import type { WhatsAppAccount, PhoneNumber } from '@/domain/types'
import '@/domain/ext/engine-whatsapp'
import '@/domain/ext/mais-a'
import { useStore } from '@/data/store'
import { countryFromPhone } from '@/app/pages/phone-numbers/countries'
import { EngineError } from '../engine/http'
import { captureEngineContext, engineSession, type EngineContext } from '../engine/session'
import type { ExpectedContext } from '../engine/types'
import { createWhatsAppChannelsService, whatsappChannelAttempt, whatsappChannelRefusal, type ConfiguredWhatsAppChannel, type WhatsAppChannelAttempt, type WhatsAppChannelPatch } from '../engine/whatsapp-channels'
import { createWhatsAppChannelJournal } from '../engine/whatsapp-channel-journal'
import { createWhatsAppConnectionService, type WhatsAppConnectionVerification } from '../engine/whatsapp-connection'
type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
function fail(message: string): never { throw new EngineError(0, 'whatsapp_action_unavailable', message) }

export function projectWhatsApp(tenantId: string, rows: ConfiguredWhatsAppChannel[], verified = new Map<string, WhatsAppConnectionVerification>()) {
  const whatsappAccounts: WhatsAppAccount[] = [], phoneNumbers: PhoneNumber[] = [], ids = new Set<string>()
  for (const row of rows) {
    if (row.tenantId !== tenantId || ids.has(row.id)) fail('A lista de contas mudou. Atualize antes de continuar.')
    ids.add(row.id)
    const candidate = verified.get(row.id), proof = candidate?.version === row.version && candidate.tenantId === tenantId && candidate.phoneId === row.externalId ? candidate : null
    const connected = row.enabled && row.readiness.canEnable && proof?.phone.status === 'CONNECTED'
    const quality = proof?.phone.qualityRating, invalid = row.provider !== 'meta' || ['BANNED', 'RESTRICTED', 'FLAGGED', 'DELETED'].includes(proof?.phone.status ?? '')
    const phoneId = row.address ? `whatsapp_${row.id}` : undefined
    whatsappAccounts.push({ id: row.id, orgId: tenantId, businessName: row.name, number: row.address ?? '—', status: invalid ? 'error' : connected ? 'connected' : 'pending', agentId: row.agentId ?? undefined,
      qualityRating: quality === 'GREEN' ? 'high' : quality === 'YELLOW' ? 'medium' : quality === 'RED' ? 'low' : 'unknown', messagesThisMonth: null, connectedAt: null, phoneNumberId: phoneId,
      engineWhatsApp: { channel: row, verification: proof } })
    if (row.address) phoneNumbers.push({ id: phoneId!, orgId: tenantId, name: `WhatsApp · ${row.name}`, number: row.address, country: countryFromPhone(row.address), kind: 'imported', capabilities: ['whatsapp'], agentId: row.agentId ?? undefined, minutesUsed: null, verified: proof?.phone.codeVerificationStatus === 'VERIFIED', createdAt: row.createdAt, whatsappAccountId: row.id })
  }
  return { whatsappAccounts, phoneNumbers }
}
export async function loadWhatsApp(context: EngineContext, options: { verifyMetadata?: boolean } = {}) {
  const service = createWhatsAppChannelsService(context), rows: ConfiguredWhatsAppChannel[] = [], proofs = new Map<string, WhatsAppConnectionVerification>()
  let cursor: string | undefined
  for (let i = 0; i < 1000; i++) {
    const page = await service.list({ limit: 100, cursor }); rows.push(...page.items)
    if (!page.nextCursor) break
    if (i === 999) fail('A lista de contas excedeu o limite de consulta.')
    cursor = page.nextCursor
  }
  if (options.verifyMetadata) {
    const verification = createWhatsAppConnectionService(context)
    for (const row of rows) if (row.provider === 'meta' && row.externalId) {
      // A failed provider read cannot turn configuration into a verified connection.
      try { proofs.set(row.id, await verification.verify(row)) } catch { context.assertCurrent() }
    }
  }
  context.assertCurrent(); return projectWhatsApp(context.tenantId, rows, proofs)
}
export function publishWhatsApp(context: EngineContext, slice: ReturnType<typeof projectWhatsApp>) {
  context.assertCurrent(); useStore.getState().mutate(db => ({ ...db,
    whatsappAccounts: [...db.whatsappAccounts.filter(row => row.orgId !== context.tenantId), ...slice.whatsappAccounts],
    phoneNumbers: [...db.phoneNumbers.filter(row => row.orgId !== context.tenantId || !row.whatsappAccountId), ...slice.phoneNumbers] }))
}
export function createWhatsAppActions(context: EngineContext, expected: ExpectedContext, storage: StoragePort) {
  const service = createWhatsAppChannelsService(context), journal = createWhatsAppChannelJournal(storage, expected)
  const refresh = async () => { const slice = await loadWhatsApp(context); publishWhatsApp(context, slice); return slice }
  async function recoverPending() {
    context.assertCurrent()
    const pending = journal.read().find(ref => !ref.terminal)
    if (pending) {
      await service.operation(pending.attempt); journal.finish(pending.attempt, 'succeeded', context.assertCurrent); await refresh()
      return fail('A alteração anterior foi confirmada. Confira as contas antes de salvar novamente.')
    }
  }
  async function mutate(attempt: WhatsAppChannelAttempt, patch?: WhatsAppChannelPatch) {
    await recoverPending()
    journal.reserve(attempt, context.assertCurrent)
    try {
      if (attempt.kind === 'update') await service.update(attempt, patch!)
      else if (attempt.kind === 'delete') await service.remove(attempt)
      else await service.setEnabled(attempt)
      journal.finish(attempt, 'succeeded', context.assertCurrent)
    } catch (error) { if (whatsappChannelRefusal(error, attempt)) journal.finish(attempt, 'whatsapp_channel_configuration_changed', context.assertCurrent); throw error }
    await refresh()
  }
  const selected = (account: WhatsAppAccount) => { context.assertCurrent(); if (account.orgId !== context.tenantId || !account.engineWhatsApp) fail('Atualize a conta antes de continuar.'); return account.engineWhatsApp.channel }
  return { refresh,
    async assign(account: WhatsAppAccount, agentId: string | null) {
      await recoverPending()
      let row = selected(account)
      if (row.enabled && !agentId) { await mutate(whatsappChannelAttempt('disable', row)); row = await service.get(row.id) }
      if (row.agentId !== agentId) { await mutate(whatsappChannelAttempt('update', row), { agentId }); row = await service.get(row.id) }
      if (agentId && !row.enabled) {
        if (!row.readiness.canEnable) fail('O assistente foi atribuído, mas a conta ainda não está pronta para responder.')
        await mutate(whatsappChannelAttempt('enable', row))
      }
    },
    async disconnect(account: WhatsAppAccount) { await recoverPending(); await mutate(whatsappChannelAttempt('delete', selected(account))) },
  }
}
export function whatsappCommands() {
  const context = captureEngineContext('channels:write'), expected = engineSession.getSnapshot().data?.identity.context
  if (!expected) fail('Atualize sua sessão antes de continuar.')
  return createWhatsAppActions(context, expected, window.sessionStorage)
}
type SignupConfig = { appId: string | null; configId: string | null; graphVersion: string; ready: boolean; featureType?: string | null }
declare global { interface Window { FB?: any; fbAsyncInit?: () => void } }
function loadFacebookSdk(appId: string, version: string): Promise<any> {
  if (window.FB) { window.FB.init({ appId, autoLogAppEvents: true, xfbml: false, version }); return Promise.resolve(window.FB) }
  return new Promise((resolve, reject) => {
    window.fbAsyncInit = () => { window.FB.init({ appId, autoLogAppEvents: true, xfbml: false, version }); resolve(window.FB) }
    const s = document.createElement('script'); s.src = 'https://connect.facebook.net/pt_BR/sdk.js'; s.async = true; s.defer = true; s.crossOrigin = 'anonymous'
    s.onerror = () => reject(new Error('Não foi possível carregar o login do Facebook. Desative bloqueadores e tente novamente.'))
    document.body.appendChild(s)
  })
}
/** WhatsApp Embedded Signup (official Meta flow): FB login with config_id -> code exchanged server-side -> WABA/phone subscribed and registered. */
export async function connectWhatsAppBusiness(): Promise<{ businessName: string; number: string }> {
  const context = captureEngineContext('channels:write')
  const cfg = await context.request<SignupConfig>('/whatsapp/embedded-signup/config')
  if (!cfg.ready || !cfg.appId || !cfg.configId) fail('A conexão com a Meta ainda não foi configurada no servidor (config_id do Embedded Signup).')
  const FB = await loadFacebookSdk(cfg.appId, cfg.graphVersion)
  const session: { wabaId?: string; phoneNumberId?: string; cancelled?: string } = {}
  const onMessage = (event: MessageEvent) => {
    if (!/^https:\/\/([a-z0-9-]+\.)*facebook\.com$/.test(event.origin)) return
    try {
      const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
      if (data?.type !== 'WA_EMBEDDED_SIGNUP') return
      if (data.event === 'FINISH' || data.event === 'FINISH_ONLY_WABA' || data.event === 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING') { session.wabaId = data.data?.waba_id; session.phoneNumberId = data.data?.phone_number_id }
      else if (data.event === 'CANCEL') session.cancelled = data.data?.current_step ?? 'cancelled'
    } catch { /* ignore non-JSON messages */ }
  }
  window.addEventListener('message', onMessage)
  try {
    const code: string | undefined = await new Promise(resolve => FB.login((r: any) => resolve(r?.authResponse?.code), {
      config_id: cfg.configId, response_type: 'code', override_default_response_type: true,
      extras: { setup: {}, sessionInfoVersion: '3', ...(cfg.featureType ? { featureType: cfg.featureType } : {}) },
    }))
    await new Promise(r => setTimeout(r, 600)) // let the session-info postMessage arrive
    if (!code) fail(session.cancelled ? 'Conexão cancelada antes de terminar.' : 'Conexão não concluída no Facebook.')
    const done = await context.request<{ verifiedName?: string | null; displayPhoneNumber?: string | null }>('/whatsapp/embedded-signup/complete', { method: 'POST', body: { code, ...(session.wabaId ? { wabaId: String(session.wabaId) } : {}), ...(session.phoneNumberId ? { phoneNumberId: String(session.phoneNumberId) } : {}) }, timeoutMs: 60000 })
    publishWhatsApp(context, await loadWhatsApp(context))
    return { businessName: done.verifiedName || 'WhatsApp Business', number: done.displayPhoneNumber || '' }
  } finally { window.removeEventListener('message', onMessage) }
}
export type EmbeddedStatus = { connected: boolean; needsAttention?: boolean; kind?: string; status?: string; displayPhoneNumber?: string | null; verifiedName?: string | null; lastError?: string | null; registered?: boolean; subscribed?: boolean }
export async function retryWhatsAppRegistration(pin?: string) {
  const context = captureEngineContext('channels:write')
  const r = await context.request<EmbeddedStatus>('/whatsapp/embedded-signup/retry', { method: 'POST', body: pin ? { pin } : {}, timeoutMs: 60000 })
  publishWhatsApp(context, await loadWhatsApp(context)); return r
}
export async function whatsappEmbeddedStatus(): Promise<EmbeddedStatus> {
  const context = captureEngineContext('channels:write')
  return context.request<EmbeddedStatus>('/whatsapp/embedded-signup/status')
}
