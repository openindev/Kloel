import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Check, CheckCircle2, ChevronDown, Download, FileText, Info, Loader2, RotateCcw, Upload, X, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import type { Contact, SmartFieldDef } from '@/domain/types'
import '@/domain/ext/inbox-contacts'
import { cn } from '@/lib/utils'
import { useStore } from '@/data/store'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { SimpleTooltip } from '@/components/ui/tooltip'
import { prepareContactImport } from '@/services/casca/contacts'
import { downloadFile, parseCsv, toCsv, useIsDesktop } from '../inbox/shared'
import { readXlsxRows } from './xlsxRead'
import { BASE_TARGETS, autoMap, buildPlan, changedFieldLabels, formatInt, historyEvent, mergeInto, type ContactQuota, type ImportRecord, type ImportTarget, type MergePolicy, type PlanRow } from './lib'
import { ContactQuotaAlert } from './QuotaAlert'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { Segmented } from '@/components/ui/segmented'

const STEPS = ['Enviar', 'Mapear colunas', 'Revisar', 'Importando', 'Concluído'] as const
const MAX_BYTES = 5 * 1024 * 1024
const PREVIEW_ROWS = 200

/** Filtro da prévia da revisão: permite inspecionar, por exemplo, só as linhas ignoradas (inclusive pela cota do plano). */
type ReviewFilter = 'all' | 'new' | 'merge' | 'skip'
const matchReview = (f: ReviewFilter, p: PlanRow) =>
  f === 'all' || (f === 'new' && p.status.kind === 'new') || (f === 'merge' && (p.status.kind === 'merge' || p.status.kind === 'merge_file')) || (f === 'skip' && p.status.kind === 'skip')

function StatusBadge({ p }: { p: PlanRow }) {
  const s = p.status
  if (s.kind === 'new') return <span data-status="new" className="inline-flex rounded bg-green-50 px-1.5 py-0.5 text-[10px] font-medium text-green-800">Novo</span>
  if (s.kind === 'merge')
    return (
      <span data-status="merge" className="inline-flex max-w-full rounded bg-brand/10 px-1.5 py-0.5 text-[10px] font-medium text-brand" title={`Mesclar com ${s.name}`}>
        <span className="truncate">Mesclar com {s.name}</span>
      </span>
    )
  if (s.kind === 'merge_file') return <span data-status="merge_file" className="inline-flex rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">Mesclar com a linha {s.row}</span>
  if (s.quota) return <span data-status="skip" className="inline-flex rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-700">Ignorado: {s.reason}</span>
  return <span data-status="skip" className="inline-flex rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">Ignorado: {s.reason}</span>
}

const recName = (p: PlanRow) => `${p.record.firstName} ${p.record.lastName}`.trim()

const NOT_MAPPED = '__none__'
const FIELD_HINT: Partial<Record<string, string>> = {
  fullName: 'Separado em nome e sobrenome',
  phone: 'Mapeie quantas colunas quiser',
  email: 'Mapeie quantas colunas quiser',
}
const FIELD_INFO: Partial<Record<string, string>> = {
  phone: 'Cada coluna mapeada vira um telefone do contato. Telefones são usados para encontrar contatos já existentes.',
  email: 'Cada coluna mapeada vira um e-mail do contato. E-mails são usados para encontrar contatos já existentes.',
}
const examplesOf = (rows: string[][], cols: number[]) =>
  rows
    .slice(0, 3)
    .flatMap((r) => cols.map((c) => r[c]?.trim()))
    .filter(Boolean)
    .slice(0, 3)
    .join(' · ')

/**
 * Uma linha CAMPO → COLUNA DO CSV. Campos simples: um select ("Não mapeado" + colunas); Telefones/E-mails: várias colunas
 * (menu com caixas de seleção). Escolher uma coluna já usada por outro campo a move para este campo.
 */
function FieldMapRow({
  target,
  headers,
  rows,
  mapping,
  onChange,
}: {
  target: { value: ImportTarget; label: string; multi?: boolean }
  headers: string[]
  rows: string[][]
  mapping: ImportTarget[]
  onChange: (m: ImportTarget[]) => void
}) {
  const t = target.value
  const cols = mapping.map((x, i) => (x === t ? i : -1)).filter((i) => i >= 0)
  const label = t === 'phone' ? 'Telefones' : t === 'email' ? 'E-mails' : target.label.replace(' (campo inteligente)', '')
  const smart = target.label.endsWith('(campo inteligente)')
  const hint = FIELD_HINT[t] ?? (smart ? 'Campo inteligente' : undefined)
  const info = FIELD_INFO[t]
  const ex = examplesOf(rows, cols)
  const triggerCls = 'flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring'
  return (
    <div role="row" className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] items-center gap-3 px-4 py-3 max-sm:grid-cols-1 max-sm:gap-2" data-map-field={t}>
      <div role="cell" className="min-w-0">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <span className="truncate">{label}</span>
          {info && (
            <SimpleTooltip label={info}>
              <Info className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label={info} />
            </SimpleTooltip>
          )}
        </p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div role="cell" className="min-w-0">
        {target.multi ? (
          <DropdownMenu>
            <DropdownMenuTrigger aria-label={`Colunas do CSV para ${label}`} className={cn(triggerCls, !cols.length && 'text-muted-foreground')}>
              <span className="truncate">{cols.length ? cols.map((c) => headers[c]).join(', ') : 'Não mapeado'}</span>
              <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-[200px]">
              {headers.map((h, i) => (
                <DropdownMenuCheckboxItem
                  key={i}
                  checked={mapping[i] === t}
                  onSelect={(e) => e.preventDefault()}
                  onCheckedChange={(on) => onChange(mapping.map((x, j) => (j === i ? (on ? t : 'ignore') : x)))}
                >
                  <span className="truncate">{h}</span>
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Select
            value={cols.length ? String(cols[0]) : NOT_MAPPED}
            onValueChange={(v) =>
              onChange(v === NOT_MAPPED ? mapping.map((x) => (x === t ? 'ignore' : x)) : mapping.map((x, j) => (j === Number(v) ? t : x === t ? 'ignore' : x)))
            }
          >
            <SelectTrigger aria-label={`Coluna do CSV para ${label}`} className={cn('h-9', !cols.length && 'text-muted-foreground')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NOT_MAPPED}>Não mapeado</SelectItem>
              <SelectSeparator />
              {headers.map((h, i) => (
                <SelectItem key={i} value={String(i)}>
                  {h}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {ex && <p className="mt-1 truncate text-[11px] text-muted-foreground">ex.: {ex}</p>}
      </div>
    </div>
  )
}

export function ImportDialog({
  open,
  onOpenChange,
  contacts,
  smartFields,
  quota,
  onDone,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  contacts: Contact[]
  smartFields: SmartFieldDef[]
  /** Cota de contatos do plano: linhas novas além do restante são ignoradas na revisão. */
  quota?: ContactQuota
  onDone?: () => void
}) {
  const [step, setStep] = useState(1)
  const [fileName, setFileName] = useState('')
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<string[][]>([])
  const [mapping, setMapping] = useState<ImportTarget[]>([])
  const [error, setError] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<{ created: number; updated: number; skipped: number } | null>(null)
  const [policy, setPolicy] = useState<MergePolicy>('keep')
  // An uncertain operation is recovered through its API receipt before another import.
  const [runError, setRunError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [preparing, setPreparing] = useState(false)
  const preparedRef = useRef<Awaited<ReturnType<typeof prepareContactImport>> | null>(null)
  const commitRef = useRef<Promise<{ created: number; updated: number; skipped: number }> | null>(null)
  const [reviewedPlan, setReviewedPlan] = useState<ReturnType<typeof buildPlan> | null>(null)
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('all')
  const inputRef = useRef<HTMLInputElement>(null)
  const isWide = useIsDesktop()

  const reset = () => {
    preparedRef.current = null; commitRef.current = null; setReviewedPlan(null)
    setStep(1)
    setFileName('')
    setHeaders([])
    setRows([])
    setMapping([])
    setError('')
    setProgress(0)
    setResult(null)
    setPolicy('keep')
    setRunError('')
    setReviewFilter('all')
  }
  useEffect(() => {
    if (open) reset()
  }, [open])

  const targets = useMemo(
    () => [...BASE_TARGETS, ...smartFields.map((f) => ({ value: `field:${f.id}` as ImportTarget, label: `${f.label} (campo inteligente)`, multi: false }))],
    [smartFields],
  )
  const remaining = quota ? quota.remaining : Infinity
  const reviewInputs = useRef({ rows, mapping, contacts, remaining, policy, open, step })
  reviewInputs.current = { rows, mapping, contacts, remaining, policy, open, step }
  const { plan, counts } = useMemo(
    () => (step === 3 && reviewedPlan ? reviewedPlan : { plan: [] as PlanRow[], counts: { created: 0, updated: 0, skipped: 0, mergedInFile: 0, overQuota: 0 } }),
    [step, reviewedPlan],
  )
  const planRef = useRef<PlanRow[]>([])
  if (step === 3) planRef.current = plan
  const shownRows = useMemo(() => plan.filter((p) => matchReview(reviewFilter, p)), [plan, reviewFilter])
  const mergeCount = useMemo(() => plan.filter((p) => matchReview('merge', p)).length, [plan])

  const readFile = async (file: File) => {
    setError('')
    // Planilha do Excel (.xlsx): lê a primeira aba. Demais arquivos: .csv pelo nome ou pelo tipo CSV declarado (o Windows informa application/vnd.ms-excel para .csv)
    const excel = /\.xlsx$/i.test(file.name) || file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    if (!excel && !/\.csv$/i.test(file.name) && !/^(text\/csv|application\/(csv|vnd\.ms-excel))$/i.test(file.type)) return setError('Envie um arquivo .csv (valores separados por vírgula ou ponto e vírgula) ou uma planilha do Excel (.xlsx).')
    if (file.size > MAX_BYTES) return setError('O arquivo tem mais de 5 MB. Divida-o em partes menores.')
    let all: string[][]
    if (excel) {
      try {
        all = await readXlsxRows(await file.arrayBuffer())
      } catch {
        return setError('Não foi possível ler a planilha. Salve-a novamente como “Pasta de Trabalho do Excel (.xlsx)” ou exporte como “CSV UTF-8”.')
      }
    } else {
      let text = ''
      try {
        text = await file.text()
      } catch {
        return setError('Não foi possível ler o arquivo.')
      }
      if (text.includes('�')) return setError('O arquivo não parece estar codificado em UTF-8. Salve-o novamente como “CSV UTF-8”.')
      all = parseCsv(text)
    }
    if (all.length === 0) return setError('O arquivo está vazio.')
    const head = all[0]!.map((h) => h.trim())
    if (head.every((h) => !h)) return setError('A primeira linha precisa conter os nomes das colunas (cabeçalho).')
    const data = all.slice(1)
    if (data.length === 0) return setError('O arquivo tem apenas o cabeçalho; nenhuma linha de contato foi encontrada.')
    const hs = head.map((h, i) => h || `Coluna ${i + 1}`)
    setFileName(file.name)
    setHeaders(hs)
    setRows(data)
    setMapping(autoMap(hs, smartFields))
    setStep(2)
  }

  const downloadTemplate = () => {
    const header = ['Nome', 'Sobrenome', 'Telefone', 'E-mail', 'Empresa', 'Notas', ...smartFields.map((f) => f.label)]
    const ex = (i: number) => smartFields.map((f) => (f.type === 'boolean' ? 'Sim' : f.type === 'number' ? String(i) : f.type === 'enum' ? (f.options?.[0] ?? '') : f.example ?? ''))
    const csv = toCsv(header, [
      ['Ana', 'Exemplo', '+55 11 90000-0901', 'ana.exemplo@exemplo.com.br', 'Empresa Exemplo', 'Prefere contato pela manhã', ...ex(1)],
      ['Bruno', 'Modelo', '+55 11 90000-0902', '', '', '', ...ex(2)],
    ])
    downloadFile('modelo-contatos-kloel.csv', csv)
  }

  const mapError = useMemo(() => {
    if (step !== 2) return ''
    const has = (t: ImportTarget) => mapping.includes(t)
    if (!has('phone') && !has('email')) return 'Mapeie ao menos uma coluna de Telefone ou E-mail — todo contato precisa de um identificador.'
    return ''
  }, [mapping, step])

  // Linhas da tabela CAMPO × COLUNA DO CSV (CO-04): campos do contato + campos inteligentes ("Ignorar" não é um campo).
  // Ordem da captura: Nome, Sobrenome, Empresa, Notas, Telefones, E-mails (+ "Nome completo" da Kloel após o sobrenome e os campos inteligentes no fim).
  const fieldTargets = useMemo(() => {
    const order = ['firstName', 'lastName', 'fullName', 'company', 'notes', 'phone', 'email']
    const rank = (v: string) => (order.includes(v) ? order.indexOf(v) : order.length)
    return targets.filter((t) => t.value !== 'ignore').sort((a, b) => rank(a.value) - rank(b.value))
  }, [targets])
  const ignoredHeaders = useMemo(() => headers.filter((_, i) => (mapping[i] ?? 'ignore') === 'ignore'), [headers, mapping])

  // The progress reflects confirmed API stages; retry only reads an existing receipt.
  useEffect(() => {
    if (step !== 4) return
    let active = true
    setRunError('')
    setProgress(0)
    const prepared = preparedRef.current
    if (!prepared) { setRunError('Revise o arquivo antes de importar.'); return }
    const pending = commitRef.current ?? prepared.commit()
    commitRef.current = pending
    void pending.then(result => {
      if (!active) return
      setProgress(100)
      setResult(result)
      setStep(5)
    }, error => { if (active) setRunError(error instanceof Error ? error.message : 'Não foi possível confirmar a importação.') }).finally(() => { if (commitRef.current === pending) commitRef.current = null })
    return () => { active = false }
  }, [step, attempt])

  const review = async () => {
    if (preparing) return
    setPreparing(true)
    const input = reviewInputs.current
    try {
      const next = buildPlan(rows, mapping, contacts, remaining)
      const prepared = await prepareContactImport(next.plan, policy)
      const current = reviewInputs.current
      if (Object.keys(input).some(key => input[key as keyof typeof input] !== current[key as keyof typeof current])) throw new Error('Os dados mudaram. Revise novamente o arquivo antes de importar.')
      preparedRef.current = prepared; commitRef.current = null; setReviewedPlan(next)
      setStep(3)
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Não foi possível revisar o arquivo.') }
    finally { setPreparing(false) }
  }

  const importing = step === 4 && !runError
  const close = (o: boolean) => {
    if (importing) return
    onOpenChange(o)
    if (!o && step === 5) onDone?.()
  }
  const toImport = counts.created + counts.updated

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        hideClose
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => importing && e.preventDefault()}
        className="flex max-h-[calc(100vh-4rem)] w-[calc(100vw-4rem)] max-w-[1200px] flex-col gap-0 gap-y-0 overflow-hidden p-6 max-sm:h-full max-sm:max-h-full max-sm:w-full max-sm:p-4"
      >
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-b pb-4 max-md:grid-cols-[1fr_auto]">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Importação em massa</p>
            <DialogTitle className="text-lg font-semibold capitalize">contatos</DialogTitle>
          </div>
          <ol className="flex items-center gap-2 text-sm max-md:col-span-2 max-md:row-start-2 max-md:justify-center" aria-label="Etapas">
            {STEPS.map((label, i) => {
              const n = i + 1
              const state = n === step ? 'current' : n < step ? 'done' : 'todo'
              return (
                <li key={label} className="flex items-center gap-2" aria-current={state === 'current' ? 'step' : undefined}>
                  <span
                    className={cn(
                      'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium',
                      state === 'current' ? 'border-primary text-primary' : state === 'done' ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground',
                    )}
                  >
                    {state === 'done' ? <Check className="h-3.5 w-3.5" strokeWidth={3} aria-label={`${label} concluído`} /> : n}
                  </span>
                  <span className={cn('hidden lg:inline', state === 'todo' ? 'text-muted-foreground' : 'text-foreground')}>{label}</span>
                  {n < STEPS.length && <span className="text-muted-foreground">›</span>}
                </li>
              )
            })}
          </ol>
          <div className="flex justify-end max-md:col-start-2 max-md:row-start-1">
            <Button variant="ghost" size="icon" aria-label="Cancelar importação" disabled={importing} onClick={() => close(false)} className="h-10 w-10">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="-mx-6 min-h-0 flex-1 overflow-y-auto px-6 py-6 max-sm:-mx-4 max-sm:px-4">
          <div className={cn('mx-auto w-full', step === 3 ? 'max-w-[960px]' : 'max-w-[720px]')}>
            {step === 1 && (
              <div className="flex flex-col gap-4">
                <div>
                  <h2 className="text-base font-semibold">Envie seu CSV ou Excel</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Arraste um arquivo CSV ou uma planilha do Excel (.xlsx) com uma linha de cabeçalho. Vamos mapear as colunas para contatos na próxima etapa.</p>
                  <div className="mt-3 text-sm text-muted-foreground">
                    Vamos identificar contatos já existentes por qualquer telefone ou e-mail já cadastrado. As colunas de telefone e e-mail são mescladas na atualização — nunca substituídas.
                  </div>
                </div>
                <div
                  role="button"
                  tabIndex={0}
                  aria-label="Arraste um arquivo CSV ou Excel ou clique para procurar"
                  onClick={() => inputRef.current?.click()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      inputRef.current?.click()
                    }
                  }}
                  onDragOver={(e) => {
                    e.preventDefault()
                    setDragOver(true)
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault()
                    setDragOver(false)
                    const f = e.dataTransfer.files?.[0]
                    if (f) readFile(f)
                  }}
                  className={cn(
                    'flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-16 text-center outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
                    dragOver ? 'border-primary bg-muted/40' : 'border-border hover:border-primary/60 hover:bg-muted/30',
                    error && 'border-destructive/60',
                  )}
                >
                  <Upload className="h-8 w-8 text-muted-foreground" />
                  <p className="text-sm font-medium">Arraste um arquivo CSV ou Excel ou clique para procurar</p>
                  <p className="text-xs text-muted-foreground">Codificado em UTF-8</p>
                </div>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="hidden"
                  data-testid="csv-input"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) readFile(f)
                    e.target.value = ''
                  }}
                />
                {error && (
                  <p role="alert" className="flex items-center gap-2 rounded-md border border-destructive/30 bg-red-50 px-3 py-2 text-sm text-destructive">
                    <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
                  </p>
                )}
                <button type="button" onClick={downloadTemplate} className="inline-flex items-center gap-2 self-start text-sm text-muted-foreground hover:text-foreground">
                  <Download className="h-4 w-4" /> Baixar um modelo de CSV
                </button>
              </div>
            )}

            {step === 2 && (
              <div className="flex flex-col gap-5">
                {/* CO-04 (Central de ajuda): "Mapear colunas para os campos do contato" — política primeiro, tabela CAMPO × COLUNA DO CSV,
                    alerta âmbar quando falta telefone/e-mail; "Voltar" à esquerda e "Continuar" à direita. */}
                <div>
                  <h2 className="text-base font-semibold">Mapear colunas para os campos do contato</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Para cada campo abaixo, escolha a coluna do CSV de onde ele deve vir.</p>
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <FileText className="h-3.5 w-3.5 shrink-0" />{' '}
                    <span className="min-w-0 truncate">
                      {fileName} · {formatInt(rows.length)} {rows.length === 1 ? 'linha' : 'linhas'} · {formatInt(headers.length)} {headers.length === 1 ? 'coluna' : 'colunas'}
                    </span>
                  </p>
                </div>
                <div className="rounded-lg border bg-muted/30 p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Quando um contato já tem um valor</p>
                  <RadioGroup value={policy} onValueChange={(v) => setPolicy(v as MergePolicy)} className="mt-3 gap-2.5">
                    {[
                      { v: 'keep', l: 'Manter existentes', d: 'Só preenche campos vazios. Não sobrescreve valores já salvos na Kloel.' },
                      { v: 'overwrite', l: 'Sobrescrever', d: 'Substitui os valores existentes pelos do CSV. Telefones e e-mails são sempre mesclados, nunca substituídos.' },
                    ].map((o) => (
                      <Label key={o.v} htmlFor={`policy-${o.v}`} className="flex cursor-pointer items-start gap-2.5 font-normal">
                        <RadioGroupItem id={`policy-${o.v}`} value={o.v} className="mt-0.5" />
                        <span>
                          <span className="block text-sm font-medium">{o.l}</span>
                          <span className="block text-xs text-muted-foreground">{o.d}</span>
                        </span>
                      </Label>
                    ))}
                  </RadioGroup>
                </div>
                <div className="overflow-hidden rounded-lg border" role="table" aria-label="Campos do contato e colunas do CSV">
                  <div role="row" className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-3 border-b bg-muted/30 px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground max-sm:hidden">
                    <span role="columnheader">Campo</span>
                    <span role="columnheader">Coluna do CSV</span>
                  </div>
                  <div className="divide-y">
                    {fieldTargets.map((t) => (
                      <FieldMapRow key={t.value} target={t} headers={headers} rows={rows} mapping={mapping} onChange={setMapping} />
                    ))}
                  </div>
                </div>
                {ignoredHeaders.length > 0 && (
                  <p className="text-xs text-muted-foreground" data-testid="import-ignored-columns">
                    Colunas não mapeadas são ignoradas: {ignoredHeaders.join(', ')}.
                  </p>
                )}
                {mapError && (
                  <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900">
                    {mapError}
                  </p>
                )}
              </div>
            )}

            {step === 3 && (
              <div className="flex flex-col gap-4">
                <div>
                  <h2 className="text-base font-semibold">Revisar</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Contatos existentes foram identificados por telefone ou e-mail. Na mesclagem, telefones e e-mails novos são sempre adicionados;{' '}
                    {policy === 'keep' ? 'os demais campos só são preenchidos quando estiverem vazios (manter existentes).' : 'os demais campos são substituídos pelos valores do CSV (sobrescrever).'}
                  </p>
                </div>
                {counts.overQuota > 0 && quota && (
                  <ContactQuotaAlert
                    quota={quota}
                    action="importar todas as linhas"
                    lead={
                      <>
                        Seu plano {quota.planName} inclui {formatInt(quota.limit)} contatos ({formatInt(quota.used)} em uso, restam {formatInt(quota.remaining)}). {formatInt(counts.overQuota)}{' '}
                        {counts.overQuota === 1 ? 'linha nova excedente será ignorada' : 'linhas novas excedentes serão ignoradas'}; contatos existentes continuam sendo atualizados.
                      </>
                    }
                  />
                )}
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[
                    { l: 'Novos contatos', v: counts.created, c: 'text-green-700' },
                    { l: 'Contatos atualizados', v: counts.updated, c: 'text-brand' },
                    { l: 'Linhas mescladas no arquivo', v: counts.mergedInFile, c: 'text-blue-700' },
                    { l: 'Linhas ignoradas', v: counts.skipped, c: 'text-muted-foreground' },
                  ].map((k) => (
                    <div key={k.l} className="rounded-lg border px-3 py-2">
                      <p className={cn('text-xl font-semibold tabular-nums', k.c)}>{formatInt(k.v)}</p>
                      <p className="text-xs text-muted-foreground">{k.l}</p>
                    </div>
                  ))}
                </div>
                <div className="max-w-full overflow-x-auto">
                  <Segmented<ReviewFilter>
                    ariaLabel="Filtrar linhas da prévia"
                    value={reviewFilter}
                    onChange={setReviewFilter}
                    options={[
                      { value: 'all', label: <>Todas <span className="tabular-nums opacity-70">{formatInt(plan.length)}</span></> },
                      { value: 'new', label: <>Novos <span className="tabular-nums opacity-70">{formatInt(counts.created)}</span></> },
                      { value: 'merge', label: <>Mesclas <span className="tabular-nums opacity-70">{formatInt(mergeCount)}</span></> },
                      { value: 'skip', label: <>Ignoradas <span className="tabular-nums opacity-70">{formatInt(counts.skipped)}</span></> },
                    ]}
                  />
                </div>
                <div data-testid="import-review-rows">
                  {shownRows.length === 0 ? (
                    <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">Nenhuma linha nesta categoria.</p>
                  ) : !isWide ? (
                    // celular: uma linha do CSV por cartão, com a ação sempre visível (sem rolagem horizontal)
                    <ul className="max-h-[420px] divide-y overflow-y-auto rounded-lg border" aria-label="Prévia da importação">
                      {shownRows.slice(0, PREVIEW_ROWS).map((p) => (
                        <li key={p.row} className={cn('space-y-1 px-3 py-2.5 text-sm', p.status.kind === 'skip' && 'text-muted-foreground')}>
                          <div className="flex items-start justify-between gap-2">
                            <p className="min-w-0 break-words font-medium">{recName(p) || p.record.phones[0] || p.record.emails[0] || '—'}</p>
                            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">Linha {p.row}</span>
                          </div>
                          {(p.record.phones.length > 0 || p.record.emails.length > 0 || p.record.company) && (
                            <p className="break-words text-xs text-muted-foreground">{[...p.record.phones, ...p.record.emails, p.record.company].filter(Boolean).join(' · ')}</p>
                          )}
                          <div className="min-w-0">
                            <StatusBadge p={p} />
                          </div>
                          {p.warnings.map((w) => (
                            <p key={w} className="break-words text-[11px] text-amber-700">
                              {w}
                            </p>
                          ))}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="max-h-[360px] overflow-auto rounded-lg border">
                      <table className="w-full min-w-[720px] text-sm">
                        <thead className="sticky top-0 bg-muted text-left text-xs text-muted-foreground">
                          <tr>
                            <th className="px-3 py-2 font-medium">Linha</th>
                            <th className="px-3 py-2 font-medium">Nome</th>
                            <th className="px-3 py-2 font-medium">Telefones</th>
                            <th className="px-3 py-2 font-medium">E-mails</th>
                            <th className="px-3 py-2 font-medium">Empresa</th>
                            <th className="px-3 py-2 font-medium">Ação</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {shownRows.slice(0, PREVIEW_ROWS).map((p) => (
                            <tr key={p.row} className={cn(p.status.kind === 'skip' && 'text-muted-foreground')}>
                              <td className="px-3 py-2 tabular-nums text-muted-foreground">{p.row}</td>
                              <td className="px-3 py-2">{recName(p) || '—'}</td>
                              <td className="px-3 py-2 tabular-nums">{p.record.phones.join(', ') || '—'}</td>
                              <td className="px-3 py-2">{p.record.emails.join(', ') || '—'}</td>
                              <td className="px-3 py-2">{p.record.company || '—'}</td>
                              <td className="max-w-[220px] px-3 py-2">
                                <StatusBadge p={p} />
                                {p.warnings.map((w) => (
                                  <p key={w} className="mt-1 text-[11px] text-amber-700">
                                    {w}
                                  </p>
                                ))}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
                {shownRows.length > PREVIEW_ROWS && (
                  <p className="text-xs text-muted-foreground">
                    Mostrando as primeiras {formatInt(PREVIEW_ROWS)} de {formatInt(shownRows.length)} linhas{reviewFilter === 'all' ? '' : ' desta categoria'}. Use os filtros acima para ver as demais.
                  </p>
                )}
              </div>
            )}

            {step === 4 && !runError && (
              <div className="flex flex-col items-center gap-4 py-16 text-center">
                <Loader2 className="h-8 w-8 animate-spin text-brand" />
                <div>
                  <h2 className="text-base font-semibold">Importando contatos…</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Não feche esta janela.</p>
                </div>
                <Progress value={progress} className="w-full max-w-md" />
                <p className="text-xs tabular-nums text-muted-foreground">{Math.round(progress)}%</p>
              </div>
            )}

            {step === 4 && runError && (
              <div className="flex flex-col items-center gap-4 py-16 text-center" role="alert">
                <XCircle className="h-10 w-10 text-destructive" />
                <div>
                  <h2 className="text-base font-semibold">A importação falhou</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{runError}</p>
                </div>
                <Progress value={progress} className="w-full max-w-md" barClassName="bg-destructive" />
                <p className="text-xs tabular-nums text-muted-foreground">Interrompida em {Math.round(progress)}%</p>
              </div>
            )}

            {step === 5 && result && (
              <div className="flex flex-col items-center gap-4 py-12 text-center">
                <CheckCircle2 className="h-10 w-10 text-green-600" />
                <div>
                  <h2 className="text-base font-semibold">Importação concluída</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{fileName}</p>
                </div>
                <div className="grid w-full max-w-md grid-cols-3 divide-x rounded-lg border">
                  {[
                    { l: 'Criados', v: result.created },
                    { l: 'Atualizados', v: result.updated },
                    { l: 'Ignorados', v: result.skipped },
                  ].map((k) => (
                    <div key={k.l} className="px-3 py-3">
                      <p className="text-2xl font-semibold tabular-nums">{formatInt(k.v)}</p>
                      <p className="text-xs text-muted-foreground">{k.l}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 max-md:pr-11">
          {step === 1 && (
            <Button variant="ghost" className="h-10" onClick={() => close(false)}>
              Cancelar
            </Button>
          )}
          {step === 2 && (
            <>
              <Button variant="ghost" className="mr-auto h-10" onClick={() => setStep(1)}>
                Voltar
              </Button>
              <Button className="h-10" disabled={!!mapError || preparing} onClick={review}>
                Continuar
              </Button>
            </>
          )}
          {step === 3 && (
            <>
              <Button variant="ghost" className="h-10" onClick={() => setStep(2)}>
                Voltar
              </Button>
              <Button className="h-10" disabled={toImport === 0} onClick={() => setStep(4)}>
                {toImport === 0 ? 'Nada para importar' : `Importar ${formatInt(toImport)} ${toImport === 1 ? 'contato' : 'contatos'}`}
              </Button>
            </>
          )}
          {step === 4 && runError && (
            <>
              <Button variant="ghost" className="h-10" onClick={() => { setRunError(''); setStep(3) }}>
                Voltar para a revisão
              </Button>
              <Button className="h-10 gap-1.5" onClick={() => setAttempt((a) => a + 1)}>
                <RotateCcw className="h-4 w-4" /> Tentar novamente
              </Button>
            </>
          )}
          {step === 5 && (
            <>
              <Button variant="ghost" className="h-10" onClick={reset}>
                Importar outro arquivo
              </Button>
              <Button
                className="h-10"
                onClick={() => {
                  toast.success('Contatos importados', { description: `${formatInt(result?.created ?? 0)} criados · ${formatInt(result?.updated ?? 0)} atualizados` })
                  close(false)
                }}
              >
                Ver contatos
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
