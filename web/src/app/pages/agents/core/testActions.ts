import type { Agent, DemoDB, EmailAction, TransferTarget } from '@/domain/types'
import '@/domain/ext/agents-resources'
import '@/domain/ext/mais-a'
import type { ActiveWindow, ExecutionTiming, SmsAction } from '@/domain/ext/agents-resources'
import { isPbx, pbxOf, pbxSummary } from '@/app/pages/phone-numbers/pbx/model'
import { renderSample } from '../resources/shared/variables'
import { matchCondition } from './chatSettings'
import { isWithinBusinessHours } from './variables'

/**
 * Narração das AÇÕES do assistente na ligação/chat de teste (tudo SIMULADO — nada é enviado nem transferido):
 * Enviar SMS (`agent.smsActions`), Enviar e-mail (`EmailAction.executionTiming/aiUsage/sendingPhrase`), Transferir ligações
 * (`TransferTarget` incl. destino PBX `pbxNumberId` e `failureDelaySec`) e servidores MCP (`WebhookConfig.variant === 'mcp'`).
 * - antes da conversa: SMS/e-mail com Executar = "Antes da conversa";
 * - durante: a fala de quem liga é comparada (palavras-chave) com "Transferir quando", "Quando a IA deve usar isto?" e com as
 *   ferramentas MCP ativas; o assistente diz a frase configurada ("Ao enviar, diga" / "O que dizer enquanto…") e a ação é narrada;
 * - depois: SMS/e-mail com Executar = "Depois da conversa" ("Somente se…" avaliado sobre o que quem liga disse).
 * A janela "Ativo" (a qualquer momento / dentro / fora do horário) é respeitada. INFERIDO (a Fonio não mostra essa narração).
 */

export interface NarrationLine {
  speaker: 'assistant' | 'system'
  text: string
}

export interface ActionContext {
  agent: Agent
  db: DemoDB
  now: Date
  /** valores do "Contexto de teste" (variáveis {{x}}) */
  values: Record<string, string>
  /** telefone de quem liga no teste (contato de exemplo), se houver */
  callerPhone?: string
}



function windowOk(win: ActiveWindow | undefined, ctx: ActionContext) {
  if (!win || win === 'any') return true
  const open = isWithinBusinessHours(ctx.agent.businessHours, ctx.now)
  return win === 'during' ? open : !open
}
const WINDOW_SKIP: Record<Exclude<ActiveWindow, 'any'>, string> = { during: 'fora do horário de funcionamento', outside: 'dentro do horário de funcionamento' }

const emailTiming = (e: EmailAction): ExecutionTiming => e.executionTiming ?? e.timing
const sample = (text: string, ctx: ActionContext, custom: string[] = []) =>
  renderSample(text, { ...ctx.values, ...Object.fromEntries(custom.map((c) => [c, `(${c}: preenchido pela IA)`])) }).replace(/\s+/g, ' ').trim()

function smsRecipients(a: SmsAction, ctx: ActionContext) {
  if (a.recipientsMode === 'fixed') return a.recipients.join(', ') || 'nenhum número'
  if (a.recipientsMode === 'ai') return `destinatário escolhido pela IA${a.recipientsInstruction?.trim() ? ` (“${a.recipientsInstruction.trim()}”)` : ''}`
  return ctx.callerPhone ? `quem liga (${ctx.callerPhone})` : 'quem liga (número do contato de exemplo)'
}

function smsLine(a: SmsAction, ctx: ActionContext, when: string) {
  const body =
    a.messageMode === 'ai' ? `texto escrito pela IA${a.aiInstruction?.trim() ? ` a partir de “${a.aiInstruction.trim()}”` : ''}` : `“${sample(a.message, ctx, (a.customVariables ?? []).map((v) => v.name)).slice(0, 160)}”`
  return `${when}: SMS “${a.name}” enviado para ${smsRecipients(a, ctx)} como ${a.sender || 'Kloel'} — ${body}`
}

function emailRecipients(e: EmailAction) {
  if (e.recipientsMode === 'ai') return `destinatário escolhido pela IA${e.recipientsInstruction?.trim() ? ` (“${e.recipientsInstruction.trim()}”)` : ''}`
  return e.recipients.join(', ') || 'nenhum endereço'
}

function emailLine(e: EmailAction, ctx: ActionContext, when: string) {
  const subject = e.messageMode === 'ai' ? 'assunto escrito pela IA' : `assunto “${sample(e.subject, ctx).slice(0, 120)}”`
  return `${when}: e-mail “${e.name}” enviado para ${emailRecipients(e)} (${subject})`
}

/** Linhas de sistema das ações "Antes da conversa". */
export function beforeConversationLines(ctx: ActionContext): NarrationLine[] {
  const out: NarrationLine[] = []
  for (const a of ctx.agent.type === 'voice' ? (ctx.agent.smsActions ?? []) : []) {
    if (a.timing !== 'before') continue
    out.push({ speaker: 'system', text: windowOk(a.activeWindow, ctx) ? smsLine(a, ctx, 'Antes da conversa') : `Antes da conversa: SMS “${a.name}” não enviado — ${WINDOW_SKIP[a.activeWindow as 'during']}` })
  }
  for (const e of ctx.agent.emails) {
    if (emailTiming(e) !== 'before') continue
    out.push({ speaker: 'system', text: windowOk(e.activeWindow, ctx) ? emailLine(e, ctx, 'Antes da conversa') : `Antes da conversa: e-mail “${e.name}” não enviado — ${WINDOW_SKIP[e.activeWindow as 'during']}` })
  }
  return out
}

/** Ações "durante" já usadas nesta conversa (cada uma dispara uma vez). */
export type DuringState = Set<string>

export interface TransferOutcome {
  target: TransferTarget
  ok: boolean
  /** segundos até o assistente voltar a falar após a falha (CT-01) */
  delaySec: number
}

function pbxDetails(t: TransferTarget, ctx: ActionContext): { ok: boolean; text: string } {
  const n = ctx.db.phoneNumbers.find((x) => x.id === t.pbxNumberId)
  if (!n || !isPbx(n)) return { ok: false, text: 'o número PBX escolhido não existe mais na central' }
  const seatedIds = ctx.db.memberships.filter((m) => m.orgId === ctx.agent.orgId && m.pbxSeat).map((m) => m.userId)
  const summary = pbxSummary(pbxOf(n), { users: ctx.db.users, agents: ctx.db.agents, seatedIds })
  if (summary === 'Ainda não configurado' || summary === 'Ninguém é notificado') return { ok: false, text: `a central PBX “${n.name}” (${n.number}) ainda não tem quem atenda` }
  return { ok: true, text: `central PBX “${n.name}” (${n.number}) — toca para todos neste número: ${summary.charAt(0).toLowerCase()}${summary.slice(1)}` }
}

function transferDestination(t: TransferTarget, ctx: ActionContext): { ok: boolean; text: string } {
  if (t.pbxNumberId) return pbxDetails(t, ctx)
  if (t.mode === 'member') {
    const u = ctx.db.users.find((x) => x.id === t.memberId)
    const who = u ? `${u.firstName} ${u.lastName}`.trim() : 'membro da equipe'
    if (!t.destination) return { ok: false, text: `${who} não tem número de telefone cadastrado` }
    return { ok: true, text: `${who} (${t.destination})` }
  }
  if (t.mode === 'sip') return { ok: true, text: `endereço SIP ${t.destination}` }
  // regra determinística da demonstração: números terminados em 0000 recusam a chamada
  if (t.destination.replace(/\D/g, '').endsWith('0000')) return { ok: false, text: `o número ${t.destination} não atendeu` }
  return { ok: true, text: `número ${t.destination}` }
}

/**
 * Reação às falas de quem liga/do cliente durante o teste. Devolve as linhas a acrescentar e, se houve, a transferência
 * (bem-sucedida → o teste termina como "Transferida").
 */
export function duringConversationLines(message: string, ctx: ActionContext, used: DuringState): { lines: NarrationLine[]; transfer?: TransferOutcome } {
  const lines: NarrationLine[] = []
  const voice = ctx.agent.type === 'voice'

  // Transferir ligações (só voz)
  if (voice) {
    for (const t of ctx.agent.transfers) {
      if (used.has(`trf:${t.id}`)) continue
      const hit = matchCondition(t.description, message)
      if (!hit) continue
      used.add(`trf:${t.id}`)
      if (!windowOk(t.activeWindow, ctx)) {
        lines.push({ speaker: 'system', text: `Transferência “${t.label}” não usada agora — só vale ${t.activeWindow === 'during' ? 'dentro' : 'fora'} do horário de funcionamento` })
        continue
      }
      const dest = transferDestination(t, ctx)
      lines.push({ speaker: 'assistant', text: `Vou transferir sua ligação para ${t.label.replace(/^Transferir para\s+/i, '')}. Um momento, por favor.` })
      if (t.checkAvailability) lines.push({ speaker: 'system', text: `Disponibilidade verificada no calendário antes de transferir: livre` })
      if (dest.ok) {
        lines.push({ speaker: 'system', text: `Ligação transferida (“${hit}” em “Transferir quando”) para ${dest.text}` })
        return { lines, transfer: { target: t, ok: true, delaySec: 0 } }
      }
      const delay = t.failureDelaySec ?? 0
      lines.push({ speaker: 'system', text: `Transferência não concluída: ${dest.text}. O assistente volta a falar após ${delay} s` })
      if (t.emailOnFailure && t.failureEmail) lines.push({ speaker: 'system', text: `E-mail em caso de falha enviado para ${t.failureEmail} com o resumo da conversa` })
      return { lines, transfer: { target: t, ok: false, delaySec: delay } }
    }
  }

  // Enviar SMS durante a conversa (só voz)
  for (const a of voice ? (ctx.agent.smsActions ?? []) : []) {
    if (a.timing !== 'during' || used.has(`sms:${a.id}`) || !a.aiUsage?.trim() || !matchCondition(a.aiUsage, message)) continue
    used.add(`sms:${a.id}`)
    if (!windowOk(a.activeWindow, ctx)) continue
    if (a.sendingPhrase?.trim()) lines.push({ speaker: 'assistant', text: a.sendingPhrase.trim() })
    lines.push({ speaker: 'system', text: smsLine(a, ctx, 'Durante a conversa') })
  }

  // Enviar e-mail durante a conversa
  for (const e of ctx.agent.emails) {
    if (emailTiming(e) !== 'during' || used.has(`eml:${e.id}`)) continue
    const usage = e.aiUsage?.trim() || e.condition?.trim() || ''
    if (!usage || !matchCondition(usage, message)) continue
    used.add(`eml:${e.id}`)
    if (!windowOk(e.activeWindow, ctx)) continue
    if (e.sendingPhrase?.trim()) lines.push({ speaker: 'assistant', text: e.sendingPhrase.trim() })
    lines.push({ speaker: 'system', text: emailLine(e, ctx, 'Durante a conversa') })
  }

  // Servidores MCP: ferramentas ativas cujo nome/descrição combinam com a fala
  for (const w of ctx.agent.webhooks) {
    if (!w.enabled || w.kind !== 'http_request' || w.variant !== 'mcp') continue
    for (const tool of w.mcpTools ?? []) {
      const key = `mcp:${w.id}:${tool.name}`
      if (!tool.enabled || used.has(key)) continue
      if (!matchCondition(`${tool.name.replace(/[_-]+/g, ' ')} ${tool.description}`, message)) continue
      used.add(key)
      if (!windowOk(w.activeWindow, ctx)) continue
      if (w.waitingPhrase?.trim()) lines.push({ speaker: 'assistant', text: w.waitingPhrase.trim() })
      lines.push({ speaker: 'system', text: `Servidor MCP “${w.name}”: ferramenta ${tool.name} chamada e respondeu` })
    }
  }
  return { lines }
}

/** Linhas de sistema das ações "Depois da conversa" ("Somente se…" avaliado sobre as falas de quem liga). */
export function afterConversationLines(callerText: string, ctx: ActionContext): NarrationLine[] {
  const out: NarrationLine[] = []
  const cond = (when: 'always' | 'only_if', condition?: string) => when === 'always' || (!!condition?.trim() && !!matchCondition(condition, callerText))
  for (const a of ctx.agent.type === 'voice' ? (ctx.agent.smsActions ?? []) : []) {
    if (a.timing !== 'after') continue
    if (!windowOk(a.activeWindow, ctx)) out.push({ speaker: 'system', text: `Depois da conversa: SMS “${a.name}” não enviado — ${WINDOW_SKIP[a.activeWindow as 'during']}` })
    else if (!cond(a.when, a.condition)) out.push({ speaker: 'system', text: `Depois da conversa: SMS “${a.name}” não enviado — a condição “${a.condition?.trim() ?? ''}” não ocorreu` })
    else out.push({ speaker: 'system', text: smsLine(a, ctx, 'Depois da conversa') })
  }
  for (const e of ctx.agent.emails) {
    if (emailTiming(e) !== 'after') continue
    if (!windowOk(e.activeWindow, ctx)) out.push({ speaker: 'system', text: `Depois da conversa: e-mail “${e.name}” não enviado — ${WINDOW_SKIP[e.activeWindow as 'during']}` })
    else if (!cond(e.when, e.condition)) out.push({ speaker: 'system', text: `Depois da conversa: e-mail “${e.name}” não enviado — a condição “${e.condition?.trim() ?? ''}” não ocorreu` })
    else out.push({ speaker: 'system', text: emailLine(e, ctx, 'Depois da conversa') })
  }
  return out
}
