import type { Agent } from '@/domain/types'
import type { AgentFields } from '../engine/agents'

const labels: Record<string, string> = {
  POINT_OUT_NOT_RESPONSIBLE: 'Explique que o assunto está fora da sua responsabilidade.',
  REDIRECT_TO_RIGHT_CONTACT: 'Indique o contato responsável quando ele for conhecido.',
  EXPLAIN_SCOPE: 'Explique em quais assuntos você pode ajudar.',
  ENGAGE_BRIEFLY: 'Responda brevemente às conversas informais e volte ao assunto.',
  REDIRECT_FRIENDLY: 'Volte ao assunto de forma amigável.',
  MATCH_MOOD: 'Acompanhe o tom da outra pessoa com respeito.',
  STAY_CALM_AND_LISTEN: 'Mantenha a calma e escute sem interromper.',
  SHOW_EMPATHY_OFFER_SOLUTION: 'Demonstre compreensão e ofereça uma solução possível.',
  STAY_FACTUAL_LOG_REQUEST: 'Mantenha-se objetivo e registre a solicitação somente se houver ferramenta que confirme o registro.',
  DECLINE_FRIENDLY: 'Recuse ofertas comerciais com educação.',
  DECLINE_AND_LOG: 'Recuse a oferta e registre-a somente se houver ferramenta que confirme o registro.',
  DECLINE_BRIEFLY: 'Recuse ofertas comerciais brevemente.',
  STAY_NEUTRAL: 'Mantenha neutralidade ao falar sobre concorrentes.',
  HIGHLIGHT_STRENGTHS: 'Destaque pontos fortes comprovados da empresa, sem inventar comparações.',
  LOG_AND_FORWARD: 'Ofereça encaminhar a informação; só afirme o encaminhamento após confirmação da ferramenta.',
}

/** Behavioral controls become actual runtime instructions; timers, routing and grants are not invented here. */
export function compileAgentRules(agent: Agent): AgentFields['rules'] {
  const rules: AgentFields['rules'] = []
  const add = (name: string, instruction: string, enabled = true) => { if (instruction.trim()) rules.push({ name, instruction, enabled }) }
  const r = agent.rules
  add('Comunicação', 'Responda de forma curta e clara. Faça uma pergunta por vez. Peça esclarecimento quando necessário. Não peça novamente uma informação já fornecida. Seja educado e calmo.')
  add('Identificação da IA', {
    never: 'Não mencione espontaneamente que é uma IA. Se perguntado, responda com honestidade.',
    if_asked: 'Informe que é uma IA se a pessoa perguntar.',
    start: 'Identifique-se como assistente de IA no início da conversa.',
    start_consent: 'Identifique-se como assistente de IA no início e solicite consentimento para continuar. Não prossiga com o atendimento sem consentimento.',
  }[r.aiDisclosure])
  add('Estilo de resposta', { default: 'Use linguagem clara e natural.', professional: 'Seja profissional e amigável.', casual: 'Use um tom casual e descontraído.', formal: 'Use linguagem formal e objetiva.', empathetic: 'Seja empático e acolhedor.' }[r.style])
  if (agent.formality && agent.formality !== 'custom') add('Forma de tratamento', agent.formality === 'formal' ? 'Use uma forma de tratamento formal.' : 'Use uma forma de tratamento informal, com respeito.')
  add('Assuntos fora do escopo', [labels[r.offTopic.behavior], r.offTopic.noteAndOffer ? 'Ofereça registrar e encaminhar a solicitação, sem afirmar ações não confirmadas.' : '', labels[r.offTopic.smallTalk]].filter(Boolean).join(' '), r.offTopic.active)
  add('Pessoas insatisfeitas', [labels[r.angry.behavior], r.angry.offerTransfer ? 'Ofereça contato com uma pessoa. Transfira somente se houver ferramenta autorizada disponível e confirmação real.' : ''].filter(Boolean).join(' '), r.angry.active)
  add('Abordagens comerciais', [labels[r.sales.reaction], r.sales.hangUp ? 'Após recusar, proponha encerrar educadamente. Não afirme ter desligado sem confirmação.' : '', r.sales.handleCompetitors ? labels[r.sales.competitorBehavior] : ''].filter(Boolean).join(' '), r.sales.active)
  for (const [index, pronunciation] of r.pronunciation.entries()) if (pronunciation.term.trim() && pronunciation.pronunciation.trim()) add(`Pronúncia ${index + 1}`, `Ao falar o termo ${JSON.stringify(pronunciation.term)}, use a pronúncia ${JSON.stringify(pronunciation.pronunciation)}.`)
  for (const rule of r.custom) if (rule.title.trim() && rule.instruction.trim()) add(rule.title, rule.condition.trim() ? `Quando: ${rule.condition}\n${rule.instruction}` : rule.instruction, rule.active)
  if (agent.webSearch.enabled) add('Pesquisa na web', `Consulte a pesquisa web quando disponível: ${agent.webSearch.instruction}. Priorize estas fontes: ${agent.webSearch.allowedDomains.join(', ')}. Não afirme uma busca que não ocorreu.`)
  return rules
}
