import { accountClient, type ProfileDraft } from '../engine/account'
import { organizationClient } from '../engine/organization'
import { EngineError } from '../engine/http'
import { captureEngineContext, engineSession, type EngineContext } from '../engine/session'
import type { Profile } from '../engine/types'

const canonical = (p: ProfileDraft) => JSON.stringify({ firstName: p.firstName.trim(), lastName: p.lastName.trim(), language: p.language, phone: p.phone?.trim() || null })

/** Recover an uncertain profile write by reading; never replay it automatically. */
export function createProfileCommands(context: EngineContext, initial: Profile) {
  const api = accountClient(context, initial.id)
  let base = initial, pending: ProfileDraft | undefined, busy = false
  return {
    async save(input: ProfileDraft): Promise<Profile> {
      context.assertCurrent()
      if (busy) throw new Error('Aguarde a confirmação do perfil.')
      busy = true
      try {
        if (pending) {
          const current = await api.profile(); context.assertCurrent()
          if (canonical(current) === canonical(pending)) {
            const sameInput = canonical(input) === canonical(pending)
            pending = undefined; base = current
            if (sameInput) return current
            throw new Error('O perfil anterior foi salvo. Confira os campos antes de salvar a nova alteração.')
          }
          if (current.revision !== base.revision) {
            pending = undefined
            throw new Error('O perfil mudou. Atualize a página antes de salvar novamente.')
          }
          throw new Error('A alteração anterior ainda não foi confirmada. Consulte novamente antes de continuar.')
        }
        pending = { ...input }
        try {
          const saved = await api.saveProfile(base, input); context.assertCurrent()
          if (canonical(saved) !== canonical(input)) throw new Error('O perfil retornado não corresponde à alteração. Consulte novamente.')
          base = saved; pending = undefined
          return saved
        } catch (error) {
          if (error instanceof EngineError && error.status >= 400 && error.status < 500) pending = undefined
          throw error
        }
      } finally { busy = false }
    },
  }
}

export async function saveOrganizationTimezone(timezone: string) {
  new Intl.DateTimeFormat('pt-BR', { timeZone: timezone })
  const context = captureEngineContext('organization:write'), api = organizationClient(context)
  const current = await api.get(); context.assertCurrent()
  const result = await api.save(current, { ...current.settings, timezone })
  context.assertCurrent()
  await engineSession.refresh()
  return result.settings.timezone
}
