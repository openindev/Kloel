/**
 * Regras de agenda das reuniões públicas (demo de cliente, conversa de parceria e formulário da landing de campanha).
 *
 * Regra do operador (nota "Agendamento de Demo", Ordem Funil › 6. Agendar uma Demonstração): só os 3 próximos dias úteis
 * a partir da visita; horários a cada 15 min; segunda só à tarde (13:00–18:30); terça a quinta 09:00–18:30; sexta só pela
 * manhã (09:00–12:00 — último início 12:00, INFERIDO de "Sexta só de manhã"); sábado e domingo nunca.
 * Ex. da nota: sábado 17/10 18:02 → seg 19 a partir das 13:00, ter 20 e qua 21 a partir das 09:00.
 * Dia da visita (decisão documentada): entra e conta como 1 dos 3 dias úteis somente se ainda tiver horário da regra no
 * futuro; só os horários futuros aparecem (segunda 08:00 → seg à tarde, ter, qua; quinta 19:00 → sex, seg, ter).
 * Tudo em America/Sao_Paulo, qualquer que seja o fuso do navegador (o fuso escolhido só muda a exibição).
 * Função única: `demoSchedule(now)`. O motor valida a reserva com a mesma regra (engine/src/demo-schedule.ts).
 */

export const SP_TZ = 'America/Sao_Paulo'
export type DayKey = string // AAAA-MM-DD

const pad = (n: number) => String(n).padStart(2, '0')

const spParts = new Intl.DateTimeFormat('en-US', { timeZone: SP_TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
/** Relógio de parede de São Paulo num instante: dia AAAA-MM-DD e o mesmo relógio lido como UTC (ms). */
function spWall(at: number) {
  const p = Object.fromEntries(spParts.formatToParts(new Date(at)).map((x) => [x.type, x.value]))
  return { day: `${p.year}-${p.month}-${p.day}`, ms: Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second)) }
}

export function todayKey(now = new Date()): DayKey {
  return spWall(now.getTime()).day
}

export function keyParts(k: DayKey) {
  const [y, m, d] = k.split('-').map(Number)
  return { y: y!, m: m!, d: d! }
}

/** Data UTC ao meio-dia (evita problemas de fuso ao formatar só a data). */
export function keyNoon(k: DayKey) {
  const { y, m, d } = keyParts(k)
  return new Date(Date.UTC(y, m - 1, d, 12))
}

export function addDays(k: DayKey, n: number): DayKey {
  const dt = keyNoon(k)
  dt.setUTCDate(dt.getUTCDate() + n)
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`
}

export const weekday = (k: DayKey) => keyNoon(k).getUTCDay()
export const isBusinessDay = (k: DayKey) => weekday(k) !== 0 && weekday(k) !== 6

/** Próximos `n` dias úteis a partir do dia seguinte (sem horários; a agenda pública usa `demoSchedule`). */
export function nextBusinessDays(n: number, from: DayKey = todayKey()): DayKey[] {
  const out: DayKey[] = []
  let k = from
  while (out.length < n) {
    k = addDays(k, 1)
    if (isBusinessDay(k)) out.push(k)
  }
  return out
}

export const DEMO_STEP_MIN = 15
export const DEMO_BOOKABLE_DAYS = 3
/** Janelas de início do time comercial por dia da semana (0 = domingo). */
export const DEMO_WINDOWS: Readonly<Record<number, readonly [string, string] | null>> = {
  0: null,
  1: ['13:00', '18:30'],
  2: ['09:00', '18:30'],
  3: ['09:00', '18:30'],
  4: ['09:00', '18:30'],
  5: ['09:00', '12:00'],
  6: null,
}

export function slotsBetween(start: string, end: string, stepMin: number): string[] {
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
  const out: string[] = []
  for (let m = toMin(start); m <= toMin(end); m += stepMin) out.push(`${pad(Math.floor(m / 60))}:${pad(m % 60)}`)
  return out
}

/** Horários da regra num dia, sem olhar o relógio (vazio no fim de semana). */
export function demoRuleTimes(k: DayKey): string[] {
  const w = DEMO_WINDOWS[weekday(k)]
  return w ? slotsBetween(w[0], w[1], DEMO_STEP_MIN) : []
}

export type DemoDay = { day: DayKey; times: string[] }

/** Os 3 dias úteis reserváveis no instante `now` e os seus horários futuros (regra pura; a agenda ocupada é aplicada depois). */
export function demoSchedule(now: Date = new Date()): DemoDay[] {
  const out: DemoDay[] = []
  const clock = spWall(now.getTime())
  const future = (k: DayKey, t: string) => {
    const { y, m, d } = keyParts(k)
    return Date.UTC(y, m - 1, d, Number(t.slice(0, 2)), Number(t.slice(3, 5))) > clock.ms
  }
  for (let k = clock.day, guard = 0; out.length < DEMO_BOOKABLE_DAYS && guard < 14; k = addDays(k, 1), guard++) {
    const times = k === clock.day ? demoRuleTimes(k).filter((t) => future(k, t)) : demoRuleTimes(k)
    if (times.length) out.push({ day: k, times })
  }
  return out
}

/** Dias reserváveis agora (AAAA-MM-DD). */
export const demoDays = (now: Date = new Date()) => demoSchedule(now).map((d) => d.day)

/** Horários livres de um dia reservável (regra + relógio, menos os ocupados/reservados em `taken`, chave "AAAA-MM-DD HH:MM"). */
export function demoSlots(k: DayKey, taken: Set<string> = new Set(), now: Date = new Date()): string[] {
  return (demoSchedule(now).find((d) => d.day === k)?.times ?? []).filter((t) => !taken.has(`${k} ${t}`))
}

/** Conversa de parceria: mesma agenda pública da demonstração (30 min, 3 próximos dias úteis, 15 min). */
export const partnerSlots = (k: DayKey, taken: Set<string> = new Set(), now: Date = new Date()) => demoSlots(k, taken, now)

/** Instante absoluto de um horário de São Paulo (hoje UTC−3; segue o fuso real do Intl se ele mudar). */
export function instantOf(k: DayKey, time: string): Date {
  const { y, m, d } = keyParts(k)
  const local = Date.UTC(y, m - 1, d, Number(time.slice(0, 2)), Number(time.slice(3, 5)))
  const offsetAt = (at: number) => spWall(at).ms - Math.floor(at / 1000) * 1000
  return new Date(local - offsetAt(local - offsetAt(local)))
}

/** Horário exibido no fuso escolhido. */
export function timeIn(k: DayKey, time: string, tz: string) {
  if (tz === SP_TZ) return time
  return new Intl.DateTimeFormat('pt-BR', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(instantOf(k, time))
}

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', ...opts })

/** "SEG." */
export const weekdayShort = (k: DayKey) => fmt({ weekday: 'short' }).format(keyNoon(k)).replace(/\.?$/, '.').toUpperCase()
/** "outubro de 2026" */
export const monthLabel = (k: DayKey) => fmt({ month: 'long', year: 'numeric' }).format(keyNoon(k))
/** "segunda-feira, 19 de outubro" */
export const longDate = (k: DayKey) => fmt({ weekday: 'long', day: 'numeric', month: 'long' }).format(keyNoon(k))
/** "seg., 19/10" */
export const shortDate = (k: DayKey) => `${fmt({ weekday: 'short' }).format(keyNoon(k)).replace(/\.?$/, '.')}, ${pad(keyParts(k).d)}/${pad(keyParts(k).m)}`

export const TIMEZONES = [
  { id: 'America/Sao_Paulo', label: 'America/Sao Paulo' },
  { id: 'America/Manaus', label: 'America/Manaus' },
  { id: 'America/Rio_Branco', label: 'America/Rio Branco' },
  { id: 'America/Noronha', label: 'America/Noronha' },
  { id: 'Europe/Lisbon', label: 'Europe/Lisbon' },
  { id: 'America/New_York', label: 'America/New York' },
]

/** Gera e baixa um arquivo .ics (convite de calendário) localmente. */
export function downloadIcs({ title, description, start, minutes, filename, location }: { title: string; description: string; start: Date; minutes: number; filename: string; location?: string }) {
  const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const end = new Date(start.getTime() + minutes * 60000)
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;')
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Kloel AI//Demonstracao local//PT-BR',
    'BEGIN:VEVENT',
    `UID:${stamp(start)}-${Math.random().toString(36).slice(2)}@kloel.local`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${esc(title)}`,
    `DESCRIPTION:${esc(description)}`,
    location ? `LOCATION:${esc(location)}` : '',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
    .filter(Boolean)
    .join('\r\n')
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Link da reunião no formato de código de sala (xxx-xxxx-xxx), derivado do id da reserva; sala gerada pelo motor local. */
export const fakeMeetLink = (id: string) => {
  const c = id.replace(/[^a-z0-9]/gi, '').toLowerCase().padStart(10, 'k').slice(-10)
  return `meet.kloel.ai/${c.slice(0, 3)}-${c.slice(3, 7)}-${c.slice(7)}`
}
