import type { Conversation } from '@/domain/types'
import type { EngineContext } from '../engine/session'
import { EngineError } from '../engine/http'
import { createConversationService } from '../engine/conversations'
import { createConversationReplyService, createReplyOperationStorage, type ReplyKind } from '../engine/conversation-replies'
import { createWhatsAppConversationReplyService, createWhatsAppReplyJournal } from '../engine/whatsapp-conversation-replies'
import { createRecipientAttestationService, createRecipientJournal } from '../engine/whatsapp-recipient-attestation'

type Identity = { userId: string; tenantId: string; membershipId: string; authorityVersion: string }
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export type Handling = { mode: 'ai' | 'human' | 'closed'; takeover: boolean; release: boolean; reply: boolean; maxLength: number }
const uncertain = () => new EngineError(0, 'reply_outcome_unknown', 'O resultado ainda não foi confirmado. Consulte a tentativa antes de continuar.')
/** Regras do WhatsApp (janela de 24 h, conversa assumida, origem verificada) explicadas para quem vai responder. */
export const whatsappReplyReasons: Record<string, string> = {
  human_takeover_required: 'assuma o atendimento antes de responder', outside_window: 'o WhatsApp só aceita mensagens livres até 24 horas depois da última mensagem do cliente; aguarde uma nova mensagem dele',
  identity_requires_review: 'a origem desta conversa precisa ser revisada (menu “Mais” › Revisar origem)', inbound_unverified: 'é necessária uma nova mensagem do cliente com origem confirmada pelo WhatsApp',
  inbound_ambiguous: 'há mais de uma origem possível para esta conversa; aguarde uma nova mensagem do cliente', channel_unavailable: 'o número de WhatsApp desta conversa está desconectado ou desativado',
  channel_changed: 'o número de WhatsApp mudou desde a mensagem recebida', provider_unavailable: 'a conexão com o WhatsApp oficial (Meta) não está configurada para esta organização',
  invalid_timestamp: 'não foi possível confirmar o horário da última mensagem do cliente', job_in_flight: 'há uma resposta sendo enviada; aguarde a confirmação',
  send_requires_reconciliation: 'há um envio pendente de confirmação; consulte a tentativa', forbidden: 'seu acesso não permite responder conversas',
  recipient_attestation_required: 'confirme o destinatário (menu “Mais” › Confirmar destinatário)',
}

/** A recovery action only reads its original receipt; it never repeats a send. */
export function createConversationActions(context: EngineContext, conversation: Conversation, identity: Identity, storage: StorageLike, refreshOverride?: () => Promise<Conversation>) {
  const id = conversation.id, web = createConversationReplyService(context), wa = createWhatsAppConversationReplyService(context, id)
  const webScope = `kloel:casca:reply-authority:${encodeURIComponent(identity.membershipId)}:${encodeURIComponent(identity.authorityVersion)}:`
  const scopedStorage = { getItem: (key: string) => storage.getItem(webScope + key), setItem: (key: string, value: string) => storage.setItem(webScope + key, value), removeItem: (key: string) => storage.removeItem(webScope + key) }
  const webJournal = createReplyOperationStorage(scopedStorage, { ...identity, conversationId: id })
  const waJournal = createWhatsAppReplyJournal(() => storage, { ...identity, conversationId: id })
  const recipientJournal = createRecipientJournal(() => storage, { ...identity, conversationId: id })
  const whatsappContext = async () => {
    const ref = recipientJournal.read()
    const receipt = ref ? await createRecipientAttestationService(context, id).operation(ref) : undefined
    const attestationId = receipt && !receipt.consumedByReplyKey && Date.parse(receipt.expiresAt) > Date.now() ? receipt.id : undefined
    return wa.context(undefined, attestationId)
  }
  const controlKey = `kloel:casca:conversation-control:v1:${identity.userId}:${identity.tenantId}:${identity.membershipId}:${identity.authorityVersion}:${id}`
  const controlPending = () => {
    const raw = storage.getItem(controlKey); if (!raw) return undefined
    try { const value = JSON.parse(raw); if (typeof value.expectedVersion !== 'string' || !/^[a-f0-9]{64}$/.test(value.expectedVersion) || !['open', 'pending'].includes(value.status) || Object.keys(value).sort().join(',') !== 'expectedVersion,status') throw Error(); return value as { expectedVersion: string; status: 'open' | 'pending' } }
    catch { throw new EngineError(0, 'reply_storage_unavailable', 'Não foi possível ler a tentativa pendente.') }
  }
  const refresh = async () => {
    context.assertCurrent()
    if (refreshOverride) { const c = await refreshOverride(); context.assertCurrent(); return c }
    const { loadConversation, publishConversation } = await import('./conversations')
    const c = await loadConversation(context, id); publishConversation(context, c); return c
  }
  const pending = () => conversation.channel === 'webchat' ? !!webJournal.read() : conversation.channel === 'whatsapp' ? !!waJournal.read() || !!controlPending() : false
  return {
    pending,
    async handling(): Promise<Handling> {
      if (conversation.channel === 'webchat') { const c = await web.context(id); return { mode: c.mode, ...c.capabilities, maxLength: c.maxLength } }
      if (conversation.channel === 'whatsapp') {
        const control = await createConversationService(context).get(id), c = control.conversation, reply = await whatsappContext()
        const blocked = c.tags.some(t => ['no_ai', 'manual_only', 'requires_review'].includes(t.toLowerCase()))
        const mode = c.status === 'closed' ? 'closed' : c.status === 'pending' || c.tags.includes('human_handoff') ? 'human' : 'ai'
        return { mode, takeover: mode === 'ai', release: mode === 'human' && !blocked, reply: reply.canReply, maxLength: 4096 }
      }
      return { mode: 'closed', takeover: false, release: false, reply: false, maxLength: 0 }
    },
    async recover() {
      if (conversation.channel === 'webchat') {
        const ref = webJournal.read(); if (!ref) return { conversation: await refresh(), outcome: 'none' as const }
        const receipt = await web.operation(ref)
        if (!['succeeded', 'failed'].includes(receipt.status)) throw uncertain()
        const refreshed = await refresh(); webJournal.archive(ref); return { conversation: refreshed, outcome: receipt.status as 'succeeded' | 'failed' }
      }
      const ref = waJournal.read()
      if (ref) {
        const receipt = await wa.operation(ref)
        if (receipt.requiresReconciliation || !['succeeded', 'failed'].includes(receipt.status)) throw uncertain()
        const refreshed = await refresh(); waJournal.clearResolved(ref); return { conversation: refreshed, outcome: receipt.status as 'succeeded' | 'failed' }
      }
      const prior = controlPending()
      if (prior) {
        const current = await createConversationService(context).get(id)
        // A local status edit has no replay endpoint. A GET observes current state, never proves an external send.
        if (current.version === prior.expectedVersion || current.conversation.status !== prior.status) throw uncertain()
      }
      const refreshed = await refresh()
      if (prior) { storage.removeItem(controlKey); if (storage.getItem(controlKey) !== null) throw uncertain() }
      return { conversation: refreshed, outcome: prior ? 'observed' as const : 'none' as const }
    },
    async command(kind: ReplyKind, content?: string) {
      context.assertCurrent()
      if (pending()) throw uncertain()
      let finish = () => {}
      if (conversation.channel === 'webchat') {
        const c = await web.context(id)
        if (!c.capabilities[kind]) throw new EngineError(0, 'reply_not_available', kind === 'reply' ? 'Não é possível responder: assuma o atendimento antes e confira se o visitante ainda está no chat.' : kind === 'takeover' ? 'Esta conversa já está com a equipe ou foi encerrada.' : 'Esta conversa não pode voltar ao assistente agora (encerrada ou bloqueada para IA).')
        const ref = { key: crypto.randomUUID(), conversationId: id, kind, expectedVersion: c.version }
        webJournal.write(ref)
        const receipt = await web.command(ref, content)
        if (receipt.status !== 'succeeded') throw uncertain()
        finish = () => { webJournal.archive(ref) }
      } else if (conversation.channel === 'whatsapp' && kind === 'reply') {
        const c = await whatsappContext()
        if (!c.canReply) throw new EngineError(0, 'reply_not_available', `Não é possível responder agora: ${whatsappReplyReasons[c.reasonCode ?? ''] ?? 'confira o atendimento e o prazo de 24 horas do WhatsApp'}.`)
        const ref = { key: crypto.randomUUID(), expectedVersion: c.version, ...(c.recipientAttestationId ? { recipientAttestationId: c.recipientAttestationId } : {}) }
        waJournal.remember(ref)
        const receipt = await wa.send(ref, content ?? '')
        if (receipt.status !== 'succeeded' || receipt.requiresReconciliation) throw uncertain()
        finish = () => { waJournal.clearResolved(ref) }
      } else if (conversation.channel === 'whatsapp' && (kind === 'takeover' || kind === 'release')) {
        const service = createConversationService(context), c = await service.get(id)
        if (c.conversation.status === 'closed' || kind === 'release' && c.conversation.tags.some(t => ['no_ai','manual_only','requires_review'].includes(t.toLowerCase()))) throw new EngineError(0, 'reply_not_available', c.conversation.status === 'closed' ? 'A conversa está encerrada. Reabra a conversa no menu “Mais” para continuar.' : 'Esta conversa está marcada para atendimento só pela equipe (sem IA) e não pode voltar ao assistente.')
        const status = kind === 'takeover' ? 'pending' : 'open'
        const raw = JSON.stringify({ expectedVersion: c.version, status })
        storage.setItem(controlKey, raw); if (storage.getItem(controlKey) !== raw) throw new EngineError(0, 'reply_storage_unavailable', 'Não foi possível preservar a tentativa. Nenhuma alteração foi enviada.')
        await service.update(c, { status, ...(kind === 'release' ? { tags: c.conversation.tags.filter(t => t !== 'human_handoff') } : {}) })
        finish = () => { storage.removeItem(controlKey); if (storage.getItem(controlKey) !== null) throw uncertain() }
      } else throw new EngineError(0, 'unsupported_channel', 'Ligações não podem ser assumidas por mensagem. Para falar com uma pessoa da equipe durante a ligação, configure a transferência no assistente.')
      const updated = await refresh(); finish(); return updated
    },
  }
}
