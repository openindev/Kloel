import { parseExpectedContext } from './http'
import { validWhatsAppChannelAttempt, type WhatsAppChannelAttempt } from './whatsapp-channels'
import type { ExpectedContext } from './types'
export type WhatsAppChannelReference = { attempt: WhatsAppChannelAttempt; createdAt: string; terminal?: 'succeeded' | 'whatsapp_channel_configuration_changed' }
const fail = (): never => { throw Error('Não foi possível preservar a referência do canal. Nenhuma nova alteração será iniciada.') }
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
export function createWhatsAppChannelJournal(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, input: ExpectedContext) {
  const context = parseExpectedContext(input), key = `kloel-whatsapp-config:${context.userId}:${context.tenantId}`
  if (!context.tenantId || !context.membershipId) fail()
  function read(): WhatsAppChannelReference[] {
    const text = storage.getItem(key); if (text === null) return []
    let raw: any; try { raw = JSON.parse(text) } catch { fail() }
    if (!raw || raw.schemaVersion !== 1 || !Array.isArray(raw.entries) || raw.entries.length > 100 || Object.keys(raw).sort().join() !== 'context,entries,schemaVersion') fail()
    const old = parseExpectedContext(raw.context)
    if (!same(old, context)) { storage.removeItem(key); if (storage.getItem(key) !== null) fail(); return [] }
    const entries: WhatsAppChannelReference[] = raw.entries.map((e: any) => {
      if (!e || !validWhatsAppChannelAttempt(e.attempt) || typeof e.createdAt !== 'string' || !Number.isFinite(Date.parse(e.createdAt)) || Object.keys(e).some(k => !['attempt', 'createdAt', 'terminal'].includes(k)) || e.terminal !== undefined && e.terminal !== 'succeeded' && !(e.terminal === 'whatsapp_channel_configuration_changed' && e.attempt.kind !== 'create')) fail()
      return { attempt: { ...e.attempt }, createdAt: e.createdAt, ...(e.terminal === undefined ? {} : { terminal: e.terminal }) }
    })
    if (new Set(entries.map(e => e.attempt.key)).size !== entries.length || entries.filter(e => !e.terminal).length > 1) fail()
    return entries
  }
  function save(entries: WhatsAppChannelReference[], current: () => void) { current(); const text = JSON.stringify({ schemaVersion: 1, context, entries }); storage.setItem(key, text); current(); if (storage.getItem(key) !== text) fail(); current(); return entries }
  return {
    key, read,
    reserve(attempt: WhatsAppChannelAttempt, current: () => void) {
      current(); if (!validWhatsAppChannelAttempt(attempt)) fail(); const entries = read()
      if (entries.length >= 100 || entries.some(e => !e.terminal || e.attempt.key === attempt.key)) throw Error('Consulte a referência em aberto antes de preparar outra alteração do canal.')
      return save([...entries, { attempt: { ...attempt }, createdAt: new Date().toISOString() }], current)
    },
    finish(attempt: WhatsAppChannelAttempt, terminal: NonNullable<WhatsAppChannelReference['terminal']>, current: () => void) {
      current(); const entries = read(), old = entries.find(e => e.attempt.key === attempt.key)
      if (!validWhatsAppChannelAttempt(attempt) || !old || !same(old.attempt, attempt) || old.terminal && old.terminal !== terminal || terminal === 'whatsapp_channel_configuration_changed' && attempt.kind === 'create' || !['succeeded', 'whatsapp_channel_configuration_changed'].includes(terminal)) fail()
      return save(entries.map(e => e === old ? { ...e, terminal } : e), current)
    },
  }
}

