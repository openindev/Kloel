import { createAgentTestService, type AgentChatResult } from '../engine/agent-test'
import { createAgentTestJournal, type ChatReference } from '../engine/agent-test-journal'
import type { EngineContext } from '../engine/session'
import type { ExpectedContext } from '../engine/types'
import { createBeforeContextService, beforeOpeningAvailable, type BeforeHistory, type BeforeOpeningAttempt } from '../engine/before-context'
import { createBeforeOpeningJournal } from '../engine/before-context-journal'

/** Only identifiers are retained. An unresolved request is consulted, never resubmitted. */
export function createCascaChatSession(context: EngineContext, expected: ExpectedContext, storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, agentId: string, options?: { webSearch?: boolean; beforeRevision?: number }) {
  context.assertCurrent()
  const api = createAgentTestService(context, agentId)
  const journal = createAgentTestJournal(storage, expected, agentId)
  const openingJournal = options?.beforeRevision === undefined ? null : createBeforeOpeningJournal(storage, expected, agentId)
  const before = options?.beforeRevision === undefined ? null : createBeforeContextService(context, agentId)
  let conversationId: string | undefined = journal.read().pending?.conversationId
  let prepared = !before
  let busy = false
  function accept(attempt: ChatReference, result: AgentChatResult) {
    context.assertCurrent()
    journal.record(attempt, result.sheetOperations, true, context.assertCurrent)
    conversationId = result.conversationId
    return result
  }
  async function recover() {
    context.assertCurrent()
    const attempt = journal.read().pending
    if (!attempt) throw Error('Não há resposta pendente para consultar.')
    const operation = await api.chatOperation(attempt.key, attempt.conversationId)
    context.assertCurrent()
    if (operation.status === 'succeeded' && operation.result) return accept(attempt, operation.result)
    journal.record(attempt, operation.sheetOperations, operation.status === 'failed', context.assertCurrent)
    if (operation.status === 'failed') throw Error('A resposta falhou. Você pode enviar outra mensagem.')
    throw Error('A resposta ainda não foi confirmada. Consulte novamente; a mensagem não será reenviada.')
  }
  return {
    get conversationId() { return conversationId },
    get pending() { context.assertCurrent(); return journal.read().pending },
    get operationReferences() { context.assertCurrent(); return journal.read().operations },
    async prepare(): Promise<BeforeHistory['items']> {
      context.assertCurrent()
      if (busy) throw Error('Aguarde a preparação atual.')
      if (prepared || conversationId || !before || !openingJournal) { prepared = true; return [] }
      if (journal.read().pending) throw Error('Consulte a resposta pendente antes de abrir outra conversa.')
      busy = true
      try {
        const availability = await before.availability()
        if (!availability.enabled || availability.revision !== options?.beforeRevision) throw Error('A mensagem inicial mudou. Atualize o assistente antes de testar.')
        let attempt = openingJournal.read().active, opening
        if (attempt) opening = await before.opening(attempt)
        else {
          attempt = { key: crypto.randomUUID(), agentId, expectedConfigRevision: availability.revision, mode: 'test', ...(availability.httpSource ? { expectedHttpRevision: availability.httpSource.revision } : {}) } satisfies BeforeOpeningAttempt
          openingJournal.reserve(attempt, context.assertCurrent)
          try { opening = await before.open(attempt) }
          catch { context.assertCurrent(); opening = await before.opening(attempt) }
        }
        if (!beforeOpeningAvailable(availability, opening)) {
          if (opening.status === 'ready') openingJournal.archiveReady(attempt, opening, context.assertCurrent)
          throw Error(`A abertura da conversa ainda não está disponível. Referência ${attempt.key}; atualize para conferir a configuração.`)
        }
        const items: BeforeHistory['items'] = []
        let cursor: string | undefined
        for (let page = 0; page < 20; page++) {
          const history = await before.history(attempt, opening, cursor)
          if (history.items.some(row => items.some(old => old.id === row.id))) throw Error('O histórico mudou. Atualize para conferir a conversa.')
          items.push(...history.items)
          if (!history.hasMore) { openingJournal.archiveReady(attempt, opening, context.assertCurrent); conversationId = opening.conversationId; prepared = true; return items }
          if (!history.cursor || history.cursor === cursor) throw Error('O histórico não pôde ser consultado completamente.')
          cursor = history.cursor
        }
        throw Error('O histórico excede o limite desta consulta. A referência foi preservada.')
      } finally { busy = false }
    },
    async consult() {
      if (busy) throw Error('Aguarde a consulta atual.')
      busy = true
      try { return await recover() } finally { busy = false }
    },
    async send(message: string) {
      context.assertCurrent()
      if (busy) throw Error('Aguarde a resposta atual.')
      if (journal.read().pending) throw Error('Consulte a resposta pendente antes de enviar outra mensagem.')
      if (!prepared) throw Error('Prepare a mensagem inicial antes de enviar uma mensagem.')
      if (!message.trim() || message.length > 20000) throw Error('Escreva uma mensagem de até 20 mil caracteres.')
      busy = true
      const attempt = { key: crypto.randomUUID(), ...(conversationId ? { conversationId } : {}) }
      try {
        journal.reserve(attempt, context.assertCurrent)
        try { return accept(attempt, await api.chat(message, attempt.key, conversationId, options)) }
        catch { context.assertCurrent(); return await recover() }
      } finally { busy = false }
    },
  }
}
export type CascaChatSession = ReturnType<typeof createCascaChatSession>
