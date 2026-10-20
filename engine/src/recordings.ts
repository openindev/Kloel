import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createHash, createHmac } from 'node:crypto';
import type { Store } from './store.js';
import { requireRequestPermission } from './memberships/access.js';
import { MembershipError } from './memberships/service.js';

/** Call recordings live in an S3-compatible bucket (LiveKit egress writes them). Playback = short-lived presigned GET. */
export const recordingStorage = () => {
  const e = process.env;
  if (!e.REC_S3_ACCESS_KEY || !e.REC_S3_SECRET || !e.REC_S3_BUCKET || !e.REC_S3_ENDPOINT) return;
  return { key: e.REC_S3_ACCESS_KEY, secret: e.REC_S3_SECRET, bucket: e.REC_S3_BUCKET, endpoint: e.REC_S3_ENDPOINT.replace(/\/$/, ''), region: e.REC_S3_REGION || 'auto', pathStyle: e.REC_S3_PATH_STYLE === '1' };
};
const hmac = (k: Buffer | string, d: string) => createHmac('sha256', k).update(d).digest();
const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());

export function presignGet(objectKey: string, expires = 3600, now = new Date(), method = 'GET'): string | undefined {
  const s = recordingStorage(); if (!s) return;
  const u = new URL(s.endpoint), host = s.pathStyle ? u.host : `${s.bucket}.${u.host}`;
  const path = (s.pathStyle ? `/${s.bucket}/` : '/') + objectKey.split('/').map(enc).join('/');
  const amz = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''), day = amz.slice(0, 8), scope = `${day}/${s.region}/s3/aws4_request`;
  const q: Record<string, string> = { 'X-Amz-Algorithm': 'AWS4-HMAC-SHA256', 'X-Amz-Credential': `${s.key}/${scope}`, 'X-Amz-Date': amz, 'X-Amz-Expires': String(expires), 'X-Amz-SignedHeaders': 'host' };
  const qs = Object.keys(q).sort().map(k => `${enc(k)}=${enc(q[k])}`).join('&');
  const canonical = [method, path, qs, `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const sts = ['AWS4-HMAC-SHA256', amz, scope, createHash('sha256').update(canonical).digest('hex')].join('\n');
  const kSig = hmac(hmac(hmac(hmac('AWS4' + s.secret, day), s.region), 's3'), 'aws4_request');
  return `${u.protocol}//${host}${path}?${qs}&X-Amz-Signature=${createHmac('sha256', kSig).update(sts).digest('hex')}`;
}

const RETENTION_MS = Number(process.env.RECORDING_RETENTION_DAYS || 30) * 86400_000;
/** Fonio parity: recordings are kept for 30 days, then deleted from storage and unlinked from the call. */
export async function sweepRecordings(store: Store, now = Date.now()) {
  if (!recordingStorage()) return 0;
  let n = 0;
  const tenants = (store.db.prepare('SELECT id FROM organizations').all() as { id: string }[]).map(r => r.id);
  for (const t of tenants) for (const c of store.list(t, 'conversations')) {
    if (typeof c.recordingKey !== 'string' || !c.recordingKey) continue;
    const at = Date.parse(String(c.endedAt ?? c.startedAt ?? c.createdAt)); if (!Number.isFinite(at) || now - at < RETENTION_MS) continue;
    const r = await fetch(presignGet(c.recordingKey, 300, new Date(), 'DELETE')!, { method: 'DELETE' }).catch(() => undefined);
    if (r && (r.ok || r.status === 404)) { store.update(t, 'conversations', c.id, { recordingKey: null, recordingDeletedAt: new Date().toISOString() }); n++; }
  }
  return n;
}
export function registerRecordings(app: FastifyInstance, store: Store) {
  if (process.env.NODE_ENV !== 'test') { const tm = setInterval(() => { void sweepRecordings(store).then(n => n && app.log.info({ n }, 'recordings_swept')).catch(() => {}); }, 6 * 3600_000); tm.unref(); }
  app.get('/api/v1/conversations/:id/recording', async (req: FastifyRequest, reply: FastifyReply) => {
    reply.header('Cache-Control', 'no-store');
    try {
      const actor = requireRequestPermission(store, req, 'conversations:read');
      const conv = store.get(actor.tenantId, 'conversations', String((req.params as { id: string }).id));
      const key = typeof conv?.recordingKey === 'string' ? conv.recordingKey : '';
      if (!conv || !key || !key.startsWith(`rec/${actor.tenantId}/`)) return reply.code(404).send({ error: { code: 'recording_not_found', message: 'Gravação não encontrada.' } });
      const url = presignGet(key, 3600);
      if (!url) return reply.code(503).send({ error: { code: 'recording_storage_not_configured', message: 'Armazenamento de gravações não configurado.' } });
      return reply.redirect(url, 302);
    } catch (e) {
      if (e instanceof MembershipError) return reply.code(e.statusCode).send({ error: { code: e.code, message: e.message } });
      throw e;
    }
  });
}
