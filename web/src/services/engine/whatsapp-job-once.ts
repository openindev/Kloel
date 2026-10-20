import { EngineError } from './http'
import type { EngineContext } from './session'
import { jobLabels, type WhatsAppJob } from './whatsapp'

export type WhatsAppJobOnceReference = { jobId: string; expectedVersion: string }
export interface WhatsAppJobOnceOperation {
  jobId: string; version: string; status: WhatsAppJob['status']; executionMode: 'manual_once'; replayed: boolean; automaticRetry: false
  externalEffect: 'not_dispatched' | 'unconfirmed' | 'not_accepted' | 'accepted'; localLink: 'not_linked' | 'linked'
  messageId: string | null; requiresReconciliation: boolean; errorCode: string | null
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
function invalid(): never { throw new EngineError(0, 'invalid_whatsapp_once_response', 'Não foi possível confirmar esta execução da IA.') }
const id = (v: unknown): string => { if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{1,150}$/.test(v)) invalid(); return v }
const version = (v: unknown): string => { if (typeof v !== 'string' || !/^[a-f0-9]{64}$/.test(v)) invalid(); return v }
function parse(raw: unknown, tenant: string, ref: WhatsAppJobOnceReference): WhatsAppJobOnceOperation {
  if (!object(raw) || raw.tenantId !== tenant || raw.jobId !== ref.jobId || raw.initialVersion !== ref.expectedVersion || !object(raw.operation)) invalid()
  const row = raw.operation
  if (row.jobId !== ref.jobId || row.executionMode !== 'manual_once' || row.automaticRetry !== false || typeof row.replayed !== 'boolean'
    || typeof row.status !== 'string' || !Object.hasOwn(jobLabels, row.status)
    || !['not_dispatched', 'unconfirmed', 'not_accepted', 'accepted'].includes(String(row.externalEffect))
    || !['not_linked', 'linked'].includes(String(row.localLink)) || typeof row.requiresReconciliation !== 'boolean') invalid()
  const messageId = row.messageId === null ? null : id(row.messageId)
  const expectedReconciliation = ['generating', 'preparing_send', 'sending', 'requires_reconciliation'].includes(row.status) || row.externalEffect === 'accepted' && row.localLink !== 'linked'
  if (row.requiresReconciliation !== expectedReconciliation || row.localLink === 'linked' && (messageId === null || row.externalEffect !== 'accepted')
    || row.localLink === 'not_linked' && messageId !== null || row.status === 'sent' && row.externalEffect !== 'accepted'
    || row.externalEffect === 'not_accepted' && row.status !== 'failed') invalid()
  if (row.errorCode !== null && (typeof row.errorCode !== 'string' || !/^[a-z0-9_]{1,100}$/.test(row.errorCode))) invalid()
  return { jobId: ref.jobId, version: version(row.version), status: row.status as WhatsAppJob['status'], executionMode: 'manual_once', replayed: row.replayed,
    automaticRetry: false, externalEffect: row.externalEffect as WhatsAppJobOnceOperation['externalEffect'], localLink: row.localLink as WhatsAppJobOnceOperation['localLink'],
    messageId, requiresReconciliation: row.requiresReconciliation, errorCode: row.errorCode as string | null }
}
export function createWhatsAppJobOnceService(context: EngineContext) {
  return {
    async run(ref: WhatsAppJobOnceReference) {
      const jobId = id(ref.jobId), expectedVersion = version(ref.expectedVersion); context.assertCurrent()
      const raw = await context.request(`/whatsapp/jobs/${jobId}/manual-once`, { method: 'POST', body: { expectedTenantId: context.tenantId, expectedVersion, confirm: true } })
      context.assertCurrent(); return parse(raw, context.tenantId, ref)
    },
    async operation(ref: WhatsAppJobOnceReference) {
      const jobId = id(ref.jobId), expectedVersion = version(ref.expectedVersion); context.assertCurrent()
      const raw = await context.request(`/whatsapp/jobs/${jobId}/manual-once`, { query: { expectedVersion } })
      context.assertCurrent(); return parse(raw, context.tenantId, ref)
    },
  }
}
export function whatsappJobOnceError(error: unknown): string {
  if (error instanceof EngineError) {
    if (error.code === 'whatsapp_once_storage_unavailable') return 'Não foi possível preservar o acompanhamento nesta aba. Novas solicitações estão bloqueadas.'
    if (error.status === 404) return 'O recibo não está disponível para esta autorização. Isso não confirma ausência de execução. A referência foi preservada.'
    if (error.status === 401 || error.status === 403 || error.code === 'superseded') return 'Sua autorização mudou. Entre novamente para consultar a execução original.'
  }
  return 'Não foi possível confirmar o resultado. Consulte o recibo original; a execução não será repetida automaticamente.'
}
export const whatsappJobOnceResolved = (op?: WhatsAppJobOnceOperation) => !!op && !op.requiresReconciliation
  && (op.status === 'sent' && op.externalEffect === 'accepted' && op.localLink === 'linked' || op.status === 'failed' && ['not_dispatched', 'not_accepted'].includes(op.externalEffect))

/** One active pointer and at most twenty opaque references under the original authority; never content or credentials. */
export function createWhatsAppJobOnceJournal(storage: () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, scope: { userId: string; tenantId: string; membershipId: string; authorityVersion: string }) {
  const name = `kloel.whatsapp.job-once.v2:${id(scope.userId)}:${id(scope.tenantId)}:${id(scope.membershipId)}:${version(scope.authorityVersion)}`
  type State = { version: 2; active: WhatsAppJobOnceReference | null; archived: WhatsAppJobOnceReference[] }
  function fail(): never { throw new EngineError(0, 'whatsapp_once_storage_unavailable', '') }
  function reference(value: unknown): WhatsAppJobOnceReference {
    if (!object(value) || Object.keys(value).sort().join(',') !== 'expectedVersion,jobId') fail()
    return { jobId: id(value.jobId), expectedVersion: version(value.expectedVersion) }
  }
  function parseState(raw: string | null): State {
    if (raw === null) return { version: 2, active: null, archived: [] }
    if (raw.length > 16384) fail()
    const value: unknown = JSON.parse(raw)
    if (!object(value) || Object.keys(value).sort().join(',') !== 'active,archived,version' || value.version !== 2 || !Array.isArray(value.archived)) fail()
    const active = value.active === null ? null : reference(value.active), archived = value.archived.map(reference)
    const all = active ? [active, ...archived] : archived
    if (all.length > 20 || new Set(all.map(item => item.jobId)).size !== all.length) fail()
    return { version: 2, active, archived }
  }
  const same = (a: WhatsAppJobOnceReference | null | undefined, b: WhatsAppJobOnceReference) => a?.jobId === b.jobId && a.expectedVersion === b.expectedVersion
  function change(update: (current: State) => State) {
    try {
      const target = storage(), previous = target.getItem(name), current = parseState(previous)
      const next = JSON.stringify(update(current))
      parseState(next)
      if (target.getItem(name) !== previous) fail()
      target.setItem(name, next)
      if (target.getItem(name) !== next) fail()
    } catch { fail() }
  }
  function archive(ref: WhatsAppJobOnceReference) {
    change(current => {
      const requested = reference(ref)
      if (!same(current.active, requested)) fail()
      return { version: 2, active: null, archived: [...current.archived, requested] }
    })
  }
  return {
    read() { try { return parseState(storage().getItem(name)).active ?? undefined } catch { return fail() } },
    archived() { try { return parseState(storage().getItem(name)).archived } catch { return fail() } },
    remember(ref: WhatsAppJobOnceReference) {
      change(current => {
        const requested = reference(ref)
        if (current.active || current.archived.some(item => item.jobId === requested.jobId)) fail()
        return { ...current, active: requested }
      })
    },
    archive,
    resume(ref: WhatsAppJobOnceReference) {
      change(current => {
        const requested = reference(ref)
        if (current.active || !current.archived.some(item => same(item, requested))) fail()
        return { version: 2, active: requested, archived: current.archived.filter(item => !same(item, requested)) }
      })
    },
    clearResolved(ref: WhatsAppJobOnceReference) {
      change(current => {
        if (!same(current.active, reference(ref))) fail()
        return { ...current, active: null }
      })
    },
  }
}
