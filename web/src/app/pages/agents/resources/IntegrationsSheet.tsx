import { useEffect, useState } from 'react'
import { ChevronsUpDown } from 'lucide-react'
import { toast } from 'sonner'
import '@/domain/ext/agents-resources'
import type { Agent, IntegrationAction } from '@/domain/types'
import type { ActiveWindow, ExecutionTiming } from '@/domain/ext/agents-resources'
import { cn, uid } from '@/lib/utils'
import { useCurrentOrg } from '@/data/store'
import { INTEGRATIONS } from '@/data/catalogs/integrations'
import { connectSheets } from '@/services/casca/resource-connections'
import { baserowConnector } from '@/services/casca/baserow'
import type { BaserowBinding } from '@/services/engine/baserow'
import { airtableConnector } from '@/services/casca/airtable'
import type { AirtableBinding } from '@/services/engine/airtable'
import { useOperation } from '@/hooks/useOperation'
import { SideSheet } from '@/components/app/SideSheet'
import { ConfirmDialog } from '@/components/app/ConfirmDialog'
import { IntegrationLogo } from '@/components/brand/IntegrationLogo'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, UnderlineTabsList, UnderlineTabsTrigger } from '@/components/ui/tabs'
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { AddRow, ComboSelect, DeleteFooterButton, FieldError, FieldRow, ListCard, ListRow, Pill, SheetFooter } from './shared/ui'
import { EXECUTION_LABEL, ExecutionControl } from './shared/timing'
import { saveAgent, upsert, useErrors, useHoursDraft } from './shared/hooks'
import { newItemParam, parseNewItem, useRoutedView, type ResourceProps } from './shared/listView'
import { AGENT_INTEGRATIONS, schemaBySlug, type IntegrationField, type IntegrationSchema } from './integrationSchemas'
import { PersonalizarSheet } from './PersonalizarSheet'
import { realWebhooks } from '@/services/casca/webhooks'

type View = { mode: 'list'; seq: number } | { mode: 'picker'; fromList: boolean; seq: number } | { mode: 'edit'; id?: string; slug: string; fromList: boolean; seq: number }

type DistOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

const catalogOf = (slug: string) => INTEGRATIONS.find((i) => i.slug === slug)

/**
 * "Integrações": sem integrações o cartão abre direto o diálogo central "Adicionar integração" (fonio-live2 C-55);
 * com integrações mostra a lista (INFERIDO) com "Adicionar integração".
 */
export function IntegrationsResource({ agent, open, onOpenChange }: ResourceProps) {
  // ?item=: "novo" (seletor aberto a partir da lista), "novo-<slug>" (nova integração) ou o id da integração
  const fromParam = (item: string | null, seq: number): View => {
    const has = agent.integrations.length > 0
    const root: View = has ? { mode: 'list', seq } : { mode: 'picker', fromList: false, seq }
    if (!item) return root
    const n = parseNewItem(item)
    if (n.isNew) {
      if (!n.preset) return has ? { mode: 'picker', fromList: true, seq } : root
      return schemaBySlug(n.preset) ? { mode: 'edit', slug: n.preset, fromList: has, seq } : root
    }
    const found = agent.integrations.find((i) => i.id === item)
    return found ? { mode: 'edit', id: found.id, slug: found.integration, fromList: true, seq } : root
  }
  const { view, go } = useRoutedView<View>({
    init: (item) => fromParam(item, 0),
    itemOf: (v) => (v.mode === 'list' ? null : v.mode === 'picker' ? (v.fromList ? newItemParam() : null) : (v.id ?? newItemParam(v.slug))),
    fromItem: (item, cur) => fromParam(item, cur.seq + 1),
  })
  const next = (v: DistOmit<View, 'seq'>) => go((cur) => ({ ...v, seq: cur.seq + 1 }) as View)

  if (view.mode === 'picker')
    return <IntegrationPicker open={open} onClose={() => (view.fromList ? next({ mode: 'list' }) : onOpenChange(false))} onPick={(slug) => next({ mode: 'edit', slug, fromList: view.fromList })} />
  if (view.mode === 'edit') {
    const target = view.id ? agent.integrations.find((i) => i.id === view.id) : undefined
    const schema = schemaBySlug(view.slug)
    if (!schema) return null
    if (schema.slug === 'personalizar') {
      return <PersonalizarSheet agent={agent} target={target} open={open} onOpenChange={onOpenChange} onDone={() => (view.fromList || agent.integrations.length ? next({ mode: 'list' }) : onOpenChange(false))} />
    }
    return (
      <IntegrationEditor
        key={view.seq}
        agent={agent}
        target={target}
        schema={schema}
        open={open}
        onOpenChange={onOpenChange}
        onDone={() => (view.fromList || agent.integrations.length ? next({ mode: 'list' }) : onOpenChange(false))}
        onSavedNew={() => (view.fromList ? next({ mode: 'list' }) : onOpenChange(false))}
      />
    )
  }
  return (
    <SideSheet open={open} onOpenChange={onOpenChange} title="Integrações" hideFooter contentClassName="pt-0">
      <ListCard>
        {agent.integrations.map((i) => (
          <ListRow
            key={i.id}
            leading={<IntegrationLogo surface="agent" slug={i.integration} name={catalogOf(i.integration)?.name ?? i.integration} className="size-8" />}
            title={i.name}
            subtitle={`${catalogOf(i.integration)?.name ?? i.integration} · ${EXECUTION_LABEL[i.timing]}`}
            pills={i.connected ? undefined : <Pill tone="muted">Não conectada</Pill>}
            onClick={() => next({ mode: 'edit', id: i.id, slug: i.integration, fromList: true })}
          />
        ))}
        <AddRow onClick={() => next({ mode: 'picker', fromList: true })}>Adicionar integração</AddRow>
      </ListCard>
    </SideSheet>
  )
}

/** Diálogo "Adicionar integração" (C-55): sm:max-w-[480px] p-0, busca cmdk "Pesquisar integrações...", logo 32px + nome. */
function IntegrationPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (slug: string) => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-[480px] sm:rounded-xl">
        <DialogHeader className="px-4 pt-3 sm:text-left">
          <DialogTitle className="text-lg leading-7">Adicionar integração</DialogTitle>
        </DialogHeader>
        <Command className="mt-2.5">
          <CommandInput autoFocus placeholder="Pesquisar integrações..." aria-label="Pesquisar integrações" />
          <CommandList className="max-h-[360px] p-1" data-testid="integration-picker">
            <CommandEmpty>Nenhum resultado encontrado.</CommandEmpty>
            {AGENT_INTEGRATIONS.map((i) => (
              <CommandItem key={i.slug} value={i.name} onSelect={() => onPick(i.slug)} className="gap-3 rounded-lg px-2 py-2.5">
                <IntegrationLogo surface="agent" slug={i.slug} name={i.name} className="size-8 text-xs" />
                <span className="flex-1 text-sm font-medium">{i.name}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}

type ErrKey = 'connection' | 'name' | 'window' | `field:${string}`

const TAB_CLASS = 'pb-2.5 text-base data-[state=inactive]:text-muted-foreground max-sm:text-[13px]'

/**
 * Folha da integração (C-56, Make): 768px, título = nome, descrição, abas "Geral" | "Settings", rodapé Cancelar | Salvar.
 * Conexão pelo motor simulado: OAuth (Conectar) ou chave de API (diálogo); n8n/Zapier usam a URL do webhook.
 */
function IntegrationEditor({
  agent,
  target,
  schema,
  open,
  onOpenChange,
  onDone,
  onSavedNew,
}: {
  agent: Agent
  target?: IntegrationAction
  schema: IntegrationSchema
  open: boolean
  onOpenChange: (o: boolean) => void
  onDone: () => void
  onSavedNew: () => void
}) {
  const cat = catalogOf(schema.slug)
  const org = useCurrentOrg()
  const hours = useHoursDraft(agent)
  const { errors, setErrors, clear } = useErrors<ErrKey>()
  const [tab, setTab] = useState('general')
  const [name, setName] = useState(target?.name ?? `New ${schema.name} integration`)
  const [integrationId] = useState(() => target?.id ?? uid('int'))
  const [timing, setTiming] = useState<ExecutionTiming>(target?.timing ?? schema.defaultTiming)
  const [win, setWin] = useState<ActiveWindow>(target?.activeWindow ?? 'any')
  const [description, setDescription] = useState(target?.description ?? '')
  const [config, setConfig] = useState<Record<string, string>>(target?.config ?? {})
  const [connected, setConnected] = useState(target?.connected ?? false)
  const [keyOpen, setKeyOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [baserowBinding, setBaserowBinding] = useState<BaserowBinding>()
  const [airtableBinding, setAirtableBinding] = useState<AirtableBinding>()
  const [airtableChoices, setAirtableChoices] = useState<AirtableBinding[]>([])
  useEffect(() => {
    if (!open || schema.slug !== 'airtable') return
    let cancelled = false
    void airtableConnector(agent.id, integrationId).list().then(items => { if (!cancelled) setAirtableChoices(items.filter(b => b.enabled)) }).catch(error => { if (!cancelled) setErrors({ connection: error instanceof Error ? error.message : 'Não foi possível consultar a conexão.' }) })
    return () => { cancelled = true }
  }, [open, schema.slug, agent.id, integrationId])
  const setField = (k: string, v: string) => {
    if (schema.slug === 'airtable' && k === 'base') {
      const binding = airtableChoices.find(b => b.id === v)
      setAirtableBinding(binding); setConnected(false)
      setConfig(c => ({ ...c, base: v, table: binding?.tableId ?? '', account: binding?.name ?? '' }))
      clear(`field:${k}`); return
    }
    setConfig((c) => ({ ...c, [k]: v }))
    clear(`field:${k}`)
  }

  const connectOp = useOperation(async (onProgress, apiKey?: string) => {
    if (schema.slug === 'airtable') {
      const result = await airtableConnector(agent.id, integrationId).connect(config.base || undefined)
      setAirtableChoices(result.items); setAirtableBinding(result.binding)
      setConfig(c => ({ ...c, base: result.binding.id, table: result.binding.tableId }))
      return result.binding.name
    }
    if (schema.slug === 'baserow') {
      const binding = await baserowConnector(agent.id, target?.id ?? 'connect').connect(Number(config.tableId), apiKey ?? '', name)
      setBaserowBinding(binding)
      return binding.name
    }
    if (schema.slug === 'google-sheets') {
      const connection = await connectSheets(onProgress)
      setConfig(c => ({ ...c, connectionId: connection.id }))
      return connection.email
    }
    throw Error(`A conexão de ${schema.name} ainda não está disponível nesta configuração.`)
  })

  const runOAuth = async () => {
    const r = await connectOp.run()
    if (r) {
      setConnected(true)
      clear('connection')
      setConfig((c) => ({ ...c, account: r }))
    }
  }

  const fieldsOf = (t: 'general' | 'settings') => schema.fields.filter((f) => (f.tab ?? 'general') === t)

  const save = async () => {
    try {
    const e: Partial<Record<ErrKey, string>> = {}
    if (!name.trim()) e.name = 'Informe um nome.'
    if (schema.auth !== 'webhook' && !connected) e.connection = `Conecte sua conta do ${schema.name}.`
    for (const f of schema.fields) {
      const v = config[f.key]?.trim() ?? ''
      if (f.required && !v && !(f.afterConnect && !connected)) e[`field:${f.key}`] = `Preencha "${f.label}".`
      else if (f.type === 'url' && v && !/^https:\/\/[^\s]+\.[^\s]+/i.test(v)) e[`field:${f.key}`] = 'Informe uma URL https:// válida.'
    }
    if (win !== 'any' && !hours.configured) e.window = 'Configure o horário de funcionamento para usar esta opção.'
    setErrors(e)
    const first = Object.keys(e).find((k) => e[k as ErrKey])
    if (first) {
      const f = schema.fields.find((x) => `field:${x.key}` === first)
      setTab(f?.tab ?? 'general')
      toast.error('Corrija os campos destacados.')
      return
    }
    const isConnected = schema.auth === 'webhook' ? !!config.webhookUrl?.trim() : connected
    const next: IntegrationAction = {
      id: integrationId,
      integration: schema.slug,
      ...(airtableBinding ? { engineBinding: { kind: 'airtable' as const, id: airtableBinding.id, revision: airtableBinding.revision } } : baserowBinding ? { engineBinding: { kind: 'baserow' as const, id: baserowBinding.id, revision: baserowBinding.revision } } : target?.engineBinding ? { engineBinding: target.engineBinding } : {}),
      name: name.trim(),
      timing,
      config,
      connected: isConnected,
      connectedAt: isConnected ? (target?.connectedAt ?? new Date().toISOString()) : target?.connectedAt,
      lastTest: target?.lastTest,
      activeWindow: win,
      description: description.trim(),
    }
    await saveAgent(agent, (a) => ({ integrations: upsert(a.integrations, next), ...(hours.changed ? { businessHours: hours.hours } : {}) }))
    toast.success(target ? 'Integração atualizada.' : `${schema.name} adicionada ao assistente.`)
    if (target) onDone()
    else onSavedNew()
      } catch (error) { toast.error('Não foi possível salvar', { description: error instanceof Error ? error.message : 'Confira o acesso e tente novamente.' }) }
  }

  const renderField = (f: IntegrationField) => {
    const err = errors[`field:${f.key}`]
    const disabled = f.afterConnect && !connected
    return (
      <FieldRow key={f.key} label={f.label} htmlFor={`int-${f.key}`} error={err} centerLabel={!!f.help}>
        {f.type === 'select' ? (
          disabled ? (
            <button type="button" id={`int-${f.key}`} disabled className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-4 text-sm text-muted-foreground">
              Selecionar...
              <ChevronsUpDown className="size-4 opacity-50" />
            </button>
          ) : (
            <ComboSelect id={`int-${f.key}`} ariaLabel={f.label} value={config[f.key] ?? ''} onChange={(v) => setField(f.key, v)} options={schema.slug === 'airtable' && f.key === 'base' ? airtableChoices.map(b => ({ value: b.id, label: b.name })) : f.options!.map((o) => ({ value: o, label: o }))} />
          )
        ) : f.type === 'textarea' ? (
          <Textarea id={`int-${f.key}`} value={config[f.key] ?? ''} onChange={(e) => setField(f.key, e.target.value)} placeholder={f.placeholder} aria-invalid={!!err || undefined} className="min-h-[88px]" />
        ) : (
          <Input id={`int-${f.key}`} type={f.type === 'password' ? 'password' : 'text'} value={config[f.key] ?? ''} onChange={(e) => setField(f.key, e.target.value)} placeholder={f.placeholder} aria-invalid={!!err || undefined} autoComplete="off" />
        )}
        {f.help && <p className="text-sm text-muted-foreground">{f.help}</p>}
      </FieldRow>
    )
  }

  return (
    <SideSheet
      open={open}
      onOpenChange={onOpenChange}
      width={768}
      title={schema.name}
      description={
        <span className="-mb-2 block">
          {schema.description ?? cat?.description}
          {schema.descriptionLink && (
            <>
              {' '}
              <a href={schema.descriptionLink.href} target="_blank" rel="noreferrer" className="text-blue-600 underline underline-offset-2">
                {schema.descriptionLink.label}
              </a>
              .
            </>
          )}
        </span>
      }
      footer={<SheetFooter onSave={save} onCancel={onDone} left={target && <DeleteFooterButton label="Remover" onClick={() => setConfirmDelete(true)} />} />}
    >
      <Tabs value={tab} onValueChange={setTab} className="-mt-2" data-testid="integration-editor">
        <UnderlineTabsList className="sticky top-0 z-10 w-full max-w-full justify-start border-b bg-background max-sm:gap-4">
          <UnderlineTabsTrigger value="general" className={TAB_CLASS}>
            Geral
          </UnderlineTabsTrigger>
          <UnderlineTabsTrigger value="settings" className={TAB_CLASS}>
            Settings
          </UnderlineTabsTrigger>
        </UnderlineTabsList>

        <TabsContent value="general" className="mt-6 flex flex-col gap-4 data-[state=inactive]:hidden">
          {schema.auth === 'webhook' && target?.engineBinding?.kind === 'http' && (
            <Button type="button" variant="secondary" className="self-start" onClick={() => void realWebhooks.test({ agentId: agent.id, actionId: target.engineBinding && target.engineBinding.kind === 'http' ? target.engineBinding.id : '', arguments: {} }).then(result => toast.success('Conexão confirmada', { description: `HTTP ${result.code} em ${result.ms} ms` })).catch(error => toast.error(error instanceof Error ? error.message : 'Não foi possível testar'))}>
              Testar conexão
            </Button>
          )}
          <FieldRow label="Execução" error={errors.window}>
            <ExecutionControl timing={timing} onTimingChange={setTiming} win={win} onWinChange={(v) => (setWin(v), clear('window'))} hoursConfigured={hours.configured} onConfigure={hours.openSheet} />
          </FieldRow>
          {schema.auth !== 'webhook' && (
            <FieldRow label="Conexão" error={errors.connection ?? (connectOp.status === 'error' && schema.auth === 'oauth' ? connectOp.error : undefined)}>
              {connected ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Pill tone="success">{schema.auth === 'oauth' ? `Conectado como ${config.account ?? schema.name}` : 'Conectado'}</Pill>
                  <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={() => (setConnected(false), connectOp.reset())}>
                    Desconectar
                  </Button>
                </div>
              ) : (
                <Button type="button" className="self-start" disabled={connectOp.isRunning} onClick={() => (schema.auth === 'apikey' ? setKeyOpen(true) : void runOAuth())}>
                  {connectOp.isRunning && schema.auth === 'oauth' ? 'Conectando…' : 'Conectar'}
                </Button>
              )}
            </FieldRow>
          )}
          <FieldRow label="Name" htmlFor="int-name" error={errors.name}>
            <Input id="int-name" value={name} onChange={(e) => (setName(e.target.value), clear('name'))} placeholder="New lead notification" aria-invalid={!!errors.name || undefined} />
          </FieldRow>
          {fieldsOf('general').map(renderField)}
        </TabsContent>

        <TabsContent value="settings" className="mt-6 flex flex-col gap-4 data-[state=inactive]:hidden">
          {fieldsOf('settings').map(renderField)}
          <FieldRow label="Description" htmlFor="int-desc">
            <Textarea id="int-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="When should the agent use this integration?" className="min-h-[80px]" />
          </FieldRow>
        </TabsContent>
      </Tabs>
      {hours.sheet}
      <ApiKeyDialog
        open={keyOpen}
        name={schema.name}
        running={connectOp.isRunning}
        error={connectOp.status === 'error' ? connectOp.error : undefined}
        onOpenChange={(o) => {
          setKeyOpen(o)
          if (!o) connectOp.reset()
        }}
        onSubmit={async (key) => {
          const r = await connectOp.run(key)
          if (r) {
            setConnected(true)
            clear('connection')
            setKeyOpen(false)
          }
        }}
      />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Remover integração?"
        description={`"${name}" deixará de ser usada pelo assistente ${agent.name}.`}
        confirmLabel="Remover"
        onConfirm={async () => {
          await saveAgent(agent, (a) => ({ integrations: a.integrations.filter((x) => x.id !== target?.id) }))
          toast.success('Integração removida.')
          onDone()
        }}
      />
    </SideSheet>
  )
}

/** Conexão por chave de API (Baserow, Stora, WinCasa — INFERIDO): a chave é validada pelo motor simulado e não é exibida depois. */
function ApiKeyDialog({ open, name, running, error, onOpenChange, onSubmit }: { open: boolean; name: string; running: boolean; error?: string; onOpenChange: (o: boolean) => void; onSubmit: (key: string) => void }) {
  const [key, setKey] = useState('')
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setKey('')
        onOpenChange(o)
      }}
    >
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Conectar {name}</DialogTitle>
          <DialogDescription>API key</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            onSubmit(key.trim())
          }}
        >
          <Input autoFocus type="password" autoComplete="off" aria-label="API key" value={key} onChange={(e) => setKey(e.target.value)} className={cn(error && 'border-destructive')} />
          <FieldError>{error}</FieldError>
          <DialogFooter className="mt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={running || !key.trim()}>
              {running ? 'Conectando…' : 'Conectar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
