import { EngineError } from './http'
import type { EngineContext } from './session'

export interface WhatsAppReplyContext {
  conversationId: string; tenantId: string; version: string; canReply: boolean; reasonCode: string | null
  channelId: string | null; sourceMessageId: string | null; windowExpiresAt: string | null
  destination: { display: string; provenance: 'signed_inbound' | 'operator_attested' } | null
  origin?: { display: string; provenance: 'signed_inbound' } | null; recipientAttestationId?: string; attestationExpiresAt?: string | null
}
export interface WhatsAppReplyReference { key: string; expectedVersion: string; recipientAttestationId?: string }
export interface WhatsAppReplyOperation {
  key: string; tenantId: string; kind: 'conversation_reply'; conversationId: string
  status: 'pending' | 'unknown' | 'failed' | 'succeeded'
  externalEffect: 'unconfirmed' | 'not_accepted' | 'accepted'; localLink: 'not_linked' | 'linked'
  messageId: string | null; deliveryStatus: null | 'accepted' | 'sent' | 'delivered' | 'read' | 'failed'
  requiresReconciliation: boolean; automaticRetry: false; errorCode: string | null
  graphCode?: number; graphSubcode?: number; createdAt: string; updatedAt: string
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
function invalid(): never { throw new EngineError(0, 'invalid_whatsapp_reply_response', 'Não foi possível confirmar a resposta desta conversa.') }
export function replyId(value: unknown): string { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) invalid(); return value }
export function replyKey(value: unknown): string { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(value)) invalid(); return value }
export function replyVersion(value: unknown): string { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) invalid(); return value }
const nullableId = (value: unknown) => value === null ? null : replyId(value)
function date(value: unknown): string { if (typeof value !== 'string' || value.length > 40 || !/^\d{4}-\d\d-\d\dT/.test(value) || !Number.isFinite(Date.parse(value))) invalid(); return value }
function code(value: unknown): string | null { if (value === null) return null; if (typeof value !== 'string' || !/^[a-z][a-z0-9_]{0,99}$/.test(value)) invalid(); return value }
function parseContext(raw: unknown, tenantId: string, conversationId: string, attestationId?: string): WhatsAppReplyContext {
  if (!object(raw) || raw.tenantId !== tenantId || raw.conversationId !== conversationId || typeof raw.canReply !== 'boolean') invalid()
  const reasonCode = code(raw.reasonCode), channelId = nullableId(raw.channelId), sourceMessageId = nullableId(raw.sourceMessageId)
  const windowExpiresAt = raw.windowExpiresAt === null ? null : date(raw.windowExpiresAt)
  let destination: WhatsAppReplyContext['destination'] = null
  if (raw.destination !== null) {
    if (!object(raw.destination) || raw.destination.provenance !== (attestationId ? 'operator_attested' : 'signed_inbound') || typeof raw.destination.display !== 'string' || raw.destination.display.length > 40 || !/[•*…]/.test(raw.destination.display) || !/^[+•*…\s-]*\d{0,4}$/.test(raw.destination.display)) invalid()
    destination = { display: raw.destination.display, provenance: attestationId ? 'operator_attested' : 'signed_inbound' }
  }
  let attested: Pick<WhatsAppReplyContext, 'origin' | 'recipientAttestationId' | 'attestationExpiresAt'> = {}
  if (attestationId) {
    if (raw.recipientAttestationId !== attestationId) invalid()
    let origin: WhatsAppReplyContext['origin'] = null
    if (raw.origin !== null) { if (!object(raw.origin) || raw.origin.provenance !== 'signed_inbound' || typeof raw.origin.display !== 'string' || !/^[•*…]{1,12}\d{1,4}$/.test(raw.origin.display)) invalid(); origin = { display: raw.origin.display, provenance: 'signed_inbound' } }
    const expires = raw.attestationExpiresAt === null ? null : date(raw.attestationExpiresAt)
    if (raw.canReply && (!origin || !expires)) invalid()
    attested = { recipientAttestationId: replyId(attestationId), origin, attestationExpiresAt: expires }
  } else if (raw.recipientAttestationId !== undefined || raw.origin !== undefined || raw.attestationExpiresAt !== undefined) invalid()
  if (raw.canReply && (reasonCode !== null || !channelId || !sourceMessageId || !windowExpiresAt || !destination)) invalid()
  return { conversationId, tenantId, version: replyVersion(raw.version), canReply: raw.canReply, reasonCode, channelId, sourceMessageId, windowExpiresAt, destination, ...attested }
}
function parseOperation(raw: unknown, tenantId: string, conversationId: string, key: string): WhatsAppReplyOperation {
  if (!object(raw) || raw.tenantId !== tenantId || raw.conversationId !== conversationId || raw.key !== key || raw.kind !== 'conversation_reply'
    || !['pending', 'unknown', 'failed', 'succeeded'].includes(String(raw.status)) || !['unconfirmed', 'not_accepted', 'accepted'].includes(String(raw.externalEffect))
    || !['not_linked', 'linked'].includes(String(raw.localLink)) || ![null, 'accepted', 'sent', 'delivered', 'read', 'failed'].includes(raw.deliveryStatus as any)
    || typeof raw.requiresReconciliation !== 'boolean' || raw.automaticRetry !== false) invalid()
  const messageId = nullableId(raw.messageId)
  if (raw.status === 'succeeded' && raw.externalEffect !== 'accepted' || raw.externalEffect === 'accepted' && raw.status !== 'succeeded'
    || raw.localLink === 'linked' && (!messageId || raw.externalEffect !== 'accepted') || raw.localLink === 'not_linked' && messageId !== null
    || raw.externalEffect !== 'accepted' && raw.deliveryStatus !== null || raw.externalEffect === 'accepted' && raw.deliveryStatus === null
    || raw.status === 'failed' && (raw.externalEffect !== 'not_accepted' || raw.requiresReconciliation)
    || ['pending', 'unknown'].includes(String(raw.status)) && (raw.externalEffect !== 'unconfirmed' || !raw.requiresReconciliation)
    || raw.externalEffect === 'accepted' && raw.requiresReconciliation !== (raw.localLink === 'not_linked')) invalid()
  const metadata: { graphCode?: number; graphSubcode?: number } = {}
  for (const name of ['graphCode', 'graphSubcode'] as const) if (raw[name] !== undefined) {
    if (!Number.isSafeInteger(raw[name]) || Number(raw[name]) < 0 || Number(raw[name]) > 2147483647) invalid()
    metadata[name] = Number(raw[name])
  }
  return { key, tenantId, conversationId, kind: 'conversation_reply', status: raw.status as WhatsAppReplyOperation['status'], externalEffect: raw.externalEffect as WhatsAppReplyOperation['externalEffect'], localLink: raw.localLink as WhatsAppReplyOperation['localLink'], messageId, deliveryStatus: raw.deliveryStatus as WhatsAppReplyOperation['deliveryStatus'], requiresReconciliation: raw.requiresReconciliation, automaticRetry: false, errorCode: code(raw.errorCode), createdAt: date(raw.createdAt), updatedAt: date(raw.updatedAt), ...metadata }
}
export function createWhatsAppConversationReplyService(context: EngineContext, conversationId: string) {
  const base = `/whatsapp/conversations/${replyId(conversationId)}`
  return {
    async context(signal?: AbortSignal, recipientAttestationId?: string) {
      context.assertCurrent(); const raw = await context.request(`${base}/reply-context`, { signal, ...(recipientAttestationId ? { query: { recipientAttestationId: replyId(recipientAttestationId) } } : {}) }); context.assertCurrent()
      if (signal?.aborted) throw new EngineError(0, 'superseded', '')
      return parseContext(raw, context.tenantId, conversationId, recipientAttestationId)
    },
    async send(reference: WhatsAppReplyReference, text: string) {
      const key = replyKey(reference.key), expectedVersion = replyVersion(reference.expectedVersion)
      if (typeof text !== 'string' || !text.trim() || text.trim().length > 4096) invalid()
      context.assertCurrent()
      const raw = await context.request<unknown>(`${base}/replies`, { method: 'POST', body: { expectedTenantId: context.tenantId, expectedVersion, idempotencyKey: key, text: text.trim(), confirm: true, ...(reference.recipientAttestationId ? { recipientAttestationId: replyId(reference.recipientAttestationId) } : {}) } })
      context.assertCurrent()
      if (!object(raw) || typeof raw.replayed !== 'boolean') invalid()
      return parseOperation(raw.operation, context.tenantId, conversationId, key)
    },
    async operation(reference: WhatsAppReplyReference) {
      const key = replyKey(reference.key); context.assertCurrent()
      const raw = await context.request(`${base}/reply-operations/${key}`); context.assertCurrent()
      return parseOperation(raw, context.tenantId, conversationId, key)
    },
  }
}
export function whatsappReplyError(error: unknown): string {
  if (error instanceof EngineError) {
    if (error.code === 'whatsapp_reply_not_admitted') return 'A conversa mudou antes de o envio começar. Atualize os dados e prepare novamente a resposta.'
    if (error.status === 404) return 'O recibo não está disponível para esta autorização. Isso não confirma ausência de envio. A chave foi preservada.'
    if (error.status === 401 || error.status === 403 || error.code === 'superseded') return 'Sua autorização mudou. Entre novamente para consultar a operação original.'
    if (error.code === 'reply_storage_unavailable') return 'Não foi possível preservar o acompanhamento nesta aba. Nenhuma nova solicitação foi enviada.'
  }
  return 'Não foi possível confirmar o resultado. Consulte o recibo original; a mensagem não será repetida automaticamente.'
}

type StorageScope = { userId: string; tenantId: string; membershipId: string; authorityVersion: string; conversationId: string }
/** CAS recovery pointer only: no message, recipient, credential or provider identity. */
export function createWhatsAppReplyJournal(storage: () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, scope: StorageScope) {
  const name = `kloel.whatsapp.conversation-reply.v1:${replyId(scope.userId)}:${replyId(scope.tenantId)}:${replyId(scope.membershipId)}:${replyVersion(scope.authorityVersion)}:${replyId(scope.conversationId)}`
  const fail = (): never => { throw new EngineError(0, 'reply_storage_unavailable', '') }
  function parse(raw: string | null): WhatsAppReplyReference | undefined {
    if (raw === null) return undefined
    if (raw.length > 1024) return fail()
    const value: unknown = JSON.parse(raw)
    if (!object(value) || !['expectedVersion,key,version', 'expectedVersion,key,recipientAttestationId,version'].includes(Object.keys(value).sort().join(',')) || value.version !== 1) return fail()
    return { key: replyKey(value.key), expectedVersion: replyVersion(value.expectedVersion), ...(value.recipientAttestationId !== undefined ? { recipientAttestationId: replyId(value.recipientAttestationId) } : {}) }
  }
  const equal = (a: WhatsAppReplyReference | undefined, b: WhatsAppReplyReference) => a?.key === b.key && a.expectedVersion === b.expectedVersion && a.recipientAttestationId === b.recipientAttestationId
  return {
    read() { try { return parse(storage().getItem(name)) } catch { return fail() } },
    remember(reference: WhatsAppReplyReference) {
      try {
        const value = { version: 1, key: replyKey(reference.key), expectedVersion: replyVersion(reference.expectedVersion), ...(reference.recipientAttestationId ? { recipientAttestationId: replyId(reference.recipientAttestationId) } : {}) }, target = storage(), current = parse(target.getItem(name))
        if (current && !equal(current, reference)) return fail()
        const raw = JSON.stringify(value); target.setItem(name, raw); if (target.getItem(name) !== raw) fail()
      } catch { fail() }
    },
    clearResolved(reference: WhatsAppReplyReference) {
      try { const target = storage(); if (!equal(parse(target.getItem(name)), reference)) return fail(); target.removeItem(name); if (target.getItem(name) !== null) fail() } catch { fail() }
    },
  }
}
