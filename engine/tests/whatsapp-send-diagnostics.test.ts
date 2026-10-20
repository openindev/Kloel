import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { Store } from '../src/store.js';
import { registerAuth } from '../src/auth.js';
import { registerWhatsAppOperator } from '../src/providers/whatsapp-operator.js';
import { seedMember } from './fixtures/membership.js';

const config = { PROVIDER_TENANT_ID: 'diagnostic-tenant', META_ACCESS_TOKEN: 'fixture-access-token-secret', META_PHONE_NUMBER_ID: '12345', META_GRAPH_VERSION: 'v25.0', META_WABA_ID: '23456' };
async function fixture(t: any) {
  const saved = { ...process.env }; Object.assign(process.env, config);
  const store = new Store(), app = Fastify(); await app.register(cookie);
  const actor = { userId: 'diagnostic-owner', tenantId: config.PROVIDER_TENANT_ID, role: 'owner' as const };
  seedMember(store, actor); seedMember(store, { ...actor, userId: 'other-owner' });
  for (const userId of [actor.userId, 'other-owner']) store.db.prepare('INSERT INTO sessions(hash,user_id,expires,tenant_id) VALUES(?,?,?,?)').run(createHash('sha256').update(`diagnostic-${userId}`).digest('hex'), userId, Date.now() + 3600000, actor.tenantId);
  await registerAuth(app, store);
  const state = { calls: [] as string[], response: async () => Response.json({ messages: [{ id: 'wamid.fixture' }] }) };
  await registerWhatsAppOperator(app, store, { fetcher: (async (url: any, init: RequestInit = {}) => {
    const target = new URL(String(url)); assert.equal(target.hostname, 'graph.facebook.com'); assert.equal(init.redirect, 'error'); state.calls.push(`${init.method ?? 'GET'} ${target.pathname}`);
    if (init.method !== 'POST') return Response.json({ data: [{ id: '42', name: 'hello', language: 'pt_BR', status: 'APPROVED', category: 'UTILITY', components: [{ type: 'BODY', text: 'Synthetic' }] }] });
    return state.response();
  }) as typeof fetch });
  const request = (method: 'GET' | 'POST', path: string, payload?: any, userId = actor.userId) => app.inject({ method, url: `/api/v1/whatsapp${path}`, headers: { cookie: `kloel_session=diagnostic-${userId}` }, ...(payload ? { payload } : {}) });
  const body = (key = randomUUID()) => ({ to: '+5511999999999', text: 'Synthetic diagnostic test', idempotencyKey: key });
  const receipt = (key: string) => store.list(actor.tenantId, 'whatsapp-operations').find(row => row.key === key)!;
  t.after(async () => { await app.close(); store.close(); for (const key of Object.keys(config)) if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; });
  return { store, app, actor, state, request, body, receipt };
}

test('Graph refusal retains only numeric diagnostics in original receipt and never repeats the send', async t => {
  const f = await fixture(t), body = f.body();
  const secret = 'REMOTE_PRIVATE_MESSAGE_URL_TOKEN';
  f.state.response = async () => Response.json({ error: { code: 131030, error_subcode: 2494010, message: secret, error_user_msg: secret, type: secret, fbtrace_id: secret, error_data: { details: secret }, url: `https://private.invalid/${secret}` } }, { status: 400 });
  const sent = await f.request('POST', '/send', body);
  assert.equal(sent.statusCode, 502); assert.equal(sent.json().error.code, 'provider_recipient_not_allowed');
  assert.equal(sent.json().error.graphCode, 131030); assert.equal(sent.json().error.graphSubcode, 2494010);
  assert.match(sent.json().error.message, /destinatário/i);
  const lookup = await f.request('GET', `/operations/${body.idempotencyKey}`);
  assert.deepEqual(lookup.json(), { status: 'failed', errorCode: 'provider_recipient_not_allowed', graphCode: 131030, graphSubcode: 2494010, automaticRetry: false });
  assert.equal(f.receipt(body.idempotencyKey).graphCode, 131030); assert.equal(f.receipt(body.idempotencyKey).graphSubcode, 2494010);
  for (const value of [sent.body, lookup.body, JSON.stringify(f.receipt(body.idempotencyKey))]) assert.ok(!value.includes(secret));
  assert.equal((await f.request('GET', `/operations/${body.idempotencyKey}`, undefined, 'other-owner')).statusCode, 404);
  assert.equal((await f.request('POST', '/send', body)).json().error.code, 'operation_requires_reconciliation');
  assert.equal(f.state.calls.length, 1); assert.equal(f.store.list(f.actor.tenantId, 'messages').length, 0);
});

for (const [graphCode, errorCode, fragment] of [
  [131047, 'provider_template_required', 'template aprovado'],
  [190, 'provider_token_invalid', 'token de acesso'],
  [10, 'provider_permission_denied', 'permissões'],
  [200, 'provider_permission_denied', 'permissões'],
  [131005, 'provider_permission_denied', 'permissões'],
  [987654, 'provider_rejected', 'recusou'],
] as const) test(`HTTP 4xx Graph ${graphCode} preserves numeric evidence and uses a fixed local explanation`, async t => {
  const f = await fixture(t), body = f.body();
  f.state.response = async () => Response.json({ error: { code: graphCode, message: 'remote-private-details', error_subcode: 0 } }, { status: 403 });
  const response = await f.request('POST', '/send', body); assert.equal(response.statusCode, 502);
  assert.equal(response.json().error.code, errorCode); assert.ok(response.json().error.message.includes(fragment));
  assert.ok(!response.body.includes('remote-private-details'));
  const r = (await f.request('GET', `/operations/${body.idempotencyKey}`)).json();
  assert.equal(r.graphCode, graphCode); assert.equal(r.graphSubcode, 0); assert.equal(r.status, 'failed');
  assert.equal((await f.request('POST', '/send', body)).statusCode, 409); assert.equal(f.state.calls.length, 1);
});

test('untrusted scalar shapes, strings, fractions and oversized numbers never become diagnostics', async t => {
  const f = await fixture(t);
  for (const value of [null, [], '131030', { error: [] }, { error: 'private-remote' }, ...['190', -1, 2.5, 2147483648, {}, []].map(value => ({ error: { code: value, error_subcode: value, message: 'private-remote' } }))]) {
    const body = f.body(); f.state.response = async () => Response.json(value, { status: 400 });
    const response = await f.request('POST', '/send', body); assert.equal(response.json().error.code, 'provider_rejected');
    assert.equal(response.json().error.graphCode, undefined); assert.equal(response.json().error.graphSubcode, undefined);
    const r = (await f.request('GET', `/operations/${body.idempotencyKey}`)).json();
    assert.deepEqual(r, { status: 'failed', errorCode: 'provider_rejected', automaticRetry: false });
    assert.ok(!JSON.stringify(f.receipt(body.idempotencyKey)).includes('private-remote'));
  }
});

test('template sends use the same sanitized refusal without another template read or message POST on replay', async t => {
  const f = await fixture(t), body = { to: '+5511999999999', name: 'hello', language: 'pt_BR', bodyParameters: [], idempotencyKey: randomUUID() };
  f.state.response = async () => Response.json({ error: { code: 131030, error_subcode: 42, message: 'private-template-rejection' } }, { status: 400 });
  const r = await f.request('POST', '/templates/send', body); assert.equal(r.json().error.code, 'provider_recipient_not_allowed');
  assert.equal((await f.request('GET', `/operations/${body.idempotencyKey}`)).json().graphSubcode, 42);
  assert.equal((await f.request('POST', '/templates/send', body)).statusCode, 409);
  assert.deepEqual(f.state.calls, ['GET /v25.0/23456/message_templates', 'POST /v25.0/12345/messages']);
});

test('invalid JSON, oversized body and stream failure preserve definite HTTP refusal without remote strings', async t => {
  const f = await fixture(t);
  for (const response of [
    new Response('private-invalid-json', { status: 400 }),
    Response.json({ error: { code: 131030, message: 'private-oversized'.repeat(2000) } }, { status: 400 }),
    new Response(new ReadableStream({ start(controller) { controller.error(new Error('private-stream-failure')); } }), { status: 400 }),
    new Response(null, { status: 400 }),
  ]) {
    const body = f.body(); f.state.response = async () => response;
    const r = await f.request('POST', '/send', body); assert.equal(r.json().error.code, 'provider_rejected');
    const lookup = await f.request('GET', `/operations/${body.idempotencyKey}`); assert.equal(lookup.json().status, 'failed'); assert.equal(lookup.json().graphCode, undefined);
    assert.ok(!r.body.includes('private-')); assert.ok(!lookup.body.includes('private-'));
    assert.equal((await f.request('POST', '/send', body)).statusCode, 409);
  }
  assert.equal(f.state.calls.length, 4);
});

test('oversized endless stream stops reading and cannot wait indefinitely for rejected cancel', async t => {
  const f = await fixture(t), body = f.body(); let reads = 0, cancelled = false;
  f.state.response = async () => new Response(new ReadableStream<Uint8Array>({
    pull(controller) { reads++; controller.enqueue(new Uint8Array(20000)); },
    cancel() { cancelled = true; return Promise.reject(Error('private-cancel-error')); },
  }), { status: 400 });
  const r = await f.request('POST', '/send', body);
  assert.equal(r.json().error.code, 'provider_rejected'); assert.equal(f.receipt(body.idempotencyKey).status, 'failed');
  assert.ok(reads <= 2); assert.equal(cancelled, true); assert.equal(f.state.calls.length, 1);
});

test('stalled 4xx body has a finite deadline, preserves refusal and blocks concurrent same-key delivery', async t => {
  const f = await fixture(t), body = f.body(); let entered!: () => void, cancelled = false;
  const reading = new Promise<void>(resolve => { entered = resolve; });
  f.state.response = async () => new Response(new ReadableStream<Uint8Array>({
    pull() { entered(); return new Promise<void>(() => {}); },
    cancel() { cancelled = true; return new Promise<void>(() => {}); },
  }), { status: 400 });
  const sending = f.request('POST', '/send', body); await reading;
  assert.equal((await f.request('GET', `/operations/${body.idempotencyKey}`)).json().status, 'pending');
  assert.equal((await f.request('POST', '/send', body)).statusCode, 409);
  const r = await sending; assert.equal(r.json().error.code, 'provider_rejected');
  assert.equal(f.receipt(body.idempotencyKey).status, 'failed'); assert.equal(cancelled, true); assert.equal(f.state.calls.length, 1);
});

test('empty chunk stream is bounded even if repeated microtasks would starve a timer', async t => {
  const f = await fixture(t), body = f.body(); let reads = 0;
  f.state.response = async () => new Response(new ReadableStream<Uint8Array>({ pull(controller) { reads++; controller.enqueue(new Uint8Array()); } }), { status: 400 });
  assert.equal((await f.request('POST', '/send', body)).json().error.code, 'provider_rejected');
  assert.ok(reads <= 129); assert.equal(f.receipt(body.idempotencyKey).status, 'failed');
});

test('revocation during refusal body read denies disclosure but preserves the known refusal and never sends again', async t => {
  const f = await fixture(t), body = f.body(); let reads = 0;
  f.state.response = async () => new Response(new ReadableStream<Uint8Array>({ pull(controller) {
    if (reads++ === 0) { f.store.db.exec('DELETE FROM sessions'); controller.enqueue(new TextEncoder().encode(JSON.stringify({ error: { code: 190, error_subcode: 463, message: 'private-revoked' } }))); }
    else controller.close();
  } }), { status: 401 });
  const r = await f.request('POST', '/send', body); assert.equal(r.statusCode, 403);
  assert.equal(r.json().error.graphCode, undefined); assert.ok(!r.body.includes('private-revoked'));
  const receipt = f.receipt(body.idempotencyKey); assert.equal(receipt.status, 'failed'); assert.equal(receipt.errorCode, 'provider_token_invalid'); assert.equal(receipt.graphSubcode, 463);
  assert.equal((await f.request('GET', `/operations/${body.idempotencyKey}`)).statusCode, 401);
  assert.equal((await f.request('POST', '/send', body)).statusCode, 401); assert.equal(f.state.calls.length, 1);
});

test('server/redirect/transport ambiguity stays unknown even when a body has a recognizable Graph code', async t => {
  const f = await fixture(t);
  for (const outcome of [503, 302, 'network'] as const) {
    const body = { ...f.body(), to: `+551199999999${f.state.calls.length}` };
    f.state.response = async () => {
      if (outcome === 'network') throw Error('private-network-error');
      return Response.json({ error: { code: 131030, error_subcode: 42, message: 'private-server-error' } }, { status: outcome });
    };
    const r = await f.request('POST', '/send', body); assert.equal(r.json().error.code, 'provider_outcome_unknown'); assert.equal(r.json().error.graphCode, undefined);
    const receipt = (await f.request('GET', `/operations/${body.idempotencyKey}`)).json();
    assert.deepEqual(receipt, { status: 'unknown', errorCode: 'provider_outcome_unknown', automaticRetry: false });
    assert.equal((await f.request('POST', '/send', body)).statusCode, 409);
  }
  assert.equal(f.state.calls.length, 3);
});

test('refusal committed before a storage exception is recoverable by GET with no second POST', async t => {
  const f = await fixture(t), body = f.body(), update = f.store.update.bind(f.store); let fail = true;
  f.state.response = async () => Response.json({ error: { code: 131047, error_subcode: 42, message: 'private-remote' } }, { status: 400 });
  f.store.update = ((...args: Parameters<Store['update']>) => {
    const result = update(...args);
    if (fail && args[1] === 'whatsapp-operations' && args[3].status === 'failed') { fail = false; throw Error('synthetic-after-commit'); }
    return result;
  }) as Store['update'];
  assert.equal((await f.request('POST', '/send', body)).statusCode, 500);
  f.state.response = async () => { throw Error('GET/replay must never call provider'); };
  const receipt = (await f.request('GET', `/operations/${body.idempotencyKey}`)).json();
  assert.equal(receipt.status, 'failed'); assert.equal(receipt.graphCode, 131047); assert.equal(receipt.graphSubcode, 42);
  assert.equal((await f.request('POST', '/send', body)).statusCode, 409); assert.equal(f.state.calls.length, 1);
});

test('legacy receipts are not backfilled and stored numeric diagnostic projection rejects malformed fields', async t => {
  const f = await fixture(t), body = f.body(); f.state.response = async () => new Response(null, { status: 400 });
  await f.request('POST', '/send', body); const row = f.receipt(body.idempotencyKey);
  const before = JSON.stringify(row); assert.equal((await f.request('GET', `/operations/${body.idempotencyKey}`)).json().graphCode, undefined); assert.equal(JSON.stringify(f.receipt(body.idempotencyKey)), before);
  f.store.update(f.actor.tenantId, 'whatsapp-operations', row.id, { graphCode: 'private-untrusted', graphSubcode: 2147483648 });
  const r = await f.request('GET', `/operations/${body.idempotencyKey}`); assert.equal(r.json().graphCode, undefined); assert.equal(r.json().graphSubcode, undefined); assert.ok(!r.body.includes('private-untrusted')); assert.equal(f.state.calls.length, 1);
});
