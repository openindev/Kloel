import { Parser } from 'htmlparser2';
import { z } from 'zod';
import { OAuthError } from '../oauth/client.js';

export type MailData = { remoteId: string; threadId: string; from: string | null; to: string[]; replyTo: string | null; subject: string; text: string; internetMessageId: string | null; references: string[]; receivedAt: string; folders: string[]; read: boolean; automatic: boolean; bodyTruncated: boolean; headersComplete?: boolean };
export type RemoteRequest = (url: string, init?: RequestInit, capability?: 'email' | 'email_send' | 'email_modify', allowEmpty?: boolean) => Promise<Record<string, any>>;
export const remoteId = z.string().min(1).max(2000).refine(v => v !== '.' && v !== '..' && !/[\r\n\0]/.test(v));
const address = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const plain = value.match(/<([^<>]+)>\s*$/)?.[1] ?? value.trim();
  const parsed = z.string().email().max(254).safeParse(plain);
  return parsed.success && !/[\r\n]/.test(plain) ? plain.toLowerCase() : null;
};
const messageId = (value: unknown) => typeof value === 'string' && /^<[^<>\s@]{1,300}@[^<>\s@]{1,300}>$/.test(value) ? value : null;
const headerText = (value: unknown) => typeof value === 'string' ? value.replace(/[\r\n\0]/g, ' ').slice(0, 1000) : '';
function decodedSubject(value: unknown) {
  return headerText(value).replace(/\?=\s+=\?/g, '?==?').replace(/=\?(utf-8|iso-8859-1|us-ascii)\?([bq])\?([^?]*)\?=/gi, (_match, charset, encoding, content) => {
    try { const bytes = encoding.toLowerCase() === 'b' ? Buffer.from(content, 'base64') : Buffer.from(content.replace(/_/g, ' ').replace(/=([0-9a-f]{2})/gi, (_: string, hex: string) => String.fromCharCode(parseInt(hex, 16))), 'latin1'); return bytes.toString(charset.toLowerCase() === 'iso-8859-1' ? 'latin1' : 'utf8').replace(/[\r\n\0]/g, ' '); } catch { return _match; }
  });
}
function encodedSubject(value: string) {
  const parts: string[] = []; let current = '';
  for (const character of value) { if (Buffer.byteLength(current + character) > 42) { parts.push(current); current = ''; } current += character; }
  if (current) parts.push(current);
  return parts.map(part => `=?UTF-8?B?${Buffer.from(part).toString('base64')}?=`).join('\r\n ');
}
function headers(input: unknown): Record<string, string> {
  if (!Array.isArray(input)) return {};
  const result: Record<string, string> = {};
  for (const h of input.slice(0, 200)) if (typeof h?.name === 'string' && typeof h.value === 'string') result[h.name.toLowerCase()] = h.value.slice(0, 10000);
  return result;
}
function completeHeaders(input: unknown) {
  if (!Array.isArray(input) || input.length > 200) return false;
  const critical = new Set(['from', 'to', 'reply-to', 'message-id', 'auto-submitted', 'return-path', 'precedence', 'x-auto-response-suppress', 'x-kloel-auto-response']), seen = new Set<string>();
  for (const h of input) {
    if (typeof h?.name !== 'string' || typeof h.value !== 'string' || h.value.length > 10000) return false;
    const name = h.name.toLowerCase(); if (critical.has(name) && seen.has(name)) return false; seen.add(name);
  }
  return true;
}
function htmlText(source: string): { text: string; truncated: boolean } {
  let result = '', suppressed = 0;
  const parser = new Parser({ onopentag(name) { if (['script', 'style', 'head'].includes(name)) suppressed++; if (['p', 'br', 'div', 'li'].includes(name) && !suppressed) result += '\n'; }, onclosetag(name) { if (['script', 'style', 'head'].includes(name)) suppressed = Math.max(0, suppressed - 1); }, ontext(text) { if (!suppressed) result += text; } }, { decodeEntities: true });
  parser.write(source.slice(0, 250000)); parser.end(); return { text: result.trim(), truncated: source.length > 250000 };
}
function gmailText(payload: any) {
  const plain: string[] = [], html: string[] = []; let visited = 0, truncated = false;
  function visit(part: any, depth = 0) {
    if (!part || part.filename || /^attachment(?:;|$)/i.test(headers(part.headers)['content-disposition'] ?? '')) return;
    if (depth > 10 || ++visited > 100) { truncated = true; return; }
    if (part.mimeType === 'text/plain' || part.mimeType === 'text/html') {
      if (typeof part.body?.data === 'string') {
        if (part.body.data.length > 400000) truncated = true;
        else {
          const decoded = Buffer.from(part.body.data, 'base64url').toString('utf8');
          if (part.mimeType === 'text/plain') plain.push(decoded); else html.push(decoded);
        }
      } else if (part.body?.attachmentId || Number(part.body?.size) > 0) truncated = true;
    }
    if (Array.isArray(part.parts)) for (const child of part.parts) visit(child, depth + 1);
  }
  visit(payload);
  const parsed = html.map(htmlText);
  return { text: plain.length ? plain.join('\n') : parsed.map(part => part.text).join('\n'), truncated: truncated || !plain.length && parsed.some(part => part.truncated) };
}
function date(value: unknown) { const stamp = typeof value === 'string' || typeof value === 'number' ? new Date(value).getTime() : NaN; return Number.isFinite(stamp) ? new Date(stamp).toISOString() : '1970-01-01T00:00:00.000Z'; }
function references(value: unknown) { return typeof value === 'string' ? (value.match(/<[^<>\s]+>/g) ?? []).filter(id => messageId(id)).slice(-30) : []; }
function automaticHeaders(h: Record<string, string>, mime = '') {
  return !!h['list-unsubscribe'] || !!h['list-id'] || !!h['x-kloel-auto-response'] || /\b(?:all|autoreply)\b/i.test(h['x-auto-response-suppress'] ?? '') || !!h['auto-submitted'] && h['auto-submitted'].trim().toLowerCase() !== 'no' || /^(bulk|list|junk)$/i.test((h.precedence ?? '').trim()) || h['return-path']?.trim() === '<>' || /(?:multipart\/report|message\/(?:delivery-status|disposition-notification))/i.test(`${mime} ${h['content-type'] ?? ''}`);
}
export function parseGmail(data: any): MailData {
  const id = remoteId.parse(data.id), threadId = remoteId.parse(data.threadId), h = headers(data.payload?.headers), body = gmailText(data.payload), text = body.text;
  return { remoteId: id, threadId, from: address(h.from), to: (h.to ?? '').split(',').map(address).filter((a): a is string => !!a).slice(0, 50), replyTo: address(h['reply-to']) ?? address(h.from), subject: decodedSubject(h.subject), text: text.slice(0, 40000), internetMessageId: messageId(h['message-id']), references: references(h.references), receivedAt: date(Number(data.internalDate)), folders: Array.isArray(data.labelIds) && !data.labelIds.some((v: unknown) => ['DRAFT', 'TRASH', 'SPAM'].includes(String(v))) ? data.labelIds.filter((v: unknown) => v === 'INBOX' || v === 'SENT').map((v: string) => v === 'INBOX' ? 'inbox' : 'sent') : [], read: !data.labelIds?.includes('UNREAD'), automatic: automaticHeaders(h, data.payload?.mimeType), bodyTruncated: body.truncated || text.length > 40000, headersComplete: completeHeaders(data.payload?.headers) };
}
export function parseGraph(data: any, folder: string): MailData {
  const id = remoteId.parse(data.id), h = headers(data.internetMessageHeaders), body = data.body?.contentType?.toLowerCase() === 'html' ? htmlText(String(data.body?.content ?? '')) : { text: String(data.body?.content ?? ''), truncated: false }, raw = body.text;
  const from = address(data.from?.emailAddress?.address);
  return { remoteId: id, threadId: remoteId.parse(data.conversationId ?? id), from, to: (Array.isArray(data.toRecipients) ? data.toRecipients : []).map((r: any) => address(r.emailAddress?.address)).filter((a: unknown): a is string => typeof a === 'string').slice(0, 50), replyTo: data.replyTo?.length === 1 ? address(data.replyTo[0]?.emailAddress?.address) : from, subject: headerText(data.subject), text: raw.slice(0, 40000), internetMessageId: messageId(data.internetMessageId), references: references(h.references), receivedAt: date(data.receivedDateTime ?? data.sentDateTime), folders: [folder], read: data.isRead === true, automatic: automaticHeaders(h), bodyTruncated: body.truncated || raw.length > 40000, headersComplete: completeHeaders(data.internetMessageHeaders) };
}

export type GmailCursor = { historyId?: string; pageToken?: string; initialPageToken?: string; baselineHistoryId?: string; initialized?: boolean; pendingIds?: string[]; pendingDeleted?: string[]; pendingNextPage?: string; pendingHistoryId?: string; pendingInitialNextPage?: string; pendingInitial?: boolean };
export type GraphFolderCursor = { folderId: string; url?: string; initialized: boolean };
export type MailCursor = { gmail?: GmailCursor; graph?: Record<'inbox' | 'sent', GraphFolderCursor> };
const gmailRoot = 'https://gmail.googleapis.com/gmail/v1/users/me';
const graphRoot = 'https://graph.microsoft.com/v1.0/me';
export async function gmailChanges(request: RemoteRequest, cursor: GmailCursor): Promise<GmailCursor> {
  if (cursor.pendingIds?.length || cursor.pendingDeleted?.length) return cursor;
  if (!cursor.initialized) {
    if (!cursor.baselineHistoryId) {
      const profile = await request(`${gmailRoot}/profile`);
      cursor = { ...cursor, baselineHistoryId: z.string().regex(/^\d+$/).parse(profile.historyId) };
    }
    const url = new URL(`${gmailRoot}/messages`); url.searchParams.set('q', 'in:inbox OR in:sent'); url.searchParams.set('maxResults', '20');
    if (cursor.initialPageToken) url.searchParams.set('pageToken', cursor.initialPageToken);
    const data = await request(url.href);
    const parsed = z.object({ messages: z.array(z.object({ id: remoteId })).max(100).default([]), nextPageToken: z.string().max(8192).optional() }).parse(data);
    return { ...cursor, pendingIds: [...new Set(parsed.messages.map(m => m.id))], pendingDeleted: [], pendingInitial: true, pendingInitialNextPage: parsed.nextPageToken };
  }
  const url = new URL(`${gmailRoot}/history`); url.searchParams.set('startHistoryId', cursor.historyId!); url.searchParams.set('maxResults', '20');
  if (cursor.pageToken) url.searchParams.set('pageToken', cursor.pageToken);
  let data: Record<string, any>;
  try { data = await request(url.href); } catch (error) { if (error instanceof OAuthError && error.upstreamStatus === 404) throw new OAuthError(409, 'email_sync_reset_required', 'O cursor Gmail expirou. Refaça uma sincronização inicial explícita.'); throw error; }
  const parsed = z.object({ history: z.array(z.record(z.unknown())).max(100).default([]), historyId: z.string().regex(/^\d+$/), nextPageToken: z.string().max(8192).optional() }).parse(data);
  const ids = new Set<string>(), deleted = new Set<string>();
  for (const change of parsed.history) {
    for (const kind of ['messagesAdded', 'labelsAdded', 'labelsRemoved']) for (const item of Array.isArray(change[kind]) ? change[kind] : []) ids.add(remoteId.parse(item.message?.id));
    for (const item of Array.isArray(change.messagesDeleted) ? change.messagesDeleted : []) deleted.add(remoteId.parse(item.message?.id));
  }
  if (ids.size + deleted.size > 500) throw new OAuthError(502, 'email_sync_page_too_large', 'A página de alterações excede o limite.');
  return { ...cursor, pendingIds: [...ids].filter(id => !deleted.has(id)), pendingDeleted: [...deleted], pendingInitial: false, pendingNextPage: parsed.nextPageToken, pendingHistoryId: parsed.historyId };
}
export const fetchGmailMessage = async (request: RemoteRequest, id: string) => parseGmail(await request(`${gmailRoot}/messages/${encodeURIComponent(remoteId.parse(id))}?format=full`));
export function completeGmailPage(cursor: GmailCursor): GmailCursor {
  if (cursor.pendingIds?.length || cursor.pendingDeleted?.length) return cursor;
  if (cursor.pendingInitial) return cursor.pendingInitialNextPage ? { baselineHistoryId: cursor.baselineHistoryId, initialPageToken: cursor.pendingInitialNextPage, initialized: false } : { historyId: cursor.baselineHistoryId, initialized: true };
  return { historyId: cursor.pendingNextPage ? cursor.historyId : cursor.pendingHistoryId, pageToken: cursor.pendingNextPage, initialized: true };
}

const graphSelection = 'id,conversationId,subject,body,from,toRecipients,replyTo,internetMessageId,internetMessageHeaders,receivedDateTime,sentDateTime,isRead,isDraft';
export function graphContinuation(value: unknown, folderId: string): string {
  if (typeof value !== 'string' || value.length > 16000) throw new OAuthError(502, 'email_sync_cursor_invalid', 'Cursor de e-mail inválido.');
  let url: URL; try { url = new URL(value); } catch { throw new OAuthError(502, 'email_sync_cursor_invalid', 'Cursor de e-mail inválido.'); }
  let path: string; try { path = decodeURIComponent(url.pathname); } catch { throw new OAuthError(502, 'email_sync_cursor_invalid', 'Caminho de continuação inválido.'); }
  const boundFolder = /^\/v1\.0\/me\/mailfolders\/([^/]+)\/messages\/delta$/i.exec(path)?.[1] ?? /^\/v1\.0\/me\/mailfolders\('([^']+)'\)\/messages\/delta$/i.exec(path)?.[1];
  if (url.origin !== 'https://graph.microsoft.com' || url.username || url.password || url.hash || boundFolder !== folderId || ![...url.searchParams.keys()].every(k => ['$skiptoken', '$deltatoken', '$select', '$top'].includes(k)) || url.searchParams.has('$skiptoken') === url.searchParams.has('$deltatoken')) throw new OAuthError(502, 'email_sync_cursor_invalid', 'Destino de continuação inválido.');
  return url.href;
}
export async function graphChanges(request: RemoteRequest, folder: 'inbox' | 'sent', old?: GraphFolderCursor) {
  const cursor = old ? { ...old } : { folderId: remoteId.parse((await request(`${graphRoot}/mailFolders/${folder === 'sent' ? 'sentitems' : 'inbox'}?$select=id`)).id), initialized: false };
  const initial = new URL(`${graphRoot}/mailFolders/${encodeURIComponent(cursor.folderId)}/messages/delta`);
  initial.searchParams.set('$select', graphSelection); initial.searchParams.set('$top', '20');
  let data: Record<string, any>;
  try { data = await request(cursor.url ? graphContinuation(cursor.url, cursor.folderId) : initial.href, { headers: { Prefer: 'outlook.body-content-type="text", IdType="ImmutableId", odata.maxpagesize=20' } }); }
  catch (error) { if (error instanceof OAuthError && [404, 410].includes(error.upstreamStatus ?? 0) && cursor.url) throw new OAuthError(409, 'email_sync_reset_required', 'O cursor Microsoft expirou. Reinicie a sincronização explicitamente.'); throw error; }
  const items = z.array(z.record(z.unknown())).max(20).parse(data.value);
  const next = data['@odata.nextLink'], delta = data['@odata.deltaLink'];
  if (Boolean(next) === Boolean(delta)) throw new OAuthError(502, 'email_sync_cursor_invalid', 'O provedor não confirmou um cursor único.');
  const result: ({ removed: string } | { message: MailData })[] = [];
  for (let item of items) {
    const id = remoteId.parse(item.id);
    if (item['@removed'] || item.isDraft) { result.push({ removed: id }); continue; }
    if (item.body === undefined || item.from === undefined || item.subject === undefined || item.conversationId === undefined) {
      try { item = await request(`${graphRoot}/messages/${encodeURIComponent(id)}?$select=${graphSelection}`, { headers: { Prefer: 'outlook.body-content-type="text", IdType="ImmutableId"' } }); }
      catch (error) { if (error instanceof OAuthError && error.upstreamStatus === 404) { result.push({ removed: id }); continue; } throw error; }
    }
    if (item.id !== id) throw new OAuthError(502, 'email_message_identity_changed', 'O provedor retornou outra mensagem.');
    if (item.isDraft) { result.push({ removed: id }); continue; }
    result.push({ message: parseGraph(item, folder) });
  }
  return { items: result, historical: !cursor.initialized, cursor: { ...cursor, url: graphContinuation(next || delta, cursor.folderId), initialized: cursor.initialized || !!delta } };
}

export async function sendThreadReply(request: RemoteRequest, provider: string, sender: string, message: MailData, text: string, operationId: string, automatic = false) {
  if (!address(sender) || !message.replyTo || message.replyTo === sender.toLowerCase()) throw new OAuthError(400, 'email_reply_recipient_invalid', 'Destinatário da resposta indisponível.');
  if (automatic && message.replyTo !== message.from) throw new OAuthError(409, 'email_automatic_recipient_binding', 'Autoresposta exige remetente e Reply-To iguais.');
  if (provider === 'google' || automatic) {
    if (!message.internetMessageId) throw new OAuthError(409, 'email_thread_headers_missing', 'A mensagem não tem os cabeçalhos necessários para responder na conversa.');
    const subject = encodedSubject(message.subject);
    const refs = [...new Set([...message.references, message.internetMessageId])].slice(-30).join('\r\n ');
    const raw = [`From: ${sender}`, `To: ${message.replyTo}`, `Subject: ${subject}`, `Date: ${new Date().toUTCString()}`, `Message-ID: <kloel.${operationId}@${sender.split('@')[1]}>`, `In-Reply-To: ${message.internetMessageId}`, `References: ${refs}`, ...(automatic ? ['Auto-Submitted: auto-replied', 'X-Auto-Response-Suppress: All', 'X-Kloel-Auto-Response: 1'] : []), 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', Buffer.from(text).toString('base64').match(/.{1,76}/g)?.join('\r\n') ?? ''].join('\r\n');
    if (provider === 'microsoft') {
      await request(`${graphRoot}/messages/${encodeURIComponent(message.remoteId)}/reply`, { method: 'POST', headers: { 'Content-Type': 'text/plain', Prefer: 'IdType="ImmutableId"' }, body: Buffer.from(raw).toString('base64') }, 'email_send', true);
      return { messageId: null, threadId: message.threadId };
    }
    const data = await request(`${gmailRoot}/messages/send`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ raw: Buffer.from(raw).toString('base64url'), threadId: message.threadId }) }, 'email_send');
    if (automatic && data.threadId !== message.threadId) throw new OAuthError(502, 'email_reply_thread_mismatch', 'O provedor não confirmou a conversa vinculada.');
    return { messageId: remoteId.parse(data.id), threadId: remoteId.parse(data.threadId ?? message.threadId) };
  }
  await request(`${graphRoot}/messages/${encodeURIComponent(message.remoteId)}/reply`, { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'IdType="ImmutableId"' }, body: JSON.stringify({ message: { body: { contentType: 'Text', content: text }, toRecipients: [{ emailAddress: { address: message.replyTo } }] } }) }, 'email_send', true);
  return { messageId: null, threadId: message.threadId };
}
