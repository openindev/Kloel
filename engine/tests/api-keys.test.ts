import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { buildApp } from '../src/app.js';
import { Store } from '../src/store.js';
import { registerAuth } from '../src/auth.js';
import { registerKnowledge } from '../src/knowledge.js';
import { addOrganizationMember, removeOrganizationMember } from '../src/memberships/service.js';
import { apiKeyScopes } from '../src/api-keys/service.js';

const password = 'api-keys-test-password';
const cookiesOf = (response: any) => ({ kloel_session: response.cookies.find((item: any) => item.name === 'kloel_session').value as string });
const bearer = (secret: string) => ({ authorization: `Bearer ${secret}` });
async function fixture() {
  const store = new Store(), app = await buildApp(store);
  const owner = await app.inject({ method: 'POST', url: '/api/v1/auth/signup', payload: { email: 'owner@example.test', password, organization: 'Keys workspace' } });
  const cookies = cookiesOf(owner);
  const create = (scopes: string[] = ['contacts:read', 'contacts:write', 'contacts:delete'], extra: object = {}) => app.inject({ method: 'POST', url: '/api/v1/api-keys', cookies, payload: { name: 'Automation key', scopes, ...extra } });
  return { store, app, owner: owner.json(), cookies, create, close: () => app.close() };
}

test('secret is returned once, only hash is stored, metadata is masked, rename/revoke are audited', async t => {
  const f = await fixture(); t.after(f.close);
  const created = await f.create(); assert.equal(created.statusCode, 201, created.body);
  const key = created.json(); assert.match(key.secret, /^klo_key_[A-Za-z0-9_-]{43}$/);
  assert.equal(key.secretDisplayedOnce, true); assert.equal(key.status, 'active');
  assert.ok(Date.parse(key.expiresAt) > Date.now()); assert.deepEqual(key.permissions, key.scopes);
  const raw = f.store.db.prepare('SELECT * FROM api_keys WHERE id=?').get(key.id)!;
  assert.equal(raw.secret_hash, createHash('sha256').update(key.secret).digest('hex'));
  assert.ok(!JSON.stringify(raw).includes(key.secret));
  const list = await f.app.inject({ url: '/api/v1/api-keys', cookies: f.cookies });
  assert.equal(list.json().items[0].secret, `klo_key_••••••••••••${key.secret.slice(-4)}`);
  assert.ok(!list.body.includes(key.secret)); assert.ok(!list.body.includes(String(raw.secret_hash)));
  const renamed = await f.app.inject({ method: 'PATCH', url: `/api/v1/api-keys/${key.id}`, cookies: f.cookies, payload: { name: 'Renamed integration' } });
  assert.equal(renamed.statusCode, 200); assert.equal(renamed.json().name, 'Renamed integration'); assert.ok(!renamed.body.includes(key.secret));
  const revoked = await f.app.inject({ method: 'DELETE', url: `/api/v1/api-keys/${key.id}`, cookies: f.cookies });
  assert.equal(revoked.statusCode, 204);
  assert.ok(f.store.db.prepare('SELECT revoked_at FROM api_keys WHERE id=?').get(key.id)?.revoked_at);
  assert.equal((await f.app.inject({ url: '/api/v1/api-keys', cookies: f.cookies })).json().items.length, 0);
  assert.equal((await f.app.inject({ url: '/api/v1/api-keys?includeRevoked=true', cookies: f.cookies })).json().items[0].status, 'revoked');
  const audit = await f.app.inject({ url: `/api/v1/api-keys/${key.id}/audit`, cookies: f.cookies });
  assert.deepEqual(audit.json().items.map((item: any) => item.action), ['revoked', 'renamed', 'created']);
  assert.ok(!audit.body.includes(key.secret)); assert.ok(!audit.body.includes(String(raw.secret_hash)));
});

test('Bearer performs real contact CRUD and tenant comes exclusively from the key', async t => {
  const f = await fixture(); t.after(f.close);
  const key = (await f.create()).json(), headers = bearer(key.secret);
  const created = await f.app.inject({ method: 'POST', url: '/api/v1/contacts', headers, payload: { name: 'Automated contact', email: 'automation@example.test' } });
  assert.equal(created.statusCode, 201, created.body); const contact = created.json();
  assert.equal(contact.tenantId, f.owner.tenantId);
  const patch = await f.app.inject({ method: 'PATCH', url: `/api/v1/contacts/${contact.id}`, headers: { ...headers, 'if-match': String(created.headers.etag) }, payload: { company: 'API integration' } });
  assert.equal(patch.statusCode, 200, patch.body); assert.equal(patch.json().company, 'API integration');
  assert.equal((await f.app.inject({ url: '/api/v1/contacts', headers })).json().total, 1);
  const foreign = f.store.create('foreign', 'contacts', { name: 'Foreign secret' });
  assert.equal((await f.app.inject({ url: `/api/v1/contacts/${foreign.id}`, headers })).statusCode, 404);
  assert.equal((await f.app.inject({ method: 'POST', url: '/api/v1/contacts', headers, payload: { name: 'Injected', tenantId: 'foreign' } })).statusCode, 400);
  const outsider = await f.app.inject({ method: 'POST', url: '/api/v1/auth/signup', payload: { email: 'outside@example.test', password, organization: 'Outside company' } });
  const mixed = await f.app.inject({ url: '/api/v1/contacts', headers, cookies: cookiesOf(outsider) });
  assert.equal(mixed.statusCode, 200); assert.equal(mixed.json().items[0].tenantId, f.owner.tenantId);
  assert.equal((await f.app.inject({ url: `/api/v1/api-keys/${key.id}/audit`, cookies: cookiesOf(outsider) })).statusCode, 404);
  assert.equal((await f.app.inject({ method: 'DELETE', url: `/api/v1/contacts/${contact.id}`, headers: { ...headers, 'if-match': String(patch.headers.etag) } })).statusCode, 204);
  assert.equal(f.store.get(f.owner.tenantId, 'contacts', contact.id), undefined);
  const listed = (await f.app.inject({ url: '/api/v1/api-keys', cookies: f.cookies })).json().items[0];
  assert.ok(listed.lastUsedAt);
  const audit = (await f.app.inject({ url: `/api/v1/api-keys/${key.id}/audit`, cookies: f.cookies })).json().items;
  assert.ok(audit.some((item: any) => item.method === 'PATCH' && item.route === '/api/v1/contacts/:id' && item.statusCode === 200));
});

test('read-only scope cannot mutate or inherit human-cookie permissions and excluded routes never accept Bearer', async t => {
  const f = await fixture(); t.after(f.close);
  const key = (await f.create(['contacts:read'])).json(), headers = bearer(key.secret);
  assert.equal((await f.app.inject({ url: '/api/v1/contacts', headers })).statusCode, 200);
  const denied = await f.app.inject({ method: 'POST', url: '/api/v1/contacts', headers, cookies: f.cookies, payload: { name: 'Denied' } });
  assert.equal(denied.statusCode, 403); assert.equal(denied.json().error.code, 'api_key_scope_denied');
  assert.equal((await f.app.inject({ url: '/api/v1/agents', headers })).statusCode, 403);
  for (const url of ['/api/v1/auth/me', '/api/v1/members', '/api/v1/api-keys', '/api/v1/local/config', '/api/v1/providers/status', '/api/v1/billing/status', '/api/v1/oauth/connections', '/api/v1/integrations', '/api/v1/organizations', '/api/v1/contacts/export', '/api/v1/contacts/lookup?q=x']) {
    const response = await f.app.inject({ url, headers, cookies: f.cookies }); assert.equal(response.statusCode, 403, `${url}: ${response.body}`); assert.equal(response.json().error.code, 'api_key_route_forbidden');
  }
  for (const url of ['/api/v1/auth/login', '/api/v1/api-keys', '/api/v1/knowledge/upload', '/api/v1/knowledge/import-url', '/api/v1/webhooks/twilio/caller-id']) {
    const response = await f.app.inject({ method: 'POST', url, headers, cookies: f.cookies, payload: {} }); assert.equal(response.statusCode, 403, `${url}: ${response.body}`);
  }
  assert.equal((await f.app.inject({ url: '/api/v1/contacts', headers: bearer(key.secret + 'x'), cookies: f.cookies })).statusCode, 401);
  assert.equal(f.store.list(f.owner.tenantId, 'contacts').length, 0);
});

test('expiration, explicit revocation and membership removal immediately invalidate a key, including remove/rejoin', async t => {
  const f = await fixture(); t.after(f.close);
  const expired = (await f.create(['contacts:read'])).json();
  f.store.db.prepare('UPDATE api_keys SET expires_at=? WHERE id=?').run('2000-01-01T00:00:00Z', expired.id);
  assert.equal((await f.app.inject({ url: '/api/v1/contacts', headers: bearer(expired.secret) })).statusCode, 401);
  const revoked = (await f.create(['contacts:read'], { name: 'Revoked key' })).json();
  await f.app.inject({ method: 'DELETE', url: `/api/v1/api-keys/${revoked.id}`, cookies: f.cookies });
  assert.equal((await f.app.inject({ url: '/api/v1/contacts', headers: bearer(revoked.secret) })).statusCode, 401);
  const other = await f.app.inject({ method: 'POST', url: '/api/v1/auth/signup', payload: { email: 'editor@example.test', password, organization: 'Editor home' } });
  addOrganizationMember(f.store, f.owner, { userId: other.json().userId, role: 'editor' });
  const switched = await f.app.inject({ method: 'POST', url: '/api/v1/auth/select-organization', cookies: cookiesOf(other), payload: { tenantId: f.owner.tenantId } });
  const editorKey = (await f.app.inject({ method: 'POST', url: '/api/v1/api-keys', cookies: cookiesOf(switched), payload: { name: 'Editor key', scopes: ['agents:read'] } })).json();
  assert.equal((await f.app.inject({ url: '/api/v1/agents', headers: bearer(editorKey.secret) })).statusCode, 200);
  removeOrganizationMember(f.store, f.owner, other.json().userId);
  addOrganizationMember(f.store, f.owner, { userId: other.json().userId, role: 'editor' });
  assert.equal((await f.app.inject({ url: '/api/v1/agents', headers: bearer(editorKey.secret) })).statusCode, 401);
});

test('effective scopes always intersect current creator permissions; editors cannot mint or manage elevated keys', async t => {
  const f = await fixture(); t.after(f.close);
  const ownerKey = (await f.create(['agents:read', 'agents:write'])).json();
  const editor = await f.app.inject({ method: 'POST', url: '/api/v1/auth/signup', payload: { email: 'creator@example.test', password, organization: 'Creator home' } });
  addOrganizationMember(f.store, f.owner, { userId: editor.json().userId, role: 'editor' });
  const switched = await f.app.inject({ method: 'POST', url: '/api/v1/auth/select-organization', cookies: cookiesOf(editor), payload: { tenantId: f.owner.tenantId } });
  const cookies = cookiesOf(switched);
  assert.equal((await f.app.inject({ method: 'POST', url: '/api/v1/api-keys', cookies, payload: { name: 'Escalated', scopes: ['contacts:write'] } })).statusCode, 403);
  assert.equal((await f.app.inject({ method: 'PATCH', url: `/api/v1/api-keys/${ownerKey.id}`, cookies, payload: { name: 'Stolen management' } })).statusCode, 404);
  const key = (await f.app.inject({ method: 'POST', url: '/api/v1/api-keys', cookies, payload: { name: 'Editor automation', scopes: ['agents:read', 'agents:write'] } })).json();
  f.store.db.prepare("UPDATE memberships SET role='viewer' WHERE user_id=? AND tenant_id=?").run(editor.json().userId, f.owner.tenantId);
  assert.equal((await f.app.inject({ url: '/api/v1/agents', headers: bearer(key.secret) })).statusCode, 200);
  assert.equal((await f.app.inject({ method: 'POST', url: '/api/v1/agents', headers: bearer(key.secret), payload: { name: 'Privilege retained' } })).statusCode, 403);
  const view = (await f.app.inject({ url: '/api/v1/api-keys', cookies: f.cookies })).json().items.find((item: any) => item.id === key.id);
  assert.deepEqual(view.permissions, ['agents:read']);
});

test('agent recording changes require their separate scope and malformed creation cannot inject authority', async t => {
  const f = await fixture(); t.after(f.close);
  const key = (await f.create(['agents:read', 'agents:write'])).json(), headers = bearer(key.secret);
  assert.equal((await f.app.inject({ method: 'POST', url: '/api/v1/agents', headers, payload: { name: 'Normal agent' } })).statusCode, 201);
  assert.equal((await f.app.inject({ method: 'POST', url: '/api/v1/agents', headers, payload: { name: 'Recording escalation', settings: { recordingEnabled: true } } })).statusCode, 403);
  for (const extra of [{ scopes: ['billing:manage'] }, { tenantId: 'foreign' }, { createdByUserId: 'foreign' }, { expiresAt: '2000-01-01T00:00:00Z' }, { scopes: [] }]) {
    const response = await f.app.inject({ method: 'POST', url: '/api/v1/api-keys', cookies: f.cookies, payload: { name: 'Invalid key', ...extra } });
    assert.equal(response.statusCode, 400, response.body);
  }
  const all = await f.create([...apiKeyScopes], { name: 'Full explicitly permitted' }); assert.equal(all.statusCode, 201, all.body);
});

test('revocation during embeddings prevents indexing and auditing never contains key or request content', async t => {
  const store = new Store(), app = Fastify(); t.after(async () => { await app.close(); store.close(); });
  await app.register(cookie); await registerAuth(app, store);
  const owner = await app.inject({ method: 'POST', url: '/api/v1/auth/signup', payload: { email: 'indexer@example.test', password, organization: 'Indexing company' } });
  const cookies = cookiesOf(owner);
  const key = (await app.inject({ method: 'POST', url: '/api/v1/api-keys', cookies, payload: { name: 'Indexing key', scopes: ['knowledge:write'] } })).json();
  // Use a separate Fastify registration before it starts serving requests.
  const worker = Fastify(); t.after(() => worker.close()); await worker.register(cookie); await registerAuth(worker, store);
  await registerKnowledge(worker, store, { apiKey: 'synthetic-openai', fetchImpl: (async () => {
    store.db.prepare('UPDATE api_keys SET revoked_at=? WHERE id=?').run(new Date().toISOString(), key.id);
    return Response.json({ data: [{ index: 0, embedding: [1, 0] }] });
  }) as typeof fetch });
  const entry = store.create(owner.json().tenantId, 'knowledge', { title: 'Secret', type: 'text', content: 'Never return or log this source', indexed: false });
  const response = await worker.inject({ method: 'POST', url: `/api/v1/knowledge/${entry.id}/ingest`, headers: bearer(key.secret), payload: {} });
  assert.equal(response.statusCode, 401, response.body);
  assert.equal(store.list(owner.json().tenantId, 'knowledge-chunks').length, 0);
  const audit = JSON.stringify(store.db.prepare('SELECT * FROM api_key_audit').all());
  assert.ok(!audit.includes(key.secret)); assert.ok(!audit.includes('Never return or log this source'));
  assert.ok(audit.includes('401'));
});

test('integrated auth preserves public-chat visitor Bearer while Kloel API keys remain excluded', async t => {
  const f = await fixture(); t.after(f.close);
  const previousFetch = globalThis.fetch;
  const previousEnv = { OPENAI_API_KEY: process.env.OPENAI_API_KEY, OPENAI_MODEL: process.env.OPENAI_MODEL, PROVIDER_TENANT_ID: process.env.PROVIDER_TENANT_ID };
  t.after(() => {
    globalThis.fetch = previousFetch;
    for (const [name, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });
  process.env.OPENAI_API_KEY = 'synthetic-public-chat-test'; process.env.OPENAI_MODEL = 'test-model'; process.env.PROVIDER_TENANT_ID = f.owner.tenantId;
  let providerCalls = 0;
  globalThis.fetch = (async () => {
    providerCalls++;
    return Response.json({ id: 'resp_public_test', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Resposta pública' }] }] });
  }) as typeof fetch;
  const origin = 'https://visitor.example.test';
  const agent = f.store.create(f.owner.tenantId, 'agents', { name: 'Public assistant', status: 'active', prompt: 'Help visitors', tools: [] });
  const channel = f.store.create(f.owner.tenantId, 'channels', { type: 'webchat', provider: 'openai', enabled: true, agentId: agent.id, configuration: { allowedOrigins: [origin] } });
  const path = (operation: string) => `/api/v1/public/chat/${operation}?${new URLSearchParams({ tenantId: f.owner.tenantId, channelId: channel.id })}`;
  const session = await f.app.inject({ method: 'POST', url: path('sessions'), headers: { origin }, payload: {} });
  assert.equal(session.statusCode, 201, session.body);
  const token = session.json().token;
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  const headers = { origin, ...bearer(token) };
  const reply = await f.app.inject({ method: 'POST', url: path('messages'), headers, payload: { message: 'Olá', idempotencyKey: randomUUID() } });
  assert.equal(reply.statusCode, 200, reply.body); assert.equal(reply.json().message.content, 'Resposta pública');
  const history = await f.app.inject({ url: path('history'), headers });
  assert.equal(history.statusCode, 200, history.body); assert.equal(history.json().items.length, 2);
  assert.equal((await f.app.inject({ url: path('history'), headers: { ...headers, origin: 'https://untrusted.example.test' } })).statusCode, 403);
  assert.equal((await f.app.inject({ url: '/api/v1/contacts', headers, cookies: f.cookies })).statusCode, 401);
  const key = (await f.create(['contacts:read'])).json();
  for (const operation of ['sessions', 'messages', 'history', 'end']) {
    const result = await f.app.inject({ method: operation === 'history' ? 'GET' : 'POST', url: path(operation), headers: { origin, ...bearer(key.secret) }, ...(operation === 'history' ? {} : { payload: {} }) });
    assert.equal(result.statusCode, 403, `${operation}: ${result.body}`); assert.equal(result.json().error.code, 'api_key_route_forbidden');
  }
  assert.equal((await f.app.inject({ method: 'POST', url: path('end'), headers, payload: {} })).statusCode, 200);
  assert.equal((await f.app.inject({ url: path('history'), headers })).statusCode, 401);
  assert.equal(providerCalls, 1);
});
