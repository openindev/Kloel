import test from 'node:test'
import assert from 'node:assert/strict'
import {beforeHttpUIFixture} from './engine-before-http-fixture'
import {createBeforeHttpJournal} from '../src/services/engine/before-http-journal'
import {parseHttpMetadata,parseHttpConfiguration,parseHttpSecrets,parseHttpOperation} from '../src/services/engine/before-http'
import {parseBeforeOpening,beforeOpeningAvailable,validBeforeOpeningAttempt} from '../src/services/engine/before-context'
import {createBeforeOpeningJournal} from '../src/services/engine/before-context-journal'
import {parseBeforeVoiceMetadata,parseBeforeVoiceIntent} from '../src/services/engine/before-voice'
import {createBeforeVoiceJournal} from '../src/services/engine/before-voice-journal'
const storage=()=>{const map=new Map<string,string>();return{map,getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{map.set(k,v)},removeItem:(k:string)=>{map.delete(k)}}}
const attempt=(f:any,revision=0)=>({key:crypto.randomUUID(),agentId:f.agent.id,expectedRevision:revision,expectedBeforeRevision:1})
const opening=(f:any,mode:'live'|'test'='live')=>({key:crypto.randomUUID(),agentId:f.agent.id,expectedConfigRevision:1,expectedHttpRevision:2,mode})
test('real HTTP configuration is disabled first, explicit second revision keeps write-only secrets and no source I/O',async t=>{
 const f=await beforeHttpUIFixture(t);await f.enable();assert.equal((await f.client.read()).state,'absent')
 const a=attempt(f),op=await f.client.configure(a,f.source,f.secrets,f.sample);assert.equal(op.revision,1);const row=await f.client.read();assert.equal(row.state,'disabled');assert.equal(row.targetOrigin,'https://context.example.com');assert.deepEqual(row.configuredHeaderNames,['authorization']);assert.equal(row.hasBodyTemplate,true);assert.doesNotMatch(JSON.stringify(row),/synthetic-before-http-secret|bodyTemplate|\/context"/)
 const b=attempt(f,1);await f.client.configure(b,{...f.source,enabled:true},{mode:'keep'},f.sample);assert.equal((await f.client.read()).state,'enabled');assert.deepEqual(await f.client.operation(a),op);assert.equal(f.httpRequests.length,0);assert.equal(f.dns.length,0)
})
test('real source live returns false/0; test skips source while normal model remains available',async t=>{
 const f=await beforeHttpUIFixture(t);await f.enable();await f.enableHttp();const live=await f.before.open(opening(f));assert.equal(live.source,'external');assert.equal(live.httpSource?.resolution,'external');assert.equal(live.httpSource?.httpStatus,200);assert.match((await f.before.history({...opening(f),key:live.key},live)).items[0].content,/Externo sintético: 0 \/ false/)
 const count=f.httpRequests.length,dns=f.dns.length,synthetic=await f.before.open(opening(f,'test'));assert.equal(synthetic.source,'test');assert.equal(synthetic.httpSource?.reasonCode,'test_no_io');assert.equal(f.httpRequests.length,count);assert.equal(f.dns.length,dns);assert.match((await f.before.history({...opening(f,'test'),key:synthetic.key},synthetic)).items[0].content,/Exemplo sintético: 7 \/ true/)
})
test('lost configuration response recovers original GET after source revision changes without repeating PUT or source',async t=>{
 const f=await beforeHttpUIFixture(t);await f.enable();const a=attempt(f);f.state.after=async(r,res)=>{if(r.path===f.httpBase&&r.method==='PUT'){f.state.after=undefined;throw Error('lost')}return res};await assert.rejects(f.client.configure(a,f.source,f.secrets,f.sample));await f.configureHttp({...f.source,enabled:true},1,crypto.randomUUID(),{mode:'keep'});const writes=f.httpWrites().length,op=await f.client.operation(a);assert.equal(op.revision,1);assert.equal(f.httpWrites().length,writes);assert.equal(f.httpRequests.length,0)
 await assert.rejects(f.client.operation(attempt(f)),e=>(e as any).status===404);assert.equal(f.httpWrites().length,writes)
})
test('original opening history remains readable after source change but cannot admit current use',async t=>{
 const f=await beforeHttpUIFixture(t);await f.enable();await f.enableHttp();const a=opening(f),op=await f.before.open(a);assert.equal(beforeOpeningAvailable(await f.before.availability(),op),true);await f.configureHttp({...f.source,enabled:false},2,crypto.randomUUID(),{mode:'keep'});const current=await f.before.availability();assert.equal(current.httpSource,undefined);assert.equal(beforeOpeningAvailable(current,op),false);const count=f.httpRequests.length;assert.equal((await f.before.opening(a)).openingId,op.openingId);assert.ok((await f.before.history(a,op)).items.length);assert.equal(f.httpRequests.length,count)
})
test('pending original receipt cannot request history and unknown remains a GET-only reference',async t=>{
 const f=await beforeHttpUIFixture(t);await f.enable();await f.enableHttp();let release!:()=>void,seen!:()=>void;const gated=new Promise<void>(r=>release=r),started=new Promise<void>(r=>seen=r);f.httpHooks.request=async spec=>{seen();await gated;spec.onResponse?.(200);return{status:200,headers:{'content-type':'application/json'},body:Buffer.from('{"nome":"OK","quantidade":0,"ativo":false}')}};const a=opening(f),promise=f.before.open(a);await started;const pending=await f.before.opening(a);assert.equal(pending.status,'pending');const calls=f.calls.length;await assert.rejects(f.before.history(a,pending));assert.equal(f.calls.length,calls);release();await promise
 const h={...pending.httpSource!,state:'unknown',resolution:'unknown',reasonCode:'before_http_interrupted'};const unknown=parseBeforeOpening({...pending,status:'unknown',httpSource:h,reasonCode:h.reasonCode},a,f.actor.tenantId);assert.equal(unknown.status,'unknown');assert.equal(beforeOpeningAvailable(await f.before.availability(),unknown),false)
})
test('HTTP metadata and write parsers reject identity/revision/secret extras and unsafe template references',async t=>{
 const f=await beforeHttpUIFixture(t);await f.enable();await f.enableHttp();const a=opening(f),op=await f.before.open(a),h=op.httpSource!
 for(const bad of [{...h,token:'x'},{...h,sourceRevision:3},{...h,httpStatus:700},{...h,automaticRetry:true}])assert.throws(()=>parseHttpMetadata(bad,2))
 assert.throws(()=>parseBeforeOpening({...op,httpSource:{...h,sourceRevision:3}},a,f.actor.tenantId));assert.throws(()=>parseBeforeOpening({...op,httpSource:undefined},a,f.actor.tenantId));assert.throws(()=>parseBeforeOpening({...op,status:'ready',httpSource:{...h,resolution:'pending'}},a,f.actor.tenantId))
 for(const body of [{$before:'system.phone'},{$before:'vars.missing'},{$before:'vars.nome',extra:1},JSON.parse('{"__proto__":1}')])assert.throws(()=>parseHttpSecrets({...f.secrets,bodyTemplate:body},f.source,f.sample))
 assert.throws(()=>parseHttpConfiguration({...f.source,mappings:[{variable:'nome',jsonPointer:'/__proto__/x'}]},f.sample));assert.throws(()=>parseHttpConfiguration({...f.source,conditions:[{field:'system.phone',operator:'equals',value:'+12345678'}]},f.sample));assert.throws(()=>parseHttpSecrets({...f.secrets,headers:{authorization:'a',Authorization:'b'}},f.source,f.sample))
 assert.throws(()=>parseHttpOperation({key:'x'},attempt(f),f.actor.tenantId))
})
test('HTTP config journal is opaque, CAS/readback bounded and never releases B with an old receipt',async t=>{
 const f=await beforeHttpUIFixture(t);await f.enable();const s=storage(),j=createBeforeHttpJournal(s,f.identity.context,f.agent.id),a=attempt(f),fresh=()=>{};j.reserve(a,fresh);const op=await f.client.configure(a,f.source,f.secrets,f.sample);assert.deepEqual(j.read().active,a);assert.doesNotMatch(JSON.stringify([...s.map.values()]),/synthetic-before-http-secret|url|headers|bodyTemplate|nome/);assert.throws(()=>j.reserve(attempt(f),fresh));j.resolve(a,op,fresh);const b=attempt(f,1);j.reserve(b,fresh);assert.throws(()=>j.resolve(a,op,fresh));assert.deepEqual(j.read().active,b)
 const other=createBeforeHttpJournal(s,{...f.identity.context,authorityVersion:'b'.repeat(64)},f.agent.id);assert.equal(other.read().active,null);const blank=storage(),lost=createBeforeHttpJournal({...blank,setItem(){}},f.identity.context,f.agent.id);assert.throws(()=>lost.reserve(a,fresh));assert.equal(blank.map.size,0);j.rejectVersion(b,fresh);for(let i=1;i<20;i++){const n=attempt(f,i);j.reserve(n,fresh);j.rejectVersion(n,fresh)}assert.throws(()=>j.reserve(attempt(f,20),fresh))
})
test('opening journal preserves old references and only opaque optional HTTP revision across explicit archive',async t=>{
 const f=await beforeHttpUIFixture(t),s=storage(),j=createBeforeOpeningJournal(s,f.identity.context,f.agent.id),a=opening(f),fresh=()=>{};j.reserve(a,fresh);assert.deepEqual(j.read().active,a);assert.equal(validBeforeOpeningAttempt({...a,url:'https://secret'}),false);j.archiveUnresolved(a,fresh);const b={...a,key:crypto.randomUUID()};j.reserve(b,fresh);assert.throws(()=>j.archiveUnresolved(a,fresh));assert.deepEqual(j.read().history,[a]);assert.deepEqual(j.read().active,b);assert.doesNotMatch(JSON.stringify([...s.map.values()]),/testFacts|url|headers|bodyTemplate/)
})
test('real voice DTO carries original HTTP revision while test skips source and keeps A2 microphone barrier',async t=>{
 const f=await beforeHttpUIFixture(t,{voice:true});await f.enable();await f.enableHttp();const intent={expectedRevision:1,expectedHttpRevision:2,mode:'test' as const},key=crypto.randomUUID(),op=await f.voiceClient.startVoice('v=0\r\na=offer',key,intent);assert.equal(op.beforeContext?.httpSource?.reasonCode,'test_no_io');assert.equal(op.beforeContext?.mediaStage,'blocked');assert.equal(f.httpRequests.length,0);assert.equal(f.dns.length,0);parseBeforeVoiceMetadata(op.beforeContext,undefined,intent)
 assert.throws(()=>parseBeforeVoiceMetadata(op.beforeContext,undefined,{...intent,expectedHttpRevision:3}));assert.throws(()=>parseBeforeVoiceIntent({...intent,expectedHttpRevision:0}));assert.throws(()=>parseBeforeVoiceMetadata({...op.beforeContext,mediaStage:'conversation'},undefined,intent));const s=storage(),j=createBeforeVoiceJournal(s,f.identity.context,f.agent.id),ref={key,agentId:f.agent.id,expectedRevision:1,expectedHttpRevision:2,mode:'test' as const};j.reserve(ref,()=>{});assert.deepEqual(j.read(),ref);assert.doesNotMatch(JSON.stringify([...s.map.values()]),/testFacts|nome|headers/)
 const count=f.requests.length;await f.voiceClient.voiceOperation(key);assert.equal(f.requests.length,count)
})
test('authority changes after a source response prevent projection without repeating the operation',async t=>{
 const f=await beforeHttpUIFixture(t);await f.enable();await f.enableHttp();f.state.after=async(r,res)=>{if(r.path===f.httpBase)f.state.current=false;return res};await assert.rejects(f.client.read(),e=>(e as any).code==='superseded');assert.equal(f.httpRequests.length,0)
})
test('disabled Before can still describe an enabled source needing reauthorization without authorizing an opening',async t=>{
 const f=await beforeHttpUIFixture(t);await f.enable();await f.enableHttp();await f.save({...f.sample,enabled:false},1);const a=await f.before.availability();assert.equal(a.enabled,false);assert.deepEqual(a.httpSource,{revision:2,state:'needs_reauthorization'});assert.equal(f.httpRequests.length,0)
})
