import { randomUUID } from 'node:crypto';
import type { Entity, Store } from '../../store.js';
import { transaction } from '../service.js';
import { initializeCRMCapture, resolveCapture } from './authority.js';
import { buildExtraction, requestExtraction, validateExtraction, type GenerationOptions } from './extraction.js';
import { applyCaptureProposal, persistProposal, safeApplicationError } from './proposals.js';
import { collectSources, sourceEvent, sourceText } from './source-events.js';
import { setCaptureScheduler } from './runtime.js';
import { errorCode, fail, grants, jobs, proposals } from './schema.js';

export type CaptureWorkerOptions = GenerationOptions & { now?: () => number; maxJobsPerTick?: number };
export class CRMCaptureWorker {
  readonly now: () => number;
  private timer?: ReturnType<typeof setInterval>;
  private pending?: Promise<{ processed: number; skipped: boolean }>;
  private lastTenant = '';
  constructor(readonly store: Store, readonly options: CaptureWorkerOptions = {}) { initializeCRMCapture(store); this.now = options.now ?? Date.now; }
  start(intervalMs = 10000) { if (!this.timer) { this.timer = setInterval(() => { void this.tick().catch(() => {}); }, Math.max(1000, intervalMs)); this.timer.unref(); setCaptureScheduler(this.store, this, true); } }
  async stop() { if (this.timer) clearInterval(this.timer); this.timer = undefined; setCaptureScheduler(this.store, this, false); await this.pending?.catch(() => {}); }
  private rows(collection: string, where = '1=1', values: (number | string)[] = [], limit = 1000) { return this.store.db.prepare(`SELECT body FROM entities WHERE collection=? AND ${where} ORDER BY rowid LIMIT ?`).all(collection, ...values, limit).map(row => JSON.parse(String(row.body)) as Entity); }
  private recover() {
    transaction(this.store, () => {
      for (const job of this.rows(jobs, "json_extract(body,'$.status')='running' AND json_extract(body,'$.leaseUntil')<=?", [this.now()])) this.store.update(job.tenantId, jobs, job.id, { status: job.attemptedAt ? 'generation_unknown' : 'queued', leaseToken: null, reason: 'interrupted', ...(!job.attemptedAt ? { quotaDay: null, reservedTokens: 0 } : {}) });
      for (const grant of this.rows(grants, "json_extract(body,'$.status')='active'")) {
        try { resolveCapture(this.store, grant.tenantId, grant.id, this.now()); }
        catch (error) { this.store.update(grant.tenantId, grants, grant.id, { status: Number(grant.expiresAt) <= this.now() ? 'expired' : 'needs_reauthorization', reason: errorCode(error), revision: Number(grant.revision) + 1 }); }
      }
      for (const proposal of this.rows(proposals, "json_extract(body,'$.expiresAt')<=? AND json_type(body,'$.encryptedData')='text'", [this.now()])) this.store.update(proposal.tenantId, proposals, proposal.id, { encryptedData: null, ...(proposal.status === 'proposed' ? { status: 'expired', revision: Number(proposal.revision) + 1 } : {}) });
      this.store.db.prepare('DELETE FROM crm_source_events WHERE json_extract(body,\'$.expiresAt\')<=?').run(this.now());
    });
  }
  tick() {
    if (this.pending) return Promise.resolve({ processed: 0, skipped: true });
    const work = this.runTick(); this.pending = work; void work.finally(() => { if (this.pending === work) this.pending = undefined; }).catch(() => {}); return work;
  }
  private async runTick() {
    this.recover(); let processed = 0;
    const max = Math.min(20, Math.max(1, this.options.maxJobsPerTick ?? 5));
    // One oldest job per tenant each round; rotate tenants across ticks.
    const tenants = this.store.db.prepare("SELECT DISTINCT tenant_id FROM entities WHERE collection=? AND json_extract(body,'$.status')='queued' ORDER BY tenant_id").all(jobs).map(r => String(r.tenant_id));
    const split = tenants.findIndex(t => t > this.lastTenant), order = split < 0 ? tenants : [...tenants.slice(split), ...tenants.slice(0, split)];
    for (let round = 0; processed < max && round < max; round++) {
      let found = false;
      for (const tenant of order) {
        if (processed >= max) break;
        const job = this.rows(jobs, "tenant_id=? AND json_extract(body,'$.status')='queued' AND coalesce(json_extract(body,'$.dueAt'),0)<=?", [tenant, this.now()], 1)[0];
        if (!job) continue; found = true; this.lastTenant = tenant; await this.generate(tenant, job.id).catch(() => {}); processed++;
      }
      if (!found) break;
    }
    return { processed, skipped: false };
  }
  async generate(tenant: string, id: string, additionalGuard: () => void = () => {}) {
    let job = this.store.get(tenant, jobs, id); if (!job) fail('capture_job_not_found', 404);
    if (job.status !== 'queued') return { jobId: id, status: job.status, proposalId: job.proposalId ?? null };
    const lease = randomUUID(); let attempted = false;
    try {
      additionalGuard();
      const selected = resolveCapture(this.store, tenant, String(job.grantId), this.now(), { revision: job.grantRevision, epoch: job.epoch }), sources = collectSources(this.store, job, selected, this.now()), linked = sources.at(-1)?.source.conversationContactId, request = buildExtraction(selected, sources, linked ? this.store.get(tenant, 'contacts', linked)?.fieldValues as Record<string, string | boolean> | undefined : undefined);
      job = transaction(this.store, () => {
        additionalGuard(); resolveCapture(this.store, tenant, selected.grant.id, this.now(), { revision: job!.grantRevision, epoch: job!.epoch });
        const current = this.store.get(tenant, jobs, id)!; if (current.status !== 'queued') fail('capture_claim_lost');
        const day = new Date(this.now()).toISOString().slice(0, 10);
        const usage = this.store.db.prepare("SELECT count(*) AS calls,coalesce(sum(json_extract(body,'$.reservedTokens')),0) AS tokens FROM entities WHERE tenant_id=? AND collection=? AND json_extract(body,'$.quotaDay')=?").get(tenant, jobs, day)!;
        if (Number(usage.calls) >= selected.policy.jobsPerDay || Number(usage.tokens) + request.reservedTokens > selected.policy.reservedTokensPerDay) fail('capture_quota_exceeded', 429);
        return this.store.update(tenant, jobs, id, { status: 'running', leaseToken: lease, leaseUntil: this.now() + 90000, reservedTokens: request.reservedTokens, quotaDay: day, sourceIds: sources.map(s => s.source.id) })!;
      });
      const assertCurrent = () => {
        additionalGuard(); resolveCapture(this.store, tenant, String(job!.grantId), this.now(), { revision: job!.grantRevision, epoch: job!.epoch });
        const current = this.store.get(tenant, jobs, id);
        if (!current || current.status !== 'running' || current.leaseToken !== lease || Number(current.leaseUntil) <= this.now()) fail('capture_claim_lost');
        for (const source of sources) sourceText(this.store, source.source, this.now());
      };
      assertCurrent(); attempted = true;
      this.store.update(tenant, jobs, id, { attemptedAt: this.now() });
      const generated = await requestExtraction(request.body, this.options, assertCurrent);
      assertCurrent(); const extraction = validateExtraction(generated.result, selected, sources);
      const proposal = transaction(this.store, () => {
        assertCurrent();
        if (extraction.candidate === 'none') { this.store.update(tenant, jobs, id, { status: 'no_candidate', leaseToken: null, usage: generated.usage, responseId: generated.responseId }); return null; }
        const row = persistProposal(this.store, job!, selected, sources, extraction, generated, this.now());
        this.store.update(tenant, jobs, id, { status: 'proposed', proposalId: row.id, leaseToken: null, usage: generated.usage, responseId: generated.responseId }); return row;
      });
      if (proposal && selected.policy.mode === 'auto_create_fill_empty' && !job.forceReview) {
        try { additionalGuard(); applyCaptureProposal(this.store, tenant, proposal.id, { kind: 'grant' }, this.now()); }
        catch (error) { safeApplicationError(this.store, proposal, error); }
      }
      const final = this.store.get(tenant, jobs, id)!;
      return { jobId: id, status: final.status, proposalId: final.proposalId ?? null };
    } catch (error) {
      const current = this.store.get(tenant, jobs, id), code = errorCode(error);
      if (current && (current.status === 'queued' || current.status === 'running' && current.leaseToken === lease)) this.store.update(tenant, jobs, id, { status: attempted && ['capture_generation_unknown', 'capture_claim_lost'].includes(code) ? 'generation_unknown' : attempted && code === 'capture_provider_rejected' ? 'failed' : 'blocked', reason: code, leaseToken: null });
      throw error;
    }
  }
}
export function queueCapturePreview(store: Store, tenant: string, grantId: string, sourceId: string, now = Date.now(), assertAccess?: () => void) {
  return transaction(store, () => {
    assertAccess?.(); const selected = resolveCapture(store, tenant, grantId, now), source = sourceEvent(store, tenant, sourceId);
    const existing = store.list(tenant, jobs).find(j => j.grantId === grantId && j.epoch === selected.grant.epoch && j.sourceEventId === sourceId);
    if (existing) {
      if (existing.status === 'queued') return store.update(tenant, jobs, existing.id, { forceReview: true })!;
      if (existing.status === 'proposed' || existing.status === 'no_candidate') return existing;
      fail('capture_preview_requires_fresh_operation');
    }
    const candidate: Entity = { id: 'preview', createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(), tenantId: tenant, grantId, grantRevision: selected.grant.revision, epoch: selected.grant.epoch, sourceEventId: sourceId, conversationId: source.conversationId };
    collectSources(store, candidate, selected, now);
    return store.create(tenant, jobs, { ...candidate, status: 'queued', dueAt: now, sourceSequence: source.sequence, forceReview: true });
  });
}
