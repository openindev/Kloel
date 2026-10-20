import { createHash, randomBytes, randomUUID } from 'node:crypto'
import Fastify from '../../../engine/node_modules/fastify/fastify.js'
import cookie from '../../../engine/node_modules/@fastify/cookie/index.js'
import { Store } from '../../../engine/src/store'
import { registerAuth } from '../../../engine/src/auth'
import { registerAccountProfile } from '../../../engine/src/account-profile'
import { seedMember } from '../../../engine/tests/fixtures/membership'
import { createEngineClient, EngineError } from '../../src/services/engine/http'
import { registerDomains } from '../../../engine/src/domains'
import { registerConversationControl } from '../../../engine/src/conversation-control'
import { registerConversationReplies } from '../../../engine/src/conversation-replies'
import { registerPublicChat } from '../../../engine/src/public-chat'
import { createConversationService } from '../../src/services/engine/conversations'
import { createConversationReplyService } from '../../src/services/engine/conversation-replies'

export async function conversationReplyFixture(t: any) {
  const store = new Store(':memory:'), app = Fastify(), tenantId = randomUUID(), owner = { userId: randomUUID(), tenantId, role: 'owner' as const }, member = { userId: randomUUID(), tenantId, role: 'member' as const }, admin = { userId: randomUUID(), tenantId, role: 'admin' as const }
  for (const actor of [owner, member, admin]) seedMember(store, actor)
  const state = { cookie: '', lostResponsePath: '', requests: [] as Array<{ path: string; method: string; body?: any }>, afterResponse: undefined as (() => void) | undefined }
  function loginAs(userId: string, selectedTenant = tenantId) { const token = randomUUID(); store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'), userId, selectedTenant, Date.now() + 3600000); state.cookie = token }
  loginAs(owner.userId)
  await app.register(cookie); await registerAuth(app, store); await registerAccountProfile(app, store)
  const localFetch: typeof fetch = async (path, options = {}) => {
    const url = String(path); if (!url.startsWith('/api/v1/')) throw Error('No external network in reply fixture')
    state.requests.push({ path: url, method: options.method ?? 'GET', ...(options.body ? { body: JSON.parse(String(options.body)) } : {}) })
    const response = await app.inject({ method: (options.method ?? 'GET') as any, url, headers: { ...options.headers as Record<string, string>, ...(state.cookie ? { cookie: `kloel_session=${state.cookie}` } : {}) }, ...(options.body ? { payload: String(options.body) } : {}) })
    state.afterResponse?.()
    if (state.lostResponsePath === url) { state.lostResponsePath = ''; throw Error('Isolated lost reply response') }
    return new Response(response.statusCode === 204 ? null : response.body, { status: response.statusCode, headers: { 'Content-Type': 'application/json' } })
  }
  const request = createEngineClient(localFetch); let current = true
  const context = { tenantId, generation: 1, request, assertCurrent() { if (!current) throw new EngineError(0, 'superseded', '') } }
  const savedFetch = globalThis.fetch
  t.after(async () => { globalThis.fetch = savedFetch; await app.close(); store.close() })
  const f = { store, app, owner, member, admin, state, context, request, localFetch, loginAs, invalidate: () => { current = false } }, previousTenant = process.env.PROVIDER_TENANT_ID
  process.env.PROVIDER_TENANT_ID = f.owner.tenantId
  t.after(() => { if (previousTenant === undefined) delete process.env.PROVIDER_TENANT_ID; else process.env.PROVIDER_TENANT_ID = previousTenant })
  await registerDomains(f.app, f.store); await registerConversationControl(f.app, f.store); await registerConversationReplies(f.app, f.store); await registerPublicChat(f.app, f.store)
  const agent = f.store.create(f.owner.tenantId, 'agents', { name: 'Isolated chat agent', status: 'active', prompt: 'Fixture only', tools: [] })
  const channel = f.store.create(f.owner.tenantId, 'channels', { name: 'Isolated webchat', type: 'webchat', provider: 'openai', enabled: true, agentId: agent.id, configuration: { allowedOrigins: ['https://visitor.example.test'] } })
  const conversation = f.store.create(f.owner.tenantId, 'conversations', { channel: 'webchat', channelId: channel.id, agentId: agent.id, subject: 'Atendimento de teste', status: 'open', tags: [] })
  const secret = randomBytes(32).toString('base64url')
  const visitor = f.store.create(f.owner.tenantId, 'public-chat-sessions', { tokenHash: createHash('sha256').update(secret).digest('hex'), conversationId: conversation.id, channelId: channel.id, agentId: agent.id, origin: 'https://visitor.example.test', status: 'active', expiresAt: Date.now() + 3600000, messageCount: 0, byteCount: 0 })
  const visitorRead = (path = 'history') => f.app.inject({ method: 'GET', url: `/api/v1/public/chat/${path}?tenantId=${f.owner.tenantId}&channelId=${channel.id}`, headers: { authorization: `Bearer ${secret}`, origin: 'https://visitor.example.test' } })
  const visitorSend = (message: string, idempotencyKey = randomUUID()) => f.app.inject({ method: 'POST', url: `/api/v1/public/chat/messages?tenantId=${f.owner.tenantId}&channelId=${channel.id}`, headers: { authorization: `Bearer ${secret}`, origin: 'https://visitor.example.test' }, payload: { message, idempotencyKey } })
  return { ...f, agent, channel, conversation, visitor, visitorRead, visitorSend, replies: createConversationReplyService(f.context), conversations: createConversationService(f.context) }
}
