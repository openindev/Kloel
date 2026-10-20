import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, ChevronsUpDown, CirclePlus, Info } from 'lucide-react'
import { toast } from 'sonner'
import '@/domain/ext/agents-resources'
import type { Agent, WebhookConfig } from '@/domain/types'
import type { ActiveWindow, CustomVariable, ExecutionTiming } from '@/domain/ext/agents-resources'
import { uid } from '@/lib/utils'
import { SideSheet } from '@/components/app/SideSheet'
import { ConfirmDialog } from '@/components/app/ConfirmDialog'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { SimpleTooltip } from '@/components/ui/tooltip'
import { Tabs, TabsContent, UnderlineTabsList, UnderlineTabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandGroup, CommandInput, CommandItem, CommandList, CommandEmpty } from '@/components/ui/command'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { CodeBlock, CodeEditor } from './shared/CodeEditor'
import { CopyButton, DeleteFooterButton, Field, FieldError, FieldRow, InfoBox, InlineCode, ListCard, ListRow, Pill, SectionCaps, SheetFooter } from './shared/ui'
import { CustomVariablesSection, customVariablesValid, syncCustomVariables } from './shared/CustomVariables'
import { EXECUTION_LABEL, ExecutionControl } from './shared/timing'
import { saveAgent, upsert, useErrors, useHoursDraft } from './shared/hooks'
import { newItemParam, parseNewItem, useRoutedView, type ResourceProps } from './shared/listView'

/** after_http_agent_changed também significa "assistente não está ativo" (o motor só liga webhooks de assistentes ativos). */
const saveErrorText = (error: unknown) => (error as { code?: string })?.code === 'after_http_agent_changed'
  ? 'O assistente precisa estar ativo para ligar este webhook. Use "Ativar assistente" na barra inferior e salve de novo.'
  : error instanceof Error ? error.message : 'Confira o acesso e tente novamente.'
import { customVariableNames, labelToken, parseJson, renderSample } from './shared/variables'

type Method = NonNullable<WebhookConfig['method']>
type Screen = 'inbound' | 'outbound' | 'test_context' | 'http'
type View = { mode: 'list'; seq: number } | { mode: Screen; id?: string; seq: number }

const headersToJson = (h?: { key: string; value: string }[]) => (h?.length ? JSON.stringify(Object.fromEntries(h.map((x) => [x.key, x.value])), null, 2) : '{}')

function jsonToHeaders(text: string): { ok: true; value: { key: string; value: string }[] } | { ok: false; error: string } {
  const p = parseJson(text)
  if (!p.ok) return p
  const v = p.value
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { ok: false, error: 'Os cabeçalhos devem ser um objeto JSON, ex. {"Authorization": "Bearer …"}.' }
  const entries = Object.entries(v as Record<string, unknown>)
  if (entries.some(([, val]) => typeof val !== 'string' && typeof val !== 'number')) return { ok: false, error: 'Os valores dos cabeçalhos devem ser texto.' }
  return { ok: true, value: entries.map(([key, val]) => ({ key, value: String(val) })) }
}

const validUrl = (u: string) => /^https?:\/\/[^\s/]+\.[^\s]+/i.test(renderSample(u.trim()))

/** Sub-telas fixas na URL (?recurso=webhooks&item=…); requisições HTTP usam o id (ou "novo"). */
const SCREEN_PARAM: Record<Exclude<Screen, 'http'>, string> = { inbound: 'entrada', outbound: 'api-outbound', test_context: 'contexto-teste' }

/** IW-03: corpo padrão de um webhook de entrada novo (número de origem e de destino da chamada). */
const DEFAULT_INBOUND_BODY = `{\n  "fromNumber": "${labelToken('call.fromNumber')}",\n  "toNumber": "${labelToken('call.toNumber')}"\n}`

/**
 * "Webhooks" (fonio-live2 C-assistentes/57–63 + data/resources.json): lista fixa "Inbound Webhook" · "Outbound API" ·
 * "Contexto de teste" (rótulos em inglês como na Fonio) + requisições HTTP adicionadas; "⊕ Adicionar novo webhook" abre o menu
 * com "Antes, durante ou após a ligação" → "Requisição HTTP".
 */
export function WebhooksResource({ agent, open, onOpenChange }: ResourceProps) {
  const inbound = agent.webhooks.find((w) => w.kind === 'inbound')
  const ctx = agent.webhooks.find((w) => w.kind === 'test_context')
  const requests = agent.webhooks.filter((w) => w.kind === 'http_request')
  const fromParam = (item: string | null, seq: number): View => {
    if (!item) return { mode: 'list', seq }
    const screen = (Object.keys(SCREEN_PARAM) as Exclude<Screen, 'http'>[]).find((k) => SCREEN_PARAM[k] === item)
    if (screen) return { mode: screen, seq }
    const n = parseNewItem(item)
    if (n.isNew) return { mode: 'http', seq }
    const r = requests.find((x) => x.id === item)
    return r ? { mode: 'http', id: item, seq } : { mode: 'list', seq }
  }
  const { view, go: goView } = useRoutedView<View>({
    init: (item) => fromParam(item, 0),
    itemOf: (v) => (v.mode === 'list' ? null : v.mode === 'http' ? (v.id ?? newItemParam()) : SCREEN_PARAM[v.mode]),
    fromItem: (item, cur) => fromParam(item, cur.seq + 1),
  })
  const go = (mode: View['mode'], id?: string) => goView((v) => ({ mode, id, seq: v.seq + 1 }) as View)
  const back = () => go('list')

  const props = { agent, open, onOpenChange, onBack: back }
  if (view.mode === 'inbound') return <InboundEditor key={view.seq} {...props} target={inbound} />
  if (view.mode === 'outbound') return <OutboundView key={view.seq} {...props} />
  if (view.mode === 'test_context') return <TestContextEditor key={view.seq} {...props} target={ctx} />
  if (view.mode === 'http') return <HttpRequestEditor key={view.seq} {...props} target={requests.find((r) => r.id === view.id)} />

  return (
    <SideSheet open={open} onOpenChange={onOpenChange} title="Webhooks" description="Configurações avançadas com webhooks de API de entrada e saída." hideFooter contentClassName="pt-0">
      <ListCard>
        <ListRow
          testId="webhook-inbound-row"
          title="Inbound Webhook"
          pills={
            <>
              <Pill>{inbound?.enabled ? 'Ativo' : 'Inativo'}</Pill>
              <Pill>{inbound?.method ?? 'POST'}</Pill>
              <Pill className="max-w-[180px]">
                <span className="truncate">{inbound?.url || 'Nenhuma URL definida'}</span>
              </Pill>
            </>
          }
          onClick={() => go('inbound')}
        />
        <ListRow testId="webhook-outbound-row" title="Outbound API" pills={<Pill>POST</Pill>} onClick={() => go('outbound')} />
        <ListRow testId="webhook-context-row" title="Contexto de teste" onClick={() => go('test_context')} />
        {requests.map((r) => (
          <ListRow
            key={r.id}
            title={r.name}
            pills={
              <>
                {!r.enabled && <Pill>Inativo</Pill>}
                <Pill>{EXECUTION_LABEL[r.timing ?? 'after']}</Pill>
                <Pill>{r.method ?? 'POST'}</Pill>
              </>
            }
            onClick={() => go('http', r.id)}
          />
        ))}
        <li>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="flex h-auto w-full items-center justify-center gap-2 rounded-none px-5 py-4 text-sm font-medium text-brand transition-colors hover:bg-accent data-[state=open]:bg-background">
                <CirclePlus className="size-4" /> Adicionar novo webhook
              </button>
            </DropdownMenuTrigger>
            {/* C-62: menu com um único item */}
            <DropdownMenuContent align="center" className="w-64">
              <DropdownMenuItem onSelect={() => go('http')}>Antes, durante ou após a ligação</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </li>
      </ListCard>
    </SideSheet>
  )
}

interface SubProps {
  agent: Agent
  open: boolean
  onOpenChange: (o: boolean) => void
  onBack: () => void
}

/* ------------------------------------------------------------------ */
/* Webhook de entrada                                                  */
/* ------------------------------------------------------------------ */

/**
 * "Webhook de entrada" (C-58/59, 600px): texto no cabeçalho, caixa "Webhook de entrada ativo" (desmarcada = campos em cinza),
 * Método (POST | GET), URL do webhook (editor com "Adicionar variável") e acordeões Cabeçalhos / Corpo / Valores padrão.
 */
function InboundEditor({ agent, open, onOpenChange, onBack, target }: SubProps & { target?: WebhookConfig }) {
  const { errors, setErrors, clear } = useErrors<'url' | 'headers' | 'body' | 'defaults'>()
  const [enabled, setEnabled] = useState(target?.enabled ?? false)
  const [method, setMethod] = useState<Method>(target?.method === 'GET' ? 'GET' : 'POST')
  const [url, setUrl] = useState(target?.url ?? '')
  const [headers, setHeaders] = useState(headersToJson(target?.headers))
  const [body, setBody] = useState(target?.body ?? DEFAULT_INBOUND_BODY)
  const [defaults, setDefaults] = useState(target?.defaults ?? '{}')
  const off = !enabled

  const save = async () => {
    try {
    const e: typeof errors = {}
    const keepSecrets = !!target?.engineBeforeHttp && !url.trim()
    if (enabled && !url.trim() && !keepSecrets) e.url = 'Informe a URL do webhook para ativá-lo.'
    else if (url.trim() && !validUrl(url)) e.url = 'Informe uma URL começando com http:// ou https://.'
    if (keepSecrets && (headers !== headersToJson(target?.headers) || body !== (target?.body ?? DEFAULT_INBOUND_BODY))) e.url = 'Para alterar corpo ou cabeçalhos, informe também a URL completa.'
    const h = jsonToHeaders(headers)
    if (!h.ok) e.headers = h.error
    if (method === 'POST') {
      const b = parseJson(body)
      if (!b.ok) e.body = b.error
    }
    const d = parseJson(defaults)
    if (!d.ok) e.defaults = d.error
    else if (d.value === null || typeof d.value !== 'object' || Array.isArray(d.value)) e.defaults = 'Os valores padrão devem ser um objeto JSON.'
    setErrors(e)
    if (Object.values(e).some(Boolean)) {
      toast.error('Corrija os campos destacados.')
      return
    }
    const next: WebhookConfig = {
      ...(target ?? {}),
      id: target?.id ?? uid('whk'),
      kind: 'inbound',
      name: 'Webhook de entrada',
      url: url.trim(),
      method,
      headers: keepSecrets ? undefined : h.ok ? h.value : [],
      body: keepSecrets ? undefined : method === 'POST' ? body : target?.body,
      defaults,
      enabled,
    }
    await saveAgent(agent, (a) => ({ webhooks: upsert(a.webhooks, next) }))
    toast.success(enabled ? 'Webhook de entrada ativo.' : 'Webhook de entrada salvo.')
    onBack()
      } catch (error) { toast.error('Não foi possível salvar', { description: saveErrorText(error) }) }
  }

  return (
    <SideSheet
      open={open}
      onOpenChange={onOpenChange}
      width={600}
      title="Webhook de entrada"
      description={
        <span className="-mr-10 mt-6 block leading-5">
          Este webhook é chamado quando uma ligação de entrada chega para carregar informações de contexto específicas. O endpoint deve sempre retornar um <InlineCode plain>JSON</InlineCode> válido — no mínimo um objeto vazio <InlineCode plain>{'{}'}</InlineCode>. A resposta deve acontecer em até 5000ms. O JSON retornado pode então ser usado no prompt.
          <br />
          Exemplo: "Olá {'{{name}}'} — aqui é a Lena!" → "Olá Max — aqui é a Lena!"
          <br />→{' '}
          <Link to="/ajuda/developers/inbound-webhook" className="text-blue-600 hover:underline">
            Vídeo tutorial
          </Link>
        </span>
      }
      footer={<SheetFooter onSave={save} onCancel={onBack} cancelVariant="secondary" />}
      contentClassName="pt-0 pb-0"
    >
      <div className="flex flex-col gap-6" data-testid="inbound-editor">
        <label className="flex cursor-pointer items-center gap-3 text-sm font-medium">
          <Checkbox checked={enabled} onCheckedChange={(v) => (setEnabled(v === true), clear('url'))} aria-label="Webhook de entrada ativo" />
          Webhook de entrada ativo
        </label>
        <Field label={<span className={off ? 'text-muted-foreground' : undefined}>Método</span>} htmlFor="in-method" className="mt-[3px]">
          <Select value={method} onValueChange={(v) => setMethod(v as Method)} disabled={off}>
            <SelectTrigger id="in-method">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="POST" className="pl-8 pr-2 [&>span:first-child]:left-2 [&>span:first-child]:right-auto">
                POST
              </SelectItem>
              <SelectItem value="GET" className="pl-8 pr-2 [&>span:first-child]:left-2 [&>span:first-child]:right-auto">
                GET
              </SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label={<span className={off ? 'text-muted-foreground' : undefined}>URL do webhook</span>}>
          <CodeEditor ariaLabel="URL do webhook" singleLine variables variableContext="inbound" value={url} onChange={(v) => (setUrl(v), clear('url'))} placeholder="https://sua-api.com.br" error={errors.url} disabled={off} />
        </Field>
        {/* C-59: linhas do acordeão com 49px */}
        <Accordion type="multiple" defaultValue={errors.headers || errors.body ? ['headers', 'body'] : []} className="-mt-2">
          <AccordionItem value="headers">
            <AccordionTrigger className="py-3.5 text-sm font-normal">Cabeçalhos</AccordionTrigger>
            <AccordionContent className="p-1">
              <CodeEditor ariaLabel="Cabeçalhos" compact format value={headers} onChange={(v) => (setHeaders(v), clear('headers'))} error={errors.headers} disabled={off} />
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="body">
            <AccordionTrigger className="py-3.5 text-sm font-normal">Corpo</AccordionTrigger>
            <AccordionContent className="flex flex-col gap-2 p-1">
              <CodeEditor ariaLabel="Corpo" compact format variables variableContext="inbound" value={body} onChange={(v) => (setBody(v), clear('body'))} error={errors.body} disabled={off || method === 'GET'} />
              {/* IW-04: notas sob o corpo + "Restaurar valor padrão" */}
              <ul className="ml-5 list-disc text-sm leading-6 text-muted-foreground">
                <li>
                  Para números SIP, todos os cabeçalhos SIP podem ser usados com <InlineCode plain>{'{{sipHeaders.nomeDoCabecalho}}'}</InlineCode>
                </li>
                <li>
                  <button type="button" disabled={off} className="text-blue-600 hover:underline disabled:opacity-60" onClick={() => (setBody(DEFAULT_INBOUND_BODY), clear('body'))}>
                    Restaurar valor padrão
                  </button>
                </li>
              </ul>
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="defaults">
            <AccordionTrigger className="py-3.5 text-sm font-normal">Valores padrão</AccordionTrigger>
            <AccordionContent className="flex flex-col gap-2 p-1">
              <CodeEditor ariaLabel="Valores padrão" compact format value={defaults} onChange={(v) => (setDefaults(v), clear('defaults'))} error={errors.defaults} disabled={off} />
              {/* IW-04: notas sob "Valores padrão" + "Restaurar valor" */}
              <ul className="ml-5 list-disc text-sm leading-6 text-muted-foreground">
                <li>Estes valores são usados se o webhook não retornar nenhuma ou nem todas as variáveis (ou não responder em até 5000ms). Também são usados em “Testar ligação”.</li>
                <li>
                  <button type="button" disabled={off} className="text-blue-600 hover:underline disabled:opacity-60" onClick={() => (setDefaults('{}'), clear('defaults'))}>
                    Restaurar valor
                  </button>
                </li>
              </ul>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
    </SideSheet>
  )
}

/* ------------------------------------------------------------------ */
/* API Outbound (somente leitura)                                     */
/* ------------------------------------------------------------------ */

/** "API Outbound" (C-60, 600px, sem rodapé): URL (Método: POST) com copiar, Body em bloco escuro com copiar e a nota do header. */
function OutboundView({ agent, open, onOpenChange, onBack }: SubProps) {
  const endpoint = new URL('/api/v1/voice/calls', window.location.origin).href
  const json = JSON.stringify({ to: '+55...', idempotencyKey: 'identificador-unico-da-chamada' }, null, 2)
  return (
    <SideSheet
      open={open}
      width={600}
      title="API Outbound"
      // painel de documentação sem rodapé; como subpainel de Webhooks, ×/Esc/clique fora voltam para a lista
      onOpenChange={(o) => (o ? onOpenChange(o) : onBack())}
      hideFooter
    >
      <div className="-mt-[3px] flex flex-col gap-6" data-testid="outbound-view">
        <Field
          label={
            <span>
              URL (<span className="font-mono text-xs font-normal">Método: POST</span>)
            </span>
          }
        >
          <div className="mt-1 flex h-10 items-center gap-1 rounded-md border bg-muted pl-3">
            <span className="min-w-0 flex-1 select-all truncate text-sm">{endpoint}</span>
            <CopyButton text={endpoint} label="Copiar URL" what="URL copiada" />
          </div>
        </Field>
        {/* C-60: "Body" 36px abaixo do campo da URL; bloco 21px abaixo do centro do rótulo */}
        <Field label="Body" className="mt-1.5">
          <div className="mt-1.5">
            <CodeBlock code={json}>
              <CopyButton dark text={json} label="Copiar body" what="Body copiado" />
            </CodeBlock>
          </div>
          <p className="-mt-1 text-sm text-muted-foreground">
            Requer a sessão autenticada do app (<InlineCode plain>kloel_session</InlineCode>) e permissão para gerenciar integrações na organização vinculada à telefonia. Esta rota não aceita chave de API. Informe o destino completo em <InlineCode plain>to</InlineCode>, começando por + e o código do país, e uma <InlineCode plain>idempotencyKey</InlineCode> por chamada. O número de origem vem da configuração de telefonia; o corpo não seleciona assistente.
          </p>
        </Field>
      </div>
    </SideSheet>
  )
}

/* ------------------------------------------------------------------ */
/* Contexto de teste                                                   */
/* ------------------------------------------------------------------ */

/**
 * "Contexto de teste" (C-61, 600px): texto no cabeçalho e editor JSON escuro com "{} Formatar" (valor "{}").
 * Usado na ligação/chat de teste no lugar dos dados do webhook de entrada (core/testContext).
 */
function TestContextEditor({ agent, open, onOpenChange, onBack, target }: SubProps & { target?: WebhookConfig }) {
  const [body, setBody] = useState(target?.body ?? '{}')
  const [error, setError] = useState<string>()

  const save = async () => {
    try {
    const p = parseJson(body)
    if (!p.ok) return setError(p.error)
    if (!p.value || typeof p.value !== 'object' || Array.isArray(p.value)) return setError('O contexto deve ser um objeto JSON, ex. {"name": "Max"}.')
    const next: WebhookConfig = { ...(target ?? {}), id: target?.id ?? uid('whk'), kind: 'test_context', name: 'Contexto de teste', body: body.trim() || '{}', enabled: true }
    await saveAgent(agent, (a) => ({ webhooks: upsert(a.webhooks, next) }))
    toast.success('Contexto de teste salvo.')
    onBack()
      } catch (error) { toast.error('Não foi possível salvar', { description: saveErrorText(error) }) }
  }

  return (
    <SideSheet
      open={open}
      onOpenChange={onOpenChange}
      width={600}
      title="Contexto de teste"
      description={
        <span className="-mb-3.5 -mr-10 mt-6 block leading-5">
          As variáveis do contexto podem ser usadas no prompt com <InlineCode plain>{'{{variable}}'}</InlineCode>.
          <br />
          Exemplo: "Olá {'{{name}}'} — aqui é a {agent.name}!" → "Olá Max — aqui é a {agent.name}!"
        </span>
      }
      footer={<SheetFooter onSave={save} onCancel={onBack} cancelVariant="secondary" />}
      contentClassName="pt-0 pb-0"
    >
      <div data-testid="test-context-editor">
        <CodeEditor
          ariaLabel="Contexto de teste (JSON)"
          format
          value={body}
          onChange={(v) => {
            setBody(v)
            setError(undefined)
          }}
          error={error}
        />
      </div>
    </SideSheet>
  )
}

/* ------------------------------------------------------------------ */
/* Requisição HTTP                                                     */
/* ------------------------------------------------------------------ */

const METHODS: Method[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
type HttpErr = 'name' | 'url' | 'headers' | 'body' | 'timeout' | 'window' | 'customVars'
const HTTP_TAB: Record<HttpErr, string> = { name: 'general', window: 'general', url: 'request', headers: 'request', body: 'request', customVars: 'request', timeout: 'advanced' }
const TAB_CLASS = 'pb-2.5 text-base data-[state=inactive]:text-muted-foreground max-sm:text-[13px]'

/**
 * "Requisição HTTP" (C-63 + data/resources.json; abas Requisição/Avançado nas capturas originais "Ordem Funil" › Webhooks):
 * Geral = Execução + Nome; Requisição = URL, Método, Cabeçalhos, Corpo, "Limite de tamanho da resposta" e
 * "VARIÁVEIS PERSONALIZADAS"; Avançado = Condição + Timeout (ms).
 */
function HttpRequestEditor({ agent, open, onOpenChange, onBack, target }: SubProps & { target?: WebhookConfig }) {
  const [webhookId] = useState(() => target?.id ?? uid('whk'))
  const hours = useHoursDraft(agent)
  const { errors, setErrors, clear } = useErrors<HttpErr>()
  const [tab, setTab] = useState('general')
  const [name, setName] = useState(target?.name ?? 'Nova integração de requisição HTTP')
  const [timing, setTiming] = useState<ExecutionTiming>(target?.timing ?? 'after')
  const [win, setWin] = useState<ActiveWindow>(target?.activeWindow ?? 'any')
  const [url, setUrl] = useState(target?.url ?? '')
  const [method, setMethod] = useState<Method>(target?.method ?? 'POST')
  const [headers, setHeaders] = useState(headersToJson(target?.headers))
  const [body, setBody] = useState(target?.body ?? '{}')
  const [condition, setCondition] = useState(target?.condition ?? '')
  const [timeout, setTimeoutMs] = useState(String(target?.timeoutMs ?? 5000))
  // {{variáveis}} fora do catálogo viram variáveis personalizadas (tipo + descrição obrigatória)
  const [customVars, setCustomVars] = useState<CustomVariable[]>(target?.customVariables ?? [])
  const vars = useMemo(() => syncCustomVariables(customVariableNames(url, headers, method === 'GET' ? '' : body), customVars), [url, headers, body, method, customVars])
  const [methodOpen, setMethodOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const save = async () => {
    try {
    const e: Partial<Record<HttpErr, string>> = {}
    if (!name.trim()) e.name = 'Informe um nome para a requisição.'
    if (!url.trim()) e.url = 'Informe a URL do endpoint.'
    else if (!validUrl(url)) e.url = 'Informe uma URL começando com http:// ou https://.'
    const h = jsonToHeaders(headers)
    if (!h.ok) e.headers = h.error
    if (method !== 'GET') {
      const b = parseJson(body)
      if (!b.ok) e.body = b.error
    }
    const t = Number(timeout)
    if (!Number.isInteger(t) || t < 500 || t > 30000) e.timeout = 'Use um valor entre 500 e 30000 milissegundos.'
    if (!customVariablesValid(vars)) e.customVars = 'Descreva cada variável personalizada.'
    if (win !== 'any' && !hours.configured) e.window = 'Configure o horário de funcionamento para usar esta opção.'
    setErrors(e)
    const first = (Object.keys(e) as HttpErr[]).find((k) => e[k])
    if (first) {
      setTab(HTTP_TAB[first])
      toast.error('Corrija os campos destacados.')
      return
    }
    const next: WebhookConfig = {
      ...(target ?? {}),
      id: webhookId,
      kind: 'http_request',
      name: name.trim(),
      description: target?.description ?? '',
      enabled: target?.enabled ?? true,
      timing,
      activeWindow: win,
      url: url.trim(),
      method,
      headers: h.ok ? h.value : [],
      body: method === 'GET' ? '' : body,
      condition: condition.trim(),
      timeoutMs: t,
      customVariables: vars,
      variant: 'http',
    }
    await saveAgent(agent, (a) => ({ webhooks: upsert(a.webhooks, next), ...(hours.changed ? { businessHours: hours.hours } : {}) }))
    toast.success(target ? 'Requisição HTTP atualizada.' : 'Requisição HTTP adicionada.')
    onBack()
      } catch (error) { toast.error('Não foi possível salvar', { description: saveErrorText(error) }) }
  }

  return (
    <SideSheet
      open={open}
      onOpenChange={onOpenChange}
      width={768}
      title="Requisição HTTP"
      // C-63: abas 24px abaixo da descrição (o SideSheet compartilhado põe 32px) → a descrição devolve 8px ao cabeçalho
      description={
        <span className="-mb-2 block">
          Chame qualquer endpoint HTTP antes, durante ou depois de uma conversa. Use variáveis de template para passar contexto da conversa e valores gerados pela IA na URL, nos cabeçalhos e no corpo.
        </span>
      }
      footer={<SheetFooter onSave={save} onCancel={onBack} left={target && <DeleteFooterButton onClick={() => setConfirmDelete(true)} />} />}
    >
      <Tabs value={tab} onValueChange={setTab} data-testid="http-editor" className="-mt-2">
        <UnderlineTabsList className="sticky top-0 z-10 w-full max-w-full justify-start border-b bg-background max-sm:gap-4 max-sm:overflow-x-auto max-sm:overflow-y-hidden">
          <UnderlineTabsTrigger value="general" className={TAB_CLASS}>
            Geral
          </UnderlineTabsTrigger>
          <UnderlineTabsTrigger value="request" className={TAB_CLASS}>
            Requisição
          </UnderlineTabsTrigger>
          <UnderlineTabsTrigger value="advanced" className={TAB_CLASS}>
            Avançado
          </UnderlineTabsTrigger>
        </UnderlineTabsList>

        <TabsContent value="general" className="mt-6 flex flex-col gap-4 data-[state=inactive]:hidden">
          <FieldRow label="Execução" error={errors.window}>
            <ExecutionControl timing={timing} onTimingChange={setTiming} win={win} onWinChange={(v) => (setWin(v), clear('window'))} hoursConfigured={hours.configured} onConfigure={hours.openSheet} />
          </FieldRow>
          <FieldRow label="Nome" htmlFor="http-name" error={errors.name}>
            <Input id="http-name" value={name} onChange={(e) => (setName(e.target.value), clear('name'))} placeholder="Notificação de pedido" aria-invalid={!!errors.name || undefined} />
          </FieldRow>
        </TabsContent>

        <TabsContent value="request" className="mt-7 flex flex-col gap-6 data-[state=inactive]:hidden">
          <Field
            label="URL"
            hint={
              <>
                Endpoint que recebe a requisição. Você pode inserir variáveis com <InlineCode>{'{{variable}}'}</InlineCode>, ex. <InlineCode>{'https://api.example.com/orders/{{orderId}}'}</InlineCode>.
              </>
            }
          >
            <CodeEditor ariaLabel="URL" singleLine variables value={url} onChange={(v) => (setUrl(v), clear('url'), clear('customVars'))} error={errors.url} />
          </Field>
          <Field label="Método" hint="Método HTTP usado na requisição. O corpo só é enviado em métodos diferentes de GET.">
            <Popover open={methodOpen} onOpenChange={setMethodOpen}>
              <PopoverTrigger asChild>
                <button type="button" role="combobox" aria-expanded={methodOpen} aria-label="Método" className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-4 text-sm focus:outline-none focus:ring-1 focus:ring-ring">
                  {method}
                  <ChevronsUpDown className="size-4 opacity-50" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0">
                <Command>
                  <CommandInput placeholder="Pesquisar..." />
                  <CommandList>
                    <CommandEmpty className="py-7 text-center text-sm text-foreground">Nenhum resultado encontrado.</CommandEmpty>
                    <CommandGroup>
                      {METHODS.map((m) => (
                        <CommandItem
                          key={m}
                          value={m}
                          onSelect={() => {
                            setMethod(m)
                            clear('body')
                            setMethodOpen(false)
                          }}
                        >
                          <span className="flex-1">{m}</span>
                          {m === method && <Check />}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </Field>
          <Field
            label="Cabeçalhos"
            hint={
              <>
                Objeto JSON dos cabeçalhos. Insira variáveis pelo seletor, por exemplo <InlineCode>{'{"Authorization": "Bearer {{apiKey}}"}'}</InlineCode>. Após preencher as variáveis o resultado precisa ser JSON válido.
              </>
            }
          >
            <CodeEditor ariaLabel="Cabeçalhos" format variables value={headers} onChange={(v) => (setHeaders(v), clear('headers'), clear('customVars'))} error={errors.headers} />
          </Field>
          <Field label="Corpo" hint="Corpo JSON enviado com a requisição. Pegue valores da conversa e valores gerados pela IA no seletor de variáveis. Após preencher as variáveis o resultado precisa ser JSON válido.">
            <CodeEditor ariaLabel="Corpo" format variables value={body} onChange={(v) => (setBody(v), clear('body'), clear('customVars'))} error={errors.body} disabled={method === 'GET'} />
          </Field>
          {/* "Ordem Funil" › Adicionar novo webhook › 3a.png */}
          <InfoBox tone="neutral" title="Limite de tamanho da resposta">
            As respostas são processadas até 96.000 caracteres — resultados maiores são{' '}
            <SimpleTooltip label="O excedente é descartado e o assistente recebe só o início da resposta.">
              <span className="cursor-help underline decoration-dotted underline-offset-2">encurtados automaticamente</span>
            </SimpleTooltip>
            .
          </InfoBox>
          {vars.length ? (
            <div className="flex flex-col gap-2">
              <CustomVariablesSection collapsible={false} value={vars} onChange={(v) => (setCustomVars(v), clear('customVars'))} />
              <FieldError>{errors.customVars}</FieldError>
            </div>
          ) : (
            <div className="flex flex-col gap-3 border-t pt-6">
              <SectionCaps className="pt-0">Variáveis personalizadas</SectionCaps>
              <div className="flex items-start gap-3 rounded-lg border px-4 py-3 text-sm">
                <Info className="mt-0.5 size-4 shrink-0" />
                <span>
                  Adicione uma variável dinâmica digitando <InlineCode>{'{{variableName}}'}</InlineCode> diretamente no texto.
                </span>
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="advanced" className="mt-7 flex flex-col gap-6 data-[state=inactive]:hidden">
          <Field label="Condição" htmlFor="http-cond" hint="Deixe vazio para sempre executar. Caso contrário, a requisição só é enviada quando isto for verdadeiro para a conversa.">
            <Textarea id="http-cond" value={condition} onChange={(e) => setCondition(e.target.value)} placeholder="Só chamar se o chamador confirmou o pedido." className="min-h-[80px]" />
          </Field>
          <Field label="Timeout (ms)" htmlFor="http-timeout" hint="Quanto tempo aguardar pela resposta antes de desistir. Padrão é 5000 milissegundos." error={errors.timeout}>
            <Input id="http-timeout" inputMode="numeric" value={timeout} onChange={(e) => (setTimeoutMs(e.target.value.replace(/\D/g, '')), clear('timeout'))} aria-invalid={!!errors.timeout || undefined} />
          </Field>
        </TabsContent>
      </Tabs>
      {hours.sheet}
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Excluir requisição HTTP?"
        description={`"${name || 'Requisição HTTP'}" deixará de ser executada.`}
        confirmLabel="Excluir"
        onConfirm={async () => {
          await saveAgent(agent, (a) => ({ webhooks: a.webhooks.filter((x) => x.id !== target?.id) }))
          toast.success('Requisição HTTP excluída.')
          onBack()
        }}
      />
    </SideSheet>
  )
}
