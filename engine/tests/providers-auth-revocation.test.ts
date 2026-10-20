import assert from 'node:assert/strict';
import { test } from 'node:test';
import { executeAgentTool, operatorAuthorized, type AgentContext } from '../src/providers/agent-tools.js';
import { Store } from '../src/store.js';
import { seedMemberships, seedMember } from './fixtures/membership.js';
import { selectOrganizationForSession } from '../src/memberships/service.js';

function fixture() {
  const store = new Store();
  store.db.prepare('INSERT INTO users(id,tenant_id,email,password,role) VALUES(?,?,?,?,?)').run('operator', 'tenant-a', 'operator@example.test', 'unused-password', 'admin');
  store.db.prepare('INSERT INTO sessions(hash,user_id,expires) VALUES(?,?,?)').run('session-hash', 'operator', Date.now() + 60_000);
  seedMemberships(store);
  const agent = store.create('tenant-a', 'agents', { name: 'CRM', tools: ['lookup_contact'] });
  const contact = store.create('tenant-a', 'contacts', { name: 'Private contact', email: 'private@example.test' });
  const context: AgentContext = { tenantId: 'tenant-a', conversationId: 'conversation-a', agent, trustedOperator: true, actor: { userId: 'operator', tenantId: 'tenant-a', role: 'admin' }, operatorSessionHash: 'session-hash' };
  const call = { id: 'lookup-1', name: 'lookup_contact', arguments: JSON.stringify({ emailOrPhone: contact.email }) };
  return { store, context, call, contact };
}

test('trustedOperator cannot grant CRM access without a current database user and session', async () => {
  const { store, context, call } = fixture();
  try {
    for (const modified of [
      { ...context, actor: { ...context.actor!, userId: 'removed-user' } },
      { ...context, operatorSessionHash: undefined },
      { ...context, operatorSessionHash: 'nonexistent-session' },
      { ...context, actor: undefined },
      { ...context, actor: { ...context.actor!, tenantId: 'tenant-b' } },
      { ...context, tenantId: 'tenant-b' },
    ]) assert.deepEqual(await executeAgentTool(store, modified, call), { ok: false, error: 'operator_session_revoked' });
    assert.equal(store.list('tenant-a', 'agent-tool-calls').length, 0);
  } finally { store.close(); }
});

test('cached CRM results stop being readable as soon as the originating session is revoked', async () => {
  const { store, context, call, contact } = fixture();
  try {
    const success = await executeAgentTool(store, context, call);
    assert.equal(success.ok, true);
    assert.equal((success.contacts as { id: string }[])[0].id, contact.id);
    assert.equal(store.list('tenant-a', 'agent-tool-calls').length, 1);
    store.db.prepare('DELETE FROM sessions WHERE hash=?').run('session-hash');
    assert.deepEqual(await executeAgentTool(store, context, call), { ok: false, error: 'operator_session_revoked' });
    assert.deepEqual(await executeAgentTool(store, context, { ...call, id: 'lookup-2' }), { ok: false, error: 'operator_session_revoked' });
    assert.equal(store.list('tenant-a', 'agent-tool-calls').length, 1);
  } finally { store.close(); }
});

test('expired sessions, removed users and changed roles invalidate previously authorized tool contexts', async () => {
  for (const revoke of [
    (store: Store) => store.db.prepare('UPDATE sessions SET expires=?').run(Date.now() - 1),
    (store: Store) => store.db.prepare('UPDATE memberships SET role=? WHERE user_id=?').run('member', 'operator'),
    (store: Store) => store.db.prepare('UPDATE memberships SET role=? WHERE user_id=?').run('owner', 'operator'),
    (store: Store) => { store.db.prepare('DELETE FROM sessions WHERE user_id=?').run('operator'); store.db.prepare('DELETE FROM memberships WHERE user_id=?').run('operator'); store.db.prepare('DELETE FROM users WHERE id=?').run('operator'); },
  ]) {
    const { store, context, call } = fixture();
    try {
      assert.equal((await executeAgentTool(store, context, call)).ok, true);
      revoke(store);
      assert.deepEqual(await executeAgentTool(store, context, call), { ok: false, error: 'operator_session_revoked' });
    } finally { store.close(); }
  }
});

test('another operator session and untrusted visitor cannot read cached operator CRM results', async () => {
  const { store, context, call } = fixture();
  try {
    assert.equal((await executeAgentTool(store, context, call)).ok, true);
    store.db.prepare('INSERT INTO users(id,tenant_id,email,password,role) VALUES(?,?,?,?,?)').run('other', 'tenant-a', 'other@example.test', 'unused-password', 'admin');
    store.db.prepare('INSERT INTO sessions(hash,user_id,expires) VALUES(?,?,?)').run('other-session', 'other', Date.now() + 60_000);
    seedMemberships(store);
    assert.deepEqual(await executeAgentTool(store, { ...context, operatorSessionHash: 'other-session' }, call), { ok: false, error: 'operator_session_revoked' });
    assert.deepEqual(await executeAgentTool(store, { ...context, trustedOperator: false }, call), { ok: false, error: 'tool_not_enabled' });
  } finally { store.close(); }
});

test('organization switch rotates the original session and cannot reuse its old organization tool capability', async () => {
  const { store, context, call } = fixture();
  try {
    seedMember(store, { userId: 'operator', tenantId: 'tenant-b', role: 'owner' });
    assert.equal((await executeAgentTool(store, context, call)).ok, true);
    const nextHash = 'b'.repeat(64);
    const next = selectOrganizationForSession(store, 'session-hash', 'tenant-b', nextHash);
    assert.equal(next.tenantId, 'tenant-b'); assert.equal(next.role, 'owner');
    assert.equal(operatorAuthorized(store, context), false);
    assert.deepEqual(await executeAgentTool(store, context, call), { ok: false, error: 'operator_session_revoked' });
    assert.equal(operatorAuthorized(store, { ...context, operatorSessionHash: nextHash }), false);
    assert.equal(operatorAuthorized(store, { ...context, tenantId: 'tenant-b', actor: next, operatorSessionHash: nextHash }), true);
  } finally { store.close(); }
});

test('membership is authoritative even when legacy users.role disagrees, and removing it revokes cached access', async () => {
  const { store, context, call } = fixture();
  try {
    store.db.prepare('UPDATE users SET role=? WHERE id=?').run('viewer', 'operator');
    assert.equal((await executeAgentTool(store, context, call)).ok, true);
    store.db.prepare('DELETE FROM memberships WHERE user_id=? AND tenant_id=?').run('operator', 'tenant-a');
    assert.deepEqual(await executeAgentTool(store, context, call), { ok: false, error: 'operator_session_revoked' });
  } finally { store.close(); }
});
