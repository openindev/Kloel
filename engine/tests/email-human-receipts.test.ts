import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { emailReceiptFixture } from './fixtures/email-human-receipts.js';
import { drafts, mailboxes, operations, sendEmailDraft } from '../src/email-agents/service.js';
import { seedMember } from './fixtures/membership.js';
import { sessionDigest } from '../src/auth.js';

const key = 'synthetic-reply-operation';
const receipt = (f: Awaited<ReturnType<typeof emailReceiptFixture>>, fresh = false, reference = key) => f.call('GET', `/${f.box.id}/operations/${encodeURIComponent(reference)}`, undefined, fresh);

for (const provider of ['google', 'microsoft']) for (const removed of ['disabled', 'disconnected', 'deleted'] as const) test(`${provider}: original accepted receipt survives mailbox ${removed} without provider I/O`, async t => {
  const f = await emailReceiptFixture(t, provider);
  assert.equal((await f.send()).statusCode, 200);
  if (removed === 'disabled') f.store.update(f.actor.tenantId, mailboxes, f.box.id, { enabled: false, revision: 2 });
  if (removed === 'disconnected') f.store.update(f.actor.tenantId, 'oauth-connections', f.connection.id, { status: 'disconnected', encryptedTokens: null });
  if (removed === 'deleted') { f.store.remove(f.actor.tenantId, mailboxes, f.box.id); f.store.remove(f.actor.tenantId, drafts, f.draft.id); }
  const before = f.calls(), response = await receipt(f);
  assert.equal(response.statusCode, 200, response.body);
  const value = response.json();
  assert.equal(value.key, key); assert.equal(value.kind, 'email.reply'); assert.equal(value.expectedRevision, 1);
  assert.equal(value.status, 'accepted'); assert.equal(value.delivered, false); assert.equal(value.delivery, 'not_confirmed'); assert.equal(value.automaticRetry, false);
  for (const secret of ['providerMessageId', 'accepted-provider-message', 'source-thread', 'sender@example.test', 'Synthetic approved reply', 'sessionHash', 'authorityVersion']) assert.ok(!response.body.includes(secret), secret);
  assert.equal((await f.send()).statusCode, 200); assert.equal(f.calls(), before);
  assert.notEqual((await f.send(false, 'new-key')).statusCode, 200); assert.equal(f.calls(), before);
});

test('lost response after disabling mailbox during send leaves an accepted, recoverable original receipt', async t => {
  const f = await emailReceiptFixture(t);
  f.setResponse(async () => { f.store.update(f.actor.tenantId, mailboxes, f.box.id, { enabled: false, revision: 2 }); return Response.json({ id: 'accepted-provider-message', threadId: 'source-thread' }); });
  assert.equal((await f.send()).statusCode, 503);
  assert.equal((await receipt(f)).json().status, 'accepted'); assert.equal((await f.send()).json().status, 'accepted'); assert.equal(f.calls(), 1);
});

test('same key cannot become another draft or revision, including after the original draft is gone', async t => {
  const f = await emailReceiptFixture(t); await f.send(); f.store.remove(f.actor.tenantId, drafts, f.draft.id);
  for (const [draftId, revision] of [[f.draft.id, 2], [randomUUID(), 1]] as const) {
    const response = await f.call('POST', `/${f.box.id}/drafts/${draftId}/send`, { confirmed: true, revision });
    assert.equal(response.statusCode, 409); assert.equal(response.json().error.code, 'idempotency_conflict');
  }
  assert.equal(f.calls(), 1);
});

test('authority ABA denies original-key recovery and replay under refreshed headers', async t => {
  const f = await emailReceiptFixture(t); await f.send(); f.roleABA();
  const denied = await receipt(f, true); assert.equal(denied.statusCode, 404); assert.equal(denied.json().error.code, 'email_reply_receipt_not_found');
  assert.equal((await f.send(true)).statusCode, 409); assert.equal(f.calls(), 1);
});

for (const other of ['same-user-new-session', 'other-owner', 'other-tenant'] as const) test(`original receipt is not inherited by ${other}`, async t => {
  const f = await emailReceiptFixture(t); await f.send();
  const actor = other === 'same-user-new-session' ? f.actor : { ...f.actor, userId: randomUUID(), ...(other === 'other-tenant' ? { tenantId: randomUUID() } : {}) };
  if (actor !== f.actor) seedMember(f.store, actor);
  f.cookies.kloel_session = randomUUID();
  f.store.db.prepare('INSERT INTO sessions(hash,user_id,expires,tenant_id) VALUES(?,?,?,?)').run(sessionDigest(f.cookies.kloel_session), actor.userId, Date.now() + 60000, actor.tenantId);
  assert.equal((await receipt(f, true)).statusCode, 404); assert.equal(f.calls(), 1);
});

test('legacy operations are not retroactively attributed to an HTTP session', async t => {
  const f = await emailReceiptFixture(t);
  const op = await sendEmailDraft(f.store, f.actor, f.box.id, f.draft.id, { confirmed: true, revision: 1 }, key, { fetchImpl: async () => Response.json({ id: 'legacy-accepted', threadId: 'source-thread' }) });
  assert.equal(op.status, 'accepted'); assert.equal((await receipt(f)).statusCode, 404); assert.equal((await f.send()).statusCode, 409);
  assert.equal(f.store.list(f.actor.tenantId, operations)[0].humanReceipt, undefined); assert.equal(f.calls(), 0);
});

test('uncertain send stays recoverable after disconnect without implicit retry', async t => {
  const f = await emailReceiptFixture(t); f.setResponse(async () => { throw new Error('lost response'); });
  assert.equal((await f.send()).json().status, 'uncertain');
  f.store.remove(f.actor.tenantId, 'oauth-connections', f.connection.id);
  const result = (await receipt(f)).json(); assert.equal(result.status, 'uncertain'); assert.equal(result.requiresReconciliation, true);
  assert.equal((await f.send()).json().status, 'uncertain'); assert.equal(f.calls(), 1);
});

test('new receipt and source locks are committed together, before provider dispatch', async t => {
  const f = await emailReceiptFixture(t);
  f.setResponse(async () => {
    const op = f.store.list(f.actor.tenantId, operations)[0];
    assert.equal((op.humanReceipt as any).schemaVersion, 1); assert.equal((op.humanReceipt as any).expectedRevision, 1);
    assert.equal(f.store.get(f.actor.tenantId, drafts, f.draft.id)!.status, 'pending');
    assert.equal((await receipt(f)).json().status, 'pending');
    assert.equal((await f.send()).json().status, 'pending');
    return Response.json({ id: 'accepted-provider-message', threadId: 'source-thread' });
  });
  assert.equal((await f.send()).json().status, 'accepted'); assert.equal(f.calls(), 1);
});
