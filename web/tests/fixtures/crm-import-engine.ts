import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { buildApp } from '../../../engine/src/app'
import { Store } from '../../../engine/src/store'
import { sessionDigest } from '../../../engine/src/auth'
import { seedMember } from '../../../engine/tests/fixtures/membership'
import { createEngineClient, EngineError, type RequestOptions } from '../../src/services/engine/http'
import { createCRMImportClient } from '../../src/services/engine/crm-import'
import type { ExpectedContext } from '../../src/services/engine/types'
export async function importFixture(t: any) {
  const store = new Store(':memory:'), actor = { userId: randomUUID(), tenantId: randomUUID(), role: 'owner' as const }; seedMember(store, actor)
  const cookie = 'synthetic-import-' + randomUUID(); store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(sessionDigest(cookie), actor.userId, actor.tenantId, Date.now() + 600000)
  const app = await buildApp(store, { workers: false }); t.after(() => app.close())
  let cookieValue = cookie, current = true
  const hooks: { loseCommitResponse?: boolean; transform?: (path: string, body: any) => any } = {}
  const calls: { path: string; method: string; headers: Record<string, string>; body?: any }[] = []
  const request = createEngineClient((async (url, init = {}) => {
    const path = String(url), headers = init.headers as Record<string, string>; calls.push({ path, method: init.method ?? 'GET', headers, body: init.body ? JSON.parse(String(init.body)) : undefined })
    const response = await app.inject({ url: path, method: init.method as any ?? 'GET', headers: { ...headers, cookie: 'kloel_session=' + cookieValue }, ...(init.body ? { payload: String(init.body) } : {}) })
    if (path.endsWith('/import/commit') && hooks.loseCommitResponse) { hooks.loseCommitResponse = false; throw Error('Synthetic response lost after commit') }
    const body = response.json(); return Response.json(hooks.transform ? hooks.transform(path, body) : body, { status: response.statusCode })
  }) as typeof fetch)
  const me = await request<any>('/auth/me'); assert.equal(me.tenantId, actor.tenantId)
  const expected = me.context as ExpectedContext
  const assertCurrent = () => { if (!current) throw new EngineError(0, 'superseded', 'Synthetic changed context') }
  const context = { tenantId: actor.tenantId, generation: 1, assertCurrent, async request<T>(path: string, options?: RequestOptions) {
    assertCurrent(); const result = await request<T>(path, { ...options, expectedContext: expected }); assertCurrent(); return result
  } }
  return { store, app, actor, cookie, expected, context, client: createCRMImportClient(context), calls, hooks,
    expire: () => { current = false }, setCookie: (value: string) => { cookieValue = value } }
}
