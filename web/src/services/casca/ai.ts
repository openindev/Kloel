import type { AIEngine, GeneratedAssistant } from '../types'
import type { ProgressFn } from '../runtime'
import { captureEngineContext, engineSession } from '../engine/session'
import { emailAgentClient } from '../engine/email-agents'
import { knowledgeCommands } from './knowledge'
import { createCascaChatSession, type CascaChatSession } from './test-chat'

const chats = new Map<string, CascaChatSession>()
function requiredAgent(context?: { agentId: string }) {
  if (!context?.agentId) throw Error('Selecione um assistente salvo para continuar.')
  return context.agentId
}
const progress = (fn: ProgressFn | undefined, complete: boolean, label: string) => fn?.({ step: complete ? 1 : 0, total: 1, percent: complete ? 100 : 0, label })
function template(): GeneratedAssistant {
  return { companyName: '', website: '', brandColor: '#585DF5', faviconLetter: 'K', assistantName: 'Assistente', greeting: 'Olá! Como posso ajudar?', companyInfo: '', faq: [], pagesAnalyzed: 0 }
}

/** Site e mídia são importados no motor. As informações (perguntas e respostas) são geradas em seguida. */
export const realAI: AIEngine = {
  generateGenericAssistant: template,
  async generateAssistantFromWebsite(url, onProgress, context) {
    const agentId = requiredAgent(context)
    progress(onProgress, false, 'Importando página…')
    const row = await knowledgeCommands(agentId, 'website-generator').importWebsite(url)
    progress(onProgress, true, 'Página importada')
    return { ...template(), website: row.url ?? url, companyInfo: row.content, pagesAnalyzed: 1 }
  },
  async generateCompanyInfo(url, onProgress, context) {
    const agentId = requiredAgent(context)
    progress(onProgress, false, 'Lendo o site…')
    const row = await knowledgeCommands(agentId, 'company-info').importWebsite(url)
    progress(onProgress, false, 'Gerando informações…')
    try { await knowledgeCommands(agentId, `faq-${row.id}`).generate(row.id) } catch { /* o texto da empresa continua disponível */ }
    progress(onProgress, true, 'Informações importadas')
    return row.content
  },
  async crawlWebsite(url, onProgress, context) {
    const agentId = requiredAgent(context)
    progress(onProgress, false, 'Lendo as páginas do site…')
    const row = await knowledgeCommands(agentId, 'website').importWebsite(url)
    progress(onProgress, false, 'Gerando informações…')
    const created = await knowledgeCommands(agentId, `faq-${row.id}`).generate(row.id)
    const pages = row.extraction?.pageCount || 1
    progress(onProgress, true, `${pages} ${pages === 1 ? 'página' : 'páginas'}`)
    return { pages, entries: Array.from({ length: created }, () => ({ question: row.title, answer: '' })) }
  },
  async processDocument(file, onProgress, context) {
    const agentId = requiredAgent(context)
    if (!(file instanceof File)) throw Error('Selecione o arquivo original para enviar.')
    progress(onProgress, false, 'Enviando mídia…')
    const row = await knowledgeCommands(agentId, 'document').upload(context?.title?.trim() || file.name, file)
    progress(onProgress, false, 'Gerando informações…')
    let created = 0
    try { created = await knowledgeCommands(agentId, `faq-${row.id}`).generate(row.id) } catch { created = 0 }
    progress(onProgress, true, 'Mídia importada')
    return { entries: [{ question: row.title, answer: row.content }, ...Array.from({ length: created }, () => ({ question: row.title, answer: '' }))] }
  },
  async chatReply(agent, _knowledge, message, _history) {
    const context = captureEngineContext(), expected = engineSession.getSnapshot().data!.identity.context
    if (!agent.id || agent.orgId !== context.tenantId) throw Error('Selecione um assistente desta organização para conversar.')
    context.assertCurrent()
    const key = `${context.generation}:${context.tenantId}:${agent.id}`
    let chat = chats.get(key)
    if (!chat) { chats.clear(); chat = createCascaChatSession(context, expected, window.sessionStorage, agent.id); chats.set(key, chat) }
    const result = chat.pending ? await chat.consult() : await chat.send(message)
    context.assertCurrent()
    return { text: result.text, usedKnowledgeIds: [] }
  },
  async draftEmailReply(input, onProgress) {
    const context = captureEngineContext(), expected = engineSession.getSnapshot().data!.identity.context
    if (!input.mailboxId || !input.messageId) throw Error('Abra uma mensagem da caixa conectada para gerar a resposta.')
    const api = emailAgentClient(context), storage = window.sessionStorage
    const slot = `kloel-casca-mail-draft:${expected.userId}:${expected.tenantId}:${input.mailboxId}:${input.messageId}`
    let reference = storage.getItem(slot), fresh = false
    if (!reference) { reference = JSON.stringify({ context: expected, key: crypto.randomUUID() }); storage.setItem(slot, reference); fresh = true }
    context.assertCurrent()
    if (storage.getItem(slot) !== reference) throw Error('Não foi possível acompanhar a geração da resposta.')
    const pending = JSON.parse(reference)
    if (JSON.stringify(pending.context) !== JSON.stringify(expected) || !/^[0-9a-f-]{36}$/i.test(pending.key)) throw Error('A geração pertence a outra sessão.')
    progress(onProgress, false, 'Gerando resposta…')
    if (fresh) {
      try {
        const draft = await api.generate(input.mailboxId, input.messageId, input.instruction ?? '', pending.key)
        context.assertCurrent(); storage.removeItem(slot); progress(onProgress, true, 'Resposta gerada'); return draft.text
      } catch { context.assertCurrent() }
    }
    const receipt = await api.generation(input.mailboxId, input.messageId, pending.key)
    if (receipt.status === 'failed') { storage.removeItem(slot); throw Error('Não foi possível gerar a resposta. Você pode tentar novamente.') }
    if (receipt.status !== 'draft' || !receipt.draftId) throw Error('A geração ainda não foi confirmada. Tentar novamente consultará a mesma solicitação.')
    const draft = (await api.drafts(input.mailboxId)).find(d => d.id === receipt.draftId && d.messageId === input.messageId)
    if (!draft) throw Error('A resposta ainda não está disponível para consulta.')
    context.assertCurrent(); storage.removeItem(slot); progress(onProgress, true, 'Resposta gerada'); return draft.text
  },
  summarizeTranscript() { throw Error('Abra a conversa salva para consultar seu resumo.') },
}
