import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createCascaChatSession } from '../src/services/casca/test-chat'
const tenantId='synthetic-chat-tenant', agentId=randomUUID()
function fixture() {
 const scope={tenantId,userId:randomUUID(),membershipId:randomUUID(),authorityVersion:'c'.repeat(64)}, values=new Map<string,string>(), calls:any[]=[]
 const storage={getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v)},removeItem:(k:string)=>{values.delete(k)}}
 let current=true, handler=async (_path:string,_options:any):Promise<any>=>{throw Error('unset')}
 const context={tenantId,generation:1,assertCurrent(){if(!current)throw Error('scope changed')},async request<T>(path:string,options?:any):Promise<T>{calls.push({path,options});return handler(path,options)}}
 const result={conversationId:randomUUID(),responseId:randomUUID(),text:'Resposta real do fixture',usage:{},sheetOperations:[],bookingChoices:[]}
 return {scope,values,calls,storage,context,result,session:createCascaChatSession(context,scope,storage,agentId),set:(fn:typeof handler)=>handler=fn,revoke:()=>current=false}
}
test('chat sends once, binds returned conversation and preserves no message text in journal',async()=>{
 const f=fixture(); f.set(async(_p,o)=>{assert.doesNotMatch([...f.values.values()].join(''),/mensagem privada/); return f.result})
 assert.equal((await f.session.send('mensagem privada')).text,f.result.text); assert.equal(f.session.conversationId,f.result.conversationId);assert.equal(f.session.pending,null)
 await f.session.send('segunda'); assert.equal(f.calls[1].options.body.conversationId,f.result.conversationId); assert.notEqual(f.calls[0].options.body.idempotencyKey,f.calls[1].options.body.idempotencyKey)
})
test('lost committed response is recovered with GET only and unresolved requests cannot be resent',async()=>{
 const f=fixture(); f.set(async(_p,o)=>{if(o?.method==='POST')throw Error('lost');return {status:'pending',sheetOperations:[]}})
 await assert.rejects(()=>f.session.send('privada')); const key=f.session.pending!.key;await assert.rejects(()=>f.session.send('do not repeat'));assert.equal(f.calls.filter(c=>c.options?.method==='POST').length,1)
 f.set(async p=>{assert.ok(p.endsWith(key));return {status:'succeeded',result:f.result}});assert.equal((await f.session.consult()).conversationId,f.result.conversationId);assert.equal(f.session.pending,null)
})
test('storage failure prevents dispatch and late authority prevents accepting a result',async()=>{
 const f=fixture(), blocked=createCascaChatSession(f.context,f.scope,{getItem:()=>null,setItem(){throw Error('quota')},removeItem(){}},agentId)
 await assert.rejects(()=>blocked.send('x'));assert.equal(f.calls.length,0)
 f.set(async()=>{f.revoke();return f.result}); await assert.rejects(()=>f.session.send('x'),/scope changed/);assert.ok(f.values.size)
})
test('failed receipt clears only the completed chat reference and retains unresolved sheet identifiers',async()=>{
 const f=fixture(), operationRef=randomUUID();f.set(async(_p,o)=>{if(o?.method==='POST')throw Error('lost');return {status:'failed',sheetOperations:[{kind:'append',operationRef,status:'uncertain',rowsAppended:null,requiresReconciliation:true,automaticRetry:false}]}})
 await assert.rejects(()=>f.session.send('x'),/resposta falhou/);assert.equal(f.session.pending,null);assert.deepEqual(f.session.operationReferences,[operationRef]);assert.doesNotMatch([...f.values.values()].join(''),/"(?:sheetOperations|message|text)"\s*:/)
})
test('configured web search is forwarded explicitly while conversation context remains bound',async()=>{
 const f=fixture(); f.set(async()=>f.result)
 const session=createCascaChatSession(f.context,f.scope,f.storage,agentId,{webSearch:true})
 await session.send('Consulte o site');assert.equal(f.calls[0].options.body.webSearch,true);assert.equal(f.calls[0].options.body.agentId,agentId)
})
