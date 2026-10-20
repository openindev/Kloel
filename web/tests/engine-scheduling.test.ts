import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { buildApp } from '../../engine/src/app'
import { Store } from '../../engine/src/store'
import { seedMember } from '../../engine/tests/fixtures/membership'
import { createEngineClient, EngineError, type EngineRequest } from '../src/services/engine/http'
import { schedulingClient, newEventConfig, publicBookingUrl, bookingOrigin } from '../src/services/engine/scheduling'
import type { Connection } from '../src/services/engine/account'

async function fixture(t: any) {
  const names = ['PUBLIC_BASE_URL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'OAUTH_ENCRYPTION_KEY'], previous = Object.fromEntries(names.map(n => [n, process.env[n]]))
  process.env.PUBLIC_BASE_URL = 'http://127.0.0.1:4310'; process.env.GOOGLE_CLIENT_ID = 'fixture'; process.env.GOOGLE_CLIENT_SECRET = 'fixture'; process.env.OAUTH_ENCRYPTION_KEY = randomBytes(32).toString('base64')
  t.after(() => { for (const name of names) if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name] })
  const store = new Store(), actor = { tenantId: randomUUID(), userId: randomUUID(), role: 'owner' as const }; seedMember(store, actor)
  const cookie = 'scheduling-frontend-fixture'
  store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(createHash('sha256').update(cookie).digest('hex'), actor.userId, actor.tenantId, Date.now() + 60000)
  const connection = store.create(actor.tenantId, 'oauth-connections', { provider: 'google', userId: actor.userId, remoteId: 'fixture-account', email: 'fixture@example.test', displayName: 'Fixture', status: 'connected', visibility: 'personal', capabilities: ['calendar', 'calendar_write'], authorizationGeneration: 1 })
  const calendar = store.create(actor.tenantId, 'calendars', { name: 'Fixture calendar', provider: 'google', connectionId: connection.id, externalCalendarId: 'primary', enabled: true, timezone: 'America/Sao_Paulo' })
  const app = await buildApp(store, { workers: false }); t.after(() => app.close())
  const calls: { path: string; method: string; body?: any }[] = [], state = { loseNextWrite: false }
  const request = createEngineClient((async (path, init = {}) => {
    assert.equal(init.credentials, 'include'); assert.equal((init.headers as any).Authorization, undefined)
    calls.push({ path: String(path), method: init.method ?? 'GET', body: init.body ? JSON.parse(String(init.body)) : undefined })
    const response = await app.inject({ method: init.method as any ?? 'GET', url: String(path), headers: { ...init.headers as Record<string, string>, cookie: `kloel_session=${cookie}` }, ...(init.body ? { payload: String(init.body) } : {}) })
    if (state.loseNextWrite && init.method !== 'GET') { state.loseNextWrite = false; throw Error('response lost after real route persisted') }
    return new Response(response.statusCode === 204 ? null : response.body, { status: response.statusCode, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch)
  const context = { tenantId: actor.tenantId, generation: 1, assertCurrent() {}, request }
  return { store, actor, connection, calendar, app, calls, state, client: schedulingClient(context), context }
}

test('scheduling client persists full event configuration, obeys revision conflicts and reads safe public links', async t => {
  const f = await fixture(t), config = { ...newEventConfig(f.calendar.id), slug: 'consulta', description: 'Descrição real' }
  assert.equal((await f.client.configuration()).publicBaseUrl, 'http://127.0.0.1:4310')
  const created = await f.client.create(config)
  assert.equal(created.revision, 1); assert.equal(created.publicationStatus, 'draft'); assert.equal(created.publicPath, null)
  assert.deepEqual(created.availability, config.availability); assert.equal((await f.client.calendars())[0].id, f.calendar.id)
  const updated = await f.client.save(created, { ...config, durationMinutes: 45, dailyLimit: 4 })
  assert.equal(updated.revision, 2); assert.equal((await f.client.events())[0].durationMinutes, 45)
  await assert.rejects(f.client.save(created, config), (e: any) => e.code === 'event_type_revision_conflict')
  assert.equal((await f.client.events())[0].dailyLimit, 4)
  f.store.update(f.actor.tenantId, 'booking-pages', created.id, { publicOrgSlug: 'o-' + 'a'.repeat(24), publicationStatus: 'published', grantId: 'private-grant-never-in-dto' })
  const published = (await f.client.events())[0]
  assert.equal(published.publicPath, `/c/o-${'a'.repeat(24)}/consulta`); assert.equal(JSON.stringify(published).includes('private-grant'), false)
  await assert.rejects(f.client.save(published, config), (e: any) => e.code === 'event_type_published')
  await f.client.unpublish(published.id); assert.equal((await f.client.events())[0].publicationStatus, 'unpublished')
  assert.equal(f.store.list(f.actor.tenantId, 'appointments').length, 0); assert.equal(f.store.list(f.actor.tenantId, 'public-bookings').length, 0)
})

test('lost scheduling response is not retried; real persisted state is recovered by GET and other tenant is rejected', async t => {
  const f = await fixture(t), config = { ...newEventConfig(f.calendar.id), slug: 'lost-response' }
  f.state.loseNextWrite = true
  await assert.rejects(f.client.create(config), (e: any) => e.code === 'network_error')
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 1)
  const items = await f.client.events(); assert.equal(items.length, 1); assert.equal(items[0].slug, config.slug)
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 1)
  await f.client.remove(items[0]); assert.equal((await f.client.events()).length, 0)
  const foreign = schedulingClient({ ...f.context, tenantId: randomUUID() })
  await assert.rejects(foreign.calendars(), (e: any) => e.code === 'invalid_response')
  f.store.db.prepare("UPDATE memberships SET role='viewer' WHERE user_id=?").run(f.actor.userId)
  await assert.rejects(f.client.configuration(), (e: any) => e.status === 403)
  await assert.rejects(f.client.create(config), (e: any) => e.status === 403)
})

test('calendar registration requires writable provider state and response parsing handles real Google/Microsoft shapes', async t => {
  const f = await fixture(t), c = { ...f.connection } as unknown as Connection
  const local = await f.client.registerCalendar(c, { id: 'fixture-secondary@example.test', name: 'Secondary', timezone: 'America/Sao_Paulo', writable: true }, 'America/Sao_Paulo')
  assert.equal(local.externalCalendarId, 'fixture-secondary@example.test'); assert.equal(local.connectionId, c.id)
  await assert.rejects(f.client.registerCalendar(c, { id: 'read-only', name: 'Read only', timezone: null, writable: false }, 'UTC'), EngineError)
  const requests: any[] = []
  const client = schedulingClient({ ...f.context, request: (async (path: string, options: any) => { requests.push({ path, options }); return { source: 'google', items: [{ id: 'cal', summary: 'Provider calendar', accessRole: 'writer', timeZone: 'UTC' }], nextPageToken: 'next/provider+token' } }) as EngineRequest })
  const remote = await client.remoteCalendars(c, 'previous/provider+token')
  assert.equal(remote.items[0].writable, true); assert.equal(remote.items[0].name, 'Provider calendar'); assert.equal(remote.nextPageToken, 'next/provider+token')
  assert.deepEqual(requests[0].options.query, { pageToken: 'previous/provider+token' })
  const ms = schedulingClient({ ...f.context, request: (async () => ({ source: 'microsoft', items: [{ id: 'calendar', name: 'Outlook', canEdit: true }], nextPageToken: null })) as EngineRequest })
  assert.equal((await ms.remoteCalendars({ ...c, provider: 'microsoft' })).items[0].writable, true)
})

test('public booking URLs reject open redirects, credentials and unsupported origins', () => {
  for (const origin of ['javascript:alert(1)', 'http://example.test', 'https://a:b@example.test', 'https://example.test/path', 'https://example.test?redirect=evil', 'https://example.test/#token']) assert.throws(() => bookingOrigin(origin), EngineError)
  for (const path of ['//evil.test', '/c/other/slug', `/c/o-${'a'.repeat(24)}/../../evil`, `/c/o-${'a'.repeat(24)}/slug?url=evil`]) assert.throws(() => publicBookingUrl('https://kloel.ai', path), EngineError)
  assert.equal(publicBookingUrl('https://kloel.ai', `/c/o-${'a'.repeat(24)}/consulta`), `https://kloel.ai/c/o-${'a'.repeat(24)}/consulta`)
})
