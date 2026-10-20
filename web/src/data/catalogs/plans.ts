import type { PlanTier, ProductKey } from '@/domain/types'
/**
 * Planos e preços (valores demonstrativos espelhando a estrutura observada na Fonio em 2026-10-18).
 * public* = página pública /planos ; app* = cards "Alterar plano"/primeiro acesso no app.
 * Os valores NÃO representam oferta comercial real da Kloel.
 */
export interface PlanDef {
  tier: PlanTier
  name: string
  appTagline: string
  publicTagline: string
  monthly: number | null // null = preço individual
  annual: number | null
  fromPrice?: { monthly: number; annual: number }
  /**
   * Preço anual anunciado no SITE PÚBLICO quando difere do cobrado no app (OBSERVADO: Webchat R$250/R$750 em [295]
   * contra R$249/R$749 no app [447]). Páginas públicas: `plan.publicAnnual ?? plan.annual`.
   */
  publicAnnual?: number
  recommended?: boolean
  appFeatures: { text: string; extra?: string; negative?: boolean }[]
  publicIncluded: { text: string; extra?: string; negative?: boolean; info?: boolean }[]
  publicFeatures: { text: string; chip?: string; info?: boolean }[]
  /** Selo "Economize R$X" do ciclo anual = monthly − annual (coerente com o preço `annual` exibido ao lado). */
  savings?: string
  limits: PlanLimits
}

/**
 * Cotas por plano. Chaves livres (minutes, numbers, users, concurrent, conversations, whatsappNumbers, inboxes…) +
 * as duas documentadas abaixo, usadas no cartão "Uso" da Visão geral (central de ajuda FS-01/AN-10) e na cota de Contatos.
 * `Infinity` = "Personalizado"/sem limite na demonstração (exibido como ∞).
 *
 * Regra para a ORGANIZAÇÃO (INFERIDA): vale o MAIOR valor entre as assinaturas ativas que definem a chave (ver
 * `orgPlanLimit`) — coerente com [469]/[472] (Voice Solo + WhatsApp Solo + Webchat Solo → "Conexões de workspace 0 / 2"),
 * com a regra de usuários de company-settings/plan.ts e com a cota de contatos de contacts/lib.ts. Complementos
 * comprados (add-on "Conexões de workspace", +1 por unidade) somam por fora.
 */
export type PlanLimits = Record<string, number> & {
  /**
   * "Conexões do workspace" (contas Google/Microsoft conectadas para agenda e e-mail).
   * Voice Solo 2 — OBSERVADO [469]/[472] ("0 de 2 em uso"); Voice Team 3 — OBSERVADO na central de ajuda AN-10
   * ("Workspace connections 0 / 3" numa conta com 3 números e 3 chamadas simultâneas = Team); Voice Scale = Infinity
   * ("Personalizado" em [284], INFERIDO). WhatsApp: = integrações de calendário do card do plano (1 / 3 / sob medida →
   * Infinity) — equivalência INFERIDA. Webchat: Solo 0 (sem agendamento), Team 1 ("Agendamento de horários incluído
   * (R$ 36 / integração extra)"), Scale 1 ("Tudo o que está incluído no Team") — INFERIDO. E-Mail IA 1 — OBSERVADO no card
   * ("Uma conexão com Google ou Microsoft incluída").
   */
  workspaceConnections?: number
  /**
   * Contatos incluídos. Voice: Solo 1.000 · Team 3.000 · Scale Personalizado (Infinity) — OBSERVADO na tabela comparativa
   * pública [279] ("Contatos inclusos"); complemento "1.000 contatos por R$120/mês" [284]. WhatsApp e Webchat: mesmos
   * valores por nível (INFERIDO, mesma regra de src/app/pages/contacts/lib.ts `contactQuota`). E-Mail IA: sem cota própria.
   */
  contacts?: number
}
export interface ProductDef { key: ProductKey; name: string; subscriptionName: string; icon: 'phone' | 'whatsapp' | 'message-square' | 'mail' | 'life-buoy'; plans: PlanDef[] }

export const PRODUCTS: ProductDef[] = [
  {
    key: 'voice', name: 'Assistente telefônico IA', subscriptionName: 'Kloel Assinatura', icon: 'phone',
    plans: [
      { tier: 'solo', name: 'Solo', appTagline: 'Para 10–20 ligações por dia', publicTagline: 'Ideal para 1-20 ligações/dia', monthly: 719, annual: 599, savings: 'Economize R$120',
        appFeatures: [{ text: '1000 minutos', extra: 'corresponde a R$ 0,72 / min' }, { text: 'Sem ligações simultâneas', negative: true }, { text: '1 números de telefone', extra: '(R$ 49 / número extra)' }, { text: 'Assistentes ilimitados' }, { text: '1 usuário' }],
        publicIncluded: [{ text: '1.000 minutos', extra: 'equivalem a R$0,71/min' }, { text: 'Sem chamadas simultâneas', negative: true }, { text: '1 número de tel.', extra: '+R$49/mês por extra' }, { text: '∞ Assistentes' }, { text: '1 Usuário' }],
        publicFeatures: [{ text: '120+ vozes' }, { text: '60+ idiomas' }, { text: 'Agenda + reservas', info: true }],
        limits: { minutes: 1000, concurrent: 1, numbers: 2, users: 3, workspaceConnections: 2, contacts: 1000 } },
      { tier: 'team', name: 'Team', appTagline: 'Para 20–100 ligações por dia', publicTagline: 'Ideal para 20-100 ligações/dia', monthly: 2159, annual: 1799, recommended: true, savings: 'Economize R$360',
        appFeatures: [{ text: '3600 minutos', extra: 'corresponde a R$ 0,60 / min' }, { text: '3 ligações simultâneas' }, { text: '3 números de telefone', extra: '(R$ 49 / número extra)' }, { text: 'Assistentes ilimitados' }, { text: 'Usuários ilimitados' }],
        publicIncluded: [{ text: '3.600 minutos', extra: 'equivalem a R$0,59/min' }, { text: '3 chamadas simultâneas' }, { text: '3 números de tel.', extra: '+R$49/mês por extra' }, { text: '∞ Assistentes' }, { text: '∞ usuários' }],
        publicFeatures: [{ text: 'Tudo do plano', chip: 'Solo' }, { text: 'Tronco SIP dedicado', info: true }, { text: 'Ligações ativas', info: true }],
        limits: { minutes: 3600, concurrent: 3, numbers: 3, users: 999, workspaceConnections: 3, contacts: 3000 } },
      { tier: 'scale', name: 'Scale', appTagline: '100+ ligações por dia', publicTagline: 'Ideal para + de 100 ligações/dia', monthly: null, annual: null, fromPrice: { monthly: 3599, annual: 3239 }, savings: 'Tarifas personalizadas',
        appFeatures: [{ text: 'A partir de 6000 minutos' }, { text: 'Chamadas simultâneas ilimitadas' }, { text: 'Números de tel. sob medida' }, { text: 'Assistentes ilimitados' }, { text: 'Usuários ilimitados' }],
        publicIncluded: [{ text: 'A partir de 6000 minutos', info: true }, { text: 'Chamadas simultâneas ilimitadas' }, { text: 'Números de tel. sob medida' }, { text: '∞ Assistentes' }, { text: '∞ usuários' }],
        publicFeatures: [{ text: 'Tudo do plano', chip: 'Team' }, { text: 'Voz personalizada' }, { text: 'Sem retenção de dados' }, { text: 'E mais' }],
        limits: { minutes: 6000, concurrent: 99, numbers: 20, users: 999, workspaceConnections: Infinity, contacts: Infinity } },
    ],
  },
  {
    key: 'whatsapp', name: 'IA de WhatsApp', subscriptionName: 'Kloel Assinatura WhatsApp', icon: 'whatsapp',
    plans: [
      { tier: 'solo', name: 'Solo', appTagline: 'Até 450 conversas por mês', publicTagline: 'Ideal para até 450 conversas/mês', monthly: 499, annual: 399, savings: 'Economize R$100',
        appFeatures: [{ text: '450 conversas' }, { text: '1 número de WhatsApp', extra: '(R$ 119 / número extra)' }, { text: '1 integração de calendário', extra: '(R$ 36 / integração extra)' }, { text: 'Assistentes ilimitados' }, { text: '1 usuário' }],
        publicIncluded: [{ text: '450 conversas por mês' }, { text: '1 número de WhatsApp', extra: '+R$114/mês por número extra' }, { text: 'Assistentes ilimitados' }, { text: '1 Usuário' }],
        publicFeatures: [{ text: 'Transferência para humano', info: true }, { text: 'Agendamento automatizado', info: true }],
        limits: { conversations: 450, whatsappNumbers: 1, workspaceConnections: 1, contacts: 1000 } },
      { tier: 'team', name: 'Team', appTagline: 'Até 2000 conversas por mês', publicTagline: 'Ideal para até 2.000 conversas/mês', monthly: 1999, annual: 1599, recommended: true, savings: 'Economize R$400',
        appFeatures: [{ text: '2000 conversas' }, { text: '3 números de WhatsApp', extra: '(R$ 119 / número extra)' }, { text: '3 integrações de calendário', extra: '(R$ 36 / integração extra)' }, { text: 'Assistentes ilimitados' }, { text: 'Usuários ilimitados' }],
        publicIncluded: [{ text: '2.000 conversas/mês' }, { text: '3 números de WhatsApp', extra: '+R$114/mês por número extra' }, { text: 'Assistentes ilimitados' }, { text: '∞ usuários' }],
        publicFeatures: [{ text: 'Tudo do plano', chip: 'Solo' }, { text: 'Onboarding', info: true }],
        limits: { conversations: 2000, whatsappNumbers: 3, workspaceConnections: 3, contacts: 3000 } },
      { tier: 'scale', name: 'Scale', appTagline: 'A partir de 5000 conversas por mês', publicTagline: 'Ideal a partir de 5.000 conversas/mês', monthly: null, annual: null, fromPrice: { monthly: 4499, annual: 3599 }, savings: 'Tarifas personalizadas',
        appFeatures: [{ text: 'A partir de 5000 conversas' }, { text: 'Números de WhatsApp personalizados', extra: 'até 20' }, { text: 'Integrações de calendário sob medida' }, { text: 'Assistentes ilimitados' }, { text: 'Usuários ilimitados' }],
        publicIncluded: [{ text: '5.000 conversas/mês' }, { text: 'Números de WhatsApp personalizados' }, { text: 'Assistentes ilimitados' }, { text: '∞ usuários' }],
        publicFeatures: [{ text: 'Tudo do plano', chip: 'Team' }, { text: 'Retenção zero de dados' }, { text: 'SLA personalizado' }],
        limits: { conversations: 5000, whatsappNumbers: 20, workspaceConnections: Infinity, contacts: Infinity } },
    ],
  },
  {
    key: 'webchat', name: 'Webchat de IA', subscriptionName: 'Kloel Chatbot de IA', icon: 'message-square',
    plans: [
      { tier: 'solo', name: 'Solo', appTagline: 'Para até 100 conversas por mês', publicTagline: 'Ideal para até 100 conversas/mês', monthly: 299, annual: 249, publicAnnual: 250, savings: 'Economize R$50',
        appFeatures: [{ text: '100 conversas', extra: 'Até 1000 mensagens' }, { text: 'Assistentes ilimitados' }, { text: '1 usuário' }, { text: 'Powered by kloel.ai' }],
        publicIncluded: [{ text: '100 conversas', extra: 'Até 1.000 mensagens', info: true }, { text: 'Webchats de IA ilimitados' }, { text: '1 Usuário' }, { text: 'Com tecnologia da kloel.ai' }],
        publicFeatures: [{ text: '60+ idiomas' }, { text: 'Personalização visual' }],
        limits: { conversations: 100, workspaceConnections: 0, contacts: 1000 } },
      { tier: 'team', name: 'Team', appTagline: 'Para até 400 conversas por mês', publicTagline: 'Ideal para até 400 conversas/mês', monthly: 899, annual: 749, publicAnnual: 750, recommended: true, savings: 'Economize R$150',
        appFeatures: [{ text: '400 conversas', extra: 'Até 4000 mensagens' }, { text: 'Agendamento de horários incluído', extra: '(R$ 36 / integração extra)' }, { text: 'Envio de PDFs e imagens' }, { text: 'Transferência para sua equipe' }, { text: 'Sem a marca kloel' }],
        publicIncluded: [{ text: '400 conversas', extra: 'Até 4.000 mensagens', info: true }, { text: 'Webchats de IA ilimitados' }, { text: '∞ usuários' }, { text: 'Sem marca da Kloel' }],
        publicFeatures: [{ text: 'Tudo do plano', chip: 'Solo' }, { text: 'Envio de PDFs e imagens' }, { text: 'Agendamento de compromissos' }, { text: 'Transferência para um humano' }, { text: 'Exportação de conversas' }],
        limits: { conversations: 400, workspaceConnections: 1, contacts: 3000 } },
      { tier: 'scale', name: 'Scale', appTagline: 'Volume de conversas personalizado', publicTagline: 'Ideal a partir de 2.000 conversas/mês', monthly: null, annual: null, fromPrice: { monthly: 2999, annual: 2699 }, savings: 'Tarifas personalizadas',
        appFeatures: [{ text: 'Volumes de conversas personalizados' }, { text: 'Tudo o que está incluído no Team' }, { text: 'Chatbot de IA incorporado à página' }, { text: 'Contexto do site' }],
        publicIncluded: [{ text: '2.000+ conversas', extra: '20.000+ mensagens', info: true }, { text: 'Webchats de IA ilimitados' }, { text: '∞ usuários' }, { text: 'Sem marca da Kloel' }],
        publicFeatures: [{ text: 'Tudo do plano', chip: 'Team' }, { text: 'Contexto da página' }, { text: 'Retenção zero de dados' }, { text: 'Rastreamento de UTM' }, { text: 'SLA individual' }],
        limits: { conversations: 2000, workspaceConnections: 1, contacts: Infinity } },
    ],
  },
  {
    key: 'email', name: 'E-Mail IA', subscriptionName: 'Kloel E-Mail IA', icon: 'mail',
    plans: [
      { tier: 'standard', name: 'Kloel E-Mail IA', appTagline: 'Um agente de e-mail para uma caixa de entrada.', publicTagline: '', monthly: 299, annual: 299,
        appFeatures: [{ text: 'Uma caixa de entrada incluída', extra: '(R$ 299 / caixa de entrada adicional)' }, { text: 'Uma conexão com Google ou Microsoft incluída' }, { text: 'E-mails ilimitados*' }],
        publicIncluded: [], publicFeatures: [], limits: { inboxes: 1, workspaceConnections: 1 } },
    ],
  },
  {
    key: 'care', name: 'Kloel Care & Setups', subscriptionName: 'Kloel', icon: 'life-buoy',
    plans: [
      { tier: 'essential', name: 'Essential Care', appTagline: 'Otimização focada em um ponto específico.', publicTagline: '', monthly: 599, annual: 599,
        appFeatures: [{ text: '30 min 1:1 por mês' }, { text: 'Otimização ao vivo do prompt e do fluxo' }, { text: 'Análise de conversas reais' }, { text: 'Tarefas concretas após a call' }], publicIncluded: [], publicFeatures: [], limits: {} },
      { tier: 'pro', name: 'Pro Care', appTagline: 'O dobro do tempo – para reformular, não só ajustar.', publicTagline: '', monthly: 899, annual: 899,
        appFeatures: [{ text: 'Tudo de Essential Care' }, { text: '60 min 1:1 por mês' }, { text: 'Transferências, calendários e integrações' }, { text: 'Resumo por escrito' }], publicIncluded: [], publicFeatures: [], limits: {} },
      { tier: 'premium', name: 'Premium Care', appTagline: 'Cuidamos, otimizamos e evoluímos o seu agente durante todo o ano.', publicTagline: '', monthly: 5399, annual: 5399,
        appFeatures: [{ text: 'Tudo de Pro Care' }, { text: 'Customer success manager dedicado' }, { text: '4 horas de otimização por mês' }, { text: 'Relatório mensal' }, { text: 'Suporte prioritário' }], publicIncluded: [], publicFeatures: [], limits: {} },
    ],
  },
]
export const productByKey = (k: ProductKey) => PRODUCTS.find((p) => p.key === k)!
export const planOf = (k: ProductKey, tier: PlanTier) => productByKey(k).plans.find((p) => p.tier === tier)

/**
 * Cota da ORGANIZAÇÃO para uma chave de `limits`: maior valor entre as assinaturas ativas que a definem
 * (`undefined` quando nenhuma define). Ex.: `orgPlanLimit(subs, 'workspaceConnections')` → 2 na demo (Voice Solo).
 * Não inclui complementos comprados (some `billing.addOns.workspaces` por fora).
 */
export function orgPlanLimit(subs: { product: ProductKey; plan: PlanTier; status: string }[], key: string): number | undefined {
  let best: number | undefined
  for (const s of subs) {
    if (s.status !== 'active') continue
    const v = planOf(s.product, s.plan)?.limits[key]
    if (typeof v === 'number' && (best === undefined || v > best)) best = v
  }
  return best
}

// Add-ons (página Assinatura e faturamento). Preços unitários INFERIDOS da tabela comparativa pública.
export const ADDONS = [
  { key: 'minutes', label: 'Minutos de ligação', icon: 'phone-call', unit: 100, unitPrice: 90, included: (l: Record<string, number>) => l.minutes ?? 1000 },
  { key: 'outbound', label: 'Créditos outbound', icon: 'phone-outgoing', unit: 5, unitPrice: 30, included: () => 0, info: 'Ao fazer ligações ativas, é cobrada em média R$ 0,24 por minuto iniciado, e o crédito é adicionado à sua conta em pacotes de R$ 30 (5 créditos).' },
  { key: 'sms', label: 'SMS', icon: 'message-square', unit: 100, unitPrice: 25, included: () => 0 },
  { key: 'numbers', label: 'Números de telefone', icon: 'phone', unit: 1, unitPrice: 49, included: () => 2 },
  { key: 'workspaces', label: 'Conexões de workspace', icon: 'users', unit: 1, unitPrice: 36, included: () => 2 },
  { key: 'waNumbers', label: 'Número WhatsApp', icon: 'smartphone', unit: 1, unitPrice: 119, included: () => 1 },
  { key: 'waConversations', label: 'Conversas do WhatsApp', icon: 'whatsapp', unit: 20, unitPrice: 24, included: () => 450 },
  { key: 'chatConversations', label: 'Conversas do Chatbot de IA', icon: 'message-square', unit: 100, unitPrice: 79, included: () => 100 },
  { key: 'waActions', label: 'Mensagens de ação do WhatsApp', icon: 'whatsapp', unit: 100, unitPrice: 90, included: () => 0 },
] as const
