import { captureEngineContext, engineSession, type EngineContext } from '../engine/session'
import { EngineError } from '../engine/http'
import type { ExpectedContext } from '../engine/types'

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>
type Receipt = { operationKey: string; changed: true; changedAt: string; otherSessionsRevoked: true }
export function createPasswordCommands(context: EngineContext, storage: Storage, expected: ExpectedContext) {
  const namespace = `kloel-password-v1:${expected.userId}:${expected.tenantId}:${expected.membershipId}:${expected.authorityVersion}`
  let busy = false
  const read = (value: Receipt, key: string) => {
    if (value?.operationKey !== key || value.changed !== true || value.otherSessionsRevoked !== true || !Number.isFinite(Date.parse(value.changedAt))) throw new Error('Não foi possível confirmar a alteração de senha.')
    context.assertCurrent(); storage.removeItem(namespace); return value
  }
  return {
    async save(currentPassword: string, password: string, confirmation: string) {
      context.assertCurrent()
      if (busy) throw new Error('Aguarde a confirmação da senha.')
      busy = true
      try {
        const pending = storage.getItem(namespace)
        if (pending) {
          if (!/^[0-9a-f-]{36}$/i.test(pending)) throw new Error('Não foi possível consultar a alteração anterior.')
          return read(await context.request<Receipt>(`/account/password/operations/${pending}`), pending)
        }
        if (!currentPassword || password.length < 12 || password.length > 128 || password !== confirmation || password === currentPassword) throw new Error('Confira a senha atual e use uma nova senha com 12 a 128 caracteres.')
        const key = crypto.randomUUID(); storage.setItem(namespace, key)
        if (storage.getItem(namespace) !== key) throw new Error('Não foi possível guardar a referência da alteração. Nenhuma senha foi enviada.')
        context.assertCurrent()
        try { return read(await context.request<Receipt>('/account/password', { method: 'POST', body: { operationKey: key, currentPassword, password, confirmation } }), key) }
        catch (error) {
          if (error instanceof EngineError && error.status >= 400 && error.status < 500 && !['password_operation_exists', 'context_changed_in_flight'].includes(error.code)) storage.removeItem(namespace)
          throw error
        }
      } finally { busy = false }
    },
  }
}
export function passwordCommands() {
  const context = captureEngineContext(), expected = engineSession.getSnapshot().data?.identity.context
  if (!expected) throw new Error('Acesse sua conta antes de alterar a senha.')
  return createPasswordCommands(context, sessionStorage, expected)
}
