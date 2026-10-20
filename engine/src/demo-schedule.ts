/**
 * Regra única da agenda pública de demonstração (nota do operador "Agendamento de Demo", Ordem Funil › 6. Agendar uma Demonstração):
 * só os 3 próximos dias úteis a partir da visita; segunda só à tarde (13:00–18:30), terça a quinta 09:00–18:30,
 * sexta só pela manhã (09:00–12:00, último início 12:00), sábado e domingo nunca; horários a cada 15 minutos.
 * Tudo em America/Sao_Paulo, qualquer que seja o fuso do processo ou do visitante (o instante vem do Intl, não do fuso local).
 * Dia da visita (decisão documentada): entra e conta como 1 dos 3 dias úteis somente se ainda tiver horário da regra no futuro;
 * só os horários estritamente futuros são oferecidos. Ex.: sábado 17/10 18:02 → seg 19 (13:00…), ter 20, qua 21;
 * segunda 08:00 → seg (13:00…), ter, qua; quinta 19:00 → sex (09:00–12:00), seg, ter.
 * Espelho do lado web: web/src/site/pages/demo/schedule.ts (mesma regra, para exibir); aqui ela valida a reserva.
 */
export const DEMO_TZ = 'America/Sao_Paulo';
export const DEMO_STEP_MIN = 15;
export const DEMO_BOOKABLE_DAYS = 3;
/** Janela de início por dia da semana (0 = domingo). */
export const DEMO_WINDOWS: Readonly<Record<number, readonly [string, string] | null>> = { 0: null, 1: ['13:00', '18:30'], 2: ['09:00', '18:30'], 3: ['09:00', '18:30'], 4: ['09:00', '18:30'], 5: ['09:00', '12:00'], 6: null };
export type DemoDay = { date: string; times: string[] };

const pad = (n: number) => String(n).padStart(2, '0');
const spParts = new Intl.DateTimeFormat('en-US', { timeZone: DEMO_TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
/** Relógio de parede de São Paulo num instante: dia AAAA-MM-DD e o mesmo relógio lido como UTC (ms). */
function wall(at: number) {
  const p = Object.fromEntries(spParts.formatToParts(new Date(at)).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, ms: Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second)) };
}
const offsetAt = (at: number) => wall(at).ms - Math.floor(at / 1000) * 1000;
/** Instante absoluto de AAAA-MM-DD HH:MM no relógio de São Paulo (hoje UTC−3; segue o Intl se o fuso mudar). */
export function demoInstant(date: string, time: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const local = Date.UTC(y!, m! - 1, d!, Number(time.slice(0, 2)), Number(time.slice(3, 5)));
  const first = local - offsetAt(local), second = local - offsetAt(first);
  return new Date(second);
}
/** Dia (AAAA-MM-DD) em São Paulo no instante dado. */
export const demoToday = (now: Date) => wall(now.getTime()).date;
const noon = (k: string) => { const [y, m, d] = k.split('-').map(Number); return new Date(Date.UTC(y!, m! - 1, d!, 12)); };
export const demoAddDays = (k: string, n: number) => { const t = noon(k); t.setUTCDate(t.getUTCDate() + n); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`; };
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
/** Horários da regra num dia (sem olhar o relógio): vazio no fim de semana. */
export function demoRuleTimes(date: string): string[] {
  const w = DEMO_WINDOWS[noon(date).getUTCDay()]; if (!w) return [];
  const out: string[] = []; for (let m = toMin(w[0]); m <= toMin(w[1]); m += DEMO_STEP_MIN) out.push(`${pad(Math.floor(m / 60))}:${pad(m % 60)}`); return out;
}
/** Os 3 dias úteis reserváveis no instante `now` e seus horários futuros (regra pura; a agenda ocupada é aplicada depois). */
export function demoSchedule(now: Date = new Date()): DemoDay[] {
  const out: DemoDay[] = [], clock = wall(now.getTime());
  // Hoje: só o que começa depois do relógio de São Paulo (comparação de relógio de parede; dias seguintes são todos futuros).
  const future = (date: string, t: string) => { const [y, m, d] = date.split('-').map(Number); return Date.UTC(y!, m! - 1, d!, Number(t.slice(0, 2)), Number(t.slice(3, 5))) > clock.ms; };
  for (let date = clock.date, guard = 0; out.length < DEMO_BOOKABLE_DAYS && guard < 14; date = demoAddDays(date, 1), guard++) {
    const times = date === clock.date ? demoRuleTimes(date).filter(t => future(date, t)) : demoRuleTimes(date);
    if (times.length) out.push({ date, times });
  }
  return out;
}
/** Validação do servidor: o horário pertence à regra e está entre os reserváveis agora. */
export const isDemoSlotBookable = (date: string, time: string, now: Date = new Date()) => demoSchedule(now).some(d => d.date === date && d.times.includes(time));
