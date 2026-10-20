import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { buildApp } from '../../engine/src/app'
import { Store } from '../../engine/src/store'
import { seedMember } from '../../engine/tests/fixtures/membership'
import { createEngineClient, EngineError, type EngineRequest } from '../src/services/engine/http'
import { contactPayload, createCRMClient, toCRMContact, toCRMFields, type CRMContact, type CRMSettings, type ContactEdit, type RawContact } from '../src/services/engine/crm'

const draft = (patch: Partial<ContactEdit> = {}): ContactEdit => ({ firstName: 'Ana', lastName: 'Silva', nameMode: 'structured', phones: [{ value: '+5511999990000', label: 'WORK' }], emails: [{ value: 'ana@example.test', label: 'HOME' }], company: 'ACME', notes: '', fields: {}, ...patch })
async function fixture(t: any) {
  const store = new Store(), tenantId = 'frontend-crm', actor = { tenantId, userId: 'frontend-owner', role: 'owner' as const }; seedMember(store, actor)
  store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(createHash('sha256').update('crm-cookie').digest('hex'), actor.userId, tenantId, Date.now() + 60000)
  const app = await buildApp(store, { workers: false }); t.after(() => app.close())
  const seen: { path: string; options: RequestInit }[] = []
  const request = createEngineClient((async (url, options = {}) => {
    seen.push({ path: String(url), options }); assert.equal(options.credentials, 'include'); assert.equal((options.headers as any).Authorization, undefined)
    const response = await app.inject({ method: options.method as any ?? 'GET', url: String(url), headers: { ...options.headers as Record<string, string>, cookie: 'kloel_session=crm-cookie' }, ...(options.body ? { payload: String(options.body) } : {}) })
    return new Response(response.statusCode === 204 ? null : response.body, { status: response.statusCode, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch)
  let current = true
  const assertCurrent = () => { if (!current) throw new EngineError(0, 'superseded', 'Sessão alterada') }
  const context = { tenantId, generation: 1, assertCurrent, request: (async <T,>(path: string, options: any) => { assertCurrent(); const value = await request<T>(path, options); assertCurrent(); return value }) as EngineRequest }
  const client = createCRMClient(context), settings = await client.settings()
  return { store, app, actor, client, settings, seen, context, expire: () => { current = false } }
}

test('real CRM HTTP creates idempotently, lists server pages, searches, edits with CAS and deletes', async t => {
  const f = await fixture(t), payload = contactPayload(draft(), f.settings)
  const created = await f.client.create(payload, 'crm-create-fixture'); assert.equal(created.revision, 1); assert.equal(created.orgId, f.actor.tenantId)
  assert.equal((await f.client.create(payload, 'crm-create-fixture')).id, created.id)
  await f.client.create(contactPayload(draft({ firstName: 'Bruna', phones: [], emails: [{ value: 'b@example.test', label: '' }] }), f.settings), 'crm-second-fixture')
  const first = await f.client.list({ page: 1, limit: 1, sort: 'name', order: 'asc' }); assert.equal(first.items.length, 1); assert.equal(first.total, 2); assert.equal(first.totalPages, 2)
  assert.equal((await f.client.list({ q: 'ana@example.test' })).items[0].id, created.id)
  const saved = await f.client.update(created, contactPayload(draft({ notes: 'Real note', phones: created.phones, emails: created.emails }), f.settings, created)); assert.equal(saved.revision, 2); assert.equal(saved.notes, 'Real note')
  await assert.rejects(f.client.update(created, payload), (error: any) => error.code === 'revision_conflict')
  assert.equal((await f.client.get(created.id)).notes, 'Real note')
  await f.client.remove(saved); await assert.rejects(f.client.get(created.id), (error: any) => error.status === 404)
  assert.ok(f.seen.some(call => (call.options.headers as any)['If-Match'] === `"contact:${created.id}:1"`)); assert.ok(f.seen.some(call => call.path.includes('q=ana%40example.test')))
})

test('multiple destinations retain IDs and primary; changed destinations become new entries without consent', async t => {
  const f = await fixture(t), original = await f.client.create(contactPayload(draft({ phones: [{ value: '+5511999990000', label: 'WORK' }, { value: '+5511888880000', label: 'HOME' }] }), f.settings), 'multi-contact-fixture')
  const same = draft({ phones: original.phones.map(phone => ({ ...phone, value: phone.value.replace('+55', '+55 ') })), emails: original.emails })
  const preserved = await f.client.update(original, contactPayload(same, f.settings, original)); assert.deepEqual(preserved.phones.map(p => p.id), original.phones.map(p => p.id)); assert.equal(preserved.raw.primaryPhoneId, original.raw.primaryPhoneId)
  const changed = await f.client.update(preserved, contactPayload(draft({ phones: [{ ...preserved.phones[0], value: '+5511777770000' }, preserved.phones[1]], emails: preserved.emails }), f.settings, preserved))
  assert.notEqual(changed.phones[0].id, original.phones[0].id); assert.equal(changed.phones[1].id, original.phones[1].id); assert.equal(changed.raw.primaryPhoneId, changed.phones[0].id)
  assert.equal(f.store.list(f.actor.tenantId, 'contact-permission-events').length, 0)
  const body = JSON.parse(String(f.seen.findLast(call => call.options.method === 'PATCH')?.options.body)); assert.equal(body.consent, undefined); assert.equal(body.blocked, undefined); assert.equal(body.whatsappAi, undefined)
})

test('settings CAS preserves option IDs/archival and fields round-trip false, decimal precision and choice labels', async t => {
  const f = await fixture(t)
  const saved = await f.client.saveSettings(f.settings, { autoCapture: false, creationGate: '', definitions: [
    { key: 'flag', label: 'Flag', type: 'boolean', status: 'active', description: '', aiFill: false, options: [], example: '', showInList: true },
    { key: 'amount', label: 'Amount', type: 'number', status: 'active', description: '', aiFill: false, options: [], example: '', showInList: true },
    { key: 'choice', label: 'Choice', type: 'choice', status: 'active', description: '', aiFill: false, options: [{ label: 'First', status: 'active' }, { label: 'Second', status: 'active' }], example: '', showInList: true },
  ] }); const [flag, number, choice] = saved.definitions
  const created = await f.client.create(contactPayload(draft({ fields: { [flag.id]: 'Não', [number.id]: '12345678901234567890123456.12', [choice.id]: choice.options[0].id } }), saved), 'typed-fields-fixture')
  assert.equal(created.raw.fieldValues[flag.id], false); assert.equal(created.fields[flag.id], 'Não'); assert.equal(created.raw.fieldValues[number.id], '12345678901234567890123456.12'); assert.equal(toCRMFields(saved)[2].choices[0].label, 'First')
  const definitions = saved.definitions.map(({ revision, ...field }) => ({ ...field, options: field.options.map((option, index) => ({ ...option, ...(index === 0 ? { label: 'Renamed', status: 'archived' as const } : {}) })) }))
  const newer = await f.client.saveSettings(saved, { autoCapture: false, creationGate: '', definitions }); assert.equal(newer.definitions[2].options[0].id, choice.options[0].id)
  await assert.rejects(f.client.saveSettings(saved, { autoCapture: false, creationGate: '', definitions }), (error: any) => error.code === 'revision_conflict')
  const next = await f.client.update(created, contactPayload(draft({ phones: created.phones, emails: created.emails, notes: 'Keep all values', fields: created.fields }), newer, created)); assert.deepEqual(next.raw.fieldValues, created.raw.fieldValues)
})

test('clearing an active smart field sends null; archived values and unknown data are not destroyed', async t => {
  const f = await fixture(t); const field = { id: 'active', revision: 1, key: 'active', label: 'Active', type: 'text' as const, status: 'active' as const, description: '', aiFill: false, options: [], example: '', showInList: false }
  const settings: CRMSettings = { ...f.settings, definitions: [field, { ...field, id: 'archived', key: 'archived', status: 'archived' }] }
  const raw = { id: 'contact', tenantId: f.actor.tenantId, revision: 2, name: 'Legacy Full Name', displayName: 'Legacy Full Name', nameMode: 'custom', firstName: '', lastName: '', phones: [], emails: [], primaryPhoneId: null, primaryEmailId: null, company: '', notes: '', ownerMembershipId: null, fieldValues: { active: 'remove', archived: 'keep' }, fieldMetadata: {}, tags: ['preserved'], timezone: 'Europe/Lisbon', source: 'legacy', createdAt: '', updatedAt: '' } as RawContact
  const previous = toCRMContact(raw, f.actor.tenantId), payload = contactPayload(draft({ displayName: raw.displayName, nameMode: 'custom', phones: [], emails: [], fields: { active: '', archived: 'keep' } }), settings, previous)
  assert.deepEqual(payload.fieldValues, { active: null }); assert.equal(payload.displayName, raw.displayName); assert.equal((payload as any).timezone, undefined); assert.equal((payload as any).tags, undefined)
})

test('deleting a linked contact keeps the conversation without the contact; removed membership and tenant mismatch fail without simulated success', async t => {
  const f = await fixture(t), contact = await f.client.create(contactPayload(draft(), f.settings), 'linked-fixture')
  const conversation = f.store.create(f.actor.tenantId, 'conversations', { contactId: contact.id, channel: 'phone', status: 'open' })
  assert.equal((await f.client.conversations(contact.id)).total, 1)
  const permissions = await f.client.permissions(contact.id); assert.deepEqual(permissions.items, [])
  assert.throws(() => toCRMContact(contact.raw, 'other'), (error: any) => error.code === 'invalid_contact')
  const other = await f.client.create(contactPayload({ ...draft(), phones: [{ value: '+5511988887777', label: '' }], emails: [] }, f.settings), 'second-fixture')
  await f.client.remove(contact)
  assert.equal(f.store.get(f.actor.tenantId, 'contacts', contact.id), undefined); assert.equal(f.store.get(f.actor.tenantId, 'conversations', conversation.id)?.contactId, null)
  f.store.db.prepare('DELETE FROM memberships WHERE tenant_id=? AND user_id=?').run(f.actor.tenantId, f.actor.userId)
  await assert.rejects(f.client.update(other, contactPayload(draft(), f.settings, other)), (error: any) => error.status === 401 || error.status === 403)
})

test('changed session during network await rejects results; uncertain POST is attempted once', async () => {
  let release!: (response: Response) => void, current = true, attempts = 0
  const assertCurrent = () => { if (!current) throw new EngineError(0, 'superseded', 'changed') }
  const request = createEngineClient((async () => { attempts++; return await new Promise<Response>(resolve => { release = resolve }) }) as typeof fetch)
  const guarded = (async <T,>(path: string, options: any) => { assertCurrent(); const value = await request<T>(path, options); assertCurrent(); return value }) as EngineRequest
  const client = createCRMClient({ tenantId: 'A', generation: 1, assertCurrent, request: guarded })
  const pending = client.list(); await new Promise(resolve => setImmediate(resolve)); current = false; release(Response.json({ items: [], page: 1, limit: 25, total: 0, totalPages: 0 })); await assert.rejects(pending, (error: any) => error.code === 'superseded'); assert.equal(attempts, 1)
  const failing = createCRMClient({ tenantId: 'A', generation: 1, assertCurrent: () => {}, request: createEngineClient((async () => { attempts++; throw new Error('connection lost') }) as typeof fetch) })
  await assert.rejects(failing.create({} as any, 'uncertain-fixture'), (error: any) => error.code === 'network_error'); assert.equal(attempts, 2)
})
