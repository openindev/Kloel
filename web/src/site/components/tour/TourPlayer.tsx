import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Pause, Play, RotateCcw, X, Captions, CaptionsOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ScaledStage } from './ScaledStage'

export interface TourScene {
  id: string
  title: string
  /** legenda (narração) exibida durante a cena */
  caption: string
  /** duração em segundos */
  duration: number
  /** p = progresso dentro da cena (0..1) */
  render: (p: number) => ReactNode
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/**
 * Player de tour animado (sem vídeo gravado): cenas montadas com componentes reais, reproduzidas em sequência.
 * Controles: reproduzir/pausar (botão ou barra de espaço), barra de progresso clicável (busca), capítulos, legendas, reiniciar e fechar.
 * props: scenes, title, onClose, autoPlay (padrão true), startAt? (segundos — útil para testes)
 */
export function TourPlayer({ scenes, title, onClose, autoPlay = true, startAt = 0, className }: { scenes: TourScene[]; title: string; onClose: () => void; autoPlay?: boolean; startAt?: number; className?: string }) {
  const total = useMemo(() => scenes.reduce((a, s) => a + s.duration, 0), [scenes])
  const [t, setT] = useState(Math.min(startAt, total))
  const [playing, setPlaying] = useState(autoPlay)
  const [captions, setCaptions] = useState(true)
  const raf = useRef<number>()
  const last = useRef<number>()
  const rootRef = useRef<HTMLDivElement>(null)

  const ended = t >= total

  useEffect(() => {
    if (!playing || ended) {
      last.current = undefined
      return
    }
    const tick = (now: number) => {
      if (last.current !== undefined) {
        const dt = (now - last.current) / 1000
        setT((prev) => Math.min(total, prev + dt))
      }
      last.current = now
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current)
      last.current = undefined
    }
  }, [playing, ended, total])

  useEffect(() => {
    if (ended) setPlaying(false)
  }, [ended])

  // cena atual
  let acc = 0
  let idx = 0
  for (let i = 0; i < scenes.length; i++) {
    if (t < acc + scenes[i]!.duration || i === scenes.length - 1) {
      idx = i
      break
    }
    acc += scenes[i]!.duration
  }
  const scene = scenes[idx]!
  const p = Math.max(0, Math.min(1, (t - acc) / scene.duration))
  const starts = scenes.map((_, i) => scenes.slice(0, i).reduce((a, s) => a + s.duration, 0))

  const toggle = useCallback(() => {
    if (ended) {
      setT(0)
      setPlaying(true)
      return
    }
    setPlaying((v) => !v)
  }, [ended])

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
    setT(ratio * total)
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === ' ' || e.key === 'k') {
      e.preventDefault()
      toggle()
    } else if (e.key === 'ArrowRight') setT((v) => Math.min(total, v + 5))
    else if (e.key === 'ArrowLeft') setT((v) => Math.max(0, v - 5))
    else if (e.key === 'Escape') onClose()
  }

  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true })
  }, [])

  return (
    <div ref={rootRef} tabIndex={0} onKeyDown={onKey} className={cn('group/tour relative overflow-hidden rounded-2xl bg-[#EEF0F6] outline-none', className)} aria-label={`${title} — player do tour`} data-tour-time={Math.floor(t)} data-tour-scene={scene.id}>
      <ScaledStage width={960} height={540}>
        <div key={scene.id} className="ks-fade-up absolute inset-0">{scene.render(p)}</div>
      </ScaledStage>

      {/* topo */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-3 p-3 sm:p-4">
        <span className="truncate rounded-full bg-white/90 px-3 py-1 font-site text-[12px] text-ink shadow-sm backdrop-blur sm:text-[13px]">
          <span className="hidden sm:inline">{title} · </span><b className="font-medium">{scene.title}</b> <span className="text-body">({idx + 1}/{scenes.length})</span>
        </span>
        <button type="button" onClick={onClose} className="pointer-events-auto flex h-8 items-center gap-1 rounded-full bg-white/90 px-3 font-site text-[13px] text-ink shadow-sm hover:bg-white" aria-label="Fechar tour">
          <X className="h-4 w-4" /> <span className="hidden sm:inline">Fechar tour</span>
        </button>
      </div>

      {/* legenda */}
      {captions && !ended && (
        <div className="pointer-events-none absolute inset-x-0 bottom-[72px] hidden justify-center px-4 sm:flex">
          <p key={scene.id} className="ks-fade-up max-w-[720px] rounded-lg bg-black/75 px-3 py-1.5 text-center font-site text-[12px] leading-5 text-white sm:text-[15px] sm:leading-6">{scene.caption}</p>
        </div>
      )}

      {/* fim */}
      {ended && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-white/80 font-site backdrop-blur-sm">
          <div className="text-[22px] font-medium text-heading sm:text-[28px]">Tour concluído</div>
          <p className="max-w-[420px] px-4 text-center text-[15px] text-body">Você viu como criar, configurar e colocar um assistente da Kloel no ar.</p>
          <button type="button" onClick={() => { setT(0); setPlaying(true) }} className="inline-flex h-11 items-center gap-2 rounded-xl bg-heading px-5 text-[15px] text-white hover:bg-heading/90">
            <RotateCcw className="h-4 w-4" /> Assistir novamente
          </button>
        </div>
      )}

      {/* controles */}
      <div className="relative z-10 flex items-center gap-3 bg-[#14151f] px-3 py-2.5 font-site text-white sm:absolute sm:inset-x-0 sm:bottom-0 sm:bg-transparent sm:bg-gradient-to-t sm:from-black/80 sm:via-black/50 sm:to-transparent sm:px-4 sm:pb-3 sm:pt-10">
        <button type="button" onClick={toggle} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-brand-blue shadow hover:scale-105" aria-label={playing ? 'Pausar' : ended ? 'Reiniciar' : 'Reproduzir'} data-testid="tour-toggle">
          {playing ? <Pause className="h-4 w-4 fill-current" /> : ended ? <RotateCcw className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4 fill-current" />}
        </button>
        <span className="w-[86px] shrink-0 text-[12px] tabular-nums sm:text-[13px]">{fmt(t)} / {fmt(total)}</span>
        <div className="relative h-5 flex-1 cursor-pointer" onClick={seek} role="slider" aria-label="Progresso do tour" aria-valuemin={0} aria-valuemax={Math.round(total)} aria-valuenow={Math.round(t)} tabIndex={-1}>
          <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-white/35" />
          <div className="absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-white" style={{ width: `${(t / total) * 100}%` }} />
          {starts.slice(1).map((s, i) => (
            <span key={i} className="absolute top-1/2 h-2.5 w-0.5 -translate-y-1/2 bg-black/40" style={{ left: `${(s / total) * 100}%` }} />
          ))}
          <span className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow" style={{ left: `${(t / total) * 100}%` }} />
        </div>
        <button type="button" onClick={() => setCaptions((v) => !v)} className="hidden h-8 w-8 items-center justify-center rounded-full hover:bg-white/15 sm:flex" aria-label={captions ? 'Ocultar legendas' : 'Mostrar legendas'}>
          {captions ? <Captions className="h-4 w-4" /> : <CaptionsOff className="h-4 w-4" />}
        </button>
      </div>

      {/* legenda no celular (abaixo dos controles) */}
      {captions && !ended && <p className="bg-[#14151f] px-3 pb-3 font-site text-[13px] leading-5 text-white/85 sm:hidden">{scene.caption}</p>}

      {/* capítulos */}
      <div className="absolute left-3 right-3 top-14 hidden flex-wrap justify-center gap-1.5 opacity-0 transition-opacity group-hover/tour:opacity-100 md:flex">
        {scenes.map((s, i) => (
          <button
            key={s.id}
            type="button"
            onClick={() => { setT(starts[i]! + 0.01); setPlaying(true) }}
            className={cn('rounded-full px-2.5 py-1 font-site text-[11px] shadow-sm', i === idx ? 'bg-brand-blue text-white' : 'bg-white/90 text-ink hover:bg-white')}
          >
            {s.title}
          </button>
        ))}
      </div>
    </div>
  )
}
