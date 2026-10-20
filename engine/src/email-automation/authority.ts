import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Entity, Store } from '../store.js';
import { DomainError } from '../domains.js';
import { digest } from '../oauth/crypto.js';
import { accessible, oauthAuthorizationGeneration, oauthAuthorizationIdentity } from '../oauth/access.js';
import { resolveMembershipActor, resolveSessionActor, type MembershipActor } from '../memberships/service.js';
import { hasPermission } from '../memberships/permissions.js';
import { mailboxes, requireMailScope } from '../email-agents/service.js';

export const grants = 'email-automation-grants', jobs = 'email-automation-jobs', arrivals = 'email-automation-arrivals';
export function fail(code: string, status = 409): never { throw new DomainError(status, code, 'A automação de e-mail não pode executar esta operação.'); }
const initialized = new WeakSet<Store>();
/** Additive, no grants/default opt-in. Call on the database used by the worker. */
export function initializeEmailAutomation(store: Store) {
  if (initialized.has(store)) return;
  store.transaction(() => store.db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS email_auto_one_source ON entities(tenant_id,json_extract(body,'$.mailboxId'),json_extract(body,'$.sourceRemoteId'),json_extract(body,'$.action')) WHERE collection='email-automation-jobs';
    CREATE UNIQUE INDEX IF NOT EXISTS email_auto_one_arrival ON entities(tenant_id,json_extract(body,'$.grantId'),json_extract(body,'$.epoch'),json_extract(body,'$.sourceRemoteId')) WHERE collection='email-automation-arrivals';
    CREATE INDEX IF NOT EXISTS email_auto_due ON entities(collection,json_extract(body,'$.status'),json_extract(body,'$.nextSyncAt')) WHERE collection='email-automation-grants';
    CREATE INDEX IF NOT EXISTS email_auto_quota ON entities(tenant_id,json_extract(body,'$.grantId'),json_extract(body,'$.attemptedAt')) WHERE collection='email-automation-jobs';
    CREATE INDEX IF NOT EXISTS email_auto_mailbox_quota ON entities(tenant_id,json_extract(body,'$.mailboxId'),json_extract(body,'$.attemptedAt')) WHERE collection='email-automation-jobs';
    CREATE UNIQUE INDEX IF NOT EXISTS email_auto_one_reply ON entities(tenant_id,json_extract(body,'$.mailboxId'),json_extract(body,'$.messageId')) WHERE collection='email-reply-operations' AND json_extract(body,'$.automatic')=1;
    CREATE TRIGGER IF NOT EXISTS email_auto_member_removed AFTER DELETE ON memberships BEGIN
      UPDATE entities SET body=json_set(body,'$.status','revoked','$.revision',coalesce(json_extract(body,'$.revision'),0)+1,'$.reason','membership_removed')
      WHERE collection='email-automation-grants' AND tenant_id=OLD.tenant_id AND (json_extract(body,'$.issuerMembershipId')=OLD.id OR json_extract(body,'$.connectionOwnerMembershipId')=OLD.id);
    END;
    CREATE TRIGGER IF NOT EXISTS email_auto_role_revoked AFTER UPDATE OF role ON memberships WHEN NEW.role NOT IN ('owner','admin') BEGIN
      UPDATE entities SET body=json_set(body,'$.status','revoked','$.revision',coalesce(json_extract(body,'$.revision'),0)+1,'$.reason','issuer_role_revoked')
      WHERE collection='email-automation-grants' AND tenant_id=NEW.tenant_id AND json_extract(body,'$.issuerMembershipId')=NEW.id;
    END;
    CREATE TRIGGER IF NOT EXISTS email_auto_org_suspended AFTER UPDATE OF status ON organizations WHEN NEW.status!='active' BEGIN
      UPDATE entities SET body=json_set(body,'$.status','revoked','$.revision',coalesce(json_extract(body,'$.revision'),0)+1,'$.reason','organization_suspended') WHERE collection='email-automation-grants' AND tenant_id=NEW.id;
    END;
    CREATE TRIGGER IF NOT EXISTS email_auto_mailbox_changed AFTER UPDATE OF body ON entities WHEN NEW.collection='email-mailboxes' AND (json_extract(NEW.body,'$.revision') IS NOT json_extract(OLD.body,'$.revision') OR coalesce(json_extract(NEW.body,'$.syncEpoch'),0)!=coalesce(json_extract(OLD.body,'$.syncEpoch'),0)) BEGIN
      UPDATE entities SET body=json_set(body,'$.status','needs_reauthorization','$.revision',coalesce(json_extract(body,'$.revision'),0)+1,'$.reason','mailbox_configuration_changed') WHERE collection='email-automation-grants' AND tenant_id=NEW.tenant_id AND json_extract(body,'$.mailboxId')=NEW.id AND json_extract(body,'$.status') IN ('active','baselining','paused');
    END;
    CREATE TRIGGER IF NOT EXISTS email_auto_agent_changed AFTER UPDATE OF body ON entities WHEN NEW.collection='agents' AND json_remove(NEW.body,'$.updatedAt')!=json_remove(OLD.body,'$.updatedAt') BEGIN
      UPDATE entities SET body=json_set(body,'$.status','needs_reauthorization','$.revision',coalesce(json_extract(body,'$.revision'),0)+1,'$.reason','agent_configuration_changed') WHERE collection='email-automation-grants' AND tenant_id=NEW.tenant_id AND json_extract(body,'$.agentId')=NEW.id AND json_extract(body,'$.status') IN ('active','baselining','paused');
    END;
    CREATE TRIGGER IF NOT EXISTS email_auto_knowledge_changed AFTER UPDATE OF body ON entities WHEN NEW.collection='knowledge' AND json_remove(NEW.body,'$.updatedAt')!=json_remove(OLD.body,'$.updatedAt') BEGIN
      UPDATE entities SET body=json_set(body,'$.status','needs_reauthorization','$.revision',coalesce(json_extract(body,'$.revision'),0)+1,'$.reason','knowledge_changed') WHERE collection='email-automation-grants' AND tenant_id=NEW.tenant_id AND json_extract(body,'$.status') IN ('active','baselining','paused') AND json_extract(body,'$.mailboxId') IN (SELECT id FROM entities AS mailbox WHERE mailbox.tenant_id=NEW.tenant_id AND mailbox.collection='email-mailboxes' AND EXISTS (SELECT 1 FROM json_each(mailbox.body,'$.knowledgeIds') WHERE value=NEW.id));
    END;
  `));
  initialized.add(store);
}
const clock = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const minute = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
export const replyPolicySchema = z.object({
  authorizeAutomaticReplies: z.literal(true), recipient: z.literal('source_sender_only'), links: z.literal('none'),
  sendsPerDay: z.number().int().min(1).max(100).default(10), repliesPerRecipientPerDay: z.number().int().min(1).max(5).default(1),
  repliesPerThread: z.literal(1).default(1), minimumIntervalSeconds: z.number().int().min(60).max(3600).default(300),
  maxReplyChars: z.number().int().min(100).max(8000).default(4000),
}).strict();
export const policySchema = z.object({
  mode: z.enum(['sync_only', 'draft_review', 'auto_reply']), optIn: z.literal(true), previousRevision: z.number().int().positive().optional(),
  expiresInDays: z.number().int().min(1).max(90).default(30), syncIntervalSeconds: z.number().int().min(60).max(3600).default(60),
  generationsPerDay: z.number().int().min(1).max(100).default(20), reservedTokensPerDay: z.number().int().min(10000).max(5000000).default(500000),
  maxMessageAgeHours: z.number().int().min(1).max(168).default(24), aliases: z.array(z.string().email().max(254).transform(v => v.toLowerCase())).max(20).default([]),
  timezone: z.string().max(100).refine(v => { try { new Intl.DateTimeFormat('en', { timeZone: v }); return true; } catch { return false; } }).default('America/Sao_Paulo'),
  schedule: z.array(z.object({ weekday: z.number().int().min(0).max(6), start: clock, end: clock }).strict().refine(p => minute(p.start) < minute(p.end))).min(1).max(21).default([1, 2, 3, 4, 5].map(weekday => ({ weekday, start: '09:00', end: '18:00' }))),
  // No default here: hashes of existing sync/review grants must remain unchanged.
  replyPolicy: replyPolicySchema.optional(),
}).strict().refine(p => p.mode === 'auto_reply' ? !!p.replyPolicy : p.replyPolicy === undefined, { message: 'auto_reply exige autorização de envio separada; outros modos não a aceitam.' });
export type AutomationPolicy = z.infer<typeof policySchema>;
export function inSchedule(policy: AutomationPolicy, now: number) {
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: policy.timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(p => [p.type, p.value]));
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(values.weekday), at = Number(values.hour) * 60 + Number(values.minute);
  return policy.schedule.some(p => p.weekday === day && at >= minute(p.start) && at < minute(p.end));
}
const memberId = (store: Store, tenantId: string, userId: string) => store.db.prepare('SELECT id FROM memberships WHERE tenant_id=? AND user_id=?').get(tenantId, userId)?.id;
export function humanAuthority(store: Store, actor: MembershipActor, sessionHash: string) {
  const fresh = resolveSessionActor(store, sessionHash);
  if (!fresh || fresh.userId !== actor.userId || fresh.tenantId !== actor.tenantId || !hasPermission(fresh.role, 'integrations:manage') || !hasPermission(fresh.role, 'integrations:execute')) fail('email_automation_owner_required', 403);
  return fresh;
}
export function contextHash(store: Store, box: Entity) {
  const agent = store.get(box.tenantId, 'agents', String(box.agentId));
  if (!agent || agent.status === 'paused') fail('email_automation_agent_unavailable');
  const knowledge = (box.knowledgeIds as string[]).map(id => store.get(box.tenantId, 'knowledge', id));
  if (knowledge.some(k => !k)) fail('email_automation_knowledge_unavailable');
  return digest(JSON.stringify({ agent, knowledge }));
}
function connectionFor(store: Store, actor: MembershipActor, box: Entity) {
  const connection = store.get(box.tenantId, 'oauth-connections', String(box.connectionId));
  if (!box.enabled || !connection || !accessible(actor, connection) || connection.status !== 'connected' || !['google', 'microsoft'].includes(String(connection.provider)) || connection.provider !== box.provider || connection.remoteId !== box.providerRemoteId || String(connection.email).toLowerCase() !== box.address || !(connection.capabilities as string[])?.includes('email')) fail('email_automation_connection_unavailable', 403);
  requireMailScope(connection.provider, connection.scopes, 'email');
  if (!resolveMembershipActor(store, String(connection.userId), box.tenantId)) fail('email_automation_connection_owner_removed', 403);
  return connection;
}
export function resolveAutomation(store: Store, tenantId: string, grantId: string, now = Date.now(), expected?: { revision: unknown; epoch: unknown }) {
  const grant = store.get(tenantId, grants, grantId);
  if (!grant || !['baselining', 'active'].includes(String(grant.status))) fail('email_automation_inactive', 403);
  if (Number(grant.expiresAt) <= now) fail('email_automation_expired', 403);
  if (expected && (grant.revision !== expected.revision || grant.epoch !== expected.epoch)) fail('email_automation_changed', 403);
  const actor = resolveMembershipActor(store, String(grant.issuedByUserId), tenantId);
  if (!actor || !hasPermission(actor.role, 'integrations:manage') || !hasPermission(actor.role, 'integrations:execute') || memberId(store, tenantId, actor.userId) !== grant.issuerMembershipId) fail('email_automation_membership_changed', 403);
  const box = store.get(tenantId, mailboxes, String(grant.mailboxId));
  if (!box || box.revision !== grant.mailboxRevision || Number(box.syncEpoch ?? 0) !== grant.syncEpoch || box.agentId !== grant.agentId) fail('email_automation_mailbox_changed', 403);
  const connection = connectionFor(store, actor, box);
  if (memberId(store, tenantId, String(connection.userId)) !== grant.connectionOwnerMembershipId || oauthAuthorizationIdentity(connection) !== grant.connectionIdentity || oauthAuthorizationGeneration(connection) !== grant.connectionGeneration) fail('email_automation_connection_changed', 403);
  if (contextHash(store, box) !== grant.contextHash) fail('email_automation_context_changed', 403);
  const policy = policySchema.parse(grant.policy);
  if (digest(JSON.stringify(policy)) !== grant.policyHash) fail('email_automation_policy_changed', 403);
  if (policy.mode === 'auto_reply') requireAutomaticSend(connection);
  return { grant, box, connection, policy };
}
function requireAutomaticSend(connection: Entity) {
  if (!(connection.capabilities as string[])?.includes('email_send')) fail('email_automation_send_scope_required', 403);
  requireMailScope(connection.provider, connection.scopes, 'email_send');
}
export function publicGrant(grant: Entity) { return { id: grant.id, mailboxId: grant.mailboxId, mode: (grant.policy as AutomationPolicy).mode, policy: grant.policy, revision: grant.revision, status: grant.status, expiresAt: grant.expiresAt, activatedAt: grant.activatedAt ?? null, nextSyncAt: grant.nextSyncAt, reason: grant.reason ?? null, lastError: grant.lastError ?? null, automaticSendingAuthorized: grant.status === 'active' && (grant.policy as AutomationPolicy).mode === 'auto_reply', automaticSending: false }; }
export function automationSnapshot(store: Store, box: Entity) {
  const grant = store.list(box.tenantId, grants).filter(g => g.mailboxId === box.id).at(-1); if (!grant) return null;
  let enabled = false, status = String(grant.status);
  if (['active', 'baselining'].includes(status)) { try { resolveAutomation(store, box.tenantId, grant.id); enabled = true; } catch { status = Number(grant.expiresAt) <= Date.now() ? 'expired' : 'needs_reauthorization'; } }
  return { id: grant.id, status, mode: String((grant.policy as AutomationPolicy).mode), enabled };
}
export function activateAutomation(store: Store, actor: MembershipActor, sessionHash: string, mailboxId: string, input: unknown, now = Date.now(), assertAccess?: () => void) {
  initializeEmailAutomation(store); actor = humanAuthority(store, actor, sessionHash); const policy = policySchema.parse(input);
  return store.transaction(() => {
    assertAccess?.(); humanAuthority(store, actor, sessionHash);
    const box = store.get(actor.tenantId, mailboxes, mailboxId); if (!box) fail('email_mailbox_not_found', 404);
    const connection = connectionFor(store, actor, box), hash = contextHash(store, box);
    if (policy.mode === 'auto_reply') requireAutomaticSend(connection);
    const old = store.list(actor.tenantId, grants).filter(g => g.mailboxId === mailboxId).at(-1);
    if (old && old.revision !== policy.previousRevision) fail('email_automation_revision_conflict');
    if (old) store.update(actor.tenantId, grants, old.id, { status: 'revoked', revision: Number(old.revision) + 1, reason: 'replaced_by_explicit_activation' });
    const grant = store.create(actor.tenantId, grants, { mailboxId, agentId: box.agentId, connectionId: connection.id, issuedByUserId: actor.userId, issuerMembershipId: memberId(store, actor.tenantId, actor.userId), connectionOwnerMembershipId: memberId(store, actor.tenantId, String(connection.userId)), mailboxRevision: box.revision, syncEpoch: Number(box.syncEpoch ?? 0), connectionGeneration: oauthAuthorizationGeneration(connection), connectionIdentity: oauthAuthorizationIdentity(connection), contextHash: hash, policy, policyHash: digest(JSON.stringify(policy)), revision: Number(old?.revision ?? 0) + 1, epoch: randomUUID(), status: 'baselining', nextSyncAt: now, issuedAt: now, expiresAt: now + policy.expiresInDays * 86400000 });
    return publicGrant(grant);
  });
}
export function stopAutomation(store: Store, actor: MembershipActor, sessionHash: string, id: string, revision: number, status: 'paused' | 'revoked', now = Date.now(), assertAccess?: () => void) {
  humanAuthority(store, actor, sessionHash);
  return store.transaction(() => { assertAccess?.(); humanAuthority(store, actor, sessionHash); const grant = store.get(actor.tenantId, grants, id); if (!grant) fail('email_automation_not_found', 404); if (grant.revision !== revision) fail('email_automation_revision_conflict'); return publicGrant(store.update(actor.tenantId, grants, id, { status, revision: revision + 1, stoppedAt: now, reason: 'operator' })!); });
}
