import { useEffect, useState } from 'react'
import { BadgeCheck, Check, ChevronsUpDown, ExternalLink, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import '@/domain/ext/agents-resources'
import type { Agent, WhatsAppAction } from '@/domain/types'
import { cn, uid } from '@/lib/utils'
import { useCurrentOrg, useCurrentUser, useStore } from '@/data/store'
import { services } from '@/services'
import { useOperation } from '@/hooks/useOperation'
import { SideSheet } from '@/components/app/SideSheet'
import { ConfirmDialog } from '@/components/app/ConfirmDialog'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AddRow, DeleteFooterButton, EditableTitle, Field, FieldError, InfoBox, ListCard, ListRow, Pill, SectionCaps, SheetFooter, SheetSegmented, digits } from './shared/ui'
import { saveAgent, upsert, useErrors, useHoursDraft } from './shared/hooks'
import { WindowControl } from './shared/timing'
import type { ActiveWindow } from '@/domain/ext/agents-resources'
import { useListView, type ResourceProps } from './shared/listView'
import { QrCode } from './shared/QrCode'
import { ownershipStatus, startOwnership, syncVerifiedNumbers, type OwnershipChallenge } from '@/services/casca/whatsapp-ownership'

export function WhatsAppResource({ agent, open, onOpenChange }: ResourceProps) {
  const lv = useListView(agent.whatsapps.length > 0, () => onOpenChange(false), (id) => agent.whatsapps.some((w) => w.id === id))
  const view = lv.view
  if (view.mode === 'list')
    return (
      // Lista das mensagens salvas (INFERIDO: a conta ao vivo não tinha nenhuma; sem itens abre direto o formulário, C-41)
      <SideSheet open={open} onOpenChange={onOpenChange} title="Enviar WhatsApp" hideFooter contentClassName="pt-0">
        <ListCard>
          {agent.whatsapps.map((w) => (
            <ListRow key={w.id} title={w.name} subtitle={w.when === 'always' ? 'Sempre' : `Somente se ${w.condition ?? ''}`} pills={w.recipients[0] ? <Pill>{w.recipients[0]}</Pill> : undefined} onClick={() => lv.edit(w.id)} />
          ))}
          <AddRow onClick={() => lv.add()}>Adicionar WhatsApp</AddRow>
        </ListCard>
      </SideSheet>
    )
  const target = view.id ? agent.whatsapps.find((w) => w.id === view.id) : undefined
  return <WhatsAppEditor key={view.seq} agent={agent} target={target} open={open} onOpenChange={onOpenChange} onDone={lv.done} />
}

/**
 * "WhatsApp" (fonio-live2 C-assistentes/41–44 + data/resources.json): Ativo, Enviar (Sempre | Somente se…), MENSAGEM › Para
 * (combobox dos números verificados), "Verificar propriedade do número", Prévia em balão e o aviso azul do add-on.
 */
function WhatsAppEditor({ agent, target, open, onOpenChange, onDone }: { agent: Agent; target?: WhatsAppAction; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const org = useCurrentOrg()
  const verified = org?.verifiedWhatsAppNumbers ?? []
  const { errors, setErrors, clear } = useErrors<'recipient' | 'condition' | 'window'>()
  const hours = useHoursDraft(agent)
  const [name, setName] = useState(target?.name ?? 'WhatsApp')
  const [win, setWin] = useState<ActiveWindow>(target?.activeWindow ?? 'any')
  const [when, setWhen] = useState<WhatsAppAction['when']>(target?.when ?? 'always')
  const [condition, setCondition] = useState(target?.condition ?? '')
  const [recipient, setRecipient] = useState<string | undefined>(target?.recipients[0])
  const [verifyOpen, setVerifyOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  useEffect(() => { if (open) void syncVerifiedNumbers().catch(() => {}) }, [open])

  const save = async () => {
    try {
    const e: typeof errors = {}
    if (!recipient) e.recipient = 'Selecione um número verificado para receber as mensagens.'
    if (when === 'only_if' && !condition.trim()) e.condition = 'Descreva a condição para enviar a mensagem.'
    if (win !== 'any' && !hours.configured) e.window = 'Configure o horário de funcionamento para usar esta opção.'
    setErrors(e)
    if (Object.values(e).some(Boolean)) {
      toast.error('Corrija os campos destacados.')
      return
    }
    const next: WhatsAppAction = {
      id: target?.id ?? uid('wpp'),
      name: name.trim() || 'WhatsApp',
      senderNumberId: target?.senderNumberId,
      timing: target?.timing ?? 'after',
      when,
      condition: when === 'only_if' ? condition.trim() : undefined,
      recipientsMode: 'fixed',
      recipients: recipient ? [recipient] : [],
      message: target?.message ?? '',
      activeWindow: win,
    }
    await saveAgent(agent, (a) => ({ whatsapps: upsert(a.whatsapps, next), ...(hours.changed ? { businessHours: hours.hours } : {}) }))
    toast.success(target ? 'Mensagem de WhatsApp atualizada.' : 'Mensagem de WhatsApp adicionada.')
    onDone()
      } catch (error) { toast.error('Não foi possível salvar', { description: error instanceof Error ? error.message : 'Confira o acesso e tente novamente.' }) }
  }

  return (
    <SideSheet
      open={open}
      onOpenChange={onOpenChange}
      title={<EditableTitle value={name} onChange={setName} />}
      footer={<SheetFooter onSave={save} onCancel={onDone} left={target && <DeleteFooterButton onClick={() => setConfirmDelete(true)} />} />}
      contentClassName="pb-0"
    >
      <div className="-mt-[3px] flex flex-col" data-testid="whatsapp-editor">
        <Field label="Ativo" htmlFor="wa-window" error={errors.window}>
          <WindowControl id="wa-window" value={win} onChange={(v) => (setWin(v), clear('window'))} hoursConfigured={hours.configured} onConfigure={hours.openSheet} />
        </Field>
        {/* C-41: "Enviar" 16px abaixo do seletor; a condição fica 4px abaixo do segmentado, com 80px */}
        <div className="mt-4 flex flex-col gap-1">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm font-medium">Enviar</span>
            <SheetSegmented<WhatsAppAction['when']>
              ariaLabel="Enviar"
              value={when}
              onChange={setWhen}
              options={[
                { value: 'always', label: 'Sempre' },
                { value: 'only_if', label: 'Somente se…' },
              ]}
            />
          </div>
          {when === 'only_if' && (
            <>
              <Textarea aria-label="Condição" value={condition} onChange={(e) => (setCondition(e.target.value), clear('condition'))} placeholder="o chamador pediu para ser chamado de volta" aria-invalid={!!errors.condition || undefined} className="min-h-[80px]" autoFocus />
              <FieldError>{errors.condition}</FieldError>
            </>
          )}
        </div>

        <SectionCaps className="mt-6">Mensagem</SectionCaps>

        <Field label="Para" className="mt-[22px]" error={errors.recipient}>
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                role="combobox"
                aria-expanded={pickerOpen}
                aria-label="Para"
                aria-invalid={!!errors.recipient || undefined}
                className={cn('flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-4 text-sm focus:outline-none focus:ring-1 focus:ring-ring aria-[invalid=true]:border-destructive', !recipient && 'text-muted-foreground')}
              >
                <span className="truncate">{recipient ?? 'Selecionar...'}</span>
                <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0">
              <Command>
                <CommandInput placeholder="Pesquisar..." />
                <CommandList>
                  {/* C-42: texto na cor do texto, 28px acima e abaixo */}
                  <CommandEmpty className="py-7 text-center text-sm text-foreground">Nenhum resultado encontrado.</CommandEmpty>
                  {verified.length > 0 && (
                    <CommandGroup>
                      {verified.map((v) => (
                        <CommandItem
                          key={v.number}
                          value={v.number}
                          onSelect={() => {
                            setRecipient(v.number)
                            clear('recipient')
                            setPickerOpen(false)
                          }}
                        >
                          <span className="flex-1">{v.number}</span>
                          {v.number === recipient && <Check className="size-4" />}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </Field>
        <Button type="button" variant="outline" className="mt-4 gap-2 self-start" onClick={() => setVerifyOpen(true)}>
          <BadgeCheck className="size-4" /> Verificar propriedade do número
        </Button>

        <Field label="Prévia" className="mt-[17px]">
          <div className="rounded-xl bg-[#e5ddd5] p-3" data-testid="whatsapp-preview">
            {/* C-44: balão branco max-w-sm, título com divisória, rodapé "Enviado via kloel.ai" */}
            <div className="w-full max-w-sm rounded-lg bg-white text-sm text-gray-800 shadow-sm">
              <p className="border-b border-gray-100 px-3 pb-1.5 pt-3 font-semibold leading-5 text-gray-900">Resumo da chamada</p>
              <div className="space-y-5 whitespace-pre-line px-3 pb-2 pt-2.5 leading-5">
                <p>Resumo da sua chamada em 2026-06-30 06:35</p>
                <p>
                  Número de telefone: +43660111222
                  {'\n'}Link: https://www.kloel.ai/app/inbox?id=00000000-0000-0000-0000-000000000001
                </p>
                <p>Resumo: A pessoa que ligou perguntou sobre o horário de funcionamento e pediu um retorno amanhã.</p>
                <p>Detalhes: link acima.</p>
                <p className="!mt-2 text-xs text-gray-400">Enviado via kloel.ai</p>
              </div>
            </div>
          </div>
        </Field>

        <InfoBox className="mt-8" testId="whatsapp-addon-note">
          <span role="note">As mensagens de ação do WhatsApp são adquiridas como add-on em pacotes de 100 por R$ 90,00.</span>
        </InfoBox>
      </div>
      {hours.sheet}
      <VerifyNumberDialog
        open={verifyOpen}
        onOpenChange={setVerifyOpen}
        onVerified={(n) => {
          setRecipient(n)
          clear('recipient')
        }}
      />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Excluir mensagem de WhatsApp?"
        description={`A ação "${name}" deixará de enviar mensagens.`}
        confirmLabel="Excluir"
        onConfirm={async () => {
          await saveAgent(agent, (a) => ({ whatsapps: a.whatsapps.filter((x) => x.id !== target?.id) }))
          toast.success('Mensagem de WhatsApp excluída.')
          onDone()
        }}
      />
    </SideSheet>
  )
}

/**
 * "Verificar número do WhatsApp" (C-assistentes/43): aviso, QR code, código "kloel verify …", "Abrir no WhatsApp" e
 * "Aguardando a mensagem do WhatsApp...". O motor emite o código; o webhook da Meta confirma quando a mensagem chega do número.
 */
export function VerifyNumberDialog({ open, onOpenChange, onVerified }: { open: boolean; onOpenChange: (o: boolean) => void; onVerified: (n: string) => void }) {
  const [challenge, setChallenge] = useState<OwnershipChallenge | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!open) { setChallenge(null); setError(null); return }
    let alive = true, timer: ReturnType<typeof setTimeout> | undefined
    startOwnership().then((c) => {
      if (!alive) return
      setChallenge(c)
      const poll = async () => {
        try {
          const r = await ownershipStatus(c.code)
          if (!alive) return
          if (r.status === 'verified' && r.number) {
            await syncVerifiedNumbers().catch(() => {})
            toast.success('Número verificado.', { description: r.number })
            onVerified(r.number); onOpenChange(false); return
          }
        } catch { /* keep waiting */ }
        if (alive) timer = setTimeout(poll, 2500)
      }
      timer = setTimeout(poll, 2500)
    }).catch((e) => alive && setError(e instanceof Error ? e.message : 'Não foi possível gerar o código.'))
    return () => { alive = false; if (timer) clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  const message = challenge?.message ?? 'kloel verify …'
  const verify = { status: error ? 'error' : 'idle', error }
  const openWhatsApp = () => { if (challenge) window.open(challenge.link, '_blank', 'noopener') }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-y-4 sm:max-w-[520px] sm:rounded-xl">
        <DialogHeader>
          <DialogTitle>Verificar número do WhatsApp</DialogTitle>
          <DialogDescription>Envie a mensagem gerada a partir do número do WhatsApp que você deseja usar.</DialogDescription>
        </DialogHeader>
        <InfoBox tone="neutral" icon="alert">
          Ao comprovar a propriedade, você permite que a kloel envie mensagens do WhatsApp para o seu número.
        </InfoBox>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[auto_1fr]">
          <div className="flex items-center justify-center rounded-xl border p-4">
            <QrCode value={challenge?.link ?? message} size={110} />
          </div>
          <div className="flex min-w-0 flex-col items-start gap-3">
            <div className="w-full break-all rounded-lg border bg-muted/50 px-3 py-2.5 font-mono text-sm leading-5" data-testid="verify-code">
              {message}
            </div>
            <Button type="button" className="gap-2" onClick={openWhatsApp} disabled={!challenge}>
              <ExternalLink className="size-4" /> Abrir no WhatsApp
            </Button>
            {verify.status === 'error' ? (
              <p className="flex items-center gap-2 text-sm text-destructive">{verify.error ?? 'Não foi possível verificar o número.'}</p>
            ) : (
              <p className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="verify-waiting">
                <Loader2 className="size-4 animate-spin" /> Aguardando a mensagem do WhatsApp...
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
