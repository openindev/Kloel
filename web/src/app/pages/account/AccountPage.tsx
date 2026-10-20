import { useEffect, useMemo, useState } from 'react'
import { ChevronsUpDown, CirclePlus, Eye, EyeOff, Check, Unplug } from 'lucide-react'
import { toast } from 'sonner'
import '@/domain/ext/mais-b'
import type { CalendarConnection } from '@/domain/types'
import { useCollection, useCurrentOrg, useCurrentUser, useStore } from '@/data/store'
import { UI_LANGUAGES } from '@/data/catalogs/languages'
import { PageTitle } from '@/components/app/Page'
import { PhoneInput } from '@/components/app/PhoneInput'
import { ConfirmDialog } from '@/components/app/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { GoogleIcon, MicrosoftIcon } from '@/components/brand/icons'
import { cn } from '@/lib/utils'
import { ProviderIcon, featureLabel, removeConnection, connectionImpact } from '@/app/pages/company-settings/connections'
import { ConnectCalendarFlow } from '@/app/pages/agents/resources/shared/ConnectCalendarFlow'
import { phoneError, normalizePhone } from '@/app/pages/users/validation'
import { TZ_GROUPS } from './timezones'
import { captureEngineContext, engineSession, useEngineSession } from '@/services/engine/session'
import { createProfileCommands, saveOrganizationTimezone } from '@/services/casca/profile'
import { passwordCommands } from '@/services/casca/password';

const card = 'bg-white rounded-xl border shadow px-4 py-6 sm:px-8 sm:py-8'

/* ------------------------------- Perfil ------------------------------- */

function ProfileCard() {
  const user = useCurrentUser()
  const session = useEngineSession()
  const commands = useMemo(() => session.data?.profile ? createProfileCommands(captureEngineContext(), session.data.profile) : undefined, [session.generation])
  const [busy, setBusy] = useState(false)
  const [f, setF] = useState({ firstName: '', lastName: '', language: 'pt-BR', phone: '+55' })
  const [submitted, setSubmitted] = useState(false)
  useEffect(() => {
    if (user) setF({ firstName: user.firstName, lastName: user.lastName, language: user.language || 'pt-BR', phone: user.phone || '+55' })
  }, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const errs = {
    firstName: !f.firstName.trim() ? 'Informe seu nome.' : f.firstName.trim().length > 60 ? 'Máximo de 60 caracteres.' : null,
    lastName: f.lastName.trim().length > 60 ? 'Máximo de 60 caracteres.' : null,
    phone: phoneError(f.phone),
  }
  const invalid = Object.values(errs).some(Boolean)
  return (
    <div className={card}>
      {/* Fonio (fonio-live2/K-admin/30): rótulos em inglês no original — Profile, First name, Last name, Phone number. */}
      <div className="mb-8 font-semibold">Profile</div>
      <form
        className="space-y-6"
        onSubmit={async (e) => {
          e.preventDefault()
          setSubmitted(true)
          if (invalid || busy || !commands) return
          const phone = normalizePhone(f.phone)
          setBusy(true)
          try {
            await commands.save({ firstName: f.firstName.trim(), lastName: f.lastName.trim(), language: f.language, phone: phone || null })
            toast.success('Perfil salvo')
            setSubmitted(false)
            await engineSession.refresh()
          } catch (error) { toast.error(error instanceof Error ? error.message : 'Não foi possível salvar o perfil.') }
          finally { setBusy(false) }
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5 pt-0.5">
            <Label htmlFor="acc-first" className={cn('leading-5', submitted && errs.firstName && 'text-destructive')}>First name</Label>
            <Input id="acc-first" value={f.firstName} onChange={(e) => setF({ ...f, firstName: e.target.value })} aria-invalid={submitted && !!errs.firstName} />
            {submitted && errs.firstName && <p className="text-sm font-medium text-destructive">{errs.firstName}</p>}
          </div>
          <div className="grid gap-1.5 pt-0.5">
            <Label htmlFor="acc-last" className="leading-5">Last name</Label>
            <Input id="acc-last" value={f.lastName} onChange={(e) => setF({ ...f, lastName: e.target.value })} aria-invalid={submitted && !!errs.lastName} />
            {submitted && errs.lastName && <p className="text-sm font-medium text-destructive">{errs.lastName}</p>}
          </div>
        </div>
        <div className="grid gap-1.5 pt-0.5">
          <Label className="leading-5">Idioma</Label>
          <Select value={f.language} onValueChange={(v) => setF({ ...f, language: v })}>
            {/* Fonio (K-admin/34): o campo e a lista mostram só os códigos (en, en-US … es). */}
            <SelectTrigger aria-label="Idioma"><SelectValue>{f.language}</SelectValue></SelectTrigger>
            <SelectContent>
              {UI_LANGUAGES.map((l) => (
                <SelectItem key={l} value={l}>{l}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5 pt-0.5">
          <Label htmlFor="acc-phone" className={cn('leading-5', submitted && errs.phone && 'text-destructive')}>Phone number</Label>
          <PhoneInput id="acc-phone" value={f.phone} onChange={(v) => setF({ ...f, phone: v })} invalid={submitted && !!errs.phone} />
          {submitted && errs.phone && <p className="text-sm font-medium text-destructive">{errs.phone}</p>}
        </div>
        <Button type="submit" disabled={busy}>Salvar</Button>
      </form>
    </div>
  )
}

/* -------------------------- Conexão de conta -------------------------- */

function AccountConnectionCard() {
  const me = useCurrentUser()
  const all = useCollection('calendarConnections')
  const mine = useMemo(() => all.filter((c) => c.scope === 'personal' && c.ownerUserId === me?.id), [all, me?.id])
  const [open, setOpen] = useState(false)
  const [toRemove, setToRemove] = useState<CalendarConnection | null>(null)
  const impact = toRemove ? connectionImpact(toRemove.id) : null
  // "Conectar um calendário agora." (folha Transferir ligações, refs. 499/509) abre esta página em #conexao-de-conta
  useEffect(() => {
    if (window.location.hash !== '#conexao-de-conta') return
    const t = setTimeout(() => document.getElementById('conexao-de-conta')?.scrollIntoView({ block: 'start' }), 50)
    return () => clearTimeout(t)
  }, [])
  return (
    <div id="conexao-de-conta" className={cn(card, 'mt-8 scroll-mt-6')}>
      <div className="mb-8 font-semibold">Conexão de conta</div>
      {mine.length === 0 ? (
        <div className="flex flex-col items-center gap-4 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center"><GoogleIcon className="h-10 w-10" /></span>
            <span className="flex h-10 w-10 items-center justify-center"><MicrosoftIcon className="h-10 w-10" /></span>
          </div>
          <p className="max-w-sm text-center text-sm text-muted-foreground">Conecte sua conta do Google ou Microsoft para começar.</p>
          <Button onClick={() => setOpen(true)} className="gap-2"><CirclePlus className="size-4" /> Conectar conta</Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <ul className="divide-y rounded-lg border">
            {mine.map((c) => (
              <li key={c.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                <ProviderIcon provider={c.provider} className="size-6 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{c.email}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    {c.features.map((f) => <Badge key={f} variant="outline" className="font-medium">{featureLabel(f)}</Badge>)}
                    <span className="text-xs text-muted-foreground">Conectada em {new Date(c.connectedAt).toLocaleDateString('pt-BR')}</span>
                  </div>
                </div>
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setToRemove(c)}><Unplug className="h-4 w-4" /> Desconectar</Button>
              </li>
            ))}
          </ul>
          <Button variant="outline" className="w-fit gap-2" onClick={() => setOpen(true)}><CirclePlus className="size-4" /> Conectar outra conta</Button>
        </div>
      )}
      {/* refs. 500–502: "Para quem é esta conexão?" (Pessoal | Compartilhada) → "Como você quer usar esta conta?" */}
      <ConnectCalendarFlow open={open} onOpenChange={setOpen} />
      <ConfirmDialog
        open={!!toRemove}
        onOpenChange={(o) => !o && setToRemove(null)}
        title="Desconectar conta?"
        description={toRemove ? <>A conta <b>{toRemove.email}</b> será desconectada.{impact && impact.inboxes.length > 0 && <> A caixa de entrada do E-Mail IA ligada a ela também será removida.</>}</> : null}
        confirmLabel="Desconectar"
        onConfirm={async () => {
          if (!toRemove) return
          await removeConnection(toRemove.id)
          toast.success('Conta desconectada', { description: toRemove.email })
        }}
      />
    </div>
  )
}

/* ---------------------------- Alterar senha ---------------------------- */

function PasswordField({ id, label, value, onChange, placeholder, error }: { id: string; label: string; value: string; onChange: (v: string) => void; placeholder: string; error?: string | null }) {
  const [show, setShow] = useState(false)
  return (
    <div className="grid gap-1.5 pt-0.5">
      <Label htmlFor={id} className={cn('leading-5', error && 'text-destructive')}>{label}</Label>
      <div className="relative">
        <Input id={id} type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="pr-10" aria-invalid={!!error} autoComplete={id === 'pw-current' ? 'current-password' : 'new-password'} />
        <Button type="button" variant="ghost" className="absolute right-0 top-0 h-10 w-10 p-0 text-muted-foreground hover:bg-transparent" aria-label={show ? 'Ocultar senha' : 'Mostrar senha'} onClick={() => setShow((s) => !s)}>
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </Button>
      </div>
      {error && <p className="text-sm font-medium text-destructive">{error}</p>}
    </div>
  )
}

function PasswordCard() {
  const commands = useMemo(() => passwordCommands(), [])
  const [busy, setBusy] = useState(false)
  const [f, setF] = useState({ current: '', next: '', confirm: '' })
  const [submitted, setSubmitted] = useState(false)
  const errs = {
    current: !f.current ? 'Informe sua senha atual.' : null,
    next: f.next.length < 12 || f.next.length > 128 ? 'A nova senha precisa ter de 12 a 128 caracteres.' : f.next === f.current ? 'A nova senha deve ser diferente da atual.' : null,
    confirm: f.confirm !== f.next ? 'As senhas não coincidem.' : null,
  }
  const show = (k: keyof typeof errs) => (submitted ? errs[k] : null)
  return (
    <div className={cn(card, 'mt-8')}>
      <div className="mb-8 font-semibold">Alterar senha</div>
      <form
        className="space-y-8"
        onSubmit={async (e) => {
          e.preventDefault()
          setSubmitted(true)
          if (Object.values(errs).some(Boolean) || busy) return
          setBusy(true)
          try {
            await commands.save(f.current, f.next, f.confirm)
            setF({ current: '', next: '', confirm: '' }); setSubmitted(false)
            toast.success('Senha alterada', { description: 'Use a nova senha no próximo login.' })
          } catch (error) { toast.error(error instanceof Error ? error.message : 'Não foi possível alterar a senha.') }
          finally { setBusy(false) }
        }}
      >
        <PasswordField id="pw-current" label="Senha atual" placeholder="Senha atual" value={f.current} onChange={(v) => setF({ ...f, current: v })} error={show('current')} />
        <PasswordField id="pw-new" label="Nova senha" placeholder="Senha" value={f.next} onChange={(v) => setF({ ...f, next: v })} error={show('next')} />
        <PasswordField id="pw-confirm" label="Confirmar senha" placeholder="Senha" value={f.confirm} onChange={(v) => setF({ ...f, confirm: v })} error={show('confirm')} />
        <Button type="submit" disabled={busy}>Salvar</Button>
      </form>
    </div>
  )
}

/* -------------------------- Company timezone -------------------------- */

function tzOffset(tz: string, d: Date) {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(d).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT'
  } catch {
    return 'GMT'
  }
}
/** Nome exibido do fuso (Fonio: último segmento do identificador IANA, sem acento — "Sao Paulo", "Kiev", "Calcutta"). */
const tzCity = (tz: string) => (tz.split('/').pop() ?? tz).replace(/_/g, ' ')
/** Rótulo do gatilho: "Sao Paulo (GMT-3) — 01:35" (K-admin/32). */
export function tzLabel(tz: string, d = new Date()) {
  let time = ''
  try {
    time = d.toLocaleTimeString('pt-BR', { timeZone: tz, hour: '2-digit', minute: '2-digit' })
  } catch {
    time = ''
  }
  return `${tzCity(tz)} (${tzOffset(tz, d)})${time ? ` — ${time}` : ''}`
}
function detectedTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo'
  } catch {
    return 'America/Sao_Paulo'
  }
}

function useNow(ms = 15000) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

/**
 * "Company timezone" (K-admin/32–33 · data/timezones.json): Popover + cmdk com a busca "Pesquisar fuso horário...", o grupo
 * "Fuso horário detectado" (fuso do navegador) e Europe/America/Asia/Australia/Pacific/Africa/Atlantic/Indian/Antarctica;
 * cada item em 2 linhas (cidade + GMT±h) com check no selecionado. Salvar fica sempre habilitado, como na Fonio.
 */
function TimezoneCard() {
  const org = useCurrentOrg()
  const [busy, setBusy] = useState(false)
  const [tz, setTz] = useState(org?.timezone ?? 'America/Sao_Paulo')
  const [open, setOpen] = useState(false)
  useEffect(() => setTz(org?.timezone ?? 'America/Sao_Paulo'), [org?.timezone])
  const now = useNow()
  const detected = useMemo(() => detectedTimezone(), [])
  const groups = useMemo(() => [{ heading: 'Fuso horário detectado', zones: [detected] }, ...TZ_GROUPS], [detected])
  return (
    <div className={cn(card, 'mt-8')}>
      <div className="mb-8 font-semibold">Company timezone</div>
      <div className="max-w-md space-y-6">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" role="combobox" aria-expanded={open} aria-label="Company timezone" className="h-10 w-full justify-between px-4">
              <span className="truncate" data-testid="tz-value">{tzLabel(tz, now)}</span>
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
            <Command filter={tzFilter}>
              <CommandInput placeholder="Pesquisar fuso horário..." />
              <CommandList className="max-h-[300px]">
                <CommandEmpty>Nenhum fuso horário encontrado.</CommandEmpty>
                {open &&
                  groups.map((g) => (
                    <CommandGroup key={g.heading} heading={g.heading}>
                      {g.zones.map((z) => (
                        <CommandItem
                          key={`${g.heading}:${z}`}
                          value={`${g.heading}:${z}`}
                          keywords={[tzCity(z), z.replace(/_/g, ' '), tzOffset(z, now)]}
                          onSelect={() => {
                            setTz(z)
                            setOpen(false)
                          }}
                        >
                          <div className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate text-sm">{tzCity(z)}</span>
                            <span className="text-xs text-muted-foreground">{tzOffset(z, now)}</span>
                          </div>
                          <Check className={cn('ml-auto h-4 w-4', z === tz ? 'opacity-100' : 'opacity-0')} />
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  ))}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        <Button
          disabled={busy}
          onClick={async () => {
            if (busy) return
            setBusy(true)
            try {
              const saved = await saveOrganizationTimezone(tz)
              toast.success('Fuso horário salvo', { description: tzLabel(saved) })
            } catch (error) { toast.error(error instanceof Error ? error.message : 'Não foi possível salvar o fuso horário.') }
            finally { setBusy(false) }
          }}
        >
          Salvar
        </Button>
      </div>
    </div>
  )
}

/** Busca sem distinção de acentos e maiúsculas, nos nomes da cidade/identificador/deslocamento (não no grupo). */
const foldText = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
function tzFilter(_value: string, search: string, keywords?: string[]) {
  const terms = foldText(search).split(/\s+/).filter(Boolean)
  const hay = foldText((keywords ?? []).join(' '))
  return terms.every((t) => hay.includes(t)) ? 1 : 0
}

export default function AccountPage() {
  const session = useEngineSession()
  return (
    <div key={session.generation} className="pt-10 lg:pt-20 pb-8 px-4 sm:px-8">
      <PageTitle className="mb-4 md:mb-8">Conta</PageTitle>
      <ProfileCard />
      <AccountConnectionCard />
      <PasswordCard />
      <TimezoneCard />
    </div>
  )
}
