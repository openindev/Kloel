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
  app.addHook('preHandler', async request => { if (!request.headers['x-anonymous']) request.actor = actor; });
  await registerConversationControl(app, store);
  const conversation = store.create('own', 'conversations', { subject: 'Original', channel: 'webchat', status: 'open', tags: ['keep'] });
  const path = '/api/v1/conversations/' + conversation.id;
  t.after(async () => { await app.close(); store.close(); });
  return { store, app, actor, conversation, path };
}
test('conversation control rejects stale edits after a worker changes data and preserves untouched fields', async t => {
  const f = await fixture(t), initial = (await f.app.inject(f.path + '/control')).json();
  f.store.update('own', 'conversations', f.conversation.id, { tags: ['keep', 'no_ai'] });
  const stale = await f.app.inject({ method: 'PATCH', url: f.path + '/control', payload: { expectedVersion: initial.version, subject: 'Lost update' } });
  assert.equal(stale.statusCode, 409); assert.equal(stale.json().error.code, 'conversation_changed');
  const fresh = (await f.app.inject(f.path + '/control')).json();
  const changed = await f.app.inject({ method: 'PATCH', url: f.path + '/control', payload: { expectedVersion: fresh.version, status: 'pending' } });
  assert.equal(changed.statusCode, 200); assert.equal(changed.json().conversation.subject, 'Original'); assert.deepEqual(changed.json().conversation.tags, ['keep', 'no_ai']);
  assert.notEqual(changed.json().version, fresh.version);
  assert.equal((await f.app.inject({ method: 'PATCH', url: f.path + '/control', payload: { expectedVersion: changed.json().version, tenantId: 'foreign' } })).statusCode, 400);
});
test('internal notes are idempotent, never outbound messages, and reject changed payloads or closed conversations', async t => {
  const f = await fixture(t), payload = { content: 'Nota interna sintética', idempotencyKey: randomUUID() };
  const create = () => f.app.inject({ method: 'POST', url: f.path + '/notes', payload });
  const first = await create(); assert.equal(first.statusCode, 200); assert.equal(first.json().message.role, 'system'); assert.equal(first.json().message.kind, 'internal_note'); assert.equal(first.json().message.deliveryStatus, 'recorded');
  const replay = await create(); assert.equal(replay.json().message.id, first.json().message.id); assert.equal(replay.json().replayed, true); assert.equal(f.store.list('own', 'messages').length, 1);
  assert.equal((await f.app.inject({ method: 'POST', url: f.path + '/notes', payload: { ...payload, content: 'Changed' } })).statusCode, 409);
  f.store.update('own', 'conversations', f.conversation.id, { status: 'closed' });
  assert.equal((await create()).json().replayed, true);
  assert.equal((await f.app.inject({ method: 'POST', url: f.path + '/notes', payload: { ...payload, idempotencyKey: randomUUID() } })).statusCode, 409);
  assert.equal(f.store.list('own', 'reply-jobs').length, 0); assert.equal(f.store.list('own', 'provider-operations').length, 0);
});
test('conversation controls enforce membership, read/write permissions and tenant isolation', async t => {
  const f = await fixture(t), foreign = f.store.create('other', 'conversations', { channel: 'webchat', status: 'open' });
  assert.equal((await f.app.inject({ url: f.path + '/control', headers: { 'x-anonymous': '1' } })).statusCode, 401);
  assert.equal((await f.app.inject('/api/v1/conversations/' + foreign.id + '/control')).statusCode, 404);
  f.store.db.prepare('UPDATE memberships SET role=? WHERE tenant_id=? AND user_id=?').run('viewer', 'own', 'operator');
  const control = await f.app.inject(f.path + '/control'); assert.equal(control.statusCode, 200);
  assert.equal((await f.app.inject({ method: 'PATCH', url: f.path + '/control', payload: { expectedVersion: control.json().version, status: 'closed' } })).statusCode, 403);
  assert.equal((await f.app.inject({ method: 'POST', url: f.path + '/notes', payload: { content: 'Denied', idempotencyKey: randomUUID() } })).statusCode, 403);
  f.store.db.prepare('DELETE FROM memberships WHERE tenant_id=? AND user_id=?').run('own', 'operator');
  assert.equal((await f.app.inject(f.path + '/control')).statusCode, 401);
});
