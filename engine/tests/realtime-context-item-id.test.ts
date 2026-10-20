import test from 'node:test';
import assert from 'node:assert/strict';
import { beforeVoiceFixture, untilBefore } from './fixtures/before-voice.js';
import { voiceOpenings } from '../src/before-context/voice.js';

const itemOf = (socket: { sent: Record<string, any>[] }) => socket.sent.find(e => e.type === 'conversation.item.create')?.item;

test('controlled provider rejects observed 35-character ID; full UUID hex passes preparation without implicit generation', async t => {
  const f = await beforeVoiceFixture(t, { autoAck: false }); await f.enable();
  // The real error identifies item.id as too long. Accepting 32 here is a conservative
  // mock contract, not a claim that OpenAI documents 32 as its maximum or accepted live.
  f.hooks.socket = socket => { socket.onSend = event => {
    if (event.type === 'session.update') queueMicrotask(() => socket.receive({ type: 'session.updated', session: { id: 'session_item_id', ...event.session } }));
    if (event.type === 'conversation.item.create') queueMicrotask(() => {
      if (/^[0-9a-f]{32}$/.test(event.item.id)) socket.receive({ type: 'conversation.item.done', item: { ...event.item, status: 'completed' } });
      else socket.receive({ type: 'error', error: { type: 'invalid_request_error', code: 'string_above_max_length', param: 'item.id', message: 'Synthetic transport rejection.' } });
    });
  }; };
  const body = f.startBody(), response = await f.start(body); assert.equal(response.statusCode, 200, response.body);
  const operation = response.json(), opening = f.store.list(f.actor.tenantId, voiceOpenings)[0], item = itemOf(f.sockets[0]);
  assert.ok(item);
  if (item.id.length === 35) {
    const session = f.store.list(f.actor.tenantId, 'voice-sessions')[0];
    assert.equal(session.providerErrorCode, 'string_above_max_length');
    assert.equal(session.providerErrorParam, 'item.id');
    assert.equal(operation.beforeContext.greetingStatus, 'not_requested');
  }
  assert.equal(operation.beforeContext.barrier, 'ready');
  assert.equal(item.id, opening.id.replaceAll('-', ''), 'preserve every UUID hex digit without prefix or truncation');
  assert.equal(item.id.length, 32);
  assert.equal(JSON.parse(item.content[0].text).openingId, opening.id);
  assert.equal(operation.beforeContext.mediaStage, 'blocked');
  assert.equal(f.sockets[0].sent.filter(e => e.type === 'response.create').length, 0);
  assert.equal(f.store.list(f.actor.tenantId, 'messages').length, 0);
  const before = f.requests.length;
  assert.equal((await f.get(body.idempotencyKey)).json().beforeContext.openingId, opening.id);
  assert.equal((await f.start(body)).json().requiresRecovery, true);
  assert.equal(f.requests.length, before); assert.equal(f.sockets.length, 1);
  const activated = await f.activate(body.idempotencyKey, opening.id); assert.equal(activated.statusCode, 200, activated.body);
  await f.activate(body.idempotencyKey, opening.id);
  assert.equal(f.sockets[0].sent.filter(e => e.type === 'response.create').length, 1);
  assert.equal(f.requests.filter(r => r.url.endsWith('/hangup')).length, 0);
});

test('a different 32-character item ACK cannot release the original barrier', async t => {
  const f = await beforeVoiceFixture(t, { autoAck: false }); await f.enable();
  const body = f.startBody(), pending = f.start(body); await untilBefore(() => f.sockets[0]?.sent.length > 0);
  const socket = f.sockets[0]; socket.receive({ type: 'session.updated', session: { id: 'session_item_fence', ...socket.sent[0].session } });
  await untilBefore(() => !!itemOf(socket)); const item = itemOf(socket);
  const wrongId = `${item.id[0] === 'a' ? 'b' : 'a'}${item.id.slice(1)}`;
  assert.equal(item.id.length, 32); assert.equal(wrongId.length, 32);
  socket.receive({ type: 'conversation.item.done', item: { ...item, id: wrongId, status: 'completed' } });
  const response = await pending; assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().beforeContext.reasonCode, 'voice_context_item_mismatch');
  assert.equal(socket.sent.filter(e => e.type === 'response.create').length, 0);
  assert.equal(f.requests.filter(r => r.url.endsWith('/hangup')).length, 1);
  const count = f.requests.length; await f.get(body.idempotencyKey); assert.equal(f.requests.length, count);
});

test('an exact item ACK after original authority revocation cannot admit playback or generation', async t => {
  const f = await beforeVoiceFixture(t, { autoAck: false }); await f.enable();
  const body = f.startBody(), pending = f.start(body); await untilBefore(() => f.sockets[0]?.sent.length > 0);
  const socket = f.sockets[0]; socket.receive({ type: 'session.updated', session: { id: 'session_item_revoked', ...socket.sent[0].session } });
  await untilBefore(() => !!itemOf(socket)); const item = itemOf(socket);
  assert.equal(item.id.length, 32);
  f.store.db.prepare('DELETE FROM sessions WHERE hash=?').run(f.sessionHash);
  socket.receive({ type: 'conversation.item.done', item: { ...item, status: 'completed' } });
  const response = await pending;
  assert.notEqual(response.json().beforeContext?.barrier, 'ready');
  assert.ok([401, 403, 404].includes((await f.get(body.idempotencyKey)).statusCode));
  assert.equal(socket.sent.filter(e => e.type === 'response.create').length, 0);
  assert.equal(f.requests.filter(r => r.url.endsWith('/hangup')).length, 1);
  assert.equal(f.store.list(f.actor.tenantId, 'messages').length, 0);
});
