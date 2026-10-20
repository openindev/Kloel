import { createHash } from 'node:crypto';
import { metaCreds } from './meta-tenants.js';
import type { Entity, Store } from './store.js';

export function whatsappDigest(value: unknown): string {
  const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
export function whatsappChannelRevision(row: Entity): number {
  if (row.revision === undefined) return 0;
  if (!Number.isSafeInteger(row.revision) || Number(row.revision) < 0) throw new Error('invalid_channel_revision');
  return Number(row.revision);
}
export const whatsappChannelVersion = (row: Entity) => whatsappDigest({ schema: 'whatsapp-channel-v1', row, revision: whatsappChannelRevision(row) });
export function captureWhatsAppChannel(row: Entity, phoneNumberId: string) {
  return { channelId: row.id, tenantId: row.tenantId, revision: whatsappChannelRevision(row), version: whatsappChannelVersion(row), phoneNumberId };
}
/** Additional restriction on autonomous jobs, never an operator/session grant. */
export function whatsappJobChannelIssue(store: Store, job: Entity): 'channel_snapshot_missing' | 'channel_changed' | undefined {
  const s = job.channelSnapshot as Record<string, unknown> | undefined;
  if (!s || typeof s !== 'object' || Array.isArray(s) || s.channelId !== job.channelId || s.tenantId !== job.tenantId || !Number.isSafeInteger(s.revision) || Number(s.revision) < 0 || typeof s.version !== 'string' || !/^[a-f0-9]{64}$/.test(s.version) || typeof s.phoneNumberId !== 'string' || !s.phoneNumberId) return 'channel_snapshot_missing';
  const row = store.get(job.tenantId, 'channels', String(job.channelId));
  if (!row || row.type !== 'whatsapp' || row.provider !== 'meta' || row.enabled !== true || row.agentId !== job.agentId || (row.configuration as Record<string, unknown> | undefined)?.externalId !== s.phoneNumberId || metaCreds(job.tenantId)?.phoneId !== s.phoneNumberId) return 'channel_changed';
  try { if (whatsappChannelRevision(row) !== s.revision || whatsappChannelVersion(row) !== s.version) return 'channel_changed'; }
  catch { return 'channel_changed'; }
}
