import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { Store } from '../src/store.js';
import { registerAuth, sessionDigest } from '../src/auth.js';
import { CONTEXT_HEADERS, type ExpectedRequestContext } from '../src/request-context.js';
import { seedMember } from './fixtures/membership.js';
import { hasPermission } from '../src/memberships/permissions.js';
import { seal, unseal } from '../src/oauth/crypto.js';
import { baserowOperations, configureBaserowTable, createBaserowRow, executeAgentBaserow, registerBaserowRoutes } from '../src/integrations/baserow.js';
import type { IntegrationTransport } from '../src/integrations/transport.js';

const secret = 'synthetic-key-redaction-token', rowId = 41;
const reply = (body: unknown) => ({ status: 200, headers: {}, body: Buffer.from(JSON.stringify(body)) });
const reflectedRow = () => ({ id: rowId, field_1: `value ${secret}`, [secret]: { id: 999 },
  '[redacted]': 'legitimate provider field', [`prefix-${secret}`]: 'must be omitted',
  nested: { [secret]: 'hidden field', '[redacted]': 'keep nested field', values: [secret, { [`nested-${secret}`]: 123, keep: secret }] } });
const sanitizedRow = { id: rowId, field_1: 'value [redacted]', '[redacted]': 'legitimate provider field',
  nested: { '[redacted]': 'keep nested field', values: ['[redacted]', { keep: '[redacted]' }] } };
async function fixture(t: TestContext) {
  const oldKey = process.env.OAUTH_ENCRYPTION_KEY; process.env.OAUTH_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  const store = new Store(':memory:'), app = Fastify(), actor = { userId: randomUUID(), tenantId: randomUUID(), role: 'owner' as const };
  seedMember(store, actor);
  const agent = store.create(actor.tenantId, 'agents', { name: 'Synthetic Baserow assistant' });
  const binding = configureBaserowTable(store, actor, { name: 'Synthetic table', instanceUrl: 'https://database.example.com', tableId: 1,
    token: secret, allowCreate: true, allowedRoles: ['owner', 'member'], agentIds: [agent.id] });
  const calls: string[] = [];
  const transport: IntegrationTransport = { resolve: async () => [{ address: '93.184.216.34', family: 4 }], request: async (url, _address, spec) => {
    calls.push(spec.method);
    return url.pathname.includes('/fields/') ? reply([{ id: 1, name: `Name ${secret}`, type: 'text' }])
      : spec.method === 'POST' ? reply(reflectedRow()) : reply({ count: 1, next: null, results: [reflectedRow()] });
  } };
  await app.register(cookie); await registerAuth(app, store); await registerBaserowRoutes(app, store, transport);
  const credentials = async (userId: string) => {
    const token = randomBytes(32).toString('base64url'), cookies = { kloel_session: token };
    store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(sessionDigest(token), userId, actor.tenantId, Date.now() + 60000);
    const me = await app.inject({ url: '/api/v1/auth/me', cookies }); assert.equal(me.statusCode, 200, me.body);
    const context = me.json().context as ExpectedRequestContext;
    return { cookies, headers: Object.fromEntries(Object.entries(CONTEXT_HEADERS).map(([key, header]) => [header, context[key as keyof ExpectedRequestContext] ?? '-'])) };
  };
  t.after(async () => { await app.close(); store.close(); if (oldKey === undefined) delete process.env.OAUTH_ENCRYPTION_KEY; else process.env.OAUTH_ENCRYPTION_KEY = oldKey; });
  return { store, app, actor, agent, binding, transport, calls, credentials };
}

test('Baserow HTTP query never exposes token-bearing keys to a member, and preserves non-secret collision candidates', async t => {
  const f = await fixture(t), member = { ...f.actor, userId: randomUUID(), role: 'member' as const }; seedMember(f.store, member);
  assert.equal(hasPermission(member.role, 'integrations:manage'), false);
  const result = await f.app.inject({ method: 'POST', url: `/api/v1/integrations/baserow/tables/${f.binding.id}/query`,
    ...await f.credentials(member.userId), payload: { size: 1 } });
  assert.equal(result.statusCode, 200, result.body); assert.equal(result.body.includes(secret), false);
  assert.deepEqual(result.json().items, [sanitizedRow]); assert.deepEqual(f.calls, ['GET']);
});

test('native Baserow creation seals only sanitized data and replays without provider I/O', async t => {
  const f = await fixture(t), key = randomUUID(), args = { values: { field_1: 'Synthetic input' } };
  const created: any = await createBaserowRow(f.store, f.actor, f.binding.id, args, key, f.transport);
  assert.equal(created.operation.status, 'created'); assert.equal(created.operation.rowId, rowId); assert.deepEqual(created.row, sanitizedRow);
  const operation = f.store.list(f.actor.tenantId, baserowOperations)[0];
  const stored = unseal(String(operation.encryptedResult), `${f.actor.tenantId}:${operation.id}:baserow-result`);
  assert.deepEqual(stored, created); assert.equal(JSON.stringify(stored).includes(secret), false);
  const before = JSON.stringify(f.store.db.prepare('SELECT * FROM entities ORDER BY rowid').all());
  assert.deepEqual(await createBaserowRow(f.store, f.actor, f.binding.id, args, key, f.transport), created);
  assert.equal(JSON.stringify(f.store.db.prepare('SELECT * FROM entities ORDER BY rowid').all()), before); assert.deepEqual(f.calls, ['GET', 'POST']);
});

test('legacy encrypted Baserow replay is sanitized on read without rewriting the historical receipt or repeating creation', async t => {
  const f = await fixture(t), key = randomUUID(), args = { values: { field_1: 'Synthetic input' } };
  const created: any = await createBaserowRow(f.store, f.actor, f.binding.id, args, key, f.transport);
  const operation = f.store.list(f.actor.tenantId, baserowOperations)[0];
  f.store.update(f.actor.tenantId, baserowOperations, operation.id, { encryptedResult: seal({ ...created, row: reflectedRow() }, `${f.actor.tenantId}:${operation.id}:baserow-result`) });
  const before = JSON.stringify(f.store.db.prepare('SELECT * FROM entities ORDER BY rowid').all());
  const replayed: any = await createBaserowRow(f.store, f.actor, f.binding.id, args, key, f.transport);
  assert.deepEqual(replayed, created); assert.equal(JSON.stringify(replayed).includes(secret), false);
  assert.equal(JSON.stringify(f.store.db.prepare('SELECT * FROM entities ORDER BY rowid').all()), before); assert.deepEqual(f.calls, ['GET', 'POST']);
});

test('assigned Baserow tools receive sanitized fields, query data and created rows', async t => {
  const f = await fixture(t), context = { tenantId: f.actor.tenantId, actor: f.actor, agent: f.agent };
  const fields: any = await executeAgentBaserow(f.store, context, f.binding.id, 'fields', {}, randomUUID(), f.transport);
  assert.equal(fields.items[0].name, 'Name [redacted]');
  const read: any = await executeAgentBaserow(f.store, context, f.binding.id, 'read', { size: 1 }, randomUUID(), f.transport);
  assert.deepEqual(read.items, [sanitizedRow]);
  const created: any = await executeAgentBaserow(f.store, context, f.binding.id, 'create', { values: { field_1: 'Synthetic input' } }, randomUUID(), f.transport);
  assert.equal(created.operation.rowId, rowId); assert.deepEqual(created.row, sanitizedRow);
  assert.equal(JSON.stringify({ fields, read, created }).includes(secret), false); assert.deepEqual(f.calls, ['GET', 'GET', 'GET', 'POST']);
});
