import { EngineError } from './http'
import type { EngineContext } from './session'

export const identityReasons = ['forbidden', 'unsupported_channel', 'not_required', 'already_reviewed', 'inbound_unverified', 'inbound_ambiguous', 'channel_unavailable', 'channel_changed', 'invalid_timestamp', 'outside_window', 'human_takeover_required', 'quarantine_tag_required', 'collisions_incomplete'] as const
export type IdentityReason = typeof identityReasons[number]
export interface IdentityReviewContext {
  tenantId: string; conversationId: string; version: string; reviewState: 'required' | 'valid' | 'stale' | 'not_required'; policy: 'manual_only' | null
  canReview: boolean; reasonCode: IdentityReason | null; sourceMessageId: string | null; channelId: string | null
  destination: { display: string; provenance: 'signed_inbound' } | null; windowExpiresAt: string | null
  collisions: { complete: boolean; items: { conversationId: string; status: 'open' | 'pending' | 'closed' | 'unknown'; noAi: boolean; humanHandoff: boolean }[] }
}
export type IdentityReviewReference = { key: string; expectedVersion: string }
export interface IdentityReviewOperation {
  tenantId: string; conversationId: string; key: string; kind: 'identity_human_review'; status: 'applied'; policy: 'manual_only'
  sourceMessageId: string; originalVersion: string; resultVersion: string; automaticRetry: false; createdAt: string
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
function invalid(): never { throw new EngineError(0, 'invalid_identity_review', 'Não foi possível confirmar a revisão desta origem.') }
function id(v: unknown): string { if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(v)) invalid(); return v }
function key(v: unknown): string { if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(v)) invalid(); return v }
function version(v: unknown): string { if (typeof v !== 'string' || !/^[a-f0-9]{64}$/.test(v)) invalid(); return v }
function date(v: unknown): string { if (typeof v !== 'string' || v.length > 40 || !/^\d{4}-\d\d-\d\dT/.test(v) || !Number.isFinite(Date.parse(v))) invalid(); return v }
const nullableId = (v: unknown) => v === null ? null : id(v)
export function parseIdentityReview(raw: unknown, tenantId: string, conversationId: string): IdentityReviewContext {
  if (!object(raw) || raw.tenantId !== tenantId || raw.conversationId !== conversationId || !['required', 'valid', 'stale', 'not_required'].includes(String(raw.reviewState))
    || ![null, 'manual_only'].includes(raw.policy as any) || typeof raw.canReview !== 'boolean'
    || raw.reasonCode !== null && !identityReasons.includes(raw.reasonCode as IdentityReason)
    || !object(raw.collisions) || typeof raw.collisions.complete !== 'boolean' || !Array.isArray(raw.collisions.items) || raw.collisions.items.length > 50) invalid()
  const sourceMessageId = nullableId(raw.sourceMessageId), channelId = nullableId(raw.channelId), windowExpiresAt = raw.windowExpiresAt === null ? null : date(raw.windowExpiresAt)
  let destination: IdentityReviewContext['destination'] = null
  if (raw.destination !== null) {
    if (!object(raw.destination) || raw.destination.provenance !== 'signed_inbound' || typeof raw.destination.display !== 'string' || !/^[•*…]{1,12}\d{1,4}$/.test(raw.destination.display)) invalid()
    destination = { display: raw.destination.display, provenance: 'signed_inbound' }
  }
  const items = raw.collisions.items.map(item => {
    if (!object(item) || !['open', 'pending', 'closed', 'unknown'].includes(String(item.status)) || typeof item.noAi !== 'boolean' || typeof item.humanHandoff !== 'boolean') invalid()
    return { conversationId: id(item.conversationId), status: item.status as IdentityReviewContext['collisions']['items'][number]['status'], noAi: item.noAi, humanHandoff: item.humanHandoff }
  })
  if (new Set(items.map(item => item.conversationId)).size !== items.length || items.some(item => item.conversationId === conversationId)
    || raw.canReview && (raw.reasonCode !== null || !['required', 'stale'].includes(String(raw.reviewState)) || !raw.collisions.complete || !sourceMessageId || !channelId || !destination || !windowExpiresAt)
    || !raw.canReview && raw.reasonCode === null || raw.reviewState === 'valid' && (raw.policy !== 'manual_only' || raw.canReview)
    || raw.reviewState === 'required' && raw.policy !== null) invalid()
  return { tenantId, conversationId, version: version(raw.version), reviewState: raw.reviewState as IdentityReviewContext['reviewState'], policy: raw.policy as IdentityReviewContext['policy'], canReview: raw.canReview, reasonCode: raw.reasonCode as IdentityReason | null,
    sourceMessageId, channelId, destination, windowExpiresAt, collisions: { complete: raw.collisions.complete, items } }
}
function parseOperation(raw: unknown, tenantId: string, conversationId: string, ref: IdentityReviewReference): IdentityReviewOperation {
  if (!object(raw) || raw.tenantId !== tenantId || raw.conversationId !== conversationId || raw.key !== ref.key || raw.originalVersion !== ref.expectedVersion
    || raw.kind !== 'identity_human_review' || raw.status !== 'applied' || raw.policy !== 'manual_only' || raw.automaticRetry !== false) invalid()
  return { tenantId, conversationId, key: key(raw.key), originalVersion: version(raw.originalVersion), resultVersion: version(raw.resultVersion), sourceMessageId: id(raw.sourceMessageId), kind: 'identity_human_review', status: 'applied', policy: 'manual_only', automaticRetry: false, createdAt: date(raw.createdAt) }
}
export function createIdentityReviewService(context: EngineContext, conversationId: string) {
  const base = `/conversations/${id(conversationId)}`
  return {
    async context(signal?: AbortSignal) {
      context.assertCurrent(); const raw = await context.request(base + '/whatsapp-identity-review', { signal }); context.assertCurrent()
      if (signal?.aborted) throw new EngineError(0, 'superseded', '')
      return parseIdentityReview(raw, context.tenantId, conversationId)
    },
    async apply(ref: IdentityReviewReference) {
      const operationKey = key(ref.key), expectedVersion = version(ref.expectedVersion); context.assertCurrent()
      const raw = await context.request(base + '/whatsapp-identity-review', { method: 'POST', body: { expectedTenantId: context.tenantId, expectedVersion, key: operationKey, decision: 'human_only', confirm: true } }); context.assertCurrent()
      if (!object(raw) || typeof raw.replayed !== 'boolean') invalid()
      return parseOperation(raw.operation, context.tenantId, conversationId, ref)
    },
    async operation(ref: IdentityReviewReference) {
      const operationKey = key(ref.key); version(ref.expectedVersion); context.assertCurrent()
      const raw = await context.request(base + '/whatsapp-identity-operations/' + encodeURIComponent(operationKey)); context.assertCurrent()
      return parseOperation(raw, context.tenantId, conversationId, ref)
    },
  }
}
export function identityReviewError(error: unknown) {
  if (error instanceof EngineError) {
    if (error.code === 'identity_review_storage') return 'Não foi possível preservar o acompanhamento nesta aba. Novas decisões estão bloqueadas.'
    if (error.code === 'whatsapp_identity_review_not_admitted' && error.status === 409) return 'A revisão não foi gravada: o contexto mudou. Consulte a origem atual antes de confirmar novamente.'
    if (error.status === 404) return 'O recibo não está disponível para esta autorização. Isso não confirma ausência da decisão; a referência foi preservada.'
    if (error.code === 'superseded' || error.status === 401 || error.status === 403) return 'Sua autorização mudou. Consulte a decisão com a autorização original.'
  }
  return 'Não foi possível confirmar a decisão. Consulte o recibo original; nenhuma repetição será feita automaticamente.'
}
export function createIdentityReviewJournal(storage: () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, scope: { userId: string; tenantId: string; membershipId: string; authorityVersion: string; conversationId: string }) {
  const name = `kloel.whatsapp.identity-review.v1:${id(scope.userId)}:${id(scope.tenantId)}:${id(scope.membershipId)}:${version(scope.authorityVersion)}:${id(scope.conversationId)}`
  function fail(): never { throw new EngineError(0, 'identity_review_storage', '') }
  function parse(raw: string | null): IdentityReviewReference | undefined {
    if (raw === null) return undefined
    if (raw.length > 1024) fail()
    const value: unknown = JSON.parse(raw)
    if (!object(value) || Object.keys(value).sort().join(',') !== 'expectedVersion,key,version' || value.version !== 1) fail()
    return { key: key(value.key), expectedVersion: version(value.expectedVersion) }
  }
  const same = (a: IdentityReviewReference | undefined, b: IdentityReviewReference) => a?.key === b.key && a.expectedVersion === b.expectedVersion
  return {
    read() { try { return parse(storage().getItem(name)) } catch { return fail() } },
    remember(ref: IdentityReviewReference) {
      try { const target = storage(), previous = target.getItem(name); if (parse(previous)) fail()
        const next = JSON.stringify({ version: 1, key: key(ref.key), expectedVersion: version(ref.expectedVersion) }); if (target.getItem(name) !== previous) fail()
        target.setItem(name, next); if (target.getItem(name) !== next) fail()
      } catch { fail() }
    },
    clearResolved(ref: IdentityReviewReference) {
      try { const target = storage(), previous = target.getItem(name); if (!same(parse(previous), ref) || target.getItem(name) !== previous) fail()
        target.removeItem(name); if (target.getItem(name) !== null) fail()
      } catch { fail() }
    },
  }
}
