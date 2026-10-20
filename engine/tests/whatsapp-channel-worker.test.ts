import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { whatsappChannelsFixture } from './fixtures/whatsapp-channels.js';
import { createWhatsAppWorker, enqueueInboundReply } from '../src/providers/worker.js';
import { captureWhatsAppChannel } from '../src/whatsapp-channel-state.js';

const generated = () => ({ text: 'Resposta sintética', responseId: 'resp_fixture', usage: {} });
const modelReply = () => ({ id: 'resp_fixture', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Resposta sintética' }] }], usage: {} });
async function fixture(t: any) {
  const f = await whatsappChannelsFixture(t); let row = await f.change((await f.create()).row, 'enable');
  const conversation = f.store.create(f.tenant, 'conversations', { channel: 'whatsapp', status: 'open', externalContact: '+5511999999999' });
  const incoming = () => {
    const message = f.store.create(f.tenant, 'messages', { conversationId: conversation.id, role: 'user', source: 'meta', content: 'Mensagem sintética', externalContact: '+5511999999999', providerMessageId: 'wamid.' + randomUUID() });
    const job = enqueueInboundReply(f.store, f.tenant, { message, conversation, phoneNumberId: '12345', messageType: 'text', providerTimestamp: String(Math.floor(Date.now() / 1000)) });
    assert.ok(job); return job;
  };
  return { ...f, row, conversation, incoming, job: incoming(), current: () => f.read(row.id) };
}
for (const mutation of ['rename', 'no_op', 'disable_enable', 'identity', 'delete', 'agent'] as const) test('original channel snapshot fences ' + mutation + ' during inference before persisting or sending the reply', async t => {
  const f = await fixture(t), original = f.job.channelSnapshot; let sends = 0;
  const worker = createWhatsAppWorker(f.store, { generate: async () => {
    if (mutation === 'rename' || mutation === 'no_op') await f.change(f.row, 'update', { name: mutation === 'rename' ? 'Renamed' : f.row.name });
    if (mutation === 'disable_enable') await f.change(await f.change(f.row, 'disable'), 'enable');
    if (mutation === 'identity') await f.change(await f.change(f.row, 'disable'), 'update', { externalId: '54321' });
    if (mutation === 'delete') assert.equal((await f.request('DELETE', '/channels/' + f.row.id, f.control(f.row), randomUUID())).statusCode, 200);
    if (mutation === 'agent') { const next = f.store.create(f.tenant, 'agents', { name: 'Next', status: 'active' }); await f.change(f.row, 'update', { agentId: next.id }); }
    return generated();
  }, send: async () => { sends++; return 'wamid.never'; } });
  assert.equal((await worker.tick()).status, 'superseded'); const after = f.store.get(f.tenant, 'reply-jobs', f.job.id)!;
  assert.equal(after.status, 'superseded'); assert.equal(after.errorCode, 'channel_changed'); assert.equal(after.replyText, undefined); assert.deepEqual(after.channelSnapshot, original); assert.equal(sends, 0); assert.equal(f.calls.length, 0); await worker.stop();
});
test('legacy job cannot adopt current channel authority, while a newly received job can snapshot a legacy revision zero channel', async t => {
  const f = await fixture(t); f.store.update(f.tenant, 'reply-jobs', f.job.id, { channelSnapshot: null }); let generatedCount = 0;
  const worker = createWhatsAppWorker(f.store, { generate: async () => { generatedCount++; return generated(); }, send: async () => 'wamid.new' });
  assert.equal((await worker.tick()).status, 'channel_snapshot_missing'); assert.equal(generatedCount, 0);
  f.store.update(f.tenant, 'reply-jobs', f.job.id, { status: 'paused' });
  const dto = (await f.request('GET', '/jobs')).json().items.find((x: any) => x.id === f.job.id);
  assert.equal((await f.request('POST', '/jobs/' + f.job.id + '/resume', { expectedVersion: dto.version })).json().error.code, 'channel_snapshot_missing');
  f.store.update(f.tenant, 'channels', f.row.id, { revision: undefined });
  const next = f.incoming(); assert.equal((next.channelSnapshot as any).revision, 0); assert.equal((await worker.tick()).status, 'sent'); assert.equal(generatedCount, 1); await worker.stop();
});
test('paused resume requires the same captured snapshot and never rebases after a channel no-op', async t => {
  const f = await fixture(t); f.store.update(f.tenant, 'reply-jobs', f.job.id, { status: 'paused', replyText: 'Reviewed generated text' });
  let view = (await f.request('GET', '/jobs')).json().items[0]; assert.equal((await f.request('POST', '/jobs/' + f.job.id + '/resume', { expectedVersion: view.version })).statusCode, 200);
  f.store.update(f.tenant, 'reply-jobs', f.job.id, { status: 'paused' }); await f.change(f.row, 'update', { name: f.row.name }); view = (await f.request('GET', '/jobs')).json().items[0];
  const before = f.store.get(f.tenant, 'reply-jobs', f.job.id); const r = await f.request('POST', '/jobs/' + f.job.id + '/resume', { expectedVersion: view.version }); assert.equal(r.statusCode, 409); assert.equal(r.json().error.code, 'channel_changed'); assert.deepEqual(f.store.get(f.tenant, 'reply-jobs', f.job.id), before); assert.equal(f.calls.length, 0);
});
test('channel mutation in the sending BEGIN prevents dispatch even after generation was persisted', async t => {
  const f = await fixture(t), transaction = f.store.transaction.bind(f.store); let changed = false, sends = 0;
  f.store.transaction = fn => transaction(() => { if (!changed && f.store.get(f.tenant, 'reply-jobs', f.job.id)?.status === 'preparing_send') { changed = true; f.store.update(f.tenant, 'channels', f.row.id, { revision: f.row.revision + 1 }); } return fn(); });
  const worker = createWhatsAppWorker(f.store, { generate: async () => generated(), send: async () => { sends++; return 'never'; } });
  assert.equal((await worker.tick()).status, 'superseded'); assert.equal(changed, true); assert.equal(sends, 0); assert.equal(f.store.get(f.tenant, 'reply-jobs', f.job.id)!.status, 'superseded'); await worker.stop();
});
for (const stage of ['response', 'json'] as const) test('default model transport fences channel ABA after ' + stage + ' await', async t => {
  const f = await fixture(t); let sends = 0;
  const invalidate = async () => { await f.change(await f.change(f.row, 'disable'), 'enable'); };
  f.hooks.provider = async (url, init) => { assert.equal(url, 'https://api.openai.com/v1/responses'); assert.equal(init.redirect, 'error'); if (stage === 'response') { await invalidate(); return Response.json(modelReply()); } return { ok: true, json: async () => { await invalidate(); return modelReply(); } } as Response; };
  const worker = createWhatsAppWorker(f.store, { send: async () => { sends++; return 'never'; } });
  assert.equal((await worker.tick()).status, 'superseded'); assert.equal(sends, 0); assert.equal(f.calls.length, 1); assert.equal(f.store.list(f.tenant, 'agent-tool-calls').length, 0); await worker.stop();
});
test('local tool BEGIN respects the original channel snapshot, without fabricating operator authority', async t => {
  const f = await fixture(t); f.store.update(f.tenant, 'agents', f.agent.id, { tools: ['schedule_appointment'] });
  const calendar = f.store.create(f.tenant, 'calendars', { name: 'Local', provider: 'local', agentId: f.agent.id, timezone: 'UTC', availability: [], enabled: true });
  f.hooks.provider = () => Response.json({ id: 'resp_tool', output: [{ type: 'function_call', call_id: 'call1', name: 'create_appointment', arguments: JSON.stringify({ calendarId: calendar.id, title: 'Synthetic', startAt: '2030-01-07T12:00:00Z', endAt: '2030-01-07T13:00:00Z', timezone: 'UTC', confirmedByUser: true }) }] });
  const transaction = f.store.transaction.bind(f.store); let hit = false, sends = 0;
  f.store.transaction = fn => transaction(() => { if (!hit && f.store.list(f.tenant, 'agent-tool-calls').length) { hit = true; f.store.update(f.tenant, 'channels', f.row.id, { revision: f.row.revision + 1 }); } return fn(); });
  const worker = createWhatsAppWorker(f.store, { send: async () => { sends++; return 'never'; } }); await worker.tick();
  assert.equal(hit, true); assert.equal(sends, 0); assert.equal(f.store.list(f.tenant, 'appointments').length, 0); const call = f.store.list(f.tenant, 'agent-tool-calls')[0]; assert.equal(call.operatorUserId, undefined); assert.equal((call.result as any).ok, false); await worker.stop();
});
test('accepted Meta response remains durable if the channel is disabled after dispatch; no automatic repeat', async t => {
  const f = await fixture(t); let posts = 0; f.hooks.provider = async (url, init) => {
    assert.equal(url, 'https://graph.facebook.com/v25.0/12345/messages'); assert.equal(init.redirect, 'error'); posts++; await f.change(f.row, 'disable'); return Response.json({ messages: [{ id: 'wamid.accepted' }] });
  };
  const worker = createWhatsAppWorker(f.store, { generate: async () => generated() }); assert.equal((await worker.tick()).status, 'sent');
  const job = f.store.get(f.tenant, 'reply-jobs', f.job.id)!; assert.equal(job.outboundMessageId, 'wamid.accepted'); assert.equal(job.status, 'sent'); assert.equal(f.store.list(f.tenant, 'messages').filter(x => x.autoReplyJobId === job.id).length, 1);
  assert.equal((await worker.tick()).status, 'idle'); assert.equal(posts, 1); await worker.stop();
});
test('lost Meta response is quarantined despite subsequent configuration changes and restart', async t => {
  const f = await fixture(t); f.hooks.provider = async () => { await f.change(f.row, 'disable'); throw Error('Synthetic connection lost after dispatch'); };
  const worker = createWhatsAppWorker(f.store, { generate: async () => generated() }); assert.equal((await worker.tick()).status, 'requires_reconciliation'); await worker.stop();
  const next = createWhatsAppWorker(f.store, { generate: async () => { throw Error('No regeneration'); } }); assert.equal((await next.tick()).status, 'idle'); assert.equal(f.calls.length, 1); assert.equal(f.store.list(f.tenant, 'messages').filter(x => x.autoReplyJobId === f.job.id).length, 0); await next.stop();
});
test('a newly received message can use the changed channel while the original job stays superseded', async t => {
  const f = await fixture(t); await f.change(f.row, 'update', { name: 'New config' }); let sends = 0;
  const worker = createWhatsAppWorker(f.store, { generate: async () => generated(), send: async () => { sends++; return 'wamid.new'; } }); assert.equal((await worker.tick()).status, 'channel_changed'); const next = f.incoming();
  assert.notDeepEqual(next.channelSnapshot, f.job.channelSnapshot); assert.equal((await worker.tick()).status, 'sent'); assert.equal(sends, 1); assert.equal(f.store.get(f.tenant, 'reply-jobs', f.job.id)!.status, 'superseded'); await worker.stop();
});
test('provider tenant or phone drift fails closed before generation; snapshot stays original', async t => {
  const f = await fixture(t); process.env.META_PHONE_NUMBER_ID = '999'; let calls = 0; const snapshot = f.job.channelSnapshot;
  const worker = createWhatsAppWorker(f.store, { generate: async () => { calls++; return generated(); } }); assert.equal((await worker.tick()).status, 'channel_changed'); assert.equal(calls, 0); assert.deepEqual(f.store.get(f.tenant, 'reply-jobs', f.job.id)!.channelSnapshot, snapshot); await worker.stop();
  assert.deepEqual(captureWhatsAppChannel(f.store.get(f.tenant, 'channels', f.row.id)!, '12345'), snapshot);
});
