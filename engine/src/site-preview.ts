import type { FastifyInstance } from 'fastify';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Prévia pública do webchat (/demo-ia): lê só a página inicial do site informado e devolve nome, cor e descrição.
 * Sem login, sem gravar nada. Proteções: apenas http/https nas portas padrão, sem IPs privados/locais
 * (checado em cada redirecionamento), 6 s de timeout, 1 MB de HTML, limite de 20 pedidos por IP a cada 10 min.
 */
export const SITE_PREVIEW_PATH = '/api/v1/public/site-preview';

const privateV4 = (ip: string) => { const [a, b] = ip.split('.').map(Number); return a === 0 || a === 10 || a === 127 || (a === 100 && b! >= 64 && b! <= 127) || (a === 169 && b === 254) || (a === 172 && b! >= 16 && b! <= 31) || (a === 192 && b === 168) || a! >= 224; };
const privateIp = (ip: string) => { if (isIP(ip) === 4) return privateV4(ip); const l = ip.toLowerCase(); if (l.startsWith('::ffff:')) return privateV4(l.slice(7)); return l === '::' || l === '::1' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe8') || l.startsWith('fe9') || l.startsWith('fea') || l.startsWith('feb'); };
async function safeUrl(raw: string) {
  const u = new URL(raw);
  if (!['http:', 'https:'].includes(u.protocol) || (u.port && !['80', '443'].includes(u.port)) || u.username || u.password) throw Error('bad');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.railway.internal')) throw Error('bad');
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => privateIp(a.address))) throw Error('bad');
  return u;
}
async function fetchHtml(start: string) {
  let url = start;
  for (let hop = 0; hop < 4; hop++) {
    const u = await safeUrl(url);
    const res = await fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(6000), headers: { 'user-agent': 'KloelPreview/1.0 (+https://www.kloel.ai)', accept: 'text/html' } });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) { url = new URL(res.headers.get('location')!, u).toString(); continue; }
    if (!res.ok || !(res.headers.get('content-type') || '').includes('html')) throw Error('fetch');
    const reader = res.body!.getReader(); let size = 0; const chunks: Uint8Array[] = [];
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; chunks.push(value); if (size > 1_000_000) { await reader.cancel(); break; } }
    return { html: Buffer.concat(chunks).toString('utf8'), finalUrl: u.toString() };
  }
  throw Error('redirects');
}
const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/\s+/g, ' ').trim();
const meta = (html: string, key: string) => {
  const re = new RegExp(`<meta[^>]+(?:name|property)=["']${key}["'][^>]*>`, 'i'); const tag = html.match(re)?.[0];
  return tag ? decode(tag.match(/content=["']([^"']*)["']/i)?.[1] ?? '') : '';
};
const hits = new Map<string, number[]>();

export function registerSitePreview(app: FastifyInstance) {
  app.get(SITE_PREVIEW_PATH, async (req, reply) => {
    const now = Date.now(); const ip = req.ip; const list = (hits.get(ip) ?? []).filter((t) => now - t < 600_000);
    if (list.length >= 20) return reply.code(429).send({ error: { code: 'rate_limited', message: 'Muitas tentativas. Tente novamente em alguns minutos.' } });
    list.push(now); hits.set(ip, list); if (hits.size > 5000) hits.clear();
    const raw = String((req.query as Record<string, unknown>)?.url ?? '').trim().slice(0, 300);
    if (!raw) return reply.code(400).send({ error: { code: 'invalid_url', message: 'Informe o endereço do site.' } });
    try {
      const { html, finalUrl } = await fetchHtml(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
      const host = new URL(finalUrl).hostname.replace(/^www\./, '');
      const title = decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '');
      const siteName = meta(html, 'og:site_name') || title.split(/\s[|\-–—:]\s/)[0] || host.split('.')[0]!;
      const description = meta(html, 'description') || meta(html, 'og:description');
      const theme = meta(html, 'theme-color');
      const brandColor = /^#[0-9a-f]{6}$/i.test(theme) ? theme : '';
      return reply.send({ website: host, companyName: siteName.slice(0, 60), description: description.slice(0, 400), title: title.slice(0, 120), brandColor });
    } catch {
      return reply.code(422).send({ error: { code: 'unreadable', message: 'Não conseguimos ler este site. Verifique o endereço e tente novamente.' } });
    }
  });
}
