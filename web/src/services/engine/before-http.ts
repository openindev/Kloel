import { EngineError } from './http'
import type { EngineContext } from './session'
import { parseBeforeConfiguration, type BeforeConfiguration, type BeforeCondition } from './before-context'

export type HttpConfiguration = { enabled:boolean; method:'GET'|'POST'; audiences:{private:boolean;voicePrivate:boolean;webchatChannelIds:string[];incomingNumberIds:string[];incomingDefaultRoute:boolean}; mappings:{variable:string;jsonPointer:string}[];conditions:BeforeCondition[];schedule:null|{weekdays:number[];start:string;end:string;overnight:boolean} }
export type HttpSource = {agentId:string;sourceId:string|null;revision:number;beforeRevision:number|null;state:'absent'|'disabled'|'enabled'|'needs_reauthorization';configuration:HttpConfiguration|null;targetOrigin:string|null;configuredHeaderNames:string[];hasBodyTemplate:boolean}
export type HttpSecrets = {mode:'keep'}|{mode:'replace';url:string;headers:Record<string,string>;bodyTemplate?:unknown}
export type HttpAttempt = {key:string;agentId:string;expectedRevision:number;expectedBeforeRevision:number}
export type HttpOperation = {key:string;kind:'before_http.configure';tenantId:string;agentId:string;sourceId:string;expectedRevision:number;revision:number;beforeRevision:number;status:'succeeded';automaticRetry:false;createdAt:string}
export type HttpAvailability = {revision:number;state:'enabled'|'needs_reauthorization'}
export const httpReasons = ['test_no_io','audience_not_selected','condition_not_matched','outside_hours','http_timeout','http_transport_error','http_non_success','http_response_invalid','before_http_changed','before_http_authority_revoked','before_http_cancelled','before_http_interrupted'] as const
export type HttpMetadata = {operationId:string;sourceRevision:number;state:'not_dispatched'|'reserved'|'dispatched'|'response_observed'|'unknown';resolution:'pending'|'external'|'defaults'|'blocked'|'unknown';reasonCode:null|typeof httpReasons[number];httpStatus:number|null;startedAt:string;deadlineAt:string;completedAt:string|null;automaticRetry:false}
const object = (v:unknown):v is Record<string,any> => !!v && typeof v==='object'&&!Array.isArray(v)
const exact=(v:Record<string,any>,keys:string[],optional:string[]=[])=>keys.every(k=>Object.hasOwn(v,k))&&Object.keys(v).every(k=>keys.includes(k)||optional.includes(k))
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(v)
const rev=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0
const date=(v:unknown):v is string=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT/.test(v)&&Number.isFinite(Date.parse(v))
const time=(v:unknown):v is string=>typeof v==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v)
const bytes=(v:unknown)=>new TextEncoder().encode(JSON.stringify(v)).length
function invalid():never {throw new EngineError(0,'invalid_before_http','Confira a configuração da fonte HTTP. O conteúdo secreto não será exibido; preserve referências pendentes.')}
function safe(v:unknown,depth=0){if(depth>30)invalid();if(v&&typeof v==='object')for(const[k,x]of Object.entries(v)){if(['__proto__','constructor','prototype'].includes(k))invalid();safe(x,depth+1)}}
export const initialHttpConfiguration=():HttpConfiguration=>({enabled:false,method:'GET',audiences:{private:false,voicePrivate:false,webchatChannelIds:[],incomingNumberIds:[],incomingDefaultRoute:false},mappings:[],conditions:[],schedule:null})
export function parseHttpConfiguration(raw:unknown,before?:BeforeConfiguration):HttpConfiguration {
 safe(raw);if(!object(raw)||!exact(raw,['enabled','method','audiences','mappings','conditions','schedule'])||typeof raw.enabled!=='boolean'||!['GET','POST'].includes(raw.method)||bytes(raw)>32768)invalid()
 const a=raw.audiences;if(!object(a)||!exact(a,['private','voicePrivate','webchatChannelIds','incomingNumberIds','incomingDefaultRoute'])||['private','voicePrivate','incomingDefaultRoute'].some(k=>typeof a[k]!=='boolean'))invalid()
 for(const k of ['webchatChannelIds','incomingNumberIds'])if(!Array.isArray(a[k])||a[k].length>20||a[k].some((x:unknown)=>!uuid(x))||new Set(a[k]).size!==a[k].length)invalid()
 if(!Array.isArray(raw.mappings)||!raw.mappings.length||raw.mappings.length>20||new Set(raw.mappings.map((m:any)=>m?.variable)).size!==raw.mappings.length)invalid()
 for(const m of raw.mappings){if(!object(m)||!exact(m,['variable','jsonPointer'])||typeof m.variable!=='string'||!/^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(m.variable)||typeof m.jsonPointer!=='string'||m.jsonPointer.length>500||m.jsonPointer!==''&&!m.jsonPointer.startsWith('/')||/~(?![01])/.test(m.jsonPointer)||m.jsonPointer.split('/').some((p:string)=>['__proto__','constructor','prototype'].includes(p.replace(/~1/g,'/').replace(/~0/g,'~')))||before&&!before.variables.some(v=>v.name===m.variable))invalid()}
 if(!Array.isArray(raw.conditions)||raw.conditions.length>8||raw.conditions.some((c:any)=>!object(c)||!exact(c,['field','operator'],['value'])||c.field==='system.phone'||c.field==='system.startedAt'||typeof c.field!=='string'||!['is_set','is_empty','equals','contains','starts_with','gt','gte','lt','lte','time_between'].includes(c.operator)))invalid()
 if(before&&raw.conditions.length)parseBeforeConfiguration({...before,greetingRules:[{conditions:raw.conditions,greeting:''}]})
 const s=raw.schedule;if(s!==null&&(!object(s)||!exact(s,['weekdays','start','end','overnight'])||!Array.isArray(s.weekdays)||!s.weekdays.length||s.weekdays.length>7||s.weekdays.some((d:unknown)=>!Number.isInteger(d)||Number(d)<0||Number(d)>6)||new Set(s.weekdays).size!==s.weekdays.length||!time(s.start)||!time(s.end)||s.start===s.end||s.overnight!==(s.start>s.end)))invalid()
 return structuredClone(raw) as HttpConfiguration
}
export function parseHttpSecrets(raw:unknown,c:HttpConfiguration,before:BeforeConfiguration):HttpSecrets {
 safe(raw);if(!object(raw))invalid();if(raw.mode==='keep'){if(!exact(raw,['mode']))invalid();return {mode:'keep'}}
 if(raw.mode!=='replace'||!exact(raw,['mode','url','headers'],['bodyTemplate'])||typeof raw.url!=='string'||raw.url.length>8000||!object(raw.headers)||Object.keys(raw.headers).length>30)invalid()
 try{const u=new URL(raw.url);if(u.protocol!=='https:'||u.username||u.password||u.hash||u.port)invalid()}catch{invalid()}
 const names=new Set<string>();for(const [k,v]of Object.entries(raw.headers)){if(!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(k)||/^(host|connection|content-length|transfer-encoding|accept-encoding|user-agent|proxy-.*|x-kloel-.*|idempotency-key|cookie|set-cookie|te|trailer|upgrade)$/i.test(k)||typeof v!=='string'||v.length>8000||/[\r\n\0]/.test(v)||names.has(k.toLowerCase()))invalid();names.add(k.toLowerCase())}
 function refs(v:unknown){if(Array.isArray(v)){v.forEach(refs);return}if(object(v)){if(Object.hasOwn(v,'$before')){const r=v.$before;if(Object.keys(v).length!==1||typeof r!=='string'||!([...before.variables.map(x=>`vars.${x.name}`),...['agentName','companyName','surface','direction','localTime','weekday','startedAt'].map(x=>`system.${x}`)]).includes(r))invalid()}else Object.values(v).forEach(refs)}}
 if(Object.hasOwn(raw,'bodyTemplate')){if(c.method==='GET'||bytes(raw.bodyTemplate)>16384)invalid();refs(raw.bodyTemplate)}
 return structuredClone(raw) as HttpSecrets
}
export function validHttpAttempt(v:unknown):v is HttpAttempt{return object(v)&&exact(v,['key','agentId','expectedRevision','expectedBeforeRevision'])&&uuid(v.key)&&uuid(v.agentId)&&rev(v.expectedRevision)&&v.expectedRevision<Number.MAX_SAFE_INTEGER&&rev(v.expectedBeforeRevision)}
export function parseHttpOperation(raw:unknown,a:HttpAttempt,tenant:string):HttpOperation{
 if(!validHttpAttempt(a)||!object(raw)||!exact(raw,['key','kind','tenantId','agentId','sourceId','expectedRevision','revision','beforeRevision','status','automaticRetry','createdAt'])||raw.key!==a.key||raw.kind!=='before_http.configure'||raw.tenantId!==tenant||raw.agentId!==a.agentId||!uuid(raw.sourceId)||raw.expectedRevision!==a.expectedRevision||!rev(raw.revision)||raw.revision!==a.expectedRevision+1||raw.beforeRevision!==a.expectedBeforeRevision||raw.status!=='succeeded'||raw.automaticRetry!==false||!date(raw.createdAt))invalid();return structuredClone(raw) as HttpOperation
}
export function parseHttpAvailability(raw:unknown):HttpAvailability {if(!object(raw)||!exact(raw,['revision','state'])||!rev(raw.revision)||raw.revision<1||!['enabled','needs_reauthorization'].includes(raw.state))invalid();return structuredClone(raw) as HttpAvailability}
export function parseHttpMetadata(raw:unknown,expectedRevision?:number,previous?:HttpMetadata):HttpMetadata {
 if(!object(raw)||!exact(raw,['operationId','sourceRevision','state','resolution','reasonCode','httpStatus','startedAt','deadlineAt','completedAt','automaticRetry'])||!uuid(raw.operationId)||!rev(raw.sourceRevision)||raw.sourceRevision<1||expectedRevision!==undefined&&raw.sourceRevision!==expectedRevision||!['not_dispatched','reserved','dispatched','response_observed','unknown'].includes(raw.state)||!['pending','external','defaults','blocked','unknown'].includes(raw.resolution)||raw.reasonCode!==null&&!httpReasons.includes(raw.reasonCode)||raw.httpStatus!==null&&(!Number.isInteger(raw.httpStatus)||raw.httpStatus<100||raw.httpStatus>599)||!date(raw.startedAt)||!date(raw.deadlineAt)||Date.parse(raw.deadlineAt)<Date.parse(raw.startedAt)||raw.completedAt!==null&&(!date(raw.completedAt)||Date.parse(raw.completedAt)<Date.parse(raw.startedAt))||raw.automaticRetry!==false)invalid()
 if(previous&&['operationId','sourceRevision','startedAt','deadlineAt'].some(k=>raw[k]!==previous[k as keyof HttpMetadata]))invalid()
 return structuredClone(raw) as HttpMetadata
}
export const httpResolutionLabel=(m:HttpMetadata)=>({pending:'Fonte pendente',external:'Valores da fonte utilizados',defaults:'Padrões utilizados',blocked:'Preparação bloqueada',unknown:'Resultado da fonte desconhecido'}[m.resolution])
export function createBeforeHttpService(context:EngineContext,agentId:string){
 if(!uuid(agentId))invalid();const base=`/agents/${agentId}/before-context/http-source`
 async function request(path:string,options?:Parameters<EngineContext['request']>[1]):Promise<any>{context.assertCurrent();const raw=await context.request(path,options);context.assertCurrent();options?.signal?.throwIfAborted();return raw}
 function attempt(a:HttpAttempt){if(!validHttpAttempt(a)||a.agentId!==agentId)invalid()}
 return {
  async read(signal?:AbortSignal):Promise<HttpSource>{const r=await request(base,{signal});if(!object(r)||!exact(r,['agentId','sourceId','revision','beforeRevision','state','configuration','targetOrigin','configuredHeaderNames','hasBodyTemplate'])||r.agentId!==agentId||!rev(r.revision)||!['absent','disabled','enabled','needs_reauthorization'].includes(r.state)||!Array.isArray(r.configuredHeaderNames)||r.configuredHeaderNames.length>30||r.configuredHeaderNames.some((n:unknown)=>typeof n!=='string'||!/^[-!#$%&'*+.^_`|~0-9A-Za-z]+$/.test(n))||new Set(r.configuredHeaderNames).size!==r.configuredHeaderNames.length||typeof r.hasBodyTemplate!=='boolean')invalid();if(r.state==='absent'){if(r.sourceId!==null||r.revision!==0||r.beforeRevision!==null||r.configuration!==null||r.targetOrigin!==null||r.configuredHeaderNames.length||r.hasBodyTemplate)invalid()}else{if(!uuid(r.sourceId)||r.revision<1||!rev(r.beforeRevision)||typeof r.targetOrigin!=='string')invalid();try{const u=new URL(r.targetOrigin);if(u.protocol!=='https:'||u.origin!==r.targetOrigin||u.username||u.password)invalid()}catch{invalid()}r.configuration=parseHttpConfiguration(r.configuration);if(r.state==='enabled'&&!r.configuration.enabled||r.state==='disabled'&&r.configuration.enabled)invalid()}return structuredClone(r) as HttpSource},
  async configure(a:HttpAttempt,c:HttpConfiguration,secrets:HttpSecrets,before:BeforeConfiguration){attempt(a);const configuration=parseHttpConfiguration(c,before),safeSecrets=parseHttpSecrets(secrets,configuration,before);const r=await request(base,{method:'PUT',body:{expectedTenantId:context.tenantId,expectedRevision:a.expectedRevision,expectedBeforeRevision:a.expectedBeforeRevision,idempotencyKey:a.key,configuration,secrets:safeSecrets}});if(!object(r)||!exact(r,['operation','replayed'])||typeof r.replayed!=='boolean')invalid();return parseHttpOperation(r.operation,a,context.tenantId)},
  async operation(a:HttpAttempt){attempt(a);return parseHttpOperation(await request(`/before-context/http-config-operations/${a.key}`),a,context.tenantId)},
 }
}
