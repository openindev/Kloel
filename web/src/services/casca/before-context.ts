import type { Agent, WebhookConfig, GreetingRule } from '@/domain/types'
import type { EngineContext } from '../engine/session'
import type { ExpectedContext } from '../engine/types'
import { EngineError } from '../engine/http'
import { createBeforeContextService, type BeforeConfigAttempt, type BeforeConfig, type BeforeConfiguration } from '../engine/before-context'
import { createBeforeConfigJournal } from '../engine/before-context-journal'
import { createBeforeHttpService, parseHttpConfiguration, type HttpAttempt, type HttpSource } from '../engine/before-http'
import { createBeforeHttpJournal } from '../engine/before-http-journal'
import { shellGreeting, shellGreetingCondition, translateInbound, type BeforePlan } from './before-translation'

type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const versionConflict = (error: unknown) => error instanceof EngineError && ['before_context_revision_conflict', 'before_context_changed', 'before_http_revision_conflict', 'before_http_before_revision_conflict'].includes(error.code)
export type BeforeSnapshot = NonNullable<Agent['engineBefore']>
export function projectBeforeFields(agent: Agent, snapshot: BeforeSnapshot): Agent {
  const c = snapshot.context.configuration, h = snapshot.http
  const next = { ...agent, engineBefore: snapshot, webhooks: agent.webhooks.filter(row => !['inbound', 'test_context'].includes(row.kind)) }
  if (snapshot.context.revision > 0) {
    next.greeting = shellGreeting(c.defaultGreeting)
    next.greetingPersonalized = c.enabled && c.greetingRules.length > 0
    next.greetingMode = 'advanced'
    next.greetingRules = c.greetingRules.map((row, index): GreetingRule => ({ id: agent.greetingRules[index]?.id ?? `before-rule-${index}`, message: shellGreeting(row.greeting), conditions: row.conditions.map(condition => shellGreetingCondition(condition) ?? { field: condition.field, operator: condition.operator, value: condition.value === undefined ? '' : JSON.stringify(condition.value) }) }))
  }
  const oldInbound = agent.webhooks.find(row => row.kind === 'inbound')
  if (h?.sourceId || c.variables.length || oldInbound) {
    const row: WebhookConfig = { id: oldInbound?.id ?? `before-inbound-${agent.id}`, kind: 'inbound', name: 'Webhook de entrada', enabled: h?.state === 'enabled', method: h?.configuration?.method ?? 'POST', defaults: JSON.stringify(Object.fromEntries(c.variables.map(v => [v.name, v.defaultValue])), null, 2), ...(h?.sourceId ? { engineBeforeHttp: { sourceId: h.sourceId, revision: h.revision, beforeRevision: h.beforeRevision } } : {}) }
    next.webhooks.push(row)
  }
  const oldTest = agent.webhooks.find(row => row.kind === 'test_context')
  if (Object.keys(c.testContext).length || oldTest) next.webhooks.push({ id: oldTest?.id ?? `before-test-${agent.id}`, kind: 'test_context', name: 'Contexto de teste', enabled: true, body: JSON.stringify(c.testContext, null, 2) })
  return next
}
export async function readBeforeSnapshot(context: EngineContext, agentId: string): Promise<BeforeSnapshot & { http: HttpSource }> {
  const [configuration, http] = await Promise.all([createBeforeContextService(context, agentId).read(), createBeforeHttpService(context, agentId).read()])
  context.assertCurrent()
  return { generation: context.generation, context: configuration, http }
}
export async function hydrateBeforeFields(context: EngineContext, agents: Agent[], canManageHttp = true): Promise<Agent[]> {
  const out = await Promise.all(agents.map(async agent => {
    const snapshot = canManageHttp ? await readBeforeSnapshot(context, agent.id) : { generation: context.generation, context: await createBeforeContextService(context, agent.id).read(), http: null }
    return projectBeforeFields(agent, snapshot)
  }))
  context.assertCurrent(); return out
}
/** CAS calls are separate writes. A caller must publish readback and report any partial completion. */
export function createBeforeFieldsService(context: EngineContext, identity: ExpectedContext, storage: StoragePort, agentId: string) {
  const api = createBeforeContextService(context, agentId), http = createBeforeHttpService(context, agentId)
  const journal = createBeforeConfigJournal(storage, identity, agentId), httpJournal = createBeforeHttpJournal(storage, identity, agentId)
  let busy = false
  async function recoverPending() {
    const a = journal.read().active, h = httpJournal.read().active
    if (a) { const op = await api.configOperation(a); journal.resolve(a, op, context.assertCurrent) }
    if (h) { const op = await http.operation(h); httpJournal.resolve(h, op, context.assertCurrent) }
    if (a || h) throw Error('O salvamento anterior foi confirmado. Atualize o assistente antes de salvar novas alterações.')
  }
  async function configure(a: BeforeConfigAttempt, configuration: BeforeConfiguration) {
    journal.reserve(a, context.assertCurrent)
    try { const op = await api.configure(a, configuration); journal.resolve(a, op, context.assertCurrent) }
    catch (error) {
      context.assertCurrent()
      if (versionConflict(error)) { journal.rejectVersion(a, context.assertCurrent); throw error }
      try { const op = await api.configOperation(a); journal.resolve(a, op, context.assertCurrent) }
      catch { context.assertCurrent(); throw Error(`O salvamento da mensagem inicial não foi confirmado. Referência ${a.key}; uma nova tentativa consultará esta referência.`) }
    }
    const saved = await api.read()
    if (saved.revision !== a.expectedRevision + 1 || !same(saved.configuration, configuration)) throw Error('A mensagem inicial mudou após o salvamento. Atualize o assistente para conferir a configuração atual.')
    return saved
  }
  async function configureHttp(a: HttpAttempt, config: NonNullable<ReturnType<typeof translateInbound>>, before: BeforeConfig) {
    httpJournal.reserve(a, context.assertCurrent)
    try { const op = await http.configure(a, config.configuration, config.secrets, before.configuration); httpJournal.resolve(a, op, context.assertCurrent) }
    catch (error) {
      context.assertCurrent()
      if (versionConflict(error)) { httpJournal.rejectVersion(a, context.assertCurrent); throw error }
      try { const op = await http.operation(a); httpJournal.resolve(a, op, context.assertCurrent) }
      catch { context.assertCurrent(); throw Error(`O salvamento do webhook não foi confirmado. Referência ${a.key}; uma nova tentativa consultará esta referência.`) }
    }
    const saved = await http.read()
    if (saved.revision !== a.expectedRevision + 1 || saved.beforeRevision !== before.revision || !same(saved.configuration, config.configuration)) throw Error('O webhook mudou após o salvamento. Atualize o assistente para conferir a configuração atual.')
    return saved
  }
  return {
    read: () => readBeforeSnapshot(context, agentId),
    checkPending: recoverPending,
    async validateSnapshot(snapshot: BeforeSnapshot) {
      const latest = await readBeforeSnapshot(context, agentId)
      if (!snapshot.http || latest.context.revision !== snapshot.context.revision || latest.http.revision !== snapshot.http.revision || latest.http.state !== snapshot.http.state) throw Error('A configuração inicial mudou. Atualize o assistente antes de salvar.')
    },
    async save(plan: BeforePlan, snapshot: BeforeSnapshot, incomingNumberIds: string[], webchatChannelIds: string[] = []): Promise<BeforeSnapshot> {
      context.assertCurrent()
      if (busy) throw Error('Aguarde o salvamento atual da mensagem inicial.')
      const initialHttp = snapshot.http
      if (!initialHttp || snapshot.generation !== context.generation || snapshot.context.agentId !== agentId || initialHttp.agentId !== agentId) throw Error('Atualize o assistente com um acesso de administrador antes de salvar a mensagem inicial.')
      busy = true; let changed = false
      try {
        await recoverPending()
        // Validate the whole request before the first write, including schemas coupled to variables.
        const httpPlan = plan.httpChanged ? translateInbound(plan, incomingNumberIds, snapshot, webchatChannelIds) : initialHttp.state === 'enabled' && initialHttp.configuration && (plan.contextChanged || plan.reauthorizeHttp) ? { configuration: parseHttpConfiguration(initialHttp.configuration, plan.configuration), secrets: { mode: 'keep' as const } } : null
        const latest = await readBeforeSnapshot(context, agentId)
        if (latest.context.revision !== snapshot.context.revision || latest.http.revision !== initialHttp.revision) throw Error('A configuração mudou. Atualize o assistente antes de salvar.')
        let before = latest.context, source: HttpSource = latest.http
        if (!same(before.configuration, plan.configuration)) { before = await configure({ key: crypto.randomUUID(), agentId, expectedRevision: before.revision }, plan.configuration); changed = true }
        if (httpPlan && (plan.httpChanged || changed || plan.reauthorizeHttp && source.state === 'needs_reauthorization')) {
          if (!source.sourceId && httpPlan.configuration.enabled) {
            source = await configureHttp({ key: crypto.randomUUID(), agentId, expectedRevision: source.revision, expectedBeforeRevision: before.revision }, { ...httpPlan, configuration: { ...httpPlan.configuration, enabled: false } }, before)
            changed = true
          }
          source = await configureHttp({ key: crypto.randomUUID(), agentId, expectedRevision: source.revision, expectedBeforeRevision: before.revision }, source.sourceId && httpPlan.configuration.enabled && source.revision === 1 && !snapshot.http?.sourceId ? { ...httpPlan, secrets: { mode: 'keep' } } : httpPlan, before)
          changed = true
        }
        context.assertCurrent(); return { generation: context.generation, context: before, http: source }
      } catch (error) {
        context.assertCurrent()
        if (changed) throw Error(`Parte da configuração inicial foi salva, mas o restante não foi concluído. Atualize para conferir. ${error instanceof Error ? error.message : ''}`)
        throw error
      } finally { busy = false }
    },
  }
}
