import type { BillingProfile, Subscription } from '@/domain/types'
import type { CartItem } from '@/domain/ext/billing'
import '@/domain/ext/engine-billing'
import { planOf } from '@/data/catalogs/plans'
import { useStore } from '@/data/store'
import { captureEngineContext, engineSession, type EngineContext } from '../engine/session'
import type { ExpectedContext } from '../engine/types'
import { createBillingService, billingDestination, type BillingCatalog, type BillingStatus, type BillingMode, type BillingOperationKind, type HostedBillingSession } from '../engine/billing'
import { createIdentityService, type IdentityState } from './stripe-identity'
type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
const fail = (message: string): never => { throw Error(message) }
const iso = (epoch: number | null | undefined) => epoch == null ? null : new Date(epoch * 1000).toISOString()
export function selectedBillingPrice(cart: CartItem[], catalog: BillingCatalog) {
  if (cart.length !== 1) return fail('Escolha uma assinatura por contratação.')
  const selected = cart[0], plan = planOf(selected.product, selected.tier)
  const expected = plan && (selected.interval === 'annual' ? plan.annual == null ? null : plan.annual * 12 : plan.monthly)
  if (expected == null || !catalog.configured) return fail('Este plano ainda não está disponível para contratação.')
  const matches = catalog.items.filter(price => price.checkoutUsable && price.currency === 'brl' && price.kloelPlan?.product === selected.product && price.kloelPlan.tier === selected.tier && price.kloelPlan.interval === selected.interval)
  if (matches.length !== 1 || matches[0].unitAmount !== Math.round(expected * 100)) return fail('O preço deste plano mudou. Atualize os planos antes de continuar.')
  return matches[0]
}
export function projectBilling(tenantId: string, catalog: BillingCatalog, status: BillingStatus, identity: IdentityState) {
  const subscriptions: Subscription[] = []
  // Test subscriptions remain visible as provider state but never unlock production features.
  for (const row of catalog.mode === 'live' ? status.subscriptions : []) {
    const price = catalog.items.find(price => price.priceId === row.priceId), plan = price?.kloelPlan
    if (!price || !plan || price.unitAmount === null || price.currency !== 'brl') continue
    subscriptions.push({ id: row.id, orgId: tenantId, product: plan.product, plan: plan.tier, interval: plan.interval, status: row.status,
      priceMonthly: price.unitAmount / 100 / (plan.interval === 'annual' ? 12 : 1), startedAt: iso(row.startedAt), renewsAt: iso(row.currentPeriodEnd),
      ...(row.canceledAt ? { canceledAt: iso(row.canceledAt)! } : {}), engineBilling: { mode: catalog.mode, scheduledCancellation: row.scheduledCancellation, providerSubscriptionId: row.providerSubscriptionId } })
  }
  // Concessão interna (plan-grants): acesso sem cobrança até expiresAt; some sozinha ao expirar.
  for (const grant of status.grants ?? []) {
    if (grant.status !== 'active' || Date.parse(grant.expiresAt) <= Date.now()) continue
    for (const p of grant.products) {
      if (subscriptions.some(s => s.product === p.product && s.status === 'active')) continue
      subscriptions.push({ id: `grant-${grant.id}-${p.product}`, orgId: tenantId, product: p.product, plan: p.tier, interval: 'monthly', status: 'active', priceMonthly: 0,
        startedAt: grant.startsAt, renewsAt: grant.expiresAt, grant: { id: grant.id, expiresAt: grant.expiresAt } })
    }
  }
  const verified = identity.configured && identity.mode === 'live' && identity.verification?.verified === true
  const billingProfiles: BillingProfile[] = [{ orgId: tenantId, organizationName: '', country: '', line1: '', line2: '', city: '', state: '', postalCode: '', taxId: '', email: '', addOns: {}, autoBuyAddOns: false, credits: 0,
    identity: verified ? 'verified' : !identity.verification ? 'not_started' : ['failed', 'canceled', 'redacted'].includes(identity.verification.state) ? 'action_required' : 'pending', engineBilling: { catalog, status, balanceKnown: false, addressKnown: false } }]
  return { subscriptions, billingProfiles, invoices: [] }
}
export async function loadBilling(context: EngineContext) {
  const billing = createBillingService(context)
  const [catalog, status, identity] = await Promise.all([billing.catalog(), billing.status(), createIdentityService(context).state()])
  context.assertCurrent(); return projectBilling(context.tenantId, catalog, status, identity)
}
export function createHostedBillingActions(context: EngineContext, expected: ExpectedContext, storage: StoragePort) {
  const billing = createBillingService(context), namespace = `kloel.casca.billing:${expected.userId}:${context.tenantId}`
  type Ref = { key: string; kind: BillingOperationKind; mode: BillingMode; priceId?: string; sessionId?: string; context: ExpectedContext }
  const name = (kind: BillingOperationKind) => `${namespace}:${kind}`
  const read = (kind: BillingOperationKind): Ref | undefined => {
    const raw = storage.getItem(name(kind)); if (!raw) return
    let value: Ref; try { value = JSON.parse(raw) } catch { return fail('Não foi possível consultar a contratação anterior.') }
    if (!value || !/^[a-f\d-]{36}$/i.test(value.key) || value.kind !== kind || !['test', 'live'].includes(value.mode) ||
        JSON.stringify(value.context) !== JSON.stringify(expected) ||
        value.priceId !== undefined && !/^price_[A-Za-z0-9]+$/.test(value.priceId) ||
        value.sessionId !== undefined && !/^cs_[A-Za-z0-9_]+$/.test(value.sessionId))
      return fail('Atualize a sessão e consulte a contratação anterior.')
    return value
  }
  const remember = (ref: Ref) => {
    context.assertCurrent(); const text = JSON.stringify(ref); storage.setItem(name(ref.kind), text)
    if (storage.getItem(name(ref.kind)) !== text) return fail('Não foi possível preservar a contratação. Nenhuma cobrança foi iniciada.')
  }
  function accepted(ref: Ref, session: HostedBillingSession) {
    context.assertCurrent()
    if (ref.kind === 'stripe.portal') storage.removeItem(name(ref.kind))
    else remember({ ...ref, sessionId: session.sessionId })
    return { session, mode: ref.mode }
  }
  async function begin(kind: BillingOperationKind, cart?: CartItem[]): Promise<{ session: HostedBillingSession; mode: BillingMode; recovered: boolean }> {
      context.assertCurrent()
      const pending = read(kind)
      if (pending) {
        // Recovery is bound to the original receipt, independently of a changed cart or price catalogue.
        const result = await billing.operation(kind, pending.key)
        if (result.status === 'failed') {
          context.assertCurrent(); storage.removeItem(name(kind))
          return fail('A tentativa anterior falhou. Revise os dados e tente novamente.')
        }
        if (result.status !== 'succeeded') return fail('A contratação anterior ainda precisa de confirmação. Consulte novamente antes de iniciar outra.')
        if (!result.result) return fail('O link da contratação anterior não está mais disponível. Consulte o estado do pagamento antes de iniciar outra.')
        return { ...accepted(pending, result.result), recovered: true }
      }
      const catalog = await billing.catalog(), price = kind === 'stripe.checkout' ? selectedBillingPrice(cart!, catalog) : undefined
      if (!catalog.configured || catalog.mode === 'unavailable') return fail('O pagamento ainda não está disponível.')
      // Another click may have completed the catalogue read while this one was waiting.
      if (read(kind)) return begin(kind, cart)
      const ref: Ref = { key: crypto.randomUUID(), kind, mode: catalog.mode, ...(price ? { priceId: price.priceId } : {}), context: expected }
      remember(ref)
      return { ...accepted(ref, await billing.start(kind, ref.key, price?.priceId)), recovered: false }
    }
  async function refresh() {
    const slice = await loadBilling(context); context.assertCurrent()
    useStore.getState().mutate(db => ({ ...db, ...slice })); return slice
  }
  return {
    checkout: (cart: CartItem[]) => begin('stripe.checkout', cart), portal: () => begin('stripe.portal'), refresh,
    async reconcile(sessionId: string) {
      const records = await billing.checkouts()
      if (!records.some(row => row.sessionId === sessionId)) return fail('Esta contratação não pertence à organização atual.')
      const result = await billing.reconcile(sessionId); context.assertCurrent(); await refresh()
      const pending = read('stripe.checkout')
      if (pending?.sessionId === sessionId && ['complete', 'expired'].includes(result.checkoutStatus))
        storage.removeItem(name('stripe.checkout'))
      return result
    },
  }
}
function currentActions() {
  const context = captureEngineContext('billing:manage'), expected = engineSession.getSnapshot().data?.identity.context
  if (!expected) return fail('Atualize sua sessão antes de continuar.')
  return { context, actions: createHostedBillingActions(context, expected, window.sessionStorage) }
}
async function openHosted(kind: BillingOperationKind, cart?: CartItem[]) {
  const { context, actions } = currentActions(), popup = window.open('about:blank', '_blank')
  if (!popup) return fail('Permita a janela de pagamento no navegador e tente novamente.')
  popup.opener = null
  const unsubscribe = engineSession.subscribe(() => {
    if (popup.closed || engineSession.getSnapshot().generation !== context.generation) { popup.close(); unsubscribe() }
  })
  try {
    const result = kind === 'stripe.checkout' ? await actions.checkout(cart!) : await actions.portal()
    context.assertCurrent(); const url = billingDestination(result.session.url, kind)
    if (popup.closed) return fail('A janela de pagamento foi fechada. Abra novamente para continuar a mesma contratação.')
    popup.location.replace(url); return { sessionId: result.session.sessionId, mode: result.mode, recovered: result.recovered }
  } catch (error) { unsubscribe(); popup.close(); throw error }
}
export const openStripeCheckout = (cart: CartItem[]) => openHosted('stripe.checkout', cart)
export const openStripePortal = () => openHosted('stripe.portal')
export const reconcileBillingReturn = (sessionId: string) => currentActions().actions.reconcile(sessionId)
export async function unsupportedBillingChange(): Promise<never> { return fail('Esta alteração ainda não está disponível. Consulte as opções no portal financeiro.') }
