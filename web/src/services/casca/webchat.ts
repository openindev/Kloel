import type { Agent } from '@/domain/types'
import type { WebchatSetup } from '@/domain/ext/mais-a'
import '@/domain/ext/engine-webchat'
import { useStore } from '@/data/store'
import { EngineError, parseExpectedContext } from '../engine/http'
import { captureEngineContext, engineSession, type EngineContext } from '../engine/session'
import type { ExpectedContext } from '../engine/types'
import { createWebchatService, parseWebchatChannel, webchatFields, type WebchatAttempt, type WebchatChannel } from '../engine/webchat'

type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
const fail = (message: string): never => { throw new EngineError(0, 'webchat_unavailable', message) }
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const validAttempt = (a: any): a is WebchatAttempt => !!a && typeof a === 'object' && !Array.isArray(a) && /^[a-f0-9-]{36}$/.test(a.key) && ['create','update','enable','disable'].includes(a.kind) && Object.keys(a).every(k => ['key','kind','channelId','expectedVersion'].includes(k)) && (a.kind === 'create' ? a.channelId === undefined && a.expectedVersion === undefined : /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(a.channelId) && /^[a-f0-9]{64}$/.test(a.expectedVersion))

/** One unknown operation blocks new writes; only its opaque reference is retained. */
export function createWebchatJournal(storage: StoragePort, expected: ExpectedContext, agentId: string) {
  const identity = parseExpectedContext(expected), key = `kloel-webchat:${identity.userId}:${identity.tenantId}:${agentId}`
  if (!identity.tenantId || !identity.membershipId || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(agentId)) fail('Abra o assistente novamente.')
  const error = () => fail('Não foi possível preservar a referência. Nenhuma nova alteração foi iniciada.')
  const read = (): WebchatAttempt | null => {
    const text = storage.getItem(key); if (text === null) return null
    let raw: any; try { raw = JSON.parse(text) } catch { return error() }
    if (!raw || raw.schema !== 1 || Object.keys(raw).sort().join() !== 'attempt,context,schema' || !same(parseExpectedContext(raw.context), identity) || !validAttempt(raw.attempt)) return error()
    return { ...raw.attempt }
  }
  const clear = (attempt: WebchatAttempt, current: () => void) => {
    current(); if (!same(read(), attempt)) error(); storage.removeItem(key); current(); if (storage.getItem(key) !== null) error()
  }
  return { read, clear, reserve(attempt: WebchatAttempt, current: () => void) {
    current(); if (read() || !validAttempt(attempt)) error()
    const text = JSON.stringify({ schema: 1, context: identity, attempt }); storage.setItem(key, text); current(); if (storage.getItem(key) !== text) error(); current()
  } }
}

export function webchatSetup(channel: WebchatChannel | null): Partial<WebchatSetup> {
  return { allowedSites: channel ? [...channel.configuration.allowedOrigins] : [], widgetGreeting: channel?.configuration.greeting ?? '', hostedEnabled: false, engineAvailable: channel?.readiness.available === true, widgetId: channel?.id ?? '' }
}

export async function hydrateWebchat(context: EngineContext, agents: Agent[]): Promise<Agent[]> {
  if (!agents.some(a => a.type === 'chat')) return agents
  const channels: WebchatChannel[] = [], ids = new Set<string>(), cursors = new Set<string>()
  let cursor: string | undefined
  for (let page = 0; page < 1000; page++) {
    context.assertCurrent()
    const raw = await context.request<any>('/webchat/channels', { query: { limit: 100, cursor } }); context.assertCurrent()
    if (!raw || raw.limit !== 100 || !Array.isArray(raw.items) || raw.items.length > 100 || raw.nextCursor !== null && (typeof raw.nextCursor !== 'string' || !raw.nextCursor || raw.nextCursor.length > 4096)) fail('Não foi possível conferir os canais de chat.')
    for (const item of raw.items) {
      const row = parseWebchatChannel(item, context.tenantId, item?.agentId)
      if (ids.has(row.id)) fail('A lista de canais mudou. Atualize antes de continuar.')
      ids.add(row.id); channels.push(row)
    }
    if (raw.nextCursor === null) return agents.map(agent => agent.type !== 'chat' ? agent : { ...agent, engineWebchat: { generation: context.generation, channels: channels.filter(c => c.agentId === agent.id) } })
    if (cursors.has(raw.nextCursor)) fail('A lista de canais mudou. Atualize antes de continuar.')
    cursors.add(raw.nextCursor); cursor = raw.nextCursor
  }
  return fail('A lista de canais excedeu o limite de consulta.')
}

export function createWebchatActions(context: EngineContext, expected: ExpectedContext, storage: StoragePort, agentId: string, publish: (channel: WebchatChannel | null) => void = () => {}) {
  if (expected.tenantId !== context.tenantId) fail('A organização mudou. Abra o assistente novamente.')
  const api = createWebchatService(context, agentId), journal = createWebchatJournal(storage, expected, agentId)
  const present = (channel: WebchatChannel | null) => { context.assertCurrent(); publish(channel); return channel }
  async function load() {
    await recover()
    const rows: WebchatChannel[] = [], seen = new Set<string>(); let cursor: string | undefined
    for (let page = 0; page < 1000; page++) {
      const result = await api.list(cursor)
      for (const row of result.items) { if (seen.has(row.id)) fail('A lista de canais mudou.'); seen.add(row.id); rows.push(row) }
      if (rows.length > 1) fail('Este assistente possui mais de um canal de chat. Confira a configuração antes de alterá-lo.')
      if (result.nextCursor === null) return present(rows[0] ?? null)
      if (cursor === result.nextCursor) fail('A lista de canais mudou.'); cursor = result.nextCursor
    }
    return fail('A lista de canais excedeu o limite de consulta.')
  }
  async function recover() {
    context.assertCurrent(); const pending = journal.read(); if (!pending) return null
    const receipt = await api.operation(pending), channel = await api.read(receipt.channelId)
    context.assertCurrent(); journal.clear(pending, context.assertCurrent); present(channel)
    return { channel, recovered: true as const }
  }
  async function mutate(kind: WebchatAttempt['kind'], channel: WebchatChannel | null, fields?: ReturnType<typeof webchatFields>) {
    context.assertCurrent()
    const attempt: WebchatAttempt = { key: crypto.randomUUID(), kind, ...(kind === 'create' ? {} : { channelId: channel!.id, expectedVersion: channel!.version }) }
    journal.reserve(attempt, context.assertCurrent)
    let committed = false
    try {
      const result = await api.write(attempt, fields); committed = true
      const latest = await api.read(result.channel.id)
      context.assertCurrent(); journal.clear(attempt, context.assertCurrent); return present(latest)!
    } catch (error) {
      context.assertCurrent()
      if (!committed && error instanceof EngineError && ['webchat_changed','webchat_not_ready','invalid_input','invalid_origin','forbidden','unauthorized','tenant_mismatch','not_found'].includes(error.code)) journal.clear(attempt, context.assertCurrent)
      throw error
    }
  }
  function selected(channel: WebchatChannel | null) { context.assertCurrent(); if (channel && (channel.tenantId !== context.tenantId || channel.agentId !== agentId)) fail('Abra o assistente novamente.'); return channel }
  return { load,
    /** keepEnabled: o link hospedado publicado também usa o canal — sem sites, o widget só some (o canal não é desligado). */
    async saveWidget(channel: WebchatChannel | null, input: { name: string; allowedSites: string[]; greeting: string; keepEnabled?: boolean }) {
      const recovered = await recover(); if (recovered) return recovered
      let row = selected(channel)
      const fields = webchatFields({ name: input.name, configuration: { allowedOrigins: input.allowedSites, greeting: input.greeting } })
      if (!row && !fields.configuration.allowedOrigins.length) fail('Adicione pelo menos um site para ativar o widget.')
      if (!row) row = await mutate('create', null, fields)
      if (!fields.configuration.allowedOrigins.length && row.enabled && !input.keepEnabled) row = await mutate('disable', row)
      if (!same({ name: row.name, configuration: row.configuration }, fields)) row = await mutate('update', row, fields)
      if (fields.configuration.allowedOrigins.length && !row.enabled && row.readiness.canEnable) row = await mutate('enable', row)
      return { channel: row, recovered: false }
    },
    async removeWidget(channel: WebchatChannel | null, keepEnabled = false) {
      const recovered = await recover(); if (recovered) return recovered
      let row = selected(channel); if (!row) fail('O widget não está configurado.')
      if (row!.enabled && !keepEnabled) row = await mutate('disable', row!)
      if (row!.configuration.allowedOrigins.length) row = await mutate('update', row!, { name: row!.name, configuration: { ...row!.configuration, allowedOrigins: [] } })
      return { channel: row!, recovered: false }
    },
  }
}

export function webchatCommands(agentId: string) {
  const context = captureEngineContext('channels:read'), expected = engineSession.getSnapshot().data?.identity.context
  if (!expected) return fail('Abra sua sessão novamente.')
  return createWebchatActions(context, expected, window.sessionStorage, agentId, channel => {
    context.assertCurrent(); const agent = useStore.getState().db.agents.find(a => a.id === agentId && a.orgId === context.tenantId)
    if (!agent) fail('O assistente não está mais disponível.')
    useStore.getState().patch('agents', agentId, { engineWebchat: { generation: context.generation, channels: channel ? [channel] : [] } })
  })
}

export const unsupportedWebchat = (tab: 'hosted' | 'customize'): never => fail(tab === 'hosted' ? 'A publicação de links hospedados ainda não está disponível.' : 'A publicação da personalização ainda não está disponível.')
export const webchatAvailabilityMessage = (channel: WebchatChannel | null) => {
  if (!channel) return 'Adicione pelo menos um site para ativar o widget.'
  const reasons = channel.readiness.reasons
  if (reasons.includes('agent_inactive')) return 'O assistente precisa estar ativo antes de disponibilizar o widget.'
  if (reasons.includes('origins_missing') || reasons.includes('origins_invalid')) return 'Confira os sites permitidos antes de ativar o widget.'
  return 'A configuração foi salva, mas o widget ainda não está disponível. Confira o acesso e a configuração da conta.'
}
