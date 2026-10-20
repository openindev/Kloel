import { useSyncExternalStore } from 'react'
import { addDays, startOfDay } from 'date-fns'
import type { Booking, Campaign, Conversation, DemoDB, EventType } from '@/domain/types'
import '@/domain/ext/mais-a'
import { useStore } from '@/data/store'
import { runSteps } from '@/services'
import { hash } from '@/services/runtime'
import { OUTBOUND_SCRIPTS, outboundDuration, renderOutbound, type OutboundOutcome } from '@/data/seed/modules/mais-a'
import { availableSlots, busyFor, fmtLongDay, fmtTime, noticesFor, smsQuotaOf } from '../scheduling/slots'
import { locationKindOf, meetingLinkFor, webhookDeliveriesFor } from '../scheduling/model'
import { uid } from '@/lib/utils'

/**
 * Simulação de campanha outbound (nenhuma ligação real): percorre os contatos, "liga" via runSteps
 * (respeita velocidade e "Simular falha"), cria conversas outbound com resultado determinístico e
 * atualiza estatísticas/resultados da campanha no store. Um resultado "Consulta agendada" cria o
 * Booking correspondente no tipo de evento vinculado ao assistente (Agendador).
 */

const active = new Set<string>()
const labels = new Map<string, string>()
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export const isActive = (id: string) => active.has(id)

export function useRunnerLabel(id: string | undefined) {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => (id ? labels.get(id) ?? '' : ''),
  )
}

function pickOutcome(seed: string): OutboundOutcome {
  const n = hash(seed) % 100
  if (n < 30) return 'appointment'
  if (n < 55) return 'resolved'
  if (n < 65) return 'transferred'
  if (n < 82) return 'outbound_no_answer'
  return 'voicemail'
}

export function computeStats(c: Campaign): Campaign['stats'] {
  const r = Object.values(c.results ?? {})
  return {
    called: r.length,
    reached: r.filter((x) => x.result !== 'outbound_no_answer' && x.result !== 'voicemail').length,
    resolved: r.filter((x) => x.result === 'appointment' || x.result === 'resolved').length,
  }
}

export const NO_NUMBER_ERROR = 'O número de saída desta campanha não está mais disponível. Escolha um número com ligações de saída para continuar.'

/** Número de saída válido da campanha (existe, é da organização e faz ligações outbound). */
export function outboundNumberOf(db: DemoDB, c: Campaign) {
  return db.phoneNumbers.find((n) => n.id === c.phoneNumberId && n.orgId === c.orgId && n.capabilities.includes('outbound'))
}

/** Tipo de evento que o assistente pode agendar (painel "Agendar compromissos" ou aba Agentes do Agendador). */
function eventTypeFor(db: DemoDB, agentId: string): EventType | undefined {
  const agent = db.agents.find((a) => a.id === agentId)
  const ids = [...(agent?.scheduling.map((s) => s.eventTypeId).filter(Boolean) as string[] ?? []), ...db.eventTypes.filter((e) => e.agentIds.includes(agentId)).map((e) => e.id)]
  const calendars = new Set(db.calendarConnections.map((c) => c.id))
  return ids.map((id) => db.eventTypes.find((e) => e.id === id)).find((e): e is EventType => !!e && e.active !== false && !!e.calendarId && calendars.has(e.calendarId))
}

/** Primeiros horários livres do tipo de evento (até 14 dias à frente), como o assistente ofereceria na ligação. */
function firstSlots(db: DemoDB, et: EventType, count: number, now = new Date()): Date[] {
  const busy = busyFor(et, db.eventTypes.filter((e) => e.orgId === et.orgId), db.bookings)
  const ofType = db.bookings.filter((b) => b.eventTypeId === et.id)
  const out: Date[] = []
  for (let i = 1; i <= Math.min(14, et.maxDaysAhead) && out.length < count; i++) {
    const day = addDays(startOfDay(now), i)
    const s = availableSlots(et, day, busy, ofType, now)
    // um horário de manhã e outro à tarde, se houver
    const pickIdx = [Math.floor(s.length * 0.2), Math.floor(s.length * 0.7)]
    for (const k of pickIdx) if (s[k] && out.length < count && !out.some((x) => x.getTime() === s[k]!.getTime())) out.push(s[k]!)
  }
  return out
}

const spoken = (d: Date) => `${fmtLongDay(d)} às ${fmtTime(d)}`

export async function runCampaign(_campaignId: string): Promise<never> {
  throw new Error('A execução de campanhas ainda não está disponível. Nenhuma ligação foi iniciada ou agendada.')
}

/* ---------------------- Agendador de campanhas (app inteiro) ---------------------- */

/**
 * Roda em qualquer tela (o módulo é carregado com as rotas): campanhas agendadas vencidas iniciam no horário,
 * e execuções interrompidas por recarregamento ficam pausadas com aviso. Só age com sessão ativa e plano Team/Scale.
 */
function tick() { /* Campaign execution is owned by the backend; no browser scheduler. */ }

declare global {
  interface Window {
    __kloelCampaignTick?: ReturnType<typeof setInterval>
  }
}

if (typeof window !== 'undefined') {
  // HMR/recarga do módulo: um único intervalo por aba
  if (window.__kloelCampaignTick) clearInterval(window.__kloelCampaignTick)
}

export const campaignTick = tick
