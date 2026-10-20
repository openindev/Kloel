import { EngineError } from './http'
import type { EngineContext } from './session'
import { bookingValues, parseBookingChoice, parseBookingOperation, validBookingAttempt, type BookingAttempt, type BookingChoice, type BookingOperation, type BookingSlot, type BookingValues } from './assistant-booking'
import { calendlyUrl, calendlyValues, parseCalendlyChoice, parseCalendlyReceipt, validCalendlyAttempt, type CalendlyAttempt, type CalendlyChoice, type CalendlyReceipt } from './calendly'

/**
 * Link hospedado do Chatbot de IA (`/w/<empresa>/<assistente>`).
 * Admin: GET/PUT/DELETE /webchat/hosted (publicação no canal de webchat do assistente).
 * Visitante: resolve público + o MESMO pipeline do widget (`/api/v1/public/chat/*`), sem cookie, marcado com `X-Kloel-Hosted: 1`
 * (o motor normaliza a origem same-origin; GETs same-origin não levam o cabeçalho Origin).
 * Agendamento: os cartões Agendador/Calendly que o chat devolve são confirmados pela API pública do widget (`createHostedBooking`).
 */
export type HostedLink = { published: boolean; assistantSlug: string; greeting: string; path: string }
export type HostedView = { agentId: string; channelId: string | null; orgSlug: string; customOrgSlug: string | null; technicalSlug: string; hosted: HostedLink | null; available: boolean; reasons: string[] }
export type HostedPage = { tenantId: string; channelId: string; assistantName: string; greeting: string }
export type PublicMessage = { id: string; role: 'user' | 'assistant'; authorType: 'visitor' | 'human' | 'ai'; content: string; createdAt: string }

const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
function invalid(): never { throw new EngineError(0, 'invalid_hosted_webchat', 'A configuração do link hospedado recebida é inválida.') }

export function parseHostedView(raw: unknown, agentId: string): HostedView {
  if (!object(raw) || raw.agentId !== agentId || raw.channelId !== null && !text(raw.channelId, 128) || !text(raw.orgSlug, 60) || !SLUG.test(raw.orgSlug) || raw.customOrgSlug !== null && !text(raw.customOrgSlug, 60) || !text(raw.technicalSlug, 60) || typeof raw.available !== 'boolean' || !Array.isArray(raw.reasons) || raw.reasons.some((r: unknown) => !text(r, 100))) invalid()
  const h = raw.hosted
  if (h !== null && (!object(h) || typeof h.published !== 'boolean' || !text(h.assistantSlug, 48) || !SLUG.test(h.assistantSlug) || !text(h.greeting, 1000) || ![raw.orgSlug, raw.technicalSlug].some(org => h.path === `/w/${org}/${h.assistantSlug}`))) invalid()
  return { agentId, channelId: raw.channelId, orgSlug: raw.orgSlug, customOrgSlug: raw.customOrgSlug, technicalSlug: raw.technicalSlug, available: raw.available, reasons: [...raw.reasons], hosted: h === null ? null : { published: h.published, assistantSlug: h.assistantSlug, greeting: h.greeting, path: h.path } }
}

export function createHostedLinkService(context: EngineContext, agentId: string) {
  const done = (raw: unknown) => { context.assertCurrent(); return parseHostedView(raw, agentId) }
  return {
    async read() { return done(await context.request('/webchat/hosted', { query: { agentId } })) },
    async publish(input: { assistantSlug: string; greeting: string }) { return done(await context.request('/webchat/hosted', { method: 'PUT', body: { expectedTenantId: context.tenantId, agentId, assistantSlug: input.assistantSlug, greeting: input.greeting } })) },
    async unpublish() { return done(await context.request(`/webchat/hosted/${encodeURIComponent(agentId)}`, { method: 'DELETE' })) },
  }
}

/* ------------------------------------------------ visitante ------------------------------------------------ */

export class HostedChatError extends Error { constructor(readonly status: number, readonly code: string, message: string) { super(message); this.name = 'HostedChatError' } }

async function call<T>(url: string, init: { method?: string; token?: string | null; body?: unknown; signal?: AbortSignal; timeoutMs?: number; failure?: string } = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, { method: init.method ?? 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error', signal: init.signal ?? AbortSignal.timeout(init.timeoutMs ?? 35000),
      headers: { Accept: 'application/json', 'X-Kloel-Hosted': '1', ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}) },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }) })
  } catch (error) {
    if (init.signal?.aborted) throw error
    throw new HostedChatError(0, 'network_error', init.failure ? init.failure : init.method && init.method !== 'GET' ? 'Não foi possível confirmar o envio. Verifique a conexão; a mensagem não será reenviada automaticamente.' : 'Não foi possível conectar. Verifique a conexão e tente novamente.')
  }
  const result = await response.json().catch(() => null)
  if (!response.ok) throw new HostedChatError(response.status, result?.error?.code ?? 'request_failed', typeof result?.error?.message === 'string' ? result.error.message : 'Atendimento indisponível no momento.')
  if (!object(result)) throw new HostedChatError(response.status, 'invalid_response', 'Recebemos uma resposta inválida. Tente novamente.')
  return result as T
}

export async function resolveHostedPage(orgSlug: string, assistantSlug: string, signal?: AbortSignal): Promise<HostedPage> {
  if (!SLUG.test(orgSlug) || !SLUG.test(assistantSlug) || orgSlug.length > 60 || assistantSlug.length > 48) throw new HostedChatError(404, 'hosted_unavailable', 'Este link de chat não está disponível.')
  const raw = await call<Record<string, unknown>>(`/api/v1/public/webchat/hosted?${new URLSearchParams({ orgSlug, assistantSlug })}`, { signal })
  if (!text(raw.tenantId, 128) || !raw.tenantId || !text(raw.channelId, 128) || !raw.channelId || !text(raw.assistantName, 100) || !text(raw.greeting, 1000)) throw new HostedChatError(0, 'invalid_response', 'Recebemos uma resposta inválida. Tente novamente.')
  return { tenantId: raw.tenantId, channelId: raw.channelId, assistantName: raw.assistantName || 'Atendimento', greeting: raw.greeting }
}

export function parsePublicMessage(raw: unknown): PublicMessage | null {
  if (!object(raw) || !text(raw.id, 128) || !['user', 'assistant'].includes(raw.role) || !['visitor', 'human', 'ai'].includes(raw.authorType) || !text(raw.content, 12000) || !text(raw.createdAt, 64)) return null
  return { id: raw.id, role: raw.role, authorType: raw.authorType, content: raw.content, createdAt: raw.createdAt }
}

export type HostedSession = { token: string; expiresAt: number; greeting: string; assistantName: string; beforeContext: null | { revision: number; httpRevision: number | null } }
/** Cartões de agendamento devolvidos pelo chat público (mesmos do widget); um cartão inválido é descartado sem derrubar a conversa. */
export type HostedBookingCards = { bookingChoices: BookingChoice[]; calendlyChoices: CalendlyChoice[] }
export type HostedHistory = HostedBookingCards & { items: PublicMessage[]; cursor: string | null; hasMore: boolean; mode: 'ai' | 'human' | 'closed' }
export type HostedReply = HostedBookingCards & { status: 'answered' | 'human_pending' | 'recorded'; message: PublicMessage | null; visitorMessage: PublicMessage | null; suppressed: boolean }
function bookingCards(raw: Record<string, any>): HostedBookingCards {
  const parsed = <T,>(list: unknown, max: number, parse: (v: unknown) => T) => (Array.isArray(list) ? list.slice(0, max) : []).flatMap(v => { try { return [parse(v)] } catch { return [] } })
  return { bookingChoices: parsed(raw.bookingChoices, 10, v => parseBookingChoice(v)), calendlyChoices: parsed(raw.calendlyChoices, 20, v => parseCalendlyChoice(v)) }
}
const publicUrl = (page: Pick<HostedPage, 'tenantId' | 'channelId'>, path: string, extra: Record<string, string> = {}) => `/api/v1/public/chat/${path}?${new URLSearchParams({ tenantId: page.tenantId, channelId: page.channelId, ...extra })}`

/** Cliente do pipeline público para um canal; o token é a única credencial do visitante. */
export function createHostedChat(page: Pick<HostedPage, 'tenantId' | 'channelId'>) {
  const url = (path: string, extra: Record<string, string> = {}) => publicUrl(page, path, extra)
  return {
    async start(): Promise<HostedSession> {
      const raw = await call<Record<string, any>>(url('sessions'), { method: 'POST', body: {} })
      if (!text(raw.token, 64) || !/^[A-Za-z0-9_-]{43}$/.test(raw.token) || !Number.isFinite(raw.expiresAt)) throw new HostedChatError(0, 'invalid_response', 'Recebemos uma resposta inválida. Tente novamente.')
      const before = object(raw.beforeContext) && raw.beforeContext.enabled === true && Number.isSafeInteger(raw.beforeContext.revision) ? { revision: Number(raw.beforeContext.revision), httpRevision: Number.isSafeInteger(raw.beforeContext.httpSource?.revision) ? Number(raw.beforeContext.httpSource.revision) : null } : null
      return { token: raw.token, expiresAt: Number(raw.expiresAt), greeting: text(raw.greeting, 1000) ? raw.greeting : '', assistantName: text(raw.assistantName, 100) ? raw.assistantName : '', beforeContext: before }
    },
    /** Contexto inicial do assistente (mesma abertura do widget); a chave é gerada uma vez por sessão. */
    async open(token: string, before: NonNullable<HostedSession['beforeContext']>, idempotencyKey: string) {
      await call(url('opening'), { method: 'POST', token, body: { expectedConfigRevision: before.revision, ...(before.httpRevision !== null ? { expectedHttpRevision: before.httpRevision } : {}), idempotencyKey } })
    },
    async send(token: string, message: string, idempotencyKey: string): Promise<HostedReply> {
      const raw = await call<Record<string, any>>(url('messages'), { method: 'POST', token, body: { message, idempotencyKey } })
      if (!['answered', 'human_pending', 'recorded'].includes(raw.status)) throw new HostedChatError(0, 'invalid_response', 'Recebemos uma resposta inválida. Consulte a conversa antes de reenviar.')
      return { status: raw.status, message: parsePublicMessage(raw.message), visitorMessage: parsePublicMessage(raw.visitorMessage), suppressed: raw.responseState === 'suppressed', ...bookingCards(raw) }
    },
    async history(token: string, after?: string | null): Promise<HostedHistory> {
      const raw = await call<Record<string, any>>(url('history', after ? { after } : {}), { token })
      if (!Array.isArray(raw.items)) throw new HostedChatError(0, 'invalid_response', 'Recebemos uma resposta inválida. Tente novamente.')
      return { items: raw.items.map(parsePublicMessage).filter((m: PublicMessage | null): m is PublicMessage => !!m), cursor: text(raw.cursor, 128) ? raw.cursor : null, hasMore: raw.hasMore === true, mode: ['ai', 'human', 'closed'].includes(raw.mode) ? raw.mode : 'ai', ...bookingCards(raw) }
    },
    async end(token: string) { await call(url('end'), { method: 'POST', token, body: {} }) },
  }
}

/* ------------------------------------------------ agendamento do visitante ------------------------------------------------ */

export type HostedBookingChoice = { provider: 'kloel'; value: BookingChoice } | { provider: 'calendly'; value: CalendlyChoice }
export type HostedBookingReference = { provider: 'kloel'; attempt: BookingAttempt } | { provider: 'calendly'; attempt: CalendlyAttempt }
export type HostedBookingReceipt = { provider: 'kloel'; value: BookingOperation } | { provider: 'calendly'; value: CalendlyReceipt }
export type HostedBookingSlot = { choice: HostedBookingChoice; slot: BookingSlot }
type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
type Saved = { provider: 'kloel' | 'calendly'; token: string; expiresAt: number; attempt: BookingAttempt | CalendlyAttempt }
const hostedBookingKey = (page: Pick<HostedPage, 'tenantId' | 'channelId'>) => `kloel-hosted-booking:${page.tenantId}:${page.channelId}`
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
function journalFailure(): never { throw new Error('Não foi possível preservar o acompanhamento nesta aba. Novas solicitações estão bloqueadas.') }
const local = (host: string) => ['localhost', '127.0.0.1', '[::1]'].includes(host)

/**
 * Cartões de agendamento do link hospedado com a MESMA interface do chat privado (`PrivateChatBookingControls`), sobre a API pública
 * do widget (`/api/v1/public/chat/booking-*` e `calendly-*`). A credencial é o token da sessão do visitante que recebeu o cartão; cada
 * tentativa fica gravada nesta aba (sessionStorage) ANTES do envio, só com a referência opaca e o token daquela sessão, para que a
 * reserva possa ser consultada depois de recarregar ou de iniciar outra conversa — nunca reenviada automaticamente.
 */
export function createHostedBooking(page: Pick<HostedPage, 'tenantId' | 'channelId'>, current: () => { token: string; expiresAt: number } | null, storage: StoragePort) {
  const key = hostedBookingKey(page), choices = new Map<string, { choice: HostedBookingChoice; token: string; expiresAt: number }>(), retired = new Set<string>(); let busy = false
  const choiceKey = (c: HostedBookingChoice) => `${c.provider}:${c.value.choiceId}`
  function saved(): Saved[] {
    const encoded = storage.getItem(key); if (encoded === null) return []
    let raw: any; try { raw = JSON.parse(encoded) } catch { journalFailure() }
    if (!object(raw) || raw.version !== 1 || !Array.isArray(raw.references) || raw.references.length > 20) journalFailure()
    for (const r of raw.references) if (!object(r) || !/^[A-Za-z0-9_-]{43}$/.test(r.token) || !Number.isFinite(r.expiresAt) || !(r.provider === 'kloel' ? validBookingAttempt(r.attempt) : r.provider === 'calendly' && validCalendlyAttempt(r.attempt))) journalFailure()
    if (new Set(raw.references.map((r: Saved) => r.attempt.key)).size !== raw.references.length) journalFailure()
    return structuredClone(raw.references)
  }
  function persist(rows: Saved[]) { const encoded = JSON.stringify({ version: 1, references: rows }); storage.setItem(key, encoded); if (storage.getItem(key) !== encoded) journalFailure() }
  /** Referências ainda consultáveis (a sessão de origem não expirou). */
  const live = () => saved().filter(r => r.expiresAt > Date.now())
  function credential(ref: HostedBookingReference) { const row = live().find(r => r.provider === ref.provider && same(r.attempt, ref.attempt)); if (!row) throw new Error('A reserva não pertence a este acompanhamento.'); return row.token }
  function remember(choice: HostedBookingChoice, session: { token: string; expiresAt: number }) {
    const value = choice.provider === 'kloel' ? parseBookingChoice(choice.value) : parseCalendlyChoice(choice.value), copy = { provider: choice.provider, value } as HostedBookingChoice
    choices.set(choiceKey(copy), { choice: copy, ...session }); return copy
  }
  /** Cartão recebido nesta conversa (mesmo conteúdo) e ainda com a sessão que o recebeu. */
  function known(c: HostedBookingChoice) {
    const entry = choices.get(choiceKey(c)); if (!entry || !same(entry.choice, c)) throw new Error('Atualize as opções desta conversa antes de reservar.')
    const session = current(); if (!session || session.token !== entry.token) throw new Error('Esta conversa foi encerrada. Peça novos horários ao assistente.')
    return entry
  }
  const request = <T,>(path: string, token: string, init: { body?: unknown; extra?: Record<string, string>; timeoutMs?: number } = {}) =>
    call<T>(publicUrl(page, path, init.extra), { method: init.body === undefined ? 'GET' : 'POST', token, body: init.body, timeoutMs: init.timeoutMs, failure: 'Não foi possível confirmar esta operação de agendamento. Consulte a reserva; nada será reenviado automaticamente.' })
  async function consult(ref: HostedBookingReference): Promise<HostedBookingReceipt> {
    const token = credential(ref), extra = { operationKey: ref.attempt.key }
    return ref.provider === 'kloel'
      ? { provider: 'kloel', value: parseBookingOperation(await request('booking-operation', token, { extra }), ref.attempt) }
      : { provider: 'calendly', value: parseCalendlyReceipt(await request('calendly-operation', token, { extra }), ref.attempt, page.tenantId) }
  }
  async function locked<T>(fn: () => Promise<T>): Promise<T> { if (busy) throw new Error('Aguarde a operação atual.'); busy = true; try { return await fn() } finally { busy = false } }
  return {
    /** Mesmo contrato do chat privado: recebe os cartões de uma resposta (ou do histórico) da sessão atual. */
    accept(result: { bookingChoices: BookingChoice[]; calendlyChoices?: CalendlyChoice[] }): HostedBookingChoice[] {
      const session = current(); if (!session) return []
      return [...result.bookingChoices.map(value => ({ provider: 'kloel' as const, value })), ...(result.calendlyChoices ?? []).map(value => ({ provider: 'calendly' as const, value }))].map(choice => remember(choice, session))
    },
    references(): HostedBookingReference[] { return live().map(r => ({ provider: r.provider, attempt: r.attempt }) as HostedBookingReference) },
    consult,
    initialSlots(choice: HostedBookingChoice): HostedBookingSlot[] { known(choice); return retired.has(choiceKey(choice)) ? [] : choice.value.slots.map(slot => ({ choice, slot })) },
    slots: (choice: HostedBookingChoice, from: string, to: string) => locked(async () => {
      const { token, expiresAt } = known(choice), result: HostedBookingSlot[] = [], seen = new Set<string>(); let cursor = from
      if (!Number.isFinite(Date.parse(from)) || Date.parse(to) <= Date.parse(from) || Date.parse(to) - Date.parse(from) > 7 * 86400000) throw new Error('Consulte um período de até sete dias.')
      for (let pageIndex = 0; pageIndex < 20; pageIndex++) {
        const c = choice.value, body = { actionId: c.actionId, expectedRevision: c.actionRevision, from: cursor, to }
        const next: HostedBookingChoice = choice.provider === 'kloel'
          ? { provider: 'kloel', value: parseBookingChoice(await request('booking-slots', token, { body }), { conversationId: c.conversationId, actionId: c.actionId, actionRevision: c.actionRevision }) }
          : { provider: 'calendly', value: parseCalendlyChoice(await request('calendly-slots', token, { body }), { conversationId: c.conversationId, chatOperationKey: c.chatOperationKey }) }
        if (next.value.eventTypeId !== c.eventTypeId || next.value.actionId !== c.actionId || next.value.actionRevision !== c.actionRevision) throw new Error('O evento mudou. Consulte novamente na conversa.')
        const fresh = remember(next, { token, expiresAt })
        for (const slot of fresh.value.slots) { if (seen.has(slot.startAt)) throw new Error('Os horários mudaram. Consulte novamente.'); seen.add(slot.startAt); result.push({ choice: fresh, slot }) }
        if (fresh.value.complete) return result
        if (!fresh.value.nextFrom || fresh.value.nextFrom <= cursor) throw new Error('Não foi possível consultar todos os horários.')
        cursor = fresh.value.nextFrom
        await new Promise(resolve => setTimeout(resolve, 650))
      }
      throw new Error('Não foi possível consultar todos os horários.')
    }),
    create: (selected: HostedBookingSlot, values: BookingValues, acknowledgeNotifications: boolean) => locked(async (): Promise<HostedBookingReceipt> => {
      const { choice, token, expiresAt } = known(selected.choice), c = choice.value
      const previous = live().find(r => r.provider === choice.provider && r.attempt.conversationId === c.conversationId && r.attempt.eventTypeId === c.eventTypeId)
      if (previous) return consult({ provider: previous.provider, attempt: previous.attempt } as HostedBookingReference)
      if (retired.has(choiceKey(choice))) throw new Error('Consulte os horários novamente antes de tentar outra reserva.')
      if (!c.allowCreate || !c.slots.some(slot => same(slot, selected.slot)) || Date.parse(selected.slot.expiresAt) <= Date.now()) throw new Error('Atualize os horários e selecione uma opção disponível.')
      if (choice.provider === 'calendly' && !acknowledgeNotifications) throw new Error('Confirme que está ciente das notificações do Calendly.')
      const attempt = { key: crypto.randomUUID(), conversationId: c.conversationId, actionId: c.actionId, actionRevision: c.actionRevision, eventTypeId: c.eventTypeId, chatOperationKey: c.chatOperationKey }
      const valid = choice.provider === 'kloel' ? bookingValues(choice.value, values) : calendlyValues({ name: values.name ?? '', email: values.email ?? '', timezone: c.timezone })
      // A referência é preservada ANTES do envio: sem ela, nenhuma reserva sai desta aba.
      const rows = live(); if (rows.length >= 20) throw new Error('Limite de reservas acompanhadas nesta aba atingido. Consulte as reservas anteriores; nada foi enviado.')
      persist([...rows, { provider: choice.provider, token, expiresAt, attempt }])
      const body = { idempotencyKey: attempt.key, actionId: c.actionId, expectedRevision: c.actionRevision, choiceId: c.choiceId, quote: selected.slot.quote, values: valid, confirm: true, ...(choice.provider === 'calendly' ? { acknowledgeNotifications: true } : {}) }
      const raw = await request<Record<string, any>>(choice.provider === 'kloel' ? 'bookings' : 'calendly-bookings', token, { body, timeoutMs: 60000 })
      return choice.provider === 'kloel' ? { provider: 'kloel', value: parseBookingOperation(raw.operation, attempt) } : { provider: 'calendly', value: parseCalendlyReceipt(raw.operation, attempt, page.tenantId) }
    }),
    /** Agendador: o visitante só consulta (a reconciliação é da equipe); Calendly: verificação pública do evento. */
    verify: (ref: HostedBookingReference) => locked(async (): Promise<HostedBookingReceipt> => {
      if (ref.provider === 'kloel') return consult(ref)
      return { provider: 'calendly', value: parseCalendlyReceipt(await request('calendly-verify', credential(ref), { body: { operationKey: ref.attempt.key }, timeoutMs: 60000 }), ref.attempt, page.tenantId) }
    }),
    releaseNotSent: (ref: HostedBookingReference) => locked(async () => {
      const receipt = await consult(ref)
      if (receipt.provider === 'kloel' ? receipt.value.status !== 'not_sent' : !['not_sent', 'failed'].includes(receipt.value.status) || receipt.value.needsReconciliation) throw new Error('Esta reserva não pode ser descartada; consulte o resultado.')
      persist(saved().filter(r => r.attempt.key !== ref.attempt.key))
      for (const { choice } of choices.values()) if (choice.provider === ref.provider && choice.value.conversationId === ref.attempt.conversationId && choice.value.eventTypeId === ref.attempt.eventTypeId) retired.add(choiceKey(choice))
    }),
    management: (ref: HostedBookingReference) => locked(async () => {
      const receipt = await consult(ref), token = credential(ref)
      if (receipt.value.status !== 'confirmed') throw new Error('Aguarde a confirmação da reserva antes de abrir o gerenciamento.')
      if (receipt.provider === 'kloel') {
        const raw = await request<Record<string, any>>('booking-management-link', token, { body: { operationKey: ref.attempt.key } })
        let link: URL; try { link = new URL(String(raw.url)) } catch { throw new Error('Link de reserva inválido.') }
        const params = new URLSearchParams(link.hash.slice(1)), here = window.location
        if (raw.bookingRef !== receipt.value.bookingRef || !(link.origin === here.origin || local(link.hostname) && local(here.hostname)) || link.username || link.password || link.search || !/^\/c\/o-[a-f0-9]{24}\/[a-z0-9-]{1,80}$/.test(link.pathname) || params.get('booking') !== raw.bookingRef || !/^[A-Za-z0-9_-]{43}$/.test(params.get('manage') ?? '') || [...params.keys()].length !== 2) throw new Error('Link de reserva inválido.')
        return [{ label: 'Gerenciar reserva', url: link.href }]
      }
      const raw = await request<Record<string, any>>('calendly-management-links', token, { extra: { operationKey: ref.attempt.key } })
      if (raw.bookingRef !== receipt.value.bookingRef) throw new Error('Consulte o recibo original antes dos links.')
      return [...(raw.cancelUrl ? [{ label: 'Cancelar no Calendly', url: calendlyUrl(raw.cancelUrl, 'cancel') }] : []), ...(raw.rescheduleUrl ? [{ label: 'Reagendar no Calendly', url: calendlyUrl(raw.rescheduleUrl, 'reschedule') }] : [])]
    }),
  }
}
export type HostedBooking = ReturnType<typeof createHostedBooking>
