import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Store } from '../store.js';
import { DomainError } from '../domains.js';
import { MembershipError } from '../memberships/service.js';
import { capture, initialize } from './authority.js';
import { analyses, close, configure, original, projectConfiguration } from './service.js';
import { configurationSchema, revision, uuid, version } from './schema.js';
import { createAnalysisWorker } from './worker.js';

export async function registerConversationAnalysis(app: FastifyInstance, store: Store) {
  initialize(store);
  const worker = createAnalysisWorker(store), params = z.object({ id: uuid }).strict(), key = z.object({ key: uuid }).strict();
  const wrap = (fn: (request: FastifyRequest) => unknown) => async (request: FastifyRequest, reply: any) => { try { return await fn(request); } catch (e) { if (e instanceof DomainError || e instanceof MembershipError) return reply.code(e.statusCode).send({ error: { code: e.code, message: e.message } }); if (e instanceof z.ZodError) return reply.code(400).send({ error: { code: 'validation_error', message: 'Dados de análise inválidos.' } }); throw e; } };
  app.get('/api/v1/agents/:id/after-conversation', wrap(r => { const a = capture(store, r, ['agents:read']); return projectConfiguration(store, a.tenantId, params.parse(r.params).id); }));
  app.put('/api/v1/agents/:id/after-conversation', wrap(r => { const a = capture(store, r, ['agents:write', 'integrations:manage']), b = z.object({ expectedTenantId: z.string().min(1), expectedRevision: revision, idempotencyKey: uuid, configuration: configurationSchema }).strict().parse(r.body); return configure(store, a, params.parse(r.params).id, b); }));
  app.get('/api/v1/after-conversation/config-operations/:key', wrap(r => original(store, capture(store, r, ['agents:read']), key.parse(r.params).key, 'config')));
  app.post('/api/v1/conversations/:id/close', wrap(r => { const a = capture(store, r, ['conversations:write']), b = z.object({ expectedTenantId: z.string().min(1), expectedVersion: version, idempotencyKey: uuid }).strict().parse(r.body); return close(store, a, params.parse(r.params).id, b); }));
  app.get('/api/v1/conversation-close-operations/:key', wrap(r => original(store, capture(store, r, ['conversations:read']), key.parse(r.params).key, 'close')));
  app.get('/api/v1/conversations/:id/analyses', wrap(r => { const a = capture(store, r, ['conversations:read']), q = z.object({ cursor: uuid.optional() }).strict().parse(r.query); return analyses(store, a.tenantId, params.parse(r.params).id, q.cursor); }));
  app.addHook('onClose', async () => { await worker.stop(); });
  return worker;
}
