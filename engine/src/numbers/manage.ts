/**
 * Numbers whose ownership Kloel itself recorded (Fonio parity for the row menu: "Alterar atribuição do assistente",
 * "Desassociar do Assistente", rename/edit, "Excluir número de telefone", plus "Criar número SIP" and "Importar número"):
 * - platform_purchase: bought through /numbers/purchase (receipt in number-purchase-operations);
 * - sip: created here, routed by its own LiveKit inbound trunk + dispatch rule;
 * - imported: an outbound caller ID verified by the Twilio call (caller-id-validations status verified).
 * Their link to an assistant is the row's agentId, which /internal/phone/number-route returns to the voice worker.
 * Legacy pilot rows (no `source`, Twilio ownership proof) keep the /phone-config path.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Entity, Store } from '../store.js';
import { requireRequestPermission } from '../memberships/access.js';
import { numberProviders, numberHttp, NumberProviderError, type NumberProviderName } from './providers.js';
import { releaseExtraNumber } from './addon.js';
import { sipBackend, type Termination } from './sip.js';

const collection = 'phone-numbers', audit = 'number-audit', sipOps = 'number-sip-operations';
export const MANAGED_SOURCES = ['platform_purchase', 'sip', 'imported'] as const;
export type ManagedSource = typeof MANAGED_SOURCES[number];
export class ManagedNumberError extends Error { constructor(readonly statusCode: number, readonly code: string, message: string) { super(message); } }
const fail = (status: number, code: string, message: string): never => { throw new ManagedNumberError(status, code, message); };
export const isManaged = (row: Entity | undefined): row is Entity => !!row && (MANAGED_SOURCES as readonly string[]).includes(String(row.source));

/** Routing key shared by number-route and the global uniqueness check: phone numbers by digits, SIP names case-insensitive. */
export function routeKey(value: unknown) {
  const raw = String(value ?? '').trim().replace(/^sips?:/i, '').replace(/@.*$/, '').replace(/;.*$/, ''), compact = raw.replace(/[\s().-]/g, '');
  if (!raw) return '';
  return /^\+?\d{4,15}$/.test(compact) ? `tel:${compact.replace(/^\+/, '')}` : `sip:${raw.toLowerCase()}`;
}
/** Every phone-numbers row of the platform with this routing key (any tenant). */
function holders(store: Store, number: unknown) {
  const key = routeKey(number); if (!key) return [];
  return (store.db.prepare("SELECT tenant_id AS tenant, body FROM entities WHERE collection=?").all(collection) as { tenant: string; body: string }[])
    .map(r => ({ tenant: r.tenant, row: JSON.parse(r.body) as Entity })).filter(r => routeKey(r.row.number) === key);
}

const idSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
const sipName = z.string().trim().min(4, 'O número / nome precisa ter pelo menos 4 caracteres.').max(64).regex(/^\+?[A-Za-z0-9][A-Za-z0-9._-]*$/, 'Use apenas letras, números e + . _ - (sem espaços).');
const terminationSchema = z.object({
  address: z.string().trim().transform(v => v.replace(/^sips?:/i, '').replace(/\/+$/, '')).pipe(z.string().min(3).max(253).regex(/^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?(?::\d{1,5})?$/, 'URL de terminação inválida (ex.: demo.pstn.twilio.com).')),
  username: z.string().trim().max(128).optional(), password: z.string().max(128).optional(),
}).strict();
const patchSchema = z.object({ name: z.string().trim().min(1).max(200).optional(), agentId: idSchema.nullable().optional(), termination: terminationSchema.nullable().optional() }).strict()
  .refine(v => v.name !== undefined || v.agentId !== undefined || v.termination !== undefined, 'Nada para alterar.');
const sipSchema = z.object({ number: sipName, name: z.string().trim().min(1).max(200).optional(), agentId: idSchema.nullable().optional(), termination: terminationSchema.nullable().optional(), idempotencyKey: z.string().uuid() }).strict();
const importedSchema = z.object({ phoneNumber: z.string().regex(/^\+[1-9]\d{7,14}$/), name: z.string().trim().min(1).max(200).optional(), agentId: idSchema.nullable().optional() }).strict();

function agentOrFail(store: Store, tenant: string, agentId: string | null | undefined) {
  if (agentId && !store.get(tenant, 'agents', agentId)) fail(404, 'agent_not_found', 'Assistente não encontrado.');
}
const terminationView = (t: Termination | null | undefined) => t ? { address: t.address, username: t.username?.trim() || null, hasPassword: !!t.password } : null;
/** Public projection (never trunk credentials). */
export function managedView(row: Entity) {
  const sip = row.sip as Record<string, any> | undefined;
  return { id: row.id, name: row.name, number: row.number, provider: row.provider, source: row.source, agentId: (row.agentId as string | null) ?? null, revision: row.revision ?? 0,
    sip: row.source === 'sip' && sip ? { uri: sip.uri ?? null, originationHost: sip.originationHost ?? null, termination: sip.termination ?? null } : null };
}
function record(store: Store, tenant: string, kind: string, row: Entity, actor: string, extra: Record<string, unknown> = {}) {
  store.create(tenant, audit, { kind, numberId: row.id, number: row.number, source: row.source, actorUserId: actor, ...extra });
}

/** Creates (once) the row of a verified imported caller ID. Called by the caller-ID verification and by POST /numbers/imported. */
export function ensureImportedNumber(store: Store, tenant: string, phoneNumber: string, callerIdSid: string | null, name?: string) {
  const existing = store.list(tenant, collection).find(n => routeKey(n.number) === routeKey(phoneNumber));
  if (existing) return existing.source === 'imported' && callerIdSid && existing.providerNumberId !== callerIdSid ? store.update(tenant, collection, existing.id, { providerNumberId: callerIdSid })! : existing;
  return store.create(tenant, collection, { name: (name?.trim() || phoneNumber).slice(0, 200), number: phoneNumber, provider: 'twilio', providerNumberId: callerIdSid, agentId: null, channelId: null,
    capabilities: ['voice'], provisioningStatus: 'unverified', revision: 1, source: 'imported', ownership: { source: 'twilio', checkedAt: new Date().toISOString(), scope: 'registration' }, importedAt: new Date().toISOString() });
}

export async function updateManagedNumber(store: Store, tenant: string, id: string, input: z.infer<typeof patchSchema>, actor: string) {
  const row = store.get(tenant, collection, id); if (!row) return fail(404, 'number_not_found', 'Número não encontrado.');
  if (!isManaged(row)) return fail(409, 'number_not_managed', 'Este número é do cadastro da conta de telefonia e é editado pelo cadastro de origem.');
  if (input.termination !== undefined && row.source !== 'sip') fail(400, 'termination_not_supported', 'Somente números SIP têm URL de terminação.');
  agentOrFail(store, tenant, input.agentId);
  const patch: Record<string, unknown> = { revision: Number(row.revision ?? 0) + 1 };
  if (input.name !== undefined) patch.name = input.name;
  if (input.agentId !== undefined) patch.agentId = input.agentId;
  if (input.termination !== undefined) {
    // New outbound trunk first; the old one is removed only after the new configuration exists.
    const sip = { ...(row.sip as Record<string, any> ?? {}) }, old = sip.outboundTrunkId as string | undefined;
    sip.outboundTrunkId = input.termination ? (await sipBackend.current.createOutbound({ number: String(row.number), label: String(row.name), tenantId: tenant, termination: input.termination })).trunkId : null;
    sip.termination = terminationView(input.termination);
    if (old) await sipBackend.current.removeTrunk(old).catch(e => console.log('sip_outbound_cleanup_failed', e instanceof NumberProviderError ? e.code : 'unknown'));
    patch.sip = sip;
  }
  const saved = store.update(tenant, collection, id, patch)!;
  record(store, tenant, 'update', saved, actor, { changes: Object.keys(input) });
  return managedView(saved);
}

/** Returns the number to its carrier / tears down its SIP routes, removes the row and gives back an extra add-on unit. */
export async function releaseManagedNumber(store: Store, tenant: string, id: string, actor: string) {
  const row = store.get(tenant, collection, id); if (!row) return fail(404, 'number_not_found', 'Número não encontrado.');
  if (!isManaged(row)) return fail(409, 'number_not_managed', 'Este número pertence à conta de telefonia da plataforma e não pode ser liberado por aqui.');
  const sip = (row.sip ?? {}) as Record<string, any>;
  // carrierReleasedAt: a retry after a later step failed never asks the carrier again (DIDlogic answers 422 for a returned DID).
  if (row.source === 'platform_purchase' && !row.carrierReleasedAt) {
    const provider = numberProviders[row.provider as NumberProviderName]; if (!provider) return fail(409, 'number_provider_unknown', 'Provedor do número desconhecido.');
    await provider.release({ providerNumberId: String(row.providerNumberId ?? ''), phoneNumber: String(row.number) });
    store.update(tenant, collection, id, { carrierReleasedAt: new Date().toISOString() });
  }
  if (row.source === 'imported' && !row.carrierReleasedAt) {
    // The caller ID lives in the platform Twilio account: delete it only when no other organization still uses it.
    const shared = holders(store, row.number).some(h => h.tenant !== tenant || h.row.id !== row.id);
    const account = process.env.TWILIO_ACCOUNT_SID?.trim(), token = process.env.TWILIO_AUTH_TOKEN?.trim();
    if (!shared && account && token && /^PN[0-9a-fA-F]{32}$/.test(String(row.providerNumberId))) {
      const r = await numberHttp.fetch(`https://api.twilio.com/2010-04-01/Accounts/${account}/OutgoingCallerIds/${row.providerNumberId}.json`, { method: 'DELETE', headers: { authorization: 'Basic ' + Buffer.from(`${account}:${token}`).toString('base64') }, signal: AbortSignal.timeout(15000) })
        .catch(() => fail(502, 'number_provider_unreachable', 'A Twilio não respondeu. Tente novamente.'));
      if (!r.ok && r.status !== 404) fail(502, 'twilio_release_failed', 'A Twilio não confirmou a remoção do número importado. Tente novamente.');
    }
    // A new import of this number must be possible again (the verification lock is per phone number).
    for (const v of store.list(tenant, 'caller-id-validations').filter(v => v.phoneNumber === row.number)) store.remove(tenant, 'caller-id-validations', v.id);
    store.update(tenant, collection, id, { carrierReleasedAt: new Date().toISOString() });
  }
  for (const rule of [sip.dispatchRuleId].filter(Boolean)) await sipBackend.current.removeDispatchRule(String(rule));
  for (const trunk of [sip.inboundTrunkId, sip.outboundTrunkId].filter(Boolean)) await sipBackend.current.removeTrunk(String(trunk));
  store.remove(tenant, collection, id);
  record(store, tenant, 'release', row, actor, { provider: row.provider, allowance: row.allowance ?? null });
  const billing = row.source === 'platform_purchase' && row.allowance === 'extra' ? await releaseExtraNumber(store, tenant, id) : null;
  return { released: true, id, number: row.number, source: row.source, billing };
}

export async function createSipNumber(store: Store, tenant: string, input: z.infer<typeof sipSchema>, actor: string, sipAllowed: () => void) {
  const opId = createHash('sha256').update(`${tenant}:${input.idempotencyKey}`).digest('hex').slice(0, 32);
  const prior = store.list(tenant, sipOps).find(o => o.opId === opId);
  if (prior?.status === 'succeeded') { const row = store.get(tenant, collection, String(prior.numberId)); if (row) return managedView(row); }
  if (prior?.status === 'pending') fail(409, 'sip_in_progress', 'Esta criação já está em andamento.');
  sipAllowed();
  const missing = sipBackend.current.missing(); if (missing.length) fail(503, 'sip_not_configured', `Os números SIP ainda não estão configurados nesta plataforma. Falta: ${missing.join('; ')}.`);
  if (holders(store, input.number).length) fail(409, 'sip_number_taken', 'Number / Name already exists.');
  agentOrFail(store, tenant, input.agentId);
  const host = sipBackend.current.originationHost()!, label = input.name?.trim() || input.number;
  const op = prior ?? store.create(tenant, sipOps, { opId, status: 'pending', number: input.number, requestedBy: actor });
  if (prior) store.update(tenant, sipOps, op.id, { status: 'pending' });
  let inbound: { trunkId: string; dispatchRuleId: string } | undefined, outbound: { trunkId: string } | undefined;
  try {
    inbound = await sipBackend.current.createInbound({ number: input.number, label, tenantId: tenant });
    if (input.termination) outbound = await sipBackend.current.createOutbound({ number: input.number, label, tenantId: tenant, termination: input.termination });
  } catch (e) {
    if (inbound) { await sipBackend.current.removeDispatchRule(inbound.dispatchRuleId).catch(() => undefined); await sipBackend.current.removeTrunk(inbound.trunkId).catch(() => undefined); }
    store.update(tenant, sipOps, op.id, { status: 'failed', error: e instanceof Error ? e.message.slice(0, 200) : 'unknown' });
    throw e;
  }
  const row = store.create(tenant, collection, { name: label.slice(0, 200), number: input.number, provider: 'sip', providerNumberId: inbound.trunkId, agentId: input.agentId ?? null, channelId: null,
    capabilities: ['voice'], provisioningStatus: 'unverified', revision: 1, source: 'sip', createdBy: actor,
    sip: { inboundTrunkId: inbound.trunkId, dispatchRuleId: inbound.dispatchRuleId, outboundTrunkId: outbound?.trunkId ?? null, originationHost: host, uri: `sip:${input.number}@${host}`, termination: terminationView(input.termination) } });
  store.update(tenant, sipOps, op.id, { status: 'succeeded', numberId: row.id });
  record(store, tenant, 'create_sip', row, actor);
  return managedView(row);
}

export function registerManagedNumbers(app: FastifyInstance, store: Store, wrap: (fn: (req: FastifyRequest) => unknown) => (req: FastifyRequest, reply: any) => Promise<unknown>, sipAllowed: (tenant: string) => void) {
  const params = (req: FastifyRequest) => z.object({ id: idSchema }).strict().parse(req.params).id;
  app.patch('/api/v1/numbers/:id', wrap(async req => {
    const actor = requireRequestPermission(store, req, 'phones:write');
    return updateManagedNumber(store, actor.tenantId, params(req), patchSchema.parse(req.body), actor.userId);
  }));
  app.delete('/api/v1/numbers/:id', wrap(async req => {
    const actor = requireRequestPermission(store, req, 'phones:write');
    return releaseManagedNumber(store, actor.tenantId, params(req), actor.userId);
  }));
  app.post('/api/v1/numbers/sip', wrap(async req => {
    const actor = requireRequestPermission(store, req, 'phones:write');
    return createSipNumber(store, actor.tenantId, sipSchema.parse(req.body), actor.userId, () => sipAllowed(actor.tenantId));
  }));
  app.post('/api/v1/numbers/imported', wrap(async req => {
    const actor = requireRequestPermission(store, req, 'phones:write'), body = importedSchema.parse(req.body);
    // Only a number this organization proved by the verification call can be registered.
    const proof = store.list(actor.tenantId, 'caller-id-validations').find(v => v.phoneNumber === body.phoneNumber && v.status === 'verified');
    if (!proof) fail(409, 'imported_number_unverified', 'Conclua a ligação de verificação deste número antes de vinculá-lo.');
    agentOrFail(store, actor.tenantId, body.agentId);
    const row = ensureImportedNumber(store, actor.tenantId, body.phoneNumber, (proof!.callerIdSid as string | undefined) ?? null, body.name);
    if (!isManaged(row)) fail(409, 'number_not_managed', 'Este número já está cadastrado de outra forma.');
    const patch = { ...(body.agentId !== undefined ? { agentId: body.agentId } : {}), ...(body.name ? { name: body.name } : {}) };
    return Object.keys(patch).length ? updateManagedNumber(store, actor.tenantId, row.id, patch, actor.userId) : managedView(row);
  }));
}
