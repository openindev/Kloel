import { randomUUID } from 'node:crypto';
import type { Entity, Store } from '../../store.js';
import { resolveMembershipActor, resolveSessionActor, type MembershipActor } from '../../memberships/service.js';
import { hasPermission, type Permission } from '../../memberships/permissions.js';
import { encryptionKey } from '../../oauth/crypto.js';
import { audit, checkRevision, digest, getSettings, transaction } from '../service.js';
import { enableCapture, captureSchedulerRunning } from './runtime.js';
import { fail, grants, policySchema, type CapturePolicy } from './schema.js';
import { providerAllowedForTenant, platformProvidersEnabled } from '../../platform-providers.js';

const initialized = new WeakSet<Store>();
const required: Permission[] = ['contacts:settings', 'contacts:write', 'conversations:read', 'agents:read', 'channels:read'];
export function initializeCRMCapture(store: Store) {
  if (initialized.has(store)) return;
  transaction(store, () => store.db.exec(`
    CREATE TABLE IF NOT EXISTS crm_source_events (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, tenant_id TEXT NOT NULL, dedup_key TEXT NOT NULL, body TEXT NOT NULL, UNIQUE(tenant_id,dedup_key));
    CREATE INDEX IF NOT EXISTS crm_source_scope ON crm_source_events(tenant_id,sequence);
    CREATE UNIQUE INDEX IF NOT EXISTS crm_capture_job_unique ON entities(tenant_id,json_extract(body,'$.grantId'),json_extract(body,'$.epoch'),json_extract(body,'$.sourceEventId')) WHERE collection='crm-capture-jobs';
    CREATE UNIQUE INDEX IF NOT EXISTS crm_capture_proposal_job ON entities(tenant_id,json_extract(body,'$.jobId')) WHERE collection='crm-capture-proposals';
    CREATE TRIGGER IF NOT EXISTS crm_capture_member_deleted AFTER DELETE ON memberships BEGIN
      UPDATE entities SET body=json_set(body,'$.status','revoked','$.revision',json_extract(body,'$.revision')+1,'$.reason','membership_removed') WHERE collection='crm-capture-grants' AND tenant_id=OLD.tenant_id AND json_extract(body,'$.issuerMembershipId')=OLD.id;
    END;
    CREATE TRIGGER IF NOT EXISTS crm_capture_member_role AFTER UPDATE OF role ON memberships WHEN NEW.role NOT IN ('owner','admin') BEGIN
      UPDATE entities SET body=json_set(body,'$.status','revoked','$.revision',json_extract(body,'$.revision')+1,'$.reason','membership_role_changed') WHERE collection='crm-capture-grants' AND tenant_id=NEW.tenant_id AND json_extract(body,'$.issuerMembershipId')=NEW.id;
    END;
    CREATE TRIGGER IF NOT EXISTS crm_capture_org_status AFTER UPDATE OF status ON organizations WHEN NEW.status!='active' BEGIN
      UPDATE entities SET body=json_set(body,'$.status','revoked','$.revision',json_extract(body,'$.revision')+1,'$.reason','organization_suspended') WHERE collection='crm-capture-grants' AND tenant_id=NEW.id;
    END;
    CREATE TRIGGER IF NOT EXISTS crm_capture_config_changed AFTER UPDATE OF body ON entities WHEN NEW.collection IN ('crm-settings','channels','agents') AND json_remove(NEW.body,'$.updatedAt')!=json_remove(OLD.body,'$.updatedAt') BEGIN
      UPDATE entities SET body=json_set(body,'$.status','needs_reauthorization','$.revision',json_extract(body,'$.revision')+1,'$.reason','configuration_changed') WHERE collection='crm-capture-grants' AND tenant_id=NEW.tenant_id AND json_extract(body,'$.status') IN ('active','paused') AND (NEW.collection='crm-settings' OR EXISTS(SELECT 1 FROM json_each(body,'$.bindings') WHERE json_extract(value,'$.channelId')=NEW.id OR json_extract(value,'$.agentId')=NEW.id));
    END;
    CREATE TRIGGER IF NOT EXISTS crm_capture_config_deleted AFTER DELETE ON entities WHEN OLD.collection IN ('crm-settings','channels','agents') BEGIN
      UPDATE entities SET body=json_set(body,'$.status','needs_reauthorization','$.revision',json_extract(body,'$.revision')+1,'$.reason','configuration_removed') WHERE collection='crm-capture-grants' AND tenant_id=OLD.tenant_id AND json_extract(body,'$.status') IN ('active','paused') AND (OLD.collection='crm-settings' OR EXISTS(SELECT 1 FROM json_each(body,'$.bindings') WHERE json_extract(value,'$.channelId')=OLD.id OR json_extract(value,'$.agentId')=OLD.id));
    END;
  `));
  initialized.add(store); enableCapture(store);
}
const membershipId = (store: Store, tenant: string, user: string) => store.db.prepare('SELECT id FROM memberships WHERE tenant_id=? AND user_id=?').get(tenant, user)?.id;
export function captureHuman(store: Store, actor: MembershipActor, sessionHash: string, manager = false) {
  const fresh = resolveSessionActor(store, sessionHash);
  const permissions: Permission[] = manager ? required : ['contacts:read', 'contacts:write', 'conversations:read'];
  if (!fresh || fresh.userId !== actor.userId || fresh.tenantId !== actor.tenantId || permissions.some(p => !hasPermission(fresh.role, p))) fail('capture_human_authority_required', 403);
  return { ...fresh, membershipId: String(membershipId(store, fresh.tenantId, fresh.userId)) };
}
export function providerBinding(tenant: string) {
  if (!providerAllowedForTenant(tenant) || !process.env.OPENAI_API_KEY) fail('capture_provider_unavailable', 403);
  encryptionKey();
  return { tenantId: tenant, model: process.env.CRM_CAPTURE_MODEL || process.env.OPENAI_MODEL || 'gpt-4.1-mini' };
}
export function channelBinding(store: Store, tenant: string, id: string) {
  const channel = store.get(tenant, 'channels', id), agent = channel && store.get(tenant, 'agents', String(channel.agentId));
  if (!channel || channel.enabled !== true || !agent || agent.status === 'paused' || !['phone', 'whatsapp', 'webchat'].includes(String(channel.type))) fail('capture_channel_unavailable', 403);
  if (channel.type === 'whatsapp' && channel.provider !== 'meta') fail('capture_channel_unavailable', 403);
  return { channelId: id, agentId: agent.id, type: String(channel.type), hash: digest({ channel, agent }) };
}
export function resolveCapture(store: Store, tenant: string, id: string, now = Date.now(), expected?: { revision: unknown; epoch: unknown }) {
  const grant = store.get(tenant, grants, id);
  if (!grant || grant.status !== 'active' || Number(grant.expiresAt) <= now) fail('capture_grant_inactive', 403);
  if (expected && (grant.revision !== expected.revision || grant.epoch !== expected.epoch)) fail('capture_grant_changed', 403);
  const actor = resolveMembershipActor(store, String(grant.issuedByUserId), tenant);
  if (!actor || required.some(p => !hasPermission(actor.role, p)) || membershipId(store, tenant, actor.userId) !== grant.issuerMembershipId) fail('capture_membership_changed', 403);
  const policy = policySchema.parse(grant.policy), settings = getSettings(store, tenant);
  if (digest(policy) !== grant.policyHash || digest(settings) !== grant.settingsHash || digest(providerBinding(tenant)) !== grant.providerHash) fail('capture_configuration_changed', 403);
  const bindings = policy.channelIds.map(id => channelBinding(store, tenant, id));
  if (digest(bindings) !== grant.bindingsHash) fail('capture_channel_changed', 403);
  if (policy.captureContacts && !settings.autoCapture || policy.allowedFieldIds.some(id => !settings.definitions.some(d => d.id === id && d.aiFill && d.status === 'active'))) fail('capture_settings_disabled', 403);
  return { grant, policy, settings, bindings, actor };
}
export function activateCapture(store: Store, actor: MembershipActor, sessionHash: string, raw: unknown, settingsRevision: number, previousGrantId: string | null, previousRevision: number | null, now = Date.now(), assertAccess?: () => void) {
  initializeCRMCapture(store); const policy = policySchema.parse(raw);
  return transaction(store, () => {
    assertAccess?.(); const fresh = captureHuman(store, actor, sessionHash, true), settings = getSettings(store, actor.tenantId); checkRevision(settings, settingsRevision);
    const provider = providerBinding(actor.tenantId), bindings = policy.channelIds.map(id => channelBinding(store, actor.tenantId, id));
    if (policy.captureContacts && !settings.autoCapture || policy.allowedFieldIds.some(id => !settings.definitions.some(d => d.id === id && d.status === 'active' && d.aiFill))) fail('capture_settings_disabled');
    const old = store.list(actor.tenantId, grants).at(-1);
    if (old ? old.id !== previousGrantId || old.revision !== previousRevision : previousGrantId !== null || previousRevision !== null) fail('capture_grant_revision_conflict');
    if (old) store.update(actor.tenantId, grants, old.id, { status: 'revoked', revision: Number(old.revision) + 1, reason: 'explicit_replacement' });
    const baseline = Number(store.db.prepare('SELECT coalesce(max(sequence),0) AS n FROM crm_source_events WHERE tenant_id=?').get(actor.tenantId)!.n);
    const grant = store.create(actor.tenantId, grants, { issuedByUserId: actor.userId, issuerMembershipId: fresh.membershipId, policy, policyHash: digest(policy), policyVersion: 1, settingsRevision, settingsHash: digest(settings), bindings, bindingsHash: digest(bindings), providerHash: digest(provider), model: provider.model, epoch: randomUUID(), revision: 1, status: 'active', issuedAt: now, expiresAt: now + policy.expiresInDays * 86400000, activatedAt: now, sourceBaselineSequence: baseline });
    audit(store, actor.tenantId, actor.userId, 'capture_grant_activated', grant.id, { mode: policy.mode, revision: 1 }); return grant;
  });
}
export function stopCapture(store: Store, actor: MembershipActor, sessionHash: string, id: string, revision: number, status: 'paused' | 'revoked', assertAccess?: () => void) {
  return transaction(store, () => {
    assertAccess?.(); captureHuman(store, actor, sessionHash, true); const grant = store.get(actor.tenantId, grants, id); if (!grant) fail('capture_grant_not_found', 404); checkRevision({ revision: Number(grant.revision) }, revision);
    const saved = store.update(actor.tenantId, grants, id, { status, revision: revision + 1, stoppedAt: Date.now(), reason: 'operator' })!;
    audit(store, actor.tenantId, actor.userId, `capture_grant_${status}`, id, { revision: revision + 1 }); return saved;
  });
}
export function publicCaptureGrant(store: Store, grant: Entity, now = Date.now()) {
  let effective = false, reason = grant.reason ?? null;
  try { resolveCapture(store, grant.tenantId, grant.id, now); effective = true; } catch { reason ??= 'grant_inactive_or_changed'; }
  const policy = grant.policy as CapturePolicy;
  return { id: grant.id, revision: grant.revision, status: grant.status, epoch: grant.epoch, policy, expiresAt: grant.expiresAt, activatedAt: grant.activatedAt, effective, captureEffective: effective && policy.captureContacts, aiFillEffective: effective && policy.allowedFieldIds.length > 0, automaticApplication: effective && policy.mode === 'auto_create_fill_empty', schedulerRunning: captureSchedulerRunning(store), reason };
}
