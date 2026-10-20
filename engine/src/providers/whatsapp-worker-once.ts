import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Store } from '../store.js';
import { MembershipError } from '../memberships/service.js';
import { hasPermission } from '../memberships/permissions.js';
import { assertRequestContext, parseExpectedRequestContext, resolveSessionContext, sameRequestContext } from '../request-context.js';
import { createWhatsAppWorker, JobError, type ManualOnceInput } from './worker.js';
import { WhatsAppSendFault } from './whatsapp-send.js';

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), version = z.string().regex(/^[a-f0-9]{64}$/);
const paramsSchema = z.object({ id }).strict();
const querySchema = z.object({ expectedVersion: version }).strict();
const bodySchema = z.object({ expectedTenantId: id, expectedVersion: version, confirm: z.literal(true) }).strict();
class RouteError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}

/** Installs one manual executor per application registration. Never starts its scheduler. */
export async function registerWhatsAppWorkerOnce(app: FastifyInstance, store: Store) {
  const worker = createWhatsAppWorker(store), active = new Set<Promise<unknown>>();
  let closing = false;
  const stop = async () => {
    closing = true;
    await worker.stop();
    // Accepted responses must finish journaling before the application's Store closes.
    await Promise.allSettled([...active]);
  };
  app.addHook('onClose', stop);

  function capture(req: FastifyRequest) {
    if (req.apiKey || !req.cookies?.kloel_session) throw new RouteError(401, 'unauthorized');
    if (!parseExpectedRequestContext(req)) throw new RouteError(400, 'expected_context_required');
    assertRequestContext(store, req);
    const sessionHash = createHash('sha256').update(req.cookies.kloel_session).digest('hex');
    const initial = resolveSessionContext(store, sessionHash);
    if (!initial?.actor || initial.actor.userId !== req.actor?.userId || initial.actor.tenantId !== req.actor?.tenantId
      || !hasPermission(initial.actor.role, 'integrations:manage') || !hasPermission(initial.actor.role, 'conversations:write')) throw new RouteError(403, 'forbidden');
    const authority = { sessionHash, context: structuredClone(initial.context) }, tenantId = initial.actor.tenantId;
    const assertAccess = () => {
      assertRequestContext(store, req);
      const current = resolveSessionContext(store, sessionHash);
      if (!current?.actor || !sameRequestContext(authority.context, current.context)
        || !hasPermission(current.actor.role, 'integrations:manage') || !hasPermission(current.actor.role, 'conversations:write')) throw new RouteError(409, 'context_changed_in_flight');
    };
    assertAccess();
    return { tenantId, authority, assertAccess };
  }
  type Operation = NonNullable<ReturnType<typeof worker.getJobOnceOperation>>;
  const envelope = (input: ManualOnceInput, operation: Operation) => ({ tenantId: input.tenantId, jobId: input.jobId, initialVersion: input.expectedVersion, operation });
  const route = (handler: (req: FastifyRequest) => unknown) => async (req: FastifyRequest, reply: any) => {
    reply.header('Cache-Control', 'no-store');
    try { return await handler(req); }
    catch (error) {
      if (error instanceof MembershipError) return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
      const status = error instanceof z.ZodError ? 400 : error instanceof RouteError ? error.status
        : error instanceof WhatsAppSendFault ? error.status : error instanceof JobError
          ? error.code === 'job_not_found' ? 404 : error.code === 'manual_once_forbidden' || error.code === 'manual_once_authority_changed' ? 403
            : ['worker_stopped','integration_not_configured'].includes(error.code) ? 503 : 409 : 500;
      const code = error instanceof z.ZodError ? 'invalid_input' : error instanceof RouteError || error instanceof WhatsAppSendFault || error instanceof JobError ? error.code : 'manual_once_internal_error';
      return reply.code(status).send({ error: { code, message: 'Não foi possível concluir esta solicitação. Consulte o recibo do job e da versão originais antes de continuar.' } });
    }
  };
  const path = '/api/v1/whatsapp/jobs/:id/manual-once';
  app.get(path, route(req => {
    const captured = capture(req), params = paramsSchema.parse(req.params), query = querySchema.parse(req.query);
    const input = { ...captured, jobId: params.id, expectedVersion: query.expectedVersion };
    let operation: Operation | undefined;
    try { operation = worker.getJobOnceOperation(input); }
    catch (error) { if (error instanceof JobError && error.code === 'manual_once_owner_conflict') throw new RouteError(404, 'not_found'); throw error; }
    if (!operation) throw new RouteError(404, 'not_found');
    captured.assertAccess(); return envelope(input, operation);
  }));
  app.post(path, route(async req => {
    const captured = capture(req), params = paramsSchema.parse(req.params), body = bodySchema.parse(req.body);
    if (body.expectedTenantId !== captured.tenantId) throw new RouteError(409, 'context_mismatch');
    if (closing) throw new RouteError(503, 'worker_stopped');
    const input = { ...captured, jobId: params.id, expectedVersion: body.expectedVersion };
    const execution = worker.runJobOnce(input); active.add(execution);
    try { const operation = await execution; captured.assertAccess(); return envelope(input, operation); }
    finally { active.delete(execution); }
  }));
  return { stop };
}
