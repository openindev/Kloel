import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { contactSchema, DomainError } from './domains.js';
import type { Entity, Store } from './store.js';
import { requireRequestPermission } from './memberships/access.js';
import { MembershipError } from './memberships/service.js';
import { CRMError } from './crm/schema.js';
import { canonicalContact, createContact, getContact, identifierKeys, legacyWriteData, listContacts, updateLegacyContact } from './crm/service.js';

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_ROWS = 2000;
const MAX_EXPORT_ROWS = 10_000;
const MAX_EXPORT_BYTES = 10 * 1024 * 1024;
const fields = ['name', 'email', 'phone', 'company', 'notes', 'tags', 'timezone', 'consent.whatsapp', 'consent.email', 'consent.phone', 'consent.recordedAt', 'consent.source'] as const;
const ddds = new Set('11 12 13 14 15 16 17 18 19 21 22 24 27 28 31 32 33 34 35 37 38 41 42 43 44 45 46 47 48 49 51 53 54 55 61 62 63 64 65 66 67 68 69 71 73 74 75 77 79 81 82 83 84 85 86 87 88 89 91 92 93 94 95 96 97 98 99'.split(' '));
type Contact = z.infer<typeof contactSchema>;
type ImportOptions = { format: 'csv' | 'json'; content?: string; base64?: string; delimiter: ',' | ';'; defaultCountry?: 'BR'; duplicatePolicy: 'error' | 'skip' | 'merge' };
type Issue = { code: string; field?: string; message: string };
type ImportRow = { line: number; action: 'create' | 'merge' | 'skip' | 'error'; existingId?: string; duplicateLine?: number; contact?: Contact; changedFields?: string[]; errors: Issue[]; warnings: Issue[] };
type PlannedRow = ImportRow & { targetId?: string };
type RawRow = { line: number; value: unknown };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const objectSchema = z.object({
  format: z.enum(['csv', 'json']),
  content: z.string().max(MAX_BYTES).optional(),
  base64: z.string().max(Math.ceil(MAX_BYTES / 3) * 4).optional(),
  delimiter: z.enum([',', ';']).default(','),
  defaultCountry: z.literal('BR').optional(),
  duplicatePolicy: z.enum(['error', 'skip', 'merge']).default('error'),
}).strict();
const oneSource = (input: { content?: string; base64?: string }) => (input.content === undefined) !== (input.base64 === undefined);
const importSchema = objectSchema.refine(oneSource, 'Informe exatamente content ou base64.');
const commitSchema = objectSchema.extend({ previewFingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).refine(oneSource, 'Informe exatamente content ou base64.');

function handler(fn: (request: FastifyRequest, reply: FastifyReply) => unknown) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try { return await fn(request, reply); }
    catch (error) {
      if (error instanceof DomainError || error instanceof MembershipError || error instanceof CRMError) return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
      if (error instanceof z.ZodError) return reply.code(400).send({ error: { code: 'invalid_input', message: 'Dados inválidos.', issues: error.issues.map(issue => ({ field: issue.path.join('.'), message: issue.message })) } });
      throw error;
    }
  };
}

function decodeInput(input: ImportOptions): string {
  let bytes: Buffer;
  if (input.base64 !== undefined) {
    if (input.base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64)) throw new DomainError(400, 'invalid_base64', 'O arquivo deve usar base64 canônico.');
    bytes = Buffer.from(input.base64, 'base64');
    if (bytes.toString('base64') !== input.base64) throw new DomainError(400, 'invalid_base64', 'Base64 inválido.');
  } else {
    bytes = Buffer.from(input.content!, 'utf8');
    if (bytes.toString('utf8') !== input.content) throw new DomainError(400, 'invalid_utf8', 'O texto contém uma sequência Unicode inválida.');
  }
  if (bytes.length > MAX_BYTES) throw new DomainError(413, 'import_too_large', 'O limite do arquivo é 2 MiB.');
  let decoded: string;
  try { decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new DomainError(400, 'invalid_utf8', 'Use UTF-8; arquivos UTF-16 ou com bytes inválidos não são aceitos.'); }
  if (decoded.includes('\0')) throw new DomainError(400, 'invalid_utf8', 'O arquivo contém bytes nulos.');
  return decoded.replace(/^\uFEFF/, '');
}

/** Strict RFC-style quoted fields; line numbers refer to physical source lines. */
export function parseContactCsv(source: string, delimiter: ',' | ';' = ','): { line: number; cells: string[] }[] {
  const records: { line: number; cells: string[] }[] = [];
  let cells: string[] = [], field = '', state: 'start' | 'unquoted' | 'quoted' | 'closed' = 'start';
  let line = 1, startLine = 1, touched = false;
  const pushField = () => { cells.push(field); field = ''; state = 'start'; if (cells.length > fields.length) throw new DomainError(400, 'csv_columns', `Linha ${startLine}: colunas demais.`); };
  const pushRecord = () => {
    pushField();
    if (touched || cells.length > 1 || cells[0] !== '') records.push({ line: startLine, cells });
    if (records.length > MAX_ROWS + 1) throw new DomainError(413, 'import_rows_exceeded', `O limite é ${MAX_ROWS} contatos por importação.`);
    cells = []; touched = false;
  };
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (state === 'quoted') {
      if (c === '"') {
        if (source[i + 1] === '"') { field += '"'; i++; } else state = 'closed';
      } else if (c === '\r' || c === '\n') {
        field += c;
        if (c === '\r' && source[i + 1] === '\n') field += source[++i];
        line++;
      } else field += c;
      continue;
    }
    if (c === delimiter) { touched = true; pushField(); continue; }
    if (c === '\r' || c === '\n') {
      pushRecord();
      if (c === '\r' && source[i + 1] === '\n') i++;
      line++; startLine = line; continue;
    }
    touched = true;
    if (state === 'closed') {
      if (c !== ' ' && c !== '\t') throw new DomainError(400, 'csv_syntax', `Linha ${line}: texto após o fechamento das aspas.`);
    } else if (c === '"') {
      if (state !== 'start') throw new DomainError(400, 'csv_syntax', `Linha ${line}: aspas no meio de um campo sem escape.`);
      state = 'quoted';
    } else { field += c; state = 'unquoted'; }
  }
  if (state === 'quoted') throw new DomainError(400, 'csv_syntax', `Linha ${startLine}: campo com aspas não fechado.`);
  if (touched || cells.length || field) pushRecord();
  return records;
}

function rawRows(input: ImportOptions): RawRow[] {
  const source = decodeInput(input);
  if (input.format === 'json') {
    let value: unknown;
    try { value = JSON.parse(source); } catch { throw new DomainError(400, 'invalid_json', 'O conteúdo JSON deve ser um array de contatos válido.'); }
    if (!Array.isArray(value)) throw new DomainError(400, 'invalid_json', 'O conteúdo JSON deve ser um array de contatos.');
    if (!value.length || value.length > MAX_ROWS) throw new DomainError(400, 'import_rows_exceeded', `Informe de 1 a ${MAX_ROWS} contatos.`);
    return value.map((row, i) => ({ line: i + 1, value: row }));
  }
  const [header, ...rows] = parseContactCsv(source, input.delimiter);
  if (!header || !rows.length) throw new DomainError(400, 'empty_import', 'Inclua um cabeçalho e pelo menos um contato.');
  const columns = header.cells.map(cell => cell.trim());
  if (columns.some(key => !(fields as readonly string[]).includes(key)) || new Set(columns).size !== columns.length || !columns.includes('name')) throw new DomainError(400, 'csv_header', 'Cabeçalho inválido: use campos documentados, sem repetições, incluindo name.');
  return rows.map(row => {
    if (row.cells.length !== columns.length) return { line: row.line, value: { _csvError: 'Quantidade de colunas diferente do cabeçalho.' } };
    const result: Record<string, unknown> = {};
    const consent: Record<string, unknown> = {};
    for (let i = 0; i < columns.length; i++) {
      const key = columns[i], original = row.cells[i], trimmed = original.trim();
      if (key !== 'name' && !trimmed) continue;
      if (key.startsWith('consent.')) {
        const nested = key.slice(8);
        consent[nested] = ['whatsapp', 'email', 'phone'].includes(nested) ? trimmed === 'true' ? true : trimmed === 'false' ? false : trimmed : trimmed;
      } else if (key === 'tags') {
        try { result.tags = JSON.parse(trimmed); } catch { result.tags = trimmed; }
      } else result[key] = key === 'notes' ? original : trimmed;
    }
    if (Object.keys(consent).length) result.consent = consent;
    return { line: row.line, value: result };
  });
}

/** A national number is accepted only with an explicit BR country, never inferred. */
export function normalizeContactPhone(value: string, defaultCountry?: 'BR'): string {
  let normalized = value.trim();
  // CSV exports protect E.164 cells from spreadsheet formula interpretation.
  if (/^'\+[1-9]/.test(normalized)) normalized = normalized.slice(1);
  if (!/^[+0-9\s().-]+$/.test(normalized)) throw new DomainError(400, 'phone_invalid', 'Use telefone em E.164; extensões e letras não são aceitas.');
  normalized = normalized.replace(/[\s().-]/g, '');
  if (!normalized.startsWith('+')) {
    if (!defaultCountry) throw new DomainError(400, 'phone_country_required', 'Telefone sem + exige defaultCountry: BR; o país não será presumido.');
    if ((normalized.length === 12 || normalized.length === 13) && normalized.startsWith('55')) normalized = normalized.slice(2);
    normalized = `+55${normalized}`;
  }
  if (!/^\+[1-9]\d{7,14}$/.test(normalized)) throw new DomainError(400, 'phone_invalid', 'Use E.164 com código do país e número completo.');
  if (normalized.startsWith('+55')) {
    const national = normalized.slice(3), subscriber = national.slice(2);
    if (!ddds.has(national.slice(0, 2)) || !(/^[2-5]\d{7}$/.test(subscriber) || /^9\d{8}$/.test(subscriber))) throw new DomainError(400, 'phone_br_invalid', 'Telefone brasileiro precisa de DDD válido e número fixo de 8 dígitos ou celular de 9 dígitos iniciado por 9.');
  }
  return normalized;
}

function parseContact(value: unknown, input: ImportOptions): { contact: Contact; supplied: Set<string> } {
  if (value && typeof value === 'object' && '_csvError' in value) throw new DomainError(400, 'csv_columns', 'Quantidade de colunas diferente do cabeçalho.');
  const raw = z.record(z.unknown()).parse(value);
  const normalized = { ...raw };
  if (normalized.phone !== undefined && normalized.phone !== null) normalized.phone = normalizeContactPhone(z.string().parse(normalized.phone), input.defaultCountry);
  const contact = contactSchema.parse(normalized);
  if (Object.values(contact.consent).some(value => value === true) && (!contact.consent.recordedAt || !contact.consent.source.trim())) throw new DomainError(400, 'consent_provenance_required', 'Consentimento positivo exige consent.recordedAt e consent.source; a importação não coleta consentimento.');
  return { contact, supplied: new Set(Object.keys(raw)) };
}

function editable(entity: Entity): Contact {
  return contactSchema.parse(Object.fromEntries(Object.keys(contactSchema.shape).filter(key => entity[key] !== undefined).map(key => [key, entity[key]])));
}
function contactKeys(contact: { email?: unknown; phone?: unknown }): string[] {
  return [typeof contact.email === 'string' && contact.email.trim() ? `email:${contact.email.trim().toLowerCase()}` : '', typeof contact.phone === 'string' && contact.phone ? `phone:${contact.phone}` : ''].filter(Boolean);
}
function issue(error: unknown): Issue[] {
  if (error instanceof DomainError || error instanceof CRMError) return [{ code: error.code, message: error.message }];
  if (error instanceof z.ZodError) return error.issues.map(item => ({ code: 'invalid_field', field: item.path.join('.'), message: item.message }));
  throw error;
}

function planImport(store: Store, tenantId: string, input: ImportOptions) {
  const source = rawRows(input);
  const existing = store.list(tenantId, 'contacts');
  const entities = new Map(existing.map(item => [item.id, item]));
  const index = new Map<string, Set<string>>();
  const pending = new Map<string, number>();
  const reserve = (id: string, contact: { email?: unknown; phone?: unknown }) => {
    for (const key of contactKeys(contact)) { if (!index.has(key)) index.set(key, new Set()); index.get(key)!.add(id); }
  };
  for (const item of existing) for (const key of identifierKeys(canonicalContact(item))) { if (!index.has(key)) index.set(key, new Set()); index.get(key)!.add(item.id); }
  const rows: PlannedRow[] = source.map(({ line, value }) => {
    const row: PlannedRow = { line, action: 'error', errors: [], warnings: [] };
    try {
      const { contact, supplied } = parseContact(value, input);
      row.contact = contact;
      const keys = contactKeys(contact);
      if (!keys.length) row.warnings.push({ code: 'no_identity_key', message: 'Contato sem telefone/e-mail: só o Idempotency-Key impede repetir este mesmo commit.' });
      const matches = new Set(keys.flatMap(key => [...(index.get(key) ?? [])]));
      if (matches.size > 1) throw new DomainError(409, 'identity_conflict', 'Telefone e/ou e-mail correspondem a contatos diferentes ou a cadastros já duplicados. Resolva no CRM.');
      const id = [...matches][0];
      if (!id) {
        row.action = 'create';
        if (Object.values(contact.consent).some(value => value === true)) row.warnings.push({ code: 'legacy_consent_unverified', message: 'A declaração será preservada como histórico não verificado; o cadastro não concede permissão de contato.' });
        const temporaryId = `pending:${line}`;
        pending.set(temporaryId, line); reserve(temporaryId, contact);
      } else if (pending.has(id)) {
        row.duplicateLine = pending.get(id);
        if (input.duplicatePolicy !== 'skip') throw new DomainError(409, 'duplicate_in_file', `Contato repetido no arquivo (linha ${pending.get(id)}); use skip para ignorar a repetição.`);
        row.action = 'skip';
      } else {
        row.existingId = id;
        if (input.duplicatePolicy === 'error') throw new DomainError(409, 'duplicate_existing', 'Já existe contato com o mesmo telefone ou e-mail. Selecione skip ou merge explicitamente.');
        if (input.duplicatePolicy === 'skip') row.action = 'skip';
        else {
          const previous = editable(entities.get(id)!);
          for (const key of ['email', 'phone'] as const) if (previous[key] && contact[key] && previous[key] !== contact[key]) throw new DomainError(409, 'identity_change', `A mesclagem não substitui ${key} existente; resolva a identidade no CRM.`);
          const merged: Record<string, unknown> = { ...previous };
          for (const key of supplied) {
            if (key === 'consent') continue;
            const next = contact[key as keyof Contact];
            if (next === null || next === undefined || next === '' || Array.isArray(next) && !next.length) continue;
            merged[key] = key === 'tags' ? [...new Set([...previous.tags, ...contact.tags])] : next;
          }
          row.contact = contactSchema.parse(merged);
          row.changedFields = Object.keys(contactSchema.shape).filter(key => JSON.stringify(previous[key as keyof Contact]) !== JSON.stringify(row.contact![key as keyof Contact]));
          row.warnings.push({ code: 'consent_preserved', message: 'Todos os consentimentos existentes serão preservados; consentimentos do arquivo não são aplicados na mesclagem.' });
          row.action = row.changedFields.length ? 'merge' : 'skip'; row.targetId = id;
          // A second row addressing this same contact is not a silent last-writer win.
          const temporaryId = `pending:${line}`;
          pending.set(temporaryId, line);
          for (const key of contactKeys(row.contact)) index.set(key, new Set([temporaryId]));
        }
      }
    } catch (error) { row.action = 'error'; row.errors = issue(error); }
    return row;
  });
  const summary = { total: rows.length, create: 0, merge: 0, skip: 0, error: 0 };
  for (const row of rows) summary[row.action]++;
  const fingerprint = hash(JSON.stringify({ version: 1, tenantId, input, existing: existing.sort((a, b) => a.id.localeCompare(b.id)) }));
  return { fingerprint, canCommit: summary.error === 0, summary, rows };
}

function publicPlan(plan: ReturnType<typeof planImport>) {
  return { ...plan, rows: plan.rows.map(({ targetId: _, ...row }) => row), limits: { maxBytes: MAX_BYTES, maxRows: MAX_ROWS } };
}

function fold(value: unknown): string { return String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR'); }
function lookup(store: Store, tenantId: string, query: string, limit: number) {
  const q = fold(query.trim()), digits = query.replace(/\D/g, ''), terms = q.split(/\s+/);
  const ranked = listContacts(store, tenantId).map(item => {
    const name = fold(item.name), emails = item.emails.map(entry => fold(entry.normalized)), phones = item.phones.map(entry => entry.normalized), haystack = [name, ...emails, ...phones, fold(item.company), fold(item.tags)].join(' ');
    const score = emails.includes(q) || phones.includes(query) || digits.length >= 8 && phones.some(phone => phone.replace(/\D/g, '') === digits) ? 100 : name.startsWith(q) ? 80 : terms.every(term => haystack.includes(term)) ? 60 : digits.length >= 4 && phones.some(phone => phone.includes(digits)) ? 40 : 0;
    return { item, score };
  }).filter(result => result.score > 0).sort((a, b) => b.score - a.score || String(a.item.name).localeCompare(String(b.item.name), 'pt-BR') || a.item.id.localeCompare(b.item.id));
  return { total: ranked.length, items: ranked.slice(0, limit).map(({ item }) => ({ id: item.id, name: item.name, email: item.email ?? null, phone: item.phone ?? null, company: item.company ?? '', tags: item.tags ?? [] })) };
}

export function safeCsvCell(value: unknown): string {
  let text = String(value ?? '');
  if (/^[\s\u0000-\u001f]*[=+\-@]/u.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export async function registerContactImport(app: FastifyInstance, store: Store): Promise<void> {
  const bodyLimit = 4 * 1024 * 1024;
  app.get('/api/v1/contacts/import/fields', handler(request => {
    requireRequestPermission(store, request, 'contacts:read');
    return {
      fields: { name: 'Nome obrigatório (1–200 caracteres).', email: 'E-mail opcional; espaços externos removidos e convertido para minúsculas.', phone: 'Telefone opcional em E.164, como +5511999999999. Sem +, exige defaultCountry: BR e DDD válido. Não acrescentamos DDD, nono dígito nem inferimos país.', company: 'Empresa (até 200 caracteres).', notes: 'Notas (até 20.000 caracteres); CSV aceita quebras de linha entre aspas.', tags: 'Array JSON de até 50 etiquetas. No CSV, escreva o array numa célula com aspas e escapes CSV.', timezone: 'Fuso IANA; padrão America/Sao_Paulo.', 'consent.whatsapp': 'true/false; padrão false.', 'consent.email': 'true/false; padrão false.', 'consent.phone': 'true/false; padrão false.', 'consent.recordedAt': 'Data ISO com fuso, obrigatória para qualquer consentimento true.', 'consent.source': 'Origem comprovável do consentimento, obrigatória para qualquer true. A importação não coleta consentimento.' },
      format: 'CSV UTF-8 com cabeçalho canônico, BOM opcional, vírgula ou delimiter: ";" explícito. JSON: array de objetos do schema de contato; consent é objeto aninhado. Envie o arquivo em content ou base64, nunca ambos.',
      policies: { error: 'Padrão: qualquer duplicação bloqueia o commit inteiro.', skip: 'Ignora contatos duplicados por telefone ou e-mail; identidades conflitantes continuam sendo erro.', merge: 'Mescla campos fornecidos não vazios em contatos existentes e une tags; preserva integralmente consentimentos e não substitui identificadores existentes. Repetições dentro do arquivo são erro.' },
      workflow: 'Preview não grava. Revise rows/summary e envie o mesmo payload ao commit com previewFingerprint e cabeçalho Idempotency-Key. Alterações no CRM invalidam a prévia; qualquer erro de linha impede todo o commit.',
      export: 'Exportação exige administrador. CSV mitiga fórmulas com apóstrofo; o importador reconhece o apóstrofo em telefones E.164. Para preservar exatamente os demais textos, use JSON.',
      limits: { maxBytes: MAX_BYTES, maxRows: MAX_ROWS, maxExportRows: MAX_EXPORT_ROWS, maxExportBytes: MAX_EXPORT_BYTES },
    };
  }));
  app.post('/api/v1/contacts/import/preview', { bodyLimit }, handler(request => {
    const actor = requireRequestPermission(store, request, 'contacts:bulk');
    return publicPlan(planImport(store, actor.tenantId, importSchema.parse(request.body)));
  }));
  app.post('/api/v1/contacts/import/commit', { bodyLimit }, handler((request, reply) => {
    const actor = requireRequestPermission(store, request, 'contacts:bulk');
    const key = z.string().min(8).max(128).regex(/^[A-Za-z0-9_.:-]+$/).parse(request.headers['idempotency-key']);
    const { previewFingerprint, ...input } = commitSchema.parse(request.body);
    const requestHash = hash(JSON.stringify({ input, previewFingerprint }));
    const assertAccess = () => { requireRequestPermission(store, request, 'contacts:bulk'); };
    const result = store.transaction(() => {
      assertAccess();
      const old = store.list(actor.tenantId, 'contact-import-receipts').find(item => item.key === key);
      if (old) {
        if (old.requestHash !== requestHash) throw new DomainError(409, 'idempotency_conflict', 'Idempotency-Key já usado com outro conteúdo.');
        return { status: 200, payload: { ...(old.result as Record<string, unknown>), replayed: true } };
      }
      const plan = planImport(store, actor.tenantId, input);
      if (plan.fingerprint !== previewFingerprint) throw new DomainError(409, 'preview_stale', 'O arquivo, as opções ou os contatos mudaram. Gere e revise uma nova prévia.');
      if (!plan.canCommit) return { status: 409, payload: { error: { code: 'import_has_errors', message: 'Nenhum contato foi gravado. Corrija os erros de linha.' }, preview: publicPlan(plan) } };
      const changes: { line: number; action: string; id: string }[] = [];
      for (const row of plan.rows) {
        if (row.action === 'create') {
          const { consent, ...data } = row.contact!;
          const legacyData = Object.values(consent).some(value => value === true) || consent.source ? { consent } : undefined;
          changes.push({ line: row.line, action: 'create', id: createContact(store, actor.tenantId, legacyWriteData(data), actor.userId, 'import', legacyData, assertAccess).id });
        }
        else if (row.action === 'merge') {
          const { consent: _consent, ...data } = row.contact!;
          const updated = updateLegacyContact(store, actor.tenantId, row.targetId!, data, getContact(store, actor.tenantId, row.targetId!).revision, actor.userId, 'import', assertAccess);
          if (!updated) throw new DomainError(409, 'preview_stale', 'Contato foi removido durante a importação.');
          changes.push({ line: row.line, action: 'merge', id: updated.id });
        }
      }
      const payload = { committed: true, replayed: false, summary: plan.summary, changes };
      store.create(actor.tenantId, 'contact-import-receipts', { key, requestHash, actorId: actor.userId, result: payload });
      return { status: 201, payload };
    });
    return reply.code(result.status).send(result.payload);
  }));
  app.get('/api/v1/contacts/lookup', handler(request => {
    const actor = requireRequestPermission(store, request, 'contacts:read');
    const { q, limit } = z.object({ q: z.string().trim().min(2).max(254), limit: z.coerce.number().int().min(1).max(50).default(10) }).strict().parse(request.query);
    return lookup(store, actor.tenantId, q, limit);
  }));
  app.get('/api/v1/contacts/export', handler((request, reply) => {
    const actor = requireRequestPermission(store, request, 'contacts:bulk');
    const { format } = z.object({ format: z.enum(['csv', 'json']).default('csv') }).strict().parse(request.query);
    const contacts = store.list(actor.tenantId, 'contacts');
    if (contacts.map(canonicalContact).some(row => row.phones.length > 1 || row.emails.length > 1 || row.firstName || row.lastName || row.ownerMembershipId || Object.keys(row.fieldValues).length || row.migrationIssues.length)) throw new CRMError(409, 'lossy_export_requires_v2', 'Use /api/v1/crm/export para preservar canais, campos e histórico legado.');
    if (contacts.length > MAX_EXPORT_ROWS) throw new DomainError(413, 'export_too_large', `Exportação local limitada a ${MAX_EXPORT_ROWS} contatos.`);
    const clean = contacts.map(editable);
    let output: string;
    if (format === 'json') output = JSON.stringify(clean, null, 2);
    else output = '\uFEFF' + [fields.map(safeCsvCell).join(','), ...clean.map(contact => fields.map(field => {
      const value = field.startsWith('consent.') ? contact.consent[field.slice(8) as keyof Contact['consent']] : contact[field as keyof Contact];
      return safeCsvCell(Array.isArray(value) ? JSON.stringify(value) : value);
    }).join(','))].join('\r\n') + '\r\n';
    if (Buffer.byteLength(output, 'utf8') > MAX_EXPORT_BYTES) throw new DomainError(413, 'export_too_large', 'Exportação local limitada a 10 MiB.');
    return reply.header('Content-Disposition', `attachment; filename="kloel-contatos.${format}"`).header('Cache-Control', 'no-store').type(format === 'json' ? 'application/json; charset=utf-8' : 'text/csv; charset=utf-8').send(output);
  }));
}
