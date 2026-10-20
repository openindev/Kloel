import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { identityUIFixture } from './engine-identity-review-fixture'

test('existing conversation dialog requires explicit manual-only confirmation, shows masked origin/history links and recovers without repost',async t=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://127.0.0.1:3004/app/inbox',pretendToBeVisual:true}),w=dom.window
 Object.assign(globalThis,{window:w,document:w.document,localStorage:w.localStorage,sessionStorage:w.sessionStorage,IS_REACT_ACT_ENVIRONMENT:true,getComputedStyle:w.getComputedStyle.bind(w),requestAnimationFrame:w.requestAnimationFrame.bind(w),cancelAnimationFrame:w.cancelAnimationFrame.bind(w)})
 for(const name of ['HTMLElement','HTMLInputElement','HTMLButtonElement','Element','Node','NodeFilter','DocumentFragment','MutationObserver','CustomEvent','Event','MouseEvent'])globalThis[name]=w[name]
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:w.navigator})
 const f=await identityUIFixture(t);globalThis.fetch=f.fetcher
 const React=await import('react'),{createRoot}=await import('react-dom/client'),{MemoryRouter}=await import('react-router-dom')
 const {engineSession,captureEngineContext}=await import('../src/services/engine/session'),{loadConversation}=await import('../src/services/casca/conversations'),{ConversationOperationDialog}=await import('../src/app/pages/inbox/ConversationOperationDialog')
 await engineSession.refresh();assert.equal(engineSession.getSnapshot().phase,'authenticated')
 const conversation=await loadConversation(captureEngineContext(),f.conversationId),before=structuredClone(f.current()),root=createRoot(w.document.getElementById('root')!),settle=()=>new Promise(r=>setTimeout(r,50))
 t.after(async()=>{await React.act(async()=>root.unmount());dom.window.close()})
 let key=0
 const render=()=>React.act(async()=>{root.render(<MemoryRouter key={++key}><ConversationOperationDialog conversation={conversation} operation="identity" onClose={()=>{}}/></MemoryRouter>);await settle()})
 const until=async(predicate:()=>unknown,label:string)=>{for(let i=0;i<50;i++){if(predicate())return;await React.act(settle)}assert.fail(label+' '+w.document.body.textContent)}
 const confirm=()=>[...w.document.querySelectorAll('button')].find(b=>b.textContent==='Confirmar atendimento humano')!
 await render();await until(()=>w.document.body.textContent!.includes('Origem recebida:'),'review load')
 assert.doesNotMatch(w.document.body.textContent!,new RegExp(f.sender));assert.match(w.document.body.textContent!,/não envia mensagens nem ativa respostas de IA/);assert.equal(confirm().disabled,true)
 const history=w.document.querySelector('a[href*="/app/inbox?id="]')!;assert.ok(history);assert.equal(new URL(history.getAttribute('href')!,'https://local.invalid').searchParams.get('id'),f.legacy.id)
 assert.equal(f.writes().length,0)
 await React.act(async()=>{w.document.querySelector<HTMLButtonElement>('[role="checkbox"]')!.click();await settle()});assert.equal(confirm().disabled,false)
 f.state.loseAfter=true;await React.act(async()=>{confirm().click();await settle()})
 await until(()=>w.document.body.textContent!.includes('Consultar tentativa'),'uncertain attempt not preserved');assert.equal(f.writes().length,1)
 await render();await until(()=>w.document.body.textContent!.includes('Revisão válida para atendimento humano.'),'receipt did not recover')
 assert.equal(f.writes().length,1);assert.equal(f.calls.length,0);assert.equal(f.store.list(f.tenant,'reply-jobs').length,0);assert.deepEqual(f.current().tags,before.tags);assert.equal(f.current().status,before.status)
 assert.equal(confirm().disabled,true);assert.equal(f.current().metaIdentityPolicy,'manual_only')
})
