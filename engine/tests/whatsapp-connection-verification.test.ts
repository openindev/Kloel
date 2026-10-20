import test from 'node:test';
import assert from 'node:assert/strict';
import { whatsappChannelsFixture, digest } from './fixtures/whatsapp-channels.js';
import { verifyMetaConnection } from '../src/whatsapp-connection-verification.js';

async function fixture(t: any) {
  const old = { app: process.env.META_APP_ID, waba: process.env.META_WABA_ID };
  process.env.META_APP_ID = '10001'; process.env.META_WABA_ID = '20002';
  t.after(() => { for (const [k, v] of [['META_APP_ID', old.app], ['META_WABA_ID', old.waba]]) if (v === undefined) delete process.env[k!]; else process.env[k!] = v; });
  const f = await whatsappChannelsFixture(t), { row } = await f.create();
  const payloads: Record<string, any> = {
    debug_token: { data: { app_id: '10001', is_valid: true, scopes: ['whatsapp_business_management', 'whatsapp_business_messaging', 'email'], expires_at: 0, data_access_expires_at: Math.floor(Date.now() / 1000) + 3600 } },
    '20002/phone_numbers': { data: [{ id: '12345' }] },
    '12345': { id: '12345', status: 'CONNECTED', quality_rating: 'GREEN', code_verification_status: 'VERIFIED', name_status: 'APPROVED', account_mode: 'SANDBOX', display_phone_number: 'must-not-leak', verified_name: 'private-name' },
  };
  f.hooks.provider = url => { const u = new URL(url); assert.equal(u.origin, 'https://graph.facebook.com'); return Response.json(payloads[u.pathname.replace('/v25.0/', '')]); };
  return { ...f, row, payloads, verify: (body = f.control(row), who = 'owner') => f.request('POST', `/channels/${row.id}/verify-connection`, body, undefined, who) };
}

test('three read-only requests verify exact app/WABA/phone without changing channel or creating receipts; expiry zero is not 1970', async t => {
  const f = await fixture(t), before = f.snapshot(), response = await f.verify();
  assert.equal(response.statusCode, 200, response.body); const d = response.json();
  assert.deepEqual(f.snapshot(), before); assert.equal(f.calls.length, 3);
  assert.equal(d.channelId, f.row.id); assert.equal(d.version, f.row.version); assert.equal(d.appId, '10001'); assert.equal(d.wabaId, '20002'); assert.equal(d.phoneId, '12345');
  assert.equal(d.status, 'metadata_verified'); assert.equal(d.token.expiresAt, 0); assert.ok(d.token.dataAccessExpiresAt > Date.now() / 1000);
  assert.deepEqual(d.token.scopes, ['whatsapp_business_management', 'whatsapp_business_messaging']); assert.deepEqual(d.proof, { webhookDelivery: false, messageSending: false });
  for (const v of ['synthetic-meta-token', 'private-name', 'must-not-leak', 'email']) assert.equal(response.body.includes(v), false);
  for (const call of f.calls) { assert.equal(call.init.method, 'GET'); assert.equal(call.init.redirect, 'error'); assert.equal(call.init.body, undefined); assert.equal(new URL(call.url).origin, 'https://graph.facebook.com'); }
  assert.equal(new URL(f.calls[0].url).searchParams.get('input_token'), 'synthetic-meta-token');
  assert.equal(new URL(f.calls[1].url).searchParams.get('fields'), 'id'); assert.equal(new URL(f.calls[1].url).searchParams.get('limit'), '100');
  assert.equal((await f.read(f.row.id)).enabled, false);
});

test('human authority, exact tenant and observed channel version are checked before network', async t => {
  const f = await fixture(t);
  for (const [body, who, status] of [[f.control(f.row), 'member', 403], [f.control(f.row), 'foreign', 409], [f.control(f.row, { expectedTenantId: 'another' }), 'owner', 409], [f.control(f.row, { expectedVersion: 'a'.repeat(64) }), 'owner', 409], [{ ...f.control(f.row), extra: true }, 'owner', 400]] as const) {
    const r = await f.verify(body, who); assert.equal(r.statusCode, status, r.body);
  }
  f.store.db.prepare('DELETE FROM sessions WHERE hash=?').run(digest(f.cookies.owner));
  assert.equal((await f.verify()).statusCode, 401); assert.equal(f.calls.length, 0);
});

test('server app/WABA/phone binding is mandatory and cannot be supplied by request', async t => {
  const f = await fixture(t);
  delete process.env.META_APP_ID; assert.equal((await f.verify()).json().error.code, 'meta_verification_not_configured'); process.env.META_APP_ID = '10001';
  process.env.META_PHONE_NUMBER_ID = '999'; assert.equal((await f.verify()).json().error.code, 'meta_phone_configuration_mismatch'); process.env.META_PHONE_NUMBER_ID = '12345';
  process.env.PROVIDER_TENANT_ID = 'other'; assert.equal((await f.verify()).json().error.code, 'meta_tenant_not_bound');
  assert.equal(f.calls.length, 0);
});

for (const [name, patch, code] of [
  ['wrong app', { app_id: '10002' }, 'meta_app_mismatch'], ['invalid token', { is_valid: false }, 'meta_token_invalid'],
  ['expired token', { expires_at: 1 }, 'meta_token_expired'], ['expired data access', { data_access_expires_at: 1 }, 'meta_token_expired'],
  ['missing management', { scopes: ['whatsapp_business_messaging'] }, 'meta_management_scope_missing'],
] as const) test(name + ' stops after debug and does not leak provider strings', async t => {
  const f = await fixture(t); Object.assign(f.payloads.debug_token.data, patch, { user_id: 'secret-user', application: 'secret-app' });
  const r = await f.verify(); assert.equal(r.statusCode, 422, r.body); assert.equal(r.json().error.code, code); assert.equal(f.calls.length, 1); assert.equal(r.body.includes('secret-'), false);
});

test('membership is exact, bounded and never follows a provider next URL', async t => {
  const f = await fixture(t); f.payloads['20002/phone_numbers'] = { data: [{ id: '99999' }], paging: { next: 'https://evil.test/?access_token=SECRET' } };
  const r = await f.verify(); assert.equal(r.statusCode, 422); assert.equal(r.json().error.code, 'meta_phone_listing_incomplete'); assert.equal(f.calls.length, 2); assert.equal(r.body.includes('SECRET'), false);
});

test('unknown enum/raw metadata are never projected; a different phone ID is rejected', async t => {
  const f = await fixture(t); f.payloads['12345'].quality_rating = 'synthetic-meta-token'; f.payloads['12345'].name_status = 'private arbitrary text';
  const r = await f.verify(); assert.equal(r.statusCode, 200); assert.equal(r.json().phone.qualityRating, null); assert.equal(r.json().phone.nameStatus, null); assert.equal(r.body.includes('synthetic'), false);
  f.payloads['12345'].id = '54321'; const bad = await f.verify(); assert.equal(bad.statusCode, 502); assert.equal(bad.json().error.code, 'meta_phone_response_mismatch');
});

for (const phase of ['fetch', 'body'] as const) test(`role ABA during ${phase} denies disclosure and the next request`, async t => {
  const f = await fixture(t), before = f.snapshot();
  f.hooks.provider = () => {
    if (phase === 'fetch') { f.aba(); return Response.json(f.payloads.debug_token); }
    return new Response(new ReadableStream({ pull(controller) { f.aba(); controller.enqueue(new TextEncoder().encode(JSON.stringify(f.payloads.debug_token))); controller.close(); } }), { headers: { 'Content-Type': 'application/json' } });
  };
  const r = await f.verify(); assert.equal(r.statusCode, 409, r.body); assert.equal(r.json().error.code, 'context_changed_in_flight'); assert.equal(f.calls.length, 1); assert.equal(r.body.includes('10001'), false); assert.deepEqual(f.snapshot(), before);
});

test('session revoke during metadata I/O prevents disclosure, including headerless legacy callers', async t => {
  const f = await fixture(t); f.hooks.provider = () => { f.store.db.prepare('DELETE FROM sessions WHERE hash=?').run(digest(f.cookies.owner)); return Response.json(f.payloads.debug_token); };
  const r = await f.app.inject({ method: 'POST', url: `/api/v1/whatsapp/channels/${f.row.id}/verify-connection`, headers: { cookie: 'kloel_session=' + f.cookies.owner }, payload: f.control(f.row) });
  assert.ok([401, 409].includes(r.statusCode), r.body); assert.equal(f.calls.length, 1); assert.equal(r.body.includes('10001'), false);
});

for (const kind of ['channel', 'credential'] as const) test(`${kind} change during provider await invalidates verification`, async t => {
  const f = await fixture(t); f.hooks.provider = () => { if (kind === 'channel') f.store.update(f.tenant, 'channels', f.row.id, { revision: 2, name: 'Changed' }); else process.env.META_ACCESS_TOKEN = 'replacement-token'; return Response.json(f.payloads.debug_token); };
  const r = await f.verify(); assert.equal(r.statusCode, 409, r.body); assert.equal(r.json().error.code, kind === 'channel' ? 'whatsapp_channel_configuration_changed' : 'meta_verification_configuration_changed'); assert.equal(f.calls.length, 1); assert.equal(r.body.includes('replacement-token'), false);
});

test('provider failures and oversized/invalid bodies produce bounded fixed errors, never raw content', async t => {
  const f = await fixture(t);
  for (const [response, status, code] of [
    [new Response('synthetic-meta-token raw error', { status: 500 }), 502, 'meta_provider_rejected'],
    [new Response('synthetic-meta-token', { status: 429 }), 503, 'meta_rate_limited'],
    [new Response('{secret', { headers: { 'Content-Type': 'application/json' } }), 502, 'meta_invalid_response'],
    [new Response('x'.repeat(256001), { headers: { 'Content-Type': 'application/json' } }), 502, 'meta_response_limit'],
    [new Response('{}', { headers: { 'Content-Type': 'application/json', 'Content-Length': '256001' } }), 502, 'meta_invalid_response'],
  ] as const) { f.hooks.provider = () => response; const r = await f.verify(); assert.equal(r.statusCode, status, r.body); assert.equal(r.json().error.code, code); assert.equal(r.body.includes('synthetic-meta-token'), false); }
});

test('concurrent verification is refused while the first read is pending, then released', async t => {
  const f = await fixture(t); let release!: () => void, entered!: () => void;
  const waiting = new Promise<void>(r => { entered = r; }), hold = new Promise<void>(r => { release = r; }), provider = f.hooks.provider!;
  f.hooks.provider = async (u, i) => { entered(); await hold; return provider(u, i); };
  const first = f.verify(); await waiting; const second = await f.verify(); assert.equal(second.statusCode, 429); assert.equal(second.json().error.code, 'meta_verification_busy'); assert.equal(f.calls.length, 1);
  release(); assert.equal((await first).statusCode, 200); assert.equal((await f.verify()).statusCode, 200); assert.equal(f.calls.length, 6);
});

test('global fifteen-second deadline aborts a pending fetch without retry or another endpoint', async t => {
  const previous = globalThis.fetch; let calls = 0;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  globalThis.fetch = (async (_url, init) => { calls++; return new Promise<Response>((_resolve, reject) => { init!.signal!.addEventListener('abort', () => reject(Error('untrusted secret failure')), { once: true }); }); }) as typeof fetch;
  try {
    const request = verifyMetaConnection({ tenantId: 'test', appId: '10001', wabaId: '20002', phoneId: '12345', graphVersion: 'v25.0', accessToken: 'synthetic-meta-token' }, () => {});
    const result = assert.rejects(request, (e: any) => e.status === 504 && e.code === 'meta_verification_timeout' && !e.message.includes('secret'));
    t.mock.timers.tick(15_000); await result; assert.equal(calls, 1);
  } finally { globalThis.fetch = previous; t.mock.timers.reset(); }
});
