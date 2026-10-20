import test from 'node:test'
import assert from 'node:assert/strict'
import { bookingOperatorFixture, bookingOrigin } from '../../engine/tests/fixtures/booking-operator'
import { createPublicBookingClient, loadPublicCompany, publicBooking, publicEvent } from '../src/services/casca/public-booking'

const memory = () => { const rows = new Map<string, string>(); return { getItem: (k: string) => rows.get(k) ?? null, setItem: (k: string, v: string) => { rows.set(k, v) }, removeItem: (k: string) => { rows.delete(k) } } }
async function fixture(t: any) {
  const f = await bookingOperatorFixture(t)
  const calls: { path: string; body: unknown; init: RequestInit }[] = []
  let loseCreate = false, loseCancelBeforeIngress = false
  const fetcher = (async (input: any, init: RequestInit = {}) => {
    const path = String(input), headers = new Headers(init.headers)
    assert.equal(init.credentials, 'omit'); assert.equal(init.cache, 'no-store'); assert.equal(init.referrerPolicy, 'no-referrer'); assert.equal(init.redirect, 'error')
    assert.equal(headers.has('x-kloel-user-id'), false); assert.equal(headers.has('cookie'), false)
    calls.push({ path, body: init.body ? JSON.parse(String(init.body)) : null, init })
    if (path.includes('/cancel?') && loseCancelBeforeIngress) { loseCancelBeforeIngress = false; throw Error('Synthetic transport loss before admission') }
    const response = await f.app.inject({ url: path, method: init.method as any ?? 'GET', headers: { ...Object.fromEntries(headers), origin: bookingOrigin }, ...(init.body ? { payload: String(init.body) } : {}) })
    if (path.includes('/bookings?') && loseCreate) { loseCreate = false; throw Error('Synthetic transport loss after admission') }
    return new Response(response.body, { status: response.statusCode })
  }) as typeof fetch
  const orgSlug = String(f.store.get(f.actor.tenantId, 'booking-pages', f.page.id)!.publicOrgSlug)
  const company = await loadPublicCompany(orgSlug, undefined, fetcher), page = company.items[0]
  const storage = memory(), client = createPublicBookingClient(page, storage, fetcher)
  return { ...f, company, page, storage, client, fetcher, calls, loseCreate: () => { loseCreate = true }, loseCancelBeforeIngress: () => { loseCancelBeforeIngress = true } }
}
test('public shell adapter reads current slots, creates a real reservation and cancels with management authority', async t => {
  const f = await fixture(t), slots = await f.client.slots(f.from, f.to)
  assert.ok(slots.length > 0); assert.ok(slots.every(s => s.startAt !== f.booked.startAt))
  const created = await f.client.create(slots[0], {})
  assert.equal(created.status, 'confirmed'); assert.equal(f.client.pending(), false); assert.equal(created.rescheduleAllowed, true)
  assert.equal(f.requests.filter(r => r.method === 'POST').length, 1)
  const event = publicEvent(f.page), row = publicBooking(created, event)
  assert.equal(row.name, ''); assert.equal(row.status, 'confirmed'); assert.equal(row.notices, undefined); assert.equal(row.meetingLink, undefined)
  assert.match(f.client.managementLink(bookingOrigin), /#booking=[a-f0-9-]+&manage=[A-Za-z0-9_-]{43}$/)
  const canceled = await f.client.cancel(); assert.equal(canceled.status, 'cancelled'); assert.equal(f.client.pending(), false)
  assert.equal(f.requests.filter(r => r.method === 'DELETE').length, 1)
})
test('lost create response preserves exact original request across reload and cannot create a duplicate', async t => {
  const f = await fixture(t), slots = await f.client.slots(f.from, f.to)
  f.loseCreate(); await assert.rejects(f.client.create(slots[0], {})); assert.equal(f.client.pending(), true)
  const restored = createPublicBookingClient(f.page, f.storage, f.fetcher)
  assert.equal(await restored.restore(''), undefined)
  const receipt = await restored.create(undefined, {})
  assert.equal(receipt.status, 'confirmed'); assert.equal(restored.pending(), false)
  const bodies = f.calls.filter(c => c.path.includes('/bookings?')).map(c => c.body)
  assert.equal(bodies.length, 2); assert.deepEqual(bodies[0], bodies[1]); assert.equal(f.requests.filter(r => r.method === 'POST').length, 1)
})
test('ambiguous cancellation keeps its original attempt when current booking still says confirmed', async t => {
  const f = await fixture(t), slots = await f.client.slots(f.from, f.to)
  await f.client.create(slots[0], {}); f.loseCancelBeforeIngress()
  await assert.rejects(f.client.cancel()); assert.equal(f.client.pending(), true)
  const observed = await f.client.cancel(); assert.equal(observed.status, 'confirmed'); assert.equal(f.client.pending(), true)
  assert.equal(f.calls.filter(c => c.path.includes('/cancel?')).length, 1); assert.equal(f.requests.filter(r => r.method === 'DELETE').length, 0)
  assert.throws(() => f.client.restart())
})
test('management link restores without tenant login after unpublishing and still permits cancellation', async t => {
  const f = await fixture(t), slots = await f.client.slots(f.from, f.to)
  const created = await f.client.create(slots[0], {}), link = f.client.managementLink(bookingOrigin)
  f.service.unpublish(f.actor, f.sessionHash, f.target.pageId)
  const restored = createPublicBookingClient({ ...f.page, unavailable: true }, memory(), f.fetcher)
  const receipt = await restored.restore(new URL(link).hash)
  assert.equal(receipt?.bookingRef, created.bookingRef); assert.equal(receipt?.rescheduleAllowed, false)
  assert.equal((await restored.cancel()).status, 'cancelled')
})
test('reschedule uses management authority, an actual quote and the current booking revision', async t => {
  const f = await fixture(t), slots = await f.client.slots(f.from, f.to)
  const created = await f.client.create(slots[0], {})
  const choices = await f.client.slots(f.from, f.to, true), target = choices.find(s => s.startAt !== created.startAt)!
  assert.ok(target)
  const moved = await f.client.reschedule(target)
  assert.equal(moved.status, 'confirmed'); assert.equal(moved.startAt, target.startAt); assert.equal(moved.endAt, target.endAt)
  assert.ok(moved.revision > created.revision); assert.equal(f.client.pending(), false)
  assert.equal(f.requests.filter(r => r.method === 'POST').length, 1); assert.equal(f.requests.filter(r => r.method === 'PATCH').length, 1)
  const request = f.calls.find(c => c.path.includes('/reschedule?'))!
  assert.equal((request.body as any).expectedRevision, created.revision)
  assert.match(new Headers(request.init.headers).get('authorization')!, /^BookingManage /)
})
