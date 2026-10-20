import { z } from 'zod';

export type Provider = 'google' | 'microsoft';
export type Capability = 'calendar' | 'calendar_write' | 'email' | 'email_send' | 'sheets_read' | 'sheets_append';
export type Tokens = { accessToken: string; refreshToken?: string; expiresAt: number; scope: string };
export class OAuthError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly upstreamStatus?:number) { super(message); }
}
// E-Mail IA organizes the mailbox (read/unread, archive, trash): gmail.modify / Mail.ReadWrite, authorized by the operator on 2026-10-20.
export const scopesFor = (provider: Provider, capabilities: Capability[]) => provider === 'google'
  ? ['openid','email',...(capabilities.some(c=>c.startsWith('calendar'))?['https://www.googleapis.com/auth/calendar.readonly']:[]),...(capabilities.includes('calendar_write')?['https://www.googleapis.com/auth/calendar.events']:[]),...(capabilities.includes('email')?['https://www.googleapis.com/auth/gmail.modify']:[]),...(capabilities.includes('email_send')?['https://www.googleapis.com/auth/gmail.send']:[]),...(capabilities.includes('sheets_append')?['https://www.googleapis.com/auth/spreadsheets']:capabilities.includes('sheets_read')?['https://www.googleapis.com/auth/spreadsheets.readonly']:[])]
  : ['offline_access','User.Read',...(capabilities.includes('calendar_write')?['Calendars.ReadWrite']:capabilities.includes('calendar')?['Calendars.Read']:[]),...(capabilities.includes('email')?['Mail.ReadWrite']:[]),...(capabilities.includes('email_send')?['Mail.Send']:[])];

export function configuration(provider: Provider) {
  const prefix = provider === 'google' ? 'GOOGLE' : 'MICROSOFT';
  const clientId = process.env[`${prefix}_CLIENT_ID`];
  const clientSecret = process.env[`${prefix}_CLIENT_SECRET`];
  const tenant = process.env.MICROSOFT_TENANT_ID || 'common';
  if (!clientId || !clientSecret || !/^[a-zA-Z0-9.-]+$/.test(tenant)) throw new OAuthError(503, 'integration_not_configured', 'Aplicativo OAuth ainda não configurado.');
  let base: URL;
  try { base = new URL(process.env.PUBLIC_BASE_URL || 'http://127.0.0.1:4310'); } catch { throw new OAuthError(503, 'integration_not_configured', 'URL pública inválida.'); }
  if (base.username || base.password || base.search || base.hash || base.pathname !== '/' || (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)))) throw new OAuthError(503, 'integration_not_configured', 'URL pública deve usar HTTPS ou localhost.');
  return {
    clientId, clientSecret,
    redirectUri: `${base.origin}/api/v1/oauth/${provider}/callback`,
    authorizeUrl: provider === 'google' ? 'https://accounts.google.com/o/oauth2/v2/auth' : `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
    tokenUrl: provider === 'google' ? 'https://oauth2.googleapis.com/token' : `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
  };
}

// Provider URLs are constructed here; clients cannot choose an arbitrary fetch destination.
export async function providerJson(url: string, init: RequestInit = {}, allowEmpty=false, onPositiveStatus?: (status: number) => void): Promise<Record<string, any>> {
  let response: Response;
  try { response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(15_000) }); }
  catch { throw new OAuthError(502, 'provider_unavailable', 'O provedor não respondeu. Tente novamente.'); }
  if (!response.ok) {
    const status = response.status;
    await response.body?.cancel();
    throw new OAuthError(status === 401 ? 503 : [403,404,409,429].includes(status)?status:502, status === 401 ? 'reauthorization_required' : status === 403 ? 'provider_permission_denied' : status===404?'provider_resource_not_found':'provider_request_failed', 'O provedor recusou a operação. Confira a conexão e as permissões.',status);
  }
  // Preserve a successful HTTP status even when its body or subsequent authority fails.
  try { onPositiveStatus?.(response.status); }
  catch (error) { try { await response.body?.cancel(); } catch { /* receipt error remains primary */ } throw error; }
  if(allowEmpty&&[202,204].includes(response.status))return {};
  const reader = response.body?.getReader();
  if (!reader) throw new OAuthError(502, 'provider_response_invalid', 'Resposta inválida do provedor.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2_000_000) { await reader.cancel(); throw new Error('too_large'); }
      chunks.push(value);
    }
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('not_object');
    return body as Record<string, any>;
  } catch { throw new OAuthError(502, 'provider_response_invalid', 'Resposta inválida do provedor.'); }
}

const tokenSchema = z.object({access_token:z.string().min(1),refresh_token:z.string().min(1).optional(),expires_in:z.coerce.number().positive().max(31_536_000),token_type:z.string().refine(s=>s.toLowerCase()==='bearer'),scope:z.string().optional()});
export async function exchange(provider: Provider, parameters: Record<string, string>, requestedScopes: string[], previous?: Tokens): Promise<Tokens> {
  const config = configuration(provider);
  const body = new URLSearchParams({client_id:config.clientId,client_secret:config.clientSecret,...parameters});
  let raw:Record<string,any>;
  try{raw=await providerJson(config.tokenUrl,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});}
  catch(e){if(parameters.grant_type==='refresh_token'&&e instanceof OAuthError&&e.upstreamStatus===400)throw new OAuthError(503,'reauthorization_required','Autorize novamente a conexão.');throw e;}
  const result = tokenSchema.safeParse(raw);
  if (!result.success) throw new OAuthError(502,'provider_response_invalid','Resposta OAuth inválida.');
  const t=result.data;
  return {accessToken:t.access_token,refreshToken:t.refresh_token || previous?.refreshToken,expiresAt:Date.now()+t.expires_in*1000,scope:t.scope || previous?.scope || requestedScopes.join(' ')};
}

export async function identity(provider: Provider, token: string) {
  const url = provider === 'google' ? 'https://openidconnect.googleapis.com/v1/userinfo' : 'https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName';
  const data = await providerJson(url,{headers:{Authorization:`Bearer ${token}`}});
  const remoteId = provider === 'google' ? data.sub : data.id;
  if (typeof remoteId !== 'string' || !remoteId) throw new OAuthError(502,'provider_response_invalid','Identidade do provedor indisponível.');
  const email = provider === 'google' ? data.email : data.mail || data.userPrincipalName;
  return {remoteId,email:typeof email==='string'?email:undefined,displayName:typeof data.displayName==='string'?data.displayName:undefined};
}
