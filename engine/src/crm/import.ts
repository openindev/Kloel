import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Store } from '../store.js';
import { hasPermission } from '../memberships/permissions.js';
import { crmHandler, humanCRM, receiptKey } from '../crm.js';
import { importAuthority, performImportOperation, readImportOperation } from './import-operations.js';
import { CRMError, contactInput, crmId, definitionInput, normalizeIdentifier, validateFieldValue, type ContactInput, type FieldDefinition } from './schema.js';
import { canonicalContact, contactView, createContact, digest, editableContact, getSettings, identifierKeys, listContacts, saveSettings, transaction, updateContact, withReceipt, type CRMContact } from './service.js';

const MAX_BYTES = 2 * 1024 * 1024;
const bundleSchema = z.object({ format: z.literal('kloel.contacts'), version: z.literal(2), definitions: z.array(definitionInput.extend({ revision: z.number().int().positive().optional() })).max(100), contacts: z.array(z.object({ sourceId: crmId.optional(), revision: z.number().int().positive().optional(), data: contactInput, legacyData: z.record(z.unknown()).optional() }).strict()).max(2000) }).strict();
const optionsSchema = z.object({ bundle: bundleSchema, mode: z.enum(['create', 'merge', 'update_by_id']).default('create'), mergePolicy: z.enum(['fill_empty', 'overwrite_supplied']).default('fill_empty'), ownerMapping: z.record(crmId.nullable()).default({}) }).strict();
type Presence = { fields: string[]; phoneLabels: boolean[]; emailLabels: boolean[] };
type ImportOptions = z.infer<typeof optionsSchema> & { presence: Presence[] };
function parse(input: unknown): ImportOptions {
  if (Buffer.byteLength(JSON.stringify(input), 'utf8') > MAX_BYTES) throw new CRMError(413, 'import_too_large', 'Importação JSON limitada a 2 MiB e 2.000 contatos.');
  const parsed = optionsSchema.parse(input);
  // Defaults validate a complete new record; they are never evidence that a merge
  // caller supplied a value. Preserve presence before the schema materializes them.
  const presence = parsed.bundle.contacts.map((_record, index) => {
    const original = (input as { bundle: { contacts: { data: Record<string, unknown> }[] } }).bundle.contacts[index].data;
    const labels = (key: string) => Array.isArray(original[key]) ? (original[key] as Record<string, unknown>[]).map(entry => Object.hasOwn(entry, 'label')) : [];
    return { fields: Object.keys(original), phoneLabels: labels('phones'), emailLabels: labels('emails') };
  });
  return { ...parsed, presence };
}
function prepareDefinitions(store: Store, tenant: string, input: ImportOptions) {
  const settings = getSettings(store, tenant), proposed = settings.definitions.map(def => structuredClone(def));
  const seen = new Set<string>(), sourceIds = new Set<string>();
  for (const source of input.bundle.definitions) {
    if (seen.has(source.key) || source.id && sourceIds.has(source.id)) throw new CRMError(400, 'duplicate_field', 'Definição repetida no arquivo.');
    seen.add(source.key); if (source.id) sourceIds.add(source.id);
    const suppliedOptionIds = source.options.flatMap(option => option.id ? [option.id] : []);
    if (new Set(suppliedOptionIds).size !== suppliedOptionIds.length) throw new CRMError(400, 'duplicate_option', 'IDs de opções repetidos no arquivo.');
    if (source.aiFill) throw new CRMError(409, 'capability_unavailable', 'Importação não habilita IA.');
    const old = proposed.find(def => def.key === source.key);
    if (old) {
      if (old.type !== source.type || source.options.some(option => !old.options.some(existing => existing.label === option.label))) throw new CRMError(409, 'definition_conflict', 'Definição existente incompatível; resolva campos/opções antes da importação.');
    } else {
      const id = `import_${digest({ tenant, key: source.key }).slice(0, 32)}`;
      proposed.push({ ...source, id, revision: 1, options: source.options.map(option => ({ ...option, id: `option_${digest({ id, label: option.label }).slice(0, 32)}` })) });
    }
  }
  if (proposed.length > 100) throw new CRMError(400, 'field_limit', 'Limite de 100 definições excedido.');
  const labels = new Set<string>();
  for (const def of proposed) {
    if (def.status === 'active') { const label = def.label.toLocaleLowerCase('pt-BR'); if (labels.has(label)) throw new CRMError(409, 'duplicate_field', 'Nome de campo duplicado.'); labels.add(label); }
    const options = new Set(def.options.map(option => option.label.toLocaleLowerCase('pt-BR')));
    if (options.size !== def.options.length || def.type === 'choice' && (!def.options.length || def.status === 'active' && !def.options.some(option => option.status === 'active')) || def.type !== 'choice' && def.options.length) throw new CRMError(400, 'invalid_options', 'Opções inválidas.');
  }
  return { settings, proposed };
}
function remapData(store: Store, tenant: string, input: ImportOptions, source: ContactInput, definitions: FieldDefinition[]) {
  const data = structuredClone(source), values: Record<string, string | boolean> = {};
  for (const [key, value] of Object.entries(data.fieldValues)) {
    if (value === null) continue;
    const origin = input.bundle.definitions.find(def => def.id === key || def.key === key);
    if (!origin) throw new CRMError(400, 'unknown_field', 'Valor sem definição no arquivo.');
    const target = definitions.find(def => def.key === origin.key)!;
    let mapped = value;
    if (origin.type === 'choice') {
      const option = origin.options.find(option => option.id === value);
      const destination = option && target.options.find(candidate => candidate.label === option.label);
      if (!destination) throw new CRMError(400, 'invalid_field_value', 'Opção de origem não encontrada.'); mapped = destination.id;
    }
    values[target.id] = validateFieldValue(target, mapped, true);
  }
  data.fieldValues = values;
  if (data.ownerMembershipId) {
    if (Object.hasOwn(input.ownerMapping, data.ownerMembershipId)) data.ownerMembershipId = input.ownerMapping[data.ownerMembershipId];
    const owner = data.ownerMembershipId && store.db.prepare('SELECT id,role FROM memberships WHERE id=? AND tenant_id=?').get(data.ownerMembershipId, tenant);
    if (data.ownerMembershipId && (!owner || !hasPermission(String(owner.role), 'contacts:read'))) throw new CRMError(400, 'invalid_owner', 'Mapeie o responsável para um membro disponível do destino.');
  }
  for (const [kind, entries, primary] of [['phone', data.phones, data.primaryPhoneId], ['email', data.emails, data.primaryEmailId]] as const) {
    const keys = entries.map(entry => normalizeIdentifier(kind, entry.value));
    if (new Set(keys).size !== keys.length) throw new CRMError(409, 'duplicate_identifier', 'Identificador repetido na linha.');
    const ids = entries.flatMap(entry => entry.id ? [entry.id] : []);
    if (new Set(ids).size !== ids.length) throw new CRMError(400, 'duplicate_identifier', 'IDs de entradas repetidos na linha.');
    if (primary && !entries.some(entry => entry.id === primary)) throw new CRMError(400, 'invalid_primary', 'Primário de origem inválido.');
  }
  return data;
}
const keysForData = (data: ContactInput) => [...data.phones.map(entry => `phone:${normalizeIdentifier('phone', entry.value)}`), ...data.emails.map(entry => `email:${normalizeIdentifier('email', entry.value)}`)];
export function previewCRMImport(store: Store, tenant: string, raw: unknown) {
  const input = parse(raw), { settings, proposed } = prepareDefinitions(store, tenant, input), contacts = listContacts(store, tenant), seen = new Set<string>(), targets = new Set<string>();
  const rows = input.bundle.contacts.map((record, i) => {
    try {
      const data = remapData(store, tenant, input, record.data, proposed), keys = keysForData(data);
      if (keys.some(key => seen.has(key))) throw new CRMError(409, 'duplicate_in_file', 'Identificador repetido no arquivo.'); keys.forEach(key => seen.add(key));
      const matches = contacts.filter(contact => identifierKeys(contact).some(key => keys.includes(key)));
      if (matches.length > 1) throw new CRMError(409, 'identity_conflict', 'A linha corresponde a contatos diferentes.');
      let target = matches[0];
      if (input.mode === 'update_by_id') {
        target = contacts.find(contact => contact.id === record.sourceId)!;
        if (!target || record.revision !== target.revision) throw new CRMError(409, 'revision_conflict', 'ID/revisão não disponível no tenant de destino.');
        if (matches.length && matches[0].id !== target.id) throw new CRMError(409, 'identity_conflict', 'Identificador pertence a outro contato.');
      } else if (input.mode === 'create' && target) throw new CRMError(409, 'duplicate_identifier', 'Contato já existe. Use mescla explicitamente.');
      if (target && targets.has(target.id)) throw new CRMError(409, 'duplicate_in_file', 'Duas linhas alterariam o mesmo contato.'); if (target) targets.add(target.id);
      if (!data.displayName && !data.firstName && !data.lastName && !keys.length) throw new CRMError(400, 'contact_identity_required', 'Contato sem nome ou identificador.');
      return { line: i + 1, action: target ? 'merge' : 'create', targetId: target?.id, expectedRevision: target?.revision, data, legacyData: record.legacyData, errors: [] as { code: string; message: string }[] };
    } catch (error) {
      return { line: i + 1, action: 'error', errors: [{ code: error instanceof CRMError ? error.code : 'validation_error', message: error instanceof Error ? error.message : 'Dados inválidos.' }] };
    }
  });
  const fingerprint = digest({ input, settings, contacts: store.list(tenant, 'contacts'), tenant, normalizer: 'crm-v2-1' });
  return { fingerprint, canCommit: rows.every(row => !row.errors.length), summary: { total: rows.length, create: rows.filter(row => row.action === 'create').length, merge: rows.filter(row => row.action === 'merge').length, error: rows.filter(row => row.action === 'error').length }, rows, definitionsToCreate: proposed.filter(def => !settings.definitions.some(old => old.key === def.key)).map(def => def.key) };
}
function stripEntryIds(data: ContactInput) { return { ...data, phones: data.phones.map(({ id, ...entry }) => entry), emails: data.emails.map(({ id, ...entry }) => entry), primaryPhoneId: null, primaryEmailId: null }; }
function mergeData(old: CRMContact, incoming: ContactInput, overwrite: boolean, presence: Presence): ContactInput {
  const result = editableContact(old);
  for (const key of ['firstName', 'lastName', 'displayName', 'company', 'notes', 'timezone'] as const) if (presence.fields.includes(key) && incoming[key] !== undefined && (overwrite || !result[key])) (result as any)[key] = incoming[key];
  if (presence.fields.includes('nameMode') && incoming.nameMode && (overwrite || !old.displayName)) result.nameMode = incoming.nameMode;
  result.tags = [...new Set([...old.tags, ...incoming.tags])];
  for (const key of ['phones', 'emails'] as const) {
    const kind = key === 'phones' ? 'phone' : 'email';
    for (const [index, entry] of incoming[key].entries()) {
      const normalized = normalizeIdentifier(kind, entry.value), existing = result[key].find(item => normalizeIdentifier(kind, item.value) === normalized);
      if (!existing) result[key].push({ value: entry.value, label: entry.label }); else if (overwrite) { existing.value = entry.value; if ((key === 'phones' ? presence.phoneLabels : presence.emailLabels)[index]) existing.label = entry.label; }
    }
  }
  result.fieldValues = { ...old.fieldValues };
  for (const [key, value] of Object.entries(incoming.fieldValues)) if (value !== null && (overwrite || !Object.hasOwn(result.fieldValues, key))) result.fieldValues[key] = value;
  // Import never reassigns an existing owner or transfers permission evidence.
  return result;
}
export function commitCRMImport(store: Store, tenant: string, actorId: string, raw: unknown, fingerprint: string, key: string, assertAccess?: () => void) {
  return withReceipt(store, tenant, key, 'crm_import', { actorId, raw, fingerprint }, () => transaction(store, () => {
    assertAccess?.();
    const input = parse(raw), plan = previewCRMImport(store, tenant, raw);
    if (plan.fingerprint !== fingerprint) throw new CRMError(409, 'preview_stale', 'Arquivo, cadastro ou definições mudaram. Gere nova prévia.');
    if (!plan.canCommit) throw new CRMError(409, 'import_has_errors', 'Nenhum contato gravado; corrija todas as linhas.');
    let settings = getSettings(store, tenant);
    if (plan.definitionsToCreate.length) {
      const incoming = input.bundle.definitions.filter(def => plan.definitionsToCreate.includes(def.key)).map(({ id, revision, ...def }) => ({ ...def, options: def.options.map(({ id, ...option }) => option) }));
      const existing = settings.definitions.map(({ revision, ...def }) => def);
      saveSettings(store, tenant, { autoCapture: settings.autoCapture, creationGate: settings.creationGate, definitions: [...existing, ...incoming] }, settings.revision, actorId, assertAccess);
      settings = getSettings(store, tenant);
    }
    const changes = [];
    for (const item of plan.rows) {
      const record = input.bundle.contacts[item.line - 1], data = remapData(store, tenant, input, record.data, settings.definitions);
      let saved: CRMContact;
      if (item.targetId) {
        const old = canonicalContact(store.get(tenant, 'contacts', item.targetId)!);
        saved = updateContact(store, tenant, old.id, mergeData(old, data, input.mergePolicy === 'overwrite_supplied', input.presence[item.line - 1]), item.expectedRevision!, actorId, 'import', assertAccess);
        if (record.legacyData) saved = store.update(tenant, 'contacts', saved.id, { legacySnapshot: { ...saved.legacySnapshot, importedSnapshots: [...(saved.legacySnapshot?.importedSnapshots ?? []), record.legacyData] } }) as CRMContact;
      } else {
        saved = createContact(store, tenant, stripEntryIds(data), actorId, 'import', record.legacyData, assertAccess);
        const phoneIndex = data.phones.findIndex(entry => entry.id === data.primaryPhoneId), emailIndex = data.emails.findIndex(entry => entry.id === data.primaryEmailId);
        if (phoneIndex > 0 || emailIndex > 0) saved = updateContact(store, tenant, saved.id, { primaryPhoneId: saved.phones[Math.max(0, phoneIndex)]?.id ?? null, primaryEmailId: saved.emails[Math.max(0, emailIndex)]?.id ?? null }, saved.revision, actorId, 'import', assertAccess);
      }
      changes.push({ line: item.line, sourceId: record.sourceId, action: item.action, id: saved.id, revision: saved.revision });
    }
    const definitionMappings = input.bundle.definitions.map(source => {
      const target = settings.definitions.find(def => def.key === source.key)!;
      return { sourceId: source.id, key: source.key, id: target.id, options: source.options.map(option => ({ sourceId: option.id, id: target.options.find(item => item.label === option.label)!.id })) };
    });
    return { committed: true, summary: plan.summary, changes, definitionMappings };
  }), assertAccess);
}
export function exportCRM(store: Store, tenant: string) {
  const contacts = listContacts(store, tenant);
  if (contacts.length > 2000) throw new CRMError(413, 'export_too_large', 'Exportação fiel limitada a 2.000 contatos por arquivo.');
  const bundle = { format: 'kloel.contacts', version: 2, definitions: getSettings(store, tenant).definitions, contacts: contacts.map(row => {
    const permissionHistory = store.list(tenant, 'contact-permission-events').filter(event => event.contactId === row.id);
    const known = new Set([...Object.keys(contactView(row)), 'legacySnapshot']);
    const unknownFields = Object.fromEntries(Object.entries(row).filter(([key]) => !known.has(key)));
    const legacyData = { ...row.legacySnapshot, originalProvenance: { source: row.source, createdAt: row.createdAt, updatedAt: row.updatedAt, fieldMetadata: row.fieldMetadata }, ...(Object.keys(unknownFields).length ? { unknownFields } : {}), ...(permissionHistory.length ? { permissionHistory } : {}) };
    return { sourceId: row.id, revision: row.revision, data: editableContact(row), ...(legacyData ? { legacyData } : {}) };
  }) };
  if (Buffer.byteLength(JSON.stringify(bundle)) > MAX_BYTES) throw new CRMError(413, 'export_too_large', 'Exportação fiel limitada a 2 MiB.');
  return bundle;
}
const previewEnvelope = z.object({ expectedTenantId: crmId, options: z.record(z.unknown()) }).strict();
const commitEnvelope = previewEnvelope.extend({ previewFingerprint: z.string().regex(/^[a-f0-9]{64}$/) });
export async function registerCRMImport(app: FastifyInstance, store: Store) {
  app.post('/api/v1/crm/import/preview', { bodyLimit: 3 * 1024 * 1024 }, crmHandler((request, reply) => {
    const authority = importAuthority(store, request), body = previewEnvelope.parse(request.body);
    if (body.expectedTenantId !== authority.actor.tenantId) throw new CRMError(409, 'tenant_mismatch', 'A organização da importação mudou.');
    const result = previewCRMImport(store, authority.actor.tenantId, body.options);
    authority.assertCurrent(); return reply.header('Cache-Control', 'no-store').send(result);
  }));
  app.post('/api/v1/crm/import/commit', { bodyLimit: 3 * 1024 * 1024 }, crmHandler((request, reply) => {
    const authority = importAuthority(store, request), body = commitEnvelope.parse(request.body);
    const receipt = performImportOperation(store, authority, { ...body, key: receiptKey(request) }, (internalKey, assertCurrent) =>
      commitCRMImport(store, authority.actor.tenantId, authority.actor.userId, body.options, body.previewFingerprint, internalKey, assertCurrent));
    return reply.header('Cache-Control', 'no-store').send(receipt);
  }));
  app.get('/api/v1/crm/import/operations/:key', crmHandler((request, reply) => {
    const authority = importAuthority(store, request), { key } = z.object({ key: z.string() }).strict().parse(request.params);
    return reply.header('Cache-Control', 'no-store').send(readImportOperation(store, authority, key));
  }));
  app.get('/api/v1/crm/export', crmHandler((request, reply) => { const actor = humanCRM(store, request, 'contacts:bulk'); return reply.header('Cache-Control', 'no-store').header('Content-Disposition', 'attachment; filename="kloel-contatos-v2.json"').send(exportCRM(store, actor.tenantId)); }));
}
