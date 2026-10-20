import '@/domain/ext/billing'
import type { DemoDB, Invoice } from '@/domain/types'
import { defaultBillingProfile, defaultContactSettings } from '../defaults'

/**
 * Seed adicional do módulo "billing / primeiro acesso" (arrays são concatenados ao seed base).
 * - Faturas mais antigas (pagas, demonstrativas) da Clínica Bem Viver para o histórico do portal financeiro.
 * - Conta fictícia em PRIMEIRO ACESSO para testar o onboarding sem cadastro:
 *   primeiro.acesso@exemplo.com.br / demo1234 (organização "Ótica Visão Clara", sem plano).
 */
export default function seed(now: Date): Partial<DemoDB> {
  const day = 86400000
  const iso = (ms: number) => new Date(ms).toISOString()
  const orgId = 'org_bemviver'
  const older: Invoice[] = [4, 5].map((m) => ({
    id: `inv_${m}`,
    orgId,
    number: `KL-2026-${1042 - m}`,
    date: iso(now.getTime() - m * 30 * day),
    amount: 719,
    status: 'paid',
    description: 'Assinatura Kloel',
    lines: [
      { label: 'Kloel Assinatura Solo', amount: 719 },
      { label: 'IVA 0% (autoliquidação)', amount: 0 },
    ],
    cardLabel: 'Visa •••• 4242',
    simulated: true,
  }))

  const obOrg = 'org_visaoclara'
  const obUser = 'usr_primeiroacesso'
  const created = iso(now.getTime() - 10 * 60 * 1000)
  return {
    invoices: older,
    users: [{ id: obUser, firstName: '', lastName: '', email: 'primeiro.acesso@exemplo.com.br', password: 'demo1234', language: 'pt-BR', createdAt: created }],
    organizations: [{ id: obOrg, name: 'Ótica Visão Clara', slug: 'otica-visao-clara', timezone: 'America/Sao_Paulo', onboardingCompleted: false, onboardingStep: 'plan', createdAt: created }],
    memberships: [{ id: 'mbr_primeiroacesso', orgId: obOrg, userId: obUser, role: 'admin', joinedAt: created }],
    billingProfiles: [defaultBillingProfile(obOrg, 'Ótica Visão Clara')],
    contactSettings: [defaultContactSettings(obOrg)],
  }
}
