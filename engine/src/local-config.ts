import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { closeSync, existsSync, lstatSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync, chmodSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';
import type { Store } from './store.js';
import { assertRequestContext } from './request-context.js';
import { resolveSessionActor } from './memberships/service.js';

export const localConfigKeys = [
  'OPENAI_API_KEY','OPENAI_MODEL','OPENAI_REALTIME_MODEL','OPENAI_WEBHOOK_SECRET','OPENAI_INBOUND_AGENT_ID','OPENAI_SIP_URI',
  'TWILIO_ACCOUNT_SID','TWILIO_AUTH_TOKEN','TWILIO_FROM_NUMBER','TWILIO_VOICE_WEBHOOK_URL','TWILIO_CALLER_ID_WEBHOOK_URL',
  'META_APP_ID','META_ACCESS_TOKEN','META_PHONE_NUMBER_ID','META_WABA_ID','META_GRAPH_VERSION','META_APP_SECRET','META_VERIFY_TOKEN',
  'RESEND_API_KEY','RESEND_FROM','STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','STRIPE_PRICE_IDS','APP_ORIGIN','BILLING_RETURN_URL',
  'CALENDLY_CLIENT_ID','CALENDLY_CLIENT_SECRET','CALENDLY_REDIRECT_URI',
  'GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','MICROSOFT_CLIENT_ID','MICROSOFT_CLIENT_SECRET','MICROSOFT_TENANT_ID','PUBLIC_BASE_URL',
] as const;
const input=z.object({key:z.enum(localConfigKeys),value:z.string().trim().min(1).max(8000).regex(/^[^\r\n\x00"'\\`]+$/)}).strict();
const loopback=(ip:string)=>['127.0.0.1','::1','::ffff:127.0.0.1'].includes(ip);
function localOwner(req:FastifyRequest,store:Store):boolean {
  assertRequestContext(store,req);
  const token=req.cookies?.kloel_session;
  const current=token?resolveSessionActor(store,createHash('sha256').update(token).digest('hex')):undefined;
  if(!current||current.role!=='owner'||current.userId!==req.actor?.userId||current.tenantId!==req.actor?.tenantId||!loopback(req.ip))return false;
  if(process.env.PROVIDER_TENANT_ID&&process.env.PROVIDER_TENANT_ID!==current.tenantId)return false;
  try {
    const host=new URL(`http://${req.headers.host}`);
    if(!['localhost','127.0.0.1','[::1]'].includes(host.hostname))return false;
    // Configuration is only possible from the server's own local UI, not from another allowed frontend.
    return req.headers.origin===host.origin && req.headers['x-kloel-local-config']==='1';
  } catch {return false;}
}

export function persistLocalConfig(file:string,values:Record<string,string>) {
  const target=resolve(file);
  if(existsSync(target)&&(!lstatSync(target).isFile()||lstatSync(target).isSymbolicLink()))throw new Error('Unsafe configuration file');
  const previous=existsSync(target)?readFileSync(target,'utf8'):'';
  const keys=new Set(Object.keys(values));
  const kept=previous.split('\n').filter(line=>!keys.has(line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=/)?.[1]||'')).join('\n').trimEnd();
  const next=kept+'\n'+Object.entries(values).map(([k,v])=>`${k}=${JSON.stringify(v)}`).join('\n')+'\n';
  const temporary=join(dirname(target),`.kloel-config-${randomBytes(12).toString('hex')}`);
  let fd:number|undefined;
  try {fd=openSync(temporary,'wx',0o600);writeFileSync(fd,next);closeSync(fd);fd=undefined;renameSync(temporary,target);chmodSync(target,0o600);}
  finally {if(fd!==undefined)closeSync(fd);if(existsSync(temporary))unlinkSync(temporary);}
  for(const [k,v]of Object.entries(values))process.env[k]=v;
}

export async function registerLocalConfig(app:FastifyInstance, store:Store, file=resolve('.env.local')) {
  app.get('/api/v1/local/config',async(req,reply)=>{
    if(!localOwner(req,store))return reply.code(403).send({error:{code:'local_owner_required',message:'Configuração restrita ao proprietário no painel local.'}});
    return {keys:localConfigKeys.map(key=>({key,configured:Boolean(process.env[key])})),tenantBound:process.env.PROVIDER_TENANT_ID===req.actor.tenantId};
  });
  app.put('/api/v1/local/config',async(req,reply)=>{
    if(!localOwner(req,store))return reply.code(403).send({error:{code:'local_owner_required',message:'Configuração restrita ao proprietário no painel local.'}});
    const {key,value}=input.parse(req.body);
    if(process.env.PROVIDER_TENANT_ID&&process.env.PROVIDER_TENANT_ID!==req.actor.tenantId)return reply.code(409).send({error:{code:'provider_binding_conflict',message:'Credenciais já vinculadas a outra organização.'}});
    persistLocalConfig(file,{[key]:value,PROVIDER_TENANT_ID:req.actor.tenantId});
    return {key,saved:true,tenantBound:true};
  });
}
