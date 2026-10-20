import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {JSDOM,VirtualConsole} from 'jsdom';
import {PUBLIC_CHAT_WIDGET} from '../src/public-chat-widget.js';
import {calendlyFixture} from './fixtures/calendly.js';

async function until(check:()=>boolean){for(let i=0;i<300;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,5));}throw Error('DOM did not settle');}
type F=Awaited<ReturnType<typeof calendlyFixture>>;
type Request={url:URL;method:string;body:any;headers:Headers};
function harness(f:F,options:{saved?:Record<string,string>;before?:(r:Request)=>void|Promise<void>;after?:(r:Request,response:Response)=>Response|Promise<Response>}={}){
  const errors:any[]=[],console=new VirtualConsole();console.on('jsdomError',e=>errors.push(e));
  const dom=new JSDOM('<!doctype html><body></body>',{url:f.origin,runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:console}),w=dom.window;
  const script=w.document.createElement('script');script.src='http://127.0.0.1:4310/widget/kloel.js';script.dataset.kloelTenant=f.actor.tenantId;script.dataset.kloelChannel=f.channel.id;
  Object.defineProperty(w.document,'currentScript',{get:()=>script});Object.defineProperty(w.crypto,'randomUUID',{value:randomUUID});(w as any).AbortSignal=AbortSignal;
  let root!:ShadowRoot;const attach=w.HTMLElement.prototype.attachShadow;w.HTMLElement.prototype.attachShadow=function(opts){const result=attach.call(this,opts);root=result as any;return result;};
  const timers:(()=>void)[]=[];w.setTimeout=((fn:()=>void)=>{timers.push(fn);return timers.length;}) as any;w.clearTimeout=()=>{};
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
  const refs=()=>{const row=Object.entries(saved()).find(([k])=>k.endsWith(':calendly-references:v1'));return row?JSON.parse(row[1]):[];};
  const text=()=>root.textContent??'';
  const open=async()=>{button('Conversar com a Kloel').click();await until(()=>requests.some(r=>r.url.pathname.endsWith('/history'))&&!chatInput().disabled);};
  const ask=async()=>{chatInput().value='Quero agendar.';chatInput().closest('form')!.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>!!root.querySelector('.calendly-card')&&!chatInput().disabled);};
  const field=(label:string)=>root.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;
  const fill=()=>{field('Nome Calendly').value='PRIVATE-NAME';field('Email Calendly').value='private@example.test';field('Aceito notificações Calendly').checked=true;};
  const confirm=()=>{button('Revisar Calendly').click();button('Confirmar Calendly').click();};
  return{dom,w,root,errors,requests,timers,button,chatInput,field,fill,saved,refs,text,open,ask,confirm};
}
async function setup(t:any){const f=await calendlyFixture(t),c=await f.connect(),a=await f.createAction(c.id,'webchat');f.toolRound(a);return f;}
const posts=(f:F)=>f.requests.filter(r=>r.method==='POST'&&new URL(r.url).pathname==='/invitees').length;

test('authored widget requires explicit values and notification acknowledgement, then verifies accepted reservation',async t=>{
  const f=await setup(t),h=harness(f);t.after(()=>h.dom.window.close());await h.open();await h.ask();assert.equal(posts(f),0);assert.match(h.text(),/America\/Sao_Paulo/);
  h.button('Revisar Calendly').click();assert.equal(h.button('Confirmar Calendly'),undefined);h.fill();h.confirm();await until(()=>h.text().includes('Calendly aceitou'));assert.equal(posts(f),1);assert.equal(h.chatInput().disabled,false);
  assert.equal(h.requests.filter(r=>r.url.pathname.endsWith('/calendly-verify')).length,0);h.button('Verificar reserva Calendly').click();await until(()=>h.text().includes('reserva verificada'));h.button('Obter links Calendly').click();await until(()=>h.root.querySelectorAll('a').length===2);
  assert.deepEqual([...h.root.querySelectorAll('a')].map(a=>a.rel),['noopener noreferrer','noopener noreferrer']);const storage=JSON.stringify(h.saved());for(const v of ['PRIVATE-NAME','private@example.test','quote','cancellations/','reschedulings/'])assert.equal(storage.includes(v),false);assert.deepEqual(h.errors,[]);
});
test('lost envelope reload preserves original reference and recovers with GET only, without rebuilding a POST',async t=>{
  const f=await setup(t),h=harness(f,{after:async(r,response)=>{if(r.url.pathname.endsWith('/calendly-bookings'))throw Error('lost envelope');return response;}});t.after(()=>h.dom.window.close());await h.open();await h.ask();h.fill();h.confirm();await until(()=>h.text().includes('lost envelope'));
  const ref=h.refs()[0];assert.deepEqual(Object.keys(ref).sort(),['actionId','actionRevision','chatOperationKey','conversationId','eventTypeId','expiresAt','key','token']);const h2=harness(f,{saved:h.saved()});t.after(()=>h2.dom.window.close());await h2.open();h2.button('Consultar Calendly').click();await until(()=>h2.text().includes('Calendly aceitou'));
  assert.equal(h2.requests.filter(r=>r.method==='POST').length,0);assert.equal(posts(f),1);assert.equal(h2.refs()[0].key,ref.key);assert.equal(h2.button('Revisar Calendly').disabled,true);assert.equal(h2.chatInput().disabled,false);
});
test('GET404 after undelivered request never reconstructs missing values or releases a new key',async t=>{
  const f=await setup(t),h=harness(f,{before:r=>{if(r.url.pathname.endsWith('/calendly-bookings'))throw Error('undelivered');}});t.after(()=>h.dom.window.close());await h.open();await h.ask();h.fill();h.confirm();await until(()=>h.text().includes('undelivered'));
  const h2=harness(f,{saved:h.saved()});t.after(()=>h2.dom.window.close());await h2.open();h2.button('Consultar Calendly').click();await until(()=>h2.text().includes('Isso não prova ausência'));assert.equal(h2.button('Revisar Calendly').disabled,true);assert.equal(posts(f),0);assert.equal(h2.requests.filter(r=>r.method==='POST').length,0);
});
test('storage readback refusal blocks POST and preserves entered values',async t=>{
  const f=await setup(t),h=harness(f);t.after(()=>h.dom.window.close());await h.open();await h.ask();h.fill();const get=h.w.Storage.prototype.getItem;h.w.Storage.prototype.getItem=function(key){return key.endsWith(':calendly-references:v1')?null:get.call(this,key);};h.confirm();await until(()=>h.text().includes('referência Calendly não foi preservada'));assert.equal(posts(f),0);assert.equal(h.field('Nome Calendly').value,'PRIVATE-NAME');assert.equal(h.requests.filter(r=>r.url.pathname.endsWith('/calendly-bookings')).length,0);
});
test('retained confirmation after draft edit or end cannot submit into the old or a new visitor session',async t=>{
  const f=await setup(t),h=harness(f);t.after(()=>h.dom.window.close());await h.open();await h.ask();h.fill();h.button('Revisar Calendly').click();const old=h.button('Confirmar Calendly');h.field('Nome Calendly').value='NEW-NAME';h.field('Nome Calendly').dispatchEvent(new h.w.Event('input'));old.click();assert.equal(posts(f),0);assert.equal(h.refs().length,0);
  h.button('Revisar Calendly').click();const retained=h.button('Confirmar Calendly');h.button('Encerrar').click();await until(()=>h.text().includes('Conversa encerrada'));h.button('Fechar').click();await h.open();retained.click();assert.equal(posts(f),0);assert.equal(h.refs().length,0);
});
test('history refresh preserves draft and server title is text, not markup',async t=>{
  const f=await calendlyFixture(t);f.remote.type.name='<img src=x onerror=alert(1)>';const c=await f.connect(),a=await f.createAction(c.id,'webchat');f.toolRound(a);const h=harness(f);t.after(()=>h.dom.window.close());await h.open();await h.ask();h.fill();const card=h.root.querySelector('.calendly-card');const before=h.requests.filter(r=>r.url.pathname.endsWith('/history')).length;h.timers.at(-1)!();await until(()=>h.requests.filter(r=>r.url.pathname.endsWith('/history')).length>before);await until(()=>!h.chatInput().disabled);
  assert.equal(h.root.querySelector('.calendly-card'),card);assert.equal(h.field('Nome Calendly').value,'PRIVATE-NAME');assert.equal(h.root.querySelector('img'),null);assert.match(h.text(),/<img src=x/);assert.deepEqual(h.errors,[]);
});
