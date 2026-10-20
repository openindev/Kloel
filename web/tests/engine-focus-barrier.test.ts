import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { EngineError } from '../src/services/engine/http'
import type { Identity } from '../src/services/engine/types'

const deferred = <T,>() => { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const identity = (): Identity => ({ userId: 'focus-owner', tenantId: 'focus-tenant', email: 'focus@example.test', role: 'owner', permissions: ['agents:read', 'agents:write', 'organization:read'], context: { userId: 'focus-owner', tenantId: 'focus-tenant', membershipId: 'focus-membership', authorityVersion: 'a'.repeat(64) }, organizations: [{ id: 'focus-tenant', tenantId: 'focus-tenant', name: 'Focus', status: 'active', role: 'owner', membershipId: 'focus-membership', createdAt: '2026-10-18', joinedAt: '2026-10-18' }] })
const calls: Array<{ path: string; method: string; headers: Record<string, string> }> = []
let intercept: ((path: string, init: RequestInit) => Promise<Response> | Response | undefined) | undefined
const originalFetch = globalThis.fetch
globalThis.fetch = async (url, init = {}) => {
  const path = String(url).replace('/api/v1', '')
  calls.push({ path, method: init.method ?? 'GET', headers: init.headers as Record<string, string> })
  const response = intercept?.(path, init)
  if (response) return response
  if (path === '/auth/me') return Response.json(identity())
  if (path === '/account/profile') return Response.json({ id: 'focus-owner', email: 'focus@example.test', firstName: 'Focus', lastName: '', language: 'pt-BR', phone: null, revision: 1, profileCreatedAt: null, updatedAt: null })
  if (path === '/capabilities') return Response.json({ role: 'owner', permissions: identity().permissions, items: [] })
  if (path === '/organization-settings') return Response.json({ name: 'Focus', timezone: 'UTC' })
  if (path === '/agents') return Response.json({ accepted: true, id: 'synthetic-agent' })
  throw new Error(`Unexpected synthetic route ${path}`)
}
const { engineSession, captureEngineContext } = await import('../src/services/engine/session')
after(() => { globalThis.fetch = originalFetch })
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
async function setup() { intercept = undefined; await engineSession.refresh(); calls.length = 0; return captureEngineContext('agents:write') }
const posts = () => calls.filter(call => call.method === 'POST')
const denied = (error: unknown) => error instanceof EngineError && error.status === 0

test('a new request waits for focus validation and uses its original expected context without an override', async () => {
  const context = await setup(), gate = deferred<Response>(); let once = true
  intercept = path => path === '/auth/me' && once ? (once = false, gate.promise) : undefined
  const focus = engineSession.revalidateOnFocus()
  const write = context.request('/agents', { method: 'POST', body: {}, expectedContext: { ...identity().context, userId: 'cannot-override' } })
  await flush(); assert.equal(posts().length, 0)
  assert.throws(() => context.assertCurrent(), (error: any) => error.code === 'session_validation_pending' && error.status === 0)
  gate.resolve(Response.json(identity())); await focus
  assert.deepEqual(await write, { accepted: true, id: 'synthetic-agent' })
  assert.equal(posts().length, 1); assert.equal(posts()[0].headers['X-Kloel-Expected-User'], 'focus-owner')
  assert.equal(posts()[0].headers['X-Kloel-Expected-Authority'], identity().context.authorityVersion)
})

test('an already accepted write waits for equivalent validation and returns once without another POST', async () => {
  const context = await setup(), sent = deferred<void>(), response = deferred<Response>(), check = deferred<Response>(); let once = true, settled = false
  intercept = path => path === '/agents' ? (sent.resolve(), response.promise) : path === '/auth/me' && once ? (once = false, check.promise) : undefined
  const write = context.request('/agents', { method: 'POST', body: {}, idempotencyKey: 'focus-existing-operation' }).then(value => { settled = true; return value })
  await sent.promise
  const focus = engineSession.revalidateOnFocus()
  response.resolve(Response.json({ accepted: true, id: 'already-created' })); await flush()
  assert.equal(settled, false); assert.equal(posts().length, 1)
  check.resolve(Response.json(identity())); await focus
  assert.deepEqual(await write, { accepted: true, id: 'already-created' }); assert.equal(posts().length, 1)
})

test('an accepted response followed by failed focus validation remains unknown to the UI and is never retried', async () => {
  const context = await setup(), sent = deferred<void>(), response = deferred<Response>(), check = deferred<Response>(); let once = true, success = false
  intercept = path => path === '/agents' ? (sent.resolve(), response.promise) : path === '/auth/me' && once ? (once = false, check.promise) : undefined
  const write = context.request('/agents', { method: 'POST', body: {}, idempotencyKey: 'focus-uncertain-operation' }).then(value => { success = true; return value })
  const rejected = assert.rejects(write, (error: any) => denied(error) && error.code === 'session_validation_failed')
  await sent.promise; const generation = context.generation, focus = engineSession.revalidateOnFocus()
  response.resolve(Response.json({ accepted: true, id: 'created-but-not-presentable' })); await flush()
  check.resolve(Response.json({ error: { code: 'unavailable', message: 'Try later' } }, { status: 503 })); await Promise.all([focus, rejected])
  assert.equal(success, false); assert.equal(posts().length, 1); assert.equal(engineSession.getSnapshot().validation, 'error')
  intercept = undefined; await engineSession.revalidateOnFocus()
  assert.equal(engineSession.getSnapshot().generation, generation); assert.equal(posts().length, 1)
})

test('a lost write response during checking keeps network uncertainty after the probe, without repeating it', async () => {
  const context = await setup(), sent = deferred<void>(), response = deferred<Response>(), check = deferred<Response>(); let once = true, settled = false
  intercept = path => path === '/agents' ? (sent.resolve(), response.promise) : path === '/auth/me' && once ? (once = false, check.promise) : undefined
  const write = context.request('/agents', { method: 'POST', body: {} }).catch(error => { settled = true; throw error })
  const rejected = assert.rejects(write, (error: any) => denied(error) && error.code === 'network_error')
  await sent.promise; const focus = engineSession.revalidateOnFocus()
  response.reject(new Error('synthetic response lost')); await flush(); assert.equal(settled, false)
  check.resolve(Response.json(identity())); await Promise.all([focus, rejected]); assert.equal(posts().length, 1)
})

test('aborting a queued request never dispatches it when validation later completes', async () => {
  const context = await setup(), check = deferred<Response>(), abort = new AbortController(); let once = true
  intercept = path => path === '/auth/me' && once ? (once = false, check.promise) : undefined
  const focus = engineSession.revalidateOnFocus(), write = context.request('/agents', { method: 'POST', body: {}, signal: abort.signal })
  const rejected = assert.rejects(write, denied); abort.abort(); await rejected
  check.resolve(Response.json(identity())); await focus
  assert.equal(posts().length, 0)
})

test('401 during focus invalidates a write already in flight even when its transport ignores abort', async () => {
  const context = await setup(), sent = deferred<void>(), response = deferred<Response>(), check = deferred<Response>(); let once = true
  intercept = path => path === '/agents' ? (sent.resolve(), response.promise) : path === '/auth/me' && once ? (once = false, check.promise) : undefined
  const write = context.request('/agents', { method: 'POST', body: {} }), rejected = assert.rejects(write, denied)
  await sent.promise; const focus = engineSession.revalidateOnFocus()
  check.resolve(Response.json({ error: { code: 'unauthorized', message: 'Revoked' } }, { status: 401 })); await focus
  response.resolve(Response.json({ accepted: true })); await rejected
  assert.equal(engineSession.getSnapshot().phase, 'anonymous'); assert.equal(engineSession.getSnapshot().data, undefined); assert.equal(posts().length, 1)
})

test('in-flight context rejection remains status zero and forces hard refresh without waiting for a stale focus probe', async () => {
  const context = await setup(), sent = deferred<void>(), response = deferred<Response>(), check = deferred<Response>(); let once = true
  intercept = path => path === '/agents' ? (sent.resolve(), response.promise) : path === '/auth/me' && once ? (once = false, check.promise) : undefined
  const write = context.request('/agents', { method: 'POST', body: {} }), rejected = assert.rejects(write, (error: any) => error.status === 0 && error.rawStatus === 409 && error.code === 'context_changed_in_flight')
  await sent.promise; const focus = engineSession.revalidateOnFocus(); await flush()
  response.resolve(Response.json({ error: { code: 'context_changed_in_flight', message: 'Changed' } }, { status: 409 })); await rejected; await focus
  assert.ok(engineSession.getSnapshot().generation > context.generation); assert.equal(posts().length, 1)
  check.resolve(Response.json(identity())); await engineSession.refresh()
})
