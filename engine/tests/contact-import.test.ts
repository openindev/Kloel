import { seedMember } from './fixtures/membership.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerContactImport, normalizeContactPhone, parseContactCsv, safeCsvCell } from '../src/contact-import.js';
import { registerDomains } from '../src/domains.js';
import { Store } from '../src/store.js';

async function fixture() {
  const app = Fastify();
  const store = new Store();
  app.addHook('preHandler', async request => {
    if (request.headers['x-anonymous']) return;
    request.actor = { userId: `${request.headers['x-tenant'] ?? 'tenant-a'}-${request.headers['x-role'] ?? 'owner'}`, tenantId: String(request.headers['x-tenant'] ?? 'tenant-a'), role: (request.headers['x-role'] ?? 'owner') as 'owner' | 'admin' | 'member' };
    seedMember(store, request.actor);
  });
  await registerDomains(app, store);
  await registerContactImport(app, store);
  await app.ready();
  const preview = (payload: object, headers: Record<string, string> = {}) => app.inject({ method: 'POST', url: '/api/v1/contacts/import/preview', payload, headers });
  const commit = (payload: object, fingerprint: string, key = 'test-import-001', headers: Record<string, string> = {}) => app.inject({ method: 'POST', url: '/api/v1/contacts/import/commit', payload: { ...payload, previewFingerprint: fingerprint }, headers: { 'idempotency-key': key, ...headers } });
  const close = async () => { await app.close(); store.close(); };
  return { app, store, preview, commit, close };
}

test('CSV quoted delimiters, escaped quotes, CRLF newlines and BOM import with source line numbers', async () => {
  const f = await fixture();
  try {
    const content = '\uFEFFname,email,phone,notes,tags\r\n"Ana, Silva",ANA@EXAMPLE.TEST,"(11) 99999-0000","Linha um\r\nLinha ""dois""","[""VIP"",""Brasil""]"\r\nBruno,bruno@example.test,+551132345678,Fim,[]\r\n';
    const input = { format: 'csv', content, defaultCountry: 'BR' };
    const response = await f.preview(input);
    assert.equal(response.statusCode, 200, response.body);
    const plan = response.json();
    assert.equal(plan.canCommit, true);
    assert.deepEqual(plan.summary, { total: 2, create: 2, merge: 0, skip: 0, error: 0 });
    assert.deepEqual(plan.rows.map((r: any) => r.line), [2, 4]);
    assert.equal(plan.rows[0].contact.name, 'Ana, Silva');
    assert.equal(plan.rows[0].contact.phone, '+5511999990000');
    assert.equal(plan.rows[0].contact.email, 'ana@example.test');
    assert.equal(plan.rows[0].contact.notes, 'Linha um\r\nLinha "dois"');
    assert.deepEqual(plan.rows[0].contact.tags, ['VIP', 'Brasil']);
    assert.equal(f.store.list('tenant-a', 'contacts').length, 0);
    assert.equal(f.store.list('tenant-a', 'contact-import-receipts').length, 0);
    const saved = await f.commit(input, plan.fingerprint);
    assert.equal(saved.statusCode, 201, saved.body);
    assert.equal(saved.json().changes.length, 2);
    assert.equal(f.store.list('tenant-a', 'contacts').length, 2);
  } finally { await f.close(); }
});

test('semicolon CSV is explicit and malformed quoting, unknown/duplicate columns are rejected', async () => {
  const f = await fixture();
  try {
    const good = await f.preview({ format: 'csv', delimiter: ';', content: 'name;email\nAna;ana@example.test\n' });
    assert.equal(good.statusCode, 200);
    for (const content of ['name,email\n"Unclosed,email@example.test', 'name,email\n"Closed"junk,a@example.test', 'name,email\nUn"escaped,a@example.test', 'name,name\nA,B', 'name,tenantId\nA,other', 'name,__proto__\nA,test', 'email\na@example.test']) {
      const response = await f.preview({ format: 'csv', content });
      assert.equal(response.statusCode, 400, content);
    }
    const width = await f.preview({ format: 'csv', content: 'name,email\nAna,ana@example.test,extra\n' });
    assert.equal(width.statusCode, 200);
    assert.equal(width.json().canCommit, false);
    assert.equal(width.json().rows[0].errors[0].code, 'csv_columns');
  } finally { await f.close(); }
});

test('UTF-8 is strict for files and strings, byte and row limits are enforced', async () => {
  const f = await fixture();
  try {
    for (const input of [
      { format: 'csv', base64: Buffer.from([0xff, 0xfe, 0x00, 0x61]).toString('base64') },
      { format: 'csv', base64: '!bad=' },
      { format: 'csv', content: 'name\n\ud800' },
      { format: 'csv', content: 'name\nA\0B' },
      { format: 'csv', content: 'name\nA', base64: 'YQ==' },
    ]) assert.equal((await f.preview(input)).statusCode, 400);
    const large = await f.preview({ format: 'csv', content: 'name\n' + 'á'.repeat(1024 * 1024) });
    assert.equal(large.statusCode, 413);
    const rows = await f.preview({ format: 'csv', content: 'name\n' + Array(2001).fill('Ana').join('\n') });
    assert.equal(rows.statusCode, 413);
    const valid = await f.preview({ format: 'csv', base64: Buffer.from('\uFEFFname\nJoão', 'utf8').toString('base64') });
    assert.equal(valid.statusCode, 200);
    assert.equal(valid.json().rows[0].contact.name, 'João');
  } finally { await f.close(); }
});

test('Brazilian numbers require explicit country for national notation and never invent DDD or ninth digit', () => {
  assert.equal(normalizeContactPhone('(11) 99999-0000', 'BR'), '+5511999990000');
  assert.equal(normalizeContactPhone('11 3234-5678', 'BR'), '+551132345678');
  assert.equal(normalizeContactPhone('55 11 99999-0000', 'BR'), '+5511999990000');
  assert.equal(normalizeContactPhone('+1 (415) 555-0100'), '+14155550100');
  assert.equal(normalizeContactPhone('+55 (11) 99999-0000'), '+5511999990000');
  for (const phone of ['11999990000', '5511999990000']) assert.throws(() => normalizeContactPhone(phone), /país não será presumido/);
  for (const phone of ['99999-0000', '11 8999-0000', '(10) 99999-0000', '011999990000', '08001234567', '005511999990000', '+5511999990000 ramal 4']) assert.throws(() => normalizeContactPhone(phone, 'BR'));
});

test('preview validates every JSON row and commit writes nothing if any row has an error', async () => {
  const f = await fixture();
  try {
    const input = { format: 'json', content: JSON.stringify([{ name: 'Valid', email: 'valid@example.test' }, { name: 'Invalid email', email: 'bad' }, { name: 'Unsafe', tenantId: 'other' }, { name: 'Ambiguous phone', phone: '11999990000' }, { name: 'Numeric phone', phone: 5511999990000 }]) };
    const plan = (await f.preview(input)).json();
    assert.equal(plan.summary.create, 1);
    assert.equal(plan.summary.error, 4);
    assert.deepEqual(plan.rows.filter((r: any) => r.action === 'error').map((r: any) => r.line), [2, 3, 4, 5]);
    const rejected = await f.commit(input, plan.fingerprint);
    assert.equal(rejected.statusCode, 409);
    assert.equal(rejected.json().error.code, 'import_has_errors');
    assert.equal(f.store.list('tenant-a', 'contacts').length, 0);
    assert.equal(f.store.list('tenant-a', 'contact-import-receipts').length, 0);
  } finally { await f.close(); }
});

test('deduplication matches normalized email or phone within tenant, including same-file repeats', async () => {
  const f = await fixture();
  try {
    f.store.create('tenant-a', 'contacts', { name: 'Existing', email: 'same@example.test', phone: '+5511999990000' });
    f.store.create('tenant-b', 'contacts', { name: 'Other tenant', email: 'fresh@example.test' });
    const input = { format: 'json', duplicatePolicy: 'skip', content: JSON.stringify([{ name: 'Duplicate email', email: 'SAME@EXAMPLE.TEST' }, { name: 'Duplicate phone', phone: '+55 (11) 99999-0000' }, { name: 'New', email: 'fresh@example.test' }, { name: 'Repeated in file', email: 'FRESH@example.test' }]) };
    const plan = (await f.preview(input)).json();
    assert.equal(plan.canCommit, true);
    assert.equal(plan.summary.skip, 3);
    assert.equal(plan.summary.create, 1);
    assert.equal(plan.rows[3].duplicateLine, 3);
    assert.equal((await f.commit(input, plan.fingerprint)).statusCode, 201);
    assert.equal(f.store.list('tenant-a', 'contacts').length, 2);
    assert.equal(f.store.list('tenant-b', 'contacts').length, 1);
    const error = (await f.preview({ ...input, duplicatePolicy: 'error' })).json();
    assert.equal(error.canCommit, false);
    assert.equal(error.rows[0].errors[0].code, 'duplicate_existing');
  } finally { await f.close(); }
});

test('ambiguous identity matches and changes to existing identifiers are never merged silently', async () => {
  const f = await fixture();
  try {
    f.store.create('tenant-a', 'contacts', { name: 'A', email: 'a@example.test', phone: '+5511999990000' });
    f.store.create('tenant-a', 'contacts', { name: 'B', email: 'b@example.test', phone: '+5511999990001' });
    for (const duplicatePolicy of ['skip', 'merge', 'error']) {
      const response = await f.preview({ format: 'json', duplicatePolicy, content: JSON.stringify([{ name: 'Conflict', email: 'a@example.test', phone: '+5511999990001' }]) });
      assert.equal(response.json().rows[0].errors[0].code, 'identity_conflict');
    }
    const changed = await f.preview({ format: 'json', duplicatePolicy: 'merge', content: JSON.stringify([{ name: 'Change email', email: 'new@example.test', phone: '+5511999990000' }]) });
    assert.equal(changed.json().rows[0].errors[0].code, 'identity_change');
    f.store.create('tenant-a', 'contacts', { name: 'Duplicate already in CRM', email: 'a@example.test' });
    const duplicate = await f.preview({ format: 'json', duplicatePolicy: 'merge', content: JSON.stringify([{ name: 'Ambiguous', email: 'a@example.test' }]) });
    assert.equal(duplicate.json().rows[0].errors[0].code, 'identity_conflict');
  } finally { await f.close(); }
});

test('merge preserves all existing consent, retains omitted fields and unions tags', async () => {
  const f = await fixture();
  try {
    const consent = { whatsapp: false, email: true, phone: false, recordedAt: '2026-10-01T10:00:00Z', source: 'Cadastro próprio' };
    const old = f.store.create('tenant-a', 'contacts', { name: 'Original', email: 'same@example.test', phone: '+5511999990000', company: 'Original company', notes: 'Original notes', tags: ['A'], timezone: 'Europe/Lisbon', consent });
    const input = { format: 'json', duplicatePolicy: 'merge', content: JSON.stringify([{ name: 'Novo nome', email: 'same@example.test', company: '', tags: ['B', 'A'], consent: { whatsapp: true, email: false, source: 'Arquivo importado', recordedAt: '2026-10-10T10:00:00Z' } }]) };
    const plan = (await f.preview(input)).json();
    assert.deepEqual(plan.rows[0].changedFields.sort(), ['name', 'tags']);
    assert.equal(plan.rows[0].warnings[0].code, 'consent_preserved');
    assert.deepEqual(plan.rows[0].contact.consent, consent);
    assert.equal((await f.commit(input, plan.fingerprint)).statusCode, 201);
    const updated = f.store.get('tenant-a', 'contacts', old.id)!;
    assert.deepEqual((updated.legacySnapshot as any).consent, consent);
    assert.equal((updated.consent as any).email, false);
    assert.equal(updated.company, 'Original company');
    assert.equal(updated.notes, 'Original notes');
    assert.equal(updated.timezone, 'Europe/Lisbon');
    assert.deepEqual(updated.tags, ['A', 'B']);
    assert.equal(updated.name, 'Novo nome');
    const repeated = await f.preview({ ...input, content: JSON.stringify([{ name: 'A', email: 'same@example.test' }, { name: 'B', email: 'same@example.test' }]) });
    assert.equal(repeated.json().rows[1].errors[0].code, 'duplicate_in_file');
  } finally { await f.close(); }
});

test('new consent grants require explicit source and timestamp, default grants remain false', async () => {
  const f = await fixture();
  try {
    const response = await f.preview({ format: 'json', content: JSON.stringify([{ name: 'Invalid grant', consent: { whatsapp: true } }, { name: 'No grant' }, { name: 'Grant with provenance', consent: { email: true, source: 'Formulário de inscrição', recordedAt: '2026-10-01T09:00:00-03:00' } }]) });
    const plan = response.json();
    assert.equal(plan.rows[0].errors[0].code, 'consent_provenance_required');
    assert.equal(plan.rows[1].contact.consent.whatsapp, false);
    assert.equal(plan.rows[2].contact.consent.email, true);
    const csv = await f.preview({ format: 'csv', content: 'name,consent.email\nInvalid,sim\n' });
    assert.equal(csv.json().canCommit, false);
  } finally { await f.close(); }
});

test('preview fingerprint rejects CRM or payload changes and idempotent replay never duplicates', async () => {
  const f = await fixture();
  try {
    const input = { format: 'json', content: JSON.stringify([{ name: 'No identifiers' }]) };
    const stale = (await f.preview(input)).json();
    f.store.create('tenant-a', 'contacts', { name: 'Changed during review' });
    assert.equal((await f.commit(input, stale.fingerprint)).json().error.code, 'preview_stale');
    const fresh = (await f.preview(input)).json();
    assert.equal((await f.commit({ ...input, duplicatePolicy: 'skip' }, fresh.fingerprint)).json().error.code, 'preview_stale');
    const first = await f.commit(input, fresh.fingerprint);
    assert.equal(first.statusCode, 201);
    const second = await f.commit(input, fresh.fingerprint);
    assert.equal(second.statusCode, 200);
    assert.equal(second.json().replayed, true);
    assert.deepEqual(first.json().changes, second.json().changes);
    assert.equal(f.store.list('tenant-a', 'contacts').length, 2);
    const conflict = await f.commit({ ...input, content: JSON.stringify([{ name: 'Different' }]) }, fresh.fingerprint);
    assert.equal(conflict.json().error.code, 'idempotency_conflict');
    assert.equal((await f.commit(input, fresh.fingerprint, 'short')).statusCode, 400);
  } finally { await f.close(); }
});

test('database failure in the second create rolls back the entire import and receipt', async () => {
  const f = await fixture();
  try {
    const input = { format: 'json', content: JSON.stringify([{ name: 'First' }, { name: 'Second' }]) };
    const plan = (await f.preview(input)).json();
    const original = f.store.create.bind(f.store);
    let count = 0;
    f.store.create = (tenant, collection, data) => { if (collection === 'contacts' && ++count === 2) throw new Error('Injected database failure'); return original(tenant, collection, data); };
    const result = await f.commit(input, plan.fingerprint);
    assert.equal(result.statusCode, 500);
    assert.equal(f.store.list('tenant-a', 'contacts').length, 0);
    assert.equal(f.store.list('tenant-a', 'contact-import-receipts').length, 0);
  } finally { await f.close(); }
});

test('import/export RBAC, tenant-scoped fingerprint/receipts, and member quick lookup', async () => {
  const f = await fixture();
  try {
    const input = { format: 'csv', content: 'name,email\nAna,ana@example.test' };
    assert.equal((await f.preview(input, { 'x-anonymous': 'true' })).statusCode, 401);
    assert.equal((await f.preview(input, { 'x-role': 'member' })).statusCode, 403);
    assert.equal((await f.app.inject({ url: '/api/v1/contacts/export', headers: { 'x-role': 'member' } })).statusCode, 403);
    const planA = (await f.preview(input)).json();
    assert.equal((await f.commit(input, planA.fingerprint, 'shared-import-key', { 'x-tenant': 'tenant-b' })).json().error.code, 'preview_stale');
    assert.equal((await f.commit(input, planA.fingerprint, 'shared-import-key')).statusCode, 201);
    const planB = (await f.preview(input, { 'x-tenant': 'tenant-b' })).json();
    assert.equal(planB.summary.create, 1);
    assert.equal((await f.commit(input, planB.fingerprint, 'shared-import-key', { 'x-tenant': 'tenant-b' })).statusCode, 201);
    const own = await f.app.inject({ url: '/api/v1/contacts/lookup?q=ana', headers: { 'x-role': 'member' } });
    assert.equal(own.statusCode, 200);
    assert.equal(own.json().total, 1);
    assert.equal((await f.app.inject({ url: '/api/v1/contacts/lookup?q=ana', headers: { 'x-anonymous': 'true' } })).statusCode, 401);
    const exported = await f.app.inject({ url: '/api/v1/contacts/export?format=json' });
    assert.equal(exported.json().length, 1);
    assert.equal(exported.json()[0].tenantId, undefined);
    assert.equal(exported.json()[0].id, undefined);
  } finally { await f.close(); }
});

test('quick lookup ranks exact identities and matches accents, phone digits and multiple terms', async () => {
  const f = await fixture();
  try {
    f.store.create('tenant-a', 'contacts', { name: 'João da Silva', email: 'joao@example.test', phone: '+5511999990000', company: 'Clínica Azul', tags: ['VIP'] });
    f.store.create('tenant-a', 'contacts', { name: 'João Outro', email: 'other@example.test' });
    f.store.create('tenant-b', 'contacts', { name: 'João Secreto', email: 'secret@example.test' });
    for (const q of ['joao silva', 'clinica azul', '(11) 99999-0000', 'JOAO@EXAMPLE.TEST']) {
      const response = await f.app.inject({ url: `/api/v1/contacts/lookup?q=${encodeURIComponent(q)}` });
      assert.equal(response.json().total, 1, q);
      assert.equal(response.json().items[0].name, 'João da Silva');
    }
    const limit = await f.app.inject({ url: '/api/v1/contacts/lookup?q=joao&limit=1' });
    assert.equal(limit.json().total, 2);
    assert.equal(limit.json().items.length, 1);
    assert.equal((await f.app.inject({ url: '/api/v1/contacts/lookup?q=j' })).statusCode, 400);
    assert.equal((await f.app.inject({ url: '/api/v1/contacts/lookup?q=joao&tenantId=tenant-b' })).statusCode, 400);
  } finally { await f.close(); }
});

test('CSV export mitigates spreadsheet formulas and JSON preserves exact editable contact values', async () => {
  const f = await fixture();
  try {
    const contact = f.store.create('tenant-a', 'contacts', { name: '=HYPERLINK("https://example.test")', phone: '+5511999990000', company: ' \t@SUM(1)', notes: '\r\n-1+2', tags: ['A,"B"'] });
    const response = await f.app.inject({ url: '/api/v1/contacts/export?format=csv' });
    assert.equal(response.statusCode, 200);
    assert.match(response.headers['content-type']!, /text\/csv; charset=utf-8/);
    assert.equal(response.headers['cache-control'], 'no-store');
    const records = parseContactCsv(response.body.replace(/^\uFEFF/, ''));
    assert.ok(records[1].cells[0].startsWith("'="));
    assert.equal(records[1].cells[2], "'+5511999990000");
    assert.ok(records[1].cells[3].startsWith("'"));
    assert.ok(records[1].cells[4].startsWith("'"));
    assert.equal(safeCsvCell('  =1+1'), '"\'  =1+1"');
    const csvPreview = await f.preview({ format: 'csv', content: response.body, duplicatePolicy: 'skip' });
    assert.equal(csvPreview.json().canCommit, true);
    assert.equal(csvPreview.json().rows[0].contact.phone, contact.phone);
    const json = await f.app.inject({ url: '/api/v1/contacts/export?format=json' });
    assert.equal(json.json()[0].name, contact.name);
    assert.equal(json.json()[0].notes, contact.notes);
    const otherTenant = await f.preview({ format: 'json', content: json.body }, { 'x-tenant': 'tenant-b' });
    assert.equal(otherTenant.json().canCommit, true);
    assert.deepEqual(otherTenant.json().rows[0].contact.tags, ['A,"B"']);
  } finally { await f.close(); }
});
