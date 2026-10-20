import { z } from 'zod';

export const scalarSchema = z.union([z.string().max(1000), z.number().finite(), z.boolean()]);
export type Scalar = z.infer<typeof scalarSchema>;
const reserved = new Set(['__proto__', 'prototype', 'constructor']);
const variable = z.object({ name: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,47}$/).refine(v => !reserved.has(v)), type: z.enum(['text', 'number', 'boolean']), defaultValue: scalarSchema }).strict();
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const range = z.object({ start: time, end: time, overnight: z.boolean() }).strict();
const condition = z.object({ field: z.string().max(80), operator: z.enum(['is_set', 'is_empty', 'equals', 'contains', 'starts_with', 'gt', 'gte', 'lt', 'lte', 'time_between']), value: z.union([scalarSchema, range]).optional() }).strict();
export const systemTypes: Record<string, 'text' | 'number' | 'time'> = { agentName: 'text', companyName: 'text', surface: 'text', direction: 'text', phone: 'text', localTime: 'time', weekday: 'number', startedAt: 'text' };
const template = z.string().max(1000);
const base = z.object({ enabled: z.boolean(), timezone: z.string().min(1).max(100).refine(value => { try { new Intl.DateTimeFormat('en', { timeZone: value }).format(0); return true; } catch { return false; } }, 'Invalid IANA timezone'), variables: z.array(variable).max(50), defaultGreeting: template, greetingRules: z.array(z.object({ conditions: z.array(condition).min(1).max(8), greeting: template }).strict()).max(32), testContext: z.record(scalarSchema) }).strict();
const scalarType = (v: Scalar) => typeof v === 'string' ? 'text' : typeof v;
export const configurationSchema = base.superRefine((c, ctx) => {
  const invalid = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  if (Buffer.byteLength(JSON.stringify(c)) > 32768) invalid('Configuration exceeds 32KiB');
  const variables = new Map(c.variables.map(v => [v.name, v]));
  if (variables.size !== c.variables.length) invalid('Duplicate variable');
  for (const v of c.variables) if (scalarType(v.defaultValue) !== v.type) invalid('Default type mismatch');
  for (const [name, value] of Object.entries(c.testContext)) if (!variables.has(name) || scalarType(value) !== variables.get(name)!.type) invalid('Test context requires declared typed values');
  const fieldType = (field: string) => field.startsWith('vars.') ? variables.get(field.slice(5))?.type : field.startsWith('system.') && Object.hasOwn(systemTypes, field.slice(7)) ? systemTypes[field.slice(7)] : undefined;
  for (const rule of c.greetingRules) for (const r of rule.conditions) {
    const type = fieldType(r.field);
    if (!type || r.field === 'system.startedAt') { invalid('Unknown condition field'); continue; }
    if (['is_set', 'is_empty'].includes(r.operator)) { if (type !== 'text' || r.value !== undefined) invalid('Presence operator requires text and no value'); continue; }
    if (type === 'time') {
      const p = range.safeParse(r.value);
      if (r.operator !== 'time_between' || !p.success || p.data.start === p.data.end || p.data.overnight !== (p.data.start > p.data.end)) invalid('Explicit time range required');
    } else if (type === 'text') { if (!['equals', 'contains', 'starts_with'].includes(r.operator) || typeof r.value !== 'string') invalid('Invalid text operator'); }
    else if (type === 'number') { if (!['equals', 'gt', 'gte', 'lt', 'lte'].includes(r.operator) || typeof r.value !== 'number' || r.field === 'system.weekday' && (!Number.isInteger(r.value) || r.value < 0 || r.value > 6)) invalid('Invalid number operator'); }
    else if (r.operator !== 'equals' || typeof r.value !== 'boolean') invalid('Invalid boolean operator');
  }
  for (const text of [c.defaultGreeting, ...c.greetingRules.map(r => r.greeting)]) {
    const remaining = text.replace(/\{\{\s*([A-Za-z][A-Za-z0-9_.]*)\s*\}\}/g, (_match, field: string) => { if (!fieldType(field)) invalid('Undeclared placeholder'); return ''; });
    if (remaining.includes('{{') || remaining.includes('}}')) invalid('Malformed placeholder');
  }
});
export type Configuration = z.infer<typeof configurationSchema>;
export const defaultConfiguration = (): Configuration => ({ enabled: false, timezone: 'America/Sao_Paulo', variables: [], defaultGreeting: '', greetingRules: [], testContext: {} });
export const testFactsSchema = z.object({ startedAt: z.string().datetime({ offset: true }).optional(), direction: z.enum(['incoming', 'outgoing', 'unknown']).optional(), phone: z.string().regex(/^\+[1-9]\d{7,14}$/).optional() }).strict();
export type TestFacts = z.infer<typeof testFactsSchema>;
/** Check raw keys too: parsers must never silently discard a prototype-shaped input. */
export function parseConfiguration(raw: unknown): Configuration {
  const visit = (value: unknown) => { if (!value || typeof value !== 'object') return; for (const [k, v] of Object.entries(value)) { if (reserved.has(k)) throw new z.ZodError([{ code: 'custom', path: [], message: 'Reserved object key' }]); visit(v); } };
  visit(raw); return configurationSchema.parse(raw);
}
