import { z } from 'zod';
import type { Entity } from '../store.js';
import { digest } from '../oauth/crypto.js';
import { BookingError } from './authority.js';

export function bookingCalendarPolicy(calendar: Entity): string {
  return digest(JSON.stringify([calendar.timezone, calendar.availability ?? [], calendar.bufferMinutes ?? 0]));
}
export function bookingEffectiveBuffer(calendar: Entity, pageBuffer: number): number {
  return Math.max(z.number().int().min(0).max(240).parse(calendar.bufferMinutes ?? 0), pageBuffer);
}
/** Calendar policy only: no event-type grid, notice or duration is imposed here. */
export function validateCalendarBookingWindow(calendar: Entity, window: { startAt: string; endAt: string }, pageBuffer: number) {
  const buffer = bookingEffectiveBuffer(calendar, pageBuffer) * 60000;
  const start = Date.parse(window.startAt), end = Date.parse(window.endAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 24 * 3600000 || start % 60000 || end % 60000) throw new BookingError(400, 'booking_window_invalid');
  const periods = z.array(z.object({ weekday: z.number().int().min(0).max(6), start: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/), end: z.string().regex(/^(?:(?:[01]\d|2[0-3]):[0-5]\d|24:00)$/) })).parse(calendar.availability ?? []);
  const bufferStartAt = new Date(start - buffer).toISOString(), bufferEndAt = new Date(end + buffer).toISOString();
  if (!periods.length) return { bufferStartAt, bufferEndAt };
  let format: Intl.DateTimeFormat;
  try { format = new Intl.DateTimeFormat('en-GB', { timeZone: String(calendar.timezone), weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }); }
  catch { throw new BookingError(409, 'booking_calendar_policy_invalid'); }
  const minutes = (value: string) => { const [h, m] = value.split(':').map(Number); return h * 60 + m; };
  for (let at = start - buffer; at < end + buffer; at += 60000) {
    const p = Object.fromEntries(format.formatToParts(at).map(part => [part.type, part.value])); const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday); const minute = Number(p.hour) * 60 + Number(p.minute);
    if (!periods.some(period => period.weekday === weekday && minute >= minutes(period.start) && minute < minutes(period.end))) throw new BookingError(409, 'booking_outside_calendar_schedule');
  }
  return { bufferStartAt, bufferEndAt };
}
