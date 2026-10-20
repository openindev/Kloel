import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { Entity, Store } from '../store.js';
import { DomainError } from '../domains.js';
import { hasPermission, type Permission } from '../memberships/permissions.js';
import { resolveSessionContext, sameRequestContext, assertRequestContext, parseExpectedRequestContext } from '../request-context.js';
export const configs = 'after-configurations', configOps = 'after-config-operations', closures = 'conversation-closures', closeOps = 'conversation-close-operations', budgets = 'after-analysis-budgets';
export const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
export const fail = (code: string, status = 409): never => { throw new DomainError(status, code, 'A conversa ou autorização de análise mudou. Consulte o resultado original antes de outra intenção.'); };
export function capture(store: Store, request: FastifyRequest, permissions: Permission[]) {
  if (!parseExpectedRequestContext(request)) fail('expected_context_required', 400); assertRequestContext(store, request);
  const token = request.cookies?.kloel_session, sessionHash = createHash('sha256').update(token ?? '').digest('hex'), original = resolveSessionContext(store, sessionHash);
  if (!token || request.apiKey || request.headers.authorization || !original?.actor || original.actor.userId !== request.actor?.userId || original.actor.tenantId !== request.actor?.tenantId) return fail('authentication_required',401);
  if (!permissions.every(p => hasPermission(original.actor!.role,p))) return fail('forbidden',403);
  const scope = Object.freeze({ userId: original.actor.userId, sessionHash, membershipId: original.context.membershipId, authorityVersion: original.context.authorityVersion });
  const assertCurrent = () => { assertRequestContext(store, request); const live=resolveSessionContext(store,sessionHash); if (!live?.actor || !sameRequestContext(live.context,original.context) || !permissions.every(p=>hasPermission(live.actor!.role,p))) fail('context_changed_in_flight'); };
  return { tenantId: original.actor.tenantId, userId: original.actor.userId, scope, assertCurrent };
}
export type Operator = ReturnType<typeof capture>;
export const owned = (row: Entity, a: Operator) => row.tenantId===a.tenantId && row.authorityRevoked!==true && hash(row.authority)===hash(a.scope);
export function by(store:Store, tenant:string, collection:string, field:'key'|'agentId', value:string) { const rows=store.db.prepare(`SELECT body FROM entities WHERE tenant_id=? AND collection=? AND json_extract(body,'$.${field}')=? LIMIT 2`).all(tenant,collection,value); if(rows.length>1)fail('analysis_state_invalid'); return rows[0]?JSON.parse(String(rows[0].body)) as Entity:undefined; }
export function issuer(store:Store,tenant:string,userId:string) {
  const m=store.db.prepare("SELECT m.id,m.revision,m.role FROM memberships m JOIN organizations o ON o.id=m.tenant_id AND o.status='active' WHERE m.tenant_id=? AND m.user_id=?").get(tenant,userId);
  if(!m||!hasPermission(String(m.role),'agents:write')||!hasPermission(String(m.role),'integrations:manage'))return fail('analysis_authority_revoked',403);
  return {userId,membershipId:String(m.id),membershipRevision:Number(m.revision)};
}
export function delegated(store:Store,row:Entity) {
  if(row.invalidated===true||row.authorizationRevoked===true)return fail('analysis_authority_revoked',403);
  const agent=store.get(row.tenantId,'agents',String(row.agentId));
  if(!agent||agent.status!=='active'||hash(agent)!==row.agentHash||agent.delegationGeneration!==undefined&&!Number.isSafeInteger(agent.delegationGeneration))return fail('analysis_agent_changed');
  if(hash(issuer(store,row.tenantId,String((row.issuer as any)?.userId)))!==hash(row.issuer))return fail('analysis_authority_revoked',403);
  return agent;
}
export function initialize(store:Store) { store.db.exec(`
 CREATE UNIQUE INDEX IF NOT EXISTS after_config_agent ON entities(tenant_id,json_extract(body,'$.agentId')) WHERE collection='after-configurations';
 CREATE UNIQUE INDEX IF NOT EXISTS after_config_key ON entities(tenant_id,json_extract(body,'$.key')) WHERE collection='after-config-operations';
 CREATE UNIQUE INDEX IF NOT EXISTS after_close_key ON entities(tenant_id,json_extract(body,'$.key')) WHERE collection='conversation-close-operations';
 CREATE UNIQUE INDEX IF NOT EXISTS after_closure_epoch ON entities(tenant_id,json_extract(body,'$.conversationId'),json_extract(body,'$.epoch')) WHERE collection='conversation-closures';
 CREATE UNIQUE INDEX IF NOT EXISTS after_budget_day ON entities(tenant_id,json_extract(body,'$.day')) WHERE collection='after-analysis-budgets';
 CREATE TRIGGER IF NOT EXISTS after_messages_insert AFTER INSERT ON entities WHEN NEW.collection='messages' BEGIN
  UPDATE entities SET body=json_set(body,'$.invalidated',json('true'),'$.invalidatedReason','messages_changed') WHERE tenant_id=NEW.tenant_id AND collection='conversation-closures' AND json_extract(body,'$.conversationId')=json_extract(NEW.body,'$.conversationId'); END;
 CREATE TRIGGER IF NOT EXISTS after_messages_update AFTER UPDATE OF body ON entities WHEN NEW.collection='messages' BEGIN
  UPDATE entities SET body=json_set(body,'$.invalidated',json('true'),'$.invalidatedReason','messages_changed') WHERE tenant_id=NEW.tenant_id AND collection='conversation-closures' AND json_extract(body,'$.conversationId') IN (json_extract(OLD.body,'$.conversationId'),json_extract(NEW.body,'$.conversationId')); END;
 CREATE TRIGGER IF NOT EXISTS after_messages_delete AFTER DELETE ON entities WHEN OLD.collection='messages' BEGIN
  UPDATE entities SET body=json_set(body,'$.invalidated',json('true'),'$.invalidatedReason','messages_changed') WHERE tenant_id=OLD.tenant_id AND collection='conversation-closures' AND json_extract(body,'$.conversationId')=json_extract(OLD.body,'$.conversationId'); END;
 CREATE TRIGGER IF NOT EXISTS after_control_update AFTER UPDATE OF body ON entities WHEN NEW.collection='conversations' AND (json_extract(OLD.body,'$.status') IS NOT json_extract(NEW.body,'$.status') OR json_extract(OLD.body,'$.tags') IS NOT json_extract(NEW.body,'$.tags') OR json_extract(OLD.body,'$.agentId') IS NOT json_extract(NEW.body,'$.agentId') OR json_extract(OLD.body,'$.channelId') IS NOT json_extract(NEW.body,'$.channelId') OR json_extract(OLD.body,'$.channel') IS NOT json_extract(NEW.body,'$.channel') OR json_extract(OLD.body,'$.phoneNumberId') IS NOT json_extract(NEW.body,'$.phoneNumberId') OR json_extract(OLD.body,'$.externalContact') IS NOT json_extract(NEW.body,'$.externalContact') OR json_extract(OLD.body,'$.contactId') IS NOT json_extract(NEW.body,'$.contactId') OR json_extract(OLD.body,'$.externalId') IS NOT json_extract(NEW.body,'$.externalId') OR json_extract(OLD.body,'$.metaIdentityPolicy') IS NOT json_extract(NEW.body,'$.metaIdentityPolicy') OR json_extract(OLD.body,'$.metaIdentityStatus') IS NOT json_extract(NEW.body,'$.metaIdentityStatus')) BEGIN
  UPDATE entities SET body=json_set(body,'$.invalidated',json('true'),'$.invalidatedReason','conversation_changed') WHERE tenant_id=NEW.tenant_id AND collection='conversation-closures' AND json_extract(body,'$.conversationId')=NEW.id; END;
 CREATE TRIGGER IF NOT EXISTS after_source_update AFTER UPDATE OF body ON entities WHEN NEW.collection IN ('agents','channels','after-configurations') BEGIN
  UPDATE entities SET body=json_set(body,'$.invalidated',json('true'),'$.invalidatedReason','configuration_changed') WHERE tenant_id=NEW.tenant_id AND collection='conversation-closures' AND ((NEW.collection='agents' AND json_extract(body,'$.agentId')=NEW.id) OR (NEW.collection='channels' AND json_extract(body,'$.channelId')=NEW.id) OR (NEW.collection='after-configurations' AND json_extract(body,'$.configId')=NEW.id));
  UPDATE entities SET body=json_set(body,'$.authorizationRevoked',json('true')) WHERE NEW.collection='agents' AND tenant_id=NEW.tenant_id AND collection='after-configurations' AND json_extract(body,'$.agentId')=NEW.id; END;
 CREATE TRIGGER IF NOT EXISTS after_source_delete AFTER DELETE ON entities WHEN OLD.collection IN ('agents','channels','after-configurations','conversations') BEGIN
  UPDATE entities SET body=json_set(body,'$.invalidated',json('true'),'$.invalidatedReason','source_removed') WHERE tenant_id=OLD.tenant_id AND collection='conversation-closures' AND ((OLD.collection='agents' AND json_extract(body,'$.agentId')=OLD.id) OR (OLD.collection='channels' AND json_extract(body,'$.channelId')=OLD.id) OR (OLD.collection='after-configurations' AND json_extract(body,'$.configId')=OLD.id) OR (OLD.collection='conversations' AND json_extract(body,'$.conversationId')=OLD.id));
  UPDATE entities SET body=json_set(body,'$.authorizationRevoked',json('true')) WHERE OLD.collection='agents' AND tenant_id=OLD.tenant_id AND collection='after-configurations' AND json_extract(body,'$.agentId')=OLD.id; END;
 CREATE TRIGGER IF NOT EXISTS after_org_suspend AFTER UPDATE OF status ON organizations WHEN NEW.status!='active' BEGIN
  UPDATE entities SET body=json_set(body,'$.authorizationRevoked',json('true'),'$.authorityRevoked',json('true'),'$.invalidated',json('true'),'$.invalidatedReason','organization_revoked') WHERE tenant_id=NEW.id AND collection IN ('after-configurations','conversation-closures','after-config-operations','conversation-close-operations'); END;
 CREATE TRIGGER IF NOT EXISTS after_member_change AFTER UPDATE OF role ON memberships WHEN OLD.role!=NEW.role BEGIN
  UPDATE entities SET body=json_set(body,'$.authorizationRevoked',json('true'),'$.invalidated',json('true'),'$.invalidatedReason','membership_revoked') WHERE tenant_id=NEW.tenant_id AND collection IN ('after-configurations','conversation-closures') AND json_extract(body,'$.issuer.membershipId')=OLD.id; END;
 CREATE TRIGGER IF NOT EXISTS after_member_delete AFTER DELETE ON memberships BEGIN
  UPDATE entities SET body=json_set(body,'$.authorizationRevoked',json('true'),'$.invalidated',json('true'),'$.invalidatedReason','membership_revoked') WHERE tenant_id=OLD.tenant_id AND collection IN ('after-configurations','conversation-closures') AND json_extract(body,'$.issuer.membershipId')=OLD.id; END;
 `); }
