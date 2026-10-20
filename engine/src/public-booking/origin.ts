import { BookingError } from './authority.js';

/** The public link and the visitor origin check use the same validated origin. */
export function publicBookingBaseUrl(): string {
  let configured: URL;
  try { configured = new URL(process.env.PUBLIC_BASE_URL || 'http://127.0.0.1:4310'); }
  catch { throw new BookingError(503, 'booking_not_configured'); }
  if (configured.username || configured.password || configured.pathname !== '/' || configured.search || configured.hash || (configured.protocol !== 'https:' && !(configured.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(configured.hostname)))) throw new BookingError(503, 'booking_not_configured');
  return configured.origin;
}
