import { availableBookingWindows, reserveManagedBooking, executeReservedCreate, completeAssistantCreation } from './create.js';
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Entity, Store } from '../store.js';
import type { MembershipActor } from '../memberships/service.js';
import { digest, seal } from '../oauth/crypto.js';
import { oauthAuthorizationGeneration, oauthAuthorizationIdentity } from '../oauth/access.js';
import { OAuthError } from '../oauth/client.js';
import { canonicalizeBookingCalendar, readBookingCalendar, createBookingCalendarEvent, cancelBookingCalendarEvent, readBookingCalendarEvent, readMicrosoftCancellationEvent, validMicrosoftBookingEtag, type BookingRemoteEvent } from '../oauth/booking-calendar.js';
import { eventTypeConfigFromRecord, validateBookingWindow, validateBookingForm } from '../scheduling/service.js';
import { authorizeBookingCalendar, BookingError, membershipId, requireBookingOwner, type BookingAuthority, type BookingPurpose, type BookingOperator } from './authority.js';
import { bookingCalendarPolicy, bookingEffectiveBuffer, validateCalendarBookingWindow } from './window.js';
import { BookingRescheduler } from './reschedule.js';
import { appointmentBlocks } from '../appointment-blocking.js';
import { completeOperatorCancellation, microsoftCancellationReservation } from './operator-cancel.js';
import { bookingInvitee, inviteeEmailState, notificationManageAccepts } from '../scheduling-notifications.js';

const token = () => randomBytes(32).toString('base64url');
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const keySchema = z.string().uuid();
const activeStatuses = new Set(['pending', 'unknown', 'confirmed', 'cancel_pending', 'conflict', 'reschedule_pending', 'reschedule_unknown', 'reschedule_conflict']);
const overlaps = (a: string, b: string, c: string, d: string) => Date.parse(a) < Date.parse(d) && Date.parse(b) > Date.parse(c);
const iso = (n: number) => new Date(n).toISOString();
const safeCode = (error: unknown) => error instanceof BookingError || error instanceof OAuthError ? error.code : 'booking_provider_failed';
export type BookingTarget = { tenantId: string; pageId: string };
const reconciliationSnapshot = (b: Entity) => JSON.stringify([b.status, b.operationId, b.cancelKeyHash, b.operationInFlightUntil, b.remoteEventId, Number(b.revision ?? 1), b.startAt, b.endAt, b.bufferStartAt, b.bufferEndAt, b.reschedule ?? null, b.reference, b.grantId, b.pageId, b.appointmentId, b.resourceKey, b.adminCancelOperationId ?? null, b.adminCancelFence ?? null]);

export class PublicBookingService {
  readonly rescheduling = new BookingRescheduler(this);
  constructor(readonly store: Store, readonly now: () => number = Date.now) {}
  authority(target: BookingTarget, purpose: BookingPurpose, grantId?: string, operator?: BookingOperator): BookingAuthority {
    const page = this.store.get(target.tenantId, 'booking-pages', target.pageId);
    const authority: BookingAuthority = { kind: 'grant', tenantId: target.tenantId, grantId: grantId ?? String(page?.grantId ?? ''), purpose, operator };
    authorizeBookingCalendar(this.store, authority); return authority;
  }
  lookup(orgSlug: string, eventSlug: string): BookingTarget {
    const row = this.store.db.prepare("SELECT tenant_id,id FROM entities WHERE collection='booking-pages' AND json_extract(body,'$.publicOrgSlug')=? AND json_extract(body,'$.slug')=?").all(orgSlug, eventSlug);
    if (row.length !== 1) throw new BookingError(404, 'booking_page_unavailable');
    return { tenantId: String(row[0].tenant_id), pageId: String(row[0].id) };
  }
  page(target: BookingTarget) {
    const { page } = authorizeBookingCalendar(this.store, this.authority(target, 'availability'));
    const config = eventTypeConfigFromRecord(page!);
    const mail = !!process.env.RESEND_API_KEY && !!process.env.RESEND_FROM;
    return { orgSlug: page!.publicOrgSlug, eventSlug: config.slug, name: config.name, description: config.description, timezone: config.timezone, durationMinutes: config.durationMinutes, form: config.form, notifications: 'not_sent',
      location: { kind: config.location.kind, address: config.location.kind === 'physical' ? config.location.address : '', phone: config.location.kind === 'phone' ? config.location.phone : '' },
      customFields: config.customFields, hostDisplayName: config.hostDisplayName, confirmationMessage: config.confirmationMessage, allowCancel: config.allowCancel, allowReschedule: config.allowReschedule,
      emailNotifications: mail && config.notifications.invitee ? 'enabled' : 'disabled', listed: !config.hideFromCompanyPage };
  }
  async publish(actor: MembershipActor, sessionHash: string, pageId: string, revision: number, assertAccess?: () => void) {
    const authority: BookingAuthority = { kind: 'publication', actor, sessionHash, assertAccess, tenantId: actor.tenantId, pageId };
    const before = authorizeBookingCalendar(this.store, authority); const config = eventTypeConfigFromRecord(before.page!);
    if (before.page!.revision !== revision) throw new BookingError(409, 'booking_revision_conflict');
    const identity = oauthAuthorizationIdentity(before.connection); const member = membershipId(this.store, actor.tenantId, actor.userId);
    const canonical = await canonicalizeBookingCalendar(this.store, authority);
    return this.store.transaction(() => {
      const current = authorizeBookingCalendar(this.store, authority);
      if (current.page!.revision !== revision || current.calendar.id !== before.calendar.id || current.calendar.externalCalendarId !== before.calendar.externalCalendarId || oauthAuthorizationIdentity(current.connection) !== identity || membershipId(this.store, actor.tenantId, actor.userId) !== member) throw new BookingError(409, 'booking_revision_conflict');
      if (current.page!.publicationStatus === 'published') throw new BookingError(409, 'booking_already_published');
      const publicOrgSlug = `o-${digest(actor.tenantId).slice(0, 24)}`;
      if (this.store.list(actor.tenantId, 'booking-pages').some(p => p.id !== pageId && p.slug === config.slug)) throw new BookingError(409, 'booking_slug_conflict');
      const grant = this.store.create(actor.tenantId, 'booking-grants', {
        pageId, configRevision: revision, status: 'active', publisherUserId: actor.userId, publisherMembershipId: member,
        localCalendarId: current.calendar.id, sourceCalendarId: current.calendar.externalCalendarId, connectionId: current.connection.id,
        provider: current.connection.provider, remoteAccountId: current.connection.remoteId,
        connectionGeneration: oauthAuthorizationGeneration(current.connection), connectionIdentity: identity,
        ...canonical, calendarPolicyIdentity: bookingCalendarPolicy(current.calendar), publishedAt: iso(this.now()),
      });
      this.store.update(actor.tenantId, 'booking-pages', pageId, { publicationStatus: 'published', grantId: grant.id, publicOrgSlug });
      return { published: true, revision, orgSlug: publicOrgSlug, eventSlug: config.slug, publicPath: `/c/${publicOrgSlug}/${config.slug}` };
    });
  }
  unpublish(actor: MembershipActor, sessionHash: string, pageId: string, revoke = false, assertAccess?: () => void) {
    requireBookingOwner(this.store, actor, sessionHash, assertAccess);
    const page = this.store.get(actor.tenantId, 'booking-pages', pageId);
    if (!page) throw new BookingError(404, 'booking_page_unavailable');
    return this.store.transaction(() => {
      requireBookingOwner(this.store, actor, sessionHash, assertAccess);
      if (revoke) for (const grant of this.store.list(actor.tenantId, 'booking-grants').filter(g => g.pageId === pageId && g.status === 'active')) this.store.update(actor.tenantId, 'booking-grants', grant.id, { status: 'revoked', revokedAt: iso(this.now()) });
      this.store.update(actor.tenantId, 'booking-pages', pageId, { publicationStatus: 'unpublished' });
      return { published: false, grantsRevoked: revoke };
    });
  }
  rate(target: BookingTarget, ip: string, kind: 'requests' | 'sessions') {
    const width = kind === 'sessions' ? 3600000 : 60000; const limit = kind === 'sessions' ? 20 : 60;
    this.store.transaction(() => {
      const bucket = `${kind}:${digest(ip)}:${Math.floor(this.now() / width)}`;
      const all = this.store.list(target.tenantId, 'booking-rates'); const old = all.find(r => r.bucket === bucket);
      if (Number(old?.count ?? 0) >= limit) throw new BookingError(429, 'booking_rate_limit');
      const dailyBucket = `tenant:${Math.floor(this.now() / 86400000)}`;
      const daily = all.find(r => r.bucket === dailyBucket);
      if (Number(daily?.count ?? 0) >= 3000) throw new BookingError(429, 'booking_daily_limit');
      if (daily) this.store.update(target.tenantId, 'booking-rates', daily.id, { count: Number(daily.count) + 1 });
      else this.store.create(target.tenantId, 'booking-rates', { bucket: dailyBucket, count: 1, expiresAt: this.now() + 86400000 });
      if (old) this.store.update(target.tenantId, 'booking-rates', old.id, { count: Number(old.count) + 1 });
      else this.store.create(target.tenantId, 'booking-rates', { bucket, count: 1, expiresAt: this.now() + width });
      for (const stale of all.filter(r => Number(r.expiresAt) < this.now() - 86400000)) this.store.remove(target.tenantId, 'booking-rates', stale.id);
    });
  }
  createSession(target: BookingTarget, origin: string) {
    const authority = this.authority(target, 'availability'); const raw = token();
    const session = this.store.transaction(() => {
      const recent = this.store.list(target.tenantId, 'booking-visitor-sessions').filter(s => Date.parse(s.createdAt) >= this.now() - 86400000);
      if (recent.length >= 1000) throw new BookingError(429, 'booking_daily_limit');
      return this.store.create(target.tenantId, 'booking-visitor-sessions', { pageId: target.pageId, grantId: authority.kind === 'grant' ? authority.grantId : '', tokenHash: digest(raw), origin, expiresAt: this.now() + 12 * 3600000, status: 'active' });
    });
    return { token: raw, expiresAt: session.expiresAt };
  }
  session(target: BookingTarget, raw: string, origin: string, fresh = true): Entity {
    tokenSchema.parse(raw);
    const session = this.store.list(target.tenantId, 'booking-visitor-sessions').find(s => s.tokenHash === digest(raw));
    if (!session || session.pageId !== target.pageId || session.origin !== origin || session.status !== 'active' || Number(session.expiresAt) <= this.now()) throw new BookingError(401, 'booking_session_expired');
    if (fresh) { const a = this.authority(target, 'availability'); if (a.kind !== 'grant' || a.grantId !== session.grantId) throw new BookingError(401, 'booking_session_expired'); }
    return session;
  }
  localBusy(target: BookingTarget, grant: Entity, start: string, end: string, excludeBooking?: string): boolean {
    const bookings = this.store.list(target.tenantId, 'public-bookings');
    if (bookings.some(b => b.id !== excludeBooking && b.resourceKey === grant.resourceKey && activeStatuses.has(String(b.status)) && (overlaps(start, end, String(b.bufferStartAt), String(b.bufferEndAt)) || b.reschedule && typeof b.reschedule === 'object' && overlaps(start, end, String((b.reschedule as any).target?.bufferStartAt), String((b.reschedule as any).target?.bufferEndAt))))) return true;
    const calendars = new Set(this.store.list(target.tenantId, 'booking-grants').filter(g => g.resourceKey === grant.resourceKey).map(g => String(g.localCalendarId)));
    calendars.add(String(grant.localCalendarId));
    for (const calendar of this.store.list(target.tenantId, 'calendars')) {
      if (calendar.provider !== grant.provider) continue;
      const connection = this.store.get(target.tenantId, 'oauth-connections', String(calendar.connectionId));
      const sameAccount = connection?.remoteId === grant.remoteAccountId;
      if (calendar.externalCalendarId === grant.canonicalCalendarId && (grant.provider === 'google' || sameAccount) || calendar.externalCalendarId === 'primary' && grant.isPrimaryCalendar === true && sameAccount) calendars.add(calendar.id);
    }
    return this.store.list(target.tenantId, 'appointments').some(a => (!excludeBooking || a.bookingId !== excludeBooking) && a.status === 'scheduled' && (a.remoteResourceKey === grant.resourceKey || calendars.has(String(a.calendarId))) && appointmentBlocks(a, Date.parse(start), Date.parse(end)));
  }
  dailyBusy(target: BookingTarget, page: Entity, date: string, excludeBooking?: string): boolean {
    return this.store.list(target.tenantId, 'public-bookings').filter(b => b.id !== excludeBooking && b.pageId === target.pageId && (b.localDate === date || (b.reschedule as any)?.target?.localDate === date) && activeStatuses.has(String(b.status))).length >= Number(page.dailyLimit);
  }
  async slots(target: BookingTarget, raw: string, origin: string, input: unknown) {
    const session = this.session(target, raw, origin); const authority = this.authority(target, 'availability');
    const q = z.object({ from: z.string().datetime({ offset: true }), to: z.string().datetime({ offset: true }) }).strict().parse(input);
    const { candidates, config, page, grant } = await availableBookingWindows(this, authority, q.from, q.to, () => { this.session(target, raw, origin); });
    return this.store.transaction(() => {
      this.session(target, raw, origin);
      for (const old of this.store.list(target.tenantId, 'booking-slot-quotes').filter(q => Number(q.expiresAt) <= this.now())) this.store.remove(target.tenantId, 'booking-slot-quotes', old.id);
      const quotes = this.store.list(target.tenantId, 'booking-slot-quotes');
      if (quotes.length + Math.min(candidates.length, 200) > 10000 || quotes.filter(q => q.sessionId === session.id).length + Math.min(candidates.length, 200) > 600) throw new BookingError(429, 'booking_quote_limit');
      return { timezone: config.timezone, slots: candidates.slice(0, 200).map(window => {
        const quote = token(); this.store.create(target.tenantId, 'booking-slot-quotes', { sessionId: session.id, pageId: page!.id, grantId: grant!.id, revision: page!.revision, tokenHash: digest(quote), expiresAt: this.now() + 5 * 60000, ...window });
        return { startAt: window.startAt, endAt: window.endAt, quote, expiresAt: this.now() + 5 * 60000 };
      }), complete: candidates.length <= 200, ...(candidates.length > 200 ? { nextFrom: candidates[200].startAt } : {}), remoteAvailabilityComplete: true, reservationsGuaranteed: false };
    });
  }
  receipt(booking: Entity) {
    const target = (booking.reschedule as any)?.target;
    return { bookingRef: booking.id, revision: Number(booking.revision ?? 1), status: booking.status, startAt: booking.startAt, endAt: booking.endAt, timezone: booking.timezone, lastRescheduleResult: booking.lastRescheduleResult ?? null, notifications: 'not_sent', ...(target ? { requestedTime: { startAt: target.startAt, endAt: target.endAt } } : {}), ...(['unknown', 'cancel_pending', 'reschedule_pending', 'reschedule_unknown', 'reschedule_conflict'].includes(String(booking.status)) ? { needsReconciliation: true } : {}),
      inviteeEmail: inviteeEmailState(this.store, booking), ...(typeof booking.meetingUrl === 'string' && booking.status !== 'cancelled' ? { meetingUrl: booking.meetingUrl } : {}) };
  }
  private values(page: Entity, input: Record<string, string>) {
      return validateBookingForm(eventTypeConfigFromRecord(page), input);
    }
  async book(target: BookingTarget, raw: string, origin: string, input: unknown) {
    const body = z.object({ quote: tokenSchema, values: z.record(z.string().max(500)), idempotencyKey: keySchema }).strict().parse(input);
    const session = this.session(target, raw, origin); const authority = this.authority(target, 'create');
    const { page, grant, calendar } = authorizeBookingCalendar(this.store, authority); const pageConfig = eventTypeConfigFromRecord(page!); const config = { ...pageConfig, bufferMinutes: bookingEffectiveBuffer(calendar, pageConfig.bufferMinutes) };
    const values = this.values(page!, body.values); const fingerprint = digest(JSON.stringify({ quote: body.quote, values }));
    const reference = randomUUID(); const encryptedVisitor = seal(values, `${target.tenantId}:${reference}:booking-visitor`);
    const acquired = this.store.transaction(() => {
      this.session(target, raw, origin);
      const all = this.store.list(target.tenantId, 'public-bookings');
      const old = all.find(b => b.sessionId === session.id && b.keyHash === digest(body.idempotencyKey));
      if (old) { if (old.fingerprint !== fingerprint) throw new BookingError(409, 'idempotency_conflict'); return { booking: old, replay: true }; }
      if (all.filter(b => Date.parse(b.createdAt) >= this.now() - 86400000).length >= 500 || all.filter(b => b.sessionId === session.id).length >= 5) throw new BookingError(429, 'booking_daily_limit');
      const quote = this.store.list(target.tenantId, 'booking-slot-quotes').find(q => q.tokenHash === digest(body.quote));
      if (!quote || quote.sessionId !== session.id || quote.grantId !== grant!.id || quote.revision !== page!.revision || Number(quote.expiresAt) <= this.now()) throw new BookingError(409, 'booking_quote_expired');
      const requested = validateBookingWindow(config, { startAt: String(quote.startAt), endAt: String(quote.endAt) }, { now: this.now() });
      const window = { ...requested, ...validateCalendarBookingWindow(calendar, requested, config.bufferMinutes) };
      if (this.localBusy(target, grant!, window.bufferStartAt, window.bufferEndAt) || this.dailyBusy(target, page!, window.localDate)) throw new BookingError(409, 'booking_slot_taken');
      const booking = reserveManagedBooking(this, target, grant!, config.name, { sessionId: session.id, reference, operationId: reference, keyHash: digest(body.idempotencyKey), fingerprint, ...window, timezone: config.timezone, encryptedVisitor, visitorRetentionUntil: this.now() + 90 * 86400000 });
      return { booking, replay: false };
    });
    if (acquired.replay) return this.receipt(acquired.booking);
    return this.receipt(await executeReservedCreate(this, target, acquired.booking, authority, config.name, () => { this.session(target, raw, origin); }));
  }

  private setState(target: BookingTarget, booking: Entity, status: string, extra: Record<string, unknown> = {}, assertAccess?: () => void) {
    return this.store.transaction(() => {
      assertAccess?.();
      const current = this.store.get(target.tenantId, 'public-bookings', booking.id);
      if (!current || current.operationId !== booking.operationId) throw new BookingError(409, 'booking_state_changed');
      const updated = this.store.update(target.tenantId, 'public-bookings', booking.id, { status, operationId: null, operationInFlightUntil: 0, ...extra })!;
      this.store.update(target.tenantId, 'appointments', String(booking.appointmentId), { status: ['cancelled', 'failed'].includes(status) ? 'cancelled' : 'scheduled', syncStatus: status === 'confirmed' ? 'synced' : status, ...(extra.remoteEventId ? { externalEventId: extra.remoteEventId } : {}) });
      if (status === 'cancelled') completeOperatorCancellation(this.store, current);
      completeAssistantCreation(this.store, current, status);
      return updated;
    });
  }

  assertOperation(target: BookingTarget, booking: Entity) {
      const current = this.store.get(target.tenantId, 'public-bookings', booking.id);
      if (!current || current.operationId !== booking.operationId) throw new BookingError(409, 'booking_state_changed');
    }
  status(target: BookingTarget, raw: string, origin: string, bookingRef: string) {
    const session = this.session(target, raw, origin, false);
    const booking = this.store.get(target.tenantId, 'public-bookings', bookingRef);
    if (!booking || booking.sessionId !== session.id || booking.pageId !== target.pageId) throw new BookingError(404, 'booking_not_found');
    return this.receipt(booking);
  }
  managementToken(target: BookingTarget, raw: string, origin: string, bookingRef: string) {
    this.status(target, raw, origin, bookingRef); const value = token();
    const booking = this.store.get(target.tenantId, 'public-bookings', bookingRef)!;
    const expiresAt = Math.min(this.now() + 90 * 86400000, Math.max(this.now() + 86400000, Date.parse(String(booking.endAt)) + 7 * 86400000));
    this.store.update(target.tenantId, 'public-bookings', bookingRef, { managementTokenHash: digest(value), managementTokenExpiresAt: expiresAt, managementOrigin: origin });
    return { token: value, expiresAt, bookingRef };
  }
  managementBooking(target: BookingTarget, raw: string, origin: string, bookingRef: string) {
    tokenSchema.parse(raw); z.string().uuid().parse(bookingRef);
    const booking = this.store.get(target.tenantId, 'public-bookings', bookingRef);
    if (!booking || booking.pageId !== target.pageId || !this.manages(booking, raw, origin)) throw new BookingError(404, 'booking_not_found');
    return booking;
  }
  /** Link do navegador (manage-token) ou link enviado nas notificações; ambos são credenciais opacas por reserva. */
  manages(booking: Entity, raw: string, origin: string) {
    return booking.managementTokenHash === digest(raw) && booking.managementOrigin === origin && Number(booking.managementTokenExpiresAt) > this.now() || notificationManageAccepts(booking, raw, origin, this.now());
  }
  /** Shared physical effect only; callers retain their own credential, reservation and receipt. */
  async cancelReserved(target: BookingTarget, booking: Entity, authority: BookingAuthority, check: () => unknown, beforeWrite: () => void, recordAccepted?: () => void, recordObservation?: (etag: string) => void): Promise<'event_absent' | 'delete_accepted'> {
    const conditional = authority.kind === 'grant' && authority.purpose === 'operator_cancel';
    const microsoftPrivate = conditional && booking.provider === 'microsoft';
    const actual = await (microsoftPrivate ? readMicrosoftCancellationEvent : readBookingCalendarEvent)(this.store, authority, String(booking.remoteEventId)); check(); this.assertOperation(target, booking);
    if (!actual || actual.cancelled && !microsoftPrivate) return 'event_absent';
    if (actual.reference !== booking.reference) throw new BookingError(409, 'booking_remote_identity_mismatch');
    if (conditional && (actual.startAt !== booking.startAt || actual.endAt !== booking.endAt || actual.hasAttendees || actual.recurring || !(microsoftPrivate ? validMicrosoftBookingEtag(actual.etag) : actual.etag && /^"[^"\r\n]{1,1000}"$/.test(actual.etag)))) throw new BookingError(409, 'booking_remote_changed');
    if (microsoftPrivate) recordObservation?.(actual.etag!);
    await cancelBookingCalendarEvent(this.store, authority, actual.id, () => { check(); this.assertOperation(target, booking); beforeWrite(); }, { ...(conditional ? { etag: actual.etag } : {}), recordAccepted });
    return 'delete_accepted';
  }
  async cancel(target: BookingTarget, raw: string, origin: string, input: unknown) {
    tokenSchema.parse(raw);
    const body = z.object({ bookingRef: z.string().uuid(), idempotencyKey: keySchema, reason: z.string().max(300).optional() }).strict().parse(input);
    const reason = (body.reason ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
    const check = () => {
      const b = this.store.get(target.tenantId, 'public-bookings', body.bookingRef);
      if (!b || b.pageId !== target.pageId || !this.manages(b, raw, origin)) throw new BookingError(404, 'booking_not_found');
      return b;
    };
    let booking = check(); if (booking.status === 'cancelled') return this.receipt(booking);
    const page = this.store.get(target.tenantId, 'booking-pages', target.pageId);
    if (page && eventTypeConfigFromRecord(page).allowCancel === false) throw new BookingError(403, 'booking_cancel_disabled');
    const authority = this.authority(target, 'cancel', String(booking.grantId));
    if (!['confirmed', 'conflict'].includes(String(booking.status)) || typeof booking.remoteEventId !== 'string') throw new BookingError(409, 'booking_requires_reconciliation');
    const previousStatus = String(booking.status);
    booking = this.store.transaction(() => { const b = check(); if (!['confirmed', 'conflict'].includes(String(b.status))) throw new BookingError(409, 'booking_requires_reconciliation'); return this.store.update(target.tenantId, 'public-bookings', booking.id, { status: 'cancel_pending', operationId: randomUUID(), operationInFlightUntil: this.now() + 360000, cancelKeyHash: digest(body.idempotencyKey), cancelReason: reason, cancelledBy: 'invitee' })!; });
    let attempted = false;
    try {
      await this.cancelReserved(target, booking, authority, check, () => { attempted = true; });
      check(); return this.receipt(this.setState(target, booking, 'cancelled', { cancelledAt: iso(this.now()) }));
    } catch (error) {
      this.setState(target, booking, attempted ? 'cancel_pending' : previousStatus, { errorCode: safeCode(error) });
      throw error;
    }
  }
  list(actor: MembershipActor, sessionHash: string, assertAccess?: () => void) {
    requireBookingOwner(this.store, actor, sessionHash, assertAccess);
    return { items: this.store.list(actor.tenantId, 'public-bookings').map(b => {
      const supported = ['google', 'microsoft'].includes(String(b.provider)), moveSupported = b.provider === 'google';
      const eligible = supported && ['confirmed', 'conflict'].includes(String(b.status)) && typeof b.remoteEventId === 'string' && !!b.remoteEventId && !b.reschedule && Number(b.operationInFlightUntil ?? 0) <= this.now();
      let moveEligible = false, moveReason: 'provider_unsupported' | 'booking_state' | 'configuration_unavailable' | null = moveSupported ? 'booking_state' : 'provider_unsupported';
      if (moveSupported) { try { this.rescheduling.eligible({ tenantId: actor.tenantId, pageId: String(b.pageId) }, b, { actor, sessionHash, assertAccess }); moveEligible = true; moveReason = null; } catch (error) { if (error instanceof BookingError && ['booking_grant_revoked', 'booking_page_unavailable', 'booking_connection_unavailable', 'booking_oauth_scope_missing', 'booking_calendar_policy_changed', 'booking_duration_changed'].includes(error.code)) moveReason = 'configuration_unavailable'; } }
      return { ...this.receipt(b), notifications: b.provider === 'microsoft' ? 'provider_managed_unknown' as const : 'not_sent' as const, pageId: b.pageId, errorCode: b.errorCode, createdAt: b.createdAt,
        invitee: bookingInvitee(b), source: b.assistantOperationId ? 'agent' as const : 'booking_page' as const, ...(typeof b.cancelReason === 'string' && b.cancelReason ? { cancelReason: b.cancelReason } : {}), adminCancellation: { supported, eligible, reason: !supported ? 'provider_unsupported' : !eligible ? 'booking_state' : null }, adminRescheduling: { supported: moveSupported, eligible: moveEligible, reason: moveReason } };
    }) };
  }
  async reconcile(actor: MembershipActor, sessionHash: string, bookingId: string, assertAccess?: () => void) {
    requireBookingOwner(this.store, actor, sessionHash, assertAccess);
    const booking = this.store.get(actor.tenantId, 'public-bookings', bookingId);
    if (!booking) throw new BookingError(404, 'booking_not_found');
    if (booking.reschedule) return this.rescheduling.reconcile(actor, sessionHash, booking, assertAccess);
    if (Number(booking.operationInFlightUntil) > this.now()) throw new BookingError(409, 'booking_operation_in_progress');
    const microsoftPrivate = booking.provider === 'microsoft' && (booking.adminCancelOperationId != null || booking.adminCancelFence != null);
    const privateReservation = microsoftPrivate ? microsoftCancellationReservation(this.store, booking, this.now()) : undefined;
    const snapshot = reconciliationSnapshot(booking);
    const unchanged = () => {
      requireBookingOwner(this.store, actor, sessionHash, assertAccess);
      const current = this.store.get(actor.tenantId, 'public-bookings', bookingId);
      if (!current || reconciliationSnapshot(current) !== snapshot) throw new BookingError(409, 'booking_state_changed');
      if (microsoftPrivate && microsoftCancellationReservation(this.store, current, this.now()) !== privateReservation) throw new BookingError(409, 'booking_cancel_operation_unavailable');
    };
    const target = { tenantId: actor.tenantId, pageId: String(booking.pageId) }; const authority = this.authority(target, 'reconcile', String(booking.grantId), { actor, sessionHash, assertAccess });
    if (microsoftPrivate) {
      const remote = await readMicrosoftCancellationEvent(this.store, authority, String(booking.remoteEventId)); unchanged();
      if (!remote) return { ...this.receipt(this.setState(target, booking, 'cancelled', { reconciledAt: iso(this.now()) }, unchanged)), notifications: 'provider_managed_unknown' as const };
      if (remote.reference !== booking.reference || remote.startAt !== booking.startAt || remote.endAt !== booking.endAt) throw new BookingError(409, 'booking_remote_identity_mismatch');
      return { ...this.receipt(booking), notifications: 'provider_managed_unknown' as const, reconciliation: 'remote_still_present' };
    }
    let remote: BookingRemoteEvent | null;
    if (typeof booking.remoteEventId === 'string') remote = await readBookingCalendarEvent(this.store, authority, booking.remoteEventId);
    else if (booking.provider === 'google') remote = await readBookingCalendarEvent(this.store, authority, `k${digest(String(booking.reference)).slice(0, 40)}`);
    else {
      const events = await readBookingCalendar(this.store, authority, String(booking.bufferStartAt), String(booking.bufferEndAt));
      const matching = events.filter(e => e.reference === booking.reference);
      if (matching.length > 1) throw new BookingError(409, 'booking_remote_identity_mismatch');
      remote = matching[0] ?? null;
    }
    unchanged();
    if (remote?.cancelled || (!remote && booking.status === 'cancel_pending')) return this.receipt(this.setState(target, booking, 'cancelled', { reconciledAt: iso(this.now()) }, unchanged));
    // An absent create may still be in flight at the provider. Never free/retry it on negative evidence alone.
    if (!remote) return { ...this.receipt(booking), reconciliation: 'remote_not_found_outcome_unresolved' };
    if (remote.reference !== booking.reference || remote.startAt !== booking.startAt || remote.endAt !== booking.endAt) throw new BookingError(409, 'booking_remote_identity_mismatch');
    if (booking.status === 'cancel_pending') return { ...this.receipt(booking), reconciliation: 'remote_still_present' };
    const busy = await readBookingCalendar(this.store, authority, String(booking.bufferStartAt), String(booking.bufferEndAt));
    unchanged();
    const conflict = busy.some(e => e.id !== remote!.id && overlaps(String(booking.bufferStartAt), String(booking.bufferEndAt), e.startAt, e.endAt));
    return this.receipt(this.setState(target, booking, conflict ? 'conflict' : 'confirmed', { remoteEventId: remote.id, reconciledAt: iso(this.now()) }, unchanged));
  }
}
