import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Store } from './store.js';
import { hashPassword } from './auth.js';
import { encryptionKey, seal, unseal } from './oauth/crypto.js';
import { auditApiKey } from './api-keys/service.js';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const tokenFormat = /^[A-Za-z0-9_-]{43}$/;
const requestSchema = z.object({ email: z.string().trim().toLowerCase().email().max(254) }).strict();
const resetSchema = z.object({ token: z.string().regex(tokenFormat), password: z.string().min(12).max(128), confirmation: z.string().min(12).max(128) }).strict().refine(v => v.password === v.confirmation);
const generic = { accepted: true, message: 'Se a conta existir e o envio estiver disponível, você receberá as instruções de recuperação.' };
type MailJob = { id: string; request_id: string | null; encrypted_payload: string | null; status: string; created_at: number };
type Payload = { kind: 'reset' | 'changed'; email: string; token?: string; userId: string | null; origin: string };
export type RecoveryOptions = { now?: () => number; fetchImpl?: typeof fetch; workers?: boolean };

function origin() {
  const value = new URL(process.env.APP_ORIGIN || 'http://127.0.0.1:4310');
  if (value.username || value.password || value.pathname !== '/' || value.search || value.hash || !(value.protocol === 'https:' || value.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(value.hostname))) throw new Error('Invalid recovery origin');
  return value.origin;
}
const context = (id: string) => `kloel:account-recovery:mail:${id}`;
function enqueue(store: Store, requestId: string | null, payload: Payload, now: number) {
  const id = randomUUID(), encrypted = seal(payload, context(id), encryptionKey());
  store.db.prepare('INSERT INTO auth_recovery_mail_jobs(id,request_id,encrypted_payload,status,created_at) VALUES(?,?,?,?,?)').run(id, requestId, encrypted, 'queued', now);
}
export function initializeAuthRecovery(store: Store) {
  store.transaction(() => {
    const marker = '2026-10-18-auth-recovery-v1';
    if (store.db.prepare('SELECT version FROM engine_migrations WHERE version=?').get(marker)) return;
    store.db.exec(`CREATE TABLE IF NOT EXISTS auth_recovery_requests (
      id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), email_hash TEXT NOT NULL, ip_hash TEXT NOT NULL,
      token_hash TEXT UNIQUE NOT NULL, password_fingerprint TEXT NOT NULL, expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL, consumed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS recovery_email_rate ON auth_recovery_requests(email_hash,created_at);
    CREATE INDEX IF NOT EXISTS recovery_ip_rate ON auth_recovery_requests(ip_hash,created_at);
    CREATE TABLE IF NOT EXISTS auth_recovery_mail_jobs (
      id TEXT PRIMARY KEY, request_id TEXT REFERENCES auth_recovery_requests(id), encrypted_payload TEXT,
      status TEXT NOT NULL, created_at INTEGER NOT NULL, completed_at INTEGER, provider_id TEXT
    );`);
    store.db.prepare('INSERT INTO engine_migrations(version,applied_at) VALUES(?,?)').run(marker, new Date().toISOString());
  });
}

/** Process one durable job, with no retry after a potentially accepted remote write. */
export async function processRecoveryMail(store: Store, options: RecoveryOptions = {}) {
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM) return false;
  const now = options.now ?? Date.now;
  const job = store.transaction(() => {
    const row = store.db.prepare("SELECT * FROM auth_recovery_mail_jobs WHERE status='queued' ORDER BY created_at,rowid LIMIT 1").get() as MailJob | undefined;
    if (row) store.db.prepare("UPDATE auth_recovery_mail_jobs SET status='pending' WHERE id=?").run(row.id);
    return row;
  });
  if (!job) return false;
  let attempted = false;
  const finish = (status: string, providerId: string | null = null) => store.db.prepare('UPDATE auth_recovery_mail_jobs SET status=?,encrypted_payload=NULL,completed_at=?,provider_id=? WHERE id=?').run(status, now(), providerId, job.id);
  try {
    const payload = unseal<Payload>(job.encrypted_payload!, context(job.id), encryptionKey());
    if (!payload.userId) { finish('ignored'); return true; }
    const user = store.db.prepare('SELECT email,password FROM users WHERE id=?').get(payload.userId);
    if (!user || user.email !== payload.email) { finish('obsolete'); return true; }
    if (payload.kind === 'reset') {
      const request = store.db.prepare('SELECT * FROM auth_recovery_requests WHERE id=?').get(job.request_id!);
      if (!request || request.user_id !== payload.userId || request.consumed_at !== null || Number(request.expires_at) <= now() || request.password_fingerprint !== digest(String(user.password))) { finish('obsolete'); return true; }
    }
    const text = payload.kind === 'reset'
      ? `Você solicitou a recuperação de acesso à Kloel AI. Abra o link em até 15 minutos:\n\n${payload.origin}/reset-password#token=${payload.token}\n\nSe não solicitou, ignore esta mensagem. Sua senha continua a mesma até concluir a redefinição.`
      : 'Sua senha da Kloel AI foi redefinida. Todas as sessões e chaves API criadas pela sua conta foram revogadas. Se você não realizou essa ação, inicie a recuperação de acesso e revise suas integrações.';
    attempted = true;
    const response = await (options.fetchImpl ?? fetch)('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': `auth-recovery-${job.id}` },
      body: JSON.stringify({ from: process.env.RESEND_FROM, to: [payload.email], subject: payload.kind === 'reset' ? 'Recupere seu acesso à Kloel AI' : 'Senha da Kloel AI redefinida', text }),
      redirect: 'error', signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) { await response.body?.cancel(); finish(response.status >= 400 && response.status < 500 ? 'rejected' : 'uncertain'); return true; }
    const data = await response.json() as { id?: unknown };
    if (typeof data.id !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(data.id)) throw new Error('Invalid email receipt');
    finish('accepted', data.id); return true;
  } catch { finish(attempted ? 'uncertain' : 'not_sent'); return true; }
}

export async function registerAuthRecovery(app: FastifyInstance, store: Store, options: RecoveryOptions = {}) {
  initializeAuthRecovery(store);
  const now = options.now ?? Date.now;
  app.post('/api/v1/auth/forgot-password', { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { email } = requestSchema.parse(request.body);
    const emailHash = digest(email), ipHash = digest(request.ip), createdAt = now();
    // Always enqueue using the same path for known and unknown identities; network timing never reaches this response.
    const token = randomBytes(32).toString('base64url'), publicOrigin = origin();
    encryptionKey();
    store.transaction(() => {
      const hour = createdAt - 3600000;
      const count = (column: 'email_hash' | 'ip_hash', hash: string) => Number(store.db.prepare(`SELECT COUNT(*) AS n FROM auth_recovery_requests WHERE ${column}=? AND created_at>?`).get(hash, hour)!.n);
      if (count('email_hash', emailHash) >= 3 || count('ip_hash', ipHash) >= 20 || Number(store.db.prepare('SELECT COUNT(*) AS n FROM auth_recovery_requests WHERE created_at>?').get(hour)!.n) >= 1000) return;
      const user = store.db.prepare('SELECT id,password FROM users WHERE lower(email)=?').get(email);
      const id = randomUUID();
      store.db.prepare('INSERT INTO auth_recovery_requests(id,user_id,email_hash,ip_hash,token_hash,password_fingerprint,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?)')
        .run(id, user ? String(user.id) : null, emailHash, ipHash, digest(token), digest(user ? String(user.password) : token), createdAt + 15 * 60000, createdAt);
      enqueue(store, id, { kind: 'reset', email, token, userId: user ? String(user.id) : null, origin: publicOrigin }, createdAt);
    });
    return reply.code(202).send(generic);
  });
  app.post('/api/v1/auth/reset-password', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const input = resetSchema.parse(request.body), timestamp = now();
    const publicOrigin = origin(); encryptionKey();
    const completed = store.transaction(() => {
      const row = store.db.prepare('SELECT * FROM auth_recovery_requests WHERE token_hash=?').get(digest(input.token));
      if (!row || !row.user_id || row.consumed_at !== null || Number(row.expires_at) <= timestamp) return false;
      const user = store.db.prepare('SELECT email,password FROM users WHERE id=?').get(String(row.user_id));
      if (!user || row.email_hash !== digest(String(user.email).toLowerCase()) || row.password_fingerprint !== digest(String(user.password))) return false;
      const newHash = hashPassword(input.password);
      store.db.prepare('UPDATE users SET password=? WHERE id=?').run(newHash, String(row.user_id));
      store.db.prepare('UPDATE auth_recovery_requests SET consumed_at=? WHERE user_id=? AND consumed_at IS NULL').run(timestamp, String(row.user_id));
      store.db.prepare('DELETE FROM sessions WHERE user_id=?').run(String(row.user_id));
      for (const key of store.db.prepare('SELECT id,tenant_id FROM api_keys WHERE creator_id=? AND revoked_at IS NULL').all(String(row.user_id))) {
        store.db.prepare('UPDATE api_keys SET revoked_at=?,revoked_by=? WHERE id=?').run(new Date(timestamp).toISOString(), String(row.user_id), String(key.id));
        auditApiKey(store, { tenantId: String(key.tenant_id), keyId: String(key.id), actorId: String(row.user_id), action: 'revoked', detail: { reason: 'password_reset' } });
      }
      enqueue(store, null, { kind: 'changed', email: String(user.email), userId: String(row.user_id), origin: publicOrigin }, timestamp);
      return true;
    });
    if (!completed) return reply.code(400).send({ error: { code: 'invalid_reset_link', message: 'Este link é inválido, foi utilizado ou expirou.' } });
    reply.clearCookie('kloel_session', { path: '/' });
    return { reset: true, loginRequired: true, sessionsRevoked: true, apiKeysRevoked: true };
  });
  let timer: ReturnType<typeof setInterval> | undefined, active: Promise<unknown> | undefined;
  app.addHook('onReady', async () => {
    if (!options.workers) return;
    store.db.prepare("UPDATE auth_recovery_mail_jobs SET status='uncertain',encrypted_payload=NULL,completed_at=? WHERE status='pending'").run(now());
    const tick = () => { if (!active) active = processRecoveryMail(store, options).catch(() => {}).finally(() => { active = undefined; }); };
    timer = setInterval(tick, 1000); timer.unref(); tick();
  });
  return { stop: async () => { if (timer) clearInterval(timer); await active; } };
}
