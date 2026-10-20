import { z } from 'zod';
import type { Store } from '../store.js';
import { BookingError } from './authority.js';
import type { PublicBookingService } from './service.js';
import { eventTypeConfigFromRecord } from '../scheduling/service.js';

/** Project only pages whose current public grant can still authorize availability. */
export function publicBookingCompany(store: Store, service: PublicBookingService, input: unknown) {
  const { orgSlug, page, limit } = z.object({ orgSlug: z.string().regex(/^o-[a-f0-9]{24}$/), page: z.coerce.number().int().min(1).max(100000).default(1), limit: z.coerce.number().int().min(1).max(100).default(100) }).strict().parse(input);
  const rows = store.db.prepare("SELECT tenant_id,id FROM entities WHERE collection='booking-pages' AND json_extract(body,'$.publicOrgSlug')=? AND json_extract(body,'$.publicationStatus')='published'").all(orgSlug);
  if (!rows.length || new Set(rows.map(row => String(row.tenant_id))).size !== 1) throw new BookingError(404, 'booking_page_unavailable');
  const tenantId = String(rows[0].tenant_id);
  const available = rows.flatMap(row => {
    const target = { tenantId, pageId: String(row.id) };
    try {
      const view = service.page(target), record = store.get(tenantId, 'booking-pages', target.pageId)!;
      const config = eventTypeConfigFromRecord(record);
      return [{ target, createdAt: record.createdAt, view: { ...view, horizonDays: config.horizonDays, minimumNoticeMinutes: config.minimumNoticeMinutes } }];
    } catch (error) {
      if (error instanceof BookingError) return [];
      throw error;
    }
  }).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.view.eventSlug.localeCompare(b.view.eventSlug));
  if (!available.length) throw new BookingError(404, 'booking_page_unavailable');
  const organization = store.db.prepare('SELECT name FROM organizations WHERE id=? AND status=?').get(tenantId, 'active');
  if (!organization || typeof organization.name !== 'string') throw new BookingError(404, 'booking_page_unavailable');
  const settings = store.list(tenantId, 'organization-settings')[0];
  const name = typeof settings?.name === 'string' ? settings.name : organization.name;
  return { target: available[0].target, body: { orgSlug, name, items: available.slice((page - 1) * limit, page * limit).map(row => row.view), page, limit, total: available.length, totalPages: Math.ceil(available.length / limit) } };
}
