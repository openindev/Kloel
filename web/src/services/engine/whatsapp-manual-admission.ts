import { EngineError } from './http'
import type { EngineContext } from './session'

export interface ManualAdmissionEvidence {
  evidenceId: string; observedAt: string; expiresAt: string; deliveryStatus: 'delivered' | 'read'
  origin: { display: string; provenance: 'signed_inbound' }; destination: { display: string; provenance: 'meta_send_response_contact' }
}
export interface ManualAdmissionContext {
  tenantId: string; conversationId: string; version: string; canAdmit: boolean; reasonCode: string | null
  sourceMessageId: string | null; windowExpiresAt: string | null; origin: { display: string; provenance: 'signed_inbound' } | null
  evidence: { complete: boolean; items: ManualAdmissionEvidence[] }
}
export type ManualAdmissionReference = { key: string; expectedVersion: string }
export interface ManualAdmissionOperation {
  id: string; key: string; tenantId: string; conversationId: string; kind: 'manual_ai_admission'; status: 'admitted'
  sourceMessageId: string; recipientEvidenceId: string | null; originalVersion: string; jobId: string; jobVersion: string
  executionStarted: false; automaticRetry: false; createdAt: string
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
function invalid(): never { throw new EngineError(0, 'invalid_manual_ai_admission', 'Não foi possível confirmar a preparação da resposta de IA.') }
const id = (v: unknown): string => { if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(v)) invalid(); return v }
const key = (v: unknown): string => { if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(v)) invalid(); return v }
const version = (v: unknown): string => { if (typeof v !== 'string' || !/^[a-f0-9]{64}$/.test(v)) invalid(); return v }
const date = (v: unknown): string => { if (typeof v !== 'string' || v.length > 40 || !/^\d{4}-\d\d-\d\dT/.test(v) || !Number.isFinite(Date.parse(v))) invalid(); return v }
function masked<P extends 'signed_inbound' | 'meta_send_response_contact'>(v: unknown, provenance: P): { display: string; provenance: P } {
  if (!object(v) || v.provenance !== provenance || typeof v.display !== 'string' || !/^[•*…]{1,12}\d{1,4}$/.test(v.display)) invalid()
  return { display: v.display, provenance }
}
export function parseManualAdmissionContext(raw: unknown, tenantId: string, conversationId: string): ManualAdmissionContext {
  if (!object(raw) || raw.tenantId !== tenantId || raw.conversationId !== conversationId || typeof raw.canAdmit !== 'boolean'
    || raw.reasonCode !== null && (typeof raw.reasonCode !== 'string' || !/^[a-z0-9_]{1,100}$/.test(raw.reasonCode))
    || !object(raw.evidence) || typeof raw.evidence.complete !== 'boolean' || !Array.isArray(raw.evidence.items) || raw.evidence.items.length > 20) invalid()
  const sourceMessageId = raw.sourceMessageId === null ? null : id(raw.sourceMessageId)
  const windowExpiresAt = raw.windowExpiresAt === null ? null : date(raw.windowExpiresAt)
  const origin = raw.origin === null ? null : masked(raw.origin, 'signed_inbound')
  const items = raw.evidence.items.map(item => {
    if (!object(item) || !['delivered', 'read'].includes(String(item.deliveryStatus))) invalid()
    return { evidenceId: id(item.evidenceId), observedAt: date(item.observedAt), expiresAt: date(item.expiresAt), deliveryStatus: item.deliveryStatus as 'delivered' | 'read', origin: masked(item.origin, 'signed_inbound'), destination: masked(item.destination, 'meta_send_response_contact') }
  })
  if (new Set(items.map(item => item.evidenceId)).size !== items.length || items.some(item => Date.parse(item.expiresAt) <= Date.parse(item.observedAt))
    || raw.canAdmit && (raw.reasonCode !== null || !sourceMessageId || !windowExpiresAt || !origin)
    || !raw.canAdmit && raw.reasonCode === null) invalid()
  return { tenantId, conversationId, version: version(raw.version), canAdmit: raw.canAdmit, reasonCode: raw.reasonCode as string | null, sourceMessageId, windowExpiresAt, origin, evidence: { complete: raw.evidence.complete, items } }
}
function operation(raw: unknown, tenantId: string, conversationId: string, ref: ManualAdmissionReference): ManualAdmissionOperation {
  if (!object(raw) || raw.tenantId !== tenantId || raw.conversationId !== conversationId || raw.key !== ref.key || raw.originalVersion !== ref.expectedVersion
    || raw.kind !== 'manual_ai_admission' || raw.status !== 'admitted' || raw.executionStarted !== false || raw.automaticRetry !== false) invalid()
  return { id: id(raw.id), key: key(raw.key), tenantId, conversationId, kind: 'manual_ai_admission', status: 'admitted', sourceMessageId: id(raw.sourceMessageId), recipientEvidenceId: raw.recipientEvidenceId === null ? null : id(raw.recipientEvidenceId), originalVersion: version(raw.originalVersion), jobId: id(raw.jobId), jobVersion: version(raw.jobVersion), executionStarted: false, automaticRetry: false, createdAt: date(raw.createdAt) }
}
export function createManualAdmissionService(context: EngineContext, conversationId: string) {
  const base = '/whatsapp/conversations/' + id(conversationId)
  return {
    async context(signal?: AbortSignal) {
      context.assertCurrent(); const raw = await context.request(base + '/manual-ai-context', { signal }); context.assertCurrent()
      if (signal?.aborted) throw new EngineError(0, 'superseded', '')
      return parseManualAdmissionContext(raw, context.tenantId, conversationId)
    },
    async admit(ref: ManualAdmissionReference, sourceMessageId: string, recipientEvidenceId?: string) {
      const operationKey = key(ref.key), expectedVersion = version(ref.expectedVersion), source = id(sourceMessageId), evidence = recipientEvidenceId === undefined ? undefined : id(recipientEvidenceId)
      context.assertCurrent()
      const raw = await context.request(base + '/manual-ai-admissions', { method: 'POST', body: { expectedTenantId: context.tenantId, expectedVersion, key: operationKey, sourceMessageId: source, ...(evidence ? { recipientEvidenceId: evidence } : {}), confirm: true } })
      context.assertCurrent(); if (!object(raw) || typeof raw.replayed !== 'boolean') invalid()
      const receipt = operation(raw.operation, context.tenantId, conversationId, ref)
      if (receipt.sourceMessageId !== source || receipt.recipientEvidenceId !== (evidence ?? null)) invalid()
      return receipt
    },
    async operation(ref: ManualAdmissionReference) {
      const operationKey = key(ref.key); version(ref.expectedVersion); context.assertCurrent()
      const raw = await context.request(base + '/manual-ai-admissions/' + encodeURIComponent(operationKey)); context.assertCurrent()
      return operation(raw, context.tenantId, conversationId, ref)
    },
  }
}
export function manualAdmissionError(error: unknown): string {
  if (error instanceof EngineError) {
    if (error.code === 'manual_ai_admission_storage') return 'Não foi possível preservar o acompanhamento nesta aba. Novas solicitações estão bloqueadas.'
    if (error.status === 409 && error.code === 'whatsapp_manual_ai_not_admitted') return 'A resposta não foi preparada porque o contexto mudou. Atualize a entrada antes de confirmar novamente.'
    if (error.status === 404) return 'O recibo não está disponível para esta autorização. A referência foi preservada; isso não confirma ausência da preparação.'
    if (error.status === 401 || error.status === 403 || error.code === 'superseded') return 'Sua autorização mudou. Consulte a preparação com a autorização original.'
  }
  return 'Não foi possível confirmar a preparação. Consulte o recibo original; nenhuma solicitação será repetida automaticamente.'
}
export function createManualAdmissionJournal(storage: () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, scope: { userId: string; tenantId: string; membershipId: string; authorityVersion: string; conversationId: string }) {
  const name = `kloel.whatsapp.manual-admission.v1:${id(scope.userId)}:${id(scope.tenantId)}:${id(scope.membershipId)}:${version(scope.authorityVersion)}:${id(scope.conversationId)}`
  function fail(): never { throw new EngineError(0, 'manual_ai_admission_storage', '') }
  function parse(raw: string | null): ManualAdmissionReference | undefined {
    if (raw === null) return undefined
    if (raw.length > 1024) fail()
    const value: unknown = JSON.parse(raw)
    if (!object(value) || Object.keys(value).sort().join(',') !== 'expectedVersion,key,version' || value.version !== 1) fail()
    return { key: key(value.key), expectedVersion: version(value.expectedVersion) }
  }
  return {
    read() { try { return parse(storage().getItem(name)) } catch { return fail() } },
    remember(ref: ManualAdmissionReference) {
      try { const target = storage(), previous = target.getItem(name); if (parse(previous)) fail()
        const next = JSON.stringify({ version: 1, key: key(ref.key), expectedVersion: version(ref.expectedVersion) }); if (target.getItem(name) !== previous) fail()
        target.setItem(name, next); if (target.getItem(name) !== next) fail()
      } catch { fail() }
    },
    clearResolved(ref: ManualAdmissionReference) {
      try { const target = storage(), previous = target.getItem(name), current = parse(previous)
        if (current?.key !== ref.key || current.expectedVersion !== ref.expectedVersion || target.getItem(name) !== previous) fail()
        target.removeItem(name); if (target.getItem(name) !== null) fail()
      } catch { fail() }
    },
  }
}
