import test from 'node:test'
import assert from 'node:assert/strict'
import { projectContact, projectContactSettings, contactDraft, createContactCommands, settingsPayload, importOptions } from '../src/services/casca/contacts'
import { toCRMContact, type CRMSettings, type RawContact, type ContactEdit } from '../src/services/engine/crm'
import type { EngineContext } from '../src/services/engine/session'

const settings: CRMSettings = { id: 'settings', revision: 1, autoCapture: false, creationGate: '', definitions: [{ id: 'choice', revision: 1, key: 'preference', label: 'Preferência', type: 'choice', description: '', status: 'active', aiFill: true, options: [{ id: 'morning', label: 'Manhã', status: 'active' }, { id: 'night', label: 'Noite', status: 'archived' }], example: '', showInList: false }] }
const raw: RawContact = { id: 'contact', tenantId: 'tenant', revision: 1, name: 'Ana', displayName: 'Ana', nameMode: 'structured', firstName: 'Ana', lastName: '', phones: [{ id: 'phone1', value: '+5511999999999', label: '' }], emails: [], primaryPhoneId: 'phone1', primaryEmailId: null, company: '', notes: '', ownerMembershipId: 'member', fieldValues: { choice: 'morning' }, fieldMetadata: {}, tags: [], timezone: 'America/Sao_Paulo', source: 'legacy', createdAt: '2026-10-19T10:00:00Z', updatedAt: '2026-10-19T10:00:00Z' }
const row = toCRMContact(raw, 'tenant'), members = new Map([['member', 'user']])
const draft: ContactEdit = { firstName: 'Ana', lastName: '', phones: [{ value: '+55 11 99999-9999', label: '' }], emails: [], company: '', notes: '', ownerId: 'user', fields: { choice: 'Manhã' } }
const identity = { userId: 'user', tenantId: 'tenant', membershipId: 'member', authorityVersion: 'a'.repeat(64) }
const memory = () => { const map = new Map<string, string>(); return { map, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v) }, removeItem: (k: string) => { map.delete(k) } } }
test('contact projection translates stable choice IDs and owner memberships without fabricating communication state', () => {
  const view = projectContact(row, settings, members)
  assert.equal(view.fields.choice, 'Manhã'); assert.equal(view.ownerId, 'user'); assert.equal(view.source, 'legacy')
  assert.equal(view.whatsappAi, undefined); assert.equal(view.blocked, undefined); assert.equal(view.history, undefined)
  assert.deepEqual(projectContactSettings(settings, 'tenant').smartFields[0]?.options, ['Manhã'])
})
test('edits preserve endpoint identity and translate UI choices and responsible user back to engine IDs', () => {
  const next = contactDraft(draft, { settings, members }, row)
  assert.equal(next.phones[0]?.id, 'phone1'); assert.equal(next.ownerId, 'member'); assert.equal(next.fields.choice, 'morning')
  assert.throws(() => contactDraft({ ...draft, ownerId: 'removed' }, { settings, members }, row), /responsável/)
})
test('field definitions keep existing keys and choice IDs and carry the advanced capture options', () => {
  const projected = projectContactSettings(settings, 'tenant')
  const payload = settingsPayload(projected, settings)
  assert.equal(payload.definitions[0]?.key, 'preference'); assert.equal(payload.definitions[0]?.options[0]?.id, 'morning')
  const advanced = settingsPayload({ ...projected, smartFields: [{ ...projected.smartFields[0]!, keepUpdated: true, updateWhen: 'Apenas se mudar', findHint: 'Turno preferido' }] }, settings)
  assert.equal(advanced.definitions[0]?.updateWhen, 'Apenas se mudar'); assert.equal(advanced.definitions[0]?.findHint, 'Turno preferido'); assert.equal(advanced.definitions[0]?.keepUpdated, true)
})
test('lost create response reuses only the explicit attempt key and stores no contact data', async () => {
  const storage = memory(), keys: string[] = []; let calls = 0
  const context = { tenantId: 'tenant', generation: 1, assertCurrent() {}, async request(_path: string, options: any) { keys.push(options.idempotencyKey); if (++calls === 1) throw new Error('lost'); return { ...raw, source: 'manual' } } } as EngineContext
  const snapshot = { settings, members, contacts: new Map() }
  await assert.rejects(createContactCommands(context, snapshot, storage, identity).save(draft), /lost/)
  assert.equal(storage.map.size, 1)
  assert.equal([...storage.map.values()][0]?.includes('Ana'), false)
  await assert.rejects(createContactCommands(context, snapshot, storage, identity).save({ ...draft, firstName: 'Bia' }), /anterior/)
  assert.equal(calls, 1)
  assert.equal((await createContactCommands(context, snapshot, storage, identity).save(draft)).firstName, 'Ana')
  assert.equal(keys[0], keys[1]); assert.equal(storage.map.size, 0)
})
test('a stale session cannot publish a create result or discard its uncertain receipt', async () => {
  const storage = memory(); let active = true
  const context = { tenantId: 'tenant', generation: 1, assertCurrent() { if (!active) throw new Error('superseded') }, async request() { active = false; return raw } } as EngineContext
  await assert.rejects(createContactCommands(context, { settings, members, contacts: new Map() }, storage, identity).save(draft), /superseded/)
  assert.equal(storage.map.size, 1)
})
test('CAS edits use the displayed revision and never turn a failed update into local success', async () => {
  const calls: any[] = [], context = { tenantId: 'tenant', generation: 1, assertCurrent() {}, async request(_p: string, options: any) { calls.push(options); throw new Error('revision conflict') } } as EngineContext
  const snapshot = { settings, members, contacts: new Map([[row.id, row]]) }
  await assert.rejects(createContactCommands(context, snapshot, memory(), identity).save(draft, row.id), /revision conflict/)
  assert.equal(calls[0].etag, '"contact:contact:1"'); assert.equal(snapshot.contacts.get(row.id)?.revision, 1)
})
test('CSV overwrite omits blank cells, collapses duplicate-file rows and maps choices to stable IDs', () => {
  const record = { firstName: 'Ana', lastName: '', phones: ['+5511999999999'], emails: [], company: '', notes: '', fields: { choice: 'Manhã' } }
  const payload = importOptions([{ row: 2, record, warnings: [], status: { kind: 'new' } }, { row: 3, record: { ...record, company: 'Clínica' }, warnings: [], status: { kind: 'merge_file', row: 2 } }], 'overwrite', settings)
  assert.equal(payload.bundle.contacts.length, 1)
  assert.equal(payload.bundle.contacts[0]?.data.notes, undefined)
  assert.equal(payload.bundle.contacts[0]?.data.company, 'Clínica')
  assert.equal(payload.bundle.contacts[0]?.data.fieldValues?.choice, 'morning')
})
