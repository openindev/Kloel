import test from 'node:test'
import { register } from 'node:module'
register('./helpers/onboarding-dom-assets-loader.mjs',import.meta.url)
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { Store } from '../../engine/src/store'
import { buildApp } from '../../engine/src/app'

test('signup initializes confirmed identity and retries a lost initialization using GET without another signup or PUT',async t=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://127.0.0.1:3004/criar-conta',pretendToBeVisual:true}),w=dom.window
 Object.assign(globalThis,{window:w,document:w.document,localStorage:w.localStorage,sessionStorage:w.sessionStorage,IS_REACT_ACT_ENVIRONMENT:true,getComputedStyle:w.getComputedStyle.bind(w)})
 for(const name of ['HTMLElement','HTMLInputElement','Element','Node','Event','MutationObserver'])globalThis[name]=w[name]
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:w.navigator});w.scrollTo=()=>{}
 const store=new Store(),app=await buildApp(store,{workers:false}),cookies:Record<string,string>={}
 let signupPosts=0,initializePuts=0,recover=false,expected:any
 globalThis.fetch=async(input,init={})=>{
  const path=String(input),method=init.method??'GET';assert.ok(path.startsWith('/api/v1/'))
  if(path.includes('/onboarding/editor-state/operations/')&&!recover)return Response.json({error:{code:'not_found',message:'Confirmação indisponível no teste.'}},{status:404})
  const response=await app.inject({url:path,method:method as any,cookies,headers:init.headers as any,...(init.body?{payload:String(init.body)}:{})})
  for(const cookie of response.cookies)cookies[cookie.name]=cookie.value
  if(path.endsWith('/auth/signup')){signupPosts++;assert.equal(response.statusCode,201,response.body);expected=response.json().context}
  if(path.endsWith('/onboarding/editor-state')&&method==='PUT'){
   initializePuts++;const payload=JSON.parse(String(init.body));assert.equal(payload.initialize,true);assert.equal(payload.expectedTenantId,expected.tenantId);assert.equal(response.statusCode,200,response.body);throw Error('Lost committed initialization')
  }
  return new Response(response.statusCode===204?null:response.body,{status:response.statusCode,headers:{'content-type':'application/json'}})
 }
 const React=await import('react'),{createRoot}=await import('react-dom/client'),{MemoryRouter,useLocation}=await import('react-router-dom')
 const {default:SignupPage}=await import('../src/site/pages/auth/SignupPage'),{engineSession}=await import('../src/services/engine/session'),{startEngineProjection}=await import('../src/services/casca/data'),{useStore}=await import('../src/data/store')
 let route='';const Probe=()=>{route=useLocation().pathname;return null},root=createRoot(w.document.getElementById('root')!),settle=()=>new Promise(r=>setTimeout(r,40))
 await engineSession.refresh();const stop=startEngineProjection()
 t.after(async()=>{await React.act(async()=>root.unmount());stop();await app.close();dom.window.close()})
 await React.act(async()=>{root.render(<MemoryRouter initialEntries={['/criar-conta?produto=voice&plano=solo']}><SignupPage/><Probe/></MemoryRouter>);await settle()})
 for(const[id,value]of Object.entries({'su-company':'Nova empresa','su-email':'signup-onboarding@example.test','su-password':'secure-signup-fixture'}))await React.act(async()=>{const field=w.document.getElementById(id)!;Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype,'value')!.set!.call(field,value);field.dispatchEvent(new w.Event('input',{bubbles:true}));await settle()})
 const submit=async()=>React.act(async()=>{w.document.querySelector('form')!.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await settle()})
 await submit();for(let n=0;n<80&&!w.document.body.textContent!.includes('Confirmação indisponível');n++)await React.act(settle)
 assert.match(w.document.body.textContent!,/Confirmação indisponível/);assert.equal(route,'/criar-conta');assert.equal(signupPosts,1);assert.equal(initializePuts,1);assert.equal(store.list(expected.tenantId,'onboarding-editor-states')[0].completed,false)
 recover=true;await submit();for(let n=0;n<80&&route!=='/app/onboarding';n++)await React.act(settle)
 assert.equal(route,'/app/onboarding');assert.equal(signupPosts,1);assert.equal(initializePuts,1)
 const org=useStore.getState().db.organizations[0];assert.equal(org.onboardingRequired,true);assert.equal(org.onboardingCompletionConfirmed,false);assert.equal(org.signupIntent?.product,'voice');assert.equal(useStore.getState().db.subscriptions.length,0)
})
