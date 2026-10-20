import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { Store } from '../src/store.js';
import { registerAuth } from '../src/auth.js';
import { registerIntegrations } from '../src/integrations.js';
import { configurationOperations } from '../src/integrations/configuration.js';
import { actionCollection } from '../src/integrations/access.js';
import { integrationAgentTools, executeAgentIntegration } from '../src/integrations/service.js';
import { digest } from '../src/oauth/crypto.js';
import { seedMember } from './fixtures/membership.js';
import { CONTEXT_HEADERS, resolveSessionContext } from '../src/request-context.js';

async function fixture(t: TestContext) {
  const previous = process.env.OAUTH_ENCRYPTION_KEY; process.env.OAUTH_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  const store = new Store(), actor = { tenantId: randomUUID(), userId: randomUUID(), role: 'owner' as const }, raw = randomUUID(), sessionHash = digest(raw);
  seedMember(store, actor); store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(sessionHash, actor.userId, actor.tenantId, Date.now() + 60000);
  const app = Fastify(); await app.register(cookie); await registerAuth(app, store);
  const state = { dns: 0, sends: 0, onResolve: undefined as (() => void | Promise<void>) | undefined };
  await registerIntegrations(app, store, { resolve: async () => { state.dns++; await state.onResolve?.(); return [{ address: '93.184.216.34', family: 4 }]; }, request: async () => { state.sends++; throw Error('configuration must not execute'); } });
  t.after(async () => { await app.close(); store.close(); if (previous === undefined) delete process.env.OAUTH_ENCRYPTION_KEY; else process.env.OAUTH_ENCRYPTION_KEY = previous; });
  const headers = () => Object.fromEntries(Object.entries(CONTEXT_HEADERS).map(([key, header]) => [header, resolveSessionContext(store, sessionHash)!.context[key as keyof typeof CONTEXT_HEADERS] ?? '-']));
  const originalHeaders = headers(), cookies = { kloel_session: raw };
  const configuration = { name: 'Synthetic HTTP', template: 'custom_http', url: 'https://workflow.example.com/secret-path?token=fixture-query-secret', method: 'POST', headers: { Authorization: 'Bearer fixture-credential' }, argumentsSchema: { type: 'object', properties: {}, additionalProperties: false }, bodyTemplate: { secret: 'fixture-static-secret' }, responsePaths: {}, timeoutMs: 5000, allowedRoles: ['owner'], agentIds: [], enabled: true };
  const body = (extra: Record<string, unknown> = {}) => ({ expectedTenantId: actor.tenantId, idempotencyKey: randomUUID(), actionId: null, expectedRevision: 0, configuration, ...extra });
  const post = (payload: unknown) => app.inject({ method: 'POST', url: '/api/v1/integrations/action-configurations', cookies, headers: originalHeaders, payload });
  const get = (key: string, session = cookies, expectedHeaders = originalHeaders) => app.inject({ method: 'GET', url: `/api/v1/integrations/configuration-operations/${key}`, cookies: session, headers: expectedHeaders });
  return { app, store, actor, raw, sessionHash, state, configuration, body, post, get, cookies, originalHeaders };
}
test('configuration creates one atomic receipt and action, replays without DNS and returns no private configuration', async t => {
  const f = await fixture(t), body = f.body(), first = await f.post(body);
  assert.equal(first.statusCode, 200, first.body); assert.equal(first.json().operation.revision, 1); assert.equal(f.state.sends, 0);
  const second = await f.post(body); assert.equal(second.statusCode, 200); assert.equal(second.json().replayed, true); assert.equal(f.state.dns, 1);
  const receipt = await f.get(body.idempotencyKey); assert.equal(receipt.statusCode, 200); assert.equal(receipt.json().actionId, first.json().operation.actionId);
  const visible = first.body + receipt.body + JSON.stringify(f.store.list(f.actor.tenantId, actionCollection)) + JSON.stringify(f.store.list(f.actor.tenantId, configurationOperations));
  for (const secret of ['secret-path', 'fixture-query-secret', 'fixture-credential', 'fixture-static-secret']) assert.equal(visible.includes(secret), false);
  assert.equal(f.store.list(f.actor.tenantId, actionCollection).length, 1); assert.equal(f.store.list(f.actor.tenantId, configurationOperations).length, 1);
  assert.equal((await f.post({ ...body, configuration: { ...f.configuration, name: 'Different' } })).statusCode, 409);
});
test('CAS is checked after DNS and a concurrent update cannot be overwritten', async t => {
  const f = await fixture(t), created = (await f.post(f.body())).json().operation, input = f.body({ actionId: created.actionId, expectedRevision: 1 });
  f.state.onResolve = () => { f.store.update(f.actor.tenantId, actionCollection, created.actionId, { revision: 2, name: 'Concurrent' }); };
  const stale = await f.post(input); assert.equal(stale.statusCode, 409, stale.body); assert.equal(stale.json().error.code, 'integration_configuration_changed');
  assert.equal(f.store.get(f.actor.tenantId, actionCollection, created.actionId)?.name, 'Concurrent'); assert.equal((await f.get(input.idempotencyKey)).statusCode, 404);
});
test('concurrent same-key creates commit only one action and receipt', async t => {
  const f = await fixture(t), input = f.body(); let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; }); f.state.onResolve = () => held;
  const first = f.post(input), second = f.post(input); await new Promise(resolve => setImmediate(resolve)); release();
  const result = await Promise.all([first, second]); assert.ok(result.every(r => r.statusCode === 200), result.map(r => r.body).join('\n'));
  assert.equal(f.store.list(f.actor.tenantId, actionCollection).length, 1); assert.equal(f.store.list(f.actor.tenantId, configurationOperations).length, 1);
});
test('role changes during DNS prevent configuration writes', async t => {
  const f = await fixture(t), input = f.body();
  f.state.onResolve = () => { f.store.db.prepare('UPDATE memberships SET role=? WHERE user_id=?').run('member', f.actor.userId); };
  const rejected = await f.post(input); assert.notEqual(rejected.statusCode, 200); assert.equal(f.state.dns, 1); assert.equal(f.store.list(f.actor.tenantId, actionCollection).length, 0);
  f.store.db.prepare('UPDATE memberships SET role=? WHERE user_id=?').run('owner', f.actor.userId);
  const direct = await f.app.inject({ method: 'POST', url: '/api/v1/integrations/action-configurations', payload: f.body() }); assert.notEqual(direct.statusCode, 200);
});
test('a deleted session cannot commit after DNS and a different session cannot read the receipt', async t => {
  const f = await fixture(t), input = f.body(), first = await f.post(input); assert.equal(first.statusCode, 200, first.body);
  const other = randomUUID(); f.store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(digest(other), f.actor.userId, f.actor.tenantId, Date.now() + 60000);
  const otherContext = resolveSessionContext(f.store, digest(other))!.context, otherHeaders = Object.fromEntries(Object.entries(CONTEXT_HEADERS).map(([key, name]) => [name, otherContext[key as keyof typeof CONTEXT_HEADERS] ?? '-']));
  assert.equal((await f.get(input.idempotencyKey, { kloel_session: other }, otherHeaders)).statusCode, 404);
  f.state.onResolve = () => { f.store.db.prepare('DELETE FROM sessions WHERE hash=?').run(f.sessionHash); };
  const rejected = await f.post(f.body()); assert.notEqual(rejected.statusCode, 200); assert.equal(f.state.dns, 2); assert.equal(f.store.list(f.actor.tenantId, actionCollection).length, 1);
});
test('receipt insertion failure rolls back the action and receipt together', async t => {
  const f = await fixture(t), originalCreate = f.store.create.bind(f.store);
  f.store.create = ((tenant: string, collection: string, data: any) => { if (collection === configurationOperations) throw Error('synthetic receipt write failure'); return originalCreate(tenant, collection, data); }) as typeof f.store.create;
  const response = await f.post(f.body()); assert.equal(response.statusCode, 500);
  assert.equal(f.store.list(f.actor.tenantId, actionCollection).length, 0); assert.equal(f.store.list(f.actor.tenantId, configurationOperations).length, 0);
});
test('explicit disable uses CAS and one receipt while preserving encrypted private configuration', async t => {
  const f = await fixture(t), original = (await f.post(f.body())).json().operation, before = f.store.get(f.actor.tenantId, actionCollection, original.actionId)!;
  const input = { expectedTenantId: f.actor.tenantId, idempotencyKey: randomUUID(), actionId: original.actionId, expectedRevision: 1, enabled: false };
  const response = await f.post(input); assert.equal(response.statusCode, 200, response.body); assert.equal(response.json().operation.kind, 'integration.action.set_enabled');
  const after = f.store.get(f.actor.tenantId, actionCollection, original.actionId)!; assert.equal(after.enabled, false); assert.equal(after.revision, 2); assert.equal(after.encryptedConfig, before.encryptedConfig);
  assert.equal((await f.post(input)).json().replayed, true); assert.equal(f.state.dns, 1);
  assert.equal((await f.post({ ...input, idempotencyKey: randomUUID(), enabled: true })).statusCode, 409);
});
test('private destination rejection and mixed inputs never commit an action', async t => {
  const f = await fixture(t);
  assert.equal((await f.post(f.body({ configuration: { ...f.configuration, url: 'https://127.0.0.1/path' } }))).statusCode, 400);
  assert.equal((await f.post(f.body({ enabled: true }))).statusCode, 400);
  assert.equal(f.state.dns, 0); assert.equal(f.store.list(f.actor.tenantId, actionCollection).length, 0);
});
test('after timing is committed with the action before any after-http binding and cannot execute during the conversation', async t => {
  const f = await fixture(t), agent = f.store.create(f.actor.tenantId, 'agents', { name: 'Assistant', status: 'active' });
  const input = f.body({ executionTiming: 'after', configuration: { ...f.configuration, agentIds: [agent.id] } }), response = await f.post(input);
  assert.equal(response.statusCode, 200, response.body); const actionId = response.json().operation.actionId;
  assert.equal(f.store.get(f.actor.tenantId, actionCollection, actionId)?.executionTiming, 'after');
  assert.equal(f.store.list(f.actor.tenantId, 'after-http-configurations').length, 0);
  const context = { tenantId: f.actor.tenantId, actor: f.actor, agent };
  assert.deepEqual(integrationAgentTools(f.store, context), []);
  await assert.rejects(() => executeAgentIntegration(f.store, context, actionId, {}, randomUUID()), (e: any) => e.code === 'action_after_conversation_only');
  assert.equal(f.state.sends, 0);
});
