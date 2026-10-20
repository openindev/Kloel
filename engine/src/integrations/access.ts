import type { Store } from '../store.js';
import { DomainError } from '../domains.js';
import { currentActor, privileged, type Actor } from '../oauth/access.js';
import { hasPermission } from '../memberships/permissions.js';
export const actionCollection='integration-actions',operationCollection='integration-operations';
export function integrationActor(store:Store,actor:Actor,admin=false){
  actor=currentActor(store,actor);
  if(admin&&!privileged(actor))throw new DomainError(403,'forbidden','Somente proprietário e administrador podem configurar integrações.');
  return actor;
}
export function authorizedAction(store:Store,actor:Actor,id:string){
  actor=integrationActor(store,actor);const action=store.get(actor.tenantId,actionCollection,id);
  if(!action)throw new DomainError(404,'action_not_found','Ação não encontrada.');
  if(!hasPermission(actor.role,'integrations:execute'))throw new DomainError(403,'action_not_authorized','Seu papel não permite executar integrações.');
  if(!Array.isArray(action.allowedRoles)||!action.allowedRoles.includes(actor.role))throw new DomainError(403,'action_not_authorized','Ação não autorizada para esta função.');
  if(!action.enabled)throw new DomainError(503,'action_disabled','Ação desabilitada.');
  return {actor,action};
}
