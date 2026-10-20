import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import Fastify from '../../engine/node_modules/fastify/fastify.js'
import cookie from '../../engine/node_modules/@fastify/cookie/index.js'
import { Store } from '../../engine/src/store'
import { registerAuth } from '../../engine/src/auth'
import { registerAccountProfile } from '../../engine/src/account-profile'
import { registerDomains } from '../../engine/src/domains'
import { registerIntegrations } from '../../engine/src/integrations'
import { registerOAuth } from '../../engine/src/oauth'
import { configureSpreadsheet } from '../../engine/src/oauth/sheets'
import { tokenContext } from '../../engine/src/oauth/access'
import { digest, seal } from '../../engine/src/oauth/crypto'
import { seedMember } from '../../engine/tests/fixtures/membership'
import { createEngineClient, EngineError } from '../src/services/engine/http'
import { createSheetsService } from '../src/services/engine/sheets'

export const spreadsheetId = 'synthetic_spreadsheet_123456789'
export const appendInput = { sheetTitle: "Client's Data", range: 'A1:C20', rows: [['=SUM(A1:A3)', 42, true]] }
export const sheetAck = { spreadsheetId, updates: { updatedRange: "'Client''s Data'!A21:C21", updatedRows: 1, updatedColumns: 3, updatedCells: 3 } }
export async function sheetsFixture(t: any) {
  const names = ['OAUTH_ENCRYPTION_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'PUBLIC_BASE_URL'], previous = Object.fromEntries(names.map(n => [n, process.env[n]])), oldFetch = globalThis.fetch
  process.env.OAUTH_ENCRYPTION_KEY = Buffer.alloc(32, 87).toString('base64'); process.env.GOOGLE_CLIENT_ID = 'synthetic-client'; process.env.GOOGLE_CLIENT_SECRET = 'synthetic-secret'; delete process.env.PUBLIC_BASE_URL
  const store = new Store(':memory:'), actor = { tenantId: randomUUID(), userId: randomUUID(), role: 'owner' as const }; seedMember(store, actor)
  const token = randomUUID(), hash = digest(token); store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(hash, actor.userId, actor.tenantId, Date.now() + 86400000)
  const connection = store.create(actor.tenantId, 'oauth-connections', { provider: 'google', userId: actor.userId, remoteId: 'synthetic-google-owner', email: 'sheets@example.test', displayName: 'Conta Sheets', visibility: 'personal', status: 'connected', capabilities: ['sheets_read', 'sheets_append'], scopes: 'https://www.googleapis.com/auth/spreadsheets' })
  const setTokens = (expiresAt = Date.now() + 86400000) => store.update(actor.tenantId, 'oauth-connections', connection.id, { encryptedTokens: seal({ accessToken: 'synthetic-sheet-token', refreshToken: 'synthetic-refresh', expiresAt, scope: connection.scopes }, tokenContext(connection)) })
  setTokens(); const binding = configureSpreadsheet(store, actor, connection.id, { spreadsheetId, name: 'Planilha sintética', allowAppend: true })
  const app = Fastify({ logger: false }); await app.register(cookie)
  app.setErrorHandler((error: any, _req, reply) => reply.code(error.statusCode ?? error.status ?? 500).send({ error: { code: error.code ?? 'fixture_error', message: error.message } }))
  await registerAuth(app, store); await registerAccountProfile(app, store); await registerDomains(app, store); await registerIntegrations(app, store); await registerOAuth(app, store)
  const identity = (await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie: `kloel_session=${token}` } })).json()
  const requests: Array<{ path: string; method: string; body: any; headers: any }> = [], calls: Array<{ url: URL; method: string; body: any; headers: Headers }> = []
  const hooks: { provider?: (request: typeof calls[number]) => Response | void | Promise<Response | void> } = {}
  const state = { current: true, cookie: token, before: undefined as undefined | ((path: string, method: string, body: any) => Promise<Response | void>), after: undefined as undefined | ((path: string, method: string, response: Response) => Promise<Response>) }
  const providerFetch: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input)); assert.ok(['sheets.googleapis.com', 'oauth2.googleapis.com'].includes(url.hostname), 'Real network forbidden')
    const request = { url, method: init.method ?? 'GET', body: init.body ? (url.hostname === 'oauth2.googleapis.com' ? new URLSearchParams(String(init.body)) : JSON.parse(String(init.body))) : undefined, headers: new Headers(init.headers) }; calls.push(request)
    const handled = await hooks.provider?.(request); if (handled) return handled
    if (url.hostname === 'oauth2.googleapis.com') return Response.json({ access_token: 'synthetic-sheet-token', token_type: 'Bearer', expires_in: 3600, scope: connection.scopes })
    assert.equal(request.headers.get('authorization'), 'Bearer synthetic-sheet-token')
    if (request.method === 'POST') return Response.json(sheetAck)
    if (url.pathname.includes('/values/')) return Response.json({ range: "'Client''s Data'!A1:C20", majorDimension: 'ROWS', values: [['<img src=x onerror=alert(1)>', 42, true]] })
    return Response.json({ spreadsheetId, properties: { title: 'Planilha sintética', locale: 'pt_BR', timeZone: 'UTC' }, sheets: [{ properties: { sheetId: 0, title: appendInput.sheetTitle, index: 0 } }] })
  }
  const fetcher: typeof fetch = async (input, init = {}) => {
    const path = String(input); if (!path.startsWith('/api/v1/')) return providerFetch(input, init)
    const method = init.method ?? 'GET', body = init.body ? JSON.parse(String(init.body)) : undefined; requests.push({ path, method, body, headers: init.headers })
    const early = await state.before?.(path, method, body); if (early) return early
    const r = await app.inject({ method: method as any, url: path, headers: { ...init.headers as any, cookie: `kloel_session=${state.cookie}` }, ...(init.body ? { payload: String(init.body) } : {}) })
    const result = new Response(r.statusCode === 204 ? null : r.body, { status: r.statusCode, headers: { 'Content-Type': 'application/json' } }); return state.after ? state.after(path, method, result) : result
  }
  globalThis.fetch = fetcher
  const request = createEngineClient(fetcher), context = { tenantId: actor.tenantId, generation: 1, assertCurrent() { if (!state.current) throw new EngineError(0, 'superseded', 'Changed context') }, request: <T,>(path: string, options?: any) => request<T>(path, { ...options, expectedContext: identity.context }) }, client = createSheetsService(context, actor.userId)
  const aba = () => { store.db.prepare("UPDATE memberships SET role='viewer' WHERE user_id=?").run(actor.userId); store.db.prepare("UPDATE memberships SET role='owner' WHERE user_id=?").run(actor.userId) }
  t.after(async () => { await app.close(); store.close(); globalThis.fetch = oldFetch; for (const name of names) { if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name] } })
  return { app, store, actor, token, hash, connection, binding, identity, context, client, requests, calls, state, hooks, fetcher, providerFetch, setTokens, aba }
}
