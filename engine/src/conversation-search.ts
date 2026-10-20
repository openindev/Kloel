import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Store, Entity } from './store.js';
import { DomainError } from './domains.js';
import { MembershipError } from './memberships/service.js';
import { capture, closures } from './conversation-analysis/authority.js';
import { analysisView } from './conversation-analysis/service.js';

const query = z.object({ q: z.string().trim().min(1).max(300), page: z.coerce.number().int().min(1).max(100000).default(1), limit: z.coerce.number().int().min(1).max(100).default(100) }).strict();
const normalize = (value: unknown) => typeof value === 'string' ? value.normalize('NFKC').toLocaleLowerCase('pt-BR') : '';
/** Read-only IDs allow the existing Inbox search to cover unloaded transcripts without disclosing their content. */
export async function registerConversationSearch(app: FastifyInstance, store: Store) {
  app.get('/api/v1/conversation-search', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    try {
      const actor = capture(store, request, ['conversations:read']), { q, page, limit } = query.parse(request.query), needle = normalize(q);
      return store.transaction(() => {
        actor.assertCurrent();
        const conversations = store.list(actor.tenantId, 'conversations').filter(row => ['phone', 'webchat', 'whatsapp'].includes(String(row.channel)));
        const allowed = new Set(conversations.map(row => row.id)), matches = new Set<string>();
        for (const row of conversations) if (normalize(row.subject).includes(needle)) matches.add(row.id);
        for (const row of store.list(actor.tenantId, 'messages')) if (allowed.has(String(row.conversationId)) && normalize(row.content).includes(needle)) matches.add(String(row.conversationId));
        const analyses = new Map<string, Entity[]>();
        for (const row of store.list(actor.tenantId, closures)) {
          const id = String(row.conversationId);
          if (allowed.has(id) && !matches.has(id) && row.status === 'succeeded' && row.invalidated !== true) analyses.set(id, [...(analyses.get(id) ?? []), row]);
        }
        for (const [id, rows] of analyses) {
          rows.sort((a, b) => Number(b.epoch) - Number(a.epoch) || b.id.localeCompare(a.id));
          for (const row of rows) {
            const view = analysisView(store, row);
            if (!view.applicable) continue;
            const result = view.result as { summary?: { text?: unknown } } | null;
            if (normalize(result?.summary?.text).includes(needle)) matches.add(id);
            break;
          }
        }
        const rows = conversations.filter(row => matches.has(row.id)).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
        actor.assertCurrent();
        return { items: rows.slice((page - 1) * limit, page * limit).map(row => ({ id: row.id })), page, limit, total: rows.length, totalPages: Math.ceil(rows.length / limit) };
      });
    } catch (error) {
      if (error instanceof DomainError || error instanceof MembershipError) return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
      if (error instanceof z.ZodError) return reply.code(400).send({ error: { code: 'validation_error', message: 'Confira o termo de busca.' } });
      throw error;
    }
  });
}
