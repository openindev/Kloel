import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Store } from './store.js';
import { requireRequestPermission } from './memberships/access.js';
import { MembershipError, resolveSessionActor } from './memberships/service.js';
import { hasPermission, type Permission } from './memberships/permissions.js';
import { CRMError, crmId } from './crm/schema.js';
import { clearFieldValues, contactETag, contactView, createContact, createLegacyContact, deleteContact, expectedRevision, getContact, getSettings, initializeCRM, linkConversation, listContacts, lookupExact, permissionState, recordPermission, saveSettings, updateContact, updateLegacyContact, withReceipt } from './crm/service.js';
import { registerCRMImport } from './crm/import.js';

export function crmHandler(fn: (request: FastifyRequest, reply: FastifyReply) => unknown) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try { return await fn(request, reply); }
    catch (error) {
      if (error instanceof CRMError || error instanceof MembershipError) return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
      if (error instanceof z.ZodError) return reply.code(400).send({ error: { code: 'validation_error', message: 'Dados inválidos.', fields: error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })) } });
      throw error;
    }
  };
}
export function humanCRM(store: Store, request: FastifyRequest, permission: Permission) {
  if (request.headers.authorization || request.apiKey) throw new CRMError(403, 'human_session_required', 'Use uma sessão humana para esta operação.');
  const actor = requireRequestPermission(store, request, permission), token = request.cookies?.kloel_session;
  const current = token ? resolveSessionActor(store, createHash('sha256').update(token).digest('hex')) : undefined;
  if (!current || current.userId !== actor.userId || current.tenantId !== actor.tenantId) throw new CRMError(401, 'unauthorized', 'Sessão humana expirada ou revogada.');
  const membership = store.db.prepare('SELECT id FROM memberships WHERE tenant_id=? AND user_id=?').get(current.tenantId, current.userId)!;
  return { ...current, membershipId: String(membership.id) };
}
export const receiptKey = (request: FastifyRequest) => z.string().min(8).max(128).regex(/^[A-Za-z0-9_.:-]+$/).parse(request.headers['idempotency-key']);
const getId = (request: FastifyRequest) => z.object({ id: crmId }).strict().parse(request.params).id;
const querySchema = z.object({ q: z.string().max(300).optional(), search: z.string().max(300).optional(), page: z.coerce.number().int().min(1).max(1000000).default(1), limit: z.coerce.number().int().min(1).max(100).default(25), sort: z.enum(['name', 'createdAt', 'updatedAt']).default('updatedAt'), order: z.enum(['asc', 'desc']).default('desc'), company: z.string().max(200).optional(), ownerMembershipId: z.union([crmId, z.literal('unassigned')]).optional(), source: z.enum(['manual', 'import', 'legacy', 'conversation']).optional(), fieldPresent: crmId.optional() }).strict();
function list(store: Store, tenant: string, input: unknown) {
  const query = querySchema.parse(input), needle = (query.q ?? query.search)?.trim().toLocaleLowerCase('pt-BR');
  let rows = listContacts(store, tenant).filter(row => (!needle || [row.name, row.company, ...row.tags, ...row.phones.flatMap(p => [p.value, p.normalized]), ...row.emails.flatMap(e => [e.value, e.normalized])].some(text => text.toLocaleLowerCase('pt-BR').includes(needle)))
    && (!query.company || row.company === query.company) && (!query.source || row.source === query.source)
    && (!query.ownerMembershipId || (query.ownerMembershipId === 'unassigned' ? !row.ownerMembershipId : row.ownerMembershipId === query.ownerMembershipId))
    && (!query.fieldPresent || Object.hasOwn(row.fieldValues, query.fieldPresent)));
  rows = rows.sort((a, b) => (String(a[query.sort]).localeCompare(String(b[query.sort]), 'pt-BR') || a.id.localeCompare(b.id)) * (query.order === 'asc' ? 1 : -1));
  return { items: rows.slice((query.page - 1) * query.limit, query.page * query.limit).map(contactView), page: query.page, limit: query.limit, total: rows.length, totalPages: Math.ceil(rows.length / query.limit) };
}
async function registerContactRoutes(app: FastifyInstance, store: Store, base: string, legacy: boolean) {
  app.get(base, crmHandler(request => { const actor = requireRequestPermission(store, request, 'contacts:read'); return list(store, actor.tenantId, request.query); }));
  app.get(`${base}/:id`, crmHandler((request, reply) => { const actor = requireRequestPermission(store, request, 'contacts:read'), row = getContact(store, actor.tenantId, getId(request)); return reply.header('ETag', contactETag(row)).header('Cache-Control', 'no-store').send(contactView(row)); }));
  app.post(base, crmHandler((request, reply) => {
    const actor = requireRequestPermission(store, request, 'contacts:write');
    const assertAccess = () => { requireRequestPermission(store, request, 'contacts:write'); };
    const create = () => legacy ? createLegacyContact(store, actor.tenantId, request.body, actor.userId, 'manual', assertAccess) : createContact(store, actor.tenantId, request.body, actor.userId, 'manual', undefined, assertAccess);
    const receipt = legacy ? { result: create(), replayed: false } : withReceipt(store, actor.tenantId, receiptKey(request), 'create_contact', { actorId: actor.userId, body: request.body }, create, assertAccess);
    return reply.code(receipt.replayed ? 200 : 201).header('ETag', contactETag(receipt.result)).send(contactView(receipt.result));
  }));
  app.patch(`${base}/:id`, crmHandler((request, reply) => {
    const actor = requireRequestPermission(store, request, 'contacts:write'), id = getId(request), expected = expectedRevision(request.headers['if-match'], id);
    const assertAccess = () => { requireRequestPermission(store, request, 'contacts:write'); };
    const row = legacy ? updateLegacyContact(store, actor.tenantId, id, request.body, expected, actor.userId, 'manual', assertAccess) : updateContact(store, actor.tenantId, id, request.body, expected, actor.userId, 'manual', assertAccess);
    return reply.header('ETag', contactETag(row)).send(contactView(row));
  }));
  app.delete(`${base}/:id`, crmHandler((request, reply) => { const actor = requireRequestPermission(store, request, 'contacts:delete'), id = getId(request); deleteContact(store, actor.tenantId, id, expectedRevision(request.headers['if-match'], id), actor.userId, () => { requireRequestPermission(store, request, 'contacts:delete'); }, !legacy); return reply.code(204).send(); }));
}
/** Legacy routes are registered by domains; new CRM routes by the application owner. */
export async function registerLegacyContacts(app: FastifyInstance, store: Store) { await registerContactRoutes(app, store, '/api/v1/contacts', true); }
export async function registerCRM(app: FastifyInstance, store: Store) {
  initializeCRM(store);
  const base = '/api/v1/crm';
  await registerContactRoutes(app, store, `${base}/contacts`, false);
  app.get(`${base}/contacts/lookup`, crmHandler(request => {
    const actor = requireRequestPermission(store, request, 'contacts:read');
    const query = z.object({ identifier: z.string().min(5).max(254) }).strict().parse(request.query);
    return lookupExact(store, actor.tenantId, query.identifier);
  }));
  app.get(`${base}/contacts/:id/conversations`, crmHandler(request => {
    const actor = requireRequestPermission(store, request, 'contacts:read'); requireRequestPermission(store, request, 'conversations:read'); const id = getId(request); getContact(store, actor.tenantId, id);
    const query = z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) }).strict().parse(request.query);
    const all = store.list(actor.tenantId, 'conversations').filter(row => row.contactId === id);
    return { items: all.slice((query.page - 1) * query.limit, query.page * query.limit), total: all.length, ...query };
  }));
  // "Criar contato" / "Vincular a um contato" a partir de Conversas: vínculo explícito feito por uma pessoa.
  app.post(`${base}/contacts/:id/conversations`, crmHandler(request => {
    const actor = humanCRM(store, request, 'contacts:write'); requireRequestPermission(store, request, 'conversations:write');
    const body = z.object({ conversationId: crmId, replace: z.boolean().default(false) }).strict().parse(request.body);
    return linkConversation(store, actor.tenantId, getId(request), body.conversationId, actor.userId, body.replace, () => { humanCRM(store, request, 'contacts:write'); requireRequestPermission(store, request, 'conversations:write'); });
  }));
  // "Apagar esses valores ao salvar": remove valores de campos inteligentes de contatos escolhidos (auditado por contato).
  app.post(`${base}/field-values/clear`, crmHandler(request => {
    const actor = humanCRM(store, request, 'contacts:settings'); requireRequestPermission(store, request, 'contacts:write');
    const body = z.object({ fields: z.array(z.object({ fieldId: crmId, contactIds: z.array(crmId).min(1).max(10000) }).strict()).min(1).max(100) }).strict().parse(request.body);
    return clearFieldValues(store, actor.tenantId, body.fields, actor.userId, () => { humanCRM(store, request, 'contacts:settings'); });
  }));
  app.get(`${base}/assignable-members`, crmHandler(request => {
    const actor = requireRequestPermission(store, request, 'contacts:read');
    return { items: store.db.prepare('SELECT id,user_id,role FROM memberships WHERE tenant_id=?').all(actor.tenantId).filter(row => hasPermission(String(row.role), 'contacts:read')).map(row => ({ id: row.id, userId: row.user_id, role: row.role })) };
  }));
  app.get(`${base}/settings`, crmHandler((request, reply) => { const actor = requireRequestPermission(store, request, 'contacts:read'), settings = getSettings(store, actor.tenantId); return reply.header('ETag', `"crm-settings:${actor.tenantId}:${settings.revision}"`).send(settings); }));
  app.put(`${base}/settings`, crmHandler((request, reply) => {
    const actor = humanCRM(store, request, 'contacts:settings'), expected = expectedRevision(request.headers['if-match'], actor.tenantId, 'crm-settings');
    const settings = saveSettings(store, actor.tenantId, request.body, expected, actor.userId, () => { humanCRM(store, request, 'contacts:settings'); });
    return reply.header('ETag', `"crm-settings:${actor.tenantId}:${settings.revision}"`).send(settings);
  }));
  app.get(`${base}/contacts/:id/permissions`, crmHandler(request => { const actor = requireRequestPermission(store, request, 'contacts:read'); return permissionState(store, actor.tenantId, getId(request)); }));
  app.post(`${base}/contacts/:id/permission-events`, crmHandler((request, reply) => {
    const actor = humanCRM(store, request, 'contacts:consent'), id = getId(request), expected = expectedRevision(request.headers['if-match'], id);
    const assertAccess = () => { humanCRM(store, request, 'contacts:consent'); };
    const receipt = withReceipt(store, actor.tenantId, receiptKey(request), 'contact_permission', { actorId: actor.userId, id, expected, body: request.body }, () => recordPermission(store, actor.tenantId, id, request.body, expected, actor.userId, actor.membershipId, assertAccess), assertAccess);
    return reply.code(receipt.replayed ? 200 : 201).send({ ...receipt.result, replayed: receipt.replayed, contactRevision: getContact(store, actor.tenantId, id).revision });
  }));
  await registerCRMImport(app, store);
}
