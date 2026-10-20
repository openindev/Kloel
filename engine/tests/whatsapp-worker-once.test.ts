import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import * as workerModule from '../src/providers/worker.js';
import { whatsappConversationReplyFixture } from './fixtures/whatsapp-conversation-reply.js';
import { resolveSessionContext } from '../src/request-context.js';

const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
const generated = () => Response.json({ id: 'resp.synthetic', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Synthetic AI answer' }] }] });
const failure = (code?: string) => (error: any) => { assert.equal(typeof error.code, 'string'); if (code) assert.equal(error.code, code); return true; };

async function fixture(t: any) {
  const f = await whatsappConversationReplyFixture(t); await f.control('open');
  process.env.WHATSAPP_AUTOREPLY_ENABLED = 'false';
  const job = f.store.list(f.tenant, 'reply-jobs')[0];
  const sessionHash = createHash('sha256').update(f.cookies.owner).digest('hex');
  const authority = { sessionHash, context: resolveSessionContext(f.store, sessionHash)!.context };
  const worker = workerModule.createWhatsAppWorker(f.store); t.after(() => worker.stop());
  f.hooks.provider = (url: string) => url === 'https://api.openai.com/v1/responses' ? generated() : f.accepted('wamid.once');
  const input = { tenantId: f.tenant, jobId: job.id, expectedVersion: createHash('sha256').update(JSON.stringify(job)).digest('hex'), authority, assertAccess: () => {} };
  return { ...f, worker, input, job, current: () => f.store.get(f.tenant, 'reply-jobs', job.id)! };
}

test('one selected job executes with autoreply false and cannot run twice or drain backlog', async t => {
  const f = await fixture(t);
  assert.equal(typeof (f.worker as any).runJobOnce, 'function');
  const other = f.store.create(f.tenant, 'reply-jobs', { provider: 'meta', status: 'sending', startedAt: 1, recipient: '+5511000000000' });
  const before = f.store.get(f.tenant, 'reply-jobs', other.id), result = await (f.worker as any).runJobOnce(f.input);
  assert.equal(result.status, 'sent'); assert.equal(result.externalEffect, 'accepted'); assert.equal(result.localLink, 'linked'); assert.equal(result.automaticRetry, false);
  assert.equal(f.calls.length, 2); assert.equal((await (f.worker as any).runJobOnce(f.input)).replayed, true); assert.equal(f.calls.length, 2);
  assert.deepEqual(f.store.get(f.tenant, 'reply-jobs', other.id), before); assert.equal(process.env.WHATSAPP_AUTOREPLY_ENABLED, 'false'); assert.equal((await f.worker.tick()).status, 'disabled');
});

test('job version matches existing operator DTO and one-shot uses native strict transports despite injected fakes', async t => {
  const f = await fixture(t), listing = await f.request('GET', '/jobs'); assert.equal(listing.json().items[0].version, workerModule.whatsappJobVersion(f.job));
  const worker = workerModule.createWhatsAppWorker(f.store, { generate: async () => { throw Error('Injection must not run'); }, send: async () => { throw Error('Injection must not run'); } }); t.after(() => worker.stop());
  const result = await worker.runJobOnce(f.input); assert.equal(result.status, 'sent'); assert.equal(f.calls.length, 2);
  const openai = JSON.parse(String(f.calls[0].init.body)), meta = JSON.parse(String(f.calls[1].init.body));
  assert.equal(openai.store, false); assert.equal(openai.max_output_tokens, 1024); assert.equal(openai.tools, undefined); assert.equal(meta.to, f.sender); assert.equal(meta.context.message_id, f.source.providerMessageId);
  assert.equal(JSON.stringify(result).includes(f.sender), false); assert.equal(JSON.stringify(result).includes('wamid.'), false); assert.equal(JSON.stringify(result).includes('Synthetic AI answer'), false);
});

for (const scenario of ['stale', 'tools', 'flag', 'source_phone', 'alias', 'proof_missing', 'proof_duplicate', 'legacy', 'timestamp'] as const) test(`admission ${scenario} has zero provider calls and does not claim`, async t => {
  const f = await fixture(t); const proof = f.store.list(f.tenant, 'provider-events').find(p => p.messageId === f.source.id)!;
  if (scenario === 'stale') f.input.expectedVersion = 'a'.repeat(64);
  if (scenario === 'tools') f.store.update(f.tenant, 'agents', f.agent.id, { tools: ['search_knowledge'] });
  if (scenario === 'flag') process.env.WHATSAPP_AUTOREPLY_ENABLED = 'true';
  if (scenario === 'source_phone') f.store.update(f.tenant, 'messages', f.source.id, { phoneNumberId: '99999' });
  if (scenario === 'alias') { f.store.update(f.tenant, 'reply-jobs', f.job.id, { recipient: '+551199999999' }); f.input.expectedVersion = workerModule.whatsappJobVersion(f.current()); }
  if (scenario === 'proof_missing') f.store.remove(f.tenant, 'provider-events', proof.id);
  if (scenario === 'proof_duplicate') { const { id, createdAt, updatedAt, tenantId, ...data } = proof; f.store.create(f.tenant, 'provider-events', data); }
  if (scenario === 'legacy') f.store.update(f.tenant, 'conversations', f.conversationId, { metaIdentityStatus: 'requires_review' });
  if (scenario === 'timestamp') f.store.update(f.tenant, 'provider-events', proof.id, { providerTimestamp: '1' });
  const before = f.snapshot(); await assert.rejects(f.worker.runJobOnce(f.input), failure()); assert.deepEqual(f.snapshot(), before); assert.equal(f.calls.length, 0); assert.equal(f.current().executionMode, undefined);
});

test('original authority is real and cannot be adopted by another session, callback or role ABA', async t => {
  const f = await fixture(t); await assert.rejects(f.worker.runJobOnce({ ...f.input, authority: { ...f.input.authority, sessionHash: 'f'.repeat(64) } }), failure('manual_once_authority_changed'));
  await f.worker.runJobOnce(f.input); const before = f.snapshot();
  const token = 'synthetic-second-session', hash = createHash('sha256').update(token).digest('hex'); f.store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(hash, f.actors.owner.userId, f.tenant, Date.now() + 60000);
  const authority = { sessionHash: hash, context: resolveSessionContext(f.store, hash)!.context };
  await assert.rejects(f.worker.runJobOnce({ ...f.input, authority }), failure('manual_once_owner_conflict'));
  await assert.rejects(f.worker.runJobOnce({ ...f.input, expectedVersion: workerModule.whatsappJobVersion(f.current()) }), failure('manual_once_owner_conflict'));
  f.aba(); await assert.rejects(f.worker.runJobOnce(f.input), failure('manual_once_authority_changed')); assert.deepEqual(f.snapshot(), before); assert.equal(f.calls.length, 2);
});

test('claim guard rolls back on authority ABA inside BEGIN', async t => {
  const f = await fixture(t), original = f.store.transaction.bind(f.store), before = f.snapshot(); let once = true;
  f.store.transaction = ((fn: () => unknown) => original(() => { if (once) { once = false; f.aba(); } return fn(); })) as typeof f.store.transaction;
  await assert.rejects(f.worker.runJobOnce(f.input), failure('manual_once_authority_changed')); assert.deepEqual(f.snapshot(), before); assert.equal(f.calls.length, 0);
});

for (const change of ['prompt', 'history', 'tools', 'config', 'channel_aba', 'conversation_aba', 'authority_alias'] as const) test(`${change} during OpenAI await cannot dispatch Meta`, async t => {
  const f = await fixture(t); f.hooks.provider = async url => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    if (change === 'prompt') f.store.update(f.tenant, 'agents', f.agent.id, { prompt: 'Changed after captured prompt' });
    if (change === 'history') f.store.update(f.tenant, 'messages', f.source.id, { content: 'Changed after captured history' });
    if (change === 'tools') f.store.update(f.tenant, 'agents', f.agent.id, { tools: ['search_knowledge'] });
    if (change === 'config') process.env.OPENAI_MODEL = 'changed-after-request';
    if (change === 'channel_aba') await f.change(await f.change(f.channel, 'disable'), 'enable');
    if (change === 'conversation_aba') { await f.control('pending'); await f.control('open'); }
    if (change === 'authority_alias') { f.aba(); f.input.authority.context = resolveSessionContext(f.store, f.input.authority.sessionHash)!.context; }
    return generated();
  };
  await assert.rejects(f.worker.runJobOnce(f.input), failure()); assert.equal(f.calls.length, 1); assert.equal(f.current().status, 'failed'); assert.equal(f.current().manualOnceEffect, 'not_dispatched'); assert.equal(f.current().attempts, 1);
});

for (const outcome of ['429', 'timeout', 'function_call', 'invalid'] as const) test(`OpenAI ${outcome} is terminal with one call and zero tools or Meta calls`, async t => {
  const f = await fixture(t); f.hooks.provider = () => {
    if (outcome === 'timeout') throw Error('synthetic timeout');
    if (outcome === '429') return new Response('private', { status: 429 });
    if (outcome === 'invalid') return Response.json({ output: [] });
    return Response.json({ output: [{ type: 'function_call', call_id: 'synthetic-call', name: 'create_appointment', arguments: '{}' }] });
  };
  await assert.rejects(f.worker.runJobOnce(f.input), failure()); const replay = await f.worker.runJobOnce(f.input); assert.equal(replay.status, 'failed'); assert.equal(replay.externalEffect, 'not_dispatched'); assert.equal(replay.automaticRetry, false); assert.equal(f.calls.length, 1);
  assert.equal(f.store.list(f.tenant, 'appointments').length, 0); assert.equal(f.current().attempts, 1);
});

for (const outcome of ['429', '503', 'timeout', 'invalid'] as const) test(`Meta ${outcome} never retries and preserves precise effect class`, async t => {
  const f = await fixture(t); f.hooks.provider = url => {
    if (url === 'https://api.openai.com/v1/responses') return generated();
    if (outcome === 'timeout') throw Error('synthetic lost Meta response');
    if (outcome === 'invalid') return Response.json({ messages: [] });
    return new Response('private', { status: Number(outcome) });
  };
  await assert.rejects(f.worker.runJobOnce(f.input), failure()); const replay = await f.worker.runJobOnce(f.input);
  assert.equal(replay.status, outcome === '429' ? 'failed' : 'requires_reconciliation'); assert.equal(replay.externalEffect, outcome === '429' ? 'not_accepted' : 'unconfirmed'); assert.equal(f.calls.length, 2); assert.equal(f.current().attempts, 1);
});

test('two instances share the exact claim and legacy manual cannot race a generating once job', async t => {
  const f = await fixture(t), entered = deferred(), release = deferred(); f.hooks.provider = async url => { if (url.includes('openai')) { entered.resolve(); await release.promise; return generated(); } return f.accepted('wamid.once-concurrent'); };
  const first = f.worker.runJobOnce(f.input); await entered.promise;
  const other = workerModule.createWhatsAppWorker(f.store); t.after(() => other.stop()); const replay = await other.runJobOnce(f.input); assert.equal(replay.replayed, true); assert.equal(replay.requiresReconciliation, true); assert.equal(f.calls.length, 1);
  const manual = await f.request('POST', '/send', { to: '+' + f.sender, channelId: f.channel.id, conversationId: f.conversationId, text: 'Manual forbidden while once generating', idempotencyKey: randomUUID() }); assert.equal(manual.json().error.code, 'recipient_requires_reconciliation');
  release.resolve(); assert.equal((await first).status, 'sent'); assert.equal(f.calls.length, 2);
});

test('human reply unknown blocks once without toggling or bypassing takeover', async t => {
  const f = await fixture(t); await f.control('pending'); f.hooks.provider = () => { throw Error('Synthetic Meta uncertainty'); };
  const body = f.body(await f.context()); await f.send(body); await f.control('open'); f.input.expectedVersion = workerModule.whatsappJobVersion(f.current());
  const before = f.snapshot(); await assert.rejects(f.worker.runJobOnce(f.input), failure('human_handoff')); assert.deepEqual(f.snapshot(), before); assert.equal(f.calls.length, 1);
});

test('legacy pending and unknown sends block once without generating', async t => {
  const f = await fixture(t), pending = f.store.create(f.tenant, 'whatsapp-operations', { recipient: '+' + f.sender, phoneNumberId: '12345', status: 'pending' });
  for (const status of ['pending', 'unknown']) { f.store.update(f.tenant, 'whatsapp-operations', pending.id, { status }); const before = f.snapshot(); await assert.rejects(f.worker.runJobOnce(f.input), failure('manual_once_send_requires_reconciliation')); assert.deepEqual(f.snapshot(), before); }
  assert.equal(f.calls.length, 0);
});

for (const change of ['logout', 'role_aba', 'config', 'inbound'] as const) test(`accepted Meta survives ${change} and cannot create a false local link`, async t => {
  const f = await fixture(t); f.hooks.provider = async url => {
    if (url.includes('openai')) return generated();
    if (change === 'logout') f.store.db.prepare('DELETE FROM sessions WHERE user_id=?').run(f.actors.owner.userId);
    if (change === 'role_aba') f.aba();
    if (change === 'config') process.env.META_ACCESS_TOKEN = 'new-synthetic-token';
    if (change === 'inbound') await f.inbound();
    return f.accepted('wamid.accepted-once');
  };
  await assert.rejects(f.worker.runJobOnce(f.input), failure()); assert.equal(f.current().manualOnceEffect, 'accepted'); assert.equal(f.current().status, 'requires_reconciliation'); assert.equal(f.current().outboundMessageId, 'wamid.accepted-once');
  assert.equal(f.store.list(f.tenant, 'messages').filter(m => m.autoReplyJobId === f.job.id).length, 0);
  if (['config', 'inbound'].includes(change)) { const replay = await f.worker.runJobOnce(f.input); assert.equal(replay.externalEffect, 'accepted'); assert.equal(replay.requiresReconciliation, true); }
  else await assert.rejects(f.worker.runJobOnce(f.input), failure('manual_once_authority_changed'));
  assert.equal(f.calls.length, 2);
});

for (const stage of ['accepted_commit', 'local_link'] as const) test(`storage failure at ${stage} conserves accepted original evidence and blocks resend`, async t => {
  const f = await fixture(t), update = f.store.update.bind(f.store); let fail = true;
  f.store.update = ((tenant: string, collection: string, id: string, data: any) => { const result = update(tenant, collection, id, data); if (fail && collection === 'reply-jobs' && (stage === 'accepted_commit' ? data.manualOnceEffect === 'accepted' : data.status === 'sent')) { fail = false; throw Error('Synthetic storage error after write'); } return result; }) as typeof f.store.update;
  await assert.rejects(f.worker.runJobOnce(f.input), failure('manual_once_operation_failed')); const replay = await f.worker.runJobOnce(f.input); assert.equal(replay.externalEffect, 'accepted'); assert.equal(replay.localLink, 'not_linked'); assert.equal(replay.requiresReconciliation, true);
  assert.equal(f.store.list(f.tenant, 'messages').filter(m => m.autoReplyJobId === f.job.id).length, 0); assert.equal(f.calls.length, 2);
});

test('delivery received before acceptance is replayed to the original once message', async t => {
  const f = await fixture(t); f.hooks.provider = async url => {
    if (url.includes('openai')) return generated();
    const raw = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: { metadata: { phone_number_id: '12345' }, statuses: [{ id: 'wamid.once', status: 'read', timestamp: String(Math.floor(Date.now() / 1000)) }] } }] }] });
    const r = await f.app.inject({ method: 'POST', url: '/api/v1/webhooks/meta', payload: raw, headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=' + createHmac('sha256', f.env.META_APP_SECRET).update(raw).digest('hex') } }); assert.equal(r.statusCode, 200); return f.accepted('wamid.once');
  };
  const result = await f.worker.runJobOnce(f.input); const message = f.store.get(f.tenant, 'messages', result.messageId!)!; assert.equal(message.providerStatus, 'read'); assert.equal(message.phoneNumberId, '12345');
  assert.equal((await f.request('GET', '/jobs')).json().items.find((j: any) => j.id === f.job.id).deliveryStatus, 'read'); assert.equal(f.calls.length, 2);
});

test('manual_once cannot be resumed or recovered by ordinary tick after a restart or status reset', async t => {
  const f = await fixture(t); f.hooks.provider = () => new Response('Synthetic throttle', { status: 429 }); await assert.rejects(f.worker.runJobOnce(f.input), failure());
  f.store.update(f.tenant, 'reply-jobs', f.job.id, { status: 'paused' }); const listed = (await f.request('GET', '/jobs')).json().items[0];
  assert.equal((await f.request('POST', '/jobs/' + f.job.id + '/resume', { expectedVersion: listed.version })).json().error.code, 'job_not_resumable');
  const restart = workerModule.createWhatsAppWorker(f.store); t.after(() => restart.stop());
  for (const status of ['queued', 'sending']) { f.store.update(f.tenant, 'reply-jobs', f.job.id, { status, startedAt: 1 }); process.env.WHATSAPP_AUTOREPLY_ENABLED = 'true'; const before = f.snapshot(); assert.equal((await restart.tick()).status, 'idle'); assert.deepEqual(f.snapshot(), before); }
  const replay = await restart.runJobOnce(f.input); assert.equal(replay.replayed, true); assert.equal(f.calls.length, 1);
});

test('worker stop during generation prevents the subsequent manual_once Meta dispatch', async t => {
  const f = await fixture(t), entered = deferred(), release = deferred();
  f.hooks.provider = async url => { if (url.includes('openai')) { entered.resolve(); await release.promise; return generated(); } return f.accepted('wamid.must-not-send'); };
  const running = f.worker.runJobOnce(f.input); await entered.promise; await f.worker.stop(); release.resolve();
  await assert.rejects(running, failure('worker_stopped')); assert.equal(f.calls.length, 1); assert.equal(f.current().manualOnceEffect, 'not_dispatched');
});
