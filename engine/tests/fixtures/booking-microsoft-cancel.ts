import type { TestContext } from 'node:test';
import { bookingOperatorFixture, type BookingProviderRequest } from './booking-operator.js';
import { bookingCancelOperations } from '../../src/public-booking/operator-cancel.js';

/** Real Fastify/Store, synthetic Graph only. Never falls back to network. */
export async function bookingMicrosoftCancelFixture(t: TestContext) {
  const f = await bookingOperatorFixture(t, 'microsoft');
  const id = String(f.record().remoteEventId), remote = f.events.get(id);
  delete remote.etag;
  Object.assign(remote, { '@odata.etag': 'W/"graph-version-1"', type: 'singleInstance', recurrence: null, isOrganizer: true, isAllDay: false, isCancelled: false });
  const control = { moved: false, hook: undefined as undefined | ((r: BookingProviderRequest) => Response | undefined | Promise<Response | undefined>) };
  f.hooks.provider = async r => {
    const response = await control.hook?.(r); if (response) return response;
    if (r.method === 'GET' && control.moved && r.url.pathname.includes('/calendars/') && r.url.pathname.endsWith(`/events/${id}`)) return Response.json({}, { status: 404 });
    if (r.method === 'DELETE') {
      if (r.headers.get('if-match') !== f.events.get(id)?.['@odata.etag']) return Response.json({}, { status: 412 });
      f.events.delete(id); return new Response(null, { status: 204 });
    }
  };
  return { ...f, id, remote, control, journal: () => f.store.list(f.actor.tenantId, bookingCancelOperations) };
}
