import test from 'node:test';
import assert from 'node:assert/strict';
import { beforeVoiceFixture, untilBefore } from './fixtures/before-voice.js';

const diagnostic = { code: 'unknown_parameter', type: 'invalid_request_error', param: 'session.audio.input.turn_detection' };
const privateText = 'DO_NOT_PERSIST synthetic-token https://private.invalid/path?secret=synthetic';
const event = () => ({ type: 'error', event_id: 'event_synthetic', error: { ...diagnostic, event_id: 'request_synthetic', message: privateText, data: { token: privateText } }, data: privateText });

test('error before session ACK survives barrier block, hangup and original GET without raw provider content', async t => {
  const f = await beforeVoiceFixture(t, { autoAck: false }); await f.enable();
  const foreign = f.store.create('foreign-tenant', 'voice-sessions', { callId: 'call_before_fixture', lastError: 'foreign_unchanged' });
  const body = f.startBody(), pending = f.start(body); await untilBefore(() => f.sockets[0]?.sent.length > 0);
  f.sockets[0].receive(event());
  const response = await pending; assert.equal(response.statusCode, 200, response.body);
  await untilBefore(() => f.store.list(f.actor.tenantId, 'voice-sessions')[0]?.controlStatus === 'closed');
  const session = f.store.list(f.actor.tenantId, 'voice-sessions')[0];
  assert.equal(session.providerErrorCode, diagnostic.code);
  assert.equal(session.providerErrorType, diagnostic.type);
  assert.equal(session.providerErrorParam, diagnostic.param);
  assert.equal(session.lastError, 'realtime_server_error');
  assert.equal(new Date(String(session.lastErrorAt)).toISOString(), session.lastErrorAt);
  assert.equal(session.hangupStatus, 'accepted');
  assert.equal(f.sockets[0].sent.filter(e => e.type === 'response.create').length, 0);
  assert.equal(f.store.list(f.actor.tenantId, 'messages').length, 0);
  assert.equal(f.requests.filter(r => r.url.endsWith('/hangup')).length, 1);
  const before = f.requests.length, receipt = (await f.get(body.idempotencyKey)).json();
  assert.equal(receipt.beforeContext.mediaStage, 'blocked');
  assert.equal(receipt.beforeContext.greetingStatus, 'not_requested');
  assert.equal(f.requests.length, before);
  assert.equal(JSON.stringify(f.store.db.prepare('SELECT body FROM entities').all()).includes(privateText), false);
  assert.deepEqual(f.store.get('foreign-tenant', 'voice-sessions', foreign.id), foreign);
});

test('queued provider error is retained when the socket closes before its serialized handler runs', async t => {
  const f = await beforeVoiceFixture(t, { autoAck: false }); await f.enable();
  const pending = f.start(); await untilBefore(() => f.sockets[0]?.sent.length > 0);
  f.sockets[0].receive(event()); f.sockets[0].close();
  await pending; await untilBefore(() => f.store.list(f.actor.tenantId, 'voice-sessions')[0]?.controlStatus === 'closed');
  const session = f.store.list(f.actor.tenantId, 'voice-sessions')[0];
  assert.equal(session.providerErrorCode, diagnostic.code);
  assert.equal(session.providerErrorType, diagnostic.type);
  assert.equal(session.providerErrorParam, diagnostic.param);
  assert.equal(f.requests.filter(r => r.url.endsWith('/hangup')).length, 1);
  assert.equal(f.sockets[0].sent.filter(e => e.type === 'response.create').length, 0);
});

test('invalid diagnostic identifiers are omitted rather than retaining raw error fields', async t => {
  const f = await beforeVoiceFixture(t, { autoAck: false }); await f.enable();
  const pending = f.start(); await untilBefore(() => f.sockets[0]?.sent.length > 0);
  f.sockets[0].receive({ type: 'error', error: { code: privateText, type: privateText, param: privateText, message: privateText } });
  await pending; await untilBefore(() => f.store.list(f.actor.tenantId, 'voice-sessions')[0]?.controlStatus === 'closed');
  const session = f.store.list(f.actor.tenantId, 'voice-sessions')[0];
  assert.equal(session.lastError, 'realtime_server_error');
  for (const name of ['providerErrorCode', 'providerErrorType', 'providerErrorParam']) assert.equal(session[name], undefined);
  assert.equal(JSON.stringify(f.store.db.prepare('SELECT body FROM entities').all()).includes(privateText), false);
});

test('diagnostic observation cannot cross revoked original authority', async t => {
  const f = await beforeVoiceFixture(t, { autoAck: false }); await f.enable();
  const pending = f.start(); await untilBefore(() => f.sockets[0]?.sent.length > 0);
  f.store.db.prepare('DELETE FROM sessions WHERE hash=?').run(f.sessionHash);
  f.sockets[0].receive(event()); await pending;
  await untilBefore(() => f.store.list(f.actor.tenantId, 'voice-sessions')[0]?.controlStatus === 'closed');
  const session = f.store.list(f.actor.tenantId, 'voice-sessions')[0];
  for (const name of ['providerErrorCode', 'providerErrorType', 'providerErrorParam', 'lastErrorAt']) assert.equal(session[name], undefined);
  assert.equal(f.sockets[0].sent.filter(e => e.type === 'response.create').length, 0);
  assert.equal(f.requests.filter(r => r.url.endsWith('/hangup')).length, 1);
});
