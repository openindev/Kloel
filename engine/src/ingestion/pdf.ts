import { Worker } from 'node:worker_threads';
import { DomainError } from '../domains.js';

export type PdfExtraction = { text: string; pageCount: number; pages: { page: number; charStart: number; charEnd: number }[]; ocr: false };
let activeWorkers = 0;
const workerSource = `
const { parentPort, workerData } = require('node:worker_threads');
(async () => {
  const { getDocument } = await import(workerData.libraryUrl);
  const task = getDocument({ data: new Uint8Array(workerData.bytes), verbosity: 0, disableFontFace: true, useSystemFonts: false, useWorkerFetch: false, disableAutoFetch: true, disableStream: true, disableRange: true, enableXfa: false, stopAtErrors: true, useWasm: false });
  let doc;
  try {
    doc = await task.promise;
    if (doc.numPages > 200) throw new Error('page_limit');
    let text = ''; const pages = [];
    for (let number = 1; number <= doc.numPages; number++) {
      const page = await doc.getPage(number);
      const content = await page.getTextContent();
      const start = text.length;
      for (const item of content.items) if (typeof item.str === 'string') {
        text += item.str + (item.hasEOL ? '\\n' : ' ');
        if (text.length > 100000) throw new Error('text_limit');
      }
      pages.push({ page: number, charStart: start, charEnd: text.length });
      text += '\\n'; if (text.length > 100000) throw new Error('text_limit'); page.cleanup();
    }
    if (!text.trim()) throw new Error('no_text');
    parentPort.postMessage({ ok: true, result: { text, pageCount: doc.numPages, pages, ocr: false } });
  } finally { await task.destroy(); }
})().catch(error => parentPort.postMessage({ ok: false, code: error.name === 'PasswordException' ? 'password_required' : ['page_limit','text_limit','no_text'].includes(error.message) ? error.message : 'invalid_pdf' }));
`;

export async function extractPdf(bytes: Uint8Array, timeoutMs = 15000): Promise<PdfExtraction> {
  if (bytes.length > 10 * 1024 * 1024) throw new DomainError(413, 'source_too_large', 'PDF size exceeds 10 MiB');
  if (!Buffer.from(bytes.subarray(0, 1024)).includes(Buffer.from('%PDF-'))) throw new DomainError(422, 'invalid_pdf', 'The uploaded data is not a PDF');
  if (activeWorkers >= 2) throw new DomainError(429, 'pdf_busy', 'Two PDF documents are already being parsed; retry shortly');
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerSource, { eval: true, workerData: { bytes, libraryUrl: import.meta.resolve('pdfjs-dist/legacy/build/pdf.mjs') }, resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32 }, stdout: true, stderr: true });
    activeWorkers++;
    // Library diagnostics are not source content or API output; consume them without logging.
    worker.stdout.resume(); worker.stderr.resume();
    let completed = false;
    const finish = (error?: Error, result?: PdfExtraction) => { if (completed) return; completed = true; clearTimeout(timer); activeWorkers--; void worker.terminate(); error ? reject(error) : resolve(result!); };
    const timer = setTimeout(() => finish(new DomainError(422, 'pdf_timeout', 'PDF parsing exceeded the time limit')), timeoutMs);
    worker.on('message', message => {
      if (message.ok) finish(undefined, message.result);
      else finish(new DomainError(422, `pdf_${message.code}`, message.code === 'no_text' ? 'The PDF has no extractable text; OCR is not implemented' : 'The PDF could not be extracted within supported limits'));
    });
    worker.on('error', () => finish(new DomainError(422, 'pdf_parse_failed', 'PDF parsing failed or exceeded its memory limit')));
    worker.on('exit', () => { if (!completed) finish(new DomainError(422, 'pdf_parse_failed', 'PDF parser stopped before completing')); });
  });
}
