import test from 'node:test'
import assert from 'node:assert/strict'
import { createConversationIdentityReview } from '../src/services/casca/conversation-identity-review'
import { identityUIFixture } from './engine-identity-review-fixture'
const memory=()=>{const data=new Map<string,string>();return{data,getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value)},removeItem:(key:string)=>{data.delete(key)}}}

test('manual origin review preserves tags/history and never dispatches AI or a message',async t=>{
 const f=await identityUIFixture(t),identity=(await f.identity()).context,storage=memory(),api=createConversationIdentityReview(f.bound,f.conversationId,identity,storage)
 const initial=await api.read(),before=structuredClone(f.current()),messages=structuredClone(f.store.list(f.tenant,'messages')),legacy=structuredClone(f.store.get(f.tenant,'conversations',f.legacy.id))
 assert.equal(initial.state.canReview,true);const result=await api.apply(initial.state)
 assert.equal(result.state.reviewState,'valid');assert.equal(result.state.policy,'manual_only');assert.equal(result.receipt?.status,'applied');assert.equal(api.pending(),false)
 assert.equal(f.writes().length,1);assert.equal(f.calls.length,0);assert.equal(f.store.list(f.tenant,'reply-jobs').length,0)
 assert.equal(f.current().status,before.status);assert.deepEqual(f.current().tags,before.tags);assert.deepEqual(f.store.list(f.tenant,'messages'),messages);assert.deepEqual(f.store.get(f.tenant,'conversations',f.legacy.id),legacy)
})
test('lost response survives remount and consults original receipt then fresh stale context without repeating POST',async t=>{
 const f=await identityUIFixture(t),identity=(await f.identity()).context,storage=memory(),api=createConversationIdentityReview(f.bound,f.conversationId,identity,storage),initial=await api.read()
 f.state.loseAfter=true;await assert.rejects(api.apply(initial.state));assert.equal(api.pending(),true);assert.doesNotMatch([...storage.data.values()].join(''),new RegExp(f.sender));assert.equal(f.writes().length,1)
 f.store.update(f.tenant,'conversations',f.legacy.id,{tags:['human_handoff']})
 const resumed=createConversationIdentityReview(f.bound,f.conversationId,identity,storage),result=await resumed.read()
 assert.equal(result.state.reviewState,'stale');assert.equal(result.receipt?.status,'applied');assert.equal(resumed.pending(),false);assert.equal(f.writes().length,1);assert.equal(f.calls.length,0)
})
test('pre-dispatch loss and GET404 retain reference; apply cannot repost the unknown decision',async t=>{
 const f=await identityUIFixture(t),identity=(await f.identity()).context,storage=memory(),api=createConversationIdentityReview(f.bound,f.conversationId,identity,storage),initial=await api.read()
 f.state.loseBefore=true;await assert.rejects(api.apply(initial.state));const raw=[...storage.data.values()][0]
 await assert.rejects(api.read());await assert.rejects(api.apply(initial.state));assert.equal(f.writes().length,1);assert.equal([...storage.data.values()][0],raw);assert.equal(f.store.list(f.tenant,'whatsapp-identity-reviews').length,0)
})
test('narrow stale CAS clears only a confirmed refusal, while storage and late authority block publication',async t=>{
 const f=await identityUIFixture(t),identity=(await f.identity()).context,storage=memory(),api=createConversationIdentityReview(f.bound,f.conversationId,identity,storage),initial=await api.read()
 await f.control({status:'open'});await f.control({status:'pending'});await assert.rejects(api.apply(initial.state));assert.equal(api.pending(),false);assert.equal(f.store.list(f.tenant,'whatsapp-identity-reviews').length,0)
 const denied=createConversationIdentityReview(f.bound,f.conversationId,identity,{...storage,setItem(){throw Error('quota')}});const current=await denied.read(),writes=f.writes().length
 await assert.rejects(denied.apply(current.state));assert.equal(f.writes().length,writes)
 f.state.after=(_path,_method,response)=>{f.state.current=false;return response};await assert.rejects(api.read());assert.equal(f.calls.length,0)
})
