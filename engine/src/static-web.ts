import { resolveCompanySlug } from './company-slug.js';
import type { FastifyInstance } from 'fastify';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';

const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json', '.avif': 'image/avif', '.xml': 'application/xml; charset=utf-8', '.mp4': 'video/mp4' };

/** Rotas reais do SPA (web/src/routes.tsx). Qualquer outra recebe o index com HTTP 404 (o SPA mostra a página 404). */
const SPA_ROUTES: RegExp[] = [
  /^\/$/, /^\/produtos\/(assistente-telefonico-ia|ia-whatsapp|webchat-ia|assistente-email-ia|central-telefonica-ia)\/?$/, /^\/solucoes\/(agente-de-suporte-com-ia|agendamentos-e-perguntas-frequentes|recepcionista-virtual-com-ia|atendedor-automatico-por-ia|assistente-de-ia-para-equipe-externa)\/?$/,
  /^\/(planos|parceiros|contato|carreiras|imprensa|casos-de-sucesso|webinars|integracoes|demo-ia|lp|agendar-demo|criar-conta|login|accept-invite|recuperar-senha|reset-password|forgot-password|register|billing)\/?$/,
  /^\/webchat\/criar\/?$/, /^\/parceiros\/agendar\/?$/, /^\/r\/[^/]+\/?$/, /^\/c\/[^/]+(\/[^/]+)?\/?$/, /^\/w\/[^/]+\/[^/]+(\/[^/]+)?\/?$/,
  /^\/ajuda(\/[^/]+){0,2}\/?$/, /^\/app(\/.*)?$/,
];

/** Serves the built web app (WEB_DIST) for any unmatched GET that is not an API route. */
export function registerStaticWeb(app: FastifyInstance) {
  const dir = process.env.WEB_DIST ? resolve(process.env.WEB_DIST) : '';
  if (!dir || !existsSync(resolve(dir, 'index.html'))) return;
  const index = readFileSync(resolve(dir, 'index.html'));
  let helpKeys: Set<string> | null = null;
  try { helpKeys = new Set(JSON.parse(readFileSync(resolve(dir, 'help-routes.json'), 'utf8')) as string[]); } catch { helpKeys = null; }
  const helpOk = (path: string) => { const m = /^\/ajuda\/(.+?)\/?$/.exec(path); return !m || !helpKeys || helpKeys.has(m[1]!); };
  app.setNotFoundHandler((req, reply) => {
    const path = decodeURIComponent(req.url.split('?')[0]);
    if (!['GET', 'HEAD'].includes(req.method) || path.startsWith('/api/') || path.startsWith('/widget/')) return reply.code(404).send({ error: { code: 'not_found', message: 'Rota não encontrada.' } });
    if (/^\/(signup|sign-up|cadastro)\/?$/.test(path)) { const q = req.url.indexOf('?'); return reply.redirect(`/criar-conta${q >= 0 ? req.url.slice(q) : ''}`, 301); } // alias /signup → /criar-conta
    { const m = /^\/c\/([a-z0-9-]+)\/?$/.exec(path); const t = m ? resolveCompanySlug(m[1]!) : undefined; if (t) return reply.redirect(`/c/${t}`, 302); } // URL da empresa
    const file = resolve(dir, '.' + path);
    if (file.startsWith(dir + sep) && existsSync(file) && statSync(file).isFile()) {
      reply.header('Cache-Control', path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
      return reply.type(types[extname(file).toLowerCase()] || 'application/octet-stream').send(readFileSync(file));
    }
    if (extname(path)) return reply.code(404).type('text/plain; charset=utf-8').send('Not found');
    const known = SPA_ROUTES.some((r) => r.test(path)) && helpOk(path);
    return reply.code(known ? 200 : 404).header('Cache-Control', 'no-cache').type('text/html; charset=utf-8').send(index);
  });
}
