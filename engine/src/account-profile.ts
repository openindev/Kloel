import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Store } from './store.js';
import { assertRequestContext } from './request-context.js';
import { MembershipError, resolveSessionIdentity } from './memberships/service.js';
import { registerAccountPassword } from './account-password.js';

const name = z.string().trim().max(60).refine(value => !/[\u0000-\u001f\u007f]/.test(value));
const language = z.string().trim().min(2).max(50).refine(value => {
  try { return Boolean(new Intl.Locale(value)); } catch { return false; }
}).transform(value => new Intl.Locale(value).toString());
const phone = z.string().trim().max(40).transform(value => value.replace(/[ ()-]/g, '')).refine(value => value === '' || /^\+[1-9]\d{7,14}$/.test(value)).nullable();
const update = z.object({
  revision: z.number().int().min(0), firstName: name.refine(value => value.length > 0).optional(),
  lastName: name.optional(), language: language.optional(), phone: phone.optional(),
}).strict().refine(value => Object.keys(value).length > 1);
type ProfileRow = { user_id: string; first_name: string; last_name: string; phone: string | null; language: string; revision: number; created_at: string; updated_at: string };

function identity(store: Store, request: FastifyRequest) {
  assertRequestContext(store, request);
  const token = request.cookies?.kloel_session;
  const fresh = !request.apiKey && token ? resolveSessionIdentity(store, createHash('sha256').update(token).digest('hex')) : undefined;
  if (!fresh || fresh.userId !== request.identity?.userId) throw new MembershipError(401, 'human_session_required', 'Acesse sua conta para editar seu perfil.');
  return fresh.userId;
}
function profile(store: Store, userId: string) {
  const user = store.db.prepare('SELECT email FROM users WHERE id=?').get(userId);
  if (!user) throw new MembershipError(401, 'unauthorized', 'Conta indisponível.');
  const row = store.db.prepare('SELECT * FROM user_profiles WHERE user_id=?').get(userId) as ProfileRow | undefined;
  return {
    id: userId, email: String(user.email), firstName: row?.first_name ?? '', lastName: row?.last_name ?? '',
    phone: row?.phone ?? null, language: row?.language ?? 'pt-BR', revision: row?.revision ?? 0,
    profileCreatedAt: row?.created_at ?? null, updatedAt: row?.updated_at ?? null,
  };
}

/** Identity-level metadata is shared across memberships; roles and login credentials live elsewhere. */
export function initializeAccountProfiles(store: Store) {
  store.transaction(() => {
    const marker = '2026-10-18-account-profiles-v1';
    if (store.db.prepare('SELECT version FROM engine_migrations WHERE version=?').get(marker)) return;
    store.db.exec(`CREATE TABLE IF NOT EXISTS user_profiles (
      user_id TEXT PRIMARY KEY REFERENCES users(id), first_name TEXT NOT NULL, last_name TEXT NOT NULL,
      phone TEXT, language TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`);
    store.db.prepare('INSERT INTO engine_migrations(version,applied_at) VALUES(?,?)').run(marker, new Date().toISOString());
  });
}

export async function registerAccountProfile(app: FastifyInstance, store: Store) {
  initializeAccountProfiles(store);
  await registerAccountPassword(app, store);
  app.get('/api/v1/account/profile', async request => profile(store, identity(store, request)));
  app.patch('/api/v1/account/profile', async request => {
    const input = update.parse(request.body);
    return store.transaction(() => {
      const userId = identity(store, request), current = profile(store, userId);
      if (current.revision !== input.revision) throw new MembershipError(409, 'profile_revision_conflict', 'Seu perfil mudou em outra janela. Atualize antes de salvar.');
      const next = { ...current, ...input, revision: current.revision + 1 }, now = new Date().toISOString();
      store.db.prepare(`INSERT INTO user_profiles(user_id,first_name,last_name,phone,language,revision,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET first_name=excluded.first_name,last_name=excluded.last_name,
        phone=excluded.phone,language=excluded.language,revision=excluded.revision,updated_at=excluded.updated_at`)
        .run(userId, next.firstName, next.lastName, next.phone || null, next.language, next.revision, current.profileCreatedAt ?? now, now);
      return profile(store, userId);
    });
  });
}
