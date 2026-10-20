import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { Store } from '../src/store.js';
import { docxText } from '../src/media-extract.js';
import { draftFaq, generateFaqForSource } from '../src/knowledge-faq.js';
import { registerIngestion, sameOriginLinks } from '../src/ingestion.js';
import { registerDomains } from '../src/domains.js';
import { seedMember } from './fixtures/membership.js';

function storedZip(name: string, data: Buffer) {
  const file = Buffer.from(name);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt32LE(data.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(file.length, 26);
  return Buffer.concat([header, file, data]);
}

test('docx text and deterministic FAQ keep facts from the source', () => {
  const xml = Buffer.from('<?xml version="1.0"?><w:document><w:body><w:p><w:r><w:t>Atendimento de segunda a sexta, das 9h às 18h. O plano custa R$ 99 por mês.</w:t></w:r></w:p></w:body></w:document>');
  const text = docxText(storedZip('word/document.xml', xml));
  assert.match(text, /R\$ 99/);
  const faq = draftFaq(`${text}\n\nTelefone de contato: 11 99999-0000. Endereço na Rua A, 10.`, 'loja.example');
  assert.ok(faq.length >= 2);
  assert.ok(faq.some(item => item.category === 'Preços e planos'));
  assert.ok(faq.some(item => item.category === 'Contato'));
  assert.deepEqual(sameOriginLinks('<a href="/sobre">Sobre</a><a href="https://outro.example/x">fora</a>', 'https://loja.example/'), ['https://loja.example/sobre']);
});

test('upload accepts docx, rejects an image without the provider, and a site crawl keeps same-origin pages', async () => {
  const store = new Store(); const app = Fastify();
  const pages: Record<string, string> = {
    'https://example.com/': '<p>Plano profissional por R$ 99.</p><a href="/sobre">Sobre</a>',
    'https://example.com/sobre': '<p>Endereço: Rua A, 10. Telefone 11 3333-4444.</p>',
  };
  try {
    app.addHook('preHandler', async request => { request.actor = { userId: 'owner', tenantId: 'tenant-a', role: 'owner' }; seedMember(store, request.actor); });
    await registerDomains(app, store);
    await registerIngestion(app, store, { resolve: async () => [{ address: '93.184.216.34', family: 4 }], request: async url => ({ status: 200, headers: { 'content-type': 'text/html' }, body: Buffer.from(pages[url.href] ?? '<p>vazio</p>') }) });
    const xml = storedZip('word/document.xml', Buffer.from('<w:t>Política de reembolso em até 7 dias.</w:t>'));
    const upload = await app.inject({ method: 'POST', url: '/api/v1/knowledge/upload', payload: { title: 'Política', filename: 'politica.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', base64: xml.toString('base64') } });
    assert.equal(upload.statusCode, 201, upload.body);
    assert.match(upload.json().content, /reembolso/);
    const image = Buffer.from('not-an-image').toString('base64');
    const previous = process.env.OPENAI_API_KEY; delete process.env.OPENAI_API_KEY;
    const denied = await app.inject({ method: 'POST', url: '/api/v1/knowledge/upload', payload: { title: 'Foto', filename: 'foto.png', mimeType: 'image/png', base64: image } });
    if (previous === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previous;
    assert.equal(denied.statusCode, 422);
    assert.equal(denied.json().error.code, 'media_provider_unavailable');
    const remote = await app.inject({ method: 'POST', url: '/api/v1/knowledge/import-url', payload: { title: 'Site', url: 'https://example.com/' } });
    assert.equal(remote.statusCode, 201, remote.body);
    assert.match(remote.json().content, /Rua A/);
    assert.equal(remote.json().extraction.pageCount, 2);
    const previousKey = process.env.OPENAI_API_KEY; delete process.env.OPENAI_API_KEY;
    const faq = await generateFaqForSource(store, 'tenant-a', remote.json().id, { apiKey: null });
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previousKey;
    assert.ok(faq.created >= 1);
    assert.ok(faq.items.every(item => Array.isArray(item.tags) && item.tags.includes('auto')));
  } finally { await app.close(); store.close(); }
});
