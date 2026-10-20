import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Entity, Store } from '../store.js';
import { humanCRM } from '../crm.js';
import { MembershipError } from '../memberships/service.js';
import { resolveSessionContext, sameRequestContext } from '../request-context.js';
import { CRMError, crmId } from './schema.js';
import { transaction } from './service.js';

export const importOperations = 'crm-import-http-operations';
const keySchema = z.string().min(8).max(128).regex(/^[A-Za-z0-9_.:-]+$/);
const count = z.number().int().nonnegative().max(2000);
const revision = z.number().int().positive().safe();
const resultSchema = z.object({
  committed: z.literal(true),
  summary: z.object({ total: count, create: count, merge: count, error: z.literal(0) }).strict(),
  changes: z.array(z.object({ line: z.number().int().min(1).max(2000), sourceId: crmId.optional(), action: z.enum(['create', 'merge']), id: crmId, revision }).strict()).max(2000),
  definitionMappings: z.array(z.object({ sourceId: crmId.optional(), key: crmId, id: crmId, options: z.array(z.object({ sourceId: crmId.optional(), id: crmId }).strict()).max(100) }).strict()).max(100),
}).strict();
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical((value as Record<string, unknown>)[key])])) : value;
function fail(code: string, status = 409): never { throw new CRMError(status, code, 'Importação indisponível ou alterada; consulte a referência original.'); }

/** Human HTTP intent only; does not change domain import or permission evidence. */
export function importAuthority(store: Store, request: FastifyRequest) {
  const current = () => {
    const actor = humanCRM(store, request, 'contacts:bulk');
    const sessionHash = hash(request.cookies.kloel_session!), snapshot = resolveSessionContext(store, sessionHash);
    if (!snapshot?.actor || snapshot.actor.userId !== actor.userId || snapshot.actor.tenantId !== actor.tenantId) fail('import_human_authority_required', 403);
    return { actor, sessionHash, context: snapshot.context };
  };
  const original = current();
  return { ...original, assertCurrent: () => {
    const next = current();
    if (!sameRequestContext(original.context, next.context)) throw new MembershipError(409, 'context_changed_in_flight', 'O contexto mudou durante a importação. Consulte o recibo antes de tentar novamente.');
  } };
}
type ImportAuthority = ReturnType<typeof importAuthority>;
function find(store: Store, tenant: string, key: string) {
  const rows = store.db.prepare("SELECT body FROM entities WHERE tenant_id=? AND collection=? AND json_extract(body,'$.key')=? LIMIT 2").all(tenant, importOperations, key);
  if (rows.length > 1) fail('import_operation_unavailable');
  return rows.length ? JSON.parse(String(rows[0].body)) as Entity : undefined;
}
function owns(row: Entity, authority: ImportAuthority) {
  return row.tenantId === authority.actor.tenantId && row.operatorUserId === authority.actor.userId && row.sessionHash === authority.sessionHash
    && row.membershipId === authority.context.membershipId && row.authorityVersion === authority.context.authorityVersion;
}
function publicOperation(row: Entity) {
  const key = keySchema.safeParse(row.key), result = resultSchema.safeParse(row.result);
  if (!key.success || !result.success || row.schemaVersion !== 1 || row.kind !== 'import.commit' || row.status !== 'succeeded') fail('import_operation_unavailable');
  const { summary, changes } = result.data;
  if (summary.total !== changes.length || summary.create + summary.merge !== summary.total
    || changes.filter(item => item.action === 'create').length !== summary.create
    || changes.some((item, index) => item.line !== index + 1) || new Set(changes.map(item => item.id)).size !== changes.length) fail('import_operation_unavailable');
  return { key: key.data, kind: 'import.commit' as const, status: 'succeeded' as const, result: result.data, createdAt: row.createdAt, automaticRetry: false as const };
}
export function readImportOperation(store: Store, authority: ImportAuthority, rawKey: unknown) {
  authority.assertCurrent(); const key = keySchema.parse(rawKey), row = find(store, authority.actor.tenantId, key);
  if (!row || !owns(row, authority)) fail('import_operation_not_found', 404);
  const result = publicOperation(row); authority.assertCurrent(); return result;
}
export function performImportOperation(store: Store, authority: ImportAuthority, input: {
  key: string; expectedTenantId: string; options: unknown; previewFingerprint: string;
}, perform: (internalKey: string, assertCurrent: () => void) => { result: unknown; replayed: boolean }) {
  return transaction(store, () => {
    authority.assertCurrent(); const tenant = authority.actor.tenantId, key = keySchema.parse(input.key);
    if (input.expectedTenantId !== tenant) fail('tenant_mismatch');
    const fingerprint = hash(JSON.stringify(canonical({ options: input.options, previewFingerprint: input.previewFingerprint })));
    const prior = find(store, tenant, key);
    if (prior) {
      if (!owns(prior, authority) || prior.fingerprint !== fingerprint) fail('idempotency_conflict');
      const operation = publicOperation(prior); authority.assertCurrent(); return { operation, replayed: true };
    }
    const internalKey = 'crm-import-http:' + hash(JSON.stringify([tenant, key]));
    // Legacy results cannot prove the original session. Never adopt them after a restart.
    const legacy = store.db.prepare("SELECT id FROM entities WHERE tenant_id=? AND collection='crm-receipts' AND json_extract(body,'$.key') IN (?,?) LIMIT 1").get(tenant, key, internalKey);
    if (legacy) fail('legacy_operation_unrecoverable');
    const committed = perform(internalKey, authority.assertCurrent);
    if (committed.replayed) fail('legacy_operation_unrecoverable');
    authority.assertCurrent();
    const receipt = store.create(tenant, importOperations, { schemaVersion: 1, key, kind: 'import.commit', status: 'succeeded', fingerprint, result: committed.result,
      operatorUserId: authority.actor.userId, sessionHash: authority.sessionHash, membershipId: authority.context.membershipId, authorityVersion: authority.context.authorityVersion });
    const operation = publicOperation(receipt);
    store.create(tenant, 'crm-import-http-audit', { operationId: receipt.id, actorId: authority.actor.userId, membershipId: authority.context.membershipId, summary: operation.result.summary });
    authority.assertCurrent(); return { operation, replayed: false };
  });
}
