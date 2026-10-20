import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle, Check, ChevronDown, CircleCheck, Copy, Info, Lightbulb, Link2, OctagonAlert, Search, StickyNote, ArrowRight, Plug, Code, Globe,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { IntegrationLogo } from '@/components/brand/IntegrationLogo'
import type { Block } from '../lib/markdown'
import { normalize } from '../lib/search'
import { copyText } from '../lib/ui'
import { getArticle, HELP_TABS } from '../content'
import { Inline } from './Inline'
import { Mockup } from './Mockups'

export function ArticleBody({ blocks }: { blocks: Block[] }) {
  return (
    <div className="help-prose">
      <Blocks blocks={blocks} />
    </div>
  )
}

function Blocks({ blocks, compact }: { blocks: Block[]; compact?: boolean }) {
  return (
    <>
      {blocks.map((b, i) => (
        <BlockView key={i} block={b} compact={compact} />
      ))}
    </>
  )
}

function HeadingAnchor({ id }: { id: string }) {
  return (
    <a
      href={`#${id}`}
      aria-label="Link para esta seção"
      className="absolute -left-6 top-1/2 hidden -translate-y-1/2 rounded-md p-1 text-zinc-400 opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 md:block"
      onClick={(e) => {
        e.preventDefault()
        window.history.replaceState(window.history.state, '', `#${id}`)
        document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }}
    >
      <Link2 className="size-3.5" />
    </a>
  )
}

function BlockView({ block: b, compact }: { block: Block; compact?: boolean }) {
  switch (b.type) {
    case 'heading': {
      if (b.level === 2)
        return (
          <h2 id={b.id} data-toc className="group relative mb-3 mt-10 scroll-mt-36 text-[22px] font-semibold leading-8 tracking-tight text-foreground first:mt-0">
            <HeadingAnchor id={b.id} />
            <Inline text={b.text} />
          </h2>
        )
      if (b.level === 3)
        return (
          <h3 id={b.id} data-toc className="group relative mb-2 mt-8 scroll-mt-36 text-lg font-semibold leading-7 tracking-tight text-foreground">
            <HeadingAnchor id={b.id} />
            <Inline text={b.text} />
          </h3>
        )
      return (
        <h4 id={b.id} className="mb-2 mt-6 scroll-mt-36 text-base font-semibold text-foreground">
          <Inline text={b.text} />
        </h4>
      )
    }
    case 'paragraph':
      return (
        <p className={cn('text-[15px] leading-7 text-zinc-700', compact ? 'my-2' : 'my-4')}>
          <Inline text={b.text} />
        </p>
      )
    case 'quote':
      return (
        <blockquote className="my-4 border-l-2 border-brand/40 pl-4 text-[15px] leading-7 text-zinc-600">
          <Inline text={b.text} />
        </blockquote>
      )
    case 'hr':
      return <hr className="my-8 border-zinc-200" />
    case 'list': {
      const Tag = b.ordered ? 'ol' : 'ul'
      return (
        <Tag
          start={b.ordered ? b.start : undefined}
          className={cn(
            'space-y-2 pl-6 text-[15px] leading-7 text-zinc-700 marker:text-zinc-400',
            b.ordered ? 'list-decimal marker:font-medium' : 'list-disc',
            compact ? 'my-2' : 'my-4',
          )}
        >
          {b.items.map((it, i) => (
            <li key={i} className="pl-1">
              <Inline text={it.text} />
              {it.children.length > 0 && (
                <ul className="mt-2 list-[circle] space-y-1.5 pl-5">
                  {it.children.map((c, j) => (
                    <li key={j}>
                      <Inline text={c} />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </Tag>
      )
    }
    case 'table':
      return (
        <div className="my-6 overflow-x-auto rounded-xl border border-zinc-200">
          <table className="w-full min-w-[480px] border-collapse text-left text-sm">
            <thead className="bg-zinc-50/80">
              <tr>
                {b.head.map((h, i) => (
                  <th key={i} className="px-4 py-2.5 font-semibold text-foreground">
                    <Inline text={h} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, i) => (
                <tr key={i} className="border-t border-zinc-200">
                  {r.map((c, j) => (
                    <td key={j} className="px-4 py-2.5 align-top leading-6 text-zinc-700">
                      <Inline text={c} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'code':
      return <CodeBlock lang={b.lang} code={b.code} />
    case 'container':
      return <ContainerView block={b} />
    case 'steps':
      return (
        <div className="my-6" role="list">
          {b.steps.map((s, i) => (
            <div key={i} role="listitem" className="relative flex items-start gap-4 pb-6 last:pb-0">
              {i < b.steps.length - 1 && <div className="absolute bottom-0 left-[13px] top-9 w-px bg-zinc-200" aria-hidden />}
              <div className="relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-xs font-semibold text-zinc-900">{i + 1}</div>
              <div className="min-w-0 flex-1 pt-0.5">
                {s.title && (
                  <p id={s.id} className="scroll-mt-36 text-[15px] font-semibold leading-6 text-foreground">
                    <Inline text={s.title} />
                  </p>
                )}
                <div className="[&>*:first-child]:mt-2 [&>*:last-child]:mb-0">
                  <Blocks blocks={s.children} compact />
                </div>
              </div>
            </div>
          ))}
        </div>
      )
    case 'cards':
      return (
        <div className="my-6 grid gap-4 sm:grid-cols-2">
          {b.cards.map((c, i) => (
            <Link key={i} to={c.href} className="group rounded-2xl border border-zinc-200 p-5 transition-colors hover:border-brand/60">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-foreground">{c.title}</span>
                <ArrowRight className="size-4 text-zinc-400 transition-transform group-hover:translate-x-0.5 group-hover:text-brand" />
              </div>
              {c.description && <p className="mt-1.5 text-sm leading-6 text-zinc-600">{c.description}</p>}
            </Link>
          ))}
        </div>
      )
    case 'leaf':
      if (b.kind === 'mockup') return <Mockup kind={b.attrs.kind ?? ''} attrs={b.attrs} />
      if (b.kind === 'tiles') return <IntegrationTiles />
      return null
  }
}

const CALLOUTS: Record<string, { icon: typeof Info; box: string; icon_cls: string; title: string }> = {
  tip: { icon: Lightbulb, box: 'border-emerald-500/20 bg-emerald-50/60', icon_cls: 'text-emerald-600', title: 'Dica' },
  check: { icon: CircleCheck, box: 'border-emerald-500/20 bg-emerald-50/60', icon_cls: 'text-emerald-600', title: 'Pronto' },
  info: { icon: Info, box: 'border-sky-500/20 bg-sky-50/60', icon_cls: 'text-sky-600', title: 'Informação' },
  warning: { icon: AlertTriangle, box: 'border-amber-500/25 bg-amber-50/60', icon_cls: 'text-amber-600', title: 'Atenção' },
  danger: { icon: OctagonAlert, box: 'border-red-500/20 bg-red-50/60', icon_cls: 'text-red-600', title: 'Importante' },
  note: { icon: StickyNote, box: 'border-zinc-200 bg-zinc-50/80', icon_cls: 'text-zinc-500', title: 'Nota' },
}

function ContainerView({ block: b }: { block: Extract<Block, { type: 'container' }> }) {
  if (b.kind === 'faq') return <FaqItem label={b.label ?? 'Pergunta'} blocks={b.children} />
  if (b.kind === 'tabs') return <TabsView blocks={b.children} />
  if (b.kind === 'tab') return <Blocks blocks={b.children} compact />
  const c = CALLOUTS[b.kind] ?? CALLOUTS.note!
  const Icon = c.icon
  return (
    <div className={cn('my-5 flex gap-3 rounded-2xl border px-5 py-4', c.box)} role="note">
      <Icon className={cn('mt-[3px] size-4 shrink-0', c.icon_cls)} />
      <div className="min-w-0 flex-1 text-sm leading-6 text-zinc-800 [&_li]:text-sm [&_li]:leading-6 [&_p]:text-sm [&_p]:leading-6 [&_p]:text-zinc-800 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
        {b.label && <p className="!mb-1 !mt-0 font-semibold text-foreground">{b.label}</p>}
        <Blocks blocks={b.children} compact />
      </div>
    </div>
  )
}

function FaqItem({ label, blocks }: { label: string; blocks: Block[] }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="my-3 rounded-xl border border-zinc-200">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-[15px] font-medium text-foreground hover:bg-zinc-50/80">
        <span>
          <Inline text={label} />
        </span>
        <ChevronDown className={cn('size-4 shrink-0 text-zinc-500 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="border-t border-zinc-200 px-4 pb-3 pt-1 [&>*:last-child]:mb-0">
          <Blocks blocks={blocks} compact />
        </div>
      )}
    </div>
  )
}

function TabsView({ blocks }: { blocks: Block[] }) {
  const tabs = blocks.filter((b): b is Extract<Block, { type: 'container' }> => b.type === 'container' && b.kind === 'tab')
  const [active, setActive] = useState(0)
  if (!tabs.length) return null
  return (
    <div className="my-6 rounded-2xl border border-zinc-200">
      <div role="tablist" className="no-scrollbar flex gap-1 overflow-x-auto border-b border-zinc-200 px-3">
        {tabs.map((t, i) => (
          <button
            key={i}
            role="tab"
            type="button"
            aria-selected={i === active}
            onClick={() => setActive(i)}
            className={cn(
              '-mb-px shrink-0 whitespace-nowrap border-b-2 px-2.5 py-2.5 text-sm transition-colors',
              i === active ? 'border-zinc-900 font-medium text-foreground' : 'border-transparent text-zinc-500 hover:text-foreground',
            )}
          >
            {t.label ?? `Aba ${i + 1}`}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="px-5 py-1 [&>*:first-child]:mt-3">
        <Blocks blocks={tabs[active]!.children} compact />
      </div>
    </div>
  )
}

export function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="group my-5 overflow-hidden rounded-xl border border-zinc-800 bg-[#0f1117]">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2">
        <span className="font-mono text-xs text-zinc-400">{lang}</span>
        <button
          type="button"
          aria-label="Copiar código"
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
          onClick={async () => {
            const ok = await copyText(code)
            if (ok) {
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            } else toast.error('Não foi possível copiar.')
          }}
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? 'Copiado' : 'Copiar'}
        </button>
      </div>
      <pre className="overflow-x-auto px-4 py-3.5 font-mono text-[13px] leading-6 text-zinc-100">
        <code>{code}</code>
      </pre>
    </div>
  )
}

/** Grade pesquisável de integrações (equivale ao bloco "tiles searchable" da referência). */
export function IntegrationTiles() {
  const [q, setQ] = useState('')
  const items = useMemo(() => {
    const keys = HELP_TABS.find((t) => t.id === 'integrations')!.groups.find((g) => g.label === 'Integrações')!.items
    return [...keys, 'developers/http-request', 'actions/websearch']
      .map((k) => ({ key: k, title: getArticle(k)?.title ?? k }))
      .sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'))
  }, [])
  const filtered = items.filter((i) => normalize(i.title).includes(normalize(q.trim())))
  return (
    <div className="my-6">
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar integração…"
          aria-label="Buscar integração"
          className="h-10 w-full rounded-xl border border-zinc-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-brand/50 focus:ring-2 focus:ring-brand/15"
        />
      </div>
      {filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-zinc-500">Nenhuma integração encontrada para “{q}”.</p>
      ) : (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {filtered.map((i) => (
            <Link key={i.key} to={`/ajuda/${i.key}`} className="flex items-center gap-2.5 rounded-xl border border-zinc-200 px-3 py-2.5 text-sm font-medium text-foreground transition-colors hover:border-brand/50 hover:bg-zinc-50/60">
              {i.key === 'developers/http-request' ? (
                <span className="flex size-7 items-center justify-center rounded-md bg-zinc-100"><Code className="size-3.5" /></span>
              ) : i.key === 'actions/websearch' ? (
                <span className="flex size-7 items-center justify-center rounded-md bg-zinc-100"><Globe className="size-3.5" /></span>
              ) : (
                <IntegrationLogo slug={i.key.split('/')[1]} name={i.title} />
              )}
              <span className="truncate">{i.title}</span>
              <Plug className="ml-auto size-3.5 shrink-0 text-zinc-300" />
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
