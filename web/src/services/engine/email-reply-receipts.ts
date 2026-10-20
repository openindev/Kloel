import { EngineError, parseExpectedContext } from './http'
import type { EngineContext } from './session'
import type { ExpectedContext } from './types'

export type EmailReplyAttempt = { key: string; mailboxId: string; draftId: string; expectedRevision: number }
export type EmailReplyReceipt = EmailReplyAttempt & { kind: 'email.reply'; id: string; status: 'pending' | 'accepted' | 'uncertain' | 'not_sent'; errorCode: string | null; requiresReconciliation: boolean; delivered: false; delivery: 'not_confirmed'; automaticRetry: false; createdAt: string; updatedAt: string }
export type EmailReplyReference = { attempt: EmailReplyAttempt; createdAt: string; resolution: 'accepted' | 'not_sent' | null }
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
function invalid(): never { throw new EngineError(502, 'invalid_response', 'O recibo não corresponde à tentativa original de e-mail.') }
export function emailReplyAttempt(v: unknown): EmailReplyAttempt {
  if (!object(v) || Object.keys(v).some(k => !['key', 'mailboxId', 'draftId', 'expectedRevision'].includes(k)) || !['key', 'mailboxId', 'draftId'].every(k => typeof v[k] === 'string' && uuid.test(v[k] as string)) || !Number.isSafeInteger(v.expectedRevision) || Number(v.expectedRevision) < 1) invalid()
  return { key: v.key as string, mailboxId: v.mailboxId as string, draftId: v.draftId as string, expectedRevision: v.expectedRevision as number }
}
export function parseEmailReplyReceipt(value: unknown, input: EmailReplyAttempt): EmailReplyReceipt {
  const a = emailReplyAttempt(input)
  if (!object(value) || value.kind !== 'email.reply' || !Object.entries(a).every(([k, v]) => value[k] === v) || typeof value.id !== 'string' || !uuid.test(value.id) || !['pending', 'accepted', 'uncertain', 'not_sent'].includes(String(value.status)) || value.delivered !== false || value.delivery !== 'not_confirmed' || value.automaticRetry !== false || value.requiresReconciliation !== ['pending', 'uncertain'].includes(String(value.status)) || ![value.createdAt, value.updatedAt].every(v => typeof v === 'string' && Number.isFinite(Date.parse(v))) || !(value.errorCode === null || typeof value.errorCode === 'string' && /^[a-zA-Z0-9_:-]{1,100}$/.test(value.errorCode))) invalid()
  return { ...a, id: value.id, kind: 'email.reply', status: value.status as EmailReplyReceipt['status'], errorCode: value.errorCode as string | null, requiresReconciliation: value.requiresReconciliation as boolean, delivered: false, delivery: 'not_confirmed', automaticRetry: false, createdAt: value.createdAt as string, updatedAt: value.updatedAt as string }
}
export function emailReplyReceiptClient(context: EngineContext) {
  return { async get(input: EmailReplyAttempt) {
    context.assertCurrent(); const attempt = emailReplyAttempt(input)
    const value = await context.request(`/email-agents/mailboxes/${attempt.mailboxId}/operations/${attempt.key}`)
    context.assertCurrent(); return parseEmailReplyReceipt(value, attempt)
  } }
}
export function createEmailReplyJournal(storage: Pick<Storage, 'getItem' | 'setItem'>, value: ExpectedContext) {
  const context = parseExpectedContext(value)
  const key = `kloel-email-replies:${context.userId}:${context.tenantId}:${context.membershipId}:${context.authorityVersion}`
  function unavailable(): never { throw Error('Não foi possível guardar e conferir a referência do envio. Nenhum novo envio será iniciado.') }
  function read(): EmailReplyReference[] {
    const bytes = storage.getItem(key); if (bytes === null) return []
    let raw: any; try { raw = JSON.parse(bytes) } catch { unavailable() }
    if (!raw || raw.schemaVersion !== 1 || JSON.stringify(parseExpectedContext(raw.context)) !== JSON.stringify(context) || !Array.isArray(raw.entries) || raw.entries.length > 100 || Object.keys(raw).some(k => !['schemaVersion', 'context', 'entries'].includes(k))) unavailable()
    const entries = raw.entries.map((r: any): EmailReplyReference => {
      if (!r || Object.keys(r).some(k => !['attempt', 'createdAt', 'resolution'].includes(k)) || typeof r.createdAt !== 'string' || !Number.isFinite(Date.parse(r.createdAt)) || ![null, 'accepted', 'not_sent'].includes(r.resolution)) unavailable()
      return { attempt: emailReplyAttempt(r.attempt), createdAt: r.createdAt, resolution: r.resolution }
    })
    if (new Set(entries.map((e: EmailReplyReference) => e.attempt.key)).size !== entries.length) unavailable()
    return entries
  }
  function save(entries: EmailReplyReference[], assertCurrent: () => void) {
    assertCurrent(); const bytes = JSON.stringify({ schemaVersion: 1, context, entries }); storage.setItem(key, bytes); assertCurrent()
    if (storage.getItem(key) !== bytes) unavailable()
    assertCurrent(); return entries
  }
  return { key, read,
    reserve(value: EmailReplyAttempt, assertCurrent: () => void) {
      assertCurrent(); const a = emailReplyAttempt(value), entries = read(), previous = entries.find(r => r.attempt.key === a.key)
      if (previous) { if (previous.resolution !== null || JSON.stringify(previous.attempt) !== JSON.stringify(a)) unavailable(); return save(entries, assertCurrent) }
      if (entries.length >= 100 || entries.some(r => r.resolution === null && r.attempt.draftId === a.draftId)) unavailable()
      return save([...entries, { attempt: a, createdAt: new Date().toISOString(), resolution: null }], assertCurrent)
    },
    observe(value: EmailReplyReceipt, assertCurrent: () => void) {
      assertCurrent(); const a = emailReplyAttempt({ key: value.key, mailboxId: value.mailboxId, draftId: value.draftId, expectedRevision: value.expectedRevision }), result = parseEmailReplyReceipt(value, a), entries = read(), previous = entries.find(r => r.attempt.key === a.key)
      if (!previous || JSON.stringify(previous.attempt) !== JSON.stringify(a)) unavailable()
      if (!['accepted', 'not_sent'].includes(result.status)) return entries
      const resolution = result.status as 'accepted' | 'not_sent'
      if (previous.resolution !== null && previous.resolution !== resolution) unavailable()
      return save(entries.map(r => r === previous ? { ...r, resolution } : r), assertCurrent)
    },
  }
}
