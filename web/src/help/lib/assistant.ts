import { ALL_ARTICLES, HELP_TABS, articleKey, canonicalKey, getArticle, type HelpArticle } from '../content'
import { chunkDoc, parseDoc, stripInline, type Block } from './markdown'
import { normalize, stem, tokenize } from './search'
import { runSteps, type ProgressFn } from '@/services/runtime'

/**
 * Assistente SIMULADO da Central de ajuda: recuperação local (BM25 sobre trechos dos artigos) +
 * composição extrativa da resposta com citações. Nenhuma chamada a modelo de linguagem ou rede.
 */

export interface Citation {
  n: number
  key: string
  title: string
  anchor?: string
  section?: string
}

export interface AssistantAnswer {
  /** parágrafos/itens em Markdown inline; marcadores [n] referem-se a citations */
  intro: string
  points: string[]
  citations: Citation[]
  found: boolean
}

const NOT_FOUND: AssistantAnswer = { intro: '', points: [], citations: [], found: false }

interface Chunk {
  key: string
  article: HelpArticle
  anchor?: string
  heading?: string
  sentences: string[]
  blocks: Block[]
  tokens: string[]
  titleTokens: Set<string>
}

let CHUNKS: Chunk[] | null = null
let DF: Map<string, number> | null = null
let AVG = 1

function sentencesOf(blocks: Block[], out: string[]) {
  for (const b of blocks) {
    switch (b.type) {
      case 'paragraph':
      case 'quote':
        out.push(...splitSentences(b.text))
        break
      case 'list':
        for (const it of b.items) out.push(it.text + (it.children.length ? ': ' + it.children.join('; ') : ''))
        break
      case 'table':
        for (const r of b.rows) out.push(r.map((c, i) => (b.head[i] ? `${stripInline(b.head[i]!)}: ${c}` : c)).join(' — '))
        break
      case 'container':
        sentencesOf(b.children, out)
        break
      case 'steps':
        b.steps.forEach((s) => {
          const inner: string[] = []
          sentencesOf(s.children, inner)
          out.push(`**${s.title}**${inner[0] ? ' — ' + inner[0] : ''}`)
          out.push(...inner.slice(1))
        })
        break
      case 'heading':
        if (b.level >= 3) out.push(`**${b.text}**`)
        break
      default:
        break
    }
  }
}

function splitSentences(text: string) {
  return text
    .split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÂÊÔÃÕÇ*`[])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 2)
}

function build() {
  if (CHUNKS) return
  CHUNKS = []
  for (const a of ALL_ARTICLES) {
    const key = articleKey(a)
    const doc = parseDoc(a.body)
    const titleTokens = new Set(tokenize(a.title + ' ' + (a.keywords ?? []).join(' ')).map(stem))
    for (const c of chunkDoc(doc)) {
      const sentences: string[] = []
      if (!c.heading) sentences.push(a.description)
      sentencesOf(c.blocks, sentences)
      const text = [a.title, c.heading ?? '', ...sentences].join(' ')
      CHUNKS.push({
        key,
        article: a,
        anchor: c.id ?? undefined,
        heading: c.heading ?? undefined,
        sentences,
        blocks: c.blocks,
        tokens: tokenize(stripInline(text)).map(stem),
        titleTokens,
      })
    }
  }
  DF = new Map()
  let total = 0
  for (const c of CHUNKS) {
    total += c.tokens.length
    for (const t of new Set(c.tokens)) DF.set(t, (DF.get(t) ?? 0) + 1)
  }
  AVG = total / Math.max(1, CHUNKS.length)
}

function scoreChunk(c: Chunk, q: string[]) {
  const N = CHUNKS!.length
  const k1 = 1.4
  const b = 0.7
  let s = 0
  const tf = new Map<string, number>()
  for (const t of c.tokens) tf.set(t, (tf.get(t) ?? 0) + 1)
  for (const t of q) {
    const f = tf.get(t) ?? 0
    const df = DF!.get(t) ?? 0
    const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5))
    if (f) s += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * c.tokens.length) / AVG)))
    if (c.titleTokens.has(t)) s += idf * 0.9
    if (c.heading && normalize(c.heading).includes(t)) s += idf * 0.6
  }
  return s
}

/** Parcela (ponderada por IDF) dos termos da pergunta presentes no trecho — evita responder perguntas fora do tema. */
function coverage(c: Chunk, q: string[]) {
  const N = CHUNKS!.length
  const toks = new Set(c.tokens)
  let all = 0
  let hit = 0
  for (const t of q) {
    const df = DF!.get(t) ?? 0
    const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5))
    all += idf
    if (toks.has(t) || c.titleTokens.has(t)) hit += idf
  }
  return all ? hit / all : 0
}

function sentenceScore(s: string, q: string[]) {
  const toks = new Set(tokenize(stripInline(s)).map(stem))
  let n = 0
  for (const t of q) if (toks.has(t)) n++
  return n
}

export function answerQuestion(question: string): AssistantAnswer {
  build()
  const q = [...new Set(tokenize(question).map(stem))]
  if (!q.length) return NOT_FOUND
  const ranked = CHUNKS!.map((c) => ({ c, s: scoreChunk(c, q) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
  const best = ranked[0]
  if (!best || best.s < 2.2 || coverage(best.c, q) < 0.6) return NOT_FOUND

  const picked: { c: Chunk; s: number }[] = []
  for (const r of ranked) {
    if (picked.length >= 3) break
    if (r.s < best.s * 0.45) break
    if (picked.some((p) => p.c.key === r.c.key && p.c.anchor === r.c.anchor)) continue
    if (picked.filter((p) => p.c.key === r.c.key).length >= 2) continue
    picked.push(r)
  }

  const citations: Citation[] = []
  const cite = (c: Chunk) => {
    let n = citations.find((x) => x.key === c.key && x.anchor === c.anchor)?.n
    if (!n) {
      n = citations.length + 1
      citations.push({ n, key: c.key, title: c.article.title, anchor: c.anchor, section: c.heading })
    }
    return n
  }

  const points: string[] = []
  picked.forEach(({ c }, idx) => {
    const n = cite(c)
    const max = idx === 0 ? 4 : 2
    const scored = c.sentences.map((s, i) => ({ s, i, v: sentenceScore(s, q) }))
    let chosen = scored.filter((x) => x.v > 0).sort((a, b) => b.v - a.v || a.i - b.i).slice(0, max)
    if (!chosen.length) chosen = scored.slice(0, idx === 0 ? 2 : 1)
    chosen.sort((a, b) => a.i - b.i)
    for (const x of chosen) {
      const text = x.s.replace(/\s+/g, ' ').trim()
      if (points.some((p) => p.startsWith(text.slice(0, 40)))) continue
      points.push(`${text.replace(/[.:;]$/, '')}. [${n}]`)
    }
  })

  const main = picked[0]!.c
  const where = main.heading ? `${main.article.title} › ${main.heading}` : main.article.title
  return {
    intro: `Encontrei isto na central de ajuda, principalmente em **${where}**:`,
    points: points.slice(0, 7),
    citations,
    found: true,
  }
}

/* ------------------------- Resumo de um artigo ------------------------- */

const INLINE_TOKEN_RE = /\[[^\]]*\]\([^)]*\)|\*\*[^*]+\*\*|`[^`]+`/g

/** Encurta sem quebrar links, negritos ou código Markdown no meio (o corte recua para antes do trecho). */
function clip(text: string, max = 230) {
  const t = text.replace(/\s+/g, ' ').trim().replace(/[.:;]$/, '')
  if (t.length <= max) return t
  let cut = max
  for (const m of t.matchAll(INLINE_TOKEN_RE)) {
    const start = m.index ?? 0
    if (start < cut && start + m[0].length > cut) cut = start
  }
  const head = t.slice(0, cut)
  const space = head.lastIndexOf(' ')
  return (space > cut - 40 ? head.slice(0, space) : head).replace(/[\s,;:—(-]+$/, '') + '…'
}

const firstSentence = (text: string) => splitSentences(text).find((x) => stripInline(x).length > 2)

/** Frase de um bloco: parágrafo (com os itens da lista seguinte quando termina em ":"), passos, abas, lista ou tabela. */
function blockLead(b: Block, next?: Block): string | undefined {
  switch (b.type) {
    case 'paragraph': {
      const x = firstSentence(b.text)
      if (x && /:\s*$/.test(x) && next?.type === 'list') return `${x} ${next.items.slice(0, 3).map((it) => it.text.replace(/[.;]$/, '')).join('; ')}`
      return x
    }
    case 'steps': {
      const out: string[] = []
      sentencesOf([b], out)
      return out[0]
    }
    case 'container': {
      const tabs = b.children.filter((c): c is Extract<Block, { type: 'container' }> => c.type === 'container' && !!c.label)
      if (b.kind === 'tabs' && tabs.length) return `Inclui: ${tabs.map((t) => t.label).join(' · ')}`
      return leadOf(b.children)
    }
    case 'list':
      return b.items[0] ? firstSentence(b.items[0].text) ?? b.items[0].text : undefined
    case 'table': {
      const out: string[] = []
      sentencesOf([b], out)
      return out[0]
    }
    default:
      return undefined
  }
}

/** Frase de abertura de uma seção: 1º parágrafo › passos › bloco destacado/abas › lista › tabela (nessa ordem). */
function leadOf(blocks: Block[]): string | undefined {
  const order: Block['type'][] = ['paragraph', 'steps', 'container', 'list', 'table']
  for (const type of order)
    for (let i = 0; i < blocks.length; i++) {
      if (blocks[i]!.type !== type) continue
      const x = blockLead(blocks[i]!, blocks[i + 1])
      if (x && stripInline(x).length > 2) return x
    }
  return undefined
}

/** Fecha o ponto com "." somente quando a frase ainda não termina em ?, ! ou reticências. */
const withStop = (t: string) => (/[?!…]$/.test(t) ? t : `${t}.`)

const MAX_SUMMARY_SECTIONS = 6

/**
 * Resumo SIMULADO de um artigo: monta a resposta a partir das próprias seções do artigo (descrição + 1ª frase
 * de cada seção H2), com uma citação por seção apontando para a âncora correspondente.
 */
export function summarizeArticle(key: string): AssistantAnswer {
  build()
  const canon = canonicalKey(key)
  const chunks = canon ? CHUNKS!.filter((c) => c.key === canon) : []
  if (!chunks.length) return NOT_FOUND
  const article = chunks[0]!.article
  const citations: Citation[] = []
  const points: string[] = []
  const cite = (c: Chunk) => {
    const n = citations.length + 1
    citations.push({ n, key: c.key, title: article.title, anchor: c.anchor, section: c.heading })
    return n
  }
  const intro = chunks.find((c) => !c.heading)
  const sections = chunks.filter((c) => c.heading)
  points.push(`${withStop(clip(article.description))} [${cite(intro ?? chunks[0]!)}]`)
  for (const c of sections.slice(0, MAX_SUMMARY_SECTIONS)) {
    const lead = leadOf(c.blocks) ?? c.sentences.find((x) => stripInline(x).length > 2)
    const n = cite(c)
    points.push(lead ? `**${c.heading}**: ${withStop(clip(lead))} [${n}]` : `**${c.heading}**. [${n}]`)
  }
  if (!sections.length && intro) {
    // artigo sem seções H2: resume os primeiros blocos do corpo
    const extra: string[] = []
    intro.blocks.forEach((b, i) => {
      const x = extra.length < 3 ? blockLead(b, intro.blocks[i + 1]) : undefined
      if (x && stripInline(x).length > 2 && !extra.includes(x)) extra.push(x)
    })
    for (const x of extra) points.push(`${withStop(clip(x))} [1]`)
  }
  const rest = sections.slice(MAX_SUMMARY_SECTIONS)
  if (rest.length) points.push(withStop(`Também neste artigo: ${rest.map((c) => c.heading).join(' · ')}`))
  return {
    intro: `Resumo de **${article.title}**${sections.length ? `, seção por seção` : ''}:`,
    points,
    citations,
    found: true,
  }
}

const SUMMARY_RE = /^\s*(resum[aeio]\w*|fa[cç]a um resumo|me d[eê] um resumo|resumir)\b/i

/** Identifica pedidos de resumo ("Resuma o artigo “X”", "Resuma esta página") e o artigo a resumir. */
export function summaryTarget(question: string, pageKey?: string): string | undefined {
  if (!SUMMARY_RE.test(question)) return undefined
  const quoted = question.match(/[“"«]([^”"»]+)[”"»]/)?.[1]?.trim()
  if (quoted) {
    const n = normalize(quoted)
    const a = ALL_ARTICLES.find((x) => normalize(x.title) === n || normalize(x.sidebarTitle ?? '') === n)
    if (a) return articleKey(a)
  }
  if (pageKey && /\b(esta|desta|nesta|essa|dessa|a)\s+p[aá]gina\b|\b(este|deste|esse|desse|o)\s+artigo\b/i.test(question)) return canonicalKey(pageKey)
  return undefined
}

/**
 * Visão geral da central (a partir da própria navegação): usada para "Resuma esta página" fora de um artigo
 * (início, índices, 404) e para perguntas sem termo pesquisável além de "Kloel" ("O que é a Kloel?").
 */
export function helpCenterOverview(kind: 'page' | 'kloel'): AssistantAnswer {
  const citations: Citation[] = []
  const points: string[] = []
  for (const tab of HELP_TABS) {
    const groups = tab.groups.filter((g) => !g.external)
    const items = groups.flatMap((g) => g.items)
    const first = items[0] && getArticle(items[0])
    if (!first) continue
    const n = citations.length + 1
    citations.push({ n, key: items[0]!, title: first.title })
    // aba com um só grupo (Começar): lista os primeiros artigos; nas demais, os grupos
    const parts = groups.length > 1 ? groups.map((g) => g.label) : items.slice(0, 5).map((k) => getArticle(k)?.sidebarTitle ?? getArticle(k)?.title ?? k)
    const more = groups.length > 1 || items.length <= 5 ? '' : ' e outros'
    points.push(`**${tab.label}** (${items.length} artigos): ${parts.join(', ')}${more}. [${n}]`)
  }
  const firstSteps = getArticle('get-started/first-steps')
  const intro =
    kind === 'page'
      ? 'Esta é a página inicial da central de ajuda da Kloel. O conteúdo está organizado em quatro abas:'
      : `A central de ajuda da Kloel explica como criar, testar e colocar no ar assistentes de IA${firstSteps ? ` (comece por **${firstSteps.title}**: ${firstSteps.description.replace(/\.$/, '').replace(/^\p{Lu}/u, (c) => c.toLowerCase())})` : ''}. O conteúdo está organizado assim:`
  return { intro, points, citations, found: points.length > 0 }
}

/** Pergunta sem nenhum termo pesquisável além de "Kloel" (ex.: "O que é a Kloel?"). */
function isGenericKloelQuestion(question: string) {
  return /\bkloel\b/.test(normalize(question)) && tokenize(question).length === 0
}

export interface AskOptions {
  /** artigo a resumir (item "Perguntar ao assistente" do menu Copiar página) */
  summaryOf?: string
  /** artigo aberto quando a pergunta foi feita (contexto de "esta página") */
  pageKey?: string
}

/** Operação simulada completa (processando → concluído | falha), respeitando o painel de demonstração. */
export async function askAssistant(question: string, opts: AskOptions = {}, onProgress?: ProgressFn): Promise<AssistantAnswer> {
  const target = opts.summaryOf ?? summaryTarget(question, opts.pageKey)
  await runSteps(
    target
      ? [
          { label: 'Abrindo o artigo…', ms: 400 },
          { label: 'Lendo as seções do artigo…', ms: 500 },
          { label: 'Escrevendo o resumo…', ms: 450 },
        ]
      : [
          { label: 'Pesquisando na central de ajuda…', ms: 450 },
          { label: 'Lendo os artigos relevantes…', ms: 500 },
          { label: 'Escrevendo a resposta…', ms: 450 },
        ],
    onProgress,
    { failAtStep: 1 },
  )
  if (target) {
    const summary = summarizeArticle(target)
    if (summary.found) return summary
  }
  // pedido de resumo fora de um artigo (início da central, índices, 404) ou pergunta genérica sobre a Kloel
  if (SUMMARY_RE.test(question) && !opts.pageKey) return helpCenterOverview('page')
  if (isGenericKloelQuestion(question)) return helpCenterOverview('kloel')
  return answerQuestion(question)
}

export const SUGGESTED_QUESTIONS = [
  'Como conecto meu número de telefone?',
  'Como transferir uma chamada para a minha equipe?',
  'Como escrever um bom prompt para o assistente?',
  'Como enviar um resumo por WhatsApp depois da ligação?',
]
