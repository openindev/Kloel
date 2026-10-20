import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { Store } from '../src/store.js';
import { registerAuth } from '../src/auth.js';
import { registerOAuth } from '../src/oauth.js';
import { registerEmailAgents } from '../src/email-agents.js';
import { seedMember } from './fixtures/membership.js';
import { digest, seal } from '../src/oauth/crypto.js';
import { oauthAuthorizationGeneration, tokenContext, updateOAuthAuthorization, type Actor } from '../src/oauth/access.js';
import { configureEmailMailbox, syncEmailMailbox, listEmailMessages, listEmailMailboxes, listEmailDrafts, getEmailMessage, generateEmailDraft, sendEmailDraft, mailboxes, messages, drafts, threads, type EmailOptions } from '../src/email-agents/service.js';
import { archiveEmailMessage, createManualEmailDraft, discardEmailDraft, disconnectEmailConnection, setEmailMessageRead, trashEmailMessage } from '../src/email-agents/mailbox-actions.js';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const MODIFY = 'https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send';
const READONLY = 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send';
const gmailMessage = (id: string, labels: string[]) => ({ id, threadId: `thread-${id}`, internalDate: '1780000000000', labelIds: labels, payload: { mimeType: 'text/plain', headers: [{ name: 'From', value: 'Cliente <client@example.com>' }, { name: 'To', value: 'inbox@example.com' }, { name: 'Subject', value: `Pedido ${id}` }, { name: 'Message-ID', value: `<${id}@example.com>` }], body: { data: Buffer.from(`Texto do pedido ${id}`).toString('base64url') } } });
const graphMessage = (id: string, isRead = false) => ({ id, conversationId: `conversation-${id}`, subject: `Pedido ${id}`, from: { emailAddress: { address: 'client@example.com' } }, toRecipients: [{ emailAddress: { address: 'inbox@example.com' } }], internetMessageId: `<${id}@example.com>`, receivedDateTime: '2026-05-28T10:00:00Z', isRead, body: { contentType: 'text', content: `Texto ${id}` } });

/** Fake Gmail/Graph mailbox with real label state: every write is observable in `requests`. */
function fixture(t: any, provider: 'google' | 'microsoft' = 'google', scopes = provider === 'google' ? MODIFY : 'Mail.ReadWrite Mail.Send', capabilities = ['email', 'email_send']) {
  const previous = process.env.OAUTH_ENCRYPTION_KEY; process.env.OAUTH_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  const store = new Store(), actor: Actor = { tenantId: randomUUID(), userId: randomUUID(), role: 'owner' }; seedMember(store, actor);
  const agent = store.create(actor.tenantId, 'agents', { name: 'E-mail', status: 'active', prompt: 'Responda com fatos verificados.' });
  const connection = store.create(actor.tenantId, 'oauth-connections', { provider, remoteId: 'remote-owner', email: 'inbox@example.com', userId: actor.userId, visibility: 'personal', status: 'connected', capabilities, scopes, authorizationGeneration: 1 });
  store.update(actor.tenantId, 'oauth-connections', connection.id, { encryptedTokens: seal({ accessToken: 'fixture-mail-token', expiresAt: Date.now() + 3600000, scope: scopes }, tokenContext(connection)) });
  const box = configureEmailMailbox(store, actor, { name: 'Atendimento', connectionId: connection.id, agentId: agent.id, settings: { signature: 'Equipe' } });
  const labels = new Map<string, string[]>([['in-1', ['INBOX', 'UNREAD']], ['in-2', ['INBOX']]]), graphRead = new Map<string, boolean>([['g-1', false]]);
  const requests: { url: URL; method: string; body: any; headers: Headers }[] = [];
  let override: ((url: URL, method: string) => Response | undefined) | undefined;
  const fetchImpl = (async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input)), method = init.method ?? 'GET'; requests.push({ url, method, body: init.body ? (typeof init.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : init.body) : undefined, headers: new Headers(init.headers) });
    const custom = override?.(url, method); if (custom) return custom;
    if (url.hostname === 'api.openai.com') return json({ id: 'r', status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Resposta da IA.' }] }] });
    if (provider === 'microsoft') {
      if (url.pathname.endsWith('/mailFolders/inbox')) return json({ id: 'folder-inbox' });
      if (url.pathname.endsWith('/mailFolders/sentitems')) return json({ id: 'folder-sent' });
      if (url.pathname.endsWith('/reply')) return new Response(null, { status: 202 });
      if (url.pathname.endsWith('/move')) return json({ id: decodeURIComponent(url.pathname.split('/').at(-2)!) }, 201);
      if (method === 'PATCH') { const id = decodeURIComponent(url.pathname.split('/').at(-1)!); graphRead.set(id, JSON.parse(String(init.body)).isRead); return json({ id, isRead: graphRead.get(id) }); }
      const sent = url.pathname.includes('folder-sent'); return json({ value: sent ? [] : [...graphRead].map(([id, read]) => graphMessage(id, read)), '@odata.deltaLink': `https://graph.microsoft.com/v1.0/me/mailFolders/${sent ? 'folder-sent' : 'folder-inbox'}/messages/delta?$deltatoken=cursor` });
    }
    if (url.pathname.endsWith('/profile')) return json({ historyId: '100' });
    if (url.pathname.endsWith('/history')) return json({ historyId: '101', history: [] });
    if (url.pathname.endsWith('/messages/send')) return json({ id: 'sent-1', threadId: 'thread-in-1' });
    if (url.pathname.endsWith('/messages')) return json({ messages: [...labels.keys()].map(id => ({ id })) });
    const parts = url.pathname.split('/'), action = parts.at(-1)!, id = decodeURIComponent(['modify', 'trash'].includes(action) ? parts.at(-2)! : action);
    if (action === 'modify') { const body = JSON.parse(String(init.body)); labels.set(id, [...labels.get(id)!.filter(l => !(body.removeLabelIds ?? []).includes(l)), ...(body.addLabelIds ?? [])]); return json({ id, threadId: `thread-${id}`, labelIds: labels.get(id) }); }
    if (action === 'trash') { labels.set(id, ['TRASH']); return json({ id, threadId: `thread-${id}`, labelIds: ['TRASH'] }); }
    return json(gmailMessage(id, labels.get(id) ?? ['INBOX']));
  }) as typeof fetch;
  const options: EmailOptions = { openaiApiKey: 'fixture-openai-key', openaiModel: 'fixture-model', fetchImpl };
  t.after(() => { store.close(); if (previous === undefined) delete process.env.OAUTH_ENCRYPTION_KEY; else process.env.OAUTH_ENCRYPTION_KEY = previous; });
  const message = (remote: string) => store.list(actor.tenantId, messages).find(m => m.remoteId === remote)!;
  return { store, actor, agent, connection, box, options, requests, labels, graphRead, message, setOverride(fn: typeof override) { override = fn; } };
}
const writes = (f: ReturnType<typeof fixture>) => f.requests.filter(r => r.method !== 'GET' && r.url.hostname !== 'api.openai.com');

test('Gmail read/unread changes the real UNREAD label and keeps drafts valid', async t => {
  const f = fixture(t); await syncEmailMailbox(f.store, f.actor, f.box.id, f.options);
  const source = f.message('in-1'), hash = source.contentHash; assert.equal(getEmailMessage(f.store, f.actor, f.box.id, source.id).read, false);
  const draft = await generateEmailDraft(f.store, f.actor, f.box.id, source.id, {}, 'draft-key', f.options);
  const read = await setEmailMessageRead(f.store, f.actor, f.box.id, source.id, { read: true }, f.options);
  assert.equal(read.read, true); assert.deepEqual(f.labels.get('in-1'), ['INBOX']);
  const call = writes(f).at(-1)!; assert.equal(call.url.pathname, '/gmail/v1/users/me/messages/in-1/modify'); assert.deepEqual(call.body, { removeLabelIds: ['UNREAD'] }); assert.equal(call.headers.get('authorization'), 'Bearer fixture-mail-token');
  assert.equal(f.message('in-1').contentHash, hash, 'read state is not message content');
  const unread = await setEmailMessageRead(f.store, f.actor, f.box.id, source.id, { read: false }, f.options);
  assert.equal(unread.read, false); assert.deepEqual(writes(f).at(-1)!.body, { addLabelIds: ['UNREAD'] }); assert.deepEqual(f.labels.get('in-1'), ['INBOX', 'UNREAD']);
  // A draft made before the label changes still sends (the same message, only its organization changed).
  const sent = await sendEmailDraft(f.store, f.actor, f.box.id, draft.id, { confirmed: true, revision: draft.revision }, 'send-key', f.options);
  assert.equal(sent.status, 'accepted');
  // A sync that re-reads the changed labels (read in Gmail) does not invalidate drafts either.
  await setEmailMessageRead(f.store, f.actor, f.box.id, source.id, { read: true }, f.options);
  f.setOverride(url => url.pathname.endsWith('/history') ? json({ historyId: '102', history: [{ labelsRemoved: [{ message: { id: 'in-1' } }] }] }) : undefined);
  const reread = await generateEmailDraft(f.store, f.actor, f.box.id, f.message('in-2').id, {}, 'other', f.options);
  await syncEmailMailbox(f.store, f.actor, f.box.id, f.options);
  assert.ok(f.requests.some(r => r.method === 'GET' && r.url.pathname.endsWith('/messages/in-1') && r.url.searchParams.get('format') === 'full'));
  assert.equal(f.message('in-1').contentHash, hash); assert.equal(getEmailMessage(f.store, f.actor, f.box.id, source.id).read, true); assert.ok(reread.id);
});

test('provider must confirm the change; nothing is recorded locally otherwise', async t => {
  const f = fixture(t); await syncEmailMailbox(f.store, f.actor, f.box.id, f.options); const source = f.message('in-1');
  f.setOverride((url, method) => method === 'POST' && url.pathname.endsWith('/modify') ? json({ id: 'in-1', labelIds: ['INBOX', 'UNREAD'] }) : undefined);
  await assert.rejects(setEmailMessageRead(f.store, f.actor, f.box.id, source.id, { read: true }, f.options), (e: any) => e.code === 'email_provider_state_mismatch');
  assert.equal(getEmailMessage(f.store, f.actor, f.box.id, source.id).read, false);
  f.setOverride((url, method) => method === 'POST' && url.pathname.endsWith('/modify') ? json({ error: 'insufficientPermissions' }, 403) : undefined);
  await assert.rejects(archiveEmailMessage(f.store, f.actor, f.box.id, source.id, {}, f.options), (e: any) => e.code === 'email_provider_permission_denied');
  assert.ok(listEmailMessages(f.store, f.actor, f.box.id, {}).items.some(m => m.id === source.id));
});

test('read-only legacy connection is refused before any provider write and asks for reconnection', async t => {
  const f = fixture(t, 'google', READONLY); await syncEmailMailbox(f.store, f.actor, f.box.id, f.options); const source = f.message('in-1'), before = f.requests.length;
  const box = listEmailMailboxes(f.store, f.actor).items[0]!;
  assert.equal(box.canOrganize, false); assert.equal(box.organizeOnReconnect, true, 'a new authorization requests gmail.modify');
  for (const action of [() => setEmailMessageRead(f.store, f.actor, f.box.id, source.id, { read: true }, f.options), () => archiveEmailMessage(f.store, f.actor, f.box.id, source.id, {}, f.options), () => trashEmailMessage(f.store, f.actor, f.box.id, source.id, { confirmed: true }, f.options)])
    await assert.rejects(action(), (e: any) => e.code === 'email_organize_scope_missing' && e.statusCode === 403);
  assert.equal(f.requests.length, before);
  // Reading and replying keep working on the legacy authorization.
  assert.equal(listEmailMessages(f.store, f.actor, f.box.id, {}).items.length, 2);
  assert.equal(listEmailMailboxes(f.store, f.actor).items[0]!.canOrganize, false);
  const modern = fixture(t); assert.equal(listEmailMailboxes(modern.store, modern.actor).items[0]!.canOrganize, true);
});

test('Gmail archive removes only the INBOX label; trash moves to provider trash and discards open drafts', async t => {
  const f = fixture(t); await syncEmailMailbox(f.store, f.actor, f.box.id, f.options);
  const first = f.message('in-1'), second = f.message('in-2');
  const archived = await archiveEmailMessage(f.store, f.actor, f.box.id, first.id, {}, f.options);
  assert.equal(archived.status, 'archived'); assert.deepEqual(writes(f).at(-1)!.body, { removeLabelIds: ['INBOX'] }); assert.deepEqual(f.labels.get('in-1'), ['UNREAD']);
  assert.deepEqual(listEmailMessages(f.store, f.actor, f.box.id, {}).items.map(m => m.id), [second.id]);
  await assert.rejects(archiveEmailMessage(f.store, f.actor, f.box.id, first.id, {}, f.options), (e: any) => e.code === 'email_message_deleted');
  const draft = createManualEmailDraft(f.store, f.actor, f.box.id, second.id, { text: 'Resposta escrita pela equipe.' }, 'manual-1', f.options);
  await assert.rejects(trashEmailMessage(f.store, f.actor, f.box.id, second.id, {}, f.options), (e: any) => e.name === 'ZodError');
  const trashed = await trashEmailMessage(f.store, f.actor, f.box.id, second.id, { confirmed: true }, f.options);
  assert.equal(trashed.recoverableAtProvider, true); assert.equal(writes(f).at(-1)!.url.pathname, '/gmail/v1/users/me/messages/in-2/trash'); assert.deepEqual(f.labels.get('in-2'), ['TRASH']);
  assert.equal(listEmailMessages(f.store, f.actor, f.box.id, { folder: 'all' }).items.length, 0);
  assert.equal(f.store.get(f.actor.tenantId, drafts, draft.id)!.status, 'discarded'); assert.equal(f.store.get(f.actor.tenantId, drafts, draft.id)!.encryptedContent, null);
  assert.ok(!writes(f).some(r => r.method === 'DELETE'), 'never a permanent provider delete');
});

test('Microsoft read, archive and trash use Graph PATCH/move with immutable IDs', async t => {
  const f = fixture(t, 'microsoft'); f.graphRead.set('g-2', true); await syncEmailMailbox(f.store, f.actor, f.box.id, f.options);
  const first = f.message('g-1'), second = f.message('g-2');
  assert.equal((await setEmailMessageRead(f.store, f.actor, f.box.id, first.id, { read: true }, f.options)).read, true);
  let call = writes(f).at(-1)!; assert.equal(call.method, 'PATCH'); assert.equal(call.url.pathname, '/v1.0/me/messages/g-1'); assert.deepEqual(call.body, { isRead: true }); assert.equal(call.headers.get('prefer'), 'IdType="ImmutableId"');
  await archiveEmailMessage(f.store, f.actor, f.box.id, first.id, {}, f.options);
  call = writes(f).at(-1)!; assert.equal(call.url.pathname, '/v1.0/me/messages/g-1/move'); assert.deepEqual(call.body, { destinationId: 'archive' });
  await trashEmailMessage(f.store, f.actor, f.box.id, second.id, { confirmed: true }, f.options);
  call = writes(f).at(-1)!; assert.equal(call.url.pathname, '/v1.0/me/messages/g-2/move'); assert.deepEqual(call.body, { destinationId: 'deleteditems' });
  assert.equal(listEmailMessages(f.store, f.actor, f.box.id, { folder: 'all' }).items.length, 0);
  const legacy = fixture(t, 'microsoft', 'Mail.Read Mail.Send'); await syncEmailMailbox(legacy.store, legacy.actor, legacy.box.id, legacy.options);
  await assert.rejects(setEmailMessageRead(legacy.store, legacy.actor, legacy.box.id, legacy.message('g-1').id, { read: true }, legacy.options), (e: any) => e.code === 'email_organize_scope_missing');
});

test('discarding a draft removes it (and superseded proposals); in-flight sends cannot be discarded', async t => {
  const f = fixture(t); await syncEmailMailbox(f.store, f.actor, f.box.id, f.options); const source = f.message('in-1');
  const older = await generateEmailDraft(f.store, f.actor, f.box.id, source.id, {}, 'k1', f.options), newer = await generateEmailDraft(f.store, f.actor, f.box.id, source.id, {}, 'k2', f.options);
  await assert.rejects(Promise.resolve().then(() => discardEmailDraft(f.store, f.actor, f.box.id, newer.id, { revision: 9 }, f.options)), (e: any) => e.code === 'email_draft_changed');
  const result = discardEmailDraft(f.store, f.actor, f.box.id, newer.id, { revision: newer.revision }, f.options);
  assert.deepEqual(new Set(result.discarded), new Set([older.id, newer.id])); assert.equal(listEmailDrafts(f.store, f.actor, f.box.id).items.length, 0);
  assert.throws(() => discardEmailDraft(f.store, f.actor, f.box.id, newer.id, { revision: newer.revision + 1 }, f.options), (e: any) => e.code === 'email_draft_changed');
  const pending = await generateEmailDraft(f.store, f.actor, f.box.id, source.id, {}, 'k3', f.options); f.store.update(f.actor.tenantId, drafts, pending.id, { status: 'pending' });
  assert.throws(() => discardEmailDraft(f.store, f.actor, f.box.id, pending.id, { revision: pending.revision }, f.options), (e: any) => e.code === 'email_draft_changed');
});

test('manual reply becomes an idempotent reviewed draft and sends through the confirmed path', async t => {
  const f = fixture(t); await syncEmailMailbox(f.store, f.actor, f.box.id, f.options); const source = f.message('in-2');
  const draft = createManualEmailDraft(f.store, f.actor, f.box.id, source.id, { text: '  Olá! Seguimos com o pedido.  ' }, 'manual-key', f.options);
  assert.equal(draft.text, 'Olá! Seguimos com o pedido.'); assert.deepEqual(draft.authorization, { kind: 'human_authored' });
  assert.equal(createManualEmailDraft(f.store, f.actor, f.box.id, source.id, { text: 'Olá! Seguimos com o pedido.' }, 'manual-key', f.options).id, draft.id);
  assert.throws(() => createManualEmailDraft(f.store, f.actor, f.box.id, source.id, { text: 'Outro texto' }, 'manual-key', f.options), (e: any) => e.code === 'idempotency_conflict');
  assert.equal(f.requests.filter(r => r.url.hostname === 'api.openai.com').length, 0, 'manual reply never calls the AI');
  const op = await sendEmailDraft(f.store, f.actor, f.box.id, draft.id, { confirmed: true, revision: 1 }, 'send', f.options);
  assert.equal(op.status, 'accepted'); const raw = Buffer.from(writes(f).at(-1)!.body.raw, 'base64url').toString();
  assert.match(raw, /In-Reply-To: <in-2@example.com>/); assert.match(Buffer.from(raw.split('\r\n\r\n')[1]!.replace(/\r\n/g, ''), 'base64').toString(), /Seguimos com o pedido/);
  assert.throws(() => createManualEmailDraft(f.store, f.actor, f.box.id, source.id, { text: 'Segunda resposta' }, 'manual-2', f.options), (e: any) => e.code === 'email_reply_already_started');
});

test('disconnect removes the E-Mail IA copy; email-only connection is disconnected, shared calendar connection is kept intact', async t => {
  const f = fixture(t); await syncEmailMailbox(f.store, f.actor, f.box.id, f.options); createManualEmailDraft(f.store, f.actor, f.box.id, f.message('in-1').id, { text: 'Rascunho' }, 'm', f.options);
  assert.throws(() => disconnectEmailConnection(f.store, f.actor, f.connection.id, {}, f.options));
  const result = disconnectEmailConnection(f.store, f.actor, f.connection.id, { confirmed: true }, f.options);
  assert.equal(result.connection, 'disconnected'); assert.equal(result.removedMailboxes, 1);
  for (const collection of [mailboxes, messages, threads, drafts]) assert.equal(f.store.list(f.actor.tenantId, collection).length, 0, collection);
  const connection = f.store.get(f.actor.tenantId, 'oauth-connections', f.connection.id)!; assert.equal(connection.status, 'disconnected'); assert.equal(connection.encryptedTokens, null);
  assert.equal(writes(f).length, 0, 'nothing is deleted at the provider');

  const c = fixture(t, 'google', MODIFY + ' https://www.googleapis.com/auth/calendar.readonly', ['calendar', 'calendar_write', 'email', 'email_send']); await syncEmailMailbox(c.store, c.actor, c.box.id, c.options);
  const before = c.store.get(c.actor.tenantId, 'oauth-connections', c.connection.id)!;
  const kept = disconnectEmailConnection(c.store, c.actor, c.connection.id, { confirmed: true }, c.options);
  assert.equal(kept.connection, 'kept_for_other_features'); assert.deepEqual(kept.keptCapabilities, ['calendar', 'calendar_write']);
  const after = c.store.get(c.actor.tenantId, 'oauth-connections', c.connection.id)!;
  assert.equal(after.status, 'connected'); assert.deepEqual(after.capabilities, before.capabilities); assert.equal(oauthAuthorizationGeneration(after), oauthAuthorizationGeneration(before), 'calendar bindings keep their OAuth identity');
  assert.deepEqual(listEmailMailboxes(c.store, c.actor), { items: [], detachedConnectionIds: [c.connection.id] });
  // A new authorization (reconnect) makes the mailbox available again.
  c.store.transaction(() => updateOAuthAuthorization(c.store, after, { scopes: after.scopes }));
  assert.deepEqual(listEmailMailboxes(c.store, c.actor).detachedConnectionIds, []);
  const stranger: Actor = { tenantId: c.actor.tenantId, userId: randomUUID(), role: 'owner' }; seedMember(c.store, stranger);
  assert.throws(() => disconnectEmailConnection(c.store, stranger, c.connection.id, { confirmed: true }, c.options), (e: any) => e.code === 'connection_not_found');
});

test('new Google connection through OAuth requests gmail.modify and the HTTP routes organize the mailbox end to end', async t => {
  const env = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'OAUTH_ENCRYPTION_KEY', 'PUBLIC_BASE_URL'], saved = Object.fromEntries(env.map(n => [n, process.env[n]]));
  t.after(() => { for (const [n, v] of Object.entries(saved)) if (v === undefined) delete process.env[n]; else process.env[n] = v; });
  process.env.GOOGLE_CLIENT_ID = 'google-test'; process.env.GOOGLE_CLIENT_SECRET = 'test-google-secret'; process.env.OAUTH_ENCRYPTION_KEY = randomBytes(32).toString('base64'); delete process.env.PUBLIC_BASE_URL;
  const store = new Store(), actor: Actor = { tenantId: randomUUID(), userId: randomUUID(), role: 'owner' }; seedMember(store, actor);
  const session = randomBytes(32).toString('hex'); store.db.prepare('INSERT INTO sessions(hash,user_id,expires,tenant_id) VALUES(?,?,?,?)').run(digest(session), actor.userId, Date.now() + 3600000, actor.tenantId);
  const labels = new Map([['new-1', ['INBOX', 'UNREAD']]]), providerWrites: { path: string; body: any }[] = [];
  const fetchImpl = (async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input)); if ((init.method ?? 'GET') !== 'GET') providerWrites.push({ path: url.pathname, body: init.body ? JSON.parse(String(init.body)) : undefined });
    if (url.pathname.endsWith('/profile')) return json({ historyId: '5' });
    if (url.pathname.endsWith('/messages')) return json({ messages: [{ id: 'new-1' }] });
    if (url.pathname.endsWith('/modify')) { const body = JSON.parse(String(init.body)); labels.set('new-1', [...labels.get('new-1')!.filter(l => !(body.removeLabelIds ?? []).includes(l)), ...(body.addLabelIds ?? [])]); return json({ id: 'new-1', labelIds: labels.get('new-1') }); }
    if (url.pathname.endsWith('/trash')) return json({ id: 'new-1', labelIds: ['TRASH'] });
    if (url.pathname.endsWith('/messages/send')) return json({ id: 'sent-new', threadId: 'thread-new-1' });
    return json(gmailMessage('new-1', labels.get('new-1')!));
  }) as typeof fetch;
  const app = Fastify(); await app.register(cookie); await registerAuth(app, store); await registerOAuth(app, store); await registerEmailAgents(app, store, { fetchImpl });
  t.after(async () => { await app.close(); store.close(); });
  const cookies = { kloel_session: session }, call = (method: 'GET' | 'POST', url: string, payload?: unknown, headers: Record<string, string> = {}) => app.inject({ method, url, cookies, headers, ...(payload === undefined ? {} : { payload: payload as any }) });
  const started = await call('POST', '/api/v1/oauth/google/start', { capabilities: ['email', 'email_send'], visibility: 'personal' }); assert.equal(started.statusCode, 200, started.body);
  const authorize = new URL(started.json().authorizationUrl), scope = authorize.searchParams.get('scope')!;
  assert.ok(scope.split(' ').includes('https://www.googleapis.com/auth/gmail.modify')); assert.ok(!scope.includes('gmail.readonly'));
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = (async (url: string | URL) => String(url).endsWith('/token') ? json({ access_token: 'new-access', refresh_token: 'new-refresh', token_type: 'Bearer', expires_in: 3600, scope }) : json({ sub: 'new-remote', email: 'inbox@example.com' })) as typeof fetch;
  const done = await app.inject({ url: `/api/v1/oauth/google/callback?state=${encodeURIComponent(authorize.searchParams.get('state')!)}&code=c`, cookies }); assert.equal(done.statusCode, 200, done.body);
  globalThis.fetch = (async () => { throw Error('no further global provider calls') }) as typeof fetch;
  const agent = store.create(actor.tenantId, 'agents', { name: 'E-mail', status: 'active', prompt: 'p' });
  const created = await call('POST', '/api/v1/email-agents/mailboxes', { connectionId: done.json().connection.id, agentId: agent.id, name: 'Agente de e-mail' }); assert.equal(created.statusCode, 201, created.body);
  const box = created.json(); assert.equal(box.canOrganize, true);
  assert.equal((await call('POST', `/api/v1/email-agents/mailboxes/${box.id}/sync`, {})).statusCode, 200);
  const id = (await call('GET', `/api/v1/email-agents/mailboxes/${box.id}/messages`)).json().items[0].id;
  const read = await call('POST', `/api/v1/email-agents/mailboxes/${box.id}/messages/${id}/read`, { read: true }); assert.equal(read.statusCode, 200, read.body); assert.equal(read.json().read, true);
  const unread = await call('POST', `/api/v1/email-agents/mailboxes/${box.id}/messages/${id}/read`, { read: false }); assert.equal(unread.json().read, false);
  const draft = await call('POST', `/api/v1/email-agents/mailboxes/${box.id}/messages/${id}/manual-drafts`, { text: 'Resposta manual' }, { 'idempotency-key': 'manual-http' }); assert.equal(draft.statusCode, 201, draft.body);
  const discarded = await call('POST', `/api/v1/email-agents/mailboxes/${box.id}/drafts/${draft.json().id}/discard`, { revision: 1 }); assert.equal(discarded.statusCode, 200, discarded.body);
  assert.equal((await call('GET', `/api/v1/email-agents/mailboxes/${box.id}/drafts`)).json().items.length, 0);
  assert.equal((await call('POST', `/api/v1/email-agents/mailboxes/${box.id}/messages/${id}/trash`, {})).statusCode, 400);
  const trashed = await call('POST', `/api/v1/email-agents/mailboxes/${box.id}/messages/${id}/trash`, { confirmed: true }); assert.equal(trashed.statusCode, 200, trashed.body);
  assert.equal((await call('GET', `/api/v1/email-agents/mailboxes/${box.id}/messages?folder=all`)).json().total, 0);
  assert.deepEqual(providerWrites.map(w => w.path.split('/').at(-1)), ['modify', 'modify', 'trash']);
  const disconnected = await call('POST', `/api/v1/email-agents/connections/${done.json().connection.id}/disconnect`, { confirmed: true }); assert.equal(disconnected.statusCode, 200, disconnected.body);
  assert.equal(disconnected.json().connection, 'disconnected');
  assert.deepEqual((await call('GET', '/api/v1/email-agents/mailboxes')).json(), { items: [], detachedConnectionIds: [] });
});
