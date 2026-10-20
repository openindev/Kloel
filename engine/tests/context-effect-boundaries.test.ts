import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { Store } from '../src/store.js';
import { registerAuth, sessionDigest } from '../src/auth.js';
import { registerAccountProfile } from '../src/account-profile.js';
import { registerCRM } from '../src/crm.js';
import { registerScheduling } from '../src/scheduling.js';
import { registerContactImport } from '../src/contact-import.js';
import { registerIngestion } from '../src/ingestion.js';
import { CONTEXT_HEADERS, resolveSessionContext } from '../src/request-context.js';
import { seedMember } from './fixtures/membership.js';

async function fixture(t: TestContext) {
  const store = new Store(), app = Fastify();
  await app.register(cookie);
  app.setErrorHandler((error, _request, reply) => {
    const e = error as { statusCode?: number; code?: string };
    reply.code(e.statusCode ?? 500).send({ error: { code: e.code ?? 'internal_error' } });
  });
  seedMember(store, { userId: 'boundary-owner', tenantId: 'boundary-tenant', role: 'owner' });
  const cookies = { kloel_session: 'boundary-session-token' };
  store.db.prepare('INSERT INTO sessions(hash,user_id,expires,tenant_id) VALUES(?,?,?,?)')
    .run(sessionDigest(cookies.kloel_session), 'boundary-owner', Date.now() + 60000, 'boundary-tenant');
  await registerAuth(app, store); await registerCRM(app, store);
  await registerAccountProfile(app, store); await registerScheduling(app, store);
  await registerContactImport(app, store); await registerIngestion(app, store, { resolve: async () => [{ address: '93.184.216.34', family: 4 }], request: async () => ({ status: 200, headers: { 'content-type': 'text/plain' }, body: Buffer.from('Synthetic knowledge source') }) });
  t.after(async () => { await app.close(); store.close(); });
  const context = resolveSessionContext(store, sessionDigest(cookies.kloel_session))!.context;
  const headers = Object.fromEntries(Object.entries(CONTEXT_HEADERS).map(([key, name]) => [name, context[key as keyof typeof context] ?? '-']));
  const request = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: Record<string, unknown>, extra: Record<string, string> = {}) => app.inject({ method, url, cookies, headers: { ...headers, ...extra }, ...(payload === undefined ? {} : { payload }) });
  const arm = (boundary: 'BEGIN' | 'SAVEPOINT', occurrence = 1) => {
    const original = store.db.exec.bind(store.db); let seen = 0, changed = false;
    store.db.exec = (sql: string) => {
      // Change authority after route admission but before this atomic boundary opens.
      if (sql.startsWith(boundary) && ++seen === occurrence) {
        store.db.prepare('UPDATE memberships SET role=? WHERE user_id=?').run('admin', 'boundary-owner');
        store.db.prepare('UPDATE memberships SET role=? WHERE user_id=?').run('owner', 'boundary-owner');
        changed = true;
      }
      return original(sql);
    };
    return () => { store.db.exec = original; assert.equal(changed, true, 'the requested boundary must be exercised'); };
  };
  return { store, request, arm, tenant: 'boundary-tenant', user: 'boundary-owner' };
}
function changed(response: any) {
  assert.equal(response.statusCode, 409, response.body);
  assert.equal(response.json().error.code, 'context_changed_in_flight');
}

for (const action of ['create', 'rename', 'revoke'] as const) test(`API key ${action} rejects context ABA at BEGIN without credential or audit mutation`, async t => {
  const f = await fixture(t);
  let id: string | undefined;
  if (action !== 'create') {
    const result = await f.request('POST', '/api/v1/api-keys', { name: 'Existing test key', scopes: ['contacts:read'] });
    assert.equal(result.statusCode, 201, result.body); id = result.json().id;
  }
  const before = f.store.db.prepare('SELECT * FROM api_keys ORDER BY id').all();
  const audit = f.store.db.prepare('SELECT * FROM api_key_audit ORDER BY id').all();
  const disarm = f.arm('BEGIN');
  const response = action === 'create' ? await f.request('POST', '/api/v1/api-keys', { name: 'Must not create', scopes: ['contacts:read'] })
    : action === 'rename' ? await f.request('PATCH', '/api/v1/api-keys/' + id, { name: 'Must not rename' })
    : await f.request('DELETE', '/api/v1/api-keys/' + id);
  disarm(); changed(response);
  assert.deepEqual(f.store.db.prepare('SELECT * FROM api_keys ORDER BY id').all(), before);
  assert.deepEqual(f.store.db.prepare('SELECT * FROM api_key_audit ORDER BY id').all(), audit);
  assert.ok(!response.body.includes('klo_key_'));
});

test('identity-level profile update rejects context ABA inside BEGIN and preserves existing profile', async t => {
  const f = await fixture(t);
  const before = f.store.db.prepare('SELECT * FROM user_profiles').all(), disarm = f.arm('BEGIN');
  const response = await f.request('PATCH', '/api/v1/account/profile', { revision: 0, firstName: 'Must not save' });
  disarm(); changed(response); assert.deepEqual(f.store.db.prepare('SELECT * FROM user_profiles').all(), before);
});

for (const action of ['create', 'update', 'delete'] as const) test(`event type ${action} rejects stale HTTP context inside its service transaction`, async t => {
  const f = await fixture(t);
  const connection = f.store.create(f.tenant, 'oauth-connections', { provider: 'google', remoteId: 'boundary-remote', userId: f.user, email: 'test@example.test', visibility: 'personal', status: 'connected', capabilities: ['calendar', 'calendar_write'] });
  const calendar = f.store.create(f.tenant, 'calendars', { name: 'Synthetic', provider: 'google', connectionId: connection.id, externalCalendarId: 'primary', enabled: true, timezone: 'America/Sao_Paulo' });
  const input = { name: 'Synthetic event', slug: 'boundary-event', calendarId: calendar.id, timezone: 'America/Sao_Paulo', durationMinutes: 30, availability: [{ weekday: 1, start: '09:00', end: '17:00' }] };
  let id: string | undefined;
  if (action !== 'create') { const result = await f.request('POST', '/api/v1/scheduling/event-types', input); assert.equal(result.statusCode, 201, result.body); id = result.json().id; }
  const before = f.store.list(f.tenant, 'booking-pages'), disarm = f.arm('BEGIN');
  const response = action === 'create' ? await f.request('POST', '/api/v1/scheduling/event-types', input)
    : action === 'update' ? await f.request('PATCH', '/api/v1/scheduling/event-types/' + id, { revision: 1, name: 'Must not save' })
    : await f.request('DELETE', '/api/v1/scheduling/event-types/' + id + '?revision=1');
  disarm(); changed(response); assert.deepEqual(f.store.list(f.tenant, 'booking-pages'), before);
  assert.equal(f.store.list(f.tenant, 'public-bookings').length, 0);
});

for (const action of ['update', 'delete', 'settings', 'permission'] as const) test(`CRM ${action} checks context within its SAVEPOINT and preserves records and receipts`, async t => {
  const f = await fixture(t);
  const result = await f.request('POST', '/api/v1/crm/contacts', { displayName: 'Existing contact', emails: [{ value: 'synthetic@example.test' }] }, { 'idempotency-key': 'existing-contact-key' });
  assert.equal(result.statusCode, 201, result.body);
  const contact = result.json(), extra = { 'if-match': String(result.headers.etag), 'idempotency-key': 'boundary-permission-key' };
  const collections = ['contacts', 'crm-settings', 'crm-receipts', 'crm-audit', 'contact-permission-events'];
  const before = collections.map(collection => f.store.list(f.tenant, collection));
  const disarm = f.arm('SAVEPOINT', action === 'permission' ? 2 : 1);
  const response = action === 'update' ? await f.request('PATCH', '/api/v1/crm/contacts/' + contact.id, { notes: 'Must not save' }, extra)
    : action === 'delete' ? await f.request('DELETE', '/api/v1/crm/contacts/' + contact.id, undefined, extra)
    : action === 'settings' ? await f.request('PUT', '/api/v1/crm/settings', { autoCapture: false, creationGate: '', definitions: [] }, { 'if-match': '"crm-settings:' + f.tenant + ':0"' })
    : await f.request('POST', '/api/v1/crm/contacts/' + contact.id + '/permission-events', { channel: 'email', identifier: 'synthetic@example.test', purpose: 'marketing', event: 'granted', occurredAt: '2026-10-01T10:00:00Z', source: 'Synthetic proof' }, extra);
  disarm(); changed(response); assert.deepEqual(collections.map(collection => f.store.list(f.tenant, collection)), before);
});

for (const boundary of ['BEGIN', 'SAVEPOINT'] as const) test(`legacy contact import rejects context ABA before ${boundary} without batch or receipt`, async t => {
  const f = await fixture(t), input = { format: 'csv', content: 'name,email\nSynthetic Person,synthetic@example.test\n' };
  const preview = await f.request('POST', '/api/v1/contacts/import/preview', input); assert.equal(preview.statusCode, 200, preview.body); assert.equal(preview.json().canCommit, true);
  const before = f.store.db.prepare('SELECT * FROM entities ORDER BY rowid').all(), disarm = f.arm(boundary);
  const response = await f.request('POST', '/api/v1/contacts/import/commit', { ...input, previewFingerprint: preview.json().fingerprint }, { 'idempotency-key': 'context-legacy-import' });
  disarm(); changed(response); assert.deepEqual(f.store.db.prepare('SELECT * FROM entities ORDER BY rowid').all(), before);
});
for (const kind of ['upload', 'import-url'] as const) test(`knowledge ${kind} rejects context ABA inside BEGIN before storing extracted content`, async t => {
  const f = await fixture(t), before = f.store.list(f.tenant, 'knowledge'), disarm = f.arm('BEGIN');
  const payload = kind === 'upload' ? { title: 'Synthetic text', filename: 'fixture.txt', mimeType: 'text/plain', base64: Buffer.from('Synthetic source').toString('base64') } : { title: 'Synthetic URL', url: 'https://example.com/synthetic' };
  const response = await f.request('POST', '/api/v1/knowledge/' + kind, payload);
  disarm(); changed(response); assert.deepEqual(f.store.list(f.tenant, 'knowledge'), before);
});
