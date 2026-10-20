import { EngineError, parseExpectedContext, type EngineRequest } from './http'
import type { BootstrapData, EngineOrganization, ExpectedContext, Identity, Profile, SessionState } from './types'

function verifiedIdentity(value: Identity): Identity {
  const context = parseExpectedContext(value?.context)
  if (!value || value.userId !== context.userId || value.tenantId !== context.tenantId || !Array.isArray(value.organizations) || !Array.isArray(value.permissions) || value.permissions.some(permission => typeof permission !== 'string')
    || value.tenantId === null && value.role !== null || value.tenantId !== null && !value.organizations.some(org => org.tenantId === value.tenantId && org.membershipId === context.membershipId && org.role === value.role)) throw new EngineError(0, 'invalid_identity', 'A sessão retornada é inválida.')
  return { ...value, context }
}

export const FOCUS_VALIDATION_TIMEOUT_MS = 15000
const sameContext = (a: ExpectedContext, b: ExpectedContext) => a.userId === b.userId && a.tenantId === b.tenantId && a.membershipId === b.membershipId && a.authorityVersion === b.authorityVersion
const ordered = (values: string[]) => JSON.stringify([...new Set(values)].sort())
function sameAuthority(a: Identity, b: Identity) {
  const memberships = (identity: Identity) => identity.organizations.map(org => JSON.stringify([org.id, org.tenantId, org.membershipId, org.role, org.status]))
  return sameContext(a.context, b.context) && a.role === b.role && ordered(a.permissions) === ordered(b.permissions) && ordered(memberships(a)) === ordered(memberships(b))
}

/** Session commands are serialized because cookie rotation is a server-side mutation.
 * Generation fences also protect against transports that ignore AbortSignal. */
export class SessionController {
  private state: SessionState = { phase: 'loading', validation: 'ready', generation: 0 }
  private listeners = new Set<() => void>()
  private readAbort?: AbortController
  private commands: Promise<unknown> = Promise.resolve()
  private verifiedContext?: ExpectedContext
  private pendingContext?: Promise<ExpectedContext | undefined>
  private refreshPending?: Promise<BootstrapData | undefined>
  private focusNonce = 0
  private focus?: { nonce: number; abort: AbortController; promise: Promise<BootstrapData | undefined> }
  constructor(private request: EngineRequest, private notifyChanged: () => void = () => {}) {}
  getSnapshot = () => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private publish(state: SessionState) { this.state = state; for (const listener of this.listeners) listener() }
  private begin() {
    this.focusNonce++; this.focus?.abort.abort(); this.focus = undefined
    this.readAbort?.abort(); this.readAbort = new AbortController()
    const generation = this.state.generation + 1
    this.publish({ phase: 'loading', validation: 'ready', generation })
    return { generation, signal: this.readAbort.signal }
  }
  private current(generation: number) { return this.state.generation === generation }
  private assertCurrent(generation: number) {
    if (!this.current(generation)) throw new EngineError(0, 'superseded', 'A sessão mudou durante a operação.')
  }
  private async candidate(signal: AbortSignal, assertCurrent: () => void, expectedContext?: ExpectedContext) {
    const identity = verifiedIdentity(await this.request<Identity>('/auth/me', { signal, expectedContext }))
    assertCurrent()
    if (expectedContext && !sameContext(identity.context, expectedContext)) throw new EngineError(0, 'identity_changed', 'A sessão mudou. Atualize antes de continuar.')
    const bound = { signal, expectedContext: identity.context }
    const [profile, capabilities, settings] = await Promise.all([
      this.request<Profile>('/account/profile', bound),
      identity.tenantId ? this.request<BootstrapData['capabilities']>('/capabilities', bound) : undefined,
      identity.tenantId && identity.permissions.includes('organization:read') ? this.request<BootstrapData['settings']>('/organization-settings', bound) : undefined,
    ])
    assertCurrent()
    if (profile.id !== identity.userId || (capabilities && capabilities.role !== identity.role)) throw new EngineError(0, 'identity_changed', 'A sessão mudou. Atualize antes de continuar.')
    // Re-read the identity after parallel data reads: membership may have been revoked meanwhile.
    const fresh = verifiedIdentity(await this.request<Identity>('/auth/me', bound))
    assertCurrent()
    if (!sameAuthority(fresh, identity)) throw new EngineError(0, 'identity_changed', 'Seu acesso mudou. Atualize a sessão.')
    return { identity: fresh, profile, capabilities, settings }
  }
  private async hydrate(generation: number, signal: AbortSignal, expectedContext?: ExpectedContext) {
    const data = await this.candidate(signal, () => this.assertCurrent(generation), expectedContext)
    this.assertCurrent(generation)
    this.verifiedContext = data.identity.context
    this.publish({ phase: data.identity.tenantId ? 'authenticated' : 'organization_required', validation: 'ready', generation, data })
    return data
  }
  private fail(generation: number, error: unknown, anonymousOn401: boolean) {
    if (!this.current(generation)) return
    this.verifiedContext = undefined
    this.readAbort?.abort()
    this.publish(error instanceof EngineError && error.status === 401 && anonymousOn401
      ? { phase: 'anonymous', validation: 'ready', generation }
      : { phase: 'error', validation: 'ready', generation, error: error instanceof Error ? error.message : 'Não foi possível carregar a sessão.' })
  }
  refresh = () => {
    const { generation, signal } = this.begin()
    const work = (async () => {
      try {
        await this.commands
        this.assertCurrent(generation)
        return await this.hydrate(generation, signal)
      } catch (error) { this.fail(generation, error, true) }
    })()
    this.refreshPending = work
    void work.finally(() => { if (this.refreshPending === work) this.refreshPending = undefined })
    return work
  }
  /** A focus probe never rotates cookies or replaces an equivalent form generation. */
  revalidateOnFocus = (): Promise<BootstrapData | undefined> => {
    if (this.pendingContext) return this.commands.then(() => this.state.data, () => undefined)
    if (this.state.phase === 'loading' && this.refreshPending) return this.refreshPending
    if (this.focus) return this.focus.promise
    const prior = this.state
    if (prior.phase !== 'authenticated' || !prior.data) return this.refresh()
    const generation = prior.generation, expected = prior.data.identity.context, nonce = ++this.focusNonce, abort = new AbortController()
    const assertFocus = () => {
      if (nonce !== this.focusNonce || abort.signal.aborted || !this.current(generation)) throw new EngineError(0, 'superseded', 'A sessão mudou durante a verificação.')
    }
    let timer: ReturnType<typeof setTimeout> | undefined, cancel!: () => void
    const deadline = new Promise<never>((_resolve, reject) => {
      cancel = () => reject(new EngineError(0, 'superseded', 'A sessão mudou durante a verificação.'))
      abort.signal.addEventListener('abort', cancel, { once: true })
      timer = setTimeout(() => { reject(new EngineError(0, 'session_validation_timeout', 'Não foi possível confirmar sua sessão a tempo. Tente novamente.')); abort.abort() }, FOCUS_VALIDATION_TIMEOUT_MS)
    })
    // Schedule I/O after the shared promise and checking state are installed.
    const candidate = Promise.resolve().then(() => {
      assertFocus()
      return this.candidate(abort.signal, assertFocus, expected)
    })
    const work = Promise.race([candidate, deadline]).then(data => {
      assertFocus()
      if (!sameAuthority(prior.data!.identity, data.identity)) return this.refresh()
      this.verifiedContext = data.identity.context
      this.publish({ phase: 'authenticated', validation: 'ready', generation, data })
      return data
    }).catch(error => {
      if (nonce !== this.focusNonce || !this.current(generation)) return undefined
      if (error instanceof EngineError && ['context_mismatch', 'context_changed_in_flight', 'identity_changed'].includes(error.code)) return this.refresh()
      if (error instanceof EngineError && (error.status === 401 || error.status === 403 || error.code === 'invalid_identity' || error.code === 'invalid_context')) {
        const next = this.begin(); this.fail(next.generation, error, true); return undefined
      }
      // Keep only the hidden in-memory tree. No request can pass the barrier in this state.
      this.focusNonce++; abort.abort()
      this.publish({ ...prior, validation: 'error', validationError: error instanceof Error ? error.message : 'Não foi possível confirmar a sessão.' })
      return undefined
    }).finally(() => {
      if (timer) clearTimeout(timer)
      abort.signal.removeEventListener('abort', cancel)
      if (this.focus?.nonce === nonce) this.focus = undefined
    })
    this.focus = { nonce, abort, promise: work }
    this.publish({ ...prior, validation: 'checking', validationError: undefined })
    return work
  }
  /** Wait for the current probe once; never dispatch or replay an HTTP operation here. */
  waitForValidation = (generation: number, expected: ExpectedContext, signal?: AbortSignal): Promise<void> => {
    const check = () => {
      const state = this.state
      if (signal?.aborted || state.phase !== 'authenticated' || state.generation !== generation || !state.data || !sameContext(state.data.identity.context, expected)) throw new EngineError(0, 'superseded', 'A organização ou sessão mudou. Atualize a tela.')
      if (state.validation === 'error') throw new EngineError(0, 'session_validation_failed', state.validationError ?? 'Confirme sua sessão antes de continuar.')
      return state.validation === 'ready'
    }
    try { if (check()) return Promise.resolve() } catch (error) { return Promise.reject(error) }
    return new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined, unsubscribe = () => {}
      const finish = (error?: unknown) => { unsubscribe(); if (timer) clearTimeout(timer); signal?.removeEventListener('abort', onChange); error ? reject(error) : resolve() }
      const onChange = () => { try { if (check()) finish() } catch (error) { finish(error) } }
      unsubscribe = this.subscribe(onChange)
      signal?.addEventListener('abort', onChange, { once: true })
      timer = setTimeout(() => finish(new EngineError(0, 'session_validation_timeout', 'A verificação da sessão não terminou. Confirme a sessão antes de consultar o resultado da operação.')), FOCUS_VALIDATION_TIMEOUT_MS)
      onChange()
    })
  }
  private captureCookieIntent() {
    const proof = this.pendingContext ?? Promise.resolve(this.verifiedContext)
    return async () => {
      const expected = await proof
      if (!expected) throw new EngineError(0, 'identity_unverified', 'Confirme a sessão antes de alterar a conta ou organização.')
      return parseExpectedContext(expected)
    }
  }
  private command(operation: () => Promise<ExpectedContext | undefined>, logout = false) {
    const { generation, signal } = this.begin()
    let resolveProof!: (context: ExpectedContext | undefined) => void, rejectProof!: (error: unknown) => void
    const proof = new Promise<ExpectedContext | undefined>((resolve, reject) => { resolveProof = resolve; rejectProof = reject })
    void proof.catch(() => undefined)
    this.pendingContext = proof
    const result = this.commands.catch(() => undefined).then(async () => {
      // Do not abort an in-flight cookie mutation. A subsequent logout/switch must follow it.
      const expected = await operation()
      resolveProof(expected)
      this.notifyChanged()
      this.assertCurrent(generation)
      if (logout) { this.verifiedContext = undefined; this.publish({ phase: 'anonymous', validation: 'ready', generation }); return undefined }
      if (!expected) throw new EngineError(0, 'identity_unverified', 'A operação não confirmou a identidade da sessão.')
      return this.hydrate(generation, signal, expected)
    }).catch(error => {
      rejectProof(error); this.fail(generation, error, error instanceof EngineError && error.code === 'invalid_credentials')
      if (this.current(generation) && error instanceof EngineError && ['context_mismatch', 'context_changed_in_flight'].includes(error.code)) queueMicrotask(() => { void this.refresh() })
      throw error
    }).finally(() => { if (this.pendingContext === proof) this.pendingContext = undefined })
    this.commands = result.catch(() => undefined)
    return result
  }
  login = (email: string, password: string) => this.command(async () => verifiedIdentity(await this.request<Identity>('/auth/login', { method: 'POST', body: { email: email.trim(), password } })).context)
  signup = (organization: string, email: string, password: string, referralCode?: string) => this.command(async () => verifiedIdentity(await this.request<Identity>('/auth/signup', { method: 'POST', body: { organization: organization.trim(), email: email.trim(), password, ...(referralCode ? { referralCode } : {}) } })).context)
  acceptInvitation = (operation: () => Promise<unknown>) => this.command(async () => {
    const receipt = await operation() as { userId?: string; tenantId?: string; membershipId?: string; context?: unknown } | undefined
    const context = parseExpectedContext(receipt?.context)
    if (receipt?.userId !== context.userId || receipt.tenantId !== context.tenantId || receipt.membershipId !== context.membershipId) throw new EngineError(0, 'invalid_identity', 'A aceitação não confirmou a identidade da sessão.')
    return context
  })
  logout = () => {
    const captured = this.captureCookieIntent()
    return this.command(async () => {
      const expectedContext = await captured()
      try { await this.request('/auth/logout', { method: 'POST', expectedContext }) } catch (error) { if (!(error instanceof EngineError && error.status === 401)) throw error }
      return undefined
    }, true)
  }
  selectOrganization = (tenantId: string) => {
    const captured = this.captureCookieIntent()
    return this.command(async () => {
      const expectedContext = await captured(), next = verifiedIdentity(await this.request<Identity>('/auth/select-organization', { method: 'POST', body: { tenantId }, expectedContext }))
      if (next.userId !== expectedContext.userId || next.tenantId !== tenantId) throw new EngineError(0, 'identity_changed', 'A sessão mudou durante a seleção.')
      return next.context
    })
  }
  createOrganization = (name: string) => {
    const captured = this.captureCookieIntent()
    return this.command(async () => {
      const expectedContext = await captured(), org = await this.request<EngineOrganization>('/organizations', { method: 'POST', body: { name: name.trim() }, expectedContext })
      const next = verifiedIdentity(await this.request<Identity>('/auth/select-organization', { method: 'POST', body: { tenantId: org.tenantId }, expectedContext }))
      if (next.userId !== expectedContext.userId || next.tenantId !== org.tenantId) throw new EngineError(0, 'identity_changed', 'A sessão mudou durante a criação.')
      return next.context
    })
  }
  /** Update presentation from a verified settings DTO without replacing authority or discarding an open draft. */
  reconcileOrganizationSettings = (tenantId: string, generation: number, settings: { name: string; timezone: string }) => {
    const state = this.state
    if (typeof settings.name !== 'string' || !settings.name.trim() || settings.name.length > 200 || typeof settings.timezone !== 'string' || settings.timezone.length > 100) return false
    try { new Intl.DateTimeFormat('en', { timeZone: settings.timezone }) } catch { return false }
    if (state.phase !== 'authenticated' || state.validation !== 'ready' || state.generation !== generation || state.data?.identity.tenantId !== tenantId) return false
    this.publish({ ...state, data: { ...state.data, settings: { name: settings.name, timezone: settings.timezone },
      identity: { ...state.data.identity, organizations: state.data.identity.organizations.map(org => org.tenantId === tenantId ? { ...org, name: settings.name } : org) } } })
    return true
  }
  can = (permission: string) => this.state.phase === 'authenticated' && this.state.data?.identity.permissions.includes(permission) === true
}
