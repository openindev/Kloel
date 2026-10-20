import { Link } from 'react-router-dom'
import { useMemo, useState, type ReactNode } from 'react'
import { ChevronDown, User } from 'lucide-react'
import { toast } from 'sonner'
import '@/domain/ext/agents-resources'
import type { Agent, TransferTarget } from '@/domain/types'
import type { ActiveWindow } from '@/domain/ext/agents-resources'
import { cn, uid } from '@/lib/utils'
import { useCollection, useDB } from '@/data/store'
import { SideSheet } from '@/components/app/SideSheet'
import { ConfirmDialog } from '@/components/app/ConfirmDialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { AddRow, DeleteFooterButton, FieldError, HelpIcon, ListCard, ListRow, Pill, SectionCaps, SheetFooter, SheetSegmented, WarningBox, digits, isEmail } from './shared/ui'
import { WindowControl } from './shared/timing'
import { saveAgent, upsert, useErrors, useHoursDraft } from './shared/hooks'
import { useListView, type ResourceProps } from './shared/listView'
import { CountryPhoneInput } from './shared/CountryPhoneInput'

type Mode = TransferTarget['mode']

/** Segmentado "Transferir para" da Fonio (fonio-live2 C-31/33/35): Número de telefone | Membro da equipe | SIP. */
const MODE_LABEL: Record<Mode, string> = { phone: 'Número de telefone', member: 'Membro da equipe', sip: 'SIP' }

function useMembers() {
  const memberships = useDB((db) => db.memberships)
  const users = useDB((db) => db.users)
  const orgId = useDB((db) => db.session.orgId)
  return useMemo(
    () =>
      memberships
        .filter((m) => m.orgId === orgId)
        .map((m) => users.find((u) => u.id === m.userId))
        .filter((u): u is NonNullable<typeof u> => !!u)
        .map((u) => ({ id: u.id, name: `${u.firstName} ${u.lastName}`.trim(), firstName: u.firstName, phone: u.phone?.trim() ?? '' })),
    [memberships, users, orgId],
  )
}

/**
 * URI SIP com destino roteável (C-35, "sip: demo.sip.com"): prefixo sip:/sips: opcional, usuário opcional ("ramal@") e host
 * obrigatório — domínio com TLD ou IPv4 —, porta e parâmetros opcionais.
 */
function isSipUri(v: string) {
  return /^(?:sips?:\s*)?(?:[\w.+\-!~*'()&=$,;?/%]+@)?(?:(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}|\d{1,3}(?:\.\d{1,3}){3})(?::\d{1,5})?(?:;[\w=.\-]+)*$/i.test(v.trim())
}

export function TransferResource({ agent, open, onOpenChange }: ResourceProps) {
  const lv = useListView(agent.transfers.length > 0, () => onOpenChange(false), (id) => agent.transfers.some((t) => t.id === id))
  const view = lv.view
  if (view.mode === 'list')
    return (
      // Lista das transferências salvas (INFERIDO: a conta ao vivo não tinha nenhuma; sem itens a folha abre direto o formulário, C-31)
      <SideSheet open={open} onOpenChange={onOpenChange} title="Transferir ligações" hideFooter contentClassName="pt-0">
        <ListCard>
          {agent.transfers.map((t) => (
            <ListRow
              key={t.id}
              testId={`transfer-row-${t.id}`}
              title={t.label}
              subtitle={`${MODE_LABEL[t.mode]}${t.destination ? ` · ${t.destination}` : ''}`}
              pills={t.activeWindow && t.activeWindow !== 'any' ? <Pill tone="muted">{t.activeWindow === 'during' ? 'Durante o horário de funcionamento' : 'Fora do horário de funcionamento'}</Pill> : undefined}
              onClick={() => lv.edit(t.id)}
            />
          ))}
          <AddRow onClick={() => lv.add()}>Adicionar transferência</AddRow>
        </ListCard>
      </SideSheet>
    )
  const target = view.id ? agent.transfers.find((t) => t.id === view.id) : undefined
  return <TransferEditor key={view.seq} agent={agent} target={target} fromList={view.fromList} open={open} onOpenChange={onOpenChange} onDone={lv.done} />
}

type ErrKey = 'destination' | 'description' | 'failureEmail' | 'calendar' | 'window' | 'name'

/**
 * Formulário de transferência (fonio-live2 C-assistentes/31–37 + data/resources.json): o título é um campo
 * ("Transferir para vendas"; vazio ao sair → borda vermelha e "O nome é obrigatório"), segmentado Número/Membro/SIP, telefone com
 * os 33 países, "Transferir quando", "Ativo" e "OPÇÕES" com 2 switches + dicas. Rodapé só com "Salvar" (fechar pelo ×).
 * Avisos/campos abertos pelos switches seguem as capturas originais do operador ("Ordem Funil", Transferir ligações).
 */
function TransferEditor({ agent, target, fromList, open, onOpenChange, onDone }: { agent: Agent; target?: TransferTarget; fromList: boolean; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const members = useMembers()
  const allCalendars = useCollection('calendarConnections')
  const calendars = useMemo(() => allCalendars.filter((c) => c.features.includes('calendar')), [allCalendars])
  const hours = useHoursDraft(agent)
  const { errors, setErrors, clear } = useErrors<ErrKey>()

  const [label, setLabel] = useState(target?.label ?? '')
  const [mode, setMode] = useState<Mode>(target?.mode ?? 'phone')
  const [phone, setPhone] = useState(target?.mode === 'phone' ? target.destination : '+55')
  const [sip, setSip] = useState(target?.mode === 'sip' ? target.destination.replace(/^sips?:\s*/i, '') : '')
  const [memberId, setMemberId] = useState(target?.memberId)
  const [description, setDescription] = useState(target?.description ?? '')
  const [win, setWin] = useState<ActiveWindow>(target?.activeWindow ?? 'any')
  const [checkAvailability, setCheck] = useState(target?.checkAvailability ?? false)
  const [calendarId, setCalendarId] = useState<string | undefined>(target?.calendarConnectionId ?? calendars[0]?.id)
  const [emailOnFailure, setEmailOnFailure] = useState(target?.emailOnFailure ?? false)
  const [failureEmail, setFailureEmail] = useState(target?.failureEmail ?? '')
  const member = members.find((m) => m.id === memberId)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const memberCalendar = useDB((db) => (memberId ? db.calendarConnections.find((c) => c.orgId === db.session.orgId && c.ownerUserId === memberId && c.scope === 'personal' && c.features.includes('calendar')) : undefined))

  const save = async () => {
    try {
    const e: Partial<Record<ErrKey, string>> = {}
    let destination = ''
    if (!label.trim()) e.name = 'O nome é obrigatório'
    if (mode === 'phone') {
      destination = phone.trim()
      if (digits(phone).length < 10 || digits(phone).length > 15) e.destination = 'Informe um número de telefone válido, com DDI e DDD (ex.: +55 11 90000-0100).'
    } else if (mode === 'sip') {
      destination = sip.trim() ? `sip:${sip.trim().replace(/^sips?:\s*/i, '')}` : ''
      if (!sip.trim()) e.destination = 'Informe o endereço SIP de destino.'
      else if (!isSipUri(sip)) e.destination = 'Endereço SIP inválido. Use o formato ramal@dominio.com.'
    } else {
      if (!member) e.destination = 'Selecione um membro da equipe.'
      else if (!member.phone) e.destination = 'Este membro não tem número de telefone cadastrado.'
      destination = member?.phone ?? ''
    }
    if (!description.trim()) e.description = 'Descreva quando a ligação deve ser transferida.'
    if (mode !== 'member' && checkAvailability && calendars.length && !calendarId) e.calendar = 'Selecione o calendário usado para verificar a disponibilidade.'
    if (mode !== 'member' && emailOnFailure) {
      if (!failureEmail.trim()) e.failureEmail = 'Informe um endereço de e-mail para receber notificações.'
      else if (!isEmail(failureEmail)) e.failureEmail = 'Informe um endereço de e-mail válido.'
    }
    if (win !== 'any' && !hours.configured) e.window = 'Configure o horário de funcionamento para usar esta opção.'
    setErrors(e)
    if (Object.values(e).some(Boolean)) {
      toast.error('Corrija os campos destacados.')
      return
    }
    const next: TransferTarget = {
      ...(target ?? { whisper: '' }),
      id: target?.id ?? uid('trf'),
      mode,
      // destino PBX/atraso de versões anteriores deixam de existir (a Fonio não tem essas opções)
      pbxNumberId: undefined,
      failureDelaySec: undefined,
      label: label.trim(),
      destination,
      memberId: mode === 'member' ? memberId : undefined,
      description: description.trim(),
      checkAvailability,
      calendarConnectionId: checkAvailability && mode !== 'member' ? calendarId : undefined,
      emailOnFailure,
      failureEmail: emailOnFailure && mode !== 'member' ? failureEmail.trim() : undefined,
      activeWindow: win,
    }
    await saveAgent(agent, (a) => ({ transfers: upsert(a.transfers, next), ...(hours.changed ? { businessHours: hours.hours } : {}) }))
    toast.success(target ? 'Transferência atualizada.' : 'Transferência adicionada.')
    onDone()
      } catch (error) { toast.error('Não foi possível salvar', { description: error instanceof Error ? error.message : 'Confira o acesso e tente novamente.' }) }
  }

  return (
    <SideSheet
      open={open}
      onOpenChange={onOpenChange}
      title={
        <>
          <span className="sr-only">{label || 'Transferir ligações'}</span>
          <TransferNameInput
            value={label}
            autoFocus={!target}
            onChange={(v) => {
              setLabel(v)
              if (v.trim()) clear('name')
            }}
            onBlur={() => afterPointerUp(() => setErrors((e) => ({ ...e, name: label.trim() ? undefined : 'O nome é obrigatório' })))}
            error={errors.name}
          />
        </>
      }
      footer={
        // C-31: o formulário tem só "Salvar" (fechar pelo ×); aberto a partir da lista, "Cancelar" volta para ela.
        <SheetFooter onSave={save} onCancel={onDone} hideCancel={!fromList} left={target && <DeleteFooterButton onClick={() => setConfirmDelete(true)} />} />
      }
      contentClassName="pb-0"
    >
      <div className="flex flex-col" data-testid="transfer-editor">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <span className="text-sm font-medium">Transferir para</span>
          <SheetSegmented<Mode>
            fullOnMobile
            ariaLabel="Transferir para"
            value={mode}
            onChange={(m) => {
              setMode(m)
              clear('destination')
            }}
            options={(['phone', 'member', 'sip'] as Mode[]).map((m) => ({ value: m, label: MODE_LABEL[m] }))}
          />
        </div>
        <div className={cn('flex flex-col gap-2', mode === 'member' ? 'mt-5' : 'mt-4')}>
          {mode === 'phone' && (
            <CountryPhoneInput
              id="transfer-phone"
              value={phone}
              onChange={(v) => {
                setPhone(v)
                clear('destination')
              }}
              invalid={!!errors.destination}
            />
          )}
          {/* C-33: no modo membro o seletor fica 4px abaixo da posição do campo de telefone */}
          {mode === 'member' && <MemberCombobox members={members} value={memberId} onChange={(id) => (setMemberId(id), clear('destination'))} invalid={!!errors.destination} />}
          {mode === 'sip' && (
            <label
              className={cn(
                'flex h-10 w-full items-center rounded-md border border-input bg-background px-3 text-sm focus-within:ring-1 focus-within:ring-ring',
                errors.destination && 'border-destructive',
              )}
            >
              <span className="sr-only">URL SIP</span>
              <span className="shrink-0 text-muted-foreground">sip:</span>
              <input
                id="transfer-sip"
                aria-label="URL SIP"
                value={sip}
                onChange={(e) => {
                  setSip(e.target.value)
                  clear('destination')
                }}
                placeholder="demo.sip.com"
                aria-invalid={!!errors.destination || undefined}
                className="h-full min-w-0 flex-1 bg-transparent pl-1 outline-none placeholder:text-muted-foreground"
              />
            </label>
          )}
          <FieldError>{errors.destination}</FieldError>
        </div>

        {/* Fonio ao vivo (C-assistentes/31, live-compare 12) e "Ordem Funil" Transferir 1/2/3 a 2x: rótulo 38px abaixo do campo de destino
            nos três modos — no modo membro o seletor desce 4px e o resto do formulário desce junto */}
        <div className="mt-[38px] flex flex-col gap-2">
          <label htmlFor="transfer-when" className="text-sm font-medium leading-none">
            Transferir quando
          </label>
          <Textarea
            id="transfer-when"
            value={description}
            onChange={(e) => {
              setDescription(e.target.value)
              clear('description')
            }}
            placeholder="o chamador pede o setor de vendas"
            aria-invalid={!!errors.description || undefined}
            className="min-h-[108px] resize-y"
          />
          <FieldError>{errors.description}</FieldError>
        </div>

        {/* idem: "Ativo" 22px abaixo do textarea (select em y=428 na captura ao vivo de 1355×661) */}
        <div className="mt-[22px] flex flex-col gap-2">
          <label htmlFor="transfer-window" className="text-sm font-medium leading-none">
            Ativo
          </label>
          <WindowControl id="transfer-window" value={win} onChange={(v) => (setWin(v), clear('window'))} hoursConfigured={hours.configured} onConfigure={hours.openSheet} />
          <FieldError>{errors.window}</FieldError>
        </div>

        <SectionCaps className="mt-6">Opções</SectionCaps>

        <div className="mt-4 flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <OptionRow label="Verificar disponibilidade" help="Transfere apenas se a agenda estiver livre.">
              <Switch aria-label="Verificar disponibilidade" checked={checkAvailability} onCheckedChange={(v) => (setCheck(v), clear('calendar'))} />
            </OptionRow>
            {checkAvailability && mode === 'member' && !memberCalendar && <WarningBox>Este membro da equipe ainda não conectou um calendário.</WarningBox>}
            {checkAvailability && mode === 'member' && memberCalendar && <p className="text-xs text-muted-foreground">{memberCalendar.email}</p>}
            {checkAvailability && mode !== 'member' && calendars.length === 0 && (
              <WarningBox>
                Nenhum calendário conectado.{' '}
                {/* "Ordem Funil" › Conectar Calendario: o link leva à página Conta (seção "Conexão de conta"); Voltar reabre a folha (?recurso=) */}
                <Link to="/app/account#conexao-de-conta" className="text-foreground underline underline-offset-2">
                  Conectar um calendário agora.
                </Link>
              </WarningBox>
            )}
            {checkAvailability && mode !== 'member' && calendars.length > 0 && (
              <div className="flex flex-col gap-2">
                <Select value={calendarId ?? ''} onValueChange={(v) => (setCalendarId(v), clear('calendar'))}>
                  <SelectTrigger aria-label="Calendário" aria-invalid={!!errors.calendar || undefined}>
                    <span className="flex min-w-0 items-center gap-2">
                      <User className="size-4 shrink-0 text-muted-foreground" />
                      <SelectValue placeholder="Selecionar..." />
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    {calendars.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError>{errors.calendar}</FieldError>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <OptionRow label="E-mail em caso de falha" help="Envia um resumo da conversa quando a transferência não é concluída.">
              <Switch aria-label="E-mail em caso de falha" checked={emailOnFailure} onCheckedChange={(v) => (setEmailOnFailure(v), clear('failureEmail'))} />
            </OptionRow>
            {emailOnFailure && mode !== 'member' && (
              <div className="mt-3 flex flex-col gap-1">
                <Input
                  aria-label="E-mail para notificações"
                  type="email"
                  value={failureEmail}
                  onChange={(e) => (setFailureEmail(e.target.value), clear('failureEmail'))}
                  placeholder="ex. alice@empresa.com"
                  aria-invalid={!!errors.failureEmail || undefined}
                  className={cn(errors.failureEmail && 'placeholder:text-destructive/50')}
                />
                <FieldError>{errors.failureEmail}</FieldError>
              </div>
            )}
          </div>
        </div>
      </div>
      {hours.sheet}
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Excluir transferência?"
        description={`"${label || 'Transferência'}" deixará de ser usada pelo assistente ${agent.name}.`}
        confirmLabel="Excluir"
        onConfirm={async () => {
          await saveAgent(agent, (a) => ({ transfers: a.transfers.filter((t) => t.id !== target?.id) }))
          toast.success('Transferência excluída.')
          onDone()
        }}
      />
    </SideSheet>
  )
}

/**
 * O erro do nome aparece ao sair do campo (C-32) e empurra o formulário 20px para baixo. Se a saída foi um clique em outro
 * controle, o erro só é mostrado depois que o clique termina — senão o deslocamento faria o clique cair fora do botão.
 */
let pointerIsDown = false
if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', () => (pointerIsDown = true), true)
  document.addEventListener('pointerup', () => (pointerIsDown = false), true)
  document.addEventListener('pointercancel', () => (pointerIsDown = false), true)
}
function afterPointerUp(fn: () => void) {
  if (!pointerIsDown) return fn()
  window.addEventListener('pointerup', () => setTimeout(fn, 0), { once: true })
}

/** Linha "rótulo (?) + switch" da seção OPÇÕES (C-37): linhas de 32px a cada 48px. */
function OptionRow({ label, help, children }: { label: string; help: string; children: ReactNode }) {
  return (
    <div className="flex min-h-8 items-center justify-between gap-4">
      <div className="flex items-center gap-1.5 text-sm font-medium leading-none">
        {label}
        <HelpIcon label={help} />
      </div>
      {children}
    </div>
  )
}

/** Título-campo (C-31/32): h-9, até 448px, texto 18px semibold; vazio ao sair → borda vermelha e "O nome é obrigatório". */
function TransferNameInput({ value, onChange, onBlur, error, autoFocus }: { value: string; onChange: (v: string) => void; onBlur: () => void; error?: string; autoFocus?: boolean }) {
  return (
    <span className="flex max-w-md flex-col gap-1">
      <input
        aria-label="Nome da transferência"
        aria-invalid={!!error || undefined}
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            ;(e.target as HTMLInputElement).blur()
          }
        }}
        placeholder="Transferir para vendas"
        className={cn(
          'h-9 w-full rounded-md border border-input bg-background px-3 text-lg font-semibold leading-7 outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring',
          error && 'border-destructive placeholder:text-destructive/60 focus-visible:ring-destructive',
        )}
      />
      {error && <span className="text-sm font-normal leading-5 text-destructive">{error}</span>}
    </span>
  )
}

function MemberCombobox({ members, value, onChange, invalid }: { members: { id: string; name: string; phone: string }[]; value?: string; onChange: (id: string) => void; invalid?: boolean }) {
  const [open, setOpen] = useState(false)
  const current = members.find((m) => m.id === value)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-label="Selecionar um membro"
          aria-invalid={invalid || undefined}
          className={cn(
            'flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring aria-[invalid=true]:border-destructive',
            !current && 'text-muted-foreground',
          )}
        >
          <span className="truncate">{current ? current.name : 'Selecionar um membro'}</span>
          <ChevronDown className="size-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0">
        <Command>
          <CommandInput placeholder="Pesquisar..." />
          <CommandList>
            <CommandEmpty>Nenhum resultado encontrado.</CommandEmpty>
            <CommandGroup>
              {members.map((m) => (
                <CommandItem
                  key={m.id}
                  value={m.name}
                  disabled={!m.phone}
                  onSelect={() => {
                    onChange(m.id)
                    setOpen(false)
                  }}
                >
                  {/* C-34: membro sem telefone desabilitado, com "(número ausente)" em cinza */}
                  <span>{m.name}</span>
                  {!m.phone && <span className="text-xs text-muted-foreground">(número ausente)</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
