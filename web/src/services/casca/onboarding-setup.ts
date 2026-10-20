import type { Agent } from '@/domain/types'
import { useStore } from '@/data/store'
import { captureEngineContext, engineSession } from '../engine/session'
import { createKnowledgeService } from '../engine/knowledge'
import { agentCommands, saveAgentFields } from './agents'
import { knowledgeCommands } from './knowledge'
import { onboardingCommands, saveOnboardingFields } from './onboarding'

/** A confirmed agent reference survives an interrupted metadata save without creating another agent. */
export async function ensureOnboardingAgent(draft:Agent):Promise<Agent>{
  const context=captureEngineContext('agents:write'),expected=engineSession.getSnapshot().data!.identity.context
  const commands=agentCommands('onboarding'),onboarding=await onboardingCommands().read()
  context.assertCurrent();if(!onboarding.required || onboarding.completed)throw Error('Atualize a configuração inicial antes de continuar.')
  const slot=`kloel-onboarding-agent:${expected.userId}:${expected.tenantId}`,raw=window.sessionStorage.getItem(slot)
  let ref:{agentId:string;context:typeof expected}|null=null
  if(raw){try{ref=JSON.parse(raw)}catch{throw Error('Não foi possível consultar o assistente criado anteriormente.')}
    if(!ref||JSON.stringify(ref.context)!==JSON.stringify(expected)||!/^[a-f0-9-]{36}$/i.test(ref.agentId))throw Error('O assistente criado anteriormente pertence a outra sessão.')}
  const agentId=onboarding.state.agentId ?? ref?.agentId
  let agent=agentId?await commands.read(agentId):await commands.create(draft)
  context.assertCurrent()
  if(!agentId){ref={agentId:agent.id,context:expected};window.sessionStorage.setItem(slot,JSON.stringify(ref));if(window.sessionStorage.getItem(slot)!==JSON.stringify(ref))throw Error('Não foi possível acompanhar o assistente criado.')}
  if(agent.companyInfo!==draft.companyInfo)agent=await saveAgentFields(agent,{companyInfo:draft.companyInfo})
  if(onboarding.state.agentId!==agent.id)await saveOnboardingFields({agentId:agent.id})
  context.assertCurrent();if(ref && window.sessionStorage.getItem(slot)===JSON.stringify(ref))window.sessionStorage.removeItem(slot)
  useStore.getState().mutate(db=>({...db,agents:db.agents.some(row=>row.id===agent.id)?db.agents.map(row=>row.id===agent.id?agent:row):[...db.agents,agent]}))
  const api=createKnowledgeService(context,agent.id),title='Informações do primeiro acesso'
  const first=await api.list(1,title), entries=[...first.items]
  for(let page=2;page<=first.totalPages;page++)entries.push(...(await api.list(page,title)).items)
  const existing=entries.filter(row=>row.type==='text'&&row.title===title)
  context.assertCurrent()
  const matching=existing.find(row=>row.content===draft.companyInfo&&row.indexed)
  if(!matching){
    if(existing.length>1)throw Error('Confira as informações da empresa em Conhecimento antes de concluir a configuração inicial.')
    if(existing[0]?.content===draft.companyInfo)await knowledgeCommands(agent.id,'onboarding-company').consult()
    else if(existing.length)await knowledgeCommands(agent.id,'onboarding-company').update(existing[0].id,title,draft.companyInfo)
    else await knowledgeCommands(agent.id,'onboarding-company').createText(title,draft.companyInfo)
  }
  context.assertCurrent();return agent
}
