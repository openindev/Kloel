import { useEffect, useRef, useState } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Check, CirclePlus, Pencil, Settings, Sparkles, Tag as TagIcon, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import type { Conversation, Tag } from '@/domain/types'
import { cn } from '@/lib/utils'
import { useCollection, useStore } from '@/data/store'
import { captureEngineContext, type EngineContext } from '@/services/engine/session'
import { createConversationEditorService, type ConversationTagCatalog } from '@/services/casca/conversation-editor'
import { autoTagReasonText, loadAutoTagAutomation, updateConversationTags, type AutoTagAutomation } from '@/services/casca/conversations'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { usePrivatePortalContainer } from '@/components/app/PrivatePortal'
import { ConfirmDialog } from '@/components/app/ConfirmDialog'
import { GuardedTooltip, TAG_COLORS, TagChip, tagChipClass, useTriggerTooltipGuard } from './shared'

/* ------------------------------------------------------------------ */
/* Popover "Atribuir etiqueta" (ícone tag do cabeçalho da conversa)      */
/* ------------------------------------------------------------------ */

export function TagPopover({ conversation, onManage }: { conversation: Conversation; onManage: () => void }) {
  const tags = useCollection('tags')
  const busy = useRef(false)
  const [saving, setSaving] = useState(false)
  const [open, setOpen] = useState(false)
  const guard = useTriggerTooltipGuard()
  const toggle = async (id: string) => {
    if (busy.current || id.startsWith('engine-tag:')) return
    busy.current = true; setSaving(true)
    try { await updateConversationTags(conversation, conversation.tagIds.includes(id) ? conversation.tagIds.filter(t => t !== id) : [...conversation.tagIds, id]) }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Não foi possível salvar a etiqueta.') }
    finally { busy.current = false; setSaving(false) }
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <GuardedTooltip label="Etiquetar" guard={guard}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Etiquetar" className="relative h-8 w-8 text-muted-foreground data-[state=open]:bg-accent">
            <TagIcon className="h-4 w-4" />
            {conversation.tagIds.length > 0 && <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-brand" />}
          </Button>
        </PopoverTrigger>
      </GuardedTooltip>
      <PopoverContent align="end" className="w-52 p-0" {...guard.contentProps}>
        <div className="flex items-center gap-1 border-b px-2 py-1.5">
          <span className="size-6" />
          <span className="flex-1 text-center text-xs font-semibold">Atribuir etiqueta</span>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Gerenciar tags"
            className="size-6"
            onClick={() => {
              setOpen(false)
              onManage()
            }}
          >
            <Settings className="size-3" />
          </Button>
        </div>
        <div className="max-h-52 overflow-y-auto p-1">
          {tags.length === 0 ? (
            // fonio-live2/D-conversas/10: ícone tag em círculo + "Nenhuma tag" (a engrenagem abre "Gerenciar tags")
            <div className="flex flex-col items-center justify-center gap-2 px-2 py-6 text-center">
              <span className="flex size-10 items-center justify-center rounded-full bg-muted">
                <TagIcon className="size-4 text-muted-foreground" />
              </span>
              <p className="text-xs font-medium">Nenhuma tag</p>
            </div>
          ) : (
            tags.map((t) => {
              const checked = conversation.tagIds.includes(t.id)
              return (
                <button
                  key={t.id}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={checked}
                  disabled={saving || t.id.startsWith('engine-tag:')}
                  onClick={() => toggle(t.id)}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-accent"
                >
                  <span className={cn('flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px] border', checked ? 'border-primary bg-primary text-primary-foreground' : 'border-input')}>
                    {checked && <Check className="size-2.5" strokeWidth={3} />}
                  </span>
                  <TagChip label={t.label} color={t.color} />
                  {t.autoAdd && <Sparkles className="ml-auto size-3 text-brand" aria-label="Regra configurada" />}
                </button>
              )
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

/* ------------------------------------------------------------------ */
/* Sheet "Gerenciar tags" com painel deslizante "Criar tag"/"Editar tag" */
/* ------------------------------------------------------------------ */

/** Painel fora de vista não recebe foco (atributo HTML inert). */
const inert = (on: boolean) => (on ? ({ inert: '' } as Record<string, string>) : {})

type Draft = Pick<Tag, 'id' | 'label' | 'color' | 'autoAdd' | 'condition'> & { isNew?: boolean }

export function TagsSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const portalContainer = usePrivatePortalContainer()
  const tags = useCollection('tags').filter(t => !t.id.startsWith('engine-tag:'))
  const authority = useRef<{ context: EngineContext; catalog: ConversationTagCatalog } | null>(null)
  const savingRef = useRef(false)
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft[]>([])
  const [removed, setRemoved] = useState<string[]>([])
  const [editing, setEditing] = useState<Draft | null>(null)
  const [pane, setPane] = useState<'list' | 'edit'>('list')
  const [confirmDel, setConfirmDel] = useState<Draft | null>(null)
  const [errors, setErrors] = useState<{ label?: string; condition?: string }>({})
  // Estado real da adição automática no motor (serviço de IA, processamento e cota do dia).
  const [automation, setAutomation] = useState<AutoTagAutomation | null>(null)
  const [automationError, setAutomationError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let active = true
    authority.current = null; setLoaded(false); setCatalogError(null); setDraft([]); setRemoved([]); setPane('list'); setEditing(null); setAutomation(null); setAutomationError(null)
    void loadAutoTagAutomation().then(value => { if (active) setAutomation(value) }, e => { if (active) setAutomationError(e instanceof Error ? e.message : 'Não foi possível consultar a adição automática.') })
    const context = captureEngineContext()
    void createConversationEditorService(context).catalog().then(catalog => {
      if (!active) return
      context.assertCurrent(); authority.current = { context, catalog }; setDraft(catalog.tags); setLoaded(true)
    }).catch(e => { if (active) { const message = e instanceof Error ? e.message : 'Não foi possível carregar as etiquetas.'; setCatalogError(message); toast.error(message) } })
    return () => { active = false }
  }, [open])

  const dirty = removed.length > 0 || draft.some((d) => {
    const t = tags.find((x) => x.id === d.id)
    return !t || t.label !== d.label || t.color !== d.color || t.autoAdd !== d.autoAdd || (t.condition ?? '') !== (d.condition ?? '')
  })

  // foca o nome depois da transição do painel (fora da fase de commit do React)
  const focusName = () => setTimeout(() => document.getElementById('tag-name')?.focus(), 320)

  const startNew = () => {
    setEditing({ id: crypto.randomUUID(), label: '', color: 'brand', autoAdd: false, condition: '', isNew: true })
    setErrors({})
    setPane('edit')
    focusName()
  }
  const startEdit = (d: Draft) => {
    setEditing({ ...d })
    setErrors({})
    setPane('edit')
    focusName()
  }
  const submitEdit = () => {
    if (!editing) return
    const label = editing.label.trim()
    const errs: typeof errors = {}
    if (!label) errs.label = 'Informe um nome para a tag.'
    else if (draft.some((d) => d.id !== editing.id && d.label.trim().toLowerCase() === label.toLowerCase())) errs.label = 'Já existe uma tag com esse nome.'
    if (editing.autoAdd && !(editing.condition ?? '').trim()) errs.condition = 'Descreva a condição para adicionar a tag automaticamente.'
    setErrors(errs)
    if (Object.keys(errs).length) return
    const next = { ...editing, label, condition: editing.autoAdd ? editing.condition?.trim() : '' }
    setDraft((ds) => (ds.some((d) => d.id === next.id) ? ds.map((d) => (d.id === next.id ? next : d)) : [...ds, next]))
    setPane('list')
  }

  const saveAll = async () => {
    const original = authority.current
    if (!original || savingRef.current) return
    savingRef.current = true; setSaving(true)
    try {
      const { context, catalog } = original
      const next = await createConversationEditorService(context).saveCatalog(catalog, draft.map(d => ({ ...d, orgId: context.tenantId })))
      context.assertCurrent()
      const keep = new Set(next.tags.map(t => t.id))
      useStore.getState().mutate(db => ({ ...db, tags: [...db.tags.filter(t => t.orgId !== context.tenantId || t.id.startsWith('engine-tag:')), ...next.tags], conversations: db.conversations.map(c => c.orgId === context.tenantId ? { ...c, tagIds: c.tagIds.filter(id => id.startsWith('engine-tag:') || keep.has(id)) } : c) }))
      toast.success('Tags salvas'); onOpenChange(false)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Não foi possível salvar as etiquetas.') }
    finally { savingRef.current = false; setSaving(false) }
  }

  return (
    <>
      <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
        <DialogPrimitive.Portal container={portalContainer}>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/25 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <DialogPrimitive.Content
            aria-describedby={undefined}
            className="fixed z-50 flex w-[560px] flex-col overflow-hidden border-l bg-background shadow-lg transition ease-in-out data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:duration-300 data-[state=open]:duration-300 data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right inset-y-0 right-0 max-md:w-full md:inset-y-5 md:right-5 md:rounded-xl"
          >
            <div className="relative flex min-h-0 flex-1 overflow-hidden">
              {/* painel 1: lista — max-md:pb-14 mantém Cancelar/Salvar acima do selo fixo "Demonstração local" em 390px */}
              <div className={cn('flex w-full flex-shrink-0 flex-col gap-8 p-8 transition-transform duration-300 max-md:pb-14', pane === 'edit' && '-translate-x-full')} {...inert(pane !== 'list')}>
                <div className="flex flex-col space-y-2 pr-10 sm:text-left">
                  <DialogPrimitive.Title className="text-xl font-semibold leading-8 text-foreground">Gerenciar tags</DialogPrimitive.Title>
                  <p className="text-sm text-muted-foreground">Crie e edite tags para organizar suas conversas.</p>
                </div>
                <div className="relative -mx-8 min-h-0 flex-1 overflow-y-auto">
                  <div className="px-8 py-1">
                    <ul className="divide-y overflow-hidden rounded-xl border">
                      {draft.length === 0 && <li data-engine-state={catalogError ? 'error' : loaded ? 'ready' : 'loading'} className="px-5 py-4 text-sm text-muted-foreground">{catalogError ?? (loaded ? 'Nenhuma tag' : 'Carregando…')}</li>}
                      {draft.map((d) => (
                        <li key={d.id} className="flex items-center gap-3 px-5 py-3">
                          <span className={cn('inline-flex size-6 shrink-0 items-center justify-center rounded text-xs font-semibold', tagChipClass(d.color))}>{d.label.slice(0, 1).toUpperCase()}</span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{d.label}</p>
                            {d.autoAdd && (
                              <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                                <Sparkles className="size-3 shrink-0 text-brand" /> Regra: {d.condition}
                              </p>
                            )}
                          </div>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" aria-label={`Editar ${d.label}`} onClick={() => startEdit(d)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" aria-label={`Excluir ${d.label}`} onClick={() => setConfirmDel(d)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </li>
                      ))}
                      <li>
                        <Button variant="ghost" disabled={!loaded || saving} onClick={startNew} className="h-auto w-full gap-2 rounded-none px-5 py-4 text-brand hover:bg-accent hover:text-brand">
                          <CirclePlus className="size-4" /> Adicionar nova tag
                        </Button>
                      </li>
                    </ul>
                  </div>
                </div>
                {/* fonio-live2/D-conversas/11: sem rodapé enquanto nada mudou; Cancelar/Salvar aparecem com alterações pendentes */}
                {dirty && (
                  <div className="flex flex-row items-center justify-end gap-2">
                    <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancelar</Button>
                    <Button disabled={!loaded || saving} onClick={saveAll}>Salvar</Button>
                  </div>
                )}
              </div>
              {/* painel 2: criar/editar */}
              <div
                className={cn('absolute inset-0 flex w-full flex-shrink-0 flex-col gap-8 p-8 transition-transform duration-300 max-md:pb-14', pane === 'edit' ? 'translate-x-0' : 'translate-x-full')}
                {...inert(pane !== 'edit')}
              >
                <div className="flex flex-col space-y-2 pr-10 sm:text-left">
                  <h2 className="text-xl font-semibold leading-8 text-foreground">{editing?.isNew ? 'Criar tag' : 'Editar tag'}</h2>
                  <p className="text-sm text-muted-foreground">Etiquetas ajudam a agrupar conversas por assunto ou próximo passo.</p>
                </div>
                {editing && (
                  <div className="relative -mx-8 min-h-0 flex-1 overflow-y-auto">
                    <div className="space-y-6 px-8 py-1">
                      <div className="space-y-2">
                        <Label htmlFor="tag-name">Nome da tag</Label>
                        <div className="flex gap-3">
                          <Input
                            id="tag-name"
                            className="h-10 flex-1"
                            placeholder="Nome da nova tag"
                            value={editing.label}
                            aria-invalid={!!errors.label}
                            onChange={(e) => setEditing({ ...editing, label: e.target.value })}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault()
                                submitEdit()
                              }
                            }}
                          />
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button type="button" variant="outline" className="h-10 w-10 p-0" aria-label="Cor da tag">
                                <span className={cn('inline-flex size-8 items-center justify-center rounded px-1.5 text-sm font-medium', tagChipClass(editing.color))}>
                                  {(editing.label.trim()[0] ?? 'A').toUpperCase()}
                                </span>
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent align="end" className="w-auto p-2" onCloseAutoFocus={(e) => e.preventDefault()}>
                              <div className="grid grid-cols-5 gap-1.5">
                                {TAG_COLORS.map((c) => (
                                  <button
                                    key={c.key}
                                    type="button"
                                    title={c.label}
                                    aria-label={c.label}
                                    aria-pressed={editing.color === c.key}
                                    onClick={() => setEditing({ ...editing, color: c.key })}
                                    className={cn('inline-flex size-8 items-center justify-center rounded text-sm font-medium ring-offset-1', c.chip, editing.color === c.key && 'ring-2 ring-foreground')}
                                  >
                                    A
                                  </button>
                                ))}
                              </div>
                            </PopoverContent>
                          </Popover>
                        </div>
                        {errors.label && <p className="text-xs text-destructive">{errors.label}</p>}
                        {editing.label.trim() && (
                          <p className="flex items-center gap-2 text-xs text-muted-foreground">
                            Prévia: <TagChip label={editing.label.trim()} color={editing.color} />
                          </p>
                        )}
                      </div>
                      <div className="mt-6 space-y-5 border-t pt-6">
                        <div className="space-y-1">
                          <div className="flex min-h-8 items-center justify-between gap-4">
                            <Label htmlFor="tag-auto">Adicionar automaticamente</Label>
                            <Switch id="tag-auto" disabled={!automation?.available && !editing.autoAdd} checked={editing.autoAdd} onCheckedChange={(v) => setEditing({ ...editing, autoAdd: v })} />
                          </div>
                          <p className="text-xs text-muted-foreground" data-testid="tag-auto-status" role={automation && !automation.available ? 'alert' : undefined}>
                            {automationError
                              ? `Não foi possível consultar a adição automática: ${automationError}`
                              : !automation
                                ? 'Consultando a adição automática…'
                                : !automation.available
                                  ? `A adição automática não pode funcionar agora porque ${autoTagReasonText(automation.reasonCode)}.${editing.autoAdd ? ' A regra fica salva e volta a valer quando isso for resolvido.' : ''}`
                                  : `A Kloel adiciona esta tag quando a condição for atendida, depois que a conversa termina (ligações encerradas ou chats sem mensagens há ${automation.idleMinutes} min). Vale para conversas dos últimos ${automation.lookbackDays} dias e as próximas; nunca recoloca uma tag que alguém removeu.${!automation.schedulerRunning ? ' O processamento automático está parado no servidor agora; use “Aplicar etiquetas automáticas” no menu da conversa.' : ''}`}
                          </p>
                        </div>
                        {editing.autoAdd && (
                          <div className="space-y-2">
                            <Label htmlFor="tag-cond">Condição</Label>
                            <Textarea
                              id="tag-cond"
                              className="min-h-[80px]"
                              placeholder="ex.: A pessoa pediu que alguém da equipe retorne a ligação."
                              value={editing.condition ?? ''}
                              aria-invalid={!!errors.condition}
                              onChange={(e) => setEditing({ ...editing, condition: e.target.value })}
                            />
                            {errors.condition && <p className="text-xs text-destructive">{errors.condition}</p>}
                            <p className="text-xs text-muted-foreground">Descreva em uma frase quando a tag se aplica. A IA só adiciona a tag quando a conversa deixa isso claro.</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
                <div className="flex flex-row items-center justify-between gap-2">
                  <div />
                  <div className="flex items-center gap-2">
                    <Button type="button" variant="secondary" onClick={() => setPane('list')}>Cancelar</Button>
                    <Button type="button" onClick={submitEdit}>Salvar</Button>
                  </div>
                </div>
              </div>
            </div>
            <DialogPrimitive.Close className="absolute right-8 top-[2.2rem] rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
              <X className="h-6 w-6" />
              <span className="sr-only">Fechar</span>
            </DialogPrimitive.Close>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
      <ConfirmDialog
        open={!!confirmDel}
        onOpenChange={(o) => !o && setConfirmDel(null)}
        title="Excluir tag?"
        description={confirmDel ? `A tag "${confirmDel.label}" será removida de todas as conversas ao salvar.` : undefined}
        confirmLabel="Excluir"
        onConfirm={() => {
          if (!confirmDel) return
          setDraft((ds) => ds.filter((d) => d.id !== confirmDel.id))
          if (tags.some((t) => t.id === confirmDel.id)) setRemoved((r) => [...r, confirmDel.id])
        }}
      />
    </>
  )
}
