import { randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Entity, Store } from '../store.js';
import { digest } from '../oauth/crypto.js';
import { OAuthError } from '../oauth/client.js';
import { MembershipError } from '../memberships/service.js';
import { assertRequestContext, resolveSessionContext, sameRequestContext } from '../request-context.js';
import { authorizeBookingCalendar, BookingError } from './authority.js';
import type { PublicBookingService } from './service.js';

export const bookingCancelOperations = 'booking-cancel-operations';
const auditCollection = 'booking-cancel-audit';
const uuid = z.string().uuid(), revision = z.number().int().positive().safe();
const input = z.object({ expectedTenantId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/), expectedRevision: revision, confirm: z.literal(true), reason: z.string().max(300).optional() }).strict();
const statusEffects = { pending: 'unconfirmed', unknown: 'unconfirmed', not_sent: 'not_sent', not_applied: 'not_applied', accepted: 'delete_accepted', succeeded: 'event_absent' } as const;
type Status = keyof typeof statusEffects;
const fail = (status: number, code: string): never => { throw new BookingError(status, code, 'Consulte a referência e o estado atual da reserva antes de outra ação.'); };
const safeCode = (e: unknown) => e instanceof BookingError || e instanceof OAuthError ? e.code : e instanceof MembershipError ? e.code : 'booking_cancel_failed';

function authority(store: Store, req: FastifyRequest) {
  assertRequestContext(store, req);
  const sessionHash = digest(req.cookies?.kloel_session ?? ''), initial = resolveSessionContext(store, sessionHash);
  if (req.apiKey || !req.cookies?.kloel_session || !initial?.actor || !req.actor || req.actor.userId !== initial.actor.userId || req.actor.tenantId !== initial.actor.tenantId) return fail(401, 'authentication_required');
  if (initial.actor.role !== 'owner') return fail(403, 'booking_owner_required');
  const assertLive = () => {
    assertRequestContext(store, req);
    const current = resolveSessionContext(store, sessionHash);
    if (!current?.actor || !sameRequestContext(initial.context, current.context)) throw new MembershipError(409, 'context_changed_in_flight', 'O contexto mudou. Consulte o recibo antes de tentar novamente.');
  };
  return { actor: initial.actor, context: initial.context, sessionHash, assertLive };
}
type Authority = ReturnType<typeof authority>;
function owns(row: Entity, a: Authority) {
  return row.tenantId === a.actor.tenantId && row.userId === a.actor.userId && row.sessionHash === a.sessionHash && row.membershipId === a.context.membershipId && row.authorityVersion === a.context.authorityVersion;
}
function find(store: Store, tenantId: string, key: string) {
  const rows = store.db.prepare("SELECT body FROM entities WHERE tenant_id=? AND collection=? AND json_extract(body,'$.key')=? LIMIT 2").all(tenantId, bookingCancelOperations, key);
  if (rows.length > 1) return fail(409, 'booking_cancel_operation_unavailable');
  return rows[0] ? JSON.parse(String(rows[0].body)) as Entity : undefined;
}
function project(row: Entity, now: number) {
  if (row.schemaVersion !== 1 || row.kind !== 'booking.cancel' || !uuid.safeParse(row.key).success || !uuid.safeParse(row.bookingRef).success || !revision.safeParse(row.expectedRevision).success || !revision.safeParse(row.reservedRevision).success || row.reservedRevision !== Number(row.expectedRevision) + 1 || !Object.hasOwn(statusEffects, String(row.status)) || !z.string().datetime({ offset: true }).safeParse(row.createdAt).success || !z.string().datetime({ offset: true }).safeParse(row.updatedAt).success) return fail(409, 'booking_cancel_operation_unavailable');
  const status: Status = row.status === 'pending' && Number(row.leaseUntil) <= now ? 'unknown' : row.status as Status;
  const errorCode = row.errorCode ?? null;
  if (errorCode !== null && (typeof errorCode !== 'string' || !/^[a-zA-Z0-9_:-]{1,100}$/.test(errorCode))) return fail(409, 'booking_cancel_operation_unavailable');
  return { key: String(row.key), kind: 'booking.cancel' as const, bookingRef: String(row.bookingRef), expectedRevision: Number(row.expectedRevision), reservedRevision: Number(row.reservedRevision), status, effect: statusEffects[status], errorCode,
    needsReconciliation: ['pending', 'unknown', 'accepted'].includes(status), automaticRetry: false as const, notifications: row.provider === 'microsoft' ? 'provider_managed_unknown' as const : 'not_sent' as const, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

const reservationFields = ['remoteEventId', 'grantId', 'pageId', 'startAt', 'endAt', 'bufferStartAt', 'bufferEndAt', 'appointmentId', 'resourceKey', 'reference', 'provider'] as const;
function matchesReservation(row: Entity, booking: Entity) {
  return row.bookingRef === booking.id && row.reservedRevision === Number(booking.revision ?? 1)
    && booking.adminCancelOperationId === row.id && booking.adminCancelFence === row.operationId
    && !booking.reschedule && reservationFields.every(field => row[field] === booking[field]);
}

/** A private Graph reservation must never fall back to public404/isCancelled handling. */
export function microsoftCancellationReservation(store: Store, booking: Entity, now: number) {
  const row = typeof booking.adminCancelOperationId === 'string' ? store.get(booking.tenantId, bookingCancelOperations, booking.adminCancelOperationId) : undefined;
  if (!row || row.provider !== 'microsoft' || !matchesReservation(row, booking) || !['pending', 'unknown', 'accepted'].includes(String(row.status))) return fail(409, 'booking_cancel_operation_unavailable');
  project(row, now);
  if (typeof row.fingerprint !== 'string' || row.fingerprint !== digest(JSON.stringify(['booking.cancel', row.bookingRef, row.tenantId, row.expectedRevision])) ||
    !uuid.safeParse(row.operationId).success || !['userId', 'sessionHash', 'membershipId', 'authorityVersion'].every(field => typeof row[field] === 'string' && !!row[field])) return fail(409, 'booking_cancel_operation_unavailable');
  return digest(JSON.stringify([row.id, row.key, row.fingerprint, row.userId, row.sessionHash, row.membershipId, row.authorityVersion, row.operationId, row.remoteEtag ?? null, ...reservationFields.map(field => row[field])]));
}

/** Called only inside the booking finalization transaction. A historical receipt is
 * completed only by the exact cancellation fence that reserved this booking. */
export function completeOperatorCancellation(store: Store, booking: Entity) {
  if (typeof booking.adminCancelOperationId !== 'string') return;
  const row = store.get(booking.tenantId, bookingCancelOperations, booking.adminCancelOperationId);
  if (!row || row.schemaVersion !== 1 || !matchesReservation(row, booking) || !['pending', 'unknown', 'accepted'].includes(String(row.status))) return;
  store.update(booking.tenantId, bookingCancelOperations, row.id, { status: 'succeeded', errorCode: null, completedAt: new Date().toISOString() });
}

export function getOperatorCancellation(store: Store, core: PublicBookingService, req: FastifyRequest, keyValue: unknown) {
  const a = authority(store, req), key = uuid.parse(keyValue), row = find(store, a.actor.tenantId, key);
  if (!row || !owns(row, a)) return fail(404, 'booking_cancel_operation_not_found');
  const result = project(row, core.now()); a.assertLive(); return result;
}

export async function cancelBookingByOperator(store: Store, core: PublicBookingService, req: FastifyRequest, bookingIdValue: unknown) {
  const a = authority(store, req), bookingId = uuid.parse(bookingIdValue), body = input.parse(req.body), key = uuid.parse(req.headers['idempotency-key']);
  const fingerprint = digest(JSON.stringify(['booking.cancel', bookingId, body.expectedTenantId, body.expectedRevision]));
  const acquired = store.transaction(() => {
    a.assertLive(); if (body.expectedTenantId !== a.actor.tenantId) return fail(409, 'tenant_mismatch');
    const old = find(store, a.actor.tenantId, key);
    if (old) { if (!owns(old, a) || old.fingerprint !== fingerprint) return fail(409, 'idempotency_conflict'); const operation = project(old, core.now()); a.assertLive(); return { replay: operation }; }
    const before = store.get(a.actor.tenantId, 'public-bookings', bookingId);
    if (!before) return fail(404, 'booking_not_found');
    if (Number(before.revision ?? 1) !== body.expectedRevision) return fail(409, 'booking_cancel_admission_revision_conflict');
    if (!['google', 'microsoft'].includes(String(before.provider))) return fail(409, 'booking_admin_cancel_unsupported');
    if (!['confirmed', 'conflict'].includes(String(before.status)) || typeof before.remoteEventId !== 'string' || !before.remoteEventId || before.reschedule || Number(before.operationInFlightUntil ?? 0) > core.now()) return fail(409, 'booking_requires_reconciliation');
    const target = { tenantId: a.actor.tenantId, pageId: String(before.pageId) };
    const access = core.authority(target, 'operator_cancel', String(before.grantId), { actor: a.actor, sessionHash: a.sessionHash, assertAccess: a.assertLive });
    const reservedRevision = body.expectedRevision + 1; if (!Number.isSafeInteger(reservedRevision)) return fail(409, 'booking_cancel_operation_unavailable');
    const operationId = randomUUID(), leaseUntil = core.now() + 360000;
    const row = store.create(a.actor.tenantId, bookingCancelOperations, { schemaVersion: 1, kind: 'booking.cancel', key, fingerprint, status: 'pending', errorCode: null, bookingRef: bookingId, expectedRevision: body.expectedRevision, reservedRevision, operationId, leaseUntil,
      userId: a.actor.userId, sessionHash: a.sessionHash, membershipId: a.context.membershipId, authorityVersion: a.context.authorityVersion,
      ...Object.fromEntries(reservationFields.map(field => [field, before[field]])), previousStatus: before.status });
    const booking = store.update(a.actor.tenantId, 'public-bookings', bookingId, { status: 'cancel_pending', revision: reservedRevision, operationId, operationInFlightUntil: leaseUntil, adminCancelOperationId: row.id, adminCancelFence: operationId, errorCode: null, cancelReason: (body.reason ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim(), cancelledBy: 'team' })!;
    store.update(a.actor.tenantId, 'appointments', String(booking.appointmentId), { syncStatus: 'cancel_pending' });
    store.create(a.actor.tenantId, auditCollection, { kind: 'booking.cancel', bookingRef: bookingId, operationId: row.id, expectedRevision: body.expectedRevision, reservedRevision, userId: a.actor.userId, membershipId: a.context.membershipId });
    a.assertLive(); return { row, booking, target, access };
  });
  if (acquired.replay) return { operation: acquired.replay, replayed: true };
  const { row, booking, target, access } = acquired;
  let attempted = false;
  const currentRow = () => { const current = store.get(row.tenantId, bookingCancelOperations, row.id); if (!current || current.fingerprint !== fingerprint || current.operationId !== booking.operationId || !owns(current, a)) return fail(409, 'booking_cancel_operation_unavailable'); return current; };
  const check = () => {
    a.assertLive(); authorizeBookingCalendar(store, access); core.assertOperation(target, booking);
    const current = store.get(target.tenantId, 'public-bookings', booking.id)!;
    if (current.status !== 'cancel_pending' || !matchesReservation(row, current) || Number(current.operationInFlightUntil) <= core.now()) return fail(409, 'booking_state_changed');
  };
  const recordAccepted = () => store.transaction(() => {
    const current = currentRow();
    // Evidence belongs to the reserved attempt, even after its HTTP authority or
    // booking lease has changed. Do not mutate the current booking in this callback.
    if (current.status !== 'succeeded') store.update(row.tenantId, bookingCancelOperations, row.id, { status: 'accepted', errorCode: null, acceptedAt: new Date(core.now()).toISOString() });
  });
  const settle = (status: Status, errorCode: string | null = null) => store.transaction(() => {
    const current = currentRow();
    if (current.status === 'succeeded' || current.status === 'accepted' && status !== 'succeeded') status = current.status as Status;
    store.update(row.tenantId, bookingCancelOperations, row.id, { status, errorCode: ['accepted', 'succeeded'].includes(status) ? null : errorCode });
    const live = store.get(target.tenantId, 'public-bookings', booking.id);
    if (live && live.operationId === booking.operationId && matchesReservation(row, live)) {
      const state = status === 'succeeded' ? 'cancelled' : status === 'not_sent' ? String(row.previousStatus) : status === 'not_applied' ? 'conflict' : 'cancel_pending';
      const settled = ['not_sent', 'not_applied', 'succeeded'].includes(status);
      store.update(target.tenantId, 'public-bookings', booking.id, { status: state, operationId: null, operationInFlightUntil: status === 'unknown' ? row.leaseUntil : 0, errorCode: ['accepted', 'succeeded'].includes(status) ? null : errorCode,
        ...(settled ? { adminCancelOperationId: null, adminCancelFence: null } : {}), ...(status === 'succeeded' ? { cancelledAt: new Date(core.now()).toISOString() } : {}) });
      store.update(target.tenantId, 'appointments', String(booking.appointmentId), { status: state === 'cancelled' ? 'cancelled' : 'scheduled', syncStatus: state === 'confirmed' ? 'synced' : state });
    }
  });
  try {
    const result = await core.cancelReserved(target, booking, access, check, () => {
      store.transaction(() => { check(); const current = currentRow(); if (current.status !== 'pending') return fail(409, 'booking_state_changed'); store.update(row.tenantId, bookingCancelOperations, row.id, { attemptedAt: new Date(core.now()).toISOString() }); check(); }); attempted = true;
    }, recordAccepted, booking.provider === 'microsoft' ? etag => store.transaction(() => {
      check(); const current = currentRow(); if (current.status !== 'pending') return fail(409, 'booking_state_changed');
      store.update(row.tenantId, bookingCancelOperations, row.id, { remoteEtag: etag }); check();
    }) : undefined);
    a.assertLive(); settle(result === 'event_absent' ? 'succeeded' : 'accepted');
  } catch (error) {
    const notApplied = attempted && error instanceof OAuthError && error.upstreamStatus === 412;
    settle(notApplied ? 'not_applied' : attempted ? 'unknown' : 'not_sent', notApplied ? 'booking_remote_version_changed' : safeCode(error));
    a.assertLive(); throw error;
  }
  a.assertLive(); return { operation: project(currentRow(), core.now()), replayed: false };
}
