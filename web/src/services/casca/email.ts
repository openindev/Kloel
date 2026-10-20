import type { CalendarConnection, EmailInbox, EmailMessage } from '@/domain/types'
import '@/domain/ext/mais-b'
import { useStore } from '@/data/store'
import { makeAgent } from '@/data/seed/defaults'
import { emailAgentClient, defaultAutomationPolicy, defaultReplyPolicy, mailboxConfig, emailFingerprint, type Mailbox, type AutomationState, type MailMessage, type MailDraft, type MailboxConfig } from '../engine/email-agents'
import { captureEngineContext, engineSession, type EngineContext } from '../engine/session'
import { createEmailReplyJournal, emailReplyReceiptClient } from '../engine/email-reply-receipts'
import { EngineError } from '../engine/http'
import { loadConnections } from './oauth'
import { agentCommands, createAgentJournal } from './agents'
import { knowledgeCommands } from './knowledge'
import { createKnowledgeService } from '../engine/knowledge'
import { realAI } from './ai'
import type { ProgressFn } from '../runtime'
import type { ExpectedContext } from '../engine/types'

declare module '@/domain/types' {
  interface EmailInbox { engineEmail?: { mailbox: Mailbox; automation: AutomationState; generation: number } }
  interface EmailMessage { engineEmail?: { message: MailMessage; draft?: MailDraft; generation: number } }
}
const busy = new Set<string>()
function session(permission: 'integrations:execute' | 'integrations:manage' = 'integrations:execute') { const context = captureEngineContext(permission), identity = engineSession.getSnapshot().data!.identity.context; return { context, identity, api: emailAgentClient(context) } }
function selected(inbox: EmailInbox, context: EngineContext): Mailbox { if (inbox.orgId !== context.tenantId || inbox.engineEmail?.generation !== context.generation) throw Error('A caixa mudou. Atualize a página.'); return inbox.engineEmail.mailbox }
function progress(fn: ProgressFn | undefined, label: string, done = false) { fn?.({ label, percent: done ? 100 : 0, step: done ? 1 : 0, total: 1 }) }
function published(context: EngineContext, slice: { emailInboxes: EmailInbox[]; emailMessages: EmailMessage[]; calendarConnections?: CalendarConnection[] }) { context.assertCurrent(); useStore.getState().mutate(db => ({ ...db, ...slice })) }
export function projectMailbox(connection: CalendarConnection, box: Mailbox | undefined, automation: AutomationState, generation: number): EmailInbox {
  const automatic = box?.enabled && automation.schedulerRunning && automation.grant?.status === 'active'
  return { id: box?.id ?? connection.id, orgId: connection.orgId, address: box?.address ?? connection.email, provider: connection.provider, agentEnabled: box?.enabled ?? false, context: box?.context ?? '', rules: (box?.rules ?? []).map((r, i) => ({ ...r, id: `rule_${i}` })), knowledge: '', knowledgeItems: [], settings: { tone: box?.settings.tone ?? 'professional', signature: box?.settings.signature ?? '', autoDraft: !!automatic && ['draft_review', 'auto_reply'].includes(automation.grant!.policy.mode), autoSend: !!box?.autoSend && automation.automaticSending }, connectionId: connection.id, ownerUserId: connection.ownerUserId, connectedAt: connection.connectedAt, ...(box?.lastSyncedAt ? { lastSyncedAt: box.lastSyncedAt } : {}), ...(box ? { engineEmail: { mailbox: box, automation, generation } } : {}) }
}
export function projectMailMessage(inbox: EmailInbox, message: MailMessage, drafts: MailDraft[], generation: number): EmailMessage {
  const draft = drafts.filter(d => d.messageId === message.id && ['draft', 'pending', 'uncertain'].includes(d.status)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
  return { id: message.id, orgId: inbox.orgId, inboxId: inbox.id, folder: message.folders.includes('sent') ? 'sent' : 'inbox', from: message.from ?? '', to: message.to.join(', '), subject: message.subject, body: message.text ?? '', date: message.receivedAt, read: message.read, status: ['replied', 'reply_accepted'].includes(message.status) || message.folders.includes('sent') ? 'replied' : draft ? 'draft_ready' : 'new', ...(draft ? { aiDraft: draft.text, draftAt: draft.createdAt, draftSource: draft.manual ? 'manual' as const : 'ai' as const } : {}), engineEmail: { message, draft, generation } }
}
export async function loadEmailArea(context: EngineContext, connections: () => Promise<CalendarConnection[]> = () => loadConnections(context), canManage = engineSession.can('integrations:manage')) {
  const api = emailAgentClient(context), [calendarConnections, state] = await Promise.all([connections(), api.mailboxState()]), boxes = state.items
  const emailInboxes: EmailInbox[] = [], emailMessages: EmailMessage[] = []
  // Caixa removida do E-Mail IA cuja conta segue conectada para Agenda/Planilhas fica oculta até nova autorização.
  for (const connection of calendarConnections.filter(c => c.features.includes('email') && !state.detachedConnectionIds.includes(c.id))) {
    const box = boxes.find(b => b.connectionId === connection.id), automation = box?.enabled && canManage ? await api.automation(box.id) : { grant: null, schedulerRunning: box?.schedulerRunning ?? false, automaticSending: box?.autoSend ?? false }
    const inbox = projectMailbox(connection, box, automation, context.generation); emailInboxes.push(inbox)
    if (!box?.enabled) continue
    const [drafts, knowledge] = await Promise.all([api.drafts(box.id), Promise.all(box.knowledgeIds.map(id => createKnowledgeService(context, box.agentId).get(id)))])
    inbox.knowledgeItems = knowledge.map(k => ({ id: k.id, title: k.title, content: k.content, createdAt: k.createdAt, updatedAt: k.updatedAt }))
    for (let page = 1; page <= 334; page++) {
      const batch = await api.messages(box.id, 'all', page)
      for (const summary of batch.items) { const detail = await api.message(box.id, summary.id); emailMessages.push(projectMailMessage(inbox, detail, drafts, context.generation)) }
      if (page * 30 >= batch.total) break
      if (page === 334) throw Error('A caixa excedeu o limite desta consulta.')
    }
  }
  linkReplies(emailMessages)
  context.assertCurrent(); return { calendarConnections, emailInboxes, emailMessages }
}
/** Enviados apontam para o e-mail recebido mais recente da mesma conversa ("Ver resposta" / "Ver e-mail original"). */
function linkReplies(list: EmailMessage[]) {
  for (const sent of list.filter(m => m.folder === 'sent' && m.engineEmail)) {
    const original = list.filter(m => m.folder === 'inbox' && m.inboxId === sent.inboxId && m.engineEmail?.message.threadId === sent.engineEmail!.message.threadId && m.date <= sent.date).sort((a, b) => b.date.localeCompare(a.date))[0]
    if (original) sent.inReplyTo = original.id
  }
}
export async function refreshEmail() { const { context } = session(); const slice = await loadEmailArea(context); published(context, slice); return slice }

/** Provisioning uses the connection ID and an opaque agent journal, never a name lookup. */
export async function activateEmail(inboxId: string, onProgress?: ProgressFn) {
  const { context, identity, api } = session('integrations:manage'), inbox = useStore.getState().db.emailInboxes.find(i => i.id === inboxId)
  if (!inbox?.connectionId || inbox.orgId !== context.tenantId) throw Error('Conecte a caixa de entrada para ativar o agente.')
  if (busy.has(inboxId)) throw Error('Aguarde a ativação.'); busy.add(inboxId)
  const slot = `kloel-email-agent:${identity.userId}:${identity.tenantId}:${inbox.connectionId}`
  try {
    progress(onProgress, 'Ativando agente de e-mail…')
    let box = (await api.mailboxes()).find(b => b.connectionId === inbox.connectionId)
    if (!box) {
      let raw = window.sessionStorage.getItem(slot), ref: { context: typeof identity; agentId: string | null } | null = raw ? JSON.parse(raw) : null
      if (ref && (Object.keys(ref).sort().join(',') !== 'agentId,context' || JSON.stringify(ref.context) !== JSON.stringify(identity) || ref.agentId !== null && !/^[a-f0-9-]{36}$/i.test(ref.agentId))) throw Error('A criação pertence a outra sessão.')
      if (!ref?.agentId) {
        if (ref && !createAgentJournal(window.sessionStorage, identity, `email:${inbox.connectionId}`).read()) throw Error('A criação do assistente ainda não foi confirmada. Nenhum novo assistente foi criado.')
        raw = JSON.stringify({ context: identity, agentId: null }); window.sessionStorage.setItem(slot, raw); context.assertCurrent(); if (window.sessionStorage.getItem(slot) !== raw) throw Error('Não foi possível acompanhar a criação do agente.')
        const agent = makeAgent(context.tenantId, 'Agente de e-mail', 'chat', '')
        agent.prompt = 'Responda às mensagens desta caixa usando o contexto, as regras e o conhecimento configurados.'
        agent.contactsEnabled = false; agent.knowledgeBaseEnabled = true
        // Como em CreateAgentDialog/Onboarding: sem extração precisa pré-preenchida (o motor recusa configurações que não executa).
        agent.technical.preciseExtraction = []
        const created = await agentCommands(`email:${inbox.connectionId}`).create(agent)
        ref = { context: identity, agentId: created.id }; raw = JSON.stringify(ref); window.sessionStorage.setItem(slot, raw); context.assertCurrent(); if (window.sessionStorage.getItem(slot) !== raw) throw Error('Não foi possível preservar a criação do agente.')
      }
      const config: MailboxConfig = { connectionId: inbox.connectionId, agentId: ref.agentId!, name: 'Agente de e-mail', context: '', rules: [], knowledgeIds: [], settings: { tone: 'professional', signature: '', autoDraft: false, autoSend: false }, enabled: true }
      try { box = await api.configure(config) } catch (error) { context.assertCurrent(); box = (await api.mailboxes()).find(b => b.connectionId === inbox.connectionId && b.agentId === ref!.agentId); if (!box) throw error }
    } else if (!box.enabled) box = await api.configure({ ...box, enabled: true }, box)
    const slice = await loadEmailArea(context); published(context, slice); window.sessionStorage.removeItem(slot)
    progress(onProgress, 'Agente de e-mail ativado', true); return box.id
  } finally { busy.delete(inboxId) }
}

export async function saveEmailInbox(id: string, patch: Partial<EmailInbox> | ((inbox: EmailInbox) => EmailInbox)) {
  const { context, identity, api } = session('integrations:manage'), original = useStore.getState().db.emailInboxes.find(i => i.id === id)
  if (!original) throw Error('Caixa de entrada não encontrada.')
  const box = selected(original, context), next = typeof patch === 'function' ? patch(original) : { ...original, ...patch }
  if (busy.has(id)) throw Error('Aguarde o salvamento da caixa.'); busy.add(id)
  const completedKnowledge: string[] = []
  try {
    let knowledgeIds = box.knowledgeIds
    const items = next.knowledgeItems ?? [], old = original.knowledgeItems ?? []
    if (JSON.stringify(items) !== JSON.stringify(old)) {
      const changed = items.filter(k => JSON.stringify(k) !== JSON.stringify(old.find(o => o.id === k.id))), removed = old.filter(o => !items.some(k => k.id === o.id))
      if (changed.length + removed.length !== 1) throw Error('Salve uma entrada de conhecimento por vez.')
      knowledgeIds = [...box.knowledgeIds]
      for (const item of changed) {
        const existing = old.find(o => o.id === item.id), commands = knowledgeCommands(box.agentId, `email:${box.id}:${item.id}`)
        const key = `kloel-email-knowledge:${identity.userId}:${identity.tenantId}:${box.id}:${item.id}`, fingerprint = await emailFingerprint({ title: item.title, content: item.content })
        const raw = window.sessionStorage.getItem(key), pending = raw ? JSON.parse(raw) : null
        if (pending && (Object.keys(pending).sort().join(',') !== 'context,entryId,fingerprint' || JSON.stringify(pending.context) !== JSON.stringify(identity) || pending.fingerprint !== fingerprint || pending.entryId !== null && !/^[a-f0-9-]{36}$/i.test(pending.entryId))) throw Error('Consulte a entrada de conhecimento anterior antes de alterar o texto.')
        if (pending && !pending.entryId) throw Error('A criação da entrada ainda não foi confirmada. Nenhuma nova entrada foi criada.')
        let saved
        if (pending?.entryId) saved = await createKnowledgeService(context, box.agentId).get(pending.entryId)
        else if (existing) saved = await commands.update(item.id, item.title, item.content)
        else {
          const reserved = JSON.stringify({ context: identity, fingerprint, entryId: null }); window.sessionStorage.setItem(key, reserved); context.assertCurrent(); if (window.sessionStorage.getItem(key) !== reserved) throw Error('Não foi possível acompanhar a entrada de conhecimento.')
          saved = await commands.createText(item.title, item.content)
          const reference = JSON.stringify({ context: identity, fingerprint, entryId: saved.id }); window.sessionStorage.setItem(key, reference); context.assertCurrent(); if (window.sessionStorage.getItem(key) !== reference) throw Error('Não foi possível preservar a referência da entrada.')
        }
        if (pending || !existing) completedKnowledge.push(key)
        if (!knowledgeIds.includes(saved.id)) knowledgeIds.push(saved.id)
      }
      // Detach only: another assistant may still use the same knowledge entry.
      knowledgeIds = knowledgeIds.filter(k => !removed.some(r => r.id === k))
    }
    const config = mailboxConfig({ ...box, enabled: next.agentEnabled, context: next.context, rules: next.rules.map(({ text, active }) => ({ text, active })), knowledgeIds, settings: { ...next.settings, autoDraft: false, autoSend: false } })
    const changedConfig = JSON.stringify(config) !== JSON.stringify(mailboxConfig(box))
    if (changedConfig) {
      try { await api.configure(config, box) }
      catch (error) { context.assertCurrent(); const observed = (await api.mailboxes()).find(b => b.id === box.id); if (!observed || observed.revision !== box.revision + 1 || JSON.stringify(mailboxConfig(observed)) !== JSON.stringify(config)) throw error }
    }
    if (next.settings.autoDraft !== original.settings.autoDraft || next.settings.autoSend !== original.settings.autoSend) {
      const state = await api.automation(box.id)
      if (!next.settings.autoDraft && !next.settings.autoSend) { if (state.grant?.status === 'active') await api.stop(box.id, state.grant, 'pause') }
      else {
        const policy = state.grant?.policy ?? defaultAutomationPolicy(), mode = next.settings.autoSend ? 'auto_reply' : 'draft_review'
        if (!(state.grant && ['active', 'baselining'].includes(state.grant.status) && state.grant.policy.mode === mode)) {
          try { await api.activate(box.id, { ...policy, mode, ...(mode === 'auto_reply' ? { replyPolicy: policy.replyPolicy ?? defaultReplyPolicy() } : { replyPolicy: undefined }) }, state.grant) }
          catch (error) { context.assertCurrent(); const observed = await api.automation(box.id); if (!observed.grant || observed.grant.id === state.grant?.id || observed.grant.policy.mode !== mode || !['active', 'baselining'].includes(observed.grant.status)) throw error }
        }
        const current = await api.automation(box.id)
        if (!current.schedulerRunning || current.grant?.status !== 'active' || next.settings.autoSend && !current.automaticSending) throw Error('A autorização foi salva, mas a automação ainda não está em execução.')
      }
    }
    const slice = await loadEmailArea(context); published(context, slice); completedKnowledge.forEach(key => window.sessionStorage.removeItem(key))
  } catch (error) { try { published(context, await loadEmailArea(context)) } catch { /* Keep only confirmed data. */ } throw error }
  finally { busy.delete(id) }
}
export async function syncMailbox(inbox: EmailInbox, onProgress?: ProgressFn) { const { context, api } = session(); const box = selected(inbox, context); progress(onProgress, 'Sincronizando e-mails…'); const result = await api.sync(box.id); published(context, await loadEmailArea(context)); progress(onProgress, 'Sincronização concluída', true); return { count: result.created, drafted: 0, sent: 0 } }
export async function generateMailDraft(inbox: EmailInbox, message: EmailMessage, onProgress?: ProgressFn) { const { context } = session(); selected(inbox, context); if (message.inboxId !== inbox.id || message.engineEmail?.generation !== context.generation) throw Error('Atualize a mensagem.'); const text = await realAI.draftEmailReply({ subject: message.subject, body: message.body, tone: inbox.settings.tone, signature: inbox.settings.signature, mailboxId: inbox.id, messageId: message.id }, onProgress); published(context, await loadEmailArea(context)); return text }
async function editConfirmed(context: EngineContext, previous: MailDraft, text: string) { const api = emailAgentClient(context); try { return await api.edit(previous.mailboxId, previous, text) } catch (error) { context.assertCurrent(); const observed = (await api.drafts(previous.mailboxId)).find(d => d.id === previous.id); if (!observed || observed.revision !== previous.revision + 1 || observed.text !== text.trim() || observed.status !== 'draft') throw error; return observed } }
export async function editMailDraft(inbox: EmailInbox, message: EmailMessage, text: string) { const { context } = session(); selected(inbox, context); const draft = message.engineEmail?.draft; if (!draft || message.engineEmail?.generation !== context.generation || message.inboxId !== inbox.id) throw Error('Gere um rascunho antes de salvá-lo.'); await editConfirmed(context, draft, text); published(context, await loadEmailArea(context)) }
export function createEmailReplySender(context: EngineContext, identity: ExpectedContext, storage: Pick<Storage, 'getItem' | 'setItem'>) {
 const api = emailAgentClient(context)
 return async function send(inbox: EmailInbox, message: EmailMessage, body: string, onProgress?: ProgressFn) {
  context.assertCurrent(); selected(inbox, context)
  let draft = message.engineEmail?.draft
  if (message.inboxId !== inbox.id || message.engineEmail?.generation !== context.generation) throw Error('Atualize a mensagem antes de enviar.')
  if (!draft) {
    // Resposta escrita pela equipe: vira um rascunho revisado no motor (idempotente por tentativa) e segue o mesmo envio confirmado.
    // Só a chave opaca e o digest do texto ficam na sessão (nunca o conteúdo do e-mail): repetir o mesmo texto reaproveita a chave.
    const slot = `kloel-email-manual:${identity.userId}:${identity.tenantId}:${inbox.id}:${message.id}`, raw = storage.getItem(slot), saved = raw ? JSON.parse(raw) : null, fingerprint = await emailFingerprint({ text: body })
    const key = saved && saved.fingerprint === fingerprint && /^[0-9a-f-]{36}$/i.test(saved.key) ? saved.key : crypto.randomUUID()
    storage.setItem(slot, JSON.stringify({ key, fingerprint })); context.assertCurrent()
    draft = await api.manualDraft(inbox.id, message.id, body, key); context.assertCurrent()
  }
  const journal = createEmailReplyJournal(storage, identity), original = journal.read().find(r => r.attempt.draftId === draft!.id && r.resolution === null), receipts = emailReplyReceiptClient(context)
  progress(onProgress, 'Enviando resposta…')
  if (!original && draft.text !== body) draft = await editConfirmed(context, draft, body)
  const attempt = original?.attempt ?? { key: crypto.randomUUID(), mailboxId: inbox.id, draftId: draft.id, expectedRevision: draft.revision }
  if (!original) { journal.reserve(attempt, context.assertCurrent); try { await api.send(inbox.id, draft, attempt.key, true) } catch { context.assertCurrent() } }
  const receipt = await receipts.get(attempt); journal.observe(receipt, context.assertCurrent)
  if (receipt.status !== 'accepted') throw Error(receipt.status === 'not_sent' ? 'O e-mail não foi enviado.' : 'O envio ainda não foi confirmado. Tentar novamente consultará a mesma solicitação.')
  context.assertCurrent(); progress(onProgress, 'Resposta aceita pelo provedor', true); return receipt
 }
}
export async function sendMailReply(inbox: EmailInbox, message: EmailMessage, body: string, onProgress?: ProgressFn) { const { context, identity } = session(); const result = await createEmailReplySender(context, identity, window.sessionStorage)(inbox, message, body, onProgress); published(context, await loadEmailArea(context)); return result }

/* ---------------- Organização da caixa (lido/não lido, arquivar, lixeira), descarte e remoção ---------------- */
function openMessage(inbox: EmailInbox, message: EmailMessage, context: EngineContext) { selected(inbox, context); if (message.inboxId !== inbox.id || message.engineEmail?.generation !== context.generation) throw Error('A mensagem mudou. Atualize a página.') }
/** Mensagem honesta quando a conexão foi autorizada só para ler e enviar. */
export function organizeBlockedReason(inbox: Pick<EmailInbox, 'engineEmail'>): string | null {
  const box = inbox.engineEmail?.mailbox
  if (!box) return 'Ative o agente desta caixa para organizar os e-mails.'
  if (box.canOrganize) return null
  return box.organizeOnReconnect ? 'Esta caixa foi conectada só com permissão de leitura e envio. Reconecte a caixa para marcar como não lido, arquivar e mover para a lixeira.' : 'A conexão desta caixa não autoriza organizar e-mails (marcar como não lido, arquivar e mover para a lixeira).'
}
function organizable(inbox: EmailInbox) { const reason = organizeBlockedReason(inbox); if (reason) throw Error(reason) }
function patchMessage(context: EngineContext, inboxId: string, messageId: string, change: (message: EmailMessage) => EmailMessage | null) {
  context.assertCurrent(); useStore.getState().mutate(db => ({ ...db, emailMessages: db.emailMessages.flatMap(m => m.id === messageId && m.inboxId === inboxId ? [change(m)].filter((x): x is EmailMessage => !!x) : [m]) }))
}
const code = (error: unknown) => error instanceof EngineError ? error.code : ''
export async function setMailRead(inbox: EmailInbox, message: EmailMessage, read: boolean) {
  const { context, api } = session(); openMessage(inbox, message, context); organizable(inbox)
  let confirmed: MailMessage
  try { confirmed = await api.setRead(inbox.id, message.id, read) }
  catch (error) { context.assertCurrent(); const observed = await api.message(inbox.id, message.id).catch(() => null); if (observed?.read !== read) throw error; confirmed = observed }
  patchMessage(context, inbox.id, message.id, m => ({ ...m, read: confirmed.read, engineEmail: { ...m.engineEmail!, message: { ...m.engineEmail!.message, read: confirmed.read } } }))
  return confirmed.read
}
/** Lost responses are reconciled against the engine, which only records provider-confirmed removals. */
async function removedFromInbox(api: ReturnType<typeof emailAgentClient>, inbox: EmailInbox, message: EmailMessage, error: unknown, archived = false) {
  if (code(error) === 'email_message_deleted') return true
  const observed = await api.message(inbox.id, message.id).catch(e => code(e) === 'email_message_deleted' ? 'deleted' as const : null)
  return observed === 'deleted' || archived && !!observed && !observed.folders.includes('inbox')
}
export async function archiveMail(inbox: EmailInbox, message: EmailMessage) {
  const { context, api } = session(); openMessage(inbox, message, context); organizable(inbox)
  if (message.folder !== 'inbox') throw Error('Só e-mails da Caixa de entrada podem ser arquivados.')
  let deleted = true
  try { deleted = (await api.archive(inbox.id, message.id)).deleted }
  catch (error) { context.assertCurrent(); if (!await removedFromInbox(api, inbox, message, error, true)) throw error }
  // Arquivado sai da Caixa de entrada; se também estiver em Enviados, continua lá.
  patchMessage(context, inbox.id, message.id, m => deleted || !m.engineEmail?.message.folders.includes('sent') ? null : { ...m, folder: 'sent' })
}
export async function trashMail(inbox: EmailInbox, message: EmailMessage) {
  const { context, api } = session(); openMessage(inbox, message, context); organizable(inbox)
  try { await api.trash(inbox.id, message.id) }
  catch (error) { context.assertCurrent(); if (!await removedFromInbox(api, inbox, message, error)) throw error }
  patchMessage(context, inbox.id, message.id, () => null)
}
export async function discardMailDraft(inbox: EmailInbox, message: EmailMessage) {
  const { context, api } = session(); openMessage(inbox, message, context)
  const draft = message.engineEmail?.draft
  if (!draft) return
  if (draft.status !== 'draft') throw Error('A resposta já está em envio e não pode ser descartada.')
  try { await api.discard(inbox.id, draft) }
  catch (error) { context.assertCurrent(); if ((await api.drafts(inbox.id)).some(d => d.id === draft.id && d.status === 'draft')) throw error }
  patchMessage(context, inbox.id, message.id, m => { const { aiDraft: _text, draftAt: _at, draftSource: _source, ...rest } = m; return { ...rest, status: m.status === 'draft_ready' ? 'new' : m.status, engineEmail: { message: m.engineEmail!.message, generation: m.engineEmail!.generation } } })
}
/** Remove a caixa do E-Mail IA (cópia local, configuração e automações). Nada é apagado no provedor. */
export async function disconnectEmailInbox(inboxId: string) {
  const { context, api } = session(), inbox = useStore.getState().db.emailInboxes.find(i => i.id === inboxId)
  if (!inbox?.connectionId || inbox.orgId !== context.tenantId) throw Error('Caixa de entrada não encontrada. Atualize a página.')
  if (busy.has(inboxId)) throw Error('Aguarde a operação em andamento.'); busy.add(inboxId)
  try {
    let result: Awaited<ReturnType<typeof api.disconnect>> | null = null
    try { result = await api.disconnect(inbox.connectionId) }
    catch (error) { context.assertCurrent(); const slice = await loadEmailArea(context); published(context, slice); if (slice.emailInboxes.some(i => i.connectionId === inbox.connectionId)) throw error }
    if (result) published(context, await loadEmailArea(context))
    return result
  } finally { busy.delete(inboxId) }
}
