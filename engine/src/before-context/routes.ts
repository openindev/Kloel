import { registerBeforeHttp } from './http-routes.js';
import { openingSourceAvailability } from './http-source.js';
import { z } from 'zod';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Store } from '../store.js';
import { DomainError } from '../domains.js';
import { MembershipError } from '../memberships/service.js';
import { parseConfiguration, testFactsSchema } from './schema.js';
import { captureBeforeOperator, configure, configuration, getConfigReceipt, getOpening, initializeBeforeContext, openConversation, openingReceipt, openingHistory, preview, fail } from './operations.js';

const uuid = z.string().uuid(), revision = z.number().int().nonnegative().safe(), tenant = z.string().min(1).max(128);
export async function registerBeforeContext(app: FastifyInstance, store: Store) {
  initializeBeforeContext(store);
  await registerBeforeHttp(app,store);
  const wrap = (handler: (request: FastifyRequest, reply: FastifyReply) => unknown) => async (request: FastifyRequest, reply: FastifyReply) => {
    reply.header('Cache-Control', 'no-store');
    try { return await handler(request, reply); }
    catch (error) {
      if (error instanceof z.ZodError) return reply.code(400).send({ error: { code: 'invalid_input', message: 'Confira os tipos, campos e limites do contexto inicial.' } });
      if (error instanceof DomainError || error instanceof MembershipError) return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
      throw error;
    }
  };
  const agentId = (request: FastifyRequest) => z.object({ id: uuid }).strict().parse(request.params).id;
  const key = (request: FastifyRequest) => z.object({ key: uuid }).strict().parse(request.params).key;
  const base = '/api/v1/agents/:id/before-context';
  app.get(base, wrap(request => { const a = captureBeforeOperator(store, request, 'agents:write'), id = agentId(request); if (!store.get(a.tenantId, 'agents', id)) fail(404, 'not_found'); const { row: _row, ...result } = configuration(store, a.tenantId, id); a.assertCurrent(); return result; }));
  app.put(base, { bodyLimit: 40000 }, wrap(request => {
    const a = captureBeforeOperator(store, request, 'agents:write'), body = z.object({ expectedTenantId: tenant, expectedRevision: revision, idempotencyKey: uuid, configuration: z.unknown() }).strict().parse(request.body);
    return configure(store, a, agentId(request), { ...body, configuration: parseConfiguration(body.configuration) });
  }));
  app.get('/api/v1/before-context/config-operations/:key', wrap(request => getConfigReceipt(store, captureBeforeOperator(store, request, 'agents:write'), key(request))));
  app.get(base + '/availability', wrap(request => {
    const a = captureBeforeOperator(store, request), id = agentId(request); if (!store.get(a.tenantId, 'agents', id)) fail(404, 'not_found'); const c = configuration(store, a.tenantId, id); a.assertCurrent(); return { agentId: id, enabled: c.configuration.enabled, revision: c.revision, supportedSurfaces: ['private', 'webchat', 'voice_private', 'voice_incoming'], ...(openingSourceAvailability(store,a.tenantId,id)?{httpSource:openingSourceAvailability(store,a.tenantId,id)}:{}) };
  }));
  app.post(base + '/preview', { bodyLimit: 40000 }, wrap(request => {
    const a = captureBeforeOperator(store, request, 'agents:write'), body = z.object({ configuration: z.unknown(), testFacts: testFactsSchema.optional() }).strict().parse(request.body);
    const result = preview(store, a.tenantId, agentId(request), parseConfiguration(body.configuration), body.testFacts); a.assertCurrent(); return result;
  }));
  app.post('/api/v1/ai/conversations/open', wrap(async request => {
    const a = captureBeforeOperator(store, request), body = z.object({ expectedTenantId: tenant, agentId: uuid, expectedConfigRevision: revision, expectedHttpRevision: revision.optional(), idempotencyKey: uuid, mode: z.enum(['live', 'test']), testFacts: testFactsSchema.optional() }).strict().refine(v => v.mode === 'test' || v.testFacts === undefined).parse(request.body);
    if (body.expectedTenantId !== a.tenantId) fail(409, 'context_mismatch'); const { expectedTenantId: _tenant, ...intent } = body;
    const result = await openConversation(store, a, intent); a.assertCurrent(); return result;
  }));
  app.get('/api/v1/ai/conversation-openings/:key', wrap(request => { const a = captureBeforeOperator(store, request); return openingReceipt(getOpening(store, a, key(request)),store); }));
  app.get('/api/v1/ai/conversation-openings/:key/history', wrap(request => { const a = captureBeforeOperator(store, request), q = z.object({ after: uuid.optional() }).strict().parse(request.query); return openingHistory(store, a, key(request), q.after); }));
}
