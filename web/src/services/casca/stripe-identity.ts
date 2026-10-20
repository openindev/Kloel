import { EngineError } from '@/services/engine/http'
import type { EngineContext } from '@/services/engine/session'

export type IdentityView = {
  id: string; state: 'pending' | 'requires_input' | 'processing' | 'verified' | 'canceled' | 'redacted' | 'unknown' | 'failed'
  mode: 'test' | 'live'; verified: boolean; canResume: boolean; requiresReconciliation: boolean
  confirmedAt: string | null; createdAt: string; updatedAt: string
}
export type IdentityState = { configured: boolean; mode: 'test' | 'live' | 'unavailable'; verification: IdentityView | null }
export type IdentityOperation = { key: string; kind: 'stripe.identity.create'; status: 'pending' | 'succeeded' | 'unknown' | 'failed'; verification: IdentityView; automaticRetry: false }
type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(value)
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const date = (value: unknown): value is string => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value))
function invalid(): never { throw new EngineError(0, 'identity_response_invalid', 'Não foi possível confirmar a verificação. Consulte novamente antes de continuar.') }
function verification(raw: unknown): IdentityView {
  if (!object(raw) || !uuid(raw.id) || !['pending', 'requires_input', 'processing', 'verified', 'canceled', 'redacted', 'unknown', 'failed'].includes(String(raw.state))
    || !['test', 'live'].includes(String(raw.mode)) || typeof raw.verified !== 'boolean' || typeof raw.canResume !== 'boolean' || typeof raw.requiresReconciliation !== 'boolean'
    || raw.confirmedAt !== null && !date(raw.confirmedAt) || !date(raw.createdAt) || !date(raw.updatedAt)
    || raw.verified && (raw.mode !== 'live' || raw.state !== 'verified' || !raw.confirmedAt) || raw.canResume && raw.state !== 'requires_input') invalid()
  return { id: raw.id, state: raw.state as IdentityView['state'], mode: raw.mode as IdentityView['mode'], verified: raw.verified,
    canResume: raw.canResume, requiresReconciliation: raw.requiresReconciliation, confirmedAt: raw.confirmedAt as string | null, createdAt: raw.createdAt, updatedAt: raw.updatedAt }
}
export function parseIdentityState(raw: unknown): IdentityState {
  if (!object(raw) || typeof raw.configured !== 'boolean' || !['test', 'live', 'unavailable'].includes(String(raw.mode)) || raw.configured !== (raw.mode !== 'unavailable')) invalid()
  const view = raw.verification === null ? null : verification(raw.verification)
  if (view && (view.verified || view.canResume) && (!raw.configured || view.mode !== raw.mode)) invalid()
  return { configured: raw.configured, mode: raw.mode as IdentityState['mode'], verification: view }
}
export function identityDestination(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length > 8192) invalid()
  let url: URL; try { url = new URL(raw) } catch { return invalid() }
  if (url.protocol !== 'https:' || url.hostname !== 'verify.stripe.com' || url.username || url.password || url.port || !url.pathname.startsWith('/start/')) invalid()
  return url.href
}
export function createIdentityService(context: EngineContext) {
  const request = async (path: string, options?: Parameters<EngineContext['request']>[1]) => {
    context.assertCurrent(); const result: unknown = await context.request(path, options); context.assertCurrent(); return result
  }
  function operation(raw: unknown, key: string): IdentityOperation {
    if (!object(raw) || raw.key !== key || raw.kind !== 'stripe.identity.create' || raw.automaticRetry !== false || !['pending', 'succeeded', 'unknown', 'failed'].includes(String(raw.status))) invalid()
    return { key, kind: 'stripe.identity.create', status: raw.status as IdentityOperation['status'], verification: verification(raw.verification), automaticRetry: false }
  }
  return {
    state: async () => parseIdentityState(await request('/billing/identity')),
    async start(key: string) {
      if (!uuid(key)) invalid()
      const raw = await request('/billing/identity/start', { method: 'POST', body: { expectedTenantId: context.tenantId, idempotencyKey: key }, timeoutMs: 60000 })
      if (!object(raw)) invalid()
      return operation(raw.operation, key)
    },
    async operation(key: string) { if (!uuid(key)) invalid(); return operation(await request('/billing/identity/operations/' + key), key) },
    async reconcile(id: string) {
      if (!uuid(id)) invalid()
      const result = verification(await request('/billing/identity/reconcile', { method: 'POST', body: { expectedTenantId: context.tenantId, verificationId: id }, timeoutMs: 60000 }))
      if (result.id !== id) invalid()
      return result
    },
    async resume(id: string) {
      if (!uuid(id)) invalid()
      const raw = await request('/billing/identity/resume', { method: 'POST', body: { expectedTenantId: context.tenantId, verificationId: id }, timeoutMs: 60000 })
      if (!object(raw)) invalid()
      const view = verification(raw.verification)
      if (view.id !== id) invalid()
      const url = raw.url === null ? null : identityDestination(raw.url)
      if (url && !view.canResume) invalid()
      return { verification: view, url }
    },
  }
}

export function createIdentityJournal(storage: StoragePort, scope: { userId: string; tenantId: string }) {
  if (![scope.userId, scope.tenantId].every(v => /^[A-Za-z0-9_-]{1,128}$/.test(v))) invalid()
  const name = `kloel.identity.attempt.v1:${scope.userId}:${scope.tenantId}`
  type Reference = { key: string; verificationId?: string }
  const parse = (raw: unknown): Reference => {
    if (!object(raw) || Object.keys(raw).some(key => !['key', 'verificationId'].includes(key)) || !uuid(raw.key) || raw.verificationId !== undefined && !uuid(raw.verificationId)) invalid()
    return { key: raw.key, ...(raw.verificationId ? { verificationId: raw.verificationId as string } : {}) }
  }
  return {
    read(): Reference | undefined { const raw = storage.getItem(name); return raw === null ? undefined : parse(JSON.parse(raw)) },
    write(value: Reference) {
      const ref = parse(value), previous = this.read()
      if (previous && previous.key !== ref.key) throw new Error('A verificação anterior ainda precisa ser conferida.')
      const serialized = JSON.stringify(ref); storage.setItem(name, serialized)
      if (storage.getItem(name) !== serialized) throw new Error('Não foi possível guardar a referência da verificação nesta aba.')
    },
    clearResolved(key: string) { const previous = this.read(); if (previous && previous.key !== key) invalid(); storage.removeItem(name) },
  }
}

/** One explicit user click starts or resumes; an interrupted creation is only read, never replayed. */
export async function prepareIdentity(service: ReturnType<typeof createIdentityService>, journal: ReturnType<typeof createIdentityJournal>) {
  const prior = journal.read()
  if (prior) {
    const result = await service.operation(prior.key)
    if (result.status === 'pending' || result.status === 'unknown') throw new Error('A solicitação anterior ainda não foi confirmada. Consulte novamente antes de iniciar outra.')
    if (result.status === 'succeeded' && !['failed', 'canceled', 'redacted'].includes(result.verification.state)) {
      journal.write({ key: prior.key, verificationId: result.verification.id })
      return service.resume(result.verification.id)
    }
    journal.clearResolved(prior.key)
  }
  const current = await service.state()
  if (!current.configured) throw new Error('A verificação de identidade ainda não está disponível.')
  if (current.verification && !['failed', 'canceled', 'redacted'].includes(current.verification.state)) return service.resume(current.verification.id)
  const key = crypto.randomUUID()
  journal.write({ key })
  const result = await service.start(key)
  journal.write({ key, verificationId: result.verification.id })
  if (result.status !== 'succeeded') throw new Error('A solicitação ainda não foi confirmada. Consulte novamente antes de continuar.')
  return service.resume(result.verification.id)
}
