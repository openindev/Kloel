import { createHash } from 'node:crypto';
import { DomainError } from './domains.js';

const keys = new Set(['name','type','channels','voiceId','language','greeting','greetingPersonalized','greetingMode','greetingRules','contactsEnabled','transfers','emails','whatsapps','scheduling','webSearch','integrations','webhooks','rules','knowledgeBaseEnabled','companyInfo','businessHours','prompt','technical','webchat','formality','chat','contactAccess','smsActions','webchatSetup','whatsappStarter','taskActions']);
const reserved = new Set(['__proto__','prototype','constructor']);
const privateKeys = new Set(['secret','password','token','accesstoken','refreshtoken','apikey','authorization','cookie','credentials','privatekey','signingsecret','clientsecret']);
const derivedKeys = new Set(['connected','connectedat','lasttest','verified','verificationstatus','mcpconnectedat','mcptools']);
const fail = (): never => { throw new DomainError(400,'invalid_editor_state','Estado editorial inválido.'); };

/** Editorial data cannot supply credentials, provider receipts or transport configuration. */
export function sanitizeAgentEditorState(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !keys.has(key))) return fail();
  let nodes = 0;
  const visit = (value: unknown, path: string[], depth: number): unknown => {
    if (++nodes > 10000 || depth > 12) return fail();
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : fail();
    if (typeof value === 'string') return value.length <= 100000 ? value : fail();
    if (Array.isArray(value)) {
      if (value.length > 2000) return fail();
      return value.map((entry,index) => visit(entry,[...path,String(index)],depth+1));
    }
    if (!value || typeof value !== 'object' || Object.keys(value).length > 128) return fail();
    const result: Record<string,unknown> = {};
    for (const [key,entry] of Object.entries(value)) {
      if (reserved.has(key)) return fail();
      const normalized = key.replace(/[-_]/g,'').toLowerCase();
      if (privateKeys.has(normalized) || derivedKeys.has(normalized)) continue;
      if (path[0] === 'webhooks' && ['url','headers','body','defaults'].includes(key)) continue;
      if (path[0] === 'integrations' && key === 'config') continue;
      Object.defineProperty(result,key,{value:visit(entry,[...path,key],depth+1),enumerable:true,writable:true,configurable:true});
    }
    return result;
  };
  const result = visit(input,[],0) as Record<string,unknown>;
  if (Buffer.byteLength(JSON.stringify(result),'utf8') > 512*1024) return fail();
  return result;
}

export function canonicalEditorJson(value: unknown): string {
  const ordered = (v: any): any => Array.isArray(v) ? v.map(ordered) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map(key => [key,ordered(v[key])])) : v;
  return JSON.stringify(ordered(value));
}
export const editorDigest = (value: unknown) => createHash('sha256').update(canonicalEditorJson(value)).digest('hex');
export const agentEditorVersion = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
