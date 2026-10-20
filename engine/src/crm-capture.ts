import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Store } from './store.js';
import { crmHandler, humanCRM, receiptKey } from './crm.js';
import { hasPermission } from './memberships/permissions.js';
import { crmId } from './crm/schema.js';
import { expectedRevision, getSettings } from './crm/service.js';
import { activateCapture, initializeCRMCapture, publicCaptureGrant, stopCapture } from './crm/capture/authority.js';
import { captureSchedulerRunning } from './crm/capture/runtime.js';
import { fail, grants, jobs, proposals, policySchema } from './crm/capture/schema.js';
import { applyCaptureProposal, dismissProposal, publicProposal } from './crm/capture/proposals.js';
import { CRMCaptureWorker, queueCapturePreview } from './crm/capture/worker.js';
import { captureOperationAuthority, performCaptureOperation, readCaptureOperation } from './crm/capture/operations.js';

export { initializeCRMCapture } from './crm/capture/authority.js';
export { recordCaptureIngress, type CaptureIngress } from './crm/capture/source-events.js';
export { CRMCaptureWorker } from './crm/capture/worker.js';
function human(store: Store, request: FastifyRequest, manager = false) {
  const actor = humanCRM(store, request, manager ? 'contacts:settings' : 'contacts:read');
  if (!hasPermission(actor.role, 'conversations:read')) fail('capture_source_access_denied', 403);
  return { actor, sessionHash: createHash('sha256').update(request.cookies.kloel_session!).digest('hex') };
}
const idOf = (request: FastifyRequest) => z.object({ id: crmId }).strict().parse(request.params).id;
export async function registerCRMCapture(app: FastifyInstance, store: Store, worker = new CRMCaptureWorker(store)) {
  initializeCRMCapture(store); const base = '/api/v1/crm/capture';
  const controlBody = z.object({ expectedTenantId: crmId }).strict();
  app.get(base + '/policy', crmHandler((request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const { actor } = human(store, request); const grant = store.list(actor.tenantId, grants).at(-1);
    return { settingsRevision: getSettings(store, actor.tenantId).revision, schedulerRunning: captureSchedulerRunning(store), grant: grant ? publicCaptureGrant(store, grant) : null, automaticConsent: false, automaticSending: false };
  }));
  app.get(base + '/operations/:key', crmHandler((request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const authority = captureOperationAuthority(store, request, 'read');
    return readCaptureOperation(store, authority, z.object({ key: z.string() }).strict().parse(request.params).key);
  }));
  app.post(base + '/grants', crmHandler((request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const authority = captureOperationAuthority(store, request, 'manage'), { actor, sessionHash } = authority;
    const body = z.object({ expectedTenantId: crmId, policy: policySchema, previousGrantId: crmId.nullable(), previousRevision: z.number().int().positive().safe().nullable() }).strict()
      .refine(value => (value.previousGrantId === null) === (value.previousRevision === null), 'Previous grant ID and revision must both be present or null').parse(request.body);
    const settingsRevision = expectedRevision(request.headers['if-match'], actor.tenantId, 'crm-settings'), key = receiptKey(request);
    body.policy.channelIds.sort(); body.policy.allowedFieldIds.sort();
    const receipt = performCaptureOperation(store, authority, { key, kind: 'grant.create', targetId: null, expectedTenantId: body.expectedTenantId, fingerprintInput: { body, settingsRevision } }, () => {
      const grant = activateCapture(store, actor, sessionHash, body.policy, settingsRevision, body.previousGrantId, body.previousRevision, undefined, authority.assertCurrent);
      return { targetId: grant.id, result: { grantId: grant.id, revision: grant.revision, status: grant.status } };
    });
    return reply.code(receipt.replayed ? 200 : 201).send(receipt);
  }));
  for (const action of ['pause', 'revoke'] as const) app.post(base + '/grants/:id/' + action, crmHandler((request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const authority = captureOperationAuthority(store, request, 'manage'), { actor, sessionHash } = authority, id = idOf(request);
    const revision = expectedRevision(request.headers['if-match'], id, 'capture-grant'), body = controlBody.parse(request.body), key = receiptKey(request);
    return performCaptureOperation(store, authority, { key, kind: action === 'pause' ? 'grant.pause' : 'grant.revoke', targetId: id, expectedTenantId: body.expectedTenantId, fingerprintInput: { body, revision } }, () => {
      const grant = stopCapture(store, actor, sessionHash, id, revision, action === 'pause' ? 'paused' : 'revoked', authority.assertCurrent);
      return { targetId: id, result: { grantId: id, revision: grant.revision, status: grant.status } };
    });
  }));
  for (const [path, collection] of [['jobs', jobs], ['proposals', proposals]]) app.get(base + '/' + path, crmHandler((request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const { actor } = human(store, request), query = z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) }).strict().parse(request.query);
    const rows = store.list(actor.tenantId, collection).reverse();
    return { total: rows.length, ...query, items: rows.slice((query.page - 1) * query.limit, query.page * query.limit).map(row => ({ id: row.id, status: row.status, revision: row.revision ?? null, conversationId: row.conversationId, proposalId: row.proposalId ?? null, reason: row.reason ?? null, reservedTokens: row.reservedTokens ?? null, usage: row.usage ?? null, createdAt: row.createdAt, updatedAt: row.updatedAt })) };
  }));
  app.get(base + '/proposals/:id', crmHandler((request, reply) => { const { actor } = human(store, request); const row = publicProposal(store, actor.tenantId, idOf(request)); return reply.header('ETag', '"capture-proposal:' + row.id + ':' + row.revision + '"').header('Cache-Control', 'no-store').send(row); }));
  app.post(base + '/proposals/:id/apply', crmHandler((request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const authority = captureOperationAuthority(store, request, 'review'), { actor, sessionHash } = authority, id = idOf(request);
    const proposalRevision = expectedRevision(request.headers['if-match'], id, 'capture-proposal');
    const body = z.object({ expectedTenantId: crmId, contactRevision: z.number().int().positive().safe().nullable(), selectedFieldIds: z.array(crmId).max(53).refine(ids => new Set(ids).size === ids.length).optional(), overrides: z.record(z.union([z.string().max(10000), z.boolean()])).default({}) }).strict().parse(request.body);
    body.selectedFieldIds?.sort(); const key = receiptKey(request);
    return performCaptureOperation(store, authority, { key, kind: 'proposal.apply', targetId: id, expectedTenantId: body.expectedTenantId, fingerprintInput: { body, proposalRevision } }, () => {
      const { expectedTenantId: _, ...application } = body;
      const result = applyCaptureProposal(store, actor.tenantId, id, { kind: 'human', input: { actor, sessionHash, key, proposalRevision, ...application }, assertAccess: authority.assertCurrent }) as { contactId: string; contactRevision: number; appliedFields: string[]; skippedFields: string[] };
      const proposal = store.get(actor.tenantId, proposals, id)!;
      return { targetId: id, result: { proposalId: id, proposalRevision: proposal.revision, contactId: result.contactId, contactRevision: result.contactRevision, appliedFields: result.appliedFields, skippedFields: result.skippedFields } };
    });
  }));
  app.post(base + '/proposals/:id/dismiss', crmHandler((request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const authority = captureOperationAuthority(store, request, 'review'), { actor, sessionHash } = authority, id = idOf(request);
    const revision = expectedRevision(request.headers['if-match'], id, 'capture-proposal'), body = controlBody.parse(request.body), key = receiptKey(request);
    return performCaptureOperation(store, authority, { key, kind: 'proposal.dismiss', targetId: id, expectedTenantId: body.expectedTenantId, fingerprintInput: { body, revision } }, () => {
      const proposal = dismissProposal(store, actor, sessionHash, id, revision, authority.assertCurrent)!;
      return { targetId: id, result: { proposalId: id, revision: proposal.revision, status: 'dismissed' } };
    });
  }));
  app.post(base + '/preview', crmHandler(async request => {
    const { actor } = human(store, request), body = z.object({ grantId: crmId, sourceEventId: crmId }).strict().parse(request.body);
    if (!hasPermission(actor.role, 'contacts:write')) fail('capture_human_authority_required', 403);
    const assertAccess = () => { const fresh = human(store, request).actor; if (!hasPermission(fresh.role, 'contacts:write')) fail('capture_human_authority_required', 403); };
    const job = queueCapturePreview(store, actor.tenantId, body.grantId, body.sourceEventId, undefined, assertAccess);
    const result = await worker.generate(actor.tenantId, job.id, assertAccess);
    human(store, request); return result;
  }));
  app.addHook('onClose', async () => { await worker.stop(); });
  return worker;
}
