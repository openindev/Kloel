import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Parser } from 'htmlparser2';
import { z } from 'zod';
import type { Store } from './store.js';
import { DomainError } from './domains.js';
import { extractPdf } from './ingestion/pdf.js';
import { describeMedia, docxText, MEDIA_MIME } from './media-extract.js';
import { fetchPublicUrl, type UrlOptions } from './ingestion/safe-url.js';
import { renderSite } from './ingestion/render.js';
import { requireRequestPermission } from './memberships/access.js';
import { MembershipError } from './memberships/service.js';

const limit = 10 * 1024 * 1024;
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const metadata = z.object({ title: z.string().trim().min(1).max(200), agentId: z.string().min(1).max(128).nullable().optional(), tags: z.array(z.string().min(1).max(80)).max(50).default([]) });
const uploadSchema = metadata.extend({ filename: z.string().trim().min(1).max(200), mimeType: z.enum(MEDIA_MIME), base64: z.string().min(4).max(Math.ceil(limit / 3) * 4) }).strict();
const urlSchema = metadata.extend({ url: z.string().max(4000).url() }).strict();

export function htmlText(html: string): string {
  const skip = new Set(['script', 'style', 'noscript', 'iframe', 'object', 'embed', 'svg', 'canvas']);
  const block = new Set(['p', 'div', 'br', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr', 'article', 'section']);
  let depth = 0; let text = '';
  const parser = new Parser({
    onopentag(name) { if (skip.has(name)) depth++; else if (!depth && block.has(name)) text += '\n'; },
    onclosetag(name) { if (skip.has(name)) depth = Math.max(0, depth - 1); else if (!depth && block.has(name)) text += '\n'; },
    ontext(value) { if (!depth) text += value; },
  }, { decodeEntities: true });
  parser.write(html); parser.end();
  return text.replace(/[\t\f\r ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function sameOriginLinks(html: string, base: string): string[] {
  const origin = new URL(base).origin;
  const found = new Set<string>();
  for (const match of html.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)) {
    try {
      const url = new URL(match[1], base);
      if (url.origin !== origin || url.username || url.password || !['http:', 'https:'].includes(url.protocol)) continue;
      url.hash = '';
      found.add(url.href);
    } catch { /* ignore malformed links */ }
  }
  return [...found];
}

async function extract(bytes: Buffer, mimeType: string, filename = 'arquivo', media: { fetch?: typeof fetch; apiKey?: string | null } = {}) {
  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return { text: docxText(bytes), method: 'docx_xml', ocr: false as const };
  if (mimeType.startsWith('image/') || mimeType.startsWith('audio/') || mimeType.startsWith('video/')) return describeMedia(bytes, mimeType, filename, media);
  if (mimeType === 'application/pdf') return { ...(await extractPdf(bytes)), method: 'pdfjs_text' };
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new DomainError(422, 'invalid_text_encoding', 'Text sources must use UTF-8'); }
  if (mimeType === 'text/html' || mimeType === 'application/xhtml+xml') text = htmlText(text);
  if (mimeType === 'application/json') { try { JSON.parse(text); } catch { throw new DomainError(422, 'invalid_json_document', 'The document is not valid JSON'); } }
  if (!text.trim()) throw new DomainError(422, 'empty_source', 'No readable text was found');
  if (text.length > 100_000) throw new DomainError(413, 'text_too_large', 'Extracted text exceeds the 100000 character indexing limit');
  return { text, method: mimeType.includes('html') ? 'html_text' : 'utf8_text', ocr: false as const };
}

function requireAgent(store: Store, tenantId: string, agentId?: string | null) {
  if (agentId && !store.get(tenantId, 'agents', agentId)) throw new DomainError(400, 'invalid_reference', 'The requested agent is unavailable');
}
function wrapper(fn: (request: FastifyRequest, reply: FastifyReply) => unknown) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try { return await fn(request, reply); }
    catch (error) {
      if (error instanceof DomainError || error instanceof MembershipError) return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
      if (error instanceof z.ZodError) return reply.code(400).send({ error: { code: 'validation_error', message: 'Invalid import request' } });
      throw error;
    }
  };
}

export async function registerIngestion(app: FastifyInstance, store: Store, urlOptions: UrlOptions = {}, media: { fetch?: typeof fetch; apiKey?: string | null } = {}): Promise<void> {
  app.post('/api/v1/knowledge/upload', { bodyLimit: Math.ceil(limit / 3) * 4 + 16384 }, wrapper(async (request, reply) => {
    const actor = requireRequestPermission(store, request, 'knowledge:write');
    const input = uploadSchema.parse(request.body);
    requireAgent(store, actor.tenantId, input.agentId);
    const padding = input.base64.indexOf('=');
    if (input.base64.length % 4 || /[^A-Za-z0-9+/=]/.test(input.base64) || padding >= 0 && !['=', '=='].includes(input.base64.slice(padding))) throw new DomainError(400, 'invalid_base64', 'Provide a canonical base64 document');
    const bytes = Buffer.from(input.base64, 'base64');
    if (bytes.length > limit) throw new DomainError(413, 'source_too_large', 'Upload size exceeds 10 MiB');
    if (bytes.toString('base64') !== input.base64) throw new DomainError(400, 'invalid_base64', 'Provide a canonical base64 document');
    const result = await extract(bytes, input.mimeType, input.filename, media);
    requireRequestPermission(store, request, 'knowledge:write');
    const rawHash = hash(bytes);
    const item = store.transaction(() => {
      requireRequestPermission(store, request, 'knowledge:write');
      requireAgent(store, actor.tenantId, input.agentId);
      return store.create(actor.tenantId, 'knowledge', {
        title: input.title, type: 'document', content: result.text, agentId: input.agentId ?? null, tags: input.tags,
        document: { filename: input.filename, mimeType: input.mimeType, sizeBytes: bytes.length, storageKey: `inline-extracted:${rawHash}` },
        ingestionStatus: 'extracted', indexed: false, chunkCount: 0,
        extraction: { status: 'extracted', method: result.method, textSha256: hash(result.text), sourceSha256: rawHash, extractedAt: new Date().toISOString(), bytes: bytes.length, ocr: result.ocr === true, ...('pages' in result ? { pages: (result as { pages?: unknown }).pages, pageCount: (result as { pageCount?: number }).pageCount } : {}), originalBinaryRetained: false },
      });
    });
    return reply.code(201).send(item);
  }));

  app.post('/api/v1/knowledge/import-url', wrapper(async (request, reply) => {
    const actor = requireRequestPermission(store, request, 'knowledge:write');
    const input = urlSchema.parse(request.body);
    requireAgent(store, actor.tenantId, input.agentId);
    const source = await fetchPublicUrl(input.url, urlOptions);
    requireRequestPermission(store, request, 'knowledge:write');
    let result: { text: string; method: string; ocr: false; pageCount?: number };
    const html = source.contentType.includes('html');
    try { result = await extract(source.body, source.contentType) as typeof result; }
    catch (error) { if (!(html && error instanceof DomainError && error.code === 'empty_source')) throw error; result = { text: '', method: 'html_text', ocr: false }; }
    if (html && result.text.length < 600) {
      const rendered = await renderSite(source.finalUrl).catch(() => null);
      if (rendered && rendered.text.length > result.text.length) result = { text: rendered.text, method: `headless_render:${rendered.pages.length}`, ocr: false };
    }
    if (html) {
      const links = sameOriginLinks(source.body.toString('utf8'), source.finalUrl).filter(link => link !== source.finalUrl).slice(0, 5);
      const pages = [result.text];
      for (const link of links) {
        try {
          const next = await fetchPublicUrl(link, urlOptions);
          if (!next.contentType.includes('html') && !next.contentType.includes('plain')) continue;
          const extracted = await extract(next.body, next.contentType);
          if (extracted.text.trim()) pages.push(extracted.text);
        } catch { /* uma página inacessível não invalida o restante do site */ }
      }
      result = { ...result, text: pages.join('\n\n').slice(0, 100_000), pageCount: pages.length };
    }
    if (!result.text.trim()) throw new DomainError(422, 'empty_source', 'No readable text was found');
    requireRequestPermission(store, request, 'knowledge:write');
    const item = store.transaction(() => {
      requireRequestPermission(store, request, 'knowledge:write');
      requireAgent(store, actor.tenantId, input.agentId);
      return store.create(actor.tenantId, 'knowledge', {
        title: input.title, type: 'url', url: source.finalUrl, content: result.text, agentId: input.agentId ?? null, tags: input.tags,
        ingestionStatus: 'extracted', indexed: false, chunkCount: 0,
        extraction: { status: 'extracted', method: result.method, textSha256: hash(result.text), sourceSha256: hash(source.body), sourceUrl: source.sourceUrl, finalUrl: source.finalUrl, redirects: source.redirects, retrievedAt: source.retrievedAt, contentType: source.contentType, bytes: source.body.length, ocr: false, ...('pageCount' in result && result.pageCount ? { pageCount: result.pageCount } : {}), ...('pages' in result ? { pages: result.pages } : {}) },
      });
    });
    return reply.code(201).send(item);
  }));
}
