import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Store } from '../src/store.js';
import { agentRuntimeTools, executeAgentTool, type AgentContext } from '../src/providers/agent-tools.js';
import { configureBaserowTable } from '../src/integrations/baserow.js';
import { DeliveryError, type IntegrationTransport } from '../src/integrations/transport.js';
import { seedMemberships } from './fixtures/membership.js';

function fixture(t: TestContext) {
  const previous = process.env.OAUTH_ENCRYPTION_KEY;
  process.env.OAUTH_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  const store = new Store(), actor = { userId: 'owner', tenantId: 'tenant-a', role: 'owner' as const };
  store.db.prepare('INSERT INTO users VALUES(?,?,?,?,?)').run('owner', 'tenant-a', 'owner@example.test', 'unused', 'owner');
  store.db.prepare('INSERT INTO sessions(hash,user_id,expires) VALUES(?,?,?)').run('session-hash', 'owner', Date.now() + 60000);
  seedMemberships(store);
  const agent = store.create(actor.tenantId, 'agents', { status: 'active', name: 'Baserow assistant', tools: [] });
  const context: AgentContext = { tenantId: actor.tenantId, actor, agent, conversationId: 'conversation', trustedOperator: true, operatorSessionHash: 'session-hash' };
  const binding = configureBaserowTable(store, actor, { name: 'Pedidos', instanceUrl: 'https://api.baserow.io', token: 'fixture-token-only', tableId: 101, agentIds: [agent.id], allowCreate: true });
  const requests: { method: string; path: string; body?: string }[] = [];
  const transport: IntegrationTransport = {
    resolve: async () => [{ address: '93.184.216.34', family: 4 }],
    request: async (url, _address, spec) => {
      requests.push({ method: spec.method, path: url.pathname, body: spec.body?.toString() });
      const data = url.pathname.includes('/fields/') ? [{ id: 7, name: 'Nome', type: 'text' }] : spec.method === 'POST' ? { id: 91, field_7: 'Pedido' } : { count: 1, next: null, results: [{ id: 91, field_7: 'Pedido' }] };
      return { status: 200, headers: {}, body: Buffer.from(JSON.stringify(data)) };
    },
  };
  const call = (action: 'fields' | 'read' | 'create', id = action, args: unknown = action === 'create' ? { values: { field_7: 'Pedido' } } : {}) => ({ id, name: `baserow_${action}_${binding.id.replaceAll('-', '')}`, arguments: JSON.stringify(args) });
  t.after(() => { store.close(); if (previous === undefined) delete process.env.OAUTH_ENCRYPTION_KEY; else process.env.OAUTH_ENCRYPTION_KEY = previous; });
  return { store, context, binding, transport, requests, call };
}

test('Baserow dispatcher exposes bound schemas without credentials and routes fields/read/create with durable write idempotency', async t => {
  const f = fixture(t), definitions = agentRuntimeTools(f.store, f.context);
  assert.deepEqual(definitions.map(d => d.name), ['fields', 'read', 'create'].map(a => `baserow_${a}_${f.binding.id.replaceAll('-', '')}`));
  assert.ok(!JSON.stringify(definitions).includes('fixture-token-only'));
  assert.ok(!JSON.stringify(definitions).includes('api.baserow.io'));
  for (const action of ['fields', 'read', 'create'] as const) {
    const first = await executeAgentTool(f.store, f.context, f.call(action), { integrationTransport: f.transport });
    assert.equal(first.ok, true); assert.equal(first.source, 'baserow');
    assert.equal(first.dataSource, 'untrusted_external_content');
    assert.deepEqual(await executeAgentTool(f.store, f.context, f.call(action), { integrationTransport: f.transport }), first);
  }
  assert.equal(f.requests.filter(r => r.method === 'POST').length, 1);
  assert.equal(f.requests.at(-1)?.body, '{"field_7":"Pedido"}');
  assert.equal(f.store.list('tenant-a', 'baserow-operations')[0].status, 'created');
  assert.equal((await executeAgentTool(f.store, f.context, f.call('create', 'create', { values: { field_7: 'Outro' } }), { integrationTransport: f.transport })).error, 'tool_call_id_conflict');
});

test('Baserow cached rows cannot bypass visitor isolation, assignment, disabled binding, revision or live session revocation', async t => {
  const f = fixture(t), read = f.call('read');
  assert.deepEqual(agentRuntimeTools(f.store, { ...f.context, trustedOperator: false }), []);
  assert.equal((await executeAgentTool(f.store, { ...f.context, trustedOperator: false }, read)).error, 'tool_not_enabled');
  assert.equal((await executeAgentTool(f.store, f.context, read, { integrationTransport: f.transport })).ok, true);
  for (const patch of [{ agentIds: [] }, { agentIds: [f.context.agent.id], enabled: false }]) {
    f.store.update('tenant-a', 'baserow-bindings', f.binding.id, patch);
    assert.equal((await executeAgentTool(f.store, f.context, read)).error, 'tool_not_enabled');
  }
  f.store.update('tenant-a', 'baserow-bindings', f.binding.id, { enabled: true, revision: 2 });
  assert.equal((await executeAgentTool(f.store, f.context, read)).error, 'tool_call_id_conflict');
  f.store.db.prepare('DELETE FROM sessions').run();
  assert.equal((await executeAgentTool(f.store, f.context, read)).error, 'operator_session_revoked');
  assert.equal(f.requests.length, 1);
});

test('Baserow session revocation during DNS prevents delivery of credentials or a write', async t => {
  const f = fixture(t);
  const transport = { ...f.transport, resolve: async () => { f.store.db.prepare('DELETE FROM sessions').run(); return [{ address: '93.184.216.34', family: 4 }]; } };
  const result = await executeAgentTool(f.store, f.context, f.call('create'), { integrationTransport: transport });
  assert.equal(result.error, 'operator_session_revoked'); assert.equal(f.requests.length, 0);
  assert.equal(f.store.list('tenant-a', 'baserow-operations').length, 0);
});

test('Baserow assignment removed while response arrives suppresses rows and cannot be replayed', async t => {
  const f = fixture(t), read = f.call('read');
  const transport: IntegrationTransport = { ...f.transport, request: async (...args) => {
    const result = await f.transport.request!(...args);
    f.store.update('tenant-a', 'baserow-bindings', f.binding.id, { agentIds: [] }); return result;
  } };
  assert.equal((await executeAgentTool(f.store, f.context, read, { integrationTransport: transport })).error, 'tool_not_enabled');
  assert.equal((await executeAgentTool(f.store, f.context, read, { integrationTransport: transport })).error, 'tool_not_enabled');
  assert.equal(f.requests.length, 1);
});

test('Baserow uncertain create is never resent by the same tool call', async t => {
  const f = fixture(t); let writes = 0;
  const transport: IntegrationTransport = { ...f.transport, request: async (...args) => {
    if (args[2].method === 'POST') { writes++; throw new DeliveryError('fixture_timeout', true); }
    return f.transport.request!(...args);
  } };
  const first = await executeAgentTool(f.store, f.context, f.call('create'), { integrationTransport: transport });
  assert.equal(first.ok, false); assert.equal(first.outcome, 'not_confirmed');
  assert.deepEqual(await executeAgentTool(f.store, f.context, f.call('create'), { integrationTransport: transport }), first);
  assert.equal(writes, 1); assert.equal(f.store.list('tenant-a', 'baserow-operations')[0].status, 'uncertain');
});

test('Baserow read-only binding excludes creation even if visitor arguments request it', async t => {
  const f = fixture(t);
  f.store.update('tenant-a', 'baserow-bindings', f.binding.id, { allowCreate: false });
  assert.equal(agentRuntimeTools(f.store, f.context).length, 2);
  assert.equal((await executeAgentTool(f.store, f.context, f.call('create'), { integrationTransport: f.transport })).error, 'tool_not_enabled');
  assert.equal(f.requests.length, 0);
});
