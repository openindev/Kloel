/** Browser origins only: no URL paths, credentials, wildcards or remote cleartext HTTP. */
export function canonicalWebchatOrigin(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2048 || value !== value.trim() || !/^https?:\/\//i.test(value) || /[\\\s*?#@]/.test(value)) return undefined;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash || url.origin === 'null') return undefined;
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) return undefined;
    return url.origin;
  } catch { return undefined; }
}

/** Link hospedado (/w/<empresa>/<assistente>): a página roda na própria origem pública da Kloel. */
export const hostedChatOrigin = (): string | undefined => canonicalWebchatOrigin(process.env.PUBLIC_BASE_URL || 'http://127.0.0.1:4310');
/** Publicação do link hospedado gravada no próprio canal de webchat (campo `hosted`). */
export function hostedLinkPublished(channel: Record<string, unknown> | undefined): boolean {
  const hosted = channel?.hosted as { published?: unknown; assistantSlug?: unknown } | undefined;
  return !!hosted && hosted.published === true && typeof hosted.assistantSlug === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(hosted.assistantSlug);
}
