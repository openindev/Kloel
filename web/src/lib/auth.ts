import { useStore } from '@/data/store'
import { engineSession } from '@/services/engine/session'

/** Credentials go only to the authenticated API; cookie rotation is serialized. */
export async function login(email: string, password: string): Promise<boolean> {
  await engineSession.login(email, password)
  return true
}

export const logout = () => engineSession.logout()

export function emailExists(email: string) {
  return useStore.getState().db.users.some((u) => u.email.toLowerCase() === email.trim().toLowerCase())
}

/** Endereço público da organização (sem acentos, minúsculas, hífens): base de /c/<slug> e /r/<slug>. */
export function slugifyOrgName(name: string) {
  return (
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'minha-empresa'
  )
}

/**
 * Slug único entre as organizações existentes: "clinica-bem-viver", depois "clinica-bem-viver-2", "-3"…
 * Sem isso, duas empresas com o mesmo nome dividiam /r/<slug> e /c/<slug> (indicações e agendamentos iam para a primeira).
 */
export function uniqueOrgSlug(orgs: { slug: string }[], name: string) {
  const base = slugifyOrgName(name)
  const taken = new Set(orgs.map((o) => o.slug))
  let slug = base
  for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`
  return slug
}

/** Cria usuário + organização nova (vazia) e inicia o primeiro acesso. */
export async function register(input: { company: string; email: string; password: string; firstName?: string; lastName?: string; referralCode?: string }) {
  await engineSession.signup(input.company, input.email, input.password, input.referralCode)
  const identity = engineSession.getSnapshot().data?.identity
  if (!identity?.tenantId) throw new Error('Não foi possível confirmar o acesso à empresa.')
  return { userId: identity.userId, orgId: identity.tenantId }
}

/** Cria nova organização para o usuário atual (seleção de organização). */
export async function createOrganization(name: string) {
  await engineSession.createOrganization(name)
  return engineSession.getSnapshot().data?.identity.tenantId ?? undefined
}
