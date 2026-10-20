import { registerSheetActionRoutes } from './sheets-agent-actions.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Store, Entity } from '../store.js';
import { hasPermission } from '../memberships/permissions.js';
import { MembershipError } from '../memberships/service.js';
import { assertRequestContext, resolveSessionContext, sameRequestContext } from '../request-context.js';
import { digest } from './crypto.js';
import { scopedConnection } from './access.js';
import { OAuthError } from './client.js';
import { sheetsBindings, sheetsOperations, bindingSchema, sheetConnection, bound, publicSheetBinding, normalizeSheetAppend, appendSpreadsheetRows, listSpreadsheetTabs, readSpreadsheetRange } from './sheets.js';

export const sheetsHttpOperations = 'oauth-sheets-http-operations';
const audit = 'oauth-sheets-http-audit';
const uuid = z.string().uuid(), keySchema = z.string().regex(/^[A-Za-z0-9_-]{8,128}$/), revision = z.number().int().positive().safe();
const tenant = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
const kinds = z.enum(['binding.create', 'binding.update', 'binding.set_enabled', 'rows.append']);
type Kind = z.infer<typeof kinds>;
const fail = (status: number, code: string): never => { throw new OAuthError(status, code, 'A operação de planilha está indisponível ou mudou. Consulte a referência antes de tentar novamente.'); };
const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical((v as Record<string, unknown>)[k])])) : v;
const fingerprint = (kind: Kind, connectionId: string, bindingId: string | null, body: unknown) => digest(JSON.stringify(canonical({ kind, connectionId, bindingId, body })));
function authority(store: Store, request: FastifyRequest) {
  assertRequestContext(store, request);
  const sessionHash = digest(request.cookies?.kloel_session ?? ''), initial = resolveSessionContext(store, sessionHash);
  if (request.apiKey || !request.cookies?.kloel_session || !initial?.actor || !request.actor || request.actor.userId !== initial.actor.userId || request.actor.tenantId !== initial.actor.tenantId) return fail(401, 'authentication_required');
  const assertLive = () => {
    assertRequestContext(store, request); const current = resolveSessionContext(store, sessionHash);
    if (!current?.actor || !sameRequestContext(initial.context, current.context)) throw new MembershipError(409, 'context_changed_in_flight', 'O contexto mudou. Consulte a referência antes de tentar novamente.');
  };
  return { actor: initial.actor, context: initial.context, sessionHash, assertLive };
}
type Authority = ReturnType<typeof authority>;
function permitted(a: Authority, manage = false) { a.assertLive(); if (!hasPermission(a.actor.role, manage ? 'integrations:manage' : 'integrations:execute')) fail(403, 'forbidden'); }
const principal = (a: Authority) => ({ userId: a.actor.userId, sessionHash: a.sessionHash, membershipId: a.context.membershipId, authorityVersion: a.context.authorityVersion });
const owns = (row: Entity, a: Authority) => row.tenantId === a.actor.tenantId && row.userId === a.actor.userId && row.sessionHash === a.sessionHash && row.membershipId === a.context.membershipId && row.authorityVersion === a.context.authorityVersion;
function localConnection(store: Store, a: Authority, connectionId: string) {
  const connection = scopedConnection(store, a.actor, connectionId);
  if (connection.provider !== 'google') return fail(400, 'unsupported_provider'); return connection;
}
function localBinding(store: Store, a: Authority, connectionId: string, bindingId: string) {
  localConnection(store, a, connectionId); const binding = store.get(a.actor.tenantId, sheetsBindings, bindingId);
  if (!binding || binding.connectionId !== connectionId) return fail(404, 'spreadsheet_binding_not_found');
  if (!revision.safeParse(binding.revision).success) return fail(503, 'spreadsheet_configuration_invalid'); return binding;
}
function find(store: Store, a: Authority, key: string) {
  const rows = store.db.prepare("SELECT body FROM entities WHERE tenant_id=? AND collection=? AND json_extract(body,'$.key')=? LIMIT 2").all(a.actor.tenantId, sheetsHttpOperations, key);
  if (rows.length > 1) return fail(409, 'sheets_operation_unavailable'); return rows[0] ? JSON.parse(String(rows[0].body)) as Entity : undefined;
}
function project(store: Store, row: Entity) {
  const kind = kinds.safeParse(row.kind), date = z.string().datetime({ offset: true });
  if (row.schemaVersion !== 2 || !kind.success || !keySchema.safeParse(row.key).success || !uuid.safeParse(row.connectionId).success || !uuid.safeParse(row.bindingId).success || !revision.safeParse(row.revision).success || !date.safeParse(row.createdAt).success) return fail(409, 'sheets_operation_unavailable');
  const remote = kind.data === 'rows.append'; let native: Entity | undefined;
  if (row.nativeOperationId !== null) {
    if (!remote || !uuid.safeParse(row.nativeOperationId).success) return fail(409, 'sheets_operation_unavailable');
    native = store.get(row.tenantId, sheetsOperations, String(row.nativeOperationId));
    if (!native || native.httpOperationId !== row.id || native.connectionId !== row.connectionId || native.bindingId !== row.bindingId || native.revision !== row.revision || native.userId !== row.userId || native.fingerprint !== row.nativeFingerprint || native.spreadsheetId !== row.spreadsheetId) return fail(409, 'sheets_operation_unavailable');
  }
  if (remote ? !['pending', 'not_sent'].includes(String(row.status)) || native && row.status !== 'pending' : row.status !== 'succeeded' || native) return fail(409, 'sheets_operation_unavailable');
  const status = String(native?.status ?? row.status);
  if (remote && !['pending', 'not_sent', 'uncertain', 'appended'].includes(status)) return fail(409, 'sheets_operation_unavailable');
  let result: { updatedRange: string; updatedRows: number; updatedColumns: number; updatedCells: number; valueInputOption: 'RAW' } | null = null;
  if (status === 'appended') {
    const parsed = z.object({ updatedRange: z.string().min(1).max(4096).refine(s => !/[\u0000-\u001f]/.test(s)), updatedRows: z.number().int().min(1).max(100), updatedColumns: z.number().int().min(1).max(50), updatedCells: z.number().int().min(1).max(5000), valueInputOption: z.literal('RAW') }).safeParse(native?.result);
    const raw = native?.result as Record<string, unknown> | undefined;
    if (!parsed.success || raw?.operationId !== native?.id || raw?.spreadsheetId !== row.spreadsheetId || raw?.status !== 'appended' || raw?.providerVerified !== true || parsed.data.updatedRows !== native?.rowsRequested || parsed.data.updatedCells > parsed.data.updatedRows * parsed.data.updatedColumns) return fail(409, 'sheets_operation_unavailable');
    result = parsed.data;
  } else if (native?.result != null) return fail(409, 'sheets_operation_unavailable');
  const errorCode = native?.errorCode ?? row.errorCode ?? null, updatedAt = native?.updatedAt ?? row.updatedAt;
  if (errorCode !== null && (typeof errorCode !== 'string' || !/^[a-zA-Z0-9_:-]{1,100}$/.test(errorCode)) || !date.safeParse(updatedAt).success) return fail(409, 'sheets_operation_unavailable');
  return { key: String(row.key), kind: kind.data, connectionId: String(row.connectionId), bindingId: String(row.bindingId), revision: Number(row.revision), status, nativeOperationId: native?.id ?? null, result, errorCode, requiresReconciliation: ['pending', 'uncertain'].includes(status), automaticRetry: false as const, createdAt: row.createdAt, updatedAt };
}
function replay(store: Store, a: Authority, key: string, hash: string) {
  const old = find(store, a, key); if (!old) return;
  if (!owns(old, a) || old.fingerprint !== hash) return fail(409, 'idempotency_conflict');
  const operation = project(store, old); a.assertLive(); return { operation, replayed: true };
}
function configure(store: Store, a: Authority, connectionId: string, bindingId: string | null, key: string, kind: Exclude<Kind, 'rows.append'>, body: { expectedTenantId: string; expectedRevision?: number; configuration?: { spreadsheetId?: string; name: string; allowAppend: boolean; enabled?: boolean }; enabled?: boolean }) {
  const hash = fingerprint(kind, connectionId, bindingId, body);
  return store.transaction(() => {
    permitted(a, true); if (body.expectedTenantId !== a.actor.tenantId) fail(409, 'tenant_mismatch');
    const old = replay(store, a, key, hash); if (old) return old;
    localConnection(store, a, connectionId); let binding: Entity;
    if (kind === 'binding.create') {
      const configuration = body.configuration!;
      sheetConnection(store, a.actor, connectionId, configuration.allowAppend);
      if (store.list(a.actor.tenantId, sheetsBindings).some(b => b.connectionId === connectionId && b.spreadsheetId === configuration.spreadsheetId)) return fail(409, 'spreadsheet_already_configured');
      binding = store.create(a.actor.tenantId, sheetsBindings, { ...configuration, connectionId, userId: a.actor.userId, revision: 1 });
    } else {
      const before = localBinding(store, a, connectionId, bindingId!);
      if (before.revision !== body.expectedRevision) return fail(409, 'spreadsheet_configuration_changed');
      if (!Number.isSafeInteger(Number(before.revision) + 1)) return fail(503, 'spreadsheet_configuration_invalid');
      if (kind === 'binding.set_enabled' && body.enabled || kind === 'binding.update' && body.configuration!.allowAppend) sheetConnection(store, a.actor, connectionId, kind === 'binding.update' ? true : before.allowAppend === true);
      const changes = kind === 'binding.set_enabled' ? { enabled: body.enabled } : body.configuration!;
      binding = store.update(a.actor.tenantId, sheetsBindings, before.id, { ...changes, revision: Number(before.revision) + 1, lastVerifiedAt: null, lastVerifiedRevision: null })!;
    }
    const row = store.create(a.actor.tenantId, sheetsHttpOperations, { schemaVersion: 2, key, kind, connectionId, bindingId: binding.id, revision: binding.revision, status: 'succeeded', nativeOperationId: null, fingerprint: hash, ...principal(a) });
    store.create(a.actor.tenantId, audit, { kind, operationId: row.id, connectionId, bindingId: binding.id, revision: binding.revision, userId: a.actor.userId, membershipId: a.context.membershipId });
    const operation = project(store, row); a.assertLive(); return { operation, replayed: false };
  });
}
async function append(store: Store, a: Authority, connectionId: string, bindingId: string, key: string, body: { expectedTenantId: string; expectedRevision: number; sheetTitle: string; range: string; rows: unknown }) {
  const { data } = normalizeSheetAppend({ sheetTitle: body.sheetTitle, range: body.range, rows: body.rows });
  const hash = fingerprint('rows.append', connectionId, bindingId, { ...body, ...data });
  const reserved = store.transaction(() => {
    permitted(a); if (body.expectedTenantId !== a.actor.tenantId) fail(409, 'tenant_mismatch');
    const old = replay(store, a, key, hash); if (old) return { old };
    const legacyHash = digest(`${a.actor.userId}:${connectionId}:${bindingId}:${key}`);
    if (store.db.prepare("SELECT id FROM entities WHERE tenant_id=? AND collection=? AND json_extract(body,'$.keyHash')=? LIMIT 1").get(a.actor.tenantId, sheetsOperations, legacyHash)) return fail(409, 'legacy_operation_unrecoverable');
    const binding = localBinding(store, a, connectionId, bindingId);
    if (binding.revision !== body.expectedRevision) return fail(409, 'sheets_admission_revision_conflict');
    bound(store, a.actor, connectionId, bindingId, true);
    const row = store.create(a.actor.tenantId, sheetsHttpOperations, { schemaVersion: 2, key, kind: 'rows.append', connectionId, bindingId, spreadsheetId: binding.spreadsheetId, revision: body.expectedRevision, status: 'pending', nativeOperationId: null, fingerprint: hash, ...principal(a) });
    a.assertLive(); return { row };
  });
  if (reserved.old) return reserved.old;
  const row = reserved.row!;
  try {
    await appendSpreadsheetRows(store, a.actor, connectionId, bindingId, data, `http-v2:${row.id}`, a.assertLive, { expectedRevision: body.expectedRevision, onReserved: native => {
      a.assertLive(); const current = store.get(row.tenantId, sheetsHttpOperations, row.id);
      if (!current || current.status !== 'pending' || current.nativeOperationId !== null || current.fingerprint !== hash || !owns(current, a)) return fail(409, 'sheets_operation_unavailable');
      store.update(row.tenantId, sheetsOperations, native.id, { httpOperationId: row.id });
      store.update(row.tenantId, sheetsHttpOperations, row.id, { nativeOperationId: native.id, nativeFingerprint: native.fingerprint });
      store.create(row.tenantId, audit, { kind: 'rows.append', operationId: row.id, nativeOperationId: native.id, bindingId, revision: row.revision, userId: a.actor.userId, membershipId: a.context.membershipId });
      a.assertLive();
    } });
  } catch (error) {
    const current = store.get(row.tenantId, sheetsHttpOperations, row.id);
    if (current?.status === 'pending' && current.nativeOperationId === null) store.update(row.tenantId, sheetsHttpOperations, row.id, { status: 'not_sent', errorCode: error instanceof OAuthError ? error.code : 'sheets_preparation_failed' });
    a.assertLive(); throw error;
  }
  a.assertLive(); return { operation: project(store, store.get(row.tenantId, sheetsHttpOperations, row.id)!), replayed: false };
}

export async function registerSheetsHttpRoutes(app: FastifyInstance, store: Store) {
  await registerSheetActionRoutes(app, store);
  const { prepareSheetQuery, querySpreadsheet, sheetQueryBodyLimit } = await import('./sheets-query.js');
  const prefix = '/api/v1/oauth/connections/:id/spreadsheets';
  const params = (r: FastifyRequest) => z.object({ id: uuid, bindingId: uuid.optional() }).strict().parse(r.params);
  const safe = (fn: (req: FastifyRequest, reply: FastifyReply) => unknown | Promise<unknown>) => async (req: FastifyRequest, reply: FastifyReply) => {
    reply.header('Cache-Control', 'no-store');
    try { return await fn(req, reply); } catch (error) {
      try { assertRequestContext(store, req); } catch (currentError) { error = currentError; }
      if (error instanceof MembershipError) return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
      if (error instanceof OAuthError) return reply.code(error.status).send({ error: { code: error.code, message: error.message } });
      if (error instanceof z.ZodError) return reply.code(400).send({ error: { code: 'invalid_sheets_input', message: 'Dados de planilha inválidos.' } }); throw error;
    }
  };
  app.get('/api/v1/oauth/sheets/operations/:key', safe(req => {
    const a = authority(store, req), key = keySchema.parse(z.object({ key: z.string() }).strict().parse(req.params).key), row = find(store, a, key);
    if (!row || !owns(row, a)) return fail(404, 'sheets_operation_not_found'); const result = project(store, row); a.assertLive(); return result;
  }));
  app.get(prefix, safe(req => {
    const a = authority(store, req), { id } = params(req); permitted(a); localConnection(store, a, id);
    const result = { items: store.list(a.actor.tenantId, sheetsBindings).filter(b => b.connectionId === id).map(publicSheetBinding), source: 'local_configured_bindings', driveListing: false }; a.assertLive(); return result;
  }));
  app.get(prefix + '/:bindingId', safe(req => { const a = authority(store, req), { id, bindingId } = params(req); permitted(a); const result = publicSheetBinding(localBinding(store, a, id, bindingId!)); a.assertLive(); return result; }));
  app.post(prefix, safe((req, reply) => {
    const a = authority(store, req), { id } = params(req), body = z.object({ expectedTenantId: tenant, configuration: bindingSchema.extend({ enabled: z.boolean(), name: z.string().trim().min(1).max(120) }) }).strict().parse(req.body);
    const result = configure(store, a, id, null, keySchema.parse(req.headers['idempotency-key']), 'binding.create', body); return reply.code(result.replayed ? 200 : 201).send(result);
  }));
  app.put(prefix + '/:bindingId', safe(req => {
    const a = authority(store, req), { id, bindingId } = params(req), body = z.object({ expectedTenantId: tenant, expectedRevision: revision, configuration: z.object({ name: z.string().trim().min(1).max(120), allowAppend: z.boolean() }).strict() }).strict().parse(req.body);
    return configure(store, a, id, bindingId!, keySchema.parse(req.headers['idempotency-key']), 'binding.update', body);
  }));
  app.patch(prefix + '/:bindingId', safe(req => {
    const a = authority(store, req), { id, bindingId } = params(req), body = z.object({ expectedTenantId: tenant, expectedRevision: revision, enabled: z.boolean() }).strict().parse(req.body);
    return configure(store, a, id, bindingId!, keySchema.parse(req.headers['idempotency-key']), 'binding.set_enabled', body);
  }));
  app.post(prefix + '/:bindingId/query', {
    bodyLimit: sheetQueryBodyLimit,
    errorHandler: (error, req, reply) => safe(async () => {
      if (error.code === 'FST_ERR_CTP_BODY_TOO_LARGE') throw new OAuthError(413, 'sheet_query_limit', 'A consulta excede o limite permitido.');
      throw error;
    })(req, reply),
  }, safe(async req => {
    const a = authority(store, req), { id, bindingId } = params(req); permitted(a);
    const query = prepareSheetQuery(req.body);
    const result = await querySpreadsheet(store, a.actor, id, bindingId!, query, a.assertLive);
    a.assertLive(); return result;
  }));
  app.get(prefix + '/:bindingId/tabs', safe(async req => {
    const a = authority(store, req), { id, bindingId } = params(req), query = z.object({ expectedRevision: z.coerce.number().int().positive().safe() }).strict().parse(req.query); permitted(a);
    const result = await listSpreadsheetTabs(store, a.actor, id, bindingId!, a.assertLive, query.expectedRevision); a.assertLive(); return result;
  }));
  app.get(prefix + '/:bindingId/values', safe(async req => {
    const a = authority(store, req), { id, bindingId } = params(req), query = z.object({ expectedRevision: z.coerce.number().int().positive().safe(), sheetTitle: z.string(), range: z.string() }).strict().parse(req.query); permitted(a);
    const result = await readSpreadsheetRange(store, a.actor, id, bindingId!, { sheetTitle: query.sheetTitle, range: query.range }, a.assertLive, query.expectedRevision); a.assertLive(); return result;
  }));
  app.post(prefix + '/:bindingId/append', safe(req => {
    const a = authority(store, req), { id, bindingId } = params(req), body = z.object({ expectedTenantId: tenant, expectedRevision: revision, sheetTitle: z.string(), range: z.string(), rows: z.unknown() }).strict().parse(req.body);
    return append(store, a, id, bindingId!, keySchema.parse(req.headers['idempotency-key']), { ...body, rows: body.rows });
  }));
  app.get('/api/v1/oauth/connections/:id/sheets-operations', safe(req => {
    const a = authority(store, req), { id } = params(req); permitted(a); sheetConnection(store, a.actor, id);
    const items = store.list(a.actor.tenantId, sheetsOperations).filter(o => o.connectionId === id && o.httpOperationId == null).map(o => ({ id: o.id, connectionId: o.connectionId, bindingId: o.bindingId, status: o.status, result: o.result ?? null, errorCode: o.errorCode ?? null, createdAt: o.createdAt, updatedAt: o.updatedAt, requiresReconciliation: ['pending', 'uncertain'].includes(String(o.status)), automaticRetry: false })); a.assertLive(); return { items };
  }));
}

