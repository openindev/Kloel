import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Entity, Store } from '../../store.js';
import { humanCRM } from '../../crm.js';
import { hasPermission } from '../../memberships/permissions.js';
import { MembershipError } from '../../memberships/service.js';
import { resolveSessionContext, sameRequestContext } from '../../request-context.js';
import { crmId } from '../schema.js';
import { transaction } from '../service.js';
import { captureHuman } from './authority.js';
import { fail, keySchema, proposals } from './schema.js';

export const captureOperations = 'crm-capture-http-operations';
export type CaptureOperationKind = 'grant.create' | 'grant.pause' | 'grant.revoke' | 'proposal.apply' | 'proposal.dismiss';
const kinds = z.enum(['grant.create', 'grant.pause', 'grant.revoke', 'proposal.apply', 'proposal.dismiss']);
const revision = z.number().int().positive().safe();
const grantResult = z.object({ grantId: crmId, revision, status: z.enum(['active', 'paused', 'revoked']) }).strict();
const applyResult = z.object({ proposalId: crmId, proposalRevision: revision, contactId: crmId, contactRevision: revision, appliedFields: z.array(crmId).max(53), skippedFields: z.array(crmId).max(53) }).strict();
const dismissResult = z.object({ proposalId: crmId, revision, status: z.literal('dismissed') }).strict();
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical((value as Record<string, unknown>)[key])])) : value;

/** HTTP-only authority. Autonomous worker grants never acquire this session dependency. */
export function captureOperationAuthority(store: Store, request: FastifyRequest, mode: 'read' | 'review' | 'manage') {
  const current = () => {
    const actor = humanCRM(store, request, mode === 'manage' ? 'contacts:settings' : 'contacts:read');
    if (!hasPermission(actor.role, 'conversations:read')) fail('capture_source_access_denied', 403);
    const sessionHash = hash(request.cookies.kloel_session!), snapshot = resolveSessionContext(store, sessionHash);
    if (!snapshot || !snapshot.actor || snapshot.actor.userId !== actor.userId || snapshot.actor.tenantId !== actor.tenantId) fail('capture_human_authority_required', 403);
    if (mode !== 'read') captureHuman(store, actor, sessionHash, mode === 'manage');
    return { actor, sessionHash, context: snapshot.context };
  };
  const original = current();
  return { ...original, assertCurrent: () => {
    const next = current();
    if (!sameRequestContext(original.context, next.context)) throw new MembershipError(409, 'context_changed_in_flight', 'O contexto mudou durante a operação. Consulte o recibo antes de tentar novamente.');
  } };
}
export type CaptureOperationAuthority = ReturnType<typeof captureOperationAuthority>;
function findOperation(store: Store, tenantId: string, key: string): Entity | undefined {
  const rows = store.db.prepare("SELECT body FROM entities WHERE tenant_id=? AND collection=? AND json_extract(body,'$.key')=? LIMIT 2").all(tenantId, captureOperations, key);
  if (rows.length > 1) fail('operation_unavailable');
  return rows.length ? JSON.parse(String(rows[0].body)) as Entity : undefined;
}
function owns(row: Entity, authority: CaptureOperationAuthority) {
  return row.tenantId === authority.actor.tenantId && row.operatorUserId === authority.actor.userId && row.sessionHash === authority.sessionHash
    && row.membershipId === authority.context.membershipId && row.authorityVersion === authority.context.authorityVersion;
}
function publicOperation(row: Entity) {
  const kind = kinds.safeParse(row.kind), key = keySchema.safeParse(row.key), target = crmId.safeParse(row.targetId);
  if (!kind.success || !key.success || !target.success || row.status !== 'succeeded' || row.schemaVersion !== 1) fail('operation_unavailable');
  const result = (kind.data === 'proposal.apply' ? applyResult : kind.data === 'proposal.dismiss' ? dismissResult : grantResult).safeParse(row.result);
  if (!result.success) fail('operation_unavailable');
  const resultTarget = 'grantId' in result.data ? result.data.grantId : result.data.proposalId;
  if (resultTarget !== target.data || kind.data === 'grant.create' && 'status' in result.data && result.data.status !== 'active'
    || kind.data === 'grant.pause' && 'status' in result.data && result.data.status !== 'paused'
    || kind.data === 'grant.revoke' && 'status' in result.data && result.data.status !== 'revoked') fail('operation_unavailable');
  return { key: key.data, kind: kind.data, status: 'succeeded' as const, targetId: target.data, result: result.data, createdAt: row.createdAt, automaticRetry: false as const };
}
export function readCaptureOperation(store: Store, authority: CaptureOperationAuthority, rawKey: unknown) {
  authority.assertCurrent(); const key = keySchema.parse(rawKey), row = findOperation(store, authority.actor.tenantId, key);
  if (!row || !owns(row, authority)) fail('operation_not_found', 404);
  const result = publicOperation(row); authority.assertCurrent(); return result;
}

/** All effects are local: the outer SAVEPOINT rolls back effects, audit and receipt together. */
export function performCaptureOperation(store: Store, authority: CaptureOperationAuthority, input: {
  key: string; kind: CaptureOperationKind; targetId: string | null; expectedTenantId: string; fingerprintInput: unknown;
}, perform: () => { targetId: string; result: unknown }) {
  return transaction(store, () => {
    authority.assertCurrent(); const tenant = authority.actor.tenantId, key = keySchema.parse(input.key);
    if (input.expectedTenantId !== tenant) fail('tenant_mismatch');
    const fingerprint = hash(JSON.stringify(canonical({ kind: input.kind, targetId: input.targetId, input: input.fingerprintInput })));
    const prior = findOperation(store, tenant, key);
    if (prior) {
      if (!owns(prior, authority) || prior.fingerprint !== fingerprint) fail('idempotency_conflict');
      const operation = publicOperation(prior); authority.assertCurrent(); return { operation, replayed: true };
    }
    // Legacy receipts do not prove original session/membership authority. Never adopt them.
    const legacy = store.db.prepare("SELECT id FROM entities WHERE tenant_id=? AND collection='crm-receipts' AND json_extract(body,'$.key')=? LIMIT 1").get(tenant, key);
    if (legacy) fail('legacy_operation_unrecoverable');
    if (input.kind === 'proposal.apply' && input.targetId) {
      const proposal = store.get(tenant, proposals, input.targetId);
      if (proposal?.status === 'applied') fail(proposal.applicationKey === hash(JSON.stringify(key)) ? 'legacy_operation_unrecoverable' : 'capture_already_applied');
    }
    const completed = perform(); authority.assertCurrent();
    const receipt = store.create(tenant, captureOperations, { schemaVersion: 1, key, kind: input.kind, status: 'succeeded', targetId: completed.targetId, result: completed.result, fingerprint,
      operatorUserId: authority.actor.userId, sessionHash: authority.sessionHash, membershipId: authority.context.membershipId, authorityVersion: authority.context.authorityVersion });
    const operation = publicOperation(receipt); authority.assertCurrent();
    return { operation, replayed: false };
  });
}
