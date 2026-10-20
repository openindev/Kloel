import type { Entity, Store } from '../store.js';
import { DomainError } from '../domains.js';
import { capture, hash, owned, type Operator } from '../conversation-analysis/authority.js';
import { hasPermission } from '../memberships/permissions.js';
import { resolveMembershipActor } from '../memberships/service.js';
import { actionCollection, authorizedAction } from '../integrations/access.js';
import { argumentSchema } from '../integrations/schema.js';
import { samplePayload, templates } from './schema.js';
export { capture, hash, owned, type Operator };
export const configs = 'after-http-configurations', configOps = 'after-http-config-operations', jobs = 'after-http-jobs', budgets = 'after-http-budgets';
export const fail = (code: string, status = 409): never => { throw new DomainError(status, code, 'A autorização ou o encerramento mudou. Consulte o recibo original.'); };
export const codeOf = (e: unknown) => e instanceof DomainError && /^[a-z][a-z0-9_]{0,99}$/.test(e.code) ? e.code : 'after_http_interrupted';
export function by(store: Store, tenant: string, collection: string, field: 'agentId'|'key', value: string): Entity|undefined {
 const found = store.db.prepare(`SELECT body FROM entities WHERE tenant_id=? AND collection=? AND json_extract(body,'$.${field}')=? LIMIT 2`).all(tenant, collection, value); if (found.length > 1) fail('after_http_state_invalid'); return found[0] ? JSON.parse(String(found[0].body)) : undefined;
}
export function issuer(store: Store, tenant: string, userId: string) {
 const actor = resolveMembershipActor(store, userId, tenant), member = store.db.prepare('SELECT id,revision FROM memberships WHERE tenant_id=? AND user_id=?').get(tenant,userId);
 if (!actor || !member || !['agents:write','integrations:manage','integrations:execute'].every(p => hasPermission(actor.role,p as any))) return fail('after_http_authority_revoked',403);
 return { actor, identity: { userId, membershipId: String(member.id), membershipRevision: Number(member.revision) } };
}
export const actionFingerprint = (a: Entity) => hash([a.id,a.revision,a.template,a.method,a.targetOrigin,a.encryptedConfig,a.argumentsSchema,a.responsePaths,a.timeoutMs,a.enabled,a.agentIds,a.allowedRoles]);
export function eligibleAction(store: Store, tenant: string, userId: string, agentId: string, actionId: string) {
 const {actor} = issuer(store,tenant,userId), {action} = authorizedAction(store,actor,actionId);
 if (action.method !== 'POST' || !templates.includes(String(action.template)) || !Array.isArray(action.agentIds) || !action.agentIds.includes(agentId) || typeof action.targetOrigin !== 'string' || !action.targetOrigin.startsWith('https://') || !Number.isSafeInteger(action.revision) || Number(action.revision) < 1) return fail('after_http_action_ineligible');
 const {validate} = argumentSchema(action.argumentsSchema);
 if (!validate({...samplePayload,agentRef:agentId}) || !validate({...samplePayload,agentRef:agentId,channel:'whatsapp'})) return fail('after_http_payload_incompatible',400);
 return {actor,action};
}
export function delegated(store: Store, row: Entity) {
 if (row.invalidated === true || row.authorizationRevoked === true) return fail('after_http_authority_revoked',403);
 const agent = store.get(row.tenantId,'agents',String(row.agentId));
 if (!agent || agent.status !== 'active' || hash(agent) !== row.agentHash) return fail('after_http_agent_changed');
 const currentIssuer = issuer(store,row.tenantId,String((row.issuer as any)?.userId));
 if (hash(currentIssuer.identity) !== hash(row.issuer)) return fail('after_http_authority_revoked',403);
 const {action,actor} = eligibleAction(store,row.tenantId,currentIssuer.actor.userId,agent.id,String((row.configuration as any)?.actionId));
 if (action.revision !== row.actionRevision || actionFingerprint(action) !== row.actionFingerprint) return fail('after_http_action_changed');
 return {agent,action,actor};
}
export function initialize(store: Store) { store.db.exec(`
 CREATE UNIQUE INDEX IF NOT EXISTS after_http_agent ON entities(tenant_id,json_extract(body,'$.agentId')) WHERE collection='${configs}';
 CREATE UNIQUE INDEX IF NOT EXISTS after_http_config_key ON entities(tenant_id,json_extract(body,'$.key')) WHERE collection='${configOps}';
 CREATE UNIQUE INDEX IF NOT EXISTS after_http_lane ON entities(tenant_id,json_extract(body,'$.conversationId'),json_extract(body,'$.epoch')) WHERE collection='${jobs}';
 CREATE UNIQUE INDEX IF NOT EXISTS after_http_job_revision ON entities(tenant_id,json_extract(body,'$.conversationId'),json_extract(body,'$.epoch'),json_extract(body,'$.configRevision')) WHERE collection='${jobs}';
 CREATE UNIQUE INDEX IF NOT EXISTS after_http_budget ON entities(tenant_id,json_extract(body,'$.day')) WHERE collection='${budgets}';
 CREATE TRIGGER IF NOT EXISTS after_http_message_insert AFTER INSERT ON entities WHEN NEW.collection='messages' BEGIN
  UPDATE entities SET body=json_set(body,'$.invalidated',json('true'),'$.invalidatedReason','messages_changed') WHERE tenant_id=NEW.tenant_id AND collection='${jobs}' AND json_extract(body,'$.conversationId')=json_extract(NEW.body,'$.conversationId'); END;
 CREATE TRIGGER IF NOT EXISTS after_http_message_update AFTER UPDATE OF body ON entities WHEN NEW.collection='messages' BEGIN
  UPDATE entities SET body=json_set(body,'$.invalidated',json('true'),'$.invalidatedReason','messages_changed') WHERE tenant_id=NEW.tenant_id AND collection='${jobs}' AND json_extract(body,'$.conversationId') IN (json_extract(OLD.body,'$.conversationId'),json_extract(NEW.body,'$.conversationId')); END;
 CREATE TRIGGER IF NOT EXISTS after_http_message_delete AFTER DELETE ON entities WHEN OLD.collection='messages' BEGIN
  UPDATE entities SET body=json_set(body,'$.invalidated',json('true'),'$.invalidatedReason','messages_changed') WHERE tenant_id=OLD.tenant_id AND collection='${jobs}' AND json_extract(body,'$.conversationId')=json_extract(OLD.body,'$.conversationId'); END;
 CREATE TRIGGER IF NOT EXISTS after_http_conversation_update AFTER UPDATE OF body ON entities WHEN NEW.collection='conversations' BEGIN
  UPDATE entities SET body=json_set(body,'$.invalidated',json('true'),'$.invalidatedReason','conversation_changed') WHERE tenant_id=NEW.tenant_id AND collection='${jobs}' AND json_extract(body,'$.conversationId')=NEW.id; END;
 CREATE TRIGGER IF NOT EXISTS after_http_source_update AFTER UPDATE OF body ON entities WHEN NEW.collection IN ('agents','channels','${configs}') BEGIN
  UPDATE entities SET body=json_set(body,'$.invalidated',json('true'),'$.invalidatedReason','configuration_changed') WHERE tenant_id=NEW.tenant_id AND collection='${jobs}' AND ((NEW.collection='agents' AND json_extract(body,'$.agentId')=NEW.id) OR (NEW.collection='channels' AND json_extract(body,'$.channelId')=NEW.id) OR (NEW.collection='${configs}' AND json_extract(body,'$.configId')=NEW.id));
  UPDATE entities SET body=json_set(body,'$.authorizationRevoked',json('true')) WHERE tenant_id=NEW.tenant_id AND collection='${configs}' AND ((NEW.collection='agents' AND json_extract(body,'$.agentId')=NEW.id) OR (NEW.collection='channels' AND json_extract(body,'$.agentId') IN (json_extract(OLD.body,'$.agentId'),json_extract(NEW.body,'$.agentId')))); END;
 CREATE TRIGGER IF NOT EXISTS after_http_action_update AFTER UPDATE OF body ON entities WHEN NEW.collection='${actionCollection}' AND (
  json_extract(NEW.body,'$.revision') IS NOT json_extract(OLD.body,'$.revision') OR json_extract(NEW.body,'$.template') IS NOT json_extract(OLD.body,'$.template') OR json_extract(NEW.body,'$.method') IS NOT json_extract(OLD.body,'$.method') OR json_extract(NEW.body,'$.targetOrigin') IS NOT json_extract(OLD.body,'$.targetOrigin') OR json_extract(NEW.body,'$.encryptedConfig') IS NOT json_extract(OLD.body,'$.encryptedConfig') OR json_extract(NEW.body,'$.argumentsSchema') IS NOT json_extract(OLD.body,'$.argumentsSchema') OR json_extract(NEW.body,'$.responsePaths') IS NOT json_extract(OLD.body,'$.responsePaths') OR json_extract(NEW.body,'$.timeoutMs') IS NOT json_extract(OLD.body,'$.timeoutMs') OR json_extract(NEW.body,'$.enabled') IS NOT json_extract(OLD.body,'$.enabled') OR json_extract(NEW.body,'$.agentIds') IS NOT json_extract(OLD.body,'$.agentIds') OR json_extract(NEW.body,'$.allowedRoles') IS NOT json_extract(OLD.body,'$.allowedRoles')) BEGIN
  UPDATE entities SET body=json_set(body,'$.authorizationRevoked',json('true'),'$.invalidated',json('true'),'$.invalidatedReason','action_changed') WHERE tenant_id=NEW.tenant_id AND ((collection='${configs}' AND json_extract(body,'$.configuration.actionId')=NEW.id) OR (collection='${jobs}' AND json_extract(body,'$.actionId')=NEW.id)); END;
 CREATE TRIGGER IF NOT EXISTS after_http_source_delete AFTER DELETE ON entities WHEN OLD.collection IN ('agents','channels','${configs}','conversations','${actionCollection}') BEGIN
  UPDATE entities SET body=json_set(body,'$.invalidated',json('true'),'$.invalidatedReason','source_removed') WHERE tenant_id=OLD.tenant_id AND collection='${jobs}' AND ((OLD.collection='agents' AND json_extract(body,'$.agentId')=OLD.id) OR (OLD.collection='channels' AND json_extract(body,'$.channelId')=OLD.id) OR (OLD.collection='${configs}' AND json_extract(body,'$.configId')=OLD.id) OR (OLD.collection='conversations' AND json_extract(body,'$.conversationId')=OLD.id) OR (OLD.collection='${actionCollection}' AND json_extract(body,'$.actionId')=OLD.id));
  UPDATE entities SET body=json_set(body,'$.authorizationRevoked',json('true')) WHERE tenant_id=OLD.tenant_id AND collection='${configs}' AND ((OLD.collection='agents' AND json_extract(body,'$.agentId')=OLD.id) OR (OLD.collection='channels' AND json_extract(body,'$.agentId')=json_extract(OLD.body,'$.agentId')) OR (OLD.collection='${actionCollection}' AND json_extract(body,'$.configuration.actionId')=OLD.id)); END;
 CREATE TRIGGER IF NOT EXISTS after_http_org_suspend AFTER UPDATE OF status ON organizations WHEN NEW.status!='active' BEGIN
  UPDATE entities SET body=json_set(body,'$.authorizationRevoked',json('true'),'$.authorityRevoked',json('true'),'$.invalidated',json('true'),'$.invalidatedReason','organization_revoked') WHERE tenant_id=NEW.id AND collection IN ('${configs}','${jobs}','${configOps}'); END;
 CREATE TRIGGER IF NOT EXISTS after_http_member_change AFTER UPDATE OF role,revision ON memberships WHEN OLD.role!=NEW.role OR OLD.revision!=NEW.revision BEGIN
  UPDATE entities SET body=json_set(body,'$.authorizationRevoked',json('true'),'$.invalidated',json('true'),'$.invalidatedReason','membership_revoked') WHERE tenant_id=NEW.tenant_id AND collection IN ('${configs}','${jobs}') AND json_extract(body,'$.issuer.membershipId')=OLD.id; END;
 CREATE TRIGGER IF NOT EXISTS after_http_member_delete AFTER DELETE ON memberships BEGIN
  UPDATE entities SET body=json_set(body,'$.authorizationRevoked',json('true'),'$.invalidated',json('true'),'$.invalidatedReason','membership_revoked') WHERE tenant_id=OLD.tenant_id AND collection IN ('${configs}','${jobs}') AND json_extract(body,'$.issuer.membershipId')=OLD.id; END;
 `); }
