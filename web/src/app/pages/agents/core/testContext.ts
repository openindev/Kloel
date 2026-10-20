import '@/domain/ext/agents-resources'
import type { Agent, Contact, SmartFieldDef, WebhookConfig } from '@/domain/types'
import { isVariableAllowed, parseJson, smartFieldKey, type VariableScope } from '../resources/shared/variables'
import type { GreetingCallContext } from './variables'

/**
 * Variáveis da ligação/chat de teste ("Testar ligação" / "Testar chat").
 * Precedência (a última vence): assistente/empresa → contato de exemplo → valores padrão do webhook de entrada (ativo)
 * → "Contexto de teste" (Webhooks › Contexto de teste, ref. 543: usado nas ligações de teste no lugar dos dados do webhook de entrada).
 * O contato de exemplo é escolhido no próprio "Contexto de teste" (padrão: o contato mais antigo da organização;
 * "Contato desconhecido" desliga) e respeita "Conectar contatos" (desligado → não reconhece; detalhe desmarcado → vazio).
 */
export type TestVarSource = 'system' | 'contact' | 'blocked' | 'default' | 'context'

export const TEST_VAR_SOURCE_LABEL: Record<TestVarSource, string> = {
  system: 'Assistente/empresa',
  contact: 'Contato de exemplo',
  blocked: 'Bloqueado em “Conectar contatos”',
  default: 'Valor padrão do webhook de entrada',
  context: 'Contexto de teste',
}

export interface TestVariables {
  values: Record<string, string>
  sources: Record<string, TestVarSource>
  /** contato reconhecido no teste (undefined = contato desconhecido) */
  contact?: Contact
  /** por que não há contato: escolhido "Contato desconhecido", contatos desligados no assistente ou organização sem contatos */
  noContactReason?: 'unknown' | 'disabled' | 'empty'
  /** chaves definidas no "Contexto de teste" */
  contextKeys: string[]
  /** JSON salvo inválido (não deveria acontecer: a folha valida antes de salvar) */
  contextError?: string
  /** dados para as condições das regras da mensagem inicial */
  greetingContact?: GreetingCallContext['contact']
  callerPhone?: string
}

export const testContextConfig = (agent: Pick<Agent, 'webhooks'>): WebhookConfig | undefined => agent.webhooks.find((w) => w.kind === 'test_context')

/** Link para editar o contexto de teste (folha Webhooks › Contexto de teste, via ?recurso=&item=). */
export const testContextHref = (agentId: string) => `/app/agents/${agentId}/general?recurso=webhooks&item=contexto-teste`

export const contactFullName = (c: Pick<Contact, 'firstName' | 'lastName'>) => [c.firstName, c.lastName].filter(Boolean).join(' ').trim() || 'Contato sem nome'

/** Contato de exemplo padrão: o mais antigo da organização (determinístico). */
export function defaultSampleContact(contacts: Contact[]) {
  return [...contacts].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))[0]
}

/** JSON → { "a.b": "valor" } (objetos aninhados viram chaves com ponto; listas viram texto separado por vírgula). */
export function flattenJson(value: unknown, prefix = '', out: Record<string, string> = {}) {
  if (value === null || value === undefined) {
    if (prefix) out[prefix] = ''
    return out
  }
  if (Array.isArray(value)) {
    out[prefix] = value.map((v) => (typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v))).join(', ')
    return out
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    if (!entries.length && prefix) out[prefix] = ''
    for (const [k, v] of entries) flattenJson(v, prefix ? `${prefix}.${k}` : k, out)
    return out
  }
  if (prefix) out[prefix] = String(value)
  return out
}

export function parseContextJson(body: string | undefined): { values: Record<string, string>; error?: string } {
  if (!body?.trim()) return { values: {} }
  const p = parseJson(body)
  if (!p.ok) return { values: {}, error: p.error }
  if (!p.value || typeof p.value !== 'object' || Array.isArray(p.value)) return { values: {}, error: 'O contexto deve ser um objeto JSON.' }
  return { values: flattenJson(p.value) }
}

/** Valores das variáveis de contato de um contato (inclui campos inteligentes). Chaves das mensagens iniciais e dos recursos. */
export function contactVariableValues(contact: Contact, smartFields: Pick<SmartFieldDef, 'id'>[]) {
  const phones = contact.phones.map((p) => p.value).filter(Boolean).join(', ')
  const emails = contact.emails.map((e) => e.value).filter(Boolean).join(', ')
  const out: Record<string, string> = {
    'contact.firstName': contact.firstName ?? '',
    'contact.lastName': contact.lastName ?? '',
    'contact.company': contact.company ?? '',
    'contact.emails': emails,
    'contact.phones': phones,
    'contact.phoneNumbers': phones,
    'contact.notes': contact.notes ?? '',
  }
  for (const f of smartFields) out[smartFieldKey(f.id)] = contact.fields?.[f.id] ?? ''
  return out
}

export function buildTestVariables(input: {
  agent: Pick<Agent, 'name' | 'webhooks' | 'contactsEnabled' | 'contactAccess'>
  companyName: string
  contacts: Contact[]
  smartFields: Pick<SmartFieldDef, 'id' | 'label' | 'description'>[]
  /** rascunho do JSON (prévia na folha); padrão = contexto salvo */
  contextBody?: string
  /** rascunho do contato de exemplo ('' = desconhecido); padrão = salvo */
  sampleContactId?: string
}): TestVariables {
  const { agent, companyName, contacts, smartFields } = input
  const cfg = testContextConfig(agent)
  const values: Record<string, string> = {}
  const sources: Record<string, TestVarSource> = {}
  const put = (k: string, v: string, s: TestVarSource) => {
    values[k] = v
    sources[k] = s
  }
  put('agent.name', agent.name, 'system')
  put('company.name', companyName, 'system')

  // contato de exemplo
  const chosen = input.sampleContactId !== undefined ? input.sampleContactId : cfg?.sampleContactId
  let contact: Contact | undefined
  let noContactReason: TestVariables['noContactReason']
  if (!agent.contactsEnabled) noContactReason = 'disabled'
  else if (chosen === '') noContactReason = 'unknown'
  else {
    contact = (chosen ? contacts.find((c) => c.id === chosen) : undefined) ?? defaultSampleContact(contacts)
    if (!contact) noContactReason = 'empty'
  }
  if (contact) {
    const scope: VariableScope = { contactsEnabled: agent.contactsEnabled, fields: agent.contactAccess?.fields ?? null, smartFields: smartFields.map((f) => ({ id: f.id, label: f.label })) }
    const cv = contactVariableValues(contact, smartFields)
    for (const [k, v] of Object.entries(cv)) {
      if (isVariableAllowed(k, scope)) put(k, v, 'contact')
      else put(k, '', 'blocked')
    }
  }

  // valores padrão do webhook de entrada ativo
  const inbound = agent.webhooks.find((w) => w.kind === 'inbound')
  if (inbound?.enabled && inbound.defaults) {
    const d = parseContextJson(inbound.defaults)
    for (const [k, v] of Object.entries(d.values)) put(k, v, 'default')
  }

  // contexto de teste
  const ctx = parseContextJson(input.contextBody !== undefined ? input.contextBody : cfg?.body)
  for (const [k, v] of Object.entries(ctx.values)) put(k, v, 'context')

  // regras da mensagem inicial: contato reconhecido (ou dados de contato informados no contexto de teste)
  const contactKeys = ['firstName', 'lastName', 'company', 'phones', 'emails'] as const
  const greetingContact =
    contact || contactKeys.some((k) => sources[`contact.${k}`] === 'context' || sources[`contact.${k}`] === 'default')
      ? Object.fromEntries(contactKeys.map((k) => [k, values[`contact.${k}`] ?? ''])) as NonNullable<TestVariables['greetingContact']>
      : undefined

  return {
    values,
    sources,
    contact,
    noContactReason,
    contextKeys: Object.keys(ctx.values),
    contextError: ctx.error,
    greetingContact,
    callerPhone: contact?.phones[0]?.value,
  }
}

/** Chaves {{x}} usadas num texto. */
export function variableKeysIn(text: string) {
  return [...new Set([...text.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]!))]
}
