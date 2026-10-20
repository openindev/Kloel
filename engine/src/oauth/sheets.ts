import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Entity,Store } from '../store.js';
import { accessTokens,oauthAuthorizationIdentity,type Actor } from './access.js';
import { authorizedOAuthConnection,authorizedOAuthRequest } from './authorization.js';
import { OAuthError,providerJson } from './client.js';
import { digest } from './crypto.js';

export const sheetsBindings='oauth-sheets-bindings',sheetsOperations='oauth-sheets-operations';
const spreadsheetId=z.string().min(10).max(200).regex(/^[a-zA-Z0-9_-]+$/);
export const bindingSchema=z.object({spreadsheetId,name:z.string().min(1).max(120),allowAppend:z.boolean().default(false)}).strict();
const rangeSchema=z.object({sheetTitle:z.string().min(1).max(100).refine(v=>!/[\u0000-\u001f]/.test(v)),range:z.string().min(2).max(40).regex(/^[A-Za-z]{1,3}[1-9][0-9]{0,6}(?::[A-Za-z]{1,3}[1-9][0-9]{0,6})?$/)}).strict();
const cell=z.union([z.string().max(50000),z.number().finite(),z.boolean()]);
const appendSchema=rangeSchema.extend({rows:z.array(z.array(cell).min(1).max(50)).min(1).max(100)});
const baseUrl=(id:string)=>`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}`;
export function sheetConnection(store:Store,actor:Actor,id:string,write=false){
  const connection=authorizedOAuthConnection(store,actor,id,write?'sheets_append':'sheets_read');
  if(connection.provider!=='google')throw new OAuthError(400,'unsupported_provider','Esta operação exige Google Sheets.');
  if(connection.status!=='connected')throw new OAuthError(503,'integration_disconnected','Conta Google desconectada.');
  if(!Array.isArray(connection.capabilities)||!connection.capabilities.includes(write?'sheets_append':'sheets_read'))throw new OAuthError(403,'capability_not_authorized',write?'Autorize explicitamente escrita no Google Sheets.':'Autorize leitura do Google Sheets.');
  const scopes=String(connection.scopes||'').split(' '),writeScope='https://www.googleapis.com/auth/spreadsheets';
  if(!scopes.includes(writeScope)&&(!scopes.includes('https://www.googleapis.com/auth/spreadsheets.readonly')||write))throw new OAuthError(403,'oauth_scope_missing','Reconecte a conta com as permissões de Sheets necessárias.');
  return connection;
}
export function bound(store:Store,actor:Actor,connectionId:string,id:string,write=false){
  const connection=sheetConnection(store,actor,connectionId,write),binding=store.get(actor.tenantId,sheetsBindings,id);
  if(!binding||binding.connectionId!==connection.id)throw new OAuthError(404,'spreadsheet_binding_not_found','Planilha não cadastrada nesta conexão.');
  if(!binding.enabled)throw new OAuthError(503,'spreadsheet_binding_disabled','Planilha desabilitada.');
  if(write&&!binding.allowAppend)throw new OAuthError(403,'spreadsheet_read_only','Habilite inclusão de linhas nesta planilha.');
  spreadsheetId.parse(binding.spreadsheetId);return {connection,binding};
}
export function publicSheetBinding(binding:Entity){return {id:binding.id,connectionId:binding.connectionId,spreadsheetId:binding.spreadsheetId,name:binding.name,allowAppend:binding.allowAppend,enabled:binding.enabled,revision:binding.revision,lastVerifiedAt:binding.lastVerifiedAt??null,lastVerifiedRevision:binding.lastVerifiedRevision??null,status:!binding.enabled?'disabled':binding.lastVerifiedRevision===binding.revision&&Number.isSafeInteger(binding.revision)?'read_verified':'configured_unverified',createdAt:binding.createdAt,updatedAt:binding.updatedAt};}
export function configureSpreadsheet(store:Store,actor:Actor,connectionId:string,input:unknown,assertAccess?:()=>void){
  const data=bindingSchema.parse(input);
  return store.transaction(()=>{
    assertAccess?.();
    const connection=sheetConnection(store,actor,connectionId,data.allowAppend);
    if(store.list(actor.tenantId,sheetsBindings).some(b=>b.connectionId===connection.id&&b.spreadsheetId===data.spreadsheetId))throw new OAuthError(409,'spreadsheet_already_configured','Esta planilha já está cadastrada nesta conexão.');
    return publicSheetBinding(store.create(actor.tenantId,sheetsBindings,{...data,connectionId:connection.id,userId:actor.userId,enabled:true,revision:1}));
  });
}
function rectangle(input:unknown){
  const value=rangeSchema.parse(input),parts=value.range.toUpperCase().split(':'),parse=(part:string)=>{
    const matched=/^([A-Z]+)([0-9]+)$/.exec(part)!;
    return {column:[...matched[1]].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0),row:Number(matched[2])};
  };
  const start=parse(parts[0]),end=parse(parts[1]||parts[0]);
  const columns=end.column-start.column+1,rows=end.row-start.row+1;
  if(columns<1||rows<1||columns>50||rows>1000||rows*columns>20000)throw new OAuthError(400,'sheet_range_limit','Use um intervalo crescente de até 1000 linhas, 50 colunas e 20000 células.');
  return {...value,columns,rows,a1:`'${value.sheetTitle.replaceAll("'","''")}'!${value.range.toUpperCase()}`};
}
function invalidResponse(){return new OAuthError(502,'provider_response_invalid','O Google não confirmou uma resposta válida da planilha.');}
function revisionGuard(store:Store,actor:Actor,connection:Entity,binding:Entity,assertAccess?:()=>void,expectedRevision?:number,write=false){
  const revision=z.number().int().positive().safe().parse(binding.revision),identity=oauthAuthorizationIdentity(connection);
  if(expectedRevision!==undefined&&expectedRevision!==revision)throw new OAuthError(409,'spreadsheet_configuration_changed','Configuração da planilha mudou; revise antes de continuar.');
  return ()=>{
    assertAccess?.();const current=bound(store,actor,connection.id,binding.id,write);
    if(current.binding.revision!==revision||current.binding.spreadsheetId!==binding.spreadsheetId)throw new OAuthError(409,'spreadsheet_configuration_changed','Configuração da planilha mudou; revise antes de continuar.');
    if(oauthAuthorizationIdentity(current.connection)!==identity)throw new OAuthError(409,'oauth_connection_changed','A autorização da planilha mudou durante a operação.');
  };
}
function markVerified(store:Store,binding:Entity,guard:()=>void){
  store.transaction(()=>{guard();store.update(binding.tenantId,sheetsBindings,binding.id,{lastVerifiedAt:new Date().toISOString(),lastVerifiedRevision:binding.revision});guard();});guard();
}
export async function listSpreadsheetTabs(store:Store,actor:Actor,connectionId:string,bindingId:string,assertAccess?:()=>void,expectedRevision?:number){
  assertAccess?.();
  const {connection,binding}=bound(store,actor,connectionId,bindingId),guard=revisionGuard(store,actor,connection,binding,assertAccess,expectedRevision);guard();
  const url=new URL(baseUrl(String(binding.spreadsheetId)));
  url.searchParams.set('fields','spreadsheetId,properties(title,locale,timeZone),sheets(properties(sheetId,title,index,sheetType,gridProperties(rowCount,columnCount)))');
  const response=await authorizedOAuthRequest(store,actor,connection,url.href,{},false,'sheets_read',guard);
  const parsed=z.object({spreadsheetId:z.literal(String(binding.spreadsheetId)),properties:z.object({title:z.string(),locale:z.string().optional(),timeZone:z.string().optional()}),sheets:z.array(z.object({properties:z.object({sheetId:z.number().int().nonnegative(),title:z.string(),index:z.number().int().nonnegative().optional(),sheetType:z.string().optional(),gridProperties:z.object({rowCount:z.number().int().nonnegative().optional(),columnCount:z.number().int().nonnegative().optional()}).optional()})})).max(1000)}).safeParse(response);
  if(!parsed.success)throw invalidResponse();
  markVerified(store,binding,guard);
  return {spreadsheetId:parsed.data.spreadsheetId,...parsed.data.properties,items:parsed.data.sheets.map(s=>s.properties),source:'google_sheets',bindingId:binding.id,bindingRevision:binding.revision,providerVerified:true};
}
export async function readSpreadsheetRange(store:Store,actor:Actor,connectionId:string,bindingId:string,input:unknown,assertAccess?:()=>void,expectedRevision?:number){
  assertAccess?.();
  const {connection,binding}=bound(store,actor,connectionId,bindingId),range=rectangle(input),guard=revisionGuard(store,actor,connection,binding,assertAccess,expectedRevision);guard();
  const url=new URL(`${baseUrl(String(binding.spreadsheetId))}/values/${encodeURIComponent(range.a1)}`);
  url.searchParams.set('majorDimension','ROWS');url.searchParams.set('valueRenderOption','UNFORMATTED_VALUE');url.searchParams.set('dateTimeRenderOption','SERIAL_NUMBER');
  const response=await authorizedOAuthRequest(store,actor,connection,url.href,{},false,'sheets_read',guard);
  const parsed=z.object({range:z.string(),majorDimension:z.literal('ROWS').optional(),values:z.array(z.array(cell).max(range.columns)).max(range.rows).default([])}).safeParse(response);
  if(!parsed.success)throw invalidResponse();
  markVerified(store,binding,guard);
  return {...parsed.data,majorDimension:'ROWS',spreadsheetId:binding.spreadsheetId,source:'google_sheets',bindingId:binding.id,bindingRevision:binding.revision,providerVerified:true,dataSource:'untrusted_spreadsheet_content',requestedRange:range.a1};
}

export { rectangle as sheetRectangle };

/** Separate evidence: never relabel the range returned by Google. This is not a remote snapshot. */
export type SheetGridEvidence = { requestedRange: string; providerRange: string; sheetId: number; rowCount: number; columnCount: number };
export function formattedSheetRange(value: string) {
  const match = /^(?:'((?:[^']|'')+)'|([^'].*))!([A-Za-z]{1,3}[1-9][0-9]{0,6})(?::([A-Za-z]{1,3}[1-9][0-9]{0,6}))?$/.exec(value);
  if (!match) return undefined;
  try {
    const range = rectangle({ sheetTitle: match[1] === undefined ? match[2] : match[1].replaceAll("''", "'"), range: `${match[3]}:${match[4] ?? match[3]}` });
    const start = /^([A-Z]+)([0-9]+)/.exec(match[3].toUpperCase())!;
    const firstColumn = [...start[1]].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0), firstRow = Number(start[2]);
    return { ...range, firstColumn, firstRow, lastColumn: firstColumn + range.columns - 1, lastRow: firstRow + range.rows - 1 };
  } catch { return undefined; }
}
export function formattedSheetRangeCovered(requestedRange: string, providerRange: string, evidence?: SheetGridEvidence) {
  const requested = formattedSheetRange(requestedRange), actual = formattedSheetRange(providerRange);
  if (!requested || !actual) return false;
  if (requested.a1 === actual.a1) return true;
  return !!evidence && evidence.requestedRange === requestedRange && evidence.providerRange === providerRange
    && Number.isSafeInteger(evidence.sheetId) && evidence.sheetId >= 0
    && Number.isSafeInteger(evidence.rowCount) && evidence.rowCount > 0
    && Number.isSafeInteger(evidence.columnCount) && evidence.columnCount > 0
    && requested.sheetTitle === actual.sheetTitle && requested.firstRow === actual.firstRow && requested.firstColumn === actual.firstColumn
    && actual.lastRow === Math.min(requested.lastRow, evidence.rowCount)
    && actual.lastColumn === Math.min(requested.lastColumn, evidence.columnCount);
}
async function formattedSheetRead(remoteId: string, range: ReturnType<typeof rectangle>, accessToken: string, guard: () => void) {
  const url = new URL(`${baseUrl(remoteId)}/values/${encodeURIComponent(range.a1)}`);
  url.searchParams.set('majorDimension', 'ROWS'); url.searchParams.set('valueRenderOption', 'FORMATTED_VALUE');
  guard();
  const response = await providerJson(url.href, { headers: { Authorization: `Bearer ${accessToken}` } });
  guard();
  const parsed = z.object({ range: z.string(), majorDimension: z.literal('ROWS').optional(), values: z.array(z.array(z.string()).max(range.columns)).max(range.rows).default([]) }).safeParse(response);
  if (!parsed.success) throw invalidResponse();
  const actual = formattedSheetRange(parsed.data.range), requested = formattedSheetRange(range.a1)!;
  if (!actual || actual.sheetTitle !== requested.sheetTitle || actual.firstRow !== requested.firstRow || actual.firstColumn !== requested.firstColumn
    || actual.lastRow > requested.lastRow || actual.lastColumn > requested.lastColumn
    || parsed.data.values.length > actual.rows || parsed.data.values.some(row => row.length > actual.columns)) throw invalidResponse();
  if (actual.a1 === requested.a1) return { response };
  // Exactly one bounded metadata read, only when the value range was clipped. Reuse the already scope-checked token.
  const metadataUrl = new URL(baseUrl(remoteId));
  metadataUrl.searchParams.set('ranges', `'${range.sheetTitle.replaceAll("'", "''")}'`);
  metadataUrl.searchParams.set('fields', 'spreadsheetId,sheets(properties(sheetId,title,sheetType,gridProperties(rowCount,columnCount)))');
  guard();
  const metadata = await providerJson(metadataUrl.href, { headers: { Authorization: `Bearer ${accessToken}` } });
  guard();
  const grid = z.object({ spreadsheetId: z.literal(remoteId), sheets: z.array(z.object({ properties: z.object({ sheetId: z.number().int().nonnegative().safe(), title: z.literal(range.sheetTitle), sheetType: z.literal('GRID').default('GRID'), gridProperties: z.object({ rowCount: z.number().int().positive().safe(), columnCount: z.number().int().positive().safe() }) }) })).length(1) }).safeParse(metadata);
  if (!grid.success) throw invalidResponse();
  const properties = grid.data.sheets[0].properties;
  const gridEvidence: SheetGridEvidence = { requestedRange: range.a1, providerRange: parsed.data.range, sheetId: properties.sheetId, ...properties.gridProperties };
  if (!formattedSheetRangeCovered(range.a1, parsed.data.range, gridEvidence)) throw invalidResponse();
  guard(); return { response, gridEvidence };
}

/** Query-only formatted read: no binding verification write or query journal. */
export async function readFormattedSheetRectangle(store:Store,actor:Actor,connectionId:string,bindingId:string,input:unknown,assertAccess:()=>void,expectedRevision:number){
  assertAccess();
  const {connection,binding}=bound(store,actor,connectionId,bindingId),range=rectangle(input),guard=revisionGuard(store,actor,connection,binding,assertAccess,expectedRevision);guard();
  const token=await accessTokens(store,connection);guard();
  if(!token.scope.split(' ').some(scope=>scope==='https://www.googleapis.com/auth/spreadsheets'||scope==='https://www.googleapis.com/auth/spreadsheets.readonly'))throw new OAuthError(403,'oauth_scope_missing','O token atual não autoriza leitura do Google Sheets.');
  const read=await formattedSheetRead(String(binding.spreadsheetId),range,token.accessToken,guard);
  guard();return {...read,bindingRevision:Number(binding.revision),assertCurrent:guard};
}
function publicOperation(o:Entity){return {id:o.id,connectionId:o.connectionId,bindingId:o.bindingId,status:o.status,result:o.result??null,errorCode:o.errorCode??null,createdAt:o.createdAt,updatedAt:o.updatedAt,requiresReconciliation:['pending','uncertain'].includes(String(o.status)),automaticRetry:false};}
function existingOperation(store:Store,actor:Actor,keyHash:string,fingerprint:string){
  const old=store.list(actor.tenantId,sheetsOperations).find(o=>o.keyHash===keyHash);
  if(!old)return undefined;
  if(old.fingerprint!==fingerprint)throw new OAuthError(409,'idempotency_conflict','Chave já utilizada com outra inclusão de linhas.');
  if(old.status==='appended')return old.result;
  throw new OAuthError(409,old.status==='uncertain'?'append_outcome_unknown':'append_in_progress','Inclusão já iniciada; confira a planilha e o recibo antes de repetir.');
}
export function normalizeSheetAppend(input:unknown){
  const data=appendSchema.parse(input),range=rectangle({sheetTitle:data.sheetTitle,range:data.range});
  if(data.rows.some(row=>row.length>range.columns)||data.rows.flat().length>5000||Buffer.byteLength(JSON.stringify(data.rows))>256000)throw new OAuthError(400,'sheet_rows_limit','Linhas excedem largura ou tamanho permitido.');
  return {data:{...data,range:data.range.toUpperCase()},range};
}
export async function appendSpreadsheetRows(store:Store,actor:Actor,connectionId:string,bindingId:string,input:unknown,idempotencyKey:string,assertAccess?:()=>void,options:{expectedRevision?:number;onReserved?:(receipt:Entity)=>void}={}){
  assertAccess?.();
  let {connection,binding}=bound(store,actor,connectionId,bindingId,true);
  const {data,range}=normalizeSheetAppend(input),guard=revisionGuard(store,actor,connection,binding,assertAccess,options.expectedRevision,true);guard();
  const key=z.string().min(1).max(300).parse(idempotencyKey),keyHash=digest(`${actor.userId}:${connection.id}:${binding.id}:${key}`);
  const fingerprint=digest(JSON.stringify({revision:binding.revision,range:range.a1,rows:data.rows}));
  const prior=existingOperation(store,actor,keyHash,fingerprint);if(prior)return prior;
  const authorizationIdentity=oauthAuthorizationIdentity(connection),token=await accessTokens(store,connection);
  assertAccess?.();
  if(!token.scope.split(' ').includes('https://www.googleapis.com/auth/spreadsheets'))throw new OAuthError(403,'oauth_scope_missing','O token atual não autoriza inclusão de linhas. Reconecte Google Sheets.');
  // Recheck current permission and binding after token refresh, before persisting or sending a write.
  ({connection,binding}=bound(store,actor,connectionId,bindingId,true));
  if(oauthAuthorizationIdentity(connection)!==authorizationIdentity)throw new OAuthError(409,'oauth_connection_changed','A autorização da planilha mudou durante a operação.');
  const currentFingerprint=digest(JSON.stringify({revision:binding.revision,range:range.a1,rows:data.rows}));
  if(currentFingerprint!==fingerprint)throw new OAuthError(409,'spreadsheet_configuration_changed','Configuração da planilha mudou; revise antes de enviar.');
  const acquired=store.transaction(()=>{
    assertAccess?.();
    guard();
    const replay=existingOperation(store,actor,keyHash,fingerprint);if(replay)return {replay};
    const receipt=store.create(actor.tenantId,sheetsOperations,{connectionId:connection.id,bindingId:binding.id,userId:actor.userId,keyHash,fingerprint,status:'pending',revision:binding.revision,spreadsheetId:binding.spreadsheetId,rowsRequested:data.rows.length});
    options.onReserved?.(receipt);guard();return {receipt};
  });
  if('replay' in acquired)return acquired.replay;
  const receipt=acquired.receipt!;
  const url=new URL(`${baseUrl(String(binding.spreadsheetId))}/values/${encodeURIComponent(range.a1)}:append`);
  url.searchParams.set('valueInputOption','RAW');url.searchParams.set('insertDataOption','INSERT_ROWS');url.searchParams.set('includeValuesInResponse','false');
  let attempted=false;
  try{
    guard();attempted=true;
    const response=await providerJson(url.href,{method:'POST',headers:{Authorization:`Bearer ${token.accessToken}`,'Content-Type':'application/json'},body:JSON.stringify({range:range.a1,majorDimension:'ROWS',values:data.rows})});
    const parsed=z.object({spreadsheetId:z.literal(String(binding.spreadsheetId)),updates:z.object({updatedRange:z.string().min(1),updatedRows:z.number().int().min(1),updatedColumns:z.number().int().min(1),updatedCells:z.number().int().min(1)})}).safeParse(response);
    if(!parsed.success||parsed.data.updates.updatedRows!==data.rows.length||parsed.data.updates.updatedColumns>range.columns||parsed.data.updates.updatedCells>data.rows.length*range.columns)throw invalidResponse();
    const result={operationId:receipt.id,status:'appended',spreadsheetId:binding.spreadsheetId,...parsed.data.updates,valueInputOption:'RAW',providerVerified:true};
    if(assertAccess)store.update(actor.tenantId,sheetsOperations,receipt.id,{status:'appended',result});
    assertAccess?.();
    const current=bound(store,actor,connectionId,bindingId,true);
    if(oauthAuthorizationIdentity(current.connection)!==authorizationIdentity||current.binding.revision!==binding.revision)throw new OAuthError(409,'oauth_connection_changed','A autorização ou a configuração da planilha mudou durante a operação.');
    if(!assertAccess)store.update(actor.tenantId,sheetsOperations,receipt.id,{status:'appended',result});
    return result;
  }catch(e){if(store.get(actor.tenantId,sheetsOperations,receipt.id)?.status!=='appended')store.update(actor.tenantId,sheetsOperations,receipt.id,{status:options.onReserved&&!attempted?'not_sent':'uncertain',errorCode:e instanceof OAuthError?e.code:'append_unknown'});throw e;}
}

export async function registerSheetsRoutes(app:FastifyInstance,store:Store){
  const {registerSheetsHttpRoutes}=await import('./sheets-http.js');
  await registerSheetsHttpRoutes(app,store);
}

/** Server-resolved access only: callers retain their real operator or delegated grant guards. */
export type AuthorizedSheetTarget = { connection: Entity; binding: Entity; assertCurrent: () => void };
export async function readAuthorizedSheetRectangle(store: Store, target: AuthorizedSheetTarget, input: unknown) {
  target.assertCurrent();
  const range = rectangle(input), remoteId = spreadsheetId.parse(target.binding.spreadsheetId);
  const token = await accessTokens(store, target.connection); target.assertCurrent();
  if (!token.scope.split(' ').some(scope => scope === 'https://www.googleapis.com/auth/spreadsheets' || scope === 'https://www.googleapis.com/auth/spreadsheets.readonly')) throw new OAuthError(403, 'oauth_scope_missing', 'O token atual não autoriza leitura.');
  const result = await formattedSheetRead(remoteId, range, token.accessToken, target.assertCurrent);
  target.assertCurrent(); return result;
}
export async function appendAuthorizedSheetRow(store: Store, target: AuthorizedSheetTarget, input: unknown, lifecycle: {
  beforeDispatch: () => void; positiveStatus: (status: number) => void; confirmed: (result: { updatedRows: number; updatedRange: string }) => void;
}) {
  target.assertCurrent();
  const { data, range } = normalizeSheetAppend(input), remoteId = spreadsheetId.parse(target.binding.spreadsheetId);
  if (data.rows.length !== 1 || Buffer.byteLength(JSON.stringify(data.rows)) > 16000) throw new OAuthError(400, 'sheet_rows_limit', 'Use uma linha limitada.');
  const token = await accessTokens(store, target.connection); target.assertCurrent();
  if (!token.scope.split(' ').includes('https://www.googleapis.com/auth/spreadsheets')) throw new OAuthError(403, 'oauth_scope_missing', 'O token atual não autoriza inclusão.');
  const url = new URL(`${baseUrl(remoteId)}/values/${encodeURIComponent(range.a1)}:append`);
  url.searchParams.set('valueInputOption', 'RAW'); url.searchParams.set('insertDataOption', 'INSERT_ROWS'); url.searchParams.set('includeValuesInResponse', 'false');
  target.assertCurrent(); lifecycle.beforeDispatch(); target.assertCurrent();
  const response = await providerJson(url.href, { method: 'POST', headers: { Authorization: `Bearer ${token.accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ range: range.a1, majorDimension: 'ROWS', values: data.rows }) }, false, lifecycle.positiveStatus);
  const parsed = z.object({ spreadsheetId: z.literal(remoteId), updates: z.object({ updatedRange: z.string().min(1), updatedRows: z.literal(1), updatedColumns: z.number().int().min(1).max(range.columns), updatedCells: z.number().int().min(1).max(range.columns) }) }).safeParse(response);
  if (!parsed.success) throw invalidResponse();
  const updated = /^(?:'((?:[^']|'')+)'|([^'].*))!([A-Za-z]{1,3})([1-9][0-9]*)(?::([A-Za-z]{1,3})([1-9][0-9]*))?$/.exec(parsed.data.updates.updatedRange);
  const firstColumn = /^[A-Z]+/.exec(data.range)![0];
  if (!updated || (updated[1] === undefined ? updated[2] : updated[1].replaceAll("''", "'")) !== data.sheetTitle || updated[3].toUpperCase() !== firstColumn || updated[4] !== (updated[6] ?? updated[4])) throw invalidResponse();
  const updatedRectangle = rectangle({ sheetTitle: data.sheetTitle, range: `${updated[3]}${updated[4]}:${updated[5] ?? updated[3]}${updated[6] ?? updated[4]}` });
  if (updatedRectangle.columns !== parsed.data.updates.updatedColumns || parsed.data.updates.updatedCells !== parsed.data.updates.updatedColumns || updatedRectangle.columns > range.columns) throw invalidResponse();
  lifecycle.confirmed({ updatedRows: 1, updatedRange: parsed.data.updates.updatedRange });
  target.assertCurrent(); return parsed.data.updates;
}
