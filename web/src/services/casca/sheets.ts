import type { Agent, IntegrationAction } from '@/domain/types'
import { createSheetsService, sheetAttempt, sheetConfiguration, validSheetAttempt, type SheetAttempt, type SheetBinding } from '../engine/sheets'
import { actionColumnName, actionConfiguration, createSheetActionsService, validActionAttempt, type ActionAttempt, type ActionConfiguration, type SheetAction } from '../engine/sheets-actions'
import { captureEngineContext, engineSession, type EngineContext } from '../engine/session'
import { EngineError, parseExpectedContext } from '../engine/http'
import type { ExpectedContext } from '../engine/types'

export type SheetsReference = { kind: 'sheets'; id: string; revision: number; connectionId: string; bindingId: string; bindingRevision: number }
type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
type BindingReference = { connectionId: string; id: string; revision: number }
type Journal = { context: ExpectedContext; fingerprint: string; bindingAttempt?: SheetAttempt; binding?: BindingReference; actionAttempt?: ActionAttempt; action?: { id: string; revision: number }; enableAttempt?: ActionAttempt; completed?: boolean }
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v)
const revision = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0
const keys = (v: object, allowed: string[]) => Object.keys(v).every(key => allowed.includes(key))
function invalid(): never { throw Error('Não foi possível confirmar a configuração da planilha. Nenhuma operação foi repetida.') }
const bindingRef = (b: SheetBinding): BindingReference => ({ connectionId: b.connectionId, id: b.id, revision: b.revision })

export function sheetSelection(row: IntegrationAction) {
  if (row.integration !== 'google-sheets' || row.timing !== 'during' || row.activeWindow && row.activeWindow !== 'any') throw Error('Use esta planilha durante a conversa, a qualquer momento.')
  let url: URL; try { url = new URL(row.config.sheetUrl) } catch { throw Error('Informe a URL da planilha do Google.') }
  const match = /^\/spreadsheets\/d\/([A-Za-z0-9_-]{10,200})(?:\/|$)/.exec(url.pathname)
  if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com' || url.username || url.password || !match) throw Error('Informe a URL da planilha do Google.')
  if (!uuid(row.config.connectionId) || !row.config.tab?.trim() || row.config.tab.length > 100 || !['Read rows', 'Add row'].includes(row.config.action)) throw Error('Conecte a conta e informe a aba e a ação da planilha.')
  const kind = row.config.action === 'Add row' ? 'append' as const : 'query' as const
  const configuration = sheetConfiguration({ spreadsheetId: match[1], name: row.name.trim(), allowAppend: kind === 'append', enabled: true })
  if ((row.description?.length ?? 0) > 700) throw Error('Use uma descrição com até 700 caracteres.')
  return { configuration, connectionId: row.config.connectionId, sheetTitle: row.config.tab, kind, description: row.description?.trim() ?? '' }
}

/** Hidden provider fields derive from the selected tab's actual header row. No example columns are supplied. */
export function sheetActionConfiguration(kind: SheetAction['kind'], sheetTitle: string, rawHeaders: unknown[], rowCount: number): ActionConfiguration {
  const headers = [...rawHeaders]
  while (headers.at(-1) === '') headers.pop()
  if (!headers.length || headers.length > 20 || headers.some(h => typeof h !== 'string' || !h.trim() || h.length > 256) || new Set(headers).size !== headers.length) throw Error('A primeira linha da aba deve ter entre 1 e 20 cabeçalhos únicos, sem colunas vazias entre eles.')
  if (!Number.isSafeInteger(rowCount) || rowCount < 2) throw Error('A aba precisa de uma linha de cabeçalho e espaço para os registros.')
  const last = actionColumnName(headers.length)
  if (kind === 'query') return actionConfiguration(kind, { sheetTitle, inputDefinitions: [], scanRange: `A1:${last}${Math.min(1000, rowCount)}`, headers: true, filters: [], expectedHeaders: headers, returnColumns: headers.map((_, i) => actionColumnName(i + 1)), maxRows: 50 })
  const names = headers.map((h, i) => `col_${i + 1}_${String(h).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9_]/g, '_').slice(0, 40)}`)
  return actionConfiguration(kind, { sheetTitle, inputDefinitions: names.map(name => ({ name, type: 'text' })), range: `A1:${last}1`, row: names.map(name => ({ kind: 'variable', name })) })
}

export function createSheetsResourceConnector(context: EngineContext, identity: ExpectedContext, storage: StoragePort, agentId: string, slot: string) {
  const expected = parseExpectedContext(identity)
  if (context.tenantId !== expected.tenantId || !uuid(agentId)) invalid()
  const api = createSheetsService(context, expected.userId), actions = createSheetActionsService(context, agentId, expected.userId)
  const key = `kloel-casca-sheets:${expected.userId}:${expected.tenantId}:${agentId}:${slot}`
  let busy = false
  function read(): Journal | null {
    context.assertCurrent(); const raw = storage.getItem(key); if (raw === null) return null
    let value: Journal; try { value = JSON.parse(raw) } catch { invalid() }
    if (!value! || !keys(value, ['context', 'fingerprint', 'bindingAttempt', 'binding', 'actionAttempt', 'action', 'enableAttempt', 'completed']) || JSON.stringify(value.context) !== JSON.stringify(expected) || !/^[a-f0-9]{64}$/.test(value.fingerprint)) invalid()
    if (value.bindingAttempt && (!validSheetAttempt(value.bindingAttempt) || value.bindingAttempt.kind === 'rows.append')) invalid()
    if (value.binding && (!keys(value.binding, ['connectionId', 'id', 'revision']) || !uuid(value.binding.connectionId) || !uuid(value.binding.id) || !revision(value.binding.revision))) invalid()
    if (value.action && (!keys(value.action, ['id', 'revision']) || !uuid(value.action.id) || !revision(value.action.revision))) invalid()
    for (const a of [value.actionAttempt, value.enableAttempt]) if (a && (!validActionAttempt(a) || a.agentId !== agentId || !['action.create', 'action.update', 'action.set_enabled'].includes(a.kind))) invalid()
    if (value.completed !== undefined && value.completed !== true) invalid()
    return value
  }
  function write(value: Journal | null) {
    context.assertCurrent(); const raw = value === null ? null : JSON.stringify(value)
    if (raw === null) storage.removeItem(key); else storage.setItem(key, raw)
    context.assertCurrent(); if (storage.getItem(key) !== raw) invalid()
  }
  async function findAction(id: string, expectedRevision: number) {
    const action = (await actions.list()).find(a => a.id === id)
    if (!action || action.revision !== expectedRevision) throw Error('A ação da planilha mudou. Abra a integração novamente.')
    return action
  }
  async function recoverBinding(journal: Journal) {
    if (!journal.bindingAttempt) invalid()
    const receipt = await api.operation(journal.bindingAttempt)
    if (receipt.status !== 'succeeded') throw Error('A configuração da planilha ainda não foi confirmada. Consulte novamente.')
    const binding = await api.get(receipt.connectionId, receipt.bindingId)
    if (binding.revision !== receipt.revision) throw Error('A planilha mudou. Abra a integração novamente.')
    journal.binding = bindingRef(binding); delete journal.bindingAttempt; write(journal); return binding
  }
  async function recoverAction(journal: Journal, field: 'actionAttempt' | 'enableAttempt') {
    const attempt = journal[field]; if (!attempt) invalid()
    const receipt = await actions.operation(attempt), action = await findAction(receipt.actionId, receipt.resultRevision)
    journal.action = { id: action.id, revision: action.revision }; delete journal[field]; write(journal); return action
  }
  async function fingerprint(value: unknown) {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)))
    return [...new Uint8Array(bytes)].map(v => v.toString(16).padStart(2, '0')).join('')
  }
  async function dispatch(journal: Journal, field: 'bindingAttempt' | 'actionAttempt' | 'enableAttempt', send: () => Promise<unknown>) {
    try { await send() } catch (error) {
      context.assertCurrent()
      if (error instanceof EngineError && [400, 401, 403, 404, 409, 413, 422].includes(error.status)) { delete journal[field]; write(journal); throw error }
      // A lost response is reconciled through the original receipt below, never replayed.
    }
  }
  async function save(row: IntegrationAction) {
    context.assertCurrent(); if (busy) throw Error('Aguarde o salvamento da planilha.')
    const selected = sheetSelection(row), ref = row.engineBinding?.kind === 'sheets' ? row.engineBinding : undefined
    const hash = await fingerprint({ selected, reference: ref ?? null }); context.assertCurrent()
    const pending = read(); if (pending && pending.fingerprint !== hash) throw Error('Há um salvamento anterior em conferência. Consulte-o antes de mudar a planilha.')
    let journal: Journal = pending ?? { context: expected, fingerprint: hash }
    busy = true
    try {
      if (!pending) {
        if (ref) {
          const current = await findAction(ref.id, ref.revision)
          if (current.connectionId !== selected.connectionId || current.bindingId !== ref.bindingId || current.bindingRevision !== ref.bindingRevision || current.kind !== selected.kind) throw Error('Para mudar de conta ou tipo de ação, adicione outra integração.')
          const binding = await api.get(ref.connectionId, ref.bindingId)
          if (binding.revision !== ref.bindingRevision || binding.spreadsheetId !== selected.configuration.spreadsheetId || !binding.enabled || selected.kind === 'append' && !binding.allowAppend) throw Error('A planilha mudou ou não autoriza esta ação. Adicione outra integração.')
          journal.binding = bindingRef(binding); journal.action = { id: current.id, revision: current.revision }
        } else {
          const matches = (await api.list(selected.connectionId)).filter(b => b.spreadsheetId === selected.configuration.spreadsheetId)
          if (matches.length > 1) throw Error('Há mais de uma configuração para esta planilha. Revise as integrações antes de continuar.')
          if (matches[0]) {
            if (!matches[0].enabled || selected.kind === 'append' && !matches[0].allowAppend) throw Error('A configuração existente desta planilha não autoriza a ação selecionada.')
            journal.binding = bindingRef(matches[0])
          }
        }
        write(journal)
      }
      let binding: SheetBinding
      if (journal.bindingAttempt) binding = await recoverBinding(journal)
      else if (journal.binding) { binding = await api.get(journal.binding.connectionId, journal.binding.id); if (binding.revision !== journal.binding.revision) throw Error('A planilha mudou. Abra a integração novamente.') }
      else {
        const attempt = sheetAttempt('binding.create', selected.connectionId); journal.bindingAttempt = attempt; write(journal)
        await dispatch(journal, 'bindingAttempt', () => api.configure(attempt, selected.configuration))
        binding = await recoverBinding(journal)
      }
      if (journal.completed) { if (!journal.action) invalid(); return { binding, action: await findAction(journal.action.id, journal.action.revision) } }
      let action: SheetAction
      if (journal.enableAttempt) { action = await recoverAction(journal, 'enableAttempt'); journal.completed = true; write(journal); return { binding, action } }
      if (journal.actionAttempt) action = await recoverAction(journal, 'actionAttempt')
      else {
        const tabs = await api.tabs(binding), tab = tabs.find(t => t.title === selected.sheetTitle)
        if (!tab?.gridProperties?.rowCount || !tab.gridProperties.columnCount) throw Error('A aba informada não foi encontrada ou não contém uma grade de dados.')
        const range = `A1:${actionColumnName(Math.min(21, tab.gridProperties.columnCount))}1`
        const header = await api.values(binding, { sheetTitle: selected.sheetTitle, range })
        const configuration = sheetActionConfiguration(selected.kind, selected.sheetTitle, header.values[0] ?? [], tab.gridProperties.rowCount)
        const attempt: ActionAttempt = journal.action ? { key: crypto.randomUUID(), kind: 'action.update', agentId, actionId: journal.action.id, expectedRevision: journal.action.revision, expectedBindingRevision: binding.revision, actionKind: selected.kind } : { key: crypto.randomUUID(), kind: 'action.create', agentId, connectionId: binding.connectionId, bindingId: binding.id, expectedBindingRevision: binding.revision, actionKind: selected.kind }
        const description = `${selected.description || row.name}. ${selected.kind === 'query' ? 'Consultar somente o intervalo configurado; até 50 linhas por consulta, sem afirmar cobertura da planilha inteira.' : 'Adicionar uma linha com os campos do cabeçalho. Confirmar os dados com o usuário antes de registrar.'}`
        journal.actionAttempt = attempt; write(journal)
        await dispatch(journal, 'actionAttempt', () => actions.configure(attempt, selected.kind, row.name, description, configuration))
        action = await recoverAction(journal, 'actionAttempt')
      }
      if (!action.enabled) {
        const attempt: ActionAttempt = { key: crypto.randomUUID(), kind: 'action.set_enabled', agentId, actionId: action.id, expectedRevision: action.revision, enabled: true }
        journal.enableAttempt = attempt; write(journal)
        await dispatch(journal, 'enableAttempt', () => actions.setEnabled(attempt))
        action = await recoverAction(journal, 'enableAttempt')
      }
      journal.completed = true; write(journal); context.assertCurrent(); return { binding: await api.get(binding.connectionId, binding.id), action }
    } finally { busy = false }
  }
  async function remove(ref: SheetsReference) {
    context.assertCurrent(); if (busy) throw Error('Aguarde o salvamento da planilha.')
    const hash = await fingerprint({ remove: ref }), pending = read()
    if (pending && pending.fingerprint !== hash) throw Error('Há um salvamento anterior em conferência. Consulte-o antes de remover a planilha.')
    const journal: Journal = pending ?? { context: expected, fingerprint: hash }
    busy = true
    try {
      if (journal.completed) return
      if (journal.enableAttempt) await recoverAction(journal, 'enableAttempt')
      else {
        const action = await findAction(ref.id, ref.revision)
        if (action.enabled) {
          const attempt: ActionAttempt = { key: crypto.randomUUID(), kind: 'action.set_enabled', agentId, actionId: action.id, expectedRevision: action.revision, enabled: false }
          journal.enableAttempt = attempt; write(journal)
          await dispatch(journal, 'enableAttempt', () => actions.setEnabled(attempt))
          await recoverAction(journal, 'enableAttempt')
        }
      }
      journal.completed = true; write(journal)
    } finally { busy = false }
  }
  return { save, remove, acknowledge() { const journal = read(); if (journal && !journal.completed) throw Error('A configuração ainda não foi confirmada.'); write(null) } }
}

export function sheetsResourceConnector(agentId: string, slot: string) {
  const context = captureEngineContext('integrations:execute'), identity = engineSession.getSnapshot().data!.identity.context
  return createSheetsResourceConnector(context, identity, window.sessionStorage, agentId, slot)
}
export function projectSheets(action: SheetAction, binding: SheetBinding, existing?: IntegrationAction): IntegrationAction {
  return { ...existing, id: existing?.id ?? action.id, integration: 'google-sheets', name: action.name, description: existing?.description ?? '', timing: 'during', activeWindow: 'any', connected: action.enabled && action.readiness.available, config: { sheetUrl: `https://docs.google.com/spreadsheets/d/${binding.spreadsheetId}/edit`, tab: action.configuration.sheetTitle, action: action.kind === 'append' ? 'Add row' : 'Read rows', connectionId: action.connectionId }, engineBinding: { kind: 'sheets', id: action.id, revision: action.revision, connectionId: action.connectionId, bindingId: action.bindingId, bindingRevision: action.bindingRevision } }
}
export async function hydrateSheets(context: EngineContext, agents: Agent[], userId: string): Promise<Agent[]> {
  const api = createSheetsService(context, userId)
  return Promise.all(agents.map(async agent => {
    const actions = (await createSheetActionsService(context, agent.id, userId).list()).filter(a => a.enabled)
    const bindings = await Promise.all(actions.map(action => api.get(action.connectionId, action.bindingId)))
    const projected: IntegrationAction[] = actions.map((action, index) => projectSheets(action, bindings[index], agent.integrations.find(i => i.engineBinding?.kind === 'sheets' && i.engineBinding.id === action.id)))
    context.assertCurrent(); return { ...agent, integrations: [...agent.integrations.filter(i => i.integration !== 'google-sheets'), ...projected] }
  }))
}
