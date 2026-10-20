import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import Fastify, { type InjectOptions } from 'fastify';
import cookie from '@fastify/cookie';
import { Store } from '../src/store.js';
import { registerAuth, sessionDigest } from '../src/auth.js';
import { registerCalendarRoutes } from '../src/oauth/calendar.js';
import { registerMailboxSendRoutes } from '../src/oauth/mail.js';
import { configureSpreadsheet, registerSheetsRoutes } from '../src/oauth/sheets.js';
import { tokenContext } from '../src/oauth/access.js';
import { seal } from '../src/oauth/crypto.js';
import { CONTEXT_HEADERS, resolveSessionContext } from '../src/request-context.js';
import { seedMember } from './fixtures/membership.js';

const googleScope = ['https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/calendar.readonly', 'https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/spreadsheets'].join(' ');
const sheetId = 'fixture-spreadsheet-123';
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const envNames = ['OAUTH_ENCRYPTION_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'PUBLIC_BASE_URL'] as const;

async function fixture(t: TestContext, provider = 'google', expired = false) {
  const oldFetch = globalThis.fetch, env = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
  process.env.OAUTH_ENCRYPTION_KEY = Buffer.alloc(32, 67).toString('base64');
  process.env.GOOGLE_CLIENT_ID = 'context-fixture-client'; process.env.GOOGLE_CLIENT_SECRET = 'context-fixture-secret'; delete process.env.PUBLIC_BASE_URL;
  globalThis.fetch = async () => { throw new Error('Unmocked provider transport is forbidden'); };
  const store = new Store(), actor = { userId: 'oauth-context-owner', tenantId: 'oauth-context-tenant', role: 'owner' as const };
  seedMember(store, actor);
  const token = 'oauth-context-session'; store.db.prepare('INSERT INTO sessions(hash,user_id,expires,tenant_id) VALUES(?,?,?,?)').run(sessionDigest(token), actor.userId, Date.now() + 60000, actor.tenantId);
  const scope = provider === 'google' ? googleScope : 'Mail.Send Calendars.ReadWrite';
  const connection = store.create(actor.tenantId, 'oauth-connections', { provider, userId: actor.userId, remoteId: 'fixture-remote', email: 'sender@example.test', visibility: 'personal', status: 'connected', capabilities: ['email_send', 'calendar', 'calendar_write', 'sheets_read', 'sheets_append'], scopes: scope });
  store.update(actor.tenantId, 'oauth-connections', connection.id, { encryptedTokens: seal({ accessToken: 'fixture-access', refreshToken: 'fixture-refresh', expiresAt: expired ? 0 : Date.now() + 3600000, scope }, tokenContext(connection)) });
  const app = Fastify(); await app.register(cookie);
  app.setErrorHandler((error, _request, reply) => { const e = error as { statusCode?: number; code?: string; message?: string }; reply.code(e.statusCode || 500).send({ error: { code: e.code, message: e.message } }); });
  await registerAuth(app, store); await registerCalendarRoutes(app, store); await registerMailboxSendRoutes(app, store); await registerSheetsRoutes(app, store);
  const cookies = { kloel_session: token };
  const headers = () => { const context = resolveSessionContext(store, sessionDigest(token))!.context; return Object.fromEntries(Object.entries(CONTEXT_HEADERS).map(([key, name]) => [name, context[key as keyof typeof context] ?? '-'])); };
  const roleABA = () => { store.db.prepare("UPDATE memberships SET role='member' WHERE user_id=? AND tenant_id=?").run(actor.userId, actor.tenantId); store.db.prepare("UPDATE memberships SET role='owner' WHERE user_id=? AND tenant_id=?").run(actor.userId, actor.tenantId); };
  const base = `/api/v1/oauth/connections/${connection.id}`;
  const mail = (extra: Record<string, string> = headers()): InjectOptions => ({ method: 'POST', url: `${base}/messages/send`, cookies, headers: { ...extra, 'idempotency-key': 'mail-context-operation' }, payload: { to: ['recipient@example.test'], subject: 'Context test', text: 'Synthetic message' } });
  const sheet = () => configureSpreadsheet(store, actor, connection.id, { spreadsheetId: sheetId, name: 'Fixture sheet', allowAppend: true });
  t.after(async () => { await app.close(); store.close(); globalThis.fetch = oldFetch; for (const name of envNames) if (env[name] === undefined) delete process.env[name]; else process.env[name] = env[name]; });
  return { app, store, actor, connection, cookies, headers, roleABA, base, mail, sheet, scope };
}

for (const provider of ['google', 'microsoft']) test(`${provider} accepted mail is journaled before role ABA suppresses disclosure; recovery never sends twice`, async t => {
  const f = await fixture(t, provider), headers = f.headers(); let writes = 0;
  globalThis.fetch = async () => { writes++; f.roleABA(); return provider === 'google' ? json({ id: 'accepted-context-message' }) : new Response(null, { status: 202 }); };
  const first = await f.app.inject(f.mail(headers));
  assert.equal(first.statusCode, 409, first.body); assert.equal(first.json().error.code, 'context_changed_in_flight'); assert.ok(!first.body.includes('accepted-context-message'));
  const stored = f.store.list(f.actor.tenantId, 'oauth-email-operations'); assert.equal(stored.length, 1); assert.equal(stored[0].status, 'accepted');
  const denied = await f.app.inject({ url: `${f.base}/mail-operations`, cookies: f.cookies, headers }); assert.equal(denied.statusCode, 409);
  const recovered = await f.app.inject({ url: `${f.base}/mail-operations`, cookies: f.cookies, headers: f.headers() });
  assert.equal(recovered.statusCode, 200, recovered.body); assert.equal(recovered.json().items[0].status, 'accepted'); assert.equal(recovered.json().items[0].result.delivery, 'not_confirmed');
  const replay = await f.app.inject(f.mail()); assert.equal(replay.statusCode, 202, replay.body); assert.equal(replay.json().operationId, stored[0].id); assert.equal(writes, 1);
});

test('lost accepted mail response is recovered by GET and same-key replay without another provider call', async t => {
  const f = await fixture(t); let writes = 0;
  globalThis.fetch = async () => { writes++; return json({ id: 'response-lost-but-accepted' }); };
  // Transport consumer discards this response; the durable operation is the source of truth.
  assert.equal((await f.app.inject(f.mail())).statusCode, 202);
  const recovered = await f.app.inject({ url: `${f.base}/mail-operations`, cookies: f.cookies, headers: f.headers() });
  assert.equal(recovered.json().items[0].result.messageId, 'response-lost-but-accepted');
  assert.equal((await f.app.inject(f.mail())).json().messageId, 'response-lost-but-accepted'); assert.equal(writes, 1);
});

test('mail transport outcome unknown remains uncertain and cannot be replayed even with a fresh context', async t => {
  const f = await fixture(t); let writes = 0;
  globalThis.fetch = async () => { writes++; throw new Error('Synthetic transport response lost'); };
  const failed = await f.app.inject(f.mail()); assert.equal(failed.statusCode, 502); assert.equal(failed.json().error.code, 'provider_unavailable');
  f.roleABA();
  const known = await f.app.inject({ url: `${f.base}/mail-operations`, cookies: f.cookies, headers: f.headers() });
  assert.equal(known.json().items[0].status, 'uncertain');
  const replay = await f.app.inject(f.mail()); assert.equal(replay.statusCode, 409); assert.equal(replay.json().error.code, 'send_outcome_unknown'); assert.equal(writes, 1);
});

for (const kind of ['mail', 'calendar', 'sheets'] as const) test(`${kind} revoked while refreshing token makes no resource request or new receipt`, async t => {
  const f = await fixture(t, 'google', true), binding = kind === 'sheets' ? f.sheet() : undefined; let refreshes = 0, resourceRequests = 0;
  globalThis.fetch = async url => {
    if (String(url).includes('oauth2.googleapis.com/token')) {
      refreshes++; f.roleABA(); return json({ access_token: 'fixture-refreshed', token_type: 'Bearer', expires_in: 3600, scope: f.scope });
    }
    resourceRequests++; throw new Error('Resource request must not happen after lost authority');
  };
  const request: InjectOptions = kind === 'mail' ? f.mail() : { method: 'POST', url: kind === 'calendar' ? `${f.base}/events` : `${f.base}/spreadsheets/${binding!.id}/append`, cookies: f.cookies, headers: { ...f.headers(), 'idempotency-key': 'refresh-revoked-operation' },
    payload: kind === 'calendar' ? { title: 'Fixture event', startAt: '2099-01-05T10:00:00Z', endAt: '2099-01-05T10:30:00Z' } : { expectedTenantId: f.actor.tenantId, expectedRevision: 1, sheetTitle: 'Sheet1', range: 'A1:A1', rows: [['fixture']] } };
  const result = await f.app.inject(request); assert.equal(result.statusCode, 409, result.body); assert.equal(result.json().error.code, 'context_changed_in_flight');
  assert.equal(refreshes, 1); assert.equal(resourceRequests, 0);
  for (const collection of ['oauth-email-operations', 'oauth-calendar-operations', 'oauth-sheets-operations']) assert.equal(f.store.list(f.actor.tenantId, collection).length, 0, collection);
});

for (const operation of ['create', 'update', 'cancel'] as const) test(`calendar ${operation} accepted before role ABA retains its receipt and replays without another write`, async t => {
  const f = await fixture(t); let writes = 0;
  globalThis.fetch = async (_url, init) => {
    if (!init?.method || init.method === 'GET') return json({ items: [] });
    writes++; f.roleABA(); return operation === 'cancel' ? new Response(null, { status: 204 }) : json({ id: 'context-event', summary: 'Confirmed fixture' });
  };
  const make = (): InjectOptions => ({ method: operation === 'create' ? 'POST' : operation === 'update' ? 'PATCH' : 'DELETE', url: `${f.base}/events${operation === 'create' ? '' : '/context-event'}`, cookies: f.cookies, headers: { ...f.headers(), 'idempotency-key': 'calendar-context-operation' },
    ...(operation !== 'cancel' ? { payload: operation === 'create' ? { title: 'Fixture', startAt: '2099-01-05T10:00:00Z', endAt: '2099-01-05T10:30:00Z' } : { title: 'Changed fixture' } } : {}) });
  const result = await f.app.inject(make()); assert.equal(result.statusCode, 409, result.body); assert.equal(result.json().error.code, 'context_changed_in_flight');
  const receipt = f.store.list(f.actor.tenantId, 'oauth-calendar-operations')[0]; assert.equal(receipt.status, 'completed');
  const known = await f.app.inject({ url: `${f.base}/operations`, cookies: f.cookies, headers: f.headers() }); assert.equal(known.json().items[0].result.event.id, 'context-event');
  const replay = await f.app.inject(make()); assert.equal(replay.statusCode, operation === 'create' ? 201 : 200, replay.body); assert.equal(writes, 1);
});

test('Sheets accepted append is durable but role ABA cannot adopt its HTTP receipt or repeat the write', async t => {
  const f = await fixture(t), binding = f.sheet(); let writes = 0;
  globalThis.fetch = async () => { writes++; f.roleABA(); return json({ spreadsheetId: sheetId, updates: { updatedRange: 'Sheet1!A2', updatedRows: 1, updatedColumns: 1, updatedCells: 1 } }); };
  const make = (): InjectOptions => ({ method: 'POST', url: `${f.base}/spreadsheets/${binding.id}/append`, cookies: f.cookies, headers: { ...f.headers(), 'idempotency-key': 'sheet-context-operation' }, payload: { expectedTenantId: f.actor.tenantId, expectedRevision: 1, sheetTitle: 'Sheet1', range: 'A1:A1', rows: [['fixture']] } });
  const result = await f.app.inject(make()); assert.equal(result.statusCode, 409, result.body); assert.equal(result.json().error.code, 'context_changed_in_flight');
  assert.equal(f.store.list(f.actor.tenantId, 'oauth-sheets-operations')[0].status, 'appended');
  const recovered = await f.app.inject({ url: `${f.base}/sheets-operations`, cookies: f.cookies, headers: f.headers() }); assert.deepEqual(recovered.json().items, []);
  const hidden = await f.app.inject({ url: '/api/v1/oauth/sheets/operations/sheet-context-operation', cookies: f.cookies, headers: f.headers() }); assert.equal(hidden.statusCode, 404);
  const replay = await f.app.inject(make()); assert.equal(replay.statusCode, 409); assert.equal(replay.json().error.code, 'idempotency_conflict'); assert.equal(writes, 1);
});

test('late Sheets read after context change exposes no content and does not mark the binding verified', async t => {
  const f = await fixture(t), binding = f.sheet();
  globalThis.fetch = async () => { f.roleABA(); return json({ spreadsheetId: sheetId, properties: { title: 'PRIVATE-LATE-RESULT' }, sheets: [] }); };
  const result = await f.app.inject({ url: `${f.base}/spreadsheets/${binding.id}/tabs?expectedRevision=1`, cookies: f.cookies, headers: f.headers() });
  assert.equal(result.statusCode, 409, result.body); assert.equal(result.json().error.code, 'context_changed_in_flight'); assert.ok(!result.body.includes('PRIVATE-LATE-RESULT'));
  assert.equal(f.store.get(f.actor.tenantId, 'oauth-sheets-bindings', binding.id)!.lastVerifiedAt, undefined);
});
