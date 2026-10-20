import type { Entity, Store } from '../../store.js';
import type { MembershipActor } from '../../memberships/service.js';
import { seal, unseal } from '../../oauth/crypto.js';
import { CRMError, normalizeIdentifier, validateFieldValue } from '../schema.js';
import { audit, checkRevision, contactView, createContact, digest, getContact, lookupExact, transaction, updateContact } from '../service.js';
import { captureHuman, resolveCapture } from './authority.js';
import { baseFields, extractionPromptVersion, type CapturedSources, type CaptureSelection } from './extraction.js';
import { sourceEvent, sourceText } from './source-events.js';
import { fail, jobs, proposals, type Extraction } from './schema.js';

type ProposalData = { extraction: Extraction; sourceIds: string[]; sourceHashes: string[]; targetContactId: string | null; targetRevision: number | null; matchReason: string | null; transportIdentifier: string | null; conversationContactId: string | null; initialValues: Record<string, unknown> };
const context = (tenant: string, id: string) => `${tenant}:${id}:crm-capture-proposal`;
export function proposalData(row: Entity) { if (typeof row.encryptedData !== 'string') fail('capture_proposal_purged'); return unseal<ProposalData>(row.encryptedData, context(row.tenantId, row.id)); }

/** Exactly the identities a human review will create; transport is observed, not ownership or consent. */
function creationIdentifiers(data: ProposalData, includeClaims = true) {
  const claims = includeClaims ? data.extraction.identityClaims : [];
  const phones = data.transportIdentifier
    ? [{ kind: 'phone' as const, value: normalizeIdentifier('phone', data.transportIdentifier), source: 'transport' as const }]
    : claims.filter(c => c.kind === 'phone').map(c => ({ kind: 'phone' as const, value: normalizeIdentifier('phone', c.value), source: 'claim' as const }));
  const emails = claims.filter(c => c.kind === 'email').map(c => ({ kind: 'email' as const, value: normalizeIdentifier('email', c.value), source: 'claim' as const }));
  return [...phones, ...emails];
}
function target(store: Store, tenant: string, result: Extraction, sources: CapturedSources, selected: CaptureSelection) {
  const source = sources.at(-1)!.source, hits = new Set<string>(), identifiers = [...new Set([...(source.transportIdentifier ? [source.transportIdentifier] : []), ...result.identityClaims.map(c => normalizeIdentifier(c.kind, c.value))])];
  for (const identifier of identifiers) for (const hit of lookupExact(store, tenant, identifier).contacts) hits.add(hit.id);
  if (hits.size > 1 || source.conversationContactId && hits.size && !hits.has(source.conversationContactId)) return { id: null, reason: 'identity_conflict' };
  const id = source.conversationContactId || [...hits][0] || null;
  if (id) getContact(store, tenant, id);
  let reason: string | null = null;
  if (result.subject !== 'current_participant') reason = 'subject_requires_manual_resolution';
  else if (!id && (!selected.policy.captureContacts || !result.gate.satisfied)) reason = 'creation_gate_not_met';
  else if (!id && !source.transportIdentifier) reason = 'identity_requires_review';
  else if (id && !source.conversationContactId && (!selected.policy.allowTransportMatch || !source.transportIdentifier || !lookupExact(store, tenant, source.transportIdentifier).contacts.some(c => c.id === id))) reason = 'link_requires_review';
  return { id, reason };
}
export function persistProposal(store: Store, job: Entity, selected: CaptureSelection, sources: CapturedSources, extraction: Extraction, generation: { responseId: string | null; usage: unknown }, now: number) {
  const found = target(store, job.tenantId, extraction, sources, selected), contact = found.id ? getContact(store, job.tenantId, found.id) : null;
  const initialValues: Record<string, unknown> = {};
  for (const item of extraction.values) initialValues[item.fieldId] = contact ? baseFields.includes(item.fieldId) ? contact[item.fieldId as 'firstName'] : contact.fieldValues[item.fieldId] : undefined;
  const data: ProposalData = { extraction, sourceIds: sources.map(s => s.source.id), sourceHashes: sources.map(s => s.source.contentHash), targetContactId: found.id, targetRevision: contact?.revision ?? null, matchReason: found.reason, transportIdentifier: sources.at(-1)!.source.transportIdentifier ?? null, conversationContactId: sources.at(-1)!.source.conversationContactId, initialValues };
  const proposal = store.create(job.tenantId, proposals, { jobId: job.id, grantId: job.grantId, grantRevision: job.grantRevision, epoch: job.epoch, revision: 1, status: 'proposed', reason: found.reason, targetContactId: found.id, targetRevision: contact?.revision ?? null, conversationId: job.conversationId, expiresAt: now + 30 * 86400000, policyHash: selected.grant.policyHash, settingsHash: selected.grant.settingsHash, model: selected.grant.model, promptVersion: extractionPromptVersion, responseId: generation.responseId, usage: generation.usage });
  return store.update(job.tenantId, proposals, proposal.id, { encryptedData: seal(data, context(job.tenantId, proposal.id)) })!;
}
export function freshProposal(store: Store, tenant: string, id: string, now = Date.now()) {
  const row = store.get(tenant, proposals, id); if (!row) fail('capture_proposal_not_found', 404);
  if (Number(row.expiresAt) <= now) fail('capture_proposal_expired');
  const selected = resolveCapture(store, tenant, String(row.grantId), now, { revision: row.grantRevision, epoch: row.epoch }), data = proposalData(row);
  const sources = data.sourceIds.map((id, index) => { const source = sourceEvent(store, tenant, id); if (source.contentHash !== data.sourceHashes[index]) fail('capture_source_changed'); return { source, text: sourceText(store, source, now) }; });
  if (row.settingsHash !== selected.grant.settingsHash || row.policyHash !== selected.grant.policyHash) fail('capture_configuration_changed');
  return { row, data, sources, selected };
}
export function publicProposal(store: Store, tenant: string, id: string) {
  const row = store.get(tenant, proposals, id); if (!row) fail('capture_proposal_not_found', 404);
  let data = typeof row.encryptedData === 'string' && Number(row.expiresAt) > Date.now() ? proposalData(row) : null;
  if (data) {
    try {
      for (const [index, id] of data.sourceIds.entries()) {
        const source = sourceEvent(store, tenant, id), message = store.get(tenant, 'messages', source.messageId);
        if (source.expiresAt <= Date.now() || !message || source.contentHash !== data.sourceHashes[index] || digest(message.content) !== source.contentHash || !store.get(tenant, 'conversations', source.conversationId)) fail('capture_source_unavailable');
      }
    } catch { data = null; }
  }
  return { id: row.id, revision: row.revision, status: row.status, reason: row.reason ?? null, targetContactId: row.targetContactId, targetRevision: row.targetRevision, conversationId: row.conversationId, model: row.model, expiresAt: row.expiresAt, result: row.result ?? null, diff: data?.extraction.values.map(value => ({ ...value, previous: data.initialValues[value.fieldId] ?? null })) ?? [], candidate: data?.extraction.candidate ?? null, subject: data?.extraction.subject ?? null, gate: data?.extraction.gate ?? null, identityClaims: data?.extraction.identityClaims ?? [], creationIdentifiers: data && data.targetContactId === null ? creationIdentifiers(data) : [], evidenceAvailable: !!data };
}
export type HumanApplication = { actor: MembershipActor; sessionHash: string; key: string; proposalRevision: number; contactRevision: number | null; overrides?: Record<string, string | boolean>; selectedFieldIds?: string[] };
export function applyCaptureProposal(store: Store, tenant: string, id: string, authority: { kind: 'human'; input: HumanApplication; assertAccess?: () => void } | { kind: 'grant' }, now = Date.now()) {
  return transaction(store, () => {
    let human: ReturnType<typeof captureHuman> | undefined;
    if (authority.kind === 'human') { authority.assertAccess?.(); if (authority.input.actor.tenantId !== tenant) fail('capture_tenant_mismatch', 403); human = captureHuman(store, authority.input.actor, authority.input.sessionHash); }
    const existing = store.get(tenant, proposals, id); if (!existing) fail('capture_proposal_not_found', 404);
    const fingerprint = authority.kind === 'human' ? digest({ actorId: human!.userId, ...authority.input, sessionHash: undefined, actor: undefined, key: undefined }) : digest({ kind: 'grant', id });
    if (existing.status === 'applied') {
      if (authority.kind === 'human' ? existing.applicationKey !== digest(authority.input.key) || existing.applicationFingerprint !== fingerprint : (existing.authorization as any)?.kind !== 'crm_capture_grant') fail('capture_already_applied');
      return { ...(existing.result as object), replayed: true };
    }
    const { row, data, selected, sources } = freshProposal(store, tenant, id, now);
    if (row.status !== 'proposed') fail('capture_proposal_not_pending');
    if (authority.kind === 'human') { checkRevision({ revision: Number(row.revision) }, authority.input.proposalRevision); if (authority.input.contactRevision !== data.targetRevision) fail('revision_conflict'); }
    else if (selected.policy.mode !== 'auto_create_fill_empty') fail('capture_automatic_application_forbidden', 403);
    if (data.extraction.candidate !== 'person' || data.extraction.subject !== 'current_participant') fail('capture_subject_requires_resolution');
    const matching = target(store, tenant, data.extraction, sources, selected);
    if (matching.id !== data.targetContactId || matching.reason === 'identity_conflict') fail('capture_identity_changed');
    if (authority.kind === 'grant' && matching.reason) fail(`capture_${matching.reason}`);
    if (!data.targetContactId && (!selected.policy.captureContacts || !data.extraction.gate.satisfied)) fail('capture_creation_gate_not_met');
    const old = data.targetContactId ? getContact(store, tenant, data.targetContactId) : null;
    if (old) checkRevision(old, data.targetRevision!);
    const overrides = authority.kind === 'human' ? authority.input.overrides ?? {} : {}, selectedFields = authority.kind === 'human' ? authority.input.selectedFieldIds : undefined;
    const ids = data.extraction.values.map(v => v.fieldId);
    if (Object.keys(overrides).some(id => !ids.includes(id)) || selectedFields?.some(id => !ids.includes(id)) || selectedFields && new Set(selectedFields).size !== selectedFields.length) fail('capture_override_not_allowed');
    const patch: Record<string, any> = { fieldValues: {} }, metadata: Record<string, unknown> = {}, applied: string[] = [], skipped: string[] = [];
    for (const item of data.extraction.values) {
      if (selectedFields && !selectedFields.includes(item.fieldId)) continue;
      const value = Object.hasOwn(overrides, item.fieldId) ? overrides[item.fieldId] : item.value, base = baseFields.includes(item.fieldId);
      const previous = old ? base ? old[item.fieldId as 'firstName'] : old.fieldValues[item.fieldId] : undefined;
      // "Manter atualizado": a filled custom field is replaced only when the evidence states a different value.
      const refresh = !base && selected.settings.definitions.some(d => d.id === item.fieldId && d.keepUpdated === true) && previous !== value;
      if (previous !== undefined && previous !== null && previous !== '' && !refresh) { skipped.push(item.fieldId); continue; }
      if (base) { if (!selected.policy.captureContacts || typeof value !== 'string' || !value.trim() || value.length > 200) fail('capture_invalid_field_value'); patch[item.fieldId] = value; }
      else { const def = selected.settings.definitions.find(d => d.id === item.fieldId); if (!def || !selected.policy.allowedFieldIds.includes(item.fieldId) || !def.aiFill) fail('capture_field_not_allowed'); patch.fieldValues[item.fieldId] = validateFieldValue(def, value); }
      applied.push(item.fieldId); metadata[item.fieldId] = { ...(refresh && previous !== undefined && previous !== '' ? { replacedValue: previous } : {}), proposalId: id, jobId: row.jobId, sourceEventIds: data.sourceIds, sourceHashes: data.sourceHashes, model: row.model, origin: human ? 'human_review' : 'automation', baseRevision: data.targetRevision, humanOverride: Object.hasOwn(overrides, item.fieldId), recordedAt: new Date(now).toISOString() };
    }
    if (!applied.length) fail('capture_no_empty_fields');
    if (!old && !selected.settings.creationGate.trim() && (!patch.firstName || !patch.lastName)) fail('capture_creation_gate_incomplete');
    if (!old) {
      const identities = creationIdentifiers(data, authority.kind === 'human');
      patch.phones = identities.filter(c => c.kind === 'phone').map(c => ({ value: c.value }));
      patch.emails = identities.filter(c => c.kind === 'email').map(c => ({ value: c.value }));
      if (!patch.phones.length && !patch.emails.length) fail('capture_identifier_required');
      patch.nameMode = 'structured';
    }
    // No fake actor: automated writes record a grant principal; human reviews use the actual user.
    const principal = human?.userId ?? `capture-grant:${selected.grant.id}`, authorization = human ? { kind: 'human_review', userId: human.userId, membershipId: human.membershipId } : { kind: 'crm_capture_grant', grantId: selected.grant.id, issuerMembershipId: selected.grant.issuerMembershipId, epoch: selected.grant.epoch };
    const assertAccess = authority.kind === 'human' ? authority.assertAccess : undefined;
    const contact = old ? updateContact(store, tenant, old.id, patch, old.revision, principal, human ? 'conversation' : 'automation', assertAccess) : createContact(store, tenant, patch, principal, human ? 'conversation' : 'automation', undefined, assertAccess);
    store.update(tenant, 'contacts', contact.id, { fieldMetadata: { ...contact.fieldMetadata, ...Object.fromEntries(Object.entries(metadata).filter(([id]) => !baseFields.includes(id)).map(([id, provenance]) => [id, { ...contact.fieldMetadata[id], ...(provenance as object) }])) }, captureProvenance: { ...(old?.captureProvenance as object ?? {}), ...metadata } });
    const conversation = store.get(tenant, 'conversations', String(row.conversationId)); if (!conversation || conversation.contactId && conversation.contactId !== contact.id) fail('capture_conversation_binding_changed');
    store.update(tenant, 'conversations', conversation.id, { contactId: contact.id });
    const result = { contactId: contact.id, contactRevision: contact.revision, appliedFields: applied, skippedFields: skipped, authorization };
    store.update(tenant, proposals, id, { status: 'applied', revision: Number(row.revision) + 1, result, authorization, appliedAt: now, applicationFingerprint: fingerprint, ...(authority.kind === 'human' ? { applicationKey: digest(authority.input.key) } : {}) });
    store.update(tenant, jobs, String(row.jobId), { status: 'applied', result: { contactId: contact.id, proposalId: id }, leaseToken: null });
    audit(store, tenant, principal, 'capture_proposal_applied', contact.id, { proposalId: id, revision: contact.revision, fields: applied, authorization });
    return { ...result, replayed: false };
  });
}
export function dismissProposal(store: Store, actor: MembershipActor, sessionHash: string, id: string, revision: number, assertAccess?: () => void) {
  return transaction(store, () => {
    assertAccess?.(); captureHuman(store, actor, sessionHash); const row = store.get(actor.tenantId, proposals, id); if (!row) fail('capture_proposal_not_found', 404); checkRevision({ revision: Number(row.revision) }, revision); if (row.status !== 'proposed') fail('capture_proposal_not_pending');
    store.update(actor.tenantId, jobs, String(row.jobId), { status: 'dismissed' }); audit(store, actor.tenantId, actor.userId, 'capture_proposal_dismissed', id);
    return store.update(actor.tenantId, proposals, id, { status: 'dismissed', revision: revision + 1, dismissedBy: actor.userId, dismissedAt: Date.now() });
  });
}
export function safeApplicationError(store: Store, row: Entity, error: unknown) {
  const code = error instanceof CRMError ? error.code : 'capture_application_failed';
  if (store.get(row.tenantId, proposals, row.id)?.status === 'proposed') store.update(row.tenantId, proposals, row.id, { reason: code });
}
