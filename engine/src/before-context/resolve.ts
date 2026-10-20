import type { Configuration, Scalar, TestFacts } from './schema.js';
import { DomainError } from '../domains.js';

export type Facts = { agentName: string; companyName: string; surface: 'private' | 'webchat' | 'voice_private' | 'voice_incoming'; direction: 'incoming' | 'outgoing' | 'unknown'; phone: string | null; localTime: string; weekday: number; startedAt: string };
export function resolveBefore(c: Configuration, input: { mode: 'live' | 'test'; agentName: string; companyName: string; surface: 'private' | 'webchat' | 'voice_private' | 'voice_incoming'; startedAt: string; testFacts?: TestFacts }, external?: Record<string, Scalar>) {
  const synthetic = input.mode === 'test' ? input.testFacts : undefined;
  const startedAt = synthetic?.startedAt ?? input.startedAt;
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: c.timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(startedAt));
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  const facts: Facts = { agentName: input.agentName, companyName: input.companyName, surface: input.surface, direction: synthetic?.direction ?? (input.surface === 'voice_incoming' ? 'incoming' : 'unknown'), phone: synthetic?.phone ?? null, startedAt,
    localTime: `${part('hour')}:${part('minute')}`, weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(part('weekday')) };
  const values: Record<string, Scalar> = Object.create(null);
  const provenance = c.variables.map(v => {
    const test = input.mode === 'test' && Object.hasOwn(c.testContext, v.name);
    const remote = input.mode === 'live' && external !== undefined && Object.hasOwn(external, v.name);
    values[v.name] = test ? c.testContext[v.name] : remote ? external![v.name] : v.defaultValue;
    return { name: v.name, source: test ? 'test' as const : remote ? 'external' as const : 'default' as const, reason: test ? 'test_value' as const : remote ? 'external_value' as const : 'default_value' as const };
  });
  const get = (field: string): Scalar | null => field.startsWith('vars.') ? values[field.slice(5)] : facts[field.slice(7) as keyof Facts];
  const matches = (r: Configuration['greetingRules'][number]['conditions'][number]) => {
    const value = get(r.field);
    switch (r.operator) {
      case 'is_set': return value !== null && value !== undefined && value !== '';
      case 'is_empty': return value === null || value === undefined || value === '';
      case 'equals': return value === r.value;
      case 'contains': return typeof value === 'string' && value.includes(r.value as string);
      case 'starts_with': return typeof value === 'string' && value.startsWith(r.value as string);
      case 'gt': return typeof value === 'number' && value > (r.value as number);
      case 'gte': return typeof value === 'number' && value >= (r.value as number);
      case 'lt': return typeof value === 'number' && value < (r.value as number);
      case 'lte': return typeof value === 'number' && value <= (r.value as number);
      case 'time_between': { const range = r.value as { start: string; end: string; overnight: boolean }; return typeof value === 'string' && (range.overnight ? value >= range.start || value < range.end : value >= range.start && value < range.end); }
    }
  };
  const index = c.greetingRules.findIndex(r => r.conditions.every(matches)), selected = index < 0 ? c.defaultGreeting : c.greetingRules[index].greeting;
  const greeting = selected.replace(/\{\{\s*([A-Za-z][A-Za-z0-9_.]*)\s*\}\}/g, (_match, field: string) => String(get(field) ?? ''));
  if (greeting.length > 1000 || Buffer.byteLength(JSON.stringify({ values, facts })) > 16384) throw new DomainError(400, 'before_context_result_too_large', 'O contexto ou saudação resolvidos excedem o limite.');
  return { mode: input.mode, ruleIndex: index < 0 ? null : index, greeting, values, provenance, facts, externalSources: input.mode === 'live' && external !== undefined };
}
export type Resolution = ReturnType<typeof resolveBefore>;
