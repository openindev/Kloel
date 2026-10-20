import { EngineError } from './http'
import type { EngineContext } from './session'
import { replyId, replyKey, replyVersion } from './whatsapp-conversation-replies'

export const attestationReasons = ['forbidden', 'identity_review_required', 'human_takeover_required', 'outside_window', 'evidence_unavailable', 'evidence_incomplete', 'send_requires_reconciliation', 'attestation_unavailable', 'attestation_consumed', 'attestation_stale'] as const
export type AttestationReason = typeof attestationReasons[number]
type Origin = { display: string; provenance: 'signed_inbound' }
export interface RecipientEvidence {
  evidenceId: string; observedAt: string; expiresAt: string; deliveryStatus: 'delivered' | 'read'; origin: Origin
  destination: { display: string; provenance: 'meta_send_response_contact' }; observedChannelVersion: string; currentChannelVersion: string; currentChannelRevision: number
}
export interface RecipientContext {
  tenantId: string; conversationId: string; version: string; canAttest: boolean; reasonCode: AttestationReason | null
  sourceMessageId: string | null; origin: Origin | null; destinationPolicy: 'explicit_attestation_only'; evidence: { complete: boolean; items: RecipientEvidence[] }
}
export type RecipientReference = { key: string; expectedVersion: string; evidenceId: string }
export interface RecipientAttestation {
  id: string; key: string; kind: 'recipient_attestation'; tenantId: string; conversationId: string; status: 'attested'
  sourceMessageId: string; evidenceId: string; originalVersion: string; expiresAt: string; consumedByReplyKey: string | null; automaticRetry: false; createdAt: string
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
function invalid(): never { throw new EngineError(0, 'invalid_recipient_attestation', '') }
function date(v: unknown): string { if (typeof v !== 'string' || v.length > 40 || !/^\d{4}-\d\d-\d\dT/.test(v) || !Number.isFinite(Date.parse(v))) invalid(); return v }
function masked<P extends 'signed_inbound' | 'meta_send_response_contact'>(v: unknown, provenance: P): { display: string; provenance: P } {
  if (!object(v) || v.provenance !== provenance || typeof v.display !== 'string' || !/^[•*…]{1,12}\d{1,4}$/.test(v.display)) invalid()
  return { display: v.display, provenance }
}
export function parseRecipientContext(raw: unknown, tenantId: string, conversationId: string): RecipientContext {
  if (!object(raw) || raw.tenantId !== tenantId || raw.conversationId !== conversationId || typeof raw.canAttest !== 'boolean' || raw.destinationPolicy !== 'explicit_attestation_only'
    || raw.reasonCode !== null && !attestationReasons.includes(raw.reasonCode as AttestationReason)
    || !object(raw.evidence) || typeof raw.evidence.complete !== 'boolean' || !Array.isArray(raw.evidence.items) || raw.evidence.items.length > 20) invalid()
  const origin = raw.origin === null ? null : masked(raw.origin, 'signed_inbound'), sourceMessageId = raw.sourceMessageId === null ? null : replyId(raw.sourceMessageId)
  const items = raw.evidence.items.map(item => {
    if (!object(item) || !['delivered', 'read'].includes(String(item.deliveryStatus)) || !Number.isSafeInteger(item.currentChannelRevision) || Number(item.currentChannelRevision) < 0) invalid()
    const itemOrigin = masked(item.origin, 'signed_inbound'), observedAt = date(item.observedAt), expiresAt = date(item.expiresAt)
    if (!origin || itemOrigin.display !== origin.display || Date.parse(expiresAt) <= Date.parse(observedAt)) invalid()
    return { evidenceId: replyId(item.evidenceId), observedAt, expiresAt, deliveryStatus: item.deliveryStatus as RecipientEvidence['deliveryStatus'], origin: itemOrigin, destination: masked(item.destination, 'meta_send_response_contact'), observedChannelVersion: replyVersion(item.observedChannelVersion), currentChannelVersion: replyVersion(item.currentChannelVersion), currentChannelRevision: Number(item.currentChannelRevision) }
  })
  if (new Set(items.map(i => i.evidenceId)).size !== items.length || raw.canAttest && (raw.reasonCode !== null || !raw.evidence.complete || !sourceMessageId || !origin || !items.length) || !raw.canAttest && raw.reasonCode === null) invalid()
  return { tenantId, conversationId, version: replyVersion(raw.version), canAttest: raw.canAttest, reasonCode: raw.reasonCode as AttestationReason | null, sourceMessageId, origin, destinationPolicy: 'explicit_attestation_only', evidence: { complete: raw.evidence.complete, items } }
}
function parseOperation(raw: unknown, tenantId: string, conversationId: string, ref: RecipientReference): RecipientAttestation {
  if (!object(raw) || raw.tenantId !== tenantId || raw.conversationId !== conversationId || raw.key !== ref.key || raw.originalVersion !== ref.expectedVersion || raw.evidenceId !== ref.evidenceId
    || raw.kind !== 'recipient_attestation' || raw.status !== 'attested' || raw.automaticRetry !== false) invalid()
  return { id: replyId(raw.id), key: replyKey(raw.key), kind: 'recipient_attestation', tenantId, conversationId, status: 'attested', sourceMessageId: replyId(raw.sourceMessageId), evidenceId: replyId(raw.evidenceId), originalVersion: replyVersion(raw.originalVersion), expiresAt: date(raw.expiresAt), consumedByReplyKey: raw.consumedByReplyKey === null ? null : replyKey(raw.consumedByReplyKey), automaticRetry: false, createdAt: date(raw.createdAt) }
}
export function createRecipientAttestationService(context: EngineContext, conversationId: string) {
  const base = '/whatsapp/conversations/' + replyId(conversationId)
  return {
    async context(signal?: AbortSignal) { context.assertCurrent(); const raw = await context.request(base + '/recipient-context', { signal }); context.assertCurrent(); if (signal?.aborted) throw new EngineError(0, 'superseded', ''); return parseRecipientContext(raw, context.tenantId, conversationId) },
    async attest(ref: RecipientReference) {
      const body = { expectedTenantId: context.tenantId, expectedVersion: replyVersion(ref.expectedVersion), key: replyKey(ref.key), evidenceId: replyId(ref.evidenceId), confirm: true }
      context.assertCurrent(); const raw = await context.request(base + '/recipient-attestations', { method: 'POST', body }); context.assertCurrent()
      if (!object(raw) || typeof raw.replayed !== 'boolean') invalid(); return parseOperation(raw.operation, context.tenantId, conversationId, ref)
    },
    async operation(ref: RecipientReference) { replyVersion(ref.expectedVersion); replyId(ref.evidenceId); context.assertCurrent(); const raw = await context.request(base + '/recipient-attestations/' + replyKey(ref.key)); context.assertCurrent(); return parseOperation(raw, context.tenantId, conversationId, ref) },
  }
}
export function recipientError(error: unknown) {
  if (error instanceof EngineError) {
    if (error.code === 'recipient_storage') return 'Não foi possível preservar o acompanhamento nesta aba. Novos atestados estão bloqueados.'
    if (error.status === 409 && error.code === 'recipient_attestation_not_admitted') return 'O atestado não foi registrado: o contexto mudou. Consulte as provas atuais antes de decidir novamente.'
    if (error.status === 404) return 'O recibo não está disponível para esta autorização. Isso não confirma ausência do atestado. A referência foi preservada.'
    if (error.code === 'superseded' || error.status === 401 || error.status === 403) return 'Sua autorização mudou. Consulte o atestado com a autorização original.'
  }
  return 'Não foi possível confirmar o atestado. Consulte o recibo original; nenhuma decisão ou mensagem será repetida automaticamente.'
}
export function createRecipientJournal(storage: () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, scope: { userId: string; tenantId: string; membershipId: string; authorityVersion: string; conversationId: string }) {
  const name = `kloel.whatsapp.recipient-attestation.v1:${replyId(scope.userId)}:${replyId(scope.tenantId)}:${replyId(scope.membershipId)}:${replyVersion(scope.authorityVersion)}:${replyId(scope.conversationId)}`
  function fail(): never { throw new EngineError(0, 'recipient_storage', '') }
  function parse(raw: string | null): RecipientReference | undefined { if (raw === null) return; if (raw.length > 1024) fail(); const v: unknown = JSON.parse(raw); if (!object(v) || Object.keys(v).sort().join(',') !== 'evidenceId,expectedVersion,key,version' || v.version !== 1) fail(); return { key: replyKey(v.key), expectedVersion: replyVersion(v.expectedVersion), evidenceId: replyId(v.evidenceId) } }
  const same = (a: RecipientReference | undefined, b: RecipientReference) => a?.key === b.key && a.expectedVersion === b.expectedVersion && a.evidenceId === b.evidenceId
  return {
    read() { try { return parse(storage().getItem(name)) } catch { return fail() } },
    remember(ref: RecipientReference) { try { const s = storage(), old = s.getItem(name); if (parse(old)) fail(); const next = JSON.stringify({ version: 1, key: replyKey(ref.key), expectedVersion: replyVersion(ref.expectedVersion), evidenceId: replyId(ref.evidenceId) }); if (s.getItem(name) !== old) fail(); s.setItem(name, next); if (s.getItem(name) !== next) fail() } catch { fail() } },
    clearResolved(ref: RecipientReference) { try { const s = storage(), old = s.getItem(name); if (!same(parse(old), ref) || s.getItem(name) !== old) fail(); s.removeItem(name); if (s.getItem(name) !== null) fail() } catch { fail() } },
  }
}
