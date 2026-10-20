import type { Store } from '../store.js';
import { accessTokens, oauthAuthorizationIdentity } from './access.js';
import { providerJson, OAuthError } from './client.js';
import { digest } from './crypto.js';
import { authorizeBookingCalendar, BookingError, requireBookingScopes, type BookingAuthority } from '../public-booking/authority.js';

export type BookingRemoteEvent = { id: string; startAt: string; endAt: string; reference?: string; cancelled: boolean; etag?: string; hasAttendees?: boolean; recurring?: boolean; meetingUrl?: string };
/** Link de videoconferência gerado pelo provedor (Google Meet / Microsoft Teams); só https. */
function meetingUrlOf(data: any): string | undefined {
  const candidates = [data?.hangoutLink, ...(Array.isArray(data?.conferenceData?.entryPoints) ? data.conferenceData.entryPoints.filter((e: any) => e?.entryPointType === 'video').map((e: any) => e.uri) : []), data?.onlineMeeting?.joinUrl, data?.onlineMeetingUrl];
  for (const value of candidates) { if (typeof value !== 'string' || value.length > 2000) continue; try { const url = new URL(value); if (url.protocol === 'https:' && !url.username && !url.password) return url.toString(); } catch { /* ignore */ } }
  return undefined;
}
const resource = (value: unknown): string => {
  if (typeof value !== 'string' || !value || value.length > 1024 || ['.', '..'].includes(value)) throw new BookingError(502, 'booking_provider_response_invalid');
  return value;
};
function calendarUrl(provider: unknown, id: string) {
  return provider === 'google' ? `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(id)}` : `https://graph.microsoft.com/v1.0/me/${id === 'primary' ? 'calendar' : `calendars/${encodeURIComponent(id)}`}`;
}
async function request(store: Store, authority: BookingAuthority, url: string, init: RequestInit = {}, empty = false, beforeWrite?: () => void, recordResponse?: (data: any) => void, onPositiveStatus?: (status: number) => void) {
  const initial = authorizeBookingCalendar(store, authority).connection;
  const identity = oauthAuthorizationIdentity(initial);
  const tokens = await accessTokens(store, initial);
  requireBookingScopes(initial.provider, tokens.scope);
  const current = authorizeBookingCalendar(store, authority).connection;
  if (oauthAuthorizationIdentity(current) !== identity) throw new BookingError(403, 'booking_grant_revoked');
  const headers = new Headers(init.headers); headers.set('Authorization', `Bearer ${tokens.accessToken}`);
  headers.set('Prefer', 'outlook.timezone="UTC", IdType="ImmutableId"');
  beforeWrite?.();
  try {
    const data = await providerJson(url, { ...init, headers }, empty, onPositiveStatus);
    // A receipt-only callback preserves acceptance before a late authority failure.
    recordResponse?.(data);
    if (oauthAuthorizationIdentity(authorizeBookingCalendar(store, authority).connection) !== identity) throw new BookingError(403, 'booking_grant_revoked');
    return data;
  } catch (error) {
    authorizeBookingCalendar(store, authority);
    throw error;
  }
}

/** Resolves aliases such as primary before a publication can reserve this resource. */
export async function canonicalizeBookingCalendar(store: Store, authority: BookingAuthority) {
  if (authority.kind !== 'publication') throw new BookingError(403, 'booking_owner_required');
  const { connection, calendar } = authorizeBookingCalendar(store, authority);
  const id = resource(calendar.externalCalendarId);
  const data = await request(store, authority, connection.provider === 'google' ? `https://www.googleapis.com/calendar/v3/users/me/calendarList/${encodeURIComponent(id)}` : calendarUrl(connection.provider, id));
  const canonicalCalendarId = resource(data.id);
  if (canonicalCalendarId === 'primary') throw new BookingError(502, 'booking_calendar_not_canonical');
  if (connection.provider === 'microsoft' && data.canEdit !== true) throw new BookingError(403, 'booking_calendar_read_only');
  if (connection.provider === 'google' && !['writer', 'owner'].includes(data.accessRole)) throw new BookingError(403, 'booking_calendar_read_only');
  // Google calendar IDs are globally canonical; Graph IDs are mailbox scoped.
  const resourceKey = digest(JSON.stringify([connection.provider, connection.provider === 'google' ? '' : connection.remoteId, canonicalCalendarId]));
  return { canonicalCalendarId, resourceKey, isPrimaryCalendar: calendar.externalCalendarId === 'primary' || data.primary === true || data.isDefaultCalendar === true };
}

function endpoint(store: Store, authority: BookingAuthority) {
  const { connection, grant } = authorizeBookingCalendar(store, authority);
  if (!grant) throw new BookingError(403, 'booking_grant_required');
  return { provider: String(connection.provider), url: calendarUrl(connection.provider, resource(grant.canonicalCalendarId)) };
}
async function requireCalendarWriter(store: Store, authority: BookingAuthority) {
  const { connection, grant } = authorizeBookingCalendar(store, authority); if (!grant) throw new BookingError(403, 'booking_grant_required');
  const id = resource(grant.canonicalCalendarId);
  const data = await request(store, authority, connection.provider === 'google' ? `https://www.googleapis.com/calendar/v3/users/me/calendarList/${encodeURIComponent(id)}` : calendarUrl(connection.provider, id));
  if (data.id !== id || (connection.provider === 'google' ? !['writer', 'owner'].includes(data.accessRole) : data.canEdit !== true)) throw new BookingError(403, 'booking_calendar_read_only');
  return data;
}
function boundary(value: unknown, timezone: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || typeof timezone !== 'string') throw new BookingError(502, 'booking_provider_response_invalid');
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
    const day = (instant: number) => { const p = Object.fromEntries(formatter.formatToParts(instant).map(p => [p.type, p.value])); return `${p.year}-${p.month}-${p.day}`; };
    const anchor = Date.parse(`${value}T00:00:00Z`); if (!Number.isFinite(anchor)) throw new Error();
    let low = anchor - 48 * 3600000, high = anchor + 48 * 3600000;
    while (high - low > 1000) { const mid = Math.floor((low + high) / 2000) * 1000; if (day(mid) < value) low = mid; else high = mid; }
    return new Date(high).toISOString();
  } catch { throw new BookingError(502, 'booking_provider_response_invalid'); }
}
function stamp(value: any, provider: string, timezone?: unknown): string {
  if (value?.date) return boundary(value.date, value.timeZone || timezone);
  let date = value?.dateTime;
  if (typeof date !== 'string') throw new BookingError(502, 'booking_provider_response_invalid');
  if (!/(Z|[+-]\d\d:\d\d)$/.test(date)) {
    if (provider !== 'microsoft' || !['UTC', 'Etc/UTC'].includes(value.timeZone)) throw new BookingError(502, 'booking_provider_response_invalid');
    date += 'Z';
  }
  if (!Number.isFinite(Date.parse(date))) throw new BookingError(502, 'booking_provider_response_invalid');
  return new Date(date).toISOString();
}
function event(data: any, provider: string, timezone?: unknown): BookingRemoteEvent {
  const id = resource(data.id); const cancelled = data.status === 'cancelled' || data.isCancelled === true;
  if (cancelled) return { id, startAt: '', endAt: '', cancelled: true };
  const startAt = stamp(data.start, provider, timezone), endAt = stamp(data.end, provider, timezone);
  if (Date.parse(startAt) >= Date.parse(endAt)) throw new BookingError(502, 'booking_provider_response_invalid');
  const meetingUrl = meetingUrlOf(data);
  return { id, startAt, endAt, cancelled: false, reference: provider === 'google' ? data.extendedProperties?.private?.kloelBooking : data.transactionId,
    etag: typeof data.etag === 'string' ? data.etag : undefined, hasAttendees: data.attendeesOmitted === true || data.attendees != null && (!Array.isArray(data.attendees) || data.attendees.length > 0),
    recurring: Boolean(data.recurringEventId || data.recurrence || data.originalStartTime), ...(meetingUrl ? { meetingUrl } : {}) };
}

/** Graph returns weak ETags. Keep the exact token; never synthesize one from changeKey. */
export const validMicrosoftBookingEtag = (value: unknown): value is string => typeof value === 'string' && /^(?:W\/)?"[\x21\x23-\x7e]{1,1000}"$/.test(value);
function microsoftCancellationEvent(data: any, expectedId: string): BookingRemoteEvent {
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.id !== expectedId ||
    data.type !== 'singleInstance' || !Array.isArray(data.attendees) || data.attendees.length !== 0 ||
    data.isOrganizer !== true || data.isAllDay !== false || typeof data.isCancelled !== 'boolean' ||
    data.recurrence !== null || data.seriesMasterId != null || !validMicrosoftBookingEtag(data['@odata.etag'])) throw new BookingError(409, 'booking_remote_changed');
  const startAt = stamp(data.start, 'microsoft'), endAt = stamp(data.end, 'microsoft');
  if (Date.parse(startAt) >= Date.parse(endAt)) throw new BookingError(502, 'booking_provider_response_invalid');
  return { id: expectedId, startAt, endAt, reference: typeof data.transactionId === 'string' ? data.transactionId : undefined,
    cancelled: data.isCancelled, etag: data['@odata.etag'], hasAttendees: false, recurring: false };
}

/** Only private cancellation callers may use mailbox-scoped absence. Public flows stay unchanged. */
export async function readMicrosoftCancellationEvent(store: Store, authority: BookingAuthority, eventId: string): Promise<BookingRemoteEvent | null> {
  if (authority.kind !== 'grant' || !['operator_cancel', 'reconcile'].includes(authority.purpose)) throw new BookingError(403, 'booking_owner_required');
  await requireCalendarWriter(store, authority);
  const target = endpoint(store, authority);
  if (target.provider !== 'microsoft') throw new BookingError(409, 'booking_admin_cancel_unsupported');
  const id = encodeURIComponent(resource(eventId));
  try {
    return microsoftCancellationEvent(await request(store, authority, `${target.url}/events/${id}`), eventId);
  } catch (error) { if (!(error instanceof OAuthError) || error.upstreamStatus !== 404) throw error; }
  // An immutable event ID survives a move to another calendar in the same mailbox.
  // Any successful lookup here prevents treating a calendar-path404 as deletion.
  try {
    await request(store, authority, `https://graph.microsoft.com/v1.0/me/events/${id}`);
  } catch (error) {
    if (!(error instanceof OAuthError) || error.upstreamStatus !== 404) throw error;
    await requireCalendarWriter(store, authority);
    return null;
  }
  throw new BookingError(409, 'booking_remote_moved');
}

/** Complete, bounded busy enumeration; only the booking service sees provider identifiers. */
export async function readBookingCalendar(store: Store, authority: BookingAuthority, from: string, to: string): Promise<BookingRemoteEvent[]> {
  if (authority.kind === 'grant' && ['availability', 'create', 'reschedule', 'operator_reschedule'].includes(authority.purpose)) await requireCalendarWriter(store, authority);
  const target = endpoint(store, authority);
  const url = new URL(`${target.url}/${target.provider === 'google' ? 'events' : 'calendarView'}`);
  if (Date.parse(to) <= Date.parse(from) || Date.parse(to) - Date.parse(from) > 9 * 86400000) throw new BookingError(400, 'booking_range_invalid');
  if (target.provider === 'google') { url.searchParams.set('timeMin', from); url.searchParams.set('timeMax', to); url.searchParams.set('singleEvents', 'true'); url.searchParams.set('maxResults', '2500'); }
  else { url.searchParams.set('startDateTime', from); url.searchParams.set('endDateTime', to); url.searchParams.set('$top', '1000'); url.searchParams.set('$select', 'id,start,end,isCancelled,showAs,transactionId'); }
  const events: BookingRemoteEvent[] = [];
  for (let page = 0; page < 20; page++) {
    const data = await request(store, authority, url.toString());
    const items = target.provider === 'google' ? data.items : data.value;
    if (!Array.isArray(items)) throw new BookingError(502, 'booking_provider_response_invalid');
    for (const item of items) {
      if (!item || typeof item !== 'object') throw new BookingError(502, 'booking_provider_response_invalid');
      if (item.status === 'cancelled' || item.isCancelled || item.transparency === 'transparent' || item.showAs === 'free') continue;
      events.push(event(item, target.provider, data.timeZone));
    }
    if (target.provider === 'google') {
      if (!data.nextPageToken) return events;
      url.searchParams.set('pageToken', resource(data.nextPageToken));
    } else {
      if (!data['@odata.nextLink']) return events;
      let next: URL; try { next = new URL(data['@odata.nextLink']); } catch { throw new BookingError(502, 'booking_provider_response_invalid'); }
      if (next.origin !== url.origin || next.pathname !== url.pathname) throw new BookingError(502, 'booking_provider_response_invalid');
      const parameter = next.searchParams.has('$skiptoken') ? '$skiptoken' : '$skip';
      if (!next.searchParams.has(parameter)) throw new BookingError(502, 'booking_provider_response_invalid');
      url.searchParams.delete('$skip'); url.searchParams.delete('$skiptoken'); url.searchParams.set(parameter, resource(next.searchParams.get(parameter)));
    }
  }
  throw new BookingError(503, 'booking_availability_incomplete');
}
export async function createBookingCalendarEvent(store: Store, authority: BookingAuthority, input: { reference: string; title: string; startAt: string; endAt: string; description?: string; location?: string; conference?: boolean }, beforeWrite: () => void, options: { quiet?: boolean; recordAccepted?: () => void; recordValidated?: (event: BookingRemoteEvent) => void } = {}) {
  const calendar = await requireCalendarWriter(store, authority);
  const target = endpoint(store, authority); const url = new URL(`${target.url}/events`);
  // Google Meet só é pedido quando o calendário declara suporte; caso contrário o evento sai sem link (nunca um link inventado).
  const meet = target.provider === 'google' && input.conference === true && Array.isArray(calendar?.conferenceProperties?.allowedConferenceSolutionTypes) && calendar.conferenceProperties.allowedConferenceSolutionTypes.includes('hangoutsMeet');
  const allowedTeams: string[] = target.provider === 'microsoft' && input.conference === true && Array.isArray(calendar?.allowedOnlineMeetingProviders) ? calendar.allowedOnlineMeetingProviders.filter((p: unknown) => typeof p === 'string' && ['teamsForBusiness', 'skypeForBusiness', 'skypeForConsumer'].includes(p)) : [];
  const teams = allowedTeams.includes(calendar?.defaultOnlineMeetingProvider) ? String(calendar.defaultOnlineMeetingProvider) : allowedTeams[0];
  const body = target.provider === 'google' ? {
    id: `k${digest(input.reference).slice(0, 40)}`, summary: input.title,
    ...(input.description ? { description: input.description } : {}), ...(input.location ? { location: input.location } : {}),
    start: { dateTime: input.startAt }, end: { dateTime: input.endAt }, attendees: [],
    ...(options.quiet ? { reminders: { useDefault: false, overrides: [] } } : {}),
    ...(meet ? { conferenceData: { createRequest: { requestId: `k${digest(`${input.reference}:meet`).slice(0, 40)}`, conferenceSolutionKey: { type: 'hangoutsMeet' } } } } : {}),
    extendedProperties: { private: { kloelBooking: input.reference } },
  } : {
    transactionId: input.reference, subject: input.title, attendees: [],
    ...(input.description ? { body: { contentType: 'text', content: input.description } } : {}), ...(input.location ? { location: { displayName: input.location } } : {}),
    ...(teams ? { isOnlineMeeting: true, onlineMeetingProvider: teams } : {}),
    start: { dateTime: input.startAt.replace(/Z$/, ''), timeZone: 'UTC' }, end: { dateTime: input.endAt.replace(/Z$/, ''), timeZone: 'UTC' },
  };
  if (target.provider === 'google') url.searchParams.set('sendUpdates', 'none');
  if (meet) url.searchParams.set('conferenceDataVersion', '1');
  const validate = (data: any) => {
    const result = event(data, target.provider);
    if (result.cancelled || result.reference !== input.reference || result.startAt !== input.startAt || result.endAt !== input.endAt || (target.provider === 'google' && result.id !== `k${digest(input.reference).slice(0, 40)}`) || options.quiet && (result.hasAttendees || result.recurring)) throw new BookingError(502, 'booking_provider_response_invalid');
    return result;
  };
  const data = await request(store, authority, url.toString(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, false, beforeWrite,
    data => { options.recordValidated?.(validate(data)); }, () => options.recordAccepted?.());
  return validate(data);
}
export async function readBookingCalendarEvent(store: Store, authority: BookingAuthority, eventId: string): Promise<BookingRemoteEvent | null> {
  const target = endpoint(store, authority);
  try {
    const result = event(await request(store, authority, `${target.url}/events/${encodeURIComponent(resource(eventId))}`), target.provider);
    if (result.id !== eventId) throw new BookingError(502, 'booking_provider_response_invalid');
    return result;
  }
  catch (error) { if (error instanceof OAuthError && error.upstreamStatus === 404) return null; throw error; }
}
export async function cancelBookingCalendarEvent(store: Store, authority: BookingAuthority, eventId: string, beforeWrite: () => void, options: { etag?: string; recordAccepted?: () => void } = {}) {
  await requireCalendarWriter(store, authority);
  const target = endpoint(store, authority); const url = new URL(`${target.url}/events/${encodeURIComponent(resource(eventId))}`);
  const conditional = authority.kind === 'grant' && authority.purpose === 'operator_cancel';
  if (conditional && !(target.provider === 'microsoft' ? validMicrosoftBookingEtag(options.etag) : target.provider === 'google' && typeof options.etag === 'string' && /^"[^"\r\n]{1,1000}"$/.test(options.etag))) throw new BookingError(409, 'booking_remote_changed');
  if (target.provider === 'google') url.searchParams.set('sendUpdates', 'none');
  const microsoftPrivate = conditional && target.provider === 'microsoft';
  await request(store, authority, url.toString(), { method: 'DELETE', ...(conditional ? { headers: { 'If-Match': options.etag! } } : {}) }, true, beforeWrite,
    microsoftPrivate ? undefined : options.recordAccepted, microsoftPrivate ? () => options.recordAccepted?.() : undefined);
}

/** Google documents conditional PATCH with If-Match/412. Graph event-update does not promise it. */
export async function rescheduleBookingCalendarEvent(store: Store, authority: BookingAuthority, previous: BookingRemoteEvent, input: { startAt: string; endAt: string }, beforeWrite: () => void, options: { recordAccepted?: () => void } = {}) {
  if (authority.kind !== 'grant' || !['reschedule', 'operator_reschedule'].includes(authority.purpose)) throw new BookingError(403, 'booking_grant_required');
  const target = endpoint(store, authority);
  if (target.provider !== 'google') throw new BookingError(409, 'booking_reschedule_unsupported');
  if (previous.cancelled || previous.hasAttendees || previous.recurring || !previous.reference || !previous.etag || !/^"[^"\r\n]{1,1000}"$/.test(previous.etag)) throw new BookingError(409, 'booking_remote_changed');
  await requireCalendarWriter(store, authority);
  const url = new URL(`${target.url}/events/${encodeURIComponent(resource(previous.id))}`); url.searchParams.set('sendUpdates', 'none');
  let positiveStatus: number | undefined;
  const data = await request(store, authority, url.toString(), { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'If-Match': previous.etag }, body: JSON.stringify({ start: { dateTime: input.startAt }, end: { dateTime: input.endAt } }) }, false, beforeWrite, undefined,
    authority.purpose === 'operator_reschedule' ? status => { positiveStatus = status; options.recordAccepted?.(); } : undefined);
  if (authority.purpose === 'operator_reschedule' && positiveStatus !== 200) throw new BookingError(502, 'booking_provider_response_invalid');
  const result = event(data, target.provider);
  if (result.id !== previous.id || result.cancelled || result.reference !== previous.reference || result.startAt !== input.startAt || result.endAt !== input.endAt || !result.etag || !/^"[^"\r\n]{1,1000}"$/.test(result.etag) || result.etag === previous.etag || result.hasAttendees || result.recurring) throw new BookingError(502, 'booking_provider_response_invalid');
  return result;
}
