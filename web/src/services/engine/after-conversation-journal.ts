import { parseExpectedContext } from './http'
import type { ExpectedContext } from './types'
import { afterId, parseAfterOperation, validAfterAttempt, type AfterAttempt, type AfterOperation } from './after-conversation'
type StoragePort = Pick<Storage,'getItem'|'setItem'|'removeItem'>
export type AfterJournalState = { active: AfterAttempt | null; archived: AfterAttempt[] }
const same = (a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b)
function fail():never { throw Error('Não foi possível preservar o acompanhamento nesta aba. Novas solicitações estão bloqueadas.') }
export function createAfterJournal(storage:StoragePort,input:ExpectedContext,kind:AfterAttempt['kind'],entityId:string) {
  const context=parseExpectedContext(input); if(!afterId(entityId)||!context.tenantId)fail(); const key=`kloel-after:${kind}:${context.userId}:${context.tenantId}:${entityId}`
  const valid=(a:unknown):a is AfterAttempt=>validAfterAttempt(a)&&a.kind===kind&&(a.kind==='after.configure'?a.agentId:a.conversationId)===entityId
  function read():AfterJournalState { const text=storage.getItem(key); if(text===null)return {active:null,archived:[]}; let r:any; try{r=JSON.parse(text)}catch{fail()}; if(!r||typeof r!=='object'||Object.keys(r).sort().join(',')!=='context,data,version'||r.version!==1)fail(); if(!same(parseExpectedContext(r.context),context)){storage.removeItem(key);if(storage.getItem(key)!==null)fail();return {active:null,archived:[]}} const d=r.data; if(!d||Object.keys(d).sort().join(',')!=='active,archived'||d.active!==null&&!valid(d.active)||!Array.isArray(d.archived)||d.archived.some((a:unknown)=>!valid(a)))fail();const all=[...d.archived,...(d.active?[d.active]:[])];if(all.length>20||new Set(all.map(a=>a.key)).size!==all.length)fail();return structuredClone(d) }
  function write(data:AfterJournalState,fresh:()=>void){fresh();const text=JSON.stringify({version:1,context,data});storage.setItem(key,text);fresh();if(storage.getItem(key)!==text)fail();fresh();return structuredClone(data)}
  return {key,read,
    reserve(a:AfterAttempt,fresh:()=>void){fresh();const s=read();if(!valid(a)||s.active||s.archived.length>=20||s.archived.some(v=>v.key===a.key))fail();return write({...s,active:a},fresh)},
    resolve(a:AfterAttempt,op:AfterOperation,fresh:()=>void){fresh();parseAfterOperation(op,a,context.tenantId!);const s=read();if(!same(s.active,a))fail();return write({...s,active:null},fresh)},
    archive(a:AfterAttempt,fresh:()=>void){fresh();const s=read();if(!same(s.active,a))fail();return write({active:null,archived:[...s.archived,a]},fresh)},
    forgetConfirmed(a:AfterAttempt,op:AfterOperation,fresh:()=>void){fresh();parseAfterOperation(op,a,context.tenantId!);const s=read();if(!s.archived.some(v=>same(v,a)))fail();return write({...s,archived:s.archived.filter(v=>!same(v,a))},fresh)},
  }
}
