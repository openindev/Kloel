import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export const digest = (value: string) => createHash('sha256').update(value).digest('hex');

export function encryptionKey(): Buffer {
  const raw = process.env.OAUTH_ENCRYPTION_KEY || '';
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32 || key.toString('base64') !== raw) throw new Error('oauth_key_unavailable');
  return key;
}

/** AAD prevents moving an encrypted token between tenants, connections or providers. */
export function seal(value: unknown, context: string, key = encryptionKey()): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(context));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return ['v1', nonce.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function unseal<T>(value: string, context: string, key = encryptionKey()): T {
  const [version, nonce, tag, ciphertext, extra] = value.split('.');
  if (version !== 'v1' || !nonce || !tag || !ciphertext || extra) throw new Error('oauth_ciphertext_invalid');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(nonce, 'base64url'));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8')) as T;
}
