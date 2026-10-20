import type { Agent, AgentType, KnowledgeEntry, KnowledgeSource } from '@/domain/types'
import { executableEmail } from './resource-capabilities'
import '@/domain/ext/agents'
import '@/domain/ext/agents-resources'
import { defaultBusinessHours, defaultRules, defaultTechnical } from '@/data/seed/defaults'
import { agentPayload, createAgentService, type EngineAgent, type AgentFields } from '../engine/agents'
import { createKnowledgeService, type KnowledgeEntry as EngineKnowledge } from '../engine/knowledge'
import { EngineError, parseExpectedContext } from '../engine/http'
import { captureEngineContext, engineSession, type EngineContext } from '../engine/session'
import type { ExpectedContext } from '../engine/types'
import { providerVoice, voiceProviderMap } from './voice-map'
import { useStore } from '@/data/store'
import { compileAgentRules } from './rules'
import { hydrateAgentResources } from './resource-hydration'
import { assertExecutableResourceChanges } from './resource-capabilities'
const isExecutableTransfer = (row: Agent['transfers'][number]) => (row.mode === 'phone' || row.mode === 'sip' || row.mode === 'member') && typeof row.destination === 'string' && (/^\+[1-9]\d{7,14}$/.test(row.destination.replace(/[\s()-]/g, '')) || /^sips?:\S{3,200}$/.test(row.destination))
import { assertExecutableAgentSettings, assertExecutableNewAgentSettings } from './agent-settings-capabilities'
import { prepareBeforeFields } from './before-save';
import { assertNewBeforeConfiguration } from './before-translation';

export { voiceProviderMap }
export type EditorOperation = { key: string; kind: 'agent.editor.create' | 'agent.editor.update'; agentId: string; tenantId: string; expectedRevision: number; revision: number; agentVersion: string; fingerprint: string; status: 'succeeded'; createdAt: string; automaticRetry: false }
export type EditorView = { agent: EngineAgent; agentVersion: string; revision: number; state: Record<string, unknown>; lastWrite: EditorOperation | null }
export type EditorMeta = { revision: number; agentVersion: string; generation: number; runtime: AgentFields }
declare module '@/domain/types' { interface Agent { cascaEditor?: EditorMeta; engineResourceReadiness?: { transfers: boolean; emails: boolean; whatsapps: boolean }; runtimeStatus?: 'draft' | 'active' | 'paused' } }
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const hash = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)
const uuid = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v)
const id = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(v)
const count = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k))
const date = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v))
function invalid(message = 'Não foi possível confirmar os dados do assistente. Atualize a página antes de continuar.'): never { throw new EngineError(0, 'invalid_agent_editor', message) }
export const editorKeys = ['name','type','channels','voiceId','language','greeting','greetingPersonalized','greetingMode','greetingRules','contactsEnabled','transfers','emails','whatsapps','scheduling','webSearch','integrations','webhooks','rules','knowledgeBaseEnabled','companyInfo','businessHours','prompt','technical','webchat','formality','chat','contactAccess','smsActions','webchatSetup','whatsappStarter','taskActions'] as const
const canonical = (v: any): string => JSON.stringify(v, (_key, value) => object(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value)
const forbidden = new Set(['secret','password','token','accesstoken','refreshtoken','apikey','authorization','cookie','credentials','privatekey','signingsecret','clientsecret','connected','connectedat','lasttest','verified','verificationstatus','mcpconnectedat','mcptools'])
/** Presentation state only: credentials and execution claims remain in their dedicated APIs. */
export function editorState(input: Record<string, unknown>): Record<string, unknown> {
  let nodes = 0
  const walk = (v: any, depth: number, rootKey: string): any => {
    if (++nodes > 10000 || depth > 12) invalid('A configuração do assistente excede o limite.')
    if (v === undefined) return undefined
    if (v === null || typeof v === 'boolean') return v
    if (typeof v === 'number') { if (!Number.isFinite(v)) invalid(); return v }
    if (typeof v === 'string') { if (v.length > 100000) invalid(); return v }
    if (Array.isArray(v)) { if (v.length > 2000) invalid(); return v.map(x => walk(x, depth + 1, rootKey)) }
    if (!object(v) || Object.keys(v).length > 128) invalid()
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(v)) {
      if (['__proto__','prototype','constructor'].includes(key)) invalid()
      const normalized = key.replace(/[-_]/g, '').toLowerCase()
      if (forbidden.has(normalized) || rootKey === 'webhooks' && ['url','headers','body','defaults'].includes(key) || rootKey === 'integrations' && key === 'config') continue
      const next = walk(value, depth + 1, rootKey); if (next !== undefined) out[key] = next
    }
    return out
  }
  const out: Record<string, unknown> = {}
  for (const key of editorKeys) if (Object.hasOwn(input, key) && input[key] !== undefined) out[key] = walk(input[key], 1, key)
  if (new TextEncoder().encode(JSON.stringify(out)).length > 512 * 1024) invalid()
  return out
}
export function parseEditorOperation(raw: unknown, tenantId: string, expected?: { key: string; kind: EditorOperation['kind']; agentId?: string; expectedRevision: number }): EditorOperation {
  if (!object(raw) || !exact(raw, ['key','kind','agentId','tenantId','expectedRevision','revision','agentVersion','fingerprint','status','createdAt','automaticRetry']) || !uuid(raw.key) || !['agent.editor.create','agent.editor.update'].includes(raw.kind) || !id(raw.agentId) || raw.tenantId !== tenantId || !count(raw.expectedRevision) || raw.revision !== raw.expectedRevision + 1 || !hash(raw.agentVersion) || !hash(raw.fingerprint) || raw.status !== 'succeeded' || !date(raw.createdAt) || raw.automaticRetry !== false) invalid()
  if (expected && (raw.key !== expected.key || raw.kind !== expected.kind || raw.expectedRevision !== expected.expectedRevision || expected.agentId && raw.agentId !== expected.agentId)) invalid()
  return structuredClone(raw) as EditorOperation
}
export function parseEditorView(raw: unknown, tenantId: string, agentId?: string): EditorView {
  if (!object(raw) || !exact(raw, ['agent','agentVersion','revision','state','lastWrite']) || !object(raw.agent) || raw.agent.tenantId !== tenantId || !id(raw.agent.id) || agentId && raw.agent.id !== agentId || !hash(raw.agentVersion) || !count(raw.revision) || !object(raw.state) || Object.keys(raw.state).some(k => !(editorKeys as readonly string[]).includes(k))) invalid()
  const a = raw.agent, keys = ['name','prompt','initialMessage','language','voice','status','settings','tools','rules']
  if (keys.some(k => !Object.hasOwn(a, k)) || !date(a.createdAt) || !date(a.updatedAt)) invalid()
  const fields = agentPayload(Object.fromEntries(keys.map(k => [k, a[k]]))) as AgentFields
  if (Object.keys(fields.settings).length !== 5) invalid()
  const state = editorState(raw.state)
  if (canonical(state) !== canonical(raw.state)) invalid('O servidor retornou dados privados fora do contrato do editor.')
  const lastWrite = raw.lastWrite === null ? null : parseEditorOperation(raw.lastWrite, tenantId)
  if (lastWrite && (lastWrite.agentId !== a.id || lastWrite.revision > raw.revision)) invalid()
  return { agent: { ...fields, id: a.id, tenantId, createdAt: a.createdAt, updatedAt: a.updatedAt }, agentVersion: raw.agentVersion, revision: raw.revision, state, lastWrite }
}
/** Pure projection: deterministic defaults for legacy records; runtime fields remain authoritative. */
export function projectAgent(a: EngineAgent, view?: Pick<EditorView, 'state' | 'revision' | 'agentVersion'>, generation = 0): Agent {
  const s = (view?.state ?? {}) as Partial<Agent>, technical = defaultTechnical()
  technical.preciseExtraction = []
  const type: AgentType = s.type === 'chat' ? 'chat' : 'voice'
  const voiceId = s.voiceId && Object.hasOwn(voiceProviderMap, s.voiceId) ? s.voiceId : a.voice === 'alloy' ? 'marcelo' : 'joana'
  const result: Agent = { id: a.id, orgId: a.tenantId, name: a.name, type, channels: type === 'voice' ? ['phone'] : ['whatsapp','webchat'], voiceId, language: a.language, greeting: a.initialMessage, greetingPersonalized: false, greetingMode: 'auto', greetingRules: [], contactsEnabled: a.tools.includes('lookup_contact'), transfers: [], emails: [], whatsapps: [], scheduling: [], webSearch: { enabled: false, instruction: '', allowedDomains: [] }, integrations: [], webhooks: [], rules: { ...defaultRules(), custom: a.rules.map((r, i) => ({ id: `runtime_${i}`, active: r.enabled, title: r.name, condition: '', instruction: r.instruction })) }, knowledgeBaseEnabled: a.tools.includes('search_knowledge'), companyInfo: '', businessHours: defaultBusinessHours(), prompt: a.prompt, technical, ...structuredClone(s), createdAt: a.createdAt, updatedAt: a.updatedAt }
  result.id = a.id; result.orgId = a.tenantId; result.name = a.name; result.prompt = a.prompt; result.greeting = a.initialMessage; result.language = a.language; result.voiceId = voiceId
  result.technical = { ...technical, ...s.technical, temperature: a.settings.temperature, recordAudio: a.settings.recordingEnabled }
  result.businessHours = { ...defaultBusinessHours(), ...s.businessHours, timezone: a.settings.timezone }
  result.contactsEnabled = a.tools.includes('lookup_contact'); result.knowledgeBaseEnabled = a.tools.includes('search_knowledge')
  result.webSearch = { ...result.webSearch, enabled: a.tools.includes('search_web') }
  if (result.taskActions) result.taskActions = { ...result.taskActions, enabled: false }
  // No editorial array can assert that a provider connection was verified.
  result.integrations = (s.integrations ?? []).map(x => ({ ...x, connected: false, config: {} }))
  // Telefone/SIP: executadas pelo worker de voz (phone-runtime.ts usa o mesmo filtro) → o card aparece ativo.
  result.engineResourceReadiness = { transfers: result.transfers.some(isExecutableTransfer), emails: result.emails.some(executableEmail), whatsapps: false }
  result.runtimeStatus = a.status
  if (view) result.cascaEditor = { revision: view.revision, agentVersion: view.agentVersion, generation, runtime: structuredClone(a) }
  return result
}
function runtimePatch(base: Agent, next: Agent): Partial<AgentFields> {
  const patch: Partial<AgentFields> = {}
  for (const [shell, runtime] of [['name','name'],['prompt','prompt'],['greeting','initialMessage'],['language','language']] as const) if (next[shell] !== base[shell]) (patch as any)[runtime] = next[shell]
  if (next.voiceId !== base.voiceId) patch.voice = providerVoice(next.voiceId)
  if (next.runtimeStatus && next.runtimeStatus !== base.runtimeStatus) patch.status = next.runtimeStatus
  const settings: Partial<AgentFields['settings']> = {}
  if (next.technical.temperature !== base.technical.temperature) settings.temperature = next.technical.temperature
  if (next.technical.recordAudio !== base.technical.recordAudio) settings.recordingEnabled = next.technical.recordAudio
  if (next.businessHours.timezone !== base.businessHours.timezone) settings.timezone = next.businessHours.timezone
  if (Object.keys(settings).length) patch.settings = settings as AgentFields['settings']
  if (next.knowledgeBaseEnabled !== base.knowledgeBaseEnabled || next.contactsEnabled !== base.contactsEnabled || next.webSearch.enabled !== base.webSearch.enabled) {
    const tools = new Set(base.cascaEditor?.runtime.tools ?? [])
    for (const [enabled, tool] of [[next.knowledgeBaseEnabled,'search_knowledge'],[next.contactsEnabled,'lookup_contact'],[next.webSearch.enabled,'search_web']] as const) enabled ? tools.add(tool) : tools.delete(tool)
    patch.tools = [...tools]
  }
  if (JSON.stringify(next.rules) !== JSON.stringify(base.rules) || next.formality !== base.formality || JSON.stringify(next.webSearch) !== JSON.stringify(base.webSearch)) patch.rules = compileAgentRules(next)
  return patch
}
export type AgentAttempt = { key: string; kind: EditorOperation['kind']; expectedRevision: number; agentId?: string }
type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export function createAgentJournal(storage: StoragePort, input: ExpectedContext, slot: string) {
  const scope = parseExpectedContext(input), key = `kloel-casca-agent:${scope.userId}:${scope.tenantId}:${slot}`
  function read(): AgentAttempt | null { const text = storage.getItem(key); if (text === null) return null; let v: any; try { v = JSON.parse(text) } catch { invalid('O acompanhamento do salvamento está indisponível nesta aba.') }
    if (!object(v) || !exact(v, ['context','attempt']) || JSON.stringify(v.context) !== JSON.stringify(scope) || !object(v.attempt)) invalid('A referência de salvamento pertence a outro acesso. Consulte a sessão original.')
    const a = v.attempt; if (!exact(a, a.agentId ? ['key','kind','expectedRevision','agentId'] : ['key','kind','expectedRevision']) || !uuid(a.key) || !['agent.editor.create','agent.editor.update'].includes(a.kind) || !count(a.expectedRevision) || a.agentId !== undefined && !id(a.agentId)) invalid()
    return a as AgentAttempt
  }
  return { read, reserve(a: AgentAttempt, current: () => void) { current(); if (read()) invalid('Há um salvamento sem confirmação. Consulte a referência original.'); const text = JSON.stringify({ context: scope, attempt: a }); storage.setItem(key, text); current(); if (storage.getItem(key) !== text) invalid('Não foi possível preservar a referência do salvamento.') }, resolve(a: AgentAttempt, current: () => void) { current(); if (JSON.stringify(read()) !== JSON.stringify(a)) invalid(); storage.removeItem(key); current(); if (storage.getItem(key) !== null) invalid() } }
}
export function createAgentCommands(context: EngineContext, journal?: ReturnType<typeof createAgentJournal>) {
  async function read(agentId: string): Promise<Agent> { if (!id(agentId)) invalid(); context.assertCurrent(); const raw = await context.request(`/agents/${agentId}/editor-state`); context.assertCurrent(); const v = parseEditorView(raw, context.tenantId, agentId); return projectAgent(v.agent, v, context.generation) }
  /** Re-read the fence when this tab's copy was projected in another session generation or never received one. The caller's fields stay; only revision, version and runtime tools come from the server. */
  async function editorFence(base: Agent): Promise<Agent> {
    if (base.cascaEditor?.generation === context.generation) return base
    const fresh = await read(base.id)
    if (fresh.orgId !== context.tenantId || !fresh.cascaEditor || fresh.cascaEditor.generation !== context.generation) invalid('Não foi possível confirmar o assistente. Atualize a página antes de salvar.')
    return { ...base, cascaEditor: fresh.cascaEditor, runtimeStatus: fresh.runtimeStatus }
  }
  async function recover(attempt: AgentAttempt): Promise<Agent> { context.assertCurrent(); const op = parseEditorOperation(await context.request(`/agents/editor-state/operations/${attempt.key}`), context.tenantId, attempt); context.assertCurrent(); try { const a = await read(op.agentId); journal?.resolve(attempt, context.assertCurrent); return a } catch (error) { context.assertCurrent(); if (error instanceof EngineError && error.status === 404) { journal?.resolve(attempt, context.assertCurrent); throw new EngineError(404, 'agent_deleted_after_write', `O salvamento foi confirmado pela referência ${attempt.key}, mas o assistente foi excluído depois.`) } throw error } }
  async function write(attempt: AgentAttempt, path: string, body: unknown, method: 'PUT' | 'POST'): Promise<Agent> {
    context.assertCurrent(); const active = journal?.read(); if (active) return recover(active)
    journal?.reserve(attempt, context.assertCurrent)
    try { const raw: any = await context.request(path, { method, body }); context.assertCurrent(); if (!object(raw) || !exact(raw, ['agent','agentVersion','revision','state','lastWrite','operation','replayed']) || typeof raw.replayed !== 'boolean') invalid(); parseEditorOperation(raw.operation, context.tenantId, attempt); const { operation, replayed, ...view } = raw; const v = parseEditorView(view, context.tenantId, raw.operation.agentId); journal?.resolve(attempt, context.assertCurrent); return projectAgent(v.agent, v, context.generation) }
    catch (error) { context.assertCurrent(); const rejected = error instanceof EngineError && ['agent_editor_revision_conflict','agent_editor_agent_changed','agent_editor_revision_invalid','agent_editor_idempotency_conflict','validation_error','invalid_editor_state','invalid_patch','forbidden','unauthorized','human_session_required','plan_required'].includes(error.code); if (rejected) { journal?.resolve(attempt, context.assertCurrent); throw error } try { return await recover(attempt) } catch (recoveryError) { context.assertCurrent(); if (recoveryError instanceof EngineError && recoveryError.code === 'agent_deleted_after_write') throw recoveryError; throw new EngineError(0, 'agent_write_unconfirmed', `O salvamento não foi confirmado. Referência ${attempt.key}. Salvar novamente consultará esta mesma referência.`) } }
  }
  return { read, recover,
    async create(input: Agent) { assertNewBeforeConfiguration(input); assertExecutableNewAgentSettings(input); assertExecutableResourceChanges({ transfers: [], emails: [], whatsapps: [] }, input); if (input.orgId !== context.tenantId) invalid(); const attempt: AgentAttempt = { key: crypto.randomUUID(), kind: 'agent.editor.create', expectedRevision: 0 }, fields: AgentFields = { name: input.name, prompt: input.prompt, initialMessage: input.greeting, language: input.language, voice: providerVoice(input.voiceId), status: 'draft', settings: { temperature: input.technical.temperature, maxResponseTokens: 1024, timezone: input.businessHours.timezone, recordingEnabled: input.technical.recordAudio, humanHandoffEnabled: true }, tools: [...(input.knowledgeBaseEnabled ? ['search_knowledge' as const] : []), ...(input.contactsEnabled ? ['lookup_contact' as const] : []), ...(input.webSearch.enabled ? ['search_web' as const] : [])], rules: compileAgentRules(input) }; agentPayload(fields); return write(attempt, '/agents/editor-state', { expectedTenantId: context.tenantId, idempotencyKey: attempt.key, agent: fields, state: editorState(input as unknown as Record<string, unknown>) }, 'POST') },
    async update(base: Agent, patch: Partial<Agent>) {
      assertExecutableResourceChanges(base, patch); assertExecutableAgentSettings(base, patch)
      // The editor fence (cascaEditor) is not stored. It is stamped only when this tab projects GET /editor-state.
      // A dirty draft keeps the first object, so a missing or older generation used to throw before any request.
      if (base.orgId !== context.tenantId) invalid('A organização da sessão mudou. Abra o assistente de novo antes de salvar.')
      const current = await editorFence(base)
      const meta = current.cascaEditor!
      const next = { ...current, ...patch }, runtime = runtimePatch(current, next); delete (next as Partial<Agent>).runtimeStatus
      if (Object.keys(runtime).length) agentPayload(runtime)
      const attempt: AgentAttempt = { key: crypto.randomUUID(), kind: 'agent.editor.update', agentId: base.id, expectedRevision: meta.revision }
      return write(attempt, `/agents/${base.id}/editor-state`, { expectedTenantId: context.tenantId, expectedRevision: meta.revision, expectedAgentVersion: meta.agentVersion, idempotencyKey: attempt.key, agent: runtime, state: editorState(next as unknown as Record<string, unknown>) }, 'PUT')
    },
    async remove(agentId: string) { if (!id(agentId)) invalid(); context.assertCurrent(); try { await context.request(`/agents/${agentId}`, { method: 'DELETE' }); context.assertCurrent() } catch (error) { context.assertCurrent(); try { await read(agentId) } catch (readError) { context.assertCurrent(); if (readError instanceof EngineError && readError.status === 404) return } throw error } },
  }
}
/** All editor callers retain a previously active HTTP-before source with its exact existing audiences. */
export function createManagedAgentCommands(context: EngineContext, journal: ReturnType<typeof createAgentJournal>, prepare: typeof prepareBeforeFields) {
  const commands = createAgentCommands(context, journal)
  return { ...commands, async update(base: Agent, patch: Partial<Agent>) {
    assertExecutableResourceChanges(base, patch)
    assertExecutableAgentSettings(base, patch)
    if (base.orgId !== context.tenantId) invalid('A organização da sessão mudou. Abra o assistente de novo antes de salvar.')
    // Greeting / inbound webhook checks use the same generation stamp. Refresh it before they can refuse the save.
    const current = !base.cascaEditor || base.cascaEditor.generation !== context.generation ? await commands.read(base.id).then(fresh => {
      if (fresh.orgId !== context.tenantId || !fresh.cascaEditor || fresh.cascaEditor.generation !== context.generation) invalid('Não foi possível confirmar o assistente. Atualize a página antes de salvar.')
      return { ...base, cascaEditor: fresh.cascaEditor, runtimeStatus: fresh.runtimeStatus, engineBefore: base.engineBefore ?? fresh.engineBefore }
    }) : base
    const saveBefore = await prepare(current, { ...current, ...patch })
    if (saveBefore) {
      const pending = journal.read()
      if (pending) { await commands.recover(pending); throw Error('O salvamento anterior foi confirmado. Atualize o assistente antes de aplicar novas alterações.') }
    }
    const saved = await commands.update(current, patch)
    if (saveBefore) {
      try { await saveBefore() }
      catch (error) { context.assertCurrent(); throw Error(`O assistente foi salvo, mas não foi possível confirmar toda a configuração inicial. Atualize para conferir. ${error instanceof Error ? error.message : ''}`) }
    }
    return saved
  } }
}
export function agentCommands(slot: string) { const context = captureEngineContext('agents:write'), identity = engineSession.getSnapshot().data!.identity.context; context.assertCurrent(); return createManagedAgentCommands(context, createAgentJournal(window.sessionStorage, identity, slot), prepareBeforeFields) }
const savingAgents = new Set<string>()
/** Cache publication happens only after the original CAS write has been confirmed. */
export async function saveAgentFields(base: Agent, patch: Partial<Agent>): Promise<Agent> {
  if (savingAgents.has(base.id)) throw new EngineError(0, 'agent_save_pending', 'Aguarde o salvamento atual.')
  assertExecutableResourceChanges(base, patch)
  assertExecutableAgentSettings(base, patch)
  savingAgents.add(base.id)
  try {
    const saved = await agentCommands(base.id).update(base, patch)
    const context = captureEngineContext('agents:write')
    if (context.tenantId !== saved.orgId || context.generation !== saved.cascaEditor?.generation) throw new EngineError(0, 'superseded', 'A sessão mudou durante o salvamento.')
    const [result] = await hydrateAgentResources(context, [saved], engineSession.getSnapshot().data!.identity.context.userId)
    context.assertCurrent(); useStore.getState().patch('agents', result.id, result)
    return result
  } catch (error) {
    try {
      const context = captureEngineContext('agents:write')
      const [current] = await hydrateAgentResources(context, [await agentCommands(base.id).read(base.id)], engineSession.getSnapshot().data!.identity.context.userId)
      context.assertCurrent(); useStore.getState().patch('agents', current.id, current)
    } catch { /* Publish only confirmed state; never roll back a separate successful write. */ }
    throw error
  } finally { savingAgents.delete(base.id) }
}
export async function loadAgents(context: EngineContext): Promise<Agent[]> { const userId = engineSession.getSnapshot().data?.identity.context.userId; context.assertCurrent(); if (!userId) invalid('Abra sua sessão novamente.'); const list = await createAgentService(context).list(), commands = createAgentCommands(context), out = await Promise.all(list.map(agent => commands.read(agent.id))); context.assertCurrent(); return hydrateAgentResources(context, out, userId) }

export function projectKnowledge(k: EngineKnowledge): { entry: KnowledgeEntry; source?: KnowledgeSource } {
  const source = k.type === 'url' ? 'website' : k.type === 'document' ? 'document' : 'manual'
  return { entry: { id: k.id, orgId: k.tenantId, agentId: k.agentId, question: k.title, answer: k.content, source, sourceLabel: k.title, ...(source === 'manual' ? {} : { sourceId: k.id }), usageCount: 0, createdAt: k.createdAt }, ...(source === 'manual' ? {} : { source: { id: k.id, orgId: k.tenantId, agentId: k.agentId, type: source, label: k.title, ...(k.url ? { url: k.url.replace(/^https?:\/\//, ''), pages: 1 } : {}), ...(k.document ? { fileName: k.document.filename, sizeBytes: k.document.sizeBytes } : {}), status: k.indexed ? 'ready' : k.ingestionStatus === 'failed' ? 'error' : 'processing', enabled: k.indexed, updatedAt: k.updatedAt } as KnowledgeSource }) }
}
export async function loadKnowledge(context: EngineContext, agentIds: string[]) { const knowledgeEntries: KnowledgeEntry[] = [], knowledgeSources: KnowledgeSource[] = []; const perAgent = await Promise.all(agentIds.map(async agentId => { const api = createKnowledgeService(context, agentId), items: EngineKnowledge[] = []; for (let page = 1; page <= 10000; page++) { const result = await api.list(page); items.push(...result.items); if (page >= result.totalPages) break; if (page === 10000) invalid('A base de conhecimento excede o limite desta consulta.') } return items })); for (const k of perAgent.flat()) { const p = projectKnowledge(k); knowledgeEntries.push(p.entry); if (p.source) knowledgeSources.push(p.source) } context.assertCurrent(); return { knowledgeEntries, knowledgeSources } }

/** Copies stored extracted text through existing knowledge APIs; never fabricates FAQ or source binaries. */
export async function copyAgentKnowledge(sourceId: string, targetId: string) {
  const context = captureEngineContext('knowledge:write'), source = createKnowledgeService(context, sourceId), target = createKnowledgeService(context, targetId)
  let incomplete: string | null = null
  try {
    for (let page = 1; page <= 10000; page++) {
      const batch = await source.list(page)
      for (const entry of batch.items) {
        if (!entry.content.trim()) continue
        const copied = await target.createText({ title: entry.title, content: entry.content, tags: entry.tags })
        if (entry.indexed) await target.ingest(copied.id)
      }
      if (page >= batch.totalPages) break
      if (page === 10000) invalid('A cópia atingiu o limite de consulta.')
    }
  } catch (error) { context.assertCurrent(); incomplete = error instanceof Error ? error.message : 'A cópia não foi concluída. Nenhuma operação será repetida automaticamente.' }
  return { ...await loadKnowledge(context, [targetId]), incomplete }
}

/** "Ativar assistente" / "Desativar": muda só o status do motor (402 plan_required quando a org não pode ativar; concessões de teste valem). */
export function setAgentActive(base: Agent, active: boolean) { return saveAgentFields(base, { runtimeStatus: active ? 'active' : 'paused' }) }
