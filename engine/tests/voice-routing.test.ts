import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import Fastify from 'fastify';
import type WebSocket from 'ws';
import twilio from 'twilio';
import { Store, type Entity } from '../src/store.js';
import { seedMember } from './fixtures/membership.js';
import { registerProviders } from '../src/providers.js';
import { routeSignedTwilioCall, resolveIncomingVoiceAgent, authorizeClaimedIncomingVoiceAgent } from '../src/providers/voice-routing.js';

const tenant = 'voice-tenant';
const config = {
  PROVIDER_TENANT_ID: tenant, TWILIO_ACCOUNT_SID: 'AC_voice_fixture', TWILIO_AUTH_TOKEN: 'voice-fixture-token',
  TWILIO_VOICE_WEBHOOK_URL: 'https://voice.example.test/api/v1/webhooks/twilio/voice',
  OPENAI_SIP_URI: 'sip:proj_voice_fixture@sip.api.openai.com;transport=tls',
  OPENAI_WEBHOOK_SECRET: `whsec_${Buffer.from('voice-webhook-test').toString('base64')}`,
  OPENAI_API_KEY: 'voice-openai-fixture', OAUTH_ENCRYPTION_KEY: Buffer.alloc(32, 91).toString('base64'),
  OPENAI_REALTIME_MODEL: 'voice-realtime-fixture',
};
const oldEnv = { ...process.env };
let store: Store;
beforeEach(() => {
  Object.assign(process.env, config); delete process.env.OPENAI_INBOUND_AGENT_ID;
  store = new Store(); seedMember(store, { tenantId: tenant, userId: 'voice-owner', role: 'owner' });
});
afterEach(() => {
  store.close();
  for (const key of [...Object.keys(config), 'OPENAI_INBOUND_AGENT_ID']) {
    if (oldEnv[key] === undefined) delete process.env[key]; else process.env[key] = oldEnv[key];
  }
});
function setup(number = '+5511999990001', withChannel = false) {
  const agent = store.create(tenant, 'agents', { name: `Agent ${number}`, status: 'active', prompt: `Serve ${number}`, voice: 'marin' });
  const channel = withChannel ? store.create(tenant, 'channels', { type: 'phone', provider: 'twilio', enabled: true, agentId: agent.id }) : undefined;
  const phone = store.create(tenant, 'phone-numbers', { name: number, number, provider: 'twilio', providerNumberId: `PN_${number.slice(1)}`, capabilities: ['voice'], agentId: agent.id, ...(channel ? { channelId: channel.id } : {}) });
  return { agent, phone, channel };
}
function issue(phone: Entity, sid = 'CA_voice_1', now = 1000) {
  return routeSignedTwilioCall(store, tenant, { Direction: 'inbound', To: String(phone.number), CallSid: sid }, config.OPENAI_SIP_URI, now);
}
function ticket(route: { sipUri: string }) { return new URLSearchParams(route.sipUri.split('?')[1]).get('x-kloel-route')!; }
function incoming(token: string, callId = 'call_one', now = 1001) {
  return resolveIncomingVoiceAgent(store, tenant, callId, [{ name: 'X-Kloel-Route', value: token }], now);
}

test('two configured numbers select their own agents; signed Twilio redelivery reuses a private encrypted ticket', () => {
  const first = setup(), second = setup('+5511999990002', true);
  const a = issue(first.phone), b = issue(second.phone, 'CA_voice_2');
  assert.notEqual(ticket(a), ticket(b));
  assert.deepEqual(issue(first.phone), a);
  assert.equal(incoming(ticket(a)).agentId, first.agent.id);
  assert.equal(incoming(ticket(b), 'call_two').agentId, second.agent.id);
  assert.deepEqual(incoming(ticket(a), 'call_one', 1000000), { agentId: first.agent.id, routingId: a.routingId });
  assert.equal(store.list(tenant, 'voice-routing-tickets').length, 2);
  const rows = JSON.stringify(store.db.prepare('SELECT body FROM entities').all());
  assert.ok(!rows.includes(ticket(a))); assert.ok(!rows.includes(ticket(b)));
  assert.match(String(store.list(tenant, 'voice-routing-tickets')[0].encryptedToken), /^v1\./);
});

test('forged, duplicate, expired and cross-call routing tokens fail closed', () => {
  const { phone } = setup(); const a = issue(phone);
  assert.throws(() => incoming('A'.repeat(43)), { code: 'voice_route_expired' });
  assert.throws(() => incoming('invalid'), { code: 'voice_route_invalid' });
  assert.throws(() => resolveIncomingVoiceAgent(store, tenant, 'call_one', [
    { name: 'X-Kloel-Route', value: ticket(a) }, { name: 'x-kloel-route', value: ticket(a) },
  ], 1001), { code: 'voice_route_invalid' });
  assert.throws(() => incoming(ticket(a), 'call_one', 601000), { code: 'voice_route_expired' });
  assert.equal(incoming(ticket(a)).agentId, a.agentId);
  assert.throws(() => incoming(ticket(a), 'call_two'), { code: 'voice_route_already_claimed' });
  assert.throws(() => issue(phone, 'CA_voice_1', 601000), { code: 'voice_route_expired' });
});

test('disabled channels, changed agent configuration, conflicting bindings and suspended organizations revoke the route', () => {
  const f = setup(undefined, true); const a = issue(f.phone);
  store.update(tenant, 'channels', f.channel!.id, { enabled: false });
  assert.throws(() => incoming(ticket(a)), { code: 'voice_channel_unavailable' });
  store.update(tenant, 'channels', f.channel!.id, { enabled: true });
  store.update(tenant, 'agents', f.agent.id, { prompt: 'Changed instructions' });
  assert.throws(() => incoming(ticket(a)), { code: 'voice_binding_changed' });
  store.update(tenant, 'agents', f.agent.id, { status: 'paused' });
  assert.throws(() => issue(f.phone, 'CA_paused'), { code: 'voice_agent_unavailable' });
  store.update(tenant, 'agents', f.agent.id, { status: 'active' });
  store.update(tenant, 'channels', f.channel!.id, { agentId: 'other-agent' });
  assert.throws(() => issue(f.phone, 'CA_conflict'), { code: 'voice_binding_conflict' });
  store.db.prepare("UPDATE organizations SET status='suspended' WHERE id=?").run(tenant);
  assert.throws(() => issue(f.phone, 'CA_suspended'), { code: 'voice_organization_unavailable' });
  assert.throws(() => incoming(ticket(a)), { code: 'voice_organization_unavailable' });
});

test('deleted, duplicate and cross-tenant configuration cannot select an agent', () => {
  const f = setup(); const a = issue(f.phone);
  store.remove(tenant, 'phone-numbers', f.phone.id);
  assert.throws(() => incoming(ticket(a)), { code: 'voice_number_unavailable' });
  const b = setup();
  store.create(tenant, 'phone-numbers', { ...b.phone, name: 'Duplicate' });
  assert.throws(() => issue(b.phone), { code: 'voice_binding_conflict' });
  seedMember(store, { tenantId: 'other-tenant', userId: 'other-owner', role: 'owner' });
  const other = store.create('other-tenant', 'agents', { status: 'active' });
  const p = store.create(tenant, 'phone-numbers', { number: '+5511999990003', provider: 'twilio', capabilities: ['voice'], agentId: other.id });
  assert.throws(() => issue(p), { code: 'voice_agent_unavailable' });
  assert.throws(() => resolveIncomingVoiceAgent(store, 'other-tenant', 'call_one', [], 1001), { code: 'voice_organization_unavailable' });
});

test('arbitrary SIP agent headers cannot choose authority; legacy unconfigured routes use only an explicit default', () => {
  const f = setup();
  assert.throws(() => resolveIncomingVoiceAgent(store, tenant, 'call_one', [{ name: 'X-Agent-Id', value: f.agent.id }]), { code: 'voice_default_agent_unconfigured' });
  process.env.OPENAI_INBOUND_AGENT_ID = 'server-configured-default';
  assert.deepEqual(resolveIncomingVoiceAgent(store, tenant, 'call_one', [{ name: 'X-Agent-Id', value: f.agent.id }]), { agentId: 'server-configured-default', routingId: null });
  assert.deepEqual(routeSignedTwilioCall(store, tenant, { Direction: 'outbound-api', To: String(f.phone.number), CallSid: 'CA_out' }, config.OPENAI_SIP_URI), { sipUri: config.OPENAI_SIP_URI, agentId: null, routingId: null });
  assert.deepEqual(routeSignedTwilioCall(store, tenant, { Direction: 'inbound', To: '+5511999999999', CallSid: 'CA_other' }, config.OPENAI_SIP_URI), { sipUri: config.OPENAI_SIP_URI, agentId: null, routingId: null });
});

test('private route and call binding survive SQLite reopen without issuing another token', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kloel-voice-route-'));
  try {
    store.close(); store = new Store(join(dir, 'voice.sqlite'));
    seedMember(store, { tenantId: tenant, userId: 'voice-owner', role: 'owner' });
    const f = setup(); const a = issue(f.phone); incoming(ticket(a));
    store.close(); store = new Store(join(dir, 'voice.sqlite'));
    assert.deepEqual(issue(f.phone), a);
    assert.equal(incoming(ticket(a)).agentId, f.agent.id);
    assert.throws(() => incoming(ticket(a), 'call_another'), { code: 'voice_route_already_claimed' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

class Socket extends EventEmitter {
  readyState = 0; sent: Record<string, any>[] = [];
  constructor() { super(); queueMicrotask(() => { this.readyState = 1; this.emit('open'); }); }
  send(value: string) { this.sent.push(JSON.parse(value)); }
  close() { this.readyState = 3; this.emit('close'); }
  terminate() { this.close(); }
}
test('signed Twilio → SIP ticket → signed OpenAI acceptance uses the number agent and deduplicates distinct deliveries', async () => {
  const f = setup(); const ignored = setup('+5511999990002');
  process.env.OPENAI_INBOUND_AGENT_ID = ignored.agent.id;
  const app = Fastify(); const upstream: { url: string; init: RequestInit }[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url, init = {}) => { upstream.push({ url: String(url), init }); return new Response(null, { status: 200 }); }) as typeof fetch;
  try {
    await registerProviders(app, store, { socketFactory: () => new Socket() as unknown as WebSocket });
    await app.ready();
    const params = { AccountSid: config.TWILIO_ACCOUNT_SID, CallSid: 'CA_integrated', From: '+5511999999999', To: String(f.phone.number), Direction: 'inbound' };
    const twilioArgs = { method: 'POST' as const, url: '/api/v1/webhooks/twilio/voice', payload: new URLSearchParams(params).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': twilio.getExpectedTwilioSignature(config.TWILIO_AUTH_TOKEN, config.TWILIO_VOICE_WEBHOOK_URL, params) } };
    const rejected = await app.inject({ ...twilioArgs, payload: twilioArgs.payload.replace('CA_integrated', 'CA_forged') });
    assert.equal(rejected.statusCode, 401); assert.equal(store.list(tenant, 'voice-routing-tickets').length, 0);
    const twiml = await app.inject(twilioArgs); assert.equal(twiml.statusCode, 200);
    assert.equal((await app.inject(twilioArgs)).body, twiml.body);
    const token = twiml.body.match(/x-kloel-route=([A-Za-z0-9_-]{43})/)?.[1]; assert.ok(token);
    const raw = JSON.stringify({ type: 'realtime.call.incoming', data: { call_id: 'call_integrated', sip_headers: [{ name: 'X-Kloel-Route', value: token }] } });
    const args = (eventId: string) => {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = createHmac('sha256', Buffer.from(config.OPENAI_WEBHOOK_SECRET.slice(6), 'base64')).update(`${eventId}.${timestamp}.${raw}`).digest('base64');
      return { method: 'POST' as const, url: '/api/v1/webhooks/openai', payload: raw, headers: { 'content-type': 'application/json', 'webhook-id': eventId, 'webhook-timestamp': timestamp, 'webhook-signature': `v1,${signature}` } };
    };
    assert.equal((await app.inject({ ...args('wh_bad'), payload: raw + ' ' })).statusCode, 401);
    assert.equal(upstream.length, 0);
    const accepted = await app.inject(args('wh_first'));
    assert.equal(accepted.statusCode, 200); assert.equal(accepted.json().accepted, true);
    assert.equal((await app.inject(args('wh_second'))).json().accepted, true);
    assert.equal(upstream.length, 1);
    const instructions = JSON.parse(String(upstream[0].init.body)).instructions;
    assert.ok(instructions.includes(f.agent.prompt)); assert.ok(!instructions.includes(ignored.agent.prompt));
    assert.equal(store.list(tenant, 'voice-sessions')[0].agentId, f.agent.id);
    assert.equal(store.list(tenant, 'calls').filter(row => row.provider === 'openai').length, 1);
  } finally { await app.close(); globalThis.fetch = originalFetch; }
});

async function incomingHarness(options: { socketFailure?: boolean; onAccept?: (fixture: ReturnType<typeof setup>) => void; beforeOpen?: (fixture: ReturnType<typeof setup>) => void; hangup?: () => Promise<Response> } = {}) {
  const fixture = setup(undefined, true), route = issue(fixture.phone, 'CA_security', Date.now());
  const app = Fastify(), sockets: Socket[] = [], requests: string[] = [];
  const oldFetch = globalThis.fetch;
  globalThis.fetch = (async (url) => {
    const target = String(url); requests.push(target);
    if (target.endsWith('/accept')) options.onAccept?.(fixture);
    if (target.endsWith('/hangup') && options.hangup) return options.hangup();
    return new Response(null, { status: 200 });
  }) as typeof fetch;
  await registerProviders(app, store, { socketFactory: () => {
    if (options.socketFailure) throw new Error('synthetic socket construction failure');
    if (options.beforeOpen) queueMicrotask(() => options.beforeOpen!(fixture));
    const socket = new Socket(); sockets.push(socket); return socket as unknown as WebSocket;
  } });
  await app.ready();
  const raw = JSON.stringify({ type: 'realtime.call.incoming', data: { call_id: 'call_security', sip_headers: [{ name: 'X-Kloel-Route', value: ticket(route) }] } });
  const send = () => {
    const eventId = 'wh_security', timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac('sha256', Buffer.from(config.OPENAI_WEBHOOK_SECRET.slice(6), 'base64')).update(`${eventId}.${timestamp}.${raw}`).digest('base64');
    return app.inject({ method: 'POST', url: '/api/v1/webhooks/openai', payload: raw, headers: { 'content-type': 'application/json', 'webhook-id': eventId, 'webhook-timestamp': timestamp, 'webhook-signature': `v1,${signature}` } });
  };
  return { ...fixture, app, sockets, requests, send, close: async () => { await app.close(); globalThis.fetch = oldFetch; } };
}
test('channel revoked during accept triggers compensating hangup, no sideband or duplicate acceptance', async () => {
  const f = await incomingHarness({ onAccept: f => { store.update(tenant, 'channels', f.channel!.id, { enabled: false }); } });
  try {
    const response = await f.send();
    assert.equal(response.statusCode, 403); assert.equal(response.json().error.code, 'voice_route_revoked');
    assert.deepEqual(f.requests.map(url => url.split('/').at(-1)), ['accept', 'hangup']);
    assert.equal(f.sockets.length, 0);
    const call = store.list(tenant, 'calls').find(row => row.provider === 'openai')!;
    assert.equal(call.status, 'hangup_requested'); assert.equal(call.hangupStatus, 'accepted');
    assert.equal((await f.send()).statusCode, 403); assert.equal(f.requests.length, 2);
  } finally { await f.close(); }
});
test('ambiguous compensation is persisted as unknown, never claimed as a completed hangup', async () => {
  const f = await incomingHarness({
    onAccept: f => { store.update(tenant, 'agents', f.agent.id, { status: 'paused' }); },
    hangup: async () => { throw new Error('synthetic timeout'); },
  });
  try {
    assert.equal((await f.send()).statusCode, 403);
    const call = store.list(tenant, 'calls').find(row => row.provider === 'openai')!;
    assert.equal(call.status, 'revoked_hangup_unconfirmed'); assert.equal(call.hangupStatus, 'unknown');
    assert.equal(store.list(tenant, 'provider-operations')[0].status, 'unknown');
    assert.equal(f.sockets.length, 0);
  } finally { await f.close(); }
});
test('revocation during sideband opening prevents greeting and sends a hangup', async () => {
  const f = await incomingHarness({ beforeOpen: f => { store.update(tenant, 'channels', f.channel!.id, { enabled: false }); } });
  try {
    const response = await f.send();
    assert.equal(response.json().sideband, 'failed');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.sockets[0].sent.length, 0); assert.equal(f.sockets[0].readyState, 3);
    assert.equal(f.requests.filter(url => url.endsWith('/hangup')).length, 1);
    assert.equal(store.list(tenant, 'voice-sessions')[0].securityStop, 'voice_route_revoked');
  } finally { await f.close(); }
});
test('quiet accepted call observes channel revocation without needing another socket event', async () => {
  const f = await incomingHarness();
  try {
    assert.equal((await f.send()).json().sideband, 'connected');
    const sent = f.sockets[0].sent.length;
    store.update(tenant, 'channels', f.channel!.id, { enabled: false });
    await new Promise(resolve => setTimeout(resolve, 1150));
    assert.equal(f.requests.filter(url => url.endsWith('/hangup')).length, 1);
    assert.equal(f.sockets[0].readyState, 3); assert.equal(f.sockets[0].sent.length, sent);
    const session = store.list(tenant, 'voice-sessions')[0];
    assert.equal(session.securityStop, 'voice_route_revoked'); assert.equal(session.callStatus, 'hangup_accepted');
  } finally { await f.close(); }
});

test('acceptance receipts from the old delivery-keyed build never dispatch a second external accept', async () => {
  const f = await incomingHarness();
  try {
    const { createHash } = await import('node:crypto');
    store.create(tenant, 'provider-operations', { operation: 'openai.accept', key: 'wh_old_delivery', fingerprint: createHash('sha256').update(JSON.stringify({ callId: 'call_security' })).digest('hex'), status: 'unknown' });
    const response = await f.send();
    assert.equal(response.statusCode, 409); assert.equal(response.json().error.code, 'voice_call_requires_reconciliation');
    assert.equal(f.requests.length, 0); assert.equal(f.sockets.length, 0);
  } finally { await f.close(); }
});
test('an accepted call without its matching receipt is locked instead of replayed', async () => {
  const f = await incomingHarness();
  try {
    store.create(tenant, 'calls', { provider: 'openai', providerCallId: 'call_security', agentId: f.agent.id, status: 'accepted' });
    assert.equal((await f.send()).json().error.code, 'voice_call_requires_reconciliation');
    assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

test('socket construction failure after acceptance ends media and replay cannot reconnect or repeat effects', async () => {
  const f = await incomingHarness({ socketFailure: true });
  try {
    const result = await f.send();
    assert.equal(result.statusCode, 200); assert.equal(result.json().sideband, 'failed'); assert.equal(result.json().hangupStatus, 'accepted');
    assert.deepEqual(f.requests.map(url => url.split('/').at(-1)), ['accept', 'hangup']);
    const replay = await f.send(); assert.equal(replay.json().sideband, 'stopped'); assert.equal(f.requests.length, 2);
    assert.equal(store.list(tenant, 'calls')[0].status, 'hangup_requested');
  } finally { await f.close(); }
});

test('live claimed-route authorization is read-only inside an ingress transaction and rejects replay or revocation', () => {
  const f = setup(undefined, true), issued = issue(f.phone);
  const unclaimed = { agentId: f.agent.id, routingId: issued.routingId };
  assert.throws(() => authorizeClaimedIncomingVoiceAgent(store, tenant, 'call_one', unclaimed), { code: 'voice_route_not_claimed' });
  const claimed = incoming(ticket(issued));
  const before = JSON.stringify(store.list(tenant, 'voice-routing-tickets'));
  assert.deepEqual(store.transaction(() => authorizeClaimedIncomingVoiceAgent(store, tenant, 'call_one', claimed)), claimed);
  assert.equal(JSON.stringify(store.list(tenant, 'voice-routing-tickets')), before);
  assert.throws(() => authorizeClaimedIncomingVoiceAgent(store, tenant, 'call_other', claimed), { code: 'voice_route_not_claimed' });
  store.update(tenant, 'channels', f.channel!.id, { enabled: false });
  assert.throws(() => authorizeClaimedIncomingVoiceAgent(store, tenant, 'call_one', claimed), { code: 'voice_channel_unavailable' });
  process.env.OPENAI_INBOUND_AGENT_ID = f.agent.id;
  const defaultRoute = { agentId: f.agent.id, routingId: null };
  assert.deepEqual(store.transaction(() => authorizeClaimedIncomingVoiceAgent(store, tenant, 'default_call', defaultRoute)), defaultRoute);
  delete process.env.OPENAI_INBOUND_AGENT_ID;
  assert.throws(() => authorizeClaimedIncomingVoiceAgent(store, tenant, 'default_call', defaultRoute), { code: 'voice_default_agent_changed' });
});
