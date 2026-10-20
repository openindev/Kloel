import { z } from 'zod';
export const uuid = z.string().uuid(), revision = z.number().int().nonnegative().safe();
export const configurationSchema = z.object({ enabled: z.boolean(), actionId: uuid.nullable() }).strict().refine(c => !c.enabled || c.actionId !== null);
export type Configuration = z.infer<typeof configurationSchema>;
export const configureSchema = z.object({ expectedTenantId: z.string().min(1), expectedRevision: revision, idempotencyKey: uuid, configuration: configurationSchema, expectedActionRevision: revision.nullable(), externalSendAcknowledged: z.boolean() }).strict().refine(b => b.configuration.enabled ? b.externalSendAcknowledged && b.expectedActionRevision !== null && b.expectedActionRevision > 0 : !b.externalSendAcknowledged && b.expectedActionRevision === null);
export const payloadSchema = z.object({ schemaVersion: z.literal(1), event: z.literal('conversation.closed'), eventId: uuid, conversationRef: uuid, agentRef: uuid, channel: z.enum(['webchat','whatsapp']), closureEpoch: revision.refine(n => n > 0), closedAt: z.string().datetime(), messageCount: revision }).strict();
export const templates = ['custom_http', 'n8n', 'make', 'zapier'];
export const samplePayload = { schemaVersion: 1, event: 'conversation.closed', eventId: '00000000-0000-4000-8000-000000000001', conversationRef: '00000000-0000-4000-8000-000000000002', agentRef: '00000000-0000-4000-8000-000000000003', channel: 'webchat', closureEpoch: 1, closedAt: '2026-01-01T00:00:00.000Z', messageCount: 2 };
export function dailyLimit() { const v = process.env.AFTER_HTTP_MAX_DISPATCHES_PER_DAY; if (v === undefined || v === '') return 20; return /^[1-9]\d{0,3}$/.test(v) && Number(v) <= 1000 ? Number(v) : null; }
