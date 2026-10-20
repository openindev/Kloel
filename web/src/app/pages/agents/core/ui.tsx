import { forwardRef, useEffect, useImperativeHandle, useRef, type TextareaHTMLAttributes } from 'react'
import { Headset, Loader2, Phone, MessageCircle, Mic } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AgentType } from '@/domain/types'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { setAudioPrefs, useAudioPrefs, useMicDevices, useMicLevel } from './audio'
import { splitVariables, variableLabel } from './variables'
import { useGreetingVariableDefs } from './greetingVariables'

/**
 * Itens de Select com o ✓ à esquerda (pl-8), como nas capturas da Fonio [477] Idioma e [549] Aviso de IA.
 * Desde a rodada "Fidelidade final" o SelectItem compartilhado já põe o indicador à esquerda em todo o app; a constante
 * fica vazia (sem sobrescrita) só para não tocar nos pontos de uso.
 */
export const LEFT_CHECK_ITEM = ''

/** Subtítulo do seletor de assistentes — em inglês na referência (OBSERVADO: "Voice Agent"; chat: "Chat Agent"). */
export const AGENT_TYPE_LABEL: Record<AgentType, string> = { voice: 'Voice Agent', chat: 'Chat Agent', omni: 'Chat + Ligação' }

/** Chip de tipo do assistente (seletor, OBSERVADO): voz = `bg-sky-500/10 text-sky-700` + phone; chat = violeta + message-circle. */
export function AgentTypeChip({ type, className }: { type: AgentType; className?: string }) {
  const Icon = type === 'voice' ? Phone : type === 'omni' ? Headset : MessageCircle
  return (
    <span
      className={cn(
        'flex h-4 w-4 shrink-0 items-center justify-center rounded',
        type === 'voice' ? 'bg-sky-500/10 text-sky-700' : type === 'omni' ? 'bg-emerald-500/10 text-emerald-700' : 'bg-violet-500/10 text-violet-700',
        className,
      )}
    >
      <Icon className="!h-3 !w-3" />
    </span>
  )
}

/** Texto com variáveis {{chave}} exibidas como chips. */
export function VarText({ text, className }: { text: string; className?: string }) {
  const vars = useGreetingVariableDefs()
  return (
    <span className={className}>
      {splitVariables(text).map((p, i) =>
        p.type === 'text' ? (
          <span key={i}>{p.value}</span>
        ) : (
          <span key={i} className="var-chip rounded-full text-sm font-normal">
            {variableLabel(p.key, vars)}
          </span>
        ),
      )}
    </span>
  )
}

/** Andamento de uma operação local (importar site, enviar documento, gerar texto): barra de progresso ou erro com repetir. */
export function OpProgress({ status, progress, error, onRetry, className }: { status: string; progress: { label: string; percent: number }; error?: string; onRetry?: () => void; className?: string }) {
  if (status === 'running')
    return (
      <div className={cn('flex flex-col gap-2 text-sm', className)}>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>{progress.label || 'Processando…'}</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${Math.max(4, Math.min(100, progress.percent))}%` }} />
        </div>
      </div>
    )
  if (status === 'error')
    return (
      <div className={cn('flex items-center gap-2 text-sm text-destructive', className)}>
        <span className="min-w-0 flex-1">{error}</span>
        {onRetry && (
          <button type="button" onClick={onRetry} className="shrink-0 text-sm font-medium underline underline-offset-2">
            Tentar novamente
          </button>
        )}
      </div>
    )
  return null
}

export function FieldError({ children, className }: { children?: string; className?: string }) {
  if (!children) return null
  return <p className={cn('text-xs font-medium text-destructive', className)}>{children}</p>
}

/** Textarea que cresce com o conteúdo (resize-none overflow-hidden, como nas capturas). */
export const AutoTextarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { minRows?: number }>(
  ({ className, value, minRows, ...props }, ref) => {
    const inner = useRef<HTMLTextAreaElement>(null)
    useImperativeHandle(ref, () => inner.current!)
    useEffect(() => {
      const el = inner.current
      if (!el) return
      el.style.height = 'auto'
      el.style.height = `${el.scrollHeight + 2}px`
    }, [value])
    return <textarea ref={inner} value={value} rows={minRows ?? 1} className={cn('resize-none overflow-hidden', className)} {...props} />
  },
)
AutoTextarea.displayName = 'AutoTextarea'

/** Medidor de nível do microfone em segmentos (OBSERVADO no popover "Configurações de áudio": 5 barras verdes, cinza quando inativas). */
const METER_SHADES = ['bg-emerald-500', 'bg-emerald-400', 'bg-emerald-300', 'bg-emerald-200', 'bg-emerald-100']
export function LevelMeter({ level, segments = 5, className }: { level: number; segments?: number; className?: string }) {
  const lit = Math.round(level * segments)
  return (
    <div className={cn('flex items-center gap-1', className)} aria-label="Nível do microfone" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)}>
      {Array.from({ length: segments }, (_, i) => (
        <span key={i} className={cn('h-1.5 flex-1 rounded-full transition-colors', i < lit ? METER_SHADES[Math.min(i, METER_SHADES.length - 1)] : 'bg-muted')} />
      ))}
    </div>
  )
}

/** Seletor de microfone + medidor — usado no popover "Configurações de áudio" e no diálogo de ligação de teste. */
export function MicPicker({ active, size = 'sm', segments = 5 }: { active: boolean; size?: 'sm' | 'lg'; segments?: number }) {
  const prefs = useAudioPrefs()
  const { devices } = useMicDevices(active)
  const selected = devices.some((d) => d.id === prefs.micId) ? prefs.micId : devices[0]!.id
  const { level } = useMicLevel(active, selected)
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Mic className="h-3.5 w-3.5" />
        <span>Microfone</span>
      </div>
      <Select
        value={selected}
        onValueChange={(id) => setAudioPrefs({ micId: id, micLabel: devices.find((d) => d.id === id)?.label ?? 'Microfone padrão' })}
      >
        {/* popover da barra (sm): sem anel ao abrir com o mouse [app-agent-general-audio-popover]; diálogo da ligação (lg): com anel, como em [460] */}
        <SelectTrigger aria-label="Microfone" className={cn('h-9 w-full', size === 'sm' ? 'text-[13px] focus:ring-0 focus-visible:ring-1' : 'text-sm')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {devices.map((d) => (
            <SelectItem key={d.id} value={d.id} className={LEFT_CHECK_ITEM}>
              {d.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <LevelMeter level={level} segments={segments} />
    </div>
  )
}

/** Prévia de voz sintetizada localmente (Web Speech API, pt-BR). Retorna false se indisponível. */
export function speakPreview(text: string, opts: { gender?: 'Feminino' | 'Masculino'; lang?: string; onEnd?: () => void } = {}) {
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined
  if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return false
  synth.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = opts.lang ?? 'pt-BR'
  const voices = synth.getVoices().filter((v) => v.lang.toLowerCase().startsWith((opts.lang ?? 'pt-BR').slice(0, 2).toLowerCase()))
  const prefer = voices.find((v) => v.lang === (opts.lang ?? 'pt-BR')) ?? voices[0]
  if (prefer) u.voice = prefer
  u.pitch = opts.gender === 'Masculino' ? 0.75 : 1.15
  u.rate = 1
  u.onend = () => opts.onEnd?.()
  u.onerror = () => opts.onEnd?.()
  synth.speak(u)
  return true
}

export function stopSpeech() {
  try {
    window.speechSynthesis?.cancel()
  } catch {
    /* sem síntese de voz */
  }
}
