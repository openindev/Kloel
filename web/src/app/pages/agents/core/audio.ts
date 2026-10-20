import { useEffect, useState, useSyncExternalStore } from 'react'

/**
 * Preferências de áudio da ligação de teste (microfone escolhido + permissão simulada).
 * Persistidas em localStorage (preferência do navegador, não dado de negócio).
 * O microfone real só é listado/medido quando o navegador JÁ concedeu permissão ao site;
 * a casca nunca dispara o pedido de permissão do navegador (permissão "Permitir" é simulada).
 */
const KEY = 'kloel-demo:agents:audio'

export interface AudioPrefs {
  micId: string
  micLabel: string
  simulatedPermission: boolean
}

const DEFAULT_PREFS: AudioPrefs = { micId: 'default', micLabel: 'Microfone padrão', simulatedPermission: false }
const listeners = new Set<() => void>()
let cache: AudioPrefs | null = null

function read(): AudioPrefs {
  if (cache) return cache
  try {
    const raw = window.localStorage.getItem(KEY)
    cache = raw ? { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<AudioPrefs>) } : DEFAULT_PREFS
  } catch {
    cache = DEFAULT_PREFS
  }
  return cache
}

export function setAudioPrefs(patch: Partial<AudioPrefs>) {
  cache = { ...read(), ...patch }
  try {
    window.localStorage.setItem(KEY, JSON.stringify(cache))
  } catch {
    /* armazenamento indisponível: mantém em memória */
  }
  listeners.forEach((l) => l())
}

export function useAudioPrefs() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    read,
    read,
  )
}

export interface MicDevice {
  id: string
  label: string
}

/** Estado real da permissão de microfone do navegador (sem solicitar). */
export function useBrowserMicPermission() {
  const [state, setState] = useState<'granted' | 'denied' | 'prompt' | 'unknown'>('unknown')
  useEffect(() => {
    let alive = true
    let status: PermissionStatus | undefined
    const onChange = () => status && alive && setState(status.state as 'granted' | 'denied' | 'prompt')
    try {
      navigator.permissions
        ?.query({ name: 'microphone' as PermissionName })
        .then((s) => {
          status = s
          onChange()
          s.addEventListener('change', onChange)
        })
        .catch(() => alive && setState('unknown'))
    } catch {
      setState('unknown')
    }
    return () => {
      alive = false
      status?.removeEventListener('change', onChange)
    }
  }, [])
  return state
}

/** Lista de microfones: dispositivos reais somente se a permissão já foi concedida; caso contrário "Microfone padrão". */
export function useMicDevices(enabled: boolean) {
  const permission = useBrowserMicPermission()
  const [devices, setDevices] = useState<MicDevice[]>([{ id: 'default', label: 'Microfone padrão' }])
  useEffect(() => {
    if (!enabled || permission !== 'granted' || !navigator.mediaDevices?.enumerateDevices) {
      setDevices([{ id: 'default', label: 'Microfone padrão' }])
      return
    }
    let alive = true
    navigator.mediaDevices
      .enumerateDevices()
      .then((list) => {
        if (!alive) return
        const inputs = list
          .filter((d) => d.kind === 'audioinput')
          .map((d) => ({ id: d.deviceId || 'default', label: d.deviceId === 'default' ? 'Padrão do sistema' : d.label || 'Microfone sem nome' }))
        setDevices(inputs.length ? inputs : [{ id: 'default', label: 'Microfone padrão' }])
      })
      .catch(() => alive && setDevices([{ id: 'default', label: 'Microfone padrão' }]))
    return () => {
      alive = false
    }
  }, [enabled, permission])
  return { devices, permission }
}

/** Nível de entrada (0–1) do microfone escolhido — só mede quando a permissão real já existe. */
export function useMicLevel(active: boolean, deviceId: string) {
  const permission = useBrowserMicPermission()
  const [level, setLevel] = useState(0)
  useEffect(() => {
    if (!active || permission !== 'granted' || !navigator.mediaDevices?.getUserMedia) {
      setLevel(0)
      return
    }
    let stream: MediaStream | undefined
    let ctx: AudioContext | undefined
    let raf = 0
    let alive = true
    navigator.mediaDevices
      .getUserMedia({ audio: deviceId && deviceId !== 'default' ? { deviceId: { exact: deviceId } } : true })
      .then((s) => {
        if (!alive) {
          s.getTracks().forEach((t) => t.stop())
          return
        }
        stream = s
        ctx = new AudioContext()
        const src = ctx.createMediaStreamSource(s)
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 512
        src.connect(analyser)
        const data = new Uint8Array(analyser.fftSize)
        const tick = () => {
          analyser.getByteTimeDomainData(data)
          let sum = 0
          for (let i = 0; i < data.length; i++) {
            const v = (data[i]! - 128) / 128
            sum += v * v
          }
          setLevel(Math.min(1, Math.sqrt(sum / data.length) * 4))
          raf = requestAnimationFrame(tick)
        }
        tick()
      })
      .catch(() => alive && setLevel(0))
    return () => {
      alive = false
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
      void ctx?.close().catch(() => undefined)
    }
  }, [active, deviceId, permission])
  return { level, live: permission === 'granted' }
}
