import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, CircleX, Ellipsis, Lock, Megaphone, Pause, Play, Plus, RotateCcw, Search, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { Campaign } from '@/domain/types'
import '@/domain/ext/mais-a'
import { cn, formatNumber } from '@/lib/utils'
import { useCollection, useStore } from '@/data/store'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Alert } from '@/components/ui/alert'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { SideSheet } from '@/components/app/SideSheet'
import { ConfirmDialog } from '@/components/app/ConfirmDialog'
import { EmptyState, ResultChip } from '@/components/app/misc'
import { useCampaignsUnlocked } from '../overview/plan-usage'
import { Field } from '../phone-numbers/NumberDialogs'
import { NO_NUMBER_ERROR, outboundNumberOf, runCampaign, useRunnerLabel } from './runner'
import { PageLoadError, PageSkeleton, usePageLoad } from '@/components/app/PageLoad'
import { deleteCampaign } from '@/services/casca/campaigns'

const STATUS: Record<Campaign['status'], { label: string; cls: string }> = {
  draft: { label: 'Rascunho', cls: 'bg-muted text-muted-foreground' },
  scheduled: { label: 'Agendada', cls: 'bg-sky-500/10 text-sky-700' },
  running: { label: 'Em andamento', cls: 'bg-brand/10 text-brand' },
  paused: { label: 'Pausada', cls: 'bg-amber-500/10 text-amber-700' },
  completed: { label: 'Concluída', cls: 'bg-emerald-500/10 text-emerald-700' },
}
const dtFmt = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

function StatusChip({ status }: { status: Campaign['status'] }) {
  return <span className={cn('inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium', STATUS[status].cls)}>{STATUS[status].label}</span>
}

/**
 * Iniciar/retomar: sem número de saída válido (liberado, ou sem ligações de saída) a campanha não liga —
 * o erro fica registrado na campanha e aparece no detalhe, com a escolha de outro número.
 */
function startCampaign(c: Campaign) {
  void runCampaign(c.id).catch(error => toast.error(error.message))
}

/* ------------------------------ Bloqueio por plano ------------------------------ */

function LockedPage() {
  return (
    <div className="pt-10 lg:pt-20 pb-8 px-4 sm:px-8">
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6">
        <div className="xl:text-3xl text-2xl font-semibold tracking-tight">Campanhas outbound</div>
        <section className="mx-auto w-full max-w-xl rounded-xl border px-8 py-12 text-center" data-testid="plan-restriction">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted">
            <Lock className="size-5 text-muted-foreground" />
          </div>
          <h1 className="mt-4 text-lg font-semibold">Disponível a partir do plano Voice Team</h1>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
            Com campanhas outbound, seu assistente liga ativamente para listas de contatos — lembretes, confirmações e reativação de clientes. Faça upgrade para o plano Team ou Scale para liberar este recurso.
          </p>
          <ul className="mx-auto mt-6 max-w-sm space-y-2 text-left text-sm">
            {['Ligações ativas para seus contatos', '3 ligações simultâneas no plano Team', 'Resultados e transcrições em Conversas'].map((t) => (
              <li key={t} className="flex items-center gap-2">
                <span className="flex size-5 items-center justify-center rounded-full bg-brand/10 text-brand">
                  <Megaphone className="size-3" />
                </span>
                {t}
              </li>
            ))}
          </ul>
          <div className="mt-8 flex flex-col justify-center gap-2 sm:flex-row">
            <Link to="/app/change-plan/voice" className={buttonVariants({ variant: 'brand' })}>
              Mudar de plano
            </Link>
            <Link to="/agendar-demo" className={buttonVariants({ variant: 'outline' })}>
              Falar com vendas
            </Link>
          </div>
        </section>
      </div>
    </div>
  )
}

/* -------------------------------- Nova campanha -------------------------------- */

function CreateCampaignSheet({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (c: Campaign) => void }) {
  const agents = useCollection('agents').filter((a) => a.type === 'voice')
  const numbers = useCollection('phoneNumbers').filter((n) => n.capabilities.includes('outbound'))
  const contacts = useCollection('contacts').filter((c) => c.phones.length > 0)
  const [name, setName] = useState('')
  const [objective, setObjective] = useState('')
  const [agentId, setAgentId] = useState('')
  const [numberId, setNumberId] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [q, setQ] = useState('')
  const [when, setWhen] = useState<'now' | 'later'>('now')
  const [at, setAt] = useState('')
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    if (open) {
      setName('')
      setObjective('')
      setAgentId(agents[0]?.id ?? '')
      setNumberId(numbers[0]?.id ?? '')
      setSelected([])
      setQ('')
      setWhen('now')
      setAt('')
      setSubmitted(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const filtered = contacts.filter((c) => !q.trim() || `${c.firstName} ${c.lastName} ${c.phones[0]?.value} ${c.company}`.toLowerCase().includes(q.trim().toLowerCase()))
  const allSel = filtered.length > 0 && filtered.every((c) => selected.includes(c.id))

  const validate = () => {
    const e: Record<string, string> = {}
    if (name.trim().length < 3) e.name = 'O nome deve ter pelo menos 3 caracteres.'
    if (!agentId) e.agent = 'Selecione um assistente.'
    if (!numberId) e.number = 'Selecione um número com ligações de saída.'
    if (selected.length === 0) e.contacts = 'Selecione pelo menos um contato.'
    if (when === 'later' && (!at || new Date(at).getTime() <= Date.now())) e.at = 'Escolha uma data e hora no futuro.'
    return e
  }
  const errors = submitted ? validate() : {}

  function save() {
    setSubmitted(true)
    if (Object.keys(validate()).length) return
    toast.error('A execução de campanhas ainda não está disponível. Nenhuma ligação foi iniciada ou agendada.')
  }

  return (
    <SideSheet open={open} onOpenChange={onOpenChange} title="Nova campanha" description="O assistente liga para os contatos selecionados e registra cada conversa." onSave={save} saveLabel={when === 'now' ? 'Criar e iniciar' : 'Agendar campanha'}>
      <div className="flex flex-col gap-5">
        <Field label="Nome" htmlFor="cmp-name" error={errors.name}>
          <Input id="cmp-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Confirmação de consultas" aria-invalid={!!errors.name || undefined} />
        </Field>
        <Field label="Objetivo da ligação" htmlFor="cmp-obj" help="O assistente usa este objetivo, junto com o prompt dele, durante a ligação.">
          <Textarea id="cmp-obj" rows={2} value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="Ex.: Lembrar da revisão semestral e oferecer um horário." />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Assistente" htmlFor="cmp-agent" error={errors.agent}>
            <Select value={agentId} onValueChange={setAgentId}>
              <SelectTrigger id="cmp-agent">
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {agents.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Número de saída" htmlFor="cmp-number" error={errors.number}>
            <Select value={numberId} onValueChange={setNumberId}>
              <SelectTrigger id="cmp-number">
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {numbers.map((n) => (
                  <SelectItem key={n.id} value={n.id}>
                    {n.name} · {n.number}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        {numbers.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nenhum número com ligações de saída.{' '}
            <Link to="/app/phone-numbers" className="underline underline-offset-4">
              Adicionar número
            </Link>
          </p>
        )}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className={cn(errors.contacts && 'text-destructive')}>Contatos ({selected.length} selecionados)</Label>
            <button
              type="button"
              className="text-xs font-medium text-brand hover:underline"
              onClick={() => setSelected((s) => (allSel ? s.filter((id) => !filtered.some((c) => c.id === id)) : [...new Set([...s, ...filtered.map((c) => c.id)])]))}
            >
              {allSel ? 'Desmarcar todos' : `Selecionar todos (${filtered.length})`}
            </button>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pesquisar contatos" className="pl-9" aria-label="Pesquisar contatos" />
          </div>
          <ul className="max-h-60 divide-y overflow-y-auto rounded-lg border">
            {filtered.length === 0 && <li className="px-3 py-4 text-center text-sm text-muted-foreground">Nenhum contato com telefone encontrado.</li>}
            {filtered.map((c) => (
              <li key={c.id}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-muted/50">
                  <Checkbox checked={selected.includes(c.id)} onCheckedChange={(v) => setSelected((s) => (v ? [...s, c.id] : s.filter((x) => x !== c.id)))} />
                  <span className="min-w-0 flex-1 truncate">
                    {c.firstName} {c.lastName}
                    {c.company && <span className="text-muted-foreground"> · {c.company}</span>}
                  </span>
                  <span className="shrink-0 tabular-nums text-xs text-muted-foreground">{c.phones[0]?.value}</span>
                </label>
              </li>
            ))}
          </ul>
          {errors.contacts && <p className="text-sm font-medium text-destructive">{errors.contacts}</p>}
        </div>
        <div className="space-y-3">
          <Label>Início</Label>
          <RadioGroup value={when} onValueChange={(v) => setWhen(v as 'now' | 'later')} className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm">
              <RadioGroupItem value="now" /> Iniciar agora
            </label>
            <label className="flex items-center gap-2 text-sm">
              <RadioGroupItem value="later" /> Agendar para depois
            </label>
          </RadioGroup>
          {when === 'later' && (
            <Field label="Data e hora" htmlFor="cmp-at" error={errors.at}>
              <Input id="cmp-at" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} aria-invalid={!!errors.at || undefined} />
            </Field>
          )}
        </div>
      </div>
    </SideSheet>
  )
}

/* ---------------------------------- Detalhe ---------------------------------- */

function CampaignDetail({ campaign, onBack, onDelete }: { campaign: Campaign; onBack: () => void; onDelete: () => void }) {
  const agents = useCollection('agents')
  const contacts = useCollection('contacts')
  const numbers = useCollection('phoneNumbers')
  const patch = useStore((s) => s.patch)
  const label = useRunnerLabel(campaign.id)
  const total = campaign.contactIds.length
  const done = Object.keys(campaign.results ?? {}).length
  const agent = agents.find((a) => a.id === campaign.agentId)
  const number = numbers.find((n) => n.id === campaign.phoneNumberId && n.capabilities.includes('outbound'))
  const outboundNumbers = numbers.filter((n) => n.capabilities.includes('outbound'))
  const s = campaign.stats
  const showError = !!campaign.lastError && campaign.status !== 'running' && campaign.status !== 'completed'

  const start = () => startCampaign(campaign)
  const pause = () => {
    toast.error('Não há uma execução de campanha que possa ser pausada.')
  }

  return (
    <div className="flex flex-col gap-6">
      <button type="button" onClick={onBack} className="-ml-1 inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Campanhas
      </button>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="xl:text-3xl text-2xl font-semibold tracking-tight">{campaign.name}</h1>
            <StatusChip status={campaign.status} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {agent?.name ?? 'Assistente removido'} · {number ? `${number.name} (${number.number})` : 'sem número'}
            {campaign.scheduledAt && campaign.status === 'scheduled' && ` · agendada para ${dtFmt.format(new Date(campaign.scheduledAt))}`}
          </p>
          {campaign.objective && <p className="mt-2 max-w-2xl text-sm">{campaign.objective}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {(campaign.status === 'draft' || campaign.status === 'scheduled') && (
            <Button variant="brand" className="gap-1.5" onClick={start}>
              <Play className="size-4" /> Iniciar agora
            </Button>
          )}
          {campaign.status === 'running' && (
            <Button variant="outline" className="gap-1.5" onClick={pause}>
              <Pause className="size-4" /> Pausar
            </Button>
          )}
          {campaign.status === 'paused' && (
            <Button variant="brand" className="gap-1.5" onClick={start}>
              <Play className="size-4" /> Retomar
            </Button>
          )}
          <Button variant="outline" className="gap-1.5 text-destructive hover:text-destructive" onClick={onDelete} disabled={campaign.status === 'running'}>
            <Trash2 className="size-4" /> Excluir
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
        <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
          {[
            ['Contatos', total],
            ['Ligações feitas', s.called],
            ['Atendidas', s.reached],
            ['Resolvidas ou agendadas', s.resolved],
          ].map(([l, v]) => (
            <div key={l as string} className="flex min-w-0 flex-col gap-1 bg-card px-4 py-3.5">
              <div className="truncate text-xs text-muted-foreground">{l}</div>
              <div className="text-2xl font-medium tabular-nums">{formatNumber(v as number)}</div>
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-2 border-t px-4 py-3.5">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="min-w-0 text-muted-foreground sm:truncate">
              {campaign.status === 'running' ? label || 'Preparando próxima ligação…' : campaign.status === 'completed' ? 'Todas as ligações foram feitas.' : `${done} de ${total} contatos processados`}
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <span className="tabular-nums">{total ? Math.round((done / total) * 100) : 0}%</span>
            </span>
          </div>
          <Progress value={total ? (done / total) * 100 : 0} />
        </div>
      </div>

      {showError && (
        <Alert variant="destructive" data-testid="campaign-error">
          <CircleX />
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>
                {campaign.lastError} {campaign.status === 'paused' ? 'A campanha foi pausada.' : 'A campanha não foi iniciada.'}
              </span>
              <Button size="xs" variant="outline" className="gap-1" onClick={start} disabled={!number}>
                <RotateCcw className="h-3.5 w-3.5" /> Tentar novamente
              </Button>
            </div>
            {!number && (
              <div className="flex flex-wrap items-center gap-2 text-foreground">
                <Label htmlFor="cmp-fix-number" className="text-sm font-normal">
                  Número de saída
                </Label>
                <Select
                  value=""
                  disabled={outboundNumbers.length === 0}
                  onValueChange={(v) => {
                    toast.error('A configuração do número de saída para campanhas ainda não está disponível.')
                  }}
                >
                  <SelectTrigger id="cmp-fix-number" aria-label="Número de saída" className="h-8 w-auto min-w-56 bg-background">
                    <SelectValue placeholder={outboundNumbers.length ? 'Escolha um número' : 'Nenhum número com saída'} />
                  </SelectTrigger>
                  <SelectContent>
                    {outboundNumbers.map((n) => (
                      <SelectItem key={n.id} value={n.id}>
                        {n.name} · {n.number}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {outboundNumbers.length === 0 && (
                  <Link to="/app/phone-numbers?add=number" className="text-sm underline underline-offset-4">
                    Adicionar número
                  </Link>
                )}
              </div>
            )}
          </div>
        </Alert>
      )}

      <div className="overflow-hidden rounded-xl border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/30 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 font-medium">Contato</th>
              <th className="hidden px-4 py-2.5 font-medium sm:table-cell">Telefone</th>
              <th className="px-4 py-2.5 font-medium">Resultado</th>
              <th className="hidden px-4 py-2.5 font-medium sm:table-cell">Duração</th>
              <th className="px-4 py-2.5 font-medium">
                <span className="sr-only">Conversa</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {campaign.contactIds.map((id) => {
              const c = contacts.find((x) => x.id === id)
              const r = campaign.results?.[id]
              return (
                <tr key={id} className="hover:bg-muted/40" data-testid="campaign-result-row">
                  <td className="px-4 py-2.5">{c ? `${c.firstName} ${c.lastName}` : 'Contato removido'}</td>
                  <td className="hidden px-4 py-2.5 tabular-nums text-muted-foreground sm:table-cell">{c?.phones[0]?.value ?? '—'}</td>
                  <td className="px-4 py-2.5">{r ? <ResultChip result={r.result} /> : <span className="text-xs text-muted-foreground">Aguardando</span>}</td>
                  <td className="hidden px-4 py-2.5 tabular-nums text-muted-foreground sm:table-cell">{r ? `${Math.floor(r.durationSec / 60)}:${String(r.durationSec % 60).padStart(2, '0')}` : '—'}</td>
                  <td className="px-4 py-2.5 text-right">
                    {r?.conversationId && (
                      <Link to={`/app/inbox/${r.conversationId}`} className="whitespace-nowrap text-xs font-medium text-brand hover:underline">
                        Ver conversa
                      </Link>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ----------------------------------- Página ----------------------------------- */

export default function CampaignsPage() {
  const load = usePageLoad('campaigns')
  const unlocked = useCampaignsUnlocked()
  const campaigns = useCollection('campaigns')
  const agents = useCollection('agents')
  const [params, setParams] = useSearchParams()
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<Campaign>()
  const openId = params.get('id')
  const open = campaigns.find((c) => c.id === openId)
  const sorted = useMemo(() => [...campaigns].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [campaigns])

  // Agendadas vencidas e execuções interrompidas por recarregamento são tratadas pelo agendador global (runner.ts),
  // em qualquer tela do app.

  if (load.isLoading || load.isError) {
    return (
      <div className="pt-10 lg:pt-20 pb-8 px-4 sm:px-8">
        <div className="mx-auto w-full max-w-[1200px]">{load.isError ? <PageLoadError onRetry={load.retry} /> : <PageSkeleton rows={4} />}</div>
      </div>
    )
  }

  if (!unlocked) return <LockedPage />

  const setOpen = (id: string | null) => {
    const next = new URLSearchParams(params)
    if (id) next.set('id', id)
    else next.delete('id')
    setParams(next)
  }

  return (
    <div className="pt-10 lg:pt-20 pb-8 px-4 sm:px-8">
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6">
        {open ? (
          <CampaignDetail campaign={open} onBack={() => setOpen(null)} onDelete={() => setDeleting(open)} />
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="xl:text-3xl text-2xl font-semibold tracking-tight">Campanhas outbound</div>
              <Button className="h-10 gap-1.5 bg-brand pl-3 pr-4 text-white hover:bg-brand/90" onClick={() => setCreating(true)}>
                <Plus className="size-4" /> Nova campanha
              </Button>
            </div>
            {sorted.length === 0 ? (
              <EmptyState
                icon={<Megaphone />}
                title="Nenhuma campanha ainda"
                description="Crie uma campanha para que seu assistente ligue para uma lista de contatos e registre cada resultado."
                action={
                  <Button onClick={() => setCreating(true)} className="gap-1.5">
                    <Plus className="size-4" /> Nova campanha
                  </Button>
                }
              />
            ) : (
              <div className="overflow-hidden rounded-xl border border-border bg-background">
                <ul className="divide-y">
                  {sorted.map((c) => {
                    const done = Object.keys(c.results ?? {}).length
                    const total = c.contactIds.length
                    return (
                      <li key={c.id} className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-muted/50" data-testid="campaign-row">
                        <button type="button" onClick={() => setOpen(c.id)} className="flex min-w-0 flex-1 flex-col gap-1 text-left sm:flex-row sm:items-center sm:gap-4">
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              <span className="truncate font-medium">{c.name}</span>
                              <StatusChip status={c.status} />
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {agents.find((a) => a.id === c.agentId)?.name ?? '—'} · {total} contatos · criada em {dtFmt.format(new Date(c.createdAt))}
                            </span>
                          </span>
                          <span className="flex w-full shrink-0 items-center gap-3 sm:w-56">
                            <Progress value={total ? (done / total) * 100 : 0} className="flex-1" />
                            <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">
                              {done}/{total}
                            </span>
                          </span>
                          <span className="hidden w-40 shrink-0 text-xs text-muted-foreground md:block">
                            {c.stats.reached} atendidas · {c.stats.resolved} resolvidas
                          </span>
                        </button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon-sm" aria-label={`Ações para ${c.name}`}>
                              <Ellipsis className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            <DropdownMenuItem onSelect={() => setOpen(c.id)}>Ver detalhes</DropdownMenuItem>
                            {(c.status === 'draft' || c.status === 'scheduled' || c.status === 'paused') && (
                              <DropdownMenuItem onSelect={() => startCampaign(c)}>{c.status === 'paused' ? 'Retomar' : 'Iniciar agora'}</DropdownMenuItem>
                            )}
                            {c.status === 'running' && <DropdownMenuItem onSelect={() => toast.error('Não foi possível confirmar a pausa da campanha.')}>Pausar</DropdownMenuItem>}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem disabled={c.status === 'running'} className="text-destructive focus:text-destructive" onSelect={() => setDeleting(c)}>
                              Excluir
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
      <CreateCampaignSheet open={creating} onOpenChange={setCreating} onCreated={(c) => setOpen(c.id)} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(undefined)}
        title="Excluir campanha?"
        description={`"${deleting?.name ?? ''}" será excluída. As conversas já registradas continuam em Conversas.`}
        confirmLabel="Excluir"
        onConfirm={async () => {
          if (!deleting) return
          await deleteCampaign(deleting.id)
          if (openId === deleting.id) setOpen(null)
          toast.success('Campanha excluída')
        }}
      />
    </div>
  )
}
