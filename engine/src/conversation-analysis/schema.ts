import { z } from 'zod';
export const uuid = z.string().uuid(), version = z.string().regex(/^[a-f0-9]{64}$/), revision = z.number().int().nonnegative().safe();
const reserved = new Set(['no_ai','human_handoff','manual_only','requires_review','__proto__','constructor','prototype']);
export const tag = z.string().trim().min(1).max(80).refine(v => !reserved.has(v.toLowerCase()));
export const configurationSchema = z.object({ enabled: z.boolean(), allowedTags: z.array(tag).max(30).refine(v => new Set(v).size === v.length) }).strict();
export type Configuration = z.infer<typeof configurationSchema>;
export const defaultConfiguration = (): Configuration => ({ enabled: false, allowedTags: [] });
export const modelResultSchema = z.object({ summary: z.object({ text: z.string().trim().min(1).max(2000), sourceMessageIds: z.array(uuid).min(1).max(20) }).strict(), tagProposals: z.array(z.object({ tag, sourceMessageIds: z.array(uuid).min(1).max(8) }).strict()).max(10) }).strict();

// Provider shape enforcement complements, and never replaces, the local bounds and reference checks above.
export const modelResultFormat = {
  type: 'json_schema', name: 'after_conversation_analysis', strict: true,
  schema: {
    type: 'object', additionalProperties: false, required: ['summary', 'tagProposals'],
    properties: {
      summary: {
        type: 'object', additionalProperties: false, required: ['text', 'sourceMessageIds'],
        properties: { text: { type: 'string' }, sourceMessageIds: { type: 'array', items: { type: 'string' } } },
      },
      tagProposals: {
        type: 'array', items: {
          type: 'object', additionalProperties: false, required: ['tag', 'sourceMessageIds'],
          properties: { tag: { type: 'string' }, sourceMessageIds: { type: 'array', items: { type: 'string' } } },
        },
      },
    },
  },
} as const;
export function dailyLimit() { const value = process.env.AFTER_CONVERSATION_MAX_ANALYSES_PER_DAY; if (value === undefined || value === '') return 20; if (!/^[1-9]\d{0,3}$/.test(value) || Number(value) > 1000) return null; return Number(value); }
