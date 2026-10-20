import { EngineError } from '@/services/engine/http'
import { captureEngineContext, engineSession, type EngineContext } from '@/services/engine/session'
import { createWhatsAppService } from '@/services/engine/whatsapp'
import { createWhatsAppAttemptReference } from '@/services/engine/whatsapp-attempt'

export interface MessageContext { channelId?: string; conversationId?: string; subject?: string }
export interface MessageAcceptance { id: string; simulated: false; status: 'accepted'; conversationId?: string }
type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
function accepted(raw: unknown): MessageAcceptance {
  if (!raw || typeof raw !== 'object' || !('messageId' in raw) || typeof raw.messageId !== 'string' || !raw.messageId || raw.messageId.length > 300
    || !('status' in raw) || raw.status !== 'accepted' || 'conversationId' in raw && !identifier(raw.conversationId)) {
    throw new Error('Não foi possível confirmar o envio. Consulte a conversa antes de tentar novamente.')
  }
  return { id: raw.messageId, simulated: false, status: 'accepted', ...('conversationId' in raw ? { conversationId: raw.conversationId as string } : {}) }
}

/** Retain only operation identifiers in the tab; never persist recipients, content or API keys. */
export function createMessagingAdapter(context: EngineContext, userId: string, storage: () => StoragePort, makeKey = () => crypto.randomUUID()) {
  const whatsapp = createWhatsAppService(context)
  const pendingWhatsApp = createWhatsAppAttemptReference(storage, userId, context.tenantId)
  // Reuse the tested reference format in a separate namespace for Resend.
  const emailStorage = (): StoragePort => {
    const target = storage(), name = (key: string) => key.replace('kloel.whatsapp.attempt.', 'kloel.email.attempt.')
    return { getItem: key => target.getItem(name(key)), setItem: (key, value) => target.setItem(name(key), value), removeItem: key => target.removeItem(name(key)) }
  }
  const pendingEmail = createWhatsAppAttemptReference(emailStorage, userId, context.tenantId)
  let sending = false
  return {
    async send(channel: 'whatsapp' | 'email' | 'sms', to: string, body: string, input: MessageContext = {}): Promise<MessageAcceptance> {
      context.assertCurrent()
      if (sending) throw new Error('Aguarde a confirmação do envio em andamento.')
      if (channel === 'sms') throw new Error('SMS não está disponível.')
      if (!body.trim()) throw new Error('Escreva a mensagem.')
      if (input.conversationId !== undefined && !identifier(input.conversationId)) throw new Error('Atualize a conversa antes de enviar.')
      if (channel === 'whatsapp' && (!identifier(input.channelId) || !/^\+[1-9]\d{7,14}$/.test(to))) throw new Error('Escolha a conta de WhatsApp e informe o número completo.')
      if (channel === 'email' && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) || !input.subject?.trim())) throw new Error('Informe o destinatário e o assunto do e-mail.')
      const journal = channel === 'whatsapp' ? pendingWhatsApp : pendingEmail
      const previous = journal.load()
      if (previous.error) throw new Error(previous.error)
      if (previous.key) {
        if (channel === 'whatsapp') {
          const result = await whatsapp.operation(previous.key)
          if (result.status === 'succeeded' || result.status === 'failed') journal.forgetResolved(previous.key)
          throw new Error(result.status === 'succeeded' ? 'O envio anterior foi confirmado. Consulte a conversa antes de enviar outra mensagem.'
            : result.status === 'failed' ? 'O envio anterior falhou. Revise a mensagem antes de tentar novamente.' : 'O envio anterior ainda não foi confirmado. Consulte novamente antes de enviar outra mensagem.')
        }
        const result = await context.request<{ items: unknown[] }>('/providers/operations')
        context.assertCurrent()
        if (!result || !Array.isArray(result.items)) throw new Error('Não foi possível consultar o envio anterior.')
        const matches = result.items.filter(value => value && typeof value === 'object' && 'key' in value && value.key === previous.key && 'operation' in value && value.operation === 'resend.send')
        const receipt = matches.length === 1 ? matches[0] as { status?: string } : undefined
        if (receipt && ['succeeded', 'failed'].includes(receipt.status ?? '')) journal.forgetResolved(previous.key)
        throw new Error(receipt?.status === 'succeeded' ? 'O envio anterior foi confirmado. Consulte a conversa antes de enviar outro e-mail.'
          : receipt?.status === 'failed' ? 'O envio anterior falhou. Revise o e-mail antes de tentar novamente.' : 'O envio anterior ainda não foi confirmado. Consulte novamente antes de enviar outro e-mail.')
      }
      sending = true
      const key = makeKey()
      try {
        journal.remember(key)
        context.assertCurrent()
        const raw = channel === 'whatsapp'
          ? await whatsapp.send({ kind: 'text', channelId: input.channelId!, to, text: body.trim(), ...(input.conversationId ? { conversationId: input.conversationId } : {}) }, key)
          : await context.request('/email/send', { method: 'POST', body: { to, subject: input.subject!.trim(), text: body.trim(), idempotencyKey: key,
            ...(input.conversationId ? { conversationId: input.conversationId } : {}) }, timeoutMs: 60000 })
        context.assertCurrent()
        const result = accepted(raw)
        journal.forgetResolved(key)
        return result
      } catch (error) {
        // A definite refusal before acceptance can be corrected. Ambiguous writes retain their original key.
        if (error instanceof EngineError && error.status >= 400 && error.status < 500 && !['idempotency_conflict', 'context_mismatch', 'context_changed_in_flight'].includes(error.code)) {
          context.assertCurrent()
          journal.forgetResolved(key)
        }
        throw error
      } finally { sending = false }
    },
  }
}

export function sendTestMessage(channel: 'whatsapp' | 'email' | 'sms', to: string, body: string, input?: MessageContext) {
  const context = captureEngineContext()
  const userId = engineSession.getSnapshot().data!.identity.userId
  return createMessagingAdapter(context, userId, () => window.sessionStorage).send(channel, to, body, input)
}
