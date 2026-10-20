import { inflateRawSync } from 'node:zlib';
import { DomainError } from './domains.js';

const IMAGE = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const AUDIO = new Set(['audio/mpeg', 'audio/wav', 'audio/mp4', 'audio/ogg', 'audio/webm', 'audio/flac', 'audio/x-m4a']);
const VIDEO = new Set(['video/mp4', 'video/webm', 'video/mpeg']);
export const MEDIA_MIME = [
  'application/pdf', 'text/plain', 'text/markdown', 'text/csv', 'application/json',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ...IMAGE, ...AUDIO, ...VIDEO,
] as const;

export function isBinaryMedia(mime: string) {
  return IMAGE.has(mime) || AUDIO.has(mime) || VIDEO.has(mime) || mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
}

/** DOCX is a zip. Read word/document.xml (stored or deflate) and drop the markup. */
export function docxText(bytes: Buffer): string {
  const parts: string[] = [];
  let offset = 0;
  while (offset + 30 < bytes.length) {
    if (bytes.readUInt32LE(offset) !== 0x04034b50) break;
    const method = bytes.readUInt16LE(offset + 8);
    const compressed = bytes.readUInt32LE(offset + 18);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = bytes.subarray(nameStart, nameStart + nameLength).toString('utf8');
    const data = bytes.subarray(dataStart, dataStart + compressed);
    if (name === 'word/document.xml') {
      let xml: Buffer;
      if (method === 0) xml = data;
      else if (method === 8) { try { xml = inflateRawSync(data); } catch { throw new DomainError(422, 'invalid_docx', 'O DOCX não pôde ser lido.'); } }
      else throw new DomainError(422, 'invalid_docx', 'O DOCX usa uma compressão não suportada.');
      const text = xml.toString('utf8').replace(/<w:p[ >]/g, '\n').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/[ \t]+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').trim();
      if (!text) throw new DomainError(422, 'empty_source', 'No readable text was found');
      return text.slice(0, 100_000);
    }
    if (name.endsWith('/') || compressed === 0) { offset = dataStart; continue; }
    offset = dataStart + compressed;
    parts.push(name);
  }
  throw new DomainError(422, 'invalid_docx', 'O arquivo não é um DOCX com texto.');
}

type FetchImpl = typeof fetch;
export async function describeMedia(bytes: Buffer, mime: string, filename: string, options: { fetch?: FetchImpl; apiKey?: string | null; model?: string | null } = {}) {
  const key = options.apiKey === undefined ? process.env.OPENAI_API_KEY : options.apiKey;
  if (!key) throw new DomainError(422, 'media_provider_unavailable', 'Para ler imagem, áudio ou vídeo, configure OPENAI_API_KEY no serviço kloel. Texto, PDF com texto selecionável e DOCX não dependem disso.');
  const call = options.fetch ?? globalThis.fetch;
  if (IMAGE.has(mime)) {
    const model = options.model === undefined ? (process.env.OPENAI_MODEL || 'gpt-4o-mini') : options.model;
    if (!model) throw new DomainError(422, 'media_provider_unavailable', 'Defina OPENAI_MODEL para descrever imagens.');
    const response = await call('https://api.openai.com/v1/chat/completions', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(45000), headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, max_tokens: 1200, messages: [{ role: 'user', content: [{ type: 'text', text: 'Extraia todo o texto visível e descreva a imagem em português, de forma factual. Não invente.' }, { type: 'image_url', image_url: { url: `data:${mime};base64,${bytes.toString('base64')}` } }] }] }) });
    if (!response.ok) throw new DomainError(502, 'media_provider_failed', 'Não foi possível ler a imagem.');
    const data = await response.json() as { choices?: { message?: { content?: string } }[] };
    const text = String(data.choices?.[0]?.message?.content ?? '').trim();
    if (!text) throw new DomainError(422, 'empty_source', 'No readable text was found');
    return { text: text.slice(0, 100_000), method: 'openai_vision', ocr: true as const };
  }
  if (AUDIO.has(mime) || VIDEO.has(mime)) {
    const boundary = `kloel${Date.now()}`;
    const safe = filename.replace(/[^\w.\-]+/g, '_').slice(0, 80) || 'media';
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safe}"\r\nContent-Type: ${mime}\r\n\r\n`),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const response = await call('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60000), headers: { Authorization: `Bearer ${key}`, 'Content-Type': `multipart/form-data; boundary=${boundary}` }, body });
    if (!response.ok) throw new DomainError(502, 'media_provider_failed', 'Não foi possível transcrever o arquivo. Vídeo usa a faixa de áudio e o limite é 10 MiB.');
    const data = await response.json() as { text?: string };
    const text = String(data.text ?? '').trim();
    if (!text) throw new DomainError(422, 'empty_source', 'No readable text was found');
    return { text: text.slice(0, 100_000), method: VIDEO.has(mime) ? 'openai_whisper_video' : 'openai_whisper', ocr: false as const };
  }
  throw new DomainError(415, 'unsupported_media', 'Este tipo de arquivo não é aceito.');
}
