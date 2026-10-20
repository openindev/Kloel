import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Entity, Store } from './store.js';
import { DomainError } from './domains.js';
import { MembershipError } from './memberships/service.js';
import { requireRequestPermission } from './memberships/access.js';
import { chatGeneration } from './conversation-replies-shared.js';
import { closeWithin } from './conversation-analysis/service.js';

const idSchema = z.object({ id: z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/) }).strict();
const changeSchema = z.object({
  expectedVersion: z.string().regex(/^[a-f0-9]{64}$/),
  subject: z.string().trim().max(300).optional(),
  status: z.enum(['open', 'pending', 'closed']).optional(),
  tags: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
}).strict().refine(value => Object.keys(value).length > 1);
const noteSchema = z.object({ content: z.string().trim().min(1).max(10000), idempotencyKey: z.string().uuid() }).strict();
export const conversationVersion = (entity: Entity) => createHash('sha256').update(JSON.stringify(entity)).digest('hex');

/** Control edits compare the entire stored version, including changes made by workers. */
export async function registerConversationControl(app: FastifyInstance, store: Store) {
  const base = '/api/v1/conversations/:id';
  const read = (tenantId: string, request: FastifyRequest) => {
    const entity = store.get(tenantId, 'conversations', idSchema.parse(request.params).id);
    if (!entity) throw new DomainError(404, 'not_found', 'Conversa não encontrada.');
    return entity;
  };
  const wrap = (fn: (request: FastifyRequest) => unknown) => async (request: FastifyRequest, reply: any) => {
    try { return await fn(request); }
    catch (error) {
      if (error instanceof DomainError || error instanceof MembershipError) return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
      if (error instanceof z.ZodError) return reply.code(400).send({ error: { code: 'validation_error', message: 'Dados de conversa inválidos.' } });
      throw error;
    }
  };
  app.get(base + '/control', wrap(request => {
    const actor = requireRequestPermission(store, request, 'conversations:read'), conversation = read(actor.tenantId, request);
    return { conversation, version: conversationVersion(conversation) };
  }));
  app.patch(base + '/control', wrap(request => {
    const actor = requireRequestPermission(store, request, 'conversations:write'), { expectedVersion, ...patch } = changeSchema.parse(request.body);
    return store.transaction(() => {
      requireRequestPermission(store, request, 'conversations:write');
      const previous = read(actor.tenantId, request);
      if (conversationVersion(previous) !== expectedVersion) throw new DomainError(409, 'conversation_changed', 'A conversa mudou. Atualize os dados antes de salvar novamente.');
      const conversation = patch.status === 'closed' && previous.status !== 'closed'
        ? closeWithin(store, previous, patch, { kind: 'control', userId: actor.userId }).conversation
        : store.update(actor.tenantId, 'conversations', previous.id, { ...patch, replyRevision: chatGeneration(previous) + 1 })!;
      return { conversation, version: conversationVersion(conversation) };
    });
  }));
  app.post(base + '/notes', wrap(request => {
    const actor = requireRequestPermission(store, request, 'conversations:write'), body = noteSchema.parse(request.body);
    return store.transaction(() => {
      requireRequestPermission(store, request, 'conversations:write');
      const conversation = read(actor.tenantId, request);
      const previous = store.list(actor.tenantId, 'messages').find(item => item.conversationId === conversation.id && item.noteOperationKey === body.idempotencyKey);
      if (previous) {
        if (previous.content !== body.content || previous.authorUserId !== actor.userId) throw new DomainError(409, 'idempotency_conflict', 'Esta operação já foi usada com outro conteúdo.');
        return { message: previous, replayed: true };
      }
      if (conversation.status === 'closed') throw new DomainError(409, 'conversation_closed', 'Reabra a conversa antes de adicionar uma nota.');
      const message = store.create(actor.tenantId, 'messages', { conversationId: conversation.id, role: 'system', kind: 'internal_note', content: body.content, authorUserId: actor.userId, source: 'manual', deliveryStatus: 'recorded', noteOperationKey: body.idempotencyKey });
      store.update(actor.tenantId, 'conversations', conversation.id, { lastMessageAt: message.createdAt });
      return { message, replayed: false };
    });
  }));
}
