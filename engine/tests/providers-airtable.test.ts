import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Store } from '../src/store.js';
import { agentRuntimeTools, executeAgentTool, type AgentContext } from '../src/providers/agent-tools.js';
import { configureAirtableTable } from '../src/integrations/airtable.js';
import type { IntegrationTransport } from '../src/integrations/transport.js';
import { seedMemberships } from './fixtures/membership.js';

function fixture(t: TestContext) {
  process.env.OAUTH_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  const store = new Store(), actor = { userId: 'owner', tenantId: 'tenant-a', role: 'owner' as const };
  store.db.prepare('INSERT INTO users VALUES(?,?,?,?,?)').run('owner', 'tenant-a', 'owner@example.test', 'unused', 'owner');
  store.db.prepare('INSERT INTO sessions(hash,user_id,expires) VALUES(?,?,?)').run('session-hash', 'owner', Date.now() + 60000); seedMemberships(store);
  const agent = store.create(actor.tenantId, 'agents', { status: 'active', name: 'Airtable assistant', tools: [] });
  const context: AgentContext = { tenantId: actor.tenantId, actor, agent, conversationId: 'conversation', trustedOperator: true, operatorSessionHash: 'session-hash' };
  const binding = configureAirtableTable(store, actor, { name: 'Pedidos', token: 'fixture-token-only', baseId: 'app12345678901234', tableId: 'tbl12345678901234', fieldIds: ['fld12345678901234'], agentIds: [agent.id], allowCreate: true });
  const requests: string[] = [];
  const transport: IntegrationTransport = { resolve: async () => [{ address: '93.184.216.34', family: 4 }], request: async (url, _address, spec) => {
    requests.push(spec.method);
    const data = url.pathname.includes('/meta/') ? { tables: [{ id: 'tbl12345678901234', fields: [{ id: 'fld12345678901234', name: 'Name', type: 'singleLineText' }] }] } : { records: [{ id: 'rec12345678901234', createdTime: '2026-10-18T09:00:00Z', fields: { fld12345678901234: 'Pedido' } }] };
    return { status: 200, headers: {}, body: Buffer.from(JSON.stringify(data)) };
  } };
  const call = (action: 'fields' | 'read' | 'create', id = action) => ({ id, name: `airtable_${action}_${binding.id.replaceAll('-', '')}`, arguments: JSON.stringify(action === 'create' ? { values: { fld12345678901234: 'Pedido' } } : {}) });
  t.after(() => store.close()); return { store, context, binding, transport, requests, call };
}

test('Airtable dispatcher executes native fields/read/create and replays one remote write', async t => {
  const f = fixture(t), tools = agentRuntimeTools(f.store, f.context);
  assert.equal(tools.length, 3); assert.ok(!JSON.stringify(tools).includes('fixture-token-only'));
  for (const action of ['fields', 'read', 'create'] as const) {
    const first = await executeAgentTool(f.store, f.context, f.call(action), { integrationTransport: f.transport });
    assert.equal(first.ok, true); assert.equal(first.source, 'airtable');
    assert.deepEqual(await executeAgentTool(f.store, f.context, f.call(action), { integrationTransport: f.transport }), first);
  }
  assert.equal(f.requests.filter(m => m === 'POST').length, 1);
  assert.equal(f.store.list('tenant-a', 'airtable-operations')[0].status, 'created');
});

test('Airtable tool receipts cannot bypass changed assignment, binding revision or revoked session', async t => {
  const f = fixture(t), read = f.call('read');
  assert.equal(agentRuntimeTools(f.store, { ...f.context, trustedOperator: false }).length, 0);
  assert.equal((await executeAgentTool(f.store, f.context, read, { integrationTransport: f.transport })).ok, true);
  f.store.update('tenant-a', 'airtable-bindings', f.binding.id, { agentIds: [] });
  assert.equal((await executeAgentTool(f.store, f.context, read)).error, 'tool_not_enabled');
  f.store.update('tenant-a', 'airtable-bindings', f.binding.id, { agentIds: [f.context.agent.id], revision: 2 });
  assert.equal((await executeAgentTool(f.store, f.context, read)).error, 'tool_call_id_conflict');
  f.store.db.prepare('DELETE FROM sessions').run();
  assert.equal((await executeAgentTool(f.store, f.context, read)).error, 'operator_session_revoked'); assert.equal(f.requests.length, 1);
});

test('Airtable dispatcher suppresses late revoked data and prevents credential delivery after DNS revocation', async t => {
  const f = fixture(t);
  const transport: IntegrationTransport = { ...f.transport, request: async (...args) => { const result = await f.transport.request!(...args); f.store.db.prepare('DELETE FROM sessions').run(); return result; } };
  const read = await executeAgentTool(f.store, f.context, f.call('read'), { integrationTransport: transport });
  assert.equal(read.ok, false); assert.equal(read.error, 'operator_session_revoked'); assert.ok(!JSON.stringify(read).includes('Pedido'));
  f.store.db.prepare('INSERT INTO sessions(hash,user_id,expires,tenant_id) VALUES(?,?,?,?)').run('session-hash', 'owner', Date.now() + 60000, 'tenant-a');
  const before = f.requests.length;
  const dns: IntegrationTransport = { ...f.transport, resolve: async () => { f.store.db.prepare('DELETE FROM sessions').run(); return [{ address: '93.184.216.34', family: 4 }]; } };
  const create = await executeAgentTool(f.store, f.context, f.call('create'), { integrationTransport: dns }); assert.equal(create.error, 'operator_session_revoked'); assert.equal(f.requests.length, before);
});
