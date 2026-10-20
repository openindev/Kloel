import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Entity, Store } from '../store.js';
import { DomainError } from '../domains.js';
import { digest } from '../oauth/crypto.js';
import { hasPermission } from '../memberships/permissions.js';
import { assertRequestContext, resolveSessionContext, sameRequestContext } from '../request-context.js';

const fail = (status: number, code: string): never => { throw new DomainError(status, code, 'Consulte o recibo usando a sessão e autoridade originais. A consulta não repete o envio.'); };
const uuid = z.string().uuid(), keySchema = z.string().min(1).max(200);
export function captureEmailReceiptAuthority(store: Store, req: FastifyRequest) {
  assertRequestContext(store, req);
  const sessionHash = digest(req.cookies?.kloel_session ?? ''), initial = resolveSessionContext(store, sessionHash);
  if (req.apiKey || !req.cookies?.kloel_session || !initial?.actor || initial.actor.userId !== req.actor?.userId || initial.actor.tenantId !== req.actor?.tenantId) return fail(401, 'authentication_required');
  if (!hasPermission(initial.actor.role, 'integrations:execute')) return fail(403, 'forbidden');
  const assertCurrent = () => {
    assertRequestContext(store, req);
    const live = resolveSessionContext(store, sessionHash);
    if (!live?.actor || !sameRequestContext(initial.context, live.context)) return fail(409, 'context_changed_in_flight');
  };
  return { tenantId: initial.actor.tenantId, userId: initial.actor.userId, sessionHash, membershipId: initial.context.membershipId!, authorityVersion: initial.context.authorityVersion, assertCurrent };
}
export type EmailReceiptAuthority = ReturnType<typeof captureEmailReceiptAuthority>;
export function emailReceiptBinding(a: EmailReceiptAuthority, revision: number) {
  a.assertCurrent();
  return { schemaVersion: 1, userId: a.userId, sessionHash: a.sessionHash, membershipId: a.membershipId, authorityVersion: a.authorityVersion, expectedRevision: revision };
}
export function ownsEmailReceipt(op: Entity, a: EmailReceiptAuthority) {
  const binding = op.humanReceipt as ReturnType<typeof emailReceiptBinding> | undefined;
  return op.tenantId === a.tenantId && op.userId === a.userId && binding?.schemaVersion === 1 && binding.userId === a.userId && binding.sessionHash === a.sessionHash && binding.membershipId === a.membershipId && binding.authorityVersion === a.authorityVersion && op.automatic !== true;
}
export function emailOperationByKey(store: Store, tenantId: string, mailboxId: string, key: string) {
  const hash = digest(`${mailboxId}:${keySchema.parse(key)}`);
  const rows = store.db.prepare("SELECT body FROM entities WHERE tenant_id=? AND collection='email-reply-operations' AND json_extract(body,'$.keyHash')=? LIMIT 2").all(tenantId, hash);
  if (rows.length > 1) return fail(409, 'email_reply_receipt_unavailable');
  return rows[0] ? JSON.parse(String(rows[0].body)) as Entity : undefined;
}
/** Historical metadata only. No mailbox, OAuth identity, token refresh or provider I/O. */
export function getEmailReplyReceipt(store: Store, a: EmailReceiptAuthority, mailboxIdValue: unknown, keyValue: unknown) {
  a.assertCurrent();
  const mailboxId = uuid.parse(mailboxIdValue), key = keySchema.parse(keyValue), op = emailOperationByKey(store, a.tenantId, mailboxId, key);
  if (!op || op.mailboxId !== mailboxId || !ownsEmailReceipt(op, a)) return fail(404, 'email_reply_receipt_not_found');
  const expectedRevision = (op.humanReceipt as ReturnType<typeof emailReceiptBinding>).expectedRevision;
  if (!uuid.safeParse(op.id).success || !uuid.safeParse(op.draftId).success || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1 || !['pending', 'accepted', 'uncertain', 'not_sent'].includes(String(op.status)) || op.fingerprint !== digest(`${op.draftId}:${expectedRevision}`) || ![op.createdAt, op.updatedAt].every(value => z.string().datetime({ offset: true }).safeParse(value).success)) return fail(409, 'email_reply_receipt_unavailable');
  const errorCode = op.errorCode ?? null;
  if (errorCode !== null && (typeof errorCode !== 'string' || !/^[a-zA-Z0-9_:-]{1,100}$/.test(errorCode))) return fail(409, 'email_reply_receipt_unavailable');
  const result = { key, kind: 'email.reply' as const, id: op.id, mailboxId, draftId: String(op.draftId), expectedRevision, status: String(op.status), errorCode, requiresReconciliation: ['pending', 'uncertain'].includes(String(op.status)), delivered: false as const, delivery: 'not_confirmed' as const, automaticRetry: false as const, createdAt: op.createdAt, updatedAt: op.updatedAt };
  a.assertCurrent(); return result;
}
