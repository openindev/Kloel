import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Entity, Store } from '../store.js';
import { hasPermission } from '../memberships/permissions.js';
import { MembershipError } from '../memberships/service.js';
import { assertRequestContext, parseExpectedRequestContext, resolveSessionContext } from '../request-context.js';
import { chatGeneration } from '../conversation-replies-shared.js';
import { captureMetaIdentityReview, identityReviewCollection as collection, identityReviewHash as hash } from './meta-identity-review.js';
import { WhatsAppSendFault as Fault } from './whatsapp-send.js';

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), key = z.string().regex(/^[A-Za-z0-9_.:-]{8,128}$/);
const params = z.object({ id, key: key.optional() }).strict();
const bodySchema = z.object({ expectedTenantId: id, expectedVersion: z.string().regex(/^[a-f0-9]{64}$/), key, decision: z.literal('human_only'), confirm: z.literal(true) }).strict();

export async function registerWhatsAppIdentityReview(app: FastifyInstance, store: Store) {
  function actor(req: FastifyRequest) {
    if (req.apiKey || !req.cookies?.kloel_session) throw new Fault(401, 'unauthorized');
    if (!parseExpectedRequestContext(req)) throw new Fault(400, 'expected_context_required');
    assertRequestContext(store, req);
    const sessionHash = createHash('sha256').update(req.cookies.kloel_session).digest('hex'), s = resolveSessionContext(store, sessionHash);
    if (!s?.actor || s.actor.userId !== req.actor?.userId || s.actor.tenantId !== req.actor?.tenantId || !hasPermission(s.actor.role, 'conversations:read')) throw new Fault(403, 'forbidden');
    return { ...s.actor, membershipId: s.context.membershipId!, sessionHash, authorityVersion: s.context.authorityVersion };
  }
  function authority(req: FastifyRequest) { const original = actor(req); return { original, assert() { if (hash(actor(req)) !== hash(original)) throw new Fault(409, 'authority_changed'); } }; }
  type Actor = ReturnType<typeof actor>;
  const editable = (a: Actor) => hasPermission(a.role, 'conversations:write') && hasPermission(a.role, 'integrations:manage');
  const owns = (a: Actor, row: Entity) => row.operatorUserId === a.userId && row.membershipId === a.membershipId && row.sessionHash === a.sessionHash && row.authorityVersion === a.authorityVersion;
  function find(tenant: string, operationKey: string) { const r = store.db.prepare(`SELECT body FROM entities WHERE tenant_id=? AND collection=? AND json_extract(body,'$.key')=? LIMIT 1`).get(tenant, collection, operationKey); return r ? JSON.parse(String(r.body)) as Entity : undefined; }
  function conversation(tenant: string, conversationId: string) { const row = store.get(tenant, 'conversations', conversationId); if (!row) throw new Fault(404, 'not_found'); return row; }
  const view = (row: Entity) => ({ tenantId: row.tenantId, conversationId: row.conversationId, key: row.key, kind: 'identity_human_review' as const, status: 'applied' as const, policy: 'manual_only' as const,
    sourceMessageId: row.sourceMessageId, originalVersion: row.originalVersion, resultVersion: row.resultVersion, automaticRetry: false, createdAt: row.createdAt });
  const route = (fn: (req: FastifyRequest) => unknown) => async (req: FastifyRequest, reply: any) => {
    reply.header('Cache-Control', 'no-store');
    try { return await fn(req); }
    catch (error) {
      if (error instanceof MembershipError) return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
      if (error instanceof z.ZodError) return reply.code(400).send({ error: { code: 'invalid_input', message: 'Confira os dados da revisão.' } });
      if (error instanceof Fault) return reply.code(error.status).send({ error: { code: error.code, message: error.message } });
      return reply.code(500).send({ error: { code: 'identity_review_internal_error', message: 'Consulte o recibo original antes de continuar.' } });
    }
  };
  const prefix = '/api/v1/conversations/:id';
  app.get(prefix + '/whatsapp-identity-review', route(req => {
    z.object({}).strict().parse(req.query); const a = authority(req), p = params.parse(req.params);
    const result = captureMetaIdentityReview(store, conversation(a.original.tenantId, p.id)).view;
    if (!editable(a.original)) { result.canReview = false; result.reasonCode = 'forbidden'; }
    a.assert(); return result;
  }));
  app.get(prefix + '/whatsapp-identity-operations/:key', route(req => {
    z.object({}).strict().parse(req.query); const a = authority(req), p = params.parse(req.params), row = find(a.original.tenantId, p.key!);
    if (!row || row.conversationId !== p.id || !owns(a.original, row)) throw new Fault(404, 'not_found');
    const result = view(row); a.assert(); return result;
  }));
  app.post(prefix + '/whatsapp-identity-review', route(req => {
    const a = authority(req), p = params.parse(req.params), body = bodySchema.parse(req.body), tenant = a.original.tenantId;
    if (!editable(a.original)) throw new Fault(403, 'forbidden');
    if (body.expectedTenantId !== tenant) throw new Fault(409, 'context_mismatch');
    const fingerprint = hash([p.id, body]);
    const replay = (row: Entity) => { if (!owns(a.original, row) || row.conversationId !== p.id || row.fingerprint !== fingerprint) throw new Fault(409, 'idempotency_conflict'); a.assert(); return { operation: view(row), replayed: true }; };
    const old = find(tenant, body.key); if (old) return replay(old);
    return store.transaction(() => {
      a.assert(); const existing = find(tenant, body.key); if (existing) return replay(existing);
      const conv = conversation(tenant, p.id), current = captureMetaIdentityReview(store, conv);
      if (!current.view.canReview || current.view.version !== body.expectedVersion) throw new Fault(409, 'whatsapp_identity_review_not_admitted', 'A revisão não foi gravada. Consulte o contexto atual antes de confirmar novamente.');
      const row = store.create(tenant, collection, { key: body.key, fingerprint, operatorUserId: a.original.userId, membershipId: a.original.membershipId, sessionHash: a.original.sessionHash, authorityVersion: a.original.authorityVersion,
        conversationId: p.id, sourceMessageId: current.source!.id, proofDigest: hash(current.proof), binding: current.binding, collisionDigest: current.conflicts.digest,
        originalVersion: body.expectedVersion, status: 'applied', policy: 'manual_only' });
      const saved = store.update(tenant, 'conversations', conv.id, { metaIdentityStatus: 'reviewed_human', metaIdentityPolicy: 'manual_only', metaIdentityReviewId: row.id, replyRevision: chatGeneration(conv) + 1 })!;
      const resultVersion = hash(saved);
      const receipt = store.update(tenant, collection, row.id, { resultVersion })!;
      store.create(tenant, 'whatsapp-identity-review-audits', { conversationId: p.id, operationId: row.id, actorUserId: a.original.userId, membershipId: a.original.membershipId, policy: 'manual_only' });
      const finalConversation = conversation(tenant, p.id);
      if (hash(finalConversation) !== resultVersion || !captureMetaIdentityReview(store, finalConversation).valid) throw new Fault(409, 'whatsapp_identity_review_not_admitted');
      a.assert(); return { operation: view(receipt), replayed: false };
    });
  }));
}
