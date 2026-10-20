import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { Store } from '../src/store.js';
import { registerAuth, sessionDigest } from '../src/auth.js';
import { registerEmailAgents } from '../src/email-agents.js';
import { CONTEXT_HEADERS, resolveSessionContext } from '../src/request-context.js';
import { seedMember } from './fixtures/membership.js';
import { seal } from '../src/oauth/crypto.js';
import { tokenContext, updateOAuthAuthorization } from '../src/oauth/access.js';
import { configureEmailMailbox, persistMessage, encrypt, mailboxes, messages, drafts, operations } from '../src/email-agents/service.js';
import { parseGmail, parseGraph } from '../src/email-agents/adapters.js';

async function fixture(t: TestContext, provider = 'google') {
  const previousKey = process.env.OAUTH_ENCRYPTION_KEY;
  process.env.OAUTH_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  const store = new Store(), app = Fastify(), actor = { userId: 'email-context-owner', tenantId: 'email-context-tenant', role: 'owner' as const };
  seedMember(store, actor);
  const cookies = { kloel_session: 'email-context-session' };
  store.db.prepare('INSERT INTO sessions(hash,user_id,expires,tenant_id) VALUES(?,?,?,?)').run(sessionDigest(cookies.kloel_session), actor.userId, Date.now() + 60000, actor.tenantId);
  const agent = store.create(actor.tenantId, 'agents', { name: 'Synthetic assistant', status: 'active', prompt: 'Synthetic fixture' });
  const scope = provider === 'google' ? 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send' : 'Mail.Read Mail.Send';
  const connection = store.create(actor.tenantId, 'oauth-connections', { provider, remoteId: 'fixture-mail-identity', email: 'inbox@example.test', userId: actor.userId, visibility: 'personal', status: 'connected', capabilities: ['email', 'email_send'], scopes: scope });
  store.update(actor.tenantId, 'oauth-connections', connection.id, { encryptedTokens: seal({ accessToken: 'synthetic-access-token', expiresAt: Date.now() + 3600000, scope }, tokenContext(connection)) });
  const input = { name: 'Synthetic mailbox', connectionId: connection.id, agentId: agent.id };
  const box = configureEmailMailbox(store, actor, input);
  const mail = provider === 'google' ? parseGmail({ id: 'source-message', threadId: 'source-thread', labelIds: ['INBOX'], internalDate: '1780000000000', payload: { mimeType: 'text/plain', headers: [{ name: 'From', value: 'sender@example.test' }, { name: 'To', value: 'inbox@example.test' }, { name: 'Subject', value: 'Synthetic subject' }, { name: 'Message-ID', value: '<source@example.test>' }], body: { data: Buffer.from('Synthetic source').toString('base64url') } } })
    : parseGraph({ id: 'source-message', conversationId: 'source-thread', from: { emailAddress: { address: 'sender@example.test' } }, toRecipients: [{ emailAddress: { address: 'inbox@example.test' } }], subject: 'Synthetic subject', internetMessageId: '<source@example.test>', receivedDateTime: '2026-01-01T00:00:00Z', body: { contentType: 'Text', content: 'Synthetic source' } }, 'inbox');
  store.transaction(() => persistMessage(store, store.get(actor.tenantId, mailboxes, box.id)!, mail, false));
  const message = store.list(actor.tenantId, messages)[0];
  const draft = store.create(actor.tenantId, drafts, { mailboxId: box.id, messageId: message.id, sourceHash: message.contentHash, mailboxRevision: box.revision, status: 'draft', revision: 1, createdBy: actor.userId });
  store.update(actor.tenantId, drafts, draft.id, { encryptedContent: encrypt(draft, 'draft', { text: 'Synthetic approved reply' }) });
  let calls = 0, respond: () => Promise<Response> = async () => provider === 'google' ? Response.json({ id: 'accepted-provider-message', threadId: 'source-thread' }) : new Response(null, { status: 202 });
  await app.register(cookie); await registerAuth(app, store);
  await registerEmailAgents(app, store, { fetchImpl: async () => { calls++; return respond(); } });
  t.after(async () => { await app.close(); store.close(); if (previousKey === undefined) delete process.env.OAUTH_ENCRYPTION_KEY; else process.env.OAUTH_ENCRYPTION_KEY = previousKey; });
  const headers = () => { const context = resolveSessionContext(store, sessionDigest(cookies.kloel_session))!.context; return Object.fromEntries(Object.entries(CONTEXT_HEADERS).map(([key, name]) => [name, context[key as keyof typeof context] ?? '-'])); };
  const initialHeaders = headers(), prefix = '/api/v1/email-agents/mailboxes';
  const call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH', path: string, payload?: unknown, fresh = false, key = 'synthetic-reply-operation') => app.inject({ method, url: prefix + path, cookies, headers: { ...(fresh ? headers() : initialHeaders), 'idempotency-key': key }, ...(payload === undefined ? {} : { payload }) });
  const roleABA = () => { store.db.prepare("UPDATE memberships SET role='admin' WHERE user_id=?").run(actor.userId); store.db.prepare("UPDATE memberships SET role='owner' WHERE user_id=?").run(actor.userId); };
  const arm = () => { const exec = store.db.exec.bind(store.db); let fired = false; store.db.exec = sql => { if (!fired && sql.startsWith('BEGIN')) { fired = true; roleABA(); } return exec(sql); }; return () => { store.db.exec = exec; assert.equal(fired, true); }; };
  const send = (fresh = false, key?: string) => call('POST', `/${box.id}/drafts/${draft.id}/send`, { confirmed: true, revision: 1 }, fresh, key);
  return { store, app, actor, box, input, draft, message, connection, scope, call, send, roleABA, arm, calls: () => calls, setResponse(fn: typeof respond) { respond = fn; } };
}
function changed(response: any) { assert.equal(response.statusCode, 409, response.body); assert.equal(response.json().error.code, 'context_changed_in_flight'); }

for (const action of ['create', 'update'] as const) test(`mailbox ${action} rejects role ABA inside BEGIN without saving stale configuration`, async t => {
  const f = await fixture(t);
  if (action === 'create') f.store.remove(f.actor.tenantId, mailboxes, f.box.id);
  const before = f.store.list(f.actor.tenantId, mailboxes), disarm = f.arm();
  const result = action === 'create' ? await f.call('POST', '', f.input) : await f.call('PUT', `/${f.box.id}`, { ...f.input, name: 'Must not save', revision: 1 });
  disarm(); changed(result); assert.deepEqual(f.store.list(f.actor.tenantId, mailboxes), before); assert.equal(f.calls(), 0);
});

for (const action of ['reset', 'edit', 'send', 'sync'] as const) test(`mailbox ${action} binds the local transaction to its captured HTTP authority`, async t => {
  const f = await fixture(t), collections = [mailboxes, messages, drafts, operations], before = collections.map(c => f.store.list(f.actor.tenantId, c)), disarm = f.arm();
  const result = action === 'reset' ? await f.call('POST', `/${f.box.id}/reset-sync`, { confirmed: true })
    : action === 'edit' ? await f.call('PATCH', `/${f.box.id}/drafts/${f.draft.id}`, { revision: 1, text: 'Must not save' })
    : action === 'sync' ? await f.call('POST', `/${f.box.id}/sync`, {}) : await f.send();
  disarm(); changed(result); assert.deepEqual(collections.map(c => f.store.list(f.actor.tenantId, c)), before); assert.equal(f.calls(), 0);
});

for (const provider of ['google', 'microsoft']) test(`${provider} accepted reply survives HTTP role ABA without leaking the result or sending again`, async t => {
  const f = await fixture(t, provider);
  f.setResponse(async () => { f.roleABA(); return provider === 'google' ? Response.json({ id: 'accepted-provider-message', threadId: 'source-thread' }) : new Response(null, { status: 202 }); });
  const response = await f.send(); changed(response); assert.ok(!response.body.includes('accepted-provider-message'));
  const receipt = f.store.list(f.actor.tenantId, operations)[0]; assert.equal(receipt.status, 'accepted'); assert.equal(receipt.providerMessageId, provider === 'google' ? 'accepted-provider-message' : null);
  const recovered = await f.call('GET', `/${f.box.id}/operations`, undefined, true); assert.equal(recovered.statusCode, 200); assert.equal(recovered.json().items[0].status, 'accepted'); assert.equal(recovered.json().items[0].delivered, false);
  assert.equal((await f.send(true)).statusCode, 409); assert.equal(f.calls(), 1);
});

test('mailbox accepted reply retains its receipt when the original session is revoked during I/O', async t => {
  const f = await fixture(t); f.setResponse(async () => { f.store.db.prepare('DELETE FROM sessions').run(); return Response.json({ id: 'accepted-provider-message', threadId: 'source-thread' }); });
  const response = await f.send(); changed(response); assert.ok(!response.body.includes('accepted-provider-message'));
  const receipt = f.store.list(f.actor.tenantId, operations)[0]; assert.equal(receipt.status, 'accepted'); assert.equal(receipt.providerMessageId, 'accepted-provider-message'); assert.equal(f.calls(), 1);
});

test('mailbox accepted reply journals evidence before a changed OAuth authorization suppresses disclosure', async t => {
  const f = await fixture(t); f.setResponse(async () => { updateOAuthAuthorization(f.store, f.store.get(f.actor.tenantId, 'oauth-connections', f.connection.id)!, {}); return Response.json({ id: 'accepted-provider-message', threadId: 'source-thread' }); });
  const response = await f.send(); assert.equal(response.statusCode, 409); assert.equal(response.json().error.code, 'oauth_connection_changed');
  assert.equal(f.store.list(f.actor.tenantId, operations)[0].status, 'accepted'); assert.equal((await f.send(true)).json().status, 'accepted'); assert.equal(f.calls(), 1);
});

test('mailbox lost response recovers its accepted receipt without repeating the send', async t => {
  const f = await fixture(t); await f.send();
  const recovered = await f.call('GET', `/${f.box.id}/operations`); assert.equal(recovered.json().items[0].providerMessageId, 'accepted-provider-message');
  assert.equal((await f.send()).json().status, 'accepted'); assert.equal(f.calls(), 1);
});

for (const failure of ['malformed', 'timeout'] as const) test(`mailbox ${failure} does not invent acceptance or resend the operation`, async t => {
  const f = await fixture(t); f.setResponse(async () => { if (failure === 'timeout') throw new Error('synthetic lost transport'); return Response.json({ threadId: 'source-thread' }); });
  assert.equal((await f.send()).json().status, 'uncertain'); assert.equal(f.store.list(f.actor.tenantId, operations)[0].providerMessageId, undefined);
  assert.equal((await f.send()).json().status, 'uncertain'); assert.equal((await f.send(false, 'another-operation-key')).statusCode, 409); assert.equal(f.calls(), 1);
});

test('mailbox authority revoked during token refresh cannot dispatch a reply', async t => {
  const f = await fixture(t), previousFetch = globalThis.fetch;
  const names = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'PUBLIC_BASE_URL'] as const, previous = names.map(name => process.env[name]);
  process.env.GOOGLE_CLIENT_ID = 'synthetic-client'; process.env.GOOGLE_CLIENT_SECRET = 'synthetic-secret'; process.env.PUBLIC_BASE_URL = 'http://127.0.0.1:4310';
  t.after(() => { globalThis.fetch = previousFetch; names.forEach((name, index) => { if (previous[index] === undefined) delete process.env[name]; else process.env[name] = previous[index]; }); });
  f.store.update(f.actor.tenantId, 'oauth-connections', f.connection.id, { encryptedTokens: seal({ accessToken: 'expired-synthetic-token', refreshToken: 'synthetic-refresh-token', expiresAt: 1, scope: f.scope }, tokenContext(f.connection)) });
  let refreshes = 0;
  globalThis.fetch = async url => { assert.equal(String(url), 'https://oauth2.googleapis.com/token'); refreshes++; f.roleABA(); return Response.json({ access_token: 'synthetic-refreshed-token', token_type: 'Bearer', expires_in: 3600, scope: f.scope }); };
  const response = await f.send(); changed(response); assert.equal(refreshes, 1); assert.equal(f.calls(), 0);
  assert.equal(f.store.list(f.actor.tenantId, operations)[0].status, 'not_sent'); assert.equal(f.store.get(f.actor.tenantId, drafts, f.draft.id)!.status, 'draft');
});

test('mailbox list revalidates context before disclosing a completed local projection', async t => {
  const f = await fixture(t), list = f.store.list.bind(f.store); let changedOnce = false;
  f.store.list = (tenant, collection) => { const result = list(tenant, collection); if (collection === mailboxes && !changedOnce) { changedOnce = true; f.roleABA(); } return result; };
  const response = await f.call('GET', ''); changed(response); assert.ok(!response.body.includes('inbox@example.test'));
});
