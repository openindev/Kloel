import type { FastifyInstance, FastifyRequest } from 'fastify';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Entity, Store } from './store.js';
import { seal, unseal } from './oauth/crypto.js';
import { resolveMembershipActor } from './memberships/service.js';
import { hasPermission } from './memberships/permissions.js';

/**
 * Multi-tenant Meta (WhatsApp Cloud API) credentials.
 * - Main tenant (PROVIDER_TENANT_ID) keeps using the server env (Kloel's own number).
 * - Customer orgs connect via WhatsApp Embedded Signup; their business token is stored sealed (AES-256-GCM, AAD bound to tenant+connection).
 * - Inbound webhooks are routed by phone_number_id to the owning tenant.
 */
export type MetaCreds = { tenantId: string; phoneId: string; token: string; wabaId: string; version: string; main: boolean };
type Conn = { tenantId: string; id: string; phoneId: string; wabaId: string; sealed: string };
const byTenant = new Map<string, Conn>(), byPhone = new Map<string, Conn>();
const COLLECTION = 'whatsapp-connections';
const ctx = (tenant: string, id: string) => `meta-whatsapp:${tenant}:${id}`;
const version = () => process.env.META_GRAPH_VERSION?.trim() || 'v21.0';

function mainCreds(): MetaCreds | undefined {
  // Main tenant keeps the legacy env binding semantics: bound by PROVIDER_TENANT_ID alone; missing phone/token surface as "not configured" downstream.
  const tenantId = process.env.PROVIDER_TENANT_ID?.trim(), phoneId = process.env.META_PHONE_NUMBER_ID?.trim() ?? '', token = process.env.META_ACCESS_TOKEN?.trim() ?? '';
  if (!tenantId) return;
  return { tenantId, phoneId, token, wabaId: process.env.META_WABA_ID?.trim() ?? '', version: version(), main: true };
}
function index(row: Entity) {
  const c: Conn = { tenantId: row.tenantId, id: row.id, phoneId: String(row.phoneNumberId), wabaId: String(row.wabaId), sealed: String(row.tokenSealed) };
  byTenant.set(c.tenantId, c); byPhone.set(c.phoneId, c);
}
export function loadMetaConnections(store: Store) {
  byTenant.clear(); byPhone.clear();
  const rows = store.db.prepare(`SELECT tenant_id, id FROM entities WHERE collection=? AND json_extract(body,'$.status') IN ('connected','needs_attention')`).all(COLLECTION) as { tenant_id: string; id: string }[];
  for (const r of rows) { const row = store.get(r.tenant_id, COLLECTION, r.id); if (row && row.tokenSealed && row.phoneNumberId) index(row); }
  console.log('meta_connections_loaded', byTenant.size);
}
/** Credentials for the tenant (env for the main tenant, sealed connection for customer orgs). */
export function metaCreds(tenant: string | undefined): MetaCreds | undefined {
  if (!tenant) return;
  const m = mainCreds(); if (m && m.tenantId === tenant) return m;
  const c = byTenant.get(tenant); if (!c) return;
  try { const token = unseal<string>(c.sealed, ctx(c.tenantId, c.id)); return { tenantId: c.tenantId, phoneId: c.phoneId, token, wabaId: c.wabaId, version: version(), main: false }; }
  catch { return; }
}
export const metaTenantBound = (tenant: string | undefined) => !!metaCreds(tenant);
export function metaTenantForPhone(phoneId: unknown): string | undefined {
  if (typeof phoneId !== 'string' || !phoneId) return;
  const m = mainCreds(); if (m && m.phoneId && m.phoneId === phoneId) return m.tenantId;
  return byPhone.get(phoneId)?.tenantId;
}
export function metaBoundTenants(): string[] {
  const out = new Set<string>(); const m = mainCreds(); if (m) out.add(m.tenantId); for (const t of byTenant.keys()) out.add(t); return [...out];
}
/** Digest-friendly config fingerprint for a tenant (never includes the raw token). */
export function metaConfigFingerprint(tenant: string | undefined): string[] {
  const c = metaCreds(tenant); return c ? [c.tenantId, c.phoneId, c.wabaId, c.version, String(c.token.length), c.token.slice(-6)] : ['unbound'];
}

class Fault extends Error { constructor(readonly status: number, readonly code: string, message = code) { super(message); } }
async function graph(path: string, init: RequestInit & { token?: string; query?: Record<string, string> } = {}): Promise<any> {
  const url = new URL(`https://graph.facebook.com/${version()}/${path}`);
  for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);
  const headers: Record<string, string> = { ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}), ...(init.body ? { 'content-type': 'application/json' } : {}) };
  let r: Response;
  try { r = await fetch(url, { method: init.method ?? 'GET', headers, body: init.body, signal: AbortSignal.timeout(20000), redirect: 'error' }); }
  catch { throw new Fault(502, 'meta_unreachable', 'A Meta não respondeu.'); }
  const data = await r.json().catch(() => ({})) as any;
  if (!r.ok) { const e = data?.error ?? {}; console.log('meta_embedded_graph_error', path.split('?')[0].replace(/\d{5,}/g, '<id>'), r.status, e.code, e.error_subcode); throw new Fault(r.status === 400 ? 400 : 502, 'meta_rejected', String(e.error_user_msg || e.message || 'A Meta recusou a operação.').slice(0, 300)); }
  return data;
}

function actor(store: Store, req: FastifyRequest) {
  const a = req.actor; if (!a) throw new Fault(401, 'unauthorized', 'Autenticação obrigatória.');
  const current = resolveMembershipActor(store, a.userId, a.tenantId);
  if (!current || !hasPermission(current.role, 'integrations:manage')) throw new Fault(403, 'forbidden', 'Você não tem permissão para conectar o WhatsApp.');
  return a.tenantId;
}
function project(row: Entity | undefined, tenant: string) {
  const m = mainCreds();
  if (m && m.tenantId === tenant) return { connected: true, kind: 'kloel_official', phoneNumberId: m.phoneId, wabaId: m.wabaId, displayPhoneNumber: process.env.WHATSAPP_NUMBER ? `+${process.env.WHATSAPP_NUMBER}` : null, verifiedName: 'Kloel' };
  if (!row) return { connected: false };
  return { connected: row.status === 'connected', needsAttention: row.status === 'needs_attention', kind: 'embedded_signup', id: row.id, status: row.status, phoneNumberId: row.phoneNumberId, wabaId: row.wabaId, displayPhoneNumber: row.displayPhoneNumber ?? null, verifiedName: row.verifiedName ?? null, qualityRating: row.qualityRating ?? null, registered: row.registered === true, subscribed: row.subscribed === true, connectedAt: row.connectedAt ?? null, lastError: row.lastError ?? null };
}
function ensureChannel(store: Store, tenant: string, phoneId: string, display: string | null) {
  const agents = store.list(tenant, 'agents').filter(a => a.status === 'active');
  const existing = store.list(tenant, 'channels').find(c => c.type === 'whatsapp' && (c.configuration as any)?.externalId === phoneId);
  const data = { type: 'whatsapp', provider: 'meta', name: 'WhatsApp Business', enabled: agents.length > 0, ...(agents[0] ? { agentId: agents[0].id } : {}), configuration: { externalId: phoneId, address: display } };
  if (existing) store.update(tenant, 'channels', existing.id, { provider: 'meta', configuration: data.configuration, ...(existing.agentId ? {} : data.agentId ? { agentId: data.agentId, enabled: true } : {}) });
  else store.create(tenant, 'channels', data);
}

const completeSchema = z.object({ code: z.string().min(10).max(2000), wabaId: z.string().regex(/^\d{5,40}$/).optional(), phoneNumberId: z.string().regex(/^\d{5,40}$/).optional(), pin: z.string().regex(/^\d{6}$/).optional() }).strict();

export function registerMetaEmbeddedSignup(app: FastifyInstance, store: Store) {
  loadMetaConnections(store);
  const send = (reply: any, fn: () => Promise<unknown> | unknown) => Promise.resolve().then(fn).catch((e: any) => {
    if (e instanceof Fault) return reply.code(e.status).send({ error: { code: e.code, message: e.message } });
    if (e instanceof z.ZodError) return reply.code(400).send({ error: { code: 'invalid_input', message: 'Dados inválidos.' } });
    console.error('meta_embedded_failed', e?.message); return reply.code(500).send({ error: { code: 'internal_error', message: 'Falha ao conectar o WhatsApp.' } });
  });
  const P = '/api/v1/whatsapp/embedded-signup';

  app.get(`${P}/config`, (req, reply) => send(reply, () => {
    actor(store, req);
    const appId = process.env.META_APP_ID?.trim(), configId = process.env.META_ES_CONFIG_ID?.trim();
    return { appId: appId ?? null, configId: configId ?? null, featureType: process.env.META_ES_FEATURE_TYPE?.trim() || null, graphVersion: version(), ready: !!(appId && configId && process.env.META_APP_SECRET?.trim() && process.env.OAUTH_ENCRYPTION_KEY) };
  }));

  app.get(`${P}/status`, (req, reply) => send(reply, () => {
    const tenant = actor(store, req);
    const row = store.list(tenant, COLLECTION).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
    return project(row, tenant);
  }));

  app.post(`${P}/complete`, (req, reply) => send(reply, async () => {
    const tenant = actor(store, req), b = completeSchema.parse(req.body);
    const m = mainCreds(); if (m && m.tenantId === tenant) throw new Fault(409, 'kloel_official_tenant', 'Esta organização já usa o número oficial da Kloel.');
    const appId = process.env.META_APP_ID?.trim(), secret = process.env.META_APP_SECRET?.trim();
    if (!appId || !secret) throw new Fault(503, 'meta_not_configured', 'Integração Meta não configurada no servidor.');
    // 1) code -> business integration system user token (server-side only; never returned).
    const tok = await graph('oauth/access_token', { query: { client_id: appId, client_secret: secret, code: b.code } });
    const token = String(tok.access_token ?? ''); if (!token) throw new Fault(502, 'meta_no_token', 'A Meta não devolveu o token.');
    // 2) Resolve WABA (from the session-info event or from the token's granular scopes).
    let wabaId = b.wabaId;
    if (!wabaId) {
      const dbg = await graph('debug_token', { token: `${appId}|${secret}`, query: { input_token: token } });
      const scopes: any[] = dbg?.data?.granular_scopes ?? [];
      wabaId = scopes.find(s => s.scope === 'whatsapp_business_management')?.target_ids?.[0];
    }
    if (!wabaId) throw new Fault(400, 'meta_no_waba', 'Nenhuma conta do WhatsApp Business foi compartilhada.');
    const taken = store.db.prepare(`SELECT tenant_id FROM entities WHERE collection=? AND json_extract(body,'$.wabaId')=? AND json_extract(body,'$.status')='connected' AND tenant_id!=? LIMIT 1`).get(COLLECTION, wabaId, tenant);
    if (taken) throw new Fault(409, 'waba_in_use', 'Esta conta do WhatsApp Business já está conectada a outra organização.');
    // 3) Phone number.
    const phones = await graph(`${wabaId}/phone_numbers`, { token, query: { fields: 'id,display_phone_number,verified_name,quality_rating,code_verification_status,status' } });
    const list: any[] = phones?.data ?? [];
    const phone = (b.phoneNumberId ? list.find(p => p.id === b.phoneNumberId) : list[0]);
    if (!phone) throw new Fault(400, 'meta_no_phone', 'Nenhum número encontrado nesta conta do WhatsApp Business.');
    if (metaTenantForPhone(phone.id) && metaTenantForPhone(phone.id) !== tenant) throw new Fault(409, 'phone_in_use', 'Este número já está conectado a outra organização.');
    const row = store.create(tenant, COLLECTION, { status: 'connecting', wabaId, phoneNumberId: phone.id, displayPhoneNumber: phone.display_phone_number ?? null, verifiedName: phone.verified_name ?? null, qualityRating: phone.quality_rating ?? null, connectedBy: req.actor?.userId });
    const sealed = seal(token, ctx(tenant, row.id));
    store.update(tenant, COLLECTION, row.id, { tokenSealed: sealed });
    let subscribed = false, registered = false, lastError: string | null = null;
    // 4) Subscribe our app to the WABA webhooks.
    try { await graph(`${wabaId}/subscribed_apps`, { method: 'POST', token }); subscribed = true; } catch (e: any) { lastError = `subscribe: ${e.message}`; }
    // 5) Register the number for Cloud API with a 2-step PIN.
    const pin = b.pin ?? String(100000 + (randomBytes(4).readUInt32BE() % 900000));
    try { await graph(`${phone.id}/register`, { method: 'POST', token, body: JSON.stringify({ messaging_product: 'whatsapp', pin }) }); registered = true; }
    catch (e: any) { lastError = (lastError ? lastError + '; ' : '') + `register: ${e.message}`; }
    const status = !subscribed ? 'error' : registered ? 'connected' : 'needs_attention';
    // Supersede previous connections of this tenant.
    for (const old of store.list(tenant, COLLECTION)) if (old.id !== row.id && ['connected', 'needs_attention'].includes(String(old.status))) store.update(tenant, COLLECTION, old.id, { status: 'replaced', tokenSealed: null });
    const updated = store.update(tenant, COLLECTION, row.id, { status, subscribed, registered, pinSealed: seal(pin, ctx(tenant, row.id) + ':pin'), lastError, connectedAt: new Date().toISOString() })!;
    if (status !== 'error') { index(updated); ensureChannel(store, tenant, String(phone.id), phone.display_phone_number ? `+${String(phone.display_phone_number).replace(/\D/g, '')}` : null); }
    console.log('meta_embedded_connected', JSON.stringify({ tenant: tenant.slice(0, 8), status, subscribed, registered }));
    return project(updated, tenant);
  }));

  // Retry Cloud API registration (and webhook subscription) for a number left in needs_attention/error.
  app.post(`${P}/retry`, (req, reply) => send(reply, async () => {
    const tenant = actor(store, req), b = z.object({ pin: z.string().regex(/^\d{6}$/).optional() }).strict().parse(req.body ?? {});
    const row = store.list(tenant, COLLECTION).filter(r => ['needs_attention', 'error', 'connected'].includes(String(r.status)) && r.tokenSealed).sort((a, b2) => String(b2.createdAt).localeCompare(String(a.createdAt)))[0];
    if (!row) throw new Fault(404, 'not_found', 'Nenhuma conexão para tentar novamente.');
    const token = unseal<string>(String(row.tokenSealed), ctx(tenant, row.id));
    let subscribed = row.subscribed === true, registered = row.registered === true; const errors: string[] = [];
    if (!subscribed) { try { await graph(`${row.wabaId}/subscribed_apps`, { method: 'POST', token }); subscribed = true; } catch (e: any) { errors.push(`subscribe: ${e.message}`); } }
    let pin = b.pin; if (!pin && row.pinSealed) { try { pin = unseal<string>(String(row.pinSealed), ctx(tenant, row.id) + ':pin'); } catch { /* new pin */ } }
    pin ??= String(100000 + (randomBytes(4).readUInt32BE() % 900000));
    if (!registered) { try { await graph(`${row.phoneNumberId}/register`, { method: 'POST', token, body: JSON.stringify({ messaging_product: 'whatsapp', pin }) }); registered = true; } catch (e: any) { errors.push(`register: ${e.message}`); } }
    const status = !subscribed ? 'error' : registered ? 'connected' : 'needs_attention';
    const updated = store.update(tenant, COLLECTION, row.id, { status, subscribed, registered, lastError: errors.join('; ') || null, pinSealed: seal(pin, ctx(tenant, row.id) + ':pin'), retriedAt: new Date().toISOString() })!;
    if (status !== 'error') { index(updated); ensureChannel(store, tenant, String(row.phoneNumberId), row.displayPhoneNumber ? `+${String(row.displayPhoneNumber).replace(/\D/g, '')}` : null); }
    console.log('meta_embedded_retry', JSON.stringify({ tenant: tenant.slice(0, 8), status }));
    return project(updated, tenant);
  }));

  app.post(`${P}/disconnect`, (req, reply) => send(reply, async () => {
    const tenant = actor(store, req);
    const c = byTenant.get(tenant); if (!c) return { connected: false };
    const creds = metaCreds(tenant);
    if (creds) { try { await graph(`${c.wabaId}/subscribed_apps`, { method: 'DELETE', token: creds.token }); } catch { /* best effort */ } }
    store.update(tenant, COLLECTION, c.id, { status: 'disconnected', tokenSealed: null, disconnectedAt: new Date().toISOString() });
    byTenant.delete(tenant); byPhone.delete(c.phoneId);
    for (const ch of store.list(tenant, 'channels').filter(ch => ch.type === 'whatsapp' && (ch.configuration as any)?.externalId === c.phoneId)) store.update(tenant, 'channels', ch.id, { enabled: false });
    return { connected: false };
  }));
}
