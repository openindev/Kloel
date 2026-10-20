import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import type WebSocket from 'ws';
import twilio from 'twilio';
import { Store } from '../src/store.js';
import { registerAuth } from '../src/auth.js';
import { registerProviders } from '../src/providers.js';
import { registerPublicChat } from '../src/public-chat.js';
import { registerCRM } from '../src/crm.js';
import { registerCRMCapture } from '../src/crm-capture.js';
import { activateCapture, initializeCRMCapture } from '../src/crm/capture/authority.js';
import { saveSettings, getSettings } from '../src/crm/service.js';
import { CRMCaptureWorker } from '../src/crm/capture/worker.js';
import { applyCaptureProposal } from '../src/crm/capture/proposals.js';
import { jobs, proposals } from '../src/crm/capture/schema.js';
import { seedMember } from './fixtures/membership.js';

class Socket extends EventEmitter {
  readyState = 0; sent: any[] = [];
  constructor() { super(); queueMicrotask(() => { this.readyState = 1; this.emit('open'); }); }
  send(body: string) { this.sent.push(JSON.parse(body)); }
  close() { this.readyState = 3; this.emit('close'); }
  terminate() { this.close(); }
}
const text = 'Meu nome é Ana Silva, meu email é ana@example.test.';
const origin = 'https://capture-customer.example.test';
async function fixture(t: any, type: 'webchat' | 'whatsapp' | 'phone') {
  const previousEnv = { ...process.env }, previousFetch = globalThis.fetch, tenant = 'capture-ingress';
  const config = { PROVIDER_TENANT_ID: tenant, OPENAI_API_KEY: 'fixture-only', OPENAI_MODEL: 'fixture-model', OAUTH_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString('base64'), META_APP_SECRET: 'meta-fixture-secret', META_PHONE_NUMBER_ID: '123456789', META_GRAPH_VERSION: 'v23.0', TWILIO_ACCOUNT_SID: 'AC_capture_fixture', TWILIO_AUTH_TOKEN: 'twilio-fixture', TWILIO_VOICE_WEBHOOK_URL: 'https://voice.example.test/api/v1/webhooks/twilio/voice', OPENAI_SIP_URI: 'sip:proj_capture@sip.api.openai.com;transport=tls', OPENAI_WEBHOOK_SECRET: `whsec_${Buffer.from('capture-webhook').toString('base64')}`, OPENAI_REALTIME_MODEL: 'fixture-realtime' };
  Object.assign(process.env, config); delete process.env.OPENAI_INBOUND_AGENT_ID;
  const store = new Store(), app = Fastify(), actor = { userId: 'capture-ingress-owner', tenantId: tenant, role: 'owner' as const }; seedMember(store, actor);
  const sessionHash = createHash('sha256').update('capture-ingress-cookie').digest('hex'); store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(sessionHash, actor.userId, tenant, Date.now() + 86400000);
  initializeCRMCapture(store); saveSettings(store, tenant, { autoCapture: true, definitions: [] }, 0, actor.userId);
  const agent = store.create(tenant, 'agents', { name: 'Ingress Agent', status: 'active', prompt: 'Assist.', voice: 'marin', tools: [] });
  const channel = store.create(tenant, 'channels', { type, provider: type === 'whatsapp' ? 'meta' : type === 'phone' ? 'twilio' : 'openai', enabled: true, agentId: agent.id, configuration: { externalId: config.META_PHONE_NUMBER_ID, allowedOrigins: [origin] } });
  const sockets: Socket[] = []; let generations = 0;
  const extraction = async (_url: unknown, init?: RequestInit) => {
    generations++; const body = JSON.parse(String(init?.body)), input = JSON.parse(body.input), source = input.sources.at(-1);
    const span = (value: string) => ({ sourceEventId: source.id, start: source.text.indexOf(value), end: source.text.indexOf(value) + value.length, quote: value });
    const result = { candidate: 'person', subject: 'current_participant', gate: { satisfied: true, evidence: [span('Ana Silva')] }, values: [{ fieldId: 'firstName', value: 'Ana', evidence: [span('Ana')] }, { fieldId: 'lastName', value: 'Silva', evidence: [span('Silva')] }], identityClaims: [{ kind: 'email', value: 'ana@example.test', evidence: [span('ana@example.test')] }] };
    return Response.json({ id: 'capture-mock-response', status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(result) }] }], usage: { input_tokens: 40, output_tokens: 40 } });
  };
  globalThis.fetch = (async url => String(url).includes('/realtime/') ? new Response(null, { status: 200 }) : Response.json({ id: 'chat-mock', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Obrigado.' }] }] })) as typeof fetch;
  const worker = new CRMCaptureWorker(store, { fetch: extraction as typeof fetch });
  await app.register(cookie); await registerAuth(app, store); await registerCRM(app, store); await registerCRMCapture(app, store, worker);
  await registerProviders(app, store, { socketFactory: () => { const socket = new Socket(); sockets.push(socket); return socket as unknown as WebSocket; } }); await registerPublicChat(app, store);
  t.after(async () => { await app.close(); store.close(); globalThis.fetch = previousFetch; for (const key of [...Object.keys(config), 'OPENAI_INBOUND_AGENT_ID']) if (previousEnv[key] === undefined) delete process.env[key]; else process.env[key] = previousEnv[key]; });
  function activate(mode = 'review', activationTime = Date.now() - 5000) { return activateCapture(store, actor, sessionHash, { mode, optIn: true, captureContacts: true, channelIds: [channel.id], reservedTokensPerDay: 1000000 }, getSettings(store, tenant).revision, null, null, activationTime); }
  const eventCount = () => Number(store.db.prepare('SELECT count(*) AS n FROM crm_source_events').get()!.n);
  async function visitor() { const response = await app.inject({ method: 'POST', url: `/api/v1/public/chat/sessions?tenantId=${tenant}&channelId=${channel.id}`, headers: { origin }, payload: {} }); assert.equal(response.statusCode, 201, response.body); return response.json().token; }
  const chat = (token: string, key = randomUUID()) => app.inject({ method: 'POST', url: `/api/v1/public/chat/messages?tenantId=${tenant}&channelId=${channel.id}`, headers: { origin, authorization: `Bearer ${token}` }, payload: { message: text, idempotencyKey: key } });
  function meta(id = randomUUID(), signature = true, from = '5511999990000') {
    const payload = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: { metadata: { phone_number_id: config.META_PHONE_NUMBER_ID }, messages: [{ id, from, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text } }] } }] }] });
    return { method: 'POST' as const, url: '/api/v1/webhooks/meta', payload, headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature ? `sha256=${createHmac('sha256', config.META_APP_SECRET).update(payload).digest('hex')}` : 'sha256=bad' } };
  }
  async function voice() {
    const number = store.create(tenant, 'phone-numbers', { number: '+551132345678', provider: 'twilio', providerNumberId: 'PN_capture', capabilities: ['voice'], agentId: agent.id, channelId: channel.id });
    const params = { AccountSid: config.TWILIO_ACCOUNT_SID, CallSid: `CA_${randomUUID()}`, From: '+5511999990000', To: String(number.number), Direction: 'inbound' };
    const twiml = await app.inject({ method: 'POST', url: '/api/v1/webhooks/twilio/voice', payload: new URLSearchParams(params).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': twilio.getExpectedTwilioSignature(config.TWILIO_AUTH_TOKEN, config.TWILIO_VOICE_WEBHOOK_URL, params) } }); assert.equal(twiml.statusCode, 200, twiml.body);
    const token = twiml.body.match(/x-kloel-route=([A-Za-z0-9_-]{43})/)?.[1]; assert.ok(token);
    const eventId = randomUUID(), timestamp = String(Math.floor(Date.now() / 1000)), raw = JSON.stringify({ type: 'realtime.call.incoming', data: { call_id: `call_${eventId}`, sip_headers: [{ name: 'X-Kloel-Route', value: token }] } });
    const signature = createHmac('sha256', Buffer.from(config.OPENAI_WEBHOOK_SECRET.slice(6), 'base64')).update(`${eventId}.${timestamp}.${raw}`).digest('base64');
    const accepted = await app.inject({ method: 'POST', url: '/api/v1/webhooks/openai', payload: raw, headers: { 'content-type': 'application/json', 'webhook-id': eventId, 'webhook-timestamp': timestamp, 'webhook-signature': `v1,${signature}` } }); assert.equal(accepted.statusCode, 200, accepted.body); assert.equal(accepted.json().sideband, 'connected');
    return { socket: sockets.at(-1)!, conversation: store.list(tenant, 'conversations').at(-1)! };
  }
  return { store, app, actor, sessionHash, tenant, agent, channel, worker, activate, eventCount, visitor, chat, meta, voice, generations: () => generations };
}
const flush = async () => { await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)); };

test('visitor chat through authenticated route creates journal, real proposal and reviewed contact, with ingress dedup', async t => {
  const f = await fixture(t, 'webchat'); f.activate(); const visitor = await f.visitor(), key = randomUUID();
  assert.equal((await f.chat(visitor, key)).statusCode, 200); assert.equal((await f.chat(visitor, key)).statusCode, 200); assert.equal(f.eventCount(), 1);
  await f.worker.tick(); assert.equal(f.generations(), 1); assert.equal(f.store.list(f.tenant, 'contacts').length, 0);
  const proposal = f.store.list(f.tenant, proposals)[0]; const result = applyCaptureProposal(f.store, f.tenant, proposal.id, { kind: 'human', input: { actor: f.actor, sessionHash: f.sessionHash, key: 'ingress-review', proposalRevision: 1, contactRevision: null } });
  assert.equal(f.store.get(f.tenant, 'contacts', result.contactId)?.email, 'ana@example.test'); assert.equal(f.store.list(f.tenant, 'contact-permission-events').length, 0);
});

test('chat without capture grant or encryption key still works and does not retain duplicate source data', async t => {
  const f = await fixture(t, 'webchat'); delete process.env.OAUTH_ENCRYPTION_KEY; const visitor = await f.visitor(); assert.equal((await f.chat(visitor)).statusCode, 200); assert.equal(f.eventCount(), 0); assert.equal(f.store.list(f.tenant, jobs).length, 0);
});

test('journal failure in public chat rolls back operation, counter and message before any provider request', async t => {
  const f = await fixture(t, 'webchat'); f.activate(); const visitor = await f.visitor(); const create = f.store.create.bind(f.store);
  f.store.create = ((tenant, collection, data) => { if (collection === jobs) throw new Error('Injected journal failure'); return create(tenant, collection, data); }) as typeof f.store.create;
  const response = await f.chat(visitor); assert.equal(response.statusCode, 502, response.body); assert.equal(f.eventCount(), 0); assert.equal(f.store.list(f.tenant, 'messages').length, 0); assert.equal(f.store.list(f.tenant, 'public-chat-operations').length, 0); assert.equal(f.store.list(f.tenant, 'public-chat-sessions')[0].messageCount, 0);
});

test('signed Meta ingress binds one channel, rejects tampering, deduplicates and auto creates real CRM contact', async t => {
  const f = await fixture(t, 'whatsapp'); f.activate('auto_create_fill_empty');
  assert.equal((await f.app.inject(f.meta('forged', false))).statusCode, 401); assert.equal(f.eventCount(), 0);
  const request = f.meta('wamid_capture'); assert.equal((await f.app.inject(request)).statusCode, 200); assert.equal((await f.app.inject(request)).statusCode, 200); assert.equal(f.eventCount(), 1);
  await f.worker.tick(); const contact = f.store.list(f.tenant, 'contacts')[0]; assert.equal(contact.name, 'Ana Silva'); assert.equal(contact.phone, '+5511999990000'); assert.equal(contact.email, null); assert.equal(f.store.list(f.tenant, proposals)[0].status, 'applied');
});

test('ambiguous Meta channel binding never enqueues capture and journal error rolls back signed message receipt', async t => {
  const f = await fixture(t, 'whatsapp'); f.activate(); const extra = f.store.create(f.tenant, 'channels', { ...f.channel, name: 'Ambiguous' });
  const ambiguous = await f.app.inject(f.meta('ambiguous')); assert.equal(ambiguous.statusCode, 200); assert.equal(f.eventCount(), 0);
  f.store.remove(f.tenant, 'channels', extra.id); const create = f.store.create.bind(f.store);
  const unresolved = await f.app.inject(f.meta('still-unresolved')); assert.equal(unresolved.statusCode, 200); assert.equal(f.eventCount(), 0);
  assert.equal(f.store.list(f.tenant, 'reply-jobs').length, 0);
  assert.equal(f.store.list(f.tenant, 'conversations').some(c => c.metaIdentityStatus === 'requires_review'), true);
  f.store.create = ((tenant, collection, data) => { if (collection === jobs) throw new Error('Injected capture write'); return create(tenant, collection, data); }) as typeof f.store.create;
  const failure = await f.app.inject(f.meta('must-rollback', true, '5511999990001')); assert.equal(failure.statusCode, 500, failure.body); assert.equal(f.eventCount(), 0); assert.equal(f.store.list(f.tenant, 'messages').some(m => m.providerMessageId === 'must-rollback'), false); assert.equal(f.store.list(f.tenant, 'provider-events').some(e => e.eventId === 'must-rollback'), false);
});

test('active CRM grant does not authorize capture around legacy identity review or human restrictions', async t => {
  const f = await fixture(t, 'whatsapp'); f.activate('auto_create_fill_empty');
  for (const [index, state] of ['open', 'pending', 'closed', 'no_ai', 'human_handoff'].entries()) {
    const from = '551199998000' + index;
    const original = f.store.create(f.tenant, 'conversations', { channel: 'whatsapp', status: ['no_ai', 'human_handoff'].includes(state) ? 'open' : state, externalContact: '+' + from, tags: ['no_ai', 'human_handoff'].includes(state) ? [state] : [] });
    assert.equal((await f.app.inject(f.meta('review-' + index, true, from))).statusCode, 200);
    assert.deepEqual(f.store.get(f.tenant, 'conversations', original.id), original);
  }
  assert.equal(f.eventCount(), 0); assert.equal(f.store.list(f.tenant, jobs).length, 0); assert.equal(f.store.list(f.tenant, 'reply-jobs').length, 0);
  await f.worker.tick(); assert.equal(f.generations(), 0); assert.equal(f.store.list(f.tenant, 'contacts').length, 0);
});

test('signed voice route captures only final user transcripts, deduplicates, and never invents caller identity', async t => {
  const f = await fixture(t, 'phone'); f.activate('auto_create_fill_empty'); const call = await f.voice();
  const emit = (type: string, item_id: string) => call.socket.emit('message', Buffer.from(JSON.stringify({ type, item_id, transcript: text })));
  emit('response.output_audio_transcript.done', 'assistant'); emit('conversation.item.input_audio_transcription.delta', 'partial'); await flush(); assert.equal(f.eventCount(), 0); assert.equal(f.store.list(f.tenant, 'messages').length, 1);
  emit('conversation.item.input_audio_transcription.completed', 'user'); emit('conversation.item.input_audio_transcription.completed', 'user'); await flush(); assert.equal(f.eventCount(), 1); assert.equal(f.store.list(f.tenant, 'messages').filter(m => m.role === 'user').length, 1); assert.equal(f.store.list(f.tenant, 'voice-sessions')[0].lastError, undefined);
  await f.worker.tick(); assert.equal(f.store.list(f.tenant, 'contacts').length, 0); const proposal = f.store.list(f.tenant, proposals)[0]; assert.equal(proposal.status, 'proposed'); assert.match(String(proposal.reason), /identity_requires_review/);
});

test('voice call started before grant cutoff and route revocation cannot feed capture', async t => {
  const f = await fixture(t, 'phone'); const call = await f.voice(); f.activate('review', Date.now());
  f.store.update(f.tenant, 'conversations', call.conversation.id, { voiceStartedAt: new Date(Date.now() - 10000).toISOString() });
  call.socket.emit('message', Buffer.from(JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'old-call', transcript: text }))); await flush(); assert.equal(f.eventCount(), 0);
  f.store.update(f.tenant, 'channels', f.channel.id, { enabled: false }); call.socket.emit('message', Buffer.from(JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'revoked-call', transcript: text }))); await flush(); assert.equal(f.eventCount(), 0); assert.equal(f.store.list(f.tenant, jobs).length, 0);
});
