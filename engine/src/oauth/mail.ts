import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Store } from '../store.js';
import { digest } from './crypto.js';
import { accessTokens, type Actor } from './access.js';
import { authorizedOAuthConnection, authorizedOAuthRequest, requestOAuthGuard } from './authorization.js';
import { OAuthError } from './client.js';

const email=z.string().email().max(254).refine(v=>!/[\r\n]/.test(v));
const schema=z.object({to:z.array(email).min(1).max(50),cc:z.array(email).max(50).default([]),bcc:z.array(email).max(50).default([]),replyTo:email.optional(),subject:z.string().min(1).max(500).refine(v=>!/[\r\n]/.test(v)),text:z.string().min(1).max(100000)}).strict().refine(v=>v.to.length+v.cc.length+v.bcc.length<=50,{message:'Maximum 50 recipients'});
type Input=z.input<typeof schema>;
const collection='oauth-email-operations';

function encodedSubject(value:string){
  const parts:string[]=[];let current='';
  for(const char of value){if(Buffer.byteLength(current+char)>42){parts.push(current);current='';}current+=char;}
  if(current)parts.push(current);
  return parts.map(part=>`=?UTF-8?B?${Buffer.from(part).toString('base64')}?=`).join('\r\n ');
}
export function gmailMessage(sender:string,input:z.output<typeof schema>,id:string){
  const headers=[`From: ${email.parse(sender)}`,`To: ${input.to.join(',\r\n ')}`,`Subject: ${encodedSubject(input.subject)}`,`Date: ${new Date().toUTCString()}`,`Message-ID: <kloel.${id}@${sender.split('@').at(-1)}>`,`MIME-Version: 1.0`,`Content-Type: text/plain; charset=UTF-8`,`Content-Transfer-Encoding: base64`];
  if(input.cc.length)headers.push(`Cc: ${input.cc.join(',\r\n ')}`);
  if(input.bcc.length)headers.push(`Bcc: ${input.bcc.join(',\r\n ')}`);
  if(input.replyTo)headers.push(`Reply-To: ${input.replyTo}`);
  const body=Buffer.from(input.text,'utf8').toString('base64').match(/.{1,76}/g)?.join('\r\n')||'';
  return Buffer.from(headers.join('\r\n')+'\r\n\r\n'+body).toString('base64url');
}

/** Explicit authenticated send only; never invoked by mailbox read/sync or OAuth callback. */
export async function sendMailboxMessage(store:Store,actor:Actor,connectionId:string,input:Input,idempotencyKey:string,assertAccess?:()=>void){
  assertAccess?.();
  const body=schema.parse(input),c=authorizedOAuthConnection(store,actor,connectionId,'email_send');
  if(c.status!=='connected')throw new OAuthError(503,'integration_disconnected','Caixa de e-mail desconectada.');
  if(!Array.isArray(c.capabilities)||!c.capabilities.includes('email_send'))throw new OAuthError(403,'capability_not_authorized','Autorize explicitamente o envio de e-mail.');
  const sender=email.safeParse(c.email);
  if(!sender.success)throw new OAuthError(503,'mailbox_identity_missing','Reconecte uma conta com endereço de e-mail válido.');
  const key=z.string().min(8).max(200).regex(/^[a-zA-Z0-9._:-]+$/).parse(idempotencyKey);
  const keyHash=digest(`${c.id}:${key}`),fingerprint=digest(JSON.stringify(body));
  const previous=store.list(actor.tenantId,collection).find(r=>r.connectionId===c.id&&r.keyHash===keyHash);
  if(previous){
    if(previous.fingerprint!==fingerprint)throw new OAuthError(409,'idempotency_conflict','A chave já foi usada com outro e-mail.');
    if(previous.status==='accepted')return previous.result;
    throw new OAuthError(409,previous.status==='uncertain'?'send_outcome_unknown':'send_in_progress','Envio já iniciado; confira o resultado antes de repetir.');
  }
  // Refresh failures occur before the receipt and cannot be confused with an attempted send.
  await accessTokens(store,c);
  assertAccess?.();
  authorizedOAuthConnection(store,actor,connectionId,'email_send');
  const acquired=store.transaction(()=>{
    assertAccess?.();
    authorizedOAuthConnection(store,actor,connectionId,'email_send');
    const old=store.list(actor.tenantId,collection).find(r=>r.connectionId===c.id&&r.keyHash===keyHash);
    if(old){
      if(old.fingerprint!==fingerprint)throw new OAuthError(409,'idempotency_conflict','A chave já foi usada com outro e-mail.');
      if(old.status==='accepted')return {replay:old.result};
      throw new OAuthError(409,old.status==='uncertain'?'send_outcome_unknown':'send_in_progress','Envio já iniciado; confira o resultado antes de repetir.');
    }
    return {receipt:store.create(actor.tenantId,collection,{connectionId:c.id,userId:actor.userId,keyHash,fingerprint,status:'pending'})};
  });
  if('replay' in acquired)return acquired.replay;
  const receipt=acquired.receipt!;
  let result:Record<string,unknown>|undefined;
  const recordResponse=(response:Record<string,any>)=>{
    if(c.provider==='google'&&typeof response.id!=='string')throw new OAuthError(502,'provider_response_invalid','O provedor não confirmou o identificador da mensagem.');
    result={operationId:receipt.id,provider:c.provider,status:'accepted',messageId:typeof response.id==='string'?response.id:null,delivery:'not_confirmed'};
    store.update(actor.tenantId,collection,receipt.id,{status:'accepted',result,acceptedAt:new Date().toISOString()});
  };
  try{
    if(c.provider==='google'){
      const response=await authorizedOAuthRequest(store,actor,c,'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({raw:gmailMessage(sender.data,body,keyHash)})},false,'email_send',assertAccess,assertAccess?recordResponse:undefined);
      if(!assertAccess)recordResponse(response);
    }else{
      const recipients=(addresses:string[])=>addresses.map(address=>({emailAddress:{address}}));
      const response=await authorizedOAuthRequest(store,actor,c,'https://graph.microsoft.com/v1.0/me/sendMail',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:{subject:body.subject,body:{contentType:'Text',content:body.text},toRecipients:recipients(body.to),ccRecipients:recipients(body.cc),bccRecipients:recipients(body.bcc),...(body.replyTo?{replyTo:recipients([body.replyTo])}:{}),internetMessageHeaders:[{name:'x-kloel-operation',value:receipt.id}]},saveToSentItems:true})},true,'email_send',assertAccess,assertAccess?recordResponse:undefined);
      if(!assertAccess)recordResponse(response);
    }
    assertAccess?.();
    return result;
  }catch(e){if(store.get(actor.tenantId,collection,receipt.id)?.status!=='accepted')store.update(actor.tenantId,collection,receipt.id,{status:'uncertain',errorCode:e instanceof OAuthError?e.code:'unexpected_error'});throw e;}
}
const safe=(fn:(req:FastifyRequest,reply:FastifyReply)=>Promise<unknown>)=>async(req:FastifyRequest,reply:FastifyReply)=>{try{return await fn(req,reply);}catch(e){if(e instanceof OAuthError)return reply.code(e.status).send({error:{code:e.code,message:e.message}});throw e;}};
export async function registerMailboxSendRoutes(app:FastifyInstance,store:Store){
  const id=(req:FastifyRequest)=>z.object({id:z.string().uuid()}).parse(req.params).id;
  app.post('/api/v1/oauth/connections/:id/messages/send',safe(async(req,reply)=>reply.code(202).send(await sendMailboxMessage(store,req.actor,id(req),req.body as Input,z.string().parse(req.headers['idempotency-key']),requestOAuthGuard(store,req)))));
  app.get('/api/v1/oauth/connections/:id/mail-operations',safe(async req=>{
    requestOAuthGuard(store,req)();
    const c=authorizedOAuthConnection(store,req.actor,id(req));
    return {items:store.list(req.actor.tenantId,collection).filter(r=>r.connectionId===c.id).map(r=>({id:r.id,status:r.status,result:r.result,errorCode:r.errorCode,createdAt:r.createdAt,updatedAt:r.updatedAt}))};
  }));
}
