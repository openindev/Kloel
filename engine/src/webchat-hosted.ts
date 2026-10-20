import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Entity, Store } from './store.js';
import { requireRequestPermission } from './memberships/access.js';
import { MembershipError } from './memberships/service.js';
import { companySlugHolder, retireCompanySlug, technicalOrgSlug } from './company-slug.js';
import { canonicalWebchatOrigin, hostedChatOrigin, hostedLinkPublished } from './webchat-origins.js';
import { providerAllowedForTenant } from './platform-providers.js';
import { PUBLIC_CHAT_PATHS } from './public-chat.js';
import { publicAppearance, registerWebchatAppearance } from './webchat-appearance.js';

/**
 * "Link hospedado" do Chatbot de IA (Fonio WC-12): página pública `<origem Kloel>/w/<empresa>/<assistente>` (rota do SPA) que conversa
 * pelo MESMO pipeline do widget (`/api/v1/public/chat/*`: sessões, limites, Conversas). A publicação fica no próprio canal de webchat
 * (`channel.hosted`); a origem da Kloel nunca entra em `allowedOrigins` — `allowedChatOrigin` só a aceita enquanto o link está publicado.
 * Páginas same-origin não mandam `Origin` em GET; o SPA marca as chamadas com `X-Kloel-Hosted: 1` e o motor as normaliza para a
 * origem pública canônica somente quando o navegador declara `Sec-Fetch-Site: same-origin` (ou a origem já é da Kloel).
 */
export const HOSTED_WEBCHAT_PUBLIC_PATH = '/api/v1/public/webchat/hosted';
export const HOSTED_HEADER = 'x-kloel-hosted';
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TECH = /^o-[a-f0-9]{24}$/;
const slug = z.string().min(3).max(48).regex(SLUG);
const agentId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
const AUDIT = 'webchat-hosted-audit';
/** Reservas por endereço /w/ da versão anterior (substituídas pela reserva do apelido aposentado em company-slug.ts). */
const LEGACY_ADDRESSES = 'webchat-hosted-addresses';
const ADOPT_MIGRATION = '2026-10-20-webchat-hosted-addresses-to-retired-company-slugs-v1';
type Data = Record<string, any>;
class Fault extends Error { constructor(readonly status: number, readonly code: string, message: string) { super(message); } }
const unavailable = () => new Fault(404, 'hosted_unavailable', 'Este link de chat não está disponível.');

/** Origens onde o próprio SPA da Kloel roda (URL pública + ALLOWED_ORIGINS do painel). */
function kloelOrigins() {
  const set = new Set<string>(); const own = hostedChatOrigin(); if (own) set.add(own);
  for (const value of String(process.env.ALLOWED_ORIGINS || '').split(',')) { const origin = canonicalWebchatOrigin(value.trim()); if (origin) set.add(origin); }
  return set;
}
/** Chamada do SPA hospedado → a origem pública canônica. Navegador em outro site nunca passa (Sec-Fetch-Site/Origin). */
export function normalizeHostedRequest(request: FastifyRequest) {
  if (request.headers[HOSTED_HEADER] !== '1' || !PUBLIC_CHAT_PATHS.has(request.url.split('?')[0])) return;
  const site = request.headers['sec-fetch-site'], origin = request.headers.origin, own = hostedChatOrigin();
  if (!own || site !== undefined && site !== 'same-origin') return;
  if (origin !== undefined && site !== 'same-origin' && !kloelOrigins().has(origin)) return;
  request.headers.origin = own;
}

function orgSlugs(store: Store, tenant: string) {
  const custom = store.list(tenant, 'company-slugs')[0]?.slug;
  const technical = technicalOrgSlug(tenant), current = typeof custom === 'string' && SLUG.test(custom) ? custom : null;
  return { orgSlug: current ?? technical, customOrgSlug: current, technicalSlug: technical };
}
/**
 * Uma vez: endereço /w/<apelido>/<assistente> que a versão anterior guardava para a empresa com um apelido que ela já não usa (e que
 * ninguém usa agora) vira reserva desse apelido aposentado, contada desde quando ele deixou de ser o atual (prazo/limite de company-slug.ts;
 * os mais recentes primeiro, como os que a versão anterior mantinha).
 */
export function adoptAddressReservations(store: Store) {
  store.transaction(() => {
    store.db.exec('CREATE TABLE IF NOT EXISTS engine_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
    if (store.db.prepare('SELECT version FROM engine_migrations WHERE version=?').get(ADOPT_MIGRATION)) return;
    const rows = store.db.prepare('SELECT tenant_id, body FROM entities WHERE collection=? ORDER BY rowid').all(LEGACY_ADDRESSES) as { tenant_id: string; body: string }[];
    const latest = new Map<string, { tenant: string; org: string; at: number }>();
    for (const row of rows) {
      const a = JSON.parse(row.body) as Data, org = String(a.orgSlug), at = Date.parse(String(a.currentAt ?? a.createdAt)), key = `${row.tenant_id}\n${org}`;
      if (SLUG.test(org) && at > (latest.get(key)?.at ?? -Infinity)) latest.set(key, { tenant: row.tenant_id, org, at });
    }
    for (const { tenant, org, at } of [...latest.values()].sort((x, y) => y.at - x.at))
      if (orgSlugs(store, tenant).customOrgSlug !== org && !companySlugHolder(store, org)) retireCompanySlug(store, tenant, org, new Date(at));
    store.db.prepare('INSERT INTO engine_migrations(version,applied_at) VALUES(?,?)').run(ADOPT_MIGRATION, new Date().toISOString());
  });
}
/** Canal publicado da empresa com este slug de assistente — filtrado no SQL (sem janela global entre empresas). */
function publishedChannel(store: Store, where: string, ...args: string[]) {
  const rows = store.db.prepare(`SELECT tenant_id, body FROM entities WHERE collection='channels' AND json_extract(body,'$.type')='webchat' AND json_extract(body,'$.hosted.published')=1 AND json_extract(body,'$.hosted.assistantSlug')=? AND ${where} ORDER BY rowid`).all(...args) as { tenant_id: string; body: string }[];
  return rows.map(row => ({ tenantId: row.tenant_id, channel: JSON.parse(row.body) as Entity })).filter(row => hostedLinkPublished(row.channel));
}
function chatChannels(store: Store, tenant: string, agent: string) { return store.list(tenant, 'channels').filter(c => c.type === 'webchat' && c.agentId === agent); }
function originsOf(channel: Entity) {
  const values = (channel.configuration as Data | undefined)?.allowedOrigins;
  return Array.isArray(values) ? values.filter(v => canonicalWebchatOrigin(v)) : [];
}
/** Mesmos requisitos do widget (webchat-channels readiness), sem a exigência de sites. */
export function hostedReasons(tenant: string, channel: Entity | undefined, agent: Entity | undefined) {
  const reasons: string[] = [];
  if (!agent) reasons.push('agent_missing'); else if (agent.status !== 'active') reasons.push('agent_inactive');
  if (channel && channel.provider !== 'openai') reasons.push('provider_unsupported');
  if (!providerAllowedForTenant(tenant)) reasons.push('tenant_not_bound');
  if (!process.env.OPENAI_API_KEY?.trim() || !process.env.OPENAI_MODEL?.trim()) reasons.push('provider_not_configured');
  if (!hostedChatOrigin()) reasons.push('installation_unavailable');
  return reasons;
}
const reasonText = (reasons: string[]) => reasons.includes('agent_missing') ? 'Assistente não encontrado nesta organização.'
  : reasons.includes('agent_inactive') ? 'Ative o assistente antes de publicar o link hospedado.'
  : reasons.includes('installation_unavailable') ? 'O endereço público da Kloel não está configurado.'
  : 'A IA da Kloel ainda não está disponível para esta organização.';

function view(store: Store, tenant: string, agent: string) {
  const channels = chatChannels(store, tenant, agent), channel = channels.length === 1 ? channels[0] : undefined;
  // O apelido atual da empresa sempre leva a ela (company-slug.ts): o link mostrado é o que funciona.
  const hosted = channel?.hosted as Data | undefined, slugs = orgSlugs(store, tenant), published = hostedLinkPublished(channel);
  const reasons = hostedReasons(tenant, channel, store.get(tenant, 'agents', agent));
  return {
    agentId: agent, channelId: channel?.id ?? null, ...slugs,
    hosted: hosted && typeof hosted.assistantSlug === 'string' ? { published, assistantSlug: String(hosted.assistantSlug), greeting: typeof hosted.greeting === 'string' ? hosted.greeting : '', path: `/w/${slugs.orgSlug}/${hosted.assistantSlug}`, publishedAt: hosted.publishedAt ?? null, updatedAt: hosted.updatedAt ?? null } : null,
    available: published && channel?.enabled === true && reasons.length === 0, reasons,
  };
}

/**
 * Resolve /w/<empresa>/<assistente> para o canal publicado de UMA empresa, filtrado no SQL (nenhuma outra empresa ocupa a busca):
 * o-<hash> → canais que gravaram esse endereço técnico na publicação (conferido contra o próprio tenant);
 * apelido → a dona atual do apelido ou, sem dona, a empresa que o aposentou e ainda o mantém reservado (company-slug.ts). Só leitura.
 */
export function resolveHosted(store: Store, org: string, assistant: string) {
  if (!SLUG.test(org) || !slug.safeParse(assistant).success) return undefined;
  if (TECH.test(org)) return publishedChannel(store, "json_extract(body,'$.hosted.orgTechSlug')=?", assistant, org).find(row => technicalOrgSlug(row.tenantId) === org);
  const owner = companySlugHolder(store, org);
  return owner ? publishedChannel(store, 'tenant_id=?', assistant, owner)[0] : undefined;
}

export function registerWebchatHosted(app: FastifyInstance, store: Store) {
  adoptAddressReservations(store);
  registerWebchatAppearance(app, store); // "Personalizar": aparência do widget e do link hospedado
  app.addHook('onRequest', async request => { normalizeHostedRequest(request); });
  const wrap = (fn: (r: FastifyRequest, p: FastifyReply) => unknown) => async (r: FastifyRequest, p: FastifyReply) => {
    p.header('Cache-Control', 'no-store');
    try { return await fn(r, p); }
    catch (e) {
      if (e instanceof z.ZodError) return p.code(400).send({ error: { code: 'invalid_input', message: 'Confira o slug do assistente e a saudação.' } });
      if (e instanceof Fault || e instanceof MembershipError) return p.code(e instanceof Fault ? e.status : e.statusCode).send({ error: { code: e.code, message: e.message } });
      throw e;
    }
  };
  app.get('/api/v1/webchat/hosted', wrap(req => {
    const actor = requireRequestPermission(store, req, 'channels:read');
    const q = z.object({ agentId }).strict().parse(req.query);
    if (!store.get(actor.tenantId, 'agents', q.agentId)) throw new Fault(404, 'not_found', 'Assistente não encontrado nesta organização.');
    return view(store, actor.tenantId, q.agentId);
  }));
  // Publica (ou atualiza) o link: cria o canal de webchat do assistente se ainda não existir; não toca nos sites do widget.
  app.put('/api/v1/webchat/hosted', wrap(req => {
    const actor = requireRequestPermission(store, req, 'channels:write');
    const body = z.object({ expectedTenantId: z.string().max(128).optional(), agentId, assistantSlug: slug, greeting: z.string().trim().max(1000).default('') }).strict().parse(req.body ?? {});
    if (body.expectedTenantId !== undefined && body.expectedTenantId !== actor.tenantId) throw new Fault(409, 'tenant_mismatch', 'A organização mudou. Atualize a página.');
    store.transaction(() => {
      const tenant = requireRequestPermission(store, req, 'channels:write').tenantId, agent = store.get(tenant, 'agents', body.agentId);
      if (!agent) throw new Fault(404, 'not_found', 'Assistente não encontrado nesta organização.');
      const channels = chatChannels(store, tenant, body.agentId);
      if (channels.length > 1) throw new Fault(409, 'webchat_ambiguous', 'Este assistente possui mais de um canal de chat. Confira a configuração antes de publicar.');
      if (store.list(tenant, 'channels').some(c => c.type === 'webchat' && c.agentId !== body.agentId && hostedLinkPublished(c) && (c.hosted as Data).assistantSlug === body.assistantSlug)) throw new Fault(409, 'slug_taken', 'Este slug já é usado por outro assistente da empresa.');
      const reasons = hostedReasons(tenant, channels[0], agent);
      if (reasons.length) throw new Fault(409, 'hosted_not_ready', reasonText(reasons));
      const channel = channels[0] ?? store.create(tenant, 'channels', { name: String(agent.name ?? 'Chatbot de IA').slice(0, 200), agentId: body.agentId, type: 'webchat', provider: 'openai', enabled: false, configuration: { allowedOrigins: [], greeting: '' }, revision: 1, verificationStatus: 'unverified' });
      const old = channel.hosted as Data | undefined, now = new Date().toISOString(), was = hostedLinkPublished(channel);
      const revision = Number.isSafeInteger(channel.revision) ? Number(channel.revision) + 1 : 1;
      store.update(tenant, 'channels', channel.id, { enabled: true, revision, hosted: { published: true, assistantSlug: body.assistantSlug, greeting: body.greeting, orgTechSlug: technicalOrgSlug(tenant), publishedAt: was ? old?.publishedAt ?? now : now, updatedAt: now } });
      store.create(tenant, AUDIT, { channelId: channel.id, agentId: body.agentId, kind: was ? 'update' : 'publish', assistantSlug: body.assistantSlug, actorUserId: actor.userId, revision });
    });
    return view(store, actor.tenantId, body.agentId);
  }));
  // Despublica: o link deixa de funcionar; sem sites do widget o canal volta a ficar desligado.
  app.delete('/api/v1/webchat/hosted/:agentId', wrap(req => {
    const actor = requireRequestPermission(store, req, 'channels:write');
    const params = z.object({ agentId }).strict().parse(req.params);
    store.transaction(() => {
      const tenant = requireRequestPermission(store, req, 'channels:write').tenantId;
      for (const channel of chatChannels(store, tenant, params.agentId).filter(c => (c.hosted as Data | undefined)?.published === true)) {
        const revision = Number.isSafeInteger(channel.revision) ? Number(channel.revision) + 1 : 1;
        store.update(tenant, 'channels', channel.id, { revision, hosted: { ...(channel.hosted as Data), published: false, updatedAt: new Date().toISOString() }, ...(originsOf(channel).length ? {} : { enabled: false }) });
        store.create(tenant, AUDIT, { channelId: channel.id, agentId: params.agentId, kind: 'unpublish', actorUserId: actor.userId, revision });
      }
    });
    return view(store, actor.tenantId, params.agentId);
  }));
  // Público: o SPA em /w/:org/:assistente descobre o canal. Indisponível = 404 sem detalhes da organização.
  app.get(HOSTED_WEBCHAT_PUBLIC_PATH, { config: { cors: false } }, wrap(req => {
    const q = z.object({ orgSlug: z.string().max(60), assistantSlug: z.string().max(60) }).strict().parse(req.query);
    const found = resolveHosted(store, q.orgSlug, q.assistantSlug);
    if (!found) throw unavailable();
    const { tenantId, channel } = found, agent = store.get(tenantId, 'agents', String(channel.agentId)), hosted = channel.hosted as Data;
    if (channel.provider !== 'openai' || channel.enabled !== true || !agent || agent.status !== 'active') throw unavailable();
    if (hostedReasons(tenantId, channel, agent).length) throw new Fault(503, 'chat_not_configured', 'Atendimento temporariamente indisponível.');
    return { tenantId, channelId: channel.id, assistantName: String(agent.name ?? 'Atendimento').slice(0, 100), greeting: String(hosted.greeting || agent.initialMessage || 'Olá! Como posso ajudar?').slice(0, 1000), orgSlug: q.orgSlug, assistantSlug: q.assistantSlug, appearance: publicAppearance(store, tenantId, channel) };
  }));
}
