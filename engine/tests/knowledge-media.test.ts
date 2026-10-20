import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { Store } from '../src/store.js';
import { docxText } from '../src/media-extract.js';
import { draftFaq, generateFaqForSource } from '../src/knowledge-faq.js';
import { registerIngestion, sameOriginLinks } from '../src/ingestion.js';
import { registerDomains } from '../src/domains.js';
import { registerKnowledge } from '../src/knowledge.js';
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

test('image, audio and video with extraction proof index, and the poster becomes separate answers', async () => {
  const poster = 'Trocas em ate 30 dias apos a entrega.\nFrete gratis acima de R$ 199.';
  const spoken = 'Nosso horário de atendimento é de segunda a sexta, das nove às dezoito horas.';
  const faq = draftFaq(poster, 'politica-trocas.png');
  assert.ok(faq.some(item => item.question === 'Qual o prazo para troca?' && item.answer === 'Até 30 dias após a entrega.'));
  assert.ok(faq.some(item => item.question === 'Tem frete grátis?' && item.answer === 'Sim, para compras acima de R$ 199.'));
  assert.ok(draftFaq(spoken, 'horario.mp3').some(item => item.question === 'Qual o horário de atendimento?'));
  const mediaFetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('/chat/completions')) return Response.json({ choices: [{ message: { content: poster } }] });
    if (url.includes('/audio/transcriptions')) return Response.json({ text: spoken });
    throw Error(`unexpected media request ${url}`);
  }) as typeof fetch;
  const store = new Store(); const app = Fastify();
  try {
    app.addHook('preHandler', async request => { request.actor = { userId: 'owner', tenantId: 'tenant-a', role: 'owner' }; seedMember(store, request.actor); });
    await registerDomains(app, store);
    await registerIngestion(app, store, {}, { fetch: mediaFetch, apiKey: 'test-not-a-real-key' });
    await registerKnowledge(app, store, { apiKey: 'test-not-a-real-key', fetchImpl: (async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { input: unknown[] };
      return Response.json({ data: body.input.map((_, index) => ({ index, embedding: [1, 0, 0] })), usage: { prompt_tokens: 1, total_tokens: 1 } });
    }) as typeof fetch });
    const files = [
      { title: 'Política', filename: 'politica-trocas.png', mimeType: 'image/png', bytes: 'png-bytes' },
      { title: 'Horário', filename: 'horario.mp3', mimeType: 'audio/mpeg', bytes: 'mp3-bytes' },
      { title: 'Vídeo', filename: 'loja.mov', mimeType: 'video/quicktime', bytes: 'mov-bytes' },
    ];
    for (const file of files) {
      const upload = await app.inject({ method: 'POST', url: '/api/v1/knowledge/upload', payload: { title: file.title, filename: file.filename, mimeType: file.mimeType, base64: Buffer.from(file.bytes).toString('base64') } });
      assert.equal(upload.statusCode, 201, upload.body);
      const indexed = await app.inject({ method: 'POST', url: `/api/v1/knowledge/${upload.json().id}/ingest`, payload: {} });
      assert.equal(indexed.statusCode, 200, indexed.body);
      assert.equal(indexed.json().status, 'indexed');
      assert.equal(store.get('tenant-a', 'knowledge', upload.json().id)?.indexed, true);
    }
    const image = store.list('tenant-a', 'knowledge').find(row => (row.document as { filename?: string } | undefined)?.filename === 'politica-trocas.png');
    const generated = await generateFaqForSource(store, 'tenant-a', String(image?.id), { apiKey: null });
    assert.ok(generated.items.some(item => String(item.title).includes('prazo para troca')));
    assert.ok(generated.items.some(item => String(item.content).includes('R$ 199')));
    assert.ok(generated.items.every(item => Array.isArray(item.tags) && item.tags.includes('auto')));
  } finally { await app.close(); store.close(); }
});
