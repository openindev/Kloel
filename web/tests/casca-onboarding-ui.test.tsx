import test from 'node:test'
import { register } from 'node:module'
register('./helpers/onboarding-dom-assets-loader.mjs',import.meta.url)
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { JSDOM } from 'jsdom'
import { Store } from '../../engine/src/store'
import { buildApp } from '../../engine/src/app'
import { provisionPlanPolicy, setTenantEnforcement, commitEntitlement } from '../../engine/src/billing/plans'

test('existing onboarding DOM saves profile, recovers agent creation, indexes knowledge, saves real chat and completes only with LIVE entitlement',async t=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://127.0.0.1:3004/app/onboarding',pretendToBeVisual:true}),w=dom.window
 Object.assign(globalThis,{window:w,document:w.document,localStorage:w.localStorage,sessionStorage:w.sessionStorage,IS_REACT_ACT_ENVIRONMENT:true,getComputedStyle:w.getComputedStyle.bind(w),requestAnimationFrame:w.requestAnimationFrame.bind(w),cancelAnimationFrame:w.cancelAnimationFrame.bind(w)})
 for(const name of ['HTMLElement','HTMLFormElement','HTMLInputElement','HTMLButtonElement','Element','Node','NodeFilter','DocumentFragment','MutationObserver','CustomEvent','Event','MouseEvent'])globalThis[name]=w[name]
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:w.navigator}); w.scrollTo=()=>{};w.HTMLElement.prototype.scrollTo=()=>{};globalThis.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}}
 const store=new Store(),app=await buildApp(store,{workers:false})
 const signup=await app.inject({method:'POST',url:'/api/v1/auth/signup',payload:{email:'onboarding-dom@example.test',password:'onboarding-dom-password',organization:'Empresa real no teste'}})
 assert.equal(signup.statusCode,201,signup.body)
 const expected=signup.json().context,cookies={kloel_session:signup.cookies.find(c=>c.name==='kloel_session')!.value},tenantId=expected.tenantId
 const previous={model:process.env.OPENAI_MODEL,key:process.env.OPENAI_API_KEY,tenant:process.env.PROVIDER_TENANT_ID},originalFetch=globalThis.fetch
 process.env.OPENAI_MODEL='gpt-4.1-mini';process.env.OPENAI_API_KEY='isolated-onboarding-fixture';process.env.PROVIDER_TENANT_ID=tenantId
 let mode:'test'|'live'='test',agentPosts=0,embeddingCalls=0,chatPosts=0,profilePatches=0,onboardingPuts=0,initPuts=0,loseAgent=true,loseChat=true
 const price={priceId:'price_onboarding',productName:'Chatbot',currency:'brl',unitAmount:7900,interval:'month',intervalCount:1,active:true,livemode:true,checkoutUsable:true,synthetic:false,kloelPlan:{product:'webchat',tier:'solo',interval:'monthly'}}
 const subscription={id:randomUUID(),providerSubscriptionId:'sub_onboarding',status:'active',priceId:price.priceId,cancelAtPeriodEnd:false,cancelAt:null,canceledAt:null,endedAt:null,currentPeriodEnd:Math.floor(Date.now()/1000)+86400,scheduledCancellation:false}
 const requests:{path:string;method:string}[]=[], failures:any[]=[]
 globalThis.fetch=async(input,init={})=>{
  const path=String(input),method=init.method??'GET';requests.push({path,method})
  if(path==='https://api.openai.com/v1/embeddings'){embeddingCalls++;const body=JSON.parse(String(init.body));return Response.json({data:body.input.map((_:unknown,index:number)=>({index,embedding:[1,0,0]})),usage:{prompt_tokens:10,total_tokens:10}})}
  if(path==='https://api.openai.com/v1/responses')return Response.json({id:'resp_onboarding',output:[{type:'message',content:[{type:'output_text',text:'A empresa atende no setor informado.'}]}],usage:{prompt_tokens:10,total_tokens:10}})
  assert.ok(path.startsWith('/api/v1/'),'Unexpected external request '+path)
  if(path.endsWith('/billing/catalog'))return Response.json({configured:true,mode,source:'stripe_api',items:[{...price,livemode:mode==='live',synthetic:mode==='test'}]})
  if(path.endsWith('/billing/status'))return Response.json({account:null,subscriptions:[subscription]})
  if(path.endsWith('/billing/identity'))return Response.json({configured:false,mode:'unavailable',verification:null})
  if(path.endsWith('/account/profile')&&method==='PATCH')profilePatches++
  if(path.endsWith('/onboarding/editor-state')&&method==='PUT'){onboardingPuts++;if(JSON.parse(String(init.body)).initialize)initPuts++}
  if(path.endsWith('/agents/editor-state')&&method==='POST'){agentPosts++;assert.deepEqual(JSON.parse(String(init.body)).state.technical.preciseExtraction,[], 'onboarding must not submit the shell extraction examples as executable settings')}
  if(path.endsWith('/ai/chat')&&method==='POST')chatPosts++
  const response=await app.inject({url:path,method:method as any,headers:init.headers as any,cookies,...(init.body?{payload:String(init.body)}:{})})
  if(response.statusCode>=400)failures.push({path,status:response.statusCode,body:response.json()})
  if(path.endsWith('/agents/editor-state')&&method==='POST'&&response.statusCode===201&&loseAgent){loseAgent=false;throw Error('agent response lost after commit')}
  if(path.endsWith('/ai/chat')&&method==='POST'&&response.statusCode===200&&loseChat){loseChat=false;throw Error('chat response lost after commit')}
  return new Response(response.statusCode===204?null:response.body,{status:response.statusCode,headers:{'content-type':'application/json'}})
 }
 const React=await import('react'),{createRoot}=await import('react-dom/client'),{MemoryRouter}=await import('react-router-dom')
 const {default:OnboardingPage}=await import('../src/app/pages/onboarding/OnboardingPage'),{TooltipProvider}=await import('../src/components/ui/tooltip')
 const {Toaster}=await import('sonner')
 const {engineSession}=await import('../src/services/engine/session'),{useStore}=await import('../src/data/store'),{startEngineProjection}=await import('../src/services/casca/data')
 const root=createRoot(w.document.getElementById('root')!),settle=()=>new Promise(r=>setTimeout(r,60))
 let stop=()=>{},routeKey=0
 t.after(async()=>{await React.act(async()=>root.unmount());stop();await app.close();dom.window.close();globalThis.fetch=originalFetch;for(const [key,value]of Object.entries({OPENAI_MODEL:previous.model,OPENAI_API_KEY:previous.key,PROVIDER_TENANT_ID:previous.tenant})){if(value===undefined)delete process.env[key];else process.env[key]=value}})
 const render=async()=>React.act(async()=>{root.render(<MemoryRouter key={++routeKey} initialEntries={['/app/onboarding']}><TooltipProvider><OnboardingPage/><Toaster/></TooltipProvider></MemoryRouter>);await settle()})
 const until=async(predicate:()=>unknown,label:string)=>{for(let i=0;i<80;i++){if(predicate())return;await React.act(settle)}assert.fail(label+'\n'+w.document.body.textContent+'\n'+JSON.stringify({requests:requests.slice(-12),failures,knowledge:store.list(tenantId,'knowledge').map(x=>({indexed:x.indexed,ingestionStatus:x.ingestionStatus}))}))}
 const click=async(label:string)=>{await React.act(async()=>{const el=[...w.document.querySelectorAll('button')].find(b=>b.textContent!.trim()===label);assert.ok(el,'Missing '+label);el.click();await settle()})}
 const fill=async(id:string,value:string)=>React.act(async()=>{const el=w.document.getElementById(id);assert.ok(el,'Missing '+id);Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype,'value')!.set!.call(el,value);el.dispatchEvent(new w.Event('input',{bubbles:true}));await settle()})
 await React.act(async()=>{await engineSession.refresh();assert.equal(engineSession.getSnapshot().phase,'authenticated');stop=startEngineProjection();await settle()})
 assert.equal(useStore.getState().db.organizations[0].onboardingRequired,false);assert.equal(useStore.getState().db.organizations[0].onboardingCompletionConfirmed,false)
 await render();await until(()=>w.document.querySelector('[data-testid="onboarding-plan"]'),'TEST subscription must remain on plan');assert.equal(initPuts,1);assert.equal(agentPosts,0)
 // A confirmed LIVE catalog controls the wizard gate; entitlement is separately enforced by the actual backend at completion.
 mode='live';await render();await until(()=>w.document.getElementById('ob-first'),'LIVE wizard did not load')
 await fill('ob-first','Ana');await fill('ob-last','Silva');await click('Continuar');await until(()=>w.document.body.textContent!.includes('Em qual setor você atua?'),'profile step failed');assert.equal(profilePatches,1)
 const {SECTORS,COMPANY_SIZES,REFERRAL_SOURCES}=await import('../src/app/pages/onboarding/setupOptions')
 await click(SECTORS[0].label);await until(()=>w.document.body.textContent!.includes('Quantos colaboradores'),'sector step failed')
 await click(COMPANY_SIZES[0].label);await until(()=>w.document.body.textContent!.includes('Como você ficou sabendo'),'size step failed')
 await click(REFERRAL_SOURCES[0].label);await until(()=>w.document.querySelector('[data-testid="onboarding-start-test-chat-card"]'),'assistant setup failed')
 assert.equal(agentPosts,1);assert.equal(store.list(tenantId,'agents').length,1);assert.equal(store.list(tenantId,'knowledge').length,1);assert.equal(store.list(tenantId,'knowledge')[0].indexed,true);assert.ok(embeddingCalls>=1)
 const actualAgent=store.list(tenantId,'agents')[0];assert.equal(useStore.getState().db.organizations[0].onboardingAgentId,actualAgent.id)
 await React.act(async()=>{w.document.querySelector<HTMLButtonElement>('[data-testid="onboarding-start-test-chat-card"]')!.click();await settle()});await until(()=>w.document.querySelector('[data-testid="onboarding-test-chat"]'),'test chat missing')
 await React.act(async()=>{const input=w.document.querySelector<HTMLInputElement>('input[aria-label="Mensagem do cliente"]')!;Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype,'value')!.set!.call(input,'Qual é o setor da empresa?');input.dispatchEvent(new w.Event('input',{bubbles:true}));await settle()})
 await React.act(async()=>{w.document.querySelector('input[aria-label="Mensagem do cliente"]')!.closest('form')!.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await settle()})
 await until(()=>w.document.body.textContent!.includes('A empresa atende no setor informado.'),'real chat reply missing');assert.equal(chatPosts,1)
 await click('Encerrar e salvar em Conversas');await until(()=>w.document.querySelector('[data-testid="onboarding-chat-result"]'),'chat was not saved')
 const conversationId=useStore.getState().db.organizations[0].onboardingTestConversationId!,actualConversation=store.get(tenantId,'conversations',conversationId)
 assert.ok(actualConversation);assert.equal(actualConversation.channel,'webchat');assert.equal(actualConversation.status,'closed');assert.equal(store.list(tenantId,'conversations').length,1)
 await click('Ir para o painel');assert.equal(useStore.getState().db.organizations[0].onboardingCompletionConfirmed,false)
 // Synthetic test entitlement is deliberately provisioned only inside this in-memory fixture.
 const now=Math.floor(Date.now()/1000)
 setTenantEnforcement(store,{operationKey:randomUUID(),expectedRevision:0,tenantId,stripeMode:'live',enabled:true})
 provisionPlanPolicy(store,{operationKey:randomUUID(),expectedRevision:0,priceId:price.priceId,stripeMode:'live',planId:'onboarding_fixture',enabled:true,assistantChatRoundsPerDay:10})
 store.create(tenantId,'billing-accounts',{customerId:'cus_onboarding'})
 store.transaction(()=>commitEntitlement(store,tenantId,{mode:'subscription',subscription:'sub_onboarding',customer:'cus_onboarding',livemode:true},{id:'sub_onboarding',livemode:true,customer:'cus_onboarding',status:'active',pause_collection:null,cancel_at:null,items:{has_more:false,data:[{quantity:1,price:{id:price.priceId},current_period_start:now-3600,current_period_end:now+86400}]}},{id:price.priceId,livemode:true,type:'recurring',recurring:{usage_type:'licensed'}}))
 await click('Ir para o painel');await until(()=>useStore.getState().db.organizations[0].onboardingCompletionConfirmed,'completion was not confirmed')
 assert.equal(initPuts,1);assert.equal(agentPosts,1);assert.equal(chatPosts,1);assert.ok(onboardingPuts>=7)
})
