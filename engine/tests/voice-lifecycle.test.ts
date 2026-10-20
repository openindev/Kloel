import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type WebSocket from 'ws';
import { Store } from '../src/store.js';
import { buildApp } from '../src/app.js';
import { RealtimeSidebands } from '../src/providers/realtime.js';
import { seedMember } from './fixtures/membership.js';

class Socket extends EventEmitter {
  readyState = 0; sent: unknown[] = [];
  constructor() { super(); queueMicrotask(() => { this.readyState = 1; this.emit('open'); }); }
  send(value: string) { this.sent.push(JSON.parse(value)); }
  close() { this.readyState = 3; this.emit('close'); }
  terminate() { this.close(); }
}
function fixture() {
  const store = new Store(); seedMember(store, { tenantId: 'lifecycle', userId: 'owner', role: 'owner' });
  const agent = store.create('lifecycle', 'agents', { status: 'active', tools: ['schedule_appointment'] });
  const conversation = store.create('lifecycle', 'conversations', { channel: 'phone', agentId: agent.id });
  const sockets: Socket[] = [];
  const sidebands = new RealtimeSidebands(store, () => { const socket = new Socket(); sockets.push(socket); return socket as unknown as WebSocket; });
  return { store, sidebands, sockets, context: { tenantId: 'lifecycle', agent, conversationId: conversation.id, trustedOperator: false } };
}
test('shutdown drains queued revocation and remote hangup before returning, without running a queued tool', async () => {
  const f = fixture(); const original = globalThis.fetch;
  let authorized = true, started = 0, completed = false, closed = false;
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  globalThis.fetch = (async () => { started++; await wait; completed = true; return new Response(null, { status: 200 }); }) as typeof fetch;
  try {
    await f.sidebands.connect('call_queued', 'test-secret', { ...f.context, liveAuthorization: () => authorized });
    authorized = false;
    f.sockets[0].emit('message', Buffer.from(JSON.stringify({ type: 'response.function_call_arguments.done', call_id: 'tool_queued', name: 'create_appointment', arguments: '{}' })));
    const closing = f.sidebands.close().then(() => { closed = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(started, 1); assert.equal(closed, false); assert.equal(completed, false);
    assert.equal(f.store.list('lifecycle', 'agent-tool-calls').length, 0);
    release(); await closing;
    assert.equal(completed, true); assert.equal(f.sockets[0].readyState, 3);
    assert.equal(f.store.list('lifecycle', 'voice-stop-operations')[0].status, 'accepted');
    assert.equal(f.store.list('lifecycle', 'voice-sessions')[0].callStatus, 'hangup_accepted');
    await f.sidebands.close(); assert.equal(started, 1);
  } finally { release(); await f.sidebands.close(); globalThis.fetch = original; f.store.close(); }
});
test('shutdown ends remote media for authorized calls and never silently reconnects after stopping', async () => {
  const f = fixture(); const original = globalThis.fetch; let stops = 0;
  globalThis.fetch = (async url => { assert.ok(String(url).endsWith('/hangup')); stops++; return new Response(null, { status: 200 }); }) as typeof fetch;
  try {
    await f.sidebands.connect('call_active', 'test-secret', f.context);
    await f.sidebands.close();
    assert.equal(stops, 1); assert.equal(f.store.list('lifecycle', 'voice-stop-operations')[0].reason, 'server_shutdown');
    await assert.rejects(() => f.sidebands.connect('call_active', 'test-secret', f.context));
    const reopened = new RealtimeSidebands(f.store, () => { throw new Error('must not reconnect'); });
    await assert.rejects(() => reopened.connect('call_active', 'test-secret', f.context), /voice_call_stopped/);
    assert.equal(await reopened.stopCall('call_active', 'test-secret', 'lifecycle', 'retry'), 'accepted');
    assert.equal(stops, 1); await reopened.close();
  } finally { await f.sidebands.close(); globalThis.fetch = original; f.store.close(); }
});
test('concurrent stop reasons share one attempt and uncertain outcomes remain locked', async () => {
  const f = fixture(); const original = globalThis.fetch; let count = 0;
  globalThis.fetch = (async () => { count++; await Promise.resolve(); throw new Error('synthetic network timeout'); }) as typeof fetch;
  try {
    const outcomes = await Promise.all([
      f.sidebands.stopCall('call_uncertain', 'test-secret', 'lifecycle', 'voice_route_revoked'),
      f.sidebands.stopCall('call_uncertain', 'test-secret', 'lifecycle', 'realtime_control_failed'),
    ]);
    assert.deepEqual(outcomes, ['unknown', 'unknown']); assert.equal(count, 1);
    assert.equal(await f.sidebands.stopCall('call_uncertain', 'test-secret', 'lifecycle', 'server_shutdown'), 'unknown');
    assert.equal(count, 1); assert.equal(f.store.list('lifecycle', 'voice-stop-operations').length, 1);
  } finally { await f.sidebands.close(); globalThis.fetch = original; f.store.close(); }
});
test('application lifecycle keeps SQLite open through provider draining and closes it last', async () => {
  const store = new Store(), original = RealtimeSidebands.prototype.close; let drained = false;
  RealtimeSidebands.prototype.close = async function () {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(store.db.prepare('SELECT 1 AS value').get()!.value, 1);
    await original.call(this); drained = true;
  };
  let app;
  try {
    app = await buildApp(store, { workers: false }); await app.ready(); await app.close();
    assert.equal(drained, true); assert.throws(() => store.db.prepare('SELECT 1'), /not open|closed/);
  } finally { RealtimeSidebands.prototype.close = original; if (app) await app.close(); else store.close(); }
});
