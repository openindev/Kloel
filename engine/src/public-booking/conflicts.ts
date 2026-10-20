import type { Entity, Store } from '../store.js';
import { oauthRequest } from '../oauth/access.js';
import { eventTypeConfigFromRecord } from '../scheduling/service.js';
import { BookingError } from './authority.js';

export type BusyInterval = { startAt: string; endAt: string };
const stamp = (value: unknown) => {
  if (typeof value !== 'string') throw new BookingError(502, 'booking_provider_response_invalid');
  const text = /(Z|[+-]\d\d:\d\d)$/.test(value) ? value : `${value}Z`, parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) throw new BookingError(502, 'booking_provider_response_invalid');
  return new Date(parsed).toISOString();
};

/**
 * "Verificar conflitos": compromissos dos calendários adicionais escolhidos no tipo de evento também bloqueiam
 * horários. Só leitura de ocupado/livre; uma falha impede oferecer horários (nunca trata ausência de leitura como livre).
 */
export async function conflictBusy(store: Store, tenantId: string, page: Entity, from: string, to: string): Promise<BusyInterval[]> {
  let ids: string[];
  try { ids = eventTypeConfigFromRecord(page).conflictCalendarIds; } catch { return []; }
  const busy: BusyInterval[] = [];
  for (const id of ids) {
    const calendar = store.get(tenantId, 'calendars', id);
    const connection = calendar && store.get(tenantId, 'oauth-connections', String(calendar.connectionId));
    if (!calendar || calendar.enabled === false || !connection || connection.status !== 'connected' || connection.provider !== calendar.provider || typeof calendar.externalCalendarId !== 'string' || !calendar.externalCalendarId) throw new BookingError(503, 'booking_conflict_calendar_unavailable');
    if (connection.provider === 'google') {
      const data = await oauthRequest(store, connection, 'https://www.googleapis.com/calendar/v3/freeBusy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ timeMin: from, timeMax: to, items: [{ id: calendar.externalCalendarId }] }) });
      const entry = data.calendars?.[calendar.externalCalendarId];
      if (!entry || Array.isArray(entry.errors) && entry.errors.length || !Array.isArray(entry.busy)) throw new BookingError(503, 'booking_conflict_calendar_unavailable');
      for (const b of entry.busy) busy.push({ startAt: stamp(b?.start), endAt: stamp(b?.end) });
    } else if (connection.provider === 'microsoft') {
      const base = calendar.externalCalendarId === 'primary' ? 'https://graph.microsoft.com/v1.0/me/calendar/calendarView' : `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(calendar.externalCalendarId)}/calendarView`;
      const url = new URL(base); url.searchParams.set('startDateTime', from); url.searchParams.set('endDateTime', to); url.searchParams.set('$top', '500'); url.searchParams.set('$select', 'start,end,showAs,isCancelled');
      const data = await oauthRequest(store, connection, url.toString(), { headers: { Prefer: 'outlook.timezone="UTC"' } });
      if (!Array.isArray(data.value) || data['@odata.nextLink']) throw new BookingError(503, 'booking_conflict_calendar_unavailable');
      for (const e of data.value) if (!e?.isCancelled && e?.showAs !== 'free') busy.push({ startAt: stamp(e?.start?.dateTime), endAt: stamp(e?.end?.dateTime) });
    } else throw new BookingError(503, 'booking_conflict_calendar_unavailable');
  }
  return busy;
}
