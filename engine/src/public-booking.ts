import { publicBookingCompany } from './public-booking/company.js';
import { conversationBookings } from './public-booking/conversation-list.js';
import { registerAssistantBooking } from './public-booking/assistant-routes.js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Store } from './store.js';
import { digest } from './oauth/crypto.js';
import { OAuthError } from './oauth/client.js';
import { BookingError } from './public-booking/authority.js';
import { PublicBookingService, type BookingTarget } from './public-booking/service.js';
import { publicBookingBaseUrl } from './public-booking/origin.js';
import { assertRequestContext } from './request-context.js';
import { cancelBookingByOperator, getOperatorCancellation } from './public-booking/operator-cancel.js';
import { captureBookingOperator, getOperatorReschedule, operatorRescheduleSlots, rescheduleBookingByOperator } from './public-booking/operator-reschedule.js';

const base = '/api/v1/public/booking';
export const PUBLIC_BOOKING_PATHS = new Set(['company', 'page', 'sessions', 'slots', 'bookings', 'status', 'manage-token', 'cancel', 'manage-status', 'reschedule-slots', 'reschedule'].map(s => `${base}/${s}`));
const identity = { orgSlug: z.string().regex(/^o-[a-f0-9]{24}$/), eventSlug: z.string().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) };
const query = z.object({ ...identity, bookingRef: z.string().uuid().optional() }).strict();
const reference = z.object({ bookingRef: z.string().uuid() }).strict();

/** Public routes accept only purpose-specific opaque credentials; cookies confer no visitor powers. */
export async function registerPublicBooking(app: FastifyInstance, store: Store, options: { now?: () => number } = {}) {
  const service = new PublicBookingService(store, options.now);
  await registerAssistantBooking(app, store, service);
  const safe = (handler: (request: FastifyRequest, reply: FastifyReply) => unknown) => async (request: FastifyRequest, reply: FastifyReply) => {
    reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer').header('X-Content-Type-Options', 'nosniff');
    try { return await handler(request, reply); }
    catch (error) {
      if (error instanceof z.ZodError) return reply.code(400).send({ error: { code: 'invalid_input', message: 'Confira os dados do agendamento.' } });
      if (error instanceof BookingError || error instanceof OAuthError) return reply.code(error.status).send({ error: { code: error.code, message: error instanceof BookingError ? error.message : 'O calendário conectado não confirmou a operação.' } });
      // Scheduling validators are typed errors without leaking details or upstream bodies.
      if (error && typeof error === 'object' && 'statusCode' in error && 'code' in error && typeof error.statusCode === 'number' && typeof error.code === 'string') return reply.code(error.statusCode).send({ error: { code: error.code, message: 'Horário ou configuração indisponível.' } });
      return reply.code(502).send({ error: { code: 'booking_operation_failed', message: 'Não foi possível confirmar a operação. Consulte o estado antes de tentar novamente.' } });
    }
  };
  function publicOrigin(request: FastifyRequest): string {
    const configured = new URL(publicBookingBaseUrl());
    const origin = request.headers.origin;
    if (origin === configured.origin) return origin;
    if (origin === undefined && request.method === 'GET' && request.headers.host === configured.host) return configured.origin;
    throw new BookingError(403, 'booking_origin_forbidden');
  }
  function visitor(request: FastifyRequest, scheme: 'Booking' | 'BookingManage') {
    const match = new RegExp(`^${scheme} ([A-Za-z0-9_-]{43})$`).exec(request.headers.authorization ?? '');
    if (!match) throw new BookingError(401, 'booking_token_required');
    return match[1];
  }
  function target(request: FastifyRequest): BookingTarget {
    const input = query.parse(request.query); return service.lookup(input.orgSlug, input.eventSlug);
  }
  const publicSafe = (handler: (request: FastifyRequest, reply: FastifyReply, context: { target: BookingTarget; origin: string }) => unknown) => safe(async (request, reply) => {
    const origin = publicOrigin(request); const current = target(request);
    reply.header('Access-Control-Allow-Origin', origin).header('Vary', 'Origin');
    service.rate(current, request.ip, request.url.split('?')[0].endsWith('/sessions') && request.method === 'POST' ? 'sessions' : 'requests');
    return handler(request, reply, { target: current, origin });
  });
  const routeOptions = { bodyLimit: 8192, config: { cors: false as const } };
  app.options(`${base}/company`, routeOptions, safe((request, reply) => {
    const origin = publicOrigin(request);
    if (request.headers['access-control-request-method'] !== 'GET' || request.headers['access-control-request-headers']) throw new BookingError(403, 'booking_origin_forbidden');
    return reply.header('Access-Control-Allow-Origin', origin).header('Vary', 'Origin').header('Access-Control-Allow-Methods', 'GET').header('Access-Control-Max-Age', '300').code(204).send();
  }));
  app.get(`${base}/company`, routeOptions, safe((request, reply) => {
    const origin = publicOrigin(request), result = publicBookingCompany(store, service, request.query);
    service.rate(result.target, request.ip, 'requests');
    reply.header('Access-Control-Allow-Origin', origin).header('Vary', 'Origin');
    return result.body;
  }));
  for (const path of [...PUBLIC_BOOKING_PATHS].filter(path => path !== `${base}/company`)) app.options(path, routeOptions, publicSafe((request, reply) => {
    const method = ['page', 'status', 'manage-status'].some(s => path.endsWith(`/${s}`)) ? 'GET' : 'POST';
    if (request.headers['access-control-request-method'] !== method || String(request.headers['access-control-request-headers'] ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean).some(s => !['authorization', 'content-type'].includes(s))) throw new BookingError(403, 'booking_origin_forbidden');
    return reply.header('Access-Control-Allow-Methods', method).header('Access-Control-Allow-Headers', 'Authorization, Content-Type').header('Access-Control-Max-Age', '300').code(204).send();
  }));
  app.get(`${base}/page`, routeOptions, publicSafe((_request, _reply, context) => service.page(context.target)));
  app.post(`${base}/sessions`, routeOptions, publicSafe((request, reply, context) => { z.object({}).strict().parse(request.body ?? {}); reply.code(201); return service.createSession(context.target, context.origin); }));
  app.post(`${base}/slots`, routeOptions, publicSafe((request, _reply, context) => service.slots(context.target, visitor(request, 'Booking'), context.origin, request.body)));
  app.post(`${base}/bookings`, routeOptions, publicSafe((request, _reply, context) => service.book(context.target, visitor(request, 'Booking'), context.origin, request.body)));
  app.get(`${base}/status`, routeOptions, publicSafe((request, _reply, context) => service.status(context.target, visitor(request, 'Booking'), context.origin, z.string().uuid().parse(query.parse(request.query).bookingRef))));
  app.post(`${base}/manage-token`, routeOptions, publicSafe((request, _reply, context) => service.managementToken(context.target, visitor(request, 'Booking'), context.origin, reference.parse(request.body).bookingRef)));
  app.post(`${base}/cancel`, routeOptions, publicSafe((request, _reply, context) => service.cancel(context.target, visitor(request, 'BookingManage'), context.origin, request.body)));
  app.get(`${base}/manage-status`, routeOptions, publicSafe((request, _reply, context) => service.rescheduling.status(context.target, visitor(request, 'BookingManage'), context.origin, z.string().uuid().parse(query.parse(request.query).bookingRef))));
  app.post(`${base}/reschedule-slots`, routeOptions, publicSafe((request, _reply, context) => service.rescheduling.slots(context.target, visitor(request, 'BookingManage'), context.origin, request.body)));
  app.post(`${base}/reschedule`, routeOptions, publicSafe((request, _reply, context) => service.rescheduling.reschedule(context.target, visitor(request, 'BookingManage'), context.origin, request.body)));

  const privateSafe = (handler: (request: FastifyRequest, assertAccess: () => void) => unknown) => safe(async request => {
    const assertAccess = () => assertRequestContext(store, request);
    assertAccess();
    const result = await handler(request, assertAccess);
    // A completed receipt stays durable even if its initiating context can no longer receive it.
    assertAccess();
    return result;
  });
  const session = (request: FastifyRequest) => digest(request.cookies?.kloel_session ?? '');
  const pageId = (request: FastifyRequest) => z.object({ id: z.string().uuid() }).parse(request.params).id;
  app.post('/api/v1/scheduling/event-types/:id/publish', privateSafe((request, assertAccess) => service.publish(request.actor, session(request), pageId(request), z.object({ revision: z.number().int().positive() }).strict().parse(request.body).revision, assertAccess)));
  app.post('/api/v1/scheduling/event-types/:id/unpublish', privateSafe((request, assertAccess) => { z.object({}).strict().parse(request.body ?? {}); return service.unpublish(request.actor, session(request), pageId(request), false, assertAccess); }));
  app.post('/api/v1/scheduling/event-types/:id/revoke-grant', privateSafe((request, assertAccess) => { z.object({}).strict().parse(request.body ?? {}); return service.unpublish(request.actor, session(request), pageId(request), true, assertAccess); }));
  app.get('/api/v1/scheduling/bookings', privateSafe((request, assertAccess) => service.list(request.actor, session(request), assertAccess)));
  app.get('/api/v1/conversations/:id/bookings', privateSafe(request => conversationBookings(store, service, request)));
  app.post('/api/v1/scheduling/bookings/:id/reconcile', privateSafe(async request => { z.object({}).strict().parse(request.body ?? {}); const a = captureBookingOperator(store, request); const result = await service.reconcile(a.actor, a.sessionHash, pageId(request), a.assertLive); a.assertLive(); return result; }));
  app.post('/api/v1/scheduling/bookings/:id/cancel', privateSafe(request => cancelBookingByOperator(store, service, request, pageId(request))));
  app.post('/api/v1/scheduling/bookings/:id/reschedule-slots', privateSafe(request => operatorRescheduleSlots(store, service, request, pageId(request))));
  app.post('/api/v1/scheduling/bookings/:id/reschedule', privateSafe(request => rescheduleBookingByOperator(store, service, request, pageId(request))));
  app.get('/api/v1/scheduling/reschedule-operations/:key', privateSafe(request => getOperatorReschedule(store, service, request, z.object({ key: z.string().uuid() }).strict().parse(request.params).key)));
  app.get('/api/v1/scheduling/operations/:key', privateSafe(request => getOperatorCancellation(store, service, request, z.object({ key: z.string().uuid() }).strict().parse(request.params).key)));
}
