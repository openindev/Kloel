import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Entity, Store } from './store.js';
import { assertRequestContext, resolveSessionContext, sameRequestContext } from './request-context.js';
import { hasPermission } from './memberships/permissions.js';
import { MembershipError } from './memberships/service.js';
import { canonicalWebchatOrigin, hostedLinkPublished } from './webchat-origins.js';
import { providerAllowedForTenant, platformProvidersEnabled } from './platform-providers.js';

const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
const keySchema = z.string().regex(/^[A-Za-z0-9_-]{8,128}$/);
const configurationSchema = z.object({ allowedOrigins: z.array(z.string().max(2048)).max(50), greeting: z.string().max(1000) }).strict();
const common = { expectedTenantId: identifier, idempotencyKey: keySchema };
const createSchema = z.object({ ...common, agentId: identifier, name: z.string().trim().min(1).max(200), configuration: configurationSchema }).strict();
const controlSchema = z.object({ ...common, expectedVersion: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const updateSchema = controlSchema.extend({ name: z.string().trim().min(1).max(200).optional(), configuration: configurationSchema.partial().optional() })
  .refine(value => value.name !== undefined || value.configuration && Object.keys(value.configuration).length > 0, 'Provide a change');
const operations = 'webchat-channel-operations';
const auditCollection = 'webchat-channel-audit';
const providers = new Set(['openai', 'twilio', 'meta', 'resend', 'google', 'microsoft', 'local']);
type Kind = 'create' | 'update' | 'enable' | 'disable';
type Reason = 'agent_missing' | 'agent_inactive' | 'origins_missing' | 'origins_invalid' | 'provider_unsupported' | 'provider_not_configured' | 'tenant_not_bound' | 'installation_unavailable';
class Fault extends Error { constructor(readonly status: number, readonly code: string, message = 'Atualize o canal e revise a operação antes de continuar.') { super(message); } }
const digest = (value: unknown): string => {
  const canonical = (item: any): any => Array.isArray(item) ? item.map(canonical) : item && typeof item === 'object'
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, canonical(item[key])])) : item;
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
};
const revision = (row: Entity) => row.revision === undefined ? 0 : Number.isSafeInteger(row.revision) && Number(row.revision) >= 0 ? Number(row.revision) : (() => { throw new Fault(409, 'webchat_changed'); })();
const version = (row: Entity) => digest({ schema: 'webchat-channel-v1', row, revision: revision(row) });
function origins(values: string[]): string[] {
  const result = values.map(value => canonicalWebchatOrigin(value));
  if (result.some(value => !value)) throw new Fault(400, 'invalid_origin', 'Use uma origem HTTPS, ou HTTP local, sem caminho, credenciais ou curingas.');
  return [...new Set(result as string[])].sort();
}
const escapeAttribute = (text: string) => text.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/** Local channel effects, audit and opaque receipts commit together. No provider request. */
export async function registerWebchatChannels(app: FastifyInstance, store: Store) {
  const cursorSecret = randomBytes(32), base = '/api/v1/webchat';
  function authority(request: FastifyRequest, write = false) {
    assertRequestContext(store, request);
    if (request.apiKey || request.headers.authorization || !request.cookies?.kloel_session) throw new Fault(401, 'unauthorized', 'Entre com uma sessão da equipe.');
    const sessionHash = createHash('sha256').update(request.cookies.kloel_session).digest('hex');
    const snapshot = resolveSessionContext(store, sessionHash), actor = snapshot?.actor;
    if (!snapshot || !actor || actor.userId !== request.actor?.userId || actor.tenantId !== request.actor?.tenantId) throw new Fault(401, 'unauthorized');
    if (!hasPermission(actor.role, write ? 'channels:write' : 'channels:read') || write && !hasPermission(actor.role, 'agents:read')) throw new Fault(403, 'forbidden', 'Seu acesso não permite gerenciar este canal.');
    return { ...actor, sessionHash, context: snapshot.context };
  }
  function assertSame(request: FastifyRequest, original: ReturnType<typeof authority>, write = false) {
    const current = authority(request, write);
    if (!sameRequestContext(original.context, current.context)) throw new Fault(409, 'context_changed_in_flight', 'O contexto mudou. Consulte o resultado antes de tentar novamente.');
    return current;
  }
  function read(tenant: string, id: string) {
    const row = store.get(tenant, 'channels', id);
    if (!row || row.type !== 'webchat') throw new Fault(404, 'not_found', 'Canal de chat não encontrado.');
    return row;
  }
  function project(row: Entity) {
    const configuration = row.configuration && typeof row.configuration === 'object' && !Array.isArray(row.configuration) ? row.configuration as Record<string, unknown> : {};
    const rawOrigins = Array.isArray(configuration.allowedOrigins) ? configuration.allowedOrigins : [];
    const canonical = rawOrigins.map(canonicalWebchatOrigin), allowedOrigins = [...new Set(canonical.filter((value): value is string => !!value))].sort();
    const reasons: Reason[] = [];
    const agentId = identifier.safeParse(row.agentId).success ? String(row.agentId) : null;
    const agent = agentId ? store.get(row.tenantId, 'agents', agentId) : undefined;
    if (!agent) reasons.push('agent_missing'); else if (agent.status !== 'active') reasons.push('agent_inactive');
    if (!allowedOrigins.length && !hostedLinkPublished(row)) reasons.push('origins_missing'); // link hospedado publicado também atende
    if (!Array.isArray(configuration.allowedOrigins) || canonical.some(value => !value) || rawOrigins.length > 50) reasons.push('origins_invalid');
    if (row.provider !== 'openai') reasons.push('provider_unsupported');
    if (!providerAllowedForTenant(String(row.tenantId))) reasons.push('tenant_not_bound');
    if (!process.env.OPENAI_API_KEY?.trim() || !process.env.OPENAI_MODEL?.trim()) reasons.push('provider_not_configured');
    const engineOrigin = canonicalWebchatOrigin(process.env.PUBLIC_BASE_URL || 'http://127.0.0.1:4310');
    if (!engineOrigin) reasons.push('installation_unavailable');
    const scriptUrl = engineOrigin ? `${engineOrigin}/widget/kloel.js` : null;
    const installation = scriptUrl ? { scriptUrl, tenantId: row.tenantId, channelId: row.id,
      snippet: `<script src="${escapeAttribute(scriptUrl)}" data-kloel-tenant="${escapeAttribute(row.tenantId)}" data-kloel-channel="${escapeAttribute(row.id)}" async></script>` } : null;
    return { id: row.id, tenantId: row.tenantId, agentId, name: typeof row.name === 'string' ? row.name.slice(0, 200) : 'Canal sem nome', type: 'webchat' as const,
      provider: typeof row.provider === 'string' && providers.has(row.provider) ? row.provider : 'unsupported', enabled: row.enabled === true,
      configuration: { allowedOrigins, greeting: typeof configuration.greeting === 'string' ? configuration.greeting.slice(0, 1000) : '' },
      revision: revision(row), version: version(row), createdAt: row.createdAt, updatedAt: row.updatedAt,
      readiness: { canEnable: reasons.length === 0, available: row.enabled === true && reasons.length === 0, reasons }, installation };
  }
  function receipt(current: ReturnType<typeof authority>, key: string) {
    const result = store.db.prepare("SELECT body FROM entities WHERE tenant_id=? AND collection=? AND json_extract(body,'$.key')=? LIMIT 1").get(current.tenantId, operations, key);
    return result ? JSON.parse(String(result.body)) as Entity : undefined;
  }
  function owns(row: Entity, current: ReturnType<typeof authority>) {
    return row.operatorUserId === current.userId && row.sessionHash === current.sessionHash && row.membershipId === current.context.membershipId && row.authorityVersion === current.context.authorityVersion;
  }
  function publicReceipt(row: Entity) {
    const result = row.result as { channelId: string; version: string; revision: number; enabled: boolean };
    return { key: row.key, tenantId: row.tenantId, channelId: row.channelId, kind: row.kind, status: row.status, automaticRetry: false,
      result: { channelId: result.channelId, version: result.version, revision: result.revision, enabled: result.enabled }, createdAt: row.createdAt };
  }
  function wrap(handler: (request: FastifyRequest, reply: FastifyReply) => unknown) {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      reply.header('Cache-Control', 'no-store');
      try { return handler(request, reply); }
      catch (error) {
        if (error instanceof z.ZodError) return reply.code(400).send({ error: { code: 'invalid_input', message: 'Confira os campos da solicitação.' } });
        if (error instanceof Fault) return reply.code(error.status).send({ error: { code: error.code, message: error.message } });
        if (error instanceof MembershipError) return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
        throw error;
      }
    };
  }
  const params = (request: FastifyRequest) => z.object({ id: identifier }).strict().parse(request.params);
  app.get(base + '/channels/:id', wrap(request => {
    const current = authority(request), channel = project(read(current.tenantId, params(request).id)); assertSame(request, current); return channel;
  }));
  app.get(base + '/operations/:key', wrap(request => {
    const current = authority(request, true), { key } = z.object({ key: keySchema }).strict().parse(request.params), row = receipt(current, key);
    if (!row || !owns(row, current)) throw new Fault(404, 'not_found', 'Operação não encontrada para este acesso.');
    assertSame(request, current, true); return publicReceipt(row);
  }));
  app.get(base + '/channels', wrap(request => {
    const current = authority(request), query = z.object({ agentId: identifier.optional(), limit: z.coerce.number().int().min(1).max(100).default(25), cursor: z.string().max(1024).optional() }).strict().parse(request.query);
    const scope = digest({ context: current.context, agentId: query.agentId ?? null, limit: query.limit });
    let snapshot = Number.MAX_SAFE_INTEGER, before = Number.MAX_SAFE_INTEGER;
    if (query.cursor !== undefined) {
      try {
        if (!/^[A-Za-z0-9_-]{40,1024}$/.test(query.cursor)) throw new Error();
        const bytes = Buffer.from(query.cursor, 'base64url'); if (bytes.toString('base64url') !== query.cursor) throw new Error();
        const decipher = createDecipheriv('aes-256-gcm', cursorSecret, bytes.subarray(0, 12)); decipher.setAAD(Buffer.from('webchat-channel-list-v1')); decipher.setAuthTag(bytes.subarray(12, 28));
        const decoded = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8'));
        if (decoded.scope !== scope || !Number.isSafeInteger(decoded.snapshot) || !Number.isSafeInteger(decoded.before) || decoded.snapshot < 1 || decoded.before < 1 || decoded.before > decoded.snapshot) throw new Error();
        snapshot = decoded.snapshot; before = decoded.before;
      } catch { throw new Fault(400, 'invalid_cursor', 'Atualize a lista de canais.'); }
    }
    const where = ["tenant_id=?", "collection='channels'", "json_extract(body,'$.type')='webchat'", 'rowid<=?', 'rowid<?'];
    const args: (string | number)[] = [current.tenantId, snapshot, before];
    if (query.agentId) { where.push("json_extract(body,'$.agentId')=?"); args.push(query.agentId); }
    const rows = store.db.prepare('SELECT rowid AS position,body FROM entities WHERE ' + where.join(' AND ') + ' ORDER BY rowid DESC LIMIT ?').all(...args, query.limit + 1);
    if (!query.cursor && rows.length) snapshot = Number(rows[0].position);
    const selected = rows.slice(0, query.limit), items = selected.map(row => project(JSON.parse(String(row.body)) as Entity));
    let nextCursor: string | null = null;
    if (rows.length > query.limit) {
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', cursorSecret, iv); cipher.setAAD(Buffer.from('webchat-channel-list-v1'));
      const encrypted = Buffer.concat([cipher.update(JSON.stringify({ scope, snapshot, before: Number(selected.at(-1)!.position) })), cipher.final()]);
      nextCursor = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
    }
    assertSame(request, current); return { items, nextCursor, limit: query.limit };
  }));
  function mutate(request: FastifyRequest, reply: FastifyReply, kind: Kind) {
    const original = authority(request, true), id = kind === 'create' ? null : params(request).id;
    const body = kind === 'create' ? createSchema.parse(request.body) : kind === 'update' ? updateSchema.parse(request.body) : controlSchema.parse(request.body);
    if ('configuration' in body && body.configuration?.allowedOrigins) body.configuration.allowedOrigins = origins(body.configuration.allowedOrigins);
    return store.transaction(() => {
      const current = assertSame(request, original, true);
      if (current.tenantId !== body.expectedTenantId) throw new Fault(409, 'tenant_mismatch', 'A organização mudou. Atualize a página.');
      const fingerprint = digest({ kind, id, body }), previousReceipt = receipt(current, body.idempotencyKey);
      if (previousReceipt) {
        if (!owns(previousReceipt, current) || previousReceipt.fingerprint !== fingerprint) throw new Fault(409, 'idempotency_conflict', 'Esta chave pertence a outra operação ou contexto.');
        if (previousReceipt.status !== 'succeeded') throw new Fault(409, 'operation_unresolved', 'Consulte a operação anterior. Nenhuma escrita foi repetida.');
        const channel = project(read(current.tenantId, String(previousReceipt.channelId))); assertSame(request, original, true);
        return { channel, operation: publicReceipt(previousReceipt), replayed: true };
      }
      let saved: Entity;
      if (kind === 'create') {
        const input = body as z.infer<typeof createSchema>;
        if (!store.get(current.tenantId, 'agents', input.agentId)) throw new Fault(404, 'not_found', 'Assistente não encontrado nesta organização.');
        saved = store.create(current.tenantId, 'channels', { name: input.name, agentId: input.agentId, type: 'webchat', provider: 'openai', enabled: false, configuration: input.configuration, revision: 1, verificationStatus: 'unverified' });
      } else {
        const existing = read(current.tenantId, id!);
        if (version(existing) !== (body as z.infer<typeof controlSchema>).expectedVersion) throw new Fault(409, 'webchat_changed', 'O canal mudou. Atualize e revise suas alterações.');
        const nextRevision = revision(existing) + 1;
        if (!Number.isSafeInteger(nextRevision)) throw new Fault(409, 'webchat_changed');
        if (kind === 'enable' && !project(existing).readiness.canEnable) throw new Fault(409, 'webchat_not_ready', 'Confira o assistente, as origens e a configuração do servidor antes de habilitar.');
        const changes: Record<string, unknown> = { revision: nextRevision };
        if (kind === 'update') {
          const input = body as z.infer<typeof updateSchema>;
          if (input.name !== undefined) changes.name = input.name;
          if (input.configuration) changes.configuration = { ...(existing.configuration as object ?? {}), ...input.configuration };
          const candidate = { ...existing, ...changes } as Entity;
          if (existing.enabled === true && !project(candidate).readiness.canEnable) throw new Fault(409, 'webchat_not_ready', 'Desabilite o canal antes de remover os requisitos de atendimento.');
        } else changes.enabled = kind === 'enable';
        saved = store.update(current.tenantId, 'channels', existing.id, changes)!;
      }
      const channel = project(saved);
      const operation = store.create(current.tenantId, operations, { key: body.idempotencyKey, channelId: saved.id, kind, status: 'succeeded', fingerprint,
        operatorUserId: current.userId, sessionHash: current.sessionHash, membershipId: current.context.membershipId, authorityVersion: current.context.authorityVersion,
        result: { channelId: saved.id, version: channel.version, revision: channel.revision, enabled: channel.enabled } });
      store.create(current.tenantId, auditCollection, { channelId: saved.id, operationId: operation.id, kind, actorUserId: current.userId, membershipId: current.context.membershipId, revision: channel.revision });
      assertSame(request, original, true);
      if (kind === 'create') reply.code(201);
      return { channel, operation: publicReceipt(operation), replayed: false };
    });
  }
  app.post(base + '/channels', wrap((request, reply) => mutate(request, reply, 'create')));
  app.patch(base + '/channels/:id', wrap((request, reply) => mutate(request, reply, 'update')));
  for (const kind of ['enable', 'disable'] as const) app.post(`${base}/channels/:id/${kind}`, wrap((request, reply) => mutate(request, reply, kind)));
}
