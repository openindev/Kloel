import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Store } from './store.js';
import { requireRequestPermission } from './memberships/access.js';
import { MembershipError } from './memberships/service.js';

/** "Desconto na sua próxima fatura": envio de avaliação/conteúdo para análise. A equipe recebe por e-mail (KLOEL_TEAM_EMAIL). */
const COLLECTION = 'credit-claims';
const REWARDS = ['omr', 'capterra', 'g2', 'linkedin', 'blog', 'case', 'youtube'] as const;
export function registerCreditClaims(app: FastifyInstance, store: Store) {
  const wrap = (fn: (r: FastifyRequest, p: FastifyReply) => unknown) => async (r: FastifyRequest, p: FastifyReply) => {
    p.header('Cache-Control', 'no-store');
    try { return await fn(r, p); } catch (e) { if (e instanceof MembershipError) return p.code(e.statusCode).send({ error: { code: e.code, message: e.message } }); throw e; }
  };
  const view = (r: Record<string, unknown>) => ({ id: String(r.id), rewardId: String(r.rewardId), evidence: String(r.evidence), note: String(r.note ?? ''), status: String(r.status), createdAt: String(r.createdAt) });
  app.get('/api/v1/credit-claims', wrap(req => {
    const a = requireRequestPermission(store, req, 'organization:read');
    return { items: store.list(a.tenantId, COLLECTION).map(view) };
  }));
  app.post('/api/v1/credit-claims', wrap(async (req, reply) => {
    const a = requireRequestPermission(store, req, 'organization:read');
    const b = z.object({ rewardId: z.enum(REWARDS), evidence: z.string().trim().min(8).max(2000), note: z.string().max(2000).default('') }).strict().parse(req.body ?? {});
    if (store.list(a.tenantId, COLLECTION).some(r => r.rewardId === b.rewardId && r.status === 'pending')) return reply.code(409).send({ error: { code: 'claim_pending', message: 'Você já tem um envio em análise para esta recompensa.' } });
    const row = store.create(a.tenantId, COLLECTION, { ...b, status: 'pending', userId: a.userId ?? null });
    const to = process.env.KLOEL_TEAM_EMAIL || process.env.INTEGRATION_REQUESTS_TO;
    if (to && process.env.RESEND_API_KEY && process.env.RESEND_FROM) {
      const org = store.list(a.tenantId, 'organizations')[0];
      void fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json', 'Idempotency-Key': `credit-claim-${row.id}` }, signal: AbortSignal.timeout(10000),
        body: JSON.stringify({ from: process.env.RESEND_FROM, to: to.split(',').map(s => s.trim()).filter(Boolean), subject: `Kloel — pedido de desconto (${b.rewardId})`, text: `Organização: ${String(org?.name ?? a.tenantId)} (${a.tenantId})\nUsuário: ${a.userId ?? '-'}\nRecompensa: ${b.rewardId}\nEvidência: ${b.evidence}\nObservação: ${b.note || '-'}` }) })
        .then(r => console.log('credit_claim_notified', r.ok)).catch(() => console.log('credit_claim_notified', false));
    }
    return view(row);
  }));
}
