import type { MessagingService, OAuthService, BillingService, WebhookService } from '../types'
import { runSteps, hash, SimulatedError } from '../runtime'

export const simulatedMessaging: MessagingService = {
  async connectWhatsAppBusiness(onProgress) {
    await runSteps(
      [{ label: 'Abrindo cadastro do WhatsApp Business', ms: 1000 }, { label: 'Selecionando conta e número', ms: 1100 }, { label: 'Concluindo conexão', ms: 900 }],
      onProgress,
    )
    return { businessName: 'Conta WhatsApp de demonstração', number: '+55 11 90000-0300' }
  },
  async verifyNumberOwnership(number, onProgress) {
    if (number.replace(/\D/g, '').length < 10) throw new SimulatedError('Número inválido.', 'INVALID_PHONE')
    await runSteps([{ label: 'Gerando QR code', ms: 700 }, { label: 'Aguardando leitura do QR code', ms: 2400 }, { label: 'Número verificado', ms: 500 }], onProgress)
    return { verified: true }
  },
  async sendTestMessage(channel, to) {
    await new Promise((r) => setTimeout(r, 800))
    return { id: `msg_${hash(channel + to + Date.now())}`, simulated: true }
  },
}

export const simulatedOAuth: OAuthService = {
  async connect(provider, purpose, onProgress) {
    await runSteps(
      [{ label: `Abrindo login ${provider === 'google' ? 'Google' : 'Microsoft'}`, ms: 900 }, { label: 'Autorizando acesso', ms: 1000 }, { label: 'Conta conectada', ms: 500 }],
      onProgress,
    )
    const domain = provider === 'google' ? 'gmail.example' : 'outlook.example'
    return { email: `${purpose.toLowerCase().replace(/[^a-z]/g, '') || 'agenda'}@${domain}` }
  },
}

export const simulatedBilling: BillingService = {
  async checkout(lines, card, onProgress) {
    const digits = card.number.replace(/\D/g, '')
    if (digits.length < 13) throw new SimulatedError('Número do cartão incompleto.', 'INVALID_CARD')
    if (!/^\d{2}\s*\/\s*\d{2}$/.test(card.expiry)) throw new SimulatedError('Validade inválida (use MM/AA).', 'INVALID_EXPIRY')
    if (!/^\d{3,4}$/.test(card.cvc)) throw new SimulatedError('CVC inválido.', 'INVALID_CVC')
    await runSteps(
      [{ label: 'Validando dados', ms: 700 }, { label: 'Processando pagamento', ms: 1300 }, { label: 'Ativando assinatura', ms: 700 }],
      onProgress,
      { fail: digits === '4000000000000002' ? 'Cartão recusado (cartão de teste de recusa 4000 0000 0000 0002).' : false },
    )
    const brand = digits.startsWith('4') ? 'Visa' : digits.startsWith('5') ? 'Mastercard' : 'Cartão'
    return { invoiceNumber: `KL-DEMO-${hash(lines.map((l) => l.label).join() + Date.now()) % 100000}`, last4: digits.slice(-4), brand }
  },
  async verifyIdentity(onProgress) {
    await runSteps(
      [{ label: 'Iniciando verificação', ms: 800 }, { label: 'Analisando documento', ms: 1400 }, { label: 'Comparando selfie', ms: 1200 }],
      onProgress,
    )
    return { status: 'verified' }
  },
}

export const simulatedWebhooks: WebhookService = {
  async test(cfg, onProgress) {
    const url = cfg.url?.trim() ?? ''
    if (!/^https?:\/\/.+/i.test(url)) throw new SimulatedError('Informe uma URL começando com http:// ou https://', 'INVALID_URL')
    await runSteps([{ label: 'Enviando requisição de teste', ms: 900 }, { label: 'Aguardando resposta', ms: 700 }], onProgress)
    const ok = !/erro|fail|500/i.test(url)
    const ms = 80 + (hash(url) % 400)
    return ok
      ? { status: 'success', code: 200, ms, response: JSON.stringify({ ok: true, simulated: true, received: cfg.method ?? 'POST' }, null, 2) }
      : { status: 'error', code: 500, ms, response: JSON.stringify({ error: 'Internal Server Error' }, null, 2) }
  },
}
