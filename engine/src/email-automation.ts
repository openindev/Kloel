import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Store } from './store.js';
import { DomainError } from './domains.js';
import { OAuthError } from './oauth/client.js';
import { accessible } from './oauth/access.js';
import { digest } from './oauth/crypto.js';
import { requireRequestPermission } from './memberships/access.js';
import { MembershipError } from './memberships/service.js';
import { activateAutomation, automationSnapshot, fail, grants, humanAuthority, jobs, publicGrant, stopAutomation } from './email-automation/authority.js';
import { EmailAutomationWorker, type AutomationOptions } from './email-automation/worker.js';
import { automationRuntime } from './email-automation/runtime.js';
export { initializeEmailAutomation } from './email-automation/authority.js';
export { EmailAutomationWorker } from './email-automation/worker.js';

export async function registerEmailAutomation(app: FastifyInstance, store: Store, options: AutomationOptions & { startWorker?: boolean } = {}) {
  const worker = new EmailAutomationWorker(store, options);
  if (options.startWorker === true) app.addHook('onReady', async () => { worker.start(); });
  app.addHook('onClose', async () => { await worker.stop(); });
  const session = (request: FastifyRequest) => digest(request.cookies?.kloel_session ?? '');
  const id = (request: FastifyRequest) => z.object({ id: z.string().uuid() }).parse(request.params).id;
  const safe = (handler: (request: FastifyRequest) => unknown) => async (request: FastifyRequest, reply: any) => {
    reply.header('Cache-Control', 'no-store');
    try { requireRequestPermission(store, request, 'integrations:manage'); humanAuthority(store, request.actor, session(request)); return handler(request); }
    catch (error) {
      if (error instanceof z.ZodError) return reply.code(400).send({ error: { code: 'invalid_email_automation_input', message: 'Confira a configuração da automação.' } });
      if (error instanceof DomainError || error instanceof MembershipError || error instanceof OAuthError) return reply.code(error instanceof OAuthError ? error.status : error.statusCode).send({ error: { code: error.code, message: error.message } });
      throw error;
    }
  };
  const access = (request: FastifyRequest) => {
    const box = store.get(request.actor.tenantId, 'email-mailboxes', id(request));
    const connection = box && store.get(request.actor.tenantId, 'oauth-connections', String(box.connectionId));
    if (!box || !connection || !accessible(request.actor, connection)) fail('email_mailbox_not_found', 404);
    return box;
  };
  const base = '/api/v1/email-agents/mailboxes/:id/automation';
  app.post(base, safe(request => activateAutomation(store, request.actor, session(request), id(request), request.body, options.now?.(), () => { requireRequestPermission(store, request, 'integrations:manage'); })));
  const sendingState = (box: ReturnType<typeof access>) => { const snapshot = automationSnapshot(store, box), runtime = automationRuntime(store); return { ...runtime, automaticSending: runtime.schedulerRunning && snapshot?.enabled === true && snapshot.status === 'active' && snapshot.mode === 'auto_reply', snapshot }; };
  app.get(base, safe(request => { const box = access(request), state = sendingState(box); const grant = store.list(request.actor.tenantId, grants).filter(g => g.mailboxId === box.id).at(-1); return { grant: grant ? { ...publicGrant(grant), status: state.snapshot?.status ?? grant.status, automaticSendingAuthorized: state.snapshot?.enabled === true && state.snapshot.status === 'active' && state.snapshot.mode === 'auto_reply', automaticSending: state.automaticSending } : null, schedulerRunning: state.schedulerRunning, automaticSending: state.automaticSending }; }));
  app.get(`${base}/jobs`, safe(request => {
    const box = access(request); const query = z.object({ page: z.coerce.number().int().min(1).default(1), size: z.coerce.number().int().min(1).max(100).default(30) }).strict().parse(request.query);
    const all = store.list(request.actor.tenantId, jobs).filter(j => j.mailboxId === box.id);
    return { total: all.length, items: all.slice((query.page - 1) * query.size, query.page * query.size).map(j => ({ id: j.id, messageId: j.sourceMessageId, draftId: j.draftId ?? null, operationId: j.operationId ?? null, status: j.status, errorCode: j.errorCode ?? null, waitingFor: j.waitingFor ?? null, attemptedAt: j.attemptedAt ?? null, usage: j.usage ?? null, authorization: j.authorization })), automaticSending: sendingState(box).automaticSending };
  }));
  for (const action of ['pause', 'revoke'] as const) app.post(`${base}/${action}`, safe(request => {
    const box = access(request), input = z.object({ grantId: z.string().uuid(), revision: z.number().int().positive() }).strict().parse(request.body);
    const grant = store.get(request.actor.tenantId, grants, input.grantId); if (!grant || grant.mailboxId !== box.id) fail('email_automation_not_found', 404);
    return stopAutomation(store, request.actor, session(request), grant.id, input.revision, action === 'pause' ? 'paused' : 'revoked', options.now?.(), () => { requireRequestPermission(store, request, 'integrations:manage'); });
  }));
  return worker;
}
