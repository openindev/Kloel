import { parseExpectedContext } from './http'
import type { ExpectedContext } from './types'
import { validHttpAttempt, parseHttpOperation, type HttpAttempt, type HttpOperation } from './before-http'
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b)
function fail():never {throw Error('Não foi possível preservar o acompanhamento da fonte nesta aba. Novas gravações estão bloqueadas.')}
export function createBeforeHttpJournal(storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>,input:ExpectedContext,agentId:string){
 const context=parseExpectedContext(input);if(!context.tenantId)fail()
 const key=`kloel-before-http-config:${context.userId}:${context.tenantId}:${context.membershipId}:${context.authorityVersion}:${agentId}`
 type State={active:HttpAttempt|null;rejected:HttpAttempt[]}
 function read():State{const text=storage.getItem(key);if(text===null)return{active:null,rejected:[]};let r:any;try{r=JSON.parse(text)}catch{fail()}
  if(!r||Object.keys(r).sort().join(',')!=='context,data,version'||r.version!==1||!same(parseExpectedContext(r.context),context)||!r.data||Object.keys(r.data).sort().join(',')!=='active,rejected')fail()
  const d=r.data;if(d.active!==null&&(!validHttpAttempt(d.active)||d.active.agentId!==agentId)||!Array.isArray(d.rejected)||d.rejected.length>20||d.rejected.some((a:unknown)=>!validHttpAttempt(a)||(a as HttpAttempt).agentId!==agentId))fail()
  const all=[...d.rejected,...(d.active?[d.active]:[])];if(new Set(all.map(a=>a.key)).size!==all.length)fail();return structuredClone(d)
 }
 function write(state:State,fresh:()=>void){fresh();const text=JSON.stringify({version:1,context,data:state});storage.setItem(key,text);fresh();if(storage.getItem(key)!==text)fail();fresh();return structuredClone(state)}
 return{key,read,
  reserve(a:HttpAttempt,fresh:()=>void){fresh();const state=read();if(!validHttpAttempt(a)||a.agentId!==agentId||state.active||state.rejected.length>=20||state.rejected.some(x=>x.key===a.key))fail();return write({...state,active:a},fresh)},
  resolve(a:HttpAttempt,op:HttpOperation,fresh:()=>void){fresh();parseHttpOperation(op,a,context.tenantId!);const state=read();if(!same(state.active,a))fail();return write({...state,active:null},fresh)},
  rejectVersion(a:HttpAttempt,fresh:()=>void){fresh();const state=read();if(!same(state.active,a)||state.rejected.length>=20)fail();return write({active:null,rejected:[...state.rejected,a]},fresh)},
 }
}
