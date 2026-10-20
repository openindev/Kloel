import { EngineError } from '../engine/http'
import type { EngineContext } from '../engine/session'
import { createIdentityReviewJournal, createIdentityReviewService, identityReviewError, type IdentityReviewContext, type IdentityReviewOperation, type IdentityReviewReference } from '../engine/whatsapp-identity-review'

type Identity = { userId:string; tenantId:string; membershipId:string; authorityVersion:string }
type StoragePort = Pick<Storage,'getItem'|'setItem'|'removeItem'>
export type ConversationIdentityReview = { state:IdentityReviewContext; receipt?:IdentityReviewOperation }

/** A manual-only decision preserves the conversation controls and never dispatches a reply. */
export function createConversationIdentityReview(context:EngineContext,conversationId:string,identity:Identity,storage:StoragePort){
  const api=createIdentityReviewService(context,conversationId),journal=createIdentityReviewJournal(()=>storage,{...identity,conversationId})
  let busy=false,reading:Promise<ConversationIdentityReview>|undefined,lastReceipt:IdentityReviewOperation|undefined
  async function recover(ref:IdentityReviewReference):Promise<ConversationIdentityReview>{
    const receipt=await api.operation(ref)
    // The receipt is historical; only a fresh context says whether the review is still valid.
    const state=await api.context();context.assertCurrent()
    journal.clearResolved(ref);lastReceipt=receipt
    return {state,receipt}
  }
  async function read(){
    context.assertCurrent()
    const ref=journal.read()
    if(ref)return recover(ref)
    const state=await api.context();context.assertCurrent();return {state,receipt:lastReceipt}
  }
  return {
    pending(){context.assertCurrent();return !!journal.read()},
    read(){
      if(reading)return reading
      if(busy)return Promise.reject(Error('Aguarde a confirmação atual.'))
      reading=read().catch(error=>{throw Error(identityReviewError(error))}).finally(()=>{reading=undefined})
      return reading
    },
    async apply(state:IdentityReviewContext):Promise<ConversationIdentityReview>{
      context.assertCurrent();if(busy||reading)throw Error('Aguarde a confirmação atual.');busy=true
      try{
        const previous=journal.read();if(previous)return await recover(previous)
        if(state.tenantId!==context.tenantId||state.conversationId!==conversationId||!state.canReview||!state.collisions.complete||!state.windowExpiresAt||Date.parse(state.windowExpiresAt)<=Date.now())throw Error('Atualize a origem antes de confirmar a revisão.')
        const ref={key:crypto.randomUUID(),expectedVersion:state.version};journal.remember(ref)
        try{await api.apply(ref)}
        catch(error){
          context.assertCurrent()
          if(error instanceof EngineError&&error.status===409&&error.code==='whatsapp_identity_review_not_admitted')journal.clearResolved(ref)
          throw error
        }
        return await recover(ref)
      }catch(error){context.assertCurrent();throw Error(identityReviewError(error))}
      finally{busy=false}
    },
  }
}
