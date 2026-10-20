import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Entity, Store } from '../store.js';
import { DomainError } from '../domains.js';
import { OAuthError } from '../oauth/client.js';
import { digest } from '../oauth/crypto.js';
import { hasPermission } from '../memberships/permissions.js';
import { MembershipError } from '../memberships/service.js';
import { assertRequestContext, resolveSessionContext, sameRequestContext } from '../request-context.js';
import { baserowBindings, baserowOperations, configureBaserowTable, createBaserowRow, parseBaserowConfiguration, publicBaserowBinding } from './baserow.js';
import { boundedJson } from './schema.js';
import type { IntegrationTransport } from './transport.js';

export const baserowHttpOperations = 'baserow-http-operations';
const auditCollection = 'baserow-http-audit';
const keySchema = z.string().regex(/^[A-Za-z0-9_-]{8,128}$/);
const tenantSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
const revisionSchema = z.number().int().positive().safe();
type Kind = 'binding.create' | 'binding.update' | 'binding.set_enabled' | 'row.create';
const kinds = z.enum(['binding.create', 'binding.update', 'binding.set_enabled', 'row.create']);
const remoteStatuses = z.enum(['pending', 'created', 'not_sent', 'uncertain']);
const fail = (status: number, code: string): never => { throw new DomainError(status, code, 'A operação Baserow está indisponível ou mudou. Consulte a referência antes de tentar novamente.'); };
const canonical = (v: unknown): any => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical((v as Record<string, unknown>)[k])])) : v;

/** Human HTTP principal only. Native service and agent callers do not acquire this dependency. */
function authority(store: Store, request: FastifyRequest) {
  assertRequestContext(store, request);
  const sessionHash = digest(request.cookies?.kloel_session ?? ''), initial = resolveSessionContext(store, sessionHash);
  if (request.apiKey || !request.cookies?.kloel_session || !initial?.actor || !request.actor
    || initial.actor.userId !== request.actor.userId || initial.actor.tenantId !== request.actor.tenantId) return fail(401, 'authentication_required');
  const actor = initial.actor;
  const assertLive = () => {
    assertRequestContext(store, request);
    const current = resolveSessionContext(store, sessionHash);
    if (!current?.actor || !sameRequestContext(initial.context, current.context)) throw new MembershipError(409, 'context_changed_in_flight', 'O contexto mudou durante a operação. Consulte o recibo antes de tentar novamente.');
  };
  return { actor, sessionHash, context: initial.context, assertLive };
}
type Authority = ReturnType<typeof authority>;
function permitted(a: Authority, kind: Kind) {
  a.assertLive();
  if (!hasPermission(a.actor.role, kind === 'row.create' ? 'integrations:execute' : 'integrations:manage')) fail(403, 'forbidden');
}
function owns(row: Entity, a: Authority) {
  return row.tenantId === a.actor.tenantId && row.userId === a.actor.userId && row.sessionHash === a.sessionHash
    && row.membershipId === a.context.membershipId && row.authorityVersion === a.context.authorityVersion;
}
function find(store: Store, tenant: string, key: string): Entity | undefined {
  const rows = store.db.prepare("SELECT body FROM entities WHERE tenant_id=? AND collection=? AND json_extract(body,'$.key')=? LIMIT 2").all(tenant, baserowHttpOperations, key);
  if (rows.length > 1) return fail(409, 'baserow_operation_unavailable');
  return rows[0] ? JSON.parse(String(rows[0].body)) : undefined;
}
function nativeReceipt(store: Store, row: Entity): Entity | undefined {
  if (row.nativeOperationId === null) return undefined;
  if (!z.string().uuid().safeParse(row.nativeOperationId).success) return fail(409, 'baserow_operation_unavailable');
  const native = store.get(row.tenantId, baserowOperations, String(row.nativeOperationId));
  if (!native || native.tenantId !== row.tenantId || native.httpOperationId !== row.id || native.bindingId !== row.bindingId || native.revision !== row.revision || native.userId !== row.userId) return fail(409, 'baserow_operation_unavailable');
  return native;
}
function project(store: Store, row: Entity) {
  const kind = kinds.safeParse(row.kind);
  if (!kind.success || !keySchema.safeParse(row.key).success || !z.string().uuid().safeParse(row.bindingId).success
    || !revisionSchema.safeParse(row.revision).success || row.schemaVersion !== 2 || !z.string().datetime({ offset: true }).safeParse(row.createdAt).success) return fail(409, 'baserow_operation_unavailable');
  const native = nativeReceipt(store, row), remote = kind.data === 'row.create';
  if (!remote && (row.status !== 'succeeded' || native) || remote && (!['pending', 'not_sent'].includes(String(row.status)) || !native && row.nativeOperationId !== null)) return fail(409, 'baserow_operation_unavailable');
  const nativeStatus = native ? remoteStatuses.safeParse(native.status) : undefined;
  if (nativeStatus && !nativeStatus.success) return fail(409, 'baserow_operation_unavailable');
  const status = nativeStatus?.success ? nativeStatus.data : String(row.status);
  if (native && row.status !== 'pending') return fail(409, 'baserow_operation_unavailable');
  const rowId = native?.rowId ?? null;
  if (status === 'created' ? !z.number().int().positive().safe().safeParse(rowId).success : rowId !== null) return fail(409, 'baserow_operation_unavailable');
  const errorCode = native?.errorCode ?? row.errorCode ?? null, updatedAt = native?.updatedAt ?? row.updatedAt;
  if (errorCode !== null && (typeof errorCode !== 'string' || !/^[a-zA-Z0-9_:-]{1,100}$/.test(errorCode)) || !z.string().datetime({ offset: true }).safeParse(updatedAt).success) return fail(409, 'baserow_operation_unavailable');
  return { key: String(row.key), kind: kind.data, status, bindingId: String(row.bindingId), revision: Number(row.revision), nativeOperationId: native?.id ?? null,
    rowId, errorCode, requiresReconciliation: ['pending', 'uncertain'].includes(status), automaticRetry: false as const, createdAt: row.createdAt, updatedAt };
}
function fingerprint(kind: Kind, targetId: string | null, input: unknown) { return digest(boundedJson(canonical({ kind, targetId, input }), 64000)); }
function replay(store: Store, a: Authority, key: string, hash: string) {
  const old = find(store, a.actor.tenantId, key);
  if (!old) return undefined;
  if (!owns(old, a) || old.fingerprint !== hash) return fail(409, 'idempotency_conflict');
  const operation = project(store, old); a.assertLive(); return { operation, replayed: true };
}
function principal(a: Authority) { return { userId: a.actor.userId, sessionHash: a.sessionHash, membershipId: a.context.membershipId, authorityVersion: a.context.authorityVersion }; }
function assertTenant(a: Authority, tenant: string) { if (a.actor.tenantId !== tenant) fail(409, 'tenant_mismatch'); }
function configure(store: Store, a: Authority, key: string, body: { expectedTenantId: string; configuration: unknown; expectedRevision?: number }, id?: string) {
  const kind = id ? 'binding.update' : 'binding.create', configuration = parseBaserowConfiguration(body.configuration);
  const hash = fingerprint(kind, id ?? null, { ...body, configuration });
  return store.transaction(() => {
    permitted(a, kind); assertTenant(a, body.expectedTenantId);
    const previous = replay(store, a, key, hash); if (previous) return previous;
    const binding = configureBaserowTable(store, a.actor, configuration, id, a.assertLive, { expectedRevision: body.expectedRevision, withinTransaction: true });
    const row = store.create(a.actor.tenantId, baserowHttpOperations, { schemaVersion: 2, key, kind, status: 'succeeded', bindingId: binding.id, revision: binding.revision, nativeOperationId: null, fingerprint: hash, ...principal(a) });
    store.create(a.actor.tenantId, auditCollection, { kind, operationId: row.id, bindingId: binding.id, revision: binding.revision, userId: a.actor.userId, membershipId: a.context.membershipId });
    const operation = project(store, row); a.assertLive(); return { operation, replayed: false };
  });
}
function setEnabled(store: Store, a: Authority, id: string, key: string, body: { expectedTenantId: string; expectedRevision: number; enabled: boolean }) {
  const kind = 'binding.set_enabled', hash = fingerprint(kind, id, body);
  return store.transaction(() => {
    permitted(a, kind); assertTenant(a, body.expectedTenantId);
    const previous = replay(store, a, key, hash); if (previous) return previous;
    const old = store.get(a.actor.tenantId, baserowBindings, id);
    if (!old) return fail(404, 'baserow_binding_not_found');
    if (old.revision !== body.expectedRevision) fail(409, 'baserow_configuration_changed');
    const binding = store.update(a.actor.tenantId, baserowBindings, id, { enabled: body.enabled, revision: body.expectedRevision + 1 })!;
    const row = store.create(a.actor.tenantId, baserowHttpOperations, { schemaVersion: 2, key, kind, status: 'succeeded', bindingId: id, revision: binding.revision, nativeOperationId: null, fingerprint: hash, ...principal(a) });
    store.create(a.actor.tenantId, auditCollection, { kind, operationId: row.id, bindingId: id, revision: binding.revision, userId: a.actor.userId, membershipId: a.context.membershipId });
    const operation = project(store, row); a.assertLive(); return { operation, replayed: false };
  });
}
async function createRow(store: Store, a: Authority, id: string, key: string, body: { expectedTenantId: string; expectedRevision: number; values: Record<string, unknown> }, transport?: IntegrationTransport) {
  const input = canonical({ values: body.values }), hash = fingerprint('row.create', id, { ...body, values: input.values });
  const reservation = store.transaction(() => {
    permitted(a, 'row.create'); assertTenant(a, body.expectedTenantId);
    const previous = replay(store, a, key, hash); if (previous) return { previous };
    // A native/agent legacy receipt cannot prove a human HTTP session. Never adopt it.
    const legacyHash = digest(`${id}:${a.actor.userId}:${key}`);
    if (store.db.prepare("SELECT id FROM entities WHERE tenant_id=? AND collection=? AND json_extract(body,'$.keyHash')=? LIMIT 1").get(a.actor.tenantId, baserowOperations, legacyHash)) fail(409, 'legacy_operation_unrecoverable');
    const binding = store.get(a.actor.tenantId, baserowBindings, id);
    if (!binding) return fail(404, 'baserow_binding_not_found');
    if (binding.revision !== body.expectedRevision) fail(409, 'baserow_admission_revision_conflict');
    if (!Array.isArray(binding.allowedRoles) || !binding.allowedRoles.includes(a.actor.role)) fail(403, 'baserow_not_authorized');
    if (!binding.enabled) fail(503, 'baserow_binding_disabled');
    if (!binding.allowCreate) fail(403, 'baserow_read_only');
    const row = store.create(a.actor.tenantId, baserowHttpOperations, { schemaVersion: 2, key, kind: 'row.create', status: 'pending', bindingId: id, revision: body.expectedRevision, nativeOperationId: null, fingerprint: hash, ...principal(a) });
    a.assertLive(); return { row };
  });
  if (reservation.previous) return reservation.previous;
  const row = reservation.row!;
  try {
    await createBaserowRow(store, a.actor, id, input, `http-v2:${row.id}`, transport, a.assertLive, { expectedRevision: body.expectedRevision, onReserved: native => {
      a.assertLive(); const current = store.get(row.tenantId, baserowHttpOperations, row.id);
      if (!current || current.status !== 'pending' || current.nativeOperationId !== null || current.fingerprint !== hash || !owns(current, a)) fail(409, 'baserow_operation_unavailable');
      store.update(row.tenantId, baserowOperations, native.id, { httpOperationId: row.id });
      store.update(row.tenantId, baserowHttpOperations, row.id, { nativeOperationId: native.id });
      store.create(row.tenantId, auditCollection, { kind: 'row.create', operationId: row.id, nativeOperationId: native.id, bindingId: id, revision: row.revision, userId: a.actor.userId, membershipId: a.context.membershipId });
      a.assertLive();
    } });
  } catch (error) {
    // Recording a known pre-transmission failure is not disclosure. Accepted native receipts win.
    const current = store.get(row.tenantId, baserowHttpOperations, row.id);
    if (current?.nativeOperationId === null && current.status === 'pending') store.update(row.tenantId, baserowHttpOperations, row.id, { status: 'not_sent', errorCode: error instanceof DomainError || error instanceof MembershipError ? error.code : 'baserow_preparation_failed' });
    a.assertLive(); throw error;
  }
  a.assertLive(); return { operation: project(store, store.get(row.tenantId, baserowHttpOperations, row.id)!), replayed: false };
}

export async function registerBaserowHttpRoutes(app: FastifyInstance, store: Store, transport?: IntegrationTransport) {
  const prefix = '/api/v1/integrations/baserow', idOf = (r: FastifyRequest) => z.object({ id: z.string().uuid() }).strict().parse(r.params).id;
  const safe = (fn: (req: FastifyRequest, reply: FastifyReply) => unknown | Promise<unknown>) => async (req: FastifyRequest, reply: FastifyReply) => {
    reply.header('Cache-Control', 'no-store');
    try { return await fn(req, reply); } catch (error) {
      try { assertRequestContext(store, req); } catch (accessError) { error = accessError; }
      if (error instanceof MembershipError || error instanceof DomainError) return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
      if (error instanceof OAuthError) return reply.code(error.status).send({ error: { code: error.code, message: error.message } });
      if (error instanceof z.ZodError) return reply.code(400).send({ error: { code: 'invalid_baserow_input', message: 'Dados Baserow inválidos.' } });
      throw error;
    }
  };
  app.get(prefix + '/operations/:key', safe(req => {
    const a = authority(store, req), key = keySchema.parse(z.object({ key: z.string() }).strict().parse(req.params).key), row = find(store, a.actor.tenantId, key);
    if (!row || !owns(row, a)) return fail(404, 'baserow_operation_not_found');
    const result = project(store, row); a.assertLive(); return result;
  }));
  app.get(prefix + '/tables/:id', safe(req => {
    const a = authority(store, req), row = store.get(a.actor.tenantId, baserowBindings, idOf(req));
    if (!row || !hasPermission(a.actor.role, 'integrations:manage') && !(Array.isArray(row.allowedRoles) && row.allowedRoles.includes(a.actor.role))) return fail(404, 'baserow_binding_not_found');
    const result = publicBaserowBinding(row); a.assertLive(); return result;
  }));
  app.post(prefix + '/tables', safe((req, reply) => {
    const a = authority(store, req), body = z.object({ expectedTenantId: tenantSchema, configuration: z.unknown() }).strict().parse(req.body);
    const result = configure(store, a, keySchema.parse(req.headers['idempotency-key']), { ...body, configuration: body.configuration });
    return reply.code(result.replayed ? 200 : 201).send(result);
  }));
  app.put(prefix + '/tables/:id', safe(req => {
    const a = authority(store, req), body = z.object({ expectedTenantId: tenantSchema, expectedRevision: revisionSchema, configuration: z.unknown() }).strict().parse(req.body);
    return configure(store, a, keySchema.parse(req.headers['idempotency-key']), { ...body, configuration: body.configuration }, idOf(req));
  }));
  app.patch(prefix + '/tables/:id', safe(req => {
    const a = authority(store, req), body = z.object({ expectedTenantId: tenantSchema, expectedRevision: revisionSchema, enabled: z.boolean() }).strict().parse(req.body);
    return setEnabled(store, a, idOf(req), keySchema.parse(req.headers['idempotency-key']), body);
  }));
  app.post(prefix + '/tables/:id/rows', safe(req => {
    const a = authority(store, req), body = z.object({ expectedTenantId: tenantSchema, expectedRevision: revisionSchema, values: z.record(z.unknown()) }).strict().parse(req.body);
    return createRow(store, a, idOf(req), keySchema.parse(req.headers['idempotency-key']), body, transport);
  }));
}

