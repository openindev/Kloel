import { useMemo } from 'react'
import '@/domain/ext/mais-b'
import type { Role, Subscription } from '@/domain/types'
import { useCollection } from '@/data/store'
import { planOf, productByKey, PRODUCTS } from '@/data/catalogs/plans'

/**
 * Regras de plano usadas pelo módulo "mais-b".
 * - Usuários: limite = maior `limits.users` entre as assinaturas ativas (Voice Solo = 3, observado em "Uso: Usuários 1 / 3").
 *   Sem nenhuma assinatura que defina o limite, vale 1 usuário (planos Solo de WhatsApp/Webchat: "1 usuário"). INFERIDO.
 *   Convites pendentes contam no limite (ao serem aceitos viram membros). INFERIDO.
 * - E-Mail IA: cada assinatura ativa "Kloel E-Mail IA" inclui 1 caixa de entrada com agente ativo (catálogo de planos).
 */
export function userLimitFrom(subs: Subscription[]) {
  let limit: number | undefined
  let source: Subscription | undefined
  for (const s of subs) {
    if (s.status !== 'active') continue
    const l = planOf(s.product, s.plan)?.limits.users
    if (typeof l === 'number' && (limit === undefined || l > limit)) {
      limit = l
      source = s
    }
  }
  return { limit: limit ?? 1, source }
}

export function planLabel(s: Subscription | undefined) {
  if (!s) return 'atual'
  const product = productByKey(s.product)
  const plan = planOf(s.product, s.plan)
  const short = s.product === 'voice' ? 'Voice' : s.product === 'whatsapp' ? 'WhatsApp' : s.product === 'webchat' ? 'Webchat' : product.name
  return `${short} ${plan?.name ?? s.plan}`
}

export function useUserLimit() {
  const subs = useCollection('subscriptions')
  const memberships = useCollection('memberships')
  const invites = useCollection('invites')
  return useMemo(() => {
    const { limit, source } = userLimitFrom(subs)
    const now = Date.now()
    const pending = invites.filter((i) => i.status === 'pending' && new Date(i.expiresAt).getTime() > now).length
    const members = memberships.length
    const used = members + pending
    return { limit, used, members, pending, reached: false, unlimited: limit >= 999, source, label: planLabel(source), hasAuthoritativeQuota: false }
  }, [subs, memberships, invites])
}

export const EMAIL_PLAN = PRODUCTS.find((p) => p.key === 'email')!.plans[0]!

export function useEmailCapacity() {
  const subs = useCollection('subscriptions')
  const inboxes = useCollection('emailInboxes')
  return useMemo(() => {
    const included = subs.filter((s) => s.product === 'email' && s.status === 'active').length
    const active = inboxes.filter((i) => i.agentEnabled).length
    return { included, active, hasSubscription: included > 0, canActivate: true, accessAllowed: true, hasAuthoritativeQuota: false, price: EMAIL_PLAN.monthly ?? 299 }
  }, [subs, inboxes])
}

export const canManageShared = (role: Role) => role === 'admin' || role === 'editor'
export const canManageUsers = (role: Role) => role === 'admin'
export const canManageApiKeys = (role: Role) => role === 'admin' || role === 'editor'
