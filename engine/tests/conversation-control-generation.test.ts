import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { Store } from '../src/store.js';
import { seedMember } from './fixtures/membership.js';
import { registerConversationControl } from '../src/conversation-control.js';

async function fixture(t: any) {
  const store = new Store(), app = Fastify();
  const actor = { userId: 'operator', tenantId: 'own', role: 'member' as const }; seedMember(store, actor);
  app.addHook('preHandler', async request => { request.actor = actor; });
  await registerConversationControl(app, store);
  const conversation = store.create('own', 'conversations', { subject: 'Original', channel: 'webchat', status: 'open', tags: [] });
  const path = '/api/v1/conversations/' + conversation.id;
  t.after(async () => { await app.close(); store.close(); });
  return { store, app, actor, conversation, path };
}

test('a control round trip cannot revive an old generation or CAS version even with a frozen clock', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 9, 18, 19, 30) });
  const f = await fixture(t), original = (await f.app.inject(f.path + '/control')).json();
  const pending = await f.app.inject({ method: 'PATCH', url: f.path + '/control', payload: { expectedVersion: original.version, status: 'pending', tags: ['human_handoff'] } });
  assert.equal(pending.statusCode, 200);
  const restored = await f.app.inject({ method: 'PATCH', url: f.path + '/control', payload: { expectedVersion: pending.json().version, status: 'open', tags: [] } });
  assert.equal(restored.statusCode, 200);
  assert.equal(restored.json().conversation.status, original.conversation.status);
  assert.deepEqual(restored.json().conversation.tags, original.conversation.tags);
  assert.equal(restored.json().conversation.updatedAt, original.conversation.updatedAt);
  assert.notEqual(restored.json().version, original.version);
  assert.ok(restored.json().conversation.replyRevision > pending.json().conversation.replyRevision);
  const stale = await f.app.inject({ method: 'PATCH', url: f.path + '/control', payload: { expectedVersion: original.version, subject: 'Obsolete request' } });
  assert.equal(stale.statusCode, 409);
  assert.equal(f.store.get('own', 'conversations', f.conversation.id)!.subject, 'Original');
});

test('control and note writes revalidate a membership revoked at the transaction boundary', async t => {
  for (const kind of ['control', 'notes'] as const) await t.test(kind, async child => {
    const f = await fixture(child), original = (await f.app.inject(f.path + '/control')).json();
    const transaction = f.store.transaction.bind(f.store); let revoked = false;
    f.store.transaction = callback => {
      if (!revoked) { revoked = true; f.store.db.prepare('DELETE FROM memberships WHERE tenant_id=? AND user_id=?').run('own', 'operator'); }
      return transaction(callback);
    };
    const response = await f.app.inject({ method: kind === 'control' ? 'PATCH' : 'POST', url: f.path + '/' + kind,
      payload: kind === 'control' ? { expectedVersion: original.version, status: 'pending' } : { content: 'Must not be recorded', idempotencyKey: randomUUID() } });
    assert.equal(response.statusCode, 401);
    assert.deepEqual(f.store.get('own', 'conversations', f.conversation.id), original.conversation);
    assert.equal(f.store.list('own', 'messages').length, 0);
  });
});
