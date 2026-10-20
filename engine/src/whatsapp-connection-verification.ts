import { metaCreds } from './meta-tenants.js';
/** Read-only provider metadata; never a webhook/delivery/send attestation. */
export class MetaVerificationError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}
const fail = (status: number, code: string): never => { throw new MetaVerificationError(status, code); };
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === 'string' && /^\d{1,40}$/.test(v);
const scopes = ['whatsapp_business_management', 'whatsapp_business_messaging', 'business_management'] as const;
export type MetaVerificationConfig = Readonly<{ tenantId: string; appId: string; wabaId: string; phoneId: string; graphVersion: string; accessToken: string }>;
export function metaVerificationConfig(tenantId: string, phoneId: unknown): MetaVerificationConfig {
  const mc = metaCreds(tenantId);
  if (!mc) return fail(403, 'meta_tenant_not_bound');
  const c = { tenantId, appId: process.env.META_APP_ID?.trim(), wabaId: mc.wabaId, phoneId: mc.phoneId, graphVersion: mc.version, accessToken: mc.token };
  if (!id(c.appId) || !id(c.wabaId) || !id(c.phoneId) || !/^v\d{1,3}\.\d{1,2}$/.test(c.graphVersion ?? '') || !c.accessToken || c.accessToken.length > 8192 || !/^[A-Za-z0-9._~+\/-]+={0,2}$/.test(c.accessToken)) return fail(409, 'meta_verification_not_configured');
  if (phoneId !== c.phoneId) return fail(409, 'meta_phone_configuration_mismatch');
  return Object.freeze(c as MetaVerificationConfig);
}
export async function verifyMetaConnection(config: MetaVerificationConfig, assertAccess: () => void) {
  const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 15_000);
  const maxBytes = 256_000;
  async function get(path: string, query: Record<string, string>) {
    assertAccess(); if (abort.signal.aborted) return fail(504, 'meta_verification_timeout');
    const url = new URL(`/${config.graphVersion}/${path}`, 'https://graph.facebook.com');
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    let response: Response;
    try { response = await fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${config.accessToken}`, Accept: 'application/json' }, redirect: 'error', signal: abort.signal }); }
    catch { assertAccess(); return fail(abort.signal.aborted ? 504 : 502, abort.signal.aborted ? 'meta_verification_timeout' : 'meta_verification_unavailable'); }
    finally { url.searchParams.delete('input_token'); }
    try { assertAccess(); } catch (error) { try { await response.body?.cancel(); } catch {} throw error; }
    if (!response.ok) { try { await response.body?.cancel(); } catch {} return fail(response.status === 429 ? 503 : 502, response.status === 429 ? 'meta_rate_limited' : 'meta_provider_rejected'); }
    const size = response.headers.get('content-length');
    if (!response.body || size !== null && (!/^\d+$/.test(size) || Number(size) > maxBytes) || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) { try { await response.body?.cancel(); } catch {} return fail(502, 'meta_invalid_response'); }
    const reader = response.body.getReader(), parts: Uint8Array[] = []; let bytes = 0;
    try {
      while (true) {
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try { chunk = await reader.read(); } catch { assertAccess(); return fail(abort.signal.aborted ? 504 : 502, abort.signal.aborted ? 'meta_verification_timeout' : 'meta_invalid_response'); }
        assertAccess(); if (abort.signal.aborted) return fail(504, 'meta_verification_timeout');
        if (chunk.done) break;
        bytes += chunk.value.byteLength; if (bytes > maxBytes) return fail(502, 'meta_response_limit'); parts.push(chunk.value);
      }
      let result: unknown;
      try { result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts))); } catch { return fail(502, 'meta_invalid_response'); }
      if (!object(result) || result.error) return fail(502, 'meta_invalid_response');
      return result;
    } finally { try { await reader.cancel(); } catch {} reader.releaseLock(); }
  }
  function expiry(value: unknown): number | null {
    if (value === undefined || value === null) return null;
    if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 253402300799) return fail(502, 'meta_invalid_response');
    if (value !== 0 && Number(value) * 1000 <= Date.now()) return fail(422, 'meta_token_expired');
    return Number(value);
  }
  const enumValue = (value: unknown, allowed: string[]): string | null => typeof value === 'string' && allowed.includes(value) ? value : null;
  try {
    const debug = (await get('debug_token', { input_token: config.accessToken })).data;
    if (!object(debug) || typeof debug.is_valid !== 'boolean' || !id(debug.app_id) || !Array.isArray(debug.scopes) || debug.scopes.length > 100 || debug.scopes.some((s: unknown) => typeof s !== 'string' || !/^[a-z][a-z0-9_]{0,99}$/.test(s))) return fail(502, 'meta_invalid_response');
    if (!debug.is_valid) return fail(422, 'meta_token_invalid');
    if (debug.app_id !== config.appId) return fail(422, 'meta_app_mismatch');
    const expiresAt = expiry(debug.expires_at), dataAccessExpiresAt = expiry(debug.data_access_expires_at);
    if (!debug.scopes.includes('whatsapp_business_management')) return fail(422, 'meta_management_scope_missing');
    const list = await get(`${config.wabaId}/phone_numbers`, { fields: 'id', limit: '100' });
    if (!Array.isArray(list.data) || list.data.length > 100 || list.data.some((row: unknown) => !object(row) || !id(row.id)) || new Set(list.data.map((row: any) => row.id)).size !== list.data.length) return fail(502, 'meta_invalid_response');
    if (!list.data.some((row: any) => row.id === config.phoneId)) return fail(422, list.paging?.next ? 'meta_phone_listing_incomplete' : 'meta_phone_not_in_waba');
    const phone = await get(config.phoneId, { fields: 'id,status,quality_rating,code_verification_status,name_status,account_mode' });
    if (phone.id !== config.phoneId) return fail(502, 'meta_phone_response_mismatch');
    assertAccess(); expiry(expiresAt); expiry(dataAccessExpiresAt);
    return { checkedAt: new Date().toISOString(), status: 'metadata_verified' as const, appId: config.appId, wabaId: config.wabaId, phoneId: config.phoneId,
      token: { valid: true, expiresAt, dataAccessExpiresAt, scopes: scopes.filter(s => debug.scopes.includes(s)) },
      phone: { status: enumValue(phone.status, ['CONNECTED','DISCONNECTED','PENDING','FLAGGED','RESTRICTED','RATE_LIMITED','MIGRATED','BANNED','DELETED','UNVERIFIED','LINKED','UNKNOWN']), qualityRating: enumValue(phone.quality_rating, ['GREEN','YELLOW','RED','NA','UNKNOWN']), codeVerificationStatus: enumValue(phone.code_verification_status, ['VERIFIED','UNVERIFIED','NOT_VERIFIED','EXPIRED']), nameStatus: enumValue(phone.name_status, ['APPROVED','AVAILABLE_WITHOUT_REVIEW','DECLINED','EXPIRED','PENDING_REVIEW','NONE']), accountMode: enumValue(phone.account_mode, ['LIVE','SANDBOX']) },
      proof: { webhookDelivery: false, messageSending: false } };
  } finally { clearTimeout(timer); abort.abort(); }
}
