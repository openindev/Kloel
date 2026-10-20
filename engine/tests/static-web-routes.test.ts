import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/store.js';
import { buildApp } from '../src/app.js';

/** As 5 landings reais de web/src/site/pages/solutions/solutionsData.ts. */
const SOLUTIONS = ['agente-de-suporte-com-ia', 'agendamentos-e-perguntas-frequentes', 'recepcionista-virtual-com-ia', 'atendedor-automatico-por-ia', 'assistente-de-ia-para-equipe-externa'];
const INDEX = '<!doctype html><title>Kloel SPA fixture</title><div id="root"></div>';

async function staticApp(t: { after: (fn: () => unknown) => void }) {
  const dist = mkdtempSync(join(tmpdir(), 'kloel-web-dist-')); t.after(() => rmSync(dist, { recursive: true, force: true }));
  writeFileSync(join(dist, 'index.html'), INDEX);
  writeFileSync(join(dist, 'help-routes.json'), JSON.stringify(['get-started', 'get-started/first-steps', 'legal', 'legal/termos', 'legal/termos-e-condicoes']));
  const previous = process.env.WEB_DIST; process.env.WEB_DIST = dist;
  t.after(() => { if (previous === undefined) delete process.env.WEB_DIST; else process.env.WEB_DIST = previous; });
  const app = await buildApp(new Store()); t.after(() => app.close());
  return app;
}

test('static web: only the 5 real solution slugs are 200; unknown /solucoes/* get the SPA index with HTTP 404', async t => {
  const app = await staticApp(t);
  for (const slug of SOLUTIONS) for (const url of [`/solucoes/${slug}`, `/solucoes/${slug}/`, `/solucoes/${slug}?utm_source=x`]) {
    const res = await app.inject({ url });
    assert.equal(res.statusCode, 200, url); assert.equal(res.body, INDEX, url);
  }
  for (const url of ['/solucoes/inexistente', '/solucoes/agente-de-suporte-com-ia-x', '/solucoes/x-agente-de-suporte-com-ia', '/solucoes/agente-de-suporte-com-ia/extra', '/solucoes', '/pagina-inexistente']) {
    const res = await app.inject({ url });
    assert.equal(res.statusCode, 404, url);
    assert.equal(res.body, INDEX, `${url} ainda recebe o SPA (que mostra a página 404)`);
    assert.match(String(res.headers['content-type']), /^text\/html/, url);
  }
  assert.equal((await app.inject({ url: '/' })).statusCode, 200);
  assert.equal((await app.inject({ url: '/planos' })).statusCode, 200);
});

test('static web: help center paths follow help-routes.json (aliases stay 200 for the SPA redirect, unknown keys 404)', async t => {
  const app = await staticApp(t);
  for (const url of ['/ajuda', '/ajuda/get-started', '/ajuda/get-started/first-steps', '/ajuda/legal/termos', '/ajuda/legal/termos-e-condicoes/']) assert.equal((await app.inject({ url })).statusCode, 200, url);
  for (const url of ['/ajuda/foo/bar', '/ajuda/foo', '/ajuda/legal/inexistente', '/ajuda/a/b/c']) {
    const res = await app.inject({ url });
    assert.equal(res.statusCode, 404, url); assert.equal(res.body, INDEX, url);
  }
});

test('static web: solution slug list matches the SPA data (drift guard)', t => {
  const data = fileURLToPath(new URL('../../web/src/site/pages/solutions/solutionsData.ts', import.meta.url));
  if (!existsSync(data)) return t.skip('web/ ausente nesta cópia');
  const slugs = [...readFileSync(data, 'utf8').matchAll(/^\s*slug: '([^']+)'/gm)].map((m) => m[1]);
  assert.deepEqual([...slugs].sort(), [...SOLUTIONS].sort());
});
