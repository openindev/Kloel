import { Link } from 'react-router-dom'
import { ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'
import { articleHref, sidebarLabel, type HelpTab } from '../content'

/** Sidebar da aba ativa: grupos em negrito, itens em cinza, ativo com fundo cinza claro (captura ao vivo). */
export function HelpSidebar({ tab, activeKey, onNavigate }: { tab: HelpTab; activeKey?: string; onNavigate?: () => void }) {
  return (
    <nav aria-label={`Navegação — ${tab.label}`} className="space-y-8 pb-10">
      {tab.groups.map((g) => (
        <div key={g.label}>
          <h5 className="mb-2 pl-3 text-sm font-semibold leading-6 text-zinc-900">{g.label}</h5>
          <ul className="space-y-1">
            {g.items.map((key) => {
              const active = key === activeKey
              const label = sidebarLabel(key)
              return (
                <li key={key}>
                  {g.external ? (
                    <a
                      href={articleHref(key)}
                      target="_blank"
                      rel="noreferrer"
                      onClick={onNavigate}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'group flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm leading-5 transition-colors',
                        active ? 'bg-zinc-100 font-medium text-zinc-900' : 'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900',
                      )}
                    >
                      <span>{label}</span>
                      <ExternalLink className="size-3.5 shrink-0 text-zinc-500 group-hover:text-zinc-700" aria-label="abre em nova aba" />
                    </a>
                  ) : (
                    <Link
                      to={articleHref(key)}
                      onClick={onNavigate}
                      aria-current={active ? 'page' : undefined}
                      data-active={active || undefined}
                      className={cn(
                        'flex items-center rounded-xl px-3 py-1.5 text-sm leading-5 transition-colors',
                        active ? 'bg-zinc-100 font-medium text-zinc-900' : 'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900',
                      )}
                    >
                      {label}
                    </Link>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}
