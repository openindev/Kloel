import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { TestContext } from 'node:test';
import { sheetsFixture, sheetAck } from './sheets-http.js';
import { registerProviders } from '../../src/providers.js';
import { registerDomains } from '../../src/domains.js';
import { registerPublicChat } from '../../src/public-chat.js';
import { sheetChannelVersion } from '../../src/oauth/sheets-agent-actions.js';
export async function sheetsActionsFixture(t: TestContext) {
  const f = await sheetsFixture(t), envNames = ['OPENAI_API_KEY', 'OPENAI_MODEL', 'PROVIDER_TENANT_ID'];
  const oldEnv = Object.fromEntries(envNames.map(k => [k, process.env[k]]));
  process.env.OPENAI_API_KEY = 'synthetic-openai-key'; process.env.OPENAI_MODEL = 'synthetic-model'; process.env.PROVIDER_TENANT_ID = f.actor.tenantId;
  t.after(() => { for (const k of envNames) { if (oldEnv[k] === undefined) delete process.env[k]; else process.env[k] = oldEnv[k]; } });
  const agent = f.store.create(f.actor.tenantId, 'agents', { name: 'Sheets helper', status: 'active', prompt: 'Use ferramentas autorizadas.', tools: [], language: 'pt-BR' });
  const origin = 'https://site.example.test';
  const channel = f.store.create(f.actor.tenantId, 'channels', { name: 'Synthetic site', type: 'webchat', provider: 'openai', enabled: true, agentId: agent.id, revision: 1, configuration: { allowedOrigins: [origin], greeting: 'Olá' } });
  await registerProviders(f.app, f.store); await registerDomains(f.app, f.store); await registerPublicChat(f.app, f.store);
  const googleFetch = globalThis.fetch, openAI: Record<string, any>[] = [];
  const hooks: { openAI?: (body: any) => Response | Promise<Response> } = {};
  globalThis.fetch = (async (url, init = {}) => {
    if (String(url) !== 'https://api.openai.com/v1/responses') return googleFetch(url, init);
    const body = JSON.parse(String(init.body)); openAI.push(body);
    return hooks.openAI ? hooks.openAI(body) : Response.json({ id: 'response_test', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Resposta sintética.' }] }] });
  }) as typeof fetch;
  f.hooks.provider = r => r.url.pathname.includes('/values/') && r.method === 'GET' ? Response.json({ range: "'Client''s Data'!A1:C20", majorDimension: 'ROWS', values: [['Nome', 'Qtd', 'Interno'], ['Teste A', '7', 'NAO_DIVULGAR'], ['Teste B', '0', 'PRIVADO']] }) : r.method === 'POST' && r.url.hostname === 'sheets.googleapis.com' ? Response.json(sheetAck) : undefined;
  const base = `/api/v1/agents/${agent.id}/sheets-actions`;
  const queryConfig = { name: 'Consultar nome', description: 'Consultar quantidade pelo nome.', sheetTitle: "Client's Data", inputDefinitions: [{ name: 'nome', type: 'text' }], scanRange: 'A1:C20', headers: true, filters: [{ column: 'Nome', op: 'eq', value: { kind: 'variable', name: 'nome' } }], expectedHeaders: ['Nome', 'Qtd', 'Interno'], returnColumns: ['A', 'B'], maxRows: 10 };
  const appendConfig = { name: 'Registrar contato', description: 'Registrar dados fornecidos.', sheetTitle: "Client's Data", inputDefinitions: [{ name: 'nome', type: 'text' }, { name: 'qtd', type: 'number' }, { name: 'ativo', type: 'boolean' }], range: 'A1:C20', row: [{ kind: 'variable', name: 'nome' }, { kind: 'variable', name: 'qtd' }, { kind: 'variable', name: 'ativo' }] };
  const list = async () => (await f.request('GET', base)).json().items as any[];
  const create = async (kind: 'query' | 'append' = 'query', enabled = true) => {
    const config = kind === 'query' ? queryConfig : appendConfig;
    const response = await f.request('POST', base, { expectedTenantId: f.actor.tenantId, expectedBindingRevision: 1, configuration: { connectionId: f.connection.id, bindingId: f.binding.id, kind, ...config } }, randomUUID());
    assert.equal(response.statusCode, 200, response.body); const receipt = response.json();
    if (enabled) { const response = await f.request('PATCH', `${base}/${receipt.actionId}`, { expectedTenantId: f.actor.tenantId, expectedRevision: 1, enabled: true }, randomUUID()); assert.equal(response.statusCode, 200, response.body); }
    return (await list()).find(row => row.id === receipt.actionId);
  };
  const grant = async (action: any, previousGrant: any = null, policy: any = {}) => {
    const response = await f.request('POST', `${base}/${action.id}/grants`, { expectedTenantId: f.actor.tenantId, expectedActionRevision: action.revision, expectedChannelVersion: sheetChannelVersion(f.store.get(f.actor.tenantId, 'channels', channel.id)!), channelId: channel.id, previousGrant, policy: { expiresInDays: 1, maxCallsPerConversation: action.kind === 'append' ? 1 : 10, maxCallsPerDay: 30, acknowledgePublicDisclosure: true, ...(action.kind === 'append' ? { authorizeDelegatedAppend: true } : {}), ...policy } }, randomUUID());
    assert.equal(response.statusCode, 200, response.body); return response.json();
  };
  const publicPath = (name: string) => `/api/v1/public/chat/${name}?${new URLSearchParams({ tenantId: f.actor.tenantId, channelId: channel.id })}`;
  const session = async () => { const response = await f.app.inject({ method: 'POST', url: publicPath('sessions'), headers: { origin }, payload: {} }); assert.equal(response.statusCode, 201, response.body); return response.json(); };
  const publicRequest = (token: string, message: string = 'Teste A', idempotencyKey = randomUUID()) => f.app.inject({ method: 'POST', url: publicPath('messages'), headers: { origin, authorization: `Bearer ${token}` }, payload: { message, idempotencyKey } });
  const history = (token: string) => f.app.inject({ method: 'GET', url: publicPath('history'), headers: { origin, authorization: `Bearer ${token}` } });
  const askPrivate = (conversationId?: string) => f.request('POST', '/api/v1/ai/chat', { agentId: agent.id, message: 'Teste A', idempotencyKey: randomUUID(), ...(conversationId ? { conversationId } : {}) });
  const toolRound = (action: any, variables: any, callId = 'call_1') => {
    hooks.openAI = body => body.input.some((x: any) => x.type === 'function_call_output') ? Response.json({ id: 'response_final', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Resultado confirmado.' }] }] }) : Response.json({ id: 'response_tool', output: [{ type: 'function_call', call_id: callId, name: `sheets_${action.kind}_${action.id.replaceAll('-', '')}`, arguments: JSON.stringify({ variables }) }] });
  };
  return { ...f, agent, channel, origin, base, queryConfig, appendConfig, openAI, aiHooks: hooks, create, list, grant, session, publicRequest, history, askPrivate, toolRound, publicPath };
}
