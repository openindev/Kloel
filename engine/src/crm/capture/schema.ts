import { z } from 'zod';
import { CRMError, crmId } from '../schema.js';
export const grants = 'crm-capture-grants', jobs = 'crm-capture-jobs', proposals = 'crm-capture-proposals';
export const kinds = ['meta_verified_inbound', 'voice_final_user_transcript', 'public_chat_visitor_message'] as const;
export const keySchema = z.string().min(8).max(128).regex(/^[A-Za-z0-9_.:-]+$/);
export const policySchema = z.object({
  mode: z.enum(['review', 'auto_create_fill_empty']), optIn: z.literal(true), captureContacts: z.boolean().default(false),
  channelIds: z.array(crmId).min(1).max(20), allowedFieldIds: z.array(crmId).max(50).default([]),
  allowTransportMatch: z.boolean().default(false), expiresInDays: z.number().int().min(1).max(90).default(30),
  jobsPerDay: z.number().int().min(1).max(100).default(20), reservedTokensPerDay: z.number().int().min(10000).max(1000000).default(100000),
  maxMessagesPerJob: z.number().int().min(1).max(20).default(10), maxInputChars: z.number().int().min(200).max(24000).default(12000),
}).strict().refine(value => value.captureContacts || value.allowedFieldIds.length > 0, 'Select capture or fields')
  .refine(value => new Set(value.channelIds).size === value.channelIds.length && new Set(value.allowedFieldIds).size === value.allowedFieldIds.length, 'Duplicate IDs');
export type CapturePolicy = z.infer<typeof policySchema>;
export const evidenceSchema = z.object({ sourceEventId: crmId, start: z.number().int().min(0), end: z.number().int().min(1), quote: z.string().min(1).max(2000) }).strict();
export const extractionSchema = z.object({
  candidate: z.enum(['none', 'person']), subject: z.enum(['current_participant', 'third_party', 'ambiguous']),
  gate: z.object({ satisfied: z.boolean(), evidence: z.array(evidenceSchema).max(10) }).strict(),
  values: z.array(z.object({ fieldId: crmId, value: z.union([z.string().max(10000), z.boolean()]), evidence: z.array(evidenceSchema).min(1).max(10) }).strict()).max(53),
  identityClaims: z.array(z.object({ kind: z.enum(['phone', 'email']), value: z.string().max(254), evidence: z.array(evidenceSchema).min(1).max(10) }).strict()).max(10),
}).strict();
export type Extraction = z.infer<typeof extractionSchema>;
export function fail(code: string, status = 409): never { throw new CRMError(status, code, 'Captura indisponível ou alterada; revise a operação.'); }
export const errorCode = (error: unknown) => error instanceof CRMError ? error.code : error instanceof z.ZodError ? 'capture_invalid_output' : 'capture_generation_unknown';
