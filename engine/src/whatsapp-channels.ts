import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { metaCreds } from './meta-tenants.js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Store, Entity } from './store.js';
import { assertRequestContext, resolveSessionContext, sameRequestContext } from './request-context.js';
import { hasPermission } from './memberships/permissions.js';
import { MembershipError } from './memberships/service.js';
import { whatsappDigest as digest, whatsappChannelRevision as revision, whatsappChannelVersion as version } from './whatsapp-channel-state.js';
import { verifyMetaConnection, metaVerificationConfig, MetaVerificationError } from './whatsapp-connection-verification.js';

const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/), keySchema = z.string().regex(/^[A-Za-z0-9_-]{8,128}$/);
const nameSchema = z.string().trim().min(1).max(200), externalIdSchema = z.string().regex(/^\d{1,40}$/), addressSchema = z.string().regex(/^\+[1-9]\d{7,14}$/).nullable();
const common = { expectedTenantId: identifier }, controlSchema = z.object({ ...common, expectedVersion: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const createSchema = z.object({ ...common, name: nameSchema, externalId: externalIdSchema, address: addressSchema.optional().default(null), agentId: identifier.nullable().optional().default(null) }).strict();
const updateSchema = controlSchema.extend({ name: nameSchema.optional(), externalId: externalIdSchema.optional(), address: addressSchema.optional(), agentId: identifier.nullable().optional() }).refine(v => ['name', 'externalId', 'address', 'agentId'].some(k => Object.hasOwn(v, k)), 'Provide a change');
type Kind = 'create' | 'update' | 'enable' | 'disable' | 'delete';
const operations = 'whatsapp-channel-operations', audits = 'whatsapp-channel-audit';
class Fault extends Error { constructor(readonly status: number, readonly code: string) { super(code); } }
function fail(status: number, code: string): never { throw new Fault(status, code); }
const configuration = (row: Entity) => row.configuration && typeof row.configuration === 'object' && !Array.isArray(row.configuration) ? row.configuration as Record<string, unknown> : {};

/** Only local configuration. No network, provider credential or customer-message payload enters the journal. */
export async function registerWhatsAppChannels(app: FastifyInstance, store: Store) {
  const base = '/api/v1/whatsapp', cursorSecret = randomBytes(32);
  function authority(request: FastifyRequest, write = false) {
    assertRequestContext(store, request);
    if (request.apiKey || request.headers.authorization || !request.cookies?.kloel_session) return fail(401, 'unauthorized');
    const sessionHash = createHash('sha256').update(request.cookies.kloel_session).digest('hex'), current = resolveSessionContext(store, sessionHash), actor = current?.actor;
    if (!actor || !current || actor.userId !== request.actor?.userId || actor.tenantId !== request.actor?.tenantId) return fail(401, 'unauthorized');
    if (!hasPermission(actor.role, write ? 'channels:write' : 'channels:read')) return fail(403, 'forbidden');
    return { ...actor, sessionHash, context: current.context };
  }
  function same(request: FastifyRequest, original: ReturnType<typeof authority>, write = false) {
    const current = authority(request, write);
    if (!sameRequestContext(current.context, original.context)) return fail(409, 'context_changed_in_flight');
    return current;
  }
  function read(tenant: string, id: string) { const row = store.get(tenant, 'channels', id); return row?.type === 'whatsapp' ? row : fail(404, 'not_found'); }
  const params = (request: FastifyRequest) => z.object({ id: identifier }).strict().parse(request.params).id;
  function duplicate(tenant: string, externalId: unknown, id?: string) {
    return typeof externalId === 'string' && store.list(tenant, 'channels').some(r => r.id !== id && r.type === 'whatsapp' && configuration(r).externalId === externalId);
  }
  function readiness(row: Entity) {
    const c = configuration(row), reasons: string[] = [], agent = typeof row.agentId === 'string' ? store.get(row.tenantId, 'agents', row.agentId) : undefined;
    if (row.provider !== 'meta') reasons.push('provider_unsupported');
    if (!externalIdSchema.safeParse(c.externalId).success) reasons.push('external_id_invalid');
    if (duplicate(row.tenantId, c.externalId, row.id)) reasons.push('duplicate_external_id');
    if (!agent) reasons.push('agent_missing'); else if (agent.status !== 'active') reasons.push('agent_inactive');
    const mc = metaCreds(row.tenantId);
    if (!mc) reasons.push('tenant_not_bound');
    if (mc && c.externalId !== mc.phoneId) reasons.push('phone_id_mismatch');
    if (!mc?.token || !/^v\d+\.\d+$/.test(mc?.version ?? '') || !externalIdSchema.safeParse(mc?.phoneId).success) reasons.push('send_not_configured');
    if (!process.env.META_APP_SECRET?.trim() || !process.env.META_VERIFY_TOKEN?.trim()) reasons.push('webhook_not_configured');
    if (!process.env.OPENAI_API_KEY?.trim() || !process.env.OPENAI_MODEL?.trim()) reasons.push('ai_not_configured');
    return { canEnable: reasons.length === 0, reasons };
  }
  function project(row: Entity) {
    const c = configuration(row);
    return { id: row.id, tenantId: row.tenantId, name: typeof row.name === 'string' ? row.name : '', type: 'whatsapp', provider: row.provider, enabled: row.enabled === true,
      agentId: identifier.safeParse(row.agentId).success ? row.agentId : null, externalId: externalIdSchema.safeParse(c.externalId).success ? c.externalId : null,
      address: addressSchema.safeParse(c.address).success ? c.address ?? null : null, verificationStatus: 'unverified', revision: revision(row), version: version(row), createdAt: row.createdAt, updatedAt: row.updatedAt, readiness: readiness(row) };
  }
  function receipt(tenant: string, key: string): Entity | undefined {
    const r = store.db.prepare("SELECT body FROM entities WHERE tenant_id=? AND collection=? AND json_extract(body,'$.key')=? LIMIT 1").get(tenant, operations, key);
    return r ? JSON.parse(String(r.body)) : undefined;
  }
  function owns(row: Entity, current: ReturnType<typeof authority>) {
    return row.operatorUserId === current.userId && row.sessionHash === current.sessionHash && row.membershipId === current.context.membershipId && row.authorityVersion === current.context.authorityVersion;
  }
  function publicReceipt(row: Entity) {
    const r = row.result as Record<string, unknown>;
    return { key: row.key, tenantId: row.tenantId, channelId: row.channelId, kind: row.kind, status: 'succeeded', result: { channelId: r.channelId, revision: r.revision, version: r.version, enabled: r.enabled, deleted: r.deleted }, automaticRetry: false, createdAt: row.createdAt };
  }
  function wrap<T>(handler: (request: FastifyRequest, reply: FastifyReply) => T | Promise<T>) {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      reply.header('Cache-Control', 'no-store');
      try { return await handler(request, reply); }
      catch (error) {
        if (error instanceof z.ZodError) return reply.code(400).send({ error: { code: 'invalid_input', message: 'Confira os campos do canal WhatsApp.' } });
        if (error instanceof Fault) return reply.code(error.status).send({ error: { code: error.code, message: error.code } });
        if (error instanceof MetaVerificationError) return reply.code(error.status).send({ error: { code: error.code, message: 'Não foi possível confirmar os metadados da conexão Meta. A configuração não foi alterada.' } });
        if (error instanceof MembershipError) return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
        throw error;
      }
    };
  }
  app.get(base + '/channels/:id', wrap(request => { const original = authority(request), result = project(read(original.tenantId, params(request))); same(request, original); return result; }));
  const verifying = new Set<string>();
  app.post(base + '/channels/:id/verify-connection', wrap(async request => {
    const original = authority(request), body = controlSchema.parse(request.body), channelId = params(request);
    if (!hasPermission(original.role, 'integrations:manage')) return fail(403, 'forbidden');
    if (body.expectedTenantId !== original.tenantId) return fail(409, 'tenant_mismatch');
    const row = read(original.tenantId, channelId);
    if (row.provider !== 'meta') return fail(409, 'provider_unsupported');
    if (version(row) !== body.expectedVersion) return fail(409, 'whatsapp_channel_configuration_changed');
    const config = metaVerificationConfig(original.tenantId, configuration(row).externalId), configHash = digest(config);
    const assertAccess = () => {
      const current = same(request, original);
      if (!hasPermission(current.role, 'integrations:manage')) return fail(403, 'forbidden');
      const currentRow = read(current.tenantId, channelId);
      if (version(currentRow) !== body.expectedVersion) return fail(409, 'whatsapp_channel_configuration_changed');
      if (digest(metaVerificationConfig(current.tenantId, configuration(currentRow).externalId)) !== configHash) return fail(409, 'meta_verification_configuration_changed');
    };
    assertAccess();
    if (verifying.has(original.tenantId)) return fail(429, 'meta_verification_busy');
    verifying.add(original.tenantId);
    try { const result = await verifyMetaConnection(config, assertAccess); assertAccess(); return { channelId, tenantId: original.tenantId, version: body.expectedVersion, ...result }; }
    finally { verifying.delete(original.tenantId); }
  }));
  app.get(base + '/channel-operations/:key', wrap(request => {
    const original = authority(request, true), key = z.object({ key: keySchema }).strict().parse(request.params).key, row = receipt(original.tenantId, key);
    if (!row || !owns(row, original)) return fail(404, 'operation_not_found');
    same(request, original, true); return publicReceipt(row);
  }));
  app.get(base + '/channels', wrap(request => {
    const original = authority(request), q = z.object({ agentId: identifier.optional(), limit: z.coerce.number().int().min(1).max(100).default(25), cursor: z.string().max(1024).optional() }).strict().parse(request.query);
    const scope = digest({ context: original.context, limit: q.limit, agentId: q.agentId ?? null }); let snapshot = Number.MAX_SAFE_INTEGER, before = Number.MAX_SAFE_INTEGER;
    if (q.cursor) {
      try {
        if (!/^[A-Za-z0-9_-]{40,1024}$/.test(q.cursor)) throw Error();
        const bytes = Buffer.from(q.cursor, 'base64url'); if (bytes.toString('base64url') !== q.cursor) throw Error();
        const decipher = createDecipheriv('aes-256-gcm', cursorSecret, bytes.subarray(0, 12)); decipher.setAAD(Buffer.from('whatsapp-channel-list-v1')); decipher.setAuthTag(bytes.subarray(12, 28));
        const data = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString());
        if (data.scope !== scope || !Number.isSafeInteger(data.snapshot) || !Number.isSafeInteger(data.before) || data.before < 1 || data.before > data.snapshot) throw Error(); snapshot = data.snapshot; before = data.before;
      } catch { return fail(400, 'invalid_cursor'); }
    }
    const rows = store.db.prepare("SELECT rowid AS position,body FROM entities WHERE tenant_id=? AND collection='channels' AND json_extract(body,'$.type')='whatsapp' AND rowid<=? AND rowid<?" + (q.agentId ? " AND json_extract(body,'$.agentId')=?" : '') + ' ORDER BY rowid DESC LIMIT ?').all(original.tenantId, snapshot, before, ...(q.agentId ? [q.agentId] : []), q.limit + 1);
    if (!q.cursor && rows.length) snapshot = Number(rows[0].position);
    const selected = rows.slice(0, q.limit); let nextCursor: string | null = null;
    if (rows.length > q.limit) {
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', cursorSecret, iv); cipher.setAAD(Buffer.from('whatsapp-channel-list-v1'));
      const bytes = Buffer.concat([cipher.update(JSON.stringify({ scope, snapshot, before: Number(selected.at(-1)!.position) })), cipher.final()]); nextCursor = Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString('base64url');
    }
    const items = selected.map(r => project(JSON.parse(String(r.body)))); same(request, original); return { items, nextCursor, limit: q.limit };
  }));
  function mutate(request: FastifyRequest, reply: FastifyReply, kind: Kind) {
    const original = authority(request, true), key = keySchema.parse(request.headers['idempotency-key']), id = kind === 'create' ? null : params(request);
    const body = kind === 'create' ? createSchema.parse(request.body) : kind === 'update' ? updateSchema.parse(request.body) : controlSchema.parse(request.body), fingerprint = digest({ kind, id, body });
    const result = store.transaction(() => {
      const current = same(request, original, true); if (current.tenantId !== body.expectedTenantId) return fail(409, 'tenant_mismatch');
      const previousReceipt = receipt(current.tenantId, key);
      if (previousReceipt) {
        if (!owns(previousReceipt, current) || previousReceipt.fingerprint !== fingerprint || previousReceipt.kind !== kind || previousReceipt.status !== 'succeeded') return fail(409, 'idempotency_conflict');
        return { operation: publicReceipt(previousReceipt), replayed: true };
      }
      const old = id ? store.get(current.tenantId, 'channels', id) : undefined;
      if (kind !== 'create' && (!old || old.type !== 'whatsapp' || version(old) !== (body as z.infer<typeof controlSchema>).expectedVersion)) return fail(409, 'whatsapp_channel_configuration_changed');
      const nextRevision = old ? revision(old) + 1 : 1; if (!Number.isSafeInteger(nextRevision)) return fail(409, 'whatsapp_channel_configuration_changed');
      const input = body as z.infer<typeof createSchema> & z.infer<typeof updateSchema>, routeChange = kind === 'update' && input.agentId !== undefined && input.agentId !== old?.agentId;
      if ((kind === 'enable' || routeChange && old?.enabled === true) && !hasPermission(current.role, 'integrations:manage')) return fail(403, 'forbidden');
      if ((kind === 'create' || input.agentId !== undefined) && input.agentId) {
        if (!hasPermission(current.role, 'agents:read')) return fail(403, 'forbidden');
        if (!store.get(current.tenantId, 'agents', input.agentId)) return fail(404, 'not_found');
      }
      const cfg = old ? configuration(old) : {};
      if (kind === 'create' || kind === 'enable' || kind === 'update' && input.externalId !== undefined && input.externalId !== cfg.externalId) {
        if (duplicate(current.tenantId, input.externalId ?? cfg.externalId, id ?? undefined)) return fail(409, 'duplicate_channel');
      }
      if (kind === 'update' && input.externalId !== undefined && input.externalId !== cfg.externalId && old!.enabled === true) return fail(409, 'channel_must_be_disabled');
      let saved: Entity, deleted = false;
      if (kind === 'create') {
        saved = store.create(current.tenantId, 'channels', { name: input.name, type: 'whatsapp', provider: 'meta', enabled: false, agentId: input.agentId, configuration: { externalId: input.externalId, address: input.address }, verificationStatus: 'unverified', revision: nextRevision });
      } else if (kind === 'delete') {
        if (store.list(current.tenantId, 'phone-numbers').some(r => r.channelId === id)) return fail(409, 'resource_in_use');
        saved = { ...old!, revision: nextRevision, enabled: false }; deleted = true; store.remove(current.tenantId, 'channels', id!);
      } else {
        const patch: Record<string, unknown> = { revision: nextRevision };
        if (kind === 'enable' || kind === 'disable') patch.enabled = kind === 'enable';
        if (kind === 'update') {
          if (input.name !== undefined) patch.name = input.name;
          if (input.agentId !== undefined) patch.agentId = input.agentId;
          if (input.externalId !== undefined || input.address !== undefined) patch.configuration = { ...cfg, ...(input.externalId !== undefined ? { externalId: input.externalId } : {}), ...(input.address !== undefined ? { address: input.address } : {}) };
        }
        if ((kind === 'enable' || routeChange && old!.enabled === true) && !readiness({ ...old!, ...patch }).canEnable) return fail(409, 'channel_not_ready');
        saved = store.update(current.tenantId, 'channels', id!, patch)!;
      }
      const operation = store.create(current.tenantId, operations, { key, kind, channelId: saved.id, fingerprint, status: 'succeeded', operatorUserId: current.userId, sessionHash: current.sessionHash, membershipId: current.context.membershipId, authorityVersion: current.context.authorityVersion, result: { channelId: saved.id, revision: nextRevision, version: version(saved), enabled: saved.enabled === true, deleted } });
      store.create(current.tenantId, audits, { channelId: saved.id, operationId: operation.id, kind, actorUserId: current.userId, membershipId: current.context.membershipId, revision: nextRevision }); same(request, original, true);
      return { operation: publicReceipt(operation), replayed: false };
    });
    same(request, original, true); if (kind === 'create' && !result.replayed) reply.code(201); return result;
  }
  app.post(base + '/channels', wrap((r, p) => mutate(r, p, 'create')));
  app.patch(base + '/channels/:id', wrap((r, p) => mutate(r, p, 'update')));
  app.delete(base + '/channels/:id', wrap((r, p) => mutate(r, p, 'delete')));
  for (const kind of ['enable', 'disable'] as const) app.post(`${base}/channels/:id/${kind}`, wrap((r, p) => mutate(r, p, kind)));
}
