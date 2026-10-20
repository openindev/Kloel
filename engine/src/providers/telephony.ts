import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import twilio from 'twilio';
import type { Entity, Store } from '../store.js';
import { MembershipError, resolveSessionActor } from '../memberships/service.js';
import { assertRequestContext } from '../request-context.js';
import { hasPermission } from '../memberships/permissions.js';
import { seal, unseal } from '../oauth/crypto.js';
import { publicUrl } from '../ingestion/safe-url.js';

export const TWILIO_CALLER_ID_CALLBACK_PATH = '/api/v1/webhooks/twilio/caller-id';
const root = '/api/v1/voice';
const collection = 'caller-id-validations';
const phone = z.string().regex(/^\+[1-9]\d{7,14}$/);
const accountSid = z.string().regex(/^AC[0-9a-fA-F]{32}$/);
const numberSid = z.string().regex(/^PN[0-9a-fA-F]{32}$/);
const callSid = z.string().regex(/^CA[0-9a-fA-F]{32}$/);
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const codeContext = (row: Entity) => `${row.tenantId}:${row.id}:caller-id-code`;
type Json = Record<string, unknown>;

class TelephonyError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly uncertain = false) { super(message); }
}
function fail(status: number, code: string, message: string): never { throw new TelephonyError(status, code, message); }
function env(name: string): string {
  const value = process.env[name]?.trim();
  return value || fail(503, 'integration_not_configured', `Configure ${name} no servidor.`);
}
function config() {
  const parsed = accountSid.safeParse(env('TWILIO_ACCOUNT_SID'));
  if (!parsed.success) return fail(503, 'integration_not_configured', 'Conta Twilio inválida.');
  return { account: parsed.data, token: env('TWILIO_AUTH_TOKEN') };
}
function operator(store: Store, request: FastifyRequest) {
  const actor = request.actor, sessionHash = hash(request.cookies?.kloel_session ?? '');
  const check = () => {
    assertRequestContext(store, request);
    const current = resolveSessionActor(store, sessionHash);
    if (!actor || !current || current.userId !== actor.userId || current.tenantId !== actor.tenantId || current.role !== actor.role || !hasPermission(current.role, 'integrations:manage')) fail(403, 'operator_session_revoked', 'Sessão com permissão vigente obrigatória.');
  };
  // Multi-org: the shared Twilio account is the platform reseller account. Only the provider org sees the whole
  // account; every other org sees only what it owns (numbers it bought via /numbers/purchase, caller IDs it verified).
  check(); return { tenant: actor.tenantId, userId: actor.userId, check, platform: actor.tenantId === process.env.PROVIDER_TENANT_ID?.trim() };
}
function callbackUrl() {
  let url: URL;
  try { url = publicUrl(env('TWILIO_CALLER_ID_WEBHOOK_URL')); } catch { return fail(503, 'integration_not_configured', 'Configure callback público HTTPS de caller ID.'); }
  if (url.protocol !== 'https:' || url.pathname !== TWILIO_CALLER_ID_CALLBACK_PATH || url.search || url.hash || url.href.length > 850) fail(503, 'integration_not_configured', 'Callback de caller ID deve apontar para a rota específica sem query.');
  return url;
}
function safe(fn: (request: FastifyRequest, reply: FastifyReply) => unknown | Promise<unknown>) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    reply.header('cache-control', 'no-store');
    try { return await fn(request, reply); }
    catch (e) {
      if (e instanceof MembershipError) return reply.code(e.statusCode).send({ error: { code: e.code, message: e.message } });
      if (e instanceof TelephonyError) return reply.code(e.status).send({ error: { code: e.code, message: e.message } });
      if (e instanceof z.ZodError) return reply.code(400).send({ error: { code: 'invalid_input', message: 'Dados de telefonia inválidos.' } });
      request.log.error({ category: 'telephony_internal_error' }, 'Telephony operation failed');
      return reply.code(500).send({ error: { code: 'telephony_internal_error', message: 'Falha interna na telefonia.' } });
    }
  };
}

async function api(path: string, query = new URLSearchParams(), form?: URLSearchParams): Promise<Json> {
  const { account, token } = config();
  const url = new URL(`https://api.twilio.com/2010-04-01/Accounts/${account}/${path}.json`); url.search = query.toString();
  let response: Response;
  try {
    response = await fetch(url, { method: form ? 'POST' : 'GET', headers: { authorization: `Basic ${Buffer.from(`${account}:${token}`).toString('base64')}`, accept: 'application/json', ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) }, ...(form ? { body: form.toString() } : {}), redirect: 'error', signal: AbortSignal.timeout(15000) });
  } catch { throw new TelephonyError(502, 'twilio_outcome_unknown', 'Não foi possível confirmar a resposta da Twilio. Consulte o recibo antes de repetir.', true); }
  if (!response.ok) throw new TelephonyError(response.status === 429 ? 429 : 502, 'twilio_rejected', `Twilio recusou a operação (HTTP ${response.status}).`, response.status >= 500);
  try { return z.record(z.unknown()).parse(await response.json()); }
  catch { throw new TelephonyError(502, 'invalid_twilio_response', 'Twilio não confirmou uma resposta válida.', true); }
}
function parseProvider<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new TelephonyError(502, 'invalid_twilio_response', 'Twilio não confirmou uma resposta válida.', true);
  return result.data;
}
const ownedNumber = z.object({ sid: numberSid, account_sid: accountSid, phone_number: phone, friendly_name: z.string().max(256), capabilities: z.record(z.boolean()).optional(), status: z.string().max(80).optional(), voice_url: z.string().nullable().optional() });
const callerNumber = ownedNumber.omit({ capabilities: true, status: true, voice_url: true });
function verifyAccount(value: { account_sid: string }) {
  if (value.account_sid !== config().account) throw new TelephonyError(502, 'twilio_account_mismatch', 'Resposta Twilio pertence a outra conta.', true);
}
function publicValidation(row: Entity) {
  return { id: row.id, phoneNumber: row.phoneNumber, friendlyName: row.friendlyName, status: row.status, verified: row.status === 'verified', providerCallSid: row.callSid ?? null, callerIdSid: row.callerIdSid ?? null, callbackStatus: row.callbackStatus ?? null, confirmationSource: row.confirmationSource ?? null, errorCode: row.errorCode ?? null, requiresReconciliation: ['requesting', 'unknown', 'awaiting_confirmation', 'callback_confirmation_pending'].includes(String(row.status)), automaticRetry: false, createdAt: row.createdAt, updatedAt: row.updatedAt };
}
function scopedValidation(store: Store, tenant: string, id: string) {
  const row = store.get(tenant, collection, id);
  return row ?? fail(404, 'validation_not_found', 'Solicitação de verificação não encontrada.');
}
function validatedCaller(value: unknown, expectedPhone: string, expectedId?: string) {
  const result = parseProvider(callerNumber, value); verifyAccount(result);
  if (result.phone_number !== expectedPhone || expectedId && result.sid !== expectedId) throw new TelephonyError(502, 'caller_id_mismatch', 'Twilio não confirmou o número solicitado.', true);
  return result;
}
function markVerified(store: Store, row: Entity, sid: string, source: string) {
  return store.update(row.tenantId, collection, row.id, { status: 'verified', callerIdSid: sid, confirmationSource: source, verifiedAt: new Date().toISOString(), encryptedCode: null })!;
}

export async function registerTwilioTelephony(app: FastifyInstance, store: Store) {
  const pagination = z.object({ page: z.coerce.number().int().min(0).max(10000).default(0), pageSize: z.coerce.number().int().min(1).max(100).default(50), phoneNumber: phone.optional() }).strict();
  app.get(`${root}/numbers/available`, safe(async request => {
    const auth = operator(store, request);
    const q = z.object({ country: z.string().regex(/^[A-Z]{2}$/).default('BR'), type: z.enum(['local', 'mobile', 'tollFree']).default('local'), contains: z.string().regex(/^[+0-9*]{1,16}$/).optional(), areaCode: z.string().regex(/^\d{1,5}$/).optional(), limit: z.coerce.number().int().min(1).max(100).default(20) }).strict().parse(request.query);
    const query = new URLSearchParams({ VoiceEnabled: 'true', PageSize: String(q.limit) });
    if (q.contains) query.set('Contains', q.contains); if (q.areaCode) query.set('AreaCode', q.areaCode);
    const type = { local: 'Local', mobile: 'Mobile', tollFree: 'TollFree' }[q.type];
    const response = await api(`AvailablePhoneNumbers/${q.country}/${type}`, query); auth.check();
    const data = parseProvider(z.object({ available_phone_numbers: z.array(z.object({ phone_number: phone, friendly_name: z.string().max(256), iso_country: z.string().regex(/^[A-Z]{2}$/), capabilities: z.record(z.boolean()), address_requirements: z.string().max(100).optional(), locality: z.string().nullable().optional(), region: z.string().nullable().optional() })).max(100) }), response);
    if (data.available_phone_numbers.some(n => n.iso_country !== q.country)) fail(502, 'invalid_twilio_response', 'País retornado difere do solicitado.');
    return { items: data.available_phone_numbers.slice(0, q.limit).map(n => ({ phoneNumber: n.phone_number, friendlyName: n.friendly_name, country: n.iso_country, capabilities: n.capabilities, addressRequirements: n.address_requirements ?? null, locality: n.locality ?? null, region: n.region ?? null })), source: 'twilio', providerVerified: true, purchasePerformed: false, priceVerified: false };
  }));
  app.get(`${root}/numbers/owned`, safe(async request => {
    const auth = operator(store, request), q = pagination.parse(request.query);
    const query = new URLSearchParams({ Page: String(q.page), PageSize: String(q.pageSize) }); if (q.phoneNumber) query.set('PhoneNumber', q.phoneNumber);
    const mine = new Set(store.list(auth.tenant, 'phone-numbers').filter(n => n.provider === 'twilio' || n.provider === 'didlogic').map(n => String(n.number)));
    if (!auth.platform && mine.size === 0) return { items: [], page: q.page, nextPage: null, source: 'twilio', providerVerified: true };
    const response = await api('IncomingPhoneNumbers', query); auth.check();
    const data = parseProvider(z.object({ incoming_phone_numbers: z.array(ownedNumber).max(100), next_page_uri: z.string().nullable() }), response);
    for (const n of data.incoming_phone_numbers) verifyAccount(n);
    if (!auth.platform) data.incoming_phone_numbers = data.incoming_phone_numbers.filter(n => mine.has(n.phone_number));
    return { items: data.incoming_phone_numbers.map(n => ({ sid: n.sid, phoneNumber: n.phone_number, friendlyName: n.friendly_name, capabilities: n.capabilities ?? {}, status: n.status ?? null, configuredVoiceWebhook: !!process.env.TWILIO_VOICE_WEBHOOK_URL && n.voice_url === process.env.TWILIO_VOICE_WEBHOOK_URL })), page: q.page, nextPage: data.next_page_uri ? q.page + 1 : null, source: 'twilio', providerVerified: true };
  }));
  app.get(`${root}/caller-ids`, safe(async request => {
    const auth = operator(store, request), q = pagination.parse(request.query);
    const query = new URLSearchParams({ Page: String(q.page), PageSize: String(q.pageSize) }); if (q.phoneNumber) query.set('PhoneNumber', q.phoneNumber);
    const verified = new Set(store.list(auth.tenant, collection).filter(v => v.status === 'verified').map(v => String(v.phoneNumber)));
    if (!auth.platform && verified.size === 0) return { items: [], page: q.page, nextPage: null, source: 'twilio', providerVerified: true };
    const response = await api('OutgoingCallerIds', query); auth.check();
    const data = parseProvider(z.object({ outgoing_caller_ids: z.array(callerNumber).max(100), next_page_uri: z.string().nullable() }), response);
    for (const n of data.outgoing_caller_ids) verifyAccount(n);
    if (!auth.platform) data.outgoing_caller_ids = data.outgoing_caller_ids.filter(n => verified.has(n.phone_number));
    return { items: data.outgoing_caller_ids.map(n => ({ sid: n.sid, phoneNumber: n.phone_number, friendlyName: n.friendly_name, verified: true, outboundOnly: true, inboundRoutingConfigured: false })), page: q.page, nextPage: data.next_page_uri ? q.page + 1 : null, source: 'twilio', providerVerified: true };
  }));
  app.get(`${root}/caller-ids/validation-requests`, safe(request => {
    const auth = operator(store, request); return { items: store.list(auth.tenant, collection).map(publicValidation) };
  }));
  app.post(`${root}/caller-ids/validation-requests`, safe(async request => {
    const auth = operator(store, request), cfg = config(), callback = callbackUrl();
    const body = z.object({ phoneNumber: phone, friendlyName: z.string().trim().min(1).max(64).optional(), confirmCall: z.literal(true), idempotencyKey: z.string().min(8).max(128).regex(/^[A-Za-z0-9_.:-]+$/) }).strict().parse(request.body);
    // Fail before any call if encryption is unavailable; never persist validation codes in cleartext.
    try { seal('probe', 'caller-id-storage-check'); } catch { return fail(503, 'telephony_storage_unavailable', 'Configure a chave de proteção local.'); }
    const keyHash = hash(`${auth.userId}:${body.idempotencyKey}`), fingerprint = hash(JSON.stringify({ phoneNumber: body.phoneNumber, friendlyName: body.friendlyName ?? null, account: cfg.account, callback: callback.href }));
    const existing = store.list(auth.tenant, collection).find(r => r.keyHash === keyHash);
    const responseFor = (row: Entity) => {
      auth.check();
      if (row.fingerprint !== fingerprint) return fail(409, 'idempotency_conflict', 'Chave já usada com outro número ou configuração.');
      if (['requesting', 'unknown'].includes(String(row.status))) return fail(409, 'validation_requires_reconciliation', 'Resultado da ligação não confirmado; não repita a solicitação.');
      let code: string | undefined;
      if (row.encryptedCode && row.initiatedBy === auth.userId && Number(row.codeExpiresAt) > Date.now() && row.status === 'awaiting_confirmation') {
        try { code = unseal<string>(String(row.encryptedCode), codeContext(row)); } catch { return fail(503, 'telephony_storage_unavailable', 'Código de validação indisponível.'); }
      }
      return { ...publicValidation(row), ...(code ? { validationCode: code, codeExpiresAt: row.codeExpiresAt } : {}) };
    };
    if (existing) return responseFor(existing);
    const row = store.transaction(() => {
      auth.check(); const attempts = store.list(auth.tenant, collection);
      if (attempts.some(r => r.phoneNumber === body.phoneNumber && !['failed', 'rejected'].includes(String(r.status)))) fail(409, 'validation_already_exists', 'Este número já tem uma verificação; consulte seu estado antes de solicitar outra ligação.');
      if (attempts.filter(r => Date.parse(r.createdAt) > Date.now() - 3600000).length >= 5 || attempts.filter(r => Date.parse(r.createdAt) > Date.now() - 86400000).length >= 20) fail(429, 'validation_limit_reached', 'Limite de verificações atingido.');
      const row = store.create(auth.tenant, collection, { phoneNumber: body.phoneNumber, friendlyName: body.friendlyName ?? body.phoneNumber, initiatedBy: auth.userId, keyHash, fingerprint, accountSid: cfg.account, status: 'requesting' });
      callback.searchParams.set('requestId', row.id);
      return store.update(auth.tenant, collection, row.id, { callbackUrl: callback.href })!;
    });
    try {
      auth.check();
      const form = new URLSearchParams({ PhoneNumber: body.phoneNumber, FriendlyName: String(row.friendlyName), CallDelay: '5', StatusCallback: String(row.callbackUrl), StatusCallbackMethod: 'POST' });
      const response = await api('OutgoingCallerIds', new URLSearchParams(), form);
      const accepted = parseProvider(z.object({ account_sid: accountSid, call_sid: callSid, phone_number: phone, validation_code: z.string().regex(/^\d{6}$/) }), response);
      if (accepted.account_sid !== cfg.account || accepted.phone_number !== body.phoneNumber) throw new TelephonyError(502, 'caller_id_mismatch', 'Twilio não confirmou o número solicitado.', true);
      const current = scopedValidation(store, auth.tenant, row.id);
      if (current.callSid && current.callSid !== accepted.call_sid) throw new TelephonyError(502, 'caller_id_mismatch', 'Twilio retornou chamadas conflitantes.', true);
      const awaiting = current.status === 'requesting';
      const updated = store.update(auth.tenant, collection, row.id, { callSid: accepted.call_sid, ...(awaiting ? { status: 'awaiting_confirmation', encryptedCode: seal(accepted.validation_code, codeContext(row)), codeExpiresAt: Date.now() + 15 * 60000 } : {}) })!;
      return responseFor(updated);
    } catch (e) {
      const current = scopedValidation(store, auth.tenant, row.id);
      if (current.status === 'requesting') store.update(auth.tenant, collection, row.id, { status: e instanceof TelephonyError && !e.uncertain ? 'rejected' : 'unknown', errorCode: e instanceof TelephonyError ? e.code : 'validation_outcome_unknown' });
      throw e;
    }
  }));
  app.post(`${root}/caller-ids/validation-requests/:id/reconcile`, safe(async request => {
    const auth = operator(store, request), id = z.object({ id: z.string().uuid() }).parse(request.params).id;
    const row = scopedValidation(store, auth.tenant, id), query = new URLSearchParams({ PhoneNumber: String(row.phoneNumber), PageSize: '100' });
    const response = await api('OutgoingCallerIds', query); auth.check();
    const data = parseProvider(z.object({ outgoing_caller_ids: z.array(callerNumber).max(100), next_page_uri: z.string().nullable() }), response);
    if (data.next_page_uri) fail(502, 'incomplete_caller_id_lookup', 'Twilio não retornou consulta completa para o número.');
    const matching = data.outgoing_caller_ids.filter(n => n.phone_number === row.phoneNumber);
    for (const n of data.outgoing_caller_ids) verifyAccount(n);
    if (matching.length > 1) fail(502, 'invalid_twilio_response', 'Twilio retornou identificadores conflitantes.');
    if (!matching.length) return { ...publicValidation(scopedValidation(store, auth.tenant, id)), providerVerified: false, found: false, automaticRetry: false };
    return { ...publicValidation(markVerified(store, scopedValidation(store, auth.tenant, id), matching[0].sid, 'twilio_api_reconciliation')), found: true, providerVerified: true };
  }));

  await app.register(async webhook => {
    webhook.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 65536 }, (_request, body, done) => done(null, body));
    webhook.post(TWILIO_CALLER_ID_CALLBACK_PATH, safe(async request => {
      const tenant = env('PROVIDER_TENANT_ID'), cfg = config(), id = z.object({ requestId: z.string().uuid() }).strict().parse(request.query).requestId;
      const row = scopedValidation(store, tenant, id);
      if (row.accountSid !== cfg.account) fail(403, 'twilio_account_mismatch', 'Conta não corresponde à solicitação.');
      if (typeof request.body !== 'string') fail(400, 'invalid_callback', 'Callback inválido.');
      const form = new URLSearchParams(request.body), params: Record<string, string> = Object.create(null);
      for (const [k, v] of form) { if (Object.hasOwn(params, k)) fail(400, 'invalid_callback', 'Parâmetros duplicados.'); params[k] = v; }
      const signature = typeof request.headers['x-twilio-signature'] === 'string' ? request.headers['x-twilio-signature'] : '';
      if (!twilio.validateRequest(cfg.token, signature, String(row.callbackUrl), params)) fail(401, 'invalid_signature', 'Assinatura Twilio inválida.');
      const data = z.object({ AccountSid: accountSid, CallSid: callSid, To: phone, VerificationStatus: z.enum(['success', 'failed']), OutgoingCallerIdSid: numberSid.optional() }).parse(params);
      if (data.AccountSid !== cfg.account || data.To !== row.phoneNumber || row.callSid && row.callSid !== data.CallSid) fail(403, 'callback_binding_mismatch', 'Callback não corresponde ao pedido.');
      if (data.VerificationStatus === 'success' && !data.OutgoingCallerIdSid) fail(400, 'invalid_callback', 'Identificador de caller ID obrigatório.');
      const callbackHash = hash(JSON.stringify({ call: data.CallSid, status: data.VerificationStatus, sid: data.OutgoingCallerIdSid ?? null }));
      if (row.callbackHash && row.callbackHash !== callbackHash) fail(409, 'callback_conflict', 'Callback conflitante para esta tentativa.');
      if (row.callbackHash === callbackHash && ['verified', 'failed'].includes(String(row.status))) return { received: true, duplicate: true };
      const updated = store.update(tenant, collection, row.id, { callSid: data.CallSid, callbackHash, callbackStatus: data.VerificationStatus, callbackReceivedAt: new Date().toISOString(), encryptedCode: null, status: row.status === 'verified' ? 'verified' : data.VerificationStatus === 'failed' ? 'failed' : 'callback_confirmation_pending', ...(data.OutgoingCallerIdSid ? { callerIdSid: data.OutgoingCallerIdSid } : {}) })!;
      if (data.VerificationStatus === 'success') {
        const result = await api(`OutgoingCallerIds/${data.OutgoingCallerIdSid}`);
        const confirmed = validatedCaller(result, String(row.phoneNumber), data.OutgoingCallerIdSid);
        markVerified(store, updated, confirmed.sid, 'signed_callback_and_twilio_api');
      }
      return { received: true };
    }));
  });
}
