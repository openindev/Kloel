import test from 'node:test'
import assert from 'node:assert/strict'
import { beforeVoiceUIFixture } from './engine-before-voice-fixture'
import { parseBeforeVoiceIntent,parseBeforeVoiceMetadata } from '../src/services/engine/before-voice'
import { createBeforeVoiceJournal } from '../src/services/engine/before-voice-journal'
import { createVoiceOperationsService } from '../src/services/engine/voice-operations'
const storage=()=>{const map=new Map<string,string>();return{getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{map.set(k,v)},removeItem:(k:string)=>{map.delete(k)},map}}
const tick=()=>new Promise(r=>setImmediate(r))
test('A2 client parses real Fastify ready/activate/greeting/normal ACK and GET/list preserve original metadata',async t=>{
  const f=await beforeVoiceUIFixture(t);await f.enable();assert.deepEqual((await f.before.availability()).supportedSurfaces,['private','webchat','voice_private','voice_incoming'])
  const key=crypto.randomUUID(),start=await f.client.startVoice('v=0\r\na=offer',key,{expectedRevision:1,mode:'test',testFacts:{phone:'+5511999990012'}})
  assert.equal(start.beforeContext?.mode,'test');assert.equal(start.beforeContext?.mediaStage,'blocked');assert.deepEqual((start as any).toolsEnabled,[])
  const op=await f.client.activateVoice(key,start.beforeContext!.openingId);assert.equal(op.beforeContext?.mediaStage,'greeting')
  f.sockets[0].finishGreeting();await tick();const current=await f.client.voiceOperation(key);assert.equal(current.beforeContext?.mediaStage,'conversation')
  const list=await createVoiceOperationsService(f.context,{agentId:f.agent.id}).list();assert.equal(list.items[0].beforeContext?.openingId,start.beforeContext?.openingId)
  const before=f.requests.length;await f.client.voiceOperation(key);assert.equal(f.requests.length,before)
  const cancelled=await f.client.cancelVoice(key);assert.equal(cancelled.beforeContext?.mediaStage,'blocked')
})
test('A2 loss after activate recovers GET and never performs a second greeting or external start',async t=>{
  const f=await beforeVoiceUIFixture(t);await f.enable();const key=crypto.randomUUID(),start=await f.client.startVoice('v=0\r\na=offer',key,{expectedRevision:1,mode:'live'})
  f.state.after=async(r,response)=>{if(r.path.endsWith('/activate')){f.state.after=undefined;throw Error('lost response')}return response}
  await assert.rejects(f.client.activateVoice(key,start.beforeContext!.openingId));assert.equal((await f.client.voiceOperation(key)).beforeContext?.mediaStage,'greeting')
  const count=f.requests.length;f.sockets[0].finishGreeting();await tick();assert.equal((await f.client.voiceOperation(key)).beforeContext?.mediaStage,'conversation');assert.equal(f.requests.length,count)
  assert.equal(f.sockets[0].sent.filter(e=>e.type==='response.create').length,1);assert.equal(f.writes().filter(r=>r.path.endsWith('/activate')).length,1)
})
test('A2 original receipt after configuration edit remains readable but cannot authorize media',async t=>{
  const f=await beforeVoiceUIFixture(t);await f.enable();const key=crypto.randomUUID(),start=await f.client.startVoice('v=0\r\na=offer',key,{expectedRevision:1,mode:'live'})
  await f.client.activateVoice(key,start.beforeContext!.openingId);f.sockets[0].finishGreeting();await tick();await f.save({...f.sample,defaultGreeting:'Outra'},1)
  const before=f.writes().length,op=await f.client.voiceOperation(key);assert.equal(op.beforeContext?.openingId,start.beforeContext?.openingId);assert.equal(op.beforeContext?.mediaStage,'blocked');assert.equal(f.writes().length,before)
})
test('A2 parsers reject contradictory media states, extra facts, changed identity and live test facts',async t=>{
  const f=await beforeVoiceUIFixture(t);await f.enable();const op=await f.client.startVoice('v=0\r\na=offer',crypto.randomUUID(),{expectedRevision:1,mode:'live'}),m=op.beforeContext!
  for(const v of [{...m,mediaStage:'conversation'},{...m,mediaStage:'greeting'},{...m,revision:Number.MAX_SAFE_INTEGER+1},{...m,facts:{}},{...m,audioDelivery:'heard'},{...m,surface:'voice_incoming',mode:'test'}])assert.throws(()=>parseBeforeVoiceMetadata(v))
  assert.throws(()=>parseBeforeVoiceMetadata({...m,openingId:crypto.randomUUID()},m));assert.throws(()=>parseBeforeVoiceMetadata({...m,mode:'test'},undefined,{expectedRevision:1,mode:'live'}))
  for(const v of [{expectedRevision:1,mode:'live',testFacts:{}},{expectedRevision:0,mode:'live'},{expectedRevision:1,mode:'test',testFacts:{phone:'123'}},{expectedRevision:1,mode:'live',authority:{}}])assert.throws(()=>parseBeforeVoiceIntent(v))
})
test('A2 journal is opaque, readback fenced, scope exact and unknown/old cleanup cannot release a new attempt',async t=>{
  const f=await beforeVoiceUIFixture(t),s=storage(),j=createBeforeVoiceJournal(s,f.identity.context,f.agent.id),a={key:crypto.randomUUID(),agentId:f.agent.id,expectedRevision:1,mode:'test' as const},fresh=()=>{}
  j.reserve(a,fresh);assert.deepEqual(j.read(),a);assert.throws(()=>j.reserve({...a,key:crypto.randomUUID()},fresh));assert.throws(()=>j.clearResolved(a,{operationKey:a.key,status:'unknown'},fresh))
  assert.doesNotMatch(JSON.stringify([...s.map.values()]),/testFacts|phone|SDP|greeting|nome|Visitante/)
  const other=createBeforeVoiceJournal(s,{...f.identity.context,authorityVersion:'b'.repeat(64)},f.agent.id);assert.equal(other.read(),undefined)
  j.clearResolved(a,{operationKey:a.key,status:'failed'},fresh);const b={...a,key:crypto.randomUUID()};j.reserve(b,fresh);assert.throws(()=>j.clearResolved(a,{operationKey:a.key,status:'failed'},fresh));assert.deepEqual(j.read(),b)
  s.map.clear();const broken=createBeforeVoiceJournal({...s,setItem(){}},f.identity.context,f.agent.id);assert.throws(()=>broken.reserve(a,fresh));assert.equal(j.read(),undefined)
})
test('A2 original absent receipt is neutral GET404; late authority invalidation rejects projection',async t=>{
  const f=await beforeVoiceUIFixture(t);await assert.rejects(f.client.voiceOperation(crypto.randomUUID()),e=>(e as any).status===404);assert.equal(f.writes().length,0);assert.equal(f.requests.length,0)
  await f.enable();f.state.after=async(r,response)=>{if(r.path.endsWith('/session'))f.state.current=false;return response};await assert.rejects(f.client.startVoice('v=0\r\na=offer',crypto.randomUUID(),{expectedRevision:1,mode:'live'}),e=>(e as any).code==='superseded')
})
test('disabled legacy start and recovery omit the A2 field rather than exposing an empty optional object',async t=>{
  const f=await beforeVoiceUIFixture(t),key=crypto.randomUUID(),op=await f.client.startVoice('v=0\r\na=offer',key)
  assert.equal(Object.hasOwn(op,'beforeContext'),false);assert.equal(Object.hasOwn(f.writes()[0].body,'beforeContext'),false)
  assert.equal(Object.hasOwn(await f.client.voiceOperation(key),'beforeContext'),false)
})
