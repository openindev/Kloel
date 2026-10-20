import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createWhatsAppWorker, whatsappJobVersion } from '../src/providers/worker.js';
import { resolveSessionContext } from '../src/request-context.js';
import { whatsappWorkerOnceHttpFixture } from './fixtures/whatsapp-worker-once-http.js';

const gate = () => { let release!: () => void; const promise = new Promise<void>(r => { release = r; }); return { promise, release }; };

test('authenticated HTTP once executes exactly one job and GET reads its original local receipt', async t => {
  const f = await whatsappWorkerOnceHttpFixture(t), before = f.snapshot();
  const missing = await f.receipt(); assert.equal(missing.statusCode, 404); assert.deepEqual(f.snapshot(), before); assert.equal(f.calls.length, 0);
  const sent = await f.run(); assert.equal(sent.statusCode, 200, sent.body); const value = sent.json();
  assert.deepEqual(Object.keys(value).sort(), ['initialVersion','jobId','operation','tenantId']);
  assert.equal(value.tenantId, f.tenant); assert.equal(value.jobId, f.job.id); assert.equal(value.initialVersion, f.initialVersion);
  assert.equal(value.operation.status, 'sent'); assert.equal(value.operation.externalEffect, 'accepted'); assert.equal(value.operation.localLink, 'linked'); assert.equal(value.operation.replayed, false); assert.equal(value.operation.automaticRetry, false);
  const snapshot = f.snapshot(), calls = f.calls.length, read = await f.receipt(); assert.equal(read.statusCode, 200, read.body); assert.equal(read.json().operation.replayed, true);
  assert.deepEqual(f.snapshot(), snapshot); assert.equal(f.calls.length, calls); assert.equal(calls, 2); assert.equal(process.env.WHATSAPP_AUTOREPLY_ENABLED, 'false');
});

test('GET missing or queued job stays readonly even with all provider configuration absent', async t => {
  const f = await whatsappWorkerOnceHttpFixture(t), before = f.snapshot();
  for (const key of ['META_ACCESS_TOKEN','META_PHONE_NUMBER_ID','OPENAI_API_KEY','OPENAI_MODEL']) delete process.env[key];
  assert.equal((await f.receipt()).statusCode, 404);
  const missing = await f.request('GET', '/jobs/nonexistent/manual-once?expectedVersion=' + f.initialVersion); assert.equal(missing.statusCode, 404);
  assert.deepEqual(f.snapshot(), before); assert.equal(f.calls.length, 0); assert.equal(f.current().executionMode, undefined);
});

test('dedicated getter cannot enter runJobOnce and rejects alternate owner or version', async t => {
  const f = await whatsappWorkerOnceHttpFixture(t), w = createWhatsAppWorker(f.store); t.after(() => w.stop());
  const input = { tenantId: f.tenant, jobId: f.job.id, expectedVersion: f.initialVersion, authority: { sessionHash: f.sessionHash, context: resolveSessionContext(f.store, f.sessionHash)!.context }, assertAccess: () => {} };
  w.runJobOnce = async () => { throw Error('Getter entered executor'); };
  assert.equal(w.getJobOnceOperation(input), undefined); assert.equal((await f.run()).statusCode, 200);
  const before = f.snapshot(), calls = f.calls.length; delete process.env.META_ACCESS_TOKEN;
  assert.equal(w.getJobOnceOperation(input)!.externalEffect, 'accepted');
  assert.throws(() => w.getJobOnceOperation({ ...input, expectedVersion: 'a'.repeat(64) }), /manual_once_owner_conflict/);
  assert.deepEqual(f.snapshot(), before); assert.equal(f.calls.length, calls);
});

for (const extra of [{ authority: {} }, { sessionHash: 'a'.repeat(64) }, { recipient: '+5511000000000' }, { text: 'Not allowed' }, { confirm: false }, { expectedVersion: 'invalid' }]) test(`strict body rejects caller-controlled ${Object.keys(extra)[0]} before effects`, async t => {
  const f = await whatsappWorkerOnceHttpFixture(t), before = f.snapshot(), r = await f.run({ ...f.input, ...extra });
  assert.equal(r.statusCode, 400, r.body); assert.equal(r.json().error.code, 'invalid_input'); assert.deepEqual(f.snapshot(), before); assert.equal(f.calls.length, 0);
});

test('cookie plus all four context headers are mandatory and cannot select another tenant', async t => {
  const f = await whatsappWorkerOnceHttpFixture(t), before = f.snapshot(), url = '/api/v1/whatsapp' + f.path;
  const absent = await f.app.inject({ method: 'POST', url, payload: f.input, headers: { cookie: 'kloel_session=' + f.cookies.owner } }); assert.equal(absent.statusCode, 400); assert.equal(absent.json().error.code, 'expected_context_required');
  const partial = await f.app.inject({ method: 'POST', url, payload: f.input, headers: { cookie: 'kloel_session=' + f.cookies.owner, 'x-kloel-expected-user': f.actors.owner.userId } }); assert.equal(partial.statusCode, 400);
  const none = await f.app.inject({ method: 'POST', url, payload: f.input }); assert.equal(none.statusCode, 401);
  const foreignCookie = await f.app.inject({ method: 'POST', url, payload: f.input, headers: { ...f.contexts.owner, cookie: 'kloel_session=' + f.cookies.foreign } }); assert.equal(foreignCookie.statusCode, 409); assert.equal(foreignCookie.json().error.code, 'context_mismatch');
  const tenant = await f.run({ ...f.input, expectedTenantId: 'foreign-tenant' }); assert.equal(tenant.statusCode, 409);
  assert.deepEqual(f.snapshot(), before); assert.equal(f.calls.length, 0);
});

for (const who of ['member','editor']) test(`${who} cannot execute or inspect a manual once receipt`, async t => {
  const f = await whatsappWorkerOnceHttpFixture(t), before = f.snapshot();
  assert.equal((await f.run(f.input, who)).statusCode, 403); assert.equal((await f.receipt(f.initialVersion, who)).statusCode, 403);
  assert.deepEqual(f.snapshot(), before); assert.equal(f.calls.length, 0);
});

test('query/body limits and API-key authentication do not enter executor', async t => {
  const f = await whatsappWorkerOnceHttpFixture(t), before = f.snapshot();
  const unknown = await f.request('GET', f.path + '?expectedVersion=' + f.initialVersion + '&confirm=true'); assert.equal(unknown.statusCode, 400);
  const omitted = await f.request('GET', f.path); assert.equal(omitted.statusCode, 400);
  const apiKey = await f.app.inject({ method: 'POST', url: '/api/v1/whatsapp' + f.path, payload: f.input, headers: { authorization: 'Bearer synthetic-invalid-api-key' } }); assert.ok([401,403].includes(apiKey.statusCode));
  assert.deepEqual(f.snapshot(), before); assert.equal(f.calls.length, 0);
});

test('pending GET and concurrent POST replay one original claim without draining another queued job', async t => {
  const f = await whatsappWorkerOnceHttpFixture(t), entered = gate(), release = gate();
  const other = f.store.create(f.tenant, 'reply-jobs', { provider: 'meta', status: 'queued', dueAt: 0, attempts: 0 }), original = f.store.get(f.tenant, 'reply-jobs', other.id);
  f.hooks.provider = async url => { if (url.includes('openai')) { entered.release(); await release.promise; return f.generated(); } return f.accepted('wamid.http-held'); };
  const running = f.run(); await entered.promise;
  const read = await f.receipt(); assert.equal(read.statusCode, 200, read.body); assert.equal(read.json().operation.status, 'generating'); assert.equal(read.json().operation.requiresReconciliation, true);
  const repeated = await f.run(); assert.equal(repeated.statusCode, 200); assert.equal(repeated.json().operation.replayed, true); assert.equal(f.calls.length, 1);
  release.release(); assert.equal((await running).statusCode, 200); assert.equal(f.calls.length, 2); assert.deepEqual(f.store.get(f.tenant, 'reply-jobs', other.id), original);
});

test('lost response followed by local GET retains receipt despite channel deletion and configuration removal', async t => {
  const f = await whatsappWorkerOnceHttpFixture(t); const ignored = await f.run(); assert.equal(ignored.statusCode, 200);
  f.store.remove(f.tenant, 'channels', f.channel.id); f.store.remove(f.tenant, 'agents', f.agent.id);
  for (const key of ['META_ACCESS_TOKEN','META_PHONE_NUMBER_ID','OPENAI_API_KEY','OPENAI_MODEL']) delete process.env[key];
  const before = f.snapshot(), r = await f.receipt(); assert.equal(r.statusCode, 200, r.body); assert.equal(r.json().operation.status, 'sent');
  const replay = await f.run(); assert.equal(replay.statusCode, 200); assert.equal(replay.json().operation.replayed, true);
  assert.deepEqual(f.snapshot(), before); assert.equal(f.calls.length, 2);
  const serialized = JSON.stringify(r.json()); for (const privateValue of [f.sessionHash, f.cookies.owner, f.sender, 'Synthetic generated answer only', 'wamid.http-once', f.env.META_ACCESS_TOKEN]) assert.equal(serialized.includes(privateValue), false);
});

test('another session, operator, membership ABA or current job version cannot adopt original receipt', async t => {
  const f = await whatsappWorkerOnceHttpFixture(t); assert.equal((await f.run()).statusCode, 200);
  assert.equal((await f.receipt(f.initialVersion, 'other')).statusCode, 404); assert.equal((await f.run(f.input, 'other')).statusCode, 409);
  assert.equal((await f.receipt(f.initialVersion, 'foreign')).statusCode, 404); assert.equal((await f.receipt(whatsappJobVersion(f.current()))).statusCode, 404);
  const token = 'synthetic-http-second-owner-session', hash = createHash('sha256').update(token).digest('hex'); f.store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(hash, f.actors.owner.userId, f.tenant, Date.now()+60000);
  const original = f.cookies.owner; f.cookies.owner = token; await f.refreshContext(); assert.equal((await f.receipt()).statusCode, 404); f.cookies.owner = original; await f.refreshContext();
  f.aba(); const stale = await f.receipt(); assert.equal(stale.statusCode, 409); await f.refreshContext(); assert.equal((await f.receipt()).statusCode, 404); assert.equal(f.calls.length, 2);
});

test('authority changed inside BEGIN rolls back claim and causes zero provider calls', async t => {
  const f = await whatsappWorkerOnceHttpFixture(t), original = f.store.transaction.bind(f.store), before = f.snapshot(); let once = true;
  f.store.transaction = ((fn: () => unknown) => original(() => { if (once) { once = false; f.aba(); } return fn(); })) as typeof f.store.transaction;
  const r = await f.run(); assert.equal(r.statusCode, 403, r.body); assert.deepEqual(f.snapshot(), before); assert.equal(f.calls.length, 0);
});

test('revocation during generation prevents Meta and leaves readonly failure proof under original job', async t => {
  const f = await whatsappWorkerOnceHttpFixture(t); f.hooks.provider = () => { f.store.db.prepare('DELETE FROM sessions WHERE hash=?').run(f.sessionHash); return f.generated(); };
  const r = await f.run(); assert.ok([403,409].includes(r.statusCode)); assert.equal(f.current().manualOnceEffect, 'not_dispatched'); assert.equal(f.current().status, 'failed'); assert.equal(f.calls.length, 1);
  assert.equal((await f.receipt()).statusCode, 401);
});

test('accepted response followed by authority revocation preserves journal while denying HTTP disclosure', async t => {
  const f = await whatsappWorkerOnceHttpFixture(t); f.hooks.provider = url => { if (url.includes('openai')) return f.generated(); f.store.db.prepare('DELETE FROM sessions WHERE hash=?').run(f.sessionHash); return f.accepted('wamid.http-revoked'); };
  const r = await f.run(); assert.ok([403,409].includes(r.statusCode)); assert.equal(r.json().operation, undefined); assert.equal(f.current().manualOnceEffect, 'accepted'); assert.equal(f.current().status, 'requires_reconciliation'); assert.equal(f.current().manualOnceMessageId, undefined); assert.equal(f.calls.length, 2);
  assert.equal((await f.receipt(f.initialVersion, 'other')).statusCode, 404);
});

test('accepted late configuration change is recovered without relink or another provider request', async t => {
  const f = await whatsappWorkerOnceHttpFixture(t); f.hooks.provider = url => { if (url.includes('openai')) return f.generated(); process.env.META_ACCESS_TOKEN = 'synthetic-new-config'; return f.accepted('wamid.http-late-config'); };
  const r = await f.run(); assert.equal(r.statusCode, 409); const before = f.snapshot(), read = await f.receipt(); assert.equal(read.statusCode, 200, read.body);
  assert.equal(read.json().operation.externalEffect, 'accepted'); assert.equal(read.json().operation.localLink, 'not_linked'); assert.equal(read.json().operation.requiresReconciliation, true);
  assert.deepEqual(f.snapshot(), before); assert.equal(f.calls.length, 2);
});

for (const failure of ['openai','rejected','unknown']) test(`${failure} preserves a terminal or unknown receipt without POST retry`, async t => {
  const f = await whatsappWorkerOnceHttpFixture(t); f.hooks.provider = url => url.includes('openai') ? failure === 'openai' ? new Response('private failed generation', { status: 429 }) : f.generated() : new Response('private provider body', { status: failure === 'rejected' ? 400 : 503 });
  const r = await f.run(); assert.ok(r.statusCode >= 400); const before = f.snapshot(), read = await f.receipt(); assert.equal(read.statusCode, 200, read.body);
  assert.equal(read.json().operation.externalEffect, failure === 'openai' ? 'not_dispatched' : failure === 'rejected' ? 'not_accepted' : 'unconfirmed');
  assert.equal(read.json().operation.requiresReconciliation, failure === 'unknown'); assert.equal(JSON.stringify(read.json()).includes('private'), false);
  assert.equal((await f.run()).statusCode, 200); assert.deepEqual(f.snapshot(), before); assert.equal(f.calls.length, failure === 'openai' ? 1 : 2);
});

test('application close drains the active accepted response before closing Store', async t => {
  const f = await whatsappWorkerOnceHttpFixture(t), entered = gate(), release = gate(); let atClose: unknown;
  const originalClose = f.store.close.bind(f.store); f.store.close = () => { atClose = f.current().manualOnceEffect; originalClose(); };
  f.hooks.provider = async url => { if (url.includes('openai')) return f.generated(); entered.release(); await release.promise; return f.accepted('wamid.http-closing'); };
  const running = f.run(); await entered.promise; const closing = f.app.close(); assert.equal(atClose, undefined);
  release.release(); await running; await closing; assert.equal(atClose, 'accepted'); assert.equal(f.calls.length, 2);
});
