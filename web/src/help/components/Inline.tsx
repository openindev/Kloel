import { Fragment, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

const TOKEN_RE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(\[([^\]]+)\]\(([^)\s]+)\))|(\[(\d{1,2})\](?!\())/g

export const LINK_CLS =
  'font-medium text-foreground underline decoration-brand/40 decoration-[1.5px] underline-offset-[3px] transition-colors hover:decoration-brand'

export function SmartLink({ href, children, className, onNavigate }: { href: string; children: ReactNode; className?: string; onNavigate?: () => void }) {
  if (href.startsWith('/')) {
    return (
      <Link to={href} className={className ?? LINK_CLS} onClick={onNavigate}>
        {children}
      </Link>
    )
  }
  if (href.startsWith('#')) {
    return (
      <a
        href={href}
        className={className ?? LINK_CLS}
        onClick={(e) => {
          const el = document.getElementById(decodeURIComponent(href.slice(1)))
          if (el) {
            e.preventDefault()
            el.scrollIntoView({ behavior: 'smooth', block: 'start' })
            window.history.replaceState(window.history.state, '', href)
          }
        }}
      >
        {children}
      </a>
    )
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className ?? LINK_CLS}>
      {children}
    </a>
  )
}

/** Renderiza Markdown inline: `código`, **negrito**, *itálico*, [link](href) e citações [n]. */
export function Inline({ text, onCite, onNavigate }: { text: string; onCite?: (n: number) => ReactNode; onNavigate?: () => void }): ReactNode {
  const out: ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  TOKEN_RE.lastIndex = 0
  const re = new RegExp(TOKEN_RE.source, 'g')
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    if (m[1]) {
      out.push(
        <code key={k++} className="rounded-md border border-zinc-200/80 bg-zinc-50 px-1.5 py-0.5 font-mono text-[0.84em] text-zinc-800">
          {m[1].slice(1, -1)}
        </code>,
      )
    } else if (m[2]) {
      out.push(
        <strong key={k++} className="font-semibold text-foreground">
          <Inline text={m[2].slice(2, -2)} onNavigate={onNavigate} />
        </strong>,
      )
    } else if (m[3]) {
      out.push(<em key={k++}>{m[3].slice(1, -1)}</em>)
    } else if (m[4]) {
      out.push(
        <SmartLink key={k++} href={m[6]!} onNavigate={onNavigate}>
          <Inline text={m[5]!} />
        </SmartLink>,
      )
    } else if (m[7]) {
      const n = Number(m[8])
      out.push(onCite ? <Fragment key={k++}>{onCite(n)}</Fragment> : m[7])
    }
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return <>{out}</>
}
