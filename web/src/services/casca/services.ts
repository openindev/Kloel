import type { KloelServices } from '../types'
import { realAI } from './ai'
import { startTestCall } from './telephony'
import { sendTestMessage } from './messaging'
import { connect } from './oauth'
import { captureEngineContext } from '../engine/session'
import { createPhonesService } from '../engine/phones'
import { createIdentityService } from './stripe-identity'
import { verifyImportedNumber, confirmImportCode, purchaseNumber } from './phones'
import { realWebhooks } from './webhooks'
import { connectWhatsAppBusiness } from './whatsapp'

/** Unsupported commands fail explicitly until their existing shell flow is wired. */
const unavailable = async (message: string): Promise<never> => { throw new Error(message) }

export const engineServices: KloelServices = {
  simulated: false,
  ai: realAI,
  oauth: { connect },
  telephony: {
    startTestCall,
    async searchAvailableNumbers(country) {
      const context = captureEngineContext()
      const result = await createPhonesService(context).available({ country, type: 'local' })
      context.assertCurrent()
      return result.map(row => row.phoneNumber)
    },
    async requestDemoCallback(phone, _onProgress, meta) {
      const e164 = '+' + phone.replace(/\D/g, '').replace(/^0+/, '')
      const res = await fetch('/api/v1/public/call-me', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: e164, ...(meta?.name ? { name: meta.name.slice(0, 120) } : {}), ...(meta?.notes ? { notes: meta.notes.slice(0, 2000) } : {}), ...(meta?.context ? { context: meta.context.slice(0, 2000) } : {}) }) })
      const body = await res.json().catch(() => ({})) as { room?: string; error?: { message?: string } }
      if (!res.ok || !body.room) throw new Error(body.error?.message || 'Não foi possível iniciar a ligação.')
      return { reference: body.room }
    },
    purchaseNumber,
    verifyImportedNumber,
    confirmImportCode,
  },
  messaging: {
    sendTestMessage,
    connectWhatsAppBusiness,
    verifyNumberOwnership: () => unavailable('A posse deste número precisa ser confirmada antes de continuar.'),
  },
  billing: {
    checkout: () => unavailable('O pagamento precisa ser concluído na Stripe.'),
    async verifyIdentity(onProgress) {
      const api = createIdentityService(captureEngineContext('billing:manage'))
      const state = await api.state()
      if (!state.configured || !state.verification) throw new Error('Inicie a verificação de identidade antes de continuar.')
      onProgress?.({ step: 0, total: 1, percent: 0, label: 'Consultando a verificação na Stripe' })
      const current = await api.reconcile(state.verification.id)
      if (!current.verified) throw new Error('A Stripe ainda não confirmou a identidade.')
      onProgress?.({ step: 1, total: 1, percent: 100, label: 'Identidade verificada' })
      return { status: 'verified' }
    },
  },
  webhooks: realWebhooks,
}
