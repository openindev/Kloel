import { request as httpsRequest } from 'node:https';
import { DomainError } from '../domains.js';
import { publicUrl, pinnedAddress, type Address, type SafeResponse, type UrlOptions } from '../ingestion/safe-url.js';

export type RequestSpec={method:string;headers:Record<string,string>;body?:Buffer;signal?:AbortSignal;redirectLimit?:number;onResponse?:(status:number)=>void};
export type IntegrationTransport={resolve?:UrlOptions['resolve'];request?:(url:URL,address:Address,spec:RequestSpec,maxBytes:number,timeoutMs:number)=>Promise<SafeResponse>};
export class DeliveryError extends DomainError {
  constructor(code:string,public readonly outcomeUnknown:boolean){super(502,code,'Não foi possível confirmar a resposta do destino. Consulte o recibo antes de tentar novamente.');}
}
export function integrationUrl(value:string){
  const url=publicUrl(value);
  if(url.protocol!=='https:')throw new DomainError(400,'https_required','Integrações exigem HTTPS público.');
  return url;
}

export function sendPinned(url:URL,address:Address,spec:RequestSpec,maxBytes:number,timeoutMs:number):Promise<SafeResponse>{
  return new Promise((resolve,reject)=>{
    let settled=false;
    const finish=(err?:Error,result?:SafeResponse)=>{if(settled)return;settled=true;clearTimeout(timer);spec.signal?.removeEventListener('abort',abort);err?reject(err):resolve(result!);};
    const request=httpsRequest(url,{method:spec.method,agent:false,headers:{...spec.headers,'accept-encoding':'identity','user-agent':'KloelIntegration/1.0',...(spec.body?{'content-length':String(spec.body.length)}:{})},
      lookup:((_host:string,options:{all?:boolean},callback:(...args:any[])=>void)=>options?.all?callback(null,[address]):callback(null,address.address,address.family)) as any,
    },response=>{
      const status=response.statusCode??502;
      try { spec.onResponse?.(status); } catch (error) { response.destroy();request.destroy();finish(error instanceof Error?error:new Error('response_observation_failed'));return; }
      const headers=Object.fromEntries(Object.entries(response.headers).map(([k,v])=>[k,Array.isArray(v)?v.join(', '):v]));
      if([301,302,303,307,308].includes(status)){response.destroy();finish(undefined,{status,headers,body:Buffer.alloc(0)});return;}
      if(Number(headers['content-length']||0)>maxBytes||(headers['content-encoding']&&headers['content-encoding']!=='identity')){response.destroy();finish(new DeliveryError('response_limit_exceeded',true));return;}
      const parts:Buffer[]=[];let total=0;
      response.on('data',(part:Buffer)=>{total+=part.length;if(total>maxBytes){response.destroy();finish(new DeliveryError('response_limit_exceeded',true));return;}parts.push(part);});
      response.on('end',()=>finish(undefined,{status,headers,body:Buffer.concat(parts)}));
      response.on('aborted',()=>finish(new DeliveryError('response_incomplete',true)));
      response.on('error',()=>finish(new DeliveryError('response_incomplete',true)));
    });
    const abort=()=>{request.destroy();finish(new DeliveryError('integration_aborted',true));};
    const timer=setTimeout(()=>{request.destroy();finish(new DeliveryError('integration_timeout',true));},timeoutMs);
    request.on('error',()=>finish(new DeliveryError('integration_network_failed',true)));
    spec.signal?.addEventListener('abort',abort,{once:true});
    if(spec.signal?.aborted){abort();return;}
    request.end(spec.body);
  });
}

export async function deliver(value:string,spec:RequestSpec,timeoutMs:number,transport:IntegrationTransport={}){
  let url=integrationUrl(value),attempted=false;
  const started=Date.now(),maxBytes=65536,redirectLimit=spec.redirectLimit??3;
  for(let redirects=0;redirects<=redirectLimit;redirects++){
    let timer:ReturnType<typeof setTimeout>|undefined,abort:(()=>void)|undefined;
    try{
      const remaining=timeoutMs-(Date.now()-started);
      if(remaining<=0||spec.signal?.aborted)throw new DeliveryError(spec.signal?.aborted?'integration_aborted':'integration_timeout',attempted);
      const response=await Promise.race([
        (async()=>{
          const address=await pinnedAddress(url,transport.resolve);
          if(Date.now()-started>=timeoutMs||spec.signal?.aborted)throw new DeliveryError(spec.signal?.aborted?'integration_aborted':'integration_timeout',attempted);
          attempted=true;
          return (transport.request??sendPinned)(url,address,spec,maxBytes,Math.max(1,timeoutMs-(Date.now()-started)));
        })(),
        new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new DeliveryError('integration_timeout',attempted)),remaining);abort=()=>reject(new DeliveryError('integration_aborted',attempted));spec.signal?.addEventListener('abort',abort,{once:true});if(spec.signal?.aborted)abort();}),
      ]).finally(()=>{clearTimeout(timer);if(abort)spec.signal?.removeEventListener('abort',abort);});
      if(spec.signal?.aborted)throw new DeliveryError('integration_aborted',attempted);
      if([301,302,303,307,308].includes(response.status)){
        if(redirects===redirectLimit||!response.headers.location)throw new DeliveryError('invalid_redirect',true);
        let next:URL;
        try{next=integrationUrl(new URL(response.headers.location,url).href);}catch{throw new DeliveryError('unsafe_redirect',true);}
        if(next.origin!==url.origin)throw new DeliveryError('cross_origin_redirect_blocked',true);
        if(!['GET','HEAD'].includes(spec.method)&&![307,308].includes(response.status))throw new DeliveryError('redirect_method_change_blocked',true);
        url=next;continue;
      }
      if(response.body.length>maxBytes)throw new DeliveryError('response_limit_exceeded',true);
      return {response,redirects,durationMs:Date.now()-started};
    }catch(e){
      if(e instanceof DeliveryError)throw e;
      throw new DeliveryError(e instanceof DomainError?e.code:'integration_network_failed',attempted);
    }
  }
  throw new DeliveryError('invalid_redirect',attempted);
}
