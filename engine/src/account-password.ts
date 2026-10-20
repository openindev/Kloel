import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Store } from './store.js';
import { hashPassword, validPassword, sessionDigest } from './auth.js';
import { assertRequestContext, parseExpectedRequestContext, resolveSessionContext, sameRequestContext } from './request-context.js';
import { MembershipError } from './memberships/service.js';

const collection = 'account_password_operations';
const operationKey = z.string().uuid();
const inputSchema = z.object({ operationKey, currentPassword: z.string().min(1).max(128), password: z.string().min(12).max(128), confirmation: z.string().min(12).max(128) }).strict()
  .refine(v => v.password === v.confirmation && v.password !== v.currentPassword);
const operationId = (user: string, key: string) => createHash('sha256').update(JSON.stringify(['account-password-v1', user, key])).digest('hex');

function authority(store: Store, request: FastifyRequest) {
  const expected = parseExpectedRequestContext(request);
  if (!expected || request.apiKey) throw new MembershipError(400, 'context_required', 'Atualize sua sessão antes de alterar a senha.');
  assertRequestContext(store, request);
  const token = request.cookies?.kloel_session, current = token ? resolveSessionContext(store, sessionDigest(token)) : undefined;
  if (!current?.actor || current.identity.userId !== request.identity?.userId || !sameRequestContext(current.context, expected)) throw new MembershipError(401, 'human_session_required', 'Acesse sua conta para alterar a senha.');
  return { context: current.context, tenantId: current.actor.tenantId, userId: current.identity.userId, sessionHash: sessionDigest(token!) };
}

/** Adapt the existing account form; receipts contain no password, token or password digest. */
export async function registerAccountPassword(app: FastifyInstance, store: Store) {
  app.get('/api/v1/account/password/operations/:key', async request => {
    const key = operationKey.parse((request.params as { key: string }).key), actor = authority(store, request);
    const row = store.get(actor.tenantId, collection, operationId(actor.userId, key));
    if (!row || !sameRequestContext(row.context as typeof actor.context, actor.context)) throw new MembershipError(404, 'password_operation_not_found', 'Alteração de senha não encontrada nesta sessão.');
    return { operationKey: key, changed: true, changedAt: row.createdAt, otherSessionsRevoked: true };
  });
  app.post('/api/v1/account/password', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async request => {
    const input = inputSchema.parse(request.body);
    return store.transaction(() => {
      const actor = authority(store, request), id = operationId(actor.userId, input.operationKey);
      if (store.get(actor.tenantId, collection, id)) throw new MembershipError(409, 'password_operation_exists', 'Consulte o resultado da alteração anterior.');
      const user = store.db.prepare('SELECT password FROM users WHERE id=?').get(actor.userId);
      if (!user || !validPassword(input.currentPassword, String(user.password))) throw new MembershipError(400, 'current_password_invalid', 'Senha atual incorreta.');
      const nextHash = hashPassword(input.password);
      authority(store, request);
      store.db.prepare('UPDATE users SET password=? WHERE id=? AND password=?').run(nextHash, actor.userId, String(user.password));
      store.db.prepare('DELETE FROM sessions WHERE user_id=? AND hash<>?').run(actor.userId, actor.sessionHash);
      const now = new Date().toISOString();
      const receipt = { id, tenantId: actor.tenantId, context: actor.context, operationKey: input.operationKey, createdAt: now, updatedAt: now };
      store.db.prepare('INSERT INTO entities(id,tenant_id,collection,body) VALUES(?,?,?,?)').run(id, actor.tenantId, collection, JSON.stringify(receipt));
      return { operationKey: input.operationKey, changed: true, changedAt: now, otherSessionsRevoked: true };
    });
  });
}
