import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { Store } from '../src/store.js';
import { buildApp } from '../src/app.js';
import { seedMember } from './fixtures/membership.js';
import { canonicalWebchatOrigin } from '../src/webchat-origins.js';
import { allowedChatOrigin } from '../src/conversation-replies-shared.js';

const base = '/api/v1/webchat';
const origin = 'https://customer.example.test';
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const snapshot = (store: Store) => store.db.prepare('SELECT * FROM entities ORDER BY rowid').all();
async function fixture(t: any) {
  const tenant = 'webchat-tenant', previousEnv = { ...process.env }, previousFetch = globalThis.fetch;
  const env = { PROVIDER_TENANT_ID: tenant, OPENAI_API_KEY: 'synthetic-openai-secret', OPENAI_MODEL: 'synthetic-model', APP_ORIGIN: 'http://127.0.0.1:3000', PUBLIC_BASE_URL: 'http://127.0.0.1:4310' };
  Object.assign(process.env, env); let providerCalls = 0;
  globalThis.fetch = (async () => { providerCalls++; throw new Error('Unexpected provider request'); }) as typeof fetch;
  const store = new Store(':memory:');
  const identities = {
    owner: { tenantId: tenant, userId: 'webchat-owner', role: 'owner' as const },
    other: { tenantId: tenant, userId: 'webchat-other', role: 'owner' as const },
    editor: { tenantId: tenant, userId: 'webchat-editor', role: 'editor' as const },
    member: { tenantId: tenant, userId: 'webchat-member', role: 'member' as const },
    viewer: { tenantId: tenant, userId: 'webchat-viewer', role: 'viewer' as const },
    foreign: { tenantId: 'foreign-webchat-tenant', userId: 'foreign-webchat-owner', role: 'owner' as const },
  };
  const cookies: Record<string, string> = {};
  for (const [name, actor] of Object.entries(identities)) {
    seedMember(store, actor); cookies[name] = 'webchat-cookie-' + name;
    store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(hash(cookies[name]), actor.userId, actor.tenantId, Date.now() + 3600000);
  }
  const agent = store.create(tenant, 'agents', { name: 'Assistente do site', status: 'active', prompt: 'Synthetic test', initialMessage: 'Olá!', language: 'pt-BR', voice: 'marin', tools: [], settings: {}, rules: [] });
  const app = await buildApp(store, { workers: false }); await app.ready();
  t.after(async () => { await app.close(); globalThis.fetch = previousFetch; for (const key of Object.keys(env)) { if (previousEnv[key] === undefined) delete process.env[key]; else process.env[key] = previousEnv[key]; } });
  const contexts: Record<string, Record<string, string>> = {};
  for (const name of Object.keys(identities)) {
    const result = await app.inject({ url: '/api/v1/auth/me', headers: { cookie: 'kloel_session=' + cookies[name] } }); assert.equal(result.statusCode, 200);
    const c = result.json().context;
    contexts[name] = { 'x-kloel-expected-user': c.userId, 'x-kloel-expected-tenant': c.tenantId, 'x-kloel-expected-membership': c.membershipId, 'x-kloel-expected-authority': c.authorityVersion };
  }
  const request = (method: any, path: string, body?: unknown, name = 'owner', extra: Record<string, string> = {}) => app.inject({ method, url: path.startsWith('/api/') ? path : base + path, headers: { cookie: 'kloel_session=' + cookies[name], ...contexts[name], ...extra }, ...(body === undefined ? {} : { payload: body }) });
  const input = (extra: Record<string, unknown> = {}) => ({ expectedTenantId: tenant, idempotencyKey: randomUUID(), name: 'Chat do site', agentId: agent.id, configuration: { allowedOrigins: [origin], greeting: 'Bem-vindo!' }, ...extra });
  const create = async (extra: Record<string, unknown> = {}) => { const response = await request('POST', '/channels', input(extra)); assert.equal(response.statusCode, 201, response.body); return response.json().channel; };
  const control = (row: any, extra: Record<string, unknown> = {}) => ({ expectedTenantId: tenant, expectedVersion: row.version, idempotencyKey: randomUUID(), ...extra });
  return { tenant, store, app, agent, identities, contexts, cookies, request, input, create, control, providerCalls: () => providerCalls };
}

test('create, receipt recovery and replay use the configured engine origin, never Host/UI origin or provider calls', async t => {
  const f = await fixture(t), body = f.input({ configuration: { allowedOrigins: [origin + '/', origin, 'HTTPS://CUSTOMER.EXAMPLE.TEST:443'], greeting: 'Private draft greeting' } });
  const first = await f.request('POST', '/channels', body, 'owner', { host: 'attacker.example.test' }); assert.equal(first.statusCode, 201, first.body);
  const { channel, operation, replayed } = first.json(); assert.equal(replayed, false); assert.equal(channel.enabled, false); assert.equal(channel.revision, 1);
  assert.deepEqual(channel.configuration.allowedOrigins, [origin]); assert.equal(channel.provider, 'openai');
  assert.deepEqual(channel.readiness, { canEnable: true, available: false, reasons: [] });
  assert.equal(channel.installation.scriptUrl, 'http://127.0.0.1:4310/widget/kloel.js'); assert.equal(channel.installation.tenantId, f.tenant); assert.equal(channel.installation.channelId, channel.id);
  assert.equal(channel.installation.snippet, `<script src="http://127.0.0.1:4310/widget/kloel.js" data-kloel-tenant="${f.tenant}" data-kloel-channel="${channel.id}" async></script>`);
  const before = snapshot(f.store), recovered = await f.request('GET', '/operations/' + body.idempotencyKey);
  assert.equal(recovered.statusCode, 200, recovered.body); assert.deepEqual(recovered.json(), operation); assert.deepEqual(snapshot(f.store), before);
  for (const secret of ['sessionHash', 'authorityVersion', 'fingerprint', 'Private draft greeting', 'synthetic-openai-secret', 'configuration', 'attacker.example']) assert.equal(recovered.body.includes(secret), false);
  const replay = await f.request('POST', '/channels', body); assert.equal(replay.statusCode, 200); assert.equal(replay.json().channel.id, channel.id); assert.equal(replay.json().replayed, true);
  assert.equal(f.store.list(f.tenant, 'channels').length, 1); assert.equal(f.store.list(f.tenant, 'webchat-channel-operations').length, 1); assert.equal(f.store.list(f.tenant, 'webchat-channel-audit').length, 1);
  assert.equal((await f.request('POST', '/channels', { ...body, name: 'Changed input' })).statusCode, 409); assert.equal(f.providerCalls(), 0);
});

test('CAS update and enable/disable preserve immutable binding and recover original receipt plus current state', async t => {
  const f = await fixture(t), created = await f.create(), patch = { ...f.control(created), name: 'Renamed', configuration: { greeting: 'New greeting' } };
  const changed = await f.request('PATCH', '/channels/' + created.id, patch); assert.equal(changed.statusCode, 200, changed.body);
  const updated = changed.json().channel; assert.equal(updated.revision, 2); assert.equal(updated.agentId, created.agentId); assert.deepEqual(updated.configuration.allowedOrigins, [origin]);
  assert.equal((await f.request('PATCH', '/channels/' + created.id, { ...f.control(created), name: 'stale' })).statusCode, 409);
  const enabledResponse = await f.request('POST', `/channels/${created.id}/enable`, f.control(updated)); assert.equal(enabledResponse.statusCode, 200, enabledResponse.body);
  const enabled = enabledResponse.json().channel; assert.equal(enabled.enabled, true); assert.equal(enabled.readiness.available, true);
  const replay = await f.request('PATCH', '/channels/' + created.id, patch); assert.equal(replay.json().channel.revision, 3); assert.equal(replay.json().operation.result.revision, 2); assert.equal(replay.json().replayed, true);
  for (const extra of [{ agentId: randomUUID() }, { type: 'phone' }, { provider: 'meta' }, { enabled: true }]) assert.equal((await f.request('PATCH', '/channels/' + created.id, { ...f.control(enabled), ...extra })).statusCode, 400);
  assert.equal((await f.request('PATCH', '/channels/' + created.id, { ...f.control(enabled), configuration: { allowedOrigins: [] } })).statusCode, 409);
  const disabled = await f.request('POST', `/channels/${created.id}/disable`, f.control(enabled)); assert.equal(disabled.statusCode, 200); assert.equal(disabled.json().channel.enabled, false); assert.equal(f.providerCalls(), 0);
});

test('same-key concurrent requests commit once; different keys with same CAS permit one update', async t => {
  const f = await fixture(t), body = f.input();
  const starts = await Promise.all([f.request('POST', '/channels', body), f.request('POST', '/channels', body)]);
  assert.deepEqual(starts.map(r => r.statusCode).sort(), [200, 201]); assert.equal(starts[0].json().channel.id, starts[1].json().channel.id);
  const row = starts[0].json().channel;
  const changes = await Promise.all(['First', 'Second'].map(name => f.request('PATCH', '/channels/' + row.id, { ...f.control(row), name })));
  assert.deepEqual(changes.map(r => r.statusCode).sort(), [200, 409]); assert.equal(f.store.list(f.tenant, 'webchat-channel-operations').length, 2);
});

test('origins share strict canonical policy between writes and visitor runtime, including legacy mixed configuration', async t => {
  const invalid = ['http://remote.example.test', 'http://localhost.evil.test', 'https://*.example.test', 'https://user:secret@example.test', 'https://example.test/path', 'https://example.test?q=x', 'https://example.test#x', 'https://example.test?', 'https://example.test/#', 'https:example.test', 'https://@example.test', 'null', 'file:///tmp/test', ' https://example.test', 'https://example.test\\evil'];
  for (const value of invalid) assert.equal(canonicalWebchatOrigin(value), undefined, value);
  for (const value of ['https://example.test', 'http://localhost:4200', 'http://127.0.0.1:4310', 'http://[::1]:4400']) assert.equal(canonicalWebchatOrigin(value), value);
  assert.equal(canonicalWebchatOrigin('HTTPS://EXAMPLE.TEST:443/'), 'https://example.test');
  const f = await fixture(t);
  for (const value of invalid) { const response = await f.request('POST', '/channels', f.input({ configuration: { allowedOrigins: [value], greeting: '' } })); assert.equal(response.statusCode, 400, value + ': ' + response.body); }
  const legacy = f.store.create(f.tenant, 'channels', { type: 'webchat', provider: 'openai', name: 'Legacy mixed', agentId: f.agent.id, enabled: true, configuration: { allowedOrigins: [origin, 'http://remote.example.test'], greeting: '' } });
  const dto = (await f.request('GET', '/channels/' + legacy.id)).json(); assert.equal(dto.readiness.available, false); assert.ok(dto.readiness.reasons.includes('origins_invalid')); assert.deepEqual(dto.configuration.allowedOrigins, [origin]);
  assert.equal(allowedChatOrigin(legacy, 'http://remote.example.test'), false); assert.equal(allowedChatOrigin(legacy, origin), false);
  const denied = await f.app.inject({ method: 'POST', url: `/api/v1/public/chat/sessions?tenantId=${f.tenant}&channelId=${legacy.id}`, headers: { origin: 'http://remote.example.test' }, payload: {} }); assert.equal(denied.statusCode, 403);
  const validButIncomplete = await f.app.inject({ method: 'POST', url: `/api/v1/public/chat/sessions?tenantId=${f.tenant}&channelId=${legacy.id}`, headers: { origin }, payload: {} }); assert.equal(validButIncomplete.statusCode, 403);
  const repaired = await f.request('PATCH', '/channels/' + legacy.id, { ...f.control(dto), configuration: { allowedOrigins: [origin] } }); assert.equal(repaired.statusCode, 200, repaired.body);
  assert.equal(allowedChatOrigin(f.store.get(f.tenant, 'channels', legacy.id)!, origin), true);
  assert.equal(f.providerCalls(), 0);
});

test('enable requires active local agent, valid origins, provider tenant/config and safe installation origin', async t => {
  const f = await fixture(t), row = await f.create();
  const scenarios = [
    () => { f.store.update(f.tenant, 'agents', f.agent.id, { status: 'paused' }); return 'agent_inactive'; },
    () => { delete process.env.OPENAI_API_KEY; return 'provider_not_configured'; },
    () => { process.env.PROVIDER_TENANT_ID = 'different'; return 'tenant_not_bound'; },
    () => { process.env.PUBLIC_BASE_URL = 'https://user:secret@engine.test/path'; return 'installation_unavailable'; },
  ];
  for (const mutate of scenarios) {
    process.env.OPENAI_API_KEY = 'synthetic-openai-secret'; process.env.PROVIDER_TENANT_ID = f.tenant; process.env.PUBLIC_BASE_URL = 'http://127.0.0.1:4310'; f.store.update(f.tenant, 'agents', f.agent.id, { status: 'active' });
    const reason = mutate(), current = (await f.request('GET', '/channels/' + row.id)).json(); assert.equal(current.readiness.canEnable, false); assert.ok(current.readiness.reasons.includes(reason));
    if (reason === 'installation_unavailable') assert.equal(current.installation, null);
    assert.equal((await f.request('POST', `/channels/${row.id}/enable`, f.control(current))).statusCode, 409);
  }
  assert.equal(f.store.list(f.tenant, 'webchat-channel-operations').length, 1); assert.equal(f.providerCalls(), 0);
});

test('generic webchat create, edit, type transitions and deletion cannot bypass private receipts; phone stays usable and WhatsApp requires its private route', async t => {
  const f = await fixture(t), row = await f.create(), before = snapshot(f.store);
  const create = { name: 'Bypass', type: 'webchat', provider: 'openai', agentId: f.agent.id, enabled: true, configuration: { allowedOrigins: [origin] } };
  for (const [method, path, payload] of [['POST', '/api/v1/channels', create], ['PATCH', '/api/v1/channels/' + row.id, { enabled: true }], ['PATCH', '/api/v1/channels/' + row.id, { type: 'phone', provider: 'twilio' }], ['DELETE', '/api/v1/channels/' + row.id, undefined]] as const) {
    const response = await f.request(method, path, payload); assert.equal(response.statusCode, 409, response.body); assert.equal(response.json().error.code, 'webchat_private_route_required');
  }
  assert.deepEqual(snapshot(f.store), before);
  const meta = await f.request('POST', '/api/v1/channels', { name: 'Meta', type: 'whatsapp', provider: 'meta' });
  assert.equal(meta.statusCode, 409); assert.equal(meta.json().error.code, 'whatsapp_private_route_required');
  for (const [type, provider] of [['phone', 'twilio']]) {
    const made = await f.request('POST', '/api/v1/channels', { name: type, type, provider, agentId: f.agent.id, configuration: { externalId: '123', address: '+5511999999999' } }); assert.equal(made.statusCode, 201, made.body);
    const id = made.json().id;
    assert.equal((await f.request('PATCH', '/api/v1/channels/' + id, { type: 'webchat', provider: 'openai' })).statusCode, 409);
    assert.equal((await f.request('PATCH', '/api/v1/channels/' + id, { enabled: true })).statusCode, 200);
    assert.equal((await f.request('DELETE', '/api/v1/channels/' + id)).statusCode, 204);
  }
});

test('list cursor is bounded and scoped to actor/context/filter; inserts do not shift existing pages', async t => {
  const f = await fixture(t), rows = [];
  for (let index = 0; index < 4; index++) rows.push(await f.create({ name: 'Channel ' + index }));
  const alternate = f.store.create(f.tenant, 'agents', { ...f.agent, name: 'Other' }); await f.create({ agentId: alternate.id });
  const query = `/channels?agentId=${f.agent.id}&limit=2`, first = (await f.request('GET', query)).json();
  assert.deepEqual(first.items.map((r: any) => r.id), [rows[3].id, rows[2].id]); assert.ok(first.nextCursor);
  await f.create({ name: 'Newer' });
  const before = snapshot(f.store), next = (await f.request('GET', query + '&cursor=' + first.nextCursor)).json();
  assert.deepEqual(next.items.map((r: any) => r.id), [rows[1].id, rows[0].id]); assert.equal(next.nextCursor, null); assert.deepEqual(snapshot(f.store), before);
  const bytes = Buffer.from(first.nextCursor, 'base64url'); bytes[bytes.length - 1] ^= 1;
  for (const path of [query + '&cursor=' + bytes.toString('base64url'), `/channels?limit=2&cursor=${first.nextCursor}`, `/channels?agentId=${f.agent.id}&limit=1&cursor=${first.nextCursor}`]) assert.equal((await f.request('GET', path)).statusCode, 400);
  assert.equal((await f.request('GET', query + '&cursor=' + first.nextCursor, undefined, 'other')).statusCode, 400);
  assert.deepEqual((await f.request('GET', '/channels', undefined, 'foreign')).json().items, []);
});

test('receipt binds original human/session/membership; role ABA and cross-tab tenant cannot leak or mutate', async t => {
  const f = await fixture(t), body = f.input(), made = await f.request('POST', '/channels', body), row = made.json().channel;
  assert.equal((await f.request('GET', '/operations/' + body.idempotencyKey, undefined, 'other')).statusCode, 404);
  assert.equal((await f.request('GET', '/operations/' + body.idempotencyKey, undefined, 'foreign')).statusCode, 404);
  assert.equal((await f.request('POST', '/channels', body, 'other')).statusCode, 409);
  assert.equal((await f.request('GET', '/channels/' + row.id, undefined, 'foreign')).statusCode, 404);
  assert.equal((await f.request('GET', '/channels', undefined, 'viewer')).statusCode, 403);
  assert.equal((await f.request('POST', '/channels', f.input(), 'member')).statusCode, 403);
  assert.equal((await f.request('GET', '/channels', undefined, 'member')).statusCode, 200);
  const before = snapshot(f.store), wrongCookie = await f.request('POST', '/channels', f.input(), 'owner', { cookie: 'kloel_session=' + f.cookies.foreign }); assert.equal(wrongCookie.statusCode, 409); assert.deepEqual(snapshot(f.store), before);
  const noContext = await f.app.inject({ method: 'POST', url: base + '/channels', headers: { cookie: 'kloel_session=' + f.cookies.foreign }, payload: f.input() }); assert.equal(noContext.statusCode, 409); assert.deepEqual(snapshot(f.store), before);
  f.store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(hash('replacement-cookie'), f.identities.owner.userId, f.tenant, Date.now() + 3600000);
  const replaced = await f.app.inject({ url: base + '/operations/' + body.idempotencyKey, headers: { cookie: 'kloel_session=replacement-cookie' } }); assert.equal(replaced.statusCode, 404);
  f.store.db.prepare("UPDATE memberships SET role='admin' WHERE tenant_id=? AND user_id=?").run(f.tenant, f.identities.owner.userId);
  f.store.db.prepare("UPDATE memberships SET role='owner' WHERE tenant_id=? AND user_id=?").run(f.tenant, f.identities.owner.userId);
  assert.equal((await f.request('GET', '/operations/' + body.idempotencyKey)).statusCode, 409);
  assert.equal((await f.app.inject({ url: base + '/operations/' + body.idempotencyKey, headers: { cookie: 'kloel_session=' + f.cookies.owner } })).statusCode, 404);
});

test('authority is revalidated inside transaction and after effects; audit/receipt failure rolls back channel', async t => {
  const f = await fixture(t), originalTransaction = f.store.transaction.bind(f.store);
  let mutate = true;
  f.store.transaction = fn => originalTransaction(() => { if (mutate) { mutate = false; f.store.db.prepare("UPDATE memberships SET role='admin' WHERE tenant_id=? AND user_id=?").run(f.tenant, f.identities.owner.userId); f.store.db.prepare("UPDATE memberships SET role='owner' WHERE tenant_id=? AND user_id=?").run(f.tenant, f.identities.owner.userId); } return fn(); });
  const rejected = await f.request('POST', '/channels', f.input()); assert.equal(rejected.statusCode, 409, rejected.body); assert.equal(f.store.list(f.tenant, 'channels').length, 0);
  f.store.transaction = originalTransaction;
  const originalCreate = f.store.create.bind(f.store);
  for (const target of ['webchat-channel-operations', 'webchat-channel-audit']) {
    f.store.create = (tenant, collection, data) => { if (collection === target) throw new Error('Injected rollback'); return originalCreate(tenant, collection, data); };
    const response = await f.request('POST', '/channels', f.input()); assert.equal(response.statusCode, 500); assert.equal(f.store.list(f.tenant, 'channels').length, 0); assert.equal(f.store.list(f.tenant, 'webchat-channel-operations').length, 0);
  }
  f.store.create = (tenant, collection, data) => { const result = originalCreate(tenant, collection, data); if (collection === 'webchat-channel-audit') f.store.db.prepare('DELETE FROM sessions WHERE hash=?').run(hash(f.cookies.owner)); return result; };
  const after = await f.request('POST', '/channels', f.input()); assert.equal(after.statusCode, 409, after.body); assert.equal(f.store.list(f.tenant, 'channels').length, 0);
  f.store.create = originalCreate;
});

test('legacy reads do not migrate values; first private write increments derived revision and hides unknown fields', async t => {
  const f = await fixture(t), legacy = f.store.create(f.tenant, 'channels', { name: 'Legacy', type: 'webchat', provider: 'openai', agentId: f.agent.id, enabled: false, internalSecret: 'private-secret', configuration: { allowedOrigins: [origin], greeting: '', apiKey: 'private-secret' } });
  const before = snapshot(f.store), read = await f.request('GET', '/channels/' + legacy.id); assert.equal(read.statusCode, 200); assert.equal(read.json().revision, 0); assert.equal(read.body.includes('private-secret'), false); assert.deepEqual(snapshot(f.store), before);
  const write = await f.request('PATCH', '/channels/' + legacy.id, { ...f.control(read.json()), name: 'Updated legacy' }); assert.equal(write.statusCode, 200); assert.equal(write.json().channel.revision, 1);
  const immutableAgent = await f.request('PATCH', '/channels/' + legacy.id, { ...f.control(write.json().channel), agentId: f.agent.id }); assert.equal(immutableAgent.statusCode, 400);
});

test('configured native channel serves the actual widget and public session; disable suspends without erasing history', async t => {
  const f = await fixture(t), channel = await f.create();
  const enabled = await f.request('POST', `/channels/${channel.id}/enable`, f.control(channel)); assert.equal(enabled.statusCode, 200);
  const widget = await f.app.inject('/widget/kloel.js'); assert.equal(widget.statusCode, 200); assert.ok(widget.body.includes('dataset.kloelTenant')); assert.ok(widget.body.includes('dataset.kloelChannel'));
  const query = `?tenantId=${f.tenant}&channelId=${channel.id}`;
  const session = await f.app.inject({ method: 'POST', url: '/api/v1/public/chat/sessions' + query, headers: { origin }, payload: {} }); assert.equal(session.statusCode, 201, session.body);
  assert.equal(session.json().greeting, 'Bem-vindo!'); assert.equal(f.store.list(f.tenant, 'conversations').length, 1);
  const disabled = await f.request('POST', `/channels/${channel.id}/disable`, f.control(enabled.json().channel)); assert.equal(disabled.statusCode, 200);
  const history = await f.app.inject({ url: '/api/v1/public/chat/history' + query, headers: { origin, authorization: 'Bearer ' + session.json().token } }); assert.equal(history.statusCode, 403);
  assert.equal(f.store.list(f.tenant, 'conversations').length, 1); assert.equal(f.store.list(f.tenant, 'public-chat-sessions').length, 1); assert.equal(f.providerCalls(), 0);
});
