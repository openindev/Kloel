import type { AgentTechnical, Conversation, DemoDB, Invoice, KnowledgeEntry, KnowledgeSource, Organization, Subscription, TranscriptLine } from '@/domain/types'
import '@/domain/ext/billing'
import '@/domain/ext/agents'
import { makeAgent, defaultBillingProfile, defaultContactSettings, defaultTechnical } from './defaults'
import MIRROR_KNOWLEDGE from './mirror-knowledge.json'

declare module '@/domain/types' {
  interface Organization {
    /** só na organização do espelho: versão dos dados do espelho já aplicada a este banco (MIRROR_SEED_VERSION / withMirrorScenario) */
    mirrorSeedVersion?: number
  }
}

/**
 * Versão dos dados do espelho. Ao mudar o espelho (novas entradas, exemplos do Técnico, conversa…), incremente e acrescente o passo
 * correspondente em `migrateMirror`: bancos já gravados no navegador recebem os dados novos sem perder o que o usuário criou.
 * v2 (2026-10-19): 90 entradas de Informações da Roberta (live-compare/C-assistentes/conhecimento-informacoes-fonio.json),
 * exemplos padrão de "Processamento preciso" observados ao vivo e a conversa atual.
 */
export const MIRROR_SEED_VERSION = 2

/**
 * Cenário "espelho": a organização "Kloel Tecnologia" no MESMO estado da conta Fonio ao vivo levantada em 2026-10-18
 * (docs/reference/fonio-live2, spec 09), para o operador navegar nos dois apps lado a lado e ver o mesmo estado:
 * - 2 assistentes de voz, Joana e Roberta, sem número de telefone (C-assistentes/03 · data/switcher.json);
 *   Roberta com a voz Camila, pt-BR, "Conectar contatos" ativo e a fonte de conhecimento "kloel.com" (5 páginas);
 * - 1 conversa: chamada web de 3:02 com a Roberta, resolvida, em 18/10 às 01:35 (D-conversas);
 * - nenhum número de telefone, conta de WhatsApp, calendário/tipo de evento, contato, chave de API ou convite;
 * - assinaturas ativas WhatsApp Solo, Solo (telefone) e Chatbot de IA Solo, add-ons zerados, compra automática ligada e
 *   verificação de identidade em "Ação necessária" (K-admin/01–05): uso 0/1.000 min, 0/450, 0/100, 0/2, 0/1, 1/3, 0/2, até 1.
 * O nome do usuário é FICTÍCIO (mesmas iniciais "DP" do avatar da conta original; os dados pessoais do operador não entram no app).
 * Login: espelho@kloel.ai / demo1234.
 */
export const MIRROR_LOGIN = { email: 'espelho@kloel.ai', password: 'demo1234' }
export const MIRROR_ORG_ID = 'org_kloeltec'
export const MIRROR_USER_ID = 'usr_espelho'
const COMPANY = 'Kloel Tecnologia'

/** Instantes da conta original (BRT = UTC−3): criação 18/10/2026 01:28:09 e conversa às 01:35. */
const CREATED_AT = Date.UTC(2026, 9, 18, 4, 28, 9)
const CALL_AT = Date.UTC(2026, 9, 18, 4, 35, 0)

const L = (t: number, speaker: TranscriptLine['speaker'], text: string): TranscriptLine => ({ t, speaker, text })

/** Transcrição da conversa ao vivo da conta Fonio (live-compare D-conversas/conversa-fonio.json), com a marca trocada. */
const SETUP_CALL: TranscriptLine[] = [
  L(0, 'assistant', 'Olá, aqui é a Roberta da Kloel Tecnologia. Como posso te ajudar?'),
  L(7, 'caller', 'Oi, Roberto, tudo bom?'),
  L(9, 'assistant', 'Oi! Aqui é a Roberta, assistente da Kloel Tecnologia. Tudo bem, e com você? Como posso ajudar hoje?'),
  L(27, 'assistant', 'Alô?'),
  L(29, 'caller', 'Calma aí, Roberto, espera só um minutinho.'),
  L(35, 'assistant', 'Pode continuar, por favor?'),
  L(38, 'caller', 'É, eu só— Tô resolvendo uma questão aqui, mas fica na linha, Roberto, já vou conversar com você.'),
  L(44, 'assistant', 'Claro, fico aguardando você. Pode me chamar quando estiver pronta para continuar.'),
  L(59, 'assistant', 'Alô?'),
  L(60, 'caller', 'Oi, Roberto.'),
  L(62, 'assistant', 'Oi! Pode falar, estou aqui para ajudar.'),
  L(66, 'caller', 'Tá. É... deixa eu pensar o que eu vou falar aqui, um minutinho, um minuto, um minuto, Roberto. Calma aí.'),
  L(76, 'caller', 'Calma aí, Roberto. Tô pensando, não fala nada ainda, Roberto. Isso, calma. E aí, Roberto. Calma aí, calma aí. Tá. Agora. Tá bom, Roberto. E aí, como é que você tá? Tudo bem?'),
  L(96, 'assistant', 'Estou bem, obrigada por perguntar! Como posso ajudar você hoje?'),
  L(100, 'caller', 'Você entende da configuração da Kloel AI?'),
  L(104, 'assistant', 'Eu posso ajudar com informações sobre os modelos de IA que a Kloel oferece, mas não tenho detalhes específicos sobre a configuração da Kloel AI. Posso ajudar com mais alguma coisa?'),
  L(117, 'caller', 'Hã... Aqui na ligação eu tenho a opção de atribuir um número. O que acontece se eu atribuir um número?'),
  L(123, 'assistant', 'Quando você atribui um número, geralmente isso serve para identificar ou organizar algo, como um atendimento, um chamado ou um recurso. Para dar uma resposta mais precisa, você poderia me dizer em qual contexto ou sistema você está atribuindo esse número?'),
  L(138, 'caller', 'Aqui na ligação mesmo aparece "atribuir número". Se eu atribuir o número na ligação, eu vou receber uma ligação no meu número?'),
  L(145, 'assistant', 'Não, atribuir um número na ligação não significa que você vai receber uma ligação no seu número. Geralmente, essa função serve para identificar ou registrar a ligação com um número específico para controle interno. Posso ajudar em mais alguma coisa?'),
  L(163, 'caller', 'Ah, entendi. Roberto. Não, tá tudo bem. Obrigado pela ligação. Você pode encerrar a ligação e desligar aí, por favor?'),
  L(174, 'assistant', 'Vou encerrar a ligação agora. Tenha um ótimo dia!'),
]

export function buildMirrorOrg(now = new Date()): Partial<DemoDB> {
  const orgId = MIRROR_ORG_ID
  const userId = MIRROR_USER_ID
  // Datas absolutas da conta original; num relógio anterior a elas, as mesmas distâncias relativas a "agora".
  const shift = now.getTime() >= CALL_AT + 182_000 ? 0 : now.getTime() - (CALL_AT + 3600_000)
  const created = CREATED_AT + shift
  const iso = (ms: number) => new Date(ms).toISOString()
  const renews = new Date(created)
  renews.setUTCMonth(renews.getUTCMonth() + 1)

  const roberta = makeAgent(orgId, 'Roberta', 'voice', COMPANY, { id: 'agt_kt_roberta', voiceId: 'camila', createdAt: iso(created + 60_000), updatedAt: iso(created + 60_000) })
  const joana = makeAgent(orgId, 'Joana', 'voice', COMPANY, { id: 'agt_kt_joana', voiceId: 'camila', createdAt: iso(created + 120_000), updatedAt: iso(created + 120_000) })

  const organization: Organization = {
    id: orgId,
    name: COMPANY,
    slug: 'kloel-tecnologia',
    timezone: 'America/Sao_Paulo',
    website: 'https://kloel.com',
    onboardingCompleted: true,
    createdAt: iso(created),
    mirrorSeedVersion: MIRROR_SEED_VERSION,
  }

  const conversation: Conversation = {
    id: 'cnv_kt_setup',
    orgId,
    agentId: roberta.id,
    channel: 'web',
    direction: 'inbound',
    title: 'Configuração Kloel AI',
    summary: 'Perguntou sobre a configuração da Kloel AI e sobre atribuir um número; recebeu explicação e encerrou.',
    outcomes: ['Informação fornecida'],
    result: 'resolved',
    startedAt: iso(CALL_AT + shift),
    durationSec: 182,
    transcript: SETUP_CALL,
    endedBy: 'assistant',
    starred: false,
    archived: false,
    read: true,
    tagIds: [],
    simulated: true,
  }

  const sub = (id: string, product: Subscription['product'], priceMonthly: number): Subscription => ({
    id, orgId, product, plan: 'solo', interval: 'monthly', status: 'active', priceMonthly, startedAt: iso(created), renewsAt: renews.toISOString(),
  })

  const invoice: Invoice = {
    id: 'inv_kt_1',
    orgId,
    number: 'KL-2026-1043',
    date: iso(created),
    amount: 1517,
    status: 'paid',
    description: 'Assinatura Kloel',
    lines: [
      { label: 'kloel Assinatura WhatsApp Solo', amount: 499 },
      { label: 'kloel Assinatura Solo', amount: 719 },
      { label: 'kloel Chatbot de IA Solo', amount: 299 },
    ],
    cardLabel: 'Visa •••• 4242',
    simulated: true,
  }

  const source: KnowledgeSource = {
    id: 'kbs_kt_site', orgId, agentId: roberta.id, type: 'website', label: 'kloel.com', pages: 5, status: 'ready', enabled: true, updatedAt: iso(created + 6 * 60_000),
  }

  const knowledgeEntries = mirrorKnowledgeEntries(orgId, roberta.id, source, iso(created + 6 * 60_000))

  return {
    organizations: [organization],
    users: [{ id: userId, firstName: 'Diego', lastName: 'Prado', email: MIRROR_LOGIN.email, password: MIRROR_LOGIN.password, phone: '', language: 'pt-BR', createdAt: iso(created) }],
    memberships: [{ id: 'mbr_espelho', orgId, userId, role: 'admin', joinedAt: iso(created) }],
    agents: [roberta, joana],
    knowledgeSources: [source],
    knowledgeEntries,
    conversations: [conversation],
    contactSettings: [defaultContactSettings(orgId)],
    subscriptions: [sub('sub_kt_whatsapp', 'whatsapp', 499), sub('sub_kt_voice', 'voice', 719), sub('sub_kt_webchat', 'webchat', 299)],
    invoices: [invoice],
    billingProfiles: [{
      ...defaultBillingProfile(orgId, COMPANY),
      autoBuyAddOns: true,
      identity: 'action_required',
      card: { brand: 'Visa', last4: '4242', expMonth: 12, expYear: 2029, holder: 'KLOEL TECNOLOGIA' },
    }],
  }
}

/**
 * Aba Conhecimento › Informações da Roberta: as 90 entradas da conta original, na ordem exibida (mesmo createdAt → a lista mantém a
 * ordem do array), com origem (site "kloel.com" = fonte kbs_kt_site; "Gerado automaticamente") e o selo de uso "N×".
 */
function mirrorKnowledgeEntries(orgId: string, agentId: string, site: KnowledgeSource, createdAt: string): KnowledgeEntry[] {
  return MIRROR_KNOWLEDGE.entries.map((e, i) => ({
    id: `kbe_kt_${String(i + 1).padStart(3, '0')}`,
    orgId,
    agentId,
    question: e.q,
    answer: e.a,
    ...(e.origin === 'site' ? { source: 'website' as const, sourceLabel: site.label, sourceId: site.id } : { source: 'auto' as const }),
    usageCount: e.usage,
    createdAt,
  }))
}

/** Exemplos de "Processamento preciso" gravados por versões anteriores do seed (substituídos pelos observados ao vivo). */
const OLD_PRECISE_EXAMPLES = new Set(['maria.silva@exemplo.com.br', 'Rua das Flores, 123 – Centro, São Paulo – SP'])

/**
 * Atualiza um banco que já tem o espelho para MIRROR_SEED_VERSION (uma vez por versão; registros do usuário preservados):
 * - acrescenta as entradas de conhecimento do espelho que ainda não existem (por id);
 * - troca os exemplos antigos de "Processamento preciso" dos assistentes do espelho pelos padrões atuais (só se ainda forem os antigos);
 * - atualiza o conteúdo da conversa do espelho (título, resumo, transcrição, duração), mantendo estrela/arquivo/leitura/etiquetas.
 */
function migrateMirror(db: DemoDB, now: Date): DemoDB {
  const fresh = buildMirrorOrg(now)
  const known = new Set(db.knowledgeEntries.map((e) => e.id))
  const hasSite = db.knowledgeSources.some((s) => s.id === 'kbs_kt_site')
  const addEntries = (fresh.knowledgeEntries ?? []).filter(
    (e) => !known.has(e.id) && db.agents.some((a) => a.id === e.agentId) && (e.source !== 'website' || hasSite),
  )
  const freshConv = fresh.conversations?.[0]
  const isOldPrecise = (t: AgentTechnical) => t.preciseExtraction.some((p) => OLD_PRECISE_EXAMPLES.has(p.example))
  return {
    ...db,
    knowledgeEntries: [...db.knowledgeEntries, ...addEntries],
    agents: db.agents.map((a) =>
      a.orgId === MIRROR_ORG_ID && a.technical && isOldPrecise(a.technical) ? { ...a, technical: { ...a.technical, preciseExtraction: defaultTechnical().preciseExtraction } } : a,
    ),
    conversations: db.conversations.map((c) =>
      freshConv && c.id === freshConv.id
        ? { ...c, title: freshConv.title, summary: freshConv.summary, transcript: freshConv.transcript, durationSec: freshConv.durationSec, result: freshConv.result, endedBy: freshConv.endedBy, outcomes: freshConv.outcomes }
        : c,
    ),
    organizations: db.organizations.map((o) => (o.id === MIRROR_ORG_ID ? { ...o, mirrorSeedVersion: MIRROR_SEED_VERSION } : o)),
  }
}

/** Seed do módulo (arrays concatenados ao seed base em src/data/seed/index.ts). */
export default function seed(now: Date): Partial<DemoDB> {
  return buildMirrorOrg(now)
}

/**
 * Bancos já gravados neste navegador antes do cenário espelho não têm a organização "Kloel Tecnologia": acrescenta-a sem
 * alterar nenhum outro dado (aditivo). Bancos que já têm o espelho numa versão anterior recebem os dados novos do espelho
 * (`migrateMirror`, uma vez por versão). Retorna o mesmo objeto quando nada muda.
 */
export function withMirrorScenario(db: DemoDB, now = new Date()): DemoDB {
  const mirrorOrg = db.organizations.find((o) => o.id === MIRROR_ORG_ID)
  if (mirrorOrg) return (mirrorOrg.mirrorSeedVersion ?? 1) < MIRROR_SEED_VERSION ? migrateMirror(db, now) : db
  if (db.users.some((u) => u.email.toLowerCase() === MIRROR_LOGIN.email)) return db
  const part = buildMirrorOrg(now) as Record<string, unknown[]>
  const out: Record<string, unknown> = { ...db }
  for (const [k, v] of Object.entries(part)) {
    const cur = out[k]
    if (Array.isArray(cur) && Array.isArray(v)) out[k] = [...cur, ...v]
  }
  return out as unknown as DemoDB
}
