import type { EngineContext } from './session'
import { EngineError } from './http'
import type { CRMSettings, RawContact } from './crm'

export type CRMEditorGuard = { dirty: boolean; busy: boolean; pending: boolean }
export const emptyCRMGuard = (): CRMEditorGuard => ({ dirty: false, busy: false, pending: false })
export type CapturePolicy = { mode: 'review' | 'auto_create_fill_empty'; optIn: true; captureContacts: boolean; channelIds: string[]; allowedFieldIds: string[]; allowTransportMatch: boolean; expiresInDays: number; jobsPerDay: number; reservedTokensPerDay: number; maxMessagesPerJob: number; maxInputChars: number }
export const newCapturePolicy = (): CapturePolicy => ({ mode: 'review', optIn: true, captureContacts: false, channelIds: [], allowedFieldIds: [], allowTransportMatch: false, expiresInDays: 30, jobsPerDay: 20, reservedTokensPerDay: 100000, maxMessagesPerJob: 10, maxInputChars: 12000 })
export type CaptureGrant = { id: string; revision: number; status: string; epoch: string; policy: CapturePolicy; expiresAt: number; activatedAt: number; effective: boolean; captureEffective: boolean; aiFillEffective: boolean; automaticApplication: boolean; schedulerRunning: boolean; reason: string | null }
export type CaptureState = { settingsRevision: number; schedulerRunning: boolean; grant: CaptureGrant | null; automaticConsent: false; automaticSending: false }
export type CaptureRow = { id: string; status: string; revision: number | null; conversationId: string; proposalId: string | null; reason: string | null; createdAt: string; updatedAt: string }
export type CapturePage = { total: number; page: number; limit: number; items: CaptureRow[] }
export type CaptureEvidence = { sourceEventId: string; start: number; end: number; quote: string }
export type CaptureProposal = { id: string; revision: number; status: string; reason: string | null; targetContactId: string | null; targetRevision: number | null; conversationId: string; model: string; expiresAt: number; result: unknown; diff: { fieldId: string; value: string | boolean; previous: unknown; evidence: CaptureEvidence[] }[]; candidate: string | null; subject: string | null; gate: { satisfied: boolean; evidence: CaptureEvidence[] } | null; identityClaims: { kind: 'phone' | 'email'; value: string; evidence: CaptureEvidence[] }[]; creationIdentifiers: { kind: 'phone' | 'email'; value: string; source: 'transport' | 'claim' }[]; evidenceAvailable: boolean }
export type CaptureKind = 'grant.create' | 'grant.pause' | 'grant.revoke' | 'proposal.apply' | 'proposal.dismiss'
export type CaptureAttempt = { key: string; kind: CaptureKind; targetId?: string; revision?: number; settingsRevision?: number; previousGrantId?: string | null; previousRevision?: number | null; contactId?: string | null; contactRevision?: number | null }
export type CaptureOperation = { key: string; kind: CaptureKind; status: 'succeeded'; targetId: string; result: { grantId?: string; revision?: number; status?: string; proposalId?: string; proposalRevision?: number; contactId?: string; contactRevision?: number; appliedFields?: string[]; skippedFields?: string[] }; createdAt: string; automaticRetry: false }
export type CaptureChannel = { id: string; agentId: string; name: string; enabled: boolean; eligible: boolean; reasons: string[] }
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(v)
const nonnegative = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0
const positive = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) > 0
const nullableId = (v: unknown) => v === null || id(v)
const text = (v: unknown, max = 10000): v is string => typeof v === 'string' && v.length <= max
const date = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v))
const kinds: CaptureKind[] = ['grant.create', 'grant.pause', 'grant.revoke', 'proposal.apply', 'proposal.dismiss']
function invalid(): never { throw new EngineError(0, 'invalid_capture', 'Os dados de captura recebidos são incompatíveis. Nenhuma ação será repetida automaticamente.') }
function ids(v: unknown, max = 53): v is string[] { return Array.isArray(v) && v.length <= max && v.every(id) && new Set(v).size === v.length }
function policy(raw: unknown): CapturePolicy {
  if (!object(raw) || !['review', 'auto_create_fill_empty'].includes(raw.mode) || raw.optIn !== true || typeof raw.captureContacts !== 'boolean' || !ids(raw.channelIds, 20) || !ids(raw.allowedFieldIds, 50) || typeof raw.allowTransportMatch !== 'boolean') invalid()
  for (const [name, min, max] of [['expiresInDays', 1, 90], ['jobsPerDay', 1, 100], ['reservedTokensPerDay', 10000, 1000000], ['maxMessagesPerJob', 1, 20], ['maxInputChars', 200, 24000]] as const) if (!Number.isSafeInteger(raw[name]) || raw[name] < min || raw[name] > max) invalid()
  return { mode: raw.mode, optIn: true, captureContacts: raw.captureContacts, channelIds: [...raw.channelIds], allowedFieldIds: [...raw.allowedFieldIds], allowTransportMatch: raw.allowTransportMatch, expiresInDays: raw.expiresInDays, jobsPerDay: raw.jobsPerDay, reservedTokensPerDay: raw.reservedTokensPerDay, maxMessagesPerJob: raw.maxMessagesPerJob, maxInputChars: raw.maxInputChars }
}
export function capturePolicyInput(raw: CapturePolicy): CapturePolicy { const value = policy(raw); if (!value.channelIds.length || !value.captureContacts && !value.allowedFieldIds.length) throw new EngineError(400, 'invalid_policy', 'Selecione canais e ao menos captura de contatos ou campos.'); return value }
function grant(raw: unknown): CaptureGrant {
  if (!object(raw) || !id(raw.id) || !positive(raw.revision) || !text(raw.status, 80) || !text(raw.epoch, 128) || !Number.isFinite(raw.expiresAt) || !Number.isFinite(raw.activatedAt) || raw.reason !== null && !text(raw.reason, 200) || ['effective', 'captureEffective', 'aiFillEffective', 'automaticApplication', 'schedulerRunning'].some(k => typeof raw[k] !== 'boolean')) invalid()
  return { id: raw.id, revision: raw.revision, status: raw.status, epoch: raw.epoch, policy: policy(raw.policy), expiresAt: raw.expiresAt, activatedAt: raw.activatedAt, effective: raw.effective, captureEffective: raw.captureEffective, aiFillEffective: raw.aiFillEffective, automaticApplication: raw.automaticApplication, schedulerRunning: raw.schedulerRunning, reason: raw.reason }
}
function evidence(raw: unknown): CaptureEvidence[] {
  if (!Array.isArray(raw) || raw.length > 10) invalid()
  return raw.map(v => { if (!object(v) || !id(v.sourceEventId) || !Number.isSafeInteger(v.start) || v.start < 0 || !positive(v.end) || v.end <= v.start || !text(v.quote, 2000) || !v.quote || v.quote.length !== v.end - v.start) invalid(); return { sourceEventId: v.sourceEventId, start: v.start, end: v.end, quote: v.quote } })
}
function proposal(raw: unknown, target: string): CaptureProposal {
  if (!object(raw) || raw.id !== target || !positive(raw.revision) || !text(raw.status, 80) || !nullableId(raw.targetContactId) || raw.targetRevision !== null && !positive(raw.targetRevision) || !id(raw.conversationId) || !text(raw.model, 200) || !Number.isFinite(raw.expiresAt) || typeof raw.evidenceAvailable !== 'boolean' || !Array.isArray(raw.diff) || raw.diff.length > 53 || !Array.isArray(raw.identityClaims) || raw.identityClaims.length > 10 || !Array.isArray(raw.creationIdentifiers) || raw.creationIdentifiers.length > 20) invalid()
  const diff = raw.diff.map((v: any) => { if (!object(v) || !id(v.fieldId) || typeof v.value !== 'boolean' && !text(v.value)) invalid(); return { fieldId: v.fieldId, value: v.value, previous: v.previous, evidence: evidence(v.evidence) } })
  if (new Set(diff.map(v => v.fieldId)).size !== diff.length) invalid()
  const identityClaims = raw.identityClaims.map((v: any) => { if (!object(v) || !['phone', 'email'].includes(v.kind) || !text(v.value, 254)) invalid(); return { kind: v.kind, value: v.value, evidence: evidence(v.evidence) } })
  const creationIdentifiers = raw.creationIdentifiers.map((v: any) => { if (!object(v) || !['phone', 'email'].includes(v.kind) || !['transport', 'claim'].includes(v.source) || !text(v.value, 254)) invalid(); return { kind: v.kind, value: v.value, source: v.source } })
  if ((!raw.evidenceAvailable || raw.targetContactId) && creationIdentifiers.length || !raw.evidenceAvailable && (diff.length || identityClaims.length)) invalid()
  const gate = raw.gate === null ? null : object(raw.gate) && typeof raw.gate.satisfied === 'boolean' ? { satisfied: raw.gate.satisfied, evidence: evidence(raw.gate.evidence) } : invalid()
  return { id: target, revision: raw.revision, status: raw.status, reason: raw.reason, targetContactId: raw.targetContactId, targetRevision: raw.targetRevision, conversationId: raw.conversationId, model: raw.model, expiresAt: raw.expiresAt, result: raw.result, diff, candidate: raw.candidate, subject: raw.subject, gate, identityClaims, creationIdentifiers, evidenceAvailable: raw.evidenceAvailable }
}
export function validCaptureAttempt(raw: unknown): raw is CaptureAttempt {
  if (!object(raw) || typeof raw.key !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(raw.key) || !kinds.includes(raw.kind)) return false
  if (raw.kind === 'grant.create') return nonnegative(raw.settingsRevision) && nullableId(raw.previousGrantId) && (raw.previousGrantId === null ? raw.previousRevision === null : positive(raw.previousRevision))
  if (!id(raw.targetId) || !positive(raw.revision)) return false
  return raw.kind !== 'proposal.apply' || nullableId(raw.contactId) && (raw.contactId === null ? raw.contactRevision === null : positive(raw.contactRevision))
}
function operation(raw: unknown, attempt: CaptureAttempt): CaptureOperation {
  if (!object(raw) || raw.key !== attempt.key || raw.kind !== attempt.kind || raw.status !== 'succeeded' || raw.automaticRetry !== false || !id(raw.targetId) || attempt.targetId && raw.targetId !== attempt.targetId || !date(raw.createdAt) || !object(raw.result)) invalid()
  const r = raw.result; let result: CaptureOperation['result']
  if (attempt.kind.startsWith('grant.')) {
    if (r.grantId !== raw.targetId || !positive(r.revision) || !['active', 'paused', 'revoked'].includes(r.status) || r.status !== (attempt.kind === 'grant.create' ? 'active' : attempt.kind === 'grant.pause' ? 'paused' : 'revoked')) invalid()
    result = { grantId: r.grantId, revision: r.revision, status: r.status }
  } else if (attempt.kind === 'proposal.dismiss') {
    if (r.proposalId !== raw.targetId || !positive(r.revision) || r.status !== 'dismissed') invalid(); result = { proposalId: r.proposalId, revision: r.revision, status: 'dismissed' }
  } else {
    if (r.proposalId !== raw.targetId || !positive(r.proposalRevision) || !id(r.contactId) || attempt.contactId && r.contactId !== attempt.contactId || !positive(r.contactRevision) || !ids(r.appliedFields) || !ids(r.skippedFields) || r.appliedFields.some((v: string) => r.skippedFields.includes(v))) invalid()
    result = { proposalId: r.proposalId, proposalRevision: r.proposalRevision, contactId: r.contactId, contactRevision: r.contactRevision, appliedFields: [...r.appliedFields], skippedFields: [...r.skippedFields] }
  }
  return { key: raw.key, kind: raw.kind, status: 'succeeded', targetId: raw.targetId, result, createdAt: raw.createdAt, automaticRetry: false }
}
export function createCRMCaptureService(context: EngineContext) {
  const request = async <T,>(path: string, options?: Parameters<EngineContext['request']>[1]) => { const value = await context.request<T>(path, options); context.assertCurrent(); return value }
  return {
    async policy(): Promise<CaptureState> { const raw = await request<any>('/crm/capture/policy'); if (!object(raw) || !nonnegative(raw.settingsRevision) || typeof raw.schedulerRunning !== 'boolean' || raw.automaticConsent !== false || raw.automaticSending !== false) invalid(); return { settingsRevision: raw.settingsRevision, schedulerRunning: raw.schedulerRunning, grant: raw.grant === null ? null : grant(raw.grant), automaticConsent: false, automaticSending: false } },
    async settings(): Promise<CRMSettings> { const raw = await request<CRMSettings>('/crm/settings'); if (!object(raw) || !nonnegative(raw.revision) || !Array.isArray(raw.definitions)) invalid(); return raw },
    async channels(cursor?: string): Promise<{ items: CaptureChannel[]; nextCursor: string | null }> {
      const raw = await request<any>('/webchat/channels', { query: { limit: 25, cursor } }); if (!object(raw) || !Array.isArray(raw.items) || raw.items.length > 25 || raw.nextCursor !== null && !text(raw.nextCursor, 4096)) invalid()
      const items = raw.items.map((v: any) => { if (!object(v) || !id(v.id) || v.tenantId !== context.tenantId || !nullableId(v.agentId) || v.type !== 'webchat' || !text(v.name, 200) || typeof v.enabled !== 'boolean' || !object(v.readiness) || typeof v.readiness.available !== 'boolean' || !Array.isArray(v.readiness.reasons)) invalid(); return { id: v.id, agentId: v.agentId ?? '', name: v.name, enabled: v.enabled, eligible: v.enabled && v.provider === 'openai' && v.readiness.available === true, reasons: v.readiness.reasons.filter((v: unknown) => text(v, 100)) } }); return { items, nextCursor: raw.nextCursor }
    },
    async list(kind: 'jobs' | 'proposals', page = 1): Promise<CapturePage> { const raw = await request<any>(`/crm/capture/${kind}`, { query: { page, limit: 25 } }); if (!object(raw) || raw.page !== page || raw.limit !== 25 || !Number.isSafeInteger(raw.total) || raw.total < 0 || !Array.isArray(raw.items) || raw.items.length > 25) invalid(); const items = raw.items.map((v: any) => { if (!object(v) || !id(v.id) || !text(v.status, 80) || !id(v.conversationId) || v.revision !== null && !positive(v.revision) || !nullableId(v.proposalId) || !date(v.createdAt) || !date(v.updatedAt)) invalid(); return { id: v.id, status: v.status, revision: v.revision, conversationId: v.conversationId, proposalId: v.proposalId, reason: v.reason, createdAt: v.createdAt, updatedAt: v.updatedAt } }); return { total: raw.total, page, limit: 25, items } },
    async proposal(target: string) { if (!id(target)) invalid(); return proposal(await request(`/crm/capture/proposals/${target}`), target) },
    async contact(target: string): Promise<RawContact> { if (!id(target)) invalid(); const raw = await request<RawContact>(`/crm/contacts/${target}`); if (!object(raw) || raw.id !== target || raw.tenantId !== context.tenantId || !positive(raw.revision)) invalid(); return raw },
    async operation(attempt: CaptureAttempt) { if (!validCaptureAttempt(attempt)) invalid(); return operation(await request(`/crm/capture/operations/${attempt.key}`), attempt) },
    async write(attempt: CaptureAttempt, data?: CapturePolicy | { selectedFieldIds: string[]; overrides: Record<string, string | boolean> }): Promise<CaptureOperation> {
      if (!validCaptureAttempt(attempt)) invalid()
      const body: Record<string, unknown> = { expectedTenantId: context.tenantId }; let path: string, etag: string
      if (attempt.kind === 'grant.create') { Object.assign(body, { policy: capturePolicyInput(data as CapturePolicy), previousGrantId: attempt.previousGrantId, previousRevision: attempt.previousRevision }); path = '/crm/capture/grants'; etag = `"crm-settings:${context.tenantId}:${attempt.settingsRevision}"` }
      else {
        const [resource, action] = attempt.kind.split('.'); path = `/crm/capture/${resource === 'grant' ? 'grants' : 'proposals'}/${attempt.targetId}/${action}`; etag = `"capture-${resource}:${attempt.targetId}:${attempt.revision}"`
        if (attempt.kind === 'proposal.apply') { const applyData: unknown = data; if (!object(applyData) || !ids(applyData.selectedFieldIds) || !applyData.selectedFieldIds.length || !object(applyData.overrides) || Object.entries(applyData.overrides).some(([key, value]) => !applyData.selectedFieldIds.includes(key) || typeof value !== 'boolean' && !text(value))) invalid(); Object.assign(body, { contactRevision: attempt.contactRevision, selectedFieldIds: applyData.selectedFieldIds, overrides: applyData.overrides }) }
      }
      const raw = await request<any>(path, { method: 'POST', body, etag, idempotencyKey: attempt.key }); if (!object(raw) || typeof raw.replayed !== 'boolean') invalid(); return operation(raw.operation, attempt)
    },
  }
}
