import type { EngineContext } from '../engine/session'
import type { ExpectedContext } from '../engine/types'
import { createCRMCaptureService, validCaptureAttempt, type CaptureAttempt, type CaptureProposal } from '../engine/crm-capture'

type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export function createConversationCapture(context: EngineContext, conversationId: string, identity: ExpectedContext, storage: StoragePort) {
  const api = createCRMCaptureService(context), prefix = `kloel:casca:conversation-capture:${identity.userId}:${context.tenantId}:${identity.membershipId}:${identity.authorityVersion}:${conversationId}:`
  let busy = false
  const prior = (id: string): CaptureAttempt | undefined => {
    const value = storage.getItem(prefix + id); if (!value) return
    try { const parsed = JSON.parse(value); if (!validCaptureAttempt(parsed) || parsed.targetId !== id || !['proposal.apply', 'proposal.dismiss'].includes(parsed.kind)) throw Error(); return parsed }
    catch { throw Error('Não foi possível consultar a tentativa preservada. Nenhuma alteração foi repetida.') }
  }
  const write = async (proposal: CaptureProposal, kind: 'proposal.apply' | 'proposal.dismiss', selectedFieldIds: string[] = []) => {
    context.assertCurrent(); if (busy) throw Error('Aguarde a operação atual.'); busy = true
    try {
      const pending = prior(proposal.id)
      if (pending) { const receipt = await api.operation(pending); context.assertCurrent(); storage.removeItem(prefix + proposal.id); return receipt }
      if (proposal.conversationId !== conversationId || kind === 'proposal.apply' && (!proposal.evidenceAvailable || Date.now() >= proposal.expiresAt)) throw Error('Atualize a proposta antes de continuar.')
      if (kind === 'proposal.apply' && (!selectedFieldIds.length || new Set(selectedFieldIds).size !== selectedFieldIds.length || selectedFieldIds.some(id => !proposal.diff.some(field => field.fieldId === id)))) throw Error('Selecione os campos que deseja aplicar.')
      const attempt: CaptureAttempt = { key: crypto.randomUUID(), kind, targetId: proposal.id, revision: proposal.revision,
        ...(kind === 'proposal.apply' ? { contactId: proposal.targetContactId, contactRevision: proposal.targetRevision } : {}) }
      const encoded = JSON.stringify(attempt); storage.setItem(prefix + proposal.id, encoded)
      if (storage.getItem(prefix + proposal.id) !== encoded) throw Error('Não foi possível preservar a tentativa. Nenhuma alteração foi enviada.')
      context.assertCurrent()
      const receipt = await api.write(attempt, kind === 'proposal.apply' ? { selectedFieldIds, overrides: {} } : undefined)
      // Confirmed receipt: the attempt is finished, so the proposal no longer shows "Consultar tentativa".
      context.assertCurrent(); storage.removeItem(prefix + proposal.id); return receipt
    } finally { busy = false }
  }
  return {
    async list(signal?: AbortSignal) {
      const settings = await api.settings(), rows = [], ids = new Set<string>(); let total: number | undefined
      for (let page = 1; page <= 1000; page++) {
        if (signal?.aborted) throw Error('Consulta cancelada.')
        const result = await api.list('proposals', page)
        if (total !== undefined && result.total !== total) throw Error('As propostas mudaram. Consulte novamente.')
        total = result.total
        for (const row of result.items) { if (ids.has(row.id)) throw Error('As propostas mudaram. Consulte novamente.'); ids.add(row.id); if (row.conversationId === conversationId) rows.push(row) }
        if (page * result.limit >= result.total) { if (ids.size !== total) throw Error('A consulta não está completa.'); context.assertCurrent(); return { settings, rows } }
        if (page === 1000) throw Error('Não foi possível carregar todas as propostas.')
        await new Promise(resolve => setTimeout(resolve, 650))
      }
      throw Error('Não foi possível carregar as propostas.')
    },
    async proposal(id: string) {
      const proposal = await api.proposal(id)
      if (proposal.conversationId !== conversationId) throw Error('Esta proposta pertence a outra conversa.')
      return proposal
    },
    apply: (proposal: CaptureProposal, selectedFieldIds: string[]) => write(proposal, 'proposal.apply', selectedFieldIds),
    dismiss: (proposal: CaptureProposal) => write(proposal, 'proposal.dismiss'),
    async consult(id: string) { const ref = prior(id); if (!ref) return undefined; const receipt = await api.operation(ref); context.assertCurrent(); storage.removeItem(prefix + id); return receipt },
    pending: (id: string) => !!prior(id),
  }
}
