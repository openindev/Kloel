import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Store } from './store.js';
import { requireRequestPermission } from './memberships/access.js';
import { MembershipError } from './memberships/service.js';
import { digest } from './oauth/crypto.js';

/** "URL da empresa": um apelido público (/c/<slug>, /w/<slug>/...) que aponta para o endereço técnico o-<hash> da organização. */
const COLLECTION = 'company-slugs';
/**
 * Apelido que a empresa deixou de usar ao trocar a URL: continua dela por RETIRED_DAYS (links /c e /w já divulgados seguem
 * levando a ela) e nenhuma outra empresa o pega nesse prazo. Limite: KEEP_RETIRED reservas vigentes por empresa — com o limite
 * atingido, o apelido que sai fica livre na hora (uma reserva concedida nunca é encurtada).
 * A dona ATUAL de um apelido sempre prevalece: a reserva só existe enquanto ninguém usa o apelido e some quando outra empresa o pega.
 */
const RETIRED = 'company-slugs-retired';
const RETIRED_DAYS = 90, KEEP_RETIRED = 2;
const RESERVED = new Set(['app', 'api', 'admin', 'ajuda', 'login', 'kloel', 'www', 'suporte', 'planos']);
const SLUG = z.string().min(3).max(48).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).refine(s => !RESERVED.has(s) && !/^o-[a-f0-9]{24}$/.test(s));
let storeRef: Store | undefined;
export const technicalOrgSlug = (tenant: string) => `o-${digest(tenant).slice(0, 24)}`;

function owner(store: Store, slug: string): string | undefined {
  const r = store.db.prepare("SELECT tenant_id FROM entities WHERE collection=? AND json_extract(body,'$.slug')=? LIMIT 1").get(COLLECTION, slug) as { tenant_id?: string } | undefined;
  return r?.tenant_id;
}
const live = (row: Record<string, unknown>, now = Date.now()) => Date.parse(String(row.expiresAt)) > now;
/** Empresa a quem o apelido leva: a dona atual ou, sem dona atual, a empresa que o aposentou há menos de RETIRED_DAYS. */
export function companySlugHolder(store: Store, slug: string): string | undefined {
  const current = owner(store, slug); if (current) return current;
  const rows = store.db.prepare("SELECT tenant_id, body FROM entities WHERE collection=? AND json_extract(body,'$.slug')=? ORDER BY rowid DESC").all(RETIRED, slug) as { tenant_id: string; body: string }[];
  return rows.find(row => live(JSON.parse(row.body)))?.tenant_id;
}
/** Reserva o apelido que a empresa deixou de usar (desde `at`) se ela tem menos de KEEP_RETIRED reservas vigentes; as vencidas saem. */
export function retireCompanySlug(store: Store, tenant: string, slug: string, at = new Date()) {
  const expiresAt = new Date(at.getTime() + RETIRED_DAYS * 86400000).toISOString();
  let held = 0;
  for (const row of store.list(tenant, RETIRED)) if (live(row)) held++; else store.remove(tenant, RETIRED, row.id);
  if (held >= KEEP_RETIRED || !live({ expiresAt })) return false;
  store.create(tenant, RETIRED, { slug, retiredAt: at.toISOString(), expiresAt });
  return true;
}
/** Resolve um apelido para o endereço técnico (ou undefined). */
export function resolveCompanySlug(slug: string): string | undefined {
  if (!storeRef || !SLUG.safeParse(slug).success) return;
  const t = companySlugHolder(storeRef, slug); return t ? technicalOrgSlug(t) : undefined;
}

export function registerCompanySlug(app: FastifyInstance, store: Store) {
  storeRef = store;
  const wrap = (fn: (r: FastifyRequest, p: FastifyReply) => unknown) => async (r: FastifyRequest, p: FastifyReply) => {
    p.header('Cache-Control', 'no-store');
    try { return await fn(r, p); } catch (e) { if (e instanceof MembershipError) return p.code(e.statusCode).send({ error: { code: e.code, message: e.message } }); throw e; }
  };
  app.get('/api/v1/organization/public-slug', wrap(req => {
    const actor = requireRequestPermission(store, req, 'organization:read');
    const row = store.list(actor.tenantId, COLLECTION)[0];
    return { slug: row ? String(row.slug) : null, technicalSlug: technicalOrgSlug(actor.tenantId) };
  }));
  app.get('/api/v1/organization/public-slug/availability', wrap(req => {
    const actor = requireRequestPermission(store, req, 'organization:read');
    const { slug } = z.object({ slug: z.string().max(60) }).strict().parse(req.query);
    if (!SLUG.safeParse(slug).success) return { available: false };
    const t = companySlugHolder(store, slug); return { available: !t || t === actor.tenantId };
  }));
  app.put('/api/v1/organization/public-slug', wrap((req, reply) => {
    const actor = requireRequestPermission(store, req, 'organization:write');
    const parsed = z.object({ slug: z.string().max(60) }).strict().parse(req.body ?? {});
    if (!SLUG.safeParse(parsed.slug).success) return reply.code(400).send({ error: { code: 'invalid_slug', message: 'URL inválida ou reservada.' } });
    const taken = store.transaction(() => {
      const t = companySlugHolder(store, parsed.slug);
      if (t && t !== actor.tenantId) return true;
      const row = store.list(actor.tenantId, COLLECTION)[0];
      if (row?.slug === parsed.slug) return false;
      // O apelido escolhido deixa de ser reserva (da própria empresa ou vencida de outra); o que sai fica reservado para ela.
      for (const r of store.db.prepare("SELECT tenant_id, id FROM entities WHERE collection=? AND json_extract(body,'$.slug')=?").all(RETIRED, parsed.slug) as { tenant_id: string; id: string }[]) store.remove(r.tenant_id, RETIRED, r.id);
      if (row && typeof row.slug === 'string') retireCompanySlug(store, actor.tenantId, row.slug);
      if (row) store.update(actor.tenantId, COLLECTION, row.id, { slug: parsed.slug }); else store.create(actor.tenantId, COLLECTION, { slug: parsed.slug });
      return false;
    });
    if (taken) return reply.code(409).send({ error: { code: 'slug_taken', message: 'Esta URL já está em uso por outra empresa.' } });
    return { slug: parsed.slug, technicalSlug: technicalOrgSlug(actor.tenantId) };
  }));
}
