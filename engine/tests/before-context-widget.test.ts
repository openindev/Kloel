import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {JSDOM,VirtualConsole} from 'jsdom';
import {PUBLIC_CHAT_WIDGET} from '../src/public-chat-widget.js';
import {beforeContextFixture} from './fixtures/before-context.js';

async function until(check:()=>boolean){for(let i=0;i<300;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,5));}throw Error('DOM did not settle');}
type F=Awaited<ReturnType<typeof beforeContextFixture>>;
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

test('widget persists original token/key before opening and renders deterministic greeting as text', async t => {
  const f = await beforeContextFixture(t); await f.enable({ ...f.sample, defaultGreeting: '<img src=x> {{vars.quantidade}} {{vars.ativo}}' });
  let h!: ReturnType<typeof harness>;
  h = harness(f, { before: r => { if (r.method === 'POST' && r.url.pathname.endsWith('/opening')) { const record = Object.values(h.saved()).map(x => JSON.parse(x)).find(x => x.openingKey); assert.equal(record.openingKey, r.body.idempotencyKey); assert.equal(record.token, r.headers.get('authorization')?.slice(7)); } } }); t.after(() => h.dom.window.close());
  await h.open(); assert.match(h.text(), /<img src=x> 0 false/); assert.equal(h.root.querySelector('img'), null); assert.equal(h.requests.filter(r => r.method === 'POST' && r.url.pathname.endsWith('/opening')).length, 1); assert.equal(f.openAI.length, 0); assert.deepEqual(h.errors, []);
  const saved = h.saved(); assert.ok(!JSON.stringify(saved).includes('Exemplo sintético')); assert.ok(!JSON.stringify(saved).includes('<img'));
});
test('lost opening envelope reload recovers only original GET/history and never emits second greeting', async t => {
  const f = await beforeContextFixture(t); await f.enable();
  const h = harness(f, { after: (r, response) => { if (r.method === 'POST' && r.url.pathname.endsWith('/opening')) throw Error('lost opening envelope'); return response; } }); t.after(() => h.dom.window.close());
  h.button('Conversar com a Kloel').click(); await until(() => h.text().includes('lost opening envelope')); assert.equal(h.chatInput().disabled, true);
  const h2 = harness(f, { saved: h.saved() }); t.after(() => h2.dom.window.close()); await h2.open();
  assert.equal(h2.requests.filter(r => r.method === 'POST').length, 0); assert.equal(h2.root.querySelectorAll('.message').length, 1); assert.match(h2.text(), /Olá Visitante: 0 \/ false/); assert.equal(f.store.list(f.actor.tenantId, 'before-context-openings').length, 1); assert.equal(f.openAI.length, 0);
});
test('opening GET404 after reload retains reference and disables chat with no reconstruction or automatic POST', async t => {
  const f = await beforeContextFixture(t); await f.enable(); const h = harness(f, { before: r => { if (r.method === 'POST' && r.url.pathname.endsWith('/opening')) throw Error('request interrupted before delivery'); } }); t.after(() => h.dom.window.close());
  h.button('Conversar com a Kloel').click(); await until(() => h.text().includes('request interrupted')); const saved = h.saved();
  const h2 = harness(f, { saved }); t.after(() => h2.dom.window.close()); h2.button('Conversar com a Kloel').click(); await until(() => h2.text().includes('Nada será reenviado automaticamente'));
  assert.equal(h2.chatInput().disabled, true); assert.deepEqual(h2.saved(), saved); assert.equal(h2.requests.filter(r => r.method === 'POST').length, 0); h2.button('Consultar abertura').click(); await until(() => h2.requests.filter(r => r.url.pathname.endsWith('/opening')).length === 2); assert.equal(h2.requests.filter(r => r.method === 'POST').length, 0);
});
for (const mode of ['throw', 'readback'] as const) test(`widget ${mode} storage failure prevents opening POST and greeting publication`, async t => {
  const f = await beforeContextFixture(t); await f.enable(); const h = harness(f); t.after(() => h.dom.window.close());
  const set = h.w.Storage.prototype.setItem;
  h.w.Storage.prototype.setItem = function(k, v) { if (mode === 'throw') throw Error('storage refused'); set.call(this, k, '{}'); };
  h.button('Conversar com a Kloel').click(); await until(() => h.text().includes(mode === 'throw' ? 'storage refused' : 'Nenhuma abertura foi enviada'));
  assert.equal(h.requests.filter(r => r.url.pathname.endsWith('/opening')).length, 0); assert.equal(h.root.querySelectorAll('.message').length, 0); assert.equal(h.chatInput().disabled, true); assert.equal(f.store.list(f.actor.tenantId, 'before-context-openings').length, 0);
});

