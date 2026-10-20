import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { captureFixture } from './engine-crm-capture-fixture'

const original = globalThis.fetch
let transport: typeof fetch
globalThis.fetch = (input, init) => transport(input, init)
const { engineSession, captureEngineContext } = await import('../src/services/engine/session')
after(() => { globalThis.fetch = original })

test('only exact apply grant refusals preserve generation after verifying the same identity', async t => {
  const f = await captureFixture(t); transport = f.fetcher; await engineSession.refresh()
  for (const code of ['capture_grant_inactive', 'capture_grant_changed']) {
    const context = captureEngineContext('contacts:write'), before = f.requests.length
    f.state.before = async (path, method) => path === '/api/v1/crm/capture/proposals/proposal-id/apply' && method === 'POST' ? Response.json({ error: { code, message: 'Grant stopped' } }, { status: 403 }) : undefined
    await assert.rejects(context.request('/crm/capture/proposals/proposal-id/apply', { method: 'POST', body: {} }), (error: any) => error.status === 403 && error.code === code)
    assert.equal(engineSession.getSnapshot().generation, context.generation); assert.equal(engineSession.getSnapshot().validation, 'ready')
    assert.ok(f.requests.slice(before).some(r => r.path === '/api/v1/auth/me')); assert.equal(f.requests.slice(before).filter(r => r.method === 'POST').length, 1)
  }
})

test('business refusal followed by membership ABA invalidates old authority instead of exposing terminal projection', async t => {
  const f = await captureFixture(t); transport = f.fetcher; await engineSession.refresh(); const context = captureEngineContext('contacts:write')
  f.state.before = async (path, method) => { if (path.endsWith('/apply') && method === 'POST') {
    f.store.db.prepare('UPDATE memberships SET role=? WHERE user_id=? AND tenant_id=?').run('admin', f.actor.userId, f.actor.tenantId)
    f.store.db.prepare('UPDATE memberships SET role=? WHERE user_id=? AND tenant_id=?').run('owner', f.actor.userId, f.actor.tenantId)
    return Response.json({ error: { code: 'capture_grant_inactive', message: 'Grant stopped' } }, { status: 403 })
  } }
  await assert.rejects(context.request('/crm/capture/proposals/proposal-id/apply', { method: 'POST', body: {} }), (error: any) => error.status === 0)
  assert.ok(engineSession.getSnapshot().generation > context.generation)
})

test('other routes, methods and generic forbidden errors keep existing hard invalidation behavior', async t => {
  const f = await captureFixture(t); transport = f.fetcher
  for (const [path, method, code] of [['/crm/capture/proposals/proposal-id/dismiss', 'POST', 'capture_grant_inactive'], ['/crm/capture/proposals/proposal-id/apply', 'GET', 'capture_grant_inactive'], ['/crm/capture/proposals/proposal-id/apply', 'POST', 'capture_human_authority_required']] as const) {
    f.state.before = undefined; await engineSession.refresh(); const context = captureEngineContext('contacts:write')
    f.state.before = async (url, verb) => url === '/api/v1' + path && method === verb ? Response.json({ error: { code, message: 'Denied' } }, { status: 403 }) : undefined
    await assert.rejects(context.request(path, { method }), (error: any) => error.status === 403)
    assert.ok(engineSession.getSnapshot().generation > context.generation)
    f.state.before = undefined; await engineSession.refresh()
  }
})

test('failed identity probe keeps a business refusal uncertain instead of releasing its journal', async t => {
  const f = await captureFixture(t); transport = f.fetcher; await engineSession.refresh(); const context = captureEngineContext('contacts:write')
  f.state.before = async (path, method) => path.endsWith('/apply') && method === 'POST'
    ? Response.json({ error: { code: 'capture_grant_changed', message: 'Grant changed' } }, { status: 403 })
    : path === '/api/v1/auth/me' ? Response.json({ error: { code: 'unavailable', message: 'Probe unavailable' } }, { status: 503 }) : undefined
  await assert.rejects(context.request('/crm/capture/proposals/proposal-id/apply', { method: 'POST', body: {} }), (error: any) => error.status === 0 && error.code === 'session_validation_failed')
  assert.equal(engineSession.getSnapshot().generation, context.generation); assert.equal(engineSession.getSnapshot().validation, 'error')
  f.state.before = undefined; await engineSession.revalidateOnFocus()
})
