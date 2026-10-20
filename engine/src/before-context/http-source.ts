import { z } from 'zod';
import type { Entity, Store } from '../store.js';
import { seal, unseal } from '../oauth/crypto.js';
import { publicUrl } from '../ingestion/safe-url.js';
import { boundedJson, jsonPointer } from '../integrations/schema.js';
import { configuration, hash, fail, findBy, type Operator } from './operations.js';
import { parseConfiguration, type Configuration } from './schema.js';
import { hasPermission } from '../memberships/permissions.js';

const integrationUrl=(value:string)=>{const url=publicUrl(value);if(url.protocol!=='https:')fail(400,'https_required');return url;};
export const httpSources='before-http-sources', httpConfigOps='before-http-config-operations', httpOperations='before-http-operations';
const ids=z.array(z.string().uuid()).max(20).refine(a=>new Set(a).size===a.length);
const clock=z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const sourceSchema=z.object({enabled:z.boolean(),method:z.enum(['GET','POST']),audiences:z.object({private:z.boolean(),voicePrivate:z.boolean(),webchatChannelIds:ids,incomingNumberIds:ids,incomingDefaultRoute:z.boolean()}).strict(),mappings:z.array(z.object({variable:z.string().max(48),jsonPointer:z.string().max(500)}).strict()).min(1).max(20),conditions:z.array(z.unknown()).max(8),schedule:z.object({weekdays:z.array(z.number().int().min(0).max(6)).min(1).max(7).refine(a=>new Set(a).size===a.length),start:clock,end:clock,overnight:z.boolean()}).strict().nullable()}).strict();
export type HttpSourceConfiguration=z.infer<typeof sourceSchema>;
export type HttpSecrets={url:string;headers:Record<string,string>;bodyTemplate?:unknown};
export const secretInput=z.discriminatedUnion('mode',[z.object({mode:z.literal('keep')}).strict(),z.object({mode:z.literal('replace'),url:z.string().max(8000),headers:z.record(z.string().max(8000)),bodyTemplate:z.unknown().optional()}).strict()]);
const aad=(tenant:string,id:string,revision:number)=>`${tenant}:${id}:${revision}:before-http-source`;
const forbidden=/^(host|connection|content-length|transfer-encoding|accept-encoding|user-agent|proxy-.*|x-kloel-.*|idempotency-key|cookie|set-cookie|te|trailer|upgrade)$/i;
export function sourceRow(store:Store,tenant:string,agentId:string){return findBy(store,tenant,httpSources,'agentId',agentId);}
export function sourceSnapshot(store:Store,tenant:string,agentId:string){return hash(sourceRow(store,tenant,agentId)??null);}
export function sourceSnapshotParts(store:Store,tenant:string,agentId:string){const row=sourceRow(store,tenant,agentId);return row?[hash(row)]:[];}
export function sourceAvailability(store:Store,tenant:string,agentId:string){const r=sourceRow(store,tenant,agentId);return r?{revision:Number(r.revision),state:r.needsReauthorization===true?'needs_reauthorization':(r.configuration as HttpSourceConfiguration).enabled?'enabled':'disabled'}:undefined;}
export function openingSourceAvailability(store:Store,tenant:string,agentId:string){const r=sourceRow(store,tenant,agentId);return r&&(r.configuration as HttpSourceConfiguration).enabled?sourceAvailability(store,tenant,agentId):undefined;}
function issuer(store:Store,a:Operator){const m=store.db.prepare('SELECT id,revision,role FROM memberships WHERE tenant_id=? AND user_id=?').get(a.tenantId,a.scope.userId);if(!m||!['owner','admin'].includes(String(m.role))||!hasPermission(String(m.role) as 'owner','agents:write'))return fail(403,'forbidden');return {userId:a.scope.userId,membershipId:String(m.id),membershipRevision:Number(m.revision)};}
function dependencies(store:Store,tenant:string,agentId:string,c:HttpSourceConfiguration){
 const agent=store.get(tenant,'agents',agentId);if(!agent)fail(404,'not_found');
 const channels=c.audiences.webchatChannelIds.map(id=>{const r=store.get(tenant,'channels',id);if(!r||r.agentId!==agentId||r.type!=='webchat'||r.provider!=='openai'||r.enabled!==true)fail(409,'before_http_audience_unavailable');return r;});
 const numbers=c.audiences.incomingNumberIds.map(id=>{const r=store.get(tenant,'phone-numbers',id),ch=r?.channelId?store.get(tenant,'channels',String(r.channelId)):undefined;if(!r||r.agentId!==agentId||!ch||ch.agentId!==agentId||ch.type!=='phone'||ch.enabled!==true)fail(409,'before_http_audience_unavailable');return {number:r,channel:ch};});
 if(c.audiences.incomingDefaultRoute&&process.env.OPENAI_INBOUND_AGENT_ID!==agentId)fail(409,'before_http_audience_unavailable');
 return hash({agent,before:configuration(store,tenant,agentId).row??null,channels,numbers,defaultRoute:c.audiences.incomingDefaultRoute?agentId:null});
}
export function assertSource(store:Store,row:Entity){
 const current=sourceRow(store,row.tenantId,String(row.agentId)),original=row.issuer as {userId:string;membershipId:string;membershipRevision:number};
 const m=store.db.prepare('SELECT id,revision,role FROM memberships WHERE tenant_id=? AND user_id=?').get(row.tenantId,original.userId);
 if(!current||hash(current)!==hash(row)||current.needsReauthorization===true||!m||m.id!==original.membershipId||Number(m.revision)!==original.membershipRevision||!['owner','admin'].includes(String(m.role))||store.db.prepare('SELECT status FROM organizations WHERE id=?').get(row.tenantId)?.status!=='active')fail(409,'before_http_authority_revoked');
 if(dependencies(store,row.tenantId,String(row.agentId),row.configuration as HttpSourceConfiguration)!==row.dependencyHash)fail(409,'before_http_changed');
}
export function publicSource(store:Store,tenant:string,agentId:string){const r=sourceRow(store,tenant,agentId);return {agentId,sourceId:r?.id??null,revision:r?.revision??0,beforeRevision:r?.beforeRevision??null,state:r?sourceAvailability(store,tenant,agentId)!.state:'absent',configuration:r?.configuration??null,targetOrigin:r?.targetOrigin??null,configuredHeaderNames:r?.configuredHeaderNames??[],hasBodyTemplate:r?.hasBodyTemplate??false};}
export function parseSource(raw:unknown,before:Configuration){
 boundedJson(raw,32768);const c=sourceSchema.parse(raw),vars=new Map(before.variables.map(v=>[v.name,v]));
 if(new Set(c.mappings.map(m=>m.variable)).size!==c.mappings.length)fail(400,'invalid_input');
 for(const m of c.mappings){if(!vars.has(m.variable))fail(400,'invalid_input');jsonPointer({},m.jsonPointer);}
 if(c.conditions.length)parseConfiguration({...before,greetingRules:[{conditions:c.conditions,greeting:''}]});
 if(c.conditions.some(x=>(x as {field?:string}).field==='system.phone'))fail(400,'invalid_input');
 if(c.schedule&&(c.schedule.start===c.schedule.end||c.schedule.overnight!==(c.schedule.start>c.schedule.end)))fail(400,'invalid_input');return c;
}
export function renderHttpBody(template:unknown,values:Record<string,unknown>,facts:Record<string,unknown>,validateOnly=false):unknown {
 if(Array.isArray(template))return template.map(x=>renderHttpBody(x,values,facts,validateOnly));
 if(template&&typeof template==='object'){
  const entries=Object.entries(template);if(entries.some(([k])=>['__proto__','constructor','prototype'].includes(k)))fail(400,'invalid_input');
  if(Object.hasOwn(template,'$before')){const ref=(template as {$before:unknown}).$before;if(entries.length!==1||typeof ref!=='string')return fail(400,'invalid_input');const [space,name,...extra]=ref.split('.');const source=space==='vars'?values:space==='system'&&['agentName','companyName','surface','direction','localTime','weekday','startedAt'].includes(name)?facts:undefined;if(extra.length||!source||!Object.hasOwn(source,name))fail(400,'invalid_input');return source![name];}
  return Object.fromEntries(entries.map(([k,v])=>[k,renderHttpBody(v,values,facts,validateOnly)]));
 }return template;
}
export function sourceSecrets(row:Entity):HttpSecrets {try{return unseal(String(row.encryptedSecrets),aad(row.tenantId,row.id,Number(row.revision)));}catch{return fail(503,'before_http_storage_unavailable');}}
export const httpConfigReceipt=(r:Entity)=>({key:r.key,kind:'before_http.configure',tenantId:r.tenantId,agentId:r.agentId,sourceId:r.sourceId,expectedRevision:r.expectedRevision,revision:r.revision,beforeRevision:r.beforeRevision,status:'succeeded',automaticRetry:false,createdAt:r.createdAt});
export function ownedHttpConfig(store:Store,a:Operator,key:string){a.assertCurrent();const r=findBy(store,a.tenantId,httpConfigOps,'key',key);if(!r||r.authorityRevoked===true||hash(r.authority)!==hash(a.scope))return fail(404,'before_context_operation_not_found');a.assertCurrent();return r;}
export function configureHttp(store:Store,a:Operator,agentId:string,b:{expectedTenantId:string;expectedRevision:number;expectedBeforeRevision:number;idempotencyKey:string;configuration:unknown;secrets:z.infer<typeof secretInput>}){
 a.assertCurrent();issuer(store,a);if(b.expectedTenantId!==a.tenantId)fail(409,'context_mismatch');const fingerprint=hash({agentId,...b});
 return store.transaction(()=>{
  a.assertCurrent();const old=findBy(store,a.tenantId,httpConfigOps,'key',b.idempotencyKey);if(old){if(old.authorityRevoked===true||hash(old.authority)!==hash(a.scope)||old.fingerprint!==fingerprint)fail(409,'before_context_key_conflict');return {operation:httpConfigReceipt(old),replayed:true};}
  const current=sourceRow(store,a.tenantId,agentId),revision=Number(current?.revision??0),before=configuration(store,a.tenantId,agentId);
  if(!Number.isSafeInteger(revision)||revision<0||revision===Number.MAX_SAFE_INTEGER)fail(409,'before_context_revision_exhausted');if(revision!==b.expectedRevision)fail(409,'before_http_revision_conflict');if(before.revision!==b.expectedBeforeRevision)fail(409,'before_http_before_revision_conflict');
  const c=parseSource(b.configuration,before.configuration);if(c.enabled&&(!current||!before.configuration.enabled))fail(409,'before_http_enable_requires_configuration');
  const secret=b.secrets.mode==='keep'?(current?sourceSecrets(current):fail(400,'invalid_input')):b.secrets;
  const url=integrationUrl(secret.url),headers:Record<string,string>={};if(Object.keys(secret.headers).length>30)fail(400,'invalid_input');
  for(const [name,value] of Object.entries(secret.headers)){if(!/^[!#$%&'*+.^_\x60|~0-9A-Za-z-]+$/.test(name)||forbidden.test(name)||/[\r\n\0]/.test(value)||headers[name.toLowerCase()]!==undefined)fail(400,'invalid_input');headers[name.toLowerCase()]=value;}
  if(c.method==='GET'&&secret.bodyTemplate!==undefined)fail(400,'body_not_allowed');
  const values=Object.fromEntries(before.configuration.variables.map(v=>[v.name,v.defaultValue]));if(secret.bodyTemplate!==undefined){boundedJson(secret.bodyTemplate,16384);boundedJson(renderHttpBody(secret.bodyTemplate,values,{agentName:'',companyName:'',surface:'private',direction:'unknown',localTime:'00:00',weekday:0,startedAt:''},true),16384);}
  const bound=dependencies(store,a.tenantId,agentId,c),by=issuer(store,a),record={agentId,revision:revision+1,beforeRevision:before.revision,configuration:c,issuer:by,dependencyHash:bound,needsReauthorization:false,targetOrigin:url.origin,configuredHeaderNames:Object.keys(headers),hasBodyTemplate:secret.bodyTemplate!==undefined};
  const row=current?store.update(a.tenantId,httpSources,current.id,record)!:store.create(a.tenantId,httpSources,record);
  let encryptedSecrets:string;try{encryptedSecrets=seal({url:url.href,headers,...(secret.bodyTemplate===undefined?{}:{bodyTemplate:secret.bodyTemplate})},aad(a.tenantId,row.id,revision+1));}catch{return fail(503,'before_http_storage_unavailable');}
  store.update(a.tenantId,httpSources,row.id,{encryptedSecrets});
  const op=store.create(a.tenantId,httpConfigOps,{key:b.idempotencyKey,agentId,sourceId:row.id,expectedRevision:revision,revision:revision+1,beforeRevision:before.revision,authority:a.scope,fingerprint});a.assertCurrent();issuer(store,a);return {operation:httpConfigReceipt(op),replayed:false};
 });
}
export function initializeBeforeHttp(store:Store){
 store.db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS before_http_source_agent ON entities(tenant_id,json_extract(body,'$.agentId')) WHERE collection='${httpSources}';CREATE UNIQUE INDEX IF NOT EXISTS before_http_config_key ON entities(tenant_id,json_extract(body,'$.key')) WHERE collection='${httpConfigOps}';CREATE UNIQUE INDEX IF NOT EXISTS before_http_operation_opening ON entities(tenant_id,json_extract(body,'$.openingId')) WHERE collection='${httpOperations}';`);
 for(const event of ['INSERT','UPDATE','DELETE']){const r=event==='DELETE'?'OLD':'NEW';store.db.exec(`CREATE TRIGGER IF NOT EXISTS before_http_opening_${event.toLowerCase()} AFTER ${event}${event==='UPDATE'?' OF body':''} ON entities WHEN ${r}.collection='${httpSources}' BEGIN UPDATE entities SET body=json_set(body,'$.invalidated',json('true')) WHERE tenant_id=${r}.tenant_id AND collection IN ('before-context-openings','before-voice-openings') AND json_extract(body,'$.agentId')=json_extract(${r}.body,'$.agentId'); END;`);}
 for(const event of ['UPDATE','DELETE']){const r=event==='DELETE'?'OLD':'NEW';store.db.exec(`CREATE TRIGGER IF NOT EXISTS before_http_dependency_${event.toLowerCase()} AFTER ${event}${event==='UPDATE'?' OF body':''} ON entities WHEN ${r}.collection IN ('agents','before-context-configurations','channels','phone-numbers') BEGIN UPDATE entities SET body=json_set(body,'$.needsReauthorization',json('true')) WHERE tenant_id=${r}.tenant_id AND collection='${httpSources}' AND ((${r}.collection='agents' AND json_extract(body,'$.agentId')=${r}.id) OR (${r}.collection='before-context-configurations' AND json_extract(body,'$.agentId')=json_extract(${r}.body,'$.agentId')) OR (${r}.collection='channels' AND (EXISTS(SELECT 1 FROM json_each(json_extract(body,'$.configuration.audiences.webchatChannelIds')) WHERE value=${r}.id) OR EXISTS(SELECT 1 FROM entities n WHERE n.tenant_id=${r}.tenant_id AND n.collection='phone-numbers' AND json_extract(n.body,'$.channelId')=${r}.id AND n.id IN (SELECT value FROM json_each(json_extract(entities.body,'$.configuration.audiences.incomingNumberIds')))))) OR (${r}.collection='phone-numbers' AND EXISTS(SELECT 1 FROM json_each(json_extract(body,'$.configuration.audiences.incomingNumberIds')) WHERE value=${r}.id))); END;`);}
 store.db.exec(`CREATE TRIGGER IF NOT EXISTS before_http_org AFTER UPDATE OF status ON organizations WHEN NEW.status!='active' BEGIN UPDATE entities SET body=json_set(body,'$.needsReauthorization',json('true')) WHERE tenant_id=NEW.id AND collection='${httpSources}';UPDATE entities SET body=json_set(body,'$.authorityRevoked',json('true')) WHERE tenant_id=NEW.id AND collection='${httpConfigOps}';END;`);
 for(const event of ['UPDATE','DELETE'])store.db.exec(`CREATE TRIGGER IF NOT EXISTS before_http_member_${event.toLowerCase()} AFTER ${event} ON memberships BEGIN UPDATE entities SET body=json_set(body,'$.needsReauthorization',json('true')) WHERE tenant_id=OLD.tenant_id AND collection='${httpSources}' AND json_extract(body,'$.issuer.membershipId')=OLD.id;END;`);
}
