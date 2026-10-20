import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Check, ChevronsUpDown, CirclePlus, Plus } from 'lucide-react'
import { toast } from 'sonner'
import '@/domain/ext/agents-resources'
import type { Agent, SchedulingAction } from '@/domain/types'
import type { ActiveWindow, SchedulingSettings } from '@/domain/ext/agents-resources'
import { cn, uid } from '@/lib/utils'
import { useCollection, useCurrentOrg, useStore } from '@/data/store'
import { loadAgentScheduling } from '@/services/casca/scheduling-resource'
import { bindEventToAgent } from '@/services/casca/scheduling-actions'
import { OpStatus } from '@/app/pages/phone-numbers/OpStatus'
import { connectCalendly } from '@/services/casca/resource-connections'
import { calendlyEvents, createCalendlyResourceActions } from '@/services/casca/calendly-resource'
import { captureEngineContext, engineSession } from '@/services/engine/session'
import type { CalendlyEventType } from '@/services/engine/calendly'
import { useOperation } from '@/hooks/useOperation'
import { SideSheet } from '@/components/app/SideSheet'
import { ConfirmDialog } from '@/components/app/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, UnderlineTabsList, UnderlineTabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from '@/components/ui/command'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ComboSelect, DeleteFooterButton, Field, FieldError, FieldRow, InlineCode, ListCard, ListRow, Pill, SheetFooter, SheetSegmented, SwitchField, isEmail } from './shared/ui'
import { WindowControl, tzOptions } from './shared/timing'
import { saveAgent, upsert, useErrors, useHoursDraft } from './shared/hooks'
import { useListView, type ResourceProps } from './shared/listView'
import { ConnectCalendarFlow } from './shared/ConnectCalendarFlow'
import { ConnectCalendarSheet } from './shared/ConnectCalendarSheet'

/**
 * Provedores do menu "Adicionar novo agendamento de calendário" (fonio-live2 C-assistentes/46): Agendador de compromissos
 * (Recomendado), Calendly, Cal.com e Etermin. Google/Microsoft ficam só para registros antigos (não estão no menu da Fonio).
 * `etermin` faz parte da união de SchedulingAction['provider'] (domain/types.ts).
 */
type Provider = SchedulingAction['provider']
type Menu = 'kloel' | 'calendly' | 'calcom' | 'etermin'
const MENUS: Menu[] = ['kloel', 'calendly', 'calcom', 'etermin']
const providerOf = (s: SchedulingAction) => s.provider as Provider

export const PROVIDER_LABEL: Record<Provider, string> = {
  kloel: 'Agendador de compromissos',
  calendly: 'Calendly',
  calcom: 'Cal.com',
  etermin: 'eTermin',
  google: 'Google Agenda',
  microsoft: 'Microsoft Outlook',
}

/** "Custo por SMS: 0,15€" (C-48 e "Ordem Funil" › Funil de Agendamento › Configurações). */
const SMS_COST = '0,15€'
const FALLBACK_EMAIL = 'guest@kloel.ai'

const DEFAULT_SETTINGS = (tz: string, provider: Provider): SchedulingSettings => ({
  timezone: tz,
  // C-48: no Agendador "Permitir reservas" já vem ligado; no Calendly ("Ordem Funil" › Configurações) vem desligado
  allowBookings: provider === 'kloel',
  destination: 'email',
  // C-48: "Nome do remetente SMS" = "fonio" → "kloel"
  smsSenderName: 'kloel',
  // C-49: no Agendador os links de reserva começam desligados; no Calendly, ligados
  allowBookingLinks: provider !== 'kloel',
  fallbackEmail: FALLBACK_EMAIL,
  durationMin: 30,
})

/** Nome padrão da ferramenta (C-47/51/52/53, em inglês na Fonio). */
const DEFAULT_NAME: Record<Provider, string> = {
  kloel: 'New scheduler integration',
  calendly: 'New Calendly integration',
  calcom: 'New Cal.com integration',
  etermin: 'New eTermin integration',
  google: 'Nova integração do Google Agenda',
  microsoft: 'Nova integração do Microsoft Outlook',
}

export function SchedulingResource({ agent, open, onOpenChange }: ResourceProps) {
  const lv = useListView(true, undefined, (id) => agent.scheduling.some((s) => s.id === id))
  const view = lv.view
  const load = useOperation(async () => loadAgentScheduling(agent.id))
  useEffect(() => { if (open) void load.run() }, [open, agent.id])
  if (open && load.status !== 'success') return <SideSheet open={open} onOpenChange={onOpenChange} title="Agendar compromissos" hideFooter><OpStatus status={load.status === 'idle' ? 'running' : load.status} progress={load.progress} error={load.error} onRetry={() => void load.run()} /></SideSheet>
  if (view.mode === 'list')
    return (
      // C-45: título, descrição e cartão com "⊕ Adicionar novo agendamento de calendário"
      <SideSheet open={open} onOpenChange={onOpenChange} title="Agendar compromissos" description="Agende compromissos nas conversas compatíveis." hideFooter contentClassName="pt-0">
        <ListCard>
          {agent.scheduling.map((s) => (
            <ListRow key={s.id} testId={`scheduling-row-${s.id}`} title={s.name} pills={<><Pill>{BADGE_LABEL[providerOf(s)] ?? s.provider}</Pill>{(s.engineBookingActions && !s.engineBookingActions.some(a => a.available) || s.engineCalendly && !s.engineCalendly.actions.some(a => a.available)) && <Pill>Requer confirmação</Pill>}</>} onClick={() => lv.edit(s.id)} />
          ))}
          <li>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="flex h-auto w-full items-center justify-center gap-2 rounded-none px-5 py-4 text-sm font-medium text-brand transition-colors hover:bg-accent data-[state=open]:bg-background">
                  <CirclePlus className="size-4" /> Adicionar novo agendamento de calendário
                </button>
              </DropdownMenuTrigger>
              {/* C-46: menu w-64; 1º item com selo "Recomendado" e descrição; separador; demais itens em cinza */}
              <DropdownMenuContent align="center" className="w-64 p-1">
                <DropdownMenuItem onSelect={() => lv.add('kloel')} className="flex-col items-stretch gap-1 px-2 py-2" aria-label="Adicionar Agendador de compromissos (Recomendado)">
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-medium leading-5">
                      <span className="block whitespace-nowrap">Adicionar Agendador</span>
                      <span className="block whitespace-nowrap">de compromissos</span>
                    </span>
                    <span className="shrink-0 rounded-full bg-brand px-2 text-[10px] font-semibold leading-[14px] text-white">Recomendado</span>
                  </span>
                  <span className="text-xs leading-4 text-muted-foreground">Integrado ao kloel, o mais rápido de configurar</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => lv.add('calendly')} className="text-muted-foreground">
                  Adicionar Calendly
                </DropdownMenuItem>
                {/* Cal.com e eTermin exigem integrações próprias (chave de API do cliente) que o motor ainda não executa: sem formulário que não conecta. */}
                <DropdownMenuItem disabled className="justify-between text-muted-foreground" title="Integração com Cal.com ainda não disponível na Kloel">
                  Adicionar Cal.com <span className="rounded-full border px-1.5 text-[10px] leading-4">Em breve</span>
                </DropdownMenuItem>
                <DropdownMenuItem disabled className="justify-between text-muted-foreground" title="Integração com eTermin ainda não disponível na Kloel">
                  Adicionar Etermin <span className="rounded-full border px-1.5 text-[10px] leading-4">Em breve</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </li>
        </ListCard>
      </SideSheet>
    )
  const target = view.id ? agent.scheduling.find((s) => s.id === view.id) : undefined
  // ?item=novo-<menu> vindo da URL: só aceita as opções do menu "Adicionar"
  const menu: Menu = MENUS.includes(view.preset as Menu) ? (view.preset as Menu) : 'kloel'
  const provider: Provider = target ? providerOf(target) : menu
  return <SchedulingEditor key={view.seq} agent={agent} target={target} initialProvider={provider} open={open} onOpenChange={onOpenChange} onDone={lv.done} />
}

const BADGE_LABEL: Record<Provider, string> = { kloel: 'Agendador', calendly: 'Calendly', calcom: 'Cal.com', etermin: 'eTermin', google: 'Google Agenda', microsoft: 'Microsoft Outlook' }

const FEATURES: Record<Provider, string[]> = {
  // C-47: 7 funcionalidades do Agendador
  kloel: [
    'Verificar disponibilidade em tempo real',
    'Agendar compromissos',
    'Ver compromissos agendados',
    'Reagendar compromissos',
    'Cancelar compromissos',
    'Enviar link de agendamento',
    'Compartilhar link de gerenciamento de reserva',
  ],
  calendly: ['Verificar disponibilidade em tempo real', 'Agendar compromissos', 'Enviar link de agendamento'],
  calcom: ['Verificar disponibilidade em tempo real', 'Agendar compromissos', 'Enviar link de agendamento'],
  // C-53: eTermin em inglês na Fonio
  etermin: ['Check real-time availability', 'Find available days', 'Book appointments', 'Cancel appointments', 'Reschedule appointments'],
  google: ['Verificar disponibilidade em tempo real', 'Agendar compromissos'],
  microsoft: ['Verificar disponibilidade em tempo real', 'Agendar compromissos'],
}

const EXT = 'text-blue-600 underline underline-offset-2'
const DESCRIPTION: Record<Provider, ReactNode> = {
  kloel: undefined,
  calendly: 'É necessária uma assinatura paga do Calendly (Standard ou superior) para agendar compromissos pela API.',
  calcom: (
    <>
      Assista{' '}
      <a href="https://www.youtube.com/results?search_query=cal.com+api+key+event+id" target="_blank" rel="noreferrer" className={EXT}>
        este vídeo curto
      </a>{' '}
      para saber onde encontrar sua chave API e o Event ID do cal.com. Ou assista{' '}
      <a href="https://www.youtube.com/results?search_query=cal.com+getting+started" target="_blank" rel="noreferrer" className={EXT}>
        este vídeo
      </a>{' '}
      se estiver usando o cal.com pela primeira vez. É gratuito.
    </>
  ),
  etermin: (
    <>
      Connect your eTermin account to manage appointments by voice. You can find your API keys in the{' '}
      <a href="https://www.etermin.net" target="_blank" rel="noreferrer" className={EXT}>
        eTermin dashboard
      </a>{' '}
      under API Interfaces → API &amp; Web-Push. See the{' '}
      <a href="https://www.etermin.net/api" target="_blank" rel="noreferrer" className={EXT}>
        API documentation
      </a>{' '}
      for more details.
    </>
  ),
  google: 'Agenda diretamente no calendário conectado, respeitando os horários ocupados.',
  microsoft: 'Agenda diretamente no calendário conectado, respeitando os horários ocupados.',
}

const TITLE: Record<Provider, string> = {
  kloel: 'Agendamento de Compromissos',
  calendly: 'Agendamento com Calendly',
  calcom: 'Agendamento com Cal.com',
  etermin: 'eTermin Appointment Scheduling',
  google: 'Agendamento com Google Agenda',
  microsoft: 'Agendamento com Microsoft Outlook',
}

type ErrKey = 'name' | 'eventType' | 'connection' | 'url' | 'calendar' | 'sms' | 'fallbackEmail' | 'window'
const TAB_OF: Record<ErrKey, string> = { name: 'general', eventType: 'general', connection: 'general', url: 'general', calendar: 'general', window: 'general', sms: 'settings', fallbackEmail: 'advanced' }

const TAB_CLASS = 'pb-2.5 text-base data-[state=inactive]:text-muted-foreground max-sm:text-[13px]'

function SchedulingEditor({
  agent,
  target,
  initialProvider,
  open,
  onOpenChange,
  onDone,
}: {
  agent: Agent
  target?: SchedulingAction
  initialProvider: Provider
  open: boolean
  onOpenChange: (o: boolean) => void
  onDone: () => void
}) {
  const org = useCurrentOrg()
  const navigate = useNavigate()
  const eventTypes = useCollection('eventTypes')
  const allCalendars = useCollection('calendarConnections')
  const hours = useHoursDraft(agent)
  const { errors, setErrors, clear } = useErrors<ErrKey>()
  const [tab, setTab] = useState('general')
  const [provider, setProvider] = useState<Provider>(initialProvider)
  const isCalendar = provider === 'google' || provider === 'microsoft'
  const isKloel = provider === 'kloel'
  const isEtermin = provider === 'etermin'
  const usesAccount = provider === 'calendly' || provider === 'calcom' || isEtermin
  const usesUrl = provider === 'calendly' || provider === 'calcom'
  const calendars = useMemo(() => allCalendars.filter((c) => c.features.includes('calendar') && c.provider === provider), [allCalendars, provider])
  const anyCalendar = allCalendars.some((c) => c.features.includes('calendar'))
  const [name, setName] = useState(target?.name ?? DEFAULT_NAME[initialProvider])
  const [description, setDescription] = useState(target?.description ?? '')
  const [win, setWin] = useState<ActiveWindow>(target?.activeWindow ?? 'any')
  // C-47: o tipo de evento começa vazio ("Selecionar...")
  const [eventTypeId, setEventTypeId] = useState<string | undefined>(target?.eventTypeId)
  const [url, setUrl] = useState(target?.url)
  const [account, setAccount] = useState(target?.connectedAccount)
  const [calendarId, setCalendarId] = useState<string | undefined>(target?.calendarConnectionId ?? calendars[0]?.id)
  const [settings, setSettings] = useState<SchedulingSettings>({ ...DEFAULT_SETTINGS(org?.timezone ?? 'America/Sao_Paulo', initialProvider), ...(target?.settings as Partial<SchedulingSettings> | undefined), destination: 'email', ...(initialProvider === 'kloel' ? { disableNotifications: !!(target?.settings as Partial<SchedulingSettings> | undefined)?.disableNotifications } : { disableNotifications: true }), ...(initialProvider === 'calendly' ? { allowBookingLinks: false, fallbackEmail: '' } : {}) })
  const [urlOpen, setUrlOpen] = useState(false)
  const [eventOpen, setEventOpen] = useState(false)
  const [connectSheet, setConnectSheet] = useState(false)
  const [connectCal, setConnectCal] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const set = <K extends keyof SchedulingSettings>(k: K, v: SchedulingSettings[K]) => setSettings((s) => ({ ...s, [k]: v }))

  const [eventUrls, setEventUrls] = useState<string[]>([])
  const [nativeEvents, setNativeEvents] = useState<CalendlyEventType[]>(target?.engineCalendly?.event ? [target.engineCalendly.event] : [])
  const [calendlyConnectionId, setCalendlyConnectionId] = useState(target?.engineCalendly?.connectionId)
  const calendlyActionsRef = useRef<ReturnType<typeof createCalendlyResourceActions>>()
  const calendlyActions = () => {
    if (calendlyActionsRef.current) return calendlyActionsRef.current
    const context = captureEngineContext('integrations:execute'), identity = engineSession.getSnapshot().data!.identity.context
    return calendlyActionsRef.current = createCalendlyResourceActions(context, agent.id, identity, window.sessionStorage)
  }
  const catalog = useOperation(async () => {
    const connection = target?.engineCalendly?.connection
    if (!connection || connection.status !== 'connected') return
    const items = await calendlyEvents(captureEngineContext(), connection)
    setNativeEvents(items); setEventUrls(items.filter(event => event.supported && event.schedulingUrl).map(event => event.schedulingUrl!))
  })
  useEffect(() => { if (open && initialProvider === 'calendly' && target?.engineCalendly) void catalog.run() }, [open, target?.id])
  const connect = useOperation(async (onProgress) => {
    if (provider !== 'calendly') throw Error(`A conexão de ${PROVIDER_LABEL[provider]} ainda não está disponível nesta configuração.`)
    const result = await connectCalendly(onProgress)
    setCalendarId(result.connection.id)
    setCalendlyConnectionId(result.connection.id)
    setNativeEvents(result.eventTypes)
    setUrl(undefined)
    setEventUrls(result.eventTypes.filter(event => event.supported && event.schedulingUrl).map(event => event.schedulingUrl!))
    return result.connection.displayName
  })

  const save = async () => {
    try {
    const e: Partial<Record<ErrKey, string>> = {}
    if (!name.trim()) e.name = 'Informe um nome.'
    if (isKloel && !eventTypeId) e.eventType = 'Selecione um tipo de evento.'
    if (usesAccount && !account) e.connection = `Conecte sua conta do ${PROVIDER_LABEL[provider]}.`
    if (usesUrl && account && !url) e.url = 'Selecione a URL de agendamento do evento.'
    if (isCalendar && !calendarId) e.calendar = 'Selecione ou conecte um calendário.'
    if (win !== 'any' && !hours.configured) e.window = 'Configure o horário de funcionamento para usar esta opção.'
    if (!isEtermin && settings.allowBookings && settings.destination === 'sms' && !/^[A-Za-z0-9]{3,11}$/.test(settings.smsSenderName)) e.sms = 'Use de 3 a 11 letras ou números, sem espaços.'
    if (!isKloel && !isEtermin && provider !== 'calendly' && !isEmail(settings.fallbackEmail)) e.fallbackEmail = 'Informe um endereço de e-mail válido.'
    setErrors(e)
    const first = (Object.keys(e) as ErrKey[]).find((k) => e[k])
    if (first) {
      setTab(TAB_OF[first])
      toast.error('Corrija os campos destacados.')
      return
    }
    const next: SchedulingAction = {
      id: target?.id ?? uid('sch'),
      provider,
      name: name.trim(),
      description: description.trim(),
      eventTypeId: isKloel ? eventTypeId : undefined,
      url: usesUrl ? url : undefined,
      connectedAccount: usesAccount ? account : undefined,
      calendarConnectionId: isCalendar ? calendarId : undefined,
      activeWindow: win,
      settings: { ...settings } as unknown as Record<string, unknown>,
    }
    if (isKloel) {
      const selected = eventTypes.find(event => event.id === eventTypeId)
      if (!selected) throw Error('Selecione um tipo de evento.')
      if (target?.eventTypeId && target.eventTypeId !== selected.id) throw Error('Remova o vínculo atual antes de escolher outro tipo de evento.')
      await bindEventToAgent(selected, agent.id, true, settings.allowBookings)
      // Nome, descrição, horário ativo, links de reserva e notificações ficam no estado do assistente; o motor os lê ao montar a ferramenta.
      const current = useStore.getState().db.agents.find(a => a.id === agent.id) ?? agent
      const saved: SchedulingAction = { ...next, settings: { ...settings, destination: 'email' } as unknown as Record<string, unknown> }
      const rows = current.scheduling.filter(s => !(s.provider === 'kloel' && s.eventTypeId === selected.id) && s.id !== saved.id).map(({ engineBookingActions: _a, engineCalendly: _c, ...rest }) => rest as SchedulingAction)
      await saveAgent(current, () => ({ scheduling: [...rows, saved], ...(hours.changed ? { businessHours: hours.hours } : {}) }))
      await loadAgentScheduling(agent.id)
    } else if (provider === 'calendly') {
      const selected = nativeEvents.find(event => event.schedulingUrl === url && event.supported)
      if (!calendlyConnectionId || !selected) throw Error('Selecione um evento disponível nesta conta.')
      if (win !== 'any' || hours.changed || description.trim() || settings.allowBookingLinks || settings.fallbackEmail) throw Error('Horário de funcionamento, descrição, envio de links e e-mail de substituição ainda não estão disponíveis nesta integração. Remova essas opções para salvar.')
      if (name !== selected.name && name !== DEFAULT_NAME.calendly || settings.timezone !== selected.timezone) throw Error('Nome e fuso são definidos pelo evento do Calendly. Selecione novamente o evento para atualizá-los.')
      if (target?.engineCalendly && (target.engineCalendly.connectionId !== calendlyConnectionId || target.engineCalendly.eventTypeId !== selected.id)) throw Error('Remova o vínculo atual antes de escolher outro evento ou outra conta.')
      await calendlyActions().save(calendlyConnectionId, selected.id, settings.allowBookings)
      await loadAgentScheduling(agent.id)
    } else {
      throw Error('A configuração de reservas deste provedor ainda não está disponível nesta folha.')
    }
    toast.success(target ? 'Agendamento atualizado.' : 'Agendamento adicionado.')
    onDone()
      } catch (error) { toast.error('Não foi possível salvar', { description: error instanceof Error ? error.message : 'Confira o acesso e tente novamente.' }) }
  }

  const eventType = eventTypes.find((x) => x.id === eventTypeId)
  const destLabel = settings.destination === 'sms' ? 'SMS' : 'e-mail'

  return (
    <SideSheet
      open={open}
      onOpenChange={onOpenChange}
      width={768}
      // C-47: sem descrição, a caixa "Funcionalidades" fica 8px abaixo do título → o título devolve 32px ao cabeçalho
      title={DESCRIPTION[provider] ? TITLE[provider] : <span className="-mb-8 block">{TITLE[provider]}</span>}
      // C-51: a caixa "Funcionalidades" fica 20px abaixo da descrição (o SideSheet compartilhado põe 32px)
      description={DESCRIPTION[provider] ? <span className="-mb-3 block">{DESCRIPTION[provider]}</span> : undefined}
      footer={<SheetFooter onSave={save} onCancel={onDone} left={target && <DeleteFooterButton onClick={() => setConfirmDelete(true)} />} />}
    >
      <div className={cn('flex flex-col gap-6', DESCRIPTION[provider] && '-mt-2')} data-testid="scheduling-editor">
        {provider === 'calendly' && ['running', 'error'].includes(catalog.status) && <OpStatus status={catalog.status} progress={catalog.progress} error={catalog.error} onRetry={() => void catalog.run()} />}
        <div className="rounded-lg border px-3 py-3 sm:mr-10">
          <p className="text-sm font-semibold text-foreground/70">{isEtermin ? 'Features' : 'Funcionalidades'}</p>
          <ul className="mt-2 list-disc pl-5 text-xs text-muted-foreground">
            {FEATURES[provider].map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
        <Tabs value={tab} onValueChange={setTab}>
          <UnderlineTabsList className="sticky top-0 z-10 w-full max-w-full justify-start border-b bg-background max-sm:gap-4 max-sm:overflow-x-auto max-sm:overflow-y-hidden">
            <UnderlineTabsTrigger value="general" className={TAB_CLASS}>
              Geral
            </UnderlineTabsTrigger>
            {isEtermin ? (
              <UnderlineTabsTrigger value="settings" className={TAB_CLASS}>
                Settings
              </UnderlineTabsTrigger>
            ) : (
              <>
                <UnderlineTabsTrigger value="settings" className={TAB_CLASS}>
                  Configurações
                </UnderlineTabsTrigger>
                <UnderlineTabsTrigger value="advanced" className={TAB_CLASS}>
                  Configurações avançadas
                </UnderlineTabsTrigger>
              </>
            )}
          </UnderlineTabsList>

          <TabsContent value="general" className="mt-6 flex flex-col gap-4 data-[state=inactive]:hidden">
            <FieldRow label="Ativo" htmlFor="sch-window" error={errors.window}>
              <WindowControl id="sch-window" value={win} onChange={(v) => (setWin(v), clear('window'))} hoursConfigured={hours.configured} onConfigure={hours.openSheet} />
            </FieldRow>

            {isKloel && (
              <FieldRow label="Tipo de evento" centerLabel>
                <Popover open={eventOpen} onOpenChange={setEventOpen}>
                  <PopoverTrigger asChild>
                    <button
                      id="sch-event-type"
                      type="button"
                      role="combobox"
                      aria-expanded={eventOpen}
                      aria-label="Tipo de evento"
                      aria-invalid={!!errors.eventType || undefined}
                      className={cn('flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-4 text-sm focus:outline-none focus:ring-1 focus:ring-ring aria-[invalid=true]:border-destructive', !eventType && 'text-muted-foreground')}
                    >
                      <span className="truncate">{eventType?.name ?? 'Selecionar...'}</span>
                      <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0">
                    <Command>
                      <CommandInput placeholder="Pesquisar..." />
                      <CommandList>
                        <CommandEmpty className="py-7 text-center text-sm text-foreground">Nenhum resultado encontrado.</CommandEmpty>
                        {eventTypes.length > 0 && (
                          <CommandGroup>
                            {eventTypes.map((et) => (
                              <CommandItem
                                key={et.id}
                                value={et.name}
                                onSelect={() => {
                                  setEventTypeId(et.id)
                                  if (isKloel) setName(et.name)
                                  clear('eventType')
                                  setEventOpen(false)
                                }}
                              >
                                <span className="flex-1 truncate">{et.name}</span>
                                {et.id === eventTypeId && <Check className="size-4" />}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        )}
                        <CommandSeparator />
                        <CommandGroup forceMount>
                          <CommandItem
                            value="__adicionar-novo-evento"
                            forceMount
                            onSelect={() => {
                              setEventOpen(false)
                              // C-50: sem calendário conectado abre "Conectar calendário"; com calendário, leva ao Agendador (criação do tipo)
                              if (anyCalendar) navigate('/app/scheduling')
                              else setConnectSheet(true)
                            }}
                          >
                            <Plus className="size-4" /> Adicionar novo evento
                          </CommandItem>
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                <p className="text-sm text-muted-foreground">
                  Para editar os detalhes de um tipo de compromisso, abra o{' '}
                  <Link to={eventType ? `/app/scheduling/${eventType.id}` : '/app/scheduling'} className="text-blue-600 underline underline-offset-2">
                    Agendador de compromissos
                  </Link>{' '}
                  e selecione o tipo desejado na lista.
                </p>
                <FieldError>{errors.eventType}</FieldError>
              </FieldRow>
            )}

            {usesAccount && (
              <FieldRow label="Conexão" error={errors.connection ?? (connect.status === 'error' ? connect.error : undefined)}>
                {account ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill tone="success">Conectado como {account}</Pill>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground"
                      onClick={() => {
                        if (provider === 'calendly') { setConfirmDisconnect(true); return }
                        setAccount(undefined)
                        setUrl(undefined)
                        connect.reset()
                      }}
                    >
                      Desconectar
                    </Button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    className="self-start"
                    disabled={connect.isRunning}
                    onClick={async () => {
                      const acc = await connect.run()
                      if (acc) {
                        setAccount(acc)
                        clear('connection')
                      }
                    }}
                  >
                    {connect.isRunning ? 'Conectando…' : 'Conectar'}
                  </Button>
                )}
              </FieldRow>
            )}

            {isCalendar && (
              <>
                <FieldRow label="Provedor">
                  <SheetSegmented<Provider>
                    ariaLabel="Provedor"
                    className="self-start"
                    value={provider}
                    onChange={(p) => {
                      setProvider(p)
                      setCalendarId(allCalendars.find((c) => c.provider === p && c.features.includes('calendar'))?.id)
                    }}
                    options={[
                      { value: 'google', label: 'Google' },
                      { value: 'microsoft', label: 'Microsoft' },
                    ]}
                  />
                </FieldRow>
                <FieldRow label="Calendário" error={errors.calendar}>
                  {calendars.length ? (
                    <Select value={calendarId ?? ''} onValueChange={(v) => (setCalendarId(v), clear('calendar'))}>
                      <SelectTrigger aria-label="Calendário">
                        <SelectValue placeholder="Selecionar..." />
                      </SelectTrigger>
                      <SelectContent>
                        {calendars.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.email}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <button type="button" onClick={() => setConnectCal(true)} className="self-start pt-2.5 text-sm font-medium text-brand hover:underline">
                      Conectar calendário
                    </button>
                  )}
                </FieldRow>
              </>
            )}

            {isKloel ? (
              <>
                <FieldRow label="Quando o agente deve usar esta ferramenta?" htmlFor="sch-desc" centerLabel>
                  <Input id="sch-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Use esta ferramenta quando o chamador quiser agendar um compromisso" />
                  <p className="text-sm text-muted-foreground">
                    Diga ao agente quando oferecer este tipo de compromisso — ex. "quando o chamador pergunta sobre uma consulta" ou "quando alguém quer agendar uma demo".
                  </p>
                </FieldRow>
                <FieldRow label="Nome da ferramenta" htmlFor="sch-name" error={errors.name}>
                  <Input id="sch-name" value={name} onChange={(e) => (setName(e.target.value), clear('name'))} placeholder="ex. Agendar consulta" aria-invalid={!!errors.name || undefined} />
                </FieldRow>
              </>
            ) : (
              <>
                <FieldRow label={isEtermin ? 'Name' : 'Nome'} htmlFor="sch-name" error={errors.name}>
                  <Input id="sch-name" value={name} onChange={(e) => (setName(e.target.value), clear('name'))} placeholder={isEtermin ? 'Book consultation appointment' : 'Agendar consulta'} aria-invalid={!!errors.name || undefined} />
                </FieldRow>
                <FieldRow label={isEtermin ? 'Description' : 'Descrição'} htmlFor="sch-desc">
                  <Input id="sch-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder={isEtermin ? 'Calendar of Dr. Smith' : provider === 'calcom' ? 'Calendário de xyz' : 'Calendário de consultas'} />
                </FieldRow>
              </>
            )}

            {usesUrl && (
              <FieldRow label="URL de agendamento de evento" error={errors.url}>
                <Popover open={urlOpen} onOpenChange={setUrlOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      role="combobox"
                      aria-expanded={urlOpen}
                      aria-label="URL de agendamento de evento"
                      aria-invalid={!!errors.url || undefined}
                      className={cn('flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-4 text-sm focus:outline-none focus:ring-1 focus:ring-ring aria-[invalid=true]:border-destructive', !url && 'text-muted-foreground')}
                    >
                      <span className="truncate">{url ?? 'Selecionar...'}</span>
                      <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0">
                    <Command>
                      <CommandInput placeholder="Pesquisar..." />
                      <CommandList>
                        <CommandEmpty className="py-7 text-center text-sm text-foreground">Nenhum resultado encontrado.</CommandEmpty>
                        {eventUrls.length > 0 && (
                          <CommandGroup>
                            {eventUrls.map((u) => (
                              <CommandItem
                                key={u}
                                value={u}
                                onSelect={() => {
                                  setUrl(u)
                                  if (provider === 'calendly') { const selected = nativeEvents.find(event => event.schedulingUrl === u); if (selected) { setName(selected.name); set('timezone', selected.timezone) } }
                                  clear('url')
                                  setUrlOpen(false)
                                }}
                              >
                                <span className="flex-1 truncate">{u}</span>
                                {u === url && <Check className="size-4" />}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        )}
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </FieldRow>
            )}

            {isCalendar && (
              <FieldRow label="Duração do compromisso">
                <Select value={String(settings.durationMin ?? 30)} onValueChange={(v) => set('durationMin', Number(v))}>
                  <SelectTrigger aria-label="Duração do compromisso">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[15, 30, 45, 60, 90].map((m) => (
                      <SelectItem key={m} value={String(m)}>
                        {m} minutos
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FieldRow>
            )}
          </TabsContent>

          {isEtermin ? (
            // eTermin › Settings (aba não aberta no levantamento — INFERIDO, mantém o inglês da Fonio para esta integração)
            <TabsContent value="settings" className="mt-6 flex flex-col gap-[22px] data-[state=inactive]:hidden">
              <Field label="Calendar timezone" htmlFor="sch-tz">
                <ComboSelect id="sch-tz" ariaLabel="Calendar timezone" placeholder="Selecionar..." value={settings.timezone} onChange={(v) => set('timezone', v)} options={tzOptions(settings.timezone).map((t) => ({ value: t.value, label: t.value }))} />
              </Field>
              <SwitchField label="Allow bookings" description="Otherwise, only availability can be checked">
                <Switch aria-label="Allow bookings" checked={settings.allowBookings} onCheckedChange={(v) => set('allowBookings', v)} />
              </SwitchField>
            </TabsContent>
          ) : (
            <>
              <TabsContent value="settings" className="mt-6 flex flex-col gap-[22px] data-[state=inactive]:hidden">
                {/* "Ordem Funil" › Configurações: Calendly/Cal.com têm o fuso do calendário (IANA); o Agendador usa o do tipo de evento (C-48) */}
                {!isKloel && (
                  <Field label="Fuso horário do calendário" htmlFor="sch-tz">
                    <ComboSelect id="sch-tz" ariaLabel="Fuso horário do calendário" placeholder="Selecionar..." value={settings.timezone} onChange={(v) => set('timezone', v)} options={tzOptions(settings.timezone).map((t) => ({ value: t.value, label: t.value }))} />
                  </Field>
                )}
                <SwitchField label="Permitir reservas" description="Caso contrário, apenas a disponibilidade pode ser consultada">
                  <Switch aria-label="Permitir reservas" checked={settings.allowBookings} onCheckedChange={(v) => (set('allowBookings', v), clear('sms'))} />
                </SwitchField>
                <Field label="Destino da reserva" htmlFor="sch-dest">
                  <ComboSelect<SchedulingSettings['destination']>
                    id="sch-dest"
                    ariaLabel="Destino da reserva"
                    placeholder="Selecionar..."
                    value={settings.destination}
                    onChange={(v) => (set('destination', v), clear('sms'))}
                    options={[
                      { value: 'email', label: 'EMAIL' },
                    ]}
                  />
                </Field>
                {settings.destination === 'sms' && (
                  <Field label="Nome do remetente SMS" htmlFor="sch-sms" hint="Este nome será usado ao enviar o SMS de reserva" error={errors.sms}>
                    <Input id="sch-sms" value={settings.smsSenderName} maxLength={11} onChange={(e) => (set('smsSenderName', e.target.value), clear('sms'))} aria-invalid={!!errors.sms || undefined} />
                  </Field>
                )}
                {/* C-48: caixa "Processo de reserva por SMS" com 4 passos, linha de falha e "Custo por SMS: 0,15€" */}
                <div className="rounded-lg border px-3 py-3 text-xs leading-4 text-muted-foreground">
                  <p className="mb-1.5 text-xs font-semibold leading-5 text-foreground/70">Processo de reserva por {destLabel}</p>
                  <ol className="list-decimal pl-5">
                    <li>Perguntar o horário preferido, sugerir alternativas se indisponível</li>
                    <li>Perguntar nome e sobrenome</li>
                    {settings.destination === 'sms' ? (
                      <li>Perguntar se o número atual pode ser usado para a confirmação SMS – caso contrário, coletar um número alternativo</li>
                    ) : (
                      <li>Perguntar o endereço de e-mail para a confirmação e soletrá-lo de volta</li>
                    )}
                    <li>Reservar o compromisso e apresentar o resultado na conversa</li>
                  </ol>
                  <p className="mt-4">{provider === 'calendly' ? 'As notificações são gerenciadas pelo Calendly. Confira as configurações na conta conectada.' : settings.disableNotifications ? 'Notificações da Kloel desativadas para as reservas feitas por este assistente.' : 'A Kloel envia a confirmação, os lembretes e os avisos de reagendamento e cancelamento por e-mail, conforme a aba Notificações do tipo de evento.'}</p>
                  {settings.destination === 'sms' && (
                    <p className="mt-4" data-testid="sms-cost">
                      Custo por SMS: {SMS_COST}
                    </p>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="advanced" className="mt-6 flex flex-col gap-[22px] data-[state=inactive]:hidden">
                <SwitchField label="Permitir links de reserva" description="Se ocorrer um erro ao reservar, o assistente pode enviar o link de reserva diretamente ao chamador">
                  <Switch disabled={provider === 'calendly'} aria-label="Permitir links de reserva" checked={settings.allowBookingLinks} onCheckedChange={(v) => set('allowBookingLinks', v)} />
                </SwitchField>
                {isKloel && (
                  <SwitchField label="Desativar notificações da Kloel" description="Desativa as notificações de confirmação/reagendamento/cancelamento enviadas ao cliente pela Kloel.">
                    <Switch aria-label="Desativar notificações da Kloel" checked={!!settings.disableNotifications} onCheckedChange={(v) => set('disableNotifications', v)} />
                  </SwitchField>
                )}
                <Field
                  label="E-mail de substituição"
                  htmlFor="sch-fallback"
                  hint={
                    <>
                      O endereço de substituição não é usado pelo agendador. Valor exibido: <InlineCode>{FALLBACK_EMAIL}</InlineCode>.
                      <span className="mt-4 block">Recomendamos manter este valor ou usar um endereço válido mas não utilizado para evitar mensagens de erro.</span>
                    </>
                  }
                  error={errors.fallbackEmail}
                >
                  <Input disabled={isKloel || provider === 'calendly'} id="sch-fallback" type="email" value={settings.fallbackEmail} onChange={(e) => (set('fallbackEmail', e.target.value), clear('fallbackEmail'))} aria-invalid={!!errors.fallbackEmail || undefined} />
                </Field>
              </TabsContent>
            </>
          )}
        </Tabs>
      </div>
      {hours.sheet}
      <ConnectCalendarSheet open={connectSheet} onOpenChange={setConnectSheet} />
      <ConnectCalendarFlow
        open={connectCal}
        onOpenChange={setConnectCal}
        onConnected={(c) => {
          if (c.provider !== provider) setProvider(c.provider)
          setCalendarId(c.id)
          clear('calendar')
        }}
      />
      <ConfirmDialog
        open={confirmDisconnect}
        onOpenChange={setConfirmDisconnect}
        title="Desconectar Calendly?"
        description="Os agendamentos dos assistentes que usam esta conta deixarão de estar disponíveis até uma nova conexão e confirmação."
        confirmLabel="Desconectar"
        onConfirm={async () => {
          if (!calendlyConnectionId) throw Error('A conta conectada não está disponível.')
          await calendlyActions().disconnect(calendlyConnectionId)
          await loadAgentScheduling(agent.id)
          setAccount(undefined); setUrl(undefined); setCalendlyConnectionId(undefined); setNativeEvents([]); setEventUrls([]); connect.reset()
          toast.success('Calendly desconectado.')
        }}
      />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Excluir agendamento?"
        description={`O assistente deixará de agendar com "${name}".`}
        confirmLabel="Excluir"
        onConfirm={async () => {
          if (target?.provider === 'calendly' && target.engineCalendly) {
            await calendlyActions().remove(target.engineCalendly.connectionId, target.engineCalendly.eventTypeId)
            await loadAgentScheduling(agent.id); toast.success('Agendamento excluído.'); onDone(); return
          }
          const current = useStore.getState().db.agents.find(a => a.id === agent.id) ?? agent
          const rest = current.scheduling.filter(s => s.id !== target?.id && !(target?.provider === 'kloel' && s.provider === 'kloel' && s.eventTypeId === target.eventTypeId)).map(({ engineBookingActions: _a, engineCalendly: _c, ...row }) => row as SchedulingAction)
          if (target?.provider === 'kloel') {
            const selected = eventTypes.find(event => event.id === target.eventTypeId)
            if (selected) await bindEventToAgent(selected, agent.id, false)
          }
          // Registros antigos (Google/Microsoft/Cal.com/eTermin) só existem no estado do assistente: removê-los basta.
          await saveAgent(useStore.getState().db.agents.find(a => a.id === agent.id) ?? current, () => ({ scheduling: rest }))
          await loadAgentScheduling(agent.id)
          toast.success('Agendamento excluído.')
          onDone()
        }}
      />
    </SideSheet>
  )
}
