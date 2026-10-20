import { lookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';

/** Headless render of client-rendered sites, crawling same-origin pages. Only runs when CHROMIUM_PATH is set. */
const publicHost = new Map<string, Promise<boolean>>();
async function isPublic(host: string) {
  if (!publicHost.has(host)) publicHost.set(host, lookup(host, { all: true }).then(rs => rs.every(r => ipaddr.parse(r.address).range() === 'unicast')).catch(() => false));
  return publicHost.get(host)!;
}

export async function renderSite(startUrl: string, maxPages = Number(process.env.RENDER_MAX_PAGES || 15)): Promise<{ text: string; pages: string[] } | null> {
  const exe = process.env.CHROMIUM_PATH;
  if (!exe) return null;
  const { chromium } = await import('playwright-core');
  const origin = new URL(startUrl).origin;
  const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const ctx = await browser.newContext({ userAgent: 'KloelBot/1.0 (+https://www.kloel.ai)' });
    await ctx.route('**/*', async route => {
      const req = route.request(), u = new URL(req.url());
      if (['image', 'media', 'font'].includes(req.resourceType())) return route.abort();
      if (!/^https?:$/.test(u.protocol) || !(await isPublic(u.hostname))) return route.abort();
      return route.continue();
    });
    const page = await ctx.newPage();
    const queue = [startUrl], seen = new Set([new URL(startUrl).pathname]), parts: string[] = [], pages: string[] = [];
    let size = 0;
    while (queue.length && pages.length < maxPages && size < 95_000) {
      const url = queue.shift()!;
      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 20_000 });
        const text = (await page.evaluate(() => (document.querySelector('main') as HTMLElement | null ?? document.body).innerText)).replace(/\n{3,}/g, '\n\n').trim();
        if (text) { const chunk = `## ${new URL(url).pathname}\n${text}`; parts.push(chunk); size += chunk.length; pages.push(url); }
        for (const href of await page.$$eval('a[href]', as => as.map(a => (a as HTMLAnchorElement).href))) {
          try { const n = new URL(href); n.hash = ''; n.search = ''; if (n.origin === origin && !seen.has(n.pathname) && !/\.(pdf|png|jpe?g|zip|mp4)$/i.test(n.pathname) && !/^\/(app|login|entrar|signin|criar-conta|signup)\b/.test(n.pathname)) { seen.add(n.pathname); queue.push(n.toString()); } } catch { /* ignore */ }
        }
      } catch { /* skip page */ }
    }
    return parts.length ? { text: parts.join('\n\n').slice(0, 99_000), pages } : null;
  } finally { await browser.close(); }
}
