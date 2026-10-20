import type { FastifyInstance, FastifyRequest } from 'fastify';
import { metaConfigFingerprint, metaCreds, metaTenantBound } from '../meta-tenants.js';
import { createHash } from 'node:crypto';
import { metaAutomationBlocked } from './meta-identity-review.js';
import { z } from 'zod';
import type { Entity, Store } from '../store.js';
import { findMetaOutbound, replayMetaDelivery } from './meta-delivery.js';
import { whatsappJobChannelIssue } from '../whatsapp-channel-state.js';
import { MembershipError, resolveSessionActor } from '../memberships/service.js';
import { assertRequestContext } from '../request-context.js';
import { hasPermission } from '../memberships/permissions.js';
import { graphSendDiagnostics } from './whatsapp-send-diagnostics.js';
import { WhatsAppSendFault as Fault, sendWhatsAppPayload, unresolvedHumanReply, conversationReplyCollection } from './whatsapp-send.js';
import { registerWhatsAppConversationReply } from './whatsapp-conversation-reply.js';
import { captureMetaContact } from './meta-identity.js';

type Data = Record<string, any>;
const prefix = '/api/v1/whatsapp';
const collection = 'whatsapp-operations';
const scheduler = new WeakMap<Store, boolean>();
/** Set only after the real scheduler starts/stops; opt-in is a separate setting. */
export function setWhatsAppSchedulerRunning(store: Store, running: boolean) { scheduler.set(store, running); }
export type WhatsAppOperatorOptions = { fetcher?: typeof fetch; now?: () => number };
const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,150}$/);
const operationKey = z.string().regex(/^[A-Za-z0-9_.:-]{8,128}$/);
const phone = z.string().regex(/^\+[1-9]\d{7,14}$/);
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const object = (value: unknown): value is Data => !!value && typeof value === 'object' && !Array.isArray(value);
const fields = ['PROVIDER_TENANT_ID', 'META_ACCESS_TOKEN', 'META_PHONE_NUMBER_ID', 'META_GRAPH_VERSION', 'META_WABA_ID'];
function configHash(tenant?: string) { return digest([...fields.map(name => process.env[name] ?? ''), ...metaConfigFingerprint(tenant)]); }
function stateVersion(row: Entity) { return digest(row); }
const delivery = (message?: Entity) => ['sent', 'delivered', 'read', 'failed'].includes(String(message?.providerStatus)) ? String(message!.providerStatus) : message?.deliveryStatus === 'failed' ? 'failed' : 'accepted';

export async function registerWhatsAppOperator(app: FastifyInstance, store: Store, options: WhatsAppOperatorOptions = {}) {
  const fetcher = options.fetcher ?? ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args));
  const now = options.now ?? Date.now;
  function actor(request: FastifyRequest) {
    assertRequestContext(store, request);
    if (request.apiKey || !request.cookies?.kloel_session) throw new Fault(401, 'unauthorized', 'Entre com sua sessão para administrar o WhatsApp.');
    const hash = createHash('sha256').update(request.cookies.kloel_session).digest('hex');
    const current = resolveSessionActor(store, hash);
    if (!current || current.userId !== request.actor?.userId || current.tenantId !== request.actor?.tenantId || !hasPermission(current.role, 'integrations:manage')) throw new Fault(403, 'forbidden', 'Sua sessão não permite administrar o WhatsApp.');
    const member = store.db.prepare('SELECT id FROM memberships WHERE tenant_id=? AND user_id=?').get(current.tenantId, current.userId) as { id: string } | undefined;
    if (!member) throw new Fault(403, 'forbidden');
    return { ...current, membershipId: member.id, sessionHash: hash };
  }
  function capture(request: FastifyRequest, bound = true) {
    const original = actor(request), config = configHash(original.tenantId);
    if (bound && !metaTenantBound(original.tenantId)) throw new Fault(403, 'provider_tenant_mismatch', 'O provedor não está vinculado a esta organização.');
    return { original, config, assert() {
      const current = actor(request);
      if (current.userId !== original.userId || current.tenantId !== original.tenantId || current.membershipId !== original.membershipId || current.role !== original.role || current.sessionHash !== original.sessionHash) throw new Fault(403, 'authority_changed', 'Seu acesso mudou durante a operação.');
      if (configHash(original.tenantId) !== config) throw new Fault(409, 'configuration_changed', 'A configuração do provedor mudou.');
    } };
  }
  function environment(templates = false, tenant?: string) {
    const mc = metaCreds(tenant);
    const token = mc?.token, phoneId = mc?.phoneId, version = mc?.version, waba = mc?.wabaId;
    if (!token || !phoneId || !/^\d{1,40}$/.test(phoneId) || !version || !/^v\d+\.\d+$/.test(version) || templates && (!waba || !/^\d{1,40}$/.test(waba))) throw new Fault(503, 'integration_not_configured', 'Complete a configuração Meta no servidor.');
    return { token, phoneId, version, waba: waba ?? '' };
  }
  function channel(tenant: string, channelId?: string) {
    if (!channelId) return undefined;
    const row = store.get(tenant, 'channels', channelId);
    if (!row || row.type !== 'whatsapp' || row.provider !== 'meta' || !row.enabled || (row.configuration as Data | undefined)?.externalId !== metaCreds(tenant)?.phoneId) throw new Fault(409, 'channel_unavailable', 'Use um canal Meta habilitado e vinculado ao número do servidor.');
    return row;
  }
  function conversation(tenant: string, conversationId: string | undefined, to: string, channelId?: string) {
    if (!conversationId) return undefined;
    const row = store.get(tenant, 'conversations', conversationId);
    if (!row) throw new Fault(404, 'not_found', 'Conversa não encontrada nesta organização.');
    if (row.channel !== 'whatsapp' || row.externalContact !== to) throw new Fault(409, 'recipient_mismatch', 'A conversa não corresponde ao destinatário.');
    if (row.status === 'closed' || channelId && row.channelId && row.channelId !== channelId) throw new Fault(409, 'conversation_mismatch', 'A conversa está encerrada ou pertence a outro canal.');
    return row;
  }
  function conversationVersion(row?: Entity) { return row ? digest([row.id, row.channel, row.externalContact, row.status, row.channelId ?? null, row.agentId ?? null]) : null; }
  function route<T>(handler: (request: FastifyRequest) => Promise<T> | T) {
    return async (request: FastifyRequest, reply: any) => {
      reply.header('Cache-Control', 'no-store');
      try { return await handler(request); }
      catch (error) {
        if (error instanceof z.ZodError) return reply.code(400).send({ error: { code: 'invalid_input', message: 'Confira os campos da solicitação.' } });
        if (error instanceof MembershipError) return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
        if (error instanceof Fault) return reply.code(error.status).send({ error: { code: error.code, message: error.message, ...graphSendDiagnostics(error.diagnostics) } });
        return reply.code(500).send({ error: { code: 'whatsapp_internal_error', message: 'Falha interna do WhatsApp. Consulte a operação antes de repetir.' } });
      }
    };
  }
  async function remote(url: URL, token: string, assert: () => void): Promise<Data> {
    assert();
    const response = await fetcher(url, { headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(30000) });
    assert();
    if (!response.ok) { await response.body?.cancel(); assert(); throw new Fault(502, 'provider_read_failed', 'A Meta não confirmou a consulta.'); }
    const data: unknown = await response.json(); assert();
    if (!object(data)) throw new Fault(502, 'invalid_provider_response');
    return data;
  }
  function template(raw: unknown) {
    if (!object(raw) || !/^\d{1,100}$/.test(String(raw.id)) || typeof raw.name !== 'string' || !/^[a-z0-9_]{1,512}$/.test(raw.name) || typeof raw.language !== 'string' || !/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(raw.language) || typeof raw.status !== 'string' || !/^[A-Z_]{1,50}$/.test(raw.status) || !Array.isArray(raw.components) || raw.components.length > 20) throw new Fault(502, 'invalid_provider_response');
    const body = raw.components.filter((c: any) => c?.type === 'BODY');
    const content = body.length === 1 && typeof body[0].text === 'string' && body[0].text.length <= 10000 ? body[0].text : '';
    const indexes = [...content.matchAll(/\{\{(\d+)\}\}/g)].map(m => Number(m[1]));
    const count = Math.max(0, ...indexes), unique = new Set(indexes);
    const supported = !!content && count <= 30 && !content.replace(/\{\{\d+\}\}/g, '').includes('{{') && unique.size === count && !unique.has(0)
      && (!raw.parameter_format || raw.parameter_format === 'POSITIONAL')
      && raw.components.every((c: any) => c?.type === 'BODY' || (['HEADER', 'FOOTER'].includes(c?.type) && (!c.format || c.format === 'TEXT') && typeof c.text === 'string' && !c.text.includes('{{')));
    return { id: String(raw.id), name: raw.name, language: raw.language, status: raw.status, category: ['MARKETING', 'UTILITY', 'AUTHENTICATION'].includes(raw.category) ? raw.category : 'UNKNOWN', body: content, bodyParameterCount: supported ? count : 0, supported, sendable: supported && raw.status === 'APPROVED' };
  }
  async function templates(authorization: ReturnType<typeof capture>, after?: string, name?: string) {
    const env = environment(true, authorization.original.tenantId), url = new URL(`https://graph.facebook.com/${env.version}/${env.waba}/message_templates`);
    url.searchParams.set('limit', '100'); if (after) url.searchParams.set('after', after); if (name) url.searchParams.set('name', name);
    const data = await remote(url, env.token, authorization.assert);
    if (!Array.isArray(data.data) || data.data.length > 100) throw new Fault(502, 'invalid_provider_response');
    const cursor = data.paging?.next ? data.paging?.cursors?.after : null;
    if (cursor !== null && (typeof cursor !== 'string' || !cursor || cursor.length > 500)) throw new Fault(502, 'invalid_provider_response');
    return { items: data.data.map(template), nextCursor: cursor as string | null, source: 'meta' as const };
  }
  app.get(`${prefix}/status`, route(request => {
    const auth = capture(request, false), tenantBound = metaTenantBound(auth.original.tenantId), mcs = metaCreds(auth.original.tenantId);
    const has = (key: string) => mcs && !mcs.main && ['META_ACCESS_TOKEN', 'META_PHONE_NUMBER_ID', 'META_WABA_ID'].includes(key) ? true : !!process.env[key]?.trim();
    const configured = (keys: string[]) => ({ configured: tenantBound && keys.every(has), missing: tenantBound ? keys.filter(k => !has(k)) : ['WHATSAPP_NOT_CONNECTED'] });
    const phoneId = mcs?.phoneId;
    auth.assert();
    return { scope: mcs && !mcs.main ? 'embedded-signup' : 'kloel-official', tenantBound, phoneNumberId: tenantBound && /^\d{1,40}$/.test(phoneId ?? '') ? phoneId : null, verifiedLive: false,
      configuration: { send: configured(['META_ACCESS_TOKEN', 'META_PHONE_NUMBER_ID', 'META_GRAPH_VERSION']), templates: configured(['META_ACCESS_TOKEN', 'META_PHONE_NUMBER_ID', 'META_WABA_ID', 'META_GRAPH_VERSION']), webhook: configured(['META_APP_SECRET', 'META_VERIFY_TOKEN', 'META_PHONE_NUMBER_ID']), ai: configured(['OPENAI_API_KEY', 'OPENAI_MODEL']) },
      autoreply: { enabled: tenantBound && process.env.WHATSAPP_AUTOREPLY_ENABLED === 'true', schedulerRunning: tenantBound && scheduler.get(store) === true } };
  }));
  app.get(`${prefix}/templates`, route(async request => {
    const query = z.object({ after: z.string().min(1).max(500).optional() }).strict().parse(request.query);
    // Org without its own WhatsApp (Embedded Signup) yet: empty list + connect hint instead of 403.
    const probe = capture(request, false);
    if (!metaTenantBound(probe.original.tenantId)) { probe.assert(); return { items: [], nextCursor: null, source: 'meta' as const, connected: false }; }
    const auth = capture(request);
    const result = await templates(auth, query.after); auth.assert(); return result;
  }));
  const base = { to: phone, conversationId: identifier.optional(), channelId: identifier.optional(), idempotencyKey: operationKey };
  const textBody = z.object({ ...base, text: z.string().trim().min(1).max(4096) }).strict();
  const templateBody = z.object({ ...base, name: z.string().regex(/^[a-z0-9_]{1,512}$/), language: z.string().regex(/^[a-z]{2,3}(?:_[A-Z]{2})?$/), bodyParameters: z.array(z.string().max(2000)).max(30).default([]) }).strict();
  function publicOperation(row: Entity) {
    const result = object(row.result) && typeof row.result.messageId === 'string' && row.result.messageId.length <= 500 && row.result.status === 'accepted'
      ? { messageId: row.result.messageId, status: 'accepted', ...(typeof row.result.conversationId === 'string' ? { conversationId: row.result.conversationId } : {}) } : undefined;
    const message = result ? findMetaOutbound(store, row.tenantId, row.phoneNumberId, result.messageId, { collection, id: row.id }) : undefined;
    return { status: row.status, ...(typeof row.errorCode === 'string' ? { errorCode: row.errorCode } : {}), ...(row.status === 'failed' ? graphSendDiagnostics(row) : {}), ...(row.status === 'succeeded' && result ? { result, deliveryStatus: delivery(message) } : {}), automaticRetry: false };
  }
  function receiptAccess(request: FastifyRequest, row: Entity) {
    const auth = capture(request);
    if (row.operatorUserId !== auth.original.userId || row.membershipId !== auth.original.membershipId) throw new Fault(404, 'not_found');
    if (row.configurationHash !== auth.config) throw new Fault(409, 'configuration_changed');
    if (row.channelId && stateVersion(channel(row.tenantId, String(row.channelId))!) !== row.channelVersion) throw new Fault(409, 'channel_changed');
    if (row.conversationId && conversationVersion(conversation(row.tenantId, String(row.conversationId), String(row.recipient), typeof row.channelId === 'string' ? row.channelId : undefined)) !== row.conversationVersion) throw new Fault(409, 'conversation_changed');
    auth.assert(); return auth;
  }
  app.get(`${prefix}/operations/:key`, route(request => {
    const auth = capture(request), key = z.object({ key: operationKey }).parse(request.params).key;
    const row = store.list(auth.original.tenantId, collection).find(item => item.key === key && item.operatorUserId === auth.original.userId);
    if (!row) throw new Fault(404, 'not_found', 'Operação não encontrada para seu usuário.');
    const current = receiptAccess(request, row), result = publicOperation(row); current.assert(); return result;
  }));
  function assertNoManualOnce(tenant: string, phoneNumberId: string, recipient: string) {
    if (store.db.prepare(`SELECT id FROM entities WHERE tenant_id=? AND collection='reply-jobs' AND json_extract(body,'$.executionMode')='manual_once'
      AND json_extract(body,'$.manualOncePhoneNumberId')=? AND (json_extract(body,'$.recipient')=? OR json_extract(body,'$.originRecipient')=?)
      AND json_extract(body,'$.status') IN ('generating','preparing_send','sending','requires_reconciliation') LIMIT 1`).get(tenant, phoneNumberId, recipient, recipient)) throw new Fault(409, 'recipient_requires_reconciliation');
  }
  async function send(request: FastifyRequest, kind: 'text' | 'template') {
    const body = (kind === 'text' ? textBody.parse(request.body) : templateBody.parse(request.body)) as Data;
    const auth = capture(request), tenant = auth.original.tenantId, env = environment(kind === 'template', tenant);
    const existing = conversation(tenant, body.conversationId, body.to, body.channelId);
    // A caller cannot bypass a conversation's route by omitting channelId.
    const selected = channel(tenant, body.channelId ?? (typeof existing?.channelId === 'string' ? existing.channelId : undefined));
    const snapshot = { channelVersion: selected ? stateVersion(selected) : null, conversationVersion: conversationVersion(existing) };
    const assert = () => { auth.assert(); if (selected && stateVersion(channel(tenant, selected.id)!) !== snapshot.channelVersion) throw new Fault(409, 'channel_changed'); if (existing && conversationVersion(conversation(tenant, existing.id, body.to, selected?.id)) !== snapshot.conversationVersion) throw new Fault(409, 'conversation_changed'); };
    const fingerprint = digest({ kind, body, operatorUserId: auth.original.userId, membershipId: auth.original.membershipId });
    const previous = store.list(tenant, collection).find(row => row.key === body.idempotencyKey);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new Fault(409, 'idempotency_conflict');
      receiptAccess(request, previous); assert();
      if (previous.status !== 'succeeded') throw new Fault(409, 'operation_requires_reconciliation', 'Consulte a operação existente; nenhuma mensagem foi repetida.');
      const result = publicOperation(previous); if (!result.result) throw new Fault(409, 'operation_requires_reconciliation');
      return result.result;
    }
    // Older builds did not bind receipts to an operator. Never turn their keys into a new send.
    if (store.list(tenant, 'provider-operations').some(row => ['meta.send', 'meta.template'].includes(String(row.operation)) && row.key === body.idempotencyKey)) throw new Fault(409, 'legacy_operation_requires_reconciliation');
    if (store.list(tenant, conversationReplyCollection).some(row => row.key === body.idempotencyKey)) throw new Fault(409, 'idempotency_conflict');
    const assertNoHumanReply = () => { if (unresolvedHumanReply(store, tenant, { conversationId: existing?.id, phoneNumberId: env.phoneId, recipient: body.to })) throw new Fault(409, 'recipient_requires_reconciliation'); };
    const receipt = store.transaction(() => {
      assert(); assertNoManualOnce(tenant, env.phoneId, body.to); assertNoHumanReply();
      if (store.list(tenant, collection).some(row => row.key === body.idempotencyKey) || store.list(tenant, conversationReplyCollection).some(row => row.key === body.idempotencyKey)) throw new Fault(409, 'idempotency_conflict');
      if (store.list(tenant, collection).some(row => row.recipient === body.to && row.phoneNumberId === env.phoneId && ['pending', 'unknown'].includes(String(row.status)))) throw new Fault(409, 'recipient_requires_reconciliation', 'Há uma operação pendente ou incerta para este destinatário. Consulte o recibo original; não abra outro envio.');
      const row = store.create(tenant, collection, { key: body.idempotencyKey, kind, fingerprint, operatorUserId: auth.original.userId, membershipId: auth.original.membershipId, configurationHash: auth.config, phoneNumberId: env.phoneId, channelId: selected?.id ?? null, conversationId: existing?.id ?? null, ...snapshot, recipient: body.to, status: 'pending' });
      assert(); return row;
    });
    let attempted = false, externalAccepted = false;
    try {
      if (kind === 'template') {
        const page = await templates(auth, undefined, body.name); assert();
        const matches = page.items.filter(item => item.name === body.name && item.language === body.language);
        if (matches.length !== 1 || !matches[0].sendable || matches[0].bodyParameterCount !== body.bodyParameters.length) throw new Fault(409, 'template_unavailable', 'Use um template aprovado, suportado e com todos os parâmetros do corpo.');
      }
      const payload = { messaging_product: 'whatsapp', recipient_type: 'individual', to: body.to.slice(1), type: kind,
        ...(kind === 'text' ? { text: { preview_url: false, body: body.text } } : { template: { name: body.name, language: { code: body.language }, ...(body.bodyParameters.length ? { components: [{ type: 'body', parameters: body.bodyParameters.map((text: string) => ({ type: 'text', text })) }] } : {}) } }) };
      const { data, messageId } = await sendWhatsAppPayload({ fetcher, env, payload, beforeDispatch: () => { assert(); assertNoManualOnce(tenant, env.phoneId, body.to); assertNoHumanReply(); }, onDispatch: () => { attempted = true; }, onRejected: () => { attempted = false; } });
      externalAccepted = true;
      // Durable external evidence must survive authority revocation during the provider await.
      const recipientIdentity = captureMetaContact(data, { tenantId: tenant, phoneNumberId: env.phoneId, channelId: selected?.id ?? null, channelVersion: snapshot.channelVersion, ownerCollection: 'whatsapp-operations', ownerId: receipt.id, requestedDestination: body.to, providerMessageId: messageId });
      store.update(tenant, collection, receipt.id, { status: 'succeeded', result: { messageId, status: 'accepted' }, ...(recipientIdentity ? { recipientIdentity } : {}) });
      assert();
      const result = store.transaction(() => {
        assert();
        const target = existing ?? store.create(tenant, 'conversations', { channel: 'whatsapp', status: 'open', externalContact: body.to, ...(selected ? { channelId: selected.id, agentId: selected.agentId ?? null } : {}) });
        const message = store.create(tenant, 'messages', { conversationId: target.id, role: 'assistant', authorType: 'human', authorUserId: auth.original.userId, authorMembershipId: auth.original.membershipId, content: kind === 'text' ? body.text : `[Template: ${body.name}] ${body.bodyParameters.join(' | ')}`, recipient: body.to, source: 'meta', deliveryStatus: 'sent', providerMessageId: messageId, phoneNumberId: env.phoneId, ...(kind === 'template' ? { templateName: body.name } : {}) });
        replayMetaDelivery(store, tenant, message.id);
        const result = { messageId, conversationId: target.id, status: 'accepted' };
        store.update(tenant, collection, receipt.id, { status: 'succeeded', result, conversationId: target.id, conversationVersion: conversationVersion(target) }); return result;
      });
      assert(); return result;
    } catch (error) {
      if (!externalAccepted) store.update(tenant, collection, receipt.id, { status: attempted ? 'unknown' : 'failed', errorCode: error instanceof Fault ? error.code : attempted ? 'provider_outcome_unknown' : 'provider_read_failed', ...(error instanceof Fault ? graphSendDiagnostics(error.diagnostics) : {}) });
      // Never disclose the external result after access changed, including known provider failures.
      assert();
      if (error instanceof Fault) throw error;
      throw new Fault(502, attempted ? 'provider_outcome_unknown' : 'provider_read_failed', 'Não foi possível confirmar a operação. Consulte seu estado antes de continuar.');
    }
  }
  app.post(`${prefix}/send`, route(request => send(request, 'text')));
  app.post(`${prefix}/templates/send`, route(request => send(request, 'template')));
  function publicJob(row: Entity) {
    const message = findMetaOutbound(store, row.tenantId, object(row.channelSnapshot) ? row.channelSnapshot.phoneNumberId : undefined, row.outboundMessageId, { collection: 'reply-jobs', id: row.id });
    return { id: row.id, channelId: row.channelId, conversationId: row.conversationId, agentId: row.agentId, status: row.status, attempts: row.attempts, createdAt: row.createdAt, updatedAt: row.updatedAt, version: stateVersion(row), ...(typeof row.errorCode === 'string' && /^[a-z0-9_]{1,100}$/.test(row.errorCode) ? { errorCode: row.errorCode } : {}), ...(row.status === 'sent' ? { deliveryStatus: delivery(message) } : {}) };
  }
  app.get(`${prefix}/jobs`, route(request => {
    const auth = capture(request), query = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1) }).strict().parse(request.query);
    const jobs = store.list(auth.original.tenantId, 'reply-jobs').filter(row => row.provider === 'meta').sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
    auth.assert(); return { items: jobs.slice((query.page - 1) * 25, query.page * 25).map(publicJob), page: query.page, total: jobs.length, totalPages: Math.ceil(jobs.length / 25) };
  }));
  app.post(`${prefix}/jobs/:id/resume`, route(request => {
    const auth = capture(request), jobId = z.object({ id: identifier }).parse(request.params).id;
    const body = z.object({ expectedVersion: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(request.body);
    return store.transaction(() => {
      auth.assert(); const row = store.get(auth.original.tenantId, 'reply-jobs', jobId);
      if (!row || row.provider !== 'meta') throw new Fault(404, 'not_found');
      if (row.executionMode === 'manual_once' || row.admissionMode === 'manual_only' || row.status !== 'paused' || stateVersion(row) !== body.expectedVersion) throw new Fault(409, 'job_not_resumable', 'Atualize a fila; somente uma resposta pausada pode ser retomada.');
      const channelIssue = whatsappJobChannelIssue(store, row); if (channelIssue) throw new Fault(409, channelIssue);
      const currentChannel = channel(row.tenantId, String(row.channelId)), agent = store.get(row.tenantId, 'agents', String(row.agentId));
      if (!agent || agent.status !== 'active' || currentChannel?.agentId !== agent.id) throw new Fault(409, 'channel_unavailable');
      const currentConversation = conversation(row.tenantId, String(row.conversationId), String(row.recipient), String(row.channelId));
      if (metaAutomationBlocked(currentConversation)) throw new Fault(409, 'identity_manual_only');
      if (currentConversation?.status !== 'open' || Array.isArray(currentConversation?.tags) && currentConversation.tags.some(tag => ['no_ai', 'human_handoff'].includes(String(tag)))) throw new Fault(409, 'human_handoff');
      if (!Number.isFinite(row.incomingAt) || Number(row.incomingAt) > now() + 60000 || now() - Number(row.incomingAt) >= 86400000) throw new Fault(409, 'outside_24h_window');
      const messages = store.list(row.tenantId, 'messages').filter(m => m.conversationId === row.conversationId && m.source === 'meta' && m.role === 'user');
      if (!messages.length || messages.at(-1)?.id !== row.sourceMessageId) throw new Fault(409, 'newer_inbound_message');
      auth.assert(); return publicJob(store.update(row.tenantId, 'reply-jobs', row.id, { status: row.replyText ? 'ready_to_send' : 'queued', dueAt: now(), errorCode: null })!);
    });
  }));
  await registerWhatsAppConversationReply(app, store, options);
}
