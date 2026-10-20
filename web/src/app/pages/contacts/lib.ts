import { useMemo, useSyncExternalStore } from 'react'
import type { Contact, ContactHistoryEvent, Conversation, ProductKey, SmartFieldDef, Subscription } from '@/domain/types'
import '@/domain/ext/inbox-contacts'
import { useCollection, useStore } from '@/data/store'
import { orgPlanLimit, planOf } from '@/data/catalogs/plans'
import { phoneKey } from '../inbox/shared'

export type PhoneLabel = Contact['phones'][number]['label']
export const LABEL_OPTIONS: { value: PhoneLabel; label: string }[] = [
  { value: '', label: '—' },
  { value: 'HOME', label: 'Casa' },
  { value: 'WORK', label: 'Trabalho' },
  { value: 'OTHER', label: 'Outro' },
]
export const labelText = (l: PhoneLabel) => LABEL_OPTIONS.find((o) => o.value === l)?.label ?? '—'

export const SOURCE_LABEL: Record<Contact['source'], string> = { manual: 'Manual', import: 'Importação', conversation: 'Conversa', legacy: 'Cadastro anterior' }
export const FIELD_TYPE_LABEL: Record<SmartFieldDef['type'], string> = { text: 'Texto', number: 'Número', boolean: 'Sim / Não', enum: 'Escolha' }

export const fullName = (c: Pick<Contact, 'firstName' | 'lastName'>) => `${c.firstName} ${c.lastName}`.trim()
export const contactInitials = (c: Pick<Contact, 'firstName' | 'lastName'>) =>
  ((c.firstName.trim()[0] ?? '') + (c.lastName.trim()[0] ?? '')).toUpperCase() || '?'

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
/** Minúsculas sem acentos (busca "joao" encontra "João"). */
export const foldText = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
/** Telefone "vazio" = só o código do país (ex.: "+55") ou nada. */
export const isBlankPhone = (v: string) => v.replace(/\D/g, '').length <= 3 && !v.replace(/^\+\d{0,3}\s*/, '').trim()
export const isValidPhone = (v: string) => v.replace(/\D/g, '').length >= 10

/* -------------------------- estado de visão da lista -------------------------- */

export type ContactSort = 'name_asc' | 'name_desc' | 'recent' | 'updated'
export const SORT_LABEL: Record<ContactSort, string> = { name_asc: 'Nome (A–Z)', name_desc: 'Nome (Z–A)', recent: 'Mais recentes', updated: 'Atualizados recentemente' }

export interface ContactFilters {
  company: string // '' = todas; '__none' = sem empresa
  owner: string // '' = todos; '__none' = sem responsável
  source: '' | Contact['source']
  field: string // '' = qualquer; id do campo inteligente que precisa estar preenchido
  comm: '' | 'blocked' | 'no_whatsapp' // configurações de comunicação
}
export const EMPTY_CONTACT_FILTERS: ContactFilters = { company: '', owner: '', source: '', field: '', comm: '' }

interface ViewState {
  query: string
  sort: ContactSort
  filters: ContactFilters
}
/*
 * A busca digitada vale para a sessão (módulo); ordenação e filtros são preferências persistidas em `ui.contacts`.
 * Filtros são guardados POR ORGANIZAÇÃO (`filtersByOrg[orgId]`): empresa, responsável e campo inteligente só
 * existem dentro da própria org, então um filtro de outra org nunca esconde contatos.
 */
let query = ''
const subs = new Set<() => void>()
const SOURCES = new Set(['', 'manual', 'import', 'conversation'])
const COMMS = new Set(['', 'blocked', 'no_whatsapp'])
function sanitizeFilters(f?: Partial<Record<keyof ContactFilters, string>>): ContactFilters {
  const s = (v: unknown) => (typeof v === 'string' ? v : '')
  return {
    company: s(f?.company),
    owner: s(f?.owner),
    source: (SOURCES.has(s(f?.source)) ? s(f?.source) : '') as ContactFilters['source'],
    field: s(f?.field),
    comm: (COMMS.has(s(f?.comm)) ? s(f?.comm) : '') as ContactFilters['comm'],
  }
}
export function setContactsView(p: Partial<ViewState>) {
  if (p.query !== undefined) {
    query = p.query
    subs.forEach((s) => s())
  }
  if (p.sort !== undefined || p.filters !== undefined) {
    const st = useStore.getState()
    const orgId = st.db.session.orgId
    // descarta o formato legado (filtros globais, sem organização)
    const { filters: _legacy, ...cur } = st.db.ui.contacts ?? {}
    const byOrg = { ...(cur.filtersByOrg ?? {}) }
    if (p.filters !== undefined && orgId) {
      if (countContactFilters(p.filters)) byOrg[orgId] = { ...p.filters }
      else delete byOrg[orgId]
    }
    st.setUi({ contacts: { ...cur, ...(p.sort !== undefined ? { sort: p.sort } : {}), filtersByOrg: byOrg } })
  }
}
export function useContactsView(): ViewState {
  const q = useSyncExternalStore(
    (cb) => {
      subs.add(cb)
      return () => subs.delete(cb)
    },
    () => query,
  )
  const prefs = useStore((s) => s.db.ui.contacts)
  const orgId = useStore((s) => s.db.session.orgId)
  return useMemo(() => {
    const sort = prefs?.sort && prefs.sort in SORT_LABEL ? prefs.sort : 'name_asc'
    return { query: q, sort, filters: sanitizeFilters(orgId ? prefs?.filtersByOrg?.[orgId] : undefined) }
  }, [q, prefs, orgId])
}
export function countContactFilters(f: ContactFilters) {
  return Object.values(f).filter(Boolean).length
}

/**
 * Remove dos filtros os valores que não existem mais entre as opções atuais (empresa sem contatos, membro removido,
 * campo inteligente excluído). `'__none'` (sem empresa / sem responsável) é sempre válido.
 */
export function pruneContactFilters(f: ContactFilters, opts: { companies: string[]; memberIds: string[]; fieldIds: string[] }): ContactFilters {
  const keep = (v: string, list: string[]) => (!v || v === '__none' || list.includes(v) ? v : '')
  return {
    ...f,
    company: keep(f.company, opts.companies),
    owner: keep(f.owner, opts.memberIds),
    field: f.field && opts.fieldIds.includes(f.field) ? f.field : '',
  }
}

/**
 * Nome exibido — regra ÚNICA para lista, detalhe, formulário, avisos e confirmações:
 * nome completo, ou telefone, ou e-mail (contatos importados só com e-mail).
 */
export const displayName = (c: Pick<Contact, 'firstName' | 'lastName' | 'phones' | 'emails'>) => fullName(c) || c.phones[0]?.value || c.emails[0]?.value || 'Contato sem nome'

/** WhatsApp AI efetivamente desligado: desativado no contato ou indisponível por bloqueio (igual ao interruptor do detalhe). */
export const whatsappAiOff = (c: Pick<Contact, 'whatsappAi' | 'blocked'>) => c.whatsappAi === false || !!c.blocked

/* --------------------------- campos inteligentes --------------------------- */

/**
 * Número em formato pt-BR ("1.500,5", "1500,5", "1.500") ou com ponto decimal ("1500.5"). `NaN` se inválido.
 */
export function parseNumberBR(raw: string): number {
  const v = raw.trim().replace(/\s/g, '')
  if (!v) return NaN
  if (/^[-+]?\d{1,3}(\.\d{3})+(,\d+)?$/.test(v)) return Number(v.replace(/\./g, '').replace(',', '.'))
  if (/^[-+]?\d+(,\d+)?$/.test(v)) return Number(v.replace(',', '.'))
  if (/^[-+]?\d*\.\d+$|^[-+]?\d+$/.test(v)) return Number(v)
  return NaN
}

/** O valor armazenado é compatível com o tipo atual do campo? (vazio é sempre compatível) */
export function isFieldValueCompatible(def: Pick<SmartFieldDef, 'type' | 'options'>, raw: string | undefined) {
  const v = (raw ?? '').trim()
  if (!v) return true
  if (def.type === 'number') return !Number.isNaN(parseNumberBR(v))
  if (def.type === 'boolean') return v === 'Sim' || v === 'Não'
  if (def.type === 'enum') return (def.options ?? []).map((o) => o.trim()).includes(v)
  return true
}

const YES = new Set(['sim', 's', 'true', 'verdadeiro', 'yes', '1']), NO = new Set(['não', 'nao', 'n', 'false', 'falso', 'no', '0'])
/**
 * O valor salvo (`raw`, como exibido) cabe no campo depois da edição (`before` → `after`)? Mesma regra do motor
 * (engine/src/crm/service.ts fitFieldValue/convertFieldValue; paridade em tests/contact-field-compat-parity.test.ts):
 * troca de tipo só mantém o que converte sem perda; sem troca, Escolha exige opção ativa. Sem valor salvo, sempre cabe.
 */
export function fieldValueFits(before: Pick<SmartFieldDef, 'type' | 'options'> | undefined, after: Pick<SmartFieldDef, 'type' | 'options'>, raw: string | undefined) {
  if (raw === undefined) return true
  if (!before || before.type === after.type) return isFieldValueCompatible(after, raw)
  const v = raw.trim(), key = v.toLocaleLowerCase('pt-BR')
  if (!v) return false
  if (after.type === 'text') return true
  if (after.type === 'boolean') return YES.has(key) || NO.has(key)
  if (after.type === 'number') {
    const n = /^-?\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(v) ? v.replace(/\./g, '').replace(',', '.') : v.replace(',', '.')
    return /^-?(?:0|[1-9]\d*)(?:\.\d{1,12})?$/.test(n) && n.replace(/\D/g, '').length <= 38
  }
  return (after.options ?? []).some((o) => o.trim().toLocaleLowerCase('pt-BR') === key)
}

/* ------------------------------ cota do plano ------------------------------ */

/**
 * "Contatos inclusos" da tabela comparativa pública (Solo 1.000 · Team 3.000 · Scale personalizado) —
 * referência [279]; complemento "1.000 contatos por R$120/mês" em [284].
 * Fonte única: `limits.contacts` do catálogo de planos (src/data/catalogs/plans.ts) pela regra da organização
 * `orgPlanLimit` (maior valor entre as assinaturas ativas que definem a chave; INFERIDO) — a mesma cota em Visão geral › Uso,
 * Contatos (alerta de cota), Importação e formulário. `Infinity` = Personalizado (Scale). Sem nenhum plano que defina a chave
 * (ex.: só E-Mail IA, ou sem assinatura), vale o mínimo público de 1.000.
 */
export const DEFAULT_CONTACT_QUOTA = 1000

export interface ContactQuota {
  limit: number // Infinity = personalizado
  used: number
  remaining: number
  reached: boolean
  planName: string
  product: ProductKey | null
}

export function contactQuota(subs: Subscription[], used: number): ContactQuota {
  const fromCatalog = orgPlanLimit(subs, 'contacts')
  const limit = typeof fromCatalog === 'number' && !Number.isNaN(fromCatalog) && fromCatalog >= 0 ? fromCatalog : DEFAULT_CONTACT_QUOTA
  // Plano que concede a cota (empate: prioridade ao Assistente telefônico IA), para as mensagens "limite do plano X".
  const granting = subs
    .filter((s) => s.status === 'active' && planOf(s.product, s.plan)?.limits.contacts === limit)
    .sort((a, b) => Number(b.product === 'voice') - Number(a.product === 'voice'))[0]
  const planName = granting ? planOf(granting.product, granting.plan)?.name ?? granting.plan : 'atual'
  const remaining = Math.max(0, limit - used)
  return { limit, used, remaining, reached: used >= limit, planName, product: granting?.product ?? null }
}

export function useContactQuota(used: number) {
  // The API is authoritative. The shell's inferred 1,000-contact plan is not an entitlement.
  return useMemo((): ContactQuota => ({ limit: Infinity, used, remaining: Infinity, reached: false, planName: '', product: null }), [used])
}

export const formatInt = (n: number) => n.toLocaleString('pt-BR')

/** Chave de ordenação por nome: nomes iniciados por letra (0), demais nomes (1), sem nome (2) — grupo "#" no fim do A–Z. */
const nameRank = (c: Contact) => {
  const n = fullName(c)
  if (!n) return 2
  return /[a-z]/.test(foldText(n[0]!)) ? 0 : 1
}
export const groupKeyOf = (c: Contact) => {
  const ch = foldText(fullName(c)[0] ?? '#').toUpperCase()
  return /[A-Z]/.test(ch) ? ch : '#'
}

export function applyContactView(list: Contact[], v: ViewState) {
  const q = foldText(v.query.trim())
  const qd = q.replace(/\D/g, '')
  const f = v.filters
  const out = list.filter((c) => {
    if (f.company && (f.company === '__none' ? c.company.trim() !== '' : c.company !== f.company)) return false
    if (f.owner && (f.owner === '__none' ? !!c.ownerId : c.ownerId !== f.owner)) return false
    if (f.source && c.source !== f.source) return false
    if (f.field && !(c.fields[f.field] ?? '').trim()) return false
    if (f.comm === 'blocked' && !c.blocked) return false
    if (f.comm === 'no_whatsapp' && !whatsappAiOff(c)) return false
    if (!q) return true
    if (foldText(fullName(c)).includes(q)) return true
    if (c.emails.some((e) => foldText(e.value).includes(q))) return true
    if (foldText(c.company).includes(q)) return true
    if (qd.length >= 3 && c.phones.some((p) => p.value.replace(/\D/g, '').includes(qd))) return true
    return false
  })
  const byName = (a: Contact, b: Contact) => nameRank(a) - nameRank(b) || displayName(a).localeCompare(displayName(b), 'pt-BR', { sensitivity: 'base' })
  out.sort((a, b) => {
    switch (v.sort) {
      case 'name_desc':
        return -byName(a, b)
      case 'recent':
        return b.createdAt.localeCompare(a.createdAt)
      case 'updated':
        return (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt)
      default:
        return byName(a, b)
    }
  })
  return out
}

/** Conversas vinculadas a um contato (vínculo explícito ou telefone igual). */
export function conversationsOf(contact: Contact, conversations: Conversation[]) {
  const keys = new Set(contact.phones.map((p) => phoneKey(p.value)).filter((k) => k.length >= 8))
  return conversations
    .filter((c) => c.contactId === contact.id || (c.callerNumber && keys.has(phoneKey(c.callerNumber))))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}

/* --------------------------------- importação --------------------------------- */

export type ImportTarget = 'ignore' | 'firstName' | 'lastName' | 'fullName' | 'phone' | 'email' | 'company' | 'notes' | `field:${string}`
export const BASE_TARGETS: { value: ImportTarget; label: string; multi?: boolean }[] = [
  { value: 'ignore', label: 'Ignorar coluna', multi: true },
  { value: 'firstName', label: 'Nome' },
  { value: 'lastName', label: 'Sobrenome' },
  { value: 'fullName', label: 'Nome completo' },
  { value: 'phone', label: 'Telefone', multi: true },
  { value: 'email', label: 'E-mail', multi: true },
  { value: 'company', label: 'Empresa' },
  { value: 'notes', label: 'Notas' },
]

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()

export function autoMap(headers: string[], fields: SmartFieldDef[]): ImportTarget[] {
  const used = new Set<string>()
  const hasLast = headers.some((h) => /^(sobrenome|last name|lastname|surname)$/.test(norm(h)))
  return headers.map((h) => {
    const n = norm(h)
    let t: ImportTarget = 'ignore'
    if (/^(nome completo|full name|fullname|name)$/.test(n)) t = 'fullName'
    else if (/^(nome|primeiro nome|first name|firstname)$/.test(n)) t = hasLast ? 'firstName' : 'fullName'
    else if (/^(sobrenome|last name|lastname|surname)$/.test(n)) t = 'lastName'
    else if (/(telefone|celular|fone|phone|whatsapp|tel)/.test(n)) t = 'phone'
    else if (/(e ?mail)/.test(n)) t = 'email'
    else if (/^(empresa|company|organizacao|organization)$/.test(n)) t = 'company'
    else if (/^(notas|nota|observacoes|observacao|obs|notes)$/.test(n)) t = 'notes'
    else {
      const f = fields.find((x) => norm(x.label) === n)
      if (f) t = `field:${f.id}`
    }
    const multi = BASE_TARGETS.find((b) => b.value === t)?.multi
    if (!multi && used.has(t)) t = 'ignore'
    used.add(t)
    return t
  })
}

export function normalizeImportPhone(v: string) {
  const s = v.trim()
  if (!s) return ''
  if (s.startsWith('+')) return s
  const d = s.replace(/\D/g, '')
  if (d.length === 10 || d.length === 11) return `+55 ${d.slice(0, 2)} ${d.slice(2, d.length - 4)}-${d.slice(-4)}`
  if (d.length >= 12) return `+${d}`
  return s
}

export interface ImportRecord {
  firstName: string
  lastName: string
  phones: string[]
  emails: string[]
  company: string
  notes: string
  fields: Record<string, string>
}

export type PlanStatus = { kind: 'new' } | { kind: 'merge'; contactId: string; name: string } | { kind: 'merge_file'; row: number } | { kind: 'skip'; reason: string; quota?: boolean }

export interface PlanRow {
  row: number // número da linha no CSV (1 = cabeçalho)
  record: ImportRecord
  status: PlanStatus
  warnings: string[]
}

/** `remaining` = contatos novos que ainda cabem na cota do plano (linhas novas excedentes são ignoradas). */
export function buildPlan(rows: string[][], mapping: ImportTarget[], existing: Contact[], remaining = Infinity) {
  const plan: PlanRow[] = []
  const phoneIndex = new Map<string, { kind: 'contact'; id: string; name: string } | { kind: 'row'; row: number }>()
  const emailIndex = new Map<string, { kind: 'contact'; id: string; name: string } | { kind: 'row'; row: number }>()
  for (const c of existing) {
    const ref = { kind: 'contact' as const, id: c.id, name: displayName(c) }
    c.phones.forEach((p) => phoneKey(p.value).length >= 8 && phoneIndex.set(phoneKey(p.value), ref))
    c.emails.forEach((e) => e.value && emailIndex.set(e.value.trim().toLowerCase(), ref))
  }
  let newCount = 0
  rows.forEach((cells, i) => {
    const rec: ImportRecord = { firstName: '', lastName: '', phones: [], emails: [], company: '', notes: '', fields: {} }
    const warnings: string[] = []
    mapping.forEach((t, col) => {
      const raw = (cells[col] ?? '').trim()
      if (!raw || t === 'ignore') return
      if (t === 'firstName') rec.firstName = raw
      else if (t === 'lastName') rec.lastName = raw
      else if (t === 'fullName') {
        const [first, ...rest] = raw.split(/\s+/)
        if (!rec.firstName) rec.firstName = first ?? ''
        if (!rec.lastName) rec.lastName = rest.join(' ')
      } else if (t === 'phone') {
        raw.split(/[|/,]/).map((x) => x.trim()).filter(Boolean).forEach((p) => {
          const v = normalizeImportPhone(p)
          if (v.replace(/\D/g, '').length >= 10) rec.phones.push(v)
          else warnings.push(`Telefone inválido ignorado: ${p}`)
        })
      } else if (t === 'email') {
        raw.split(/[|,;\s]+/).filter(Boolean).forEach((e) => {
          if (EMAIL_RE.test(e)) rec.emails.push(e.toLowerCase())
          else warnings.push(`E-mail inválido ignorado: ${e}`)
        })
      } else if (t === 'company') rec.company = raw
      else if (t === 'notes') rec.notes = raw
      else if (t.startsWith('field:')) rec.fields[t.slice(6)] = raw
    })
    const rowNo = i + 2
    // Central de ajuda › Contatos: cada contato precisa ser identificável por telefone ou e-mail.
    if (rec.phones.length === 0 && rec.emails.length === 0) {
      plan.push({ row: rowNo, record: rec, status: { kind: 'skip', reason: 'Sem telefone nem e-mail' }, warnings })
      return
    }
    let hit: ReturnType<typeof phoneIndex.get>
    for (const p of rec.phones) hit = hit ?? phoneIndex.get(phoneKey(p))
    for (const e of rec.emails) hit = hit ?? emailIndex.get(e)
    let status: PlanStatus
    if (hit?.kind === 'contact') status = { kind: 'merge', contactId: hit.id, name: hit.name }
    else if (hit?.kind === 'row') status = { kind: 'merge_file', row: hit.row }
    else if (newCount >= remaining) {
      plan.push({ row: rowNo, record: rec, status: { kind: 'skip', reason: 'Limite de contatos do plano', quota: true }, warnings })
      return
    } else {
      status = { kind: 'new' }
      newCount++
    }
    const ref = hit ?? { kind: 'row' as const, row: rowNo }
    rec.phones.forEach((p) => !phoneIndex.has(phoneKey(p)) && phoneIndex.set(phoneKey(p), ref))
    rec.emails.forEach((e) => !emailIndex.has(e) && emailIndex.set(e, ref))
    plan.push({ row: rowNo, record: rec, status, warnings })
  })
  const created = plan.filter((p) => p.status.kind === 'new').length
  const updatedIds = new Set(plan.flatMap((p) => (p.status.kind === 'merge' ? [p.status.contactId] : [])))
  const skipped = plan.filter((p) => p.status.kind === 'skip').length
  const mergedInFile = plan.filter((p) => p.status.kind === 'merge_file').length
  const overQuota = plan.filter((p) => p.status.kind === 'skip' && p.status.quota).length
  return { plan, counts: { created, updated: updatedIds.size, skipped, mergedInFile, overQuota } }
}

export type MergePolicy = 'keep' | 'overwrite'

/**
 * Mescla um registro importado em um contato existente. Telefones e e-mails são SEMPRE mesclados (nunca substituídos).
 * Demais campos: "Manter existentes" só preenche vazios; "Sobrescrever" substitui pelos valores do CSV (quando presentes).
 */
export function mergeInto(c: Contact, r: ImportRecord, policy: MergePolicy = 'keep'): Contact {
  const pick = (cur: string, inc: string) => (policy === 'overwrite' ? inc || cur : cur || inc)
  const phones = [...c.phones]
  r.phones.forEach((p) => !phones.some((x) => phoneKey(x.value) === phoneKey(p)) && phones.push({ value: p, label: '' }))
  const emails = [...c.emails]
  r.emails.forEach((e) => !emails.some((x) => x.value.toLowerCase() === e) && emails.push({ value: e, label: '' }))
  const fields = { ...c.fields }
  Object.entries(r.fields).forEach(([k, v]) => {
    if (policy === 'overwrite' || !(fields[k] ?? '').trim()) fields[k] = v
  })
  return {
    ...c,
    firstName: pick(c.firstName, r.firstName),
    lastName: pick(c.lastName, r.lastName),
    company: pick(c.company, r.company),
    notes: pick(c.notes, r.notes),
    phones,
    emails,
    fields,
    updatedAt: new Date().toISOString(),
  }
}

/* ------------------------- histórico do contato ------------------------- */

/**
 * Histórico do contato (ícone "histórico" ao lado do título na captura CO-01 da Central de ajuda). Os eventos são
 * gravados pelas ações locais; contatos antigos sem registro recebem o evento de criação derivado de `createdAt`/`source`.
 */
export const HISTORY_LABEL: Record<ContactHistoryEvent['kind'], string> = {
  created: 'Contato criado',
  updated: 'Contato editado',
  imported: 'Atualizado pela importação',
  blocked: 'Contato bloqueado',
  unblocked: 'Contato desbloqueado',
  whatsapp_on: 'WhatsApp IA ativado',
  whatsapp_off: 'WhatsApp IA desativado',
}

export function historyEvent(kind: ContactHistoryEvent['kind'], by: string, fields?: string[]): ContactHistoryEvent {
  return { at: new Date().toISOString(), by, kind, ...(fields?.length ? { fields } : {}) }
}

/** Eventos em ordem decrescente; inclui a criação derivada quando o contato não tem registro dela. */
export function contactHistory(c: Contact): ContactHistoryEvent[] {
  const list = [...(c.history ?? [])]
  if (!list.some((e) => e.kind === 'created' || (e.kind === 'imported' && !e.fields?.length))) {
    list.push({ at: c.createdAt, by: c.source === 'import' ? 'Importação de CSV' : c.source === 'conversation' ? 'Conversa (captura automática)' : 'Equipe', kind: c.source === 'import' ? 'imported' : 'created' })
  }
  return list.sort((a, b) => b.at.localeCompare(a.at))
}

/** Rótulos dos campos que mudaram entre o contato salvo e os dados do formulário. */
export function changedFieldLabels(
  before: Pick<Contact, 'firstName' | 'lastName' | 'phones' | 'emails' | 'company' | 'notes' | 'fields'> & { ownerId?: string },
  after: Partial<Pick<Contact, 'firstName' | 'lastName' | 'phones' | 'emails' | 'company' | 'notes' | 'fields'>> & { ownerId?: string },
  smartFields: SmartFieldDef[],
) {
  const out: string[] = []
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? '') === JSON.stringify(b ?? '')
  if ('firstName' in after && !same(before.firstName, after.firstName)) out.push('Nome')
  if ('lastName' in after && !same(before.lastName, after.lastName)) out.push('Sobrenome')
  if ('phones' in after && !same(before.phones, after.phones)) out.push('Telefones')
  if ('emails' in after && !same(before.emails, after.emails)) out.push('E-mails')
  if ('company' in after && !same(before.company, after.company)) out.push('Empresa')
  if ('ownerId' in after && !same(before.ownerId, after.ownerId)) out.push('Responsável')
  if ('notes' in after && !same(before.notes, after.notes)) out.push('Notas')
  if (after.fields) {
    for (const f of smartFields) if (!same(before.fields?.[f.id], after.fields[f.id])) out.push(f.label)
  }
  return out
}
