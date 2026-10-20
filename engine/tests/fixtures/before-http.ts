import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { TestContext } from 'node:test';
import { beforeContextFixture } from './before-context.js';
import { beforeVoiceFixture } from './before-voice.js';
import { setBeforeHttpTransport } from '../../src/before-context/http-resolution.js';
import type { RequestSpec } from '../../src/integrations/transport.js';
import type { SafeResponse } from '../../src/ingestion/safe-url.js';
import type { HttpSourceConfiguration } from '../../src/before-context/http-source.js';

type Base = Awaited<ReturnType<typeof beforeContextFixture>> | Awaited<ReturnType<typeof beforeVoiceFixture>>;
function sourceHarness<F extends Base>(f:F){
 const requests:Array<{url:string;spec:RequestSpec}>=[],dns:string[]=[];
 const hooks:{resolve?:(host:string)=>Promise<Array<{address:string;family:4|6}>>;request?:(spec:RequestSpec)=>Promise<SafeResponse>|SafeResponse}={};
 setBeforeHttpTransport(f.store,{resolve:async host=>{dns.push(host);return hooks.resolve?hooks.resolve(host):[{address:'93.184.216.34',family:4}];},request:async(url,address,spec)=>{requests.push({url:url.href,spec});if(hooks.request)return hooks.request(spec);spec.onResponse?.(200);return {status:200,headers:{'content-type':'application/json'},body:Buffer.from(JSON.stringify({nome:'Externo sintético',quantidade:0,ativo:false}))};}});
 const httpBase=`/api/v1/agents/${f.agent.id}/before-context/http-source`;
 const source:HttpSourceConfiguration={enabled:false,method:'POST',audiences:{private:true,voicePrivate:true,webchatChannelIds:'publicRequest'in f?[f.channel.id]:[],incomingNumberIds:'number'in f?[f.number.id]:[],incomingDefaultRoute:false},mappings:f.sample.variables.map(v=>({variable:v.name,jsonPointer:'/'+v.name})),conditions:[],schedule:null};
 const secrets={mode:'replace' as const,url:'https://context.example.com/context',headers:{authorization:'Bearer synthetic-before-http-secret'},bodyTemplate:{name:{$before:'vars.nome'},surface:{$before:'system.surface'}}};
 const configure=(configuration=source,revision=0,key=randomUUID(),inputSecrets:typeof secrets|{mode:'keep'}=secrets,beforeRevision=1)=>f.request('PUT',httpBase,{expectedTenantId:f.actor.tenantId,expectedRevision:revision,expectedBeforeRevision:beforeRevision,idempotencyKey:key,configuration,secrets:inputSecrets});
 const enableHttp=async(configuration={...source,enabled:true})=>{let r=await configure();assert.equal(r.statusCode,200,r.body);r=await configure(configuration,1,randomUUID(),{mode:'keep'});assert.equal(r.statusCode,200,r.body);return r.json().operation;};
 return {httpBase,source,secrets,configure,enableHttp,httpRequests:requests,dns,httpHooks:hooks};
}
export async function beforeHttpFixture(t:TestContext){const f=await beforeContextFixture(t);return {...f,...sourceHarness(f),openHttp:(mode:'live'|'test'='live',key=randomUUID(),httpRevision=2)=>f.request('POST','/api/v1/ai/conversations/open',{expectedTenantId:f.actor.tenantId,agentId:f.agent.id,expectedConfigRevision:1,expectedHttpRevision:httpRevision,idempotencyKey:key,mode}),publicOpenHttp:(token:string,key=randomUUID(),httpRevision=2)=>f.publicRequest(token,'opening',{expectedConfigRevision:1,expectedHttpRevision:httpRevision,idempotencyKey:key})};}
export async function beforeHttpVoiceFixture(t:TestContext){const f=await beforeVoiceFixture(t);return {...f,...sourceHarness(f),startHttp:(mode:'live'|'test'='live',key=randomUUID(),httpRevision=2)=>f.start({...f.startBody(key,mode),beforeContext:{...f.startBody(key,mode).beforeContext,expectedHttpRevision:httpRevision}})};}
