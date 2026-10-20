import { z } from 'zod';
import { OAuthError } from '../oauth/client.js';
import { digest } from '../oauth/crypto.js';
import { fetchGmailMessage, graphContinuation, parseGraph, remoteId, type MailData, type RemoteRequest } from '../email-agents/adapters.js';

const gmail = 'https://gmail.googleapis.com/gmail/v1/users/me', graph = 'https://graph.microsoft.com/v1.0/me';
const selection = 'id,conversationId,parentFolderId,subject,body,from,toRecipients,replyTo,internetMessageId,internetMessageHeaders,receivedDateTime,sentDateTime,isRead,isDraft';
const purposes = ['inbox', 'sent', 'created'] as const;
type Purpose = typeof purposes[number];
type Item = { id: string; kind: 'messagesAdded' | 'changed' | 'created' | 'removed'; eventId: string; raw?: Record<string, any>; folderId?: string };
type GraphPosition = { folderId: string; url?: string; initialized: boolean };
export type AutomationCursor = {
  gmail?: { baseline: string; historyId: string; pageToken?: string };
  graph?: Partial<Record<Purpose, GraphPosition>>; phase?: number;
  pending?: { items: Item[]; folder?: 'inbox' | 'sent'; historical: boolean; cursorDigest: string; nextGmail?: AutomationCursor['gmail']; purpose?: Purpose; nextGraph?: GraphPosition };
};
export function baselineReady(provider: unknown, cursor: AutomationCursor) { return provider === 'google' ? !!cursor.gmail : purposes.every(p => cursor.graph?.[p]?.initialized); }
function continuation(value: unknown, folderId: string, purpose: Purpose) {
  if (typeof value !== 'string') return graphContinuation(value, folderId);
  let url: URL; try { url = new URL(value); } catch { return graphContinuation(value, folderId); }
  if (url.searchParams.has('changeType')) {
    if (purpose !== 'created' || url.searchParams.getAll('changeType').length !== 1 || url.searchParams.get('changeType') !== 'created') throw new OAuthError(502, 'email_sync_cursor_invalid', 'Finalidade de cursor inválida.');
    url.searchParams.delete('changeType');
  }
  graphContinuation(url.href, folderId); return value;
}
/** One bounded page only. Persist its pending queue BEFORE any message hydration. */
export async function loadAutomationPage(request: RemoteRequest, provider: unknown, cursor: AutomationCursor): Promise<AutomationCursor> {
  if (cursor.pending) return cursor;
  if (provider === 'google') {
    if (!cursor.gmail) {
      const result = await request(`${gmail}/profile`), baseline = z.string().regex(/^\d+$/).parse(result.historyId);
      return { ...cursor, gmail: { baseline, historyId: baseline } };
    }
    const url = new URL(`${gmail}/history`); url.searchParams.set('startHistoryId', cursor.gmail.historyId); url.searchParams.set('maxResults', '5');
    if (cursor.gmail.pageToken) url.searchParams.set('pageToken', cursor.gmail.pageToken);
    let data: Record<string, any>;
    try { data = await request(url.href); } catch (error) { if (error instanceof OAuthError && error.upstreamStatus === 404) throw new OAuthError(409, 'email_sync_reset_required', 'O histórico de e-mail expirou. Ative uma nova linha de base.'); throw error; }
    const response = z.object({ history: z.array(z.record(z.unknown())).max(100).default([]), historyId: z.string().regex(/^\d+$/), nextPageToken: z.string().max(8192).optional() }).parse(data);
    if (BigInt(response.historyId) < BigInt(cursor.gmail.historyId)) throw new OAuthError(502, 'email_sync_cursor_invalid', 'O cursor retornou ao passado.');
    const pending = new Map<string, Item>();
    for (const change of response.history) {
      const eventId = z.string().regex(/^\d+$/).parse(change.id);
      for (const kind of ['labelsAdded', 'labelsRemoved', 'messagesAdded', 'messagesDeleted'] as const) {
        for (const item of Array.isArray(change[kind]) ? change[kind] as any[] : []) {
          const id = remoteId.parse(item.message?.id), previous = pending.get(id);
          const eventKind = kind === 'messagesDeleted' ? 'removed' : kind === 'messagesAdded' && BigInt(eventId) > BigInt(cursor.gmail.baseline) ? 'messagesAdded' : 'changed';
          if (!previous || eventKind === 'removed' || previous.kind !== 'removed' && (eventKind === 'messagesAdded' || previous.kind !== 'messagesAdded')) pending.set(id, { id, eventId, kind: eventKind });
        }
      }
    }
    if (pending.size > 500) throw new OAuthError(502, 'email_sync_page_too_large', 'Página de e-mail acima do limite.');
    return { ...cursor, pending: { items: [...pending.values()], historical: false, cursorDigest: digest(url.href), nextGmail: { baseline: cursor.gmail.baseline, historyId: response.nextPageToken ? cursor.gmail.historyId : response.historyId, pageToken: response.nextPageToken } } };
  }
  const purpose = purposes[(cursor.phase ?? 0) % purposes.length], folder = purpose === 'sent' ? 'sent' : 'inbox';
  let position = cursor.graph?.[purpose];
  if (!position) position = { folderId: remoteId.parse((await request(`${graph}/mailFolders/${folder === 'sent' ? 'sentitems' : 'inbox'}?$select=id`)).id), initialized: false };
  const initial = new URL(`${graph}/mailFolders/${encodeURIComponent(position.folderId)}/messages/delta`);
  initial.searchParams.set('$select', selection); initial.searchParams.set('$top', '5');
  if (purpose === 'created') initial.searchParams.set('changeType', 'created');
  const url = position.url ? continuation(position.url, position.folderId, purpose) : initial.href;
  let data: Record<string, any>;
  try { data = await request(url, { headers: { Prefer: 'IdType="ImmutableId", outlook.body-content-type="text", odata.maxpagesize=5' } }); }
  catch (error) { if (error instanceof OAuthError && [404, 410].includes(error.upstreamStatus ?? 0) && position.url) throw new OAuthError(409, 'email_sync_reset_required', 'O delta de e-mail expirou. Ative uma nova linha de base.'); throw error; }
  const values = z.array(z.record(z.any())).max(20).parse(data.value), next = data['@odata.nextLink'], delta = data['@odata.deltaLink'];
  if (Boolean(next) === Boolean(delta)) throw new OAuthError(502, 'email_sync_cursor_invalid', 'O provedor não confirmou um cursor único.');
  const cursorDigest = digest(url);
  return { ...cursor, pending: { folder, purpose, historical: !position.initialized, cursorDigest, items: values.map(raw => ({ id: remoteId.parse(raw.id), kind: raw['@removed'] || raw.isDraft ? 'removed' : purpose === 'created' ? 'created' : 'changed', eventId: cursorDigest, raw, folderId: position.folderId })), nextGraph: { ...position, url: continuation(next || delta, position.folderId, purpose), initialized: position.initialized || !!delta } } };
}
export function completeAutomationPage(cursor: AutomationCursor): AutomationCursor {
  const pending = cursor.pending; if (!pending || pending.items.length) return cursor;
  if (pending.nextGmail) return { ...cursor, pending: undefined, gmail: pending.nextGmail };
  return { ...cursor, pending: undefined, graph: { ...cursor.graph, [pending.purpose!]: pending.nextGraph }, phase: ((cursor.phase ?? 0) + 1) % purposes.length };
}
export async function hydrateAutomationMessage(request: RemoteRequest, provider: unknown, item: Item, folder?: 'inbox' | 'sent'): Promise<MailData | undefined> {
  if (item.kind === 'removed') return;
  try {
    if (provider === 'google') { const data = await fetchGmailMessage(request, item.id); if (data.remoteId !== item.id) throw new OAuthError(502, 'email_message_identity_changed', 'A mensagem recebida difere da solicitada.'); return data; }
    let raw = item.raw!;
    if (raw.body === undefined || raw.from === undefined || raw.subject === undefined || raw.conversationId === undefined || raw.parentFolderId === undefined) raw = await request(`${graph}/messages/${encodeURIComponent(item.id)}?$select=${selection}`, { headers: { Prefer: 'IdType="ImmutableId", outlook.body-content-type="text"' } });
    if (raw.id !== item.id) throw new OAuthError(502, 'email_message_identity_changed', 'A mensagem recebida difere da solicitada.');
    if (raw.isDraft || raw.parentFolderId !== item.folderId) return;
    return parseGraph(raw, folder ?? 'inbox');
  } catch (error) { if (error instanceof OAuthError && error.upstreamStatus === 404) return; throw error; }
}
