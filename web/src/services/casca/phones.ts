import type { PhoneNumber } from '@/domain/types'
import '@/domain/ext/engine-phones'
import { useStore } from '@/data/store'
import { countryFromPhone } from '@/app/pages/phone-numbers/countries'
import { EngineError } from '../engine/http'
import { captureEngineContext, engineSession, type EngineContext } from '../engine/session'
import type { ExpectedContext } from '../engine/types'
import { createPhonesService, type OwnedPhone, type CallerId, type PhonePatch, type CallerValidation } from '../engine/phones'
import { createPhoneConfigService, phoneAttempt, phoneRefusal, type ConfiguredPhone } from '../engine/phone-config'
import { createPhoneConfigJournal } from '../engine/phone-config-journal'
type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
function fail(message: string): never { throw new EngineError(0, 'phone_action_unavailable', message) }

/** Provider inventory proves existence, local configuration proves only its own routing intent. */
export function projectPhones(tenantId: string, local: ConfiguredPhone[], owned: OwnedPhone[], callers: CallerId[]): PhoneNumber[] {
  const rows: PhoneNumber[] = [], seen = new Set<string>()
  const append = (configured: ConfiguredPhone | null, purchased: OwnedPhone | null, caller: CallerId | null) => {
    const number = configured?.number ?? purchased?.phoneNumber ?? caller!.phoneNumber
    if (seen.has(number)) return fail('A lista de números mudou. Atualize antes de continuar.')
    seen.add(number)
    if (configured && configured.tenantId !== tenantId || configured?.providerNumberId && purchased && configured.providerNumberId !== purchased.sid) return fail('Não foi possível confirmar o cadastro deste número.')
    const inbound = purchased?.capabilities.voice === true
    rows.push({ id: configured?.id ?? `twilio_${purchased?.sid ?? caller!.sid}`, orgId: tenantId,
      name: configured?.name ?? purchased?.friendlyName ?? caller!.friendlyName, number, country: countryFromPhone(number), kind: caller && !purchased ? 'imported' : 'purchased',
      capabilities: caller && !purchased ? ['outbound'] : inbound ? ['inbound', 'outbound'] : [], agentId: configured?.agentId ?? undefined,
      minutesUsed: null, verified: !!purchased || !!caller, createdAt: configured?.createdAt ?? null,
      enginePhone: { local: configured, owned: purchased, callerId: caller, inboundReady: inbound && purchased.configuredVoiceWebhook && !!configured?.agentId } })
  }
  for (const row of local) append(row, owned.find(item => item.phoneNumber === row.number) ?? null, callers.find(item => item.phoneNumber === row.number) ?? null)
  for (const row of owned) if (!seen.has(row.phoneNumber)) append(null, row, null)
  for (const row of callers) if (!seen.has(row.phoneNumber)) append(null, null, row)
  return rows
}
export async function loadPhones(context: EngineContext, options: { verifyProvider?: boolean } = {}) {
  context.assertCurrent()
  const service = createPhonesService(context)
  const all = async <T extends { sid: string }>(read: (page: number) => Promise<{ items: T[]; nextPage: number | null }>) => {
    const rows: T[] = [], seen = new Set<string>(); let page = 0
    for (let i = 0; i < 1000; i++) { const result = await read(page); for (const item of result.items) { if (seen.has(item.sid)) fail('A lista de números mudou. Atualize antes de continuar.'); seen.add(item.sid); rows.push(item) } if (result.nextPage === null) return rows; page = result.nextPage }
    return fail('A lista de números excedeu o limite de consulta.')
  }
  const [local, provider] = await Promise.all([createPhoneConfigService(context).list(), options.verifyProvider === false ? null : service.availability()])
  context.assertCurrent()
  if (!provider?.tenantBound || !provider.catalogConfigured) return { phoneNumbers: projectPhones(context.tenantId, local, [], []) }
  const [owned, callers] = await Promise.all([all(page => service.listOwned(page)), all(page => service.listCallerIds(page))])
  context.assertCurrent(); return { phoneNumbers: projectPhones(context.tenantId, local, owned, callers) }
}
export function publishPhones(context: EngineContext, slice: Awaited<ReturnType<typeof loadPhones>>) {
  context.assertCurrent(); useStore.getState().mutate(db => ({ ...db, phoneNumbers: [...db.phoneNumbers.filter(row => row.orgId !== context.tenantId || !!row.whatsappAccountId), ...slice.phoneNumbers] }))
}
export function createPhoneActions(context: EngineContext, expected: ExpectedContext, storage: StoragePort) {
  const service = createPhoneConfigService(context), journal = createPhoneConfigJournal(storage, expected)
  const refresh = async () => { const slice = await loadPhones(context); publishPhones(context, slice); return slice }
  return {
    refresh,
    async update(number: PhoneNumber, patch: PhonePatch) {
      context.assertCurrent(); if (number.orgId !== context.tenantId) fail('A organização mudou. Atualize a lista.')
      const data = number.enginePhone; if (!data || !data.local && !data.owned) fail('A edição deste número ainda não está disponível.')
      const pending = journal.read().find(ref => !ref.terminal)
      if (pending) { await service.operation(pending.attempt); journal.finish(pending.attempt, 'succeeded', context.assertCurrent); await refresh(); return fail('A alteração anterior foi confirmada. Confira os dados antes de salvar novamente.') }
      const attempt = data.local ? phoneAttempt('update', data.local) : phoneAttempt('create')
      journal.reserve(attempt, context.assertCurrent)
      try {
        if (data.local) await service.update(attempt, patch)
        else await service.create(attempt, { name: patch.name ?? number.name, number: number.number, providerNumberId: data.owned!.sid, agentId: patch.agentId ?? null, channelId: patch.channelId ?? null })
        journal.finish(attempt, 'succeeded', context.assertCurrent)
      } catch (error) { if (phoneRefusal(error, attempt)) journal.finish(attempt, 'phone_configuration_changed', context.assertCurrent); throw error }
      await refresh()
    },
    async release(_number: PhoneNumber): Promise<never> { return fail('A liberação deste número na operadora ainda não está disponível.') },
  }
}

const phoneHash = async (phone: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(phone)))).map(byte => byte.toString(16).padStart(2, '0')).join('')
/** A caller-ID code is entered on the actual verification call; no browser comparison can approve it. */
export function createCallerVerification(context: EngineContext, expected: ExpectedContext, storage: StoragePort) {
  const service = createPhonesService(context), name = `kloel.caller-validation.v1:${expected.userId}:${context.tenantId}`
  type Ref = { context: ExpectedContext; key: string; phoneHash: string; startedAt: string; validationId?: string }
  const read = (): Ref | undefined => {
    const raw = storage.getItem(name); if (!raw) return undefined
    let ref: Ref; try { ref = JSON.parse(raw) } catch { return fail('Não foi possível ler a solicitação anterior.') }
    if (!ref || Object.keys(ref).some(key => !['context', 'key', 'phoneHash', 'startedAt', 'validationId'].includes(key)) || !/^[a-f\d-]{36}$/i.test(ref.key) || !/^[a-f\d]{64}$/i.test(ref.phoneHash) || !Number.isFinite(Date.parse(ref.startedAt)) || JSON.stringify(ref.context) !== JSON.stringify(expected)) return fail('Consulte a solicitação anterior antes de iniciar outra verificação.')
    return ref
  }
  const save = (ref: Ref) => { context.assertCurrent(); const serialized = JSON.stringify(ref); storage.setItem(name, serialized); if (storage.getItem(name) !== serialized) fail('Não foi possível guardar a solicitação. Nenhuma ligação foi iniciada.') }
  async function recover(ref: Ref, phone: string): Promise<CallerValidation> {
    if (await phoneHash(phone) !== ref.phoneHash) fail('Existe outra solicitação de importação pendente.')
    const items = await service.validations(), matches = items.filter(row => ref.validationId ? row.id === ref.validationId : row.phoneNumber === phone && row.createdAt >= ref.startedAt)
    if (matches.length !== 1 || matches[0].phoneNumber !== phone) fail('A ligação anterior ainda não foi confirmada. Consulte novamente antes de iniciar outra.')
    if (!ref.validationId) save({ ...ref, validationId: matches[0].id })
    return matches[0]
  }
  return {
    async start(phone: string) {
      if (!/^\+[1-9]\d{7,14}$/.test(phone)) fail('Digite um número internacional válido.')
      const prior = read()
      if (prior) return recover(prior, phone)
      const ref: Ref = { context: expected, key: crypto.randomUUID(), phoneHash: await phoneHash(phone), startedAt: new Date().toISOString() }; save(ref)
      const result = await service.requestValidation({ phoneNumber: phone, confirmCall: true }, ref.key)
      save({ ...ref, validationId: result.id }); return result
    },
    async confirm(phone: string) {
      const ref = read(); if (!ref) fail('Inicie a importação deste número antes de consultar a confirmação.')
      const current = await recover(ref, phone), result = current.verified ? current : await service.reconcileValidation(current)
      if (result.verified) { context.assertCurrent(); storage.removeItem(name); if (storage.getItem(name) !== null) fail('A confirmação precisa ser consultada novamente.'); publishPhones(context, await loadPhones(context)); }
      return result.verified
    },
  }
}

function currentScope() {
  const context = captureEngineContext('phones:write'), expected = engineSession.getSnapshot().data?.identity.context
  if (!expected) return fail('Atualize sua sessão antes de continuar.')
  return { context, expected, storage: window.sessionStorage }
}
export function phoneCommands() { const { context, expected, storage } = currentScope(); return createPhoneActions(context, expected, storage) }
export async function verifyImportedNumber(number: string) { const { context, expected, storage } = currentScope(); const row = await createCallerVerification(context, expected, storage).start(number); return { code: row.validationCode ?? '' } }
export async function confirmImportCode(number: string, _code: string) { const { context, expected, storage } = currentScope(); return createCallerVerification(context, expected, storage).confirm(number) }
/** Buys the next number of the org's allowance (included → DIDlogic, extra → Twilio) and binds it to the agent. */
export async function purchaseNumber(_countryLabel: string, onProgress?: (p: { step: number; total: number; label: string; percent: number }) => void, options: { agentId?: string; ddd?: string; phoneNumber?: string } = {}): Promise<{ number: string }> {
  const { context } = currentScope()
  onProgress?.({ step: 1, total: 2, label: 'Reservando número', percent: 30 })
  const row = await context.request<{ number?: unknown }>('/numbers/purchase', { method: 'POST', timeoutMs: 60000, body: { idempotencyKey: crypto.randomUUID(), ...(options.agentId ? { agentId: options.agentId } : {}), ...(options.ddd ? { ddd: options.ddd } : {}), ...(options.phoneNumber ? { phoneNumber: options.phoneNumber } : {}) } })
  context.assertCurrent()
  if (typeof row?.number !== 'string' || !/^\+[1-9]\d{7,14}$/.test(row.number)) return fail('Não foi possível confirmar o número adquirido.')
  onProgress?.({ step: 2, total: 2, label: 'Ativando número', percent: 100 })
  return { number: row.number }
}
export async function createSipNumber(): Promise<never> { return fail('A criação de números SIP ainda não está disponível.') }

/* ---------------------- Compra de números da plataforma ---------------------- */
export type NumberOffer = { enabled: boolean; extraMonthlyPriceBRL: number; allowance: { paid: boolean; included: number; extra: number; usedIncluded: number; usedExtra: number; remainingIncluded: number; remainingExtra: number } }
export type AvailableNumber = { phoneNumber: string; locality: string | null; region: string | null }
export type OwnedPlatformNumber = { id: string; number: string; name: string; locality: string | null; allowance: 'included' | 'extra'; monthlyPriceBRL: number; purchasedAt: string }
const scopedGet = async <T,>(path: string) => { const { context } = currentScope(); const row = await context.request<T>(path, { method: 'GET', timeoutMs: 30000 }); context.assertCurrent(); return row }
export const loadNumberOffer = () => scopedGet<NumberOffer>('/numbers/offer')
export const searchAvailableNumbers = (ddd: string) => scopedGet<{ allowance: 'included' | 'extra'; priceBRL: number; items: AvailableNumber[] }>(`/numbers/search?ddd=${encodeURIComponent(ddd)}&limit=10`)
export const loadOwnedPlatformNumbers = () => scopedGet<{ items: OwnedPlatformNumber[] }>('/numbers/owned')

/** Cobra o número extra (item da assinatura +1, pró-rata) ou devolve o link do checkout do Stripe. */
export async function chargeExtraNumberAddon(): Promise<{ status: 'active' } | { status: 'checkout'; url: string }> {
  const { context } = currentScope()
  const row = await context.request<{ status?: unknown; url?: unknown }>('/numbers/addon', { method: 'POST', timeoutMs: 60000, body: { idempotencyKey: crypto.randomUUID() } })
  context.assertCurrent()
  if (row?.status === 'checkout' && typeof row.url === 'string' && /^https:\/\/checkout\.stripe\.com\//.test(row.url)) return { status: 'checkout', url: row.url }
  if (row?.status === 'active') return { status: 'active' }
  return fail('Não foi possível confirmar a cobrança do número extra.')
}
