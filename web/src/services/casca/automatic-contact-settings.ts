import type { EngineContext } from '../engine/session'
import type { ExpectedContext } from '../engine/types'
import { EngineError, parseExpectedContext } from '../engine/http'
import { createCRMClient, type CRMSettings, type FieldInput } from '../engine/crm'
import { createCRMCaptureService, newCapturePolicy, validCaptureAttempt, type CaptureAttempt, type CapturePolicy, type CaptureState } from '../engine/crm-capture'
import { createPhonesService } from '../engine/phones'

export type ContactSettingsInput = { autoCapture: boolean; creationGate: string; definitions: FieldInput[] }
type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
type Pending = { stage: 'settings'; expectedRevision: number; hash: string } | { stage: 'grant'; attempt: CaptureAttempt }
const running = new Set<string>()
const canonical = (value: unknown) => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)
const hash = async (value: unknown) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value))))].map(byte => byte.toString(16).padStart(2, '0')).join('')
/** Stable definition keys let a confirmed read match newly assigned field/option IDs. */
export function settingsMeaning(value: ContactSettingsInput | CRMSettings) {
  return { autoCapture: value.autoCapture, creationGate: value.creationGate.trim(), definitions: value.definitions.map(field => ({ key: field.key, label: field.label, type: field.type, description: field.description, status: field.status, aiFill: field.aiFill, example: field.example, showInList: field.showInList, findHint: field.findHint ?? '', keepUpdated: field.keepUpdated === true, updateWhen: field.updateWhen ?? '', options: field.options.map(option => ({ label: option.label, status: option.status })) })) }
}
const automatic = (value: ContactSettingsInput | CRMSettings) => value.autoCapture || value.definitions.some(field => field.status === 'active' && field.aiFill)
const rejected = (error: unknown) => error instanceof EngineError && [400, 401, 403, 404, 409, 413, 422].includes(error.status)
const failure = (message: string): never => { throw Error(message) }

/** Why a saved grant stopped (engine reason codes) — shown so the person knows what to do. */
const grantReasons: Record<string, string> = {
  configuration_changed: 'um assistente, canal ou configuração de contatos mudou depois da ativação',
  configuration_removed: 'um assistente ou canal usado pela captura foi removido',
  capture_configuration_changed: 'um assistente, canal ou configuração de contatos mudou depois da ativação',
  capture_channel_changed: 'os canais conectados mudaram depois da ativação', capture_channel_unavailable: 'um canal usado pela captura foi desativado',
  capture_settings_disabled: 'os campos ou a captura foram desativados', capture_membership_changed: 'a pessoa que ativou a captura não tem mais acesso',
  membership_removed: 'a pessoa que ativou a captura saiu da organização', membership_role_changed: 'a pessoa que ativou a captura perdeu a permissão de administrador',
  organization_suspended: 'a organização está suspensa', capture_grant_inactive: 'a autorização expirou', capture_provider_unavailable: 'o serviço de IA não está disponível para esta organização',
  explicit_replacement: 'uma nova autorização a substituiu', operator: 'ela foi pausada', grant_inactive_or_changed: 'a configuração mudou depois da ativação',
}
/** Saved preferences remain visible; they do not assert that a grant is currently effective. */
export function automaticContactSettingsError(settings: CRMSettings, policy?: CaptureState): string | undefined {
  if (!automatic(settings)) return
  if (!policy || policy.settingsRevision !== settings.revision) return 'As preferências estão salvas, mas não foi possível confirmar a automação. Atualize para consultar seu estado.'
  const grant = policy.grant, fields = settings.definitions.filter(field => field.status === 'active' && field.aiFill).map(field => field.id)
  if (!policy.schedulerRunning) return 'As preferências estão salvas, mas o processamento automático está parado no servidor neste momento. Nada é capturado até ele voltar; tente “Reativar” mais tarde.'
  if (!grant) return 'As preferências estão salvas, mas a captura automática ainda não foi autorizada. Use “Reativar” — é preciso ter um canal ativo (telefone, chat do site ou WhatsApp oficial) conectado a um assistente.'
  if (!grant.effective || !grant.automaticApplication || grant.policy.mode !== 'auto_create_fill_empty' || settings.autoCapture && !grant.captureEffective || fields.some(id => !grant.policy.allowedFieldIds.includes(id)) || fields.length && !grant.aiFillEffective) {
    const reason = grant.reason ? grantReasons[grant.reason] ?? (grant.status === 'expired' ? 'a autorização expirou' : undefined) : grant.status === 'expired' ? 'a autorização expirou' : undefined
    return `A captura e o preenchimento automáticos estão pausados${reason ? ` porque ${reason}` : ''}. Use “Reativar” para autorizar a configuração atual.`
  }
}

export function createAutomaticContactSettings(context: EngineContext, identity: ExpectedContext, storage: StoragePort) {
  const expected = parseExpectedContext(identity)
  if (expected.tenantId !== context.tenantId || !expected.membershipId) failure('Atualize sua sessão antes de salvar.')
  const key = `kloel:casca:automatic-contacts:${expected.userId}:${context.tenantId}:${expected.membershipId}:${expected.authorityVersion}`
  const crm = createCRMClient(context), capture = createCRMCaptureService(context), catalog = createPhonesService(context)
  function read(): Pending | undefined {
    context.assertCurrent(); const text = storage.getItem(key); if (!text) return
    let raw: any; try { raw = JSON.parse(text) } catch { failure('A referência anterior não pôde ser consultada. Nenhuma operação foi repetida.') }
    if (!raw || Object.keys(raw).some(name => !['context', 'pending'].includes(name)) || canonical(parseExpectedContext(raw.context)) !== canonical(expected)) failure('A referência pertence a outra sessão.')
    const p = raw.pending
    if (p?.stage === 'settings' && Object.keys(p).length === 3 && Number.isSafeInteger(p.expectedRevision) && p.expectedRevision >= 0 && /^[a-f0-9]{64}$/.test(p.hash)) return p
    if (p?.stage === 'grant' && Object.keys(p).length === 2 && validCaptureAttempt(p.attempt) && ['grant.create', 'grant.revoke'].includes(p.attempt.kind)) return p
    return failure('A referência anterior não pôde ser consultada. Nenhuma operação foi repetida.')
  }
  function write(pending?: Pending) {
    context.assertCurrent(); const text = pending ? JSON.stringify({ context: expected, pending }) : null
    if (text === null) storage.removeItem(key); else storage.setItem(key, text)
    context.assertCurrent(); if (storage.getItem(key) !== text) failure('Não foi possível preservar a referência da operação.')
  }
  async function state() {
    const settings = await crm.settings(), policy = await capture.policy(); context.assertCurrent()
    if (policy.settingsRevision !== settings.revision) failure('As configurações mudaram durante a consulta. Atualize antes de continuar.')
    return { settings, policy }
  }
  async function eligibleChannels() {
    const [channels, agents] = await Promise.all([catalog.listChannels(), catalog.listAgents()]); context.assertCurrent()
    const ids = channels.filter(channel => channel.enabled && channel.agentId && agents.some(agent => agent.id === channel.agentId && agent.status !== 'paused') && (channel.type === 'phone' || channel.type === 'webchat' || channel.type === 'whatsapp' && channel.provider === 'meta')).map(channel => channel.id).sort()
    // Sem canal elegível as preferências são salvas mesmo assim; a autorização é criada ao reativar com um canal conectado.
    if (ids.length > 20) failure('A captura automática permite até 20 canais nesta configuração. Nenhuma seleção parcial foi feita.')
    return ids
  }
  function assertEffective(settings: CRMSettings, policy: CaptureState, wanted?: CapturePolicy) {
    if (!automatic(settings)) {
      if (policy.grant?.effective) failure('As preferências foram salvas, mas a autorização anterior ainda está ativa. Consulte novamente.')
      return
    }
    const error = automaticContactSettingsError(settings, policy)
    if (error) failure(error)
    if (wanted && canonical(policy.grant?.policy) !== canonical(wanted)) {
      failure('As preferências foram salvas, mas a captura ou o preenchimento automáticos não estão ativos nesta configuração. Consulte novamente antes de continuar.')
    }
  }
  async function grant(attempt: CaptureAttempt, policy?: CapturePolicy) {
    write({ stage: 'grant', attempt })
    try { await capture.write(attempt, policy) }
    catch (error) { context.assertCurrent(); if (rejected(error)) write(); throw error }
    const receipt = await capture.operation(attempt); context.assertCurrent()
    const current = await state(); context.assertCurrent()
    if (current.policy.grant?.id !== receipt.targetId || current.policy.grant.revision !== receipt.result.revision) { write(); failure('A autorização foi confirmada, mas mudou depois. Atualize para conferir a configuração atual.') }
    write(); assertEffective(current.settings, current.policy, policy)
    return current
  }
  async function recover(pending: Pending) {
    if (pending.stage === 'settings') {
      const current = await state()
      if (current.settings.revision !== pending.expectedRevision + 1 || await hash(settingsMeaning(current.settings)) !== pending.hash) failure('O salvamento anterior ainda não pôde ser confirmado. Nenhuma escrita foi repetida.')
      write()
      return { ...current, recovered: true as const, complete: !automatic(current.settings) && !current.policy.grant?.effective }
    }
    const receipt = await capture.operation(pending.attempt), current = await state(); context.assertCurrent()
    write()
    if (current.policy.grant?.id !== receipt.targetId || current.policy.grant.revision !== receipt.result.revision) failure('A autorização anterior foi confirmada, mas mudou depois. Atualize antes de salvar novamente.')
    assertEffective(current.settings, current.policy)
    return { ...current, recovered: true as const, complete: true }
  }
  return {
    pending: () => !!read(),
    async confirm(previous: { settings: CRMSettings; policy: CaptureState }) {
      const current = await state()
      if (current.settings.revision !== previous.settings.revision || current.policy.grant?.id !== previous.policy.grant?.id || current.policy.grant?.revision !== previous.policy.grant?.revision) failure('A configuração mudou após o salvamento. Confira as preferências atuais antes de continuar.')
      assertEffective(current.settings, current.policy)
      return current
    },
    async save(previous: CRMSettings, build: () => ContactSettingsInput) {
      context.assertCurrent(); if (running.has(key)) failure('Aguarde o salvamento atual.'); running.add(key)
      try {
        const pending = read(); if (pending) return await recover(pending)
        const input = build(), wantsAutomatic = automatic(input)
        const channels = wantsAutomatic ? await eligibleChannels() : []
        if (wantsAutomatic && !(await capture.policy()).schedulerRunning) failure('O processamento automático de contatos está parado no servidor neste momento, então a captura não pode ser ativada agora. Nenhuma configuração foi alterada; tente novamente em alguns minutos.')
        const requestedHash = await hash(settingsMeaning(input)); context.assertCurrent()
        if (requestedHash !== await hash(settingsMeaning(previous))) {
          const attempt: Pending = { stage: 'settings', expectedRevision: previous.revision, hash: requestedHash }; write(attempt)
          try { await crm.saveSettings(previous, input) }
          catch (error) { context.assertCurrent(); if (rejected(error)) write(); throw error }
          const confirmed = await crm.settings(); context.assertCurrent()
          if (confirmed.revision !== previous.revision + 1 || await hash(settingsMeaning(confirmed)) !== requestedHash) failure('As preferências mudaram durante o salvamento. Consulte a referência anterior.')
          write()
        }
        const current = await state()
        if (await hash(settingsMeaning(current.settings)) !== requestedHash) failure('As preferências mudaram. Atualize antes de autorizar a captura.')
        const old = current.policy.grant
        if (!wantsAutomatic) {
          if (old && old.status !== 'revoked') return { ...await grant({ key: crypto.randomUUID(), kind: 'grant.revoke', targetId: old.id, revision: old.revision }), recovered: false as const, complete: true }
          assertEffective(current.settings, current.policy); return { ...current, recovered: false as const, complete: true }
        }
        // Nenhum canal elegível: uma autorização anterior também não pode estar efetiva (o motor confere os mesmos canais).
        if (!channels.length) return { ...current, recovered: false as const, complete: true, waitingForChannel: true as const }
        // Validade e cota máximas aceitas pelo motor (90 dias, 100 análises/dia): a captura não para após 20 mensagens.
        const policy: CapturePolicy = { ...newCapturePolicy(), expiresInDays: 90, jobsPerDay: 100, reservedTokensPerDay: 1000000, mode: 'auto_create_fill_empty', captureContacts: current.settings.autoCapture, channelIds: channels, allowedFieldIds: current.settings.definitions.filter(field => field.status === 'active' && field.aiFill).map(field => field.id).sort(), allowTransportMatch: false }
        if (old?.effective && old.automaticApplication && canonical(old.policy) === canonical(policy)) { assertEffective(current.settings, current.policy, policy); return { ...current, recovered: false as const, complete: true } }
        const attempt: CaptureAttempt = { key: crypto.randomUUID(), kind: 'grant.create', settingsRevision: current.settings.revision, previousGrantId: old?.id ?? null, previousRevision: old?.revision ?? null }
        return { ...await grant(attempt, policy), recovered: false as const, complete: true }
      } finally { running.delete(key) }
    },
  }
}
