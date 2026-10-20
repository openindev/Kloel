import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import Fastify from 'fastify';
import twilio from 'twilio';
import { Store } from '../src/store.js';
import { registerTwilioTelephony, TWILIO_CALLER_ID_CALLBACK_PATH } from '../src/providers/telephony.js';
import { seedMemberships, seedMember } from './fixtures/membership.js';

const account = `AC${'a'.repeat(32)}`, callSid = `CA${'b'.repeat(32)}`, callerSid = `PN${'c'.repeat(32)}`;
const phoneNumber = '+551155555555', callbackUrl = `https://example.com${TWILIO_CALLER_ID_CALLBACK_PATH}`;
const accepted = { account_sid: account, call_sid: callSid, phone_number: phoneNumber, validation_code: '384729' };
const confirmed = { account_sid: account, sid: callerSid, phone_number: phoneNumber, friendly_name: 'Kloel' };
const validationPath = '/api/v1/voice/caller-ids/validation-requests';

async function fixture(t: TestContext) {
  const savedEnv = { ...process.env }, oldFetch = globalThis.fetch;
  const settings = { PROVIDER_TENANT_ID: 'tenant-a', TWILIO_ACCOUNT_SID: account, TWILIO_AUTH_TOKEN: 'fixture-secret-twilio', TWILIO_CALLER_ID_WEBHOOK_URL: callbackUrl, OAUTH_ENCRYPTION_KEY: randomBytes(32).toString('base64') };
  Object.assign(process.env, settings);
  const store = new Store(), app = Fastify();
  store.db.prepare('INSERT INTO users VALUES(?,?,?,?,?)').run('owner', 'tenant-a', 'owner@example.test', 'unused', 'owner');
  store.db.prepare('INSERT INTO sessions(hash,user_id,expires) VALUES(?,?,?)').run(createHash('sha256').update('cookie-fixture').digest('hex'), 'owner', Date.now() + 60000);
  seedMemberships(store); seedMember(store, { userId: 'owner', tenantId: 'tenant-b', role: 'owner' });
  app.addHook('onRequest', async req => {
    req.cookies = { kloel_session: 'cookie-fixture' };
    req.actor = { userId: 'owner', tenantId: String(req.headers['x-tenant'] ?? 'tenant-a'), role: req.headers['x-member'] ? 'member' : 'owner' };
  });
  const requests: { url: URL; init: RequestInit }[] = [];
  let respond: (url: URL, init: RequestInit) => Promise<Response> = async (_url, init) => Response.json(init.method === 'POST' ? accepted : confirmed);
  globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input)); requests.push({ url, init }); return respond(url, init);
  }) as typeof fetch;
  await registerTwilioTelephony(app, store); await app.ready();
  t.after(async () => { await app.close(); store.close(); globalThis.fetch = oldFetch; for (const key of Object.keys(settings)) { if (savedEnv[key] === undefined) delete process.env[key]; else process.env[key] = savedEnv[key]; } });
  const start = (extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) => app.inject({ method: 'POST', url: validationPath, headers, payload: { phoneNumber, friendlyName: 'Kloel', confirmCall: true, idempotencyKey: 'validation-fixture-key', ...extra } });
  const callback = (id: string, changes: Record<string, string> = {}, tampered = false) => {
    const params = { AccountSid: account, CallSid: callSid, To: phoneNumber, VerificationStatus: 'success', OutgoingCallerIdSid: callerSid, ...changes };
    const url = `${callbackUrl}?requestId=${id}`;
    const signature = twilio.getExpectedTwilioSignature(settings.TWILIO_AUTH_TOKEN, url, params);
    return app.inject({ method: 'POST', url: `${TWILIO_CALLER_ID_CALLBACK_PATH}?requestId=${id}`, headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': tampered ? 'bad' : signature }, payload: new URLSearchParams(params).toString() });
  };
  return { app, store, requests, start, callback, setRespond(fn: typeof respond) { respond = fn; } };
}

test('catalog and owned numbers are provider reads with bounded projections and never purchases', async t => {
  const f = await fixture(t);
  f.setRespond(async url => url.pathname.includes('AvailablePhoneNumbers') ? Response.json({ available_phone_numbers: [{ phone_number: phoneNumber, friendly_name: 'São Paulo', iso_country: 'BR', capabilities: { voice: true, SMS: false }, address_requirements: 'local' }] }) : Response.json({ incoming_phone_numbers: [{ ...confirmed, capabilities: { voice: true }, voice_url: 'https://secret.example/credential', status: 'in-use' }], next_page_uri: '/irrelevant-private-provider-url' }));
  const catalog = await f.app.inject('/api/v1/voice/numbers/available?country=BR&type=local&limit=5');
  assert.equal(catalog.statusCode, 200); assert.equal(catalog.json().purchasePerformed, false); assert.equal(catalog.json().priceVerified, false);
  assert.equal(f.requests[0].url.pathname, `/2010-04-01/Accounts/${account}/AvailablePhoneNumbers/BR/Local.json`);
  const owned = await f.app.inject('/api/v1/voice/numbers/owned?page=2&pageSize=10');
  assert.equal(owned.statusCode, 200); assert.equal(owned.json().nextPage, 3); assert.equal(owned.json().items[0].sid, callerSid);
  assert.ok(!owned.body.includes('credential')); assert.ok(!owned.body.includes('irrelevant-private'));
  assert.ok(f.requests.every(r => r.init.method === 'GET'));
});

test('caller-ID listing reports outbound verification without claiming inbound routing', async t => {
  const f = await fixture(t); f.setRespond(async () => Response.json({ outgoing_caller_ids: [confirmed], next_page_uri: null }));
  const result = await f.app.inject('/api/v1/voice/caller-ids');
  assert.equal(result.statusCode, 200); assert.equal(result.json().items[0].verified, true);
  assert.equal(result.json().items[0].outboundOnly, true); assert.equal(result.json().items[0].inboundRoutingConfigured, false);
});

test('explicit validation sends once, encrypts the code and replays only to a current initiating operator', async t => {
  const f = await fixture(t), response = await f.start();
  assert.equal(response.statusCode, 200); assert.equal(response.json().status, 'awaiting_confirmation');
  assert.equal(response.json().verified, false); assert.equal(response.json().validationCode, accepted.validation_code);
  assert.equal(response.headers['cache-control'], 'no-store');
  const row = f.store.list('tenant-a', 'caller-id-validations')[0]; assert.ok(!JSON.stringify(row).includes(accepted.validation_code));
  const params = new URLSearchParams(String(f.requests[0].init.body));
  assert.equal(params.get('StatusCallback'), `${callbackUrl}?requestId=${row.id}`); assert.equal(params.get('PhoneNumber'), phoneNumber);
  assert.deepEqual((await f.start()).json(), response.json()); assert.equal(f.requests.length, 1);
  const list = await f.app.inject(validationPath); assert.ok(!list.body.includes(accepted.validation_code)); assert.ok(!list.body.includes('encryptedCode'));
  f.store.db.prepare('DELETE FROM sessions').run();
  assert.equal((await f.start()).statusCode, 403); assert.equal(f.requests.length, 1);
});

test('unknown validation outcomes stay locked across retries and different idempotency keys', async t => {
  const f = await fixture(t); f.setRespond(async () => { throw new Error('synthetic timeout'); });
  assert.equal((await f.start()).statusCode, 502);
  assert.equal(f.store.list('tenant-a', 'caller-id-validations')[0].status, 'unknown');
  assert.equal((await f.start()).statusCode, 409);
  assert.equal((await f.start({ idempotencyKey: 'another-fixture-key' })).statusCode, 409);
  assert.equal(f.requests.length, 1);
});

test('missing configuration, missing explicit call confirmation and stale role cannot start a verification call', async t => {
  const f = await fixture(t);
  assert.equal((await f.start({ confirmCall: false })).statusCode, 400);
  assert.equal((await f.start({}, { 'x-member': '1' })).statusCode, 403);
  assert.equal((await f.start({}, { 'x-tenant': 'tenant-b' })).statusCode, 403);
  delete process.env.TWILIO_AUTH_TOKEN;
  assert.equal((await f.start()).statusCode, 503); assert.equal(f.requests.length, 0);
});

test('session revocation while a call is accepted suppresses the validation code but preserves the actual call receipt', async t => {
  const f = await fixture(t);
  f.setRespond(async () => { f.store.db.prepare('DELETE FROM sessions').run(); return Response.json(accepted); });
  const result = await f.start(); assert.equal(result.statusCode, 403); assert.ok(!result.body.includes(accepted.validation_code));
  const row = f.store.list('tenant-a', 'caller-id-validations')[0]; assert.equal(row.callSid, callSid); assert.equal(row.status, 'awaiting_confirmation');
  assert.equal(f.requests.length, 1);
});

test('authenticated callback binds account, phone and call and confirms against Twilio before verification', async t => {
  const f = await fixture(t), started = await f.start(), id = started.json().id;
  assert.equal((await f.callback(id, {}, true)).statusCode, 401);
  assert.equal((await f.callback(id, { To: '+551166666666' })).statusCode, 403);
  assert.equal((await f.callback(id, { AccountSid: `AC${'d'.repeat(32)}` })).statusCode, 403);
  assert.equal((await f.callback(id, { CallSid: `CA${'d'.repeat(32)}` })).statusCode, 403);
  assert.equal(f.requests.length, 1);
  const result = await f.callback(id); assert.equal(result.statusCode, 200);
  const row = f.store.get('tenant-a', 'caller-id-validations', id)!;
  assert.equal(row.status, 'verified'); assert.equal(row.encryptedCode, null); assert.equal(row.confirmationSource, 'signed_callback_and_twilio_api');
  assert.equal(f.requests[1].url.pathname, `/2010-04-01/Accounts/${account}/OutgoingCallerIds/${callerSid}.json`);
  assert.equal((await f.callback(id)).json().duplicate, true); assert.equal(f.requests.length, 2);
  assert.equal((await f.callback(id, { VerificationStatus: 'failed' })).statusCode, 409);
});

test('signed success without matching upstream caller ID stays unverified and retries only the read', async t => {
  const f = await fixture(t), id = (await f.start()).json().id;
  f.setRespond(async () => Response.json({ ...confirmed, phone_number: '+551177777777' }));
  assert.equal((await f.callback(id)).statusCode, 502);
  assert.equal(f.store.get('tenant-a', 'caller-id-validations', id)!.status, 'callback_confirmation_pending');
  f.setRespond(async () => Response.json(confirmed));
  assert.equal((await f.callback(id)).statusCode, 200);
  assert.equal(f.requests.filter(r => r.init.method === 'POST').length, 1);
});

test('callback can reconcile a lost create response using the registered requestId without another call', async t => {
  const f = await fixture(t); f.setRespond(async () => { throw new Error('synthetic response lost'); });
  await f.start(); const row = f.store.list('tenant-a', 'caller-id-validations')[0];
  f.setRespond(async () => Response.json(confirmed));
  assert.equal((await f.callback(row.id)).statusCode, 200);
  assert.equal(f.store.get('tenant-a', 'caller-id-validations', row.id)!.status, 'verified');
  assert.equal(f.requests.filter(r => r.init.method === 'POST').length, 1);
});

test('read-only reconciliation proves caller-ID existence without inventing a successful callback', async t => {
  const f = await fixture(t), id = (await f.start()).json().id;
  f.setRespond(async () => Response.json({ outgoing_caller_ids: [confirmed], next_page_uri: null }));
  const result = await f.app.inject({ method: 'POST', url: `${validationPath}/${id}/reconcile` });
  assert.equal(result.statusCode, 200); assert.equal(result.json().verified, true); assert.equal(result.json().callbackStatus, null);
  assert.equal(result.json().confirmationSource, 'twilio_api_reconciliation');
  assert.equal(f.requests[1].url.searchParams.get('PhoneNumber'), phoneNumber);
  assert.equal(f.requests.filter(r => r.init.method === 'POST').length, 1);
});

test('malformed or foreign Twilio responses never mark validation accepted or expose a code', async t => {
  const f = await fixture(t); f.setRespond(async () => Response.json({ ...accepted, account_sid: `AC${'d'.repeat(32)}` }));
  const response = await f.start(); assert.equal(response.statusCode, 502); assert.ok(!response.body.includes(accepted.validation_code));
  assert.equal(f.store.list('tenant-a', 'caller-id-validations')[0].status, 'unknown');
});
