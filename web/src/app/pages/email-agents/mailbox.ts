import { useMemo } from 'react'
import '@/domain/ext/mais-b'
import type { CalendarConnection, EmailInbox, EmailMessage, ID, Role } from '@/domain/types'
import type { EmailTone } from '@/domain/ext/mais-b'
import { useCollection, useCurrentRole, useCurrentUser, useStore } from '@/data/store'
import { uid } from '@/lib/utils'
import { canManageShared } from '@/app/pages/company-settings/plan'
import { disconnectEmailInbox } from '@/services/casca/email'

/**
 * Regras de apresentação e permissões do E-Mail IA. Os e-mails vêm da caixa Google/Microsoft conectada,
 * sincronizada pelo motor (`services/casca/email.ts`); os auxiliares históricos abaixo recusam criar dados em memória.
 */

export const TONES: { value: EmailTone; label: string }[] = [
  { value: 'professional', label: 'Profissional' },
  { value: 'friendly', label: 'Amigável' },
  { value: 'formal', label: 'Formal' },
  { value: 'casual', label: 'Descontraído' },
  { value: 'empathetic', label: 'Empático' },
]
export const toneLabel = (t: string) => TONES.find((x) => x.value === t)?.label ?? t

export const MAIL_VIEWS = ['inbox', 'sent', 'context', 'rules', 'knowledge', 'settings'] as const
export type MailView = (typeof MAIL_VIEWS)[number]
export const VIEW_LABEL: Record<MailView, string> = {
  inbox: 'Caixa de entrada',
  sent: 'Enviados',
  context: 'Contexto',
  rules: 'Regras',
  knowledge: 'Conhecimento',
  settings: 'Configurações',
}

/** Historical shell helper signatures refuse to create provider data in memory. */
export const POOL_SIZE = 0
export function initialMessages(..._args: unknown[]): EmailMessage[] { throw Error('Conecte e sincronize a caixa de entrada.') }
export function nextSyncedMessages(..._args: unknown[]): EmailMessage[] { throw Error('Use a sincronização da caixa conectada.') }

export const DEFAULT_RULES = () => [
  { id: uid('rul'), active: true, text: 'Não responda newsletters, propagandas ou e-mails automáticos.' },
  { id: uid('rul'), active: true, text: 'Em reclamações, peça desculpas e informe que a equipe retornará ainda hoje.' },
  { id: uid('rul'), active: false, text: 'Nunca confirme valores sem consultar a tabela de preços atual.' },
]

export function defaultSignature(firstName: string, orgName: string) {
  return `Atenciosamente,\n${firstName ? firstName + '\n' : ''}${orgName}`
}

/**
 * Cria a caixa de entrada do E-Mail IA para uma conexão com o recurso "IA de e-mail" e executa a
 * primeira sincronização simulada. Agente começa DESATIVADO (ativação depende da assinatura).
 */
export function createInboxForConnection(_conn: CalendarConnection): EmailInbox { throw Error('Atualize as caixas conectadas antes de ativar o agente.') }
/** Remove a caixa do E-Mail IA (também usado em Configurações da empresa → Caixas de entrada). Nada é apagado no Gmail/Outlook. */
export async function disconnectInbox(inboxId: ID): Promise<void> { await disconnectEmailInbox(inboxId) }

/* ------------------------------ Permissões ------------------------------ */

/**
 * Quem pode fazer o quê numa caixa do E-Mail IA (mesmo modelo de Configurações da empresa → Conexões de contas):
 * - Caixa COMPARTILHADA: Admin e Editor gerenciam (ativar/desativar agente, configurações, assinatura, desconectar,
 *   responder e excluir e-mails). Builder edita Contexto, Regras e Conhecimento ("gerencia assistentes e base de
 *   conhecimento"). Visualizador: somente leitura.
 * - Caixa PESSOAL: somente o proprietário gerencia ("contas pessoais são gerenciadas por seus proprietários").
 * Caixa sem conexão registrada é tratada como compartilhada. INFERIDO a partir das descrições das funções.
 */
export interface InboxAccess {
  scope: 'shared' | 'personal'
  canManage: boolean
  canEdit: boolean
  /** explicação exibida (tooltip/aviso) quando `canManage` é falso */
  manageReason: string
  editReason: string
}

export function inboxAccess(inbox: Pick<EmailInbox, 'connectionId' | 'ownerUserId'>, role: Role, userId: ID | undefined | null, connections: CalendarConnection[], users: { id: ID; firstName: string; lastName: string }[] = []): InboxAccess {
  const conn = inbox.connectionId ? connections.find((c) => c.id === inbox.connectionId) : undefined
  const scope = conn?.scope ?? 'shared'
  const ownerId = conn?.ownerUserId ?? inbox.ownerUserId
  if (scope === 'personal') {
    const isOwner = !!userId && ownerId === userId
    const owner = users.find((u) => u.id === ownerId)
    const ownerName = owner ? `${owner.firstName} ${owner.lastName}`.trim() : ''
    const reason = `Caixas pessoais só podem ser gerenciadas pelo proprietário${ownerName ? ` (${ownerName})` : ''}.`
    return { scope, canManage: isOwner, canEdit: isOwner, manageReason: reason, editReason: reason }
  }
  const canManage = canManageShared(role)
  return {
    scope,
    canManage,
    canEdit: canManage || role === 'builder',
    manageReason: 'Somente Admin e Editor podem gerenciar caixas de entrada compartilhadas.',
    editReason: 'Somente Admin, Editor e Builder podem editar o agente de caixas compartilhadas. Sua função tem acesso somente leitura.',
  }
}

export function useInboxAccess(inbox: Pick<EmailInbox, 'connectionId' | 'ownerUserId'> | undefined): InboxAccess {
  const role = useCurrentRole()
  const me = useCurrentUser()
  const connections = useCollection('calendarConnections')
  const users = useStore((s) => s.db.users)
  const connectionId = inbox?.connectionId
  const ownerUserId = inbox?.ownerUserId
  return useMemo(
    () => inboxAccess({ connectionId, ownerUserId }, role, me?.id, connections, users),
    [connectionId, ownerUserId, role, me?.id, connections, users],
  )
}

/** Texto do rascunho sem a assinatura padrão: vazio = nada foi escrito além da assinatura. */
export function draftContent(text: string, signature: string) {
  const t = text.trim()
  const sig = signature.trim()
  return sig && t.endsWith(sig) ? t.slice(0, t.length - sig.length).trim() : t
}

const STOP = new Set(['para', 'como', 'qual', 'quais', 'sobre', 'mais', 'esta', 'este', 'isso', 'pela', 'pelo', 'vocês', 'voces', 'gostaria', 'olá', 'obrigada', 'obrigado', 'favor', 'saber', 'tenho', 'minha', 'meu', 'seria', 'possível', 'possivel'])
function words(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length > 3 && !STOP.has(w))
}

/** Entradas de conhecimento relevantes para um e-mail (sobreposição de palavras-chave). */
export function matchKnowledge(inbox: EmailInbox, msg: Pick<EmailMessage, 'subject' | 'body'>) {
  const target = new Set(words(`${msg.subject} ${msg.body}`))
  return (inbox.knowledgeItems ?? []).filter((k) => words(`${k.title} ${k.content}`).some((w) => target.has(w)))
}

export function formatMailDate(iso: string, now = Date.now()) {
  const d = new Date(iso)
  const sameDay = new Date(now).toDateString() === d.toDateString()
  if (sameDay) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  const diff = now - d.getTime()
  if (diff < 6 * 86400_000) return d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' }).replace('.', '')
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/** Registra uma resposta enviada (simulada): cria o e-mail em "Enviados" e marca o original como respondido. */
export function recordReply(..._args: unknown[]): EmailMessage { throw Error('Envie a resposta pela caixa conectada e confira sua confirmação.') }
