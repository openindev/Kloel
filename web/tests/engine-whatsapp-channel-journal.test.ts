import test from 'node:test'
import assert from 'node:assert/strict'
import { createWhatsAppChannelJournal } from '../src/services/engine/whatsapp-channel-journal'
import { whatsappChannelAttempt, type WhatsAppChannelAttempt } from '../src/services/engine/whatsapp-channels'
const context = { userId: 'user', tenantId: 'tenant', membershipId: 'member', authorityVersion: 'a'.repeat(64) }
const memory = () => { const data = new Map<string, string>(); return { data, getItem: (k: string) => data.get(k) ?? null, setItem(k: string, v: string) { data.set(k, v) }, removeItem(k: string) { data.delete(k) } } }
const update = (): WhatsAppChannelAttempt => ({ key: crypto.randomUUID(), kind: 'update', channelId: 'channel', expectedVersion: 'b'.repeat(64), expectedRevision: 1, expectedEnabled: false })
test('configuration journal is opaque, separate from sends, exact authority and bounded without eviction', () => {
  const s = memory(), j = createWhatsAppChannelJournal(s, context), a = update(); s.setItem('kloel.whatsapp.attempt.v1:user:tenant', '{"key":"sender"}')
  j.reserve(a, () => {}); assert.throws(() => j.reserve(update(), () => {}))
  assert.deepEqual(j.read()[0].attempt, a); j.finish(a, 'succeeded', () => {})
  assert.deepEqual(Object.keys(JSON.parse(s.getItem(j.key)!)).sort(), ['context', 'entries', 'schemaVersion'])
  assert.ok(s.getItem('kloel.whatsapp.attempt.v1:user:tenant')); assert.equal(s.getItem(j.key)!.includes('externalId'), false)
  for (let i = 1; i < 100; i++) { const b = update(); j.reserve(b, () => {}); j.finish(b, 'succeeded', () => {}) }
  const before = s.getItem(j.key); assert.throws(() => j.reserve(update(), () => {})); assert.equal(s.getItem(j.key), before); assert.equal(j.read().length, 100)
})
test('storage failure and readback mismatch prevent safe reserve or terminal release', () => {
  const s = memory(), j = createWhatsAppChannelJournal(s, context), a = update()
  const original = s.setItem; s.setItem = () => { throw Error('unavailable') }; assert.throws(() => j.reserve(a, () => {})); assert.equal(j.read().length, 0)
  s.setItem = original; j.reserve(a, () => {}); s.setItem = () => {}; assert.throws(() => j.finish(a, 'succeeded', () => {})); assert.equal(j.read()[0].terminal, undefined)
})
test('history A cannot release unknown B, invent adoption or mark a create CAS refusal', () => {
  const s = memory(), j = createWhatsAppChannelJournal(s, context), a = update(), b = update()
  j.reserve(a, () => {}); j.finish(a, 'succeeded', () => {}); j.reserve(b, () => {}); j.finish(a, 'succeeded', () => {})
  assert.equal(j.read().find(e => e.attempt.key === b.key)!.terminal, undefined); assert.throws(() => j.finish({ ...b, channelId: 'other' } as any, 'succeeded', () => {}))
  j.finish(b, 'whatsapp_channel_configuration_changed', () => {}); const c = whatsappChannelAttempt('create'); j.reserve(c, () => {})
  assert.throws(() => j.finish(c, 'whatsapp_channel_configuration_changed', () => {}))
})
test('hard refresh with same authority retains reference; foreign authority cannot adopt it', () => {
  const s = memory(), j = createWhatsAppChannelJournal(s, context), a = update(); j.reserve(a, () => {})
  assert.deepEqual(createWhatsAppChannelJournal(s, { ...context }).read()[0].attempt, a)
  const other = createWhatsAppChannelJournal(s, { ...context, authorityVersion: 'c'.repeat(64) }); assert.deepEqual(other.read(), []); assert.equal(s.getItem(j.key), null)
})
test('corrupt records, extra private fields and fresh-context rejection fail closed', () => {
  const s = memory(), j = createWhatsAppChannelJournal(s, context), a = update()
  assert.throws(() => j.reserve(a, () => { throw Error('revoked') })); assert.equal(s.data.size, 0)
  s.setItem(j.key, '{'); assert.throws(() => j.read())
  s.setItem(j.key, JSON.stringify({ schemaVersion: 1, context, entries: [{ attempt: { ...a, name: 'private' }, createdAt: new Date().toISOString() }] })); assert.throws(() => j.read())
})

