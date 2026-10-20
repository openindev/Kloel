import { useState, type ReactNode } from 'react'
import { Braces, ChevronDown, Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { SimpleTooltip } from '@/components/ui/tooltip'
import { INTEGRATION_VARIABLE_KEYS, type VariableDef } from './variables'
import { useScopedVariables } from './variableScope'

/**
 * Contexto de uso das variáveis:
 * - `before`: "Antes da conversa" — variáveis que só existem depois da conversa ficam desabilitadas/riscadas (ref. EM-03);
 * - `inbound`: webhook de entrada — só dados da chamada que está tocando (ref. IW-04: Assistente, Chamada: origem/destino/SIP,
 *   Empresa: Nome, Contato…);
 * - `default`: durante/depois da conversa (refs. EM-06, SM-04, HR-04).
 */
export type VariableContext = 'default' | 'before' | 'inbound'

/** Ordem alfabética pelo prefixo ("Chamada" antes de "Chamada de saída") e depois pelo restante do rótulo. */
function byLabelPrefix(a: VariableDef, b: VariableDef) {
  const [pa, ...ra] = a.label.split(':')
  const [pb, ...rb] = b.label.split(':')
  return pa!.localeCompare(pb!, 'pt-BR') || ra.join(':').localeCompare(rb.join(':'), 'pt-BR')
}

const byLabel = (a: VariableDef, b: VariableDef) => a.label.localeCompare(b.label, 'pt-BR')

const INBOUND_KEYS = new Set(['agent.name', 'company.name', 'call.fromNumber', 'call.toNumber', 'call.sipHeaders'])

export function variablesForContext(list: VariableDef[], context: VariableContext) {
  if (context === 'inbound') return list.filter((v) => INBOUND_KEYS.has(v.key) || v.group === 'Contato')
  return list.filter((v) => v.phase !== 'inbound')
}

/**
 * Menu "Adicionar variável" (refs. 484/492 e Central de ajuda EM-06/SM-04/IW-04/HR-04): busca "Buscar variáveis…",
 * grupos, "?" (pode estar vazia), ⓘ (descrição), rodapé "Não encontrou sua variável?…". No editor escuro (`dark`) a lista é
 * corrida e em fonte monoespaçada no formato {{Rótulo}}, como nas refs. IW-04/HR-04.
 */
export function VariablePicker({
  onPick,
  trigger,
  variant = 'text',
  align = 'end',
  groups,
  triggerClassName,
  context = 'default',
  restoreFocus = true,
}: {
  onPick: (v: VariableDef) => void
  /** false: ao fechar, o foco não volta ao gatilho (o editor com chips recoloca o cursor depois da variável inserida) */
  restoreFocus?: boolean
  /** ajuste de medidas do gatilho de texto (ex.: barra do editor de e-mail, ref. 514) */
  triggerClassName?: string
  trigger?: ReactNode
  variant?: 'text' | 'dark' | 'braces'
  align?: 'start' | 'end'
  groups?: VariableDef['group'][]
  context?: VariableContext
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  // C-40: "Variáveis predefinidas" e "Esta integração" abertos; "Contato" recolhido (com busca, todos abrem)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ contact: true })
  // Só as variáveis liberadas em "Conectar contatos" para este assistente (+ campos inteligentes marcados).
  const available = useScopedVariables()
  const list = variablesForContext(groups ? available.filter((v) => groups.includes(v.group)) : available, context)
  const mono = variant === 'dark'
  const sections: { id: string; title?: string; items: VariableDef[] }[] = mono
    ? // ref. IW-04/HR-04: lista corrida em ordem alfabética
      [{ id: 'all', items: [...list].sort(byLabelPrefix) }]
    : [
        // C-40: ordem alfabética do rótulo inteiro ("Chamada de saída: …" antes de "Chamada: Direção")
        { id: 'predefined', title: 'Variáveis predefinidas', items: list.filter((v) => v.group !== 'Contato' && !INTEGRATION_VARIABLE_KEYS.includes(v.key)).sort(byLabel) },
        { id: 'contact', title: 'Contato', items: list.filter((v) => v.group === 'Contato').sort(byLabel) },
        { id: 'integration', title: 'Esta integração', items: INTEGRATION_VARIABLE_KEYS.map((k) => list.find((v) => v.key === k)).filter((v): v is VariableDef => !!v) },
      ].filter((s) => s.items.length)
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) setQuery('')
      }}
    >
      <PopoverTrigger asChild>
        {trigger ?? (
          variant === 'braces' ? (
            // C-38: botão lucide-braces [aria "Adicionar variável"] à direita do assunto
            <button type="button" aria-label="Adicionar variável" className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
              <Braces className="size-4" />
            </button>
          ) : (
            <button
              type="button"
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm font-medium transition-colors',
                // refs. 540/546: no editor escuro o gatilho tem 12px
                variant === 'dark' ? 'text-xs text-[#A6ADC8] hover:text-white' : 'text-foreground hover:bg-accent',
                triggerClassName,
              )}
            >
              Adicionar variável <ChevronDown className="size-4" />
            </button>
          )
        )}
      </PopoverTrigger>
      <PopoverContent
        align={align}
        // C-40: popover largo w-[min(640px,…)]
        className={cn('p-0', mono ? 'w-[380px] max-w-[calc(100vw-2rem)]' : 'w-[min(640px,calc(100vw-2rem))]')}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={restoreFocus ? undefined : (e) => e.preventDefault()}
      >
        <Command>
          {/* refs. IW-04/HR-04: no editor escuro a lista abre direto, sem campo de busca */}
          {!mono && <CommandInput placeholder="Buscar variáveis..." autoFocus value={query} onValueChange={setQuery} />}
          <CommandList className={mono ? 'max-h-72' : 'max-h-[360px]'}>
            <CommandEmpty>Nenhum resultado encontrado.</CommandEmpty>
            {sections.map((s) => {
              const isCollapsed = !mono && !query.trim() && collapsed[s.id]
              return (
                <CommandGroup
                  key={s.id}
                  // recolhido o grupo fica sem itens: forceMount mantém o título visível (cmdk esconde grupos vazios)
                  forceMount={isCollapsed || undefined}
                  heading={
                    s.title ? (
                      <button type="button" className="flex w-full items-center gap-1.5 text-left" aria-expanded={!isCollapsed} onClick={() => setCollapsed((c) => ({ ...c, [s.id]: !c[s.id] }))}>
                        <ChevronDown className={cn('size-3.5 transition-transform', isCollapsed && '-rotate-90')} />
                        {s.title}
                      </button>
                    ) : undefined
                  }
                >
                  {!isCollapsed &&
                    s.items.map((v) => {
                      const off = context === 'before' && v.phase === 'after'
                      return (
                        <CommandItem
                          key={v.key}
                          value={`${v.label} ${v.key}`}
                          disabled={off}
                          data-unavailable={off || undefined}
                          onSelect={() => {
                            onPick(v)
                            setOpen(false)
                            setQuery('')
                          }}
                          className={mono ? undefined : 'px-4 py-2'}
                        >
                          <span className={cn('flex-1', mono ? 'break-all font-mono text-[13px] text-muted-foreground' : 'truncate', off && 'line-through')}>{mono ? `{{${v.label}}}` : v.label}</span>
                          {v.optional && (
                            <SimpleTooltip label="Esta variável pode estar vazia.">
                              <span className="text-xs font-semibold text-muted-foreground">?</span>
                            </SimpleTooltip>
                          )}
                          <SimpleTooltip label={v.description}>
                            <Info className="!size-3.5 text-muted-foreground" />
                          </SimpleTooltip>
                        </CommandItem>
                      )
                    })}
                </CommandGroup>
              )
            })}
          </CommandList>
          <div className="border-t px-3 py-2.5 text-xs leading-5 text-muted-foreground">
            Não encontrou sua variável? Esta lista não é completa; outras variáveis ainda podem funcionar, por ex.{' '}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground">{'{{variableName}}'}</code>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

/** Insere texto na posição do cursor de um input/textarea controlado. */
export function insertAtCursor(el: HTMLInputElement | HTMLTextAreaElement | null, current: string, insert: string): { value: string; caret: number } {
  if (!el) return { value: current + insert, caret: (current + insert).length }
  const start = el.selectionStart ?? current.length
  const end = el.selectionEnd ?? current.length
  const value = current.slice(0, start) + insert + current.slice(end)
  return { value, caret: start + insert.length }
}
