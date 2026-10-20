import { createHmac, timingSafeEqual } from 'node:crypto';

export function sameSecret(a: string, b: string): boolean {
  const aa = Buffer.from(a); const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}

export function verifyStripeSignature(raw: Buffer, signature: string, secret: string, now = Date.now()): boolean {
  const parts = signature.split(',').map(part => part.trim().split('='));
  const timestamp = parts.find(([k]) => k === 't')?.[1];
  if (!timestamp || !/^\d+$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 300) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.`).update(raw).digest('hex');
  return parts.some(([k, v]) => k === 'v1' && !!v && sameSecret(v, expected));
}

export function verifyMetaSignature(raw: Buffer, signature: string, secret: string): boolean {
  return sameSecret(signature, `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`);
}

// Standard Webhooks format used by OpenAI. Timestamp limits replay lifetime;
// the caller must additionally deduplicate webhook-id before applying effects.
export function verifyOpenAISignature(raw: Buffer, id: string, timestamp: string, signature: string, secret: string, now = Date.now()): boolean {
  if (!id || !/^\d+$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 300) return false;
  const key = Buffer.from(secret.startsWith('whsec_') ? secret.slice(6) : secret, 'base64');
  if (!key.length) return false;
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.`).update(raw).digest('base64');
  return signature.split(' ').some(part => sameSecret(part, `v1,${expected}`));
}

export function escapeXML(value: string): string {
  return value.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]!));
}
