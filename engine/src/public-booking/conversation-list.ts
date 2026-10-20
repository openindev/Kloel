import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Store } from '../store.js';
import { parseExpectedRequestContext } from '../request-context.js';
import { BookingError } from './authority.js';
import { bookingOperations } from './assistant-authority.js';
import { operationView } from './assistant-booking.js';
import { captureBookingOperator } from './operator-reschedule.js';
import type { PublicBookingService } from './service.js';

const query = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) }).strict();

/** Owner inventory projection only: no visitor quotes, tokens or authority are transferred. */
export function conversationBookings(store: Store, service: PublicBookingService, request: FastifyRequest) {
  if (!parseExpectedRequestContext(request)) throw new BookingError(400, 'expected_context_required');
  const access = captureBookingOperator(store, request);
  const conversationId = z.object({ id: z.string().uuid() }).strict().parse(request.params).id;
  const { page, limit } = query.parse(request.query);
  if (!store.get(access.actor.tenantId, 'conversations', conversationId)) throw new BookingError(404, 'conversation_not_found');
  const operations = store.list(access.actor.tenantId, bookingOperations)
    .filter(row => row.conversationId === conversationId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  const selected = operations.slice((page - 1) * limit, page * limit);
  const bookings = new Map(service.list(access.actor, access.sessionHash, access.assertLive).items.map(booking => [booking.bookingRef, booking]));
  const items = selected.map(row => {
    const operation = operationView(row, service.now(), store);
    const booking = bookings.get(operation.bookingRef) ?? null;
    if (booking && booking.pageId !== operation.eventTypeId) throw new BookingError(409, 'booking_operation_unavailable');
    return { operation, booking };
  });
  access.assertLive();
  return { conversationId, items, page, limit, total: operations.length, totalPages: Math.ceil(operations.length / limit) };
}
