import { createHash, randomUUID } from 'node:crypto';
import type { Entity, Store } from '../store.js';
import { hasPermission } from '../memberships/permissions.js';
import { CRMError, canonicalPhone, contactInput, contactPatch, legacyContactSchema, normalizeIdentifier, permissionInput, settingsInput, validateFieldValue, type ContactInput, type Endpoint, type FieldDefinition } from './schema.js';
import { captureAvailable } from './capture/runtime.js';

type Data = Record<string, any>;
export type CRMContact = Entity & { schemaVersion: 2; revision: number; name: string; displayName: string; nameMode: 'custom' | 'structured'; firstName: string; lastName: string; phones: Endpoint[]; emails: Endpoint[]; primaryPhoneId: string | null; primaryEmailId: string | null; ownerMembershipId: string | null; fieldValues: Record<string, string | boolean>; fieldMetadata: Data; company: string; notes: string; tags: string[]; timezone: string; source: string; legacySnapshot?: Data; migrationIssues: string[] };
export const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function transaction<T>(store: Store, fn: () => T): T {
  const name = `crm_${randomUUID().replaceAll('-', '')}`;
  store.db.exec(`SAVEPOINT ${name}`);
  try { const result = fn(); store.db.exec(`RELEASE ${name}`); return result; }
  catch (error) { store.db.exec(`ROLLBACK TO ${name}`); store.db.exec(`RELEASE ${name}`); throw error; }
}
const blankConsent = () => ({ whatsapp: false, email: false, phone: false, recordedAt: null, source: '' });
const deterministicId = (id: string, kind: string) => createHash('sha256').update(`${id}:${kind}`).digest('hex').slice(0, 32);
export function contactETag(row: CRMContact) { return `"contact:${row.id}:${row.revision}"`; }
export function expectedRevision(value: unknown, id: string, kind = 'contact'): number {
  if (typeof value !== 'string') throw new CRMError(428, 'precondition_required', 'Envie o ETag atual no cabeçalho If-Match.');
  const prefix = `"${kind}:${id}:`;
  if (!value.startsWith(prefix) || !/^\d+"$/.test(value.slice(prefix.length))) throw new CRMError(400, 'invalid_precondition', 'If-Match inválido.');
  const result = Number(value.slice(prefix.length, -1));
  if (!Number.isSafeInteger(result) || result < 0) throw new CRMError(400, 'invalid_precondition', 'Revisão inválida.');
  return result;
}
export function checkRevision(row: { revision: number }, expected: number) {
  if (!Number.isSafeInteger(expected) || expected !== row.revision) throw new CRMError(409, 'revision_conflict', 'O recurso mudou. Recarregue antes de salvar.');
}

/** Pure legacy projection. Reads never rewrite the source or promote legacy consent. */
export function canonicalContact(row: Entity): CRMContact {
  if (row.schemaVersion !== undefined && row.schemaVersion !== 2) throw new CRMError(409, 'unsupported_contact_schema', 'Versão de contato desconhecida; preserve o registro e revise a migração.');
  if (row.schemaVersion === 2) {
    if (!Number.isSafeInteger(row.revision) || !Array.isArray(row.phones) || !Array.isArray(row.emails) || !row.fieldValues) throw new CRMError(409, 'invalid_contact_record', 'Contato v2 inválido; reparo explícito necessário.');
    return row as CRMContact;
  }
  const issues: string[] = [];
  const endpoints = (kind: 'phone' | 'email'): Endpoint[] => {
    if (row[kind] === null || row[kind] === undefined || row[kind] === '') return [];
    if (typeof row[kind] !== 'string') { issues.push(`invalid_${kind}`); return []; }
    try { return [{ id: deterministicId(row.id, kind), value: String(row[kind]), normalized: normalizeIdentifier(kind, String(row[kind])), label: '' }]; }
    catch { issues.push(`invalid_${kind}`); return []; }
  };
  const phones = endpoints('phone'), emails = endpoints('email');
  const name = typeof row.name === 'string' ? row.name : '';
  if (!name) issues.push('missing_name');
  const consent = row.consent as Data | undefined;
  if (consent && ['email', 'phone', 'whatsapp'].some(key => consent[key] === true)) issues.push('legacy_consent_unverified');
  const parsed = legacyContactSchema.safeParse(Object.fromEntries(Object.keys(legacyContactSchema.shape).filter(key => row[key] !== undefined).map(key => [key, row[key]])));
  if (!parsed.success) issues.push('legacy_validation_required');
  const unknown = Object.keys(row).filter(key => !['id', 'tenantId', 'createdAt', 'updatedAt', ...Object.keys(legacyContactSchema.shape)].includes(key));
  if (unknown.length) issues.push('unmapped_legacy_fields');
  return { ...row, schemaVersion: 2, revision: 1, name, displayName: name, nameMode: 'custom', firstName: '', lastName: '', phones, emails,
    primaryPhoneId: phones[0]?.id ?? null, primaryEmailId: emails[0]?.id ?? null,
    phone: phones[0]?.normalized ?? null, email: emails[0]?.normalized ?? null,
    company: typeof row.company === 'string' ? row.company : '', notes: typeof row.notes === 'string' ? row.notes : '', tags: Array.isArray(row.tags) ? row.tags as string[] : [], timezone: typeof row.timezone === 'string' ? row.timezone : 'America/Sao_Paulo',
    ownerMembershipId: null, fieldValues: {}, fieldMetadata: {}, source: 'legacy', legacySnapshot: structuredClone(row), migrationIssues: issues, consent: blankConsent() };
}
export function getContact(store: Store, tenant: string, id: string) {
  const row = store.get(tenant, 'contacts', id);
  if (!row) throw new CRMError(404, 'not_found', 'Contact not found');
  return canonicalContact(row);
}
export function listContacts(store: Store, tenant: string) { return store.list(tenant, 'contacts').map(canonicalContact); }
export function contactView(row: CRMContact) {
  const { legacySnapshot, ...rest } = row;
  // Whitelist projection: unknown legacy fields remain in storage/export, never become public authority.
  const keys = ['id', 'tenantId', 'createdAt', 'updatedAt', 'schemaVersion', 'revision', 'name', 'displayName', 'nameMode', 'firstName', 'lastName', 'phones', 'emails', 'primaryPhoneId', 'primaryEmailId', 'phone', 'email', 'company', 'notes', 'tags', 'timezone', 'ownerMembershipId', 'fieldValues', 'fieldMetadata', 'captureProvenance', 'source', 'migrationIssues', 'consent'];
  return Object.fromEntries(keys.map(key => [key, rest[key]]));
}
export function initializeCRM(store: Store) {
  transaction(store, () => {
    const marker = '2026-10-18-crm-v2';
    if (store.db.prepare('SELECT version FROM engine_migrations WHERE version=?').get(marker)) return;
    for (const raw of store.db.prepare("SELECT body FROM entities WHERE collection='contacts'").all()) {
      const row = canonicalContact(JSON.parse(String(raw.body)));
      // Preserve timestamps and all unknown fields; migration is not a user edit.
      store.db.prepare("UPDATE entities SET body=? WHERE id=? AND tenant_id=? AND collection='contacts'").run(JSON.stringify(row), row.id, row.tenantId);
    }
    store.db.prepare('INSERT INTO engine_migrations(version,applied_at) VALUES(?,?)').run(marker, new Date().toISOString());
  });
}
export function getSettings(store: Store, tenant: string): { id: string; revision: number; autoCapture: boolean; creationGate: string; definitions: FieldDefinition[] } {
  const row = store.list(tenant, 'crm-settings')[0];
  return row ? row as any : { id: tenant, revision: 0, autoCapture: false, creationGate: '', definitions: [] };
}
export function saveSettings(store: Store, tenant: string, input: unknown, expected: number, actorId: string, assertAccess?: () => void) {
  return transaction(store, () => {
    assertAccess?.();
    const data = settingsInput.parse(input), old = getSettings(store, tenant); checkRevision(old, expected);
    if ((data.autoCapture || data.definitions.some(def => def.aiFill)) && !captureAvailable(store)) throw new CRMError(409, 'capability_unavailable', 'Captura automática ainda não tem executor; permanece desativada.');
    const previous = new Map(old.definitions.map(def => [def.id, def])), ids = new Set<string>(), keys = new Set<string>(), labels = new Set<string>(), conversions: FieldDefinition[] = [];
    const definitions: FieldDefinition[] = data.definitions.map(raw => {
      const before = raw.id ? previous.get(raw.id) : undefined;
      if (raw.id && !before) throw new CRMError(400, 'invalid_reference', 'Campo não pertence a esta configuração.');
      if (before && raw.key !== before.key) throw new CRMError(409, 'immutable_field_key', 'Identificador de importação é imutável.');
      const id = before?.id ?? randomUUID();
      if (ids.has(id) || keys.has(raw.key) || raw.status === 'active' && labels.has(raw.label.toLocaleLowerCase('pt-BR'))) throw new CRMError(409, 'duplicate_field', 'Campo, identificador ou nome duplicado.');
      ids.add(id); keys.add(raw.key); if (raw.status === 'active') labels.add(raw.label.toLocaleLowerCase('pt-BR'));
      const typeChanged = !!before && before.type !== raw.type;
      const optionIds = new Set<string>(), optionLabels = new Set<string>();
      const options = raw.options.map(option => {
        const prior = option.id ? before?.options.find(item => item.id === option.id) : undefined;
        if (option.id && !prior) throw new CRMError(400, 'invalid_reference', 'Opção não pertence ao campo.');
        const optionId = prior?.id ?? randomUUID();
        if (optionIds.has(optionId) || optionLabels.has(option.label.toLocaleLowerCase('pt-BR'))) throw new CRMError(409, 'duplicate_option', 'Opção duplicada.');
        optionIds.add(optionId); optionLabels.add(option.label.toLocaleLowerCase('pt-BR'));
        return { ...option, id: optionId };
      });
      if (before?.options.some(option => !optionIds.has(option.id))) throw new CRMError(409, 'option_requires_archive', 'Arquive opções em vez de removê-las.');
      if (raw.type === 'choice' ? options.filter(option => option.status === 'active').length < 1 && raw.status === 'active' : options.length > 0) throw new CRMError(400, 'invalid_options', 'Escolha exige opções; outros tipos não aceitam opções.');
      const content = { ...raw, id, options };
      // Definitions saved before findHint/keepUpdated/updateWhen existed compare with their defaults (no spurious revision).
      const priorContent = before && { ...fieldDefaults, ...Object.fromEntries(Object.entries(before).filter(([key]) => key !== 'revision')) };
      const definition = { ...content, revision: before ? before.revision + (sortedDigest(content) === sortedDigest(priorContent) ? 0 : 1) : 1 } as FieldDefinition;
      if (typeChanged) conversions.push(definition);
      return definition;
    });
    if (old.definitions.some(def => !ids.has(def.id))) throw new CRMError(409, 'field_requires_archive', 'Arquive campos explicitamente em vez de removê-los.');
    // "Apagar esses valores ao salvar": only the listed values that do not fit the new definition are removed, in this same transaction.
    const clear = new Map<string, Set<string>>();
    for (const item of data.clear) {
      if (!previous.has(item.fieldId) || !ids.has(item.fieldId)) throw new CRMError(400, 'unknown_field', 'Campo não pertence à organização.');
      for (const id of item.contactIds) clear.set(id, (clear.get(id) ?? new Set()).add(item.fieldId));
    }
    // Type change of a field in use: every stored value must convert to the new type (or be cleared), or nothing is saved.
    const changed: { contact: CRMContact; fieldValues: Record<string, string | boolean>; fieldMetadata: Data; converted: string[]; removed: string[] }[] = [];
    if (conversions.length || clear.size) {
      let incompatible = 0;
      for (const contact of listContacts(store, tenant)) {
        const wanted = clear.get(contact.id), fieldValues = { ...contact.fieldValues }, fieldMetadata = { ...contact.fieldMetadata }, converted: string[] = [], removed: string[] = [];
        for (const def of definitions) {
          const typeChanged = conversions.includes(def);
          if (!Object.hasOwn(contact.fieldValues, def.id) || !typeChanged && !wanted?.has(def.id)) continue;
          const value = fitFieldValue(previous.get(def.id)!, def, contact.fieldValues[def.id]);
          if (value === undefined && wanted?.has(def.id)) { delete fieldValues[def.id]; delete fieldMetadata[def.id]; removed.push(def.id); }
          else if (value === undefined) incompatible++;
          else if (typeChanged) { fieldValues[def.id] = value; converted.push(def.id); }
        }
        if (converted.length || removed.length) changed.push({ contact, fieldValues, fieldMetadata, converted, removed });
      }
      if (incompatible) throw new CRMError(409, 'field_type_in_use', `${incompatible} ${incompatible === 1 ? 'valor salvo não combina' : 'valores salvos não combinam'} com o novo tipo. Marque “Apagar esses valores ao salvar” ou mantenha o tipo anterior.`);
    }
    const value = { revision: old.revision + 1, autoCapture: data.autoCapture, creationGate: data.creationGate, definitions };
    const result = old.revision ? store.update(tenant, 'crm-settings', old.id, value)! : store.create(tenant, 'crm-settings', value);
    for (const { contact, fieldValues, fieldMetadata, converted, removed } of changed) {
      store.update(tenant, 'contacts', contact.id, { fieldValues, ...(removed.length ? { fieldMetadata } : {}), revision: contact.revision + 1 });
      if (converted.length) audit(store, tenant, actorId, 'field_values_converted', contact.id, { revision: contact.revision + 1, fields: converted });
      if (removed.length) audit(store, tenant, actorId, 'field_values_cleared', contact.id, { revision: contact.revision + 1, fields: removed });
    }
    audit(store, tenant, actorId, 'settings_updated', result.id, { revision: value.revision });
    return result;
  });
}
const fieldDefaults = { findHint: '', keepUpdated: false, updateWhen: '' };
const sortedDigest = (value: unknown) => digest(JSON.parse(JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)));
const yes = new Set(['sim', 's', 'true', 'verdadeiro', 'yes', '1']), no = new Set(['não', 'nao', 'n', 'false', 'falso', 'no', '0']);
/** Lossless conversion between field types; undefined means the stored value does not fit the new type. */
export function convertFieldValue(before: FieldDefinition, after: FieldDefinition, value: string | boolean): string | boolean | undefined {
  const text = typeof value === 'boolean' ? (value ? 'Sim' : 'Não') : before.type === 'choice' ? before.options.find(option => option.id === value)?.label ?? '' : String(value);
  if (!text.trim()) return undefined;
  if (after.type === 'text') return text.slice(0, 10000);
  if (after.type === 'boolean') { const key = text.trim().toLocaleLowerCase('pt-BR'); return yes.has(key) ? true : no.has(key) ? false : undefined; }
  if (after.type === 'number') { const raw = text.trim(), number = /^-?\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(raw) ? raw.replaceAll('.', '').replace(',', '.') : raw.replace(',', '.'); return /^-?(?:0|[1-9]\d*)(?:\.\d{1,12})?$/.test(number) && number.replace(/\D/g, '').length <= 38 ? number : undefined; }
  const option = after.options.find(item => item.status === 'active' && item.label.toLocaleLowerCase('pt-BR') === text.trim().toLocaleLowerCase('pt-BR'));
  return option?.id;
}
/** The one compatibility rule (web mirrors it in contacts/lib.ts fieldValueFits): the value stored under `after`, or undefined when it does not fit. */
export function fitFieldValue(before: FieldDefinition, after: FieldDefinition, value: string | boolean): string | boolean | undefined {
  if (before.type !== after.type) return convertFieldValue(before, after, value);
  return after.type !== 'choice' || after.options.some(option => option.id === value && option.status === 'active') ? value : undefined;
}
/** Explicit, audited removal of field values that no longer fit the field's current type or options (values that fit are kept). */
export function clearFieldValues(store: Store, tenant: string, input: { fieldId: string; contactIds: string[] }[], actorId: string, assertAccess?: () => void) {
  return transaction(store, () => {
    assertAccess?.();
    const settings = getSettings(store, tenant), byContact = new Map<string, Set<string>>();
    for (const item of input) {
      if (!settings.definitions.some(def => def.id === item.fieldId)) throw new CRMError(400, 'unknown_field', 'Campo não pertence à organização.');
      for (const id of item.contactIds) byContact.set(id, (byContact.get(id) ?? new Set()).add(item.fieldId));
    }
    let cleared = 0; const contacts: string[] = [];
    for (const [id, fields] of byContact) {
      const row = getContact(store, tenant, id), fieldValues = { ...row.fieldValues }, fieldMetadata = { ...row.fieldMetadata }, removed: string[] = [];
      for (const fieldId of fields) {
        const def = settings.definitions.find(item => item.id === fieldId)!;
        if (Object.hasOwn(fieldValues, fieldId) && fitFieldValue(def, def, fieldValues[fieldId]!) === undefined) { delete fieldValues[fieldId]; delete fieldMetadata[fieldId]; removed.push(fieldId); }
      }
      if (!removed.length) continue;
      store.update(tenant, 'contacts', id, { fieldValues, fieldMetadata, revision: row.revision + 1 });
      audit(store, tenant, actorId, 'field_values_cleared', id, { revision: row.revision + 1, fields: removed });
      cleared += removed.length; contacts.push(id);
    }
    return { cleared, contacts };
  });
}
/** Manual identity resolution: a person links a conversation to the contact they confirmed. */
export function linkConversation(store: Store, tenant: string, contactId: string, conversationId: string, actorId: string, replace = false, assertAccess?: () => void) {
  return transaction(store, () => {
    assertAccess?.();
    const contact = getContact(store, tenant, contactId), conversation = store.get(tenant, 'conversations', conversationId);
    if (!conversation) throw new CRMError(404, 'conversation_not_found', 'Conversa não encontrada.');
    const previous = typeof conversation.contactId === 'string' && conversation.contactId ? conversation.contactId : null;
    if (previous === contact.id) return { conversationId, contactId: contact.id, previousContactId: previous, changed: false };
    if (previous && store.get(tenant, 'contacts', previous) && !replace) throw new CRMError(409, 'conversation_already_linked', 'Esta conversa já está vinculada a outro contato. Confirme a troca para continuar.');
    store.update(tenant, 'conversations', conversationId, { contactId: contact.id });
    audit(store, tenant, actorId, 'conversation_linked', contact.id, { conversationId, previousContactId: previous });
    return { conversationId, contactId: contact.id, previousContactId: previous, changed: true };
  });
}
export function editableContact(row: CRMContact): ContactInput {
  return { firstName: row.firstName, lastName: row.lastName, displayName: row.displayName, nameMode: row.nameMode,
    phones: row.phones.map(({ normalized, ...endpoint }) => endpoint), emails: row.emails.map(({ normalized, ...endpoint }) => endpoint), primaryPhoneId: row.primaryPhoneId, primaryEmailId: row.primaryEmailId,
    company: row.company, notes: row.notes, tags: row.tags, timezone: row.timezone, ownerMembershipId: row.ownerMembershipId, fieldValues: row.fieldValues };
}
function normalizeContact(store: Store, tenant: string, data: ContactInput, previous?: CRMContact, actorId = '', source = 'manual'): Data {
  const normalizeEndpoints = (kind: 'phone' | 'email', inputs: ContactInput['phones']): Endpoint[] => {
    const old = previous?.[kind === 'phone' ? 'phones' : 'emails'] ?? [], seen = new Set<string>(), ids = new Set<string>();
    return inputs.map(input => {
      const normalized = normalizeIdentifier(kind, input.value), prior = input.id ? old.find(entry => entry.id === input.id) : undefined;
      if (input.id && !prior) throw new CRMError(400, 'invalid_reference', 'Identificador não pertence ao contato.');
      if (prior && prior.normalized !== normalized) throw new CRMError(409, 'identifier_identity_changed', 'Adicione o novo destino como outra entrada.');
      if (seen.has(normalized)) throw new CRMError(409, 'duplicate_identifier', 'Identificador repetido no contato.');
      seen.add(normalized); const id = prior?.id ?? randomUUID();
      if (ids.has(id)) throw new CRMError(409, 'duplicate_identifier', 'ID de entrada repetido.'); ids.add(id);
      return { id, value: input.value, normalized, label: input.label };
    });
  };
  const phones = normalizeEndpoints('phone', data.phones), emails = normalizeEndpoints('email', data.emails);
  const primary = (endpoints: Endpoint[], id: string | null | undefined) => {
    if (!endpoints.length) { if (id) throw new CRMError(400, 'invalid_primary', 'Primário não existe.'); return null; }
    if (id === undefined || id === null) return endpoints[0].id;
    if (!endpoints.some(endpoint => endpoint.id === id)) throw new CRMError(400, 'invalid_primary', 'Escolha um primário do contato.');
    return id;
  };
  const primaryPhoneId = primary(phones, data.primaryPhoneId), primaryEmailId = primary(emails, data.primaryEmailId);
  const nameMode = data.nameMode ?? (data.displayName !== undefined ? 'custom' : 'structured');
  const displayName = nameMode === 'custom' ? data.displayName ?? '' : `${data.firstName} ${data.lastName}`.trim();
  if (!displayName && !phones.length && !emails.length) throw new CRMError(400, 'contact_identity_required', 'Informe nome, telefone ou e-mail.');
  if (data.ownerMembershipId && data.ownerMembershipId !== previous?.ownerMembershipId) {
    const membership = store.db.prepare('SELECT tenant_id,role FROM memberships WHERE id=?').get(data.ownerMembershipId);
    if (!membership || membership.tenant_id !== tenant || !hasPermission(String(membership.role), 'contacts:read')) throw new CRMError(400, 'invalid_owner', 'Responsável indisponível nesta organização.');
  }
  const defs = new Map(getSettings(store, tenant).definitions.map(def => [def.id, def])), fieldValues: Record<string, string | boolean> = {}, fieldMetadata = { ...previous?.fieldMetadata };
  for (const [id, value] of Object.entries(data.fieldValues)) {
    if (value === null) { delete fieldMetadata[id]; continue; }
    const def = defs.get(id); if (!def) throw new CRMError(400, 'unknown_field', 'Campo não pertence à organização.');
    const unchanged = previous?.fieldValues[id] === value;
    fieldValues[id] = validateFieldValue(def, value, unchanged || source === 'import');
    if (!unchanged) fieldMetadata[id] = { definitionRevision: def.revision, source, actorId, updatedAt: new Date().toISOString() };
  }
  for (const id of Object.keys(fieldMetadata)) if (!Object.hasOwn(fieldValues, id)) delete fieldMetadata[id];
  return { ...data, schemaVersion: 2, nameMode, displayName, name: displayName || phones[0]?.normalized || emails[0]?.normalized,
    phones, emails, primaryPhoneId, primaryEmailId, phone: phones.find(p => p.id === primaryPhoneId)?.normalized ?? null, email: emails.find(e => e.id === primaryEmailId)?.normalized ?? null, fieldValues, fieldMetadata };
}
export function identifierKeys(row: Pick<CRMContact, 'phones' | 'emails'>) { return [...row.phones.map(x => `phone:${canonicalPhone(x.normalized)}`), ...row.emails.map(x => `email:${x.normalized}`)]; }
function preventDuplicate(store: Store, tenant: string, data: Data, exceptId?: string) {
  const keys = new Set(identifierKeys(data as CRMContact));
  const hits = listContacts(store, tenant).filter(row => row.id !== exceptId && identifierKeys(row).some(key => keys.has(key)));
  if (hits.length) throw new CRMError(409, hits.length > 1 ? 'identity_conflict' : 'duplicate_identifier', 'Identificador já corresponde a outro contato. Resolva a identidade explicitamente.');
}
export function createContact(store: Store, tenant: string, input: unknown, actorId: string, source = 'manual', legacyData?: Data, assertAccess?: () => void) {
  return transaction(store, () => {
    assertAccess?.();
    const data = normalizeContact(store, tenant, contactInput.parse(input), undefined, actorId, source); preventDuplicate(store, tenant, data);
    const row = store.create(tenant, 'contacts', { ...data, revision: 1, source, migrationIssues: legacyData ? ['imported_legacy_data_unverified'] : [], ...(legacyData ? { legacySnapshot: structuredClone(legacyData) } : {}), consent: blankConsent() }) as CRMContact;
    audit(store, tenant, actorId, 'created', row.id, { revision: 1 }); return row;
  });
}
export function updateContact(store: Store, tenant: string, id: string, input: unknown, expected: number, actorId: string, source = 'manual', assertAccess?: () => void) {
  return transaction(store, () => {
    assertAccess?.();
    const previous = getContact(store, tenant, id); checkRevision(previous, expected);
    const patch = contactPatch.parse(input), merged = { ...editableContact(previous), ...patch, fieldValues: patch.fieldValues ? { ...previous.fieldValues, ...patch.fieldValues } : previous.fieldValues };
    const data = normalizeContact(store, tenant, contactInput.parse(merged), previous, actorId, source);
    // Existing ambiguous legacy identities may remain unchanged, but new conflicts cannot be added.
    const oldKeys = new Set(identifierKeys(previous)), added = identifierKeys(data as CRMContact).filter(key => !oldKeys.has(key));
    if (added.length && listContacts(store, tenant).some(row => row.id !== id && identifierKeys(row).some(key => added.includes(key)))) throw new CRMError(409, 'duplicate_identifier', 'Novo identificador pertence a outro contato.');
    const captureProvenance = { ...(previous.captureProvenance as Data | undefined) };
    for (const [key, metadata] of Object.entries(captureProvenance)) {
      const priorValue = ['firstName', 'lastName', 'company'].includes(key) ? previous[key] : previous.fieldValues[key];
      const nextValue = ['firstName', 'lastName', 'company'].includes(key) ? data[key] : data.fieldValues[key];
      if (priorValue !== nextValue) captureProvenance[key] = { ...metadata, supersededAt: new Date().toISOString(), supersededBy: actorId, supersededSource: source };
    }
    const row = store.update(tenant, 'contacts', id, { ...previous, ...data, ...(Object.keys(captureProvenance).length ? { captureProvenance } : {}), revision: previous.revision + 1 }) as CRMContact;
    audit(store, tenant, actorId, 'updated', id, { revision: row.revision, fields: Object.keys(patch) }); return row;
  });
}
/** Legacy routes keep refusing linked contacts; the CRM route unlinks conversations/appointments/campaigns (kept, without the contact). */
export function deleteContact(store: Store, tenant: string, id: string, expected: number, actorId: string, assertAccess?: () => void, unlinkReferences = false) {
  return transaction(store, () => {
    assertAccess?.();
    const row = getContact(store, tenant, id); checkRevision(row, expected); let unlinked = 0;
    for (const [collection, field] of [['conversations', 'contactId'], ['appointments', 'contactId'], ['campaigns', 'contactIds']]) for (const item of store.list(tenant, collection)) {
      const linked = Array.isArray(item[field]) ? (item[field] as unknown[]).includes(id) : item[field] === id;
      if (!linked) continue;
      if (!unlinkReferences) throw new CRMError(409, 'resource_in_use', 'Contato possui vínculos.');
      store.update(tenant, collection, item.id, { [field]: Array.isArray(item[field]) ? (item[field] as unknown[]).filter(value => value !== id) : null }); unlinked++;
    }
    store.remove(tenant, 'contacts', id); audit(store, tenant, actorId, 'deleted', id, { revision: row.revision, unlinked });
  });
}
export function audit(store: Store, tenant: string, actorId: string, action: string, contactId: string, detail: Data = {}) { store.create(tenant, 'crm-audit', { actorId, action, contactId, detail }); }
export function legacyWriteData(input: Data, previous?: CRMContact) {
  if (input.consent && ['phone', 'email', 'whatsapp'].some(key => input.consent[key] === true)) throw new CRMError(409, 'consent_requires_evidence', 'Concessão exige registro de evidência próprio. Cadastro não concede permissão.');
  const result: Data = {};
  for (const key of ['company', 'notes', 'tags', 'timezone']) if (input[key] !== undefined) result[key] = input[key];
  if (input.name !== undefined) { result.displayName = input.name; result.nameMode = 'custom'; }
  for (const kind of ['phone', 'email'] as const) if (Object.hasOwn(input, kind)) {
    const listName = kind === 'phone' ? 'phones' : 'emails', primaryName = kind === 'phone' ? 'primaryPhoneId' : 'primaryEmailId';
    const endpoints = previous?.[listName] ?? [], primaryId = previous?.[primaryName];
    const previousPrimary = endpoints.find(endpoint => endpoint.id === primaryId);
    if (input[kind] === previousPrimary?.normalized) continue;
    if (endpoints.length > 1) throw new CRMError(409, 'primary_identifier_resolution_required', 'Use o editor multicanal para alterar o primário.');
    result[listName] = input[kind] ? [{ value: input[kind], label: previousPrimary?.label ?? '' }] : [];
    result[primaryName] = null;
  }
  return result;
}
export function createLegacyContact(store: Store, tenant: string, input: unknown, actorId: string, source = 'manual', assertAccess?: () => void) {
  const data = legacyContactSchema.parse(input); return createContact(store, tenant, legacyWriteData(data), actorId, source, undefined, assertAccess);
}
export function updateLegacyContact(store: Store, tenant: string, id: string, input: unknown, expected: number, actorId: string, source = 'manual', assertAccess?: () => void) {
  const patch = legacyContactSchema.partial().refine(value => Object.keys(value).length > 0, 'Empty patch').parse(input), old = getContact(store, tenant, id);
  if (patch.consent && digest(patch.consent) !== digest(old.consent)) throw new CRMError(409, 'consent_requires_evidence', 'Altere permissões pelo registro de evidências.');
  const writable = legacyWriteData(patch, old);
  return updateContact(store, tenant, id, Object.keys(writable).length ? writable : { notes: old.notes }, expected, actorId, source, assertAccess);
}
export function lookupExact(store: Store, tenant: string, query: string) {
  let normalized: string, kind: 'phone' | 'email';
  try { kind = query.includes('@') ? 'email' : 'phone'; normalized = normalizeIdentifier(kind, query); } catch { throw new CRMError(400, 'invalid_lookup', 'Informe e-mail ou telefone internacional exato.'); }
  const contacts = listContacts(store, tenant).filter(row => (kind === 'phone' ? row.phones : row.emails).some(item => (kind === 'phone' ? canonicalPhone(item.normalized) : item.normalized) === normalized));
  return { total: contacts.length, ambiguous: contacts.length > 1, contacts: contacts.slice(0, 50).map(row => ({ id: row.id, name: row.name, email: row.email, phone: row.phone, company: row.company, matchedIdentifier: normalized })) };
}
export function recordPermission(store: Store, tenant: string, contactId: string, input: unknown, expected: number, actorId: string, membershipId: string, assertAccess?: () => void) {
  return transaction(store, () => {
    assertAccess?.();
    const row = getContact(store, tenant, contactId); checkRevision(row, expected); const data = permissionInput.parse(input);
    if (Date.parse(data.occurredAt) > Date.now() + 60000) throw new CRMError(400, 'future_evidence', 'Data da evidência está no futuro.');
    const kind = data.channel === 'email' ? 'email' : 'phone', identifier = normalizeIdentifier(kind, data.identifier);
    if (!(kind === 'email' ? row.emails : row.phones).some(entry => entry.normalized === identifier)) throw new CRMError(400, 'invalid_identifier', 'Destino não pertence ao contato.');
    const previous = store.list(tenant, 'contact-permission-events').filter(event => event.contactId === contactId && event.channel === data.channel && event.identifier === identifier && event.purpose === data.purpose).at(-1);
    if (previous && (Date.parse(data.occurredAt) < Date.parse(String(previous.occurredAt)) || previous.event === 'revoked' && data.event === 'granted' && Date.parse(data.occurredAt) === Date.parse(String(previous.occurredAt)))) throw new CRMError(409, 'stale_evidence', 'Evidência antiga não substitui a decisão mais recente.');
    const result = store.create(tenant, 'contact-permission-events', { ...data, identifier, contactId, actorId, membershipId, recordedAt: new Date().toISOString() });
    store.update(tenant, 'contacts', contactId, { ...row, revision: row.revision + 1 });
    audit(store, tenant, actorId, `permission_${data.event}`, contactId, { eventId: result.id, revision: row.revision + 1 }); return result;
  });
}
export function permissionState(store: Store, tenant: string, contactId: string) {
  const row = getContact(store, tenant, contactId), latest = new Map<string, Entity>();
  for (const event of store.list(tenant, 'contact-permission-events').filter(event => event.contactId === contactId)) latest.set(`${event.channel}:${event.identifier}:${event.purpose}`, event);
  return { items: [...latest.values()].map(event => {
    const destinationPresent = (event.channel === 'email' ? row.emails : row.phones).some(entry => entry.normalized === event.identifier);
    return { channel: event.channel, identifier: event.identifier, purpose: event.purpose, status: event.event, eventId: event.id, occurredAt: event.occurredAt, source: event.source, recordedAt: event.recordedAt, destinationPresent, effective: destinationPresent && event.event === 'granted' };
  }), legacyStatus: (row.legacySnapshot?.consent && Object.values(row.legacySnapshot.consent).some(value => value === true)) ? 'legacy_unverified' : 'none' };
}
export function withReceipt<T>(store: Store, tenant: string, key: string, action: string, input: unknown, fn: () => T, assertAccess?: () => void): { result: T; replayed: boolean } {
  return transaction(store, () => {
    assertAccess?.();
    const fingerprint = digest({ action, input }), prior = store.list(tenant, 'crm-receipts').find(item => item.key === key);
    if (prior) { if (prior.fingerprint !== fingerprint) throw new CRMError(409, 'idempotency_conflict', 'Chave usada com outro conteúdo.'); return { result: prior.result as T, replayed: true }; }
    const result = fn(); store.create(tenant, 'crm-receipts', { key, fingerprint, result }); return { result, replayed: false };
  });
}
