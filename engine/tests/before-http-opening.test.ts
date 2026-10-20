import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { beforeHttpFixture,beforeHttpVoiceFixture } from './fixtures/before-http.js';
import { sourceSecrets } from '../src/before-context/http-source.js';

test('live private HTTP has one durable dispatch and typed external context; replay and historical GET perform no I/O',async t=>{
 const f=await beforeHttpFixture(t);await f.enable();await f.enableHttp();const key=randomUUID(),result=await f.openHttp('live',key);assert.equal(result.statusCode,200,result.body);const op=result.json().operation;
 assert.equal(op.status,'ready');assert.equal(op.httpSource.state,'response_observed');assert.equal(op.httpSource.resolution,'external');assert.equal(op.source,'external');assert.equal(f.httpRequests.length,1);assert.equal(f.httpRequests[0].spec.headers['idempotency-key'],op.httpSource.operationId);assert.equal((await f.openingHistory(key)).json().items[0].content,'Olá Externo sintético: 0 / false.');
 assert.equal((await f.openHttp('live',key)).json().replayed,true);const source=f.store.list(f.actor.tenantId,'before-http-sources')[0];f.store.remove(f.actor.tenantId,'before-http-sources',source.id);assert.equal((await f.opening(key)).json().httpSource.resolution,'external');assert.equal((await f.openHttp('live',key)).json().replayed,true);assert.equal(f.httpRequests.length,1);assert.equal((await f.askPrivate(op.conversationId)).statusCode,409);
});
test('test resolution skips HTTP DNS and decrypt even with unusable secret; model chat remains available',async t=>{
 const f=await beforeHttpFixture(t);await f.enable();await f.enableHttp();const r=f.store.list(f.actor.tenantId,'before-http-sources')[0];f.store.update(f.actor.tenantId,'before-http-sources',r.id,{encryptedSecrets:'invalid'});
 const opening=await f.openHttp('test');assert.equal(opening.statusCode,200,opening.body);assert.equal(opening.json().operation.httpSource.reasonCode,'test_no_io');assert.equal(f.dns.length,0);assert.equal(f.httpRequests.length,0);assert.equal((await f.askPrivate(opening.json().operation.conversationId)).statusCode,200);assert.equal(f.openAI.length,1);
});
test('webchat delegates source to selected channel and original opening recovery is read-only',async t=>{
 const f=await beforeHttpFixture(t);await f.enable();await f.enableHttp();const session=await f.session();assert.equal(session.greeting,'');assert.equal(session.beforeContext.httpSource.revision,2);const key=randomUUID(),r=await f.publicOpenHttp(session.token,key);assert.equal(r.statusCode,200,r.body);assert.equal(r.json().operation.httpSource.resolution,'external');const current=await f.publicRequest(session.token,'opening');assert.equal(current.json().httpSource.operationId,r.json().operation.httpSource.operationId);assert.equal(f.httpRequests.length,1);
});
import { untilBefore } from './fixtures/before-voice.js';
import { beforeHttpRuntime } from '../src/before-context/http-resolution.js';

for(const [label,value] of [['missing',{nome:'partial',quantidade:0}],['wrong boolean',{nome:'partial',quantidade:0,ativo:'false'}],['null',{nome:null,quantidade:0,ativo:false}],['object',{nome:{text:'x'},quantidade:0,ativo:false}],['overflow greeting',{nome:'x'.repeat(1000),quantidade:0,ativo:false}]])test(`invalid projection ${label} uses integral defaults without retry`,async t=>{
 const f=await beforeHttpFixture(t);await f.enable();await f.enableHttp();f.httpHooks.request=spec=>{spec.onResponse?.(200);return {status:200,headers:{},body:Buffer.from(JSON.stringify(value))};};const key=randomUUID(),r=await f.openHttp('live',key);assert.equal(r.statusCode,200,r.body);assert.equal(r.json().operation.httpSource.reasonCode,'http_response_invalid');assert.equal(r.json().operation.httpSource.httpStatus,200);assert.equal((await f.openingHistory(key)).json().items[0].content,'Olá Visitante: 0 / false.');await f.openHttp('live',key);assert.equal(f.httpRequests.length,1);
});
for(const mode of ['condition','audience','schedule','GET'] as const)test(`HTTP ${mode} selection respects defaults and no implicit delegation`,async t=>{
 const f=await beforeHttpFixture(t);await f.enable();const source=structuredClone(f.source);source.enabled=true;
 if(mode==='condition')source.conditions=[{field:'vars.ativo',operator:'equals',value:true}];if(mode==='audience')source.audiences.private=false;
 if(mode==='schedule')source.schedule={weekdays:[],start:'22:00',end:'06:00',overnight:true};
 if(mode==='GET'){source.method='GET';const r=await f.configure({...source,enabled:false},0,randomUUID(),{...f.secrets,bodyTemplate:undefined});assert.equal(r.statusCode,200,r.body);assert.equal((await f.configure(source,1,randomUUID(),{mode:'keep'})).statusCode,200);}else if(mode==='schedule'){source.schedule!.weekdays=[(new Date().getUTCDay()+3)%7];await f.enableHttp(source);}else await f.enableHttp(source);
 const r=await f.openHttp();assert.equal(r.statusCode,200,r.body);if(mode==='GET'){assert.equal(f.httpRequests[0].spec.method,'GET');assert.equal(f.httpRequests[0].spec.body,undefined);}else{assert.equal(f.dns.length,0);assert.equal(r.json().operation.httpSource.reasonCode,mode==='condition'?'condition_not_matched':mode==='audience'?'audience_not_selected':'outside_hours');}
});
test('redirect and non-success responses never repeat a physical request',async t=>{
 const f=await beforeHttpFixture(t);await f.enable();await f.enableHttp();for(const status of [302,503]){f.httpHooks.request=spec=>{spec.onResponse?.(status);return {status,headers:{location:'https://context.example.com/second'},body:Buffer.from('{}')};};const r=await f.openHttp();assert.equal(r.statusCode,200,r.body);assert.equal(r.json().operation.httpSource.resolution,'defaults');assert.equal(r.json().operation.httpSource.httpStatus,status);}assert.equal(f.httpRequests.length,2);assert.equal(f.dns.length,2);
});
test('source edit during response preserves observed status but blocks both external values and fallback',async t=>{
 const f=await beforeHttpFixture(t);await f.enable();await f.enableHttp();f.httpHooks.request=async spec=>{spec.onResponse?.(200);assert.equal((await f.configure(f.source,2,randomUUID(),{mode:'keep'})).statusCode,200);return {status:200,headers:{},body:Buffer.from('{"nome":"MUST_NOT_PUBLISH","quantidade":0,"ativo":false}')};};const key=randomUUID(),r=await f.openHttp('live',key);assert.equal(r.statusCode,409,r.body);const get=await f.opening(key);assert.equal(get.json().status,'blocked');assert.equal(get.json().httpSource.httpStatus,200);assert.equal((await f.openingHistory(key)).json().items.length,0);assert.ok(!get.body.includes('MUST_NOT_PUBLISH'));assert.equal(f.httpRequests.length,1);
});
test('organization suspension ABA during DNS refuses dispatch and does not turn revocation into fallback',async t=>{
 const f=await beforeHttpFixture(t);await f.enable();await f.enableHttp();f.httpHooks.resolve=async()=>{f.store.db.prepare("UPDATE organizations SET status='suspended' WHERE id=?").run(f.actor.tenantId);f.store.db.prepare("UPDATE organizations SET status='active' WHERE id=?").run(f.actor.tenantId);return [{address:'93.184.216.34',family:4}];};const r=await f.openHttp();assert.equal(r.statusCode,409,r.body);assert.equal(f.httpRequests.length,0);assert.equal(f.store.list(f.actor.tenantId,'messages').filter(m=>m.source==='before_context').length,0);assert.equal(f.store.list(f.actor.tenantId,'before-http-operations')[0].resolution,'blocked');
});
test('deadline aborts pending DNS; late resolution cannot dispatch or replace committed defaults',async t=>{
 const f=await beforeHttpFixture(t);await f.enable();await f.enableHttp();let release!:(v:Array<{address:string;family:4}>)=>void;f.httpHooks.resolve=()=>new Promise(r=>{release=r;});const key=randomUUID(),started=Date.now(),pending=f.openHttp('live',key);await untilBefore(()=>f.dns.length===1);const r=await pending;assert.equal(r.statusCode,200,r.body);assert.equal(r.json().operation.httpSource.reasonCode,'http_timeout');assert.ok(Date.now()-started>=4900);const old=(await f.openingHistory(key)).body;release([{address:'93.184.216.34',family:4}]);await new Promise(r=>setImmediate(r));assert.equal(f.httpRequests.length,0);assert.equal((await f.openingHistory(key)).body,old);
});
test('POST deadline cancels socket signal and retains observed 2xx while late body is discarded',async t=>{
 const f=await beforeHttpFixture(t);await f.enable();await f.enableHttp();let release!:(v:any)=>void,signal:AbortSignal|undefined;f.httpHooks.request=spec=>{signal=spec.signal;spec.onResponse?.(200);return new Promise(r=>{release=r;});};const key=randomUUID(),r=await f.openHttp('live',key);assert.equal(r.statusCode,200,r.body);assert.equal(r.json().operation.httpSource.httpStatus,200);assert.equal(r.json().operation.httpSource.reasonCode,'http_timeout');assert.equal(signal?.aborted,true);release({status:200,headers:{},body:Buffer.from('{"nome":"TOO_LATE","quantidade":4,"ativo":true}')});await new Promise(r=>setImmediate(r));assert.ok(!(await f.openingHistory(key)).body.includes('TOO_LATE'));await f.openHttp('live',key);assert.equal(f.httpRequests.length,1);
});
for(const boundary of ['reservation','dispatch','ready'] as const)test(`failure after ${boundary} COMMIT preserves original operation without automatic replay`,async t=>{
 const f=await beforeHttpFixture(t);await f.enable();await f.enableHttp();const original=f.store.transaction.bind(f.store);let fired=false;f.store.transaction=((fn:any)=>{const result=original(fn);const op=f.store.list(f.actor.tenantId,'before-http-operations')[0];if(!fired&&op&&(boundary==='reservation'?op.state==='not_dispatched':boundary==='dispatch'?op.state==='dispatched':op.resolution==='external')){fired=true;throw Error('synthetic after COMMIT');}return result;}) as typeof f.store.transaction;
 const key=randomUUID(),r=await f.openHttp('live',key);assert.ok(fired);f.store.transaction=original;assert.equal(r.statusCode,boundary==='dispatch'?200:500);const get=await f.opening(key);assert.equal(get.statusCode,200,get.body);assert.equal(get.json().status,boundary==='reservation'?'unknown':'ready');assert.equal(f.httpRequests.length,boundary==='ready'?1:0);const before=f.store.list(f.actor.tenantId,'before-http-operations');await f.openHttp('live',key);assert.deepEqual(f.store.list(f.actor.tenantId,'before-http-operations'),before);assert.equal(f.httpRequests.length,boundary==='ready'?1:0);
});
test('shutdown aborts and drains source before store close; no default greeting is published',async t=>{
 const f=await beforeHttpFixture(t);await f.enable();await f.enableHttp();let signal:AbortSignal|undefined;f.httpHooks.request=spec=>{signal=spec.signal;return new Promise(()=>{});};const pending=f.openHttp();await untilBefore(()=>f.httpRequests.length===1);await beforeHttpRuntime(f.store).close();const r=await pending;assert.equal(r.statusCode,500);assert.equal(signal?.aborted,true);assert.equal(f.store.list(f.actor.tenantId,'before-http-operations')[0].resolution,'blocked');assert.equal(f.store.list(f.actor.tenantId,'messages').filter(m=>m.source==='before_context').length,0);
});

import {JSDOM,VirtualConsole} from 'jsdom';
import {PUBLIC_CHAT_WIDGET} from '../src/public-chat-widget.js';
async function until(check:()=>boolean){for(let i=0;i<300;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,5));}throw Error('DOM did not settle');}
type F=Awaited<ReturnType<typeof beforeHttpFixture>>;
type Request={url:URL;method:string;body:any;headers:Headers};
function harness(f:F,options:{saved?:Record<string,string>;before?:(r:Request)=>void|Promise<void>;after?:(r:Request,response:Response)=>Response|Promise<Response>}={}){
  const errors:any[]=[],console=new VirtualConsole();console.on('jsdomError',e=>errors.push(e));
  const dom=new JSDOM('<!doctype html><body></body>',{url:f.origin,runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:console}),w=dom.window;
  const script=w.document.createElement('script');script.src='http://127.0.0.1:4310/widget/kloel.js';script.dataset.kloelTenant=f.actor.tenantId;script.dataset.kloelChannel=f.channel.id;
  Object.defineProperty(w.document,'currentScript',{get:()=>script});Object.defineProperty(w.crypto,'randomUUID',{value:randomUUID});(w as any).AbortSignal=AbortSignal;
  let root!:ShadowRoot;const attach=w.HTMLElement.prototype.attachShadow;w.HTMLElement.prototype.attachShadow=function(opts){const result=attach.call(this,opts);root=result as any;return result;};
  w.setTimeout=(()=>1) as any;w.clearTimeout=()=>{};
  for(const[k,v]of Object.entries(options.saved??{}))w.sessionStorage.setItem(k,v);
  const requests:Request[]=[];
  (w as any).fetch=async(input:string,init:RequestInit)=>{
    const url=new URL(input);assert.equal(url.origin,'http://127.0.0.1:4310');assert.equal(init.credentials,'omit');const headers=new Headers(init.headers),request={url,method:String(init.method),headers,body:init.body?JSON.parse(String(init.body)):undefined};assert.equal(headers.has('cookie'),false);requests.push(request);await options.before?.(request);
    const result=await f.app.inject({method:request.method as any,url:url.pathname+url.search,headers:{origin:f.origin,...Object.fromEntries(headers)},...(request.body?{payload:request.body}:{})});const response=new Response(result.body,{status:result.statusCode,headers:{'content-type':'application/json'}});return options.after?options.after(request,response):response;
  };
  w.eval(PUBLIC_CHAT_WIDGET);
  const button=(text:string,scope:ParentNode=root)=>[...scope.querySelectorAll('button')].find(b=>b.textContent===text) as HTMLButtonElement;
  const chatInput=()=>root.querySelector('input[aria-label="Sua mensagem"]') as HTMLInputElement;
  const saved=()=>Object.fromEntries(Array.from({length:w.sessionStorage.length},(_,i)=>w.sessionStorage.key(i)!).map(k=>[k,w.sessionStorage.getItem(k)!]));
  const refs=()=>{const row=Object.entries(saved()).find(([k])=>k.endsWith(':booking-references:v1'));return row?JSON.parse(row[1]):[];};
  const text=()=>root.textContent??'';
  const open=async()=>{button('Conversar com a Kloel').click();await until(()=>requests.some(r=>r.url.pathname.endsWith('/history'))&&!chatInput().disabled);};
  const ask=async()=>{chatInput().value='Quero agendar.';chatInput().closest('form')!.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>!!root.querySelector('.booking-card')&&!chatInput().disabled);};
  const confirm=()=>{button('Revisar agendamento').click();button('Confirmar agendamento').click();};
  return{dom,w,root,errors,requests,button,chatInput,saved,refs,text,open,ask,confirm};
}


test('widget binds HTTP revision before one POST and reload only reads original external greeting',async t=>{
 const f=await beforeHttpFixture(t);await f.enable();await f.enableHttp();let h!:ReturnType<typeof harness>;
 h=harness(f,{before:r=>{if(r.method==='POST'&&r.url.pathname.endsWith('/opening')){const saved=Object.values(h.saved()).map(v=>JSON.parse(v)).find(v=>v.openingKey);assert.equal(saved.openingHttpRevision,2);assert.equal(saved.openingHttpRevision,r.body.expectedHttpRevision);}},after:(r,response)=>{if(r.method==='POST'&&r.url.pathname.endsWith('/opening'))throw Error('synthetic lost HTTP opening');return response;}});t.after(()=>h.dom.window.close());h.button('Conversar com a Kloel').click();await until(()=>h.text().includes('synthetic lost HTTP opening'));
 const saved=h.saved();assert.ok(!JSON.stringify(saved).includes('Externo sintético'));assert.ok(!JSON.stringify(saved).includes('context.example.com'));const h2=harness(f,{saved});t.after(()=>h2.dom.window.close());await h2.open();assert.equal(h2.requests.filter(r=>r.method==='POST').length,0);assert.match(h2.text(),/Olá Externo sintético: 0 \/ false/);assert.equal(f.httpRequests.length,1);assert.deepEqual(h2.errors,[]);
});
test('disabled source preserves legacy widget opening and publishes defaults without HTTP metadata',async t=>{
 const f=await beforeHttpFixture(t);await f.enable();assert.equal((await f.configure()).statusCode,200);const h=harness(f);t.after(()=>h.dom.window.close());await h.open();const request=h.requests.find(r=>r.url.pathname.endsWith('/opening'))!;assert.equal(request.body.expectedHttpRevision,undefined);assert.match(h.text(),/Olá Visitante: 0 \/ false/);assert.equal(f.dns.length,0);
});
test('public end during HTTP body cancels the opening, retains receipt, and does not emit fallback',async t=>{
 const f=await beforeHttpFixture(t);await f.enable();await f.enableHttp();let signal:AbortSignal|undefined;f.httpHooks.request=spec=>{signal=spec.signal;return new Promise(()=>{});};const session=await f.session(),pending=f.publicOpenHttp(session.token);await untilBefore(()=>f.httpRequests.length===1);const ended=await f.publicRequest(session.token,'end',{});assert.equal(ended.statusCode,200,ended.body);await pending;assert.equal(signal?.aborted,true);const get=await f.publicRequest(session.token,'opening');assert.equal(get.statusCode,200,get.body);assert.equal(get.json().status,'blocked');assert.equal(f.store.list(f.actor.tenantId,'messages').filter(m=>m.source==='before_context').length,0);
});
import { hash } from '../src/before-context/operations.js';
test('legacy before opening without HTTP source remains usable with its original snapshot format',async t=>{
 const f=await beforeHttpFixture(t);await f.enable();const opened=await f.open();assert.equal(opened.statusCode,200,opened.body);const row=f.store.list(f.actor.tenantId,'before-context-openings')[0],agent=f.store.get(f.actor.tenantId,'agents',f.agent.id),config=f.store.list(f.actor.tenantId,'before-context-configurations')[0];f.store.update(f.actor.tenantId,'before-context-openings',row.id,{snapshot:hash([agent,config,null])});const reply=await f.askPrivate(String(row.conversationId));assert.equal(reply.statusCode,200,reply.body);assert.equal(f.openAI.length,1);assert.equal(f.dns.length,0);
});
