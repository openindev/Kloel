import type { Entity, Store } from '../store.js';
import { resolveSessionActor, resolveMembershipActor, type MembershipActor } from '../memberships/service.js';
import { oauthAuthorizationGeneration, oauthAuthorizationIdentity } from '../oauth/access.js';
import { bookingCalendarPolicy } from './window.js';

export class BookingError extends Error {
  constructor(readonly status: number, readonly code: string, message = 'Não foi possível concluir o agendamento.') { super(message); }
}
export type BookingPurpose = 'availability' | 'create' | 'reschedule' | 'cancel' | 'reconcile' | 'operator_cancel' | 'operator_reschedule' | 'notify';
export function requireBookingScopes(provider: unknown, value: unknown) {
  const scopes = String(value ?? '').split(/\s+/);
  const permitted = provider === 'google' ? scopes.includes('https://www.googleapis.com/auth/calendar') || scopes.includes('https://www.googleapis.com/auth/calendar.events') && scopes.includes('https://www.googleapis.com/auth/calendar.readonly') : scopes.some(s => s.replace('https://graph.microsoft.com/', '').toLowerCase() === 'calendars.readwrite');
  if (!permitted) throw new BookingError(403, 'booking_oauth_scope_missing');
}
export type BookingOperator = { actor: MembershipActor; sessionHash: string; assertAccess?: () => void };
export type BookingAuthority = { kind: 'grant'; tenantId: string; grantId: string; purpose: BookingPurpose; operator?: BookingOperator; assertAccess?: () => void }
  | ({ kind: 'publication'; tenantId: string; pageId: string } & BookingOperator);

export function requireBookingOwner(store: Store, actor: MembershipActor, sessionHash: string, assertAccess?: () => void): MembershipActor {
  assertAccess?.();
  const current = resolveSessionActor(store, sessionHash);
  if (!current || current.userId !== actor.userId || current.tenantId !== actor.tenantId || current.role !== 'owner') throw new BookingError(403, 'booking_owner_required', 'A publicação exige a sessão atual do proprietário.');
  return current;
}
export function membershipId(store: Store, tenantId: string, userId: string): string {
  const row = store.db.prepare('SELECT id FROM memberships WHERE tenant_id=? AND user_id=?').get(tenantId, userId);
  if (!row) throw new BookingError(403, 'booking_grant_revoked');
  return String(row.id);
}

/** Every use resolves persisted authority. No human actor is invented for public requests. */
export function authorizeBookingCalendar(store: Store, authority: BookingAuthority): { connection: Entity; calendar: Entity; grant?: Entity; page?: Entity } {
  if (authority.kind === 'grant') authority.assertAccess?.();
  let ownerId: string; let calendarId: string; let grant: Entity | undefined; let page: Entity | undefined;
  if (authority.kind === 'publication') {
    ownerId = requireBookingOwner(store, authority.actor, authority.sessionHash, authority.assertAccess).userId;
    page = store.get(authority.tenantId, 'booking-pages', authority.pageId);
    if (!page || page.enabled !== true) throw new BookingError(404, 'booking_page_unavailable');
    calendarId = String(page.calendarId);
  } else {
    if (['reconcile', 'operator_cancel', 'operator_reschedule'].includes(authority.purpose)) {
      if (!authority.operator || authority.operator.actor.tenantId !== authority.tenantId) throw new BookingError(403, 'booking_owner_required');
      requireBookingOwner(store, authority.operator.actor, authority.operator.sessionHash, authority.operator.assertAccess);
    }
    grant = store.get(authority.tenantId, 'booking-grants', authority.grantId);
    if (!grant || grant.status !== 'active') throw new BookingError(403, 'booking_grant_revoked');
    ownerId = String(grant.publisherUserId); calendarId = String(grant.localCalendarId);
    const owner = resolveMembershipActor(store, ownerId, authority.tenantId);
    if (owner?.role !== 'owner' || membershipId(store, authority.tenantId, ownerId) !== grant.publisherMembershipId) throw new BookingError(403, 'booking_grant_revoked');
    page = store.get(authority.tenantId, 'booking-pages', String(grant.pageId));
    if (['availability', 'create', 'reschedule', 'operator_reschedule'].includes(authority.purpose) && (!page || page.enabled !== true || page.publicationStatus !== 'published' || page.grantId !== grant.id || page.revision !== grant.configRevision)) throw new BookingError(403, 'booking_page_unavailable');
  }
  const calendar = store.get(authority.tenantId, 'calendars', calendarId);
  const connection = calendar && store.get(authority.tenantId, 'oauth-connections', String(calendar.connectionId));
  if (!calendar || calendar.enabled !== true || !connection || !['google', 'microsoft'].includes(String(connection.provider)) || connection.provider !== calendar.provider || connection.status !== 'connected' || connection.userId !== ownerId || typeof connection.remoteId !== 'string' || !connection.remoteId || typeof calendar.externalCalendarId !== 'string' || !calendar.externalCalendarId || !Array.isArray(connection.capabilities) || !connection.capabilities.includes('calendar_write')) throw new BookingError(403, 'booking_connection_unavailable');
  requireBookingScopes(connection.provider, connection.scopes);
  if (grant && (grant.connectionId !== connection.id || grant.provider !== connection.provider || grant.remoteAccountId !== connection.remoteId || grant.sourceCalendarId !== calendar.externalCalendarId || grant.connectionGeneration !== oauthAuthorizationGeneration(connection) || grant.connectionIdentity !== oauthAuthorizationIdentity(connection))) throw new BookingError(403, 'booking_grant_revoked');
  if (grant && authority.kind === 'grant' && ['availability', 'create', 'reschedule', 'operator_reschedule'].includes(authority.purpose) && grant.calendarPolicyIdentity !== bookingCalendarPolicy(calendar)) throw new BookingError(403, 'booking_calendar_policy_changed');
  return { connection, calendar, grant, page };
}
