import type { Contact, SmartFieldDef } from '../../domain/types'
import { captureEngineContext, type EngineContext } from './session'
import { EngineError } from './http'

export type Endpoint = { id?: string; value: string; normalized?: string; label: '' | 'HOME' | 'WORK' | 'OTHER' }
export type FieldDefinition = { id: string; revision: number; key: string; label: string; type: 'text' | 'number' | 'boolean' | 'choice'; description: string; status: 'active' | 'archived'; aiFill: boolean; options: { id: string; label: string; status: 'active' | 'archived' }[]; example: string; showInList: boolean; findHint?: string; keepUpdated?: boolean; updateWhen?: string }
export type CRMSettings = { id: string; revision: number; autoCapture: boolean; creationGate: string; definitions: FieldDefinition[] }
export type FieldInput = Omit<FieldDefinition, 'id' | 'revision' | 'options'> & { id?: string; options: { id?: string; label: string; status: 'active' | 'archived' }[] }
export type FieldEvidence = { source?: string; origin?: string; actorId?: string; model?: string; updatedAt?: string; recordedAt?: string; supersededAt?: string; supersededBy?: string; supersededSource?: string; proposalId?: string }
export type RawContact = { id: string; tenantId: string; revision: number; name: string; displayName: string; nameMode: 'custom' | 'structured'; firstName: string; lastName: string; phones: Endpoint[]; emails: Endpoint[]; primaryPhoneId: string | null; primaryEmailId: string | null; company: string; notes: string; ownerMembershipId: string | null; fieldValues: Record<string, string | boolean>; fieldMetadata: Record<string, FieldEvidence>; captureProvenance?: Record<string, FieldEvidence>; tags: string[]; timezone: string; source: string; createdAt: string; updatedAt: string }
export type CRMContact = Omit<Contact, 'source' | 'phones' | 'emails'> & { source: string; name: string; displayName: string; nameMode: 'custom' | 'structured'; phones: Endpoint[]; emails: Endpoint[]; revision: number; raw: RawContact }
export type CRMField = SmartFieldDef & { status: 'active' | 'archived'; choices: { id: string; label: string; status: 'active' | 'archived' }[] }
export type ContactEdit = { firstName: string; lastName: string; displayName?: string; nameMode?: 'custom' | 'structured'; phones: Endpoint[]; emails: Endpoint[]; company: string; ownerId?: string; notes: string; fields: Record<string, string> }
export type PermissionState = { items: { channel: string; identifier: string; purpose: string; status: string; effective: boolean; destinationPresent: boolean; occurredAt?: string; source?: string; recordedAt?: string }[]; legacyStatus: string }
export type PermissionInput = { channel: 'phone' | 'whatsapp' | 'email'; identifier: string; purpose: 'service' | 'marketing'; event: 'granted' | 'revoked'; occurredAt: string; source: string; evidenceReference?: string }
export type ContactQuery = { q?: string; page?: number; limit?: number; sort?: 'name' | 'createdAt' | 'updatedAt'; order?: 'asc' | 'desc'; company?: string; ownerMembershipId?: string; source?: 'manual' | 'import' | 'legacy' | 'conversation'; fieldPresent?: string }
export type ContactPage = { items: CRMContact[]; page: number; limit: number; total: number; totalPages: number }
export const contactETag = (contact: Pick<RawContact, 'id' | 'revision'>) => `"contact:${contact.id}:${contact.revision}"`
export const crmError = (error: unknown) => error instanceof EngineError && error.code === 'revision_conflict' ? 'Este registro mudou em outra sessão. Seu formulário foi mantido. Recarregue o registro antes de salvar novamente.' : error instanceof Error ? error.message : 'Não foi possível concluir a operação.'
export const isSuperseded = (error: unknown) => error instanceof EngineError && error.code === 'superseded'

export function toCRMContact(raw: RawContact, tenantId: string): CRMContact {
  if (!raw || raw.tenantId !== tenantId || !Number.isSafeInteger(raw.revision) || raw.revision < 1 || !Array.isArray(raw.phones) || !Array.isArray(raw.emails)) throw new EngineError(0, 'invalid_contact', 'O contato recebido é inválido para esta organização.')
  return { ...raw, orgId: raw.tenantId, ownerId: raw.ownerMembershipId ?? undefined, fields: Object.fromEntries(Object.entries(raw.fieldValues).map(([id, value]) => [id, typeof value === 'boolean' ? value ? 'Sim' : 'Não' : value])), raw }
}
export const toCRMFields = (settings: CRMSettings): CRMField[] => settings.definitions.map(def => ({ id: def.id, label: def.label, type: def.type === 'choice' ? 'enum' : def.type, description: def.description, aiFill: def.aiFill, options: def.options.map(option => option.id), choices: def.options, status: def.status, example: def.example, showInList: def.showInList }))

/** Keep stable endpoint IDs only for the same normalized destination. Changing a destination is remove/add. */
function endpoints(items: Endpoint[], previous: Endpoint[] = [], kind: 'phone' | 'email') {
  const normalize = (value: string) => kind === 'phone' ? '+' + value.replace(/\D/g, '') : value.trim().toLowerCase()
  return items.map(item => {
    const old = item.id && previous.find(entry => entry.id === item.id)
    return { ...(old && normalize(old.value) === normalize(item.value) ? { id: old.id } : {}), value: item.value.trim(), label: item.label }
  })
}
export function contactPayload(draft: ContactEdit, settings: CRMSettings, previous?: CRMContact) {
  const phones = endpoints(draft.phones, previous?.phones, 'phone'), emails = endpoints(draft.emails, previous?.emails, 'email')
  const fieldValues: Record<string, string | boolean | null> = {}
  for (const definition of settings.definitions) {
    if (definition.status !== 'active') continue
    const text = draft.fields[definition.id]?.trim() ?? '', old = previous?.raw.fieldValues[definition.id]
    let value: string | boolean | null = text === '' ? null : definition.type === 'boolean' ? text === 'Sim' ? true : text === 'Não' ? false : null : text
    if (text && definition.type === 'boolean' && value === null) throw new Error('Escolha Sim, Não ou Não informado.')
    if (value !== old && !(value === null && old === undefined)) fieldValues[definition.id] = value
  }
  const primary = (items: Endpoint[], old?: string | null) => old && items.some(item => item.id === old) ? old : null
  return { firstName: draft.firstName.trim(), lastName: draft.lastName.trim(), ...(draft.nameMode ? { nameMode: draft.nameMode, ...(draft.nameMode === 'custom' ? { displayName: draft.displayName?.trim() ?? '' } : {}) } : {}), phones, emails, primaryPhoneId: primary(phones, previous?.raw.primaryPhoneId), primaryEmailId: primary(emails, previous?.raw.primaryEmailId), company: draft.company.trim(), notes: draft.notes.trim(), ownerMembershipId: draft.ownerId || null, fieldValues }
}

/** Every call captures a live session generation; callers retain that context through UI publication. */
export function createCRMClient(context: EngineContext) {
  const request = context.request.bind(context)
  const check = (raw: RawContact) => { context.assertCurrent(); return toCRMContact(raw, context.tenantId) }
  return {
    context,
    async list(query: ContactQuery = {}, signal?: AbortSignal): Promise<ContactPage> {
      const page = await request<Omit<ContactPage, 'items'> & { items: RawContact[] }>('/crm/contacts', { query, signal })
      return { ...page, items: page.items.map(check) }
    },
    async get(id: string, signal?: AbortSignal) { return check(await request<RawContact>(`/crm/contacts/${encodeURIComponent(id)}`, { signal })) },
    async create(data: ReturnType<typeof contactPayload>, key: string) { return check(await request<RawContact>('/crm/contacts', { method: 'POST', body: data, idempotencyKey: key })) },
    async update(previous: CRMContact, data: ReturnType<typeof contactPayload>) { return check(await request<RawContact>(`/crm/contacts/${encodeURIComponent(previous.id)}`, { method: 'PATCH', body: data, etag: contactETag(previous) })) },
    async remove(previous: CRMContact) { await request(`/crm/contacts/${encodeURIComponent(previous.id)}`, { method: 'DELETE', etag: contactETag(previous) }); context.assertCurrent() },
    settings: (signal?: AbortSignal) => request<CRMSettings>('/crm/settings', { signal }),
    members: (signal?: AbortSignal) => request<{ items: { id: string; userId: string; role: string }[] }>('/crm/assignable-members', { signal }),
    permissions: (id: string, signal?: AbortSignal) => request<PermissionState>(`/crm/contacts/${encodeURIComponent(id)}/permissions`, { signal }),
    /** Registro de consentimento (LGPD) com evidência; exige a revisão atual do contato. */
    recordPermission: (contact: Pick<CRMContact, 'id' | 'revision'>, input: PermissionInput, key: string) => request<{ id: string; replayed: boolean; contactRevision: number }>(`/crm/contacts/${encodeURIComponent(contact.id)}/permission-events`, { method: 'POST', body: input, etag: contactETag(contact), idempotencyKey: key }),
    conversations: (id: string, signal?: AbortSignal) => request<{ items: { id: string; channel: string; status: string; createdAt: string }[]; total: number }>(`/crm/contacts/${encodeURIComponent(id)}/conversations`, { signal, query: { limit: 100 } }),
    /** Vínculo explícito conversa → contato (Conversas › Criar/Vincular contato). replace troca um vínculo existente. */
    linkConversation: (contactId: string, conversationId: string, replace = false) => request<{ conversationId: string; contactId: string; previousContactId: string | null; changed: boolean }>(`/crm/contacts/${encodeURIComponent(contactId)}/conversations`, { method: 'POST', body: { conversationId, replace } }),
    /** "Apagar esses valores ao salvar": remove valores de campos inteligentes dos contatos indicados. */
    clearFieldValues: (fields: { fieldId: string; contactIds: string[] }[]) => request<{ cleared: number; contacts: string[] }>('/crm/field-values/clear', { method: 'POST', body: { fields } }),
    async saveSettings(settings: CRMSettings, data: { autoCapture: boolean; creationGate: string; definitions: FieldInput[] }) {
      return request<CRMSettings>('/crm/settings', { method: 'PUT', etag: `"crm-settings:${context.tenantId}:${settings.revision}"`, body: data })
    },
  }
}
export const crmClient = (permission = 'contacts:read') => createCRMClient(captureEngineContext(permission))
