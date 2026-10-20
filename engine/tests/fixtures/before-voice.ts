import assert from 'node:assert/strict';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { TestContext } from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import type WebSocket from 'ws';
import { Store } from '../../src/store.js';
import { registerAuth } from '../../src/auth.js';
import { registerProviders } from '../../src/providers.js';
import { seedMember } from './membership.js';
import { guardedBoundary } from './request-context.js';
import { defaultConfiguration, type Configuration } from '../../src/before-context/schema.js';
import { routeSignedTwilioCall } from '../../src/providers/voice-routing.js';

export class BeforeVoiceSocket extends EventEmitter {
  readyState = 0; sent: Record<string, any>[] = []; autoAck = true; autoGreeting = false;
  onSend?: (event: Record<string, any>) => void;
  constructor() { super(); queueMicrotask(() => { this.readyState = 1; this.emit('open'); }); }
  receive(event: unknown) { this.emit('message', Buffer.from(JSON.stringify(event))); }
  send(raw: string) {
    const event = JSON.parse(raw); this.sent.push(event); this.onSend?.(event);
    if (this.autoAck && event.type === 'session.update') queueMicrotask(() => this.receive({ type: 'session.updated', session: { id: 'sess_synthetic_before', ...event.session } }));
    if (this.autoAck && event.type === 'conversation.item.create') queueMicrotask(() => this.receive({ type: 'conversation.item.done', item: { ...event.item, status: 'completed' } }));
    if (this.autoGreeting && event.type === 'response.create') queueMicrotask(() => this.finishGreeting());
  }
  finishGreeting(status = 'completed') { const requested = this.sent.find(e => e.type === 'response.create'); assert.ok(requested); const response = { id: 'resp_before_greeting', metadata: requested.response.metadata, status }; this.receive({ type: 'response.created', response: { ...response, status: 'in_progress' } }); this.receive({ type: 'response.done', response }); }
  close() { if (this.readyState === 3) return; this.readyState = 3; this.emit('close'); }
  terminate() { this.close(); }
}
export async function untilBefore(condition: () => boolean) { const deadline = Date.now() + 4000; while (!condition() && Date.now() < deadline) await new Promise(resolve => setImmediate(resolve)); assert.ok(condition(), 'controlled boundary did not arrive'); }
export async function beforeVoiceFixture(t: TestContext, options: { autoAck?: boolean; autoGreeting?: boolean; setup?: (app: FastifyInstance, store: Store) => void | Promise<void> } = {}) {
  const tenant = 'before-voice-tenant', actor = { tenantId: tenant, userId: 'before-voice-owner', role: 'owner' as const }, token = 'before-voice-owner-session', sessionHash = createHash('sha256').update(token).digest('hex');
  const env = { PROVIDER_TENANT_ID: tenant, OPENAI_API_KEY: 'synthetic-before-voice-api-key', OPENAI_MODEL: 'synthetic-text', OPENAI_REALTIME_MODEL: 'synthetic-realtime', OPENAI_WEBHOOK_SECRET: `whsec_${Buffer.from('synthetic-before-webhook').toString('base64')}`, TWILIO_ACCOUNT_SID: 'AC_before_fixture', OPENAI_SIP_URI: 'sip:synthetic@sip.api.openai.com;transport=tls', OAUTH_ENCRYPTION_KEY: Buffer.alloc(32, 41).toString('base64') };
  const previous = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]])), oldFetch = globalThis.fetch; Object.assign(process.env, env);
  const store = new Store(), app = Fastify({ logger: false }); seedMember(store, actor); store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(sessionHash, actor.userId, tenant, Date.now() + 3600000);
  const agent = store.create(tenant, 'agents', { name: 'Assistente de voz sintético', status: 'active', prompt: 'Seja útil.', initialMessage: 'Saudação legada.', voice: 'marin', language: 'pt-BR', tools: ['search_knowledge'], rules: [] });
  const channel = store.create(tenant, 'channels', { type: 'phone', provider: 'twilio', enabled: true, agentId: agent.id });
  const number = store.create(tenant, 'phone-numbers', { number: '+5511999990001', provider: 'twilio', providerNumberId: 'PN_before_fixture', capabilities: ['voice'], agentId: agent.id, channelId: channel.id });
  const headers = { cookie: `kloel_session=${token}`, ...guardedBoundary(store, sessionHash, actor.userId).headers }, sockets: BeforeVoiceSocket[] = [], requests: Array<{ url: string; init: RequestInit }> = [];
  const hooks: { fetch?: (url: string, init: RequestInit) => Response | Promise<Response>; socket?: (socket: BeforeVoiceSocket) => void } = {};
  globalThis.fetch = (async (input, init = {}) => { const url = String(input); requests.push({ url, init }); if (hooks.fetch) return hooks.fetch(url, init); if (url === 'https://api.openai.com/v1/realtime/calls') return new Response('v=0\r\na=synthetic-answer', { status: 201, headers: { location: '/v1/realtime/calls/call_before_fixture' } }); if (/^https:\/\/api\.openai\.com\/v1\/realtime\/calls\/[A-Za-z0-9_-]+\/(accept|hangup)$/.test(url)) return new Response(null, { status: 200 }); throw new Error('Unexpected synthetic network request'); }) as typeof fetch;
  await app.register(cookie); await registerAuth(app, store); await registerProviders(app, store, { socketFactory: () => { const socket = new BeforeVoiceSocket(); socket.autoAck = options.autoAck ?? true; socket.autoGreeting = options.autoGreeting ?? false; hooks.socket?.(socket); sockets.push(socket); return socket as unknown as WebSocket; } }); await options.setup?.(app, store); await app.ready();
  t.after(async () => { await app.close(); store.close(); globalThis.fetch = oldFetch; for (const k of Object.keys(env)) if (previous[k] === undefined) delete process.env[k]; else process.env[k] = previous[k]; });
  const request = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown, suppliedHeaders = headers) => app.inject({ method, url, headers: suppliedHeaders, ...(payload === undefined ? {} : { payload }) });
  const sample: Configuration = { ...defaultConfiguration(), enabled: true, defaultGreeting: 'Olá {{vars.nome}}!', variables: [{ name: 'nome', type: 'text', defaultValue: 'Visitante' }], testContext: { nome: 'Pessoa sintética' } };
  const save = (configuration = sample, expectedRevision = 0) => request('PUT', `/api/v1/agents/${agent.id}/before-context`, { expectedTenantId: tenant, expectedRevision, idempotencyKey: randomUUID(), configuration });
  const enable = async () => { const r = await save(); assert.equal(r.statusCode, 200, r.body); return r.json().operation; };
  const startBody = (key = randomUUID(), mode: 'live' | 'test' = 'live') => ({ agentId: agent.id, sdp: 'v=0\r\na=synthetic-offer', preview: true, idempotencyKey: key, beforeContext: { expectedRevision: 1, mode } });
  const start = (body = startBody()) => request('POST', '/api/v1/ai/realtime/session', body);
  const get = (key: string) => request('GET', `/api/v1/ai/realtime/operations/${key}`);
  const activate = (key: string, openingId: string) => request('POST', `/api/v1/ai/realtime/operations/${key}/activate`, { expectedTenantId: tenant, openingId, confirm: true });
  const incoming = (callId = 'call_incoming_before', eventId = randomUUID()) => {
    const route = routeSignedTwilioCall(store, tenant, { Direction: 'inbound', To: String(number.number), CallSid: `CA_before_${callId}` }, env.OPENAI_SIP_URI);
    const routeToken = new URLSearchParams(route.sipUri.split('?')[1]).get('x-kloel-route')!;
    const raw = JSON.stringify({ type: 'realtime.call.incoming', data: { call_id: callId, sip_headers: [{ name: 'X-Kloel-Route', value: routeToken }] } }), timestamp = String(Math.floor(Date.now()/1000));
    const signature = createHmac('sha256', Buffer.from(env.OPENAI_WEBHOOK_SECRET.slice(6), 'base64')).update(`${eventId}.${timestamp}.${raw}`).digest('base64');
    return app.inject({ method: 'POST', url: '/api/v1/webhooks/openai', payload: raw, headers: { 'content-type': 'application/json', 'webhook-id': eventId, 'webhook-timestamp': timestamp, 'webhook-signature': `v1,${signature}` } });
  };
  return { app, store, actor, agent, channel, number, token, sessionHash, headers, request, requests, sockets, hooks, sample, save, enable, startBody, start, get, activate, incoming };
}
