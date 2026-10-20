/**
 * Parser do subconjunto de Markdown + diretivas usado nos artigos (ver src/help/content/types.ts).
 * Gera uma árvore simples usada pela renderização, pelo sumário, pela busca, pelo assistente e pela exportação.
 */

export type Attrs = Record<string, string>

export interface ListItem {
  text: string
  children: string[]
}

export type Block =
  | { type: 'heading'; level: 2 | 3 | 4; text: string; id: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; start: number; items: ListItem[] }
  | { type: 'table'; head: string[]; rows: string[][] }
  | { type: 'code'; lang: string; code: string }
  | { type: 'quote'; text: string }
  | { type: 'hr' }
  | { type: 'container'; kind: string; label?: string; attrs: Attrs; children: Block[] }
  | { type: 'steps'; steps: { title: string; id: string; children: Block[] }[] }
  | { type: 'cards'; cards: { title: string; href: string; description: string }[] }
  | { type: 'leaf'; kind: string; label?: string; attrs: Attrs }

export interface TocItem {
  id: string
  text: string
  level: 2 | 3
}

export interface ParsedDoc {
  blocks: Block[]
  toc: TocItem[]
}

const CONTAINER_RE = /^(:{3,})([a-z][\w-]*)(?:\[([^\]]*)\])?(?:\{(.*)\})?\s*$/
const LEAF_RE = /^::([a-z][\w-]*)(?:\[([^\]]*)\])?(?:\{(.*)\})?\s*$/
const FENCE_RE = /^(```|~~~)\s*([\w-]*)\s*$/
const HEADING_RE = /^(#{2,4})\s+(.*)$/
const LIST_RE = /^(\s*)([-*]|\d+[.)])\s+(.*)$/
const TABLE_SEP_RE = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/

export function slugify(text: string) {
  return (
    text
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[`*_[\]()]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'secao'
  )
}

export function parseAttrs(raw?: string): Attrs {
  const out: Attrs = {}
  if (!raw) return out
  const re = /([\w-]+)=(?:"([^"]*)"|'([^']*)'|(\S+))/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw))) out[m[1]!] = m[2] ?? m[3] ?? m[4] ?? ''
  return out
}

class Slugger {
  private seen = new Map<string, number>()
  make(text: string) {
    const base = slugify(stripInline(text))
    const n = this.seen.get(base) ?? 0
    this.seen.set(base, n + 1)
    return n === 0 ? base : `${base}-${n + 1}`
  }
}

/** Remove marcação inline (para texto puro). */
export function stripInline(text: string) {
  return text
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
}

function isBlockStart(line: string) {
  return (
    HEADING_RE.test(line) ||
    FENCE_RE.test(line) ||
    CONTAINER_RE.test(line) ||
    LEAF_RE.test(line) ||
    /^\s*([-*]|\d+[.)])\s+/.test(line) ||
    line.startsWith('|') ||
    line.startsWith('>') ||
    /^---+\s*$/.test(line)
  )
}

function findClose(lines: string[], from: number, colons: number) {
  let inFence: string | null = null
  for (let i = from; i < lines.length; i++) {
    const l = lines[i]!
    const f = FENCE_RE.exec(l.trim())
    if (f) {
      if (!inFence) inFence = f[1]!
      else if (f[1] === inFence && !f[2]) inFence = null
      continue
    }
    if (inFence) continue
    const t = l.trim()
    if (/^:+$/.test(t) && t.length === colons) return i
  }
  return lines.length
}

function splitRow(line: string) {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|')) s = s.slice(0, -1)
  // permite \| dentro de células
  return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'))
}

function parseBlocks(lines: string[], slugger: Slugger): Block[] {
  const blocks: Block[] = []
  let i = 0
  while (i < lines.length) {
    const raw = lines[i]!
    const line = raw.trimEnd()
    const trimmed = line.trim()
    if (!trimmed) {
      i++
      continue
    }

    // bloco de código
    const fence = FENCE_RE.exec(trimmed)
    if (fence) {
      const marker = fence[1]!
      const code: string[] = []
      i++
      while (i < lines.length && lines[i]!.trim() !== marker) {
        code.push(lines[i]!)
        i++
      }
      i++
      const indent = Math.min(...code.filter((c) => c.trim()).map((c) => c.length - c.trimStart().length), 99)
      blocks.push({ type: 'code', lang: fence[2] || 'text', code: code.map((c) => c.slice(indent === 99 ? 0 : indent)).join('\n') })
      continue
    }

    // contêiner :::tipo[rótulo]{attrs}
    const cont = CONTAINER_RE.exec(trimmed)
    if (cont) {
      const colons = cont[1]!.length
      const kind = cont[2]!
      const close = findClose(lines, i + 1, colons)
      const inner = lines.slice(i + 1, close)
      i = close + 1
      if (kind === 'steps') {
        const steps: { title: string; id: string; children: Block[] }[] = []
        let current: { title: string; lines: string[] } | null = null
        const flush = () => {
          if (current) steps.push({ title: current.title, id: slugger.make('passo ' + current.title), children: parseBlocks(current.lines, slugger) })
        }
        let inFence = false
        for (const l of inner) {
          if (FENCE_RE.test(l.trim())) inFence = !inFence
          const h = !inFence ? /^###\s+(.*)$/.exec(l.trim()) : null
          if (h) {
            flush()
            current = { title: h[1]!.trim(), lines: [] }
          } else if (current) current.lines.push(l)
          else if (l.trim()) current = { title: '', lines: [l] }
        }
        flush()
        blocks.push({ type: 'steps', steps })
        continue
      }
      if (kind === 'cards') {
        const cards: { title: string; href: string; description: string }[] = []
        for (const l of inner) {
          const m = /^\s*[-*]\s+\[([^\]]+)\]\(([^)\s]+)\)\s*[—–:-]?\s*(.*)$/.exec(l)
          if (m) cards.push({ title: m[1]!, href: m[2]!, description: m[3]!.trim() })
        }
        blocks.push({ type: 'cards', cards })
        continue
      }
      blocks.push({ type: 'container', kind, label: cont[3]?.trim() || undefined, attrs: parseAttrs(cont[4]), children: parseBlocks(inner, slugger) })
      continue
    }

    // diretiva de linha ::tipo{attrs}
    const leaf = LEAF_RE.exec(trimmed)
    if (leaf) {
      blocks.push({ type: 'leaf', kind: leaf[1]!, label: leaf[2]?.trim() || undefined, attrs: parseAttrs(leaf[3]) })
      i++
      continue
    }

    const h = HEADING_RE.exec(trimmed)
    if (h) {
      const level = h[1]!.length as 2 | 3 | 4
      const text = h[2]!.trim()
      blocks.push({ type: 'heading', level, text, id: slugger.make(text) })
      i++
      continue
    }

    if (/^---+\s*$/.test(trimmed)) {
      blocks.push({ type: 'hr' })
      i++
      continue
    }

    // tabela
    if (trimmed.startsWith('|') && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1]!.trim())) {
      const head = splitRow(trimmed)
      const rows: string[][] = []
      i += 2
      while (i < lines.length && lines[i]!.trim().startsWith('|')) {
        rows.push(splitRow(lines[i]!))
        i++
      }
      blocks.push({ type: 'table', head, rows })
      continue
    }

    // lista
    const li = LIST_RE.exec(line)
    if (li && li[1]!.length < 2) {
      const ordered = /\d/.test(li[2]!)
      const start = ordered ? parseInt(li[2]!, 10) || 1 : 1
      const items: ListItem[] = []
      while (i < lines.length) {
        const l = lines[i]!.trimEnd()
        if (!l.trim()) {
          // lista continua se a próxima linha não vazia for item
          const next = lines.slice(i + 1).find((x) => x.trim())
          if (next && LIST_RE.test(next) && (LIST_RE.exec(next)![1]!.length >= 2 || /\d/.test(LIST_RE.exec(next)![2]!) === ordered)) {
            i++
            continue
          }
          break
        }
        const m = LIST_RE.exec(l)
        if (m && m[1]!.length < 2) {
          if (/\d/.test(m[2]!) !== ordered) break
          items.push({ text: m[3]!, children: [] })
        } else if (m && m[1]!.length >= 2 && items.length) {
          items[items.length - 1]!.children.push(m[3]!)
        } else if (items.length && /^\s{2,}\S/.test(l)) {
          const last = items[items.length - 1]!
          if (last.children.length) last.children[last.children.length - 1] += ' ' + l.trim()
          else last.text += ' ' + l.trim()
        } else break
        i++
      }
      blocks.push({ type: 'list', ordered, start, items })
      continue
    }

    if (trimmed.startsWith('>')) {
      const q: string[] = []
      while (i < lines.length && lines[i]!.trim().startsWith('>')) {
        q.push(lines[i]!.trim().replace(/^>\s?/, ''))
        i++
      }
      blocks.push({ type: 'quote', text: q.join(' ') })
      continue
    }

    // parágrafo
    const para: string[] = [trimmed]
    i++
    while (i < lines.length && lines[i]!.trim() && !isBlockStart(lines[i]!.trim())) {
      para.push(lines[i]!.trim())
      i++
    }
    blocks.push({ type: 'paragraph', text: para.join(' ') })
  }
  return blocks
}

const cache = new Map<string, ParsedDoc>()

export function parseDoc(body: string): ParsedDoc {
  const hit = cache.get(body)
  if (hit) return hit
  const slugger = new Slugger()
  const blocks = parseBlocks(body.replace(/\r\n/g, '\n').split('\n'), slugger)
  const toc: TocItem[] = []
  for (const b of blocks) if (b.type === 'heading' && b.level <= 3) toc.push({ id: b.id, text: stripInline(b.text), level: b.level as 2 | 3 })
  const doc = { blocks, toc }
  cache.set(body, doc)
  return doc
}

/* ----------------------------- Texto puro ----------------------------- */

export function blocksToText(blocks: Block[]): string {
  const out: string[] = []
  for (const b of blocks) {
    switch (b.type) {
      case 'heading':
      case 'paragraph':
      case 'quote':
        out.push(stripInline(b.text))
        break
      case 'list':
        for (const it of b.items) out.push(stripInline(it.text), ...it.children.map(stripInline))
        break
      case 'table':
        out.push(b.head.map(stripInline).join(' · '))
        for (const r of b.rows) out.push(r.map(stripInline).join(' · '))
        break
      case 'code':
        out.push(b.code)
        break
      case 'container':
        if (b.label) out.push(stripInline(b.label))
        out.push(blocksToText(b.children))
        break
      case 'steps':
        for (const s of b.steps) out.push(stripInline(s.title), blocksToText(s.children))
        break
      case 'cards':
        for (const c of b.cards) out.push(c.title, c.description)
        break
      case 'leaf':
        if (b.attrs.caption) out.push(b.attrs.caption)
        break
    }
  }
  return out.filter(Boolean).join('\n')
}

/** Divide o artigo em trechos por H2 (para o assistente e para a busca por seção). */
export function chunkDoc(doc: ParsedDoc): { id: string | null; heading: string | null; blocks: Block[] }[] {
  const chunks: { id: string | null; heading: string | null; blocks: Block[] }[] = [{ id: null, heading: null, blocks: [] }]
  for (const b of doc.blocks) {
    if (b.type === 'heading' && b.level === 2) chunks.push({ id: b.id, heading: stripInline(b.text), blocks: [] })
    else chunks[chunks.length - 1]!.blocks.push(b)
  }
  return chunks.filter((c) => c.heading || c.blocks.length)
}

/* --------------------------- Exportação Markdown --------------------------- */

const CALLOUT_LABEL: Record<string, string> = { tip: 'Dica', info: 'Informação', warning: 'Atenção', danger: 'Importante', note: 'Nota' }

export function blocksToMarkdown(blocks: Block[], depth = 0): string {
  const out: string[] = []
  for (const b of blocks) {
    switch (b.type) {
      case 'heading':
        out.push(`${'#'.repeat(b.level)} ${b.text}`)
        break
      case 'paragraph':
        out.push(b.text)
        break
      case 'quote':
        out.push(`> ${b.text}`)
        break
      case 'hr':
        out.push('---')
        break
      case 'list':
        out.push(
          b.items
            .map((it, idx) => [`${b.ordered ? `${b.start + idx}.` : '-'} ${it.text}`, ...it.children.map((c) => `  - ${c}`)].join('\n'))
            .join('\n'),
        )
        break
      case 'table':
        out.push([`| ${b.head.join(' | ')} |`, `|${b.head.map(() => '---').join('|')}|`, ...b.rows.map((r) => `| ${r.join(' | ')} |`)].join('\n'))
        break
      case 'code':
        out.push('```' + b.lang + '\n' + b.code + '\n```')
        break
      case 'container': {
        if (b.kind === 'tabs') {
          out.push(blocksToMarkdown(b.children, depth + 1))
          break
        }
        if (b.kind === 'tab' || b.kind === 'faq') {
          out.push(`**${b.label ?? ''}**`, blocksToMarkdown(b.children, depth + 1))
          break
        }
        const title = b.label ?? CALLOUT_LABEL[b.kind] ?? b.kind
        const inner = blocksToMarkdown(b.children, depth + 1)
        out.push(`> **${title}**\n>\n` + inner.split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n'))
        break
      }
      case 'steps':
        b.steps.forEach((s, idx) => out.push(`**Passo ${idx + 1}: ${s.title}**`, blocksToMarkdown(s.children, depth + 1)))
        break
      case 'cards':
        out.push(b.cards.map((c) => `- [${c.title}](${c.href})${c.description ? ` — ${c.description}` : ''}`).join('\n'))
        break
      case 'leaf':
        if (b.kind === 'mockup') out.push(`*[Ilustração: ${b.attrs.caption ?? b.attrs.kind ?? 'interface da Kloel'}]*`)
        else if (b.kind === 'tiles') out.push('*[Grade de integrações — ver a seção Integrações da central]*')
        break
    }
  }
  return out.filter((s) => s !== '').join('\n\n')
}
