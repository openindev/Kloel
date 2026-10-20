import { useState } from 'react'
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import type { BillingInterval, PlanTier } from '@/domain/types'
import { productByKey } from '@/data/catalogs/plans'
import { useCollection, useCurrentRole } from '@/data/store'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/app/misc'
import { PlanCards } from './PlanCards'
import { PlanPageFrame } from './PlanPageFrame'
import { encodeItems, productFromSlug, safeReturnTo } from './lib'
import { AdminOnlyNotice } from './components'

/**
 * /app/add-product/:product — "Adicionar assinatura" (mesma moldura de "Alterar plano").
 * email → título "Preços"; care → "Kloel Care & Setups" + subtítulo (captura ao vivo). Telefone/WhatsApp/Chatbot: reativação (INFERIDO).
 * Produto JÁ ATIVO → redireciona para /app/change-plan/:product (troca proporcional; spec 05 [466]/[468]: somente produtos
 * ainda não assinados aparecem em "Disponível para adicionar").
 */
export default function AddProductPage() {
  const [sp] = useSearchParams()
  // /add-product/:product (Kloel) ou /add-product?productType=email-ai|care (Fonio — fonio-live2/data/admin.json).
  const product = productFromSlug(useParams().product ?? sp.get('productType'))
  const navigate = useNavigate()
  const subs = useCollection('subscriptions')
  const role = useCurrentRole()
  const returnTo = safeReturnTo(sp.get('returnTo'))
  const [interval, setBillingInterval] = useState<BillingInterval>('monthly')

  if (!product) {
    return (
      <PlanPageFrame title="Adicionar assinatura" onBack={() => navigate(returnTo)}>
        <EmptyState title="Produto não encontrado" description="Escolha um produto disponível em Assinatura e faturamento." action={<Button onClick={() => navigate('/app/billing')}>Ir para Assinatura e faturamento</Button>} />
      </PlanPageFrame>
    )
  }

  const def = productByKey(product)
  const active = subs.find((s) => s.product === product && s.status === 'active')
  if (active) return <Navigate to={`/app/change-plan/${product}?returnTo=${encodeURIComponent(returnTo)}`} replace />
  const canceledBefore = subs.some((s) => s.product === product && s.status === 'canceled')
  const core = product === 'voice' || product === 'whatsapp' || product === 'webchat'
  const title = product === 'email' ? 'Preços' : product === 'care' ? 'Kloel Care & Setups' : def.name
  const subtitle =
    product === 'care'
      ? 'Acompanhamento contínuo do seu agente – e uma configuração sob medida quando a parte técnica fica complexa.'
      : core
        ? `Escolha um plano para ${canceledBefore ? 'reativar' : 'adicionar'} este produto. Você revisa o valor antes de confirmar.`
        : undefined

  const canManage = role === 'admin'
  const onSelect = (tier: string) => {
    if (!canManage) return
    const items = encodeItems([{ product, tier: tier as PlanTier, interval: core ? interval : 'monthly' }])
    navigate(`/app/checkout?items=${items}&returnTo=${encodeURIComponent(returnTo)}&from=${encodeURIComponent(`/app/add-product/${product}?returnTo=${encodeURIComponent(returnTo)}`)}`)
  }

  return (
    <PlanPageFrame title={title} subtitle={subtitle} onBack={() => navigate(returnTo)}>
      {!canManage && <AdminOnlyNotice className="mb-8">Somente administradores podem adicionar assinaturas. Peça a um administrador da organização.</AdminOnlyNotice>}
      <PlanCards
        disabled={!canManage}
        product={product}
        interval={core ? interval : 'monthly'}
        onSelect={onSelect}
        variant={core ? 'onboarding' : 'change'}
        onIntervalChange={core ? setBillingInterval : undefined}
      />
    </PlanPageFrame>
  )
}
