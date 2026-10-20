import { seedMember } from './fixtures/membership.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import Fastify from 'fastify';
import { Store } from '../src/store.js';
import { htmlText, registerIngestion } from '../src/ingestion.js';
import { fetchPublicUrl, isPublicAddress, pinnedAddress, publicUrl, requestPinned, type UrlOptions } from '../src/ingestion/safe-url.js';
import { extractPdf } from '../src/ingestion/pdf.js';
import { ingestKnowledge } from '../src/knowledge.js';
import { registerDomains } from '../src/domains.js';

function pdf(text = 'Kloel opens at nine', withText = true) {
  const content = withText ? `BT /F1 12 Tf 72 720 Td (${text}) Tj ET` : 'q Q';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];
  let body = '%PDF-1.7\n'; const offsets = [0];
  for (let i = 0; i < objects.length; i++) { offsets.push(Buffer.byteLength(body)); body += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`; }
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(value => `${String(value).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(body);
}
const resolver = async () => [{ address: '93.184.216.34', family: 4 }];
const response = (body: string, contentType = 'text/html') => ({ status: 200, headers: { 'content-type': contentType }, body: Buffer.from(body) });

test('public URL validation rejects private, mapped, metadata, numeric and non-HTTP bypasses', () => {
  for (const value of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '168.63.129.16', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1', '2001:db8::1', 'fec0::1', '2002:7f00:1::', '64:ff9b::7f00:1']) assert.equal(isPublicAddress(value), false, value);
  for (const value of ['http://127.1', 'http://2130706433', 'http://0x7f000001', 'http://[::1]', 'http://[::ffff:7f00:1]', 'http://localhost.', 'http://foo.local', 'http://metadata.google.internal', 'file:///etc/passwd', 'https://user:pass@example.com', 'http://example.com:8080']) assert.throws(() => publicUrl(value), undefined, value);
  assert.equal(isPublicAddress('93.184.216.34'), true);
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
});

test('DNS pinning rejects mixed public/private answers and forwards the validated address', async () => {
  await assert.rejects(pinnedAddress(new URL('https://example.com'), async () => [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.1', family: 4 }]), /private or special-use/);
  let requested = false;
  const result = await fetchPublicUrl('https://example.com/', { resolve: resolver, request: async (url, address) => { requested = true; assert.equal(url.hostname, 'example.com'); assert.deepEqual(address, { address: '93.184.216.34', family: 4 }); return response('safe'); } });
  assert.equal(requested, true);
  assert.equal(result.finalUrl, 'https://example.com/');
});

test('redirects are revalidated, stop at private destinations and enforce the limit', async () => {
  let requests = 0;
  await assert.rejects(fetchPublicUrl('https://example.com', { resolve: resolver, request: async () => { requests++; return { status: 302, headers: { location: 'http://127.0.0.1/secrets' }, body: Buffer.alloc(0) }; } }), /not allowed/);
  assert.equal(requests, 1);
  requests = 0;
  await assert.rejects(fetchPublicUrl('https://example.com', { resolve: resolver, request: async () => { requests++; return { status: 302, headers: { location: `/redirect-${requests}` }, body: Buffer.alloc(0) }; } }), /redirect chain/);
  assert.equal(requests, 6);
  let resolved = 0;
  await assert.rejects(fetchPublicUrl('https://example.com', { resolve: async () => { resolved++; return [{ address: resolved === 1 ? '93.184.216.34' : '127.0.0.1', family: 4 }]; }, request: async () => ({ status: 302, headers: { location: '/rebound' }, body: Buffer.alloc(0) }) }), /private or special-use/);
  assert.equal(resolved, 2);
});

test('source size, content type, DNS timeout and HTTP status are bounded', async () => {
  await assert.rejects(fetchPublicUrl('https://example.com', { resolve: resolver, request: async () => response('12345'), maxBytes: 4 }), /byte limit/);
  await assert.rejects(fetchPublicUrl('https://example.com', { resolve: resolver, request: async () => response('binary', 'application/octet-stream') }), /content type/);
  await assert.rejects(fetchPublicUrl('https://example.com', { resolve: resolver, request: async () => ({ status: 404, headers: {}, body: Buffer.alloc(0) }) }), /HTTP 200/);
  let requestCount = 0;
  await assert.rejects(fetchPublicUrl('https://example.com', { timeoutMs: 5, resolve: async () => { await new Promise(resolve => setTimeout(resolve, 30)); return resolver(); }, request: async () => { requestCount++; return response('unexpected'); } }), /time limit/);
  await new Promise(resolve => setTimeout(resolve, 35));
  assert.equal(requestCount, 0);
});

test('native HTTP transport really connects to pinned address and enforces streaming bytes', async () => {
  const server = createServer((request, response) => {
    assert.ok(request.headers.host?.startsWith('nonresolving.example'));
    response.writeHead(200, { 'content-type': 'text/plain' }); response.end('pinned response');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address() as { port: number };
    // Direct transport test only: public URL validation deliberately does not permit this local address.
    const url = new URL(`http://nonresolving.example:${address.port}/`);
    const result = await requestPinned(url, { address: '127.0.0.1', family: 4 }, 100, 2000);
    assert.equal(result.body.toString(), 'pinned response');
    await assert.rejects(requestPinned(url, { address: '127.0.0.1', family: 4 }, 3, 2000), /byte limit/);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('HTML extraction decodes entities and excludes scripts/styles without executing them', () => {
  const text = htmlText('<html><head><style>secret-style</style><script>throw "bad"</script></head><body><h1>Hor&aacute;rios</h1><p>9 &amp; 18</p><iframe>hidden</iframe></body></html>');
  assert.equal(text, 'Horários\n\n9 & 18');
  assert.ok(!text.includes('secret'));
});

test('PDF extraction reads actual text, captures pages and reports no OCR', async () => {
  const result = await extractPdf(pdf());
  assert.ok(result.text.includes('Kloel opens at nine'));
  assert.equal(result.pageCount, 1);
  assert.equal(result.pages[0].page, 1);
  assert.equal(result.ocr, false);
  await assert.rejects(extractPdf(Buffer.from('not a pdf')), /not a PDF/);
  await assert.rejects(extractPdf(pdf('', false)), /OCR is not implemented/);
  await assert.rejects(extractPdf(pdf(), 1), /time limit/);
});

test('upload and URL import persist provenance, enforce tenant/RBAC and feed real indexing path', async () => {
  const store = new Store(); const app = Fastify();
  try {
    const sourceOptions: UrlOptions = { resolve: resolver, request: async () => response('<p>Atendemos de segunda a sexta.</p>') };
    app.addHook('preHandler', async request => { request.actor = { userId: request.headers['x-member'] ? 'member' : 'owner', tenantId: 'tenant-a', role: request.headers['x-member'] ? 'member' : 'owner' }; seedMember(store, request.actor); });
    await registerDomains(app, store);
    await registerIngestion(app, store, sourceOptions);
    const input = { title: 'PDF policy', filename: 'hours.pdf', mimeType: 'application/pdf', base64: pdf().toString('base64') };
    const denied = await app.inject({ method: 'POST', url: '/api/v1/knowledge/upload', payload: input, headers: { 'x-member': 'true' } });
    assert.equal(denied.statusCode, 403);
    const foreign = store.create('tenant-b', 'agents', { name: 'Foreign' });
    const scoped = await app.inject({ method: 'POST', url: '/api/v1/knowledge/upload', payload: { ...input, agentId: foreign.id } });
    assert.equal(scoped.statusCode, 400);
    const upload = await app.inject({ method: 'POST', url: '/api/v1/knowledge/upload', payload: input });
    assert.equal(upload.statusCode, 201, upload.body);
    assert.equal(upload.json().extraction.method, 'pdfjs_text');
    assert.equal(upload.json().extraction.originalBinaryRetained, false);
    assert.equal(upload.json().indexed, false);
    const remote = await app.inject({ method: 'POST', url: '/api/v1/knowledge/import-url', payload: { title: 'Website', url: 'https://example.com/policy' } });
    assert.equal(remote.statusCode, 201, remote.body);
    assert.equal(remote.json().type, 'url');
    assert.equal(remote.json().extraction.finalUrl, 'https://example.com/policy');
    const options = { apiKey: 'test-only', fetchImpl: (async (_url: unknown, init: RequestInit) => { const request = JSON.parse(String(init.body)); return Response.json({ data: request.input.map((_: unknown, index: number) => ({ index, embedding: [1, 0, 0] })) }); }) as typeof fetch };
    for (const id of [upload.json().id, remote.json().id]) {
      const indexed = await ingestKnowledge(store, 'tenant-a', id, {}, options);
      assert.equal(indexed.status, 'indexed');
    }
    await assert.rejects(ingestKnowledge(store, 'tenant-a', upload.json().id, { content: 'Injected replacement without PDF extraction' }, options), /upload PDFs/);
    await app.inject({ method: 'PATCH', url: `/api/v1/knowledge/${remote.json().id}`, payload: { content: 'Changed without import' } });
    assert.equal(store.get('tenant-a', 'knowledge', remote.json().id)?.extraction, null);
    await assert.rejects(ingestKnowledge(store, 'tenant-a', remote.json().id, {}, options), /Import the URL/);
  } finally { await app.close(); store.close(); }
});
