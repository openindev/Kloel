import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { Store } from '../src/store.js';
import { registerProviders } from '../src/providers.js';
import { identityCollection } from '../src/providers/stripe-identity.js';
import { resolveSessionContext, CONTEXT_HEADERS } from '../src/request-context.js';
import { seedMember, seedMemberships } from './fixtures/membership.js';

const savedEnv = { ...process.env }, savedFetch = globalThis.fetch;
const config: Record<string, string> = { PROVIDER_TENANT_ID: 'tenant', STRIPE_SECRET_KEY: 'sk_test_fixture', APP_ORIGIN: 'http://localhost:3000', STRIPE_WEBHOOK_SECRET: 'whsec_identity_fixture' };
const envNames = [...Object.keys(config), 'STRIPE_IDENTITY_RETURN_URL'];
let app: FastifyInstance, store: Store, cookie: string, remote: Record<string, any>, calls: { url: string; init: RequestInit }[];
let respond: (url: string, init: RequestInit) => Promise<Response>;
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const row = () => store.list('tenant', identityCollection).at(-1)!;
function headers() {
  const context = resolveSessionContext(store, hash(cookie))!.context;
  return { [CONTEXT_HEADERS.userId]: context.userId, [CONTEXT_HEADERS.tenantId]: context.tenantId ?? '-', [CONTEXT_HEADERS.membershipId]: context.membershipId ?? '-', [CONTEXT_HEADERS.authorityVersion]: context.authorityVersion };
}
const start = (key = randomUUID(), extra: Record<string, any> = {}) => app.inject({ method: 'POST', url: '/api/v1/billing/identity/start', headers: headers(), payload: { expectedTenantId: 'tenant', idempotencyKey: key, ...extra } });
const action = (name = 'reconcile', id = row().id) => app.inject({ method: 'POST', url: `/api/v1/billing/identity/${name}`, headers: headers(), payload: { expectedTenantId: 'tenant', verificationId: id } });
const state = () => app.inject({ url: '/api/v1/billing/identity', headers: headers() });
const operation = (key = row().key) => app.inject({ url: `/api/v1/billing/identity/operations/${key}`, headers: headers() });
const creates = () => calls.filter(c => c.url.endsWith('/identity/verification_sessions') && c.init.method === 'POST').length;
async function fixtureResponse(url: string, init: RequestInit) {
  if (url.endsWith('/account')) return Response.json({ id: 'acct_fixture' });
  if (init.method === 'POST') {
    const form = new URLSearchParams(String(init.body));
    remote = { id: 'vs_fixture', object: 'identity.verification_session', type: 'document', options: { document: { require_matching_selfie: true } }, livemode: process.env.STRIPE_SECRET_KEY!.startsWith('sk_live_'), status: 'requires_input',
      client_reference_id: form.get('client_reference_id'), metadata: { kloelIdentityId: form.get('metadata[kloelIdentityId]'), tenantId: form.get('metadata[tenantId]'), userId: form.get('metadata[userId]') },
      url: 'https://verify.stripe.com/start/opaque-link', client_secret: 'SECRET-CANARY', verified_outputs: { first_name: 'DOCUMENT-PII-CANARY' }, last_error: { reason: 'RAW-ERROR-CANARY' } };
  }
  return Response.json(remote);
}
async function event(type: string, changes: Record<string, any> = {}, id = `evt_${randomUUID().replaceAll('-', '')}`, created = Math.floor(Date.now() / 1000), signature = true) {
  const body = JSON.stringify({ id, type: `identity.verification_session.${type}`, livemode: remote.livemode, created, data: { object: { ...remote, ...changes } } });
  const timestamp = Math.floor(Date.now() / 1000), value = createHmac('sha256', config.STRIPE_WEBHOOK_SECRET).update(`${timestamp}.${body}`).digest('hex');
  return app.inject({ method: 'POST', url: '/api/v1/webhooks/stripe', headers: { 'content-type': 'application/json', 'stripe-signature': signature ? `t=${timestamp},v1=${value}` : 'invalid' }, payload: body });
}
beforeEach(async () => {
  Object.assign(process.env, config); delete process.env.STRIPE_IDENTITY_RETURN_URL;
  store = new Store(); calls = []; cookie = 'identity-session'; remote = {};
  seedMember(store, { userId: 'owner', tenantId: 'tenant', role: 'owner' });
  for (const value of ['identity-session', 'identity-new-session']) store.db.prepare('INSERT INTO sessions(hash,user_id,expires) VALUES(?,?,?)').run(hash(value), 'owner', Date.now() + 3600000);
  seedMemberships(store); respond = fixtureResponse;
  globalThis.fetch = (async (url: string | URL | Request, init: RequestInit = {}) => { calls.push({ url: String(url), init }); return respond(String(url), init); }) as typeof fetch;
  app = Fastify(); app.addHook('onRequest', async request => { request.cookies = { kloel_session: cookie }; request.actor = resolveSessionContext(store, hash(cookie))?.actor; });
  await registerProviders(app, store); await app.ready();
});
afterEach(async () => { await app.close(); store.close(); globalThis.fetch = savedFetch; for (const name of envNames) { if (savedEnv[name] === undefined) delete process.env[name]; else process.env[name] = savedEnv[name]; } });

test('create reserves one operation, sends opaque metadata, stores no hosted secrets or documents', async () => {
  const tables = store.db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name").all();
  const key = randomUUID(), result = await start(key); assert.equal(result.statusCode, 200, result.body);
  assert.equal(result.json().operation.status, 'succeeded'); assert.equal(result.json().operation.verification.verified, false);
  const form = new URLSearchParams(String(calls[1].init.body));
  assert.equal(form.get('return_url'), 'http://localhost:3000/app/billing/identity'); assert.equal(form.get('type'), 'document');
  assert.equal(form.get('options[document][require_matching_selfie]'), 'true');
  assert.deepEqual([...form.keys()].sort(), ['client_reference_id', 'metadata[kloelIdentityId]', 'metadata[tenantId]', 'metadata[userId]', 'options[document][require_matching_selfie]', 'return_url', 'type'].sort());
  assert.equal(String(new Headers(calls[1].init.headers).get('Idempotency-Key')).length, 64);
  const stored = JSON.stringify(store.list('tenant', identityCollection));
  for (const canary of ['verify.stripe.com', 'SECRET-CANARY', 'DOCUMENT-PII-CANARY', 'RAW-ERROR-CANARY', config.STRIPE_SECRET_KEY]) { assert.ok(!stored.includes(canary)); assert.ok(!result.body.includes(canary)); }
  assert.deepEqual(store.db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name").all(), tables);
  const callsBefore = calls.length; assert.equal((await start(key)).statusCode, 200); assert.equal((await operation(key)).json().key, key);
  assert.equal(calls.length, callsBefore); assert.equal((await state()).headers['cache-control'], 'no-store'); assert.equal(calls.length, callsBefore);
  assert.equal((await start()).statusCode, 409); assert.equal(creates(), 1);
});

test('fresh resume obtains URL via GET, reuses same session and never persists the URL', async () => {
  await start(); remote.url = 'https://verify.stripe.com/start/new-one';
  const result = await action('resume'); assert.equal(result.statusCode, 200, result.body); assert.equal(result.json().url, remote.url);
  assert.equal(result.json().verification.canResume, true); assert.equal(result.headers['referrer-policy'], 'no-referrer');
  remote.url = 'https://verify.stripe.com/start/new-two'; assert.equal((await action('resume')).json().url, remote.url);
  assert.equal(creates(), 1); assert.ok(!JSON.stringify(row()).includes('verify.stripe.com')); assert.ok(!(await state()).body.includes('verify.stripe.com'));
});

test('test mode completion never yields a production verified verdict', async () => {
  await start(); remote.status = 'verified'; const result = await action();
  assert.equal(result.json().state, 'verified'); assert.equal(result.json().mode, 'test'); assert.equal(result.json().verified, false);
  assert.equal((await action('resume')).json().url, null); assert.equal((await state()).json().verification.verified, false);
});

test('live verdict requires a bound Stripe GET; webhook is only an invalidation', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_live_fixture'; await start(); remote.status = 'verified';
  assert.equal((await event('verified')).statusCode, 200); assert.equal((await state()).json().verification.verified, false);
  assert.equal((await action()).json().verified, true); assert.equal((await state()).json().verification.verified, true);
  assert.equal((await event('processing')).statusCode, 200); assert.equal((await state()).json().verification.verified, false);
  remote.status = 'processing'; const result = await action(); assert.equal(result.json().verified, false); assert.equal(result.json().state, 'processing');
});

test('redaction immediately removes verdict and GET accepts stripped Stripe metadata for the known session', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_live_fixture'; await start(); remote.status = 'verified'; await action();
  remote.metadata = {}; remote.client_reference_id = null; remote.redaction = { status: 'redacted' };
  assert.equal((await event('redacted')).statusCode, 200); assert.equal((await state()).json().verification.verified, false);
  const result = await action(); assert.equal(result.statusCode, 200, result.body); assert.equal(result.json().state, 'redacted'); assert.equal(result.json().verified, false);
});

test('untrusted or malformed hosted URLs are rejected without disclosure', async () => {
  await start();
  for (const url of ['https://evil.example/start/PII-CANARY', 'http://verify.stripe.com/start/x', 'https://verify.stripe.com@evil.example/start/x', 'https://verify.stripe.com:444/start/x', 'https://verify.stripe.com/other/x']) {
    remote.url = url; const result = await action('resume'); assert.equal(result.statusCode, 502); assert.ok(!result.body.includes(url)); assert.equal(result.json().error.code, 'identity_invalid_response');
  }
});

test('server return override supports new app port but rejects query, credentials, foreign paths and plaintext external hosts', async () => {
  for (const value of ['/app/billing/identity', 'https://example.test/app/other', 'https://u:p@example.test/app/billing/identity', 'https://example.test/app/billing/identity?verified=1', 'http://example.test/app/billing/identity']) {
    process.env.STRIPE_IDENTITY_RETURN_URL = value; assert.equal((await start()).json().error.code, 'identity_return_invalid');
  }
  assert.equal(calls.length, 0);
  process.env.STRIPE_IDENTITY_RETURN_URL = 'http://127.0.0.1:3004/app/billing/identity'; assert.equal((await start()).statusCode, 200);
  assert.equal(new URLSearchParams(String(calls[1].init.body)).get('return_url'), process.env.STRIPE_IDENTITY_RETURN_URL); assert.equal(process.env.APP_ORIGIN, 'http://localhost:3000');
});

test('ownership follows same active membership across login but never another user', async () => {
  const key = randomUUID(); await start(key); const verificationId = row().id;
  cookie = 'identity-new-session'; assert.equal((await operation(key)).statusCode, 200); assert.equal((await action('resume', verificationId)).statusCode, 200);
  seedMember(store, { userId: 'other', tenantId: 'tenant', role: 'owner' });
  store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(hash('other-session'), 'other', 'tenant', Date.now() + 3600000); cookie = 'other-session';
  const before = calls.length; assert.equal((await operation(key)).statusCode, 404); assert.equal((await action('resume', verificationId)).statusCode, 404); assert.equal((await state()).json().verification, null); assert.equal(calls.length, before);
});

test('deleted and recreated membership cannot claim prior verification', async () => {
  const key = randomUUID(); await start(key); const id = row().id;
  store.db.prepare('DELETE FROM memberships WHERE user_id=?').run('owner'); seedMember(store, { userId: 'owner', tenantId: 'tenant', role: 'owner' });
  assert.equal((await operation(key)).statusCode, 404); assert.equal((await action('resume', id)).statusCode, 404); assert.equal((await state()).json().verification, null);
});

test('missing role, mismatched tenant, body extras and bearer auth reject before effects', async () => {
  assert.equal((await start(randomUUID(), { expectedTenantId: 'other' })).statusCode, 409);
  assert.equal((await start(randomUUID(), { returnUrl: 'https://evil.example' })).statusCode, 400);
  assert.equal((await app.inject({ url: '/api/v1/billing/identity', headers: { ...headers(), authorization: 'Bearer fixture' } })).statusCode, 403);
  store.db.prepare("UPDATE memberships SET role='viewer',revision=revision+1 WHERE user_id='owner'").run(); assert.equal((await start()).statusCode, 403); assert.equal(calls.length, 0);
});

test('revocation during create persists external receipt and discloses nothing', async () => {
  respond = async (url, init) => { const response = await fixtureResponse(url, init); if (init.method === 'POST') store.db.prepare('DELETE FROM sessions WHERE hash=?').run(hash(cookie)); return response; };
  const result = await start(); assert.equal(result.statusCode, 409); assert.equal(result.json().error.code, 'context_changed_in_flight'); assert.ok(!result.body.includes('verify.stripe.com')); assert.equal(row().providerSessionId, 'vs_fixture'); assert.equal(row().operationStatus, 'succeeded'); assert.equal(creates(), 1);
});

test('revocation during resume blocks URL and does not confirm a new verdict', async () => {
  await start(); respond = async (url, init) => { const result = await fixtureResponse(url, init); if (url.endsWith('/vs_fixture')) store.db.prepare('DELETE FROM sessions WHERE hash=?').run(hash(cookie)); return result; };
  const result = await action('resume'); assert.equal(result.statusCode, 409); assert.equal(result.json().error.code, 'context_changed_in_flight'); assert.ok(!result.body.includes('verify.stripe.com')); assert.equal(row().confirmedAt, null);
});

test('configuration and account drift fail closed and hide cached live verification', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_live_fixture'; await start(); remote.status = 'verified'; await action();
  respond = async (url, init) => url.endsWith('/account') ? Response.json({ id: 'acct_other' }) : fixtureResponse(url, init);
  assert.equal((await action('resume')).json().error.code, 'identity_account_changed');
  process.env.STRIPE_SECRET_KEY = 'sk_test_other'; const result = await state(); assert.equal(result.json().verification.verified, false); assert.equal(result.json().verification.state, 'unknown');
  assert.equal((await action('resume')).statusCode, 409); assert.equal((await operation()).statusCode, 409); assert.equal((await start()).statusCode, 409);
  delete process.env.STRIPE_SECRET_KEY; const unavailable = (await state()).json(); assert.equal(unavailable.configured, false); assert.equal(unavailable.mode, 'unavailable'); assert.equal(unavailable.verification.verified, false); assert.equal(unavailable.verification.canResume, false); assert.equal(unavailable.verification.requiresReconciliation, true);
});

test('concurrent same-key creates return the original reservation and perform only one POST', async () => {
  const key = randomUUID(); let pending = 0, release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  respond = async (url, init) => { if (url.endsWith('/account')) { pending++; if (pending === 2) release(); await gate; } return fixtureResponse(url, init); };
  const results = await Promise.all([start(key), start(key)]); for (const result of results) assert.equal(result.statusCode, 200, result.body);
  assert.equal(results[0].json().operation.verification.id, results[1].json().operation.verification.id); assert.equal(creates(), 1); assert.equal(store.list('tenant', identityCollection).length, 1);
});

test('lost create response retains unknown operation; same or different keys cannot create twice', async () => {
  const key = randomUUID(); respond = async (url, init) => { const response = await fixtureResponse(url, init); if (init.method === 'POST') throw new Error('RAW-NETWORK-SECRET'); return response; };
  const result = await start(key); assert.equal(result.statusCode, 502); assert.ok(!result.body.includes('RAW-NETWORK-SECRET')); assert.equal((await operation(key)).json().status, 'unknown');
  assert.equal((await start(key)).statusCode, 200); assert.equal((await start()).statusCode, 409); assert.equal(creates(), 1); assert.equal((await action()).json().error.code, 'identity_creation_unconfirmed');
  assert.equal((await event('created')).statusCode, 200); respond = fixtureResponse;
  assert.equal((await action('resume')).statusCode, 200); assert.equal((await operation(key)).json().status, 'succeeded'); assert.equal(creates(), 1);
});

test('definite provider rejection is sanitized and allows a fresh explicit attempt', async () => {
  respond = async (url, init) => init.method === 'POST' ? Response.json({ error: { message: 'RAW-PII-CANARY' } }, { status: 403 }) : fixtureResponse(url, init);
  const result = await start(); assert.equal(result.statusCode, 502); assert.ok(!result.body.includes('RAW-PII-CANARY')); assert.equal(row().state, 'failed');
  respond = fixtureResponse; assert.equal((await start()).statusCode, 200); assert.equal(creates(), 2);
});

test('Stripe binding mismatch cannot approve or leak a session URL', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_live_fixture'; await start(); remote.status = 'verified';
  for (const mutation of [{ id: 'vs_other' }, { livemode: false }, { options: { document: { require_matching_selfie: false } } }, { client_reference_id: 'other' }, { metadata: { tenantId: 'other' } }]) {
    const previous = { ...remote }; Object.assign(remote, mutation); const result = await action(); assert.equal(result.statusCode, 502); assert.equal(row().confirmedAt, null); remote = previous;
  }
});

test('signed webhook rejects bad signature, deduplicates, ignores older events and preserves billing data', async () => {
  await start(); const billing = store.create('tenant', 'billing-accounts', { customerId: 'cus_fixture', checkoutStatus: 'paid' });
  assert.equal((await event('verified', {}, 'evt_signature', undefined, false)).statusCode, 401);
  const created = Math.floor(Date.now() / 1000); assert.equal((await event('processing', {}, 'evt_once', created)).statusCode, 200);
  const first = JSON.stringify(row()); assert.equal((await event('verified', {}, 'evt_once', created)).json().duplicate, true); assert.equal(JSON.stringify(row()), first);
  await event('redacted', {}, 'evt_older', created - 1); assert.equal(JSON.stringify(row()), first);
  await event('verified', { id: 'vs_other', metadata: {} }, 'evt_other', created + 1); assert.equal(JSON.stringify(row()), first);
  assert.deepEqual(store.get('tenant', 'billing-accounts', billing.id), billing); assert.equal(creates(), 1);
});

test('webhook during GET creates a retry boundary and cannot be overwritten by stale verification', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_live_fixture'; await start(); remote.status = 'verified';
  respond = async (url, init) => { const result = await fixtureResponse(url, init); if (url.endsWith('/vs_fixture')) await event('processing'); return result; };
  const result = await action(); assert.equal(result.statusCode, 409); assert.equal(result.json().error.code, 'identity_changed_retry'); assert.equal((await state()).json().verification.verified, false);
});

test('session creation response claiming verified is never enough for a live verdict', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_live_fixture'; respond = async (url, init) => { const response = await fixtureResponse(url, init); if (init.method !== 'POST') return response; remote.status = 'verified'; return Response.json(remote); };
  const result = await start(); assert.equal(result.statusCode, 200); assert.equal(result.json().operation.verification.state, 'pending'); assert.equal(result.json().operation.verification.verified, false);
  assert.equal((await action()).json().verified, true);
});
