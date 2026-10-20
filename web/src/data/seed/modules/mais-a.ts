import type { DemoDB, Booking, Campaign, Conversation, ConversationResult, TranscriptLine } from '@/domain/types'
import '@/domain/ext/mais-a'

/**
 * Seed adicional do módulo "mais-a" (arrays são concatenados ao seed base "Clínica Bem Viver").
 * - Próximos agendamentos do tipo de evento "Avaliação odontológica" (Agendador / página de reserva).
 * - Uma campanha outbound concluída (visível quando o plano de telefone é Team/Scale), com as conversas
 *   outbound geradas por ela. Todos os nomes e telefones são fictícios.
 */

/* ------------------------- Roteiros outbound (campanhas) ------------------------- */

export type OutboundOutcome = Extract<ConversationResult, 'appointment' | 'resolved' | 'transferred' | 'outbound_no_answer' | 'voicemail'>

interface OutboundScript {
  title: string
  summary: string
  endedBy: Conversation['endedBy']
  lines: [number, TranscriptLine['speaker'], string][]
}

export const OUTBOUND_SCRIPTS: Record<OutboundOutcome, OutboundScript> = {
  appointment: {
    title: 'Revisão agendada (campanha)',
    summary: 'Ligação ativa da campanha: o contato aceitou agendar a revisão; horário confirmado e lembrete enviado.',
    endedBy: 'assistant',
    lines: [
      [0, 'assistant', 'Olá, {first}? Aqui é a {agent}, assistente virtual da {company}. Estou ligando porque já está na hora da sua revisão. Podemos agendar?'],
      [9, 'caller', 'Oi! Pode ser, sim.'],
      [12, 'assistant', 'Ótimo! Tenho {slotA} ou {slotB}. Qual prefere?'],
      [19, 'caller', 'Prefiro a segunda opção.'],
      [23, 'assistant', 'Perfeito, agendado para {slot}. Você vai receber a confirmação por mensagem. Até lá!'],
    ],
  },
  resolved: {
    title: 'Lembrete entregue (campanha)',
    summary: 'Ligação ativa da campanha: o contato recebeu o lembrete e preferiu retornar depois para marcar.',
    endedBy: 'caller',
    lines: [
      [0, 'assistant', 'Olá, {first}? Aqui é a {agent}, da {company}. Estou ligando para lembrar da sua revisão semestral.'],
      [8, 'caller', 'Ah, obrigado pelo lembrete! Esta semana está corrida, eu ligo para marcar depois.'],
      [15, 'assistant', 'Sem problemas! Quando quiser, é só ligar ou mandar mensagem. Tenha um ótimo dia!'],
    ],
  },
  transferred: {
    title: 'Dúvida financeira – transferida (campanha)',
    summary: 'Ligação ativa da campanha: o contato pediu para falar sobre um pagamento e foi transferido para a recepção.',
    endedBy: 'system',
    lines: [
      [0, 'assistant', 'Olá, {first}? Aqui é a {agent}, da {company}. Estou ligando sobre a sua revisão semestral.'],
      [7, 'caller', 'Oi! Antes disso, queria falar com alguém sobre um boleto em aberto.'],
      [13, 'assistant', 'Claro! Vou transferir você agora para a nossa recepção.'],
    ],
  },
  outbound_no_answer: {
    title: 'Sem resposta (campanha)',
    summary: 'Ligação ativa da campanha não atendida.',
    endedBy: 'system',
    lines: [[0, 'system', 'Chamando… ninguém atendeu após 30 segundos.']],
  },
  voicemail: {
    title: 'Recado deixado na caixa postal (campanha)',
    summary: 'Ligação ativa da campanha caiu na caixa postal; a assistente deixou um recado curto.',
    endedBy: 'assistant',
    lines: [
      [0, 'system', 'Caixa postal detectada.'],
      [3, 'assistant', 'Olá, {first}! Aqui é a {agent}, da {company}. Estamos ligando para agendar sua revisão. Retorne quando puder. Obrigada!'],
    ],
  },
}

/** Horários falados no roteiro "appointment" quando a ligação não traz horários reais (seed antigo). */
const DEFAULT_SLOTS = { slotA: 'terça às 10h', slotB: 'quinta às 15h', slot: 'quinta às 15h' }

export function renderOutbound(outcome: OutboundOutcome, vars: { agent: string; company: string; first: string; slotA?: string; slotB?: string; slot?: string }): TranscriptLine[] {
  const all: Record<string, string> = { ...DEFAULT_SLOTS, ...(Object.fromEntries(Object.entries(vars).filter(([, v]) => v !== undefined)) as Record<string, string>) }
  return OUTBOUND_SCRIPTS[outcome].lines.map(([t, speaker, text]) => ({
    t,
    speaker,
    text: text.replace(/\{(\w+)\}/g, (_, k: string) => all[k] ?? ''),
  }))
}

/** Duração total simulada de uma ligação outbound (determinística). */
export function outboundDuration(outcome: OutboundOutcome, salt: number) {
  const last = OUTBOUND_SCRIPTS[outcome].lines.at(-1)?.[0] ?? 0
  if (outcome === 'outbound_no_answer') return 30
  return last + 6 + (salt % 17)
}

/* --------------------------------- Seed --------------------------------- */

const DAY = 86400000

function nextBusinessDays(now: Date, count: number): Date[] {
  const out: Date[] = []
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  while (out.length < count) {
    d.setTime(d.getTime() + DAY)
    const wd = d.getDay()
    if (wd >= 1 && wd <= 5) out.push(new Date(d))
  }
  return out
}

export default function seed(now: Date): Partial<DemoDB> {
  const orgId = 'org_bemviver'
  const iso = (ms: number) => new Date(ms).toISOString()

  // Próximos agendamentos (horários dentro da disponibilidade seg–sex 08:00–18:00)
  const days = nextBusinessDays(now, 4)
  const upcoming: Array<[number, number, number, string, string, Booking['source']]> = [
    [0, 9, 0, 'Helena Prado', '+55 11 90000-0611', 'agent'],
    [0, 14, 30, 'Otávio Reis', '+55 11 90000-0612', 'booking_page'],
    [1, 10, 0, 'Sofia Campos', '+55 11 90000-0613', 'agent'],
    [3, 16, 0, 'Marcelo Tavares', '+55 11 90000-0614', 'booking_page'],
  ]
  const bookings: Booking[] = upcoming.map(([di, h, m, name, phone, source], i) => {
    const d = new Date(days[di]!)
    d.setHours(h, m, 0, 0)
    const email = source === 'booking_page' ? `${name.split(' ')[0]!.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')}@exemplo.com.br` : undefined
    const createdAt = iso(now.getTime() - (i + 1) * DAY)
    // avisos simulados registrados conforme a aba Notificações do tipo de evento (confirmação, lembrete 24 h, equipe)
    const notices: NonNullable<Booking['notices']> = [
      ...(email
        ? [
            { kind: 'confirmation' as const, channel: 'email' as const, to: email, at: createdAt },
            { kind: 'reminder' as const, channel: 'email' as const, to: email, at: iso(Math.max(d.getTime() - DAY, now.getTime())) },
          ]
        : []),
      { kind: 'team' as const, channel: 'team' as const, to: 'agenda@bemviver.example', at: createdAt },
    ]
    return {
      notices,
      id: `bkg_up_${i + 1}`,
      orgId,
      eventTypeId: 'evt_avaliacao',
      name,
      phone,
      email,
      startsAt: d.toISOString(),
      status: 'confirmed',
      source,
      answers: { dc_nome: name, dc_tel: phone },
      createdAt,
    }
  })

  // Campanha concluída (aparece em /app/campaigns quando o plano Voice for Team/Scale)
  const firsts = ['Mariana', 'João', 'Beatriz', 'Carlos', 'Fernanda', 'Rafael', 'Juliana', 'Pedro']
  const outcomes: OutboundOutcome[] = ['appointment', 'resolved', 'outbound_no_answer', 'voicemail', 'appointment', 'resolved', 'outbound_no_answer', 'transferred']
  const started = now.getTime() - 24 * DAY - 6 * 3600 * 1000
  const conversations: Conversation[] = outcomes.map((outcome, i) => {
    const script = OUTBOUND_SCRIPTS[outcome]
    const at = started + i * 4 * 60 * 1000
    return {
      id: `cnv_cmp_${String(i + 1).padStart(2, '0')}`,
      orgId,
      agentId: 'agt_roberta',
      channel: 'phone',
      direction: 'outbound',
      title: script.title,
      summary: script.summary,
      result: outcome,
      startedAt: iso(at),
      durationSec: outboundDuration(outcome, i * 7),
      callerNumber: '+55 11 90000-0200',
      calleeNumber: `+55 11 90000-${String(i + 1).padStart(4, '0')}`,
      contactId: `cnt_${i + 1}`,
      transcript: renderOutbound(outcome, { agent: 'Roberta', company: 'Clínica Bem Viver', first: firsts[i]! }),
      endedBy: script.endedBy,
      starred: false,
      archived: false,
      read: true,
      tagIds: [],
      simulated: true,
      campaignId: 'cmp_revisao',
    }
  })
  const results: NonNullable<Campaign['results']> = {}
  conversations.forEach((c) => {
    if (c.durationSec == null) return
    results[c.contactId!] = { result: c.result, conversationId: c.id, durationSec: c.durationSec, at: c.startedAt }
  })
  // ligações "Consulta agendada" da campanha viram agendamentos (já realizados) no Agendador — quinta seguinte às 15h, como no roteiro
  conversations.forEach((c, i) => {
    if (c.result !== 'appointment') return
    const d = new Date(c.startedAt)
    d.setHours(15, 0, 0, 0)
    do d.setDate(d.getDate() + 1)
    while (d.getDay() !== 4)
    // duas ligações da mesma campanha marcaram "quinta às 15h": a segunda fica na quinta seguinte, mesmo horário (sem reserva
    // dupla no mesmo horário do tipo de evento; mesma regra usada para bkg_1…bkg_10 em demo.ts)
    while (bookings.some((b) => b.eventTypeId === 'evt_avaliacao' && b.startsAt === d.toISOString())) d.setDate(d.getDate() + 7)
    bookings.push({
      id: `bkg_cmp_${String(i + 1).padStart(2, '0')}`,
      orgId,
      eventTypeId: 'evt_avaliacao',
      name: firsts[i]!,
      phone: c.calleeNumber,
      startsAt: d.toISOString(),
      status: 'confirmed',
      source: 'agent',
      conversationId: c.id,
      createdAt: c.startedAt,
      notices: [{ kind: 'team', channel: 'team', to: 'agenda@bemviver.example', at: c.startedAt }],
    })
  })
  const reached = conversations.filter((c) => c.result !== 'outbound_no_answer' && c.result !== 'voicemail').length
  const campaign: Campaign = {
    id: 'cmp_revisao',
    orgId,
    name: 'Revisão semestral – setembro',
    agentId: 'agt_roberta',
    phoneNumberId: 'num_sp',
    contactIds: conversations.map((c) => c.contactId!),
    status: 'completed',
    stats: { called: conversations.length, reached, resolved: conversations.filter((c) => c.result === 'appointment' || c.result === 'resolved').length },
    createdAt: iso(started - 2 * DAY),
    objective: 'Lembrar pacientes da revisão semestral e oferecer um horário de avaliação.',
    startedAt: iso(started),
    completedAt: iso(started + outcomes.length * 4 * 60 * 1000),
    results,
  }

  return { bookings, campaigns: [campaign], conversations }
}
