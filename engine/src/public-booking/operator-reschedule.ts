import { randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Entity, Store } from '../store.js';
import { digest } from '../oauth/crypto.js';
import { MembershipError } from '../memberships/service.js';
import { assertRequestContext, resolveSessionContext, sameRequestContext } from '../request-context.js';
import { BookingError } from './authority.js';
import { bookingMoveSnapshot, type Move } from './reschedule.js';
import type { PublicBookingService } from './service.js';

export const operatorRescheduleOperations = 'booking-operator-reschedule-operations';
const uuid = z.string().uuid(), revision = z.number().int().positive().safe(), stamp = z.string().datetime({ offset: true });
const tenant = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
const range = z.object({ expectedTenantId: tenant, expectedRevision: revision, from: stamp, to: stamp }).strict();
const input = z.object({ expectedTenantId: tenant, expectedRevision: revision, quote: z.string().regex(/^[A-Za-z0-9_-]{43}$/), confirm: z.literal(true) }).strict();
const effects = { pending: 'unconfirmed', unknown: 'unconfirmed', not_sent: 'not_sent', not_applied: 'not_applied', accepted: 'patch_accepted', succeeded: 'target_confirmed' } as const;
type Status = keyof typeof effects;
function fail(status: number, code: string): never { throw new BookingError(status, code, 'Consulte a tentativa original e o estado atual da reserva antes de outra ação.'); }

/** Also used by reconciliation: absent HTTP context headers do not remove the real session fence. */
export function captureBookingOperator(store: Store, request: FastifyRequest) {
  assertRequestContext(store, request);
  const sessionHash = digest(request.cookies?.kloel_session ?? ''), initial = resolveSessionContext(store, sessionHash);
  if (request.apiKey || !request.cookies?.kloel_session || !initial?.actor || request.actor?.userId !== initial.actor.userId || request.actor.tenantId !== initial.actor.tenantId) return fail(401, 'authentication_required');
  if (initial.actor.role !== 'owner') return fail(403, 'booking_owner_required');
  const assertLive = () => {
    assertRequestContext(store, request);
    const current = resolveSessionContext(store, sessionHash);
    if (!current?.actor || !sameRequestContext(initial.context, current.context)) throw new MembershipError(409, 'context_changed_in_flight', 'O contexto mudou. Consulte o recibo antes de tentar novamente.');
  };
  return { actor: initial.actor, sessionHash, context: initial.context, assertLive };
}
type Authority = ReturnType<typeof captureBookingOperator>;
const identity = (a: Authority) => ({ userId: a.actor.userId, sessionHash: a.sessionHash, membershipId: a.context.membershipId, authorityVersion: a.context.authorityVersion });
const owns = (row: Entity, a: Authority) => row.tenantId === a.actor.tenantId && Object.entries(identity(a)).every(([key, value]) => row[key] === value);
const configuration = (grant: Entity) => digest(JSON.stringify([grant.id, grant.configRevision, grant.calendarPolicyIdentity, grant.localCalendarId, grant.resourceKey, grant.connectionGeneration, grant.connectionIdentity]));
function find(store: Store, tenantId: string, key: string) {
  const rows = store.db.prepare("SELECT body FROM entities WHERE tenant_id=? AND collection=? AND json_extract(body,'$.key')=? LIMIT 2").all(tenantId, operatorRescheduleOperations, key);
  if (rows.length > 1) return fail(409, 'booking_reschedule_operation_unavailable');
  return rows[0] ? JSON.parse(String(rows[0].body)) as Entity : undefined;
}
function time(value: unknown) {
  const parsed = z.object({ startAt: stamp, endAt: stamp }).strict().safeParse(value);
  if (!parsed.success || Date.parse(parsed.data.endAt) <= Date.parse(parsed.data.startAt)) return fail(409, 'booking_reschedule_operation_unavailable');
  return parsed.data;
}
function project(row: Entity, now: number) {
  if (row.schemaVersion !== 1 || row.kind !== 'booking.reschedule' || !uuid.safeParse(row.key).success || !uuid.safeParse(row.bookingRef).success || !revision.safeParse(row.expectedRevision).success || !revision.safeParse(row.reservedRevision).success || row.reservedRevision !== Number(row.expectedRevision) + 1 || !Object.hasOwn(effects, String(row.status)) || typeof row.needsReconciliation !== 'boolean' || !stamp.safeParse(row.createdAt).success || !stamp.safeParse(row.updatedAt).success) return fail(409, 'booking_reschedule_operation_unavailable');
  const status: Status = row.status === 'pending' && Number(row.leaseUntil) <= now ? 'unknown' : row.status as Status;
  const errorCode = row.errorCode ?? null;
  if (errorCode !== null && (typeof errorCode !== 'string' || !/^[a-zA-Z0-9_:-]{1,100}$/.test(errorCode))) return fail(409, 'booking_reschedule_operation_unavailable');
  return { key: String(row.key), kind: 'booking.reschedule' as const, bookingRef: String(row.bookingRef), expectedRevision: Number(row.expectedRevision), reservedRevision: Number(row.reservedRevision), originalTime: time(row.originalTime), requestedTime: time(row.requestedTime), status, effect: effects[status], needsReconciliation: ['pending', 'unknown', 'accepted'].includes(status) || row.needsReconciliation, errorCode, automaticRetry: false as const, notifications: 'not_sent' as const, createdAt: row.createdAt, updatedAt: row.updatedAt };
}
const reservedFields = ['provider', 'pageId', 'grantId', 'resourceKey', 'remoteEventId', 'reference', 'appointmentId', 'startAt', 'endAt', 'bufferStartAt', 'bufferEndAt'] as const;

/** Evidence-only writes survive late authority/fence changes; no current booking is touched.
 * Finalization calls this inside the same transaction as both physical holds. */
export function updateOperatorMoveReceipt(store: Store, booking: Entity, move: Move, proposed: Status, resolved: boolean, errorCode: string | undefined, now: number, ownTransaction = false) {
  if (!move.admin) return;
  const write = () => {
    const row = store.get(booking.tenantId, operatorRescheduleOperations, move.admin!.id);
    if (!row || row.schemaVersion !== 1 || row.kind !== 'booking.reschedule' || row.bookingRef !== booking.id || row.operationId !== move.admin!.fence || row.nativeRecordId !== move.recordId || row.holdId !== move.holdAppointmentId || row.expectedRevision !== move.fromRevision || row.reservedRevision !== move.reservedRevision || row.reservedRevision !== Number(booking.revision) || reservedFields.some(key => (row.reservation as Record<string, unknown>)?.[key] !== booking[key]) || JSON.stringify(row.requestedTime) !== JSON.stringify({ startAt: move.target.startAt, endAt: move.target.endAt })) return fail(409, 'booking_reschedule_operation_unavailable');
    // A committed dispatch marker whose caller failed before returning remains uncertain.
    let status = proposed === 'not_sent' && row.attemptedAt ? 'unknown' as const : proposed;
    if (row.status === 'succeeded' || row.status === 'accepted' && status !== 'succeeded' || row.status === 'not_applied' && status === 'unknown') status = row.status as Status;
    const needsReconciliation = status === 'succeeded' ? false : resolved && ['not_sent', 'not_applied'].includes(status) ? false : true;
    store.update(booking.tenantId, operatorRescheduleOperations, row.id, { status, needsReconciliation, errorCode: ['accepted', 'succeeded'].includes(status) ? null : errorCode ?? null,
      ...(move.attempted && !row.attemptedAt ? { attemptedAt: new Date(now).toISOString() } : {}), ...(status === 'accepted' && !row.acceptedAt ? { acceptedAt: new Date(now).toISOString() } : {}), ...(!needsReconciliation ? { completedAt: new Date(now).toISOString() } : {}) });
  };
  return ownTransaction ? store.transaction(write) : write();
}

export function getOperatorReschedule(store: Store, core: PublicBookingService, request: FastifyRequest, keyValue: unknown) {
  const a = captureBookingOperator(store, request), key = uuid.parse(keyValue), row = find(store, a.actor.tenantId, key);
  if (!row || !owns(row, a)) return fail(404, 'booking_reschedule_operation_not_found');
  const result = project(row, core.now()); a.assertLive(); return result;
}
export async function operatorRescheduleSlots(store: Store, core: PublicBookingService, request: FastifyRequest, idValue: unknown) {
  const a = captureBookingOperator(store, request), id = uuid.parse(idValue), body = range.parse(request.body);
  if (body.expectedTenantId !== a.actor.tenantId) return fail(409, 'tenant_mismatch');
  const booking = store.get(a.actor.tenantId, 'public-bookings', id);
  if (!booking) return fail(404, 'booking_not_found');
  if (Number(booking.revision ?? 1) !== body.expectedRevision) return fail(409, 'booking_revision_conflict');
  const target = { tenantId: a.actor.tenantId, pageId: String(booking.pageId) }, operator = { actor: a.actor, sessionHash: a.sessionHash, assertAccess: a.assertLive };
  const { authority, grant } = core.rescheduling.eligible(target, booking, operator);
  const result = await core.rescheduling.candidates(target, booking, authority, a.assertLive, Date.parse(body.from), Date.parse(body.to));
  const response = core.rescheduling.issueQuotes(target, booking, result, { purpose: 'operator_reschedule', ...identity(a), bookingSnapshot: result.snapshot, configuration: configuration(grant!) });
  a.assertLive(); return { bookingRef: id, ...response };
}
export async function rescheduleBookingByOperator(store: Store, core: PublicBookingService, request: FastifyRequest, idValue: unknown) {
  const a = captureBookingOperator(store, request), id = uuid.parse(idValue), body = input.parse(request.body), key = uuid.parse(request.headers['idempotency-key']);
  const fingerprint = digest(JSON.stringify(['booking.reschedule', id, body.expectedTenantId, body.expectedRevision, digest(body.quote)]));
  const acquired = store.transaction(() => {
    a.assertLive(); if (body.expectedTenantId !== a.actor.tenantId) return fail(409, 'tenant_mismatch');
    const old = find(store, a.actor.tenantId, key);
    if (old) { if (!owns(old, a) || old.fingerprint !== fingerprint) return fail(409, 'idempotency_conflict'); const operation = project(old, core.now()); a.assertLive(); return { replay: operation }; }
    const booking = store.get(a.actor.tenantId, 'public-bookings', id);
    if (!booking) return fail(404, 'booking_not_found');
    if (Number(booking.revision ?? 1) !== body.expectedRevision) return fail(409, 'booking_reschedule_admission_revision_conflict');
    const reservedRevision = body.expectedRevision + 1;
    if (!Number.isSafeInteger(reservedRevision)) return fail(409, 'booking_reschedule_operation_unavailable');
    const target = { tenantId: a.actor.tenantId, pageId: String(booking.pageId) }, operator = { actor: a.actor, sessionHash: a.sessionHash, assertAccess: a.assertLive };
    const { authority, grant, page } = core.rescheduling.eligible(target, booking, operator);
    const quote = store.list(a.actor.tenantId, 'booking-slot-quotes').find(q => q.tokenHash === digest(body.quote));
    if (!quote || quote.purpose !== 'operator_reschedule' || !owns(quote, a) || quote.bookingId !== id || quote.bookingRevision !== body.expectedRevision || quote.grantId !== grant!.id || quote.revision !== page!.revision || quote.configuration !== configuration(grant!) || quote.bookingSnapshot !== bookingMoveSnapshot(store, booking) || Number(quote.expiresAt) <= core.now()) return fail(409, 'booking_quote_expired');
    const operationId = randomUUID();
    const row = store.create(a.actor.tenantId, operatorRescheduleOperations, { schemaVersion: 1, kind: 'booking.reschedule', key, fingerprint, bookingRef: id, ...identity(a), expectedRevision: body.expectedRevision, reservedRevision, operationId, leaseUntil: core.now() + 360000,
      status: 'pending', needsReconciliation: true, errorCode: null, originalTime: { startAt: booking.startAt, endAt: booking.endAt }, requestedTime: { startAt: quote.startAt, endAt: quote.endAt }, reservation: Object.fromEntries(reservedFields.map(field => [field, booking[field]])) });
    const reserved = core.rescheduling.reserve(target, booking, authority, quote, { keyHash: digest(`operator-reschedule:${row.id}`), fingerprint }, { id: row.id, fence: operationId, reservedRevision });
    const move = reserved.booking.reschedule as Move;
    store.update(a.actor.tenantId, operatorRescheduleOperations, row.id, { nativeRecordId: move.recordId, holdId: move.holdAppointmentId });
    store.create(a.actor.tenantId, 'booking-reschedule-audit', { kind: 'booking.reschedule', operationId: row.id, bookingRef: id, expectedRevision: body.expectedRevision, reservedRevision, userId: a.actor.userId, membershipId: a.context.membershipId });
    a.assertLive();
    const current = store.get(a.actor.tenantId, 'public-bookings', id);
    if (!current || bookingMoveSnapshot(store, current) !== reserved.snapshot) return fail(409, 'booking_state_changed');
    return { row, reserved, target, authority };
  });
  if (acquired.replay) return { operation: acquired.replay, replayed: true };
  await core.rescheduling.executeReserved(acquired.target, acquired.reserved, acquired.authority, a.assertLive);
  a.assertLive(); const row = find(store, a.actor.tenantId, key);
  if (!row || !owns(row, a)) return fail(409, 'booking_reschedule_operation_unavailable');
  const operation = project(row, core.now()); a.assertLive(); return { operation, replayed: false };
}
