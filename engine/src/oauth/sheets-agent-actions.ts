import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Store, Entity } from '../store.js';
import { hasPermission } from '../memberships/permissions.js';
import { MembershipError, resolveMembershipActor } from '../memberships/service.js';
import { assertRequestContext, parseExpectedRequestContext, resolveSessionContext, sameRequestContext, type ExpectedRequestContext } from '../request-context.js';
import { digest } from './crypto.js';
import { OAuthError } from './client.js';
import { oauthAuthorizationIdentity, scopedConnection, type Actor } from './access.js';
import { bound, sheetsBindings, sheetRectangle } from './sheets.js';
import { prepareSheetQuery } from './sheets-query.js';

export const sheetActions = 'sheets-assistant-actions', sheetGrants = 'sheets-assistant-grants', sheetActionReceipts = 'sheets-action-http-operations', sheetExecutions = 'sheets-action-executions';
export const failSheetAction = (status: number, code: string): never => { throw new OAuthError(status, code, 'A ação de planilha está indisponível ou mudou. Revise a configuração e consulte a referência antes de tentar novamente.'); };
export const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical((v as Record<string, unknown>)[k])])) : v;
export const sheetHash = (v: unknown) => digest(JSON.stringify(canonical(v)));
const uuid = z.string().uuid(), revision = z.number().int().positive().safe(), tenant = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/), key = z.string().regex(/^[A-Za-z0-9_-]{8,128}$/);
const inputDefinition = z.object({ name: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/), type: z.enum(['text', 'number', 'boolean']) }).strict();
const common = { sheetTitle: z.string().min(1).max(100).refine(v => !/[\u0000-\u001f]/.test(v)), inputDefinitions: z.array(inputDefinition).max(20) };
const cellRef = z.discriminatedUnion('kind', [z.object({ kind: z.literal('literal'), value: z.union([z.string().max(2000), z.number().finite(), z.boolean()]) }).strict(), z.object({ kind: z.literal('variable'), name: inputDefinition.shape.name }).strict()]);
const queryConfig = z.object({ ...common, scanRange: z.string(), headers: z.literal(true), filters: z.array(z.unknown()).max(12), expectedHeaders: z.array(z.string().min(1).max(256)).min(1).max(50), returnColumns: z.array(z.string().regex(/^[A-Z]{1,3}$/)).min(1).max(50), maxRows: z.number().int().min(1).max(50) }).strict();
const appendConfig = z.object({ ...common, range: z.string(), row: z.array(cellRef).min(1).max(50) }).strict();
export type SheetActionConfiguration = z.infer<typeof queryConfig> | z.infer<typeof appendConfig>;
const columnIndex = (s: string) => [...s].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
export function parseActionConfiguration(kind: string, raw: unknown): SheetActionConfiguration {
  const config = kind === 'query' ? queryConfig.parse(raw) : kind === 'append' ? appendConfig.parse(raw) : failSheetAction(400, 'invalid_sheet_action');
  const names = new Set(config.inputDefinitions.map(i => i.name));
  if (names.size !== config.inputDefinitions.length) failSheetAction(400, 'invalid_sheet_action');
  if ('scanRange' in config) {
    const prepared = prepareSheetQuery({ expectedTenantId: 'validation', expectedRevision: 1, sheetTitle: config.sheetTitle, scanRange: config.scanRange, headers: true, filters: config.filters, maxRows: config.maxRows, variables: config.inputDefinitions.map(i => ({ ...i, value: i.type === 'text' ? '' : i.type === 'number' ? 0 : false })) });
    if (config.expectedHeaders.length !== prepared.range.columns || new Set(config.expectedHeaders).size !== config.expectedHeaders.length || config.expectedHeaders.some(h => !h.trim()) || new Set(config.returnColumns).size !== config.returnColumns.length || config.returnColumns.some(c => columnIndex(c) < prepared.firstColumn || columnIndex(c) >= prepared.firstColumn + prepared.range.columns)) failSheetAction(400, 'invalid_sheet_action');
  } else {
    const range = sheetRectangle({ sheetTitle: config.sheetTitle, range: config.range });
    const used = new Set(config.row.filter(c => c.kind === 'variable').map(c => c.name));
    if (range.columns !== config.row.length || used.size !== names.size || [...used].some(n => !names.has(n))) failSheetAction(400, 'invalid_sheet_action');
  }
  return config;
}
export function actionConfiguration(row: Entity) { return parseActionConfiguration(String(row.kind), row.configuration); }
export function resolveSheetVariables(config: SheetActionConfiguration, raw: unknown) {
  const properties = Object.fromEntries(config.inputDefinitions.map(i => [i.name, i.type === 'text' ? z.string().max(2000) : i.type === 'number' ? z.number().finite() : z.boolean()]));
  return z.object(properties).strict().parse(raw);
}
export function agentDelegationGeneration(agent: Entity): number {
  const value = agent.delegationGeneration ?? 0;
  if (!Number.isSafeInteger(value) || Number(value) < 0) return failSheetAction(409, 'agent_delegation_version_invalid');
  return Number(value);
}
export const sheetChannelVersion = (channel: Entity) => sheetHash({ schema: 'webchat-channel-v1', row: channel, revision: channel.revision ?? 0 });
function memberSnapshot(store: Store, tenantId: string, userId: string) {
  const actor = resolveMembershipActor(store, userId, tenantId);
  const row = store.db.prepare('SELECT id,revision,role FROM memberships WHERE tenant_id=? AND user_id=?').get(tenantId, userId);
  if (!actor || !row) return failSheetAction(403, 'sheet_action_authority_changed');
  return { actor, id: String(row.id), revision: Number(row.revision), role: String(row.role) };
}
export function actionTarget(store: Store, action: Entity, actor: Actor, requireEnabled = true) {
  const current = store.get(actor.tenantId, sheetActions, action.id);
  if (!current || current.tenantId !== action.tenantId || current.revision !== action.revision || sheetHash(current) !== sheetHash(action)) return failSheetAction(409, 'sheet_action_changed');
  if (requireEnabled && current.enabled !== true) failSheetAction(403, 'sheet_action_disabled');
  const agent = store.get(actor.tenantId, 'agents', String(action.agentId));
  if (!agent || agent.status !== 'active') return failSheetAction(403, 'sheet_action_agent_unavailable');
  agentDelegationGeneration(agent);
  const target = bound(store, actor, String(action.connectionId), String(action.bindingId), action.kind === 'append');
  if (target.binding.revision !== action.bindingRevision) failSheetAction(409, 'sheet_action_binding_changed');
  return { ...target, agent, action: current };
}
export function grantTarget(store: Store, grant: Entity) {
  if (grant.status !== 'active') return failSheetAction(403, 'sheet_action_grant_inactive');
  if (!Number.isFinite(grant.expiresAt) || Number(grant.expiresAt) <= Date.now()) return failSheetAction(403, 'sheet_action_grant_expired');
  const issuer = memberSnapshot(store, grant.tenantId, String(grant.issuerUserId));
  if (!hasPermission(issuer.actor.role, 'integrations:manage') || issuer.id !== grant.issuerMembershipId || issuer.revision !== grant.issuerMembershipRevision) failSheetAction(403, 'sheet_action_authority_changed');
  const action = store.get(grant.tenantId, sheetActions, String(grant.actionId));
  if (!action || action.revision !== grant.actionRevision) return failSheetAction(403, 'sheet_action_grant_changed');
  // This is a real membership resolver, not a synthetic visitor Actor. Only grant issuance uses bound().
  const connection = store.get(grant.tenantId, 'oauth-connections', String(action.connectionId));
  const binding = store.get(grant.tenantId, sheetsBindings, String(action.bindingId));
  const agent = store.get(grant.tenantId, 'agents', String(action.agentId));
  const channel = store.get(grant.tenantId, 'channels', String(grant.channelId));
  if (!connection || connection.userId !== issuer.actor.userId || oauthAuthorizationIdentity(connection) !== grant.connectionIdentity || connection.status !== 'connected' || connection.provider !== 'google') return failSheetAction(403, 'sheet_action_connection_changed');
  const capability = action.kind === 'append' ? 'sheets_append' : 'sheets_read';
  const scopes = String(connection.scopes ?? '').split(' ');
  if (!Array.isArray(connection.capabilities) || !connection.capabilities.includes(capability) || !scopes.includes('https://www.googleapis.com/auth/spreadsheets') && (action.kind === 'append' || !scopes.includes('https://www.googleapis.com/auth/spreadsheets.readonly'))) failSheetAction(403, 'capability_not_authorized');
  if (!binding || binding.connectionId !== connection.id || binding.revision !== grant.bindingRevision || binding.revision !== action.bindingRevision || binding.enabled !== true || action.kind === 'append' && binding.allowAppend !== true) return failSheetAction(403, 'sheet_action_binding_changed');
  if (!agent || agent.status !== 'active' || agentDelegationGeneration(agent) !== grant.agentGeneration || action.enabled !== true || sheetHash(agent) !== grant.agentHash) return failSheetAction(403, 'sheet_action_agent_changed');
  if (!channel || channel.enabled !== true || channel.type !== 'webchat' || channel.provider !== 'openai' || channel.agentId !== agent.id || sheetChannelVersion(channel) !== grant.channelVersion) return failSheetAction(403, 'sheet_action_channel_changed');
  return { action, connection, binding, agent, channel };
}
export function initializeSheetActions(store: Store) {
  store.db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS sheets_action_receipt_key ON entities(tenant_id,json_extract(body,'$.key')) WHERE collection='sheets-action-http-operations';
    CREATE UNIQUE INDEX IF NOT EXISTS sheets_action_append_slot ON entities(tenant_id,json_extract(body,'$.actionId'),json_extract(body,'$.conversationId')) WHERE collection='sheets-action-executions' AND json_extract(body,'$.kind')='append';
    CREATE UNIQUE INDEX IF NOT EXISTS sheets_action_call ON entities(tenant_id,json_extract(body,'$.callKey')) WHERE collection='sheets-action-executions';
    CREATE TRIGGER IF NOT EXISTS sheets_action_invalidate AFTER UPDATE OF body ON entities WHEN NEW.collection IN ('sheets-assistant-actions','oauth-sheets-bindings','channels') BEGIN
      UPDATE entities SET body=json_set(body,'$.status','needs_reauthorization','$.revision',json_extract(body,'$.revision')+1)
      WHERE collection='sheets-assistant-grants' AND tenant_id=NEW.tenant_id AND json_extract(body,'$.status')='active'
      AND ((NEW.collection='sheets-assistant-actions' AND json_extract(body,'$.actionId')=NEW.id) OR (NEW.collection='oauth-sheets-bindings' AND json_extract(body,'$.bindingId')=NEW.id AND json_extract(NEW.body,'$.revision') IS NOT json_extract(OLD.body,'$.revision')) OR (NEW.collection='channels' AND json_extract(body,'$.channelId')=NEW.id));
    END;
    CREATE TRIGGER IF NOT EXISTS sheets_action_org_suspended AFTER UPDATE OF status ON organizations WHEN NEW.status!='active' BEGIN
      UPDATE entities SET body=json_set(body,'$.status','needs_reauthorization','$.revision',json_extract(body,'$.revision')+1)
      WHERE collection='sheets-assistant-grants' AND tenant_id=NEW.id AND json_extract(body,'$.status')='active';
    END;
  `);
}
function privateAuthority(store: Store, request: FastifyRequest, manage = true) {
  if (!parseExpectedRequestContext(request)) failSheetAction(400, 'expected_context_required');
  assertRequestContext(store, request, 'admission');
  if (request.apiKey || request.headers.authorization || !request.cookies?.kloel_session) failSheetAction(401, 'authentication_required');
  const sessionHash = digest(request.cookies!.kloel_session!), original = resolveSessionContext(store, sessionHash);
  if (!original?.actor || original.actor.userId !== request.actor?.userId || original.actor.tenantId !== request.actor?.tenantId) return failSheetAction(401, 'authentication_required');
  const assertCurrent = () => { assertRequestContext(store, request); const live = resolveSessionContext(store, sessionHash); if (!live?.actor || !sameRequestContext(original.context, live.context)) throw new MembershipError(409, 'context_changed_in_flight', 'O contexto mudou. Consulte o recibo.'); if (!hasPermission(live.actor.role, manage ? 'integrations:manage' : 'integrations:execute')) failSheetAction(403, 'forbidden'); };
  assertCurrent(); return { actor: original.actor, sessionHash, context: original.context, assertCurrent };
}
export type SheetOperatorAuthority = { actor: Actor; sessionHash: string; context: ExpectedRequestContext; assertCurrent: () => void };
export function operatorScope(a: SheetOperatorAuthority) { return { userId: a.actor.userId, sessionHash: a.sessionHash, membershipId: a.context.membershipId, authorityVersion: a.context.authorityVersion }; }
const owns = (row: Entity, a: SheetOperatorAuthority) => sheetHash(row.authority) === sheetHash(operatorScope(a)) && row.tenantId === a.actor.tenantId;
export function sheetActionView(store: Store, row: Entity, actor: Actor) {
  let reasonCode: string | null = null;
  try { actionTarget(store, row, actor); } catch (e) { reasonCode = e instanceof OAuthError ? e.code : 'sheet_action_unavailable'; }
  return { id: row.id, agentId: row.agentId, connectionId: row.connectionId, bindingId: row.bindingId, bindingRevision: row.bindingRevision, kind: row.kind, name: row.name, description: row.description, enabled: row.enabled, revision: row.revision, configuration: row.configuration, readiness: { available: reasonCode === null, reasonCode }, createdAt: row.createdAt, updatedAt: row.updatedAt };
}
export function sheetGrantView(store: Store, row: Entity) {
  let status = String(row.status);
  if (status === 'active') { try { grantTarget(store, row); } catch { status = Number(row.expiresAt) <= Date.now() ? 'expired' : 'needs_reauthorization'; } }
  return { id: row.id, actionId: row.actionId, channelId: row.channelId, revision: row.revision, status, expiresAt: row.expiresAt, mode: row.mode, policy: row.policy };
}
export function publicSheetExecution(row: Entity) { return { kind: 'append' as const, operationRef: row.id, status: row.status === 'appended' ? 'appended' : row.status === 'not_sent' ? 'not_sent' : row.status === 'pending' ? 'pending' : 'uncertain', rowsAppended: row.status === 'appended' ? 1 : null, requiresReconciliation: ['pending', 'uncertain'].includes(String(row.status)), automaticRetry: false }; }
const receiptView = (row: Entity, replayed = true) => ({ key: row.key, kind: row.kind, status: 'succeeded', actionId: row.actionId, grantId: row.grantId ?? null, resultRevision: row.resultRevision, replayed, automaticRetry: false });
const control = { expectedTenantId: tenant, expectedRevision: revision };
const configurationCore = z.object({ name: z.string().trim().min(1).max(120), description: z.string().trim().min(1).max(1000) }).passthrough();
export async function registerSheetActionRoutes(app: FastifyInstance, store: Store) {
  initializeSheetActions(store);
  const base = '/api/v1/agents/:agentId/sheets-actions';
  const params = (r: FastifyRequest) => z.object({ agentId: uuid, actionId: uuid.optional(), grantId: uuid.optional() }).strict().parse(r.params);
  const local = (a: SheetOperatorAuthority, agentId: string, actionId: string) => { const row = store.get(a.actor.tenantId, sheetActions, actionId); if (!row || row.agentId !== agentId) return failSheetAction(404, 'sheet_action_not_found'); scopedConnection(store, a.actor, String(row.connectionId)); return row; };
  const safe = (fn: (req: FastifyRequest) => unknown) => async (req: FastifyRequest, reply: any) => {
    reply.header('Cache-Control', 'no-store');
    try { return await fn(req); } catch (e) { if (e instanceof MembershipError) return reply.code(e.statusCode).send({ error: { code: e.code, message: e.message } }); if (e instanceof OAuthError) return reply.code(e.status).send({ error: { code: e.code, message: e.message } }); if (e instanceof z.ZodError) return reply.code(400).send({ error: { code: 'invalid_sheet_action', message: 'Configuração ou valores inválidos.' } }); throw e; }
  };
  function mutate(req: FastifyRequest, kind: string, body: Record<string, any>, effect: (a: SheetOperatorAuthority) => { actionId: string; grantId?: string; resultRevision: number }) {
    const a = privateAuthority(store, req), idempotencyKey = key.parse(req.headers['idempotency-key']);
    const fingerprint = sheetHash({ kind, params: req.params, body });
    return store.transaction(() => {
      a.assertCurrent(); if (body.expectedTenantId !== a.actor.tenantId) failSheetAction(409, 'tenant_mismatch');
      const old = store.list(a.actor.tenantId, sheetActionReceipts).find(r => r.key === idempotencyKey);
      if (old) { if (!owns(old, a) || old.fingerprint !== fingerprint) failSheetAction(409, 'idempotency_conflict'); return receiptView(old); }
      const result = effect(a); a.assertCurrent();
      const row = store.create(a.actor.tenantId, sheetActionReceipts, { key: idempotencyKey, kind, fingerprint, authority: operatorScope(a), ...result });
      store.create(a.actor.tenantId, 'sheets-action-audit', { operationId: row.id, kind, actionId: result.actionId, actorUserId: a.actor.userId, resultRevision: result.resultRevision });
      a.assertCurrent(); return receiptView(row, false);
    });
  }
  app.get(base, safe(req => { const a = privateAuthority(store, req, false), { agentId } = params(req); const items = store.list(a.actor.tenantId, sheetActions).filter(row => row.agentId === agentId).filter(row => { try { scopedConnection(store, a.actor, String(row.connectionId)); return true; } catch { return false; } }).map(row => sheetActionView(store, row, a.actor)); a.assertCurrent(); return { items }; }));
  app.post(base, safe(req => {
    const { agentId } = params(req), body = z.object({ expectedTenantId: tenant, expectedBindingRevision: revision, configuration: z.unknown() }).strict().parse(req.body);
    const raw = configurationCore.extend({ connectionId: uuid, bindingId: uuid, kind: z.enum(['query', 'append']) }).parse(body.configuration);
    const { connectionId, bindingId, kind, name, description, ...fields } = raw, configuration = parseActionConfiguration(kind, fields);
    return mutate(req, 'action.create', { ...body, configuration: { ...raw, ...configuration } }, a => {
      if (!store.get(a.actor.tenantId, 'agents', agentId)) failSheetAction(404, 'agent_not_found');
      const { binding } = bound(store, a.actor, connectionId, bindingId, kind === 'append');
      if (binding.revision !== body.expectedBindingRevision) failSheetAction(409, 'sheet_action_binding_changed');
      const row = store.create(a.actor.tenantId, sheetActions, { agentId, connectionId, bindingId, kind, name, description, configuration, bindingRevision: binding.revision, enabled: false, revision: 1 });
      return { actionId: row.id, resultRevision: 1 };
    });
  }));
  app.put(base + '/:actionId', safe(req => {
    const { agentId, actionId } = params(req), body = z.object({ ...control, expectedBindingRevision: revision, configuration: z.unknown() }).strict().parse(req.body);
    return mutate(req, 'action.update', body, a => {
      const old = local(a, agentId, actionId!); if (old.revision !== body.expectedRevision || body.expectedRevision >= Number.MAX_SAFE_INTEGER) failSheetAction(409, 'sheet_action_changed');
      const { name, description, ...fields } = configurationCore.parse(body.configuration), configuration = parseActionConfiguration(String(old.kind), fields);
      const { binding } = bound(store, a.actor, String(old.connectionId), String(old.bindingId), old.kind === 'append');
      if (binding.revision !== body.expectedBindingRevision) failSheetAction(409, 'sheet_action_binding_changed');
      store.update(a.actor.tenantId, sheetActions, old.id, { name, description, configuration, bindingRevision: binding.revision, revision: body.expectedRevision + 1 });
      return { actionId: old.id, resultRevision: body.expectedRevision + 1 };
    });
  }));
  app.patch(base + '/:actionId', safe(req => {
    const { agentId, actionId } = params(req), body = z.object({ ...control, enabled: z.boolean() }).strict().parse(req.body);
    return mutate(req, 'action.set_enabled', body, a => {
      const old = local(a, agentId, actionId!); if (old.revision !== body.expectedRevision || body.expectedRevision >= Number.MAX_SAFE_INTEGER) failSheetAction(409, 'sheet_action_changed');
      if (body.enabled) { actionTarget(store, old, a.actor, false); if (store.list(a.actor.tenantId, sheetActions).filter(r => r.agentId === agentId && r.enabled && r.id !== old.id).length >= 10) failSheetAction(409, 'sheet_action_limit'); }
      store.update(a.actor.tenantId, sheetActions, old.id, { enabled: body.enabled, revision: body.expectedRevision + 1 });
      return { actionId: old.id, resultRevision: body.expectedRevision + 1 };
    });
  }));
  app.get(base + '/:actionId/grants', safe(req => { const a = privateAuthority(store, req), { agentId, actionId } = params(req); local(a, agentId, actionId!); return { items: store.list(a.actor.tenantId, sheetGrants).filter(r => r.actionId === actionId).map(r => sheetGrantView(store, r)) }; }));
  const policy = z.object({ expiresInDays: z.number().int().min(1).max(30), maxCallsPerConversation: z.number().int().min(1).max(20), maxCallsPerDay: z.number().int().min(1).max(100), acknowledgePublicDisclosure: z.literal(true), authorizeDelegatedAppend: z.literal(true).optional() }).strict();
  app.post(base + '/:actionId/grants', safe(req => {
    const { agentId, actionId } = params(req), body = z.object({ expectedTenantId: tenant, expectedActionRevision: revision, expectedChannelVersion: z.string().regex(/^[a-f0-9]{64}$/), channelId: uuid, previousGrant: z.object({ id: uuid, revision }).strict().nullable(), policy }).strict().parse(req.body);
    return mutate(req, 'grant.create', body, a => {
      const action = local(a, agentId, actionId!); if (action.revision !== body.expectedActionRevision) failSheetAction(409, 'sheet_action_changed');
      const target = actionTarget(store, action, a.actor), channel = store.get(a.actor.tenantId, 'channels', body.channelId);
      if (target.connection.userId !== a.actor.userId) failSheetAction(403, 'sheet_action_connection_owner_required');
      if (!channel || channel.type !== 'webchat' || channel.provider !== 'openai' || channel.agentId !== agentId || channel.enabled !== true || sheetChannelVersion(channel) !== body.expectedChannelVersion) failSheetAction(409, 'sheet_action_channel_changed');
      if (action.kind === 'append' && (body.policy.maxCallsPerConversation !== 1 || body.policy.authorizeDelegatedAppend !== true)) failSheetAction(400, 'invalid_sheet_action');
      const previous = store.list(a.actor.tenantId, sheetGrants).filter(r => r.actionId === action.id && r.channelId === body.channelId).at(-1);
      if (previous ? body.previousGrant?.id !== previous.id || body.previousGrant.revision !== previous.revision : body.previousGrant !== null) failSheetAction(409, 'sheet_grant_changed');
      if (previous) store.update(a.actor.tenantId, sheetGrants, previous.id, { status: 'revoked', revision: Number(previous.revision) + 1 });
      const issuer = memberSnapshot(store, a.actor.tenantId, a.actor.userId);
      const grant = store.create(a.actor.tenantId, sheetGrants, { actionId: action.id, channelId: channel!.id, actionRevision: action.revision, bindingId: target.binding.id, bindingRevision: target.binding.revision, agentId, agentGeneration: agentDelegationGeneration(target.agent), agentHash: sheetHash(target.agent), channelVersion: sheetChannelVersion(channel!), connectionIdentity: oauthAuthorizationIdentity(target.connection), issuerUserId: a.actor.userId, issuerMembershipId: issuer.id, issuerMembershipRevision: issuer.revision, mode: action.kind === 'query' ? 'disclose_query' : 'delegated_append', policy: body.policy, revision: 1, status: 'active', expiresAt: Date.now() + body.policy.expiresInDays * 86400000 });
      return { actionId: action.id, grantId: grant.id, resultRevision: 1 };
    });
  }));
  app.post(base + '/:actionId/grants/:grantId/revoke', safe(req => {
    const { agentId, actionId, grantId } = params(req), body = z.object(control).strict().parse(req.body);
    return mutate(req, 'grant.revoke', body, a => { local(a, agentId, actionId!); const row = store.get(a.actor.tenantId, sheetGrants, grantId!); if (!row || row.actionId !== actionId || row.revision !== body.expectedRevision || body.expectedRevision >= Number.MAX_SAFE_INTEGER) failSheetAction(409, 'sheet_grant_changed'); store.update(a.actor.tenantId, sheetGrants, row!.id, { status: 'revoked', revision: body.expectedRevision + 1 }); return { actionId: actionId!, grantId, resultRevision: body.expectedRevision + 1 }; });
  }));
  app.post(base + '/:actionId/preview', safe(async req => {
    const a = privateAuthority(store, req, false), { agentId, actionId } = params(req), body = z.object({ ...control, variables: z.unknown() }).strict().parse(req.body);
    if (body.expectedTenantId !== a.actor.tenantId) failSheetAction(409, 'tenant_mismatch');
    const action = local(a, agentId, actionId!); if (action.kind !== 'query' || action.revision !== body.expectedRevision) failSheetAction(409, 'sheet_action_changed');
    const { previewSheetAction } = await import('./agent-sheets.js'); return previewSheetAction(store, action, a, body.variables);
  }));
  app.get('/api/v1/oauth/sheets/chat-operations/:key', safe(async req => {
    const a = privateAuthority(store, req, false), wanted = key.parse(z.object({ key: z.string() }).strict().parse(req.params).key);
    const chat = store.list(a.actor.tenantId, 'provider-operations').find(row => row.operation === 'openai.chat' && row.key === wanted);
    if (!chat || !chat.sheetAuthority || sheetHash(chat.sheetAuthority) !== sheetHash(operatorScope(a))) return failSheetAction(404, 'sheet_action_operation_not_found');
    const { sheetPrivateOperations } = await import('./agent-sheets.js');
    a.assertCurrent(); return { sheetOperations: sheetPrivateOperations(store, a, chat.id, String(chat.chatConversationId ?? '')) };
  }));
  app.get('/api/v1/oauth/sheets/action-executions/:id', safe(req => {
    const a = privateAuthority(store, req, false), wanted = uuid.parse(z.object({ id: z.string() }).strict().parse(req.params).id);
    const row = store.get(a.actor.tenantId, sheetExecutions, wanted), scope = row?.scope as Record<string, unknown> | undefined;
    if (!row || row.kind !== 'append' || scope?.kind !== 'operator' || sheetHash(scope) !== sheetHash({ kind: 'operator', ...operatorScope(a) })) return failSheetAction(404, 'sheet_action_operation_not_found');
    a.assertCurrent(); return publicSheetExecution(row);
  }));
  app.get('/api/v1/oauth/sheets/action-operations/:key', safe(req => {
    const a = privateAuthority(store, req, false), wanted = key.parse(z.object({ key: z.string() }).parse(req.params).key), row = store.list(a.actor.tenantId, sheetActionReceipts).find(r => r.key === wanted);
    if (!row || !owns(row, a)) return failSheetAction(404, 'sheet_action_operation_not_found'); a.assertCurrent(); return receiptView(row);
  }));
}
