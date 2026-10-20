import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Store } from './store.js';
import { assertRequestContext } from './request-context.js';
import { DomainError } from './domains.js';
import { OAuthError } from './oauth/client.js';
import { MembershipError, resolveSessionActor } from './memberships/service.js';
import { createEventType, deleteEventType, getEventType, getSchedulingConfiguration, listEventTypes, updateEventType } from './scheduling/service.js';
import { BookingError } from './public-booking/authority.js';
import { bookingContext, deliverWebhook, initializeSchedulingNotifications, notificationHistory, startSchedulingNotifications, webhookPayload, type NotificationOptions } from './scheduling-notifications.js';
import { hasPermission } from './memberships/permissions.js';

/** Private configuration only. Publishing needs a separate persisted booking grant. */
export async function registerScheduling(app: FastifyInstance, store: Store, options: NotificationOptions = {}) {
  initializeSchedulingNotifications(store);
  let worker: ReturnType<typeof startSchedulingNotifications> | undefined;
  app.addHook('onReady', async () => { if (options.workers) worker = startSchedulingNotifications(store, options); });
  app.addHook('onClose', async () => { await worker?.stop(); });
  const actor = (request: FastifyRequest) => {
    assertRequestContext(store, request);
    const token = request.cookies?.kloel_session;
    const current = !request.apiKey && !request.headers.authorization && token ? resolveSessionActor(store, createHash('sha256').update(token).digest('hex')) : undefined;
    if (!current || current.userId !== request.actor?.userId || current.tenantId !== request.actor?.tenantId) throw new MembershipError(401, 'human_session_required', 'Acesse sua conta para configurar o agendamento.');
    return current;
  };
  const safe = (handler: (request: FastifyRequest, reply: FastifyReply) => unknown) => async (request: FastifyRequest, reply: FastifyReply) => {
    try { return await handler(request, reply); }
    catch (error) {
      if (error instanceof DomainError || error instanceof MembershipError || error instanceof OAuthError || error instanceof BookingError) return reply.code(error instanceof OAuthError || error instanceof BookingError ? error.status : error.statusCode).send({ error: { code: error.code, message: error.message } });
      if (error instanceof z.ZodError) return reply.code(400).send({ error: { code: 'invalid_scheduling_input', message: 'Dados de agendamento inválidos.', fields: error.issues.map(issue => ({ path: issue.path.join('.'), code: issue.code })) } });
      throw error;
    }
  };
  app.get('/api/v1/scheduling/configuration', safe((request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return getSchedulingConfiguration(store, actor(request));
  }));
  const id = (request: FastifyRequest) => z.object({ id: z.string().uuid() }).strict().parse(request.params).id;
  const base = '/api/v1/scheduling/event-types';
  app.get(base, safe(request => listEventTypes(store, actor(request), request.query)));
  app.get(`${base}/:id`, safe(request => getEventType(store, actor(request), id(request))));
  app.post(base, safe((request, reply) => reply.code(201).send(createEventType(store, actor(request), request.body, () => { actor(request); }))));
  app.patch(`${base}/:id`, safe(request => updateEventType(store, actor(request), id(request), request.body, () => { actor(request); })));
  /** Histórico real de e-mails e webhooks do tipo de evento (sem destinatários completos nem conteúdo). */
  app.get(`${base}/:id/notifications`, safe((request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const current = actor(request), page = getEventType(store, current, id(request));
    return { items: notificationHistory(store, current.tenantId, page.id), emailConfigured: !!process.env.RESEND_API_KEY && !!process.env.RESEND_FROM };
  }));
  /** "Enviar teste" do webhook: POST real para a URL informada, com dados de exemplo e as mesmas proteções da entrega. */
  app.post(`${base}/:id/webhooks/test`, { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, safe(async (request, reply) => {
    const current = actor(request);
    if (!hasPermission(current.role, 'calendars:write')) throw new MembershipError(403, 'forbidden', 'Seu papel não permite esta operação de agendamento.');
    const page = getEventType(store, current, id(request)), { url } = z.object({ url: z.string().trim().max(500).url().refine(value => value.startsWith('https://')) }).strict().parse(request.body);
    const sample = store.list(current.tenantId, 'public-bookings').filter(b => b.pageId === page.id).at(-1);
    const ctx = sample && bookingContext(store, sample);
    const payload = ctx ? { ...webhookPayload(ctx, 'test', randomUUID(), Date.now()), test: true } : { event: 'booking.test', test: true, deliveryId: randomUUID(), createdAt: new Date().toISOString(),
      data: { bookingId: null, status: 'confirmed', eventType: { id: page.id, name: page.name, slug: page.slug }, startAt: new Date(Date.now() + 86400000).toISOString(), timezone: page.timezone, invitee: { name: 'Convidado de teste', email: 'convidado@exemplo.com.br', phone: null } } };
    try {
      const result = await deliverWebhook(url, payload, options);
      return reply.send({ status: result.status >= 200 && result.status < 300 ? 'delivered' : 'rejected', httpStatus: result.status, durationMs: result.durationMs });
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : 'webhook_failed';
      return reply.code(422).send({ error: { code, message: ['unsafe_url', 'unsafe_destination', 'invalid_url', 'webhook_https_required'].includes(code) ? 'Use uma URL https pública (endereços locais e privados não são aceitos).' : code === 'dns_failed' ? 'O endereço não foi encontrado (DNS).' : 'O destino não respondeu ao teste.' } });
    }
  }));
  app.delete(`${base}/:id`, safe((request, reply) => {
    const { revision } = z.object({ revision: z.coerce.number().int().positive() }).strict().parse(request.query);
    deleteEventType(store, actor(request), id(request), revision, () => { actor(request); });
    return reply.code(204).send();
  }));
}
