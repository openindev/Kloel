import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Store, Entity } from './store.js';
import { DomainError } from './domains.js';
import { MembershipError } from './memberships/service.js';
import { requireRequestPermission } from './memberships/access.js';
import { resolveSessionContext, sameRequestContext } from './request-context.js';
import { hasPermission } from './memberships/permissions.js';

export const conversationEditorStates = 'conversation-editor-states';
export const conversationReadMarkers = 'conversation-read-markers';
export const conversationTagCatalogs = 'conversation-tag-catalogs';
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
const tag = z.object({ id: z.string().uuid(), label: z.string().trim().min(1).max(80).refine(value => !/[\x00-\x1f\x7f]/.test(value)), color: z.string().regex(/^#[a-f\d]{6}$/i), autoAdd: z.boolean(), condition: z.string().trim().max(2000).optional() }).strict();
const tagsSchema = z.array(tag).max(200).refine(items => new Set(items.map(t => t.id)).size === items.length && new Set(items.map(t => t.label.normalize('NFKC').toLowerCase())).size === items.length);
const patchSchema = z.object({ read: z.boolean().optional(), starred: z.boolean().optional(), archived: z.boolean().optional(), tagIds: z.array(z.string().uuid()).max(100).refine(ids => new Set(ids).size === ids.length).optional(), assigneeUserId: z.string().min(1).max(128).nullable().optional() }).strict().refine(body => Object.keys(body).length > 0);
function fail(code: string, status = 409): never { throw new DomainError(status, code, status === 404 ? 'Conversa não encontrada.' : 'Os dados mudaram. Atualize antes de salvar novamente.'); }
const revision = (row?: Entity) => { const value = row?.revision ?? 0; if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) >= Number.MAX_SAFE_INTEGER) fail('conversation_editor_invalid'); return Number(value); };

/** UI state only: never modifies runtime conversation status, execution tags or messages. */
export async function registerConversationEditorState(app: FastifyInstance, store: Store) {
  const capture = (request: FastifyRequest, write = false) => {
    if (request.apiKey || request.headers.authorization || !request.cookies?.kloel_session) fail('human_session_required', 401);
    const actor = requireRequestPermission(store, request, write ? 'conversations:write' : 'conversations:read');
    const hash = createHash('sha256').update(request.cookies.kloel_session).digest('hex'), session = resolveSessionContext(store, hash);
    if (!session?.actor || session.actor.userId !== actor.userId || session.actor.tenantId !== actor.tenantId) fail('unauthorized', 401);
    return { ...actor, context: session.context };
  };
  type Actor = ReturnType<typeof capture>;
  const same = (request: FastifyRequest, actor: Actor, write = false) => { if (!sameRequestContext(capture(request, write).context, actor.context)) fail('context_changed_in_flight'); };
  const unique = (rows: Entity[]) => { if (rows.length > 1) fail('conversation_editor_invalid'); return rows[0]; };
  const conversation = (tenant: string, conversationId: string) => store.get(tenant, 'conversations', conversationId) ?? fail('not_found', 404);
  const sharedFor = (a: Actor, conversationId: string) => unique(store.list(a.tenantId, conversationEditorStates).filter(row => row.conversationId === conversationId));
  const markerFor = (a: Actor, conversationId: string) => unique(store.list(a.tenantId, conversationReadMarkers).filter(row => row.conversationId === conversationId && row.userId === a.userId && row.membershipId === a.context.membershipId));
  const catalogRow = (a: Actor) => unique(store.list(a.tenantId, conversationTagCatalogs));
  const catalog = (a: Actor) => { const row = catalogRow(a), tags = tagsSchema.parse(row?.tags ?? []); return { revision: digest([a.tenantId, revision(row), tags]), tags }; };
  type BatchRows = { conversations: Map<string, Entity>; shared: Map<string, Entity[]>; markers: Map<string, Entity[]>; messages: Map<string, Entity[]> };
  const snapshot = (a: Actor, conversationId: string, batch?: BatchRows) => {
    if (batch) { if (!batch.conversations.has(conversationId)) fail('not_found', 404); } else conversation(a.tenantId, conversationId);
    const shared = batch ? unique(batch.shared.get(conversationId) ?? []) : sharedFor(a, conversationId), marker = batch ? unique(batch.markers.get(conversationId) ?? []) : markerFor(a, conversationId);
    const messages = batch ? batch.messages.get(conversationId) ?? [] : store.list(a.tenantId, 'messages').filter(row => row.conversationId === conversationId);
    const messageVersion = digest(messages.map(row => [row.id, row.updatedAt, row.content, row.role, row.kind]));
    const values = { starred: shared?.starred === true, archived: shared?.archived === true, tagIds: z.array(z.string().uuid()).parse(shared?.tagIds ?? []), ...(typeof shared?.assigneeUserId === 'string' ? { assigneeUserId: shared.assigneeUserId } : {}) };
    const read = marker?.seenMessageVersion === messageVersion;
    return { shared, marker, messageVersion, view: { conversationId, tenantId: a.tenantId, version: digest([a.tenantId, conversationId, revision(shared), values, a.userId, a.context.membershipId, revision(marker), marker?.seenMessageVersion ?? null, messageVersion]), read, ...values } };
  };
  const conversationEtag = (view: { conversationId: string; version: string }) => `"conversation-editor:${view.conversationId}:${view.version}"`;
  const catalogEtag = (view: { revision: string }) => `"conversation-tags:${view.revision}"`;
  const match = (request: FastifyRequest, etag: string) => { if (typeof request.headers['if-match'] !== 'string') fail('precondition_required', 428); if (request.headers['if-match'] !== etag) fail('conversation_editor_changed'); };
  const wrap = (fn: (request: FastifyRequest, reply: any) => unknown) => async (request: FastifyRequest, reply: any) => {
    reply.header('Cache-Control', 'no-store');
    try { return await fn(request, reply); }
    catch (error) {
      if (error instanceof DomainError || error instanceof MembershipError) return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
      if (error instanceof z.ZodError) return reply.code(400).send({ error: { code: 'validation_error', message: 'Confira os dados da conversa.' } });
      throw error;
    }
  };
  const conversationId = (request: FastifyRequest) => z.object({ id }).strict().parse(request.params).id;
  app.get('/api/v1/conversation-editor-states', wrap(request => {
    const a = capture(request), ids = z.object({ ids: z.string().max(3699).transform(value => value.split(',')).pipe(z.array(z.string().uuid()).min(1).max(100).refine(values => new Set(values).size === values.length)) }).strict().parse(request.query).ids;
    return store.transaction(() => {
      same(request, a); const wanted = new Set(ids);
      const group = (rows: Entity[]) => { const result = new Map<string, Entity[]>(); for (const row of rows) { const id = String(row.conversationId); if (wanted.has(id)) result.set(id, [...(result.get(id) ?? []), row]); } return result; };
      const batch: BatchRows = { conversations: new Map(store.list(a.tenantId, 'conversations').filter(row => wanted.has(row.id)).map(row => [row.id, row])), shared: group(store.list(a.tenantId, conversationEditorStates)), markers: group(store.list(a.tenantId, conversationReadMarkers).filter(row => row.userId === a.userId && row.membershipId === a.context.membershipId)), messages: group(store.list(a.tenantId, 'messages')) };
      const items = ids.map(id => snapshot(a, id, batch).view); same(request, a); return { items };
    });
  }));
  app.get('/api/v1/conversations/:id/editor-state', wrap((request, reply) => {
    const a = capture(request), result = snapshot(a, conversationId(request)).view; same(request, a); reply.header('ETag', conversationEtag(result)); return result;
  }));
  app.patch('/api/v1/conversations/:id/editor-state', wrap((request, reply) => {
    const body = patchSchema.parse(request.body), write = Object.keys(body).some(key => key !== 'read'), a = capture(request, write), selected = conversationId(request);
    return store.transaction(() => {
      same(request, a, write); const previous = snapshot(a, selected); match(request, conversationEtag(previous.view));
      if (body.tagIds) { const allowed = new Set(catalog(a).tags.map(t => t.id)); if (body.tagIds.some(tagId => !allowed.has(tagId))) fail('conversation_tag_not_found', 400); }
      // "Responsável": only a current member who can read conversations can be assigned.
      if (body.assigneeUserId) { const member = store.db.prepare('SELECT role FROM memberships WHERE tenant_id=? AND user_id=?').get(a.tenantId, body.assigneeUserId); if (!member || !hasPermission(String(member.role), 'conversations:read')) fail('conversation_assignee_invalid', 400); }
      const assignee = body.assigneeUserId !== undefined ? body.assigneeUserId : previous.view.assigneeUserId ?? null;
      const nextShared = { starred: body.starred ?? previous.view.starred, archived: body.archived ?? previous.view.archived, tagIds: body.tagIds ?? previous.view.tagIds, ...(assignee ? { assigneeUserId: assignee } : {}) };
      if (digest(nextShared) !== digest({ starred: previous.view.starred, archived: previous.view.archived, tagIds: previous.view.tagIds, ...(previous.view.assigneeUserId ? { assigneeUserId: previous.view.assigneeUserId } : {}) })) {
        const data = { conversationId: selected, ...nextShared, assigneeUserId: assignee, revision: revision(previous.shared) + 1 };
        if (previous.shared) store.update(a.tenantId, conversationEditorStates, previous.shared.id, data); else store.create(a.tenantId, conversationEditorStates, data);
      }
      if (body.read !== undefined && body.read !== previous.view.read) {
        const data = { conversationId: selected, userId: a.userId, membershipId: a.context.membershipId, seenMessageVersion: body.read ? previous.messageVersion : null, revision: revision(previous.marker) + 1 };
        if (previous.marker) store.update(a.tenantId, conversationReadMarkers, previous.marker.id, data); else store.create(a.tenantId, conversationReadMarkers, data);
      }
      same(request, a, write); const result = snapshot(a, selected).view; reply.header('ETag', conversationEtag(result)); return result;
    });
  }));
  app.get('/api/v1/conversation-tags', wrap((request, reply) => { const a = capture(request), result = catalog(a); same(request, a); reply.header('ETag', catalogEtag(result)); return result; }));
  app.put('/api/v1/conversation-tags', wrap((request, reply) => {
    const a = capture(request, true), { tags } = z.object({ tags: tagsSchema }).strict().parse(request.body);
    return store.transaction(() => {
      same(request, a, true); const previous = catalog(a); match(request, catalogEtag(previous));
      if (digest(tags) !== digest(previous.tags)) {
        const row = catalogRow(a), next = { tags, revision: revision(row) + 1 }, keep = new Set(tags.map(t => t.id));
        if (row) store.update(a.tenantId, conversationTagCatalogs, row.id, next); else store.create(a.tenantId, conversationTagCatalogs, next);
        for (const shared of store.list(a.tenantId, conversationEditorStates)) {
          const before = z.array(z.string().uuid()).parse(shared.tagIds ?? []), tagIds = before.filter(tagId => keep.has(tagId));
          if (tagIds.length !== before.length) store.update(a.tenantId, conversationEditorStates, shared.id, { tagIds, revision: revision(shared) + 1 });
        }
      }
      same(request, a, true); const result = catalog(a); reply.header('ETag', catalogEtag(result)); return result;
    });
  }));
}
