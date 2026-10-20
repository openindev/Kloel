import { useEffect, useState, type ReactNode } from 'react'
import { AlertTriangle, CalendarClock } from 'lucide-react'
import { toast } from 'sonner'
import type { Agent } from '@/domain/types'
import type { ChatSettings } from '@/domain/ext/agents'
import { cn } from '@/lib/utils'
import { useCollection, useStore } from '@/data/store'
import { SideSheet } from '@/components/app/SideSheet'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { ENTRY_OPTIONS, HANDOVER_OPTIONS, SCHEDULE_OPTIONS, STANDARD_HANDOVER_TEXT } from './chatSettings'
import { BusinessHoursSheet, DAY_ORDER, DAY_SHORT, dayHoursLabel } from './BusinessHoursSheet'
import { FieldError } from './ui'
import { saveAgentFields } from '@/services/casca/agents'

export type ChatSheetId = 'entry' | 'schedule' | 'handover' | 'notifications'

const TEXTAREA =
  'min-h-[120px] w-full resize-y rounded-lg border border-input bg-background px-3 py-2.5 text-sm leading-6 outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring aria-[invalid=true]:border-destructive'

/** Cartão de rádio das folhas de "Gestão de conversas" (WC-04/05/06): selecionado = borda roxa e fundo lilás claro. */
function RadioCards<T extends string>({ value, onChange, options, label, disabled }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; description: string }[]; label: string; disabled?: boolean }) {
  return (
    <RadioGroup value={value} onValueChange={(v) => onChange(v as T)} aria-label={label} className="gap-2.5" disabled={disabled}>
      {options.map((o) => {
        const sel = o.value === value
        return (
          <label
            key={o.value}
            className={cn(
              'flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3.5 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
              sel ? 'border-brand/60 bg-brand/[0.05]' : 'border-border bg-background hover:border-foreground/25',
              disabled && 'cursor-not-allowed opacity-60',
            )}
          >
            <RadioGroupItem value={o.value} className="mt-0.5 border-foreground/70 text-foreground" />
            <span className="min-w-0">
              <span className="block text-sm font-medium leading-5">{o.label}</span>
              <span className="mt-1 block text-sm leading-5 text-muted-foreground">{o.description}</span>
            </span>
          </label>
        )
      })}
    </RadioGroup>
  )
}

function Field({ label, htmlFor, help, error, children }: { label: string; htmlFor: string; help?: ReactNode; error?: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <label htmlFor={htmlFor} className="block text-sm font-medium">
        {label}
      </label>
      {children}
      {help && <p className="text-sm text-muted-foreground">{help}</p>}
      <FieldError>{error}</FieldError>
    </div>
  )
}

/**
 * Folhas da "Gestão de conversas" do assistente de chat (Central de ajuda › Chatbot de IA):
 * Entrada da conversa (WC-04), Agenda de resposta (WC-05), Transferência de conversa ativa (WC-06) — OBSERVADAS —
 * e Notificações da equipe (linha observada em WC-03; conteúdo da folha INFERIDO).
 * Salvar aplica ao rascunho da página (barra "N alterações"), como as folhas de Regras.
 */
export function ChatHandlingSheets({ agent, sheet, onClose, value, onSave }: { agent: Agent; sheet: ChatSheetId | null; onClose: () => void; value: ChatSettings; onSave: (v: ChatSettings) => void }) {
  const [local, setLocal] = useState<ChatSettings>(value)
  const [showErrors, setShowErrors] = useState(false)
  const [hoursOpen, setHoursOpen] = useState(false)
  const memberships = useCollection('memberships')
  const users = useStore((s) => s.db.users)
  const members = memberships.map((m) => users.find((u) => u.id === m.userId)).filter((u): u is NonNullable<typeof u> => !!u)

  useEffect(() => {
    if (!sheet) return
    const copy = JSON.parse(JSON.stringify(value)) as ChatSettings
    // primeira vez ligando as notificações: sugere todas as pessoas da organização
    if (sheet === 'notifications' && !copy.notifications.userIds.length) copy.notifications.userIds = members.map((u) => u.id)
    setLocal(copy)
    setShowErrors(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet])

  const entryError = local.entry.mode === 'condition' && !local.entry.condition.trim() ? 'Descreva quais conversas devem começar com a equipe.' : undefined
  const handoverError = local.handover.enabled && local.handover.mode !== 'standard' && !local.handover.custom.trim() ? 'Descreva as condições personalizadas.' : undefined
  const notifError =
    local.notifications.enabled && !local.notifications.onTeamEntry && !local.notifications.onHandover
      ? 'Escolha pelo menos um aviso.'
      : local.notifications.enabled && !local.notifications.userIds.length
        ? 'Escolha pelo menos uma pessoa.'
        : undefined

  function save(error: string | undefined) {
    if (error) {
      setShowErrors(true)
      toast.error('Não foi possível salvar', { description: error })
      return
    }
    onSave(local)
    onClose()
  }

  const close = (o: boolean) => !o && onClose()
  const bh = agent.businessHours

  return (
    <>
      <SideSheet
        open={sheet === 'entry'}
        onOpenChange={close}
        width={480}
        title="Entrada da conversa"
        description="Decida se uma nova conversa começa com a IA ou com a sua equipe."
        onSave={() => save(entryError)}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="flex flex-col gap-6">
          <RadioCards label="Entrada da conversa" value={local.entry.mode} options={ENTRY_OPTIONS} onChange={(mode) => setLocal((l) => ({ ...l, entry: { ...l.entry, mode } }))} />
          {local.entry.mode === 'condition' && (
            <Field
              label="Condição de entrada"
              htmlFor="chat-entry-condition"
              help="Descreva quais novas conversas devem começar com a sua equipe. Todas as outras começam com a IA."
              error={showErrors ? entryError : undefined}
            >
              <textarea
                id="chat-entry-condition"
                className={TEXTAREA}
                value={local.entry.condition}
                aria-invalid={(showErrors && !!entryError) || undefined}
                placeholder="Comece com a equipe para dúvidas de cobrança, reclamações ou pedidos para falar com uma pessoa."
                onChange={(e) => setLocal((l) => ({ ...l, entry: { ...l.entry, condition: e.target.value } }))}
              />
            </Field>
          )}
        </div>
      </SideSheet>

      <SideSheet
        open={sheet === 'schedule'}
        onOpenChange={close}
        width={480}
        title="Agenda de resposta"
        description="Escolha quando a IA deve responder usando o horário de funcionamento da sua empresa."
        onSave={() => save(undefined)}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="flex flex-col gap-6">
          <RadioCards label="Agenda de resposta" value={local.schedule} options={SCHEDULE_OPTIONS} onChange={(schedule) => setLocal((l) => ({ ...l, schedule }))} />
          <section aria-label="Horário de funcionamento da empresa" className="rounded-xl border bg-muted/30 px-4 py-4">
            <div className="flex items-start justify-between gap-3 border-b pb-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">Horário de funcionamento da empresa</p>
                <p className="mt-1 text-sm text-muted-foreground">Fuso horário: {bh.timezone}</p>
              </div>
              <Button type="button" variant="outline" size="sm" aria-label="Editar horário de funcionamento" className="h-9 shrink-0 gap-2 bg-background" onClick={() => setHoursOpen(true)}>
                <CalendarClock className="size-4" />
                Editar horário
              </Button>
            </div>
            {bh.enabled ? (
              <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 pt-3 text-[13px] sm:grid-cols-2">
                {DAY_ORDER.map((d) => (
                  <div key={d} className="flex items-baseline justify-between gap-3">
                    <dt className="text-muted-foreground">{DAY_SHORT[d]}</dt>
                    <dd className="tabular-nums text-foreground">{dayHoursLabel(bh, d, '–')}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="pt-3 text-sm text-muted-foreground">Nenhum horário configurado: “Durante o horário” nunca responde e “Fora do horário” responde sempre.</p>
            )}
          </section>
        </div>
      </SideSheet>

      <SideSheet
        open={sheet === 'handover'}
        onOpenChange={close}
        width={480}
        title="Transferência de conversa ativa"
        description="Estas configurações valem depois que a IA começou a atender uma conversa."
        onSave={() => save(handoverError)}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="flex flex-col gap-6">
          <div className="flex items-start justify-between gap-4 rounded-xl border px-4 py-3.5">
            <label htmlFor="chat-handover-enabled" className="min-w-0">
              <span className="block text-sm font-medium">Habilitar transferência para a equipe</span>
              <span className="mt-1 block text-sm text-muted-foreground">A IA pode passar uma conversa ativa para uma pessoa quando uma condição é atendida.</span>
            </label>
            <Switch id="chat-handover-enabled" checked={local.handover.enabled} onCheckedChange={(enabled) => setLocal((l) => ({ ...l, handover: { ...l.handover, enabled } }))} />
          </div>
          <RadioCards
            label="Condições de transferência"
            value={local.handover.mode}
            options={HANDOVER_OPTIONS}
            disabled={!local.handover.enabled}
            onChange={(mode) => setLocal((l) => ({ ...l, handover: { ...l.handover, mode } }))}
          />
          {local.handover.enabled && local.handover.mode !== 'custom' && (
            <div className="rounded-xl border bg-muted/30 px-4 py-3.5">
              <p className="text-sm font-medium">Condições padrão</p>
              <p className="mt-1 text-sm leading-5 text-muted-foreground">{STANDARD_HANDOVER_TEXT}</p>
            </div>
          )}
          <div role="note" className="flex gap-2.5 rounded-xl border border-orange-300 px-4 py-3.5 text-sm leading-5 text-orange-600">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <p>O seu prompt personalizado também pode influenciar a transferência. Se ele tiver condições diferentes ou conflitantes, o assistente ainda pode transferir a conversa com base nelas.</p>
          </div>
          {local.handover.enabled && local.handover.mode !== 'standard' && (
            <Field label="Condições personalizadas" htmlFor="chat-handover-custom" error={showErrors ? handoverError : undefined}>
              <textarea
                id="chat-handover-custom"
                className={TEXTAREA}
                value={local.handover.custom}
                aria-invalid={(showErrors && !!handoverError) || undefined}
                placeholder="Transfira quando o cliente pedir uma pessoa, estiver irritado, relatar um problema de cobrança, pedir cancelamento ou perguntar sobre temas jurídicos/de privacidade."
                onChange={(e) => setLocal((l) => ({ ...l, handover: { ...l.handover, custom: e.target.value } }))}
              />
            </Field>
          )}
        </div>
      </SideSheet>

      <SideSheet
        open={sheet === 'notifications'}
        onOpenChange={close}
        width={480}
        title="Notificações da equipe"
        description="Avise a sua equipe quando uma conversa precisar de uma pessoa."
        onSave={() => save(notifError)}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="flex flex-col gap-6">
          <div className="flex items-start justify-between gap-4 rounded-xl border px-4 py-3.5">
            <label htmlFor="chat-notif-enabled" className="min-w-0">
              <span className="block text-sm font-medium">Notificar a equipe</span>
              <span className="mt-1 block text-sm text-muted-foreground">Envia um e-mail às pessoas escolhidas.</span>
            </label>
            <Switch
              id="chat-notif-enabled"
              checked={local.notifications.enabled}
              onCheckedChange={(enabled) => setLocal((l) => ({ ...l, notifications: { ...l.notifications, enabled } }))}
            />
          </div>
          <fieldset disabled={!local.notifications.enabled} className={cn('space-y-3', !local.notifications.enabled && 'opacity-60')}>
            <legend className="mb-3 text-sm font-medium">Avisar quando</legend>
            {(
              [
                ['onTeamEntry', 'Uma nova conversa começar com a equipe'],
                ['onHandover', 'A IA transferir uma conversa ativa'],
              ] as const
            ).map(([k, l]) => (
              <label key={k} className="flex items-center gap-2.5 text-sm">
                <Checkbox checked={local.notifications[k]} onCheckedChange={(v) => setLocal((s) => ({ ...s, notifications: { ...s.notifications, [k]: v === true } }))} />
                {l}
              </label>
            ))}
          </fieldset>
          <fieldset disabled={!local.notifications.enabled} className={cn('space-y-3', !local.notifications.enabled && 'opacity-60')}>
            <legend className="mb-3 text-sm font-medium">Quem recebe</legend>
            {members.map((u) => (
              <label key={u.id} className="flex items-center gap-2.5 text-sm">
                <Checkbox
                  checked={local.notifications.userIds.includes(u.id)}
                  onCheckedChange={(v) =>
                    setLocal((s) => ({
                      ...s,
                      notifications: { ...s.notifications, userIds: v === true ? [...new Set([...s.notifications.userIds, u.id])] : s.notifications.userIds.filter((x) => x !== u.id) },
                    }))
                  }
                />
                <span className="min-w-0">
                  <span className="font-medium">
                    {u.firstName} {u.lastName}
                  </span>{' '}
                  <span className="text-muted-foreground">{u.email}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <FieldError>{showErrors ? notifError : undefined}</FieldError>
        </div>
      </SideSheet>

      <BusinessHoursSheet
        open={hoursOpen}
        onOpenChange={setHoursOpen}
        value={bh}
        onSave={async (next) => {
          await saveAgentFields(agent, { businessHours: next })
          toast.success('Horário de funcionamento salvo')
        }}
      />
    </>
  )
}
