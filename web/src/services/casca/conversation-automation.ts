import type { EngineContext } from '../engine/session'
import { EngineError } from '../engine/http'
import { createManualAdmissionJournal, createManualAdmissionService, type ManualAdmissionContext, type ManualAdmissionOperation } from '../engine/whatsapp-manual-admission'
import { createRecipientJournal, createRecipientAttestationService, type RecipientContext } from '../engine/whatsapp-recipient-attestation'
import { createWhatsAppJobOnceJournal, createWhatsAppJobOnceService, whatsappJobOnceResolved } from '../engine/whatsapp-job-once'
import { createWhatsAppConversationReplyService } from '../engine/whatsapp-conversation-replies'

type Identity = { userId: string; tenantId: string; membershipId: string; authorityVersion: string }
type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
const unavailable = () => Error('A situação da conversa mudou. Consulte novamente antes de confirmar.')

/** Preparação, declaração de destinatário e execução são decisões distintas; recuperação é somente leitura. */
export function createConversationAutomation(context: EngineContext, conversationId: string, identity: Identity, storage: StoragePort) {
  const scope = { ...identity, conversationId }, admission = createManualAdmissionService(context, conversationId), recipient = createRecipientAttestationService(context, conversationId)
  const admissions = createManualAdmissionJournal(() => storage, scope), recipients = createRecipientJournal(() => storage, scope)
  const executions = createWhatsAppJobOnceJournal(() => storage, identity), jobs = createWhatsAppJobOnceService(context)
  const replies = createWhatsAppConversationReplyService(context, conversationId)
  let busy = false
  const exclusive = async <T>(operation: () => Promise<T>) => {
    context.assertCurrent(); if (busy) throw Error('Aguarde a operação atual.'); busy = true
    try { const value = await operation(); context.assertCurrent(); return value } finally { busy = false }
  }
  const executionRef = (prepared: ManualAdmissionOperation) => {
    const ref = executions.read(), archived = executions.archived().find(row => row.jobId === prepared.jobId)
    if (ref && ref.jobId !== prepared.jobId) throw Error('Há outra resposta em acompanhamento. Consulte-a antes de continuar.')
    const found = ref ?? archived
    if (found && found.expectedVersion !== prepared.jobVersion) throw unavailable()
    return found
  }
  return {
    async recipient() {
      const state = await recipient.context(), ref = recipients.read()
      const receipt = ref ? await recipient.operation(ref) : undefined
      const reply = receipt ? await replies.context(undefined, receipt.id) : undefined
      context.assertCurrent(); return { state, receipt, reply, pending: !!ref && !receipt }
    },
    attest(state: RecipientContext, evidenceId: string) {
      return exclusive(async () => {
        const prior = recipients.read(); if (prior) return recipient.operation(prior)
        const evidence = state.evidence.items.find(row => row.evidenceId === evidenceId)
        if (state.conversationId !== conversationId || !state.canAttest || !state.evidence.complete || !evidence || Date.parse(evidence.expiresAt) <= Date.now()) throw unavailable()
        const ref = { key: crypto.randomUUID(), expectedVersion: state.version, evidenceId }
        recipients.remember(ref)
        try { return await recipient.attest(ref) }
        catch (error) {
          if (error instanceof EngineError && error.status === 409 && error.code === 'recipient_attestation_not_admitted') { context.assertCurrent(); recipients.clearResolved(ref) }
          throw error
        }
      })
    },
    resetRecipient() {
      return exclusive(async () => {
        const ref = recipients.read(); if (!ref) return
        const receipt = await recipient.operation(ref)
        const reply = await replies.context(undefined, receipt.id)
        if (!receipt.consumedByReplyKey && Date.parse(receipt.expiresAt) > Date.now() && !['attestation_stale', 'attestation_unavailable'].includes(reply.reasonCode ?? '')) throw Error('Esta confirmação ainda está válida para uma resposta.')
        context.assertCurrent(); recipients.clearResolved(ref)
      })
    },
    async admission() {
      const state = await admission.context(), ref = admissions.read()
      const prepared = ref ? await admission.operation(ref) : undefined
      const jobRef = prepared ? executionRef(prepared) : undefined
      const execution = jobRef ? await jobs.operation(jobRef) : undefined
      context.assertCurrent(); return { state, prepared, execution }
    },
    prepare(state: ManualAdmissionContext, evidenceId?: string) {
      return exclusive(async () => {
        const prior = admissions.read(); if (prior) return admission.operation(prior)
        if (state.conversationId !== conversationId || !state.canAdmit || !state.sourceMessageId || !state.windowExpiresAt || Date.parse(state.windowExpiresAt) <= Date.now()) throw unavailable()
        if (evidenceId && (!state.evidence.complete || !state.evidence.items.some(row => row.evidenceId === evidenceId && Date.parse(row.expiresAt) > Date.now()))) throw unavailable()
        const ref = { key: crypto.randomUUID(), expectedVersion: state.version }
        admissions.remember(ref)
        try { return await admission.admit(ref, state.sourceMessageId, evidenceId) }
        catch (error) {
          if (error instanceof EngineError && error.status === 409 && error.code === 'whatsapp_manual_ai_not_admitted') { context.assertCurrent(); admissions.clearResolved(ref) }
          throw error
        }
      })
    },
    run(prepared: ManualAdmissionOperation) {
      return exclusive(async () => {
        const ref = admissions.read(); if (!ref) throw unavailable()
        const current = await admission.operation(ref)
        if (current.jobId !== prepared.jobId || current.jobVersion !== prepared.jobVersion) throw unavailable()
        const prior = executionRef(current)
        if (prior) return jobs.operation(prior)
        const attempt = { jobId: current.jobId, expectedVersion: current.jobVersion }
        executions.remember(attempt)
        // A timeout keeps the original pointer; subsequent clicks only consult its receipt.
        const result = await jobs.run(attempt)
        if (whatsappJobOnceResolved(result)) executions.archive(attempt)
        return result
      })
    },
    resetCompletedAdmission() {
      return exclusive(async () => {
        const ref = admissions.read(); if (!ref) return
        const prepared = await admission.operation(ref), jobRef = executionRef(prepared)
        if (!jobRef) throw Error('A resposta preparada ainda não foi executada.')
        const execution = await jobs.operation(jobRef), state = await admission.context()
        if (!whatsappJobOnceResolved(execution) || state.sourceMessageId === prepared.sourceMessageId) throw Error('Aguarde uma nova mensagem antes de preparar outra resposta.')
        if (executions.read()?.jobId === jobRef.jobId) executions.archive(jobRef)
        context.assertCurrent(); admissions.clearResolved(ref)
      })
    },
  }
}
