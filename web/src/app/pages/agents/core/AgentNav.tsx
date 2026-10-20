import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Check, ChevronsUpDown, CirclePlus, MessageSquare, Plus, Sparkles, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Agent, AgentType } from '@/domain/types'
import { useCollection, useStore, useUi } from '@/data/store'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { SimpleTooltip } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AGENT_TYPE_LABEL, AgentTypeChip } from './ui'

export type AgentTab = 'general' | 'rules' | 'knowledge' | 'prompt' | 'technical'

/**
 * Abas do assistente (OBSERVADO ao vivo: Geral · Regras · Conhecimento · Prompt personalizado · Técnico). Assistente de chat
 * (Central de ajuda WC-02/WC-03, OBSERVADO): Geral, Regras, Conhecimento e Prompt personalizado — sem Técnico. Não existe aba "Canal".
 */
export function tabsFor(type: AgentType): { id: AgentTab; label: string }[] {
  const base: { id: AgentTab; label: string }[] = [
    { id: 'general', label: 'Geral' },
    { id: 'rules', label: 'Regras' },
    { id: 'knowledge', label: 'Conhecimento' },
    { id: 'prompt', label: 'Prompt personalizado' },
  ]
  return type === 'chat' ? base : [...base, { id: 'technical', label: 'Técnico' }]
}

const PROMO_KEY = 'agents.chatbot-promo'
const MENU_BTN =
  'peer/menu-button flex w-full items-center gap-2 overflow-hidden rounded-lg p-2 text-left outline-none ring-ring transition-[width,height,padding] focus-visible:ring-2 active:bg-accent active:text-accent-foreground hover:bg-accent hover:text-accent-foreground data-[active=true]:bg-accent data-[active=true]:font-medium data-[active=true]:text-accent-foreground text-sm h-10 px-4'

/** Linha de status do assistente no seletor: número conectado ou aviso. */
function useConnectionLabel() {
  const numbers = useCollection('phoneNumbers')
  const wa = useCollection('whatsappAccounts')
  return (a: Agent) => {
    if (a.type === 'chat') {
      const acc = wa.find((w) => w.agentId === a.id)
      if (acc) return acc.number
    }
    const nums = numbers.filter((n) => n.agentId === a.id)
    if (!nums.length) return 'Nenhum número de telefone conectado'
    return nums[0]!.number
  }
}

/**
 * Seletor de assistentes (OBSERVADO: fonio-live2/C-assistentes/03 + data/switcher.json): Popover w-[22rem] com cmdk, busca
 * "Pesquisar assistentes…", itens em ordem alfabética (nome 13px + selo do tipo + número conectado ou "Nenhum número de telefone
 * conectado"), ✓ text-brand no atual e rodapé "⊕ Novo assistente".
 */
export function AgentSwitcher({ agent, tab, onCreate, className }: { agent: Agent; tab: AgentTab; onCreate: () => void; className?: string }) {
  const [open, setOpen] = useState(false)
  const agents = useCollection('agents')
  const sorted = useMemo(() => [...agents].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }) || a.createdAt.localeCompare(b.createdAt)), [agents])
  const navigate = useNavigate()
  const connection = useConnectionLabel()
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Trocar assistente"
          className={cn(
            'flex w-full min-w-0 items-center justify-between gap-2 rounded-lg px-3 py-2 text-left outline-none hover:bg-accent focus:ring-1 focus:ring-ring data-[state=open]:bg-accent',
            className,
          )}
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-4">{agent.name}</p>
            <p className="truncate text-sm leading-4 text-muted-foreground">{AGENT_TYPE_LABEL[agent.type]}</p>
          </div>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[22rem] max-w-[calc(100vw-1rem)] p-0">
        <Command>
          <CommandInput placeholder="Pesquisar assistentes…" />
          <CommandList>
            <CommandEmpty>Nenhum assistente encontrado.</CommandEmpty>
            <CommandGroup>
              {sorted.map((a) => (
                <CommandItem
                  key={a.id}
                  value={`${a.name} ${a.id}`}
                  onSelect={() => {
                    setOpen(false)
                    const next = tabsFor(a.type).some((t) => t.id === tab) ? tab : 'general'
                    if (a.id !== agent.id) navigate(`/app/agents/${a.id}/${next}`)
                  }}
                  className="gap-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="truncate text-[13px] font-medium">{a.name}</p>
                      <AgentTypeChip type={a.type} />
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <span className="truncate">{connection(a)}</span>
                    </div>
                  </div>
                  {a.id === agent.id && <Check className="size-4 shrink-0 text-brand" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
          <div className="border-t p-1">
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                onCreate()
              }}
              className="flex w-full items-center justify-center gap-2 rounded-sm px-2 py-1.5 text-sm font-medium text-brand hover:bg-accent"
            >
              <CirclePlus className="size-4" />
              Novo assistente
            </button>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function ChatbotPromo({ onCreateChat }: { onCreateChat: () => void }) {
  const ui = useUi()
  if (ui.dismissed[PROMO_KEY]) return null
  return (
    <div className="mt-auto shrink-0 px-3 pb-4 pt-8">
      <section
        aria-label="Conheça seu chatbot de IA"
        className="relative isolate overflow-hidden rounded-xl border border-brand/20 bg-gradient-to-br from-brand/[0.15] via-brand/5 to-background p-4"
      >
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <Sparkles className="absolute right-11 top-12 size-5 rotate-12 text-brand/35" />
          <span className="absolute right-5 top-24 h-2 w-1 -rotate-12 rounded-full bg-amber-400/60" />
          <span className="absolute left-24 top-11 h-1 w-2 rotate-45 rounded-full bg-brand/35" />
          <span className="absolute right-20 top-8 size-1.5 rounded-full bg-sky-400/60" />
        </div>
        <div className="mb-4 flex items-center justify-between gap-2">
          <span className="inline-flex items-center rounded-full border border-transparent bg-brand/10 px-2.5 py-0.5 text-xs font-semibold text-brand">Novo</span>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Dispensar anúncio"
            className="-mr-2 -mt-2 text-muted-foreground"
            onClick={() => useStore.getState().setUi({ dismissed: { ...useStore.getState().db.ui.dismissed, [PROMO_KEY]: true } })}
          >
            <X className="size-3.5" />
          </Button>
        </div>
        <div className="mb-3 flex size-10 items-center justify-center rounded-xl bg-brand/10 text-brand">
          <MessageSquare className="size-5" />
        </div>
        <h2 className="text-sm font-semibold">Conheça seu chatbot de IA</h2>
        <p className="mb-4 mt-2 text-xs leading-relaxed text-muted-foreground">Seu chatbot de IA agora pode responder a perguntas no seu site como uma pessoa.</p>
        <button
          type="button"
          onClick={onCreateChat}
          className="inline-flex h-auto min-h-9 w-full items-center justify-center whitespace-normal rounded-md bg-brand px-2 py-2 text-xs font-medium text-white transition-colors hover:bg-brand/90"
        >
          Criar chatbot de IA
        </button>
      </section>
    </div>
  )
}

/** Coluna secundária (desktop, lg+): seletor + "Criar assistente" + abas verticais + cartão promocional. */
export function AgentAside({ agent, tab, onCreate }: { agent: Agent; tab: AgentTab; onCreate: (type?: AgentType) => void }) {
  return (
    <aside className="hidden w-[260px] shrink-0 flex-col overflow-visible border-r bg-background dark:bg-zinc-900 lg:flex">
      <div className="flex h-full flex-col">
        <div className="flex h-[68px] shrink-0 items-start px-3 pt-4">
          <div className="flex w-full min-w-0 items-center gap-1">
            <AgentSwitcher agent={agent} tab={tab} onCreate={() => onCreate()} />
            <SimpleTooltip label="Criar assistente">
              <Button variant="outline" size="icon-sm" aria-label="Criar assistente" className="size-8 shrink-0 rounded-lg" onClick={() => onCreate()}>
                <Plus className="size-4" />
              </Button>
            </SimpleTooltip>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <ul className="flex w-full min-w-0 shrink-0 flex-col gap-1 px-3 pt-14">
            {tabsFor(agent.type).map((t) => (
              <li key={t.id}>
                <Link to={`/app/agents/${agent.id}/${t.id}`} data-active={tab === t.id} aria-current={tab === t.id ? 'page' : undefined} className={MENU_BTN}>
                  <span className="truncate text-sm">{t.label}</span>
                </Link>
              </li>
            ))}
          </ul>
          <ChatbotPromo onCreateChat={() => onCreate('chat')} />
        </div>
      </div>
    </aside>
  )
}

/** Navegação móvel (< lg): seletor + TabsList horizontal. */
export function MobileAgentNav({ agent, tab, onCreate }: { agent: Agent; tab: AgentTab; onCreate: (type?: AgentType) => void }) {
  const navigate = useNavigate()
  const stripRef = useRef<HTMLDivElement>(null)
  // < lg: a faixa de abas rola na horizontal; a aba ativa (ex.: Técnico por URL direta) é trazida para a área visível.
  // Ajuste só de scrollLeft (scrollIntoView também rolaria a página na vertical).
  useEffect(() => {
    const strip = stripRef.current
    const active = strip?.querySelector<HTMLElement>('[role="tab"][data-state="active"]')
    if (!strip || !active || strip.clientWidth === 0) return
    const pad = 16
    const left = active.offsetLeft - strip.scrollLeft
    const right = left + active.offsetWidth
    if (left < pad) strip.scrollLeft += left - pad
    else if (right > strip.clientWidth - pad) strip.scrollLeft += right - (strip.clientWidth - pad)
  }, [tab, agent.id])
  return (
    <div className="mb-6 lg:hidden">
      <div className="mb-3 flex max-w-xs items-center gap-1">
        <AgentSwitcher agent={agent} tab={tab} onCreate={() => onCreate()} className="border" />
        <Button variant="outline" size="icon-sm" aria-label="Criar assistente" className="size-8 shrink-0 rounded-lg" onClick={() => onCreate()}>
          <Plus className="size-4" />
        </Button>
      </div>
      <div ref={stripRef} className="no-scrollbar relative -mx-4 overflow-x-auto px-4">
        <Tabs value={tab} onValueChange={(v) => navigate(`/app/agents/${agent.id}/${v}`)}>
          <TabsList className="w-max">
            {tabsFor(agent.type).map((t) => (
              <TabsTrigger key={t.id} value={t.id} className="gap-2">
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
    </div>
  )
}
