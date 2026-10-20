import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.js';
import { buildApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';
import { processRecoveryMail } from '../src/auth-recovery.js';

const requestPath = '/api/v1/auth/forgot-password', resetPath = '/api/v1/auth/reset-password';
const originalPassword = 'original-test-password', replacement = 'replacement-test-password';
const cookie = (r: any) => ({ kloel_session: r.cookies.find((c: any) => c.name === 'kloel_session').value as string });
function env(t: any) {
  const values = { OAUTH_ENCRYPTION_KEY: randomBytes(32).toString('base64'), RESEND_API_KEY: 'test-only-resend-key', RESEND_FROM: 'Kloel <sender@example.test>', APP_ORIGIN: 'http://127.0.0.1:4310' };
  const before = Object.fromEntries(Object.keys(values).map(k => [k, process.env[k]])); Object.assign(process.env, values);
  t.after(() => { for (const [k, v] of Object.entries(before)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
}
async function fixture(t: any) {
  env(t); const store = new Store(), app = await buildApp(store); t.after(() => app.close());
  const account = await app.inject({ method: 'POST', url: '/api/v1/auth/signup', payload: { email: 'owner@example.test', password: originalPassword, organization: 'Recovery fixture' } });
  const request = (email = 'owner@example.test') => app.inject({ method: 'POST', url: requestPath, payload: { email } });
  const reset = (token: string) => app.inject({ method: 'POST', url: resetPath, payload: { token, password: replacement, confirmation: replacement } });
  const sent: Record<string, any>[] = [];
  const fetchImpl = (async (url: any, init: RequestInit) => { assert.equal(String(url), 'https://api.resend.com/emails'); const data = JSON.parse(String(init.body)); sent.push(data); return new Response(JSON.stringify({ id: `synthetic-${sent.length}` }), { status: 200 }); }) as typeof fetch;
  const deliver = () => processRecoveryMail(store, { fetchImpl });
  const token = () => { const link = String(sent.at(-1)!.text).match(/http:\/\/127\.0\.0\.1:4310\/reset-password#token=([A-Za-z0-9_-]{43})/); assert.ok(link, 'reset link in synthetic transport'); return link[1]; };
  return { store, app, account, request, reset, sent, deliver, token };
}

test('known and unknown accounts receive identical queued responses; tokens and mail content stay encrypted', async t => {
  const f = await fixture(t), known = await f.request(), unknown = await f.request('absent@example.test');
  assert.equal(known.statusCode, 202); assert.equal(unknown.statusCode, 202); assert.deepEqual(known.json(), unknown.json());
  assert.equal(f.sent.length, 0, 'HTTP request never waits on or invokes delivery');
  await f.deliver(); const token = f.token(); await f.deliver();
  assert.equal(f.sent.length, 1); assert.equal(f.sent[0].to[0], 'owner@example.test');
  const rows = JSON.stringify(f.store.db.prepare('SELECT * FROM auth_recovery_requests').all());
  const jobs = JSON.stringify(f.store.db.prepare('SELECT * FROM auth_recovery_mail_jobs').all());
  assert.ok(!rows.includes(token) && !jobs.includes(token)); assert.ok(!rows.includes('owner@example.test'));
  assert.ok(!known.body.includes(token));
  assert.deepEqual(f.store.db.prepare('SELECT status FROM auth_recovery_mail_jobs ORDER BY rowid').all().map(r => r.status), ['accepted', 'ignored']);
});

test('single-use reset changes the password, revokes every session and API key, then queues a secret-free notification', async t => {
  const f = await fixture(t), jar = cookie(f.account);
  const key = (await f.app.inject({ method: 'POST', url: '/api/v1/api-keys', cookies: jar, payload: { name: 'Recovery key', scopes: ['agents:read'] } })).json();
  const second = await f.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'owner@example.test', password: originalPassword } });
  await f.request(); await f.deliver(); const token = f.token();
  const reset = await f.reset(token); assert.equal(reset.statusCode, 200, reset.body); assert.equal(reset.json().loginRequired, true);
  assert.equal((await f.reset(token)).statusCode, 400);
  assert.equal((await f.app.inject({ url: '/api/v1/auth/me', cookies: jar })).statusCode, 401);
  assert.equal((await f.app.inject({ url: '/api/v1/auth/me', cookies: cookie(second) })).statusCode, 401);
  assert.equal((await f.app.inject({ url: '/api/v1/agents', headers: { authorization: `Bearer ${key.secret}` } })).statusCode, 401);
  assert.equal((await f.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'owner@example.test', password: originalPassword } })).statusCode, 401);
  assert.equal((await f.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'owner@example.test', password: replacement } })).statusCode, 200);
  await f.deliver(); assert.equal(f.sent.length, 2); assert.ok(!f.sent[1].text.includes(token)); assert.ok(!f.sent[1].text.includes(replacement));
  assert.ok(f.store.db.prepare('SELECT revoked_at FROM api_keys WHERE id=?').get(key.id)?.revoked_at);
});

test('expiry, another password change and mismatched confirmation cannot reset an account', async t => {
  const f = await fixture(t); await f.request(); await f.deliver(); const expired = f.token();
  f.store.db.prepare('UPDATE auth_recovery_requests SET expires_at=0').run(); assert.equal((await f.reset(expired)).statusCode, 400);
  await f.request(); await f.deliver(); const obsolete = f.token();
  const mismatch = await f.app.inject({ method: 'POST', url: resetPath, payload: { token: obsolete, password: replacement, confirmation: 'a-different-password' } }); assert.equal(mismatch.statusCode, 400);
  f.store.db.prepare('UPDATE users SET password=? WHERE id=?').run(hashPassword('changed-outside-recovery'), f.account.json().userId);
  assert.equal((await f.reset(obsolete)).statusCode, 400);
  assert.equal((await f.reset(randomBytes(32).toString('base64url'))).statusCode, 400);
});

test('uncertain mail delivery is never retried and acceptance is not delivery confirmation', async t => {
  const f = await fixture(t); await f.request(); let calls = 0;
  const fetchImpl = (async () => { calls++; throw new Error('Synthetic timeout after possible acceptance'); }) as typeof fetch;
  await processRecoveryMail(f.store, { fetchImpl }); await processRecoveryMail(f.store, { fetchImpl });
  assert.equal(calls, 1);
  const job = f.store.db.prepare('SELECT * FROM auth_recovery_mail_jobs').get()!;
  assert.equal(job.status, 'uncertain'); assert.equal(job.encrypted_payload, null);
});

test('missing or malformed provider IDs cannot claim mail acceptance', async t => {
  const f = await fixture(t);
  for (const id of ['', '   ', null]) {
    await f.request();
    await processRecoveryMail(f.store, { fetchImpl: (async () => new Response(JSON.stringify({ id }), { status: 200 })) as typeof fetch });
  }
  const rows = f.store.db.prepare('SELECT status,provider_id FROM auth_recovery_mail_jobs').all();
  assert.equal(rows.length, 3); assert.ok(rows.every(row => row.status === 'uncertain' && row.provider_id === null));
});

test('per-account durable limits do not reveal account existence or invalidate an earlier link', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 4; i++) assert.equal((await f.request()).statusCode, 202);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM auth_recovery_requests').get()?.n, 3);
  await f.deliver(); const first = f.token(); assert.equal((await f.reset(first)).statusCode, 200);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM auth_recovery_requests WHERE consumed_at IS NULL').get()?.n, 0);
});

test('reset origin cannot come from Host, caller return URL or another website', async t => {
  const f = await fixture(t);
  assert.equal((await f.app.inject({ method: 'POST', url: requestPath, headers: { origin: 'https://attacker.example' }, payload: { email: 'owner@example.test' } })).statusCode, 403);
  assert.equal((await f.app.inject({ method: 'POST', url: requestPath, payload: { email: 'owner@example.test', returnTo: 'https://attacker.example' } })).statusCode, 400);
  assert.equal((await f.app.inject({ method: 'POST', url: requestPath, headers: { host: 'attacker.example' }, payload: { email: 'owner@example.test' } })).statusCode, 202);
  await f.deliver(); assert.ok(f.token()); assert.ok(!f.sent[0].text.includes('attacker.example'));
});

test('queued recovery survives restart and interrupted remote writes are quarantined before workers start', async t => {
  env(t); const dir = mkdtempSync(join(tmpdir(), 'kloel-recovery-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const db = join(dir, 'db.sqlite'); let store = new Store(db), app = await buildApp(store); t.after(() => app.close());
  await app.inject({ method: 'POST', url: '/api/v1/auth/signup', payload: { email: 'persistent@example.test', password: originalPassword, organization: 'Persistent' } });
  await app.inject({ method: 'POST', url: requestPath, payload: { email: 'persistent@example.test' } }); await app.close();
  store = new Store(db); app = await buildApp(store);
  assert.equal(store.db.prepare('SELECT status FROM auth_recovery_mail_jobs').get()?.status, 'queued');
  store.db.prepare("UPDATE auth_recovery_mail_jobs SET status='pending'").run(); await app.close();
  process.env.RESEND_API_KEY = ''; store = new Store(db); app = await buildApp(store, { workers: true }); await app.ready();
  const job = store.db.prepare('SELECT * FROM auth_recovery_mail_jobs').get()!;
  assert.equal(job.status, 'uncertain'); assert.equal(job.encrypted_payload, null);
});

test('recovery forms use POST even without JavaScript so passwords cannot enter the URL', async t => {
  const app = await buildApp(new Store()); t.after(() => app.close());
  for (const name of ['forgot-password', 'reset-password']) {
    const page = await app.inject(`/${name}`); assert.equal(page.statusCode, 200);
    assert.match(page.body, new RegExp(`<form[^>]+method="post"[^>]+action="/api/v1/auth/${name}"`));
    assert.equal(page.headers['referrer-policy'], 'no-referrer');
    assert.equal(page.headers['cache-control'], 'no-store');
  }
  const fallback = await app.inject({ method: 'POST', url: resetPath, headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: 'password=private&confirmation=private' });
  assert.equal(fallback.statusCode, 415); assert.ok(!fallback.body.includes('private'));
});
