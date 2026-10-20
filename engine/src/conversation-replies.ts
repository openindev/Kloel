import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Entity, Store } from './store.js';
import { assertRequestContext } from './request-context.js';
import { resolveSessionActor } from './memberships/service.js';
import { hasPermission } from './memberships/permissions.js';
import { conversationVersion } from './conversation-control.js';
import { allowedChatOrigin, chatGeneration, chatMode } from './conversation-replies-shared.js';
import { providerAllowedForTenant, platformProvidersEnabled } from './platform-providers.js';

const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const operationKey = z.string().regex(/^[A-Za-z0-9_-]{8,128}$/);
const inputSchema = z.object({ expectedTenantId: identifier, expectedVersion: z.string().regex(/^[a-f0-9]{64}$/), idempotencyKey: operationKey }).strict();
const replySchema = inputSchema.extend({ content: z.string().trim().min(1).max(4000) });
const collection = 'conversation-reply-operations';
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
type Kind = 'takeover' | 'release' | 'reply';
class Fault extends Error { constructor(readonly status: number, readonly code: string, message = 'Atualize a conversa antes de continuar.') { super(message); } }

/** Human webchat writes and their receipts commit together; no provider request or synthetic session. */
export async function registerConversationReplies(app: FastifyInstance, store: Store, options: { now?: () => number } = {}) {
  const now = options.now ?? Date.now;
  function actor(request: FastifyRequest, write = false) {
    assertRequestContext(store, request);
    if (request.apiKey || !request.cookies?.kloel_session) throw new Fault(401, 'unauthorized', 'Entre com sua sessão para atender a conversa.');
    const current = resolveSessionActor(store, createHash('sha256').update(request.cookies.kloel_session).digest('hex'));
    if (!current || current.userId !== request.actor?.userId || current.tenantId !== request.actor?.tenantId) throw new Fault(401, 'unauthorized');
    if (!hasPermission(current.role, write ? 'conversations:write' : 'conversations:read')) throw new Fault(403, 'forbidden');
    const member = store.db.prepare('SELECT id,revision FROM memberships WHERE user_id=? AND tenant_id=?').get(current.userId, current.tenantId) as { id: string; revision: number } | undefined;
    if (!member) throw new Fault(403, 'forbidden');
    return { ...current, membershipId: member.id, membershipRevision: member.revision };
  }
  function read(tenantId: string, id: string) {
    const row = store.get(tenantId, 'conversations', id);
    if (!row) throw new Fault(404, 'not_found', 'Conversa não encontrada.');
    return row;
  }
  function availability(conversation: Entity) {
    if (conversation.channel !== 'webchat') return 'unsupported_channel';
    if (conversation.status === 'closed') return 'conversation_closed';
    const channel = typeof conversation.channelId === 'string' ? store.get(conversation.tenantId, 'channels', conversation.channelId) : undefined;
    if (!channel || channel.type !== 'webchat' || channel.provider !== 'openai' || channel.enabled !== true || channel.agentId !== conversation.agentId || !providerAllowedForTenant(String(conversation.tenantId))) return 'channel_unavailable';
    if (typeof conversation.agentId !== 'string' || !store.get(conversation.tenantId, 'agents', conversation.agentId)) return 'channel_unavailable';
    const active = store.list(conversation.tenantId, 'public-chat-sessions').some(session => session.conversationId === conversation.id && session.channelId === channel.id && session.agentId === channel.agentId && session.status === 'active' && Number(session.expiresAt) > now() && allowedChatOrigin(channel, session.origin));
    if (!active) return 'session_unavailable';
    return null;
  }
  function context(request: FastifyRequest, conversation: Entity) {
    const current = actor(request), mode = chatMode(conversation), unavailable = availability(conversation);
    const agent = typeof conversation.agentId === 'string' ? store.get(current.tenantId, 'agents', conversation.agentId) : undefined;
    const write = hasPermission(current.role, 'conversations:write');
    const noAi = Array.isArray(conversation.tags) && conversation.tags.includes('no_ai');
    const reasonCode = unavailable ?? (!write ? 'forbidden' : noAi ? 'no_ai' : agent?.status !== 'active' ? 'agent_paused' : null);
    return { conversationId: conversation.id, tenantId: conversation.tenantId, channel: conversation.channel, version: conversationVersion(conversation), mode,
      capabilities: { takeover: write && !unavailable && mode === 'ai', release: write && !unavailable && mode === 'human' && !noAi && agent?.status === 'active', reply: write && !unavailable && mode === 'human' }, reasonCode, delivery: 'available_in_chat', maxLength: 4000 };
  }
  function project(row: Entity) {
    return { key: row.key, conversationId: row.conversationId, tenantId: row.tenantId, kind: row.kind, status: row.status, automaticRetry: false,
      ...(row.errorCode ? { errorCode: row.errorCode } : {}), ...(row.status === 'succeeded' && row.result ? { result: row.result } : {}) };
  }
  function receipt(current: ReturnType<typeof actor>, id: string, key: string) {
    return store.list(current.tenantId, collection).find(row => row.key === key && row.conversationId === id && row.operatorUserId === current.userId && row.membershipId === current.membershipId && row.membershipRevision === current.membershipRevision);
  }
  function wrap(handler: (request: FastifyRequest) => unknown) {
    return async (request: FastifyRequest, response: any) => {
      response.header('Cache-Control', 'no-store');
      try { return handler(request); }
      catch (error) {
        if (error instanceof z.ZodError) return response.code(400).send({ error: { code: 'invalid_input', message: 'Confira os campos da solicitação.' } });
        if (error instanceof Fault) return response.code(error.status).send({ error: { code: error.code, message: error.message } });
        throw error;
      }
    };
  }
  const params = (request: FastifyRequest) => z.object({ id: identifier }).strict().parse(request.params);
  const base = '/api/v1/conversations/:id';
  app.get(base + '/reply-context', wrap(request => store.transaction(() => {
    const current = actor(request); return context(request, read(current.tenantId, params(request).id));
  })));
  app.get(base + '/reply-operations/:key', wrap(request => store.transaction(() => {
    const current = actor(request, true), p = z.object({ id: identifier, key: operationKey }).strict().parse(request.params);
    read(current.tenantId, p.id);
    const row = receipt(current, p.id, p.key);
    if (!row) throw new Fault(404, 'not_found', 'Operação não encontrada para este acesso.');
    actor(request, true); return project(row);
  })));
  function mutate(request: FastifyRequest, kind: Kind) {
    const original = actor(request, true), { id } = params(request), body = kind === 'reply' ? replySchema.parse(request.body) : inputSchema.parse(request.body);
    const result = store.transaction(() => {
      const current = actor(request, true);
      if (current.tenantId !== body.expectedTenantId) throw new Fault(409, 'tenant_mismatch', 'A organização mudou. Atualize a página.');
      if (current.membershipId !== original.membershipId || current.membershipRevision !== original.membershipRevision) throw new Fault(403, 'authority_changed');
      const conversation = read(current.tenantId, id), fingerprint = digest({ kind, conversationId: id, ...body });
      const existing = store.list(current.tenantId, collection).find(row => row.key === body.idempotencyKey);
      if (existing) {
        if (existing.operatorUserId !== current.userId || existing.membershipId !== current.membershipId || existing.membershipRevision !== current.membershipRevision || existing.fingerprint !== fingerprint || existing.conversationId !== id) throw new Fault(409, 'idempotency_conflict');
        return project(existing);
      }
      if (conversationVersion(conversation) !== body.expectedVersion) throw new Fault(409, 'conversation_changed');
      const unavailable = availability(conversation);
      if (unavailable) throw new Fault(409, unavailable);
      const currentContext = context(request, conversation);
      if (!currentContext.capabilities[kind === 'reply' ? 'reply' : kind]) throw new Fault(409, kind === 'reply' ? 'human_handoff_required' : currentContext.reasonCode ?? 'mode_changed');
      const tags = Array.isArray(conversation.tags) ? conversation.tags.map(String) : [];
      let message: Entity | undefined;
      if (kind === 'reply') {
        message = store.create(current.tenantId, 'messages', { conversationId: id, role: 'assistant', authorType: 'human', authorUserId: current.userId, authorMembershipId: current.membershipId, content: (body as z.infer<typeof replySchema>).content, source: 'webchat', deliveryStatus: 'available_in_chat' });
      }
      const updated = store.update(current.tenantId, 'conversations', id, { replyRevision: chatGeneration(conversation) + 1,
        ...(message ? { lastMessageAt: message.createdAt } : { status: kind === 'takeover' ? 'pending' : 'open', webchatHuman: kind === 'takeover', tags: kind === 'takeover' ? [...new Set([...tags, 'human_handoff'])] : tags.filter(tag => tag !== 'human_handoff'), lastHandoffBy: current.userId, lastHandoffMembershipId: current.membershipId }),
      })!;
      const record = store.create(current.tenantId, collection, { key: body.idempotencyKey, conversationId: id, kind, fingerprint, operatorUserId: current.userId, membershipId: current.membershipId, membershipRevision: current.membershipRevision, status: 'succeeded', result: { version: conversationVersion(updated), mode: chatMode(updated), ...(message ? { messageId: message.id, delivery: 'available_in_chat' } : {}) } });
      actor(request, true); return project(record);
    });
    const fresh = actor(request, true);
    if (fresh.membershipId !== original.membershipId || fresh.membershipRevision !== original.membershipRevision) throw new Fault(403, 'authority_changed');
    return result;
  }
  app.post(base + '/takeover', wrap(request => mutate(request, 'takeover')));
  app.post(base + '/release', wrap(request => mutate(request, 'release')));
  app.post(base + '/replies', wrap(request => mutate(request, 'reply')));
}
