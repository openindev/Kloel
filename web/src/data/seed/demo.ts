import type { DemoDB, Conversation, Contact, KnowledgeEntry, ConversationChannel } from '@/domain/types'
import { createRng } from './rng'
import { makeAgent, defaultContactSettings, defaultBillingProfile } from './defaults'
import { SCENARIOS, renderLines } from './scenarios'
import '@/domain/ext/scheduling'

export const DEMO_LOGIN = { email: 'demo@kloel.ai', password: 'demo1234' }
const COMPANY = 'Clínica Bem Viver'

const FIRST = ['Mariana', 'João', 'Beatriz', 'Carlos', 'Fernanda', 'Rafael', 'Juliana', 'Pedro', 'Camila', 'Lucas', 'Larissa', 'Gustavo', 'Patrícia', 'Diego', 'Aline', 'Bruno', 'Vanessa', 'Thiago', 'Renata', 'Felipe', 'Paula', 'André', 'Tatiane', 'Rodrigo']
const LAST = ['Almeida', 'Souza', 'Lima', 'Pereira', 'Costa', 'Rodrigues', 'Oliveira', 'Santos', 'Ferreira', 'Gomes', 'Martins', 'Araújo', 'Ribeiro', 'Carvalho', 'Barbosa', 'Rocha', 'Dias', 'Teixeira', 'Moreira', 'Cardoso', 'Nunes', 'Mendes', 'Freitas', 'Vieira']
const COMPANIES = ['', '', 'Padaria Pão Dourado', 'Mercado Bom Preço', 'Escritório Lima & Costa', '', 'Academia Movimento', '', 'Auto Center Rocha', '']

/** Telefones fictícios (padrão +55 11 90000-0NNN) — não pertencem a pessoas reais. */
const fakePhone = (n: number) => `+55 11 90000-${String(n).padStart(4, '0')}`

/** Endereço fictício da clínica (mesmo da base de conhecimento) — exibido no tipo de evento "Local físico". */
const CLINIC_ADDRESS = 'Rua das Acácias, 200 – Vila Mariana, São Paulo – SP'

/**
 * Início dos agendamentos `bkg_N` (conversas com resultado "Consulta agendada"): o dia e a hora combinados na transcrição
 * do cenário (scenarios.ts — "quinta às 14h", "quarta às 9h"), na semana seguinte à conversa. Ficam dentro da
 * disponibilidade do tipo de evento (seg–sex 08:00–18:00, 30 min) no fuso America/Sao_Paulo (UTC−3 fixo, sem horário de
 * verão desde 2019). Um horário já ocupado — por outro `bkg_N` ou pelos "Próximos agendamentos" do seed mais-a (1º dia
 * útil 09:00 e 14:30, 2º 10:00, 4º 16:00) — passa para a mesma hora da semana seguinte, então nada se sobrepõe.
 */
const SP_OFFSET_MS = -3 * 3600 * 1000
const SCENARIO_SLOT: Record<string, [weekday: number, hour: number, minute: number]> = {
  'Agendamento de avaliação': [4, 14, 0],
  'Remarcação de consulta': [3, 9, 0],
}
const FALLBACK_SLOT: [number, number, number] = [2, 11, 0]
/** Relógio de São Paulo nos campos UTC de um Date. */
const spWall = (ms: number) => new Date(ms + SP_OFFSET_MS)
const fromSpWall = (y: number, mo: number, d: number, h: number, mi: number) => Date.UTC(y, mo, d, h, mi) - SP_OFFSET_MS

function seedBookingStarts(appointments: Conversation[], now: Date, dayMs: number): string[] {
  const taken = new Set<number>()
  const today = spWall(now.getTime())
  const business: [number, number, number][] = []
  for (let k = 1; business.length < 4; k++) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + k))
    if (d.getUTCDay() >= 1 && d.getUTCDay() <= 5) business.push([d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()])
  }
  for (const [i, h, m] of [[0, 9, 0], [0, 14, 30], [1, 10, 0], [3, 16, 0]] as const) taken.add(fromSpWall(...business[i]!, h, m))
  return appointments.map((c) => {
    const [wd, h, m] = SCENARIO_SLOT[c.title] ?? FALLBACK_SLOT
    const w = spWall(new Date(c.startedAt).getTime())
    const ahead = (wd - w.getUTCDay() + 7) % 7 || 7
    let t = fromSpWall(w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate() + ahead, h, m)
    while (taken.has(t)) t += 7 * dayMs
    taken.add(t)
    return new Date(t).toISOString()
  })
}

export function buildDemoOrg(now = new Date()): Partial<DemoDB> {
  const rng = createRng(20261018)
  const orgId = 'org_bemviver'
  const userId = 'usr_ana'
  const day = 86400000
  const iso = (ms: number) => new Date(ms).toISOString()

  const roberta = makeAgent(orgId, 'Roberta', 'voice', COMPANY, {
    id: 'agt_roberta', voiceId: 'camila',
    companyInfo: 'A Clínica Bem Viver é uma clínica odontológica em São Paulo (Rua das Acácias, 200 – Vila Mariana). Atendemos de segunda a sexta das 8h às 19h e aos sábados das 8h às 12h. Especialidades: clínica geral, ortodontia, implantes e clareamento.',
    prompt: 'Você é a Roberta – a recepcionista virtual da Clínica Bem Viver. Responda de forma amigável e objetiva, agende avaliações e transfira urgências para a recepção.',
    transfers: [{ id: 'trf_recepcao', mode: 'phone', label: 'Recepção', destination: '+55 11 90000-0100', description: 'Urgências, dor forte ou pedidos para falar com uma pessoa.', checkAvailability: false, emailOnFailure: false, whisper: '' }],
    emails: [{ id: 'eml_resumo', name: 'Resumo para a equipe', timing: 'after', when: 'always', recipientsMode: 'fixed', recipients: ['recepcao@bemviver.example'], messageMode: 'ai', subject: 'Resumo da ligação', body: '', aiInstruction: 'Envie um resumo curto com nome, motivo do contato e próximos passos.' }],
    scheduling: [{ id: 'sch_aval', provider: 'kloel', name: 'Avaliação odontológica', eventTypeId: 'evt_avaliacao', settings: {} }],
    createdAt: iso(now.getTime() - 120 * day),
  })
  roberta.greetingPersonalized = true
  const joana = makeAgent(orgId, 'Joana', 'voice', COMPANY, { id: 'agt_joana', voiceId: 'joana', createdAt: iso(now.getTime() - 60 * day) })
  joana.greeting = `Olá, aqui é a Joana do suporte da ${COMPANY}. Em que posso ajudar?`
  const maria = makeAgent(orgId, 'Maria', 'chat', COMPANY, { id: 'agt_maria', createdAt: iso(now.getTime() - 30 * day), webchat: { color: '#585DF5', position: 'right', title: 'Maria – Bem Viver', welcome: 'Olá! Eu sou a Maria, assistente virtual da Clínica Bem Viver. Como posso ajudar?', website: 'https://bemviver.example' } })
  maria.contactsEnabled = false

  const contacts: Contact[] = Array.from({ length: 24 }, (_, i) => {
    const firstName = FIRST[i]!
    const lastName = LAST[(i * 7) % LAST.length]!
    return {
      id: `cnt_${i + 1}`, orgId, firstName, lastName,
      phones: [{ value: fakePhone(i + 1), label: i % 3 === 0 ? 'WORK' : '' }],
      emails: i % 2 === 0 ? [{ value: `${firstName.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')}.${lastName.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')}@exemplo.com.br`, label: '' }] : [],
      company: COMPANIES[i % COMPANIES.length]!, ownerId: i % 4 === 0 ? userId : undefined,
      notes: i % 5 === 0 ? 'Prefere contato pelo WhatsApp no fim da tarde.' : '',
      fields: { sf_pref: i % 3 === 0 ? 'Prefere atendimento à tarde' : '', sf_conv: i % 2 === 0 ? 'OdontoMais' : '' },
      source: i % 3 === 0 ? 'conversation' : 'manual',
      createdAt: iso(now.getTime() - (90 - i * 3) * day), updatedAt: iso(now.getTime() - (20 - (i % 20)) * day),
    }
  })

  const agentIds = ['agt_roberta', 'agt_roberta', 'agt_roberta', 'agt_joana', 'agt_maria']
  const conversations: Conversation[] = []
  for (let i = 0; i < 72; i++) {
    const agentId = rng.pick(agentIds)
    const isChat = agentId === 'agt_maria'
    const channel: ConversationChannel = isChat ? (rng.chance(0.6) ? 'whatsapp' : 'webchat') : rng.chance(0.15) ? 'web' : 'phone'
    const scenario = rng.pick(SCENARIOS)
    const contact = rng.chance(0.7) ? rng.pick(contacts) : undefined
    const caller = contact ? `${contact.firstName} ${contact.lastName}` : rng.pick(FIRST)
    const agentName = agentId === 'agt_roberta' ? 'Roberta' : agentId === 'agt_joana' ? 'Joana' : 'Maria'
    const daysAgo = Math.floor(Math.pow(rng.next(), 1.6) * 88)
    const started = now.getTime() - daysAgo * day - rng.int(0, 10 * 3600) * 1000 - 3600 * 1000
    const lines = renderLines(scenario, { agent: agentName, company: COMPANY, caller, first: caller.split(' ')[0]! })
    const duration = (lines[lines.length - 1]?.t ?? 10) + rng.int(4, 40)
    conversations.push({
      id: `cnv_${String(i + 1).padStart(3, '0')}`, orgId, agentId, channel,
      direction: rng.chance(0.08) ? 'outbound' : 'inbound',
      title: scenario.title, summary: scenario.summary, result: scenario.result,
      startedAt: iso(started), durationSec: duration,
      callerNumber: channel === 'webchat' || channel === 'web' ? undefined : contact?.phones[0]?.value ?? fakePhone(500 + i),
      calleeNumber: channel === 'phone' ? '+55 11 90000-0200' : undefined,
      contactId: contact?.id, transcript: lines, endedBy: scenario.endedBy,
      starred: rng.chance(0.08), archived: rng.chance(0.05), read: daysAgo > 1 || rng.chance(0.5), tagIds: rng.chance(0.15) ? ['tag_retorno'] : [], simulated: true,
    })
  }
  conversations.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  const appointments = conversations.filter((c) => c.result === 'appointment').slice(0, 10)
  const bookingStarts = seedBookingStarts(appointments, now, day)

  const kb: [string, string][] = [
    ['Qual é o horário de funcionamento?', 'De segunda a sexta, das 8h às 19h, e aos sábados das 8h às 12h.'],
    ['Onde fica a clínica?', 'Rua das Acácias, 200 – Vila Mariana, São Paulo – SP. Há estacionamento conveniado ao lado.'],
    ['Vocês aceitam convênio?', 'Aceitamos OdontoMais, Sorriso Total e Dental Prime. Traga a carteirinha e um documento com foto.'],
    ['Quanto custa a avaliação?', 'A primeira avaliação é gratuita para novos pacientes.'],
    ['Quanto custa o clareamento?', 'O clareamento a laser começa em R$ 890, com parcelamento em até 6x sem juros.'],
    ['Vocês fazem implantes?', 'Sim. O implante é planejado após avaliação e tomografia; o valor depende de cada caso.'],
    ['Atendem crianças?', 'Sim, temos odontopediatria às terças e quintas.'],
    ['Como remarcar uma consulta?', 'Pode remarcar por telefone ou WhatsApp com até 24 horas de antecedência, sem custo.'],
    ['Quais formas de pagamento?', 'Pix, cartão de débito e crédito (até 6x sem juros) e boleto para tratamentos acima de R$ 1.500.'],
    ['Têm atendimento de urgência?', 'Sim. Em caso de dor forte, transferimos para a recepção para um encaixe no mesmo dia.'],
    ['Fazem aparelho invisível?', 'Sim, trabalhamos com alinhadores transparentes após avaliação ortodôntica.'],
    ['Precisa de jejum para extração?', 'Não é necessário jejum. Recomendamos uma refeição leve antes do procedimento.'],
  ]
  const knowledgeEntries: KnowledgeEntry[] = kb.map(([question, answer], i) => ({
    id: `kbe_${i + 1}`, orgId, agentId: 'agt_roberta', question, answer, source: i < 8 ? 'website' : 'manual',
    sourceLabel: i < 8 ? 'bemviver.example' : undefined, usageCount: i % 4 === 0 ? rng.int(1, 9) : 0, createdAt: iso(now.getTime() - 100 * day),
  }))

  return {
    session: { orgId, userId },
    organizations: [{ id: orgId, name: COMPANY, slug: 'clinica-bem-viver', timezone: 'America/Sao_Paulo', website: 'https://bemviver.example', sector: 'Saúde', size: '2-10', onboardingCompleted: true, createdAt: iso(now.getTime() - 120 * day) }],
    users: [
      { id: userId, firstName: 'Ana', lastName: 'Ribeiro', email: DEMO_LOGIN.email, password: DEMO_LOGIN.password, phone: '', language: 'pt-BR', createdAt: iso(now.getTime() - 120 * day) },
      { id: 'usr_carlos', firstName: 'Carlos', lastName: 'Mendes', email: 'carlos@bemviver.example', password: 'demo1234', language: 'pt-BR', createdAt: iso(now.getTime() - 50 * day) },
    ],
    memberships: [
      { id: 'mbr_ana', orgId, userId, role: 'admin', joinedAt: iso(now.getTime() - 120 * day) },
      { id: 'mbr_carlos', orgId, userId: 'usr_carlos', role: 'editor', joinedAt: iso(now.getTime() - 50 * day) },
    ],
    invites: [{ id: 'inv_1', orgId, email: 'paula@bemviver.example', firstName: 'Paula', lastName: 'Dias', role: 'viewer', status: 'expired', createdAt: iso(now.getTime() - 12 * day), lastSentAt: iso(now.getTime() - 12 * day), expiresAt: iso(now.getTime() - 5 * day) }],
    agents: [roberta, joana, maria],
    knowledgeEntries,
    knowledgeSources: [
      { id: 'kbs_site', orgId, agentId: 'agt_roberta', type: 'website', label: 'bemviver.example', pages: 6, status: 'ready', enabled: true, updatedAt: iso(now.getTime() - 3600 * 1000) },
    ],
    conversations,
    tags: [
      { id: 'tag_retorno', orgId, label: 'Retornar ligação', color: 'amber', autoAdd: false },
      { id: 'tag_vip', orgId, label: 'Paciente VIP', color: 'violet', autoAdd: false },
    ],
    contacts,
    contactSettings: [{ ...defaultContactSettings(orgId), smartFields: [
      { id: 'sf_pref', label: 'Preferências pessoais', type: 'text', description: 'Preferências de horário e de contato.', aiFill: true },
      { id: 'sf_conv', label: 'Convênio', type: 'text', description: 'Convênio odontológico informado pelo paciente.', aiFill: true },
    ] }],
    phoneNumbers: [
      { id: 'num_sp', orgId, name: 'Recepção SP', number: '+55 11 90000-0200', country: 'BR', kind: 'purchased', capabilities: ['inbound', 'outbound'], agentId: 'agt_roberta', minutesUsed: 312, verified: true, createdAt: iso(now.getTime() - 110 * day) },
      { id: 'num_sip', orgId, name: 'PABX da clínica', number: 'sip-bemviver-01', country: 'BR', kind: 'sip', capabilities: ['inbound'], agentId: 'agt_joana', minutesUsed: 41, verified: true, sip: { terminationUrl: '', username: '', password: '' }, createdAt: iso(now.getTime() - 40 * day) },
    ],
    whatsappAccounts: [],
    calendarConnections: [{ id: 'cal_google', orgId, provider: 'google', email: 'agenda@bemviver.example', scope: 'shared', features: ['calendar'], ownerUserId: userId, connectedAt: iso(now.getTime() - 90 * day) }],
    eventTypes: [{
      id: 'evt_avaliacao', orgId, name: 'Avaliação odontológica', slug: 'avaliacao', durationMin: 30, description: 'Primeira avaliação gratuita para novos pacientes.', calendarId: 'cal_google', location: 'in_person', locationAddress: CLINIC_ADDRESS,
      availability: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day: d, enabled: d >= 1 && d <= 5, from: '08:00', to: '18:00' })), bufferMin: 10, minNoticeHours: 4, maxDaysAhead: 30,
      notifications: { confirmationEmail: true, reminderEmail: true, reminderHours: 24, smsReminder: false, notifyTeam: true },
      dataCollection: [{ id: 'dc_nome', label: 'Nome completo', required: true, type: 'text' }, { id: 'dc_tel', label: 'Telefone', required: true, type: 'phone' }],
      agentIds: ['agt_roberta'], advanced: { allowReschedule: true, allowCancel: true, slotIntervalMin: 30, maxPerDay: 12 }, createdAt: iso(now.getTime() - 90 * day),
    }],
    bookings: appointments.map((c, i) => ({
      id: `bkg_${i + 1}`, orgId, eventTypeId: 'evt_avaliacao', name: c.contactId ? contacts.find((x) => x.id === c.contactId)!.firstName : 'Paciente', startsAt: bookingStarts[i]!, status: 'confirmed' as const, source: 'agent' as const, conversationId: c.id,
    })),
    emailInboxes: [],
    emailMessages: [],
    apiKeys: [{ id: 'key_1', orgId, name: 'Integração n8n (produção)', prefix: 'klo_live_', secret: 'klo_live_••••••••••••3f9a', createdAt: iso(now.getTime() - 20 * day), lastUsedAt: iso(now.getTime() - 1 * day) }],
    integrationRequests: [],
    campaigns: [],
    subscriptions: [
      { id: 'sub_whatsapp', orgId, product: 'whatsapp', plan: 'solo', interval: 'monthly', status: 'active', priceMonthly: 499, startedAt: iso(now.getTime() - 30 * day), renewsAt: iso(now.getTime() + 30 * day) },
      { id: 'sub_voice', orgId, product: 'voice', plan: 'solo', interval: 'monthly', status: 'active', priceMonthly: 719, startedAt: iso(now.getTime() - 120 * day), renewsAt: iso(now.getTime() + 15 * day) },
      { id: 'sub_webchat', orgId, product: 'webchat', plan: 'solo', interval: 'monthly', status: 'active', priceMonthly: 299, startedAt: iso(now.getTime() - 30 * day), renewsAt: iso(now.getTime() + 30 * day) },
    ],
    invoices: [0, 1, 2, 3].map((m) => ({ id: `inv_${m}`, orgId, number: `KL-2026-${String(1042 - m)}`, date: iso(now.getTime() - m * 30 * day), amount: m < 1 ? 1517 : 719, status: 'paid' as const, description: 'Assinatura Kloel' })),
    billingProfiles: [{ ...defaultBillingProfile(orgId, COMPANY), line1: 'Rua das Acácias, 200', city: 'São Paulo', state: 'SP', postalCode: '04000-000', email: 'financeiro@bemviver.example', card: { brand: 'Visa', last4: '4242', expMonth: 12, expYear: 2029, holder: 'CLINICA BEM VIVER' } }],
    referrals: [
      { id: 'ref_1', orgId, name: 'Padaria Pão Dourado', email: 'contato@paodourado.example', status: 'active', credit: 1800, createdAt: iso(now.getTime() - 40 * day) },
      { id: 'ref_2', orgId, name: 'Academia Movimento', email: 'gestao@movimento.example', status: 'signed_up', credit: 0, createdAt: iso(now.getTime() - 5 * day) },
    ],
  }
}
