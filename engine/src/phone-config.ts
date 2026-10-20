import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Store, Entity } from './store.js';
import { assertRequestContext, resolveSessionContext, sameRequestContext } from './request-context.js';
import { hasPermission } from './memberships/permissions.js';
import { MembershipError } from './memberships/service.js';
import { PhoneConfigError, verifyPhoneOwnership, type OwnershipProof } from './phone-config/twilio-proof.js';

const idSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
const keySchema = z.string().regex(/^[A-Za-z0-9_-]{8,128}$/);
const nameSchema = z.string().trim().min(1).max(200);
const routeFields = { agentId: idSchema.nullable().optional(), channelId: idSchema.nullable().optional() };
const common = { expectedTenantId: idSchema };
const createSchema = z.object({ ...common, name: nameSchema, number: z.string().regex(/^\+[1-9]\d{7,14}$/), providerNumberId: z.string().regex(/^PN[0-9a-fA-F]{32}$/), ...routeFields }).strict();
const controlSchema = z.object({ ...common, expectedVersion: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const updateSchema = controlSchema.extend({ name: nameSchema.optional(), ...routeFields }).refine(v => v.name !== undefined || v.agentId !== undefined || v.channelId !== undefined, 'Provide a change');
const operations = 'phone-config-operations', audits = 'phone-config-audit', collection = 'phone-numbers';
type Kind = 'create' | 'update' | 'delete';
type Route = Record<string, unknown> & { agentId?: unknown; channelId?: unknown };
const fail = (status: number, code: string): never => { throw new PhoneConfigError(status, code); };
const digest = (value: unknown): string => {
  const canonical = (x: any): any => Array.isArray(x) ? x.map(canonical) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map(k => [k, canonical(x[k])])) : x;
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
};
const revision = (row: Entity): number => row.revision === undefined ? 0 : Number.isSafeInteger(row.revision) && Number(row.revision) >= 0 ? Number(row.revision) : fail(409, 'phone_configuration_changed');
const version = (row: Entity) => digest({ schema: 'phone-config-v1', row, revision: revision(row) });
const nullableId = (value: unknown): string | null => idSchema.safeParse(value).success ? String(value) : null;
function project(row: Entity) {
  const proof = row.ownership as Record<string, unknown> | undefined;
  return { id: row.id, tenantId: row.tenantId, name: typeof row.name === 'string' ? row.name : '', number: typeof row.number === 'string' ? row.number : '', provider: row.provider,
    providerNumberId: typeof row.providerNumberId === 'string' ? row.providerNumberId : null, agentId: nullableId(row.agentId), channelId: nullableId(row.channelId),
    capabilities: Array.isArray(row.capabilities) ? [...new Set(row.capabilities.filter(c => ['voice', 'sms', 'whatsapp'].includes(String(c))))] : [],
    provisioningStatus: 'unverified', revision: revision(row), version: version(row), createdAt: row.createdAt, updatedAt: row.updatedAt,
    ownership: proof?.source === 'twilio' && typeof proof.checkedAt === 'string' && Number.isFinite(Date.parse(proof.checkedAt)) && ['registration', 'routing'].includes(String(proof.scope))
      ? { source: 'twilio', checkedAt: proof.checkedAt, scope: proof.scope } : null };
}

/** Private local intentions. Provider reads finish before the atomic local commit. */
export async function registerPhoneConfig(app: FastifyInstance, store: Store) {
  const base = '/api/v1/phone-config', cursorSecret = randomBytes(32);
  function authority(request: FastifyRequest, write = false) {
    assertRequestContext(store, request);
    if (request.apiKey || request.headers.authorization || !request.cookies?.kloel_session) return fail(401, 'unauthorized');
    const sessionHash = createHash('sha256').update(request.cookies.kloel_session).digest('hex'), current = resolveSessionContext(store, sessionHash), actor = current?.actor;
    if (!actor || !current || request.actor?.userId !== actor.userId || request.actor?.tenantId !== actor.tenantId) return fail(401, 'unauthorized');
    if (!hasPermission(actor.role, write ? 'phones:write' : 'phones:read')) return fail(403, 'forbidden');
    return { ...actor, sessionHash, context: current.context };
  }
  function same(request: FastifyRequest, original: ReturnType<typeof authority>, write = false) {
    const current = authority(request, write);
    if (!sameRequestContext(original.context, current.context)) return fail(409, 'context_changed_in_flight');
    return current;
  }
  function read(tenant: string, id: string): Entity { return store.get(tenant, collection, id) ?? fail(404, 'not_found'); }
  function owned(row: Entity, current: ReturnType<typeof authority>) {
    return row.operatorUserId === current.userId && row.sessionHash === current.sessionHash && row.membershipId === current.context.membershipId && row.authorityVersion === current.context.authorityVersion;
  }
  function receipt(tenant: string, key: string): Entity | undefined {
    const row = store.db.prepare("SELECT body FROM entities WHERE tenant_id=? AND collection=? AND json_extract(body,'$.key')=? LIMIT 1").get(tenant, operations, key);
    return row ? JSON.parse(String(row.body)) : undefined;
  }
  function publicReceipt(row: Entity) {
    const result = row.result as { numberId: string; revision: number; version: string; deleted: boolean };
    return { key: row.key, tenantId: row.tenantId, kind: row.kind, numberId: row.numberId, status: 'succeeded',
      result: { numberId: result.numberId, revision: result.revision, version: result.version, deleted: result.deleted }, automaticRetry: false, createdAt: row.createdAt };
  }
  function references(tenant: string, route: Route, validate: boolean) {
    const channelId = nullableId(route.channelId), channel = channelId ? store.get(tenant, 'channels', channelId) : undefined;
    const agentId = nullableId(route.agentId), effectiveAgentId = agentId ?? nullableId(channel?.agentId), agent = effectiveAgentId ? store.get(tenant, 'agents', effectiveAgentId) : undefined;
    if (validate && (channelId && (!channel || channel.type !== 'phone' || channel.provider !== 'twilio' || channel.enabled !== true)
      || (agentId || channelId) && (!agent || agent.status !== 'active')
      || agentId && channel?.agentId && agentId !== channel.agentId)) return fail(409, 'phone_route_invalid');
    return digest({ channel: channel ?? null, agent: agent ?? null });
  }
  const routeOf = (row: Route) => ({ agentId: nullableId(row.agentId), channelId: nullableId(row.channelId) });
  const unique = (tenant: string, number: unknown, providerNumberId: unknown, id?: string) => {
    if (store.list(tenant, collection).some(r => r.id !== id && (r.number === number || providerNumberId && r.providerNumberId === providerNumberId))) fail(409, 'phone_duplicate_number');
  };
  const parameters = (request: FastifyRequest) => z.object({ id: idSchema }).strict().parse(request.params).id;
  function wrap(handler: (request: FastifyRequest, reply: FastifyReply) => unknown) {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      reply.header('Cache-Control', 'no-store');
      try { return await handler(request, reply); }
      catch (error) {
        if (error instanceof z.ZodError) return reply.code(400).send({ error: { code: 'invalid_input', message: 'Confira os campos da configuração do número.' } });
        if (error instanceof PhoneConfigError) return reply.code(error.status).send({ error: { code: error.code, message: error.message } });
        if (error instanceof MembershipError) return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
        throw error;
      }
    };
  }
  app.get(base + '/numbers/:id', wrap(request => {
    const original = authority(request), row = project(read(original.tenantId, parameters(request))); same(request, original); return row;
  }));
  app.get(base + '/operations/:key', wrap(request => {
    const original = authority(request, true), key = z.object({ key: keySchema }).strict().parse(request.params).key, row = receipt(original.tenantId, key);
    if (!row || !owned(row, original)) return fail(404, 'operation_not_found');
    same(request, original, true); return publicReceipt(row);
  }));
  app.get(base + '/numbers', wrap(request => {
    const original = authority(request), q = z.object({ limit: z.coerce.number().int().min(1).max(100).default(25), cursor: z.string().max(1024).optional() }).strict().parse(request.query);
    const scope = digest({ context: original.context, limit: q.limit }); let snapshot = Number.MAX_SAFE_INTEGER, before = Number.MAX_SAFE_INTEGER;
    if (q.cursor) {
      try {
        if (!/^[A-Za-z0-9_-]{40,1024}$/.test(q.cursor)) throw new Error();
        const bytes = Buffer.from(q.cursor, 'base64url'); if (bytes.toString('base64url') !== q.cursor) throw new Error();
        const decipher = createDecipheriv('aes-256-gcm', cursorSecret, bytes.subarray(0, 12)); decipher.setAAD(Buffer.from('phone-config-list-v1')); decipher.setAuthTag(bytes.subarray(12, 28));
        const data = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8'));
        if (data.scope !== scope || !Number.isSafeInteger(data.snapshot) || !Number.isSafeInteger(data.before) || data.snapshot < 1 || data.before < 1 || data.before > data.snapshot) throw new Error();
        snapshot = data.snapshot; before = data.before;
      } catch { return fail(400, 'invalid_cursor'); }
    }
    const rows = store.db.prepare('SELECT rowid AS position,body FROM entities WHERE tenant_id=? AND collection=? AND rowid<=? AND rowid<? ORDER BY rowid DESC LIMIT ?').all(original.tenantId, collection, snapshot, before, q.limit + 1);
    if (!q.cursor && rows.length) snapshot = Number(rows[0].position);
    const selected = rows.slice(0, q.limit), items = selected.map(r => project(JSON.parse(String(r.body)))); let nextCursor: string | null = null;
    if (rows.length > q.limit) {
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', cursorSecret, iv); cipher.setAAD(Buffer.from('phone-config-list-v1'));
      const encrypted = Buffer.concat([cipher.update(JSON.stringify({ scope, snapshot, before: Number(selected.at(-1)!.position) })), cipher.final()]);
      nextCursor = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
    }
    same(request, original); return { items, nextCursor, limit: q.limit };
  }));

  async function mutate(request: FastifyRequest, reply: FastifyReply, kind: Kind) {
    const original = authority(request, true), key = keySchema.parse(request.headers['idempotency-key']), id = kind === 'create' ? null : parameters(request);
    const body = kind === 'create' ? createSchema.parse(request.body) : kind === 'update' ? updateSchema.parse(request.body) : controlSchema.parse(request.body);
    if (kind === 'create') Object.assign(body, routeOf(body));
    const fingerprint = digest({ kind, id, body });
    function access() {
      const current = same(request, original, true);
      if (current.tenantId !== body.expectedTenantId) return fail(409, 'tenant_mismatch');
      return current;
    }
    function replay() {
      const current = access(), previous = receipt(current.tenantId, key); if (!previous) return;
      if (!owned(previous, current) || previous.fingerprint !== fingerprint || previous.kind !== kind || previous.status !== 'succeeded') return fail(409, 'idempotency_conflict');
      return { operation: publicReceipt(previous), replayed: true };
    }
    function existing() {
      const row = read(original.tenantId, id!);
      if (version(row) !== (body as z.infer<typeof controlSchema>).expectedVersion) return fail(409, 'phone_configuration_changed');
      return row;
    }
    // This admission snapshot and the commit each check the journal before CAS.
    const preparation = store.transaction(() => {
      const recovered = replay(); if (recovered) return { recovered };
      const old = kind === 'create' ? undefined : existing();
      const candidate: Route = kind === 'create' ? body as z.infer<typeof createSchema> : { ...old!, ...body };
      const routeChanged = kind === 'create' || kind === 'update' && digest(routeOf(old!)) !== digest(routeOf(candidate));
      const needsProof = kind === 'create' || routeChanged && !!(candidate.agentId || candidate.channelId);
      if (needsProof && old && old.provider !== 'twilio') return fail(409, 'phone_route_invalid');
      const referenceVersion = references(original.tenantId, candidate, needsProof);
      if (kind !== 'delete') unique(original.tenantId, candidate.number, candidate.providerNumberId, id ?? undefined);
      return { old, candidate, needsProof, referenceVersion };
    });
    if (preparation.recovered) return preparation.recovered;
    const { candidate, needsProof, referenceVersion } = preparation;
    let proof: OwnershipProof | undefined;
    if (needsProof) proof = await verifyPhoneOwnership(original.tenantId, String(candidate!.number), String(candidate!.providerNumberId), access);
    const result = store.transaction(() => {
      const recovered = replay(); if (recovered) return recovered;
      proof?.assertCurrent();
      const old = kind === 'create' ? undefined : existing();
      if (needsProof && references(original.tenantId, candidate!, true) !== referenceVersion) return fail(409, 'phone_references_changed');
      if (kind !== 'delete') unique(original.tenantId, candidate!.number, candidate!.providerNumberId, id ?? undefined);
      const nextRevision = old ? revision(old) + 1 : 1; if (!Number.isSafeInteger(nextRevision)) return fail(409, 'phone_configuration_changed');
      let saved: Entity, deleted = false;
      if (kind === 'create') {
        const input = body as z.infer<typeof createSchema>;
        saved = store.create(original.tenantId, collection, { name: input.name, number: input.number, provider: 'twilio', providerNumberId: input.providerNumberId, ...routeOf(input),
          capabilities: proof!.capabilities, provisioningStatus: 'unverified', revision: nextRevision, ownership: { source: 'twilio', checkedAt: proof!.checkedAt, scope: 'registration' } });
      } else if (kind === 'update') {
        const input = body as z.infer<typeof updateSchema>, patch: Record<string, unknown> = { revision: nextRevision };
        if (input.name !== undefined) patch.name = input.name;
        if (input.agentId !== undefined) patch.agentId = input.agentId;
        if (input.channelId !== undefined) patch.channelId = input.channelId;
        if (proof) { patch.ownership = { source: 'twilio', checkedAt: proof.checkedAt, scope: 'routing' }; patch.capabilities = proof.capabilities; }
        saved = store.update(original.tenantId, collection, id!, patch)!;
      } else {
        saved = { ...old!, revision: nextRevision }; deleted = true; store.remove(original.tenantId, collection, id!);
      }
      const effect = { numberId: saved.id, revision: nextRevision, version: version(saved), deleted };
      const operation = store.create(original.tenantId, operations, { key, kind, numberId: saved.id, status: 'succeeded', fingerprint,
        operatorUserId: original.userId, sessionHash: original.sessionHash, membershipId: original.context.membershipId, authorityVersion: original.context.authorityVersion, result: effect });
      store.create(original.tenantId, audits, { kind, numberId: saved.id, operationId: operation.id, actorUserId: original.userId, membershipId: original.context.membershipId, revision: nextRevision });
      access(); proof?.assertCurrent();
      return { operation: publicReceipt(operation), replayed: false };
    });
    same(request, original, true); if (kind === 'create' && !result.replayed) reply.code(201); return result;
  }
  app.post(base + '/numbers', wrap((request, reply) => mutate(request, reply, 'create')));
  app.patch(base + '/numbers/:id', wrap((request, reply) => mutate(request, reply, 'update')));
  app.delete(base + '/numbers/:id', wrap((request, reply) => mutate(request, reply, 'delete')));
}
