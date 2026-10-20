import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { seedMember } from '../../engine/tests/fixtures/membership'
import { sessionDigest } from '../../engine/src/auth'
import { createContact, getContact, getSettings } from '../../engine/src/crm/service'
import { digestImportOptions, type ImportOptions } from '../src/services/engine/crm-import'
import { createCRMImportJournal } from '../src/services/engine/crm-import-journal'
import { importFixture } from './fixtures/crm-import-engine'

const options = (): ImportOptions => ({ bundle: { format: 'kloel.contacts', version: 2, definitions: [], contacts: [{ data: { firstName: 'Synthetic import', emails: [{ value: 'import-fixture@example.test' }] } }] } })
test('import client uses actual context/tenant and previews, commits, reads history and exports typed data', async t => {
  const f = await importFixture(t), input = options()
  input.bundle.definitions = [{ key: 'flag', label: 'Flag', type: 'boolean' }, { key: 'amount', label: 'Amount', type: 'number' }]
  input.bundle.contacts[0].data.fieldValues = { flag: false, amount: '12345678901234567890.12' }
  const before = f.store.list(f.actor.tenantId, 'contacts'), preview = await f.client.preview(input); assert.equal(preview.canCommit, true); assert.equal(preview.summary.create, 1); assert.deepEqual(f.store.list(f.actor.tenantId, 'contacts'), before)
  const key = randomUUID(), receipt = await f.client.commit(input, preview.fingerprint, key); assert.equal(receipt.replayed, false); assert.equal(receipt.operation.result.changes.length, 1)
  assert.deepEqual(await f.client.operation(key), receipt.operation)
  const exported = await f.client.export(); assert.equal(exported.contacts.length, 1); assert.equal(exported.contacts[0].sourceId, receipt.operation.result.changes[0].id)
  const definitions = getSettings(f.store, f.actor.tenantId).definitions, contact = getContact(f.store, f.actor.tenantId, receipt.operation.result.changes[0].id)
  assert.equal(contact.fieldValues[definitions[0].id], false); assert.equal(contact.fieldValues[definitions[1].id], '12345678901234567890.12'); assert.equal(f.store.list(f.actor.tenantId, 'contact-permission-events').length, 0)
  for (const call of f.calls.filter(call => call.path.includes('/crm/'))) { assert.equal(call.headers['X-Kloel-Expected-Tenant'], f.actor.tenantId); assert.equal(call.headers['X-Kloel-Expected-Authority'], f.expected.authorityVersion) }
  assert.equal(f.calls.find(call => call.path.endsWith('/import/commit'))!.body.expectedTenantId, f.actor.tenantId)
})

test('lost commit response is recovered by GET without a second effect; historical same-key replay precedes stale preview', async t => {
  const f = await importFixture(t), input = options(), preview = await f.client.preview(input), key = randomUUID()
  f.hooks.loseCommitResponse = true; await assert.rejects(f.client.commit(input, preview.fingerprint, key), (error: any) => error.status === 0)
  assert.equal(f.store.list(f.actor.tenantId, 'contacts').length, 1); assert.equal(f.calls.filter(call => call.path.endsWith('/import/commit')).length, 1)
  const recovered = await f.client.operation(key); f.store.remove(f.actor.tenantId, 'contacts', recovered.result.changes[0].id)
  assert.deepEqual((await f.client.commit(input, preview.fingerprint, key)).operation, recovered); assert.equal(f.store.list(f.actor.tenantId, 'contacts').length, 0)
})

test('changed preview or cross-tab cookie cannot import under the captured context', async t => {
  const f = await importFixture(t), input = options(), preview = await f.client.preview(input)
  createContact(f.store, f.actor.tenantId, { firstName: 'Concurrent contact' }, f.actor.userId)
  await assert.rejects(f.client.commit(input, preview.fingerprint, randomUUID()), (error: any) => error.code === 'preview_stale')
  const fresh = await f.client.preview(input), foreign = { ...f.actor, userId: randomUUID(), tenantId: randomUUID() }; seedMember(f.store, foreign)
  const foreignCookie = 'synthetic-other-cookie'; f.store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(sessionDigest(foreignCookie), foreign.userId, foreign.tenantId, Date.now() + 60000); f.setCookie(foreignCookie)
  await assert.rejects(f.client.commit(input, fresh.fingerprint, randomUUID()), (error: any) => error.code === 'context_mismatch')
  assert.equal(f.store.list(f.actor.tenantId, 'contacts').length, 1); assert.equal(f.store.list(foreign.tenantId, 'contacts').length, 0)
})

test('malformed success remains uncertain and its actual receipt is recoverable', async t => {
  const f = await importFixture(t), input = options(), preview = await f.client.preview(input), key = randomUUID()
  f.hooks.transform = (path, body) => path.endsWith('/import/commit') ? { ...body, operation: { ...body.operation, key: randomUUID() } } : body
  await assert.rejects(f.client.commit(input, preview.fingerprint, key), (error: any) => error.status === 0 && error.code === 'invalid_import_response')
  assert.equal((await f.client.operation(key)).result.summary.create, 1); assert.equal(f.store.list(f.actor.tenantId, 'contacts').length, 1)
  f.expire(); const count = f.calls.length; await assert.rejects(f.client.operation(key), (error: any) => error.code === 'superseded'); assert.equal(f.calls.length, count)
})

test('canonical digest preserves omissions, false, exact decimals and array order while ignoring object key order', async () => {
  const a = options(), b = { bundle: { contacts: a.bundle.contacts, definitions: [], version: 2 as const, format: 'kloel.contacts' as const } }
  assert.equal(await digestImportOptions(a), await digestImportOptions(b))
  const variants = [a, { ...a, mode: 'create' as const }, { ...a, bundle: { ...a.bundle, contacts: [{ data: { ...a.bundle.contacts[0].data, notes: '' } }] } }, { ...a, bundle: { ...a.bundle, contacts: [{ data: { ...a.bundle.contacts[0].data, fieldValues: { flag: false } } }] } }, { ...a, bundle: { ...a.bundle, contacts: [{ data: { ...a.bundle.contacts[0].data, fieldValues: { flag: '0' } } }] } }]
  assert.equal(new Set(await Promise.all(variants.map(digestImportOptions))).size, variants.length)
  await assert.rejects(digestImportOptions({ ...a, mode: undefined } as any))
})

test('lost response plus journal remount recovers by GET with no file in storage and no automatic POST', async t => {
  const f = await importFixture(t), input = options(), preview = await f.client.preview(input), attempt = { key: randomUUID(), optionsDigest: await digestImportOptions(input), previewFingerprint: preview.fingerprint }
  const items = new Map<string, string>(), port = { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => { items.set(key, value) }, removeItem: (key: string) => { items.delete(key) } }
  const journal = createCRMImportJournal(port, f.expected); journal.reserve(attempt, f.context.assertCurrent)
  f.hooks.loseCommitResponse = true; await assert.rejects(f.client.commit(input, preview.fingerprint, attempt.key))
  const remounted = createCRMImportJournal(port, f.expected), restored = remounted.read().active!; assert.deepEqual(restored, attempt)
  assert.equal(f.calls.filter(call => call.path.endsWith('/import/commit')).length, 1); assert.equal(JSON.stringify([...items.values()]).includes('import-fixture@example.test'), false)
  const receipt = await f.client.operation(restored.key); assert.equal(receipt.result.summary.create, 1); remounted.clear(restored, f.context.assertCurrent)
  assert.equal(f.calls.filter(call => call.path.endsWith('/import/commit')).length, 1); assert.equal(f.store.list(f.actor.tenantId, 'contacts').length, 1); assert.equal(remounted.read().active, null)
})
