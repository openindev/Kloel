import { z } from 'zod';
import type { Store, Entity } from '../store.js';
import { digest } from '../oauth/crypto.js';

export const C = { connections:'calendly-connections', states:'calendly-oauth-states', refresh:'calendly-refresh-operations', actions:'calendly-actions', config:'calendly-configuration-operations', choices:'calendly-choices', operations:'calendly-operations', cursors:'calendly-cursors', cancellations:'calendly-cancellation-operations' } as const;
export const uuid=z.string().uuid(), revision=z.number().int().positive().safe(), token=z.string().regex(/^[A-Za-z0-9_-]{43}$/), stamp=z.string().datetime({offset:true});
export const timezone=z.string().min(1).max(100).refine(v=>{try{new Intl.DateTimeFormat('en',{timeZone:v});return true;}catch{return false;}});
export const hash=(v:unknown)=>digest(JSON.stringify(v)??'undefined');
export class CalendlyError extends Error { constructor(readonly status:number,readonly code:string){super('Consulte a tentativa original e a configuração Calendly antes de outra ação.');} }
export function fail(status:number,code:string):never{throw new CalendlyError(status,code);}
export const nextRevision=(v:unknown)=>{const n=revision.parse(v);if(n===Number.MAX_SAFE_INTEGER)fail(409,'calendly_revision_conflict');return n+1;};
export function findKey(store:Store,tenant:string,collection:string,key:string):Entity|undefined{return store.list(tenant,collection).find(r=>r.key===key);}
export function initializeCalendly(store:Store){
  store.db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS calendly_cancellation_key ON entities(tenant_id,json_extract(body,'$.key')) WHERE collection='${C.cancellations}';
    CREATE UNIQUE INDEX IF NOT EXISTS calendly_cancellation_lane ON entities(tenant_id,json_extract(body,'$.targetHash')) WHERE collection='${C.cancellations}' AND json_extract(body,'$.laneHeld')=1;
    CREATE UNIQUE INDEX IF NOT EXISTS calendly_config_key ON entities(tenant_id,json_extract(body,'$.key')) WHERE collection='${C.config}';
    CREATE UNIQUE INDEX IF NOT EXISTS calendly_operation_key ON entities(tenant_id,json_extract(body,'$.key')) WHERE collection='${C.operations}';
    CREATE UNIQUE INDEX IF NOT EXISTS calendly_oauth_key ON entities(tenant_id,json_extract(body,'$.key')) WHERE collection='${C.states}';
    CREATE UNIQUE INDEX IF NOT EXISTS calendly_refresh_version ON entities(tenant_id,json_extract(body,'$.connectionId'),json_extract(body,'$.tokenVersion')) WHERE collection='${C.refresh}';
    CREATE TRIGGER IF NOT EXISTS calendly_resource_update AFTER UPDATE OF body ON entities WHEN NEW.collection IN ('agents','channels') BEGIN
      UPDATE entities SET body=json_set(body,'$.invalidated',json('true')) WHERE tenant_id=NEW.tenant_id AND collection='${C.actions}' AND ((NEW.collection='agents' AND json_extract(body,'$.agentId')=NEW.id) OR (NEW.collection='channels' AND json_extract(body,'$.channelId')=NEW.id));
    END;
    CREATE TRIGGER IF NOT EXISTS calendly_resource_delete AFTER DELETE ON entities WHEN OLD.collection IN ('agents','channels') BEGIN
      UPDATE entities SET body=json_set(body,'$.invalidated',json('true')) WHERE tenant_id=OLD.tenant_id AND collection='${C.actions}' AND ((OLD.collection='agents' AND json_extract(body,'$.agentId')=OLD.id) OR (OLD.collection='channels' AND json_extract(body,'$.channelId')=OLD.id));
    END;
    CREATE TRIGGER IF NOT EXISTS calendly_org_suspend AFTER UPDATE OF status ON organizations WHEN NEW.status!='active' BEGIN
      UPDATE entities SET body=json_set(body,'$.invalidated',json('true')) WHERE tenant_id=NEW.id AND collection IN ('${C.actions}','${C.connections}','${C.states}');
    END;
    CREATE TRIGGER IF NOT EXISTS calendly_member_update AFTER UPDATE ON memberships BEGIN
      UPDATE entities SET body=json_set(body,'$.invalidated',json('true')) WHERE tenant_id=OLD.tenant_id AND collection IN ('${C.actions}','${C.connections}','${C.states}') AND json_extract(body,'$.issuerUserId')=OLD.user_id;
    END;
    CREATE TRIGGER IF NOT EXISTS calendly_member_delete AFTER DELETE ON memberships BEGIN
      UPDATE entities SET body=json_set(body,'$.invalidated',json('true')) WHERE tenant_id=OLD.tenant_id AND collection IN ('${C.actions}','${C.connections}','${C.states}') AND json_extract(body,'$.issuerUserId')=OLD.user_id;
    END;
  `);
}
