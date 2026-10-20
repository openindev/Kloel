import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Store } from './store.js';

/**
 * "Indique um amigo": every organization has a stable referral code (UUID-shaped, as in the Fonio link
 * `/register?ref=<uuid>`), derived from its id so it needs no storage and never changes.
 * A signup that carries a valid code is recorded in both organizations; rewards are handled by billing.
 */
export const REFERRAL_PUBLIC_PATH = /^\/api\/v1\/public\/referrals\/[0-9a-f-]{36}$/;
const codeSchema = z.string().trim().toLowerCase().uuid();

export function referralCodeFor(tenantId: string): string {
  const hex = createHash('sha256').update(`kloel-referral:${tenantId}`).digest('hex');
  const variant = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function resolveReferralCode(store: Store, code: unknown): { tenantId: string; name: string } | undefined {
  const parsed = codeSchema.safeParse(code);
  if (!parsed.success) return undefined;
  const rows = store.db.prepare("SELECT id,name FROM organizations WHERE status='active'").all() as { id: string; name: string }[];
  const row = rows.find(org => referralCodeFor(String(org.id)) === parsed.data);
  return row ? { tenantId: String(row.id), name: String(row.name) } : undefined;
}

/** Records the referral once per referred organization. A missing or self-referencing code is ignored. */
export function recordReferralSignup(store: Store, code: unknown, referred: { tenantId: string; organization: string }) {
  const referrer = resolveReferralCode(store, code);
  if (!referrer || referrer.tenantId === referred.tenantId) return undefined;
  if (store.list(referred.tenantId, 'referred-by').length) return undefined;
  const at = new Date().toISOString();
  return store.transaction(() => {
    store.create(referrer.tenantId, 'referral-signups', { code: referralCodeFor(referrer.tenantId), referredTenantId: referred.tenantId, referredOrganization: referred.organization.slice(0, 120), status: 'signed_up', rewardStatus: 'pending_first_paid_month', signedUpAt: at });
    return store.create(referred.tenantId, 'referred-by', { code: referralCodeFor(referrer.tenantId), referrerTenantId: referrer.tenantId, referrerName: referrer.name, benefit: { percentOff: 50, months: 2 }, benefitStatus: 'pending_first_subscription', createdAt: at });
  });
}

export async function registerReferralCodes(app: FastifyInstance, store: Store) {
  // Authenticated: the code and the referrals of the current organization.
  app.get('/api/v1/referrals/code', async request => {
    const tenantId = request.actor.tenantId;
    const signups = store.list(tenantId, 'referral-signups').map(row => ({ referredOrganization: row.referredOrganization, status: row.status, rewardStatus: row.rewardStatus, signedUpAt: row.signedUpAt }));
    return { code: referralCodeFor(tenantId), path: `/register?ref=${referralCodeFor(tenantId)}`, signups };
  });
  // Public: confirms a shared code without revealing anything beyond the referring organization's name.
  app.get('/api/v1/public/referrals/:code', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async request => {
    const referrer = resolveReferralCode(store, (request.params as { code?: string }).code);
    return referrer ? { valid: true, referrerName: referrer.name, benefit: { percentOff: 50, months: 2 } } : { valid: false };
  });
}
