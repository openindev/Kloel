import type { Store } from '../store.js';
import { graphSendRefusal, readGraphSendDiagnostics, type GraphSendDiagnostics } from './whatsapp-send-diagnostics.js';

export class WhatsAppSendFault extends Error {
  constructor(readonly status: number, readonly code: string, message = 'Não foi possível concluir a operação do WhatsApp.', readonly diagnostics?: GraphSendDiagnostics) { super(message); }
}
export const conversationReplyCollection = 'whatsapp-conversation-replies';
/** Original unresolved physical effects, not an authorization grant. */
export function unresolvedHumanReply(store: Store, tenant: string, scope: { conversationId?: string; phoneNumberId?: string; recipient?: string }, excludeId = ''): boolean {
  return !!store.db.prepare(`SELECT id FROM entities WHERE tenant_id=? AND collection=? AND id!=?
    AND (json_extract(body,'$.status') IN ('pending','unknown') OR (json_extract(body,'$.status')='succeeded' AND json_extract(body,'$.localLink')!='linked'))
    AND (json_extract(body,'$.conversationId')=? OR (json_extract(body,'$.phoneNumberId')=? AND (json_extract(body,'$.recipient')=? OR json_extract(body,'$.originRecipient')=?))) LIMIT 1`)
    .get(tenant, conversationReplyCollection, excludeId, scope.conversationId ?? '', scope.phoneNumberId ?? '', scope.recipient ?? '', scope.recipient ?? '');
}

/** One physical POST. Its caller owns reservation and durable acceptance before any late guard. */
export async function sendWhatsAppPayload(input: {
  fetcher: typeof fetch; env: { version: string; phoneId: string; token: string }; payload: unknown;
  beforeDispatch: () => void; onDispatch: () => void; onRejected: () => void;
}) {
  input.beforeDispatch(); input.onDispatch();
  const response = await input.fetcher(new URL(`https://graph.facebook.com/${input.env.version}/${input.env.phoneId}/messages`), {
    method: 'POST', headers: { Authorization: `Bearer ${input.env.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(input.payload), redirect: 'error', signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    if (response.status >= 400 && response.status < 500) {
      input.onRejected(); const diagnostics = await readGraphSendDiagnostics(response), refusal = graphSendRefusal(diagnostics);
      throw new WhatsAppSendFault(502, refusal.code, refusal.message, diagnostics);
    }
    try { void response.body?.cancel().catch(() => undefined); } catch { /* Keep the ambiguous outcome. */ }
    throw new WhatsAppSendFault(502, 'provider_outcome_unknown', 'A Meta não confirmou o resultado. Consulte esta operação, sem reenviar.');
  }
  const data: any = await response.json();
  const messageId = data && typeof data === 'object' && !Array.isArray(data) && Array.isArray(data.messages) && data.messages.length === 1 ? data.messages[0]?.id : undefined;
  if (typeof messageId !== 'string' || !/^wamid\.[A-Za-z0-9_+=/.-]{1,480}$/.test(messageId)) throw new WhatsAppSendFault(502, 'provider_outcome_unknown');
  return { data: data as unknown, messageId };
}
