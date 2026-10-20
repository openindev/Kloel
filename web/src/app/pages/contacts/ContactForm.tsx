import { useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { usePrivatePortalContainer } from '@/components/app/PrivatePortal'
import { Link } from 'react-router-dom'
import { ArrowLeft, Check, ChevronsUpDown, Info, Plus, Sparkles, X } from 'lucide-react'
import type { Contact, Conversation, SmartFieldDef } from '@/domain/types'
import '@/domain/ext/inbox-contacts'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SimpleTooltip } from '@/components/ui/tooltip'
import { PhoneInput } from '@/components/app/PhoneInput'
import { DarkBarButton, DarkBarPrimary } from '@/components/app/ActionBar'
import { phoneKey } from '../inbox/shared'
import { EMAIL_RE, FIELD_TYPE_LABEL, LABEL_OPTIONS, displayName, isBlankPhone, isFieldValueCompatible, isValidPhone, parseNumberBR, type PhoneLabel } from './lib'

export interface ContactDraft {
  firstName: string
  lastName: string
  phones: { value: string; label: PhoneLabel }[]
  emails: { value: string; label: PhoneLabel }[]
  company: string
  ownerId: string
  notes: string
  fields: Record<string, string>
}

export function draftFrom(c?: Contact, prefillPhone?: string): ContactDraft {
  if (!c)
    return { firstName: '', lastName: '', phones: [{ value: prefillPhone || '+55', label: '' }], emails: [{ value: '', label: '' }], company: '', ownerId: '', notes: '', fields: {} }
  return {
    firstName: c.firstName,
    lastName: c.lastName,
    phones: c.phones.length ? c.phones.map((p) => ({ ...p })) : [{ value: '+55', label: '' }],
    emails: c.emails.length ? c.emails.map((e) => ({ ...e })) : [{ value: '', label: '' }],
    company: c.company,
    ownerId: c.ownerId ?? '',
    notes: c.notes,
    fields: { ...c.fields },
  }
}

/** Forma canônica (para comparar alterações e salvar). */
export function cleanDraft(d: ContactDraft) {
  return {
    firstName: d.firstName.trim(),
    lastName: d.lastName.trim(),
    phones: d.phones.filter((p) => !isBlankPhone(p.value)).map((p) => ({ value: p.value.trim(), label: p.label })),
    emails: d.emails.filter((e) => e.value.trim()).map((e) => ({ value: e.value.trim(), label: e.label })),
    company: d.company.trim(),
    ownerId: d.ownerId || undefined,
    notes: d.notes.trim(),
    fields: Object.fromEntries(Object.entries(d.fields).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v !== '')),
  }
}

const LBL = 'text-xs font-normal tracking-[0.01em]'

function LabelSelect({ value, onChange }: { value: PhoneLabel; onChange: (v: PhoneLabel) => void }) {
  return (
    <Select value={value || 'NONE'} onValueChange={(v) => onChange((v === 'NONE' ? '' : v) as PhoneLabel)}>
      <SelectTrigger aria-label="Rótulo" className="w-32 shrink-0">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {LABEL_OPTIONS.map((o) => (
          <SelectItem key={o.value || 'NONE'} value={o.value || 'NONE'}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function CompanyCombobox({ value, onChange, companies }: { value: string; onChange: (v: string) => void; companies: string[] }) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLDivElement>(null)
  const q = value.trim().toLowerCase()
  const matches = companies.filter((c) => !q || c.toLowerCase().includes(q)).slice(0, 8)
  const exact = companies.some((c) => c.toLowerCase() === q)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div ref={anchorRef} className="relative">
          <Input
            id="contact-company"
            role="combobox"
            aria-expanded={open}
            aria-autocomplete="list"
            autoComplete="off"
            placeholder="Buscar ou adicionar uma empresa"
            value={value}
            onChange={(e) => {
              onChange(e.target.value)
              setOpen(true)
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false)
              if (e.key === 'Enter') {
                e.preventDefault()
                setOpen(false)
              }
            }}
            className="pr-9"
          />
          <button type="button" tabIndex={-1} aria-label="Mostrar empresas" onClick={() => setOpen((o) => !o)} className="absolute right-2 top-1/2 -translate-y-1/2">
            <ChevronsUpDown className="h-4 w-4 text-gray-400" />
          </button>
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] p-1"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => {
          if (anchorRef.current?.contains(e.target as Node)) e.preventDefault()
        }}
      >
        <div role="listbox" className="max-h-56 overflow-y-auto">
          {matches.map((c) => (
            <button
              key={c}
              type="button"
              role="option"
              aria-selected={c === value}
              onClick={() => {
                onChange(c)
                setOpen(false)
              }}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
            >
              <span className="flex-1 truncate">{c}</span>
              {c === value && <Check className="h-4 w-4 text-brand" />}
            </button>
          ))}
          {q && !exact && (
            <button type="button" onClick={() => setOpen(false)} className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-brand hover:bg-accent">
              <Plus className="h-3.5 w-3.5" /> Adicionar “{value.trim()}”
            </button>
          )}
          {!matches.length && !q && <p className="px-2 py-3 text-center text-xs text-muted-foreground">Nenhuma empresa cadastrada ainda. Digite para adicionar.</p>}
          {value && (
            <button type="button" onClick={() => { onChange(''); setOpen(false) }} className="mt-1 flex w-full items-center gap-2 rounded-sm border-t px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent">
              <X className="h-3 w-3" /> Remover empresa
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function SmartFieldInput({ def, value, onChange, invalid }: { def: SmartFieldDef; value: string; onChange: (v: string) => void; invalid?: boolean }) {
  const id = `sf-${def.id}`
  // valor salvo antes de o tipo do campo mudar: continua visível no seletor para ser revisto ou apagado
  const legacy = value && !isFieldValueCompatible(def, value) ? value : ''
  if (def.type === 'boolean')
    return (
      <Select value={value || 'NONE'} onValueChange={(v) => onChange(v === 'NONE' ? '' : v)}>
        <SelectTrigger id={id} aria-invalid={!!legacy || undefined} className={cn(!value && 'text-muted-foreground')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="NONE">Não informado</SelectItem>
          <SelectItem value="Sim">Sim</SelectItem>
          <SelectItem value="Não">Não</SelectItem>
          {legacy && <SelectItem value={legacy}>{legacy}</SelectItem>}
        </SelectContent>
      </Select>
    )
  if (def.type === 'enum')
    return (
      <Select value={value || 'NONE'} onValueChange={(v) => onChange(v === 'NONE' ? '' : v)}>
        <SelectTrigger id={id} aria-invalid={!!legacy || undefined} className={cn(!value && 'text-muted-foreground')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="NONE">Não informado</SelectItem>
          {(def.options ?? []).filter(Boolean).map((o) => (
            <SelectItem key={o} value={o}>
              {o}
            </SelectItem>
          ))}
          {value && !(def.options ?? []).includes(value) && <SelectItem value={value}>{value}</SelectItem>}
        </SelectContent>
      </Select>
    )
  return (
    <Input
      id={id}
      inputMode={def.type === 'number' ? 'decimal' : undefined}
      value={value}
      aria-invalid={invalid || undefined}
      placeholder={def.example || (def.type === 'number' ? 'ex.: 1.500,5' : def.aiFill ? 'A Kloel preenche a partir das conversas' : '')}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

/**
 * Formulário de contato (Novo contato / Editar). Barra escura fixa Cancelar/Salvar (captura app-10).
 * `restriction` (limite do plano) bloqueia o salvamento de contatos novos.
 */
export function ContactForm({
  contact,
  prefillPhone,
  fromConversation,
  contacts,
  members,
  smartFields,
  barLeft,
  restriction,
  onSave,
  onCancel,
  onBack,
  onOpenSettings,
  showBack,
}: {
  contact?: Contact
  prefillPhone?: string
  fromConversation?: Conversation
  contacts: Contact[]
  members: { id: string; name: string }[]
  smartFields: SmartFieldDef[]
  barLeft: string
  restriction?: ReactNode
  onSave: (data: ReturnType<typeof cleanDraft>) => void | Promise<void>
  onCancel: () => void
  onBack: () => void
  onOpenSettings: () => void
  /** Seta "Voltar para a lista" (coluna única: celular e larguras intermediárias). */
  showBack?: boolean
}) {
  const [draft, setDraft] = useState<ContactDraft>(() => draftFrom(contact, prefillPhone))
  const portalContainer = usePrivatePortalContainer()
  const [errors, setErrors] = useState<Record<string, ReactNode>>({})
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const isNew = !contact
  const blockedByPlan = isNew && !!restriction
  const companies = useMemo(() => [...new Set(contacts.map((c) => c.company.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [contacts])

  const set = (p: Partial<ContactDraft>) => setDraft((d) => ({ ...d, ...p }))
  const dupLink = (dup: Contact, what: string) => (
    <>
      Este {what} já pertence a{' '}
      <Link to={`/app/contacts/${dup.id}`} className="underline">
        {displayName(dup)}
      </Link>
      .
    </>
  )

  const validate = () => {
    const e: Record<string, ReactNode> = {}
    const c = cleanDraft(draft)
    // mesma regra de identificação da importação (telefone ou e-mail), além do nome
    if (!c.firstName && !c.lastName && c.phones.length === 0 && c.emails.length === 0) e.form = 'Informe ao menos o nome, um telefone ou um e-mail.'
    draft.phones.forEach((p, i) => {
      if (isBlankPhone(p.value)) return
      if (!isValidPhone(p.value)) {
        e[`phone${i}`] = 'Telefone inválido. Inclua DDD e número.'
        return
      }
      const dup = contacts.find((x) => x.id !== contact?.id && x.phones.some((y) => phoneKey(y.value) === phoneKey(p.value)))
      if (dup) e[`phone${i}`] = dupLink(dup, 'telefone')
      if (draft.phones.findIndex((q) => phoneKey(q.value) === phoneKey(p.value)) !== i) e[`phone${i}`] = 'Telefone repetido.'
    })
    draft.emails.forEach((m, i) => {
      const v = m.value.trim().toLowerCase()
      if (!v) return
      if (!EMAIL_RE.test(v)) {
        e[`email${i}`] = 'E-mail inválido.'
        return
      }
      // a importação identifica contatos por e-mail: dois contatos com o mesmo e-mail seriam ambíguos
      const dup = contacts.find((x) => x.id !== contact?.id && x.emails.some((y) => y.value.trim().toLowerCase() === v))
      if (dup) e[`email${i}`] = dupLink(dup, 'e-mail')
      if (draft.emails.findIndex((q) => q.value.trim().toLowerCase() === v) !== i) e[`email${i}`] = 'E-mail repetido.'
    })
    smartFields.forEach((f) => {
      const v = (draft.fields[f.id] ?? '').trim()
      // valor anterior incompatível e não alterado (o tipo do campo mudou depois): não bloqueia salvar o resto do contato
      const unchanged = v === (contact?.fields[f.id] ?? '').trim()
      if (f.type === 'number' && v && !unchanged && Number.isNaN(parseNumberBR(v))) e[`field${f.id}`] = 'Informe um número, por exemplo 1.500,5 ou 42.'
    })
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const save = async () => {
    if (blockedByPlan || savingRef.current) return
    if (!validate()) return
    savingRef.current = true
    setSaving(true)
    try { await onSave(cleanDraft(draft)) }
    catch (error) { setErrors(e => ({ ...e, form: error instanceof Error ? error.message : 'Não foi possível salvar o contato.' })) }
    finally { savingRef.current = false; setSaving(false) }
  }
  const cancel = () => {
    setDraft(draftFrom(contact, prefillPhone))
    setErrors({})
    onCancel()
  }

  const title = isNew ? 'Novo contato' : displayName(contact!)

  return (
    <div className="mx-auto max-w-[440px] space-y-8" data-testid="contact-form">
      <div className="space-y-2">
        <div className="flex items-start gap-2">
          <Button variant="ghost" size="icon" aria-label="Voltar para a lista" onClick={onBack} className={cn('-ml-2 h-8 w-8 shrink-0 text-muted-foreground', showBack === undefined ? 'md:hidden' : !showBack && 'hidden')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h2 className="min-w-0 flex-1 truncate text-[30px] font-semibold leading-none tracking-tight max-md:text-2xl">{title}</h2>
        </div>
        {isNew && fromConversation && (
          <p className="text-xs text-muted-foreground">
            A partir da conversa{' '}
            <Link to={`/app/inbox?id=${encodeURIComponent(fromConversation.id)}`} className="font-medium text-brand hover:underline">
              {fromConversation.title}
            </Link>
            ; ela será vinculada ao salvar.
          </p>
        )}
      </div>

      {blockedByPlan && restriction}
      {errors.form && <p className="rounded-md border border-destructive/30 bg-red-50 px-3 py-2 text-sm text-destructive" role="alert">{errors.form}</p>}

      {/* live-compare I-contatos/02: sem foco automático em "Nome" (sem anel ao abrir) e rótulo "Nome" 36px abaixo do título;
          rótulo → campo com 4px (space-y-1) */}
      <fieldset disabled={blockedByPlan || saving} className="!mt-9 space-y-8 disabled:opacity-60">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="contact-first" className={LBL}>Nome</Label>
          <Input id="contact-first" value={draft.firstName} onChange={(e) => set({ firstName: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="contact-last" className={LBL}>Sobrenome</Label>
          <Input id="contact-last" value={draft.lastName} onChange={(e) => set({ lastName: e.target.value })} />
        </div>
      </div>

      <div>
        <p className={cn('mb-1', LBL)}>Telefones</p>
        <div className="space-y-2">
          {draft.phones.map((p, i) => (
            <div key={i} className="space-y-1">
              <div className="flex gap-1">
                <PhoneInput
                  className="min-w-0 flex-1"
                  value={p.value}
                  invalid={!!errors[`phone${i}`]}
                  onChange={(v) => set({ phones: draft.phones.map((x, j) => (j === i ? { ...x, value: v } : x)) })}
                />
                <LabelSelect value={p.label} onChange={(label) => set({ phones: draft.phones.map((x, j) => (j === i ? { ...x, label } : x)) })} />
                {draft.phones.length > 1 && (
                  <Button variant="ghost" size="icon" aria-label="Remover telefone" className="h-10 w-8 shrink-0 text-muted-foreground" onClick={() => set({ phones: draft.phones.filter((_, j) => j !== i) })}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
              {errors[`phone${i}`] && <p className="text-xs text-destructive">{errors[`phone${i}`]}</p>}
            </div>
          ))}
        </div>
        <Button variant="outline" className="mt-2 h-[26px] gap-1 rounded-sm px-1.5 py-1 text-xs" onClick={() => set({ phones: [...draft.phones, { value: '+55', label: '' }] })}>
          <Plus className="h-3 w-3" /> Adicionar telefone
        </Button>
      </div>

      <div>
        <p className={cn('mb-1', LBL)}>E-mails</p>
        <div className="space-y-2">
          {draft.emails.map((m, i) => (
            <div key={i} className="space-y-1">
              <div className="flex gap-1">
                <Input
                  type="email"
                  placeholder="name@example.com"
                  className="min-w-0 flex-1"
                  value={m.value}
                  aria-label={`E-mail ${i + 1}`}
                  aria-invalid={!!errors[`email${i}`] || undefined}
                  onChange={(e) => set({ emails: draft.emails.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })}
                />
                <LabelSelect value={m.label} onChange={(label) => set({ emails: draft.emails.map((x, j) => (j === i ? { ...x, label } : x)) })} />
                {draft.emails.length > 1 && (
                  <Button variant="ghost" size="icon" aria-label="Remover e-mail" className="h-10 w-8 shrink-0 text-muted-foreground" onClick={() => set({ emails: draft.emails.filter((_, j) => j !== i) })}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
              {errors[`email${i}`] && <p className="text-xs text-destructive">{errors[`email${i}`]}</p>}
            </div>
          ))}
        </div>
        <Button variant="outline" className="mt-2 h-[26px] gap-1 rounded-sm px-1.5 py-1 text-xs" onClick={() => set({ emails: [...draft.emails, { value: '', label: '' }] })}>
          <Plus className="h-3 w-3" /> Adicionar e-mail
        </Button>
      </div>

      <div className="space-y-1">
        <Label htmlFor="contact-company" className={LBL}>Empresa</Label>
        <CompanyCombobox value={draft.company} onChange={(company) => set({ company })} companies={companies} />
      </div>

      <div className="space-y-1">
        <Label htmlFor="contact-owner" className={LBL}>Responsável</Label>
        <Select value={draft.ownerId || 'NONE'} onValueChange={(v) => set({ ownerId: v === 'NONE' ? '' : v })}>
          <SelectTrigger id="contact-owner" className={cn(!draft.ownerId && 'text-muted-foreground')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="NONE">Nenhuma pessoa atribuída</SelectItem>
            {members.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name}
              </SelectItem>
            ))}
            {draft.ownerId && !members.some((m) => m.id === draft.ownerId) && <SelectItem value={draft.ownerId}>Membro removido</SelectItem>}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label htmlFor="contact-notes" className={LBL}>Notas</Label>
        <Textarea id="contact-notes" className="min-h-[80px]" placeholder="Algo que valha a pena lembrar sobre este contato…" value={draft.notes} onChange={(e) => set({ notes: e.target.value })} />
      </div>

      {smartFields.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-muted-foreground">Campos inteligentes</p>
            <button type="button" onClick={onOpenSettings} className="text-xs text-muted-foreground hover:text-foreground">
              Editar campos
            </button>
          </div>
          {smartFields.map((f) => (
            <div key={f.id} className="space-y-1">
              <div className="flex items-center gap-1.5">
                <Label htmlFor={`sf-${f.id}`} className={LBL}>{f.label}</Label>
                {f.aiFill && (
                  <SimpleTooltip label="Preenchido pela Kloel a partir das conversas">
                    <Sparkles className="h-3 w-3 text-brand" aria-label="Preenchido pela Kloel" />
                  </SimpleTooltip>
                )}
                {f.description && (
                  <SimpleTooltip label={f.description}>
                    <Info className="h-3 w-3 text-muted-foreground" aria-label={f.description} />
                  </SimpleTooltip>
                )}
              </div>
              <SmartFieldInput def={f} value={draft.fields[f.id] ?? ''} invalid={!!errors[`field${f.id}`]} onChange={(v) => set({ fields: { ...draft.fields, [f.id]: v } })} />
              {errors[`field${f.id}`] ? (
                <p className="text-xs text-destructive">{errors[`field${f.id}`]}</p>
              ) : (
                !isFieldValueCompatible(f, draft.fields[f.id]) &&
                (draft.fields[f.id] ?? '').trim() === (contact?.fields[f.id] ?? '').trim() && (
                  <p className="text-xs text-amber-700" data-testid={`incompatible-${f.id}`}>
                    Valor salvo antes de o campo virar “{FIELD_TYPE_LABEL[f.type]}”. Escolha um valor válido ou apague-o.
                  </p>
                )
              )}
            </div>
          ))}
        </div>
      )}
      </fieldset>

      {createPortal(
        <div className="pointer-events-none fixed bottom-5 right-0 z-40 flex justify-center px-4" style={{ left: barLeft }}>
          <div className="pointer-events-auto inline-flex items-center gap-1 rounded-2xl border border-brand/40 bg-[#16171B] p-1 shadow-[0px_6px_18px_rgba(15,18,28,0.35)]">
            <DarkBarButton onClick={cancel} disabled={saving}>Cancelar</DarkBarButton>
            <DarkBarPrimary onClick={save} disabled={blockedByPlan || saving}>
              Salvar
            </DarkBarPrimary>
          </div>
        </div>,
        portalContainer ?? document.body,
      )}
    </div>
  )
}
