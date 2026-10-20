import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Entity, Store } from './store.js';
import { digest, encryptionKey, seal, unseal } from './oauth/crypto.js';
import { configuration, exchange, identity, OAuthError, scopesFor, type Provider, type Capability } from './oauth/client.js';
import { tokenContext, privileged, accessible, scopedConnection, oauthAuthorizationGeneration, updateOAuthAuthorization } from './oauth/access.js';
import { authorizedOAuthActor, authorizedOAuthConnection, authorizedOAuthRequest } from './oauth/authorization.js';
import { assertAddressKept, keptCapabilities, reauthorizationTarget, reauthorizeConnection } from './oauth/reauthorization.js';
import { resolveSessionActor } from './memberships/service.js';
import { assertRequestContext } from './request-context.js';
import { hasPermission } from './memberships/permissions.js';
import { registerCalendarRoutes } from './oauth/calendar.js';
import { registerMailboxSendRoutes } from './oauth/mail.js';
import { registerSheetsRoutes } from './oauth/sheets.js';
export { readCalendarAvailability, createCalendarEvent, updateCalendarEvent, cancelCalendarEvent } from './oauth/calendar.js';

const providers = ['google','microsoft'] as const;
const providerParams = z.object({provider:z.enum(providers)});
const connectionParams = z.object({id:z.string().uuid()});
const startSchema = z.object({capabilities:z.array(z.enum(['calendar','calendar_write','email','email_send','sheets_read','sheets_append'])).min(1).max(6).transform(v=>[...new Set([...v,...(v.includes('calendar_write')?['calendar' as const]:[]),...(v.includes('sheets_append')?['sheets_read' as const]:[])])]),visibility:z.enum(['personal','shared']).default('personal'),/** "Reconectar caixa": the connection being re-authorized; the callback only completes with that same account. */connectionId:z.string().uuid().optional()}).strict();
const states = 'oauth-states';
const connections = 'oauth-connections';
type Actor = FastifyRequest['actor'];
/** `owned`: whether the requesting user authorized it (only that person can re-authorize it); other owners stay undisclosed. */
const publicConnection = (c: Entity, userId: string) => ({id:c.id,provider:c.provider,email:c.email,displayName:c.displayName,visibility:c.visibility,capabilities:c.capabilities,status:c.status,authorizationGeneration:oauthAuthorizationGeneration(c),owned:c.userId===userId,createdAt:c.createdAt,updatedAt:c.updatedAt});
/** `page`: the provider callback runs in the connect window; a browser navigation gets its outcome as a readable page. API clients keep JSON. */
const safe = (handler: (req: FastifyRequest, reply: FastifyReply)=>Promise<unknown>, page=false) => async(req: FastifyRequest, reply: FastifyReply)=>{
  const html=page&&/\btext\/html\b/i.test(String(req.headers.accept??''));
  try{const result=await handler(req,reply);return html?outcomePage(reply,200,'Conta conectada','A conexão foi concluída. Volte para a Kloel.'):result;}
  catch(e){if(e instanceof OAuthError)return html?outcomePage(reply,e.status,'A conexão não foi concluída',e.message):reply.code(e.status).send({error:{code:e.code,message:e.message}});throw e;}
};
const escapeHtml=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]!);
function outcomePage(reply:FastifyReply,status:number,title:string,message:string){
  return reply.code(status).header('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'").header('Referrer-Policy','no-referrer').header('Cache-Control','no-store').header('X-Content-Type-Options','nosniff').type('text/html; charset=utf-8')
    .send(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head><body style="font:16px/1.5 system-ui,sans-serif;max-width:36rem;margin:2rem auto;padding:0 1rem"><h1 style="font-size:1.25rem">${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><p style="color:#555">Você pode fechar esta janela.</p></body></html>`);
}
function key() {try{return encryptionKey();}catch{throw new OAuthError(503,'oauth_storage_unavailable','Chave de proteção OAuth não configurada.');}}

export async function registerOAuth(app: FastifyInstance, store: Store): Promise<void> {
  const guarded = (handler: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>) => safe(async (req, reply) => {
    assertRequestContext(store, req);
    const result = await handler(req, reply);
    assertRequestContext(store, req);
    return result;
  });
  const connection = (req: FastifyRequest) => {
    assertRequestContext(store, req);
    const {id}=connectionParams.parse(req.params);
    return authorizedOAuthConnection(store,req.actor,id);
  };
  const read = async(req:FastifyRequest,c:Entity,url:string,capability:string) => {
    return authorizedOAuthRequest(store,req.actor,c,url,{},false,capability,()=>assertRequestContext(store,req));
  };

  app.get('/api/v1/oauth/status',guarded(async(req)=>({providers:providers.map(provider=>{
    let configured=true;try{configuration(provider);key();}catch{configured=false;}
    const count=store.list(req.actor.tenantId,connections).filter(c=>c.provider===provider&&accessible(req.actor,c)&&c.status==='connected').length;
    return {provider,configured,connectedAccounts:count,status:!configured?'not_configured':count?'connected':'disconnected',liveValidated:false};
  })})));
  app.get('/api/v1/oauth/connections',guarded(async(req)=>({items:store.list(req.actor.tenantId,connections).filter(c=>accessible(req.actor,c)).map(c=>publicConnection(c,req.actor.userId))})));

  app.post('/api/v1/oauth/:provider/start',guarded(async(req)=>{
    req.actor=authorizedOAuthActor(store,req.actor);
    const {provider}=providerParams.parse(req.params);
    const input=startSchema.parse(req.body);
    // Re-authorization of one connection: same owner, provider and visibility; every feature it has is asked again.
    const target=input.connectionId?reauthorizationTarget(store,req.actor,provider,input.visibility,input.connectionId):undefined;
    const capabilities=target?[...new Set([...input.capabilities,...(target.capabilities as Capability[])])]:input.capabilities;
    if(provider!=='google'&&capabilities.some(c=>c.startsWith('sheets_')))throw new OAuthError(400,'unsupported_capability','Google Sheets exige conexão Google.');
    if(input.visibility==='shared'&&!privileged(req.actor))throw new OAuthError(403,'forbidden','Somente administradores podem conectar contas compartilhadas.');
    const config=configuration(provider),storageKey=key();
    const verifier=randomBytes(32).toString('base64url');
    const challenge=createHash('sha256').update(verifier).digest('base64url');
    const nonce=randomBytes(32).toString('base64url');
    const scopes=scopesFor(provider,capabilities);
    const state=store.transaction(()=>{
      assertRequestContext(store,req);
      req.actor=authorizedOAuthActor(store,req.actor);
      for(const old of store.list(req.actor.tenantId,states))if(Number(old.expiresAt)<Date.now())store.remove(req.actor.tenantId,states,old.id);
      const pending=store.list(req.actor.tenantId,states).filter(s=>s.userId===req.actor.userId);
      if(pending.length>=10)throw new OAuthError(429,'oauth_pending_limit','Há muitas autorizações pendentes. Aguarde alguns minutos.');
      const row=store.create(req.actor.tenantId,states,{provider,userId:req.actor.userId,visibility:input.visibility,capabilities,...(target?{reauthorize:target.id}:{}),scopes:scopes.join(' '),sessionHash:digest(req.cookies.kloel_session||''),nonceHash:digest(nonce),expiresAt:Date.now()+10*60_000});
      store.update(req.actor.tenantId,states,row.id,{verifier:seal(verifier,`${row.tenantId}:${row.id}:verifier`,storageKey)});
      return seal({tenantId:row.tenantId,id:row.id,nonce},`oauth-state:${provider}`,storageKey);
    });
    const url=new URL(config.authorizeUrl);
    const params:Record<string,string>={client_id:config.clientId,redirect_uri:config.redirectUri,response_type:'code',scope:scopes.join(' '),state,code_challenge:challenge,code_challenge_method:'S256'};
    if(provider==='google'){params.access_type='offline';params.prompt='consent';params.include_granted_scopes='true';}else params.response_mode='query';
    if(target&&typeof target.email==='string')params.login_hint=target.email;
    for(const [k,v] of Object.entries(params))url.searchParams.set(k,v);
    return {authorizationUrl:url.toString(),expiresIn:600,...(capabilities.some(c=>c.startsWith('sheets_'))?{scopeNotice:{service:'Google Sheets',providerScope:'all_google_spreadsheets',access:capabilities.includes('sheets_append')?'read_write':'read_only',localRestriction:'configured_spreadsheet_ids_only',driveListing:false}}:{})};
  }));

  for(const provider of providers)app.get(`/api/v1/oauth/${provider}/callback`,safe(async(req)=>{
    const query=z.object({state:z.string().min(1).max(4096),code:z.string().min(1).max(8192).optional(),error:z.string().max(300).optional()}).parse(req.query);
    const storageKey=key();
    let decoded:{tenantId:string;id:string;nonce:string};
    try{decoded=z.object({tenantId:z.string().uuid(),id:z.string().uuid(),nonce:z.string()}).parse(unseal(query.state,`oauth-state:${provider}`,storageKey));}
    catch{throw new OAuthError(400,'oauth_state_invalid','Autorização inválida ou expirada.');}
    const state=store.transaction(()=>{
      const s=store.get(decoded.tenantId,states,decoded.id);
      if(!s||s.provider!==provider||s.nonceHash!==digest(decoded.nonce))throw new OAuthError(400,'oauth_state_invalid','Autorização inválida ou já utilizada.');
      if(Number(s.expiresAt)<Date.now())throw new OAuthError(400,'oauth_state_expired','Autorização expirada. Inicie novamente.');
      const sessionHash=digest(req.cookies.kloel_session||'');
      const session=resolveSessionActor(store,sessionHash);
      if(sessionHash!==s.sessionHash||!session||session.userId!==s.userId||session.tenantId!==s.tenantId)throw new OAuthError(403,'oauth_session_mismatch','Continue na mesma sessão que iniciou a conexão.');
      if(!hasPermission(session.role,'integrations:execute')||(s.visibility==='shared'&&!privileged(session)))throw new OAuthError(403,'forbidden','A permissão para conectar a conta foi removida.');
      store.remove(decoded.tenantId,states,decoded.id);
      return s;
    });
    if(query.error)throw new OAuthError(400,'oauth_consent_denied','O provedor não autorizou a conexão.');
    if(!query.code)throw new OAuthError(400,'oauth_code_missing','Código de autorização ausente.');
    const config=configuration(provider);
    const verifier=unseal<string>(String(state.verifier),`${state.tenantId}:${state.id}:verifier`,storageKey);
    const granted=await exchange(provider,{grant_type:'authorization_code',code:query.code,redirect_uri:config.redirectUri,code_verifier:verifier},String(state.scopes).split(' '));
    const needed=scopesFor(provider,state.capabilities as Capability[]).filter(s=>!['openid','email','offline_access'].includes(s));
    const actual=new Set(granted.scope.split(' ').map(s=>s.replace('https://graph.microsoft.com/','').toLowerCase()));
    if(needed.some(s=>!actual.has(s.toLowerCase())))throw new OAuthError(403,'oauth_scope_missing','As permissões solicitadas não foram concedidas.');
    const remote=await identity(provider,granted.accessToken);
    const c=store.transaction(()=>{
      const session=resolveSessionActor(store,digest(req.cookies.kloel_session||''));
      if(!session||session.userId!==state.userId||session.tenantId!==state.tenantId)throw new OAuthError(403,'oauth_session_mismatch','A sessão ou o vínculo mudou durante a autorização.');
      if(!hasPermission(session.role,'integrations:execute')||(state.visibility==='shared'&&!privileged(session)))throw new OAuthError(403,'forbidden','A permissão para conectar a conta foi removida.');
      // "Reconectar caixa": only the account of that connection completes it. Another account (browser session) writes nothing.
      const target=typeof state.reauthorize==='string'?store.get(state.tenantId,connections,state.reauthorize):undefined;
      if(state.reauthorize!==undefined&&(!target||target.status!=='connected'||target.provider!==provider||target.userId!==state.userId||target.visibility!==state.visibility))throw new OAuthError(409,'oauth_connection_changed','A conexão desta conta mudou durante a autorização. Nada foi alterado.');
      if(target&&target.remoteId!==remote.remoteId)throw new OAuthError(409,'oauth_reauthorization_account_mismatch',`Você autorizou outra conta${remote.email?` (${remote.email})`:''}. Nada foi alterado: para reconectar, escolha ${target.email}.`);
      const existing=target??store.list(state.tenantId,connections).find(c=>c.provider===provider&&c.remoteId===remote.remoteId&&c.userId===state.userId&&c.visibility===state.visibility);
      // Same account, another primary address (renamed at the provider): what depends on the old address would stop. Refused, nothing written.
      if(existing)assertAddressKept(store,existing,provider,remote.email);
      // A connected account never loses a feature the new token still covers because a dialog left it unticked.
      const data={provider,...remote,userId:state.userId,visibility:state.visibility,capabilities:existing?keptCapabilities(provider,existing,state.capabilities as Capability[],actual):state.capabilities,scopes:granted.scope,status:'connected'};
      // Same connected account, no feature dropped (ex.: "Reconectar caixa" adding gmail.modify): booking pages (also through the assistant), email automation and sheet actions keep working.
      const row=existing?reauthorizeConnection(store,existing,data):store.create(state.tenantId,connections,{...data,authorizationGeneration:1});
      return store.update(state.tenantId,connections,row.id,{encryptedTokens:seal(granted,tokenContext(row),storageKey)})!;
    });
    return {connection:publicConnection(c,String(state.userId)),providerVerified:true};
  },true));

  app.delete('/api/v1/oauth/connections/:id',guarded(async(req)=>{
    assertRequestContext(store,req);
    const actor=authorizedOAuthActor(store,req.actor),c=scopedConnection(store,actor,connectionParams.parse(req.params).id);
    const revoked=store.transaction(()=>{
      assertRequestContext(store,req);
      const fresh=authorizedOAuthActor(store,req.actor),current=scopedConnection(store,fresh,c.id);
      return updateOAuthAuthorization(store,current,{status:'disconnected',encryptedTokens:null});
    });
    return {id:c.id,status:'disconnected',authorizationGeneration:oauthAuthorizationGeneration(revoked),revokedAtProvider:false};
  }));
  app.get('/api/v1/oauth/connections/:id/calendars',guarded(async(req)=>{
    const c=connection(req);
    if(!(c.capabilities as string[]).includes('calendar'))throw new OAuthError(403,'capability_not_authorized','Autorize acesso à agenda.');
    const query=z.object({pageToken:z.string().max(8192).optional()}).parse(req.query);
    const url=c.provider==='google'?new URL('https://www.googleapis.com/calendar/v3/users/me/calendarList'):new URL('https://graph.microsoft.com/v1.0/me/calendars');
    url.searchParams.set(c.provider==='google'?'maxResults':'$top','100');
    if(query.pageToken)applyPageToken(url,c.provider as Provider,query.pageToken);
    const data=await read(req,c,url.toString(),'calendar');
    return {items:c.provider==='google'?(data.items||[]):(data.value||[]),nextPageToken:pageToken(c.provider as Provider,data),source:c.provider};
  }));
  app.get('/api/v1/oauth/connections/:id/events',guarded(async(req)=>{
    const c=connection(req);
    if(!(c.capabilities as string[]).includes('calendar'))throw new OAuthError(403,'capability_not_authorized','Autorize acesso à agenda.');
    const q=z.object({calendarId:z.string().min(1).max(500).default('primary'),from:z.string().datetime({offset:true}),to:z.string().datetime({offset:true}),pageToken:z.string().max(8192).optional()}).parse(req.query);
    if(Date.parse(q.to)<=Date.parse(q.from)||Date.parse(q.to)-Date.parse(q.from)>93*86400000)throw new OAuthError(400,'invalid_time_range','Use um intervalo positivo de até 93 dias.');
    const path=c.provider==='google'?`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(q.calendarId)}/events`:`https://graph.microsoft.com/v1.0/me/${q.calendarId==='primary'?'calendar':`calendars/${encodeURIComponent(q.calendarId)}`}/calendarView`;
    const url=new URL(path);
    if(c.provider==='google'){url.searchParams.set('timeMin',q.from);url.searchParams.set('timeMax',q.to);url.searchParams.set('singleEvents','true');url.searchParams.set('maxResults','100');url.searchParams.set('orderBy','startTime');}
    else{url.searchParams.set('startDateTime',q.from);url.searchParams.set('endDateTime',q.to);url.searchParams.set('$top','100');}
    if(q.pageToken)applyPageToken(url,c.provider as Provider,q.pageToken);
    const data=await read(req,c,url.toString(),'calendar');
    return {items:c.provider==='google'?(data.items||[]):(data.value||[]),nextPageToken:pageToken(c.provider as Provider,data),source:c.provider};
  }));
  app.get('/api/v1/oauth/connections/:id/messages',guarded(async(req)=>{
    const c=connection(req);
    if(!(c.capabilities as string[]).includes('email'))throw new OAuthError(403,'capability_not_authorized','Autorize acesso ao e-mail.');
    const q=z.object({folder:z.enum(['inbox','sent']).default('inbox'),limit:z.coerce.number().int().min(1).max(50).default(20),pageToken:z.string().max(8192).optional()}).parse(req.query);
    const url=new URL(c.provider==='google'?'https://gmail.googleapis.com/gmail/v1/users/me/messages':`https://graph.microsoft.com/v1.0/me/mailFolders/${q.folder==='inbox'?'inbox':'sentitems'}/messages`);
    if(c.provider==='google'){url.searchParams.set('maxResults',String(q.limit));url.searchParams.set('labelIds',q.folder==='inbox'?'INBOX':'SENT');}
    else{url.searchParams.set('$top',String(q.limit));url.searchParams.set('$select','id,conversationId,subject,from,toRecipients,receivedDateTime,sentDateTime,isRead,bodyPreview');url.searchParams.set('$orderby','receivedDateTime desc');}
    if(q.pageToken)applyPageToken(url,c.provider as Provider,q.pageToken);
    const data=await read(req,c,url.toString(),'email');
    return {items:c.provider==='google'?(data.messages||[]):(data.value||[]),nextPageToken:pageToken(c.provider as Provider,data,'$skip'),source:c.provider};
  }));
  app.get('/api/v1/oauth/connections/:id/messages/:messageId',guarded(async(req)=>{
    const c=connection(req);
    if(!(c.capabilities as string[]).includes('email'))throw new OAuthError(403,'capability_not_authorized','Autorize acesso ao e-mail.');
    const {messageId}=z.object({messageId:z.string().min(1).max(1024)}).parse(req.params);
    const url=c.provider==='google'?`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=full`:`https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(messageId)}?$select=id,conversationId,subject,from,toRecipients,receivedDateTime,sentDateTime,isRead,body,bodyPreview`;
    return {message:await read(req,c,url,'email'),source:c.provider,untrustedContent:true};
  }));
  await registerCalendarRoutes(app,store);
  await registerMailboxSendRoutes(app,store);
  await registerSheetsRoutes(app,store);
}

function pageToken(provider: Provider, data: Record<string, any>, _microsoftKey='$skiptoken'): string|undefined {
  if(provider==='google')return typeof data.nextPageToken==='string'?data.nextPageToken:undefined;
  if(typeof data['@odata.nextLink']!=='string')return undefined;
  try {
    const url=new URL(data['@odata.nextLink']);
    if(url.origin!=='https://graph.microsoft.com')return undefined;
    for(const parameter of ['$skiptoken','$skip']) {
      const value=url.searchParams.get(parameter);
      if(value!==null)return Buffer.from(JSON.stringify({parameter,value})).toString('base64url');
    }
  } catch { return undefined; }
  return undefined;
}

function applyPageToken(url: URL, provider: Provider, cursor: string) {
  if(provider==='google'){url.searchParams.set('pageToken',cursor);return;}
  try{
    const parsed=z.object({parameter:z.enum(['$skip','$skiptoken']),value:z.string().max(8192)}).strict().parse(JSON.parse(Buffer.from(cursor,'base64url').toString('utf8')));
    url.searchParams.set(parsed.parameter,parsed.value);
  }catch{throw new OAuthError(400,'invalid_cursor','Cursor de paginação inválido.');}
}
