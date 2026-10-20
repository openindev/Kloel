import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { Store } from './store.js';
import { capabilitiesFor, roleSchema } from './memberships/permissions.js';
import { MembershipError, type MembershipActor } from './memberships/service.js';

export type ExpectedRequestContext = Readonly<{ userId: string; tenantId: string | null; membershipId: string | null; authorityVersion: string }>;
export type SessionContext = { context: ExpectedRequestContext; identity: { userId: string }; email: string; actor?: MembershipActor };
export const CONTEXT_HEADERS = Object.freeze({ userId: 'x-kloel-expected-user', tenantId: 'x-kloel-expected-tenant', membershipId: 'x-kloel-expected-membership', authorityVersion: 'x-kloel-expected-authority' });
const captured = new WeakMap<object, ExpectedRequestContext | undefined>();
const identifier = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

/** A precondition, never a credential. All four absent preserves legacy clients. */
export function parseExpectedRequestContext(request: Pick<FastifyRequest, 'headers'>): ExpectedRequestContext | undefined {
  if (captured.has(request)) return captured.get(request);
  const values = Object.values(CONTEXT_HEADERS).map(name => request.headers[name]);
  if (values.every(value => value === undefined)) { captured.set(request, undefined); return undefined; }
  const [userId, tenant, member, authorityVersion] = values;
  if (values.some(value => typeof value !== 'string') || !identifier.test(userId as string)
    || !(tenant === '-' || identifier.test(tenant as string)) || !(member === '-' || identifier.test(member as string))
    || (tenant === '-') !== (member === '-') || !/^[a-f0-9]{64}$/.test(authorityVersion as string)) {
    throw new MembershipError(400, 'invalid_context', 'Envie os quatro cabeçalhos de contexto válidos.');
  }
  const context = Object.freeze({ userId: userId as string, tenantId: tenant === '-' ? null : tenant as string,
    membershipId: member === '-' ? null : member as string, authorityVersion: authorityVersion as string });
  captured.set(request, context);
  return context;
}

/** One SQL snapshot binds the selected active membership to the exact live session.
 * Neither its secret hash nor the version inputs are returned to clients. */
export function resolveSessionContext(store: Store, sessionHash: string, now = Date.now()): SessionContext | undefined {
  const row = store.db.prepare(`SELECT u.id AS user_id,u.email,s.tenant_id AS selected_tenant,
    m.id AS membership_id,m.revision,m.role,o.id AS active_tenant
    FROM sessions s JOIN users u ON u.id=s.user_id
    LEFT JOIN memberships m ON m.user_id=u.id AND m.tenant_id=s.tenant_id
    LEFT JOIN organizations o ON o.id=m.tenant_id AND o.status='active'
    WHERE s.hash=? AND s.expires>?`).get(sessionHash, now);
  if (!row) return undefined;
  const role = roleSchema.safeParse(row.role), userId = String(row.user_id);
  const actor = row.active_tenant && row.membership_id && role.success ? { userId, tenantId: String(row.active_tenant), role: role.data } : undefined;
  const context = Object.freeze({ userId, tenantId: actor?.tenantId ?? null, membershipId: actor ? String(row.membership_id) : null,
    authorityVersion: digest(JSON.stringify(['kloel-request-context-v1', sessionHash, userId, row.selected_tenant ?? null,
      actor?.tenantId ?? null, row.membership_id ?? null, row.revision ?? null, actor?.role ?? null,
      actor ? [...capabilitiesFor(actor.role)].sort() : []])) });
  return { context, identity: { userId }, email: String(row.email), actor };
}

export function sameRequestContext(a: ExpectedRequestContext, b: ExpectedRequestContext): boolean {
  return a.userId === b.userId && a.tenantId === b.tenantId && a.membershipId === b.membershipId && a.authorityVersion === b.authorityVersion;
}

/** Recheck at effect boundaries, not globally around storage: accepted remote receipts
 * must remain durable even when this precondition no longer holds. */
export function assertRequestContext(store: Store, request: Pick<FastifyRequest, 'headers' | 'cookies'>, phase: 'admission' | 'in_flight' = 'in_flight'): void {
  const expected = parseExpectedRequestContext(request);
  if (!expected) return;
  const token = request.cookies?.kloel_session;
  const current = token ? resolveSessionContext(store, digest(token)) : undefined;
  if (!current || !sameRequestContext(expected, current.context)) {
    throw new MembershipError(409, phase === 'admission' ? 'context_mismatch' : 'context_changed_in_flight',
      phase === 'admission' ? 'O contexto da sessão mudou. Atualize antes de continuar.' : 'O contexto mudou durante a operação. Consulte o resultado antes de tentar novamente.');
  }
}

export function rejectExpectedRequestContext(request: Pick<FastifyRequest, 'headers'>): void {
  if (parseExpectedRequestContext(request)) throw new MembershipError(400, 'context_not_applicable', 'Esta autenticação não aceita uma precondição de contexto do navegador.');
}
