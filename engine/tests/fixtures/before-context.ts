import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import type { FastifyInstance } from 'fastify';
import type { Store } from '../../src/store.js';
import { assistantBookingFixture } from './assistant-booking.js';
import { defaultConfiguration, type Configuration } from '../../src/before-context/schema.js';

export async function beforeContextFixture(t: TestContext, setup?: (app: FastifyInstance, store: Store) => void | Promise<void>) {
  const f = await assistantBookingFixture(t, setup), beforeBase = `/api/v1/agents/${f.agent.id}/before-context`;
  const sample: Configuration = { ...defaultConfiguration(), enabled: true, defaultGreeting: 'Olá {{vars.nome}}: {{vars.quantidade}} / {{vars.ativo}}.', variables: [
    { name: 'nome', type: 'text', defaultValue: 'Visitante' }, { name: 'quantidade', type: 'number', defaultValue: 0 }, { name: 'ativo', type: 'boolean', defaultValue: false },
  ], testContext: { nome: 'Exemplo sintético', quantidade: 7, ativo: true } };
  const save = (configuration: Configuration = sample, revision = 0, key = randomUUID()) => f.request('PUT', beforeBase, { expectedTenantId: f.actor.tenantId, expectedRevision: revision, idempotencyKey: key, configuration });
  const enable = async (configuration: Configuration = sample) => { const r = await save(configuration); assert.equal(r.statusCode, 200, r.body); return r.json().operation; };
  const open = (mode: 'live' | 'test' = 'live', key = randomUUID(), revision = 1, testFacts?: unknown) => f.request('POST', '/api/v1/ai/conversations/open', { expectedTenantId: f.actor.tenantId, agentId: f.agent.id, expectedConfigRevision: revision, idempotencyKey: key, mode, ...(testFacts === undefined ? {} : { testFacts }) });
  const opening = (key: string) => f.request('GET', `/api/v1/ai/conversation-openings/${key}`);
  const openingHistory = (key: string) => f.request('GET', `/api/v1/ai/conversation-openings/${key}/history`);
  const publicOpen = (token: string, key = randomUUID(), revision = 1) => f.publicRequest(token, 'opening', { expectedConfigRevision: revision, idempotencyKey: key });
  return { ...f, beforeBase, sample, save, enable, open, opening, openingHistory, publicOpen };
}
