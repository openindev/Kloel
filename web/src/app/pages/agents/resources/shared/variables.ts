/**
 * Catálogo de variáveis de template (menus "Adicionar variável" e "{ }").
 * Rótulos observados nas referências 484/492/514; chaves no formato {{grupo.campo}}.
 */
export interface VariableDef {
  key: string
  label: string
  group: 'Geral' | 'Chamada' | 'Contato' | 'Interlocutor' | 'Conversa' | 'Integrações'
  description: string
  /** pode estar vazia ("?" na referência) */
  optional?: boolean
  sample: string
  /**
   * Disponibilidade (Central de ajuda EM-03 / IW-04): `after` = só existe depois que a conversa acontece (indisponível em
   * "Antes da conversa": chip vermelho riscado); `inbound` = só no webhook de entrada (dados da chamada que está tocando).
   */
  phase?: 'after' | 'inbound'
}

/**
 * Catálogo (Central de ajuda EM-06, SM-04, HR-04, IW-04 — rótulos traduzidos): Assistente, Chamada, Empresa, Contato,
 * Interlocutor, Conversa, Webhook de entrada e Chamada de saída.
 */
export const VARIABLES: VariableDef[] = [
  { key: 'agent.name', label: 'Assistente: Nome', group: 'Geral', description: 'O nome de exibição do assistente.', sample: 'Roberta' },
  { key: 'agent.phoneNumber', label: 'Assistente: Número de telefone', group: 'Geral', description: 'O número de telefone do assistente nesta conversa.', optional: true, sample: '+55 11 90000-0200' },
  { key: 'company.id', label: 'Empresa: ID', group: 'Geral', description: 'O ID exclusivo da empresa.', sample: 'org_bemviver' },
  { key: 'company.name', label: 'Empresa: Nome', group: 'Geral', description: 'O nome da empresa.', sample: 'Clínica Bem Viver' },
  { key: 'call.fromNumber', label: 'Chamada: Número de origem', group: 'Chamada', description: 'Número de quem está ligando.', sample: '+55 11 90000-0123', phase: 'inbound' },
  { key: 'call.toNumber', label: 'Chamada: Número de destino', group: 'Chamada', description: 'Número da sua empresa que recebeu a ligação.', sample: '+55 11 90000-0200', phase: 'inbound' },
  { key: 'call.sipHeaders', label: 'Chamada: Cabeçalhos SIP: *', group: 'Chamada', description: 'Cabeçalhos SIP da chamada (só números SIP), ex. {{sipHeaders.nomeDoCabecalho}}.', optional: true, sample: '{}', phase: 'inbound' },
  { key: 'call.audioRecording', label: 'Chamada: Gravação de áudio', group: 'Chamada', description: 'Link para a gravação de áudio da chamada.', optional: true, sample: 'https://www.kloel.ai/gravacoes/exemplo.mp3', phase: 'after' },
  { key: 'call.direction', label: 'Chamada: Direção', group: 'Chamada', description: 'Se a chamada é recebida, realizada ou via web.', sample: 'Recebida' },
  { key: 'call.disconnectReason', label: 'Chamada: Motivo da desconexão', group: 'Chamada', description: 'O motivo pelo qual a chamada foi encerrada.', optional: true, sample: 'Encerrada por quem ligou', phase: 'after' },
  { key: 'call.duration', label: 'Chamada: Duração', group: 'Chamada', description: 'A duração no formato minutos:segundos.', sample: '3:12', phase: 'after' },
  { key: 'call.durationSeconds', label: 'Chamada: Duração em segundos', group: 'Chamada', description: 'A duração como número de segundos.', sample: '192', phase: 'after' },
  { key: 'contact.company', label: 'Contato: Empresa', group: 'Contato', description: 'Empresa à qual o contato pertence', optional: true, sample: 'Padaria Pão Dourado' },
  { key: 'contact.emails', label: 'Contato: Endereços de e-mail', group: 'Contato', description: 'Todos os endereços de e-mail do contato', optional: true, sample: 'mariana.almeida@exemplo.com.br' },
  { key: 'contact.firstName', label: 'Contato: Nome', group: 'Contato', description: 'Primeiro nome do contato identificado', optional: true, sample: 'Mariana' },
  { key: 'contact.phoneNumbers', label: 'Contato: Números de telefone', group: 'Contato', description: 'Todos os números de telefone do contato', optional: true, sample: '+55 11 90000-0001' },
  { key: 'contact.lastName', label: 'Contato: Sobrenome', group: 'Contato', description: 'Sobrenome do contato identificado', optional: true, sample: 'Almeida' },
  { key: 'caller.phoneNumber', label: 'Interlocutor: Número de telefone', group: 'Interlocutor', description: 'O número de telefone do interlocutor.', optional: true, sample: '+55 11 90000-0123' },
  { key: 'conversation.id', label: 'Conversa: ID', group: 'Conversa', description: 'O ID exclusivo da conversa.', sample: '00000000-0000-0000-0000-000000000001' },
  { key: 'conversation.link', label: 'Conversa: Link', group: 'Conversa', description: 'Link para a conversa na caixa de entrada do Kloel.', sample: '/app/inbox?id=conv_exemplo' },
  { key: 'conversation.startedAt', label: 'Conversa: Horário de início', group: 'Conversa', description: 'O horário de início da conversa.', sample: '18/10/2026 09:35' },
  { key: 'conversation.summary', label: 'Conversa: Resumo', group: 'Conversa', description: 'Um resumo da chamada gerado por IA.', sample: 'A pessoa que ligou perguntou sobre o horário de funcionamento e pediu um retorno amanhã.', phase: 'after' },
  { key: 'conversation.transcript', label: 'Conversa: Transcrição', group: 'Conversa', description: 'A transcrição completa da chamada, incluindo as ações e respostas do agente.', sample: 'Assistente: Olá, aqui é a Roberta… / Interlocutor: Bom dia, queria saber o horário…', phase: 'after' },
  { key: 'conversation.formattedTranscript', label: 'Conversa: Transcrição formatada', group: 'Conversa', description: 'A transcrição com rótulos técnicos das funções.', sample: 'agent: Olá, aqui é a Roberta… / user: Bom dia, queria saber o horário…', phase: 'after' },
  { key: 'conversation.plainTranscript', label: 'Conversa: Transcrição simples', group: 'Conversa', description: 'A transcrição da chamada sem os detalhes das ações do agente.', sample: 'Olá, aqui é a Roberta… Bom dia, queria saber o horário…', phase: 'after' },
  { key: 'inboundWebhook.response', label: 'Webhook de entrada: Dados de resposta: *', group: 'Integrações', description: 'Dados retornados pelo webhook de entrada no início da chamada.', optional: true, sample: '{"plano": "Ouro"}' },
  { key: 'outboundCall.context', label: 'Chamada de saída: Dados fornecidos: *', group: 'Integrações', description: 'Dados fornecidos ao iniciar a chamada de saída.', optional: true, sample: '{"name": "Maria"}' },
]

/**
 * Grupos do menu "Adicionar variável" da Fonio (fonio-live2 data/resources.json › Enviar e-mail › variablesPopover):
 * "Variáveis predefinidas" (13), "Contato" (5 + campos inteligentes) e "Esta integração" (6 — duração, resumo e transcrições).
 */
export const INTEGRATION_VARIABLE_KEYS = ['call.duration', 'call.durationSeconds', 'conversation.summary', 'conversation.transcript', 'conversation.formattedTranscript', 'conversation.plainTranscript']

/** Rótulos antigos (textos já salvos com {{Rótulo}}) → chave. */
const LEGACY_LABELS: Record<string, string> = {
  'chamada: motivo do encerramento': 'call.disconnectReason',
  'conversa: hora de início': 'conversation.startedAt',
  'webhook de entrada: dados de resposta': 'inboundWebhook.response',
  'chamada de saída: dados fornecidos': 'outboundCall.context',
}

/** Variáveis que só existem depois da conversa (indisponíveis em "Antes da conversa", ref. EM-03). */
export const AFTER_ONLY_KEYS = VARIABLES.filter((v) => v.phase === 'after').map((v) => v.key)

/** Variável do catálogo conhecida (as demais {{x}} digitadas viram "variáveis personalizadas"). */
export const isCatalogVariable = (key: string) => !!VARIABLE_BY_KEY[key] || key.startsWith('contact.smart.') || key.startsWith('sipHeaders.')

/** Nomes {{x}} do texto que não são do catálogo (variáveis personalizadas: SM-05 / HR-07). */
export function customVariableNames(...texts: string[]) {
  return usedVariableKeys(...texts).filter((k) => !isCatalogVariable(k) && /^[A-Za-z_][\w]*$/.test(k))
}

export const VARIABLE_BY_KEY = Object.fromEntries(VARIABLES.map((v) => [v.key, v])) as Record<string, VariableDef>

/* ------------------------------------------------------------------ */
/* Escopo por assistente ("Conectar contatos")                         */
/* ------------------------------------------------------------------ */

/**
 * O que "Conectar contatos" libera para um assistente: contatos ligados/desligados, detalhes marcados
 * (`null` = nunca configurado → todos) e os campos inteligentes da organização.
 */
export interface VariableScope {
  contactsEnabled: boolean
  fields: string[] | null
  smartFields: { id: string; label: string; description?: string }[]
}

/** Detalhe de "Conectar contatos" (ids de ContactsSheet) a que cada variável de contato pertence. */
const CONTACT_FIELD_BY_KEY: Record<string, string> = {
  'contact.firstName': 'firstName',
  'contact.lastName': 'lastName',
  'contact.company': 'company',
  'contact.emails': 'emails',
  'contact.phoneNumbers': 'phones',
  'contact.phones': 'phones', // chave usada pelas mensagens iniciais (módulo agents-core)
  'contact.notes': 'notes',
}

export const smartFieldKey = (id: string) => `contact.smart.${id}`

/** Detalhe de contato exigido pela variável (`smart:<id>` para campos inteligentes); `undefined` = não é de contato. */
export function contactFieldOf(key: string): string | undefined {
  if (key.startsWith('contact.smart.')) return `smart:${key.slice('contact.smart.'.length)}`
  return CONTACT_FIELD_BY_KEY[key]
}

export function isVariableAllowed(key: string, scope: VariableScope | null | undefined) {
  const field = contactFieldOf(key)
  if (!field || !scope) return true
  if (!scope.contactsEnabled) return false
  return scope.fields === null || scope.fields.includes(field)
}

/** Variáveis que o assistente pode usar: catálogo sem os detalhes desmarcados + campos inteligentes marcados ("Contato: …"). */
export function scopedVariables(scope: VariableScope | null | undefined): VariableDef[] {
  if (!scope) return VARIABLES
  const smart: VariableDef[] = scope.smartFields.map((f) => ({
    key: smartFieldKey(f.id),
    label: `Contato: ${f.label}`,
    group: 'Contato',
    description: f.description || 'Campo inteligente do contato.',
    optional: true,
    sample: `(${f.label.toLowerCase()} do contato)`,
  }))
  return [...VARIABLES, ...smart].filter((v) => isVariableAllowed(v.key, scope))
}

/** Rótulo de qualquer variável conhecida no escopo (inclui campos inteligentes). */
export function variableLabel(key: string, scope?: VariableScope | null) {
  if (VARIABLE_BY_KEY[key]) return VARIABLE_BY_KEY[key]!.label
  const f = key.startsWith('contact.smart.') ? scope?.smartFields.find((x) => smartFieldKey(x.id) === key) : undefined
  return f ? `Contato: ${f.label}` : key
}

/**
 * Valores de exemplo para a prévia: variáveis bloqueadas em "Conectar contatos" ficam vazias (como no envio),
 * campos inteligentes liberados recebem um exemplo.
 */
export function scopedSamples(scope: VariableScope | null | undefined, extra: Record<string, string> = {}) {
  const out: Record<string, string> = { ...extra }
  if (!scope) return out
  for (const f of scope.smartFields) out[smartFieldKey(f.id)] = `(${f.label.toLowerCase()} do contato)`
  for (const k of [...Object.keys(CONTACT_FIELD_BY_KEY), ...scope.smartFields.map((f) => smartFieldKey(f.id))]) if (!isVariableAllowed(k, scope)) out[k] = ''
  return out
}

/** Rótulo (minúsculo) → chave: nos editores escuros a variável entra pelo rótulo, ex. {{Chamada: Número de origem}} (ref. IW-03). */
const KEY_BY_LABEL = { ...LEGACY_LABELS, ...Object.fromEntries(VARIABLES.map((v) => [v.label.toLowerCase(), v.key])) } as Record<string, string>

/** Conteúdo de {{…}} → chave do catálogo (aceita a chave ou o rótulo); desconhecido volta como está. */
export function resolveVariable(raw: string) {
  const t = raw.trim()
  return VARIABLE_BY_KEY[t] ? t : (KEY_BY_LABEL[t.toLowerCase()] ?? t)
}

const TOKEN_RE = /\{\{\s*([^{}]+?)\s*\}\}/g

/** Chaves {{x}} de um texto (chave ou rótulo) e chips data-var de um HTML. */
export function usedVariableKeys(...texts: string[]) {
  const keys = new Set<string>()
  for (const t of texts) {
    for (const m of t.matchAll(TOKEN_RE)) keys.add(resolveVariable(m[1]!))
    for (const m of t.matchAll(/data-var="([\w.]+)"/g)) keys.add(m[1]!)
  }
  return [...keys]
}

export const token = (key: string) => `{{${key}}}`
/** Token pelo rótulo, como nos editores escuros da referência (IW-03/IW-04/HR-04); variáveis fora do catálogo usam a chave. */
export const labelToken = (key: string) => (VARIABLE_BY_KEY[key] ? `{{${VARIABLE_BY_KEY[key]!.label}}}` : token(key))

/** Substitui {{chave}} / {{Rótulo}} por valores de exemplo (prévia). Desconhecidas viram "[chave]". */
export function renderSample(text: string, extra: Record<string, string> = {}) {
  return text.replace(TOKEN_RE, (_, raw: string) => {
    const k = resolveVariable(raw)
    return extra[k] ?? VARIABLE_BY_KEY[k]?.sample ?? `[${k}]`
  })
}

/**
 * Troca variáveis {{x}} que estão FORA de strings JSON por um marcador (variáveis dentro de strings já são JSON válido).
 */
function protectBareVariables(text: string, marker: (i: number) => string) {
  const vars: string[] = []
  let out = ''
  let inString = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (inString) {
      out += ch
      if (ch === '\\') {
        out += text[i + 1] ?? ''
        i++
      } else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      out += ch
      continue
    }
    if (ch === '{' && text[i + 1] === '{') {
      const end = text.indexOf('}}', i + 2)
      if (end > 0) {
        vars.push(text.slice(i, end + 2))
        out += marker(vars.length - 1)
        i = end + 1
        continue
      }
    }
    out += ch
  }
  return { out, vars }
}

/** Para validar JSON com variáveis: troca cada {{x}} solto por um valor neutro. */
export function stripVariablesForJson(text: string) {
  return protectBareVariables(text, () => '0').out
}

export function parseJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const t = text.trim()
  if (!t) return { ok: true, value: {} }
  try {
    return { ok: true, value: JSON.parse(stripVariablesForJson(t)) }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const lc = msg.match(/line (\d+) column (\d+)/i)
    const pos = msg.match(/position (\d+)/i)
    const where = lc ? ` (linha ${lc[1]}, coluna ${lc[2]})` : pos ? ` (posição ${pos[1]})` : ''
    const hint = /end of (JSON|data)|Unexpected end/i.test(msg) ? 'o conteúdo termina antes da hora — falta fechar } ou ]' : /Unexpected token|Expected/i.test(msg) ? 'verifique vírgulas, aspas e chaves' : 'verifique a sintaxe'
    return { ok: false, error: `JSON inválido${where}: ${hint}.` }
  }
}

/** Formata (indenta) JSON preservando variáveis; retorna null se inválido. */
export function formatJson(text: string): string | null {
  const t = text.trim()
  if (!t) return '{}'
  const { out, vars } = protectBareVariables(t, (i) => `"__KLOEL_VAR_${i}__"`)
  try {
    return JSON.stringify(JSON.parse(out), null, 2).replace(/"__KLOEL_VAR_(\d+)__"/g, (_, i: string) => vars[Number(i)] ?? '')
  } catch {
    return null
  }
}
