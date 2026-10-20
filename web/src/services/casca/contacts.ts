import type { Contact, ContactSettings, SmartFieldDef } from '@/domain/types'
import '@/app/pages/contacts/ext'
import { useStore } from '@/data/store'
import { createCRMClient, contactPayload, type CRMContact, type CRMSettings, type ContactEdit, type FieldInput, type PermissionInput } from '../engine/crm'
import { captureEngineContext, engineSession, type EngineContext } from '../engine/session'
import { automaticContactSettingsError, createAutomaticContactSettings, settingsMeaning } from './automatic-contact-settings'
import { createCRMCaptureService, type CaptureState } from '../engine/crm-capture'
import { EngineError, parseExpectedContext } from '../engine/http'
import type { ExpectedContext } from '../engine/types'
import { publishSlice, type DataSlice } from './data'
import { createCRMImportClient, digestImportOptions, type ImportOptions } from '../engine/crm-import'
import { createCRMImportJournal } from '../engine/crm-import-journal'
import type { ImportRecord, PlanRow, MergePolicy } from '@/app/pages/contacts/lib'

type Communication = { blocked: boolean; whatsappAi: boolean }
/**
 * O snapshot é a autoridade de Contatos e o ÚNICO escritor de db.contacts/db.contactSettings: a tela é sempre a projeção dele, e ele dá a revisão
 * (If-Match) e a base dos salvamentos — o que a pessoa vê é o que o salvamento parte. comm: Bloquear/WhatsApp IA (rota própria, sem revisão).
 * marks/commMarks: quando um contato foi criado/excluído, ou teve os interruptores gravados, aqui (relógio local) — uma leitura que começou antes
 * não desfaz isso. readAt: início da leitura mais nova já instalada.
 */
type Snapshot = { context: EngineContext; settings: CRMSettings; contacts: Map<string, CRMContact>; members: Map<string, string>; comm: Map<string, Communication>; policy?: CaptureState; marks: Map<string, number>; commMarks: Map<string, number>; readAt: number }
/** unresolvedFields: campos Escolha cujo valor salvo não aponta para nenhuma opção (legado); a tela mostra o texto cru, mas para o motor ele não cabe em tipo nenhum. */
declare module '@/domain/types' { interface Contact { engineSource?: string; captureProvenance?: import('../engine/crm').RawContact['captureProvenance']; unresolvedFields?: string[] } }
declare module '@/domain/types' { interface ContactSettings { automationError?: string } }
const snapshots = new Map<string, Snapshot>()
let tick = 0
const scope = (c: EngineContext) => `${c.generation}:${c.tenantId}`
const failure = (message: string): never => { throw new Error(message) }
const canonical = (value: unknown): string => JSON.stringify(value, (_k, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v)

export function projectContact(row: CRMContact, settings: CRMSettings, members: Map<string, string>): Contact {
  const fields: Record<string, string> = {}, unresolved: string[] = []
  for (const [id, value] of Object.entries(row.raw.fieldValues)) {
    const definition = settings.definitions.find(f => f.id === id), option = definition?.type === 'choice' && typeof value === 'string' ? definition.options.find(o => o.id === value) : undefined
    if (definition?.type === 'choice' && typeof value === 'string' && !option) unresolved.push(id)
    fields[id] = typeof value === 'boolean' ? value ? 'Sim' : 'Não' : option?.label ?? value
  }
  if (!['manual', 'import', 'conversation', 'legacy', 'automation'].includes(row.source)) failure('A origem de um contato não pôde ser confirmada.')
  return { id: row.id, orgId: row.orgId, firstName: row.firstName, lastName: row.lastName, phones: row.phones.map(({ value, label }) => ({ value, label })), emails: row.emails.map(({ value, label }) => ({ value, label })), company: row.company, ownerId: row.raw.ownerMembershipId ? members.get(row.raw.ownerMembershipId) ?? row.raw.ownerMembershipId : undefined, notes: row.notes, fields, source: row.source === 'automation' ? 'conversation' : row.source as Contact['source'], engineSource: row.source, captureProvenance: structuredClone(row.raw.captureProvenance), createdAt: row.createdAt, updatedAt: row.updatedAt, ...(unresolved.length ? { unresolvedFields: unresolved } : {}) }
}

export function projectContactSettings(settings: CRMSettings, tenantId: string, policy?: CaptureState): ContactSettings {
  return { orgId: tenantId, autoCapture: settings.autoCapture, creationGate: settings.creationGate, automationError: automaticContactSettingsError(settings, policy), smartFields: settings.definitions.filter(d => d.status === 'active').map(d => ({ id: d.id, label: d.label, type: d.type === 'choice' ? 'enum' : d.type, description: d.description, aiFill: d.aiFill, keepUpdated: d.keepUpdated === true, ...(d.findHint ? { findHint: d.findHint } : {}), ...(d.updateWhen ? { updateWhen: d.updateWhen } : {}), options: d.options.filter(o => o.status === 'active').map(o => o.label), example: d.example, showInList: d.showInList })) }
}

/** Lê Contatos, instala no snapshot e publica a projeção dele. Devolve fatia vazia: db.contacts/db.contactSettings só são escritos pelo snapshot. */
export async function loadContacts(context: EngineContext): Promise<DataSlice> {
  const api = createCRMClient(context), started = ++tick
  const [settings, memberPage] = await Promise.all([api.settings(), api.members()])
  context.assertCurrent()
  const rows: CRMContact[] = []
  for (let page = 1; page <= 100; page++) {
    const result = await api.list({ page, limit: 100, sort: 'createdAt', order: 'asc' })
    if (!Number.isSafeInteger(result.totalPages) || result.totalPages < 0 || !Number.isSafeInteger(result.total) || result.total < 0) failure('A lista de contatos está incompleta. Tente novamente.')
    rows.push(...result.items)
    if (page >= result.totalPages) {
      if (rows.length !== result.total || new Set(rows.map(c => c.id)).size !== rows.length) failure('A lista de contatos mudou durante o carregamento. Tente novamente.')
      context.assertCurrent()
      const members = new Map(memberPage.items.map(m => [m.id, m.userId]))
      let policy: CaptureState | undefined
      try { policy = await createCRMCaptureService(context).policy() } catch { context.assertCurrent() }
      context.assertCurrent()
      // Configurações de comunicação (Bloquear contato / WhatsApp IA) vêm de uma rota própria do motor; leitura que falha não vale como "desligado".
      let comm: Map<string, Communication> | undefined
      try { const r = await context.request<{ items: ({ contactId: string } & Communication)[] }>('/crm/contact-communication'); comm = new Map(r.items.map(i => [i.contactId, { blocked: i.blocked === true, whatsappAi: i.whatsappAi === true }])) } catch { /* sem a rota: ficam os interruptores já confirmados (ou desligados) */ }
      context.assertCurrent()
      install(context, started, { settings, rows, members, policy, comm })
      // Só o snapshot publica Contatos: as áreas recebem fatia vazia, então uma área lenta nunca publica depois uma cópia antiga da lista.
      publish(context)
      return {}
    }
  }
  return failure('Há contatos demais para carregar nesta tela. Nenhuma lista parcial foi usada.')
}

type Read = { settings: CRMSettings; rows: CRMContact[]; members: Map<string, string>; policy?: CaptureState; comm?: Map<string, Communication> }
/**
 * Instala uma leitura (iniciada em `started`) no snapshot vivo, no lugar — salvamentos em andamento gravam nos mesmos Maps —, sem desfazer o que foi
 * gravado aqui depois que ela começou: configurações e contatos ficam com a revisão mais nova; criado/excluído durante a leitura continua criado/excluído;
 * interruptores gravados durante a leitura ficam. Leitura mais antiga que a já instalada (terminou depois dela) só traz revisões mais novas.
 */
function install(context: EngineContext, started: number, read: Read) {
  const key = scope(context), live = snapshots.get(key)
  for (const other of [...snapshots.keys()]) if (other !== key) snapshots.delete(other)
  if (!live) { snapshots.set(key, { context, settings: read.settings, contacts: new Map(read.rows.map(c => [c.id, c])), members: read.members, comm: read.comm ?? new Map(), policy: read.policy, marks: new Map(), commMarks: new Map(), readAt: started }); return }
  const older = started < live.readAt, after = (marks: Map<string, number>, id: string) => older || (marks.get(id) ?? 0) > started, next = new Map<string, CRMContact>()
  for (const row of read.rows) {
    const mine = live.contacts.get(row.id)
    if (!mine && after(live.marks, row.id)) continue // excluído aqui depois que a leitura começou
    next.set(row.id, mine && mine.revision > row.revision ? mine : row)
  }
  for (const [id, mine] of live.contacts) if (!next.has(id) && after(live.marks, id)) next.set(id, mine) // criado aqui depois que a leitura começou
  const comm = new Map<string, Communication>()
  for (const id of next.keys()) { const flags = !read.comm || after(live.commMarks, id) ? live.comm.get(id) : read.comm.get(id); if (flags) comm.set(id, flags) }
  live.contacts.clear(); for (const [id, row] of next) live.contacts.set(id, row)
  live.comm.clear(); for (const [id, flags] of comm) live.comm.set(id, flags)
  Object.assign(live, { context, members: older ? live.members : read.members, policy: older ? live.policy : read.policy, settings: live.settings.revision > read.settings.revision ? live.settings : read.settings, readAt: Math.max(live.readAt, started) })
}
/** Publica a projeção do snapshot inteiro (contatos + configurações): db.contacts nunca fica com uma versão diferente da que dá a revisão do salvamento. */
function publish(context: EngineContext, extra: DataSlice = {}) {
  const s = snapshots.get(scope(context))
  if (!s) return failure('Recarregue os contatos.')
  const contacts = [...s.contacts.values()].map(c => { const p = projectContact(c, s.settings, s.members), x = s.comm.get(c.id); return x ? { ...p, ...x } : p })
  publishSlice(context, { ...extra, contacts, contactSettings: [projectContactSettings(s.settings, context.tenantId, s.policy)] })
}
/** Resposta confirmada de um salvamento: nunca troca uma revisão mais nova que já esteja no snapshot; um contato criado fica marcado (a leitura antiga não o tira). */
function remember(snapshot: Pick<Snapshot, 'contacts'> & Partial<Pick<Snapshot, 'marks'>>, row: CRMContact, created = false) {
  const known = snapshot.contacts.get(row.id)
  if (!known || known.revision <= row.revision) snapshot.contacts.set(row.id, row)
  if (created) snapshot.marks?.set(row.id, ++tick)
}

function current(permission: string) {
  const context = captureEngineContext(permission), snapshot = snapshots.get(scope(context))
  if (!snapshot) return failure('Recarregue os contatos antes de salvar.')
  context.assertCurrent()
  return { ...snapshot, context, api: createCRMClient(context) }
}

export function contactDraft(input: ContactEdit, snapshot: Pick<Snapshot, 'settings' | 'members'>, previous?: CRMContact): ContactEdit {
  const fields = { ...input.fields }
  for (const def of snapshot.settings.definitions) {
    if (def.type !== 'choice' || !fields[def.id]) continue
    const choices = def.options.filter(o => o.label === fields[def.id] || o.id === fields[def.id])
    if (choices.length !== 1) failure(`Revise o campo ${def.label}.`)
    fields[def.id] = choices[0]!.id
  }
  const preserveEndpointIds = (next: ContactEdit['phones'], old: CRMContact['phones'] = [], phone = true) => next.map(item => {
    const normalize = (v: string) => phone ? v.replace(/\D/g, '') : v.trim().toLowerCase()
    const match = old.find(o => normalize(o.value) === normalize(item.value))
    return { ...item, ...(match?.id ? { id: match.id } : {}) }
  })
  const owner = input.ownerId ? [...snapshot.members].find(([, userId]) => userId === input.ownerId)?.[0] : undefined
  if (input.ownerId && !owner && input.ownerId !== previous?.raw.ownerMembershipId) failure('Escolha um responsável que ainda pertença à equipe.')
  return { ...input, fields, ownerId: owner ?? input.ownerId, phones: preserveEndpointIds(input.phones, previous?.phones), emails: preserveEndpointIds(input.emails, previous?.emails, false) }
}

/** One explicit create attempt keeps the same idempotency key across transport failures and reloads. */
export function createContactCommands(context: EngineContext, snapshot: Pick<Snapshot, 'settings' | 'members' | 'contacts'> & Partial<Pick<Snapshot, 'marks'>>, storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, identity: ExpectedContext) {
  const expected = parseExpectedContext(identity)
  if (expected.tenantId !== context.tenantId || !expected.membershipId) failure('Atualize sua sessão antes de salvar o contato.')
  const api = createCRMClient(context), storageKey = `kloel:casca:contact-create:${context.tenantId}:${expected.userId}:${expected.membershipId}:${expected.authorityVersion}`
  let busy = false
  return {
    async save(input: ContactEdit, id?: string) {
      context.assertCurrent()
      if (busy) return failure('Aguarde o salvamento do contato.')
      busy = true
      try {
        const previous = id ? snapshot.contacts.get(id) : undefined
        if (id && !previous) return failure('Atualize o contato antes de salvar.')
        const payload = contactPayload(contactDraft(input, snapshot, previous), snapshot.settings, previous)
        if (previous) {
          const result = await api.update(previous, payload); context.assertCurrent()
          remember(snapshot, result)
          return projectContact(result, snapshot.settings, snapshot.members)
        }
        const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(payload)))), b => b.toString(16).padStart(2, '0')).join('')
        context.assertCurrent()
        let attempt: { key: string; digest: string }
        try {
          const existing = storage.getItem(storageKey)
          attempt = existing ? JSON.parse(existing) : { key: crypto.randomUUID(), digest }
          if (!/^[0-9a-f-]{36}$/.test(attempt.key) || !/^[a-f0-9]{64}$/.test(attempt.digest) || Object.keys(attempt).sort().join() !== 'digest,key') throw new Error('invalid')
          if (attempt.digest !== digest) return failure('Há um contato com salvamento não confirmado. Mantenha os dados anteriores e tente novamente antes de criar outro.')
          const serialized = JSON.stringify(attempt); storage.setItem(storageKey, serialized)
          if (storage.getItem(storageKey) !== serialized) throw new Error('storage')
        } catch (e) { if (e instanceof Error && e.message.startsWith('Há um contato')) throw e; return failure('Não foi possível guardar a referência do contato. Nenhuma solicitação foi enviada.') }
        try {
          const result = await api.create(payload, attempt.key); context.assertCurrent()
          storage.removeItem(storageKey); remember(snapshot, result, true)
          return projectContact(result, snapshot.settings, snapshot.members)
        } catch (error) {
          if (error instanceof EngineError && error.status >= 400 && error.status < 500 && error.code !== 'idempotency_conflict') storage.removeItem(storageKey)
          throw error
        }
      } finally { busy = false }
    },
  }
}

export async function saveContact(input: ContactEdit, id?: string, fromConversation?: string) {
  const s = current('contacts:write')
  const expected = engineSession.getSnapshot().data!.identity.context
  const contact = await createContactCommands(s.context, s, sessionStorage, expected).save(input, id)
  s.context.assertCurrent()
  publish(s.context)
  // "Criar contato" a partir de Conversas: o contato já foi salvo; o vínculo com a conversa é uma segunda confirmação do motor.
  if (fromConversation) {
    try { await linkConversationToContact(contact.id, fromConversation) }
    catch (error) { throw new Error(`O contato foi criado, mas não foi vinculado à conversa. ${error instanceof Error ? error.message : ''}`.trim()) }
  }
  return contact
}

/** Conversas › "Vincular a um contato": vínculo explícito feito por uma pessoa (replace confirma a troca de contato). */
export async function linkConversationToContact(contactId: string, conversationId: string, replace = false) {
  const context = captureEngineContext('contacts:write')
  const result = await createCRMClient(context).linkConversation(contactId, conversationId, replace)
  context.assertCurrent()
  publishSlice(context, { conversations: useStore.getState().db.conversations.map(c => c.id === conversationId ? { ...c, contactId } : c) })
  return result
}

/** Contatos (do snapshot atual) com valor salvo que não cabe no tipo/nas opções escolhidos no formulário (fits: a regra do motor, fieldValueFits). */
export function incompatibleContactIds(field: SmartFieldDef, contacts: Contact[], fits: (field: SmartFieldDef, value: string | undefined) => boolean) {
  return contacts.filter(c => c.fields[field.id] !== undefined && (c.unresolvedFields?.includes(field.id) || !fits(field, c.fields[field.id]))).map(c => c.id)
}

export async function removeContacts(ids: string[]) {
  const s = current('contacts:delete')
  let removed = 0
  for (const id of ids) {
    const previous = s.contacts.get(id)
    if (!previous) failure('Atualize a lista antes de excluir os contatos.')
    try { await s.api.remove(previous!); s.context.assertCurrent() }
    catch (error) { throw new Error(`${removed ? `${removed} contato(s) já foram excluídos. ` : ''}${error instanceof Error ? error.message : 'Não foi possível excluir este contato.'}`) }
    s.contacts.delete(id); s.comm.delete(id); s.marks.set(id, ++tick); removed++
    publish(s.context, { conversations: useStore.getState().db.conversations.map(c => c.contactId === id ? { ...c, contactId: undefined } : c) })
  }
  return removed
}

export type FieldClear = { fieldId: string; contactIds: string[] }
export function settingsPayload(input: Omit<ContactSettings, 'orgId'>, previous: CRMSettings, clear: FieldClear[] = []): { autoCapture: boolean; creationGate: string; definitions: FieldInput[]; clear?: FieldClear[] } {
  const definitions = input.smartFields.map((field): FieldInput => {
    const old = previous.definitions.find(d => d.id === field.id), keepUpdated = field.keepUpdated ?? true
    const options: FieldInput['options'] = field.type === 'enum' ? (field.options ?? []).map(label => { const found = old?.options.find(o => o.label === label); return { ...(found ? { id: found.id } : {}), label, status: 'active' } }) : []
    for (const option of old?.options ?? []) if (!options.some(o => o.id === option.id)) options.push({ id: option.id, label: option.label, status: 'archived' })
    return { ...(old ? { id: old.id } : {}), key: old?.key ?? `field_${field.id.replace(/[^a-zA-Z0-9_]/g, '_')}`, label: field.label.trim(), type: field.type === 'enum' ? 'choice' : field.type, description: field.description.trim(), status: 'active', aiFill: field.aiFill, example: field.example ?? '', showInList: field.showInList ?? false, options, findHint: field.findHint?.trim() ?? '', keepUpdated, updateWhen: keepUpdated ? field.updateWhen?.trim() ?? '' : '' }
  })
  for (const old of previous.definitions) if (!definitions.some(d => d.id === old.id)) {
    const { revision: _revision, ...definition } = old
    definitions.push({ ...definition, status: 'archived' })
  }
  // The CRM requires explicit archival; never drop prior fields or their values.
  // clear rides in the same PUT /crm/settings: the engine removes only the listed values that do not fit, in the settings transaction.
  return { autoCapture: input.autoCapture, creationGate: input.creationGate.trim(), definitions, ...(clear.length ? { clear } : {}) }
}

/**
 * clear ("Apagar esses valores ao salvar"): contatos cujo valor não cabe no tipo/nas opções novos. Vai dentro do PUT /crm/settings e o motor
 * apaga só os listados que não cabem, na mesma transação da configuração: recusa (revisão, tipo em uso…) ou falha antes do PUT não apaga nada.
 * Sem mudança de configuração não há PUT; então a limpeza (mesma regra no motor) só é pedida depois de a gravação ter sido aceita.
 */
export async function saveContactSettings(input: Omit<ContactSettings, 'orgId'>, clear: FieldClear[] = []) {
  const s = current('contacts:settings')
  const targets = clear.filter(item => item.contactIds.length && s.settings.definitions.some(d => d.id === item.fieldId))
  const payload = settingsPayload(input, s.settings, targets), unchanged = canonical(settingsMeaning(payload)) === canonical(settingsMeaning(s.settings))
  const commands = createAutomaticContactSettings(s.context, engineSession.getSnapshot().data!.identity.context, window.sessionStorage)
  try {
    const result = await commands.save(s.settings, () => payload); s.context.assertCurrent()
    await loadContacts(s.context)
    const waitingForChannel = 'waitingForChannel' in result && result.waitingForChannel === true
    if (!waitingForChannel) await commands.confirm(result)
    if (result.recovered) failure(result.complete ? 'O salvamento anterior foi confirmado. Confira as preferências atuais antes de fazer outra alteração.' : 'As preferências anteriores foram confirmadas. Confira os dados e salve novamente para concluir a configuração automática.')
    if (unchanged && targets.length) { await createCRMClient(s.context).clearFieldValues(targets); s.context.assertCurrent(); await loadContacts(s.context) }
    return { settings: result.settings, waitingForChannel }
  } catch (error) {
    s.context.assertCurrent()
    try { await loadContacts(s.context) } catch { /* Do not project guesses when the read is unavailable. */ }
    s.context.assertCurrent(); throw error
  }
}

/** Collapse the shell's reviewed CSV rows, then require the server to confirm every create/merge decision. */
export function importOptions(plan: PlanRow[], policy: MergePolicy, settings: CRMSettings): ImportOptions {
  const records = new Map<string, ImportRecord>()
  for (const row of plan) {
    if (row.status.kind === 'skip') continue
    const key = row.status.kind === 'merge' ? row.status.contactId : String(row.status.kind === 'merge_file' ? row.status.row : row.row)
    const base = records.get(key)
    if (!base) { records.set(key, structuredClone(row.record)); continue }
    for (const name of ['firstName', 'lastName', 'company', 'notes'] as const) if (row.record[name] && (policy === 'overwrite' || !base[name])) base[name] = row.record[name]
    base.phones = [...new Set([...base.phones, ...row.record.phones])]; base.emails = [...new Set([...base.emails, ...row.record.emails])]
    for (const [id, value] of Object.entries(row.record.fields)) if (value && (policy === 'overwrite' || !base.fields[id])) base.fields[id] = value
  }
  // Smart-field columns: the bundle must describe each referenced field (same key/type/options) so the engine maps values to it.
  const used = new Set([...records.values()].flatMap(record => Object.entries(record.fields).filter(([, value]) => value?.trim()).map(([id]) => id)))
  const definitions = settings.definitions.filter(def => used.has(def.id)).map(def => ({ id: def.id, key: def.key, label: def.label, type: def.type, description: def.description, status: def.status, aiFill: false, options: def.options, example: def.example, showInList: def.showInList }))
  return { mode: 'merge', mergePolicy: policy === 'keep' ? 'fill_empty' : 'overwrite_supplied', bundle: { format: 'kloel.contacts', version: 2, definitions, contacts: [...records.values()].map(record => {
    const draft = contactDraft({ ...record, phones: record.phones.map(value => ({ value, label: '' })), emails: record.emails.map(value => ({ value, label: '' })) }, { settings, members: new Map() })
    const payload = contactPayload(draft, settings)
    // Empty CSV cells are omitted: overwrite_supplied must not erase existing data.
    return { data: { ...(record.firstName ? { firstName: payload.firstName } : {}), ...(record.lastName ? { lastName: payload.lastName } : {}), ...(record.company ? { company: payload.company } : {}), ...(record.notes ? { notes: payload.notes } : {}), phones: payload.phones, emails: payload.emails, fieldValues: Object.fromEntries(Object.entries(payload.fieldValues).filter(([, value]) => value !== null)) } }
  }) } }
}

export async function prepareContactImport(plan: PlanRow[], policy: MergePolicy) {
  const s = current('contacts:bulk'), api = createCRMImportClient(s.context)
  const expected = engineSession.getSnapshot().data?.identity.context
  if (!expected) failure('Atualize sua sessão antes de importar.')
  const journal = createCRMImportJournal(sessionStorage, expected!)
  const options = importOptions(plan, policy, s.settings), digest = await digestImportOptions(options)
  s.context.assertCurrent()
  const prior = journal.read().active
  if (prior && prior.optionsDigest !== digest) failure('Há uma importação pendente. Reabra o arquivo anterior para consultar seu resultado antes de importar outro.')
  const preview = prior ? null : await api.preview(options)
  if (preview && (!preview.canCommit || preview.rows.some((row, index) => {
    const entries = plan.filter(p => p.status.kind === 'new' || p.status.kind === 'merge')
    const targets = [...new Map(entries.map(p => [p.status.kind === 'merge' ? p.status.contactId : String(p.row), p])).values()]
    const original = targets[index]
    return !original || row.action !== (original.status.kind === 'new' ? 'create' : 'merge') || original.status.kind === 'merge' && row.targetId !== original.status.contactId
  }))) failure(preview.rows.flatMap(r => r.errors.map(e => e.message)).join(' ') || 'Os contatos mudaram. Atualize a lista e revise o arquivo novamente.')
  if (preview) journal.acknowledgePreview(preview.fingerprint, s.context.assertCurrent)
  let attempt = prior, busy = false
  return {
    async commit() {
      s.context.assertCurrent()
      if (busy) failure('Aguarde a confirmação da importação.')
      busy = true
      try {
        const recovering = !!attempt
        if (!attempt) {
          attempt = { key: crypto.randomUUID(), optionsDigest: digest, previewFingerprint: preview!.fingerprint }
          journal.reserve(attempt, s.context.assertCurrent)
        }
        const operation = recovering ? await api.operation(attempt.key) : (await api.commit(options, attempt.previewFingerprint, attempt.key)).operation
        s.context.assertCurrent()
        // Keep the reference until the refreshed data is visible, including a lost read after a successful import.
        await loadContacts(s.context)
        journal.archive(attempt, s.context.assertCurrent)
        return { created: operation.result.summary.create, updated: operation.result.summary.merge, skipped: plan.filter(p => p.status.kind === 'skip').length }
      } finally { busy = false }
    },
  }
}

/** "Bloquear contato" / "WhatsApp IA": grava no motor (o motor deixa de atender, responder e ligar para números bloqueados); o estado confirmado pelo motor vai ao snapshot. */
export async function setContactCommunication(id: string, patch: { blocked?: boolean; whatsappAi?: boolean }) {
  const s = current('contacts:write')
  const row = await s.context.request<{ contactId?: unknown; blocked?: unknown; whatsappAi?: unknown }>(`/crm/contacts/${encodeURIComponent(id)}/communication`, { method: 'PUT', body: patch })
  s.context.assertCurrent()
  // Resposta fora do formato esperado: relê do motor em vez de supor o estado.
  if (row?.contactId !== id || typeof row.blocked !== 'boolean' || typeof row.whatsappAi !== 'boolean') { await loadContacts(s.context); return }
  s.comm.set(id, { blocked: row.blocked, whatsappAi: row.whatsappAi }); s.commMarks.set(id, ++tick)
  publish(s.context)
}

/** Consentimento (LGPD) por destino do contato: estado atual e registro de nova decisão com evidência. */
export async function loadContactPermissions(id: string) {
  const context = captureEngineContext('contacts:read')
  const state = await createCRMClient(context).permissions(id); context.assertCurrent()
  return state
}
export async function recordContactPermission(id: string, input: PermissionInput) {
  const s = current('contacts:consent'), contact = s.contacts.get(id)
  if (!contact) return failure('Atualize o contato antes de registrar o consentimento.')
  if (!input.source.trim()) failure('Informe como a pessoa deu ou retirou o consentimento.')
  const result = await s.api.recordPermission(contact, input, crypto.randomUUID()); s.context.assertCurrent()
  await loadContacts(s.context)
  return result
}
