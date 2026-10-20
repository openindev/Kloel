/**
 * Regenerates public/sitemap.xml from the public routes and the help center articles.
 *   npx tsx scripts/sitemap.ts
 * Pages that are private or transactional (/app, /login, /criar-conta, /r, /w, /c) stay out; they are also marked noindex at runtime.
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ALL_ARTICLES, articleKey } from '../src/help/content/index'

const ORIGIN = 'https://www.kloel.ai'
const PAGES = [
  '/', '/produtos/assistente-telefonico-ia', '/produtos/ia-whatsapp', '/produtos/webchat-ia', '/produtos/assistente-email-ia', '/produtos/central-telefonica-ia',
  '/solucoes/agente-de-suporte-com-ia', '/solucoes/agendamentos-e-perguntas-frequentes', '/solucoes/recepcionista-virtual-com-ia',
  '/solucoes/atendedor-automatico-por-ia', '/solucoes/assistente-de-ia-para-equipe-externa',
  '/planos', '/parceiros', '/parceiros/agendar', '/contato', '/carreiras', '/imprensa', '/casos-de-sucesso', '/webinars', '/integracoes',
  '/webchat/criar', '/demo-ia', '/lp', '/agendar-demo', '/ajuda',
]
const articles = [...new Set(ALL_ARTICLES.map(a => `/ajuda/${articleKey(a)}`))]
const urls = [...PAGES, ...articles]
const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u => `  <url><loc>${ORIGIN}${u}</loc></url>`).join('\n')}\n</urlset>\n`
writeFileSync(fileURLToPath(new URL('../public/sitemap.xml', import.meta.url)), xml)
console.log(`sitemap.xml: ${urls.length} URLs (${PAGES.length} pages, ${articles.length} help articles)`)
