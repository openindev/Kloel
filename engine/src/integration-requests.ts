import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Store } from './store.js';
import { requireRequestPermission } from './memberships/access.js';
import { MembershipError } from './memberships/service.js';

/**
 * Catálogo de Integrações: "Solicitar acesso" (Acesso antecipado) e "Notificar" (Em breve).
 * Fica registrado por organização; a equipe Kloel recebe um e-mail quando INTEGRATION_REQUESTS_TO está definido.
 */
const COLLECTION = 'integration-requests';
const body = z.object({ integration: z.string().min(1).max(80).regex(/^[a-z0-9][a-z0-9-]*$/), kind: z.enum(['request', 'notify']) }).strict();

async function notifyTeam(subject: string, text: string) {
  const to = process.env.INTEGRATION_REQUESTS_TO; if (!to || !process.env.RESEND_API_KEY || !process.env.RESEND_FROM) return false;
  const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify({ from: process.env.RESEND_FROM, to: to.split(',').map(s => s.trim()).filter(Boolean), subject, text }), signal: AbortSignal.timeout(10000) }).catch(() => undefined);
  return !!r?.ok;
}

export function registerIntegrationRequests(app: FastifyInstance, store: Store) {
  const wrap = (fn: (r: FastifyRequest, p: FastifyReply) => unknown) => async (r: FastifyRequest, p: FastifyReply) => {
    p.header('Cache-Control', 'no-store');
    try { return await fn(r, p); } catch (e) { if (e instanceof MembershipError) return p.code(e.statusCode).send({ error: { code: e.code, message: e.message } }); throw e; }
  };
  const view = (r: Record<string, unknown>) => ({ id: String(r.id), integration: String(r.integration), kind: String(r.kind), requestedAt: String(r.createdAt), requestedByUserId: r.userId ?? null });
  app.get('/api/v1/integration-requests', wrap(req => {
    const a = requireRequestPermission(store, req, 'organization:read');
    return { items: store.list(a.tenantId, COLLECTION).map(view) };
  }));
  app.post('/api/v1/integration-requests', wrap(async req => {
    const a = requireRequestPermission(store, req, 'organization:read');
    const b = body.parse(req.body ?? {});
    const old = store.list(a.tenantId, COLLECTION).find(r => r.integration === b.integration && r.kind === b.kind);
    if (old) return view(old);
    const row = store.create(a.tenantId, COLLECTION, { ...b, userId: a.userId ?? null });
    const org = store.list(a.tenantId, 'organizations')[0] ?? store.list(a.tenantId, 'organization-settings')[0];
    void notifyTeam(`Kloel — ${b.kind === 'request' ? 'pedido de acesso antecipado' : 'aviso de lançamento'}: ${b.integration}`,
      `Organização: ${String(org?.name ?? a.tenantId)} (${a.tenantId})\nUsuário: ${a.userId ?? '-'}\nIntegração: ${b.integration}\nTipo: ${b.kind === 'request' ? 'Solicitar acesso' : 'Notificar quando disponível'}`).then(ok => console.log('integration_request_notified', ok));
    return view(row);
  }));
  // "Você será notificado" pode ser desfeito; pedido de acesso, não.
  app.delete('/api/v1/integration-requests/:integration/notify', wrap(req => {
    const a = requireRequestPermission(store, req, 'organization:read');
    const { integration } = z.object({ integration: z.string().min(1).max(80) }).strict().parse(req.params);
    for (const r of store.list(a.tenantId, COLLECTION).filter(r => r.integration === integration && r.kind === 'notify')) store.remove(a.tenantId, COLLECTION, r.id);
    return { ok: true };
  }));
}
