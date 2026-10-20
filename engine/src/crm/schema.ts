import { z } from 'zod';

export class CRMError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message: string) { super(message); }
}
export const crmId = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
export const crmTimezone = z.string().max(100).refine(value => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; } }, 'Use a valid IANA timezone');
export const legacyContactSchema = z.object({
  name: z.string().trim().min(1).max(200), email: z.string().trim().toLowerCase().email().max(254).nullable().optional(),
  phone: z.string().regex(/^\+[1-9]\d{7,14}$/).nullable().optional(), company: z.string().max(200).default(''), notes: z.string().max(20000).default(''),
  tags: z.array(z.string().trim().min(1).max(80)).max(50).default([]), timezone: crmTimezone.default('America/Sao_Paulo'),
  consent: z.object({ whatsapp: z.boolean().default(false), email: z.boolean().default(false), phone: z.boolean().default(false), recordedAt: z.string().datetime({ offset: true }).nullable().optional(), source: z.string().max(500).default('') }).strict().default({ whatsapp: false, email: false, phone: false, source: '' }),
}).strict();
export const endpointInput = z.object({ id: crmId.optional(), value: z.string().trim().min(1).max(254), label: z.enum(['', 'HOME', 'WORK', 'OTHER']).default('') }).strict();
export const fieldValue = z.union([z.string().max(10000), z.boolean()]);
const safeKey = (key: string) => !['__proto__', 'constructor', 'prototype'].includes(key);
export const fieldMap = z.record(fieldValue.nullable()).refine(value => Object.keys(value).length <= 100 && Object.keys(value).every(safeKey), 'Invalid field keys');
export const contactInput = z.object({
  firstName: z.string().trim().max(200).default(''), lastName: z.string().trim().max(200).default(''), displayName: z.string().trim().max(400).optional(), nameMode: z.enum(['structured', 'custom']).optional(),
  phones: z.array(endpointInput).max(20).default([]), emails: z.array(endpointInput).max(20).default([]),
  primaryPhoneId: crmId.nullable().optional(), primaryEmailId: crmId.nullable().optional(),
  company: z.string().max(200).default(''), notes: z.string().max(20000).default(''), tags: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
  timezone: crmTimezone.default('America/Sao_Paulo'), ownerMembershipId: crmId.nullable().default(null), fieldValues: fieldMap.default({}),
}).strict();
export const contactPatch = contactInput.partial().refine(value => Object.keys(value).length > 0, 'Empty patch');
export type ContactInput = z.infer<typeof contactInput>;
export type Endpoint = { id: string; value: string; normalized: string; label: '' | 'HOME' | 'WORK' | 'OTHER' };
export const optionInput = z.object({ id: crmId.optional(), label: z.string().trim().min(1).max(100), status: z.enum(['active', 'archived']).default('active') }).strict();
export const definitionInput = z.object({
  id: crmId.optional(), key: z.string().min(1).max(80).regex(/^[a-z][a-z0-9_]*$/).refine(safeKey), label: z.string().trim().min(1).max(100),
  type: z.enum(['text', 'number', 'boolean', 'choice']), description: z.string().max(2000).default(''),
  status: z.enum(['active', 'archived']).default('active'), aiFill: z.boolean().default(false),
  options: z.array(optionInput).max(100).default([]), example: z.string().max(1000).default(''), showInList: z.boolean().default(false),
  // "Como a Kloel deve encontrar isso?", "Manter atualizado" e "Atualizar somente quando…": instruções da captura automática.
  findHint: z.string().trim().max(2000).default(''), keepUpdated: z.boolean().default(false), updateWhen: z.string().trim().max(500).default(''),
}).strict();
export type FieldDefinition = Omit<z.infer<typeof definitionInput>, 'id' | 'options'> & { id: string; revision: number; options: { id: string; label: string; status: 'active' | 'archived' }[] };
export const clearInput = z.array(z.object({ fieldId: crmId, contactIds: z.array(crmId).min(1).max(10000) }).strict()).max(100);
// clear: "Apagar esses valores ao salvar" — applied in the same transaction as the definitions (never stored in the settings).
export const settingsInput = z.object({ autoCapture: z.boolean().default(false), creationGate: z.string().max(5000).default(''), definitions: z.array(definitionInput).max(100).default([]), clear: clearInput.default([]) }).strict();
export const permissionInput = z.object({
  channel: z.enum(['phone', 'whatsapp', 'email']), identifier: z.string().min(1).max(254), purpose: z.enum(['service', 'marketing']),
  event: z.enum(['granted', 'revoked']), occurredAt: z.string().datetime({ offset: true }), source: z.string().trim().min(1).max(500), evidenceReference: z.string().trim().max(1000).optional(),
}).strict();
export function normalizeIdentifier(kind: 'phone' | 'email', value: string): string {
  if (kind === 'email') return z.string().trim().toLowerCase().email().max(254).parse(value);
  if (!/^\+[\d\s().-]+$/.test(value.trim())) throw new CRMError(400, 'invalid_phone', 'Use telefone internacional com + e código do país.');
  return canonicalPhone(z.string().regex(/^\+[1-9]\d{7,14}$/).parse('+' + value.trim().slice(1).replace(/[^\d]/g, '')));
}
/** Brazilian mobiles are canonical with the 9th digit (+55 DD 9XXXXXXXX), so +556493128506 and +5564993128506 are one identity. */
export function canonicalPhone(e164: string): string {
  const match = /^\+55(\d{2})([6-9]\d{7})$/.exec(e164);
  return match ? `+55${match[1]}9${match[2]}` : e164;
}
export function validateFieldValue(def: FieldDefinition, value: string | boolean, existing = false) {
  if (def.status === 'archived' && !existing) throw new CRMError(409, 'field_archived', 'Campo arquivado não aceita novos valores.');
  if (def.type === 'boolean') { if (typeof value !== 'boolean') throw new CRMError(400, 'invalid_field_value', 'Campo Sim/Não exige boolean.'); }
  else if (typeof value !== 'string') throw new CRMError(400, 'invalid_field_value', 'Campo exige string.');
  else if (def.type === 'number' && (!/^-?(?:0|[1-9]\d*)(?:\.\d{1,12})?$/.test(value) || value.replace(/\D/g, '').length > 38)) throw new CRMError(400, 'invalid_field_value', 'Número exige decimal canônico de até 38 dígitos e 12 casas.');
  else if (def.type === 'choice' && !def.options.some(option => option.id === value && (existing || option.status === 'active'))) throw new CRMError(400, 'invalid_field_value', 'Opção indisponível para esse campo.');
  return value;
}
