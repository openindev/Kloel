import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { recipientAttestationFixture } from './recipient-attestation.js';

export async function manualAiAdmissionFixture(t: any) {
  const f = await recipientAttestationFixture(t);
  const legacyPath = '/api/v1/conversations/' + f.legacy.id;
  const lc = await f.request('GET', legacyPath + '/control');
  const clean = await f.request('PATCH', legacyPath + '/control', { expectedVersion: lc.json().version, tags: [] }); assert.equal(clean.statusCode, 200, clean.body);
  // Explicitly review the changed collision; no product code clears old opt-outs.
  const review = await f.request('GET', f.path + '/whatsapp-identity-review');
  const applied = await f.request('POST', f.path + '/whatsapp-identity-review', { expectedTenantId: f.tenant, expectedVersion: review.json().version, key: randomUUID(), decision: 'human_only', confirm: true }); assert.equal(applied.statusCode, 200, applied.body);
  await f.control({ status: 'open', tags: [] });
  const path = '/conversations/' + f.conversationId;
  const contextResponse = (who = 'owner') => f.request('GET', path + '/manual-ai-context', undefined, undefined, who);
  const context = async () => { const r = await contextResponse(); assert.equal(r.statusCode, 200, r.body); return r.json(); };
  const input = (c: any, evidenceId?: string, key = randomUUID()) => ({ expectedTenantId: f.tenant, expectedVersion: c.version, sourceMessageId: c.sourceMessageId, key, ...(evidenceId ? { recipientEvidenceId: evidenceId } : {}), confirm: true });
  const admit = (body: any, who = 'owner') => f.request('POST', path + '/manual-ai-admissions', body, undefined, who);
  const operation = (key: string, who = 'owner') => f.request('GET', path + '/manual-ai-admissions/' + encodeURIComponent(key), undefined, undefined, who);
  const run = (o: any, who = 'owner') => f.request('POST', '/jobs/' + o.jobId + '/manual-once', { expectedTenantId: f.tenant, expectedVersion: o.jobVersion, confirm: true }, undefined, who);
  const once = (o: any, who = 'owner') => f.request('GET', '/jobs/' + o.jobId + '/manual-once?expectedVersion=' + o.jobVersion, undefined, undefined, who);
  const approve = async (evidenceId?: string) => { const body = input(await context(), evidenceId), r = await admit(body); assert.equal(r.statusCode, 200, r.body); return { body, operation: r.json().operation }; };
  return { ...f, legacyPath, contextResponse, context, input, admit, operation, run, once, approve };
}
