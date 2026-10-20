import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import Fastify from '../../engine/node_modules/fastify/fastify.js'
import cookie from '../../engine/node_modules/@fastify/cookie/index.js'
import { Store } from '../../engine/src/store'
import { registerAuth } from '../../engine/src/auth'
import { registerAccountProfile } from '../../engine/src/account-profile'
import { registerDomains } from '../../engine/src/domains'
import { registerOAuth } from '../../engine/src/oauth'
import { registerEmailAgents } from '../../engine/src/email-agents'
import { registerEmailAutomation } from '../../engine/src/email-automation'
import { registerAgentEditorState } from '../../engine/src/agent-editor-state'
import { configureEmailMailbox } from '../../engine/src/email-agents/service'
import { tokenContext } from '../../engine/src/oauth/access'
import { seal } from '../../engine/src/oauth/crypto'
import { seedMember } from '../../engine/tests/fixtures/membership'
import { createEngineClient } from '../src/services/engine/http'
import { emailAgentClient, newMailboxConfig } from '../src/services/engine/email-agents'

export async function emailFixture(t: any, options: { provider?: 'google' | 'microsoft'; role?: 'owner' | 'member'; empty?: boolean; /** E-Mail IA connections authorized with gmail.modify / Mail.ReadWrite */ organize?: boolean } = {}) {
  const oldEncryption = process.env.OAUTH_ENCRYPTION_KEY; process.env.OAUTH_ENCRYPTION_KEY = randomBytes(32).toString('base64')
  const store = new Store(), actor = { tenantId: randomUUID(), userId: randomUUID(), role: 'owner' as const }, provider = options.provider ?? 'google'
  seedMember(store, actor)
  const state = { cookie: 'email-fixture-' + randomUUID(), current: true, loseNext: '', providerFailure: false, aiFailure: false, hold: undefined as undefined | ((path: string, method: string, response: Response) => Promise<Response>) }
  function session(userId: string, tenantId: string) { const value = 'email-fixture-' + randomUUID(); store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(createHash('sha256').update(value).digest('hex'), userId, tenantId, Date.now() + 600000); return value }
  state.cookie = session(actor.userId, actor.tenantId)
  const agent = store.create(actor.tenantId, 'agents', { name: 'Assistente real', status: 'active', prompt: 'Use somente fatos confirmados.' })
  const knowledge = store.create(actor.tenantId, 'knowledge', { agentId: agent.id, title: 'Horários reais', type: 'text', content: 'Atendemos de segunda a sexta.' })
  const scopes = options.organize ? provider === 'google' ? 'https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send' : 'Mail.ReadWrite Mail.Send' : provider === 'google' ? 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send' : 'Mail.Read Mail.Send'
  const connection = store.create(actor.tenantId, 'oauth-connections', { provider, remoteId: 'fixture-provider-owner', email: 'inbox@example.test', userId: actor.userId, visibility: 'shared', status: 'connected', capabilities: ['email', 'email_send'], scopes, authorizationGeneration: 1 })
  store.update(actor.tenantId, 'oauth-connections', connection.id, { encryptedTokens: seal({ accessToken: 'fixture-provider-token', scope: scopes, expiresAt: Date.now() + 3600000 }, tokenContext(connection)) })
  const config = { ...newMailboxConfig(connection.id, agent.id), name: 'Atendimento real', context: 'Contexto privado da empresa', knowledgeIds: [knowledge.id] }
  const box = options.empty ? undefined : configureEmailMailbox(store, actor, config)
  if (options.role === 'member') store.db.prepare('UPDATE memberships SET role=? WHERE user_id=? AND tenant_id=?').run('member', actor.userId, actor.tenantId)
  const providerCalls: { path: string; method: string }[] = [], labels = new Map<string, string[]>()
  const providerFetch = async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input)), method = init.method ?? 'GET'; providerCalls.push({ path: url.pathname, method })
    if (url.hostname === 'api.openai.com') { assert.equal(url.pathname, '/v1/responses'); if (state.aiFailure) return Response.json({ error: 'Synthetic provider failure' }, { status: 503 }); return Response.json({ id: 'fixture-response', status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Olá! Nossa equipe confirmará seu pedido.' }] }] }) }
    assert.ok(['gmail.googleapis.com', 'graph.microsoft.com'].includes(url.hostname), 'No unrecognized provider is contacted')
    // Organização da caixa (lido/não lido, arquivar, lixeira) com estado real de rótulos por mensagem.
    const parts = url.pathname.split('/'), action = parts.at(-1)!
    if (provider === 'google' && method === 'POST' && (action === 'modify' || action === 'trash')) {
      const id = decodeURIComponent(parts.at(-2)!), body = init.body ? JSON.parse(String(init.body)) : {}
      labels.set(id, action === 'trash' ? ['TRASH'] : [...(labels.get(id) ?? ['INBOX', 'UNREAD']).filter(l => !(body.removeLabelIds ?? []).includes(l)), ...(body.addLabelIds ?? [])])
      return Response.json({ id, threadId: 'thread-' + id.slice(-1), labelIds: labels.get(id) })
    }
    if (provider === 'microsoft' && method === 'PATCH') return Response.json({ id: decodeURIComponent(action), isRead: JSON.parse(String(init.body)).isRead })
    if (provider === 'microsoft' && method === 'POST' && action === 'move') return Response.json({ id: decodeURIComponent(parts.at(-2)!) }, { status: 201 })
    if (method === 'POST') { if (state.providerFailure) throw Error('Synthetic provider response lost'); return provider === 'google' ? Response.json({ id: 'sent-fixture', threadId: 'thread-1' }) : new Response(null, { status: 202 }) }
    if (provider === 'google') {
      if (url.pathname.endsWith('/profile')) return Response.json({ historyId: '100' })
      if (url.pathname.endsWith('/history')) return Response.json({ historyId: '101', history: [] })
      if (url.pathname.endsWith('/messages')) return Response.json({ messages: [{ id: 'mail-1' }, { id: 'mail-2' }] })
      const id = url.pathname.split('/').at(-1)!
      return Response.json({ id, threadId: 'thread-' + id.slice(-1), internalDate: String(Date.now()), labelIds: labels.get(id) ?? ['INBOX', 'UNREAD'], payload: { mimeType: 'text/plain', headers: [{ name: 'From', value: 'cliente@example.test' }, { name: 'To', value: 'inbox@example.test' }, { name: 'Subject', value: 'Pedido ' + id }, { name: 'Message-ID', value: `<${id}@example.test>` }], body: { data: Buffer.from('Conteúdo privado. <img src="https://tracking.invalid/pixel" onerror="alert(1)">').toString('base64url') } } })
    }
    if (url.pathname.endsWith('/mailFolders/inbox')) return Response.json({ id: 'folder-inbox' })
    if (url.pathname.endsWith('/mailFolders/sentitems')) return Response.json({ id: 'folder-sent' })
    const sent = url.pathname.includes('folder-sent')
    return Response.json({ value: sent ? [] : [{ id: 'mail-1', conversationId: 'thread-1', subject: 'Pedido mail-1', from: { emailAddress: { address: 'cliente@example.test' } }, toRecipients: [{ emailAddress: { address: 'inbox@example.test' } }], internetMessageId: '<mail-1@example.test>', receivedDateTime: new Date().toISOString(), body: { contentType: 'text', content: 'Conteúdo privado da mensagem' }, isRead: false }], '@odata.deltaLink': `https://graph.microsoft.com/v1.0/me/mailFolders/${sent ? 'folder-sent' : 'folder-inbox'}/messages/delta?$deltatoken=fixture` })
  }
  const runtime = { openaiApiKey: 'fixture-openai-key', openaiModel: 'fixture-model', fetchImpl: providerFetch as typeof fetch }
  const app = Fastify({ logger: false }); await app.register(cookie)
  app.setErrorHandler((error: any, _req: any, reply: any) => reply.code(error.statusCode ?? error.status ?? 500).send({ error: { code: error.code ?? 'internal_error', message: error.message } }))
  await registerAuth(app, store); await registerAccountProfile(app, store); await registerDomains(app, store); await registerOAuth(app, store); await registerEmailAgents(app, store, runtime); await registerEmailAutomation(app, store, { ...runtime, startWorker: false }); await registerAgentEditorState(app, store)
  const requests: { path: string; method: string; body: any; key?: string }[] = []
  const fetcher: typeof fetch = async (input, init = {}) => {
    const path = String(input), method = init.method ?? 'GET'; assert.ok(path.startsWith('/api/v1/')); assert.equal(init.credentials, 'include'); assert.equal(new Headers(init.headers).get('Authorization'), null)
    requests.push({ path, method, body: init.body ? JSON.parse(String(init.body)) : undefined, key: new Headers(init.headers).get('Idempotency-Key') ?? undefined })
    const result = await app.inject({ method: method as any, url: path, headers: { ...init.headers as any, cookie: `kloel_session=${state.cookie}` }, ...(init.body ? { payload: String(init.body) } : {}) })
    const response = new Response(result.statusCode === 204 ? null : result.body, { status: result.statusCode, headers: { 'Content-Type': 'application/json' } })
    if (state.loseNext && method !== 'GET' && path.endsWith(state.loseNext)) { state.loseNext = ''; throw Error('Synthetic response lost after backend commit') }
    return state.hold ? state.hold(path, method, response) : response
  }
  const context = { tenantId: actor.tenantId, generation: 1, request: createEngineClient(fetcher), assertCurrent() { assert.equal(state.current, true, 'Stale session cannot perform any request') } }
  t.after(async () => { await app.close(); store.close(); if (oldEncryption === undefined) delete process.env.OAUTH_ENCRYPTION_KEY; else process.env.OAUTH_ENCRYPTION_KEY = oldEncryption })
  return { store, actor, state, session, agent, connection, config, box, providerCalls, requests, context, client: emailAgentClient(context), fetcher, runtime, labels }
}
