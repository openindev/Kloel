import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { TestContext } from 'node:test';
import type { FastifyInstance } from 'fastify';
import type { Store, Entity } from '../../src/store.js';
import { beforeContextFixture } from './before-context.js';
import { registerConversationControl } from '../../src/conversation-control.js';
import { registerConversationAnalysis } from '../../src/conversation-analysis/routes.js';
import type { AnalysisWorker } from '../../src/conversation-analysis/worker.js';
import { hash } from '../../src/conversation-analysis/authority.js';

export async function afterConversationFixture(t: TestContext, setup?: (app: FastifyInstance, store: Store) => void | Promise<void>) {
  const oldLimit = process.env.AFTER_CONVERSATION_MAX_ANALYSES_PER_DAY;
  delete process.env.AFTER_CONVERSATION_MAX_ANALYSES_PER_DAY;
  t.after(() => { if (oldLimit === undefined) delete process.env.AFTER_CONVERSATION_MAX_ANALYSES_PER_DAY; else process.env.AFTER_CONVERSATION_MAX_ANALYSES_PER_DAY = oldLimit; });
  let worker!: AnalysisWorker;
  const f = await beforeContextFixture(t, async (app, store) => { await registerConversationControl(app, store); worker = await registerConversationAnalysis(app, store); await setup?.(app, store); });
  const analysisCalls: any[] = [], analysisHooks: { model?: (body: any) => Response | Promise<Response> } = {};
  f.aiHooks.openAI = body => {
    if (!String(body.instructions).startsWith('Analise somente os dados')) return Response.json({ id: 'synthetic-after-response', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Resposta sintética pública.' }] }] });
    analysisCalls.push(body); if (analysisHooks.model) return analysisHooks.model(body);
    const input = JSON.parse(body.input[0].content);
    return output({ summary: { text: 'Resumo sintético da conversa.', sourceMessageIds: [input.messages[0].id] }, tagProposals: input.allowedTags.length ? [{ tag: input.allowedTags[0], sourceMessageIds: [input.messages[0].id] }] : [] });
  };
  const afterBase = `/api/v1/agents/${f.agent.id}/after-conversation`;
  const configureAfter = (enabled = true, expectedRevision = 0, allowedTags = ['interessado'], key = randomUUID()) => f.request('PUT', afterBase, { expectedTenantId: f.actor.tenantId, expectedRevision, idempotencyKey: key, configuration: { enabled, allowedTags } });
  const seedConversation = async (content = 'Quero informações sobre o produto.') => {
    const session = await f.session(), r = await f.publicRequest(session.token, 'messages', { message: content, idempotencyKey: randomUUID() }); assert.equal(r.statusCode, 200, r.body);
    const local = f.store.list(f.actor.tenantId, 'public-chat-sessions').find(s => s.tokenHash === hashToken(session.token))!;
    return { token: session.token, conversation: f.store.get(f.actor.tenantId, 'conversations', String(local.conversationId))!, session: local };
  };
  const control = (id: string) => f.request('GET', `/api/v1/conversations/${id}/control`);
  const change = (c: Entity, patch: Record<string, unknown>) => f.app.inject({ method: 'PATCH', url: `/api/v1/conversations/${c.id}/control`, cookies: f.cookies, headers: f.headers, payload: { expectedVersion: hash(c), ...patch } });
  const close = (c: Entity, key = randomUUID(), expectedVersion = hash(c)) => f.request('POST', `/api/v1/conversations/${c.id}/close`, { expectedTenantId: f.actor.tenantId, expectedVersion, idempotencyKey: key });
  const operation = (key: string) => f.request('GET', `/api/v1/conversation-close-operations/${key}`);
  const analyses = (id: string, cursor?: string) => f.request('GET', `/api/v1/conversations/${id}/analyses${cursor ? `?cursor=${cursor}` : ''}`);
  return { ...f, worker, afterBase, configureAfter, seedConversation, control, change, close, operation, analyses, analysisCalls, analysisHooks };
}
import { createHash } from 'node:crypto';
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const output = (value: unknown) => Response.json({ id: 'resp_synthetic_after_response', object: 'response', status: 'completed', error: null, incomplete_details: null, output: [{ id: 'msg_synthetic_after_response', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(value), annotations: [] }] }] });
