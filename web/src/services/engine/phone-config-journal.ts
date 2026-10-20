import { parseExpectedContext } from './http'
import { validPhoneAttempt, type PhoneAttempt } from './phone-config'
import type { ExpectedContext } from './types'
export type PhoneReference = { attempt: PhoneAttempt; createdAt: string; terminal?: 'succeeded' | 'phone_configuration_changed' }
const fail = (): never => { throw Error('Não foi possível preservar a referência. Nenhum novo envio será iniciado.') }
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
export function createPhoneConfigJournal(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, input: ExpectedContext) {
  const context = parseExpectedContext(input), key = `kloel-phone-config:${context.userId}:${context.tenantId}`
  if (!context.tenantId || !context.membershipId) fail()
  function read(): PhoneReference[] {
    const text = storage.getItem(key); if (text === null) return []
    let raw: any; try { raw = JSON.parse(text) } catch { fail() }
    if (!raw || raw.schemaVersion !== 1 || !Array.isArray(raw.entries) || raw.entries.length > 100 || Object.keys(raw).sort().join() !== 'context,entries,schemaVersion') fail()
    const old = parseExpectedContext(raw.context)
    if (!same(old, context)) { storage.removeItem(key); if (storage.getItem(key) !== null) fail(); return [] }
    const entries: PhoneReference[] = raw.entries.map((e: any) => {
      if (!e || !validPhoneAttempt(e.attempt) || typeof e.createdAt !== 'string' || !Number.isFinite(Date.parse(e.createdAt)) || Object.keys(e).some(k => !['attempt', 'createdAt', 'terminal'].includes(k)) || e.terminal !== undefined && e.terminal !== 'succeeded' && !(e.terminal === 'phone_configuration_changed' && e.attempt.kind !== 'create')) fail()
      return { attempt: { ...e.attempt }, createdAt: e.createdAt, ...(e.terminal === undefined ? {} : { terminal: e.terminal }) }
    })
    if (new Set(entries.map(e => e.attempt.key)).size !== entries.length || entries.filter(e => !e.terminal).length > 1) fail()
    return entries
  }
  function save(entries: PhoneReference[], current: () => void) { current(); const text = JSON.stringify({ schemaVersion: 1, context, entries }); storage.setItem(key, text); current(); if (storage.getItem(key) !== text) fail(); current(); return entries }
  return {
    key, read,
    reserve(attempt: PhoneAttempt, current: () => void) {
      current(); if (!validPhoneAttempt(attempt)) fail(); const entries = read()
      if (entries.length >= 100 || entries.some(e => !e.terminal || e.attempt.key === attempt.key)) throw Error('Consulte a referência em aberto antes de preparar outra alteração.')
      return save([...entries, { attempt: { ...attempt }, createdAt: new Date().toISOString() }], current)
    },
    finish(attempt: PhoneAttempt, terminal: NonNullable<PhoneReference['terminal']>, current: () => void) {
      current(); const entries = read(), old = entries.find(e => e.attempt.key === attempt.key)
      if (!validPhoneAttempt(attempt) || !old || !same(old.attempt, attempt) || old.terminal && old.terminal !== terminal || terminal === 'phone_configuration_changed' && attempt.kind === 'create' || !['succeeded', 'phone_configuration_changed'].includes(terminal)) fail()
      return save(entries.map(e => e === old ? { ...e, terminal } : e), current)
    },
  }
}
