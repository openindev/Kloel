import Fastify from '../../../engine/node_modules/fastify/fastify.js'
import cookie from '../../../engine/node_modules/@fastify/cookie/index.js'
import { createHash, randomUUID } from 'node:crypto'
import { Store } from '../../../engine/src/store'
import { registerAuth, hashPassword } from '../../../engine/src/auth'
import { registerMembers } from '../../../engine/src/members'
import { registerAccountProfile } from '../../../engine/src/account-profile'
import { capabilitiesFor } from '../../../engine/src/memberships/permissions'
import { seedMember } from '../../../engine/tests/fixtures/membership'
import { createEngineClient, EngineError } from '../../src/services/engine/http'
import { createTeamService } from '../../src/services/engine/team'

export async function teamFixture(t: any) {
  const previousKey = process.env.OAUTH_ENCRYPTION_KEY; process.env.OAUTH_ENCRYPTION_KEY = Buffer.alloc(32, 79).toString('base64')
  const store = new Store(':memory:'), app = Fastify(), tenantId = randomUUID(), owner = { userId: randomUUID(), tenantId, role: 'owner' as const }, member = { userId: randomUUID(), tenantId, role: 'member' as const }, admin = { userId: randomUUID(), tenantId, role: 'admin' as const }
  const password = 'Isolated-test-password-123'
  for (const actor of [owner, member, admin]) { seedMember(store, actor); store.db.prepare('UPDATE users SET password=? WHERE id=?').run(hashPassword(password), actor.userId) }
  const state = { cookie: '', lostResponsePath: '', dropCookieOnLoss: false, requests: [] as Array<{ path: string; method: string; body?: any }>, afterResponse: undefined as (() => void) | undefined }
  function loginAs(userId: string, selectedTenant = tenantId) { const token = randomUUID(); store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'), userId, selectedTenant, Date.now() + 3600000); state.cookie = token; return token }
  loginAs(owner.userId)
  await app.register(cookie); await registerAuth(app, store); await registerMembers(app, store); await registerAccountProfile(app, store)
  app.get('/api/v1/capabilities', async request => ({ role: request.actor!.role, permissions: capabilitiesFor(request.actor!.role), items: [] }))
  app.get('/api/v1/organization-settings', async () => ({ name: 'Isolated team', timezone: 'America/Sao_Paulo' }))
  const localFetch: typeof fetch = async (path, options = {}) => {
    const url = String(path); if (!url.startsWith('/api/v1/')) throw Error('No external network in team fixture')
    state.requests.push({ path: url, method: options.method ?? 'GET', ...(options.body ? { body: JSON.parse(String(options.body)) } : {}) })
    const response = await app.inject({ method: (options.method ?? 'GET') as any, url, headers: { ...options.headers as Record<string, string>, ...(state.cookie ? { cookie: `kloel_session=${state.cookie}` } : {}) }, ...(options.body ? { payload: String(options.body) } : {}) })
    const lost = state.lostResponsePath === url
    if (!(lost && state.dropCookieOnLoss)) { const raw = response.headers['set-cookie']; const first = Array.isArray(raw) ? raw[0] : raw; if (typeof first === 'string') state.cookie = /^kloel_session=([^;]*)/.exec(first)?.[1] ?? state.cookie }
    state.afterResponse?.()
    if (lost) { state.lostResponsePath = ''; throw Error('Isolated lost response') }
    return new Response(response.statusCode === 204 ? null : response.body, { status: response.statusCode, headers: { 'Content-Type': 'application/json' } })
  }
  const request = createEngineClient(localFetch); let current = true
  const context = { tenantId, generation: 1, assertCurrent() { if (!current) throw new EngineError(0, 'superseded', 'changed') }, request }
  const savedFetch = globalThis.fetch
  t.after(async () => { globalThis.fetch = savedFetch; await app.close(); store.close(); if (previousKey === undefined) delete process.env.OAUTH_ENCRYPTION_KEY; else process.env.OAUTH_ENCRYPTION_KEY = previousKey })
  return { store, app, owner, member, admin, password, state, context, request, service: createTeamService(context), localFetch, loginAs, invalidate: () => { current = false } }
}
