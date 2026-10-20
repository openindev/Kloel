import { ALL_ARTICLES, articleKey, locateArticle, type HelpArticle } from '../content'
import { blocksToText, chunkDoc, parseDoc, stripInline } from './markdown'

/**
 * Índice de busca local da Central de ajuda (título, descrição, palavras-chave, títulos de seção e corpo).
 * Tudo em memória, sem rede.
 */

export function normalize(s: string) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

export const STOPWORDS = new Set(
  'a o e é de da do das dos em no na nos nas um uma uns umas para pra por com sem que se como qual quais quando onde quem eu meu minha meus minhas seu sua seus suas ao aos à às ou mais menos muito já não sim me te lhe isso esse essa este esta isto ser ter tem posso pode podem fazer faço faz consigo consegue preciso precisa devo deve kloel sobre the of to and is how what'.split(
    ' ',
  ).map(normalize),
)

export function tokenize(s: string) {
  return normalize(s)
    .split(/[^a-z0-9@._-]+/)
    .map((t) => t.replace(/^[._-]+|[._-]+$/g, ''))
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
}

/** Radical simples para português: corta plurais e algumas terminações comuns. */
export function stem(t: string) {
  if (t.length <= 4) return t
  return t
    .replace(/(coes|soes)$/, 'cao')
    .replace(/(ais)$/, 'al')
    .replace(/(eis)$/, 'el')
    .replace(/(oes|aes)$/, 'ao')
    .replace(/(ns)$/, 'm')
    .replace(/(es|s)$/, '')
    .slice(0, 6)
}

export interface SearchEntry {
  key: string
  article: HelpArticle
  tabLabel: string
  groupLabel: string
  titleN: string
  descN: string
  keywordsN: string
  headings: { id: string; text: string; textN: string }[]
  text: string
  textN: string
}

let INDEX: SearchEntry[] | null = null

export function getIndex(): SearchEntry[] {
  if (INDEX) return INDEX
  INDEX = ALL_ARTICLES.map((a) => {
    const key = articleKey(a)
    const doc = parseDoc(a.body)
    const loc = locateArticle(key)
    const text = blocksToText(doc.blocks)
    const headings = chunkDoc(doc)
      .filter((c) => c.heading)
      .map((c) => ({ id: c.id!, text: c.heading!, textN: normalize(c.heading!) }))
    for (const t of doc.toc) if (t.level === 3) headings.push({ id: t.id, text: t.text, textN: normalize(t.text) })
    return {
      key,
      article: a,
      tabLabel: loc.tab.label,
      groupLabel: loc.group.label,
      titleN: normalize(a.title),
      descN: normalize(a.description),
      keywordsN: normalize((a.keywords ?? []).join(' ')),
      headings,
      text,
      textN: normalize(text),
    }
  })
  return INDEX
}

export interface SearchResult {
  key: string
  title: string
  groupLabel: string
  tabLabel: string
  /** âncora da seção correspondente (quando o termo está num título de seção) */
  anchor?: string
  anchorText?: string
  snippet: string
  /** trechos (normalizados) a destacar */
  terms: string[]
  score: number
}

function makeSnippet(text: string, textN: string, terms: string[]) {
  let pos = -1
  for (const t of terms) {
    const p = textN.indexOf(t)
    if (p >= 0 && (pos < 0 || p < pos)) pos = p
  }
  if (pos < 0) return text.slice(0, 140).replace(/\s+/g, ' ')
  const start = Math.max(0, pos - 50)
  const end = Math.min(text.length, pos + 110)
  return (start > 0 ? '…' : '') + text.slice(start, end).replace(/\s+/g, ' ').trim() + (end < text.length ? '…' : '')
}

export function searchArticles(query: string, limit = 30): SearchResult[] {
  const q = normalize(query).trim()
  if (!q) return []
  const terms = q.split(/\s+/).filter(Boolean)
  const results: SearchResult[] = []
  for (const e of getIndex()) {
    let score = 0
    let matchedAll = true
    let anchor: { id: string; text: string } | undefined
    for (const t of terms) {
      let s = 0
      if (e.titleN.startsWith(t)) s += 12
      else if (new RegExp(`\\b${escapeRe(t)}`).test(e.titleN)) s += 9
      else if (e.titleN.includes(t)) s += 6
      if (e.keywordsN.includes(t)) s += 5
      if (e.descN.includes(t)) s += 3
      const h = e.headings.find((x) => x.textN.includes(t))
      if (h) {
        s += 3
        anchor ??= h
      }
      if (e.textN.includes(t)) s += Math.min(4, 1 + Math.floor(countOccurrences(e.textN, t) / 3))
      if (s === 0) matchedAll = false
      score += s
    }
    if (!matchedAll || score === 0) continue
    if (e.titleN.includes(q)) score += 8
    const titleHit = terms.some((t) => e.titleN.includes(t))
    results.push({
      key: e.key,
      title: e.article.title,
      groupLabel: e.groupLabel,
      tabLabel: e.tabLabel,
      anchor: titleHit ? undefined : anchor?.id,
      anchorText: titleHit ? undefined : anchor?.text,
      snippet: titleHit ? e.article.description : makeSnippet(e.text, e.textN, terms),
      terms,
      score,
    })
  }
  return results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit)
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function countOccurrences(hay: string, needle: string) {
  let n = 0
  let p = hay.indexOf(needle)
  while (p >= 0 && n < 50) {
    n++
    p = hay.indexOf(needle, p + needle.length)
  }
  return n
}

/** Divide um texto em partes destacadas/não destacadas (comparação sem acentos). */
export function highlightParts(text: string, terms: string[]): { text: string; hit: boolean }[] {
  if (!terms.length) return [{ text, hit: false }]
  const n = normalize(text)
  const marks = new Array(text.length).fill(false)
  for (const t of terms) {
    if (!t) continue
    let p = n.indexOf(t)
    while (p >= 0) {
      for (let i = p; i < p + t.length; i++) marks[i] = true
      p = n.indexOf(t, p + t.length)
    }
  }
  const parts: { text: string; hit: boolean }[] = []
  for (let i = 0; i < text.length; i++) {
    const last = parts[parts.length - 1]
    if (last && last.hit === marks[i]) last.text += text[i]
    else parts.push({ text: text[i]!, hit: marks[i] })
  }
  return parts
}

export { stripInline }
