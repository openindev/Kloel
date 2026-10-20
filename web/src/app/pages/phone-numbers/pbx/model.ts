import { useMemo } from 'react'
import { toast } from 'sonner'
import type { Agent, Contact, Membership, PhoneNumber, Role, User } from '@/domain/types'
import type { PbxConfig, PbxRouting } from '@/domain/ext/mais-a'
import '@/domain/ext/mais-a'
import { useCollection, useStore } from '@/data/store'

/**
 * Kloel PBX — modelo e regras (OBSERVADO na central de ajuda pública da Fonio, artigo phone-numbers/pbx, PB-01…PB-19).
 * Nada aqui toca de verdade: as chamadas, a caixa postal e o telefone do navegador são simulados.
 */

export const DEFAULT_RING = 30
export const MAX_STEPS = 10

export function defaultPbxConfig(timezone = 'America/Sao_Paulo'): PbxConfig {
  return {
    mode: 'one',
    ringSeconds: DEFAULT_RING,
    groupUserIds: [],
    steps: [],
    allowlist: { enabled: false, contactIds: [], routing: 'one', ringSeconds: DEFAULT_RING, groupUserIds: [], steps: [] },
    businessHours: { enabled: false, timezone, outside: 'missed' },
    missed: 'nothing',
    voicemail: { source: 'ai', text: '', voiceId: 'joana' },
    postCallEmails: [],
    callerId: 'this',
    recording: true,
  }
}

/** Configuração completa (preenche campos ausentes de dados antigos). */
export function pbxOf(n: PhoneNumber): PbxConfig {
  const d = defaultPbxConfig()
  const p = n.pbx ?? d
  const cfg: PbxConfig = { ...d, ...p, allowlist: { ...d.allowlist, ...p.allowlist }, businessHours: { ...d.businessHours, ...p.businessHours }, voicemail: { ...d.voicemail, ...p.voicemail } }
  // número atribuído a um assistente em outra tela (ex.: "Atribuir número" do assistente): o assistente atende (modo "Assistente de IA")
  if (n.agentId && (cfg.mode !== 'ai' || cfg.agentId !== n.agentId)) return { ...cfg, mode: 'ai', agentId: n.agentId }
  return cfg
}

export const isPbx = (n: PhoneNumber) => !!n.pbx

export const fullName = (u?: Pick<User, 'firstName' | 'lastName'>) => (u ? `${u.firstName} ${u.lastName}`.trim() : '')

export interface SeatUser {
  user: User
  membership: Membership
}

/** Membros da organização atual, com a posição PBX (Membership.pbxSeat). */
export function usePbxMembers() {
  const memberships = useCollection('memberships')
  const users = useStore((s) => s.db.users)
  const numbers = useCollection('phoneNumbers')
  return useMemo(() => {
    const members: SeatUser[] = memberships
      .map((m) => ({ membership: m, user: users.find((u) => u.id === m.userId) }))
      .filter((x): x is SeatUser => !!x.user)
      .sort((a, b) => fullName(a.user).localeCompare(fullName(b.user)))
    const seated = members.filter((m) => m.membership.pbxSeat)
    // OBSERVADO (PB-04): coluna "Posição PBX" com contador "0 / 1" para um número PBX → 1 posição por número PBX (INFERIDO)
    const limit = numbers.filter(isPbx).length
    return { members, seated, used: seated.length, limit }
  }, [memberships, users, numbers])
}

/** Quem pode atribuir/remover posições PBX: Admin e Editor (Editor gerencia números de telefone — catálogo de funções). INFERIDO. */
export const canManagePbxSeats = (role?: Role) => role === 'admin' || role === 'editor'

/** Motivo para o switch de posição estar bloqueado (mesma regra no diálogo "Posições PBX" e na página Usuários). */
export function seatBlockReason(opts: { on: boolean; used: number; limit: number; role?: Role }) {
  if (!canManagePbxSeats(opts.role)) return 'Somente Admin ou Editor pode atribuir posições PBX.'
  if (opts.on) return undefined
  if (opts.limit === 0) return 'Compre um número PBX para liberar posições.'
  if (opts.used >= opts.limit) return 'Todas as posições estão em uso.'
  return undefined
}

/**
 * Grava Membership.pbxSeat validando o limite (1 posição por número PBX) contra o estado ATUAL do store.
 * Usado pelo diálogo "Posições PBX" (número PBX) e pela coluna "Posição PBX" de Usuários (PB-04).
 */
export function setPbxSeat(membershipId: string, on: boolean, role?: Role) {
  const { db, patch } = useStore.getState()
  const m = db.memberships.find((x) => x.id === membershipId)
  if (!m) return false
  const u = db.users.find((x) => x.id === m.userId)
  const used = db.memberships.filter((x) => x.orgId === m.orgId && x.pbxSeat).length
  const limit = db.phoneNumbers.filter((n) => n.orgId === m.orgId && isPbx(n)).length
  const reason = seatBlockReason({ on: !!m.pbxSeat || !on, used, limit, role })
  if (reason) {
    toast.error('Não foi possível alterar a posição PBX', { description: reason })
    return false
  }
  if (!!m.pbxSeat === on) return true
  patch('memberships', m.id, { pbxSeat: on })
  toast.success(on ? `Posição PBX atribuída a ${fullName(u)}` : `Posição PBX removida de ${fullName(u)}`)
  return true
}

/**
 * Coluna "Conexão" de Usuários (OBSERVADO PB-04: "Connection" com "—" para quem não tem posição; demais valores INFERIDOS):
 * com posição PBX, mostra como o membro recebe as chamadas — o telefone do navegador. Para o usuário atual usa a
 * disponibilidade salva no telefone do navegador; os demais membros não têm sessão aberta nesta demonstração local.
 */
export function pbxConnection(opts: { seated: boolean; isMe: boolean; available: boolean; hasLine: boolean }): { label: string; detail: string; tone: 'online' | 'away' | 'offline' } | null {
  if (!opts.seated || !opts.hasLine) return null
  if (opts.isMe) return opts.available ? { label: 'Telefone do navegador', detail: 'Disponível', tone: 'online' } : { label: 'Telefone do navegador', detail: 'Indisponível', tone: 'away' }
  return { label: 'Telefone do navegador', detail: 'Desconectado', tone: 'offline' }
}

export const RING_LIMITS = { min: 5, max: 120 }

export function routingTargets(r: PbxRouting, mode: 'one' | 'group' | 'sequence', seatedIds: string[]) {
  if (mode === 'one') return r.ownerUserId && seatedIds.includes(r.ownerUserId) ? [r.ownerUserId] : []
  if (mode === 'group') return r.groupUserIds.filter((id) => seatedIds.includes(id))
  return r.steps.map((s) => s.userId).filter((id): id is string => !!id && seatedIds.includes(id))
}

/** Resumo do cabeçalho (OBSERVADO: "Ainda não configurado", "Toca para <pessoa>", "Assistente <nome> atende"). */
export function pbxSummary(cfg: PbxConfig, ctx: { users: User[]; agents: Agent[]; seatedIds: string[] }) {
  const name = (id?: string) => fullName(ctx.users.find((u) => u.id === id))
  switch (cfg.mode) {
    case 'nobody':
      return cfg.missed === 'voicemail' ? 'Vai direto para a caixa postal' : cfg.missed === 'agent' && cfg.missedAgentId ? `Assistente ${agentName(ctx.agents, cfg.missedAgentId)} atende` : 'Ninguém é notificado'
    case 'one': {
      const t = routingTargets(cfg, 'one', ctx.seatedIds)
      return t.length ? `Toca para ${name(t[0])}` : 'Ainda não configurado'
    }
    case 'group': {
      const t = routingTargets(cfg, 'group', ctx.seatedIds)
      return t.length ? `${t.length} ${t.length === 1 ? 'pessoa toca' : 'pessoas tocam'} em paralelo` : 'Ainda não configurado'
    }
    case 'sequence': {
      const t = routingTargets(cfg, 'sequence', ctx.seatedIds)
      return t.length ? `${t.length} ${t.length === 1 ? 'etapa' : 'etapas'} em sequência` : 'Ainda não configurado'
    }
    case 'ai':
      return cfg.agentId ? `Assistente ${agentName(ctx.agents, cfg.agentId)} atende` : 'Ainda não configurado'
  }
}

export const agentName = (agents: Agent[], id?: string) => agents.find((a) => a.id === id)?.name ?? ''

export type PreviewStep = { icon: 'phone' | 'user' | 'users' | 'timer' | 'end' | 'agent' | 'voicemail' | 'clock'; text: string; tone?: 'green' | 'muted' }

/** "PRÉVIA AO VIVO — O que quem liga vivencia" (OBSERVADO PB-05/07/08/12/18; textos traduzidos). */
export function previewSteps(cfg: PbxConfig, ctx: { users: User[]; agents: Agent[]; seatedIds: string[] }): PreviewStep[] {
  const name = (id?: string) => fullName(ctx.users.find((u) => u.id === id))
  const out: PreviewStep[] = [{ icon: 'phone', text: 'Chamada recebida' }]
  if (cfg.businessHours.enabled && cfg.mode !== 'ai') out.push({ icon: 'clock', text: `Dentro do horário (${cfg.businessHours.timezone})`, tone: 'muted' })
  if (cfg.mode === 'ai') {
    out.push({ icon: 'agent', text: cfg.agentId ? `Assistente ${agentName(ctx.agents, cfg.agentId)} atende` : 'Escolha um assistente' })
    return out
  }
  let rang = false
  if (cfg.mode === 'one') {
    const t = routingTargets(cfg, 'one', ctx.seatedIds)
    if (t.length) {
      out.push({ icon: 'user', text: `Toca para ${name(t[0])}`, tone: 'green' }, { icon: 'timer', text: `${cfg.ringSeconds}s de toque` })
      rang = true
    }
  } else if (cfg.mode === 'group') {
    const t = routingTargets(cfg, 'group', ctx.seatedIds)
    if (t.length) {
      out.push({ icon: 'users', text: `${t.length} ${t.length === 1 ? 'pessoa toca' : 'pessoas tocam'} em paralelo`, tone: 'green' }, { icon: 'timer', text: `${cfg.ringSeconds}s de toque` })
      rang = true
    }
  } else if (cfg.mode === 'sequence') {
    cfg.steps.forEach((s, i) => {
      if (s.userId && ctx.seatedIds.includes(s.userId)) {
        out.push({ icon: 'user', text: `${i + 1}. Toca para ${name(s.userId)} · ${s.seconds}s`, tone: 'green' })
        rang = true
      }
    })
  }
  if (cfg.missed === 'voicemail') out.push({ icon: 'voicemail', text: rang ? 'Ninguém atendeu: caixa postal' : 'Caixa postal' })
  else if (cfg.missed === 'agent') out.push({ icon: 'agent', text: cfg.missedAgentId ? `${rang ? 'Ninguém atendeu: assistente' : 'Assistente'} ${agentName(ctx.agents, cfg.missedAgentId)} assume` : 'Escolha o assistente que assume' })
  else out.push({ icon: 'end', text: 'Chamada encerrada', tone: 'muted' })
  return out
}

export const contactLabel = (c: Contact) => `${c.firstName} ${c.lastName ?? ''}`.trim()

export const TIMEZONES = ['America/Sao_Paulo', 'America/Manaus', 'America/Belem', 'America/Fortaleza', 'America/Recife', 'America/Cuiaba', 'America/Rio_Branco', 'America/Noronha', 'Europe/Lisbon', 'UTC']

export const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

/** E.164 compacto exibido em fonte monoespaçada na escolha do número (PB-02). */
export const compactE164 = (n: string) => n.replace(/[^\d+]/g, '')

/** "+55 11 90000-0123" → "+55 11 90000 0123" (cabeçalho/telefone do navegador, monoespaçado). */
export const spacedNumber = (n: string) => n.replace(/-/g, ' ')
