import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Store } from './store.js';
import { requireRequestPermission } from './memberships/access.js';
import { MembershipError } from './memberships/service.js';
import { phoneVariants } from './lead-link.js';

/** "Bloquear contato" / "WhatsApp IA" por contato (Configurações de comunicação). Guardado à parte do contrato do CRM. */
const COLLECTION = 'contact-communication';
let storeRef: Store | undefined;

function contactPhones(row: Record<string, unknown>): string[] {
  const list = Array.isArray(row.phones) ? (row.phones as { normalized?: unknown; value?: unknown }[]).map(p => String(p.normalized ?? p.value ?? '')) : [];
  if (typeof row.phone === 'string') list.push(row.phone);
  return list.filter(Boolean);
}

/** True when a contact of this org that owns this number is blocked: the agent never answers or calls it. */
export function isPhoneBlocked(store: Store, tenant: string, phone: string | null | undefined): boolean {
  if (!tenant || !phone) return false;
  const blocked = store.list(tenant, COLLECTION).filter(r => r.blocked === true).map(r => String(r.contactId));
  if (!blocked.length) return false;
  const wanted = new Set(phoneVariants(phone));
  return blocked.some(id => { const c = store.get(tenant, 'contacts', id); return !!c && contactPhones(c).some(p => phoneVariants(p).some(v => wanted.has(v))); });
}
/** Para rotas sem store (ligação de saída da plataforma). */
export function isPhoneBlockedForProvider(phone: string): boolean {
  const tenant = process.env.PROVIDER_TENANT_ID;
  return !!storeRef && !!tenant && isPhoneBlocked(storeRef, tenant, phone);
}

export function registerContactBlocks(app: FastifyInstance, store: Store) {
  storeRef = store;
  const wrap = (fn: (r: FastifyRequest, p: FastifyReply) => unknown) => async (r: FastifyRequest, p: FastifyReply) => {
    p.header('Cache-Control', 'no-store');
    try { return await fn(r, p); } catch (e) { if (e instanceof MembershipError) return p.code(e.statusCode).send({ error: { code: e.code, message: e.message } }); throw e; }
  };
  const view = (r: Record<string, unknown>) => ({ contactId: String(r.contactId), blocked: r.blocked === true, whatsappAi: r.whatsappAi === true, updatedAt: String(r.updatedAt ?? '') });
  app.get('/api/v1/crm/contact-communication', wrap(req => {
    const actor = requireRequestPermission(store, req, 'contacts:read');
    return { items: store.list(actor.tenantId, COLLECTION).filter(r => store.get(actor.tenantId, 'contacts', String(r.contactId))).map(view) };
  }));
  app.put('/api/v1/crm/contacts/:id/communication', wrap((req, reply) => {
    const actor = requireRequestPermission(store, req, 'contacts:write');
    const { id } = z.object({ id: z.string().min(1).max(128) }).strict().parse(req.params);
    const body = z.object({ blocked: z.boolean().optional(), whatsappAi: z.boolean().optional() }).strict().parse(req.body ?? {});
    if (!store.get(actor.tenantId, 'contacts', id)) return reply.code(404).send({ error: { code: 'not_found', message: 'Contato não encontrado.' } });
    const old = store.list(actor.tenantId, COLLECTION).find(r => r.contactId === id);
    const next = { contactId: id, blocked: body.blocked ?? old?.blocked === true, whatsappAi: (body.blocked ?? old?.blocked) === true ? false : body.whatsappAi ?? old?.whatsappAi === true, updatedBy: actor.userId ?? null };
    const row = old ? store.update(actor.tenantId, COLLECTION, String(old.id), next)! : store.create(actor.tenantId, COLLECTION, next);
    return view(row);
  }));
}
