import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import * as SliderPrimitive from '@radix-ui/react-slider'
import {
  Archive, ArchiveRestore, ArrowLeft, CalendarDays, CircleCheck, Copy, Ellipsis, Link2, MessageSquareX, PanelRightClose, PanelRightOpen, Pause, Phone, PhoneOff, Play, Printer, RotateCcw, Sparkles, Star, Tag as TagIcon, Trash2,
  UserRound, Volume1, Volume2, VolumeX,
} from 'lucide-react'
import { toast } from 'sonner'
import type { Conversation, Tag, TranscriptLine } from '@/domain/types'
import '@/domain/ext/inbox-contacts'
import { format } from 'date-fns'
import { cn } from '@/lib/utils'
import { CHANNEL_LABEL, RESULTS } from '@/data/catalogs/results'
import { useStore } from '@/data/store'
import { autoTagReasonText, runConversationAutoTags, setConversationStatus, updateConversationEditor, type AutoTagRun } from '@/services/casca/conversations'
import { Button } from '@/components/ui/button'
import { SimpleTooltip } from '@/components/ui/tooltip'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ConfirmDialog } from '@/components/app/ConfirmDialog'
import { TagPopover } from './TagsUi'
import { GuardedTooltip, TagChip, TriggerTooltip, formatDuration, isTypingTarget, useTriggerTooltipGuard } from './shared'
import { ChatComposer, ChatHandlingBar, PendingMessageRow, useChatTakeover } from './ChatTakeover'
import { isChat } from './filters'
import { ConversationOperationDialog, type ConversationOperation } from './ConversationOperationDialog'
import { BookingsSheet } from '../scheduling/BookingsSheet'

const CALLER_HSL = 'hsl(238,89%,60%)'
/** Chamador inativo: índigo em ~16% (referência ao vivo: barras claras por falante, rgb≈224,221,239). */
const CALLER_HSL_INACTIVE = 'hsla(238,89%,60%,0.16)'
export const READ_ONLY_HINT = 'Seu papel tem acesso somente leitura ao histórico de conversas.'

async function copyText(text: string, okMsg: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(okMsg)
  } catch {
    toast.error('Não foi possível acessar a área de transferência.', { description: text })
  }
}

function endLabel(c: Conversation) {
  const chat = isChat(c)
  const what = chat ? 'a conversa' : 'a chamada'
  if (c.result === 'transferred') return chat ? 'A conversa foi transferida para a equipe' : 'A chamada foi transferida'
  if (c.endedBy === 'assistant') return `O assistente encerrou ${what}`
  if (c.endedBy === 'caller') return chat ? 'O contato encerrou a conversa' : 'O chamador encerrou a chamada'
  if (c.endedBy === 'unknown') return chat ? 'Conversa encerrada' : 'Chamada encerrada'
  return chat ? 'A conversa foi encerrada por inatividade' : 'A chamada foi encerrada pelo sistema'
}

/* ------------------------------ transcrição ------------------------------ */

/** Barra da fala: cor do falante (assistente = foreground, chamador = índigo, equipe = verde); inativa em tom reduzido. */
function barStyle(line: TranscriptLine, active: boolean): { className: string; style?: CSSProperties } {
  if (line.speaker === 'caller') return { className: '', style: { background: active ? CALLER_HSL : CALLER_HSL_INACTIVE } }
  if (line.author === 'team') return { className: line.speaker === 'system' ? 'bg-border' : active ? 'bg-emerald-600' : 'bg-emerald-600/20' }
  if (line.speaker === 'system') return { className: active ? 'bg-muted-foreground' : 'bg-border' }
  return { className: active ? 'bg-foreground' : 'bg-foreground/[0.18]' }
}

function TranscriptRow({
  line,
  active,
  chat,
  onClick,
}: {
  line: TranscriptLine
  active: boolean
  chat: boolean
  onClick: () => void
}) {
  const caller = line.speaker === 'caller'
  const team = line.author === 'team' && line.speaker !== 'system'
  const speaker = team ? 'Equipe' : line.speaker === 'assistant' ? 'Assistente' : caller ? (chat ? 'Contato' : 'Chamador') : 'Sistema'
  const time = line.sentAt ? format(new Date(line.sentAt), 'HH:mm') : formatDuration(line.t)
  const bar = barStyle(line, active)
  return (
    <div
      role="button"
      tabIndex={0}
      data-active={active || undefined}
      aria-current={active || undefined}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
      className="group relative flex cursor-pointer items-stretch gap-2 pr-2 outline-none hover:bg-muted/30 focus-visible:bg-muted/40"
    >
      <span className={cn('w-[40px] shrink-0 pr-1 pt-[8px] text-right text-[12px] tabular-nums leading-[1.7] text-muted-foreground/70', active && 'font-medium text-foreground')}>
        {time}
      </span>
      <span className={cn('w-[2px] shrink-0', bar.className)} style={bar.style} />
      {/* Rótulo do falante truncado em 64px, como na Fonio ao vivo e no print original do operador
          (Problemas/2. Internos/2. Conversas/Captura 23.07.28: "Assisten…", "Chamad…"); nome inteiro no title. */}
      <span
        data-testid="transcript-speaker"
        className={cn(
          'ml-2 w-[64px] shrink-0 truncate pt-[8px] text-[13px] font-semibold leading-[1.6]',
          caller ? 'text-[hsl(238,89%,60%)]' : team ? 'text-emerald-700' : line.speaker === 'system' ? 'text-muted-foreground' : 'text-foreground',
        )}
        title={team && line.authorName ? `Equipe · ${line.authorName}` : speaker}
      >
        {speaker}
      </span>
      <span
        className={cn(
          'min-w-0 flex-1 whitespace-pre-wrap break-words pb-[3px] pt-[8px] text-[13px] leading-[1.6]',
          caller ? 'text-[hsl(238,89%,55%)]' : line.speaker === 'system' ? 'italic text-muted-foreground' : 'text-foreground/90',
          active && 'font-semibold',
        )}
      >
        {line.text}
      </span>
      <div className="absolute right-1 top-1 flex items-center gap-0.5 rounded-md border bg-white opacity-0 shadow-sm group-hover:opacity-100 group-focus-visible:opacity-100 print:hidden">
        <button
          type="button"
          aria-label="Copiar fala"
          title="Copiar"
          onClick={(e) => {
            e.stopPropagation()
            copyText(`[${time}] ${speaker}: ${line.text}`, 'Fala copiada')
          }}
          className="flex h-6 w-6 items-center justify-center rounded-xs text-muted-foreground hover:bg-muted"
        >
          <Copy className="h-3 w-3" />
        </button>
      </div>
    </div>
  )
}

/**
 * Mensagem de chat em balão (captura WA-03 "Assumir conversas"): contato à direita (roxo, texto branco); assistente e
 * equipe à esquerda (cinza claro, borda); mensagens da equipe com "👤 Equipe · nome"; eventos do sistema centralizados.
 */
function ChatBubble({ line, active, onClick }: { line: TranscriptLine; active: boolean; onClick: () => void }) {
  const fromContact = line.speaker === 'caller'
  const team = line.author === 'team' && line.speaker !== 'system'
  const speaker = team ? 'Equipe' : line.speaker === 'assistant' ? 'Assistente' : fromContact ? 'Contato' : 'Sistema'
  const time = line.sentAt ? format(new Date(line.sentAt), 'HH:mm') : formatDuration(line.t)
  const keyProps = {
    role: 'button' as const,
    tabIndex: 0,
    'data-active': active || undefined,
    'aria-current': active || undefined,
    onClick,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onClick()
      }
    },
  }
  if (line.speaker === 'system') {
    return (
      <div {...keyProps} className="flex cursor-default justify-center py-1.5 outline-none focus-visible:ring-1 focus-visible:ring-ring" title={line.sentAt ? format(new Date(line.sentAt), 'dd/MM/yyyy, HH:mm') : undefined}>
        <span className="rounded-full bg-muted/60 px-2.5 py-0.5 text-[11px] text-muted-foreground">
          <span className="sr-only" title="Sistema">Sistema: </span>
          {line.text}
        </span>
      </div>
    )
  }
  return (
    <div className={cn('group relative flex py-1', fromContact ? 'justify-end pl-10' : 'justify-start pr-10')}>
      <div
        {...keyProps}
        title={time}
        className={cn(
          'max-w-[min(75%,560px)] cursor-pointer rounded-xl px-3 py-2 text-[13px] leading-[1.45] outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring',
          fromContact ? 'bg-brand text-white' : 'border bg-muted/30 text-foreground',
          active && (fromContact ? 'ring-2 ring-brand/30' : 'ring-1 ring-foreground/15'),
        )}
      >
        {team ? (
          <span className="mb-0.5 flex items-center gap-1 text-[10.5px] text-muted-foreground" title={line.authorName ? `Equipe · ${line.authorName}` : 'Equipe'}>
            <UserRound className="h-2.5 w-2.5 shrink-0" />
            <span className="truncate">Equipe{line.authorName ? ` · ${line.authorName}` : ''}</span>
          </span>
        ) : (
          <span className="sr-only" title={speaker}>
            {speaker}:{' '}
          </span>
        )}
        <span className="whitespace-pre-wrap break-words">{line.text}</span>
      </div>
      <div className={cn('absolute top-1 flex items-center gap-0.5 rounded-md border bg-white opacity-0 shadow-sm group-hover:opacity-100 group-focus-within:opacity-100 print:hidden', fromContact ? 'left-1' : 'right-1')}>
        <button
          type="button"
          aria-label="Copiar mensagem"
          title="Copiar"
          onClick={(e) => {
            e.stopPropagation()
            copyText(`[${time}] ${team && line.authorName ? `Equipe · ${line.authorName}` : speaker}: ${line.text}`, 'Mensagem copiada')
          }}
          className="flex h-6 w-6 items-center justify-center rounded-xs text-muted-foreground hover:bg-muted"
        >
          <Copy className="h-3 w-3" />
        </button>
      </div>
    </div>
  )
}

/** Playback follows media events; an absent recording never gets a generated timer or waveform. */
function useAudioPlayback(url: string | undefined) {
  const audio = useRef<HTMLAudioElement | null>(null)
  const [position, updatePosition] = useState(0), [playing, updatePlaying] = useState(false), [speed, updateSpeed] = useState(1)
  const vol = usePlayerVolume()
  useEffect(() => {
    updatePosition(0); updatePlaying(false)
    if (!url) return
    const media = new Audio(url); audio.current = media
    const time = () => updatePosition(media.currentTime), play = () => updatePlaying(true), pause = () => updatePlaying(false)
    const failed = () => { updatePlaying(false); toast.error('Não foi possível reproduzir a gravação.') }
    media.addEventListener('timeupdate', time); media.addEventListener('play', play); media.addEventListener('pause', pause); media.addEventListener('ended', pause); media.addEventListener('error', failed)
    return () => { media.pause(); media.removeAttribute('src'); media.load(); audio.current = null }
  }, [url])
  useEffect(() => { if (audio.current) { audio.current.volume = vol.volume; audio.current.muted = vol.muted; audio.current.playbackRate = speed } }, [url, vol.volume, vol.muted, speed])
  return { position, playing, speed, setPosition: (value: number) => { if (audio.current) { audio.current.currentTime = value; updatePosition(value) } }, setSpeed: updateSpeed,
    setPlaying: (value: boolean) => { const media = audio.current; if (!media) return; if (!value) media.pause(); else void media.play().catch(() => toast.error('Não foi possível reproduzir a gravação.')) },
  }
}
type WaveBar = { h: number; speaker: 'caller' | 'assistant' | null }
function waveform(peaks: number[], lines: TranscriptLine[], total: number): WaveBar[] {
  return peaks.map((peak, i) => {
    const t = i / peaks.length * total, line = lines.find((l, j) => t >= l.t && t < (lines[j + 1]?.t ?? total))
    return { h: Math.max(0, Math.min(1, Number.isFinite(peak) ? peak : 0)), speaker: line?.speaker === 'caller' ? 'caller' : line?.speaker === 'assistant' ? 'assistant' : null }
  })
}

const SPEEDS = [1, 1.5, 2]
const SEEK_STEP = 5
const VOLUME_STEP = 0.1

/** Player volume preference. */
function usePlayerVolume() {
  const pref = useStore((s) => s.db.ui.inboxPlayer)
  const volume = typeof pref?.volume === 'number' ? Math.max(0, Math.min(1, pref.volume)) : 1
  const muted = !!pref?.muted
  const set = (patch: { volume?: number; muted?: boolean }) => {
    const st = useStore.getState()
    st.setUi({ inboxPlayer: { ...st.db.ui.inboxPlayer, ...patch } })
  }
  return { volume, muted, set }
}

/**
 * Player no cabeçalho da conversa (captura AN-09): botão circular de reproduzir, forma de onda por falante com cursor,
 * "0:00 / 1:27", dica de atalhos "Espaço · ←/→ · ↑/↓", volume com controle deslizante e velocidade "1×".
 * Atalhos valem com o foco no player (ou sem foco em nenhum campo): Espaço reproduz/pausa, ←/→ voltam/avançam 5 s,
 * ↑/↓ ajustam o volume. O áudio segue os eventos do arquivo recebido.
 */
function RecordingPlayer({ player, total, bars }: { player: ReturnType<typeof useAudioPlayback>; total: number; bars: WaveBar[] }) {
  const pct = player.position / Math.max(1, total)
  const vol = usePlayerVolume()
  const rootRef = useRef<HTMLDivElement>(null)
  const seek = (v: number) => player.setPosition(Math.max(0, Math.min(total, v)))
  const toggle = () => {
    if (!player.playing && player.position >= total) player.setPosition(0)
    player.setPlaying(!player.playing)
  }
  const setVolume = (v: number) => vol.set({ volume: Math.round(Math.max(0, Math.min(1, v)) * 100) / 100, muted: v <= 0 })
  const effective = vol.muted ? 0 : vol.volume
  const VolIcon = effective === 0 ? VolumeX : effective < 0.5 ? Volume1 : Volume2

  // Atalhos: tratados no próprio player e também quando o foco está no corpo da página (nenhum campo/lista focado).
  const handleKey = (e: KeyboardEvent | React.KeyboardEvent, fromRoot: boolean) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return false
    const target = e.target as HTMLElement | null
    if (isTypingTarget(target)) return false
    const inVolume = !!target?.closest?.('[data-player-volume]')
    if (e.key === ' ' || e.key === 'Spacebar') {
      toggle()
    } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !inVolume) {
      seek(player.position + (e.key === 'ArrowRight' ? SEEK_STEP : -SEEK_STEP))
    } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !inVolume) {
      setVolume(effective + (e.key === 'ArrowUp' ? VOLUME_STEP : -VOLUME_STEP))
    } else return false
    if (!fromRoot || e.key === ' ' || e.key === 'Spacebar' || !inVolume) e.preventDefault()
    return true
  }
  const keyRef = useRef(handleKey)
  keyRef.current = handleKey
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      const a = document.activeElement
      if (a && a !== document.body) return
      if (document.querySelector('[role="dialog"], [role="menu"], [role="alertdialog"], [role="listbox"][data-state="open"]')) return
      keyRef.current(e, false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div
      ref={rootRef}
      role="group"
      aria-label="Gravação da chamada"
      onKeyDown={(e) => {
        handleKey(e, true)
      }}
      className="mx-6 mb-3 max-md:mx-4 print:hidden"
    >
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label={player.playing ? 'Pausar gravação' : 'Reproduzir gravação'}
          aria-keyshortcuts="Space"
          onClick={toggle}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-foreground transition-colors hover:bg-muted/70"
        >
          {player.playing ? <Pause className="h-3.5 w-3.5 fill-current" /> : <Play className="ml-px h-3.5 w-3.5 fill-current" />}
        </button>
        <div
          role="slider"
          tabIndex={0}
          aria-label="Posição da gravação"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={Math.round(player.position)}
          aria-valuetext={`${formatDuration(player.position)} de ${formatDuration(total)}`}
          aria-keyshortcuts="ArrowLeft ArrowRight"
          className="relative flex h-10 min-w-0 flex-1 cursor-pointer items-center gap-[2px] overflow-hidden outline-none focus-visible:ring-1 focus-visible:ring-ring max-md:gap-px"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            seek(((e.clientX - r.left) / r.width) * total)
          }}
        >
          {bars.map((b, i) => {
            const played = i / bars.length < pct
            return (
              <span
                key={i}
                data-speaker={b.speaker ?? undefined}
                className={cn(
                  'min-w-0 flex-1 rounded-[1px]',
                  b.speaker === 'caller' ? (played ? 'bg-brand' : 'bg-brand/20') : played ? 'bg-foreground/70' : 'bg-muted-foreground/35',
                )}
                style={{ height: `${Math.round(b.h * 100)}%` }}
              />
            )
          })}
          {/* cursor da posição atual (AN-09: traço escuro sobre a onda) */}
          <span aria-hidden className="pointer-events-none absolute inset-y-0 w-[2px] -translate-x-1/2 rounded-full bg-foreground" style={{ left: `${pct * 100}%` }} />
        </div>
        <button
          type="button"
          aria-label="Velocidade de reprodução"
          onClick={() => player.setSpeed(SPEEDS[(SPEEDS.indexOf(player.speed) + 1) % SPEEDS.length]!)}
          className="inline-flex h-7 shrink-0 items-center rounded-md border bg-muted/40 px-2 text-[11px] font-medium tabular-nums text-muted-foreground hover:bg-muted"
        >
          {String(player.speed).replace('.', ',')}×
        </button>
      </div>
      <div className="mt-1 flex items-center gap-3 pl-12 pr-[60px] text-[11px] text-muted-foreground max-sm:pr-0">
        <span className="shrink-0 tabular-nums">
          {formatDuration(player.position)} / {formatDuration(total)}
        </span>
        <span className="min-w-0 flex-1 truncate text-center max-sm:hidden" aria-hidden>
          Espaço · ←/→ · ↑/↓
        </span>
        <span className="flex shrink-0 items-center gap-1.5 max-sm:ml-auto" data-player-volume>
          <button
            type="button"
            aria-label={effective === 0 ? 'Ativar som' : 'Silenciar'}
            aria-pressed={effective === 0}
            onClick={() => vol.set(effective === 0 ? { muted: false, volume: vol.volume > 0 ? vol.volume : 0.5 } : { muted: true })}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md hover:bg-muted hover:text-foreground"
          >
            <VolIcon className="h-3.5 w-3.5" />
          </button>
          <SliderPrimitive.Root
            min={0}
            max={1}
            step={0.05}
            value={[effective]}
            onValueChange={(v) => setVolume(v[0] ?? 0)}
            aria-label="Volume"
            className="relative flex w-16 touch-none select-none items-center py-1.5"
          >
            <SliderPrimitive.Track className="relative h-[3px] w-full grow overflow-hidden rounded-full bg-muted-foreground/25">
              <SliderPrimitive.Range className="absolute h-full bg-foreground" />
            </SliderPrimitive.Track>
            <SliderPrimitive.Thumb aria-label="Volume" className="block size-2.5 rounded-full bg-foreground shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          </SliderPrimitive.Root>
        </span>
      </div>
    </div>
  )
}

/* ------------------------------ detalhe ------------------------------ */

export function ConversationDetail({
  conversation,
  tags,
  detailsOpen,
  onToggleDetails,
  onBack,
  onDelete,
  onManageTags,
  agentName,
  contactLabel,
  readOnly = false,
  compact = false,
  reserveCorner = false,
}: {
  conversation: Conversation
  tags: Tag[]
  detailsOpen: boolean
  onToggleDetails: () => void
  onBack: () => void
  onDelete: () => void
  onManageTags: () => void
  agentName?: string
  /** Nome do contato (ou número) usado no compositor do chat assumido. */
  contactLabel?: string
  /** Papéis Builder/Visualizador: acesso somente leitura ao histórico (catálogo de papéis). */
  readOnly?: boolean
  /** Modo de coluna única (celular/tablet estreito): mostra "Voltar para a lista". */
  compact?: boolean
  /** A coluna encosta na borda direita da janela (sem painel lado a lado): o rodapé reserva o canto do selo fixo. */
  reserveCorner?: boolean
}) {
  const chat = isChat(conversation)
  // Falas da conversa original (gravação/forma de onda/marcador de término) e mensagens posteriores da equipe (chat assumido).
  const allLines = conversation.transcript
  const lines = useMemo(() => allLines.filter((l) => !l.author), [allLines])
  const teamLines = useMemo(() => allLines.filter((l) => l.author === 'team'), [allLines])
  const takeover = useChatTakeover(conversation)
  const [draft, setDraft] = useState('')
  const menuGuard = useTriggerTooltipGuard()
  const recording = conversation.recording?.url ? conversation.recording : undefined
  const player = useAudioPlayback(recording?.url)
  const [clickedIdx, setClickedIdx] = useState(0)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [extraOperation, setExtraOperation] = useState<ConversationOperation | 'bookings'>()
  const scrollRef = useRef<HTMLDivElement>(null)

  const playIdx = useMemo(() => {
    let idx = 0
    lines.forEach((l, i) => {
      if (l.t <= player.position) idx = i
    })
    return idx
  }, [lines, player.position])
  const activeIdx = recording && (player.playing || player.position > 0) ? playIdx : clickedIdx

  useEffect(() => {
    if (!player.playing) return
    const el = scrollRef.current?.querySelector('[data-active]')
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [activeIdx, player.playing])

  // Chat assumido: nova mensagem (ou envio em andamento) leva a transcrição ao fim.
  const lastTeamCount = useRef(teamLines.length)
  useEffect(() => {
    if (teamLines.length === lastTeamCount.current && !takeover.pendingText) return
    lastTeamCount.current = teamLines.length
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [teamLines.length, takeover.pendingText])

  const assigned = tags.filter((t) => conversation.tagIds.includes(t.id))
  const total = recording?.durationSec ?? 0
  const bars = useMemo(() => waveform(recording?.peaks ?? [], lines, total), [recording?.peaks, lines, total])

  const editing = useRef(false)
  const edit = async (changes: { starred?: boolean; archived?: boolean }, label: string) => {
    if (readOnly || editing.current) return
    editing.current = true
    try { await updateConversationEditor(conversation, changes); toast.success(label) }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Não foi possível salvar a conversa.') }
    finally { editing.current = false }
  }
  // "Marcar como resolvida" / "Reabrir conversa" (chats) e "Aplicar etiquetas automáticas": operações confirmadas pelo motor.
  const operating = useRef(false)
  const operate = async (action: () => Promise<unknown>, ok: string | ((value: any) => string | null)) => {
    if (readOnly || operating.current) return
    operating.current = true
    try { const value = await action(); const message = typeof ok === 'string' ? ok : ok(value); if (message) toast.success(message) }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Não foi possível concluir a operação.') }
    finally { operating.current = false }
  }
  const resolved = conversation.engineConversation?.control?.conversation.status === 'closed'
  const toggleResolved = () => operate(() => setConversationStatus(conversation, resolved ? 'open' : 'closed'), resolved ? 'Conversa reaberta: o assistente volta a responder novas mensagens.' : 'Conversa marcada como resolvida.')
  const applyAutoTags = () => operate(() => runConversationAutoTags(conversation), (run: AutoTagRun) => {
    if (run.status === 'applied') return `${run.appliedTagIds.length === 1 ? '1 etiqueta adicionada' : `${run.appliedTagIds.length} etiquetas adicionadas`}: ${run.appliedTagIds.map((id) => tags.find((t) => t.id === id)?.label ?? '').filter(Boolean).join(', ')}`
    if (run.status === 'no_match') { toast.info('Nenhuma condição de etiqueta automática foi atendida nesta conversa.'); return null }
    toast.error(`As etiquetas automáticas não foram aplicadas: ${autoTagReasonText(run.reasonCode)}.`); return null
  })
  const toggleStar = () => edit({ starred: !conversation.starred }, conversation.starred ? 'Removida dos favoritos' : 'Adicionada aos favoritos')
  const toggleArchive = () => edit({ archived: !conversation.archived }, conversation.archived ? 'Conversa desarquivada' : 'Conversa arquivada')

  const selectLine = (i: number) => {
    setClickedIdx(i)
    if (recording) {
      player.setPosition(lines[i]!.t)
      player.setPlaying(true)
    }
  }

  return (
    <div data-print-area className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-white">
      <div className="bg-white px-[var(--inbox-content-x,1.5rem)] pb-4 pt-5 max-md:px-4">
        <div className="flex items-start gap-3">
          {compact && (
            <Button variant="ghost" size="icon" aria-label="Voltar para a lista" onClick={onBack} className="-ml-2 h-8 w-8 shrink-0 text-muted-foreground print:hidden">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
          <div className="min-w-0 flex-1">
            {/* Fonio ao vivo (fonio-live2/D-conversas/01): só o título; o selo de resultado aparece apenas na lista. */}
            <h2 className="min-w-0 max-w-full truncate text-[18px] font-semibold tracking-tight">{conversation.title}</h2>
            <p className="mt-1 hidden text-xs text-muted-foreground print:block">
              {['Kloel AI', agentName, CHANNEL_LABEL[conversation.channel], format(new Date(conversation.startedAt), 'dd/MM/yyyy, HH:mm'), formatDuration(conversation.durationSec), conversation.chatActive ? 'Ativo' : RESULTS[conversation.result].label]
                .filter(Boolean)
                .join(' · ')}
            </p>
            {(assigned.length > 0 || conversation.archived) && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                {conversation.archived && (
                  <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground">
                    <Archive className="h-2.5 w-2.5" /> Arquivada
                  </span>
                )}
                {assigned.map((t) => (
                  <TagChip key={t.id} label={t.label} color={t.color} />
                ))}
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-0.5 print:hidden">
            {readOnly ? (
              <SimpleTooltip label={READ_ONLY_HINT}>
                <span tabIndex={0} className="inline-flex items-center gap-0.5 rounded-md outline-none focus-visible:ring-1 focus-visible:ring-ring" data-testid="inbox-readonly-actions">
                  <Button variant="ghost" size="icon" aria-label="Marcar com estrela" disabled className="h-8 w-8 text-muted-foreground">
                    <Star className={cn('h-4 w-4', conversation.starred && 'fill-amber-400 text-amber-400')} />
                  </Button>
                  <Button variant="ghost" size="icon" aria-label="Etiquetar" disabled className="h-8 w-8 text-muted-foreground">
                    <TagIcon className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" aria-label="Arquivar" disabled className="h-8 w-8 text-muted-foreground">
                    <Archive className="h-4 w-4" />
                  </Button>
                </span>
              </SimpleTooltip>
            ) : (
              <>
                <TriggerTooltip label={conversation.starred ? 'Remover estrela' : 'Marcar com estrela'}>
                  <Button variant="ghost" size="icon" aria-label="Marcar com estrela" aria-pressed={conversation.starred} onClick={toggleStar} className="h-8 w-8 text-muted-foreground">
                    <Star className={cn('h-4 w-4', conversation.starred && 'fill-amber-400 text-amber-400')} />
                  </Button>
                </TriggerTooltip>
                <TagPopover conversation={conversation} onManage={onManageTags} />
                <TriggerTooltip label={conversation.archived ? 'Desarquivar' : 'Arquivar'}>
                  <Button variant="ghost" size="icon" aria-label={conversation.archived ? 'Desarquivar' : 'Arquivar'} onClick={toggleArchive} className="h-8 w-8 text-muted-foreground">
                    {conversation.archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
                  </Button>
                </TriggerTooltip>
              </>
            )}
            <DropdownMenu>
              <GuardedTooltip label="Mais" guard={menuGuard}>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="Mais" className="h-8 w-8 text-muted-foreground data-[state=open]:bg-accent">
                    <Ellipsis className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
              </GuardedTooltip>
              {/* fonio-live2/D-conversas/09: Copiar link interno (link2) · Salvar como PDF (printer) · — · Excluir chamada (vermelho) */}
              <DropdownMenuContent align="end" className="w-56" {...menuGuard.contentProps}>
                <DropdownMenuItem className="text-sm" onSelect={() => copyText(`${window.location.origin}/app/inbox?id=${encodeURIComponent(conversation.id)}`, 'Link interno copiado')}>
                  <Link2 className="text-muted-foreground" /> Copiar link interno
                </DropdownMenuItem>
                <DropdownMenuItem className="text-sm" onSelect={() => setTimeout(() => window.print(), 50)}>
                  <Printer className="text-muted-foreground" /> Salvar como PDF
                </DropdownMenuItem>
                {!readOnly && conversation.engineConversation?.loaded && <>
                  <DropdownMenuSeparator />
                  {conversation.channel === 'whatsapp' && <>
                    <DropdownMenuItem onSelect={() => setExtraOperation('identity')}><UserRound className="text-muted-foreground" /> Revisar origem</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setExtraOperation('recipient')}><UserRound className="text-muted-foreground" /> Confirmar destinatário</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setExtraOperation('admission')}><Sparkles className="text-muted-foreground" /> Responder com IA</DropdownMenuItem>
                  </>}
                  {chat && <DropdownMenuItem onSelect={() => void toggleResolved()}>{resolved ? <RotateCcw className="text-muted-foreground" /> : <CircleCheck className="text-muted-foreground" />} {resolved ? 'Reabrir conversa' : 'Marcar como resolvida'}</DropdownMenuItem>}
                  {tags.some((t) => t.autoAdd) && <DropdownMenuItem onSelect={() => void applyAutoTags()}><Sparkles className="text-muted-foreground" /> Aplicar etiquetas automáticas</DropdownMenuItem>}
                  <DropdownMenuItem onSelect={() => setExtraOperation('capture')}><UserRound className="text-muted-foreground" /> Revisar dados do contato</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setExtraOperation('bookings')}><CalendarDays className="text-muted-foreground" /> Ver agendamentos</DropdownMenuItem>
                </>}
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-sm text-red-600 focus:bg-red-50 focus:text-red-700" disabled={readOnly} onSelect={() => setConfirmDelete(true)}>
                  <Trash2 /> {chat ? 'Excluir conversa' : 'Excluir chamada'}
                </DropdownMenuItem>
                {readOnly && <p className="px-2 pb-1.5 pt-0.5 text-[11px] leading-snug text-muted-foreground">{READ_ONLY_HINT}</p>}
              </DropdownMenuContent>
            </DropdownMenu>
            {/* panel-right-open (fechado por padrão); aberto, o painel sobreposto traz o próprio botão "Ocultar detalhes" */}
            <TriggerTooltip label={detailsOpen ? 'Ocultar detalhes' : 'Mostrar detalhes'}>
              <Button variant="ghost" size="icon" aria-label={detailsOpen ? 'Ocultar detalhes' : 'Mostrar detalhes'} aria-pressed={detailsOpen} onClick={onToggleDetails} className="ml-2 h-8 w-8 text-muted-foreground">
                {detailsOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
              </Button>
            </TriggerTooltip>
          </div>
        </div>
      </div>

      {recording && <RecordingPlayer player={player} total={total} bars={bars} />}

      {/* Chat em andamento (WA-03): ainda sem resumo — a caixa só aparece quando há resumo */}
      {conversation.summary.trim() !== '' && (
        <div className="mx-6 mb-4 flex items-start gap-2.5 rounded-lg border bg-muted/30 px-3.5 py-2.5 max-md:mx-4">
          <Sparkles className="mt-[3px] h-[13px] w-[13px] shrink-0 text-brand" />
          <p className="flex-1 text-[12.5px] leading-[1.5] text-foreground/80">
            <span className="mr-1.5 font-medium text-muted-foreground">Resumo</span>
            {conversation.summary}
          </p>
        </div>
      )}

      <div className="relative flex min-h-0 flex-1 flex-col border-t">
        <div className="flex h-[42px] shrink-0 items-center justify-between gap-3 border-b px-6 py-2.5 max-md:px-4">
          {/* Ligações: "Histórico" (captura ao vivo); chats: "Mensagens" (captura WA-03) */}
          <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{chat ? 'Mensagens' : 'Histórico'}</span>
        </div>
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-4 max-md:px-3" data-print-expand>
          {chat && lines.length > 0 && (
            <p className="pb-3 text-center text-[11px] tabular-nums text-muted-foreground" data-testid="inbox-chat-date">
              {format(new Date(conversation.startedAt), 'dd/MM, HH:mm')}
            </p>
          )}
          {lines.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{chat ? 'Sem mensagens nesta conversa.' : 'Sem transcrição para esta conversa.'}</p>
          ) : chat ? (
            lines.map((l, i) => <ChatBubble key={i} line={l} active={i === activeIdx} onClick={() => selectLine(i)} />)
          ) : (
            lines.map((l, i) => <TranscriptRow key={i} line={l} active={i === activeIdx} chat={chat} onClick={() => selectLine(i)} />)
          )}
          {!conversation.chatActive && (
          <div className="-mx-2 my-2.5 px-2">
            <div className="flex items-center gap-2">
              <span className="h-px flex-1 bg-border" />
              <button
                type="button"
                onClick={() => {
                  setClickedIdx(Math.max(0, lines.length - 1))
                  if (recording) {
                    player.setPlaying(false)
                    player.setPosition(total)
                  }
                }}
                className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground"
              >
                {chat ? <MessageSquareX className="h-3 w-3" /> : conversation.result === 'transferred' ? <Phone className="h-3 w-3" /> : <PhoneOff className="h-3 w-3" />}
                {endLabel(conversation)}
                <span className="shrink-0 tabular-nums text-muted-foreground/60">· {formatDuration(conversation.durationSec)}</span>
              </button>
              <span className="h-px flex-1 bg-border" />
            </div>
          </div>
          )}
          {teamLines.map((l, j) => {
            const i = lines.length + j
            const active = i === clickedIdx && !(recording && (player.playing || player.position > 0))
            return chat ? (
              <ChatBubble key={`team-${j}`} line={l} active={active} onClick={() => setClickedIdx(i)} />
            ) : (
              <TranscriptRow key={`team-${j}`} line={l} active={active} chat={chat} onClick={() => setClickedIdx(i)} />
            )
          })}
          {chat && <PendingMessageRow state={takeover} onEdit={setDraft} />}
        </div>
        {chat && !takeover.takenOver && (
          <ChatHandlingBar conversation={conversation} state={takeover} readOnly={readOnly} readOnlyHint={READ_ONLY_HINT} reserveCorner={reserveCorner} />
        )}
        {chat && (
          <ChatComposer
            conversation={conversation}
            state={takeover}
            readOnly={readOnly}
            readOnlyHint={READ_ONLY_HINT}
            contactLabel={contactLabel || (conversation.channel === 'whatsapp' ? 'o contato no WhatsApp' : 'o visitante do site')}
            draft={draft}
            setDraft={setDraft}
          />
        )}
      </div>

      {extraOperation === 'bookings' ? <BookingsSheet key={conversation.id} conversationId={conversation.id} open onOpenChange={open => !open && setExtraOperation(undefined)} /> : extraOperation && <ConversationOperationDialog key={`${conversation.id}:${extraOperation}`} conversation={conversation} operation={extraOperation} onClose={() => setExtraOperation(undefined)} />}
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={chat ? 'Excluir conversa?' : 'Excluir chamada?'}
        description="O resumo, a transcrição e os detalhes serão removidos permanentemente. Esta ação não pode ser desfeita."
        confirmLabel="Excluir"
        onConfirm={onDelete}
      />
    </div>
  )
}
