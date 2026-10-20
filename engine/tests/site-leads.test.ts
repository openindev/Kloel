import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { buildApp } from '../src/app.js';
import { sendLeadMail } from '../src/site-leads.js';

function env(t: any, values: Record<string, string | undefined>) {
  const before = Object.fromEntries(Object.keys(values).map(k => [k, process.env[k]]));
  for (const [k, v] of Object.entries(values)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  t.after(() => { for (const [k, v] of Object.entries(before)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
}
const lead = { kind: 'contact', title: 'Fale com a imprensa', page: '/imprensa', context: { origem: 'imprensa' }, fields: { nome: 'Maria Souza', email: 'maria@exemplo.com.br', mensagem: 'Gostaria de uma entrevista.' }, consent: true };

test('a public site lead is stored without a session and never lost when e-mail is not configured', async t => {
  env(t, { RESEND_API_KEY: undefined, RESEND_FROM: undefined, PROVIDER_TENANT_ID: 'tenant-site-test' });
  const store = new Store(), app = await buildApp(store); t.after(() => app.close());
  const response = await app.inject({ method: 'POST', url: '/api/v1/public/leads', payload: lead });
  assert.equal(response.statusCode, 202);
  assert.equal(response.json().status, 'received');
  const rows = store.list('tenant-site-test', 'site-leads');
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.delivery, 'not_configured');
  assert.deepEqual(rows[0]!.fields, lead.fields);
  assert.equal(typeof rows[0]!.ipHash, 'string');
});

test('honeypot submissions get the same answer and are not stored; invalid payloads are rejected', async t => {
  env(t, { RESEND_API_KEY: undefined, PROVIDER_TENANT_ID: 'tenant-site-test' });
  const store = new Store(), app = await buildApp(store); t.after(() => app.close());
  const bot = await app.inject({ method: 'POST', url: '/api/v1/public/leads', payload: { ...lead, website: 'http://spam.example' } });
  assert.equal(bot.statusCode, 202);
  assert.equal(store.list('tenant-site-test', 'site-leads').length, 0);
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/public/leads', payload: { ...lead, kind: 'unknown' } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/public/leads', payload: { ...lead, fields: {} } })).statusCode, 400);
});

test('the lead e-mail goes to the team with the sender as reply-to', async t => {
  env(t, { RESEND_API_KEY: 'test-only-resend-key', RESEND_FROM: 'Kloel <nao-responda@kloel.ai>', SITE_LEADS_TO: undefined });
  const sent: any[] = [];
  const fetchImpl = (async (url: any, init: RequestInit) => { sent.push({ url: String(url), headers: init.headers, body: JSON.parse(String(init.body)) }); return new Response(JSON.stringify({ id: 'email_1' }), { status: 200 }); }) as typeof fetch;
  assert.equal(await sendLeadMail(lead as any, 'lead-1', { fetchImpl }), 'accepted');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, 'https://api.resend.com/emails');
  assert.deepEqual(sent[0].body.to, ['contato@kloel.ai']);
  assert.equal(sent[0].body.reply_to, 'maria@exemplo.com.br');
  assert.match(sent[0].body.subject, /Contato — Maria Souza/);
  assert.match(sent[0].body.text, /mensagem: Gostaria de uma entrevista\./);
  assert.match(sent[0].body.text, /Consentimento LGPD: sim/);
  const failing = (async () => new Response('', { status: 500 })) as typeof fetch;
  assert.equal(await sendLeadMail(lead as any, 'lead-2', { fetchImpl: failing }), 'failed');
});
