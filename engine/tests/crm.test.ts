import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { Store } from '../src/store.js';
import { registerAuth } from '../src/auth.js';
import { registerDomains } from '../src/domains.js';
import { registerContactImport } from '../src/contact-import.js';
import { registerCRM } from '../src/crm.js';
import { canonicalContact, contactETag, createContact, getContact, getSettings, initializeCRM, lookupExact, updateContact } from '../src/crm/service.js';
import { commitCRMImport, exportCRM, previewCRMImport } from '../src/crm/import.js';
import { seedMember } from './fixtures/membership.js';

async function fixture() {
  const store = new Store(), app = Fastify(); await app.register(cookie); await registerAuth(app, store); await registerDomains(app, store); await registerCRM(app, store); await registerContactImport(app, store);
  const signup = async (name: string) => {
    const response = await app.inject({ method: 'POST', url: '/api/v1/auth/signup', payload: { email: `${name}@example.test`, password: 'test-crm-password-long', organization: name } });
    assert.equal(response.statusCode, 201, response.body);
    return { actor: response.json(), cookies: { kloel_session: response.cookies.find(value => value.name === 'kloel_session')!.value } };
  };
  const owner = await signup('crm-owner'); let serial = 0;
  const request = (method: any, url: string, payload?: any, headers: Record<string,string> = {}) => app.inject({ method, url, cookies: owner.cookies, payload, headers });
  const create = (data: any) => request('POST', '/api/v1/crm/contacts', data, { 'idempotency-key': `create-contact-${++serial}` });
  const settings = async (definitions: any[]) => { const old = await request('GET', '/api/v1/crm/settings'); return request('PUT', '/api/v1/crm/settings', { definitions, autoCapture: false, creationGate: '' }, { 'if-match': String(old.headers.etag) }); };
  return { app, store, owner, signup, request, create, settings, close: async () => { await app.close(); store.close(); } };
}
const multi = () => ({ firstName: 'Ana', lastName: 'Silva', phones: [{ value: '+55 (11) 99999-0000', label: 'HOME' }, { value: '+551132345678', label: 'WORK' }], emails: [{ value: 'ANA@EXAMPLE.TEST', label: 'HOME' }, { value: 'work@example.test', label: 'WORK' }] });

test('v2 CRUD persists all channels, uses CAS, idempotency, exact secondary lookup and tenant isolation', async t => {
  const f = await fixture(); t.after(f.close);
  const created = await f.create(multi()); assert.equal(created.statusCode, 201, created.body); const row = created.json();
  assert.equal(row.name, 'Ana Silva'); assert.equal(row.phones[0].normalized, '+5511999990000'); assert.equal(row.emails[0].value, 'ANA@EXAMPLE.TEST');
  const lookup = await f.request('GET', '/api/v1/crm/contacts/lookup?identifier=work%40example.test'); assert.equal(lookup.json().contacts[0].id, row.id); assert.equal(lookup.json().ambiguous, false);
  const quick = await f.request('GET', '/api/v1/contacts/lookup?q=work%40example.test'); assert.equal(quick.json().items[0].id, row.id);
  assert.equal((await f.request('GET', '/api/v1/contacts?q=work%40example.test')).json().total, 1);
  assert.equal((await f.request('PATCH', `/api/v1/crm/contacts/${row.id}`, { notes: 'missing condition' })).statusCode, 428);
  const saved = await f.request('PATCH', `/api/v1/crm/contacts/${row.id}`, { notes: 'Real note', primaryPhoneId: row.phones[1].id }, { 'if-match': String(created.headers.etag) });
  assert.equal(saved.statusCode, 200, saved.body); assert.equal(saved.json().revision, 2); assert.equal(saved.json().phone, '+551132345678'); assert.deepEqual(saved.json().emails, row.emails);
  const stale = await f.request('PATCH', `/api/v1/crm/contacts/${row.id}`, { notes: 'Lost update' }, { 'if-match': String(created.headers.etag) }); assert.equal(stale.statusCode, 409);
  const legacy = await f.request('PATCH', `/api/v1/contacts/${row.id}`, { company: 'Company' }, { 'if-match': String(saved.headers.etag) }); assert.equal(legacy.statusCode, 200, legacy.body); assert.equal(legacy.json().emails.length, 2);
  assert.equal((await f.request('PATCH', `/api/v1/contacts/${row.id}`, { phone: null }, { 'if-match': String(legacy.headers.etag) })).json().error.code, 'primary_identifier_resolution_required');
  const outsider = await f.signup('crm-outsider'); assert.equal((await f.app.inject({ url: `/api/v1/crm/contacts/${row.id}`, cookies: outsider.cookies })).statusCode, 404);
  assert.equal((await f.request('GET', '/api/v1/contacts/export?format=json')).json().error.code, 'lossy_export_requires_v2');
});

test('legacy and v2 writes cannot grant consent, while human evidence is destination scoped and auditable', async t => {
  const f = await fixture(); t.after(f.close);
  const denied = await f.request('POST', '/api/v1/contacts', { name: 'Bad grant', consent: { whatsapp: true } }); assert.equal(denied.json().error.code, 'consent_requires_evidence'); assert.equal(f.store.list(f.owner.actor.tenantId, 'contacts').length, 0);
  const response = await f.create(multi()), row = response.json();
  assert.equal((await f.request('PATCH', `/api/v1/crm/contacts/${row.id}`, { consent: { email: true } }, { 'if-match': String(response.headers.etag) })).statusCode, 400);
  const body = { channel: 'email', identifier: 'work@example.test', purpose: 'marketing', event: 'granted', occurredAt: '2026-10-01T10:00:00Z', source: 'Explicit subscription form' };
  const headers = { 'if-match': String(response.headers.etag), 'idempotency-key': 'permission-event-1' };
  const grant = await f.request('POST', `/api/v1/crm/contacts/${row.id}/permission-events`, body, headers); assert.equal(grant.statusCode, 201, grant.body);
  const replay = await f.request('POST', `/api/v1/crm/contacts/${row.id}/permission-events`, body, headers); assert.equal(replay.statusCode, 200); assert.equal(replay.json().replayed, true);
  const state = (await f.request('GET', `/api/v1/crm/contacts/${row.id}/permissions`)).json(); assert.equal(state.items.length, 1); assert.equal(state.items[0].identifier, 'work@example.test');
  const current = await f.request('GET', `/api/v1/crm/contacts/${row.id}`); assert.equal(current.json().consent.email, false);
  const revoked = await f.request('POST', `/api/v1/crm/contacts/${row.id}/permission-events`, { ...body, event: 'revoked', occurredAt: '2026-10-02T10:00:00Z' }, { 'if-match': String(current.headers.etag), 'idempotency-key': 'permission-event-2' }); assert.equal(revoked.statusCode, 201);
  const after = await f.request('GET', `/api/v1/crm/contacts/${row.id}`);
  const stale = await f.request('POST', `/api/v1/crm/contacts/${row.id}/permission-events`, body, { 'if-match': String(after.headers.etag), 'idempotency-key': 'permission-event-3' }); assert.equal(stale.json().error.code, 'stale_evidence');
  assert.equal(f.store.list(f.owner.actor.tenantId, 'contact-permission-events').length, 2);
});

test('API keys execute v2 CRUD with CAS but cannot reach consent, settings or bulk; revocation is fresh', async t => {
  const f = await fixture(); t.after(f.close);
  const made = await f.request('POST', '/api/v1/api-keys', { name: 'CRM key', scopes: ['contacts:read', 'contacts:write', 'contacts:delete'] }); assert.equal(made.statusCode, 201, made.body);
  const key = made.json(), headers = { authorization: `Bearer ${key.secret}`, 'idempotency-key': 'api-contact-create' };
  const created = await f.app.inject({ method: 'POST', url: '/api/v1/crm/contacts', headers, payload: multi() }); assert.equal(created.statusCode, 201, created.body);
  const row = created.json();
  for (const url of ['/api/v1/crm/settings', '/api/v1/crm/export', `/api/v1/crm/contacts/${row.id}/permissions`]) assert.equal((await f.app.inject({ url, headers, cookies: f.owner.cookies })).statusCode, 403, url);
  const denied = await f.app.inject({ method: 'POST', url: '/api/v1/contacts', headers, payload: { name: 'Untrusted', consent: { email: true, source: 'claim', recordedAt: '2026-10-01T00:00:00Z' } } }); assert.equal(denied.statusCode, 409);
  const patch = await f.app.inject({ method: 'PATCH', url: `/api/v1/crm/contacts/${row.id}`, headers: { ...headers, 'if-match': String(created.headers.etag) }, payload: { notes: 'via key' } }); assert.equal(patch.statusCode, 200, patch.body);
  await f.request('DELETE', `/api/v1/api-keys/${key.id}`);
  assert.equal((await f.app.inject({ method: 'PATCH', url: `/api/v1/crm/contacts/${row.id}`, headers: { ...headers, 'if-match': String(patch.headers.etag) }, payload: { notes: 'revoked' } })).statusCode, 401);
});

test('typed fields retain false, zero and precision; archived choices survive; settings cannot start AI', async t => {
  const f = await fixture(); t.after(f.close);
  const response = await f.settings([{ key: 'active', label: 'Active', type: 'boolean' }, { key: 'amount', label: 'Amount', type: 'number' }, { key: 'plan', label: 'Plan', type: 'choice', options: [{ label: 'Gold' }, { label: 'Silver' }] }]); assert.equal(response.statusCode, 200, response.body);
  const defs = response.json().definitions, values = { [defs[0].id]: false, [defs[1].id]: '12345678901234567890.001', [defs[2].id]: defs[2].options[0].id };
  const created = await f.create({ firstName: 'Fields', fieldValues: values }); assert.equal(created.statusCode, 201, created.body); const row = created.json(); assert.deepEqual(row.fieldValues, values);
  const invalid = await f.request('PATCH', `/api/v1/crm/contacts/${row.id}`, { fieldValues: { [defs[0].id]: 'false' } }, { 'if-match': String(created.headers.etag) }); assert.equal(invalid.statusCode, 400);
  const changed = defs.map(({ revision, ...def }: any) => def); changed[2].options[0].label = 'Golden'; changed[2].options[0].status = 'archived';
  const saved = await f.settings(changed); assert.equal(saved.statusCode, 200, saved.body);
  const note = await f.request('PATCH', `/api/v1/crm/contacts/${row.id}`, { notes: 'preserve archived option' }, { 'if-match': String(created.headers.etag) }); assert.equal(note.statusCode, 200, note.body); assert.deepEqual(note.json().fieldValues, values);
  assert.equal((await f.request('GET', `/api/v1/crm/contacts?fieldPresent=${defs[0].id}`)).json().total, 1);
  const removed = await f.settings(changed.slice(1)); assert.equal(removed.json().error.code, 'field_requires_archive');
  const settings = await f.request('GET', '/api/v1/crm/settings');
  assert.equal((await f.request('PUT', '/api/v1/crm/settings', { autoCapture: true, definitions: changed }, { 'if-match': String(settings.headers.etag) })).json().error.code, 'capability_unavailable');
  changed[0].aiFill = true; assert.equal((await f.settings(changed)).statusCode, 409);
});

test('owner is tenant membership identity, removal does not reassign and unrelated edits preserve historical owner', async t => {
  const f = await fixture(); t.after(f.close); const tenant = f.owner.actor.tenantId;
  seedMember(f.store, { tenantId: tenant, userId: 'member-one', role: 'member' }); const member = f.store.db.prepare('SELECT id FROM memberships WHERE user_id=?').get('member-one')!;
  seedMember(f.store, { tenantId: 'other', userId: 'member-other', role: 'member' }); const foreign = f.store.db.prepare('SELECT id FROM memberships WHERE user_id=?').get('member-other')!;
  assert.equal((await f.create({ firstName: 'Foreign', ownerMembershipId: foreign.id })).json().error.code, 'invalid_owner');
  const created = await f.create({ firstName: 'Assigned', ownerMembershipId: member.id }); assert.equal(created.statusCode, 201, created.body);
  f.store.db.prepare('DELETE FROM memberships WHERE id=?').run(String(member.id)); seedMember(f.store, { tenantId: tenant, userId: 'member-one', role: 'member' });
  const newMember = f.store.db.prepare('SELECT id FROM memberships WHERE user_id=?').get('member-one')!; assert.notEqual(newMember.id, member.id);
  const saved = await f.request('PATCH', `/api/v1/crm/contacts/${created.json().id}`, { notes: 'owner historical' }, { 'if-match': String(created.headers.etag) }); assert.equal(saved.statusCode, 200, saved.body); assert.equal(saved.json().ownerMembershipId, member.id);
});

test('legacy migration preserves timestamps/unknown fields, never validates consent and rolls back unsupported schema', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kloel-crm-')); const path = join(dir, 'fixture.sqlite'); let store = new Store(path);
  try {
    const before = store.create('legacy', 'contacts', { name: 'Maria da Conceição', phone: '+5511999990000', privateExtension: { keep: ['all', 0, false] }, consent: { email: true, source: 'old claim' } });
    initializeCRM(store); const migrated = getContact(store, 'legacy', before.id); assert.equal(migrated.createdAt, before.createdAt); assert.equal(migrated.updatedAt, before.updatedAt); assert.equal(migrated.firstName, ''); assert.equal(migrated.displayName, before.name); assert.deepEqual(migrated.legacySnapshot, before); assert.equal((migrated.consent as any).email, false);
    const stable = JSON.stringify(migrated); initializeCRM(store); assert.equal(JSON.stringify(getContact(store, 'legacy', before.id)), stable);
    store.close(); store = new Store(path); assert.equal(JSON.stringify(getContact(store, 'legacy', before.id)), stable);
    const next = updateContact(store, 'legacy', before.id, { notes: 'edit' }, 1, 'operator'); assert.deepEqual(next.legacySnapshot, before); assert.deepEqual(next.privateExtension, before.privateExtension);
    const exportData = exportCRM(store, 'legacy'); assert.deepEqual(exportData.contacts[0].legacyData?.privateExtension, before.privateExtension);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
  const broken = new Store(); try { const first = broken.create('a', 'contacts', { name: 'Good' }); broken.create('a', 'contacts', { name: 'Unknown', schemaVersion: 9 }); assert.throws(() => initializeCRM(broken), /desconhecida/); assert.equal(broken.get('a', 'contacts', first.id)?.schemaVersion, undefined); } finally { broken.close(); }
});

test('duplicate legacy identifiers yield ambiguity; no first-match merge or implicit conversation association', async t => {
  const f = await fixture(); t.after(f.close); const tenant = f.owner.actor.tenantId;
  const a = f.store.create(tenant, 'contacts', { name: 'A', phone: '+5511999990000' }); f.store.create(tenant, 'contacts', { name: 'B', phone: '+5511999990000' });
  assert.equal(lookupExact(f.store, tenant, '+5511999990000').ambiguous, true);
  assert.equal((await f.create({ firstName: 'C', phones: [{ value: '+5511999990000' }] })).statusCode, 409);
  f.store.create(tenant, 'conversations', { subject: 'Explicit', contactId: a.id }); f.store.create(tenant, 'conversations', { subject: 'Same phone, not linked', callerNumber: '+5511999990000' });
  const linked = await f.request('GET', `/api/v1/crm/contacts/${a.id}/conversations`); assert.equal(linked.json().total, 1);
  const deletion = await f.request('DELETE', `/api/v1/contacts/${a.id}`, undefined, { 'if-match': contactETag(canonicalContact(a)) }); assert.equal(deletion.json().error.code, 'resource_in_use');
});

test('JSON export/import preserves arrays, labels, primary selection, fields and legacy data without granting permissions', async t => {
  const f = await fixture(); t.after(f.close); const tenant = f.owner.actor.tenantId;
  const settings = await f.settings([{ key: 'approved', label: 'Approved', type: 'boolean' }, { key: 'plan', label: 'Plan', type: 'choice', options: [{ label: 'Gold' }] }]); const defs = settings.json().definitions;
  const created = await f.create({ ...multi(), fieldValues: { [defs[0].id]: false, [defs[1].id]: defs[1].options[0].id } }); let original = created.json();
  const changed = await f.request('PATCH', `/api/v1/crm/contacts/${original.id}`, { primaryEmailId: original.emails[1].id }, { 'if-match': String(created.headers.etag) }); original = changed.json();
  const bundle = exportCRM(f.store, tenant); bundle.contacts[0].legacyData = { untouched: { data: [false, '0', 'á'] }, consent: { email: true } };
  const options = { bundle }, plan = previewCRMImport(f.store, 'destination', options); assert.equal(plan.canCommit, true, JSON.stringify(plan));
  assert.equal(f.store.list('destination', 'contacts').length, 0); assert.equal(getSettings(f.store, 'destination').revision, 0);
  const result = commitCRMImport(f.store, 'destination', 'importer', options, plan.fingerprint, 'portable-import-1'); assert.equal(result.result.changes.length, 1);
  const row = getContact(f.store, 'destination', result.result.changes[0].id), importedDefs = getSettings(f.store, 'destination').definitions;
  assert.deepEqual(row.phones.map(({ id, ...entry }) => entry), original.phones.map(({ id, ...entry }: any) => entry)); assert.equal(row.email, 'work@example.test'); assert.equal(row.emails[1].id, row.primaryEmailId);
  assert.equal(row.fieldValues[importedDefs[0].id], false); assert.equal(row.fieldValues[importedDefs[1].id], importedDefs[1].options[0].id); assert.deepEqual(row.legacySnapshot?.untouched, bundle.contacts[0].legacyData.untouched); assert.equal((row.consent as any).email, false);
  assert.equal(commitCRMImport(f.store, 'destination', 'importer', options, plan.fingerprint, 'portable-import-1').replayed, true); assert.equal(f.store.list('destination', 'contacts').length, 1);
});

test('import rejects stale preview/conflicting identities and rolls back definitions, contacts and receipts', async t => {
  const f = await fixture(); t.after(f.close); const tenant = f.owner.actor.tenantId;
  const bundle = { format: 'kloel.contacts', version: 2, definitions: [{ key: 'note', label: 'Note', type: 'text' }], contacts: [{ data: { firstName: 'A', emails: [{ value: 'a@example.test' }] } }, { data: { firstName: 'B', emails: [{ value: 'b@example.test' }] } }] };
  const options = { bundle }, plan = previewCRMImport(f.store, tenant, options); assert.equal(plan.canCommit, true);
  const original = f.store.create.bind(f.store); let count = 0;
  f.store.create = (tenantId, collection, data) => { if (collection === 'contacts' && ++count === 2) throw new Error('Injected disk error'); return original(tenantId, collection, data); };
  assert.throws(() => commitCRMImport(f.store, tenant, 'actor', options, plan.fingerprint, 'rollback-import-1'), /Injected/);
  assert.equal(f.store.list(tenant, 'contacts').length, 0); assert.equal(getSettings(f.store, tenant).revision, 0); assert.equal(f.store.list(tenant, 'crm-receipts').length, 0);
  f.store.create = original; createContact(f.store, tenant, { firstName: 'Changed' }, 'actor');
  assert.throws(() => commitCRMImport(f.store, tenant, 'actor', options, plan.fingerprint, 'stale-import-1'), /mudaram/);
});

test('member can edit contacts but cannot configure or register evidence; revoked session cannot commit', async t => {
  const f = await fixture(); t.after(f.close); const userId = f.owner.actor.userId, tenant = f.owner.actor.tenantId;
  const created = await f.create(multi());
  f.store.db.prepare("UPDATE memberships SET role='member' WHERE tenant_id=? AND user_id=?").run(tenant, userId);
  assert.equal((await f.request('PATCH', `/api/v1/crm/contacts/${created.json().id}`, { notes: 'member edit' }, { 'if-match': String(created.headers.etag) })).statusCode, 200);
  const settings = await f.request('GET', '/api/v1/crm/settings'); assert.equal((await f.request('PUT', '/api/v1/crm/settings', { definitions: [] }, { 'if-match': String(settings.headers.etag) })).statusCode, 403);
  assert.equal((await f.request('POST', `/api/v1/crm/contacts/${created.json().id}/permission-events`, { channel: 'email', identifier: 'work@example.test', purpose: 'marketing', event: 'granted', occurredAt: '2026-10-01T10:00:00Z', source: 'member claim' }, { 'if-match': `"contact:${created.json().id}:2"`, 'idempotency-key': 'member-evidence-denied' })).statusCode, 403);
  f.store.db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId);
  assert.equal((await f.request('POST', '/api/v1/crm/import/commit', { bundle: {} }, { 'idempotency-key': 'revoked-import' })).statusCode, 401);
});

test('v1 import preserves positive assertions only as unverified history and CAS advances on merge', async t => {
  const f = await fixture(); t.after(f.close);
  const input = { format: 'json', content: JSON.stringify([{ name: 'Historical', email: 'history@example.test', consent: { email: true, recordedAt: '2026-10-01T10:00:00Z', source: 'Imported claim' } }]) };
  const preview = await f.request('POST', '/api/v1/contacts/import/preview', input); assert.equal(preview.statusCode, 200, preview.body); assert.equal(preview.json().rows[0].warnings[0].code, 'legacy_consent_unverified');
  const committed = await f.request('POST', '/api/v1/contacts/import/commit', { ...input, previewFingerprint: preview.json().fingerprint }, { 'idempotency-key': 'legacy-claims-import' }); assert.equal(committed.statusCode, 201, committed.body);
  const id = committed.json().changes[0].id, before = await f.request('GET', `/api/v1/contacts/${id}`); assert.equal(before.json().consent.email, false);
  const state = await f.request('GET', `/api/v1/crm/contacts/${id}/permissions`); assert.equal(state.json().legacyStatus, 'legacy_unverified'); assert.deepEqual(state.json().items, []);
  const mergeInput = { format: 'json', duplicatePolicy: 'merge', content: JSON.stringify([{ name: 'Changed', email: 'history@example.test' }]) }, merge = await f.request('POST', '/api/v1/contacts/import/preview', mergeInput);
  assert.equal((await f.request('POST', '/api/v1/contacts/import/commit', { ...mergeInput, previewFingerprint: merge.json().fingerprint }, { 'idempotency-key': 'legacy-claims-merge' })).statusCode, 201);
  assert.equal((await f.request('PATCH', `/api/v1/contacts/${id}`, { notes: 'stale form' }, { 'if-match': String(before.headers.etag) })).statusCode, 409);
});

test('import preserves false and nonempty fields, maps stable definitions, and rejects ambiguous option IDs', async t => {
  const f = await fixture(); t.after(f.close); const tenant = f.owner.actor.tenantId;
  const setup = await f.settings([{ key: 'flag', label: 'Flag', type: 'boolean' }]), def = setup.json().definitions[0];
  const created = await f.create({ firstName: 'Original', emails: [{ value: 'merge@example.test' }], fieldValues: { [def.id]: false }, notes: 'keep' });
  const bundle = exportCRM(f.store, tenant); bundle.contacts[0].data.fieldValues[def.id] = true; bundle.contacts[0].data.firstName = 'Replacement'; bundle.contacts[0].data.notes = 'replace';
  const options = { bundle, mode: 'merge' }, preview = previewCRMImport(f.store, tenant, options);
  const saved = commitCRMImport(f.store, tenant, 'operator', options, preview.fingerprint, 'merge-preserve-false'); const row = getContact(f.store, tenant, created.json().id);
  assert.equal(row.fieldValues[def.id], false); assert.equal(row.firstName, 'Original'); assert.equal(row.notes, 'keep'); assert.equal(saved.result.definitionMappings[0].id, def.id);
  f.store.update(tenant, 'contacts', row.id, { unknownFutureField: { preserve: true } }); assert.deepEqual(exportCRM(f.store, tenant).contacts[0].legacyData?.unknownFields?.unknownFutureField, { preserve: true });
  assert.throws(() => previewCRMImport(f.store, tenant, { bundle: { format: 'kloel.contacts', version: 2, definitions: [{ id: 'f1', key: 'choice', label: 'Choice', type: 'choice', options: [{ id: 'same', label: 'A' }, { id: 'same', label: 'B' }] }], contacts: [] } }), /IDs de opções/);
  assert.throws(() => previewCRMImport(f.store, tenant, { bundle: { format: 'kloel.contacts', version: 2, definitions: [{ id: 'f1', key: 'choice', label: 'Choice', type: 'choice', options: [{ id: 'archived', label: 'Old', status: 'archived' }] }], contacts: [] } }), /Opções inválidas/);
});

test('HTTP import/export requires fresh human session and replays only the same reviewed request', async t => {
  const f = await fixture(); t.after(f.close);
  const input = { bundle: { format: 'kloel.contacts', version: 2, definitions: [], contacts: [{ data: { displayName: 'HTTP import', emails: [{ value: 'http@example.test' }] } }] } };
  const preview = await f.request('POST', '/api/v1/crm/import/preview', { expectedTenantId: f.owner.actor.tenantId, options: input }); assert.equal(preview.statusCode, 200, preview.body);
  const body = { expectedTenantId: f.owner.actor.tenantId, options: input, previewFingerprint: preview.json().fingerprint }, headers = { 'idempotency-key': 'http-import-receipt' };
  const commit = await f.request('POST', '/api/v1/crm/import/commit', body, headers); assert.equal(commit.statusCode, 200, commit.body); assert.equal(commit.json().operation.result.committed, true);
  const replay = await f.request('POST', '/api/v1/crm/import/commit', body, headers); assert.equal(replay.json().replayed, true);
  assert.equal((await f.request('GET', '/api/v1/crm/export')).json().contacts.length, 1);
  const conflict = await f.request('POST', '/api/v1/crm/import/commit', { ...body, options: { ...body.options, mode: 'merge' } }, headers); assert.equal(conflict.json().error.code, 'idempotency_conflict');
});

test('overwrite_supplied preserves omitted timezone and labels, while explicit changes are applied', async t => {
  const f = await fixture(); t.after(f.close); const tenant = f.owner.actor.tenantId;
  const response = await f.create({ firstName: 'Existing', timezone: 'Europe/Lisbon', phones: [{ value: '+5511999990000', label: 'WORK' }], emails: [{ value: 'merge-label@example.test', label: 'HOME' }] }); assert.equal(response.statusCode, 201, response.body);
  const data: any = { company: 'Imported company', phones: [{ value: '+55 (11) 99999-0000' }], emails: [{ value: 'merge-label@example.test' }] };
  const options = { mode: 'merge', mergePolicy: 'overwrite_supplied', bundle: { format: 'kloel.contacts', version: 2, definitions: [], contacts: [{ data }] } };
  const preview = previewCRMImport(f.store, tenant, options); assert.equal(preview.canCommit, true);
  commitCRMImport(f.store, tenant, 'operator', options, preview.fingerprint, 'preserve-omitted-fields');
  const saved = getContact(f.store, tenant, response.json().id); assert.equal(saved.timezone, 'Europe/Lisbon'); assert.equal(saved.phones[0].label, 'WORK'); assert.equal(saved.emails[0].label, 'HOME'); assert.equal(saved.company, 'Imported company');
  data.timezone = 'America/Sao_Paulo'; data.phones[0].label = ''; data.emails[0].label = 'OTHER';
  const explicit = previewCRMImport(f.store, tenant, options); commitCRMImport(f.store, tenant, 'operator', options, explicit.fingerprint, 'apply-explicit-fields');
  const changed = getContact(f.store, tenant, saved.id); assert.equal(changed.timezone, 'America/Sao_Paulo'); assert.equal(changed.phones[0].label, ''); assert.equal(changed.emails[0].label, 'OTHER');
});
