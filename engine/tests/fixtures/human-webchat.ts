import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { Store } from '../../src/store.js';
import { registerAuth } from '../../src/auth.js';
import { registerDomains } from '../../src/domains.js';
import { registerPublicChat } from '../../src/public-chat.js';
import { registerConversationControl } from '../../src/conversation-control.js';
import { registerConversationReplies } from '../../src/conversation-replies.js';
import { seedMember } from './membership.js';

export const origin = 'https://human-chat.example.test';
export async function humanFixture(t: { after(fn: () => unknown): void }) {
  const saved = { ...process.env }, oldFetch = globalThis.fetch, tenantId = randomUUID();
  Object.assign(process.env, { PROVIDER_TENANT_ID: tenantId, OPENAI_API_KEY: 'synthetic-webchat-key', OPENAI_MODEL: 'synthetic-model' });
  const store = new Store(), app = Fastify(), owner = { userId: randomUUID(), tenantId, role: 'owner' as const };
  const users = { owner: owner.userId, member: randomUUID(), viewer: randomUUID(), other: randomUUID() };
  const cookies: Record<string, string> = {};
  for (const [name, userId] of Object.entries(users)) {
    seedMember(store, { userId, tenantId, role: name === 'viewer' ? 'viewer' : name === 'member' ? 'member' : 'owner' });
    const token = randomUUID(); cookies[name] = 'kloel_session=' + token;
    store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'), userId, tenantId, Date.now() + 3600000);
  }
  seedMember(store, { ...owner, tenantId: 'other-tenant' });
  let clock = Date.now();
  const agent = store.create(tenantId, 'agents', { name: 'Atendente', status: 'active', prompt: 'Ajude.', tools: [] });
  const channel = store.create(tenantId, 'channels', { type: 'webchat', provider: 'openai', enabled: true, agentId: agent.id, configuration: { allowedOrigins: [origin] } });
  const calls: any[] = [];
  const state = { respond: async (_body: any) => Response.json({ id: 'response-fixture', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Resposta da IA' }] }] }) };
  globalThis.fetch = async (url, init = {}) => { assert.equal(String(url), 'https://api.openai.com/v1/responses'); const body = JSON.parse(String(init.body)); calls.push(body); return state.respond(body); };
  await app.register(cookie); await registerAuth(app, store); await registerDomains(app, store); await registerConversationControl(app, store); await registerConversationReplies(app, store, { now: () => clock });
  await registerPublicChat(app, store, { now: () => clock, limits: { requestsPerIpMinute: 1000, sessionsPerIpHour: 100, messagesPerSession: 200, messagesPerDay: 1000 } });
  await app.ready();
  t.after(async () => { await app.close(); store.close(); globalThis.fetch = oldFetch; for (const key of ['PROVIDER_TENANT_ID', 'OPENAI_API_KEY', 'OPENAI_MODEL']) if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; });
  const path = (part: string) => '/api/v1/public/chat/' + part + '?' + new URLSearchParams({ tenantId, channelId: channel.id });
  const publicRequest = (method: 'GET' | 'POST', part: string, token?: string, payload?: any, query = '') => app.inject({ method, url: path(part) + query, headers: { origin, ...(token ? { authorization: 'Bearer ' + token } : {}) }, ...(payload ? { payload } : {}) });
  async function open() { const response = await publicRequest('POST', 'sessions', undefined, {}); assert.equal(response.statusCode, 201, response.body); const token = response.json().token; const session = store.list(tenantId, 'public-chat-sessions').find(row => row.tokenHash === createHash('sha256').update(token).digest('hex'))!; return { token, session, id: String(session.conversationId) }; }
  const request = (method: 'GET' | 'POST' | 'PATCH', id: string, part: string, payload?: any, user = 'owner') => app.inject({ method, url: '/api/v1/conversations/' + id + (part ? '/' + part : ''), headers: { cookie: cookies[user] }, ...(payload ? { payload } : {}) });
  async function body(id: string, content?: string) { const response = await request('GET', id, 'reply-context'); assert.equal(response.statusCode, 200, response.body); return { expectedTenantId: tenantId, expectedVersion: response.json().version, idempotencyKey: randomUUID(), ...(content ? { content } : {}) }; }
  async function command(id: string, kind: 'takeover' | 'release' | 'replies', content?: string) { const payload = await body(id, content); const response = await request('POST', id, kind, payload); assert.equal(response.statusCode, 200, response.body); return { payload, value: response.json() }; }
  return { app, store, tenantId, owner, users, cookies, agent, channel, state, calls, path, publicRequest, open, request, body, command, advance(ms: number) { clock += ms; } };
}
