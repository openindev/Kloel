import { useEffect, useState, type FormEvent } from 'react'
import { ChevronRight } from 'lucide-react'
import type { ChatSettings } from '@/domain/ext/agents'
import { cn } from '@/lib/utils'
import { SectionLabel, SettingsCard } from '@/components/app/Page'
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAgentDraft } from './draft'
import { ChatHandlingSheets, type ChatSheetId } from './ChatHandlingSheets'
import {
  TIMEOUT_MAX,
  TIMEOUT_MIN,
  TIMEOUT_PRESETS,
  chatSettingsOf,
  entrySummary,
  handoverSummary,
  notificationsSummary,
  scheduleSummary,
  timeoutLabel,
} from './chatSettings'
import { FieldError, LEFT_CHECK_ITEM } from './ui'

type Unit = 'min' | 'h' | 'd'
const UNIT_FACTOR: Record<Unit, number> = { min: 1, h: 60, d: 1440 }

/** "Personalizado..." do tempo limite: número + unidade (5 minutos a 7 dias) — INFERIDO (a opção é OBSERVADA em WC-03). */
function CustomTimeoutDialog({ open, onOpenChange, minutes, onApply }: { open: boolean; onOpenChange: (o: boolean) => void; minutes: number; onApply: (m: number) => void }) {
  const [amount, setAmount] = useState('')
  const [unit, setUnit] = useState<Unit>('h')
  const [error, setError] = useState<string>()
  useEffect(() => {
    if (!open) return
    const u: Unit = minutes % 1440 === 0 ? 'd' : minutes % 60 === 0 ? 'h' : 'min'
    setUnit(u)
    setAmount(String(minutes / UNIT_FACTOR[u]))
    setError(undefined)
  }, [open, minutes])
  function submit(e: FormEvent) {
    e.preventDefault()
    const n = Number(amount.replace(',', '.'))
    const total = Math.round(n * UNIT_FACTOR[unit])
    if (!amount.trim() || !Number.isFinite(n) || n <= 0) return setError('Informe um número maior que zero.')
    if (total < TIMEOUT_MIN || total > TIMEOUT_MAX) return setError('Use um valor entre 5 minutos e 7 dias.')
    onApply(total)
    onOpenChange(false)
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader className="gap-y-2">
          <DialogTitle>Tempo limite personalizado</DialogTitle>
          <DialogDescription>Depois desse tempo sem novas mensagens, a conversa é encerrada e a próxima mensagem abre uma nova conversa.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="chat-timeout-amount">Tempo limite</Label>
            <div className="flex gap-2">
              <Input
                id="chat-timeout-amount"
                inputMode="decimal"
                value={amount}
                aria-invalid={!!error}
                onChange={(e) => {
                  setAmount(e.target.value)
                  setError(undefined)
                }}
                className="h-10 flex-1"
              />
              <Select value={unit} onValueChange={(v) => setUnit(v as Unit)}>
                <SelectTrigger aria-label="Unidade" className="h-10 w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="min">minutos</SelectItem>
                  <SelectItem value="h">horas</SelectItem>
                  <SelectItem value="d">dias</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <FieldError>{error}</FieldError>
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit">Aplicar</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Linha "Tempo limite da conversa" do Básico (WC-03): 15 minutos / ✓ 1 hora / 4 horas / 12 horas / 24 horas / Personalizado... */
export function ChatTimeoutRow() {
  const { agent, draft, update, issueFor } = useAgentDraft()
  const c: ChatSettings = draft.chat ?? chatSettingsOf(agent)
  const [customOpen, setCustomOpen] = useState(false)
  const isPreset = TIMEOUT_PRESETS.some((p) => p.minutes === c.timeoutMinutes)
  const set = (timeoutMinutes: number) => update((d) => ({ chat: { ...(d.chat ?? c), timeoutMinutes } }))
  return (
    <div className="flex min-h-14 items-center justify-between gap-4 px-5 py-2">
      <div className="min-w-0 shrink-0">
        <span className="block text-sm font-medium">Tempo limite da conversa</span>
        <FieldError>{issueFor('chat.timeout')}</FieldError>
      </div>
      <Select
        value={isPreset ? String(c.timeoutMinutes) : 'current'}
        onValueChange={(v) => {
          if (v === 'custom') setCustomOpen(true)
          else if (v !== 'current') set(Number(v))
        }}
      >
        <SelectTrigger aria-label="Tempo limite da conversa" className="h-8 w-auto gap-1.5 rounded-lg text-[13px] shadow-none">
          <SelectValue>{timeoutLabel(c.timeoutMinutes)}</SelectValue>
        </SelectTrigger>
        <SelectContent align="start">
          {TIMEOUT_PRESETS.map((p) => (
            <SelectItem key={p.minutes} value={String(p.minutes)} className={LEFT_CHECK_ITEM}>
              {p.label}
            </SelectItem>
          ))}
          {!isPreset && (
            <SelectItem value="current" className={LEFT_CHECK_ITEM}>
              {timeoutLabel(c.timeoutMinutes)}
            </SelectItem>
          )}
          <SelectSeparator />
          <SelectItem value="custom" className={LEFT_CHECK_ITEM}>
            Personalizado...
          </SelectItem>
        </SelectContent>
      </Select>
      <CustomTimeoutDialog open={customOpen} onOpenChange={setCustomOpen} minutes={c.timeoutMinutes} onApply={set} />
    </div>
  )
}

function HandlingRow({ label, value, onClick, error, testId }: { label: string; value: string; onClick: () => void; error?: string; testId: string }) {
  return (
    <button type="button" onClick={onClick} data-chat-row={testId} className="flex min-h-14 w-full items-center justify-between gap-4 px-5 py-2 text-left transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-muted/20">
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <FieldError>{error}</FieldError>
      </span>
      <span className={cn('inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border bg-background pl-3 pr-2 text-[13px]', error && 'border-destructive')}>
        {value}
        <ChevronRight className="size-4 text-muted-foreground" />
      </span>
    </button>
  )
}

/** Grupo "Gestão de conversas" do assistente de chat (WC-03) + as quatro folhas (WC-04/05/06 + Notificações). */
export function ChatHandlingSection() {
  const { agent, draft, update, issueFor } = useAgentDraft()
  const c: ChatSettings = draft.chat ?? chatSettingsOf(agent)
  const [sheet, setSheet] = useState<ChatSheetId | null>(null)
  return (
    <div>
      <SectionLabel>Gestão de conversas</SectionLabel>
      <SettingsCard>
        <HandlingRow testId="entry" label="Entrada da conversa" value={entrySummary(c)} error={issueFor('chat.entry')} onClick={() => setSheet('entry')} />
        <HandlingRow testId="schedule" label="Agenda de resposta" value={scheduleSummary(c)} onClick={() => setSheet('schedule')} />
        <HandlingRow testId="handover" label="Transferência de conversa ativa" value={handoverSummary(c)} error={issueFor('chat.handover')} onClick={() => setSheet('handover')} />
        <HandlingRow testId="notifications" label="Notificações da equipe" value={notificationsSummary(c)} error={issueFor('chat.notifications')} onClick={() => setSheet('notifications')} />
      </SettingsCard>
      <ChatHandlingSheets agent={agent} sheet={sheet} onClose={() => setSheet(null)} value={c} onSave={(next) => update({ chat: next })} />
    </div>
  )
}
