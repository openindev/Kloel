import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {JSDOM,VirtualConsole} from 'jsdom';
import {PUBLIC_CHAT_WIDGET} from '../src/public-chat-widget.js';
import {assistantBookingFixture} from './fixtures/assistant-booking.js';

async function until(check:()=>boolean){for(let i=0;i<300;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,5));}throw Error('DOM did not settle');}
type F=Awaited<ReturnType<typeof assistantBookingFixture>>;
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

test('widget explicit card creates exactly one managed Google booking with typed time and real management link',async t=>{
  const f=await assistantBookingFixture(t),a=await f.create('webchat');f.toolRound(a);const h=harness(f);t.after(()=>h.dom.window.close());await h.open();await h.ask();
  assert.equal(f.requests.filter(r=>r.method==='POST').length,0);assert.match(h.text(),/Horários em UTC/);h.confirm();await until(()=>h.text().includes('agendamento confirmado.'));
  assert.equal(f.requests.filter(r=>r.method==='POST').length,1);assert.equal(h.requests.filter(r=>r.url.pathname.endsWith('/bookings')).length,1);assert.equal(h.chatInput().disabled,false);
  h.button('Obter link da reserva').click();await until(()=>!!h.root.querySelector('a'));const link=h.root.querySelector('a')!;assert.match(link.href,/#booking=.*&manage=/);assert.equal(link.rel,'noopener noreferrer');assert.ok(!JSON.stringify(h.saved()).includes('manage='));assert.deepEqual(h.errors,[]);
});

test('lost booking envelope survives reload as opaque original reference; recovery is GET only',async t=>{
  const f=await assistantBookingFixture(t),a=await f.create('webchat');f.toolRound(a);const h=harness(f,{after:async(r,response)=>{if(r.url.pathname.endsWith('/bookings'))throw Error('lost reply');return response;}});t.after(()=>h.dom.window.close());await h.open();await h.ask();h.confirm();await until(()=>h.refs().length===1&&h.text().includes('lost reply'));
  const ref=h.refs()[0],stored=h.saved();assert.deepEqual(Object.keys(ref).sort(),['actionId','actionRevision','chatOperationKey','conversationId','eventTypeId','expiresAt','key','token']);assert.ok(!JSON.stringify(stored).includes('quote'));assert.ok(!JSON.stringify(stored).includes('Operator test'));assert.equal(h.chatInput().disabled,false);
  const h2=harness(f,{saved:stored});t.after(()=>h2.dom.window.close());await h2.open();assert.equal(h2.requests.filter(r=>r.method==='POST').length,0);h2.button('Consultar agendamento').click();await until(()=>h2.text().includes('agendamento confirmado.'));
  assert.equal(h2.requests.filter(r=>r.method==='POST').length,0);assert.equal(h2.refs()[0].key,ref.key);assert.equal(f.requests.filter(r=>r.method==='POST').length,1);assert.equal(h2.button('Revisar agendamento').disabled,true);
});

test('GET404 after reload cannot reconstruct quote/body or offer booking POST; ordinary chat remains usable',async t=>{
  const f=await assistantBookingFixture(t),a=await f.create('webchat');f.toolRound(a);const h=harness(f,{before:r=>{if(r.url.pathname.endsWith('/bookings'))throw Error('request not delivered');}});t.after(()=>h.dom.window.close());await h.open();await h.ask();h.confirm();await until(()=>h.refs().length===1&&h.text().includes('request not delivered'));
  const h2=harness(f,{saved:h.saved()});t.after(()=>h2.dom.window.close());await h2.open();h2.button('Consultar agendamento').click();await until(()=>h2.text().includes('Isso não prova ausência'));
  assert.equal(h2.button('Revisar agendamento').disabled,true);assert.equal(h2.chatInput().disabled,false);assert.equal(h2.requests.filter(r=>r.method==='POST').length,0);assert.equal(f.requests.filter(r=>r.method==='POST').length,0);assert.equal(h2.refs().length,1);
});

test('ending then starting another chat keeps old booking recovery bound to its original credential',async t=>{
  const f=await assistantBookingFixture(t),a=await f.create('webchat');f.toolRound(a);const h=harness(f);t.after(()=>h.dom.window.close());await h.open();await h.ask();h.confirm();await until(()=>h.text().includes('agendamento confirmado.'));const old=h.refs()[0];
  h.button('Encerrar').click();await until(()=>h.text().includes('Conversa encerrada'));h.button('Fechar').click();await h.open();const currentSession=Object.entries(h.saved()).find(([k])=>!k.endsWith(':booking-references:v1'))!;assert.notEqual(JSON.parse(currentSession[1]).token,old.token);
  const before=f.requests.length;h.button('Consultar agendamento').click();await until(()=>h.requests.some(r=>r.url.pathname.endsWith('/booking-operation')));assert.equal(h.requests.at(-1)!.headers.get('authorization'),'Bearer '+old.token);assert.equal(f.requests.length,before);assert.equal(h.refs()[0].key,old.key);
});

test('storage refusal occurs before booking POST and does not erase entered form data',async t=>{
  const f=await assistantBookingFixture(t);f.store.update(f.actor.tenantId,'booking-pages',f.page.id,{form:[{field:'name',label:'Nome',required:true}]});const a=await f.create('webchat');f.toolRound(a);const h=harness(f);t.after(()=>h.dom.window.close());await h.open();await h.ask();const name=h.root.querySelector('input[aria-label="Nome"]') as HTMLInputElement;name.value='PRIVATE-NAME';name.dispatchEvent(new h.w.Event('input'));
  const set=h.w.Storage.prototype.setItem;h.w.Storage.prototype.setItem=function(key,value){if(key.endsWith(':booking-references:v1'))throw Error('storage unavailable');set.call(this,key,value);};h.confirm();await until(()=>h.text().includes('storage unavailable'));
  assert.equal(name.value,'PRIVATE-NAME');assert.equal(h.requests.filter(r=>r.url.pathname.endsWith('/bookings')).length,0);assert.equal(f.requests.filter(r=>r.method==='POST').length,0);assert.ok(!JSON.stringify(h.saved()).includes('PRIVATE-NAME'));
});

test('editing form after review invalidates confirmation; ended old card cannot post into a new session',async t=>{
  const f=await assistantBookingFixture(t);f.store.update(f.actor.tenantId,'booking-pages',f.page.id,{form:[{field:'name',label:'Nome',required:true}]});const a=await f.create('webchat');f.toolRound(a);const h=harness(f);t.after(()=>h.dom.window.close());await h.open();await h.ask();const name=h.root.querySelector('input[aria-label="Nome"]') as HTMLInputElement;name.value='A';h.button('Revisar agendamento').click();const confirm=h.button('Confirmar agendamento');name.value='B';name.dispatchEvent(new h.w.Event('input'));confirm.click();assert.equal(h.refs().length,0);
  h.button('Revisar agendamento').click();h.button('Encerrar').click();await until(()=>h.text().includes('Conversa encerrada'));h.button('Fechar').click();await h.open();confirm.click();await new Promise(r=>setTimeout(r,20));assert.equal(h.requests.filter(r=>r.url.pathname.endsWith('/bookings')).length,0);assert.equal(f.requests.filter(r=>r.method==='POST').length,0);
});

test('widget treats server title and form labels as text, never markup',async t=>{
  const f=await assistantBookingFixture(t);f.store.update(f.actor.tenantId,'booking-pages',f.page.id,{name:'<img src=x onerror=alert(1)>',form:[{field:'name',label:'<script>private</script>',required:false}]});const a=await f.create('webchat');f.toolRound(a);const h=harness(f);t.after(()=>h.dom.window.close());await h.open();await h.ask();assert.equal(h.root.querySelector('img'),null);assert.equal(h.root.querySelector('script'),null);assert.match(h.text(),/<img src=x/);assert.match(h.text(),/<script>private/);assert.deepEqual(h.errors,[]);
});

test('explicit new slot page invalidates the old confirmation while preserving entered fields',async t=>{
  const f=await assistantBookingFixture(t);f.store.update(f.actor.tenantId,'booking-pages',f.page.id,{form:[{field:'name',label:'Nome',required:true}]});const a=await f.create('webchat');f.toolRound(a);const h=harness(f);t.after(()=>h.dom.window.close());await h.open();await h.ask();const old=h.root.querySelector('.booking-card')!,name=old.querySelector('input')!;name.value='DRAFT-KEPT';h.button('Revisar agendamento',old).click();const confirm=h.button('Confirmar agendamento',old);h.button('Atualizar horários',old).click();await until(()=>h.root.querySelectorAll('.booking-card').length===2);assert.equal(name.value,'DRAFT-KEPT');assert.equal(h.button('Revisar agendamento',old).disabled,true);confirm.click();assert.equal(h.refs().length,0);assert.equal(f.requests.filter(r=>r.method==='POST').length,0);
});
