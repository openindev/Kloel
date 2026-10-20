import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import ipaddr from 'ipaddr.js';
import { DomainError } from '../domains.js';

export type Address = { address: string; family: number };
export type SafeResponse = { status: number; headers: Record<string, string | undefined>; body: Buffer };
export type UrlOptions = {
  resolve?: (hostname: string) => Promise<Address[]>;
  request?: (url: URL, pinned: Address, maxBytes: number, timeoutMs: number) => Promise<SafeResponse>;
  maxBytes?: number;
  timeoutMs?: number;
};
const allowedTypes = new Set(['text/html', 'application/xhtml+xml', 'text/plain', 'text/markdown', 'text/csv', 'application/json', 'application/pdf']);

export function isPublicAddress(address: string): boolean {
  try {
    if (address === '168.63.129.16') return false; // Azure host platform virtual IP.
    const parsed = ipaddr.parse(address);
    // Reject mapped/translated IPv6 as well as special-use, private and multicast ranges.
    return parsed.range() === 'unicast';
  } catch { return false; }
}

export function publicUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new DomainError(400, 'invalid_url', 'Provide a public HTTP(S) URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (url.port && url.port !== (url.protocol === 'https:' ? '443' : '80'))) throw new DomainError(400, 'unsafe_url', 'Only public HTTP(S) URLs on standard ports without credentials are accepted');
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  if (!hostname || /(^|\.)(localhost|local|internal|home|lan|test|invalid)$/.test(hostname) || hostname === 'metadata.google.internal' || (ipaddr.isValid(hostname) && !isPublicAddress(hostname))) throw new DomainError(400, 'unsafe_url', 'Local and special-use destinations are not allowed');
  url.hash = '';
  return url;
}

export async function pinnedAddress(url: URL, resolve: UrlOptions['resolve'] = async hostname => lookup(hostname, { all: true, verbatim: true })): Promise<Address> {
  const hostname = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
  let addresses: Address[];
  if (ipaddr.isValid(hostname)) addresses = [{ address: hostname, family: ipaddr.parse(hostname).kind() === 'ipv4' ? 4 : 6 }];
  else {
    try { addresses = await resolve(hostname); }
    catch { throw new DomainError(502, 'dns_failed', 'The public URL hostname could not be resolved'); }
  }
  if (!addresses.length || addresses.some(item => ![4, 6].includes(item.family) || !isPublicAddress(item.address))) throw new DomainError(400, 'unsafe_destination', 'The hostname resolves to a private or special-use destination');
  return addresses[0];
}

export function requestPinned(url: URL, pinned: Address, maxBytes: number, timeoutMs: number): Promise<SafeResponse> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, result?: SafeResponse) => { if (settled) return; settled = true; clearTimeout(deadline); error ? reject(error) : resolve(result!); };
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
      method: 'GET', agent: false,
      headers: { Accept: [...allowedTypes].join(', '), 'Accept-Encoding': 'identity', 'User-Agent': 'KloelKnowledgeImporter/1.0' },
      // No second DNS resolution: the connect address is the already validated address.
      lookup: ((_hostname: string, options: { all?: boolean }, callback: (...args: any[]) => void) => options?.all ? callback(null, [pinned]) : callback(null, pinned.address, pinned.family)) as any,
    }, response => {
      const headers = Object.fromEntries(Object.entries(response.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : value]));
      const status = response.statusCode ?? 502;
      if ([301, 302, 303, 307, 308].includes(status)) { response.destroy(); finish(undefined, { status, headers, body: Buffer.alloc(0) }); return; }
      if (Number(response.headers['content-length'] ?? 0) > maxBytes) { response.destroy(); finish(new DomainError(413, 'source_too_large', 'The remote source exceeds the byte limit')); return; }
      if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') { response.destroy(); finish(new DomainError(415, 'unsupported_encoding', 'Compressed HTTP responses are not accepted')); return; }
      const parts: Buffer[] = []; let total = 0;
      response.on('data', (part: Buffer) => {
        total += part.length;
        if (total > maxBytes) { response.destroy(); finish(new DomainError(413, 'source_too_large', 'The remote source exceeds the byte limit')); return; }
        parts.push(part);
      });
      response.on('end', () => finish(undefined, { status, headers, body: Buffer.concat(parts) }));
      response.on('error', () => finish(new DomainError(502, 'source_download_failed', 'The remote source could not be downloaded')));
    });
    const deadline = setTimeout(() => { request.destroy(); finish(new DomainError(504, 'source_timeout', 'The remote source exceeded the time limit')); }, timeoutMs);
    request.on('error', () => finish(new DomainError(502, 'source_download_failed', 'The remote source could not be downloaded')));
    request.end();
  });
}

export async function fetchPublicUrl(value: string, options: UrlOptions = {}) {
  const maxBytes = options.maxBytes ?? 10 * 1024 * 1024;
  const timeout = options.timeoutMs ?? 15000;
  const started = Date.now();
  let url = publicUrl(value);
  const redirects: string[] = [];
  for (let count = 0; count <= 5; count++) {
    const remaining = timeout - (Date.now() - started);
    if (remaining <= 0) throw new DomainError(504, 'source_timeout', 'URL import exceeded the time limit');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([
      (async () => {
        const address = await pinnedAddress(url, options.resolve);
        if (Date.now() - started >= timeout) throw new DomainError(504, 'source_timeout', 'URL import exceeded the time limit');
        return (options.request ?? requestPinned)(url, address, maxBytes, Math.max(1, timeout - (Date.now() - started)));
      })(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new DomainError(504, 'source_timeout', 'URL import exceeded the time limit')), remaining); }),
    ]).finally(() => clearTimeout(timer));
    if ([301, 302, 303, 307, 308].includes(result.status)) {
      if (!result.headers.location || count === 5) throw new DomainError(422, 'invalid_redirect', 'The source has an invalid or excessive redirect chain');
      let destination: URL;
      try { destination = new URL(result.headers.location, url); } catch { throw new DomainError(422, 'invalid_redirect', 'The source returned an invalid redirect'); }
      url = publicUrl(destination.href);
      redirects.push(url.href);
      continue;
    }
    if (result.status !== 200) throw new DomainError(502, 'source_http_error', 'The remote source did not return HTTP 200');
    const contentType = String(result.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (!allowedTypes.has(contentType)) throw new DomainError(415, 'unsupported_source_type', 'The remote content type is not supported');
    if (result.body.length > maxBytes) throw new DomainError(413, 'source_too_large', 'The remote source exceeds the byte limit');
    return { body: result.body, contentType, sourceUrl: publicUrl(value).href, finalUrl: url.href, redirects, retrievedAt: new Date().toISOString() };
  }
  throw new DomainError(422, 'invalid_redirect', 'Too many redirects');
}
