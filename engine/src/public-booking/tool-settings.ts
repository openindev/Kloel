import type { Store } from '../store.js';
/** Opções do recurso "Agendar compromissos" guardadas no estado editorial do assistente (por tipo de evento). */
export function bookingToolSettings(store: Store, tenantId: string, agentId: string, eventTypeId: string) {
  const state = store.list(tenantId, 'agent-editor-states').find(r => r.agentId === agentId)?.state as Record<string, any> | undefined;
  const row = Array.isArray(state?.scheduling) ? state!.scheduling.find((s: any) => s?.provider === 'kloel' && s?.eventTypeId === eventTypeId) : undefined;
  const text = (v: unknown, max: number) => typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '';
  return { name: text(row?.name, 120), description: text(row?.description, 500), activeWindow: ['during', 'outside'].includes(row?.activeWindow) ? row.activeWindow as 'during' | 'outside' : 'any' as const,
    allowBookingLinks: row?.settings?.allowBookingLinks === true, disableNotifications: row?.settings?.disableNotifications === true, businessHours: state?.businessHours };
}
/** Mesmo critério das demais ações do assistente: horário desligado ou ausente vale como aberto. */
export function withinBusinessHours(bh: any, now = new Date()): boolean {
  if (!bh || bh.enabled === false || !Array.isArray(bh.days)) return true;
  const tz = typeof bh.timezone === 'string' && bh.timezone ? bh.timezone : 'America/Sao_Paulo';
  let parts: Record<string, string>;
  try { parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now).map(p => [p.type, p.value])); } catch { return true; }
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(String(parts.weekday)), hm = `${String(parts.hour).replace('24', '00')}:${parts.minute}`;
  const d = bh.days.find((x: any) => x?.day === day);
  return !!d?.enabled && (Array.isArray(d.ranges) ? d.ranges : []).some((r: any) => typeof r?.from === 'string' && typeof r?.to === 'string' && r.from <= hm && hm < r.to);
}
export function bookingToolActive(settings: ReturnType<typeof bookingToolSettings>, now = new Date()) {
  if (settings.activeWindow === 'any') return true;
  return (settings.activeWindow === 'during') === withinBusinessHours(settings.businessHours, now);
}

