import type { AIEngine, GeneratedAssistant } from '../types'
import { runSteps, hash, SimulatedError, consumeFailureFlag } from '../runtime'
import type { TranscriptLine, ConversationResult, KnowledgeEntry } from '@/domain/types'

/* ---------------------- Busca simulada na base de conhecimento ---------------------- */

const normalizeText = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

/**
 * Palavras que não identificam o assunto da pergunta (pronomes, interrogativos, verbos genéricos).
 * Sem esta lista, "vocês", "qual" ou "quanto" presentes no texto das perguntas cadastradas faziam qualquer
 * pergunta casar com uma resposta específica errada.
 */
const STOP_WORDS = new Set(
  (
    'a o as os um uma uns umas de da do das dos em na no nas nos por pra pras pro pros para com sem sob sobre entre ate apos e ou mas se que ' +
    'eu tu ele ela nos vos eles elas voce voces vc vcs me te lhe mim meu minha meus minhas seu sua seus suas teu tua nosso nossa nossos nossas ' +
    'esse essa esses essas este esta estes estas isso isto aquilo aquele aquela aqui ai la ' +
    'qual quais quanto quanta quantos quantas quando onde como porque porque pq quem oque ' +
    'ser sou eh sao era estar estou esta estao ter tem temos tenho teria tinha ha haver fazer faz fazem faco pode podem posso poderia consegue conseguem ' +
    'vai vao ir quero queria gostaria saber preciso precisa dizer diz falar ' +
    'tambem ainda ja so muito muita mais menos bem algum alguma alguns algumas todo toda todos todas cada outro outra mesmo mesma ' +
    'sim nao ok entao tipo coisa coisas favor ola oi bom boa dia tarde noite obrigado obrigada'
  ).split(/\s+/),
)

function contentTokens(s: string) {
  return [...new Set(normalizeText(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP_WORDS.has(w)))]
}

/**
 * Mesma palavra ou variação de flexão (horario/horarios, agendam/agendamento, plano/planos).
 * Retorna o tamanho do prefixo comum (qualidade do casamento) ou 0 quando não casam.
 */
function stemMatch(a: string, b: string) {
  if (a === b) return a.length + 1
  const min = Math.min(a.length, b.length)
  if (min < 4) return 0
  let i = 0
  while (i < min && a[i] === b[i]) i++
  return i >= Math.max(4, min - 3) ? i : 0
}

/**
 * Escolhe a entrada da base que responde à mensagem — ou nenhuma, para cair na resposta genérica
 * (uma resposta genérica é melhor do que uma resposta específica errada).
 * - Palavras presentes em várias perguntas cadastradas (ex.: o nome da empresa) pesam menos (1 / nº de perguntas).
 * - Mensagem com 1 palavra de conteúdo: só responde se essa palavra apontar para uma única pergunta, ou casar
 *   claramente melhor com uma delas ("agendamento" ≈ "agendam" mais do que ≈ "agendo"); "Kloel?" sozinho não basta.
 * - Mensagem maior: a pergunta escolhida precisa compartilhar ≥ 2 palavras de conteúdo, cobrir metade delas e ter peso ≥ 1
 *   (ou conter todas as palavras da mensagem). Empates vão para o casamento mais exato ("aceitam" > "aceitos").
 *   Uma palavra solta em comum ("Qual o horário de atendimento de vocês?" × "Vocês agendam horários…?") não basta.
 */
export function matchKnowledge(knowledge: KnowledgeEntry[], message: string): KnowledgeEntry | undefined {
  const words = contentTokens(message)
  if (!words.length || !knowledge.length) return undefined
  const questions = knowledge.map((e) => contentTokens(e.question))
  // qualidade do melhor casamento de cada palavra da mensagem em cada pergunta cadastrada
  const quality = questions.map((q) => words.map((w) => Math.max(0, ...q.map((t) => stemMatch(w, t)))))
  if (words.length === 1) {
    const ranked = quality.map((qs, i) => ({ q: qs[0]!, i })).filter((r) => r.q > 0).sort((a, b) => b.q - a.q)
    if (!ranked.length || (ranked.length > 1 && ranked[0]!.q === ranked[1]!.q)) return undefined
    return knowledge[ranked[0]!.i]
  }
  const df = words.map((_, wi) => quality.filter((qs) => qs[wi]! > 0).length)
  let best = { strength: 0, matched: 0, fit: 0, i: -1 }
  quality.forEach((qs, i) => {
    const matched = qs.filter((v) => v > 0).length
    const strength = qs.reduce((s, v, wi) => (v > 0 ? s + 1 / df[wi]! : s), 0)
    const fit = qs.reduce((s, v) => s + v, 0)
    const better =
      strength > best.strength ||
      (strength === best.strength && (matched > best.matched || (matched === best.matched && fit > best.fit)))
    if (better) best = { strength, matched, fit, i }
  })
  if (best.i < 0) return undefined
  // todas as palavras da mensagem presentes na pergunta, ou pelo menos uma palavra pouco comum entre as perguntas
  const enough = best.matched >= 2 && best.matched / words.length >= 0.5 && (best.strength >= 1 || best.matched === words.length)
  return enough ? knowledge[best.i] : undefined
}

const PALETTE = ['#585DF5', '#0EA5E9', '#10B981', '#F97316', '#E11D48', '#8B5CF6', '#14B8A6', '#F59E0B']
const NAMES = ['Maria', 'Sofia', 'Clara', 'Luiza', 'Helena', 'Alice']

function normalizeUrl(url: string) {
  const u = url.trim().replace(/^https?:\/\//i, '').replace(/\/$/, '')
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/.*)?$/i.test(u)) throw new SimulatedError('Digite um endereço de site válido, por exemplo minhaempresa.com.br.', 'INVALID_URL')
  return u
}

function companyFromDomain(domain: string) {
  const base = domain.split('/')[0]!.replace(/^www\./, '').split('.')[0]!
  return base.split(/[-_]/).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ')
}

function faqFor(company: string): { question: string; answer: string }[] {
  return [
    { question: `O que a ${company} faz?`, answer: `A ${company} oferece produtos e serviços descritos no site, com atendimento personalizado.` },
    { question: 'Qual é o horário de atendimento?', answer: 'Atendemos de segunda a sexta, das 9h às 18h.' },
    { question: 'Como entro em contato?', answer: 'Você pode falar conosco por telefone, WhatsApp ou pelo formulário do site.' },
    { question: 'Quais formas de pagamento são aceitas?', answer: 'Pix, cartão de crédito e boleto.' },
  ]
}

export const simulatedAI: AIEngine = {
  async generateAssistantFromWebsite(url, onProgress) {
    const domain = normalizeUrl(url)
    const h = hash(domain)
    await runSteps(
      [
        { label: 'Acessando o site', ms: 900 },
        { label: 'Lendo páginas e textos', ms: 1100 },
        { label: 'Identificando cores e identidade visual', ms: 800 },
        { label: 'Extraindo perguntas frequentes', ms: 1000 },
        { label: 'Criando base de conhecimento', ms: 900 },
        { label: 'Configurando assistente', ms: 900 },
      ],
      onProgress,
      { fail: /erro|falha|invalid/i.test(domain) ? 'Não conseguimos ler este site. Verifique o endereço e tente novamente.' : false },
    )
    const company = companyFromDomain(domain)
    const name = NAMES[h % NAMES.length]!
    return {
      companyName: company,
      website: domain,
      brandColor: PALETTE[h % PALETTE.length]!,
      faviconLetter: company.charAt(0).toUpperCase(),
      assistantName: name,
      greeting: `Olá! Eu sou a ${name}, assistente virtual da ${company}. Como posso ajudar?`,
      companyInfo: `${company} (${domain}). Informações extraídas automaticamente do site — revise antes de usar.`,
      faq: faqFor(company),
      pagesAnalyzed: 3 + (h % 9),
    } satisfies GeneratedAssistant
  },
  generateGenericAssistant() {
    return {
      companyName: 'Sua empresa', website: '', brandColor: '#585DF5', faviconLetter: 'K', assistantName: 'Maria',
      greeting: 'Olá! Eu sou a Maria, assistente virtual. Como posso ajudar?', companyInfo: '', faq: faqFor('sua empresa'), pagesAnalyzed: 0,
    }
  },
  async chatReply(agent, knowledge, message) {
    // "Simular falha na próxima operação" (painel de demonstração) também vale para as conversas de chat.
    const forced = consumeFailureFlag()
    await new Promise((r) => setTimeout(r, 700 + (hash(message) % 600)))
    if (forced) return { text: 'Não foi possível responder agora. Use “Tentar novamente” para reenviar a mensagem.', usedKnowledgeIds: [], failed: true }
    const best = matchKnowledge(knowledge, message)
    if (best) return { text: best.answer, usedKnowledgeIds: [best.id] }
    if (/\b(oi|ola|bom dia|boa tarde|boa noite)\b/.test(normalizeText(message))) return { text: agent.greeting, usedKnowledgeIds: [] }
    return { text: 'Entendi! Vou registrar sua solicitação e nossa equipe retorna em breve. Posso ajudar em mais alguma coisa?', usedKnowledgeIds: [] }
  },
  async generateCompanyInfo(url, onProgress) {
    const domain = normalizeUrl(url)
    await runSteps([{ label: 'Lendo o site', ms: 900 }, { label: 'Resumindo informações', ms: 900 }], onProgress)
    const c = companyFromDomain(domain)
    return `${c} – empresa com presença online em ${domain}.\nServiços: descreva aqui os principais serviços.\nHorário: segunda a sexta, 9h às 18h.\nEndereço: informe o endereço.\nRevise as informações antes de salvar.`
  },
  async crawlWebsite(url, onProgress) {
    const domain = normalizeUrl(url)
    await runSteps(
      [{ label: 'Buscando páginas', ms: 900 }, { label: 'Lendo conteúdo', ms: 1200 }, { label: 'Gerando entradas', ms: 900 }],
      onProgress,
      { fail: /erro|falha/i.test(domain) ? 'O site não respondeu.' : false },
    )
    const c = companyFromDomain(domain)
    return { pages: 2 + (hash(domain) % 8), entries: faqFor(c) }
  },
  async processDocument(file, onProgress) {
    if (!/pdf$/i.test(file.name) && file.type !== 'application/pdf') throw new SimulatedError('Somente arquivos PDF são aceitos.', 'INVALID_TYPE')
    if (file.size > 20 * 1024 * 1024) throw new SimulatedError('O arquivo excede 20 MB.', 'TOO_LARGE')
    await runSteps([{ label: 'Enviando documento', ms: 700 }, { label: 'Extraindo texto', ms: 1100 }, { label: 'Gerando entradas', ms: 800 }], onProgress)
    const base = file.name.replace(/\.pdf$/i, '')
    return { entries: [{ question: `O que diz o documento "${base}"?`, answer: `Resumo do documento ${file.name}.` }] }
  },
  async draftEmailReply({ subject, body, tone, signature, context, rules, knowledge, senderName }, onProgress) {
    await runSteps([{ label: 'Lendo e-mail', ms: 600 }, { label: 'Aplicando contexto e regras', ms: 600 }, { label: 'Redigindo resposta', ms: 900 }], onProgress)
    const greeting = senderName ? `Olá, ${senderName.split(' ')[0]},` : 'Olá,'
    const kbLine = (() => {
      if (!knowledge) return ''
      const words = `${subject} ${body}`.toLowerCase().split(/\W+/).filter((w) => w.length > 4)
      const hit = knowledge.split(/\n+/).find((l) => words.some((w) => l.toLowerCase().includes(w)))
      return hit ? `\n\n${hit.trim()}` : ''
    })()
    const ctx = context ? `\n\n(Contexto considerado: ${context.slice(0, 120)}${context.length > 120 ? '…' : ''})` : ''
    const rl = rules && rules.length ? `\n(Regras aplicadas: ${rules.slice(0, 3).join('; ')})` : ''
    return `${greeting}\n\nObrigado pela mensagem sobre "${subject}". Recebemos sua solicitação e retornaremos com os detalhes em breve.${kbLine}\n\n${signature || 'Atenciosamente,\nEquipe'}${ctx}${rl}`
  },
  summarizeTranscript(lines: TranscriptLine[], kind: 'call' | 'chat' = 'call') {
    const callerLines = lines.filter((l) => l.speaker === 'caller').map((l) => l.text)
    const first = callerLines[0] ?? ''
    let result: ConversationResult = callerLines.length === 0 ? 'no_interaction' : 'resolved'
    if (/agend|marcar|consulta/i.test(callerLines.join(' '))) result = 'appointment'
    const chat = kind === 'chat'
    const label = chat ? 'Chat de teste' : 'Ligação de teste'
    return {
      title: first ? (first.length > 40 ? first.slice(0, 40) + '…' : first) : label,
      summary: first
        ? `${label}: ${chat ? 'o cliente escreveu' : 'quem ligou disse'} "${first.slice(0, 80)}".`
        : `${label} sem ${chat ? 'mensagem do cliente' : 'fala de quem ligou'}.`,
      result,
    }
  },
}
