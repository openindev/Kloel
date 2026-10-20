import { randomUUID } from 'node:crypto';
import type { TestContext } from 'node:test';
import type { FastifyInstance } from 'fastify';
import type { Store } from '../../src/store.js';
import { bookingOperatorFixture } from './booking-operator.js';

/** Real HTTP/auth/Store, memory-only calendar transport. Never contacts a provider. */
export async function bookingRescheduleFixture(t: TestContext, provider: 'google' | 'microsoft' = 'google', setup?: (app: FastifyInstance, store: Store) => void | Promise<void>) {
  const f = await bookingOperatorFixture(t, provider, setup);
  const slots = (expectedRevision = Number(f.record().revision ?? 1), expected = f.headers) => f.request(`/api/v1/scheduling/bookings/${f.booked.bookingRef}/reschedule-slots`, { expectedTenantId: f.actor.tenantId, expectedRevision, from: f.from, to: f.to }, expected);
  const move = (quote: string, key = randomUUID(), expectedRevision = Number(f.record().revision ?? 1), expected = f.headers) => f.request(`/api/v1/scheduling/bookings/${f.booked.bookingRef}/reschedule`, { expectedTenantId: f.actor.tenantId, expectedRevision, quote, confirm: true }, expected, key);
  const operation = (key: string, expected = f.headers) => f.request(`/api/v1/scheduling/reschedule-operations/${key}`, undefined, expected);
  return { ...f, slots, move, operation };
}
