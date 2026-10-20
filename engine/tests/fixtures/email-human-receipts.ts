import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { Store } from '../../src/store.js';
import { registerAuth, sessionDigest } from '../../src/auth.js';
import { registerEmailAgents } from '../../src/email-agents.js';
import { CONTEXT_HEADERS, resolveSessionContext } from '../../src/request-context.js';
import { seedMember } from './membership.js';
import { seal } from '../../src/oauth/crypto.js';
import { tokenContext, updateOAuthAuthorization } from '../../src/oauth/access.js';
import { configureEmailMailbox, persistMessage, encrypt, mailboxes, messages, drafts, operations } from '../../src/email-agents/service.js';
import { parseGmail, parseGraph } from '../../src/email-agents/adapters.js';

export async function emailReceiptFixture(t: TestContext, provider = 'google') {
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
  return { store, app, actor, box, input, draft, message, connection, scope, call, send, roleABA, arm, cookies, headers, calls: () => calls, setResponse(fn: typeof respond) { respond = fn; } };
}
