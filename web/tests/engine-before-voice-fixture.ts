import type { TestContext } from 'node:test'
import { beforeVoiceFixture } from '../../engine/tests/fixtures/before-voice'
import { registerAccountProfile } from '../../engine/src/account-profile'
import { registerDomains } from '../../engine/src/domains'
import { createEngineClient, EngineError } from '../src/services/engine/http'
import { createAgentTestService } from '../src/services/engine/agent-test'
import { createBeforeContextService } from '../src/services/engine/before-context'
export async function beforeVoiceUIFixture(t:TestContext) {
  const f=await beforeVoiceFixture(t,{setup:async(app,store)=>{await registerAccountProfile(app,store);await registerDomains(app,store)}})
  const agent=f.store.update(f.actor.tenantId,'agents',f.agent.id,{rules:[],settings:{temperature:0.7,maxResponseTokens:1024,timezone:'UTC',recordingEnabled:false,humanHandoffEnabled:false}})!
  const identity=(await f.request('GET','/api/v1/auth/me')).json(),providerFetch=globalThis.fetch
  const calls:Array<{path:string;method:string;body:any;headers:Headers}>=[]
  const state={current:true,before:undefined as undefined|((r:typeof calls[number])=>Promise<Response|void>),after:undefined as undefined|((r:typeof calls[number],response:Response)=>Promise<Response>)}
  const fetcher:typeof fetch=async(input,init={})=>{
    const path=String(input);if(!path.startsWith('/api/v1/'))return providerFetch(input,init)
    const r={path,method:init.method??'GET',body:init.body?JSON.parse(String(init.body)):undefined,headers:new Headers(init.headers)};calls.push(r)
    const early=await state.before?.(r);if(early)return early
    const response=await f.app.inject({method:r.method as any,url:path,headers:{cookie:f.headers.cookie,...Object.fromEntries(r.headers)},...(init.body?{payload:String(init.body)}:{})})
    const result=new Response(response.statusCode===204?null:response.body,{status:response.statusCode,headers:{'Content-Type':'application/json'}})
    return state.after?state.after(r,result):result
  }
  globalThis.fetch=fetcher
  const request=createEngineClient(fetcher),context={tenantId:f.actor.tenantId,generation:1,assertCurrent(){if(!state.current)throw new EngineError(0,'superseded','Context changed')},request:<T,>(path:string,options?:any)=>request<T>(path,{...options,expectedContext:identity.context})}
  return{...f,agent,identity,providerFetch,fetcher,calls,state,context,client:createAgentTestService(context,agent.id),before:createBeforeContextService(context,agent.id),writes:()=>calls.filter(r=>r.method!=='GET'&&r.path.startsWith('/api/v1/ai/realtime/'))}
}
