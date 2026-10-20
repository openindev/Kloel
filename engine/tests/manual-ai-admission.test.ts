import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { manualAiAdmissionFixture } from './fixtures/manual-ai-admission.js';
import { createWhatsAppWorker, whatsappJobVersion } from '../src/providers/worker.js';

const generated = () => Response.json({ id: 'response-synthetic', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Controlled generated reply' }] }], usage: {} });
const accepted = () => Response.json({ messages: [{ id: 'wamid.manual-admission-' + randomUUID() }] });
const defer = <T,>() => { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
const modelCalls = (f: any) => f.calls.filter((c: any) => c.url.includes('api.openai.com'));
const metaCalls = (f: any) => f.calls.filter((c: any) => c.url.includes('graph.facebook.com'));

test('manual AI context is local and admits a reviewed fresh text with closed clean history', async t => {
  const f = await manualAiAdmissionFixture(t), c = await f.context();
  assert.equal(c.canAdmit, true, JSON.stringify(c)); assert.equal(c.sourceMessageId, f.source.id); assert.equal(c.origin.provenance, 'signed_inbound');
  assert.equal(f.store.get(f.tenant, 'conversations', f.legacy.id)?.status, 'closed'); assert.equal(f.calls.length, 0);
});

for (const alternate of [false, true]) test('explicit local admission then once uses ' + (alternate ? 'independently selected Meta evidence' : 'exact signed origin'), async t => {
  const f = await manualAiAdmissionFixture(t), before = JSON.stringify(f.current()), { body, operation } = await f.approve(alternate ? f.evidence.id : undefined);
  assert.equal(operation.executionStarted, false); assert.equal(operation.automaticRetry, false); assert.equal(f.calls.length, 0); assert.equal(JSON.stringify(f.current()), before);
  const job = f.store.get(f.tenant, 'reply-jobs', operation.jobId)!; assert.equal(job.executionMode, undefined); assert.equal(job.admissionMode, 'manual_only'); assert.equal(whatsappJobVersion(job), operation.jobVersion);
  assert.equal(f.store.list(f.tenant, 'whatsapp-recipient-attestations').length, 0);
  f.hooks.provider = (url, init) => { if (url.includes('api.openai.com')) { const data = JSON.parse(String(init.body)); assert.equal(data.tools, undefined); assert.equal(data.store, false); return generated(); }
    const data = JSON.parse(String(init.body)); assert.equal(data.to, alternate ? f.destination.slice(1) : f.sender); assert.equal(data.context.message_id, f.source.providerMessageId); return accepted(); };
  const run = await f.run(operation); assert.equal(run.statusCode, 200, run.body); assert.equal(run.json().operation.externalEffect, 'accepted'); assert.equal(run.json().operation.localLink, 'linked');
  assert.equal(modelCalls(f).length, 1); assert.equal(metaCalls(f).length, 1);
  const message = f.store.get(f.tenant, 'messages', run.json().operation.messageId)!; assert.equal(message.conversationId, f.conversationId); assert.equal(message.autoReplyJobId, operation.jobId);
  assert.equal(f.current().externalContact, '+' + f.sender); assert.equal(f.current().metaIdentityPolicy, 'manual_only');
  assert.equal((await f.run(operation)).json().operation.replayed, true); assert.equal((await f.admit(body)).json().replayed, true);
  assert.deepEqual((await f.operation(body.key)).json(), operation); assert.equal(modelCalls(f).length, 1); assert.equal(metaCalls(f).length, 1);
});

test('one signed source creates one job across concurrent keys and operators; replay and absent GET are read-only', async t => {
  const f = await manualAiAdmissionFixture(t), c = await f.context(), a = f.input(c), b = f.input(c);
  const [one, two] = await Promise.all([f.admit(a), f.admit(b, 'other')]); assert.deepEqual([one.statusCode, two.statusCode].sort(), [200, 409]);
  assert.equal(f.store.list(f.tenant, 'reply-jobs').length, 1); assert.equal(f.store.list(f.tenant, 'whatsapp-manual-ai-admissions').length, 1);
  const snapshot = JSON.stringify(f.snapshot()); assert.equal((await f.operation(randomUUID())).statusCode, 404); assert.equal(JSON.stringify(f.snapshot()), snapshot); assert.equal(f.calls.length, 0);
});

test('historical original receipt survives missing source/channel/job and offline provider configuration', async t => {
  const f = await manualAiAdmissionFixture(t), { body, operation } = await f.approve(f.evidence.id);
  for (const [collection, id] of [['channels', f.channel.id], ['messages', f.source.id], ['conversations', f.conversationId], ['reply-jobs', operation.jobId]]) f.store.remove(f.tenant, collection, id);
  delete process.env.META_ACCESS_TOKEN; delete process.env.OPENAI_API_KEY;
  assert.deepEqual((await f.operation(body.key)).json(), operation); assert.equal((await f.admit(body)).json().replayed, true); assert.equal(f.calls.length, 0);
});

test('authority is bound to original cookie and membership for admission receipt and first execution', async t => {
  const f = await manualAiAdmissionFixture(t), { body, operation } = await f.approve();
  assert.equal((await f.operation(body.key, 'other')).statusCode, 404); assert.equal((await f.admit(body, 'other')).statusCode, 409); assert.equal((await f.run(operation, 'other')).statusCode, 409);
  f.aba(); await f.refreshContext(); assert.equal((await f.operation(body.key)).statusCode, 404); assert.equal((await f.run(operation)).statusCode, 409);
  assert.equal(f.store.get(f.tenant, 'reply-jobs', operation.jobId)?.executionMode, undefined); assert.equal(f.calls.length, 0);
});

test('permissions and four context headers are mandatory; no payload can supply authority or recipient', async t => {
  const f = await manualAiAdmissionFixture(t), c = await f.context(), input = f.input(c);
  assert.equal((await f.contextResponse('member')).json().canAdmit, false); assert.equal((await f.admit(input, 'member')).statusCode, 403);
  for (const extra of [{ recipient: f.destination }, { authority: {} }, { text: 'Injected generation' }]) assert.equal((await f.admit({ ...input, ...extra })).statusCode, 400);
  const r = await f.app.inject({ method: 'POST', url: '/api/v1/whatsapp/conversations/' + f.conversationId + '/manual-ai-admissions', headers: { cookie: 'kloel_session=' + f.cookies.owner }, payload: input });
  assert.equal(r.statusCode, 400); assert.equal(r.json().error.code, 'expected_context_required'); assert.equal(f.store.list(f.tenant, 'reply-jobs').length, 0);
  const serialized = JSON.stringify(c); for (const secret of [f.sender, f.destination, f.wamid, f.env.META_ACCESS_TOKEN, 'Synthetic new signed entry', 'Synthetic original manual send']) assert.equal(serialized.includes(secret), false);
});

for (const tag of ['no_ai', 'human_handoff']) test('closed historical collision with ' + tag + ' vetoes AI even after human review is current', async t => {
  const f = await manualAiAdmissionFixture(t);
  f.store.update(f.tenant, 'conversations', f.legacy.id, { tags: [tag] });
  await f.control({ status: 'pending', tags: ['no_ai'] });
  const c = await f.request('GET', f.path + '/whatsapp-identity-review');
  const r = await f.request('POST', f.path + '/whatsapp-identity-review', { expectedTenantId: f.tenant, expectedVersion: c.json().version, key: randomUUID(), decision: 'human_only', confirm: true }); assert.equal(r.statusCode, 200, r.body);
  await f.control({ status: 'open', tags: [] });
  const context = await f.context(); assert.equal(context.reasonCode, 'collision_automation_blocked'); assert.equal((await f.admit(f.input(context))).statusCode, 409); assert.equal(f.calls.length, 0);
});

for (const type of [null, 'image', 'audio']) test('no backfill of original signed message type: ' + type, async t => {
  const f = await manualAiAdmissionFixture(t), c = await f.context(), proof = f.store.list(f.tenant, 'provider-events').find(e => e.messageId === f.source.id)!;
  f.store.update(f.tenant, 'provider-events', proof.id, { messageType: type });
  const r = await f.admit(f.input(c)); assert.equal(r.statusCode, 409); assert.equal(f.store.list(f.tenant, 'reply-jobs').length, 0); assert.equal(f.calls.length, 0);
});

test('tools, autoreply and own handoff controls veto admission without mutating those settings', async t => {
  const f = await manualAiAdmissionFixture(t);
  f.store.update(f.tenant, 'agents', f.agent.id, { tools: [{ id: 'x', enabled: true }] }); assert.equal((await f.context()).reasonCode, 'tools_not_allowed');
  f.store.update(f.tenant, 'agents', f.agent.id, { tools: [] }); process.env.WHATSAPP_AUTOREPLY_ENABLED = 'true'; assert.equal((await f.context()).reasonCode, 'autoreply_must_be_disabled');
  process.env.WHATSAPP_AUTOREPLY_ENABLED = 'false'; await f.control({ tags: ['no_ai'] }); assert.equal((await f.context()).reasonCode, 'human_handoff');
  assert.equal((await f.admit(f.input(await f.context()))).statusCode, 409); assert.deepEqual(f.current().tags, ['no_ai']); assert.equal(f.calls.length, 0);
});

test('scheduler, interruption cleanup and both resume routes never adopt manual admissions', async t => {
  const f = await manualAiAdmissionFixture(t), { operation } = await f.approve(), worker = createWhatsAppWorker(f.store);
  process.env.WHATSAPP_AUTOREPLY_ENABLED = 'true';
  const before = JSON.stringify(f.store.get(f.tenant, 'reply-jobs', operation.jobId)); assert.equal((await worker.tick()).processed, 0); assert.equal(JSON.stringify(f.store.get(f.tenant, 'reply-jobs', operation.jobId)), before);
  f.store.update(f.tenant, 'reply-jobs', operation.jobId, { status: 'generating', startedAt: 1 }); const pending = JSON.stringify(f.store.get(f.tenant, 'reply-jobs', operation.jobId)); await worker.tick(); assert.equal(JSON.stringify(f.store.get(f.tenant, 'reply-jobs', operation.jobId)), pending);
  const paused = f.store.update(f.tenant, 'reply-jobs', operation.jobId, { status: 'paused' })!;
  assert.equal((await f.request('POST', '/jobs/' + operation.jobId + '/resume', { expectedVersion: whatsappJobVersion(paused) })).statusCode, 409);
  const generic = await f.request('POST', '/api/v1/providers/jobs/' + operation.jobId + '/resume'); assert.equal(generic.statusCode, 409, generic.body);
  assert.equal(f.calls.length, 0); await worker.stop();
});

test('future inbound does not supersede the manual job and cannot make its original admission runnable', async t => {
  const f = await manualAiAdmissionFixture(t), { operation } = await f.approve(), before = JSON.stringify(f.store.get(f.tenant, 'reply-jobs', operation.jobId));
  await f.inbound(); assert.equal(JSON.stringify(f.store.get(f.tenant, 'reply-jobs', operation.jobId)), before); assert.equal((await f.run(operation)).statusCode, 409);
  assert.equal(f.store.list(f.tenant, 'reply-jobs').length, 1); assert.equal(f.calls.length, 0);
});

test('selected evidence is independent of human attestation and cannot be replaced by that receipt ID', async t => {
  const f = await manualAiAdmissionFixture(t), c = await f.context();
  const wrong = await f.admit(f.input(c, randomUUID())); assert.equal(wrong.statusCode, 409); assert.equal(wrong.json().error.code, 'whatsapp_manual_ai_not_admitted');
  const original = f.evidence.recipientIdentity as any; f.store.update(f.tenant, 'whatsapp-operations', f.evidence.id, { recipientIdentity: { ...original, waId: '5511777777777' } });
  assert.equal((await f.admit(f.input(c, f.evidence.id))).statusCode, 409); assert.equal(f.calls.length, 0);
});

for (const what of ['agent', 'history', 'collision', 'channel', 'evidence'] as const) test('changed ' + what + ' between admission and claim cannot execute or recreate a job', async t => {
  const f = await manualAiAdmissionFixture(t), { body, operation } = await f.approve(f.evidence.id);
  if (what === 'agent') f.store.update(f.tenant, 'agents', f.agent.id, { prompt: 'Changed prompt' });
  if (what === 'history') f.store.create(f.tenant, 'messages', { conversationId: f.conversationId, role: 'assistant', content: 'New history' });
  if (what === 'collision') f.store.update(f.tenant, 'conversations', f.legacy.id, { status: 'pending' });
  if (what === 'channel') f.store.update(f.tenant, 'channels', f.channel.id, { revision: 4 });
  if (what === 'evidence') f.store.update(f.tenant, 'whatsapp-operations', f.evidence.id, { recipientIdentity: null });
  assert.equal((await f.run(operation)).statusCode, 409); assert.equal((await f.admit(body)).json().replayed, true); assert.equal(f.store.list(f.tenant, 'reply-jobs').length, 1); assert.equal(f.calls.length, 0);
});

test('original authority revoked during model await prevents Meta and cannot re-admit or retry the same source', async t => {
  const f = await manualAiAdmissionFixture(t), { operation } = await f.approve(f.evidence.id);
  f.hooks.provider = () => { f.aba(); return generated(); };
  const rejected = await f.run(operation); assert.equal(rejected.statusCode, 403); assert.equal(rejected.json().error.code, 'manual_once_authority_changed'); assert.equal(modelCalls(f).length, 1); assert.equal(metaCalls(f).length, 0);
  assert.equal(f.store.get(f.tenant, 'reply-jobs', operation.jobId)?.status, 'failed');
  await f.refreshContext(); const c = await f.context(); assert.equal(c.reasonCode, 'source_already_admitted'); assert.equal((await f.admit(f.input(c))).statusCode, 409);
});

test('changed input after model response is fenced before Meta', async t => {
  const f = await manualAiAdmissionFixture(t), { operation } = await f.approve();
  f.hooks.provider = () => { f.store.update(f.tenant, 'agents', f.agent.id, { prompt: 'Changed during await' }); return generated(); };
  assert.equal((await f.run(operation)).statusCode, 409); assert.equal(modelCalls(f).length, 1); assert.equal(metaCalls(f).length, 0);
});

test('Meta acceptance remains durable after late channel change and historical GET/replay perform no more I/O', async t => {
  const f = await manualAiAdmissionFixture(t), { operation } = await f.approve(f.evidence.id);
  f.hooks.provider = url => { if (url.includes('api.openai.com')) return generated(); f.store.update(f.tenant, 'channels', f.channel.id, { revision: 4, enabled: false }); return accepted(); };
  assert.equal((await f.run(operation)).statusCode, 409);
  const read = await f.once(operation); assert.equal(read.statusCode, 200, read.body); assert.equal(read.json().operation.externalEffect, 'accepted'); assert.equal(read.json().operation.localLink, 'not_linked'); assert.equal(read.json().operation.requiresReconciliation, true);
  delete process.env.META_ACCESS_TOKEN; assert.equal((await f.run(operation)).json().operation.replayed, true); assert.equal(modelCalls(f).length, 1); assert.equal(metaCalls(f).length, 1);
});

test('unknown Meta result stays unresolved and excludes human/ad hoc sends on both spellings', async t => {
  const f = await manualAiAdmissionFixture(t), { operation } = await f.approve(f.evidence.id);
  f.hooks.provider = url => { if (url.includes('api.openai.com')) return generated(); throw Error('Synthetic transport uncertainty'); };
  assert.equal((await f.run(operation)).statusCode, 409); assert.equal((await f.once(operation)).json().operation.externalEffect, 'unconfirmed');
  for (const to of [f.destination, '+' + f.sender]) assert.equal((await f.request('POST', '/send', { to, channelId: f.channel.id, idempotencyKey: randomUUID(), text: 'No concurrent effect' })).statusCode, 409);
  assert.equal((await f.run(operation)).json().operation.replayed, true); assert.equal(modelCalls(f).length, 1); assert.equal(metaCalls(f).length, 1);
});

for (const recipient of ['origin', 'observed']) test('legacy unknown on ' + recipient + ' excludes AI admission/claim before any generation', async t => {
  const f = await manualAiAdmissionFixture(t), c = await f.context(), to = recipient === 'origin' ? '+' + f.sender : f.destination;
  f.store.create(f.tenant, 'whatsapp-operations', { phoneNumberId: '12345', recipient: to, status: 'unknown', key: randomUUID() });
  assert.equal((await f.admit(f.input(c, f.evidence.id))).statusCode, 409); assert.equal(f.store.list(f.tenant, 'reply-jobs').length, 0); assert.equal(f.calls.length, 0);
});

test('human send starting after admission blocks claim on the selected observed input', async t => {
  const f = await manualAiAdmissionFixture(t), { operation } = await f.approve(f.evidence.id), entered = defer<void>(), release = defer<Response>();
  f.hooks.provider = () => { entered.resolve(); return release.promise; };
  const sending = f.request('POST', '/send', { to: f.destination, channelId: f.channel.id, idempotencyKey: randomUUID(), text: 'Human in flight' }).then(r => r); await entered.promise;
  assert.equal((await f.run(operation)).statusCode, 409); assert.equal(modelCalls(f).length, 0);
  release.resolve(accepted()); assert.equal((await sending).statusCode, 200); assert.equal(metaCalls(f).length, 1);
});

test('rollback before admission commit removes job/receipt/audit while preserving previous history', async t => {
  const f = await manualAiAdmissionFixture(t), c = await f.context(), create = f.store.create.bind(f.store), before = JSON.stringify(f.snapshot());
  f.store.create = ((tenant: any, collection: any, body: any) => { const row = create(tenant, collection, body); if (collection === 'whatsapp-manual-ai-admission-audits') throw Error('Synthetic disk failure'); return row; }) as typeof f.store.create;
  assert.equal((await f.admit(f.input(c))).statusCode, 500); assert.equal(JSON.stringify(f.snapshot()), before); assert.equal(f.calls.length, 0);
});

test('lost envelope after admission commit is recovered with GET and never creates another job', async t => {
  const f = await manualAiAdmissionFixture(t), body = f.input(await f.context()), r = await f.admit(body); assert.equal(r.statusCode, 200);
  const snapshot = JSON.stringify(f.snapshot()); const read = await f.operation(body.key); assert.equal(read.json().executionStarted, false);
  assert.equal((await f.admit(body)).json().replayed, true); assert.equal(JSON.stringify(f.snapshot()), snapshot); assert.equal(f.calls.length, 0);
});

test('authority changes inside admission BEGIN roll back the receipt, job and audit', async t => {
  const f = await manualAiAdmissionFixture(t), input = f.input(await f.context()), create = f.store.create.bind(f.store);
  f.store.create = ((tenant: any, collection: any, body: any) => { const row = create(tenant, collection, body); if (collection === 'whatsapp-manual-ai-admission-audits') f.aba(); return row; }) as typeof f.store.create;
  assert.equal((await f.admit(input)).statusCode, 409); assert.equal(f.store.list(f.tenant, 'reply-jobs').length, 0); assert.equal(f.store.list(f.tenant, 'whatsapp-manual-ai-admissions').length, 0); assert.equal(f.calls.length, 0);
});

test('two invocations of a claimed admission generate once and block both manual destinations until acceptance', async t => {
  const f = await manualAiAdmissionFixture(t), { operation } = await f.approve(f.evidence.id), entered = defer<void>(), release = defer<Response>();
  f.hooks.provider = url => { if (url.includes('api.openai.com')) { entered.resolve(); return release.promise; } return accepted(); };
  const pending = f.run(operation).then(r => r); await entered.promise;
  const concurrent = await f.run(operation); assert.equal(concurrent.statusCode, 200); assert.equal(concurrent.json().operation.replayed, true); assert.equal(concurrent.json().operation.status, 'generating');
  for (const to of [f.destination, '+' + f.sender]) assert.equal((await f.request('POST', '/send', { to, channelId: f.channel.id, idempotencyKey: randomUUID(), text: 'Blocked while AI generates' })).statusCode, 409);
  release.resolve(generated()); assert.equal((await pending).statusCode, 200); assert.equal(modelCalls(f).length, 1); assert.equal(metaCalls(f).length, 1);
});

test('another ordinary worker cannot send on the original spelling while admitted alias job is in flight', async t => {
  const f = await manualAiAdmissionFixture(t), { operation } = await f.approve(f.evidence.id), job = f.store.get(f.tenant, 'reply-jobs', operation.jobId)!;
  // A separate ordinary conversation is used to exercise phone/recipient exclusion, not same-conversation exclusion.
  const conv = f.store.create(f.tenant, 'conversations', { channel: 'whatsapp', status: 'open', tags: [], channelId: f.channel.id, agentId: f.agent.id, externalContact: '+' + f.sender });
  const source = f.store.create(f.tenant, 'messages', { conversationId: conv.id, source: 'meta', role: 'user', externalContact: '+' + f.sender, content: 'Ordinary source' });
  const ordinary = f.store.create(f.tenant, 'reply-jobs', { provider: 'meta', conversationId: conv.id, sourceMessageId: source.id, recipient: '+' + f.sender, channelId: f.channel.id, channelSnapshot: job.channelSnapshot, agentId: f.agent.id, incomingAt: Date.now(), status: 'queued', attempts: 0, dueAt: 0 });
  f.store.update(f.tenant, 'reply-jobs', job.id, { status: 'generating', executionMode: 'manual_once', manualOncePhoneNumberId: '12345' });
  process.env.WHATSAPP_AUTOREPLY_ENABLED = 'true'; let generatedCount = 0, sendCount = 0;
  const worker = createWhatsAppWorker(f.store, { generate: async () => { generatedCount++; return { text: 'must not generate', responseId: 'x', usage: {} }; }, send: async () => { sendCount++; return 'wamid.no'; } });
  const r = await worker.tick(); assert.equal(r.status, 'human_handoff'); assert.equal(generatedCount, 0); assert.equal(sendCount, 0); assert.equal(f.store.get(f.tenant, 'reply-jobs', ordinary.id)?.status, 'paused'); await worker.stop();
});

test('admission identity and recipient cannot be changed on a queued job to bypass the stored decision', async t => {
  const f = await manualAiAdmissionFixture(t), { operation } = await f.approve(f.evidence.id);
  const altered = f.store.update(f.tenant, 'reply-jobs', operation.jobId, { recipient: '+5511777777777' })!;
  const r = await f.run({ ...operation, jobVersion: whatsappJobVersion(altered) }); assert.equal(r.statusCode, 409); assert.equal(r.json().error.code, 'manual_admission_invalid'); assert.equal(f.calls.length, 0);
});

test('Meta acceptance survives authority revocation with no historical retry under a new authority', async t => {
  const f = await manualAiAdmissionFixture(t), { body, operation } = await f.approve(f.evidence.id);
  f.hooks.provider = url => { if (url.includes('api.openai.com')) return generated(); f.aba(); return accepted(); };
  assert.equal((await f.run(operation)).statusCode, 403);
  const job = f.store.get(f.tenant, 'reply-jobs', operation.jobId)!; assert.equal(job.manualOnceEffect, 'accepted'); assert.equal(job.status, 'requires_reconciliation'); assert.equal(typeof job.outboundMessageId, 'string');
  await f.refreshContext(); assert.equal((await f.operation(body.key)).statusCode, 404); assert.equal((await f.once(operation)).statusCode, 404); assert.equal(metaCalls(f).length, 1);
});

test('an actual new signed media input and expired timestamp are not admitted as fresh text', async t => {
  const f = await manualAiAdmissionFixture(t); await f.inbound({ type: 'image' });
  const media = await f.context(); assert.equal(media.reasonCode, 'source_not_text'); assert.equal((await f.admit(f.input(media))).statusCode, 409);
  await f.inbound({ timestamp: String(Math.floor(Date.now() / 1000) - 86401) });
  const expired = await f.context(); assert.equal(expired.reasonCode, 'outside_window'); assert.equal((await f.admit(f.input(expired))).statusCode, 409);
  assert.equal(f.store.list(f.tenant, 'reply-jobs').length, 0); assert.equal(f.calls.length, 0);
});
