import { beforeEach, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { Store, type Entity } from '../src/store.js';
import { registerConversationEditorState, conversationEditorStates, conversationTagCatalogs } from '../src/conversation-editor-state.js';
import { ConversationAutoTagWorker, autoTagBudgets, autoTagRuns, registerConversationAutoTags } from '../src/conversation-auto-tags.js';
import { recordMetaDelivery } from '../src/providers/meta-delivery.js';
import { resolveSessionContext, CONTEXT_HEADERS } from '../src/request-context.js';
import { seedMember } from './fixtures/membership.js';

let app: FastifyInstance, store: Store, cookie: string, worker: ConversationAutoTagWorker, now: number, calls: any[], answer: (body: any) => Response;
const env = { ...process.env };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const headers = () => { const context = resolveSessionContext(store, hash(cookie))!.context; return { [CONTEXT_HEADERS.userId]: context.userId, [CONTEXT_HEADERS.tenantId]: context.tenantId!, [CONTEXT_HEADERS.membershipId]: context.membershipId!, [CONTEXT_HEADERS.authorityVersion]: context.authorityVersion }; };
const callback = { id: randomUUID(), label: 'Retornar ligação', color: '#585df5', autoAdd: true, condition: 'A pessoa pediu que alguém da equipe retorne o contato.' };
const complaint = { id: randomUUID(), label: 'Reclamação', color: '#b91c1c', autoAdd: true, condition: 'A pessoa reclamou do atendimento.' };
const manual = { id: randomUUID(), label: 'VIP', color: '#166534', autoAdd: false };
function member(userId: string, tenantId: string, role: 'owner' | 'viewer' = 'owner') { seedMember(store, { userId, tenantId, role }); store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(hash(userId), userId, tenantId, Date.now() + 3600000); }
const reply = (matches: unknown[]) => Response.json({ id: 'resp_tags', status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ matches }) }] }], usage: { input_tokens: 10, output_tokens: 5 } });
function conversation(status: string, channel = 'phone', text = 'Por favor, peçam para alguém da equipe me ligar de volta.') {
  const c = store.create('tenant', 'conversations', { channel, status, subject: 'Conversa' });
  store.create('tenant', 'messages', { conversationId: c.id, role: 'user', content: text });
  store.create('tenant', 'messages', { conversationId: c.id, role: 'assistant', content: 'Certo, vou registrar.' });
  return c;
}
const tagsOf = (id: string) => store.list('tenant', conversationEditorStates).find(r => r.conversationId === id)?.tagIds ?? [];

beforeEach(async () => {
  process.env.OPENAI_API_KEY = 'fixture-only'; process.env.PROVIDER_TENANT_ID = 'tenant'; delete process.env.PLATFORM_AI_PROVIDERS; delete process.env.AUTO_TAGS_MAX_PER_DAY;
  store = new Store(); member('owner', 'tenant'); member('viewer', 'tenant', 'viewer'); member('outsider', 'other'); cookie = 'owner'; now = Date.now(); calls = [];
  store.create('tenant', conversationTagCatalogs, { tags: [callback, complaint, manual], revision: 1 });
  answer = body => { const input = JSON.parse(body.input); return reply([{ tagId: callback.id, reason: 'Pediu retorno.', messageIds: [input.messages[0].id] }]); };
  worker = new ConversationAutoTagWorker(store, { now: () => now, idleMinutes: 30, fetch: (async (url: string, init: any) => { assert.equal(url, 'https://api.openai.com/v1/responses'); const body = JSON.parse(String(init.body)); calls.push(body); return answer(body); }) as typeof fetch });
  app = Fastify(); app.addHook('onRequest', async request => { request.cookies = { kloel_session: cookie }; request.actor = resolveSessionContext(store, hash(cookie))?.actor; });
  await registerConversationEditorState(app, store); await registerConversationAutoTags(app, store, worker); await app.ready();
});
afterEach(async () => { await app.close(); store.close(); for (const k of ['OPENAI_API_KEY', 'PROVIDER_TENANT_ID', 'PLATFORM_AI_PROVIDERS', 'AUTO_TAGS_MAX_PER_DAY']) { if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; } });

test('an ended conversation receives only the automatic tags whose condition matched, once', async () => {
  const closed = conversation('closed'), open = conversation('open');
  assert.deepEqual(await worker.tick(), { processed: 1 });
  assert.equal(calls.length, 1); const body = calls[0];
  assert.equal(body.store, false); assert.equal(body.text.format.name, 'conversation_auto_tags'); assert.deepEqual(body.text.format.schema.properties.matches.items.properties.tagId.enum, [callback.id, complaint.id]);
  const input = JSON.parse(body.input); assert.deepEqual(input.tags.map((t: any) => t.id), [callback.id, complaint.id]); assert.ok(!JSON.stringify(input).includes(manual.id));
  assert.deepEqual(tagsOf(closed.id), [callback.id]); assert.deepEqual(tagsOf(open.id), []);
  const run = store.list('tenant', autoTagRuns)[0]!; assert.equal(run.status, 'applied'); assert.deepEqual(run.appliedTagIds, [callback.id]); assert.equal(run.trigger, 'automatic');
  await worker.tick(); assert.equal(calls.length, 1, 'same messages and rules are not evaluated twice');
  const view = await app.inject({ url: `/api/v1/conversations/${closed.id}/auto-tags`, headers: headers() }); assert.equal(view.json().run.status, 'applied');
});

test('an idle chat is evaluated after the idle window; a tag removed by a person is never re-added', async () => {
  const chat = conversation('open', 'webchat');
  await worker.tick(); assert.equal(calls.length, 0, 'recent chat is still in progress');
  now += 31 * 60000; await worker.tick(); assert.deepEqual(tagsOf(chat.id), [callback.id]);
  const state = await app.inject({ url: `/api/v1/conversations/${chat.id}/editor-state`, headers: headers() });
  const removed = await app.inject({ method: 'PATCH', url: `/api/v1/conversations/${chat.id}/editor-state`, headers: { ...headers(), 'if-match': String(state.headers.etag) }, payload: { tagIds: [manual.id] } });
  assert.equal(removed.statusCode, 200, removed.body);
  store.create('tenant', 'messages', { conversationId: chat.id, role: 'user', content: 'Ainda aguardo alguém da equipe me ligar.' }); now += 31 * 60000;
  await worker.tick(); assert.equal(calls.length, 2);
  assert.deepEqual(tagsOf(chat.id), [manual.id]); assert.equal(store.list('tenant', autoTagRuns).at(-1)!.status, 'no_match');
});

test('model output outside the automatic rules or the conversation is ignored; provider failures retry at most 3 times', async () => {
  const c = conversation('closed');
  answer = () => reply([{ tagId: manual.id, reason: 'x', messageIds: ['forged'] }, { tagId: complaint.id, reason: 'Reclamou.', messageIds: ['forged'] }]);
  await worker.tick(); assert.deepEqual(tagsOf(c.id), [complaint.id]); assert.deepEqual(store.list('tenant', autoTagRuns)[0]!.matches[0].messageIds, []);
  const d = conversation('closed', 'phone', 'Quero cancelar.'); answer = () => new Response('busy', { status: 503 });
  for (let i = 0; i < 5; i++) await worker.tick();
  assert.equal(store.list('tenant', autoTagRuns).filter(r => r.conversationId === d.id && r.status === 'failed').length, 3);
});

test('manual run requires write access; daily quota and missing provider are explained without calling the model', async () => {
  const c = conversation('open');
  cookie = 'viewer'; assert.equal((await app.inject({ method: 'POST', url: `/api/v1/conversations/${c.id}/auto-tags/run`, headers: headers() })).statusCode, 403);
  cookie = 'outsider'; assert.equal((await app.inject({ method: 'POST', url: `/api/v1/conversations/${c.id}/auto-tags/run`, headers: headers() })).statusCode, 404);
  cookie = 'owner'; process.env.AUTO_TAGS_MAX_PER_DAY = '1';
  const first = await app.inject({ method: 'POST', url: `/api/v1/conversations/${c.id}/auto-tags/run`, headers: headers() });
  assert.equal(first.statusCode, 200, first.body); assert.equal(first.json().run.status, 'applied'); assert.equal(first.json().run.trigger, 'manual'); assert.deepEqual(tagsOf(c.id), [callback.id]);
  const second = await app.inject({ method: 'POST', url: `/api/v1/conversations/${c.id}/auto-tags/run`, headers: headers() });
  assert.equal(second.json().run.reasonCode, 'quota_exceeded'); assert.equal(calls.length, 1);
  const status = await app.inject({ url: '/api/v1/conversation-tags/automation', headers: headers() });
  assert.equal(status.json().available, true); assert.equal(status.json().rules, 2); assert.equal(status.json().usedToday, 1); assert.equal(status.json().dailyLimit, 1);
  delete process.env.OPENAI_API_KEY;
  const off = await app.inject({ url: '/api/v1/conversation-tags/automation', headers: headers() }); assert.equal(off.json().available, false); assert.equal(off.json().reasonCode, 'provider_not_configured');
  process.env.OPENAI_API_KEY = 'fixture-only'; process.env.PROVIDER_TENANT_ID = 'someone-else';
  const other = await app.inject({ url: '/api/v1/conversation-tags/automation', headers: headers() }); assert.equal(other.json().reasonCode, 'provider_not_enabled_for_organization');
  assert.equal(calls.length, 1);
});

test('rules removed while the model answered are not applied', async () => {
  const c: Entity = conversation('closed');
  answer = body => { const catalog = store.list('tenant', conversationTagCatalogs)[0]!; store.update('tenant', conversationTagCatalogs, catalog.id, { tags: [{ ...callback, autoAdd: false }, complaint, manual], revision: 2 }); const input = JSON.parse(body.input); return reply([{ tagId: callback.id, reason: 'Pediu retorno.', messageIds: [input.messages[0].id] }]); };
  await worker.tick(); assert.deepEqual(tagsOf(c.id), []); assert.equal(store.list('tenant', autoTagRuns)[0]!.status, 'no_match');
});

const runsOf = (tenant: string) => store.list(tenant, autoTagRuns);
function tenantWith(tenant: string, count: number) {
  store.create(tenant, conversationTagCatalogs, { tags: [callback, complaint, manual], revision: 1 });
  for (let i = 0; i < count; i++) { const c = store.create(tenant, 'conversations', { channel: 'phone', status: 'closed', subject: 'Conversa' }); store.create(tenant, 'messages', { conversationId: c.id, role: 'user', content: 'Por favor, me liguem de volta.' }); }
}

test('a tenant out of daily quota is skipped without run rows and never stops the other tenants', async () => {
  process.env.PLATFORM_AI_PROVIDERS = '1'; process.env.AUTO_TAGS_MAX_PER_DAY = '2';
  tenantWith('a-big', 6); tenantWith('b-small', 1); tenantWith('c-small', 1);
  for (let i = 0; i < 10; i++) await worker.tick();
  assert.equal(runsOf('a-big').length, 2); assert.ok(runsOf('a-big').every(r => r.status === 'applied'));
  assert.equal(runsOf('b-small').length, 1); assert.equal(runsOf('c-small').length, 1); assert.equal(calls.length, 4);
  assert.deepEqual(await worker.tick(), { processed: 0 }, 'an exhausted tenant does not use up the tick'); assert.equal(runsOf('a-big').length, 2);
});

test('one tick serves every tenant with pending work before serving any tenant twice', async () => {
  process.env.PLATFORM_AI_PROVIDERS = '1';
  tenantWith('a-big', 5); tenantWith('b-small', 1); tenantWith('c-small', 1);
  assert.deepEqual(await worker.tick(), { processed: 3 }); assert.deepEqual(['a-big', 'b-small', 'c-small'].map(t => runsOf(t).length), [1, 1, 1]);
  assert.deepEqual(await worker.tick(), { processed: 3 }); assert.equal(runsOf('a-big').length, 4);
});

test('budget used up by other runs during a tick ends that tenant turn without a run row', async () => {
  process.env.PLATFORM_AI_PROVIDERS = '1'; process.env.AUTO_TAGS_MAX_PER_DAY = '3';
  tenantWith('a-big', 3); tenantWith('b-small', 2);
  const base = answer; answer = body => { const budget = store.list('a-big', autoTagBudgets)[0]!; store.update('a-big', autoTagBudgets, budget.id, { count: 3 }); return base(body); };
  assert.deepEqual(await worker.tick(), { processed: 3 });
  assert.equal(runsOf('a-big').length, 1); assert.equal(runsOf('b-small').length, 2); assert.equal(calls.length, 3);
  assert.deepEqual(await worker.tick(), { processed: 0 }); assert.equal(runsOf('a-big').length, 1);
});

test('delivery and read receipts do not trigger another paid classification', async () => {
  const c = store.create('tenant', 'conversations', { channel: 'whatsapp', status: 'open', subject: 'WhatsApp' });
  store.create('tenant', 'messages', { conversationId: c.id, role: 'user', content: 'Me liguem de volta, por favor.' });
  store.create('tenant', 'messages', { conversationId: c.id, role: 'assistant', content: 'Certo, vou registrar.', source: 'meta', phoneNumberId: '5511999990000', providerMessageId: 'wamid.reply', deliveryStatus: 'sent', providerStatus: 'sent', providerStatusAt: 1 });
  now += 31 * 60000; await worker.tick(); assert.equal(calls.length, 1); assert.deepEqual(tagsOf(c.id), [callback.id]);
  await new Promise(resolve => setTimeout(resolve, 5));
  for (const [status, at] of [['delivered', 2], ['read', 3]] as const) recordMetaDelivery(store, 'tenant', '5511999990000', { id: 'wamid.reply', status, timestamp: String(at) });
  assert.equal(store.list('tenant', 'messages').find(m => m.providerMessageId === 'wamid.reply')!.providerStatus, 'read');
  now += 31 * 60000; await worker.tick(); assert.equal(calls.length, 1, 'receipts only change delivery metadata');
  store.create('tenant', 'messages', { conversationId: c.id, role: 'user', content: 'E também quero reclamar do atraso.' }); now += 31 * 60000;
  await worker.tick(); assert.equal(calls.length, 2, 'new content is still evaluated');
});
