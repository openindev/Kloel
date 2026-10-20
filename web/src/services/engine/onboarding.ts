import { EngineError } from './http'
import type { EngineContext } from './session'
import type { ExpectedContext } from './types'

export const onboardingSteps = ['plan','billing','payment','name','sector','size','referral','done','test-call'] as const
export type OnboardingStep = typeof onboardingSteps[number]
export interface OnboardingState { step: OnboardingStep; sector: string | null; size: string | null; referralSource: string | null; agentId: string | null; conversationId: string | null }
export interface OnboardingView { tenantId: string; userId: string; revision: number; required: boolean; completed: boolean; completedAt: string | null; state: OnboardingState }
export interface OnboardingReceipt { operationKey: string; status: 'succeeded'; revision: number; view: OnboardingView }
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v)
const bad = (): never => { throw new EngineError(0,'onboarding_invalid_response','Não foi possível confirmar a configuração inicial. Atualize a página.') }
export function parseOnboardingState(raw: unknown): OnboardingState {
  if (!object(raw) || !onboardingSteps.includes(raw.step) || Object.keys(raw).sort().join(',') !== 'agentId,conversationId,referralSource,sector,size,step') return bad()
  for (const key of ['sector','size','referralSource']) if (raw[key] !== null && (typeof raw[key] !== 'string' || !raw[key].trim() || raw[key] !== raw[key].trim() || raw[key].length > 100 || /[\u0000-\u001f\u007f]/.test(raw[key]))) return bad()
  for (const key of ['agentId','conversationId']) if (raw[key] !== null && !uuid(raw[key])) return bad()
  return { step:raw.step,sector:raw.sector,size:raw.size,referralSource:raw.referralSource,agentId:raw.agentId,conversationId:raw.conversationId }
}
export function parseOnboardingView(raw: unknown, expected: Pick<ExpectedContext,'tenantId'|'userId'>): OnboardingView {
  if (!object(raw) || raw.tenantId !== expected.tenantId || raw.userId !== expected.userId || !Number.isSafeInteger(raw.revision) || raw.revision < 0 || typeof raw.required !== 'boolean' || typeof raw.completed !== 'boolean' || raw.completed && !raw.required || raw.completedAt !== null && (typeof raw.completedAt !== 'string' || !Number.isFinite(Date.parse(raw.completedAt))) || raw.completed !== (raw.completedAt !== null)) return bad()
  const state = parseOnboardingState(raw.state)
  if (raw.completed && (!state.agentId || !['done','test-call'].includes(state.step))) return bad()
  return { tenantId:raw.tenantId,userId:raw.userId,revision:raw.revision,required:raw.required,completed:raw.completed,completedAt:raw.completedAt,state }
}
export function onboardingClient(context: EngineContext, expected: ExpectedContext) {
  function receipt(raw: unknown, operationKey: string): OnboardingReceipt {
    if (!object(raw) || raw.operationKey !== operationKey || raw.status !== 'succeeded') return bad()
    const view = parseOnboardingView(raw.view,expected)
    if (raw.revision !== view.revision) return bad()
    return { operationKey,status:'succeeded',revision:view.revision,view }
  }
  return {
    async read() { context.assertCurrent(); const raw=await context.request('/onboarding/editor-state');context.assertCurrent();return parseOnboardingView(raw,expected) },
    async operation(key: string) { if(!uuid(key))return bad();context.assertCurrent();const raw=await context.request(`/onboarding/editor-state/operations/${key}`);context.assertCurrent();return receipt(raw,key) },
    async write(base: OnboardingView, key: string, state: OnboardingState, intent: 'initialize'|'save'|'complete') {
      context.assertCurrent();parseOnboardingView(base,expected);if(!uuid(key))return bad()
      const raw=await context.request('/onboarding/editor-state',{method:'PUT',body:{expectedTenantId:context.tenantId,expectedRevision:base.revision,idempotencyKey:key,state:parseOnboardingState(state),...(intent==='initialize'?{initialize:true}:intent==='complete'?{complete:true}:{})}})
      context.assertCurrent();return receipt(raw,key)
    },
  }
}
