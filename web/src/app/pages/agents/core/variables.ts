import type { Agent, BusinessHours, GreetingRule, SmartFieldDef } from '@/domain/types'
import { smartFieldKey } from '../resources/shared/variables'

/**
 * Variáveis inseríveis nas mensagens (menu "Adicionar variável", spec 06 [484]/[492]) e
 * campos de condição das regras da mensagem inicial (spec 06 [490]/[491]).
 * Sintaxe armazenada: {{chave}} — exibida como chip "Grupo: Campo".
 */
export interface VariableDef {
  key: string
  label: string
  group?: 'Contato'
  /** "?" = pode estar vazio na conversa */
  optional?: boolean
  description: string
}

/** OBSERVADO (fonio-live2/data/initial-message.json → variablesPopover): rótulos, ordem e textos do ⓘ. */
export const VARIABLES: VariableDef[] = [
  { key: 'agent.name', label: 'Assistente: Nome', description: 'O nome de exibição do assistente.' },
  { key: 'company.name', label: 'Empresa: Nome', description: 'O nome da empresa.' },
  { key: 'contact.company', label: 'Contato: Empresa', group: 'Contato', optional: true, description: 'Empresa à qual o contato pertence' },
  { key: 'contact.emails', label: 'Contato: Endereços de e-mail', group: 'Contato', optional: true, description: 'Todos os endereços de e-mail do contato' },
  { key: 'contact.firstName', label: 'Contato: Nome', group: 'Contato', optional: true, description: 'Primeiro nome do contato identificado' },
  { key: 'contact.phones', label: 'Contato: Números de telefone', group: 'Contato', optional: true, description: 'Todos os números de telefone do contato' },
  { key: 'contact.lastName', label: 'Contato: Sobrenome', group: 'Contato', optional: true, description: 'Sobrenome do contato identificado' },
]

/** Tooltip do "?" (variável/condição que pode estar vazia) — OBSERVADO. */
export const CONTACT_OPTIONAL_NOTE = 'Vazio se nenhum contato foi reconhecido ou este campo do contato não está preenchido.'

/**
 * Campos inteligentes de Contatos (Configurações de contatos / "Conectar contatos") como variáveis "Contato: <campo>",
 * no mesmo formato de chave dos menus de e-mail e webhooks: {{contact.smart.<id>}}.
 */
export function smartVariables(fields: Pick<SmartFieldDef, 'id' | 'label' | 'description'>[]): VariableDef[] {
  return fields.map((f) => ({
    key: smartFieldKey(f.id),
    label: `Contato: ${f.label}`,
    group: 'Contato' as const,
    optional: true,
    description: f.description || 'Campo inteligente do contato.',
  }))
}

/** Rótulo do chip; `extra` = variáveis dinâmicas (campos inteligentes). Campo inteligente excluído → "Contato: campo removido". */
export function variableLabel(key: string, extra: VariableDef[] = []) {
  const found = VARIABLES.find((v) => v.key === key) ?? extra.find((v) => v.key === key)
  if (found) return found.label
  return key.startsWith('contact.smart.') ? 'Contato: campo removido' : key
}

export type ConditionKind = 'text' | 'list' | 'boolean' | 'direction' | 'time' | 'period'

export interface ConditionFieldDef {
  key: string
  label: string
  /** rótulo na pílula da condição */
  shortLabel: string
  kind: ConditionKind
  /** "?" — quando a condição pode estar vazia (texto do tooltip) */
  optional?: string
  /** texto do ⓘ */
  description: string
}

/**
 * Os 10 campos do menu "+ Adicionar condição" (OBSERVADO: fonio-live2/data/initial-message.json → conditionMenu.fields), na ordem,
 * com o "?" (pode estar vazio), o ⓘ, os operadores e a pílula padrão de cada um.
 */
export const CONDITION_FIELDS: ConditionFieldDef[] = [
  { key: 'caller.phone', label: 'Interlocutor: Número de telefone', shortLabel: 'Interlocutor: Número de telefone', kind: 'text', optional: 'Vazio para chamadas web.', description: 'O número de telefone do interlocutor.' },
  { key: 'call.period', label: 'Chamada: Período', shortLabel: 'Período', kind: 'period', description: 'Esta mensagem é usada nas chamadas que começam neste período, no fuso horário da sua empresa. O início está incluído; o fim, não.' },
  { key: 'call.timeOfDay', label: 'Chamada: Hora do dia', shortLabel: 'Hora do dia', kind: 'time', description: 'O horário local em que a chamada começa.' },
  { key: 'call.withinBusinessHours', label: 'Chamada: Dentro do horário de funcionamento', shortLabel: 'Dentro do horário de funcionamento', kind: 'boolean', optional: 'Desconhecido até você definir o horário de funcionamento.', description: 'Se a chamada está dentro do seu horário de funcionamento.' },
  { key: 'call.direction', label: 'Chamada: Direção da chamada', shortLabel: 'Direção da chamada', kind: 'direction', description: 'Se a chamada é recebida ou efetuada.' },
  { key: 'contact.firstName', label: 'Contato: Nome', shortLabel: 'Nome', kind: 'text', optional: CONTACT_OPTIONAL_NOTE, description: 'Primeiro nome do contato identificado' },
  { key: 'contact.lastName', label: 'Contato: Sobrenome', shortLabel: 'Sobrenome', kind: 'text', optional: CONTACT_OPTIONAL_NOTE, description: 'Sobrenome do contato identificado' },
  { key: 'contact.company', label: 'Contato: Empresa', shortLabel: 'Empresa', kind: 'text', optional: CONTACT_OPTIONAL_NOTE, description: 'Empresa à qual o contato pertence' },
  { key: 'contact.phones', label: 'Contato: Números de telefone', shortLabel: 'Números de telefone', kind: 'list', optional: CONTACT_OPTIONAL_NOTE, description: 'Todos os números de telefone do contato' },
  { key: 'contact.emails', label: 'Contato: Endereços de e-mail', shortLabel: 'Endereços de e-mail', kind: 'list', optional: CONTACT_OPTIONAL_NOTE, description: 'Todos os endereços de e-mail do contato' },
]

export type ConditionOperator = 'is' | 'is_not' | 'contains' | 'is_set' | 'is_empty' | 'is_any_of' | 'after' | 'before' | 'within'

export const OPERATOR_LABEL: Record<ConditionOperator, string> = {
  is: 'é',
  is_not: 'não é',
  contains: 'contém',
  is_set: 'está preenchido',
  is_empty: 'não está preenchido',
  is_any_of: 'é qualquer um de',
  after: 'é depois de',
  before: 'é antes de',
  within: 'está dentro de',
}

/** Operadores por tipo de campo, na ordem do menu (OBSERVADO). */
export const OPERATORS: Record<ConditionKind, ConditionOperator[]> = {
  text: ['is', 'is_not', 'contains', 'is_set', 'is_empty'],
  list: ['contains', 'is_set', 'is_empty'],
  period: ['within'],
  time: ['after', 'before', 'within'],
  boolean: ['is', 'is_set', 'is_empty'],
  direction: ['is', 'is_not', 'is_any_of', 'is_set', 'is_empty'],
}

/** Valores fixos dos campos de escolha (OBSERVADO: "sim/não"; "Chamada recebida/Chamada efetuada"). */
export const CONDITION_VALUES: Partial<Record<ConditionKind, { value: string; label: string }[]>> = {
  boolean: [
    { value: 'yes', label: 'sim' },
    { value: 'no', label: 'não' },
  ],
  direction: [
    { value: 'inbound', label: 'Chamada recebida' },
    { value: 'outbound', label: 'Chamada efetuada' },
  ],
}

export const needsValue = (op: string) => op !== 'is_set' && op !== 'is_empty'

export const conditionField = (key: string) => CONDITION_FIELDS.find((f) => f.key === key)
export const conditionKind = (key: string): ConditionKind => conditionField(key)?.kind ?? 'text'

type Cond = GreetingRule['conditions'][number]

const pad = (n: number) => String(n).padStart(2, '0')
const localStamp = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
const nextDay = (ymd: string) => {
  const d = new Date(`${ymd}T00:00`)
  d.setDate(d.getDate() + 1)
  return localStamp(d).slice(0, 10)
}

/** Pílula padrão ao adicionar um campo (OBSERVADO: "está preenchido", "é sim", "é Chamada recebida", "é depois de 09:00", hoje 00:00–amanhã 00:00). */
export function defaultCondition(field: string, now = new Date()): Cond {
  const kind = conditionKind(field)
  if (kind === 'period') {
    const today = localStamp(now).slice(0, 10)
    return { field, operator: 'within', value: `${today}T00:00|${nextDay(today)}T00:00` }
  }
  if (kind === 'time') return { field, operator: 'after', value: '09:00' }
  if (kind === 'boolean') return { field, operator: 'is', value: 'yes' }
  if (kind === 'direction') return { field, operator: 'is', value: 'inbound' }
  return { field, operator: 'is_set', value: '' }
}

/** Valor inicial ao trocar o operador da pílula. */
export function valueForOperator(field: string, op: ConditionOperator, prev: Cond): string {
  const kind = conditionKind(field)
  if (!needsValue(op)) return ''
  if (kind === 'time') {
    if (op === 'within') return prev.value.includes('-') ? prev.value : `${prev.value || '09:00'}-18:00`
    return prev.value.split('-')[0] || '09:00'
  }
  if (kind === 'boolean') return prev.value === 'no' ? 'no' : 'yes'
  if (kind === 'direction') return op === 'is_any_of' ? prev.value || 'inbound' : (prev.value.split(',')[0] ?? '') || 'inbound'
  return prev.operator && needsValue(prev.operator) ? prev.value : ''
}

/** Converte condições gravadas no formato antigo (é igual a / é verdadeiro / é entrada / é no dia…) para o atual. */
export function normalizeCondition(c: Cond): Cond {
  const kind = conditionKind(c.field)
  const op = c.operator
  const ops = OPERATORS[kind] as string[]
  if (ops.includes(op)) return c
  if (kind === 'boolean') return { ...c, operator: 'is', value: op === 'is_false' ? 'no' : 'yes' }
  if (kind === 'direction') return { ...c, operator: 'is', value: op === 'is_outbound' ? 'outbound' : 'inbound' }
  if (kind === 'period') {
    const d = /^\d{4}-\d{2}-\d{2}$/.test(c.value) ? c.value : localStamp(new Date()).slice(0, 10)
    if (op === 'before') return { ...c, operator: 'within', value: `1970-01-01T00:00|${d}T00:00` }
    if (op === 'after') return { ...c, operator: 'within', value: `${nextDay(d)}T00:00|9999-12-31T00:00` }
    return { ...c, operator: 'within', value: `${d}T00:00|${nextDay(d)}T00:00` }
  }
  if (op === 'equals') return { ...c, operator: kind === 'list' ? 'contains' : 'is' }
  if (op === 'starts_with') return { ...c, operator: 'contains' }
  return { ...c, operator: ops[0]!, value: needsValue(ops[0]!) ? c.value : '' }
}

/** Valor da pílula como exibido ("09:00", "sim", "Chamada recebida", "2026-10-19 00:00–2026-10-20 00:00"). */
export function conditionValueLabel(c: Cond): string {
  const kind = conditionKind(c.field)
  if (!needsValue(c.operator) || !c.value) return ''
  if (kind === 'period') return c.value.split('|').map((x) => x.replace('T', ' ')).join('–')
  if (kind === 'time' && c.operator === 'within') return c.value.split('-').join('–')
  const opts = CONDITION_VALUES[kind]
  if (opts) return c.value.split(',').map((v) => opts.find((o) => o.value === v)?.label ?? v).join(', ')
  return c.value
}

/** Condição cujo operador exige valor e está sem valor (ou com intervalo incompleto). */
export function conditionMissingValue(raw: Cond) {
  const c = normalizeCondition(raw)
  if (!needsValue(c.operator)) return false
  const kind = conditionKind(c.field)
  if (kind === 'period') {
    const [from, to] = c.value.split('|')
    return !from || !to
  }
  if (kind === 'time' && c.operator === 'within') {
    const [from, to] = c.value.split('-')
    return !from || !to
  }
  return !c.value.trim()
}

/** Mensagem da regra gerenciada pela Kloel (modo Automático): cumprimenta o contato pelo nome. */
export function autoRuleMessage(greeting: string) {
  const m = greeting.match(/^(Olá|Oi|Bom dia|Boa tarde|Boa noite)([,!.]?)\s*/i)
  if (m) return `${m[1]}, {{contact.firstName}}, ${greeting.slice(m[0].length)}`
  return `Olá, {{contact.firstName}}! ${greeting}`
}

/**
 * Substitui variáveis para uso em ligação/chat de teste. `values` (contexto de teste, contato de exemplo, valores padrão —
 * ver testContext.ts) tem prioridade; sem valor, a variável fica vazia (ex.: contato desconhecido).
 */
export function renderMessage(text: string, ctx: { agent: Pick<Agent, 'name'>; companyName: string; values?: Record<string, string> }) {
  return text
    .replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) => {
      if (ctx.values && Object.prototype.hasOwnProperty.call(ctx.values, key)) return ctx.values[key] ?? ''
      if (key === 'agent.name') return ctx.agent.name
      if (key === 'company.name') return ctx.companyName
      return ''
    })
    .replace(/\s+,/g, ',')
    .replace(/,\s*,/g, ',')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** Divide o texto em partes de texto e variáveis para exibição com chips. */
export function splitVariables(text: string): ({ type: 'text'; value: string } | { type: 'var'; key: string })[] {
  const out: ({ type: 'text'; value: string } | { type: 'var'; key: string })[] = []
  const re = /\{\{\s*([\w.]+)\s*\}\}/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ type: 'text', value: text.slice(last, m.index) })
    out.push({ type: 'var', key: m[1]! })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ type: 'text', value: text.slice(last) })
  return out
}

/** Contexto de uma chamada para avaliar as regras da mensagem inicial (na ligação de teste: contato desconhecido, chamada de entrada). */
export interface GreetingCallContext {
  now: Date
  direction: 'inbound' | 'outbound'
  callerPhone?: string
  contact?: Partial<Record<'firstName' | 'lastName' | 'company' | 'phones' | 'emails', string>>
  businessHours?: BusinessHours
}

/** Data (AAAA-MM-DD), hora (HH:MM) e dia da semana no fuso informado. */
function localParts(now: Date, timeZone?: string) {
  let tz = timeZone
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone: tz })
  } catch {
    tz = undefined
  }
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday ?? '')
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}`, weekday }
}

export function isWithinBusinessHours(bh: BusinessHours | undefined, now: Date) {
  if (!bh?.enabled) return false
  const { time, weekday } = localParts(now, bh.timezone)
  const day = bh.days.find((d) => d.day === weekday)
  return !!day?.enabled && day.ranges.some((r) => r.from <= time && time < r.to)
}

function conditionMatches(raw: GreetingRule['conditions'][number], ctx: GreetingCallContext) {
  const c = normalizeCondition(raw)
  const kind = conditionKind(c.field)
  const tz = ctx.businessHours?.timezone
  const local = localParts(ctx.now, tz)
  if (kind === 'boolean') {
    // desconhecido até definir o horário de funcionamento
    const known = !!ctx.businessHours?.enabled
    if (c.operator === 'is_set') return known
    if (c.operator === 'is_empty') return !known
    if (!known) return false
    const v = isWithinBusinessHours(ctx.businessHours, ctx.now)
    return c.value === 'no' ? !v : v
  }
  if (kind === 'direction') {
    if (c.operator === 'is_set') return true
    if (c.operator === 'is_empty') return false
    const wanted = c.value.split(',').filter(Boolean)
    if (c.operator === 'is_not') return !wanted.includes(ctx.direction)
    return wanted.includes(ctx.direction)
  }
  if (kind === 'time') {
    if (!c.value) return false
    if (c.operator === 'within') {
      const [from = '', to = ''] = c.value.split('-')
      if (!from || !to) return false
      return from <= to ? local.time >= from && local.time < to : local.time >= from || local.time < to
    }
    return c.operator === 'after' ? local.time >= c.value : local.time < c.value
  }
  if (kind === 'period') {
    const [from = '', to = ''] = c.value.split('|')
    if (!from || !to) return false
    const stamp = `${local.date}T${local.time}`
    return stamp >= from && stamp < to
  }
  const rawValue = c.field === 'caller.phone' ? ctx.callerPhone : ctx.contact?.[c.field.replace('contact.', '') as keyof NonNullable<GreetingCallContext['contact']>]
  const v = (rawValue ?? '').trim().toLowerCase()
  const want = c.value.trim().toLowerCase()
  switch (c.operator) {
    case 'is_empty':
      return !v
    case 'is':
      return !!v && v === want
    case 'is_not':
      return v !== want
    case 'contains':
      return !!v && !!want && v.includes(want)
    default:
      return !!v
  }
}

/**
 * Mensagem inicial efetiva de uma chamada: com "Personalizar" desligado usa a padrão; em Automático, a regra gerenciada
 * (contato com nome conhecido); em Avançado, a primeira regra cujas condições valem (de cima para baixo), senão a padrão.
 */
export function pickGreeting(agent: Pick<Agent, 'greeting' | 'greetingPersonalized' | 'greetingMode' | 'greetingRules'>, ctx: GreetingCallContext): { text: string; rule: number | null } {
  if (!agent.greetingPersonalized) return { text: agent.greeting, rule: null }
  const rules: GreetingRule[] =
    agent.greetingMode === 'advanced' ? agent.greetingRules : [{ id: 'auto', conditions: [{ field: 'contact.firstName', operator: 'is_set', value: '' }], message: autoRuleMessage(agent.greeting) }]
  const idx = rules.findIndex((r) => r.message.trim() && r.conditions.every((c) => conditionMatches(c, ctx)))
  return idx >= 0 ? { text: rules[idx]!.message, rule: idx } : { text: agent.greeting, rule: null }
}
