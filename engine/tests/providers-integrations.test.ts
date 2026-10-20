import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Store } from '../src/store.js';
import { agentRuntimeTools, executeAgentTool, type AgentContext } from '../src/providers/agent-tools.js';
import { configureAction } from '../src/integrations/service.js';
import type { IntegrationTransport } from '../src/integrations/transport.js';
import { seedMemberships } from './fixtures/membership.js';

function fixture(t: any) {
  const previous = process.env.OAUTH_ENCRYPTION_KEY; process.env.OAUTH_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  const store = new Store(); const actor = { userId: 'owner', tenantId: 'tenant-a', role: 'owner' as const };
  store.db.prepare('INSERT INTO users VALUES(?,?,?,?,?)').run('owner', 'tenant-a', 'owner@example.test', 'unused', 'owner');
  store.db.prepare('INSERT INTO sessions(hash,user_id,expires) VALUES(?,?,?)').run('session-hash', 'owner', Date.now() + 60000);
  seedMemberships(store);
  const agent = store.create('tenant-a', 'agents', { name: 'Atendente', status: 'active', tools: [] });
  const context: AgentContext = { tenantId: 'tenant-a', agent, conversationId: 'conversation', trustedOperator: true, actor, operatorSessionHash: 'session-hash' };
  const action = configureAction(store, actor, { name: 'Create ticket', url: 'https://example.com/secret-path', headers: { Authorization: 'Bearer private-credential' }, argumentsSchema: { type: 'object', properties: { subject: { type: 'string', maxLength: 100 } }, required: ['subject'], additionalProperties: false }, agentIds: [agent.id], responsePaths: { ticketId: '/id' } });
  const call = { id: 'integration-call', name: `integration_${action.id.replaceAll('-', '')}`, arguments: '{"subject":"Pedido de teste"}' };
  let deliveries = 0;
  const transport: IntegrationTransport = { resolve: async () => [{ address: '93.184.216.34', family: 4 }], request: async (_url, _address, spec) => { deliveries++; assert.equal(spec.body?.toString(), '{"subject":"Pedido de teste"}'); return { status: 202, headers: {}, body: Buffer.from('{"id":"ticket-fixture"}') }; } };
  t.after(() => { store.close(); if (previous === undefined) delete process.env.OAUTH_ENCRYPTION_KEY; else process.env.OAUTH_ENCRYPTION_KEY = previous; });
  return { store, context, action, call, transport, deliveries: () => deliveries };
}

test('registered actions expose only bound schema and execute with durable result, never arbitrary destinations', async t => {
  const f = fixture(t); const tools = agentRuntimeTools(f.store, f.context);
  assert.equal(tools.length, 1); assert.equal(tools[0].name, f.call.name); assert.equal(tools[0].strict, false);
  assert.deepEqual(tools[0].parameters, f.action.argumentsSchema);
  const schema = JSON.stringify(tools); for (const secret of ['secret-path', 'private-credential', 'Authorization']) assert.ok(!schema.includes(secret));
  const invalid = await executeAgentTool(f.store, f.context, { ...f.call, id: 'bad', arguments: '{"subject":"Pedido de teste","url":"https://evil.test"}' }, { integrationTransport: f.transport });
  assert.equal(invalid.error, 'invalid_arguments'); assert.equal(f.deliveries(), 0);
  const first = await executeAgentTool(f.store, f.context, f.call, { integrationTransport: f.transport });
  assert.equal(first.ok, true); assert.equal(first.outcome, 'endpoint_acknowledged'); assert.equal(first.workflowCompletion, 'not_verified'); assert.deepEqual(first.data, { ticketId: 'ticket-fixture' });
  assert.deepEqual(await executeAgentTool(f.store, f.context, f.call, { integrationTransport: f.transport }), first); assert.equal(f.deliveries(), 1);
});

test('anonymous, unassigned, disabled, revised or revoked action capabilities cannot reuse cached integrations', async t => {
  const f = fixture(t);
  assert.deepEqual(agentRuntimeTools(f.store, { ...f.context, trustedOperator: false }), []);
  assert.equal((await executeAgentTool(f.store, { ...f.context, trustedOperator: false }, f.call, { integrationTransport: f.transport })).error, 'tool_not_enabled');
  assert.equal((await executeAgentTool(f.store, f.context, f.call, { integrationTransport: f.transport })).ok, true);
  f.store.update('tenant-a', 'integration-actions', f.action.id, { enabled: false });
  assert.equal((await executeAgentTool(f.store, f.context, f.call, { integrationTransport: f.transport })).error, 'tool_not_enabled');
  f.store.update('tenant-a', 'integration-actions', f.action.id, { enabled: true, agentIds: [] });
  assert.equal((await executeAgentTool(f.store, f.context, f.call, { integrationTransport: f.transport })).error, 'tool_not_enabled');
  f.store.update('tenant-a', 'integration-actions', f.action.id, { agentIds: [f.context.agent.id], revision: 2 });
  assert.equal((await executeAgentTool(f.store, f.context, f.call, { integrationTransport: f.transport })).error, 'tool_call_id_conflict');
  f.store.db.prepare('DELETE FROM sessions').run();
  assert.equal((await executeAgentTool(f.store, f.context, f.call, { integrationTransport: f.transport })).error, 'operator_session_revoked');
  assert.equal(f.deliveries(), 1);
});

test('another valid operator cannot read the original operator cached integration result', async t => {
  const f = fixture(t); await executeAgentTool(f.store, f.context, f.call, { integrationTransport: f.transport });
  f.store.db.prepare('INSERT INTO users VALUES(?,?,?,?,?)').run('other', 'tenant-a', 'other@example.test', 'unused', 'owner');
  f.store.db.prepare('INSERT INTO sessions(hash,user_id,expires) VALUES(?,?,?)').run('other-hash', 'other', Date.now() + 60000);
  seedMemberships(f.store);
  const result = await executeAgentTool(f.store, { ...f.context, actor: { userId: 'other', tenantId: 'tenant-a', role: 'owner' }, operatorSessionHash: 'other-hash' }, f.call, { integrationTransport: f.transport });
  assert.equal(result.error, 'tool_call_operator_conflict'); assert.equal(f.deliveries(), 1);
});

test('revocation while an authorized request is in flight suppresses its result without erasing the audit outcome', async t => {
  const f = fixture(t);
  const transport: IntegrationTransport = { ...f.transport, request: async () => {
    f.store.db.prepare('DELETE FROM sessions').run();
    return { status: 202, headers: {}, body: Buffer.from('{"id":"private-result"}') };
  } };
  const result = await executeAgentTool(f.store, f.context, f.call, { integrationTransport: transport });
  assert.deepEqual(result, { ok: false, error: 'operator_session_revoked' });
  assert.equal(f.store.list('tenant-a', 'integration-operations')[0].status, 'endpoint_acknowledged');
  assert.equal(f.store.list('tenant-a', 'agent-tool-calls')[0].status, 'succeeded');
});
