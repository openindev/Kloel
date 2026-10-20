import type { Store } from '../store.js';
import { z } from 'zod';
import { BookingError } from './authority.js';
import { PublicBookingService } from './service.js';
import { bookingActions, resolveAction, type Audience } from './assistant-authority.js';
import { assistantSlots, collectedAnswers, customFieldGaps } from './assistant-booking.js';
import { eventTypeConfigFromRecord, type EventTypeConfig } from '../scheduling/service.js';
import { publicBookingBaseUrl } from './origin.js';

import { bookingToolActive, bookingToolSettings } from './tool-settings.js';
export type BookingTurn={audience:Audience;agentId:string;conversationId:string;operationId:string;operationKey:string;assertBase:()=>void;guards:Set<()=>void>;assertResults:()=>void};
export function createBookingTurn(input:Omit<BookingTurn,'guards'|'assertResults'>):BookingTurn{const guards=new Set<()=>void>();return{...input,guards,assertResults:()=>{for(const guard of guards)guard();}};}
export function managedBookingMode(store: Store, turn: BookingTurn | undefined, privateChat?: { tenantId: string; agentId: string }) {
  // Route-derived fallback is restrictive only: it does not authorize booking tools.
  const scope = turn ? { tenantId: turn.audience.tenantId, agentId: turn.agentId, kind: turn.audience.kind, channelId: turn.audience.kind === 'webchat' ? turn.audience.channelId : undefined } : privateChat && { ...privateChat, kind: 'private' as const, channelId: undefined };
  return !!scope && store.list(scope.tenantId, bookingActions).some(action => action.agentId === scope.agentId && action.enabled === true && action.audience === scope.kind && (scope.kind === 'private' || action.channelId === scope.channelId));
}
export const bookingMutators=new Set(['create_appointment','external_create_appointment']);
export function bookingAgentTools(store:Store,turn:BookingTurn|undefined){
  if(!turn)return[];const actions=store.list(turn.audience.tenantId,bookingActions).filter(a=>a.agentId===turn.agentId&&a.enabled===true).flatMap(a=>{try{const t=resolveAction(store,turn.audience,a.id,turn.conversationId,Date.now()),settings=bookingToolSettings(store,turn.audience.tenantId,turn.agentId,String(a.eventTypeId));return bookingToolActive(settings)?[{...t,settings,fields:eventTypeConfigFromRecord(t.page!).customFields}]:[];}catch{return[];}});
  if(!actions.length)return[];
  const tool=(name:string,description:string,properties:Record<string,unknown>)=>({type:'function' as const,name,description,strict:true,parameters:{type:'object',properties,required:Object.keys(properties),additionalProperties:false}});
  const when=(t:typeof actions[number])=>[t.settings.name&&t.settings.name!=='New scheduler integration'?`Ferramenta "${t.settings.name}".`:'',t.settings.description?`Use quando: ${t.settings.description}.`:''].filter(Boolean).join(' ');
  // Campos personalizados do tipo de evento: o modelo pergunta na conversa e envia em answers (null = ainda sem resposta).
  const label=(f:EventTypeConfig['customFields'][number])=>`${f.label.slice(0,120)}${f.required?' (obrigatório)':''}`;
  const ask=(t:typeof actions[number])=>t.fields.length?` Antes de consultar, pergunte na conversa e envie em answers: ${t.fields.map(label).join(', ')}.`:'';
  const answers=(t:typeof actions[number])=>t.fields.length?{answers:{type:'object',description:'Respostas que a pessoa deu na conversa; null quando ainda não respondeu.',properties:Object.fromEntries(t.fields.map(f=>[`c_${f.id}`,{type:['string','null'],description:`${label(f)}${f.type==='email'?'; e-mail':f.type==='phone'?'; telefone com DDD':''}`}])),required:t.fields.map(f=>`c_${f.id}`),additionalProperties:false}}:{};
  return[tool('booking_event_types','Tipos de reserva gerenciada autorizados. Criar exige confirmação explícita no cartão; nunca afirme reserva por uma consulta.',{}),
    ...actions.map(t=>tool(`booking_slots_${t.action.id.replaceAll('-','')}`,`${when(t)} Horários reais de ${String(t.page!.name).slice(0,160)}. ${String(t.page!.timezone)}. Consulta gera cartão para a pessoa escolher e confirmar; não cria reserva.${ask(t)}`.trim(),{from:{type:'string',description:'RFC3339 com offset, data explícita'},to:{type:'string',description:'RFC3339, no máximo 7 dias após from'},...answers(t)})),
    ...actions.filter(t=>t.settings.allowBookingLinks&&t.page!.publicOrgSlug).map(t=>tool(`booking_link_${t.action.id.replaceAll('-','')}`,`Link da página de reserva de ${String(t.page!.name).slice(0,160)}. Use somente se a consulta ou a reserva falhar ou se a pessoa preferir agendar sozinha.`,{}))];
}
export async function executeBookingAgentTool(store:Store,turn:BookingTurn,call:{name:string;arguments:string}){
  turn.assertBase();
  if(call.name==='booking_event_types'){
    z.object({}).strict().parse(JSON.parse(call.arguments));
    const items=store.list(turn.audience.tenantId,bookingActions).filter(a=>a.agentId===turn.agentId).flatMap(a=>{try{const t=resolveAction(store,turn.audience,a.id,turn.conversationId,Date.now());turn.guards.add(t.check);return[{actionId:a.id,name:t.page!.name,timezone:t.page!.timezone,durationMinutes:t.page!.durationMinutes,creationRequiresCard:true}];}catch{return[];}});
    turn.assertBase();return{ok:true,eventTypes:items};
  }
  const link=/^booking_link_([a-f0-9]{32})$/.exec(call.name);
  if(link){
    const a=store.list(turn.audience.tenantId,bookingActions).find(a=>a.agentId===turn.agentId&&a.id.replaceAll('-','')===link[1]);
    if(!a)return{ok:false,error:'tool_not_enabled'};
    try{
      const t=resolveAction(store,turn.audience,a.id,turn.conversationId,Date.now()),settings=bookingToolSettings(store,turn.audience.tenantId,turn.agentId,String(a.eventTypeId));
      if(!settings.allowBookingLinks||!bookingToolActive(settings)||!t.page!.publicOrgSlug)return{ok:false,error:'tool_not_enabled'};
      turn.guards.add(t.check);turn.assertBase();
      return{ok:true,kind:'booking.link',title:String(t.page!.name),url:`${publicBookingBaseUrl()}/c/${String(t.page!.publicOrgSlug)}/${String(t.page!.slug)}`,instruction:'Envie este link para a pessoa escolher um horário. O link não confirma reserva.'};
    }catch(e){turn.assertBase();return{ok:false,error:e instanceof BookingError?e.code:'booking_link_unavailable',automaticRetry:false};}
  }
  const match=/^booking_slots_([a-f0-9]{32})$/.exec(call.name),a=match&&store.list(turn.audience.tenantId,bookingActions).find(a=>a.agentId===turn.agentId&&a.id.replaceAll('-','')===match[1]);
  if(!a)return{ok:false,error:'tool_not_enabled'};
  if(!bookingToolActive(bookingToolSettings(store,turn.audience.tenantId,turn.agentId,String(a.eventTypeId))))return{ok:false,error:'tool_outside_active_window'};
  try{
    const target=resolveAction(store,turn.audience,a.id,turn.conversationId,Date.now());turn.guards.add(target.check);
    const{answers:given={},...range}=z.object({from:z.string().datetime({offset:true}),to:z.string().datetime({offset:true}),answers:z.record(z.string().max(500).nullable()).optional()}).strict().parse(JSON.parse(call.arguments));
    // Sem as respostas obrigatórias o cartão não teria como confirmar: o modelo recebe os rótulos para perguntar.
    const answers={...collectedAnswers(store,turn.audience,turn.conversationId,a.id),...Object.fromEntries(Object.entries(given).filter(([,v])=>v?.trim()))},gaps=customFieldGaps(eventTypeConfigFromRecord(target.page!),answers);
    if(gaps.missing.length||gaps.invalid.length){turn.assertBase();return{ok:false,error:gaps.missing.length?'booking_form_required':'booking_form_invalid',missingFields:gaps.missing,invalidFields:gaps.invalid,instruction:`Antes de mostrar horários, peça à pessoa: ${[...gaps.missing,...gaps.invalid].join(', ')}. Depois consulte de novo com as respostas em answers.`,automaticRetry:false};}
    const choice=await assistantSlots(new PublicBookingService(store),turn.audience,turn.conversationId,{actionId:a.id,expectedRevision:a.revision,...range},{id:turn.operationId,key:turn.operationKey},answers);turn.assertBase();
    // Quotes and visitor form never enter model input or generic tool journals.
    return{ok:true,kind:'booking.slots',choiceId:choice.choiceId,title:choice.title,timezone:choice.timezone,slots:choice.slots.map(s=>({startAt:s.startAt,endAt:s.endAt})),complete:choice.complete,nextFrom:choice.nextFrom,confirmation:'A pessoa precisa escolher e confirmar no cartão. Consulta não é reserva.'};
  }catch(e){turn.assertBase();return{ok:false,error:e instanceof BookingError?e.code:'booking_slots_unavailable',automaticRetry:false};}
}
