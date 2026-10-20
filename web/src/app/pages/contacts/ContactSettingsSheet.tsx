import { useEffect, useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronRight, GripVertical, Info, Plus, Sparkles, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import type { SmartFieldDef } from '@/domain/types'
import '@/domain/ext/inbox-contacts'
import './ext'
import { cn, uid } from '@/lib/utils'
import { useCollection, useContactSettings, useCurrentOrg, useStore } from '@/data/store'
import { SideSheet } from '@/components/app/SideSheet'
import { ConfirmDialog } from '@/components/app/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { SimpleTooltip } from '@/components/ui/tooltip'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { FIELD_TYPE_LABEL, fieldValueFits, formatInt } from './lib'
import { incompatibleContactIds, saveContactSettings, removeContacts } from '@/services/casca/contacts'

type FieldErrors = Record<string, { label?: string; options?: string }>

function FieldCard({
  field,
  index,
  total,
  open,
  onOpenChange,
  onChange,
  onRemove,
  onMove,
  errors,
  dragProps,
  dragging,
  incompatible,
  typeChanged,
  clearIncompatible,
  onClearIncompatibleChange,
}: {
  field: SmartFieldDef
  index: number
  total: number
  open: boolean
  onOpenChange: (o: boolean) => void
  onChange: (f: SmartFieldDef) => void
  onRemove: () => void
  onMove: (to: number) => void
  errors?: { label?: string; options?: string }
  dragProps: React.HTMLAttributes<HTMLDivElement> & { draggable?: boolean }
  dragging: boolean
  /** Contatos cujo valor salvo não combina com o tipo/opções atuais (ex.: texto livre num campo "Sim / Não"). */
  incompatible: number
  /** Tipo diferente do salvo: o motor só aceita a troca se esses valores forem apagados (ou o tipo anterior voltar). */
  typeChanged: boolean
  clearIncompatible: boolean
  onClearIncompatibleChange: (v: boolean) => void
}) {
  const [advanced, setAdvanced] = useState(false)
  const set = (p: Partial<SmartFieldDef>) => onChange({ ...field, ...p })
  return (
    <div {...dragProps} className={cn('relative rounded-md border bg-white shadow-sm transition-opacity', dragging && 'opacity-40', errors && 'border-destructive/50')}>
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <div className="flex items-center gap-1.5 px-1.5 py-1.5">
          <button
            type="button"
            aria-label="Arraste para reordenar"
            title="Arraste para reordenar (ou use ↑/↓)"
            data-grip
            onKeyDown={(e) => {
              if (e.key === 'ArrowUp' && index > 0) {
                e.preventDefault()
                onMove(index - 1)
              }
              if (e.key === 'ArrowDown' && index < total - 1) {
                e.preventDefault()
                onMove(index + 1)
              }
            }}
            className="flex h-7 w-5 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground hover:bg-muted active:cursor-grabbing"
          >
            <GripVertical className="h-4 w-4" />
          </button>
          <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-2 rounded px-1.5 py-1 hover:bg-muted/50">
            <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform', !open && '-rotate-90')} />
            <span className="truncate text-[13px] font-medium">{field.label.trim() || 'Novo detalhe'}</span>
            <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{FIELD_TYPE_LABEL[field.type]}</span>
            {field.aiFill && <Sparkles className="h-3 w-3 shrink-0 text-brand" aria-label="Preenchido pela Kloel" />}
          </CollapsibleTrigger>
          <Button variant="ghost" size="icon" aria-label="Remover detalhe" onClick={onRemove} className="h-7 w-7 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
        <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
          <div className="space-y-3.5 border-t px-3 py-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor={`f-name-${field.id}`} className="text-xs font-normal">Nome</Label>
                <Input id={`f-name-${field.id}`} value={field.label} aria-invalid={!!errors?.label || undefined} onChange={(e) => set({ label: e.target.value })} placeholder="ex.: Convênio" />
                {errors?.label && <p className="text-xs text-destructive">{errors.label}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`f-type-${field.id}`} className="text-xs font-normal">Tipo</Label>
                <Select value={field.type} onValueChange={(v) => set({ type: v as SmartFieldDef['type'], options: v === 'enum' ? (field.options?.length ? field.options : ['', '']) : field.options })}>
                  <SelectTrigger id={`f-type-${field.id}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(FIELD_TYPE_LABEL) as SmartFieldDef['type'][]).map((t) => (
                      <SelectItem key={t} value={t}>
                        {FIELD_TYPE_LABEL[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {incompatible > 0 && (
              <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" data-testid="incompatible-warning" role="status">
                <p className="flex items-start gap-1.5">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    {formatInt(incompatible)} {incompatible === 1 ? 'contato tem um valor que não combina' : 'contatos têm valores que não combinam'} com o tipo “{FIELD_TYPE_LABEL[field.type]}”
                    {field.type === 'enum' ? ' e as opções atuais' : ''}.{' '}
                    {typeChanged ? 'Para trocar o tipo, apague esses valores ao salvar ou mantenha o tipo anterior.' : 'Eles continuam salvos e aparecem marcados no contato para revisão.'}
                  </span>
                </p>
                <label className="flex cursor-pointer items-center gap-2 pl-5">
                  <Checkbox checked={clearIncompatible} onCheckedChange={(v) => onClearIncompatibleChange(v === true)} aria-label="Apagar esses valores ao salvar" />
                  <span>Apagar esses valores ao salvar</span>
                </label>
              </div>
            )}
            {field.type === 'enum' && (
              <div className="space-y-1.5">
                <Label className="text-xs font-normal">Opções</Label>
                <div className="space-y-1.5">
                  {(field.options ?? []).map((o, i) => (
                    <div key={i} className="flex gap-1">
                      <Input
                        value={o}
                        aria-label={`Opção ${i + 1}`}
                        placeholder={`Opção ${i + 1}`}
                        className="h-9"
                        onChange={(e) => set({ options: (field.options ?? []).map((x, j) => (j === i ? e.target.value : x)) })}
                      />
                      <Button variant="ghost" size="icon" aria-label={`Remover opção ${i + 1}`} className="h-9 w-9 shrink-0 text-muted-foreground" onClick={() => set({ options: (field.options ?? []).filter((_, j) => j !== i) })}>
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
                <Button variant="outline" className="h-[26px] gap-1 rounded-sm px-1.5 py-1 text-xs" onClick={() => set({ options: [...(field.options ?? []), ''] })}>
                  <Plus className="h-3 w-3" /> Adicionar opção
                </Button>
                {errors?.options && <p className="text-xs text-destructive">{errors.options}</p>}
              </div>
            )}
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <Label htmlFor={`f-desc-${field.id}`} className="text-xs font-normal">Descrição</Label>
                <SimpleTooltip label="Mostrado na página do contato e usado pelo seu assistente.">
                  <Info className="h-3 w-3 text-muted-foreground" aria-label="Mostrado na página do contato e usado pelo seu assistente." />
                </SimpleTooltip>
              </div>
              <Textarea id={`f-desc-${field.id}`} value={field.description} onChange={(e) => set({ description: e.target.value })} placeholder="ex.: O nome da empresa que a pessoa representa." />
            </div>
            {/* fonio-live2/I-contatos/03: cartão "✨ Deixar a Kloel preencher — Captado automaticamente das chamadas" + interruptor */}
            <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-3">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-[13px] font-medium">
                  <Sparkles className="h-3.5 w-3.5 shrink-0 text-brand" /> Deixar a Kloel preencher
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">Captado automaticamente das chamadas e conversas</p>
              </div>
              <Switch checked={field.aiFill} onCheckedChange={(aiFill) => set({ aiFill })} aria-label="Deixar a Kloel preencher" />
            </div>
            <div className="border-t pt-2.5">
              <button type="button" onClick={() => setAdvanced((a) => !a)} aria-expanded={advanced} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
                <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', advanced && 'rotate-90')} /> Configurações avançadas
              </button>
              {advanced && (
                <div className="mt-3 space-y-3.5">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <Label htmlFor={`f-find-${field.id}`} className="text-xs font-normal">Como a Kloel deve encontrar isso? (opcional)</Label>
                      <SimpleTooltip label="Usado apenas pela Kloel. Se você deixar vazio, a descrição acima é usada.">
                        <Info className="h-3 w-3 text-muted-foreground" aria-label="Usado apenas pela Kloel. Se você deixar vazio, a descrição acima é usada." />
                      </SimpleTooltip>
                    </div>
                    <Textarea
                      id={`f-find-${field.id}`}
                      value={field.findHint ?? ''}
                      onChange={(e) => set({ findHint: e.target.value })}
                      placeholder="ex.: Procure expressões como “estou ligando em nome de …” ou “representando …”."
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-1.5">
                      <Label htmlFor={`f-keep-${field.id}`} className="text-xs font-normal">Manter atualizado</Label>
                      <SimpleTooltip label="A Kloel atualiza o valor com base nas conversas recentes quando ele muda.">
                        <Info className="h-3 w-3 text-muted-foreground" aria-label="A Kloel atualiza o valor com base nas conversas recentes quando ele muda." />
                      </SimpleTooltip>
                    </div>
                    <Switch id={`f-keep-${field.id}`} checked={field.keepUpdated ?? true} onCheckedChange={(keepUpdated) => set({ keepUpdated })} />
                  </div>
                  <div className={cn('space-y-1.5', field.keepUpdated === false && 'opacity-50')}>
                    <div className="flex items-center gap-1.5">
                      <Label htmlFor={`f-when-${field.id}`} className="text-xs font-normal">Atualizar somente quando…</Label>
                      <SimpleTooltip label="Deixe em branco para atualizar o valor sempre que ele mudar claramente.">
                        <Info className="h-3 w-3 text-muted-foreground" aria-label="Deixe em branco para atualizar o valor sempre que ele mudar claramente." />
                      </SimpleTooltip>
                    </div>
                    <Input
                      id={`f-when-${field.id}`}
                      className="h-9"
                      disabled={field.keepUpdated === false}
                      value={field.updateWhen ?? ''}
                      onChange={(e) => set({ updateWhen: e.target.value })}
                      placeholder="o valor mudou claramente"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}

export function ContactSettingsSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const settings = useContactSettings()
  const org = useCurrentOrg()
  const contacts = useCollection('contacts')
  const patchContactSettings = useStore((s) => s.patchContactSettings)
  const [autoCapture, setAutoCapture] = useState(true)
  const [gate, setGate] = useState('')
  const [fields, setFields] = useState<SmartFieldDef[]>([])
  const [openIds, setOpenIds] = useState<Record<string, boolean>>({})
  const [errors, setErrors] = useState<FieldErrors>({})
  const [dragId, setDragId] = useState<string | null>(null)
  const [armedId, setArmedId] = useState<string | null>(null)
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false)
  const [clearIds, setClearIds] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState(false)
  // Mesma regra do motor (troca de tipo converte sem perda; Escolha exige opção ativa): a contagem e o "Apagar" mostram o que ele apagaria.
  const fits = (f: SmartFieldDef, v: string | undefined) => fieldValueFits(settings?.smartFields.find((s) => s.id === f.id), f, v)
  const incompatibleCount = (f: SmartFieldDef) => incompatibleContactIds(f, contacts, fits).length

  useEffect(() => {
    if (!open) return
    setAutoCapture(settings?.autoCapture ?? true)
    setGate(settings?.creationGate ?? '')
    setFields((settings?.smartFields ?? []).map((f) => ({ ...f, options: f.options ? [...f.options] : undefined })))
    setOpenIds({})
    setErrors({})
    setClearIds({})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const move = (from: number, to: number) =>
    setFields((fs) => {
      const next = [...fs]
      const [it] = next.splice(from, 1)
      next.splice(to, 0, it!)
      return next
    })

  const addField = () => {
    const f: SmartFieldDef = { id: uid('sf'), label: '', type: 'text', description: '', aiFill: true }
    setFields((fs) => [...fs, f])
    setOpenIds((o) => ({ ...o, [f.id]: true }))
  }

  const save = async () => {
    if (saving) return
    const errs: FieldErrors = {}
    const seen = new Set<string>()
    fields.forEach((f) => {
      const name = f.label.trim()
      if (!name) errs[f.id] = { label: 'O nome é obrigatório.' }
      else if (seen.has(name.toLowerCase())) errs[f.id] = { label: 'Já existe um detalhe com esse nome.' }
      seen.add(name.toLowerCase())
      if (f.type === 'enum' && (f.options ?? []).map((o) => o.trim()).filter(Boolean).length < 2) errs[f.id] = { ...errs[f.id], options: 'Adicione pelo menos duas opções.' }
    })
    setErrors(errs)
    if (Object.keys(errs).length) {
      setOpenIds((o) => ({ ...o, ...Object.fromEntries(Object.keys(errs).map((id) => [id, true])) }))
      toast.error('Revise os campos destacados.')
      return
    }
    const next = {
      autoCapture,
      creationGate: gate.trim(),
      smartFields: fields.map((f) => ({
        ...f,
        label: f.label.trim(),
        description: f.description.trim(),
        options: f.type === 'enum' ? [...new Set((f.options ?? []).map((o) => o.trim()).filter(Boolean))] : undefined,
        example: f.example?.trim() || undefined,
        findHint: f.findHint?.trim() || undefined,
        updateWhen: f.updateWhen?.trim() || undefined,
      })),
    }
    setSaving(true)
    try {
      // "Apagar esses valores ao salvar": só os valores que não combinam com o tipo/as opções escolhidos agora.
      const clear = next.smartFields.filter((f) => clearIds[f.id]).map((f) => ({ fieldId: f.id, contactIds: incompatibleContactIds(f, contacts, fits) }))
      const result = await saveContactSettings(next, clear)
      if (result.waitingForChannel) toast.success('Configurações de contatos salvas', { description: 'A captura automática começa quando um canal ativo (telefone, chat do site ou WhatsApp oficial) estiver conectado a um assistente.' })
      else toast.success('Configurações de contatos salvas')
      onOpenChange(false)
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Não foi possível salvar as configurações.') }
    finally { setSaving(false) }
  }

  // "Reativar": autoriza de novo a configuração já salva (por exemplo, depois que um assistente ou canal mudou).
  const reactivate = async () => {
    if (saving || !settings) return
    setSaving(true)
    try {
      const result = await saveContactSettings({ autoCapture: settings.autoCapture, creationGate: settings.creationGate, smartFields: settings.smartFields })
      if (result.waitingForChannel) toast.error('Ainda não há um canal ativo conectado a um assistente.', { description: 'Conecte telefone, chat do site ou WhatsApp oficial a um assistente e tente novamente.' })
      else toast.success('Captura automática reativada')
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Não foi possível reativar a captura automática.') }
    finally { setSaving(false) }
  }

  const deleteAll = async () => {
    const ids = new Set(contacts.map((c) => c.id))
    const n = ids.size
    await removeContacts([...ids])
    toast.success(`${formatInt(n)} ${n === 1 ? 'contato excluído' : 'contatos excluídos'}`)
  }

  return (
    <>
      <SideSheet
        open={open}
        onOpenChange={onOpenChange}
        width={576}
        title="Configurações de contatos"
        description="Escolha como a Kloel salva e lembra seus contatos."
        footer={
          <div className="flex flex-row items-center justify-end gap-2 max-md:pr-11">
            <Button variant="outline" className="h-10" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button onClick={save} disabled={saving}>Salvar</Button>
          </div>
        }
      >
        {/* espaçamentos medidos em fonio-live2/I-contatos/02 (seções a ~28px; rótulo → descrição → campo a 4px) */}
        <div className="space-y-7">
          <div className="space-y-1">
            <div className="flex min-h-8 items-center justify-between gap-4">
              <Label htmlFor="cs-auto" className="text-sm font-medium">Capturar contatos automaticamente</Label>
              <Switch id="cs-auto" checked={autoCapture} onCheckedChange={setAutoCapture} />
            </div>
            <p className="text-xs text-muted-foreground" role={settings?.automationError ? 'alert' : undefined} data-engine-state={settings?.automationError ? 'error' : undefined}>{settings?.automationError ?? 'Salve novos contatos automaticamente das interações com clientes.'}</p>
            {settings?.automationError && (
              <Button variant="outline" size="xs" className="mt-1.5" disabled={saving} onClick={() => void reactivate()}>
                Reativar
              </Button>
            )}
          </div>

          <div className={cn('space-y-1 transition-opacity', !autoCapture && 'pointer-events-none opacity-50')} aria-disabled={!autoCapture}>
            <Label htmlFor="cs-gate" className="text-sm font-medium">Quando devemos criar um contato?</Label>
            <p className="text-xs text-muted-foreground">
              Diga à Kloel quando uma pessoa que liga deve ser salva como contato. Deixe vazio para salvar qualquer pessoa cujo nome ou sobrenome for mencionado.
            </p>
            <Textarea
              id="cs-gate"
              className="min-h-[80px]"
              disabled={!autoCapture}
              placeholder="Por padrão, salvamos um contato assim que descobrimos o nome ou sobrenome."
              value={gate}
              onChange={(e) => setGate(e.target.value)}
            />
          </div>

          <div>
            <div className="space-y-1">
              <p className="text-sm font-medium">Campos inteligentes</p>
              <p className="text-xs text-muted-foreground">Outras coisas que você quer lembrar sobre um contato. A Kloel pode captá-las na conversa, ou você pode preenchê-las você mesmo.</p>
            </div>
            <div className={cn('space-y-2', fields.length > 0 && 'mt-3')} onDragOver={(e) => dragId && e.preventDefault()}>
              {fields.map((f, i) => (
                <FieldCard
                  key={f.id}
                  field={f}
                  index={i}
                  total={fields.length}
                  open={!!openIds[f.id]}
                  onOpenChange={(o) => setOpenIds((s) => ({ ...s, [f.id]: o }))}
                  onChange={(nf) => {
                    setFields((fs) => fs.map((x) => (x.id === f.id ? nf : x)))
                    if (errors[f.id]) setErrors(({ [f.id]: _, ...rest }) => rest)
                  }}
                  onRemove={() => setFields((fs) => fs.filter((x) => x.id !== f.id))}
                  onMove={(to) => move(i, to)}
                  errors={errors[f.id]}
                  incompatible={incompatibleCount(f)}
                  typeChanged={!!settings?.smartFields.some((s) => s.id === f.id && s.type !== f.type)}
                  clearIncompatible={!!clearIds[f.id]}
                  onClearIncompatibleChange={(v) => setClearIds((s) => ({ ...s, [f.id]: v }))}
                  dragging={dragId === f.id}
                  dragProps={{
                    draggable: armedId === f.id,
                    onPointerDown: (e) => setArmedId((e.target as HTMLElement).closest('[data-grip]') ? f.id : null),
                    onDragStart: (e) => {
                      setDragId(f.id)
                      e.dataTransfer.effectAllowed = 'move'
                      e.dataTransfer.setData('text/plain', f.id)
                    },
                    onDragEnter: () => {
                      if (!dragId || dragId === f.id) return
                      const from = fields.findIndex((x) => x.id === dragId)
                      if (from >= 0) move(from, i)
                    },
                    onDragOver: (e) => e.preventDefault(),
                    onDrop: (e) => e.preventDefault(),
                    onDragEnd: () => {
                      setDragId(null)
                      setArmedId(null)
                    },
                  }}
                />
              ))}
            </div>
            <Button variant="ghost" className={cn('h-9 gap-1.5 rounded-md px-3 text-muted-foreground', fields.length > 0 ? 'mt-3' : 'mt-6')} onClick={addField}>
              <Plus className="h-4 w-4" /> Adicionar detalhe
            </Button>
          </div>

          <Separator />

          <Accordion type="single" collapsible>
            <AccordionItem value="delete" className="border-b-0">
              <AccordionTrigger className="py-2 hover:no-underline">
                <span className="text-left">
                  <span className="block text-sm font-medium">Excluir contatos</span>
                  <span className="block text-xs font-normal text-muted-foreground">Exclua permanentemente todos os contatos da sua organização.</span>
                </span>
              </AccordionTrigger>
              <AccordionContent className="pt-3">
                <Button variant="destructive" className="h-9 gap-2 rounded-md px-3" disabled={contacts.length === 0} onClick={() => setConfirmDeleteAll(true)}>
                  <Trash2 className="h-4 w-4" /> Excluir todos os {formatInt(contacts.length)} contatos
                </Button>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </SideSheet>
      <ConfirmDialog
        open={confirmDeleteAll}
        onOpenChange={setConfirmDeleteAll}
        title={`Excluir todos os ${formatInt(contacts.length)} contatos?`}
        description={`Todos os contatos de ${org?.name ?? 'sua organização'} serão removidos permanentemente. As conversas continuam disponíveis, mas sem correspondência de contato.`}
        confirmLabel="Excluir todos"
        onConfirm={deleteAll}
      />
    </>
  )
}
