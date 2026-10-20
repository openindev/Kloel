import { beforeEach, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { Store, type Entity } from '../src/store.js';
import { registerConversationEditorState, conversationEditorStates, conversationReadMarkers } from '../src/conversation-editor-state.js';
import { resolveSessionContext, CONTEXT_HEADERS } from '../src/request-context.js';
import { seedMember } from './fixtures/membership.js';

let app: FastifyInstance, store: Store, cookie: string, conversation: Entity;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const headers = () => { const context = resolveSessionContext(store, hash(cookie))!.context; return { [CONTEXT_HEADERS.userId]: context.userId, [CONTEXT_HEADERS.tenantId]: context.tenantId!, [CONTEXT_HEADERS.membershipId]: context.membershipId!, [CONTEXT_HEADERS.authorityVersion]: context.authorityVersion }; };
const get = (id = conversation.id) => app.inject({ url: `/api/v1/conversations/${id}/editor-state`, headers: headers() });
const patch = (body: Record<string, unknown>, etag: string, id = conversation.id) => app.inject({ method: 'PATCH', url: `/api/v1/conversations/${id}/editor-state`, headers: { ...headers(), 'if-match': etag }, payload: body });
const catalog = () => app.inject({ url: '/api/v1/conversation-tags', headers: headers() });
const put = (tags: object[], etag: string) => app.inject({ method: 'PUT', url: '/api/v1/conversation-tags', headers: { ...headers(), 'if-match': etag }, payload: { tags } });
const tag = (label = 'Cliente') => ({ id: randomUUID(), label, color: '#8b5cf6', autoAdd: false });
function member(userId: string, tenantId: string, role: 'owner' | 'viewer' = 'owner') { seedMember(store, { userId, tenantId, role }); store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(hash(userId), userId, tenantId, Date.now() + 3600000); }
beforeEach(async () => {
  store = new Store(); member('owner', 'tenant'); member('peer', 'tenant'); member('viewer', 'tenant', 'viewer'); member('outsider', 'other'); cookie = 'owner';
  conversation = store.create('tenant', 'conversations', { channel: 'whatsapp', status: 'open', tags: ['runtime_tag'], replyRevision: 4 });
  app = Fastify(); app.addHook('onRequest', async request => { request.cookies = { kloel_session: cookie }; request.actor = resolveSessionContext(store, hash(cookie))?.actor; });
  await registerConversationEditorState(app, store); await app.ready();
});
afterEach(async () => { await app.close(); store.close(); });

test('initial editorial state is local, empty, versioned and does not modify conversation or schema', async () => {
  const schema = store.db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name").all();
  const response = await get(), value = response.json(); assert.equal(response.statusCode, 200); assert.equal(value.read, false); assert.equal(value.starred, false); assert.equal(value.archived, false); assert.deepEqual(value.tagIds, []);
  assert.equal(response.headers.etag, `"conversation-editor:${conversation.id}:${value.version}"`); assert.equal(response.headers['cache-control'], 'no-store'); assert.equal(store.list('tenant', conversationEditorStates).length, 0);
  assert.deepEqual(store.get('tenant', 'conversations', conversation.id), conversation); assert.deepEqual(store.db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name").all(), schema);
});

test('star/archive share tenant state but never close a conversation or change executor tags', async () => {
  const initial = await get(), changed = await patch({ starred: true, archived: true }, String(initial.headers.etag)); assert.equal(changed.statusCode, 200);
  assert.equal(changed.json().starred, true); assert.equal(changed.json().archived, true); assert.notEqual(changed.json().version, initial.json().version);
  assert.deepEqual(store.get('tenant', 'conversations', conversation.id), conversation); cookie = 'peer'; const other = await get(); assert.equal(other.json().starred, true); assert.equal(other.json().archived, true);
});

test('If-Match is mandatory and old versions reject lost updates including ABA', async () => {
  const initial = await get(), etag = String(initial.headers.etag);
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/v1/conversations/${conversation.id}/editor-state`, headers: headers(), payload: { starred: true } })).statusCode, 428);
  const set = await patch({ starred: true }, etag); assert.equal(set.statusCode, 200); assert.equal((await patch({ archived: true }, etag)).statusCode, 409);
  const unset = await patch({ starred: false }, String(set.headers.etag)); assert.equal(unset.statusCode, 200); assert.notEqual(unset.headers.etag, etag); assert.equal((await patch({ starred: true }, etag)).statusCode, 409);
});

test('read marker belongs to current user/membership and a new message becomes unread', async () => {
  store.create('tenant', 'messages', { conversationId: conversation.id, role: 'user', content: 'Olá' }); const initial = await get();
  const read = await patch({ read: true }, String(initial.headers.etag)); assert.equal(read.json().read, true);
  cookie = 'peer'; const peer = await get(); assert.equal(peer.json().read, false); await patch({ read: true }, String(peer.headers.etag)); cookie = 'owner'; assert.equal((await get()).headers.etag, read.headers.etag);
  store.create('tenant', 'messages', { conversationId: conversation.id, role: 'user', content: 'Outra pergunta' }); const newer = await get(); assert.equal(newer.json().read, false); assert.notEqual(newer.headers.etag, read.headers.etag);
  assert.equal((await patch({ read: true }, String(read.headers.etag))).statusCode, 409); assert.equal((await patch({ read: true }, String(newer.headers.etag))).statusCode, 200);
  store.db.prepare('DELETE FROM memberships WHERE user_id=?').run('owner'); seedMember(store, { userId: 'owner', tenantId: 'tenant', role: 'owner' }); assert.equal((await get()).json().read, false);
});

test('viewer may mark own read state but cannot mutate shared flags or catalog', async () => {
  cookie = 'viewer'; const initial = await get(); assert.equal((await patch({ read: true }, String(initial.headers.etag))).statusCode, 200);
  const current = await get(); assert.equal((await patch({ starred: true }, String(current.headers.etag))).statusCode, 403); assert.equal((await patch({ read: false, archived: true }, String(current.headers.etag))).statusCode, 403);
  const tags = await catalog(); assert.equal((await put([tag()], String(tags.headers.etag))).statusCode, 403); assert.equal((await get()).json().read, true);
});

test('catalog CRUD and assignments are CAS-bound; deletion removes references atomically only in this tenant', async () => {
  const initial = await catalog(), first = tag(), second = tag('Suporte'); assert.deepEqual(initial.json().tags, []);
  const created = await put([first, second], String(initial.headers.etag)); assert.equal(created.statusCode, 200); assert.equal(created.headers.etag, `"conversation-tags:${created.json().revision}"`);
  const conversationBefore = await get(); const assigned = await patch({ tagIds: [first.id, second.id] }, String(conversationBefore.headers.etag)); assert.equal(assigned.statusCode, 200);
  const otherShared = store.create('other', conversationEditorStates, { conversationId: 'foreign', tagIds: [first.id], revision: 1 });
  const changed = await put([{ ...second, label: 'Suporte VIP', color: '#22C55E', autoAdd: true, condition: 'Configuração preservada' }], String(created.headers.etag)); assert.equal(changed.statusCode, 200);
  assert.deepEqual((await get()).json().tagIds, [second.id]); assert.notEqual((await get()).headers.etag, assigned.headers.etag); assert.equal((await patch({ archived: true }, String(assigned.headers.etag))).statusCode, 409);
  assert.deepEqual(store.get('other', conversationEditorStates, otherShared.id), otherShared); assert.deepEqual(store.get('tenant', 'conversations', conversation.id), conversation);
  assert.equal((await put([], String(initial.headers.etag))).statusCode, 409); assert.equal((await catalog()).json().tags[0].condition, 'Configuração preservada');
});

test('invalid and unknown tags reject without partial state', async () => {
  const initial = await catalog(), etag = String(initial.headers.etag), valid = tag();
  for (const tags of [[valid, valid], [valid, { ...tag(), label: valid.label.toUpperCase() }], [{ ...valid, color: 'javascript:bad' }], [{ ...valid, id: 'not-uuid' }], [{ ...valid, secret: 'x' }]]) assert.equal((await put(tags, etag)).statusCode, 400);
  const state = await get(); assert.equal((await patch({ starred: true, tagIds: [randomUUID()] }, String(state.headers.etag))).statusCode, 400); assert.equal((await get()).json().starred, false);
  assert.equal((await patch({ status: 'closed' }, String(state.headers.etag))).statusCode, 400); assert.equal((await patch({}, String(state.headers.etag))).statusCode, 400); assert.equal(store.list('tenant', conversationEditorStates).length, 0);
});

test('foreign conversation and stale session authority never disclose or mutate state', async () => {
  const initial = await get(), staleHeaders = headers(); cookie = 'outsider'; assert.equal((await get()).statusCode, 404); assert.equal((await patch({ starred: true }, String(initial.headers.etag))).statusCode, 404); assert.deepEqual((await catalog()).json().tags, []);
  cookie = 'owner'; store.db.prepare("UPDATE memberships SET revision=revision+1 WHERE user_id='owner'").run();
  const result = await app.inject({ method: 'PATCH', url: `/api/v1/conversations/${conversation.id}/editor-state`, headers: { ...staleHeaders, 'if-match': String(initial.headers.etag) }, payload: { starred: true } }); assert.equal(result.statusCode, 409); assert.equal(store.list('tenant', conversationEditorStates).length, 0);
  assert.equal((await app.inject({ url: `/api/v1/conversations/${conversation.id}/editor-state`, headers: { ...headers(), authorization: 'Bearer fixture' } })).statusCode, 401);
});

test('idempotent local assignment/read preserves revision and never creates provider operations', async () => {
  const initial = await get(), first = await patch({ starred: true, read: true }, String(initial.headers.etag)); const again = await patch({ starred: true, read: true }, String(first.headers.etag));
  assert.equal(again.statusCode, 200); assert.equal(again.headers.etag, first.headers.etag); assert.equal(store.list('tenant', conversationEditorStates).length, 1); assert.equal(store.list('tenant', conversationReadMarkers).length, 1); assert.deepEqual(store.list('tenant', 'provider-operations'), []);
});

test('batch reads preserve order and exact single-item DTO with four tenant collection scans', async () => {
  const second = store.create('tenant', 'conversations', { channel: 'webchat', status: 'open' });
  const firstView = await get(), updated = await patch({ starred: true, read: true }, String(firstView.headers.etag));
  const secondView = await get(second.id), originalList = store.list.bind(store), scans: string[] = [];
  store.list = (tenant, collection) => { scans.push(`${tenant}:${collection}`); return originalList(tenant, collection); };
  const response = await app.inject({ url: `/api/v1/conversation-editor-states?ids=${second.id},${conversation.id}`, headers: headers() });
  assert.equal(response.statusCode, 200); assert.deepEqual(response.json().items, [secondView.json(), updated.json()]);
  assert.deepEqual(scans.sort(), ['tenant:conversation-editor-states', 'tenant:conversation-read-markers', 'tenant:conversations', 'tenant:messages']);
});

test('batch rejects missing/duplicate/oversized ids and all foreign references without partial results', async () => {
  const foreign = store.create('other', 'conversations', {});
  for (const query of ['', '?ids=', `?ids=${conversation.id},${conversation.id}`, '?ids=not-uuid', '?ids=' + Array.from({ length: 101 }, () => randomUUID()).join(',')]) {
    const result = await app.inject({ url: '/api/v1/conversation-editor-states' + query, headers: headers() }); assert.equal(result.statusCode, 400);
  }
  const denied = await app.inject({ url: `/api/v1/conversation-editor-states?ids=${conversation.id},${foreign.id}`, headers: headers() }); assert.equal(denied.statusCode, 404); assert.equal(denied.json().items, undefined);
  assert.equal(store.list('tenant', conversationEditorStates).length, 0); assert.equal(store.list('tenant', conversationReadMarkers).length, 0);
});

test('assignee ("Responsável") is shared, validated against current members and clearable', async () => {
  const initial = await get(); assert.equal(initial.json().assigneeUserId, undefined);
  assert.equal((await patch({ assigneeUserId: 'outsider' }, String(initial.headers.etag))).json().error.code, 'conversation_assignee_invalid');
  const assigned = await patch({ assigneeUserId: 'peer' }, String(initial.headers.etag)); assert.equal(assigned.statusCode, 200, assigned.body); assert.equal(assigned.json().assigneeUserId, 'peer');
  cookie = 'peer'; const seen = await get(); assert.equal(seen.json().assigneeUserId, 'peer');
  const cleared = await patch({ assigneeUserId: null }, String(seen.headers.etag)); assert.equal(cleared.json().assigneeUserId, undefined);
  cookie = 'viewer'; const denied = await patch({ assigneeUserId: 'viewer' }, String((await get()).headers.etag)); assert.equal(denied.statusCode, 403);
  assert.deepEqual(store.get('tenant', 'conversations', conversation.id), conversation);
});
