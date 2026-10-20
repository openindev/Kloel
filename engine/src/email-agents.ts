import { captureEmailReceiptAuthority, getEmailReplyReceipt } from './email-agents/human-receipts.js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Store } from './store.js';
import { DomainError } from './domains.js';
import { OAuthError } from './oauth/client.js';
import { MembershipError } from './memberships/service.js';
import { requireRequestPermission } from './memberships/access.js';
import { archiveEmailMessage, createManualEmailDraft, discardEmailDraft, disconnectEmailConnection, setEmailMessageRead, trashEmailMessage } from './email-agents/mailbox-actions.js';
import { migrateLegacyEmailContentHashes, configureEmailMailbox, listEmailMailboxes, syncEmailMailbox, resetEmailSync, listEmailMessages, getEmailMessage, getEmailThread, listEmailDrafts, getEmailDraftGeneration, generateEmailDraft, editEmailDraft, sendEmailDraft, listEmailOperations, type EmailOptions } from './email-agents/service.js';

export async function registerEmailAgents(app: FastifyInstance, store: Store, options: EmailOptions = {}) {
  // Before any route or worker: messages synced with the previous content hash (read included) move to the current one.
  migrateLegacyEmailContentHashes(store);
  const safe = (handler: (req: FastifyRequest, reply: FastifyReply) => unknown | Promise<unknown>) => async (req: FastifyRequest, reply: FastifyReply) => {
    try { requireRequestPermission(store, req, 'integrations:execute'); const result = await handler(req, reply); requireRequestPermission(store, req, 'integrations:execute'); return result; }
    catch (e) {
      if (e instanceof DomainError || e instanceof MembershipError || e instanceof OAuthError) return reply.code(e instanceof OAuthError ? e.status : e.statusCode).send({ error: { code: e.code, message: e.message } });
      if (e instanceof z.ZodError) return reply.code(400).send({ error: { code: 'invalid_email_agent_input', message: 'Dados do agente de e-mail inválidos.' } });
      throw e;
    }
  };
  const params = (req: FastifyRequest) => z.object({ id: z.string().uuid(), messageId: z.string().uuid().optional(), draftId: z.string().uuid().optional(), threadId: z.string().uuid().optional() }).parse(req.params);
  const runtime = (req: FastifyRequest): EmailOptions => ({ ...options, assertAccess: () => { options.assertAccess?.(); requireRequestPermission(store, req, 'integrations:execute'); } });
  const key = (req: FastifyRequest) => z.string().min(1).max(200).parse(req.headers['idempotency-key']);
  const prefix = '/api/v1/email-agents/mailboxes';
  app.get(prefix, safe(req => listEmailMailboxes(store, req.actor)));
  app.post(prefix, safe((req, reply) => { reply.code(201); return configureEmailMailbox(store, req.actor, req.body, undefined, runtime(req)); }));
  app.put(`${prefix}/:id`, safe(req => configureEmailMailbox(store, req.actor, req.body, params(req).id, runtime(req))));
  app.post(`${prefix}/:id/sync`, safe(req => { z.object({}).strict().parse(req.body ?? {}); return syncEmailMailbox(store, req.actor, params(req).id, runtime(req)); }));
  app.post(`${prefix}/:id/reset-sync`, safe(req => { z.object({ confirmed: z.literal(true) }).strict().parse(req.body); return resetEmailSync(store, req.actor, params(req).id, runtime(req)); }));
  app.get(`${prefix}/:id/messages`, safe(req => listEmailMessages(store, req.actor, params(req).id, req.query, runtime(req))));
  app.get(`${prefix}/:id/messages/:messageId`, safe(req => { const p = params(req); return getEmailMessage(store, req.actor, p.id, p.messageId!, runtime(req)); }));
  app.get(`${prefix}/:id/threads/:threadId`, safe(req => { const p = params(req); return getEmailThread(store, req.actor, p.id, p.threadId!, runtime(req)); }));
  app.get(`${prefix}/:id/drafts`, safe(req => listEmailDrafts(store, req.actor, params(req).id, runtime(req))));
  app.post(`${prefix}/:id/messages/:messageId/drafts`, safe((req, reply) => { const p = params(req); reply.code(201); return generateEmailDraft(store, req.actor, p.id, p.messageId!, req.body, key(req), runtime(req)); }));
  app.get(`${prefix}/:id/messages/:messageId/draft-generation`, safe(req => { const p = params(req), query = z.object({ key: z.string().min(1).max(200) }).strict().parse(req.query); return getEmailDraftGeneration(store, req.actor, p.id, p.messageId!, query.key, runtime(req)); }));
  app.patch(`${prefix}/:id/drafts/:draftId`, safe(req => { const p = params(req); return editEmailDraft(store, req.actor, p.id, p.draftId!, req.body, runtime(req)); }));
  app.post(`${prefix}/:id/drafts/:draftId/send`, safe(req => { const p = params(req); const authority = captureEmailReceiptAuthority(store, req), base = runtime(req); return sendEmailDraft(store, req.actor, p.id, p.draftId!, req.body, key(req), { ...base, humanReceipt: authority, assertAccess: () => { base.assertAccess?.(); authority.assertCurrent(); } }); }));
  app.get(`${prefix}/:id/operations`, safe(req => listEmailOperations(store, req.actor, params(req).id, runtime(req))));
  // Organização da caixa no provedor (exige gmail.modify / Mail.ReadWrite), descarte, resposta manual e remoção da caixa.
  app.post(`${prefix}/:id/messages/:messageId/read`, safe(req => { const p = params(req); return setEmailMessageRead(store, req.actor, p.id, p.messageId!, req.body, runtime(req)); }));
  app.post(`${prefix}/:id/messages/:messageId/archive`, safe(req => { const p = params(req); return archiveEmailMessage(store, req.actor, p.id, p.messageId!, req.body ?? {}, runtime(req)); }));
  app.post(`${prefix}/:id/messages/:messageId/trash`, safe(req => { const p = params(req); return trashEmailMessage(store, req.actor, p.id, p.messageId!, req.body, runtime(req)); }));
  app.post(`${prefix}/:id/messages/:messageId/manual-drafts`, safe((req, reply) => { const p = params(req); reply.code(201); return createManualEmailDraft(store, req.actor, p.id, p.messageId!, req.body, key(req), runtime(req)); }));
  app.post(`${prefix}/:id/drafts/:draftId/discard`, safe(req => { const p = params(req); return discardEmailDraft(store, req.actor, p.id, p.draftId!, req.body, runtime(req)); }));
  app.post('/api/v1/email-agents/connections/:id/disconnect', safe(req => disconnectEmailConnection(store, req.actor, z.object({ id: z.string().uuid() }).strict().parse(req.params).id, req.body, runtime(req))));
  app.get(`${prefix}/:id/operations/:key`, safe(req => { const p = z.object({ id: z.string().uuid(), key: z.string().min(1).max(200) }).strict().parse(req.params); return getEmailReplyReceipt(store, captureEmailReceiptAuthority(store, req), p.id, p.key); }));
}
