import test from 'node:test'
import assert from 'node:assert/strict'
import { AgentVoiceSession } from '../src/services/engine/agent-voice'
import type { AgentTestService, VoiceOperation, VoiceStart } from '../src/services/engine/agent-test'
import type { BeforeVoiceMetadata } from '../src/services/engine/before-voice'
import { EngineError } from '../src/services/engine/http'

const key = 'bcc2a59b-f5dd-4ab1-94e8-201b25e9e214', openingId = 'cc203a00-745b-4dd2-bb85-d63b25e1cd81'
const intent = {expectedRevision:1,mode:'live' as const}
const metadata = (mediaStage: BeforeVoiceMetadata['mediaStage'] = 'blocked', patch:Partial<BeforeVoiceMetadata> = {}):BeforeVoiceMetadata => ({openingId,revision:1,mode:'live',surface:'voice_private',barrier:mediaStage === 'conversation' ? 'active':'ready',greetingStatus:mediaStage === 'conversation'?'generation_completed':mediaStage==='greeting'?'requested':'not_requested',reasonCode:null,automaticRetry:false,audioDelivery:'unverified',mediaStage,...patch})
const operation = (stage:BeforeVoiceMetadata['mediaStage']='greeting',patch:Partial<VoiceOperation>={}):VoiceOperation => ({operationKey:key,status:'succeeded',callId:'call_original',conversationId:'conversation_original',cancelRequested:false,hangupStatus:'not_requested',beforeContext:metadata(stage),...patch})
const deferred = <T,>() => { let resolve!:(value:T)=>void,reject!:(cause:unknown)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject} }
async function settle(){for(let i=0;i<30;i++)await Promise.resolve()}
class Peer {
  connectionState='new';iceGatheringState='complete';localDescription?:{sdp:string};closed=0
  ontrack?: (event:any)=>void;onconnectionstatechange?:()=>void
  channel={onmessage:undefined as undefined|((e:{data:string})=>void),close(){}}
  added:boolean[]=[]; remote=0
  addTrack(t:{enabled:boolean}){this.added.push(t.enabled)} addTransceiver(){} addEventListener(){} removeEventListener(){}
  createDataChannel(){return this.channel} async createOffer(){return{type:'offer',sdp:'v=0\r\na=synthetic-offer'}}
  async setLocalDescription(v:{sdp:string}){this.localDescription=v}async setRemoteDescription(){this.remote++}
  async getStats(){return new Map()} close(){this.closed++;this.connectionState='closed';this.onconnectionstatechange?.()}
  connect(){this.connectionState='connected';this.onconnectionstatechange?.()}
  event(type:string){this.channel.onmessage?.({data:JSON.stringify({type})})}
}
function fixture(){
  const peer=new Peer(), track={enabled:true,stopped:0,stop(){this.stopped++}},stream={getTracks:()=>[track],getAudioTracks:()=>[track]} as unknown as MediaStream
  const order:string[]=[],counts={start:0,activate:0,get:0,cancel:0,play:0,stopAudio:0},timers=new Map<number,()=>void>();let current=true
  const api={startVoice:async()=>{counts.start++;order.push('start');assert.equal(track.enabled,false);return{...operation('blocked'),sdp:'v=0\r\na=synthetic-answer',toolsEnabled:[]} as VoiceStart},activateVoice:async()=>{counts.activate++;order.push('activate');return operation()},voiceOperation:async()=>{counts.get++;return operation('conversation')},heartbeatVoice:async()=>operation('greeting'),cancelVoice:async()=>{counts.cancel++;return operation('blocked',{cancelRequested:true,hangupStatus:'accepted'})}} as unknown as AgentTestService
  const deps={peer:()=>peer as unknown as RTCPeerConnection,microphone:async()=>stream,audio:()=>{throw Error('legacy audio must not run')},armAudio:async()=>{counts.play++;order.push('play')},stopAudio:()=>{counts.stopAudio++},assertCurrent:()=>{if(!current)throw Error('authority changed')},change:()=>{},interval:((fn:()=>void,ms:number)=>{timers.set(ms,fn);return ms}) as any,clearInterval:((ms:number)=>timers.delete(ms)) as any,timeout:((fn:()=>void,ms:number)=>{timers.set(ms,fn);return ms}) as any,clearTimeout:((ms:number)=>timers.delete(ms)) as any}
  const session=new AgentVoiceSession(api,deps,key,intent)
  return{peer,track,stream,api,deps,session,counts,order,timers,revoke(){current=false},async connect(){peer.ontrack?.({streams:[stream]});peer.connect();await settle()}}
}
test('A2 disables capture before addTrack and start, arms same-stream playback before one activate, and gates microphone on GET',async()=>{
  const f=fixture();await f.session.start(true);assert.deepEqual(f.peer.added,[false]);assert.equal(f.counts.play,0)
  f.peer.ontrack?.({streams:[f.stream]});await settle();assert.equal(f.counts.activate,0)
  f.peer.connect();await settle();assert.deepEqual(f.order,['start','play','activate']);assert.equal(f.track.enabled,false)
  f.peer.connect();f.peer.event('response.created');await settle();assert.equal(f.counts.activate,1);assert.equal(f.counts.get,0)
  f.peer.event('response.done');await settle();assert.equal(f.counts.get,1);assert.equal(f.track.enabled,true)
  f.session.mute(true);assert.equal(f.track.enabled,false);await f.session.stop()
})
test('A2 autoplay rejection performs no activate; explicit gesture arms playback once and desired mute survives ready',async()=>{
  const f=fixture();f.deps.armAudio=async()=>{f.counts.play++;throw Error('gesture required')};await f.session.start(true);await f.connect()
  assert.equal(f.counts.activate,0);assert.equal(f.session.snapshot().playbackRequired,true);assert.equal(f.track.enabled,false)
  f.deps.armAudio=async()=>{f.counts.play++};f.session.mute(true);await Promise.all([f.session.resumePlayback(),f.session.resumePlayback()]);assert.equal(f.counts.activate,1)
  await f.session.consultPreparation();assert.equal(f.track.enabled,false);f.session.mute(false);assert.equal(f.track.enabled,true);await f.session.stop()
})
test('A2 response.done before second ACK remains greeting; session.updated during GET schedules one bounded follow-up',async()=>{
  const f=fixture(),gate=deferred<VoiceOperation>();let queries=0;f.api.voiceOperation=async()=>{f.counts.get++;return ++queries===1?gate.promise:operation('conversation')}
  await f.session.start(true);await f.connect();f.peer.event('response.done');await settle();assert.equal(f.counts.get,1)
  f.peer.event('session.updated');f.peer.event('session.updated');f.peer.event('response.done');assert.equal(f.counts.get,1)
  gate.resolve(operation('greeting',{beforeContext:metadata('greeting',{barrier:'waiting_session',greetingStatus:'generation_completed'})}));await settle()
  assert.equal(f.counts.get,2);assert.equal(f.counts.activate,1);assert.equal(f.track.enabled,true)
  f.peer.event('session.updated');await settle();assert.equal(f.counts.get,2);await f.session.stop()
})
test('A2 events arriving separately trigger only GET and a stale activation response cannot downgrade a fresher read',async()=>{
  const f=fixture(),activate=deferred<VoiceOperation>();f.api.activateVoice=async()=>{f.counts.activate++;return activate.promise};let stage:'greeting'|'conversation'='greeting';f.api.voiceOperation=async()=>{f.counts.get++;return operation(stage)}
  await f.session.start(true);await f.connect();f.peer.event('response.done');await settle();assert.equal(f.track.enabled,false);assert.equal(f.counts.get,1)
  stage='conversation';f.peer.event('session.updated');await settle();assert.equal(f.track.enabled,true)
  activate.resolve(operation('greeting'));await settle();assert.equal(f.track.enabled,true);assert.equal(f.session.snapshot().beforeContext?.mediaStage,'conversation');await f.session.stop()
})
test('A2 lost activation preserves same player and track disabled; GET404 never retries activation',async()=>{
  const f=fixture();f.api.activateVoice=async()=>{f.counts.activate++;throw new Error('lost response')};f.api.voiceOperation=async()=>{f.counts.get++;throw new EngineError(404,'not_found','Not found')}
  await f.session.start(true);await f.connect();assert.equal(f.counts.play,1);assert.equal(f.counts.stopAudio,0);assert.equal(f.track.enabled,false)
  await f.session.consultPreparation();await f.session.resumePlayback();assert.equal(f.counts.activate,1);assert.equal(f.counts.start,1);assert.equal(f.peer.closed,0)
  f.api.voiceOperation=async()=>operation('conversation');await f.session.consultPreparation();assert.equal(f.track.enabled,true);await f.session.stop()
})
test('A2 late play after authority revocation never activates and releases local media',async()=>{
  const f=fixture(),play=deferred<void>();f.deps.armAudio=()=>play.promise
  await f.session.start(true);await f.connect();f.revoke();play.resolve();await settle();assert.equal(f.counts.activate,0);assert.equal(f.track.stopped,1);assert.equal(f.peer.closed,1)
})
test('A2 blocked or mismatched metadata fails closed and queued GET events cannot revive media',async()=>{
  for(const result of [operation('blocked'),operation('conversation',{beforeContext:metadata('conversation',{openingId:crypto.randomUUID()})})]){
    const f=fixture(),gate=deferred<VoiceOperation>();f.api.voiceOperation=()=>gate.promise;await f.session.start(true);await f.connect()
    f.peer.event('response.done');f.peer.event('session.updated');gate.resolve(result);await settle();assert.equal(f.track.enabled,false);assert.equal(f.track.stopped,1);assert.equal(f.peer.closed,1)
    f.peer.event('response.done');await settle();assert.equal(f.counts.activate,1)
  }
})
test('A2 storage failure before dispatch performs zero POST and closes tracks; permission decline does not reserve',async()=>{
  const f=fixture();let reserve=0;(f.deps as any).beforeStart=()=>{reserve++;throw Error('readback failed')};await f.session.start(true)
  assert.equal(reserve,1);assert.equal(f.counts.start,0);assert.equal(f.counts.cancel,0);assert.equal(f.track.stopped,1)
  const denied=fixture();let calls=0;(denied.deps as any).beforeStart=()=>{calls++};denied.deps.microphone=async()=>{throw Error('Denied')};await denied.session.start(true);assert.equal(calls,0)
})
test('A2 stop while GET is in flight and retained playback/event callbacks cannot reconnect or enable input',async()=>{
  const f=fixture(),gate=deferred<VoiceOperation>();f.api.voiceOperation=()=>gate.promise;await f.session.start(true);await f.connect()
  const read=f.session.consultPreparation();await f.session.stop();gate.resolve(operation('conversation'));await read;await f.session.resumePlayback();f.peer.event('session.updated');await settle()
  assert.equal(f.track.enabled,false);assert.equal(f.counts.activate,1);assert.equal(f.counts.play,1);assert.equal(f.peer.remote,1)
})
test('A2 heartbeat revocation while awaiting playback closes media before any activation',async()=>{
  const f=fixture();f.deps.armAudio=async()=>{throw Error('gesture required')};f.api.heartbeatVoice=async()=>operation('blocked',{beforeContext:metadata('blocked',{barrier:'blocked',reasonCode:'before_context_changed'})})
  await f.session.start(true);await f.connect();assert.equal(f.counts.activate,0);f.timers.get(15000)!();await settle()
  assert.equal(f.track.stopped,1);assert.equal(f.peer.closed,1);await f.session.resumePlayback();assert.equal(f.counts.activate,0)
})
