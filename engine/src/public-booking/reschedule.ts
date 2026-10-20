import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Entity, Store } from '../store.js';
import type { MembershipActor } from '../memberships/service.js';
import { digest } from '../oauth/crypto.js';
import { OAuthError } from '../oauth/client.js';
import { readBookingCalendar, readBookingCalendarEvent, rescheduleBookingCalendarEvent, type BookingRemoteEvent } from '../oauth/booking-calendar.js';
import { eventTypeConfigFromRecord, validateBookingWindow } from '../scheduling/service.js';
import { authorizeBookingCalendar, BookingError, requireBookingOwner, type BookingAuthority, type BookingOperator } from './authority.js';
import { bookingEffectiveBuffer, validateCalendarBookingWindow } from './window.js';
import { updateOperatorMoveReceipt } from './operator-reschedule.js';
import { conflictBusy } from './conflicts.js';
import type { BookingTarget, PublicBookingService } from './service.js';

type Window = ReturnType<typeof validateBookingWindow>;
export type Move = { recordId: string; holdAppointmentId: string; target: Window; expectedEtag?: string; attempted: boolean; notApplied?: boolean; fromRevision: number; reservedRevision?: number; admin?: { id: string; fence: string } };
const iso = (value: number) => new Date(value).toISOString();
const overlap = (a: Window, b: { startAt: string; endAt: string }) => Date.parse(a.bufferStartAt) < Date.parse(b.endAt) && Date.parse(a.bufferEndAt) > Date.parse(b.startAt);
const range = z.object({ bookingRef: z.string().uuid(), from: z.string().datetime({ offset: true }), to: z.string().datetime({ offset: true }) }).strict();
const input = z.object({ bookingRef: z.string().uuid(), expectedRevision: z.number().int().positive(), quote: z.string().regex(/^[A-Za-z0-9_-]{43}$/), idempotencyKey: z.string().uuid() }).strict();
const same = (remote: BookingRemoteEvent, value: Record<string, unknown>) => remote.startAt === value.startAt && remote.endAt === value.endAt;
const fields = ['id', 'tenantId', 'status', 'operationId', 'operationInFlightUntil', 'revision', 'provider', 'grantId', 'pageId', 'resourceKey', 'remoteEventId', 'reference', 'appointmentId', 'startAt', 'endAt', 'bufferStartAt', 'bufferEndAt', 'reschedule', 'adminCancelOperationId', 'adminCancelFence', 'cancelKeyHash'] as const;
const appointmentFields = ['id', 'tenantId', 'calendarId', 'bookingId', 'bookingPageId', 'status', 'syncStatus', 'source', 'remoteResourceKey', 'startAt', 'endAt', 'bufferStartAt', 'bufferEndAt', 'timezone'] as const;
const selected = (value: Entity | undefined, keys: readonly string[]) => value ? keys.map(key => value[key] ?? null) : null;
/** Includes both physical holds, not timestamps or an HTTP actor. */
export function bookingMoveSnapshot(store: Store, booking: Entity) {
  const move = booking.reschedule as Move | undefined;
  return JSON.stringify([selected(booking, fields), selected(store.get(booking.tenantId, 'appointments', String(booking.appointmentId)), appointmentFields), move ? selected(store.get(booking.tenantId, 'appointments', move.holdAppointmentId), appointmentFields) : null]);
}

/** Public capabilities and private human authority share only reserved physical execution. */
export class BookingRescheduler {
  constructor(readonly core: PublicBookingService) {}
  private get store() { return this.core.store; }
  private get now() { return this.core.now; }
  eligible(target: BookingTarget, booking: Entity, operator?: BookingOperator) {
    if (operator && booking.provider !== 'google') throw new BookingError(409, 'booking_admin_reschedule_unsupported');
    const authority = this.core.authority(target, operator ? 'operator_reschedule' : 'reschedule', String(booking.grantId), operator);
    const context = authorizeBookingCalendar(this.store, authority);
    if (context.grant?.provider !== 'google') throw new BookingError(409, 'booking_reschedule_unsupported');
    if (!operator && eventTypeConfigFromRecord(context.page!).allowReschedule === false) throw new BookingError(403, 'booking_reschedule_disabled');
    if (booking.status !== 'confirmed' || booking.reschedule || typeof booking.remoteEventId !== 'string' || Number(booking.operationInFlightUntil ?? 0) > this.now()) throw new BookingError(409, 'booking_requires_reconciliation');
    if (Date.parse(String(booking.startAt)) <= this.now()) throw new BookingError(409, 'booking_already_started');
    if (operator && Date.parse(String(booking.endAt)) - Date.parse(String(booking.startAt)) !== eventTypeConfigFromRecord(context.page!).durationMinutes * 60000) throw new BookingError(409, 'booking_duration_changed');
    return { authority, ...context };
  }
  status(target: BookingTarget, raw: string, origin: string, bookingRef: string) {
    const booking = this.core.managementBooking(target, raw, origin, bookingRef);
    let rescheduleAllowed = false, rescheduleUnavailableReason: string | undefined;
    try { this.eligible(target, booking); rescheduleAllowed = true; }
    catch (error) { if (!(error instanceof BookingError)) throw error; rescheduleUnavailableReason = error.code; }
    const page = this.store.get(target.tenantId, 'booking-pages', target.pageId);
    let cancelAllowed = false; try { cancelAllowed = !!page && eventTypeConfigFromRecord(page).allowCancel && ['confirmed', 'conflict'].includes(String(booking.status)); } catch { cancelAllowed = false; }
    return { ...this.core.receipt(booking), rescheduleAllowed, cancelAllowed, ...(rescheduleUnavailableReason ? { rescheduleUnavailableReason } : {}) };
  }
  private verifyRemote(remote: BookingRemoteEvent | null, booking: Entity) {
    if (!remote || remote.cancelled || remote.id !== booking.remoteEventId || remote.reference !== booking.reference || !same(remote, booking) || remote.hasAttendees || remote.recurring || !remote.etag || !/^"[^"\r\n]{1,1000}"$/.test(remote.etag)) throw new BookingError(409, 'booking_remote_changed');
    return remote;
  }
  async candidates(target: BookingTarget, booking: Entity, authority: BookingAuthority, assertAccess: () => void, from: number, to: number) {
    if (to <= from || to - from > 7 * 86400000) throw new BookingError(400, 'booking_range_invalid');
    const snapshot = bookingMoveSnapshot(this.store, booking);
    const check = () => { assertAccess(); const current = this.store.get(target.tenantId, 'public-bookings', booking.id); if (!current || bookingMoveSnapshot(this.store, current) !== snapshot) throw new BookingError(409, 'booking_state_changed'); };
    const access: BookingAuthority = authority.kind === 'grant' ? { ...authority, assertAccess: check } : authority;
    const { page, calendar, grant } = authorizeBookingCalendar(this.store, access);
    this.verifyRemote(await readBookingCalendarEvent(this.store, access, String(booking.remoteEventId)), booking); check();
    const config = eventTypeConfigFromRecord(page!); config.bufferMinutes = bookingEffectiveBuffer(calendar, config.bufferMinutes);
    const busy = [...await readBookingCalendar(this.store, access, iso(from - config.bufferMinutes * 60000), iso(to + config.bufferMinutes * 60000)), ...(await conflictBusy(this.store, target.tenantId, page!, iso(from - config.bufferMinutes * 60000), iso(to + config.bufferMinutes * 60000))).map(b => ({ ...b, id: '' }))]; check();
    const candidates: Window[] = [];
    for (let at = Math.ceil(from / 60000) * 60000; at < to && candidates.length < 201; at += 60000) {
      let window: Window;
      try { const requested = validateBookingWindow(config, { startAt: iso(at) }, { now: this.now() }); window = { ...requested, ...validateCalendarBookingWindow(calendar, requested, config.bufferMinutes) }; } catch { continue; }
      if (window.startAt === booking.startAt || Date.parse(window.endAt) > to || busy.some(b => b.id !== booking.remoteEventId && overlap(window, b)) || this.core.localBusy(target, grant!, window.bufferStartAt, window.bufferEndAt, booking.id) || this.core.dailyBusy(target, page!, window.localDate, booking.id)) continue;
      candidates.push(window);
    }
    return { candidates, config, page: page!, grant: grant!, snapshot, check: () => { check(); authorizeBookingCalendar(this.store, access); } };
  }
  issueQuotes(target: BookingTarget, booking: Entity, result: Awaited<ReturnType<BookingRescheduler['candidates']>>, binding: Record<string, unknown>) {
    return this.store.transaction(() => {
      result.check();
      for (const quote of this.store.list(target.tenantId, 'booking-slot-quotes').filter(q => Number(q.expiresAt) <= this.now())) this.store.remove(target.tenantId, 'booking-slot-quotes', quote.id);
      const quotes = this.store.list(target.tenantId, 'booking-slot-quotes'), candidates = result.candidates;
      if (quotes.length + Math.min(candidates.length, 200) > 10000 || quotes.filter(q => q.bookingId === booking.id).length + Math.min(candidates.length, 200) > 600) throw new BookingError(429, 'booking_quote_limit');
      const response = { timezone: result.config.timezone, expectedRevision: Number(booking.revision ?? 1), slots: candidates.slice(0, 200).map(window => {
        const quote = randomBytes(32).toString('base64url'), expiresAt = this.now() + 300000;
        this.store.create(target.tenantId, 'booking-slot-quotes', { ...binding, bookingId: booking.id, pageId: result.page.id, grantId: result.grant.id, revision: result.page.revision, bookingRevision: Number(booking.revision ?? 1), tokenHash: digest(quote), expiresAt, ...window });
        return { startAt: window.startAt, endAt: window.endAt, quote, expiresAt };
      }), complete: candidates.length <= 200, ...(candidates.length > 200 ? { nextFrom: candidates[200].startAt } : {}), remoteAvailabilityComplete: true, reservationsGuaranteed: false };
      result.check(); return response;
    });
  }
  async slots(target: BookingTarget, raw: string, origin: string, value: unknown) {
    const body = range.parse(value), booking = this.core.managementBooking(target, raw, origin, body.bookingRef), { authority } = this.eligible(target, booking);
    const result = await this.candidates(target, booking, authority, () => { this.core.managementBooking(target, raw, origin, booking.id); }, Date.parse(body.from), Date.parse(body.to));
    return this.issueQuotes(target, booking, result, { purpose: 'reschedule', managementTokenHash: digest(raw) });
  }
  /** Caller owns the transaction and the quote's identity; no external I/O here. */
  reserve(target: BookingTarget, current: Entity, authority: BookingAuthority, quote: Entity, native: { keyHash: string; fingerprint: string }, admin?: { id: string; fence: string; reservedRevision: number }) {
    const { page, calendar, grant } = authorizeBookingCalendar(this.store, authority);
    if (this.store.list(target.tenantId, 'booking-reschedule-operations').filter(o => o.bookingId === current.id).length >= 20) throw new BookingError(429, 'booking_daily_limit');
    const config = eventTypeConfigFromRecord(page!); config.bufferMinutes = bookingEffectiveBuffer(calendar, config.bufferMinutes);
    const requested = validateBookingWindow(config, { startAt: String(quote.startAt), endAt: String(quote.endAt) }, { now: this.now() });
    const window = { ...requested, ...validateCalendarBookingWindow(calendar, requested, config.bufferMinutes) };
    if (window.startAt === current.startAt) throw new BookingError(409, 'booking_same_time');
    if (this.core.localBusy(target, grant!, window.bufferStartAt, window.bufferEndAt, current.id) || this.core.dailyBusy(target, page!, window.localDate, current.id)) throw new BookingError(409, 'booking_slot_taken');
    const operation = this.store.create(target.tenantId, 'booking-reschedule-operations', { bookingId: current.id, ...native, outcome: 'pending' });
    const hold = this.store.create(target.tenantId, 'appointments', { calendarId: grant!.localCalendarId, bookingId: current.id, bookingPageId: current.pageId, title: 'Horário reservado durante reagendamento', ...window, timezone: config.timezone, status: 'scheduled', source: 'public_booking_reschedule_hold', remoteResourceKey: grant!.resourceKey, syncStatus: 'hold_pending', attendeeEmails: [] });
    const move: Move = { recordId: operation.id, holdAppointmentId: hold.id, target: window, fromRevision: Number(current.revision ?? 1), attempted: false, ...(admin ? { reservedRevision: admin.reservedRevision, admin: { id: admin.id, fence: admin.fence } } : {}) };
    const booking = this.store.update(target.tenantId, 'public-bookings', current.id, { status: 'reschedule_pending', reschedule: move, operationId: admin?.fence ?? randomUUID(), operationInFlightUntil: this.now() + 360000, ...(admin ? { revision: admin.reservedRevision } : {}) })!;
    this.store.update(target.tenantId, 'appointments', String(current.appointmentId), { syncStatus: 'reschedule_pending' });
    return { booking, snapshot: bookingMoveSnapshot(this.store, booking) };
  }
  private fence(target: BookingTarget, booking: Entity, snapshot: string) {
    return () => { const current = this.store.get(target.tenantId, 'public-bookings', booking.id); if (!current || bookingMoveSnapshot(this.store, current) !== snapshot || Number(current.operationInFlightUntil) <= this.now()) throw new BookingError(409, 'booking_state_changed'); };
  }
  private finish(target: BookingTarget, booking: Entity, move: Move, outcome: 'applied' | 'failed' | 'unknown' | 'conflict', fence: () => void, errorCode?: string, busy = false, assertAccess?: () => void) {
    return this.store.transaction(() => {
      assertAccess?.(); fence();
      const resolved = outcome === 'failed' || outcome === 'applied' && !busy;
      const status = outcome === 'applied' ? busy ? 'reschedule_conflict' : 'confirmed' : outcome === 'failed' ? 'confirmed' : `reschedule_${outcome}`;
      const updated = this.store.update(target.tenantId, 'public-bookings', booking.id, { status, operationId: null, operationInFlightUntil: 0,
        revision: move.reservedRevision ?? (resolved ? move.fromRevision + 1 : move.fromRevision), reschedule: resolved ? null : move, errorCode: errorCode ?? null, lastRescheduleResult: outcome === 'applied' && !busy ? 'applied' : outcome === 'failed' ? 'not_applied' : null,
        ...(outcome === 'applied' && !busy ? { ...move.target, rescheduledAt: iso(this.now()) } : {}),
      })!;
      this.store.update(target.tenantId, 'appointments', String(booking.appointmentId), { syncStatus: status === 'confirmed' ? 'synced' : status, ...(outcome === 'applied' && !busy ? move.target : {}) });
      if (resolved) this.store.update(target.tenantId, 'appointments', move.holdAppointmentId, { status: 'cancelled', syncStatus: 'hold_released' });
      this.store.update(target.tenantId, 'booking-reschedule-operations', move.recordId, { outcome: busy ? 'conflict' : outcome, errorCode: errorCode ?? null, completedAt: resolved ? iso(this.now()) : null });
      updateOperatorMoveReceipt(this.store, booking, move, outcome === 'applied' && !busy ? 'succeeded' : move.notApplied ? 'not_applied' : move.attempted ? 'unknown' : 'not_sent', resolved, errorCode, this.now());
      return this.core.receipt(updated);
    });
  }
  async executeReserved(target: BookingTarget, reserved: { booking: Entity; snapshot: string }, authority: BookingAuthority, assertAccess: () => void) {
    let booking = reserved.booking, move = booking.reschedule as Move, fence = this.fence(target, booking, reserved.snapshot);
    const guard = () => { assertAccess(); fence(); };
    const access: BookingAuthority = authority.kind === 'grant' ? { ...authority, assertAccess: guard } : authority;
    const check = () => { guard(); authorizeBookingCalendar(this.store, access); };
    try {
      check(); const previous = this.verifyRemote(await readBookingCalendarEvent(this.store, access, String(booking.remoteEventId)), booking); check();
      const remoteBusy = await readBookingCalendar(this.store, access, move.target.bufferStartAt, move.target.bufferEndAt); check();
      if (remoteBusy.some(b => b.id !== previous.id && overlap(move.target, b))) throw new BookingError(409, 'booking_slot_taken');
      await rescheduleBookingCalendarEvent(this.store, access, previous, move.target, () => {
        const next = this.store.transaction(() => {
          check(); const { grant, page } = authorizeBookingCalendar(this.store, access);
          if (this.core.localBusy(target, grant!, move.target.bufferStartAt, move.target.bufferEndAt, booking.id) || this.core.dailyBusy(target, page!, move.target.localDate, booking.id)) throw new BookingError(409, 'booking_slot_taken');
          const nextMove = { ...move, attempted: true, expectedEtag: previous.etag };
          this.store.update(target.tenantId, 'booking-reschedule-operations', move.recordId, { attemptedAt: iso(this.now()) });
          updateOperatorMoveReceipt(this.store, booking, nextMove, 'pending', false, undefined, this.now());
          const updated = this.store.update(target.tenantId, 'public-bookings', booking.id, { reschedule: nextMove })!;
          assertAccess(); authorizeBookingCalendar(this.store, authority);
          return { booking: updated, snapshot: bookingMoveSnapshot(this.store, updated) };
        });
        booking = next.booking; move = booking.reschedule as Move; fence = this.fence(target, booking, next.snapshot); check();
      }, move.admin ? { recordAccepted: () => updateOperatorMoveReceipt(this.store, booking, move, 'accepted', false, undefined, this.now(), true) } : {}); check();
      const finalBusy = await readBookingCalendar(this.store, access, move.target.bufferStartAt, move.target.bufferEndAt); check();
      const { grant } = authorizeBookingCalendar(this.store, access);
      return this.finish(target, booking, move, 'applied', fence, undefined, finalBusy.some(b => b.id !== previous.id && overlap(move.target, b)) || this.core.localBusy(target, grant!, move.target.bufferStartAt, move.target.bufferEndAt, booking.id), check);
    } catch (error) {
      const code = error instanceof BookingError || error instanceof OAuthError ? error.code : 'booking_provider_failed';
      if (move.attempted && error instanceof OAuthError && error.upstreamStatus === 412) {
        move = { ...move, notApplied: true };
        updateOperatorMoveReceipt(this.store, booking, move, 'not_applied', false, 'booking_remote_version_changed', this.now(), true);
        try {
          check(); const next = this.store.transaction(() => { check(); const updated = this.store.update(target.tenantId, 'public-bookings', booking.id, { reschedule: move })!; assertAccess(); return { booking: updated, snapshot: bookingMoveSnapshot(this.store, updated) }; });
          booking = next.booking; fence = this.fence(target, booking, next.snapshot);
          this.verifyRemote(await readBookingCalendarEvent(this.store, access, String(booking.remoteEventId)), booking); check();
          return this.finish(target, booking, move, 'failed', fence, 'booking_remote_version_changed', false, check);
        } catch { /* Both holds survive unless the original event was positively verified. */ }
      }
      updateOperatorMoveReceipt(this.store, booking, move, move.notApplied ? 'not_applied' : move.attempted ? 'unknown' : 'not_sent', false, code, this.now(), true);
      // Receipt evidence survives authority loss. Cleanup is separately fenced and never adopts a successor.
      try { this.finish(target, booking, move, move.attempted ? 'unknown' : code === 'booking_remote_changed' ? 'conflict' : 'failed', fence, code); } catch { /* A successor or expired lease owns current holds. */ }
      throw error;
    }
  }
  async reschedule(target: BookingTarget, raw: string, origin: string, value: unknown) {
    const body = input.parse(value), initial = this.core.managementBooking(target, raw, origin, body.bookingRef), fingerprint = digest(JSON.stringify([body.expectedRevision, body.quote]));
    const acquired = this.store.transaction(() => {
      const current = this.core.managementBooking(target, raw, origin, initial.id);
      const previous = this.store.list(target.tenantId, 'booking-reschedule-operations').find(o => o.bookingId === current.id && o.keyHash === digest(body.idempotencyKey));
      if (previous) { if (previous.fingerprint !== fingerprint) throw new BookingError(409, 'idempotency_conflict'); return { replay: true as const, booking: current }; }
      const { authority, page, grant } = this.eligible(target, current);
      if (Number(current.revision ?? 1) !== body.expectedRevision) throw new BookingError(409, 'booking_revision_conflict');
      const quote = this.store.list(target.tenantId, 'booking-slot-quotes').find(q => q.tokenHash === digest(body.quote));
      if (!quote || quote.purpose !== 'reschedule' || quote.bookingId !== current.id || quote.managementTokenHash !== digest(raw) || quote.grantId !== grant!.id || quote.revision !== page!.revision || quote.bookingRevision !== body.expectedRevision || Number(quote.expiresAt) <= this.now()) throw new BookingError(409, 'booking_quote_expired');
      return { replay: false as const, reserved: this.reserve(target, current, authority, quote, { keyHash: digest(body.idempotencyKey), fingerprint }), authority };
    });
    if (acquired.replay) return this.core.receipt(acquired.booking);
    return this.executeReserved(target, acquired.reserved, acquired.authority, () => { this.core.managementBooking(target, raw, origin, acquired.reserved.booking.id); });
  }
  async reconcile(actor: MembershipActor, sessionHash: string, initial: Entity, assertAccess?: () => void) {
    requireBookingOwner(this.store, actor, sessionHash, assertAccess);
    const target = { tenantId: actor.tenantId, pageId: String(initial.pageId) }, initialSnapshot = bookingMoveSnapshot(this.store, initial);
    const authority = this.core.authority(target, 'reconcile', String(initial.grantId), { actor, sessionHash, assertAccess });
    const reserved = this.store.transaction(() => {
      authorizeBookingCalendar(this.store, authority);
      const current = this.store.get(target.tenantId, 'public-bookings', initial.id);
      if (!current?.reschedule || bookingMoveSnapshot(this.store, current) !== initialSnapshot) throw new BookingError(409, 'booking_state_changed');
      if (Number(current.operationInFlightUntil) > this.now()) throw new BookingError(409, 'booking_operation_in_progress');
      const booking = this.store.update(target.tenantId, 'public-bookings', current.id, { operationId: randomUUID(), operationInFlightUntil: this.now() + 360000 })!;
      requireBookingOwner(this.store, actor, sessionHash, assertAccess);
      return { booking, snapshot: bookingMoveSnapshot(this.store, booking) };
    });
    const booking = reserved.booking, move = booking.reschedule as Move, fence = this.fence(target, booking, reserved.snapshot);
    const guard = () => { requireBookingOwner(this.store, actor, sessionHash, assertAccess); fence(); };
    const access: BookingAuthority = { ...authority, assertAccess: guard };
    const check = () => { guard(); authorizeBookingCalendar(this.store, access); };
    try {
      const remote = await readBookingCalendarEvent(this.store, access, String(booking.remoteEventId)); check();
      if (remote && !remote.cancelled && remote.reference === booking.reference && same(remote, move.target) && remote.etag && /^"[^"\r\n]{1,1000}"$/.test(remote.etag) && remote.etag !== move.expectedEtag && !remote.hasAttendees && !remote.recurring) {
        const busy = await readBookingCalendar(this.store, access, move.target.bufferStartAt, move.target.bufferEndAt); check();
        const { grant } = authorizeBookingCalendar(this.store, access);
        return this.finish(target, booking, move, 'applied', fence, undefined, busy.some(b => b.id !== remote.id && overlap(move.target, b)) || this.core.localBusy(target, grant!, move.target.bufferStartAt, move.target.bufferEndAt, booking.id), check);
      }
      if ((!move.attempted || move.notApplied) && remote) {
        this.verifyRemote(remote, booking); check();
        return this.finish(target, booking, move, 'failed', fence, move.notApplied ? 'booking_remote_version_changed' : 'booking_reschedule_not_attempted', false, check);
      }
      return { ...this.finish(target, booking, move, 'unknown', fence, 'booking_reschedule_outcome_unresolved', false, check), reconciliation: 'remote_outcome_unresolved' };
    } catch (error) {
      try { this.finish(target, booking, move, 'unknown', fence, error instanceof BookingError || error instanceof OAuthError ? error.code : 'booking_provider_failed'); } catch { /* Never modify a newer reservation. */ }
      throw error;
    }
  }
}
