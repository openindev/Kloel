import test from 'node:test';
import { captureWhatsAppChannel } from '../src/whatsapp-channel-state.js';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { Store } from '../src/store.js';
import { registerAuth } from '../src/auth.js';
import { registerWhatsAppOperator, setWhatsAppSchedulerRunning } from '../src/providers/whatsapp-operator.js';
import { seedMember } from './fixtures/membership.js';

const config = { PROVIDER_TENANT_ID: 'wa-tenant', META_ACCESS_TOKEN: 'isolated-meta-token', META_PHONE_NUMBER_ID: '12345', META_GRAPH_VERSION: 'v25.0', META_WABA_ID: '23456', META_APP_SECRET: 'isolated-app-secret', META_VERIFY_TOKEN: 'isolated-verify-token', OPENAI_API_KEY: 'isolated-openai-token', OPENAI_MODEL: 'fixture', WHATSAPP_AUTOREPLY_ENABLED: 'true' };
async function fixture(t: any) {
  const saved = { ...process.env }; Object.assign(process.env, config);
  const store = new Store(), app = Fastify(); await app.register(cookie);
  const owner = { userId: 'wa-owner', tenantId: config.PROVIDER_TENANT_ID, role: 'owner' as const };
  seedMember(store, owner); seedMember(store, { ...owner, userId: 'other-owner' }); seedMember(store, { ...owner, userId: 'viewer', role: 'viewer' }); seedMember(store, { ...owner, tenantId: 'foreign' });
  const token = (user: string) => `fixture-cookie-${user}`;
  for (const user of [owner.userId, 'other-owner', 'viewer']) store.db.prepare('INSERT INTO sessions(hash,user_id,expires,tenant_id) VALUES(?,?,?,?)').run(createHash('sha256').update(token(user)).digest('hex'), user, Date.now() + 3600000, owner.tenantId);
  await registerAuth(app, store);
  const state = { calls: [] as Array<{ url: URL; init: RequestInit }>, response: undefined as undefined | ((url: URL, init: RequestInit) => Promise<Response>) };
  const template = { id: '42', name: 'hello', language: 'pt_BR', status: 'APPROVED', category: 'UTILITY', components: [{ type: 'BODY', text: 'Olá {{1}}' }] };
  await registerWhatsAppOperator(app, store, { fetcher: (async (url: any, init: RequestInit = {}) => {
    const target = new URL(String(url)); assert.equal(target.hostname, 'graph.facebook.com'); assert.equal(init.redirect, 'error'); state.calls.push({ url: target, init });
    return state.response ? state.response(target, init) : init.method === 'POST' ? Response.json({ messages: [{ id: 'wamid.fixture' }] }) : Response.json({ data: [template] });
  }) as typeof fetch });
  const channel = store.create(owner.tenantId, 'channels', { name: 'WhatsApp', type: 'whatsapp', provider: 'meta', enabled: true, agentId: 'agent', configuration: { externalId: '12345' } });
  store.create(owner.tenantId, 'agents', { name: 'Fixture agent', status: 'active' });
  const agent = store.create(owner.tenantId, 'agents', { name: 'Assigned', status: 'active' }); store.update(owner.tenantId, 'channels', channel.id, { agentId: agent.id });
  const request = (method: 'GET' | 'POST', path: string, payload?: any, user = owner.userId) => app.inject({ method, url: `/api/v1/whatsapp${path}`, headers: { cookie: `kloel_session=${token(user)}` }, ...(payload ? { payload } : {}) });
  t.after(async () => { await app.close(); store.close(); for (const key of Object.keys(config)) if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; });
  const body = (key = randomUUID()) => ({ to: '+5511999999999', text: 'Mensagem de teste isolado', channelId: channel.id, idempotencyKey: key });
  return { store, app, owner, channel, agent, state, request, body, template, token };
}

test('status separates actual scheduler, opt-in and unverified provider configuration without secrets', async t => {
  const f = await fixture(t); let r = await f.request('GET', '/status'); assert.equal(r.statusCode, 200); assert.equal(r.json().phoneNumberId, '12345'); assert.equal(r.json().verifiedLive, false);
  assert.deepEqual(r.json().autoreply, { enabled: true, schedulerRunning: false }); setWhatsAppSchedulerRunning(f.store, true);
  r = await f.request('GET', '/status'); assert.equal(r.json().autoreply.schedulerRunning, true); assert.equal(f.state.calls.length, 0);
  for (const key of ['META_ACCESS_TOKEN', 'META_APP_SECRET', 'META_VERIFY_TOKEN', 'OPENAI_API_KEY'] as const) assert.ok(!r.body.includes(config[key]));
  delete process.env.META_PHONE_NUMBER_ID;
  assert.equal((await f.request('GET', '/status')).json().configuration.templates.configured, false);
  assert.equal((await f.request('GET', '/templates')).statusCode, 503);
  process.env.META_PHONE_NUMBER_ID = config.META_PHONE_NUMBER_ID;
  assert.equal((await f.request('GET', '/status', undefined, 'viewer')).statusCode, 403);
  f.store.db.prepare('UPDATE sessions SET tenant_id=? WHERE user_id=?').run('foreign', f.owner.userId);
  r = await f.request('GET', '/status'); assert.equal(r.json().phoneNumberId, null); assert.equal(r.json().tenantBound, false); assert.deepEqual(r.json().autoreply, { enabled: false, schedulerRunning: false });
});

test('send receipt/replay is operator-bound, result sanitized, delivery only follows provider status', async t => {
  const f = await fixture(t), body = f.body(); const r = await f.request('POST', '/send', body); assert.equal(r.statusCode, 200); assert.equal(r.json().status, 'accepted');
  assert.equal((await f.request('POST', '/send', body)).statusCode, 200); assert.equal(f.state.calls.length, 1);
  let lookup = await f.request('GET', `/operations/${body.idempotencyKey}`); assert.equal(lookup.json().deliveryStatus, 'accepted'); assert.equal(lookup.json().automaticRetry, false);
  assert.ok(!lookup.body.includes(body.text)); assert.ok(!lookup.body.includes('fingerprint')); assert.ok(!lookup.body.includes('recipient'));
  const message = f.store.list(f.owner.tenantId, 'messages')[0]; f.store.update(f.owner.tenantId, 'messages', message.id, { providerStatus: 'delivered' });
  lookup = await f.request('GET', `/operations/${body.idempotencyKey}`); assert.equal(lookup.json().deliveryStatus, 'delivered');
  assert.equal((await f.request('GET', `/operations/${body.idempotencyKey}`, undefined, 'other-owner')).statusCode, 404);
  assert.equal((await f.request('POST', '/send', body, 'other-owner')).statusCode, 409); assert.equal(f.state.calls.length, 1);
});

test('pending and uncertain receipts block duplicate effects, including concurrent requests and legacy keys', async t => {
  const f = await fixture(t), body = f.body(); let release!: () => void, entered!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; }); f.state.response = async () => { entered(); await new Promise<void>(resolve => { release = resolve; }); throw Error('isolated lost provider response'); };
  const first = f.request('POST', '/send', body); await waiting;
  assert.equal((await f.request('GET', `/operations/${body.idempotencyKey}`)).json().status, 'pending');
  assert.equal((await f.request('POST', '/send', body)).statusCode, 409); release(); assert.equal((await first).statusCode, 502);
  const result = (await f.request('GET', `/operations/${body.idempotencyKey}`)).json(); assert.equal(result.status, 'unknown'); assert.equal(result.result, undefined);
  assert.equal((await f.request('POST', '/send', body)).statusCode, 409); assert.equal(f.state.calls.length, 1);
  assert.equal((await f.request('POST', '/send', f.body())).json().error.code, 'recipient_requires_reconciliation'); assert.equal(f.state.calls.length, 1);
  f.store.create(f.owner.tenantId, 'provider-operations', { operation: 'meta.send', key: 'legacy-key-1', status: 'succeeded', result: { secret: 'never-visible' } });
  assert.equal((await f.request('POST', '/send', f.body('legacy-key-1'))).json().error.code, 'legacy_operation_requires_reconciliation');
  assert.equal((await f.request('GET', '/operations/legacy-key-1')).statusCode, 404);
});

for (const change of ['logout', 'membership', 'rejoin', 'tenant', 'config', 'channel', 'conversation'] as const) test(`accepted external receipt survives ${change} during I/O without disclosing result or repeating effect`, async t => {
  const f = await fixture(t), conversation = f.store.create(f.owner.tenantId, 'conversations', { channel: 'whatsapp', externalContact: '+5511999999999', status: 'open', channelId: f.channel.id });
  const body = { ...f.body(), conversationId: conversation.id };
  f.state.response = async () => {
    if (change === 'logout') f.store.db.prepare('DELETE FROM sessions WHERE user_id=?').run(f.owner.userId);
    if (change === 'membership') f.store.db.prepare('UPDATE memberships SET role=? WHERE user_id=?').run('viewer', f.owner.userId);
    if (change === 'rejoin') { f.store.db.prepare('DELETE FROM memberships WHERE user_id=? AND tenant_id=?').run(f.owner.userId, f.owner.tenantId); seedMember(f.store, f.owner); }
    if (change === 'tenant') f.store.db.prepare('UPDATE sessions SET tenant_id=? WHERE user_id=?').run('foreign', f.owner.userId);
    if (change === 'config') process.env.META_ACCESS_TOKEN = 'changed-test-token';
    if (change === 'channel') f.store.update(f.owner.tenantId, 'channels', f.channel.id, { enabled: false });
    if (change === 'conversation') f.store.update(f.owner.tenantId, 'conversations', conversation.id, { status: 'closed' });
    return Response.json({ messages: [{ id: 'wamid.accepted' }] });
  };
  const response = await f.request('POST', '/send', body); assert.ok([403, 409].includes(response.statusCode)); assert.ok(!response.body.includes('wamid.accepted'));
  const receipt = f.store.list(f.owner.tenantId, 'whatsapp-operations')[0]; assert.equal(receipt.status, 'succeeded'); assert.equal((receipt.result as any).messageId, 'wamid.accepted'); assert.equal(f.store.list(f.owner.tenantId, 'messages').length, 0);
  assert.notEqual((await f.request('POST', '/send', body)).statusCode, 200); assert.equal(f.state.calls.length, 1);
});

test('revocation while decoding provider JSON is fenced after await and accepted evidence remains durable', async t => {
  const f = await fixture(t); f.state.response = async () => ({ ok: true, json: async () => { f.store.db.exec('DELETE FROM sessions'); return { messages: [{ id: 'wamid.json' }] }; } }) as Response;
  const r = await f.request('POST', '/send', f.body()); assert.equal(r.statusCode, 403); assert.ok(!r.body.includes('wamid.json')); assert.equal(f.store.list(f.owner.tenantId, 'whatsapp-operations')[0].status, 'succeeded');
});

test('omitting channelId cannot bypass a conversation-bound disabled or different Meta number route', async t => {
  const f = await fixture(t), c = f.store.create(f.owner.tenantId, 'conversations', { channel: 'whatsapp', status: 'open', externalContact: '+5511999999999', channelId: f.channel.id });
  const { channelId: omitted, ...base } = f.body(); const body = { ...base, conversationId: c.id };
  f.store.update(f.owner.tenantId, 'channels', f.channel.id, { enabled: false });
  assert.equal((await f.request('POST', '/send', body)).json().error.code, 'channel_unavailable');
  f.store.update(f.owner.tenantId, 'channels', f.channel.id, { enabled: true, configuration: { externalId: '98765' } });
  assert.equal((await f.request('POST', '/send', body)).json().error.code, 'channel_unavailable');
  assert.equal(f.state.calls.length, 0); assert.equal(f.store.list(f.owner.tenantId, 'whatsapp-operations').length, 0);
  f.store.update(f.owner.tenantId, 'channels', f.channel.id, { configuration: { externalId: '12345' } });
  const wrongRecipient = { ...body, to: '+5511888888888' }; assert.equal((await f.request('POST', '/send', wrongRecipient)).json().error.code, 'recipient_mismatch');
});

test('channel inferred from conversation is captured and revalidated after external acceptance', async t => {
  const f = await fixture(t), c = f.store.create(f.owner.tenantId, 'conversations', { channel: 'whatsapp', status: 'open', externalContact: '+5511999999999', channelId: f.channel.id });
  const { channelId: omitted, ...base } = f.body(); const body = { ...base, conversationId: c.id };
  f.state.response = async () => { f.store.update(f.owner.tenantId, 'channels', f.channel.id, { enabled: false }); return Response.json({ messages: [{ id: 'wamid.inferred' }] }); };
  const result = await f.request('POST', '/send', body); assert.equal(result.statusCode, 409); assert.ok(!result.body.includes('wamid.inferred'));
  const receipt = f.store.list(f.owner.tenantId, 'whatsapp-operations')[0]; assert.equal(receipt.channelId, f.channel.id); assert.equal(receipt.status, 'succeeded');
  assert.equal(f.store.list(f.owner.tenantId, 'messages').length, 0); assert.equal(f.state.calls.length, 1);
});

test('definite rejection is failed; invalid successful body/redirect/server failure are quarantined without retry', async t => {
  const f = await fixture(t);
  for (const [response, status] of [[new Response('private-provider-body', { status: 400 }), 'failed'], [new Response('private-provider-body', { status: 503 }), 'unknown'], [new Response(null, { status: 302 }), 'unknown'], [Response.json({ messages: [{ id: 'not-a-provider-id' }], token: 'private' }), 'unknown']] as const) {
    f.state.response = async () => response; const body = { ...f.body(), to: `+551199999999${f.state.calls.length}` }, before = f.state.calls.length;
    const sent = await f.request('POST', '/send', body); assert.equal(sent.statusCode, 502); assert.ok(!sent.body.includes('private'));
    assert.equal((await f.request('GET', `/operations/${body.idempotencyKey}`)).json().status, status);
    assert.equal((await f.request('POST', '/send', body)).statusCode, 409); assert.equal(f.state.calls.length, before + 1);
  }
});

test('template list projects only metadata, honors pagination and fences access during reads', async t => {
  const f = await fixture(t);
  f.state.response = async () => Response.json({ data: [{ ...f.template, secret: 'private-template-secret', components: [...f.template.components, { type: 'BUTTONS', buttons: [{ url: 'https://secret.invalid' }] }] }], paging: { next: 'https://graph.facebook.com/anything', cursors: { after: 'opaque-cursor' } } });
  let r = await f.request('GET', '/templates?after=previous'); assert.equal(r.statusCode, 200); assert.equal(r.json().items[0].sendable, false); assert.equal(r.json().nextCursor, 'opaque-cursor'); assert.ok(!r.body.includes('secret'));
  assert.equal(f.state.calls[0].url.searchParams.get('after'), 'previous');
  f.state.response = async () => { f.store.db.exec('DELETE FROM sessions'); return Response.json({ data: [f.template] }); };
  r = await f.request('GET', '/templates'); assert.equal(r.statusCode, 403); assert.ok(!r.body.includes('Olá'));
});

test('template send rechecks current approved template/parameters and repeats no provider I/O on replay', async t => {
  const f = await fixture(t), body = { to: '+5511999999999', channelId: f.channel.id, name: 'hello', language: 'pt_BR', bodyParameters: ['Maria'], idempotencyKey: randomUUID() };
  let r = await f.request('POST', '/templates/send', body); assert.equal(r.statusCode, 200); assert.equal(f.state.calls.length, 2);
  const payload = JSON.parse(String(f.state.calls[1].init.body)); assert.deepEqual(payload.template.components[0].parameters, [{ type: 'text', text: 'Maria' }]);
  assert.equal((await f.request('POST', '/templates/send', body)).statusCode, 200); assert.equal(f.state.calls.length, 2);
  f.template.status = 'PAUSED'; r = await f.request('POST', '/templates/send', { ...body, idempotencyKey: randomUUID() }); assert.equal(r.statusCode, 409); assert.equal(f.state.calls.filter(c => c.init.method === 'POST').length, 1);
});

test('job projection excludes prompts/claim tokens; resume uses CAS and refuses uncertain or human-handled work', async t => {
  const f = await fixture(t), c = f.store.create(f.owner.tenantId, 'conversations', { channel: 'whatsapp', externalContact: '+5511999999999', status: 'open', channelId: f.channel.id });
  const m = f.store.create(f.owner.tenantId, 'messages', { conversationId: c.id, source: 'meta', role: 'user' });
  const job = f.store.create(f.owner.tenantId, 'reply-jobs', { provider: 'meta', status: 'paused', channelSnapshot: captureWhatsAppChannel(f.store.get(f.owner.tenantId, 'channels', f.channel.id)!, '12345'), channelId: f.channel.id, agentId: f.agent.id, conversationId: c.id, recipient: '+5511999999999', incomingAt: Date.now(), sourceMessageId: m.id, attempts: 1, claimToken: 'private-claim', replyText: 'private-reply' });
  let r = await f.request('GET', '/jobs'); assert.equal(r.statusCode, 200); assert.ok(!r.body.includes('private'));
  const old = r.json().items[0]; r = await f.request('POST', `/jobs/${job.id}/resume`, { expectedVersion: old.version }); assert.equal(r.statusCode, 200); assert.equal(r.json().status, 'ready_to_send');
  assert.equal((await f.request('POST', `/jobs/${job.id}/resume`, { expectedVersion: old.version })).statusCode, 409); assert.equal(f.state.calls.length, 0);
  f.store.update(f.owner.tenantId, 'reply-jobs', job.id, { status: 'requires_reconciliation' }); const uncertain = (await f.request('GET', '/jobs')).json().items[0];
  assert.equal((await f.request('POST', `/jobs/${job.id}/resume`, { expectedVersion: uncertain.version })).statusCode, 409);
  f.store.update(f.owner.tenantId, 'reply-jobs', job.id, { status: 'paused' }); f.store.update(f.owner.tenantId, 'conversations', c.id, { tags: ['human_handoff'] }); const paused = (await f.request('GET', '/jobs')).json().items[0];
  assert.equal((await f.request('POST', `/jobs/${job.id}/resume`, { expectedVersion: paused.version })).json().error.code, 'human_handoff');
});
