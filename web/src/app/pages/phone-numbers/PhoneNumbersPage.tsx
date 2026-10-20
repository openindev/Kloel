import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { loadOwnedPlatformNumbers, type OwnedPlatformNumber } from '@/services/casca/phones'
import { useSearchParams } from 'react-router-dom'
import { ArrowDownLeft, ArrowDownUp, ArrowUpRight, Ellipsis, Link2, Link2Off, PencilLine, Plus, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import type { PhoneNumber } from '@/domain/types'
import '@/domain/ext/mais-a'
import { cn, formatNumber } from '@/lib/utils'
import { useCollection, useStore } from '@/data/store'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ConfirmDialog } from '@/components/app/ConfirmDialog'
import { WhatsAppIcon } from '@/components/brand/icons'
import { AddNumberDialog, ImportNumberDialog, LinkAgentDialog, RenameDialog, SipDialog } from './NumberDialogs'
import { flagCode } from './countries'
import { NO_NUMBER_ERROR } from '../campaigns/runner'
import { PageLoadError, PageSkeleton, usePageLoad } from '@/components/app/PageLoad'
import { phoneCommands } from '@/services/casca/phones'
import '@/domain/ext/engine-phones'

type Cap = 'all' | 'inbound' | 'outbound' | 'whatsapp'
const CAP_TABS: { value: Cap; label: string }[] = [
  { value: 'all', label: 'Tudo' },
  { value: 'inbound', label: 'Entrada' },
  { value: 'outbound', label: 'Saída' },
  { value: 'whatsapp', label: 'WhatsApp' },
]
// OBSERVADO (central de ajuda, FS-09): chip cinza "SIP Trunk" ao lado do nome → "Tronco SIP"
const KIND_LABEL: Record<PhoneNumber['kind'], string> = { purchased: '', sip: 'Tronco SIP', imported: 'Importado' }

const COL = {
  name: 'pl-5 min-w-[200px] w-[280px]',
  number: 'w-[180px] min-w-[160px]',
  usage: 'w-[112px] min-w-[96px]',
  link: 'min-w-[160px] flex-1',
  actions: 'w-12 shrink-0',
}

/** Preço mensal dos números comprados na plataforma (incluído no plano ou extra), por número E.164. */
function usePlatformNumberPrices(refreshKey: unknown) {
  const [prices, setPrices] = useState<Map<string, OwnedPlatformNumber>>(new Map())
  useEffect(() => {
    let alive = true
    loadOwnedPlatformNumbers().then((r) => alive && setPrices(new Map(r.items.map((n) => [n.number, n]))), () => undefined)
    return () => { alive = false }
  }, [refreshKey])
  return prices
}

export default function PhoneNumbersPage() {
  const load = usePageLoad('phone-numbers')
  const numbers = useCollection('phoneNumbers')
  const platformPrices = usePlatformNumberPrices(numbers.length)
  const agents = useCollection('agents')
  const waAccounts = useCollection('whatsappAccounts')
  const campaigns = useCollection('campaigns')
  const { patch, remove } = useStore.getState()
  const [params, setParams] = useSearchParams()
  const cap = (CAP_TABS.some((t) => t.value === params.get('cap')) ? params.get('cap') : 'all') as Cap
  /** Diálogos de adicionar: estado local — na Fonio abrir "Adicionar número de telefone"/"Criar número SIP"/"Importar número" não muda a URL. */
  const [dialog, setDialog] = useState<'number' | 'sip' | 'import' | null>(null)
  const [q, setQ] = useState('')
  const [renaming, setRenaming] = useState<PhoneNumber>()
  const [linking, setLinking] = useState<PhoneNumber>()
  const [releasing, setReleasing] = useState<PhoneNumber>()

  const setParam = (k: string, v: string | null) => {
    const next = new URLSearchParams(params)
    if (v === null) next.delete(k)
    else next.set(k, v)
    setParams(next, { replace: true })
  }

  // Links antigos/de outras telas (?add=number|sip|import, ex.: Campanhas → "Adicionar número"): abre o diálogo e limpa a URL.
  // Parâmetros da central PBX (?add=pbx, ?pbx=) não existem na Fonio e são descartados.
  useEffect(() => {
    const add = params.get('add')
    if (!add && !params.has('pbx')) return
    if (add === 'number' || add === 'sip' || add === 'import') setDialog(add)
    const next = new URLSearchParams(params)
    next.delete('add')
    next.delete('pbx')
    setParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])

  const agentName = (id?: string) => agents.find((a) => a.id === id)?.name
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase()
    // números: compara só os dígitos ("1190000" encontra "+55 11 90000-0200")
    const digits = term.replace(/\D/g, '')
    return [...numbers]
      .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))
      .filter((n) => cap === 'all' || n.capabilities.includes(cap))
      .filter((n) => !term || [n.name, n.number, agentName(n.agentId) ?? ''].some((s) => s.toLowerCase().includes(term)) || (digits.length >= 2 && n.number.replace(/\D/g, '').includes(digits)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numbers, cap, q, agents])

  const linkedCampaigns = releasing ? campaigns.filter((c) => c.phoneNumberId === releasing.id && c.status !== 'completed') : []

  const usage = (n: PhoneNumber) => {
    if (n.whatsappAccountId) {
      const acc = waAccounts.find((a) => a.id === n.whatsappAccountId)
      const m = acc?.messagesThisMonth
      if (m == null) return '–'
      return `${formatNumber(m)} ${m === 1 ? 'mensagem' : 'mensagens'}`
    }
    return n.minutesUsed === null ? '–' : `${formatNumber(n.minutesUsed)} min`
  }

  /** Uso (OBSERVADO FS-09): ícones de entrada ↙ e saída ↗, escuros quando o número está em uso naquela direção. */
  const usageCell = (n: PhoneNumber) => {
    if (n.whatsappAccountId) return <span className="tabular-nums text-muted-foreground">{usage(n)}</span>
    const dir = (cap: 'inbound' | 'outbound', label: string, icon: ReactNode) => {
      const on = n.capabilities.includes(cap) && !!n.agentId && (cap !== 'inbound' || !n.enginePhone || n.enginePhone.inboundReady)
      return (
        <span
          className={cn('flex size-5 items-center justify-center rounded-full', on ? 'bg-muted text-foreground' : 'bg-muted/40 text-muted-foreground/50')}
          aria-label={`${label}: ${on ? 'em uso' : n.capabilities.includes(cap) ? 'sem assistente' : 'indisponível'}`}
          data-active={on || undefined}
        >
          {icon}
        </span>
      )
    }
    return (
      <span className="flex items-center gap-1.5" title={n.minutesUsed === null ? undefined : `${formatNumber(n.minutesUsed)} min neste ciclo`} data-testid="usage-icons">
        {dir('inbound', 'Entrada', <ArrowDownLeft className="size-3" strokeWidth={2.5} />)}
        {dir('outbound', 'Saída', <ArrowUpRight className="size-3" strokeWidth={2.5} />)}
      </span>
    )
  }


  if (load.isLoading || load.isError) {
    return (
      <div className="pt-10 lg:pt-20 pb-8 px-4 sm:px-8">
        <div className="mx-auto w-full max-w-[1200px]">{load.isError ? <PageLoadError onRetry={load.retry} /> : <PageSkeleton rows={4} />}</div>
      </div>
    )
  }

  return (
    <div className="pt-10 lg:pt-20 pb-8 px-4 sm:px-8">
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6">
        <div className="xl:text-3xl text-2xl font-semibold tracking-tight flex flex-row items-center min-w-0">
          <span>Números de telefone</span>
        </div>
        <div className="flex w-full flex-col gap-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative w-full sm:w-52 sm:shrink-0">
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => e.key === 'Escape' && q && setQ('')}
                  placeholder="Pesquisar"
                  aria-label="Pesquisar"
                  className="h-10 text-sm pr-9"
                />
                {/* Fonio: caixa de ícone à direita, sem ícone visível em repouso (captura ao vivo); aqui ela traz "Limpar" quando há texto. */}
                <div className="pointer-events-none absolute inset-y-0 right-1 flex items-center">
                  {q && (
                    <Button type="button" variant="ghost" size="icon-xs" aria-label="Limpar pesquisa" className="pointer-events-auto text-muted-foreground" onClick={() => setQ('')}>
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
              <Tabs value={cap} onValueChange={(v) => setParam('cap', v === 'all' ? null : v)}>
                <TabsList aria-label="Filtrar capacidades" className="h-10 w-full justify-start sm:w-auto">
                  {CAP_TABS.map((t) => (
                    <TabsTrigger key={t.value} value={t.value} className="flex-1 sm:flex-none">
                      {t.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button className="h-10 px-4 py-2 gap-1.5 bg-brand pl-3 pr-4 text-white hover:bg-brand/90 rounded-md text-sm font-medium max-sm:w-full">
                    <Plus className="size-4" />
                    Adicionar número de telefone
                  </Button>
                </DropdownMenuTrigger>
                {/* OBSERVADO (fonio-live2/E-numeros/02): 3 itens sem ícones, largura do conteúdo, alinhado à direita */}
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setDialog('number')}>Adicionar número de telefone</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setDialog('sip')}>Criar número SIP</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setDialog('import')}>Importar número</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="hidden items-center px-1 sm:flex" aria-hidden>
              {(
                [
                  ['Nome', COL.name],
                  ['Número', COL.number],
                  ['Uso', COL.usage],
                  ['Vinculação', COL.link],
                  ['', COL.actions],
                ] as const
              ).map(([label, cls], i) => (
                <div key={i} className={cn('whitespace-nowrap px-2 text-xs font-medium text-muted-foreground', cls)}>
                  {label}
                </div>
              ))}
            </div>
            <div className="overflow-hidden rounded-xl border border-border bg-background">
              <table className="w-full caption-bottom text-sm">
                <thead className="sr-only">
                  <tr>
                    <th>Nome</th>
                    <th>Número</th>
                    <th>Uso</th>
                    <th>Vinculação</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody className="[&_tr:last-child]:border-0">
                  {rows.length === 0 && (
                    <tr className="border-b transition-colors hover:bg-muted/50">
                      <td colSpan={5} className="p-4 align-middle h-24 text-center">
                        Nenhum número encontrado
                      </td>
                    </tr>
                  )}
                  {rows.map((n) => {
                    const agent = agentName(n.agentId)
                    return (
                      <tr key={n.id} className="flex border-b px-[3px] transition-colors hover:bg-muted/50" data-testid="number-row">
                        <td className={cn('min-w-0 flex-1 px-2 py-3 align-middle sm:flex-none', COL.name, 'max-sm:w-auto max-sm:min-w-0 max-sm:pl-4')}>
                          <div className="flex min-w-0 items-center gap-2">
                            {n.capabilities.includes('whatsapp') && <WhatsAppIcon className="h-4 w-4 shrink-0 text-emerald-600" />}
                            <span className="truncate font-medium">{n.name}</span>
                            {KIND_LABEL[n.kind] && !n.whatsappAccountId && (
                              <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium leading-none text-foreground/80">{KIND_LABEL[n.kind]}</span>
                            )}
                          </div>
                          <div className="mt-1 flex flex-col gap-0.5 text-xs text-muted-foreground sm:hidden">
                            <span className="tabular-nums">{n.number} · {usage(n)}</span>
                            <span>{agent ? `Vinculado a ${agent}` : 'Sem assistente'}</span>
                          </div>
                        </td>
                        <td className={cn('hidden px-2 py-3 align-middle sm:block', COL.number)}>
                          <span className="flex items-center gap-2 tabular-nums">
                            {n.kind !== 'sip' && <span className={cn('fi', `fi-${flagCode(n.country)}`, 'shrink-0 rounded-[2px]')} />}
                            <span className="truncate">{n.number}</span>
                          </span>
                          {platformPrices.get(n.number) && (
                            <span className="mt-0.5 block text-xs text-muted-foreground" data-testid="number-price">
                              {(() => { const o = platformPrices.get(n.number)!; return `${o.locality ? `${o.locality} · ` : ''}${o.allowance === 'included' ? 'Incluído no plano' : `${o.monthlyPriceBRL.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}/mês`}` })()}
                            </span>
                          )}
                        </td>
                        <td className={cn('hidden px-2 py-3 align-middle sm:flex sm:items-center', COL.usage)}>{usageCell(n)}</td>
                        <td className={cn('hidden px-2 py-2 align-middle sm:block', COL.link)}>
                          <button
                            type="button"
                            onClick={() => setLinking(n)}
                            className="-mx-2 inline-flex max-w-full items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-accent"
                          >
                            {agent ? (
                              <span className="inline-flex h-6 max-w-full items-center gap-1 rounded-full bg-muted px-2 text-xs font-medium" data-testid="assignment-chip">
                                <ArrowDownUp className="size-3 shrink-0 text-muted-foreground" />
                                <span className="truncate">{agent}</span>
                              </span>
                            ) : (
                              <span className="text-muted-foreground">Sem vinculação</span>
                            )}
                          </button>
                        </td>
                        <td className={cn('flex items-center justify-end px-2 py-2 align-middle', COL.actions)}>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon-sm" aria-label={`Ações para ${n.name}`}>
                                <Ellipsis className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-52">
                              <DropdownMenuItem onSelect={() => setRenaming(n)}>
                                <PencilLine className="text-muted-foreground" />
                                Renomear
                              </DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => setLinking(n)}>
                                <Link2 className="text-muted-foreground" />
                                Vincular assistente
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                disabled={!n.agentId}
                                onSelect={async () => {
                                  try { await phoneCommands().update(n, { agentId: null }); toast.success('Assistente desvinculado do número') }
                                  catch (error) { toast.error(error instanceof Error ? error.message : 'Não foi possível desvincular o assistente.') }
                                }}
                              >
                                <Link2Off className="text-muted-foreground" />
                                Desvincular
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setReleasing(n)}>
                                <Trash2 />
                                Liberar número
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <AddNumberDialog open={dialog === 'number'} onOpenChange={(o) => !o && setDialog(null)} />
      <SipDialog open={dialog === 'sip'} onOpenChange={(o) => !o && setDialog(null)} />
      <ImportNumberDialog open={dialog === 'import'} onOpenChange={(o) => !o && setDialog(null)} />
      <RenameDialog number={renaming} onOpenChange={(o) => !o && setRenaming(undefined)} />
      <LinkAgentDialog number={linking} onOpenChange={(o) => !o && setLinking(undefined)} />
      <ConfirmDialog
        open={!!releasing}
        onOpenChange={(o) => !o && setReleasing(undefined)}
        title="Liberar número?"
        description={
          (releasing?.whatsappAccountId
            ? `O número ${releasing.number} será liberado e a conta do WhatsApp Business vinculada será desconectada. Esta ação não pode ser desfeita.`
            : `O número ${releasing?.number ?? ''} será liberado e deixará de receber e fazer ligações. Esta ação não pode ser desfeita.`) +
          (linkedCampaigns.length
            ? ` ${linkedCampaigns.length === 1 ? 'A campanha' : 'As campanhas'} ${linkedCampaigns.map((c) => `"${c.name}"`).join(', ')} ${linkedCampaigns.length === 1 ? 'usa' : 'usam'} este número para ligar e ${linkedCampaigns.length === 1 ? 'ficará parada' : 'ficarão paradas'} até você escolher outro número de saída.`
            : '')
        }
        confirmLabel="Liberar número"
        onConfirm={async () => {
          if (!releasing) return
          await phoneCommands().release(releasing)
          toast.success('Número liberado', { description: linkedCampaigns.length ? `${releasing.number} · ${linkedCampaigns.length} campanha(s) aguardando outro número` : releasing.number })
        }}
      />
    </div>
  )
}
