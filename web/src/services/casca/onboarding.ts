import type { Organization } from '@/domain/types'
import { useStore } from '@/data/store'
import { EngineError } from '../engine/http'
import { captureEngineContext, engineSession, type EngineContext } from '../engine/session'
import type { ExpectedContext } from '../engine/types'
import { onboardingClient, parseOnboardingState, type OnboardingState, type OnboardingView } from '../engine/onboarding'

type StoragePort = Pick<Storage,'getItem'|'setItem'|'removeItem'>
type Intent = 'initialize'|'save'|'complete'
const keyOf = (context: EngineContext, userId: string) => `${context.generation}:${context.tenantId}:${userId}`
const snapshots = new Map<string,OnboardingView>()
const commands = new Map<string,ReturnType<typeof createOnboardingCommands>>()
const same = (a: unknown,b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const fail = (message: string): never => { throw new Error(message) }
const fingerprint = async (value: unknown) => [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(v=>v.toString(16).padStart(2,'0')).join('')

export function onboardingOrganization(view: OnboardingView): Partial<Organization> {
  return { onboardingRequired:view.required,onboardingCompletionConfirmed:view.completed,
    // The shell's legacy boolean means the modal is unnecessary; it is not a backend completion claim.
    onboardingCompleted:!view.required || view.completed,onboardingStep:view.state.step,
    onboardingCompletedAt:view.completedAt ?? undefined,onboardingAgentId:view.state.agentId ?? undefined,onboardingTestConversationId:view.state.conversationId ?? undefined,
    sector:view.state.sector ?? undefined,size:view.state.size ?? undefined,referralSource:view.state.referralSource ?? undefined }
}
export function publishOnboarding(context: EngineContext, view: OnboardingView) {
  context.assertCurrent();const key=keyOf(context,view.userId),current=snapshots.get(key)
  if(current && current.revision>view.revision)return current
  snapshots.set(key,view)
  useStore.getState().mutate(db=>({...db,organizations:db.organizations.map(org=>org.id===view.tenantId?{...org,...onboardingOrganization(view)}:org)}))
  return view
}
export function createOnboardingCommands(context: EngineContext, expected: ExpectedContext, storage: StoragePort, publish:(view:OnboardingView)=>OnboardingView = view=>view) {
  const api=onboardingClient(context,expected),slot=`kloel-onboarding:${expected.userId}:${expected.tenantId}`
  let baseline:OnboardingView|undefined,busy=false,initialization:Promise<OnboardingView>|undefined
  type Ref={key:string;signature:string;context:ExpectedContext}
  function pending():Ref|null { const raw=storage.getItem(slot);if(!raw)return null;let ref:any;try{ref=JSON.parse(raw)}catch{return fail('Não foi possível consultar a configuração anterior.')}if(!ref||Object.keys(ref).sort().join(',')!=='context,key,signature'||!same(ref.context,expected)||!/^[a-f0-9-]{36}$/i.test(ref.key)||!/^[a-f0-9]{64}$/.test(ref.signature))return fail('A configuração anterior pertence a outra sessão.');return ref }
  function accept(view:OnboardingView){context.assertCurrent();baseline=publish(view);return baseline}
  function clear(ref:Ref){context.assertCurrent();if(same(pending(),ref))storage.removeItem(slot)}
  async function recover(ref:Ref){const receipt=await api.operation(ref.key);context.assertCurrent();const latest=await api.read();context.assertCurrent();if(latest.revision<receipt.revision)return fail('A configuração atual ainda não está disponível. Consulte novamente.');const view=accept(latest);clear(ref);return view}
  async function read(){context.assertCurrent();const ref=pending();return ref?recover(ref):accept(await api.read())}
  async function write(state:OnboardingState,intent:Intent){
    context.assertCurrent();if(busy)return fail('Aguarde a configuração atual.');busy=true
    try{
      const desired=parseOnboardingState(state),signature=await fingerprint({state:desired,intent});context.assertCurrent()
      const ref=pending()
      if(ref){const recovered=await recover(ref);if(ref.signature!==signature) return fail('A configuração anterior foi confirmada. Confira a etapa antes de continuar.');return recovered}
      const base=baseline ?? await read()
      if(intent==='initialize' && base.required)return base
      if(intent!=='initialize' && !base.required)return fail('Inicie a configuração da sua conta antes de continuar.')
      const attempt:Ref={key:crypto.randomUUID(),signature,context:expected},serialized=JSON.stringify(attempt)
      context.assertCurrent();storage.setItem(slot,serialized);if(storage.getItem(slot)!==serialized)return fail('Não foi possível acompanhar a configuração.')
      try{const receipt=await api.write(base,attempt.key,desired,intent);const view=accept(receipt.view);clear(attempt);return view}
      catch(error){context.assertCurrent();if(error instanceof EngineError && error.status>=400 && error.status<500){clear(attempt);baseline=undefined;throw error}return await recover(attempt)}
    }finally{busy=false}
  }
  return {read,initialize(){
    if(initialization)return initialization
    initialization=(async()=>{const current=await read();return current.required?current:write(current.state,'initialize')})().finally(()=>{initialization=undefined})
    return initialization
  },save:(state:OnboardingState)=>write(state,'save'),complete:(state:OnboardingState)=>write(state,'complete')}
}
export function onboardingCommands(){
  const context=captureEngineContext(),expected=engineSession.getSnapshot().data!.identity.context,key=keyOf(context,expected.userId)
  let current=commands.get(key)
  if(!current){commands.clear();current=createOnboardingCommands(context,expected,window.sessionStorage,view=>publishOnboarding(context,view));commands.set(key,current)}
  return current
}
export async function readOnboardingProjection(context:EngineContext,expected:ExpectedContext){const view=await onboardingClient(context,expected).read();return publishOnboarding(context,view)}
export function initializeOnboarding(){return onboardingCommands().initialize()}
export async function saveOnboardingFields(patch:Partial<OnboardingState>,complete=false){const commands=onboardingCommands(),current=await commands.read();const next={...current.state,...patch};return complete?commands.complete(next):commands.save(next)}
