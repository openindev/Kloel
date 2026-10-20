import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { Store } from '../src/store.js';
import { buildApp } from '../src/app.js';
import { seedMember } from './fixtures/membership.js';
import { technicalOrgSlug } from '../src/company-slug.js';
import { adoptAddressReservations } from '../src/webchat-hosted.js';

const kloel = 'http://127.0.0.1:4310';
const site = 'https://cliente.example.test';
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
/** Navegador na própria página /w/...: GET same-origin sem Origin, POST com Origin da Kloel; sempre Sec-Fetch-Site same-origin. */
const hostedHeaders = (method: string, token?: string) => ({ 'x-kloel-hosted': '1', 'sec-fetch-site': 'same-origin', ...(method === 'GET' ? {} : { origin: kloel }), ...(token ? { authorization: `Bearer ${token}` } : {}) });

/** Outras empresas publicam pelo provedor da plataforma. */
function platformProviders(t: any) {
  const previous = process.env.PLATFORM_AI_PROVIDERS; process.env.PLATFORM_AI_PROVIDERS = '1';
  t.after(() => { if (previous === undefined) delete process.env.PLATFORM_AI_PROVIDERS; else process.env.PLATFORM_AI_PROVIDERS = previous; });
}

async function fixture(t: any, seed?: (store: Store, agent: { id: string }) => void) {
  const tenant = 'hosted-tenant', previousEnv = { ...process.env }, previousFetch = globalThis.fetch;
  const env = { PROVIDER_TENANT_ID: tenant, OPENAI_API_KEY: 'synthetic-openai-secret', OPENAI_MODEL: 'synthetic-model', PUBLIC_BASE_URL: kloel, ALLOWED_ORIGINS: kloel };
  Object.assign(process.env, env);
  const provider: { url: string; body: any }[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init: RequestInit = {}) => {
    provider.push({ url: String(url), body: JSON.parse(String(init.body)) });
    return Response.json({ id: 'resp_hosted', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Resposta do assistente hospedado.' }] }], usage: { total_tokens: 12 } });
  }) as typeof fetch;
  const store = new Store(':memory:');
  const identities = {
    owner: { tenantId: tenant, userId: 'hosted-owner', role: 'owner' as const },
    member: { tenantId: tenant, userId: 'hosted-member', role: 'member' as const },
    viewer: { tenantId: tenant, userId: 'hosted-viewer', role: 'viewer' as const },
    foreign: { tenantId: 'foreign-hosted-tenant', userId: 'foreign-hosted-owner', role: 'owner' as const },
    third: { tenantId: 'third-hosted-tenant', userId: 'third-hosted-owner', role: 'owner' as const },
  };
  const cookies: Record<string, string> = {};
  for (const [name, actor] of Object.entries(identities)) {
    seedMember(store, actor); cookies[name] = 'hosted-cookie-' + name;
    store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(hash(cookies[name]), actor.userId, actor.tenantId, Date.now() + 3600000);
  }
  const agent = store.create(tenant, 'agents', { name: 'Clara', status: 'active', prompt: 'Teste sintético', initialMessage: 'Oi!', language: 'pt-BR', voice: 'marin', tools: [], settings: {}, rules: [] });
  seed?.(store, agent);
  const app = await buildApp(store, { workers: false }); await app.ready();
  t.after(async () => { await app.close(); globalThis.fetch = previousFetch; for (const key of Object.keys(env)) { if (previousEnv[key] === undefined) delete process.env[key]; else process.env[key] = previousEnv[key]; } });
  const contexts: Record<string, Record<string, string>> = {};
  for (const name of Object.keys(identities)) {
    const me = await app.inject({ url: '/api/v1/auth/me', headers: { cookie: 'kloel_session=' + cookies[name] } }); assert.equal(me.statusCode, 200);
    const c = me.json().context;
    contexts[name] = { 'x-kloel-expected-user': c.userId, 'x-kloel-expected-tenant': c.tenantId, 'x-kloel-expected-membership': c.membershipId, 'x-kloel-expected-authority': c.authorityVersion };
  }
  const request = (method: any, url: string, body?: unknown, name = 'owner') => app.inject({ method, url, headers: { cookie: 'kloel_session=' + cookies[name], ...contexts[name], ...(method === 'GET' ? {} : { origin: kloel }) }, ...(body === undefined ? {} : { payload: body }) });
  const publish = (extra: Record<string, unknown> = {}, name = 'owner') => request('PUT', '/api/v1/webchat/hosted', { agentId: agent.id, assistantSlug: 'clara', greeting: 'Bem-vindo ao link da Clara!', ...extra }, name);
  const chat = (path: string, channelId: string, method = 'POST', token?: string, payload?: unknown, headers?: Record<string, string>) =>
    app.inject({ method: method as any, url: `/api/v1/public/chat/${path}?${new URLSearchParams({ tenantId: tenant, channelId })}`, headers: headers ?? hostedHeaders(method, token), ...(method === 'GET' ? {} : { payload: payload ?? {} }) });
  const companySlug = (slug: string, name = 'owner') => request('PUT', '/api/v1/organization/public-slug', { slug }, name);
  const resolve = (org: string, assistant = 'clara') => app.inject({ url: `/api/v1/public/webchat/hosted?orgSlug=${org}&assistantSlug=${assistant}` });
  /** Apelidos aposentados (troca da URL da empresa) ainda reservados; `expire` simula o fim do prazo da reserva. */
  const retiredSlugs = () => (store.db.prepare("SELECT tenant_id AS tenant, json_extract(body,'$.slug') AS slug FROM entities WHERE collection='company-slugs-retired' ORDER BY rowid").all() as { tenant: string; slug: string }[]).map(r => `${r.tenant}:${r.slug}`);
  const expire = (slug: string) => store.db.prepare("UPDATE entities SET body=json_set(body,'$.expiresAt','2000-01-01T00:00:00.000Z') WHERE collection='company-slugs-retired' AND json_extract(body,'$.slug')=?").run(slug);
  return { tenant, store, app, agent, request, publish, chat, provider, companySlug, resolve, retiredSlugs, expire };
}
/** Assistente "Clara" de outra empresa do fixture e a publicação do link dela. */
function foreignClara(f: Awaited<ReturnType<typeof fixture>>, name = 'foreign', tenant = 'foreign-hosted-tenant') {
  const agent = f.store.create(tenant, 'agents', { name: 'Clara', status: 'active', prompt: 'Outra empresa', tools: [], settings: {}, rules: [] });
  return { tenant, agent, publish: (assistantSlug = 'clara') => f.request('PUT', '/api/v1/webchat/hosted', { agentId: agent.id, assistantSlug, greeting: 'Outra empresa' }, name), view: () => f.request('GET', `/api/v1/webchat/hosted?agentId=${agent.id}`, undefined, name) };
}

test('publishing creates the chat channel without customer sites and the public link resolves by technical and custom slug', async t => {
  const f = await fixture(t);
  const empty = await f.request('GET', `/api/v1/webchat/hosted?agentId=${f.agent.id}`); assert.equal(empty.statusCode, 200, empty.body);
  assert.equal(empty.json().hosted, null); assert.equal(empty.json().channelId, null); assert.equal(empty.json().orgSlug, technicalOrgSlug(f.tenant));
  const missing = await f.app.inject({ url: `/api/v1/public/webchat/hosted?orgSlug=${technicalOrgSlug(f.tenant)}&assistantSlug=clara` }); assert.equal(missing.statusCode, 404); assert.equal(missing.json().error.code, 'hosted_unavailable');
  const published = await f.publish(); assert.equal(published.statusCode, 200, published.body);
  const view = published.json(); assert.equal(view.hosted.published, true); assert.equal(view.available, true); assert.deepEqual(view.reasons, []);
  assert.equal(view.hosted.path, `/w/${technicalOrgSlug(f.tenant)}/clara`);
  const [channel] = f.store.list(f.tenant, 'channels'); assert.equal(channel.enabled, true); assert.deepEqual((channel.configuration as any).allowedOrigins, []);
  // O widget continua sem sites: a origem da Kloel nunca vira "site permitido".
  const projected = await f.request('GET', `/api/v1/webchat/channels/${channel.id}`); assert.equal(projected.statusCode, 200);
  assert.deepEqual(projected.json().configuration.allowedOrigins, []); assert.equal(projected.json().readiness.available, true);
  const resolved = await f.app.inject({ url: `/api/v1/public/webchat/hosted?orgSlug=${technicalOrgSlug(f.tenant)}&assistantSlug=clara` }); assert.equal(resolved.statusCode, 200, resolved.body);
  assert.deepEqual(resolved.json(), { tenantId: f.tenant, channelId: channel.id, assistantName: 'Clara', greeting: 'Bem-vindo ao link da Clara!', orgSlug: technicalOrgSlug(f.tenant), assistantSlug: 'clara' });
  assert.equal((await f.request('PUT', '/api/v1/organization/public-slug', { slug: 'clinica-sol' })).statusCode, 200);
  assert.equal((await f.app.inject({ url: '/api/v1/public/webchat/hosted?orgSlug=clinica-sol&assistantSlug=clara' })).statusCode, 200);
  assert.equal((await f.request('GET', `/api/v1/webchat/hosted?agentId=${f.agent.id}`)).json().hosted.path, '/w/clinica-sol/clara');
  assert.equal((await f.app.inject({ url: '/api/v1/public/webchat/hosted?orgSlug=outra-empresa&assistantSlug=clara' })).statusCode, 404);
  assert.equal(f.store.list(f.tenant, 'webchat-hosted-audit').length, 1); assert.equal(f.provider.length, 0);
});

test('only channel writers publish; foreign tenants, bad slugs, inactive assistants and taken slugs are refused', async t => {
  const f = await fixture(t);
  assert.equal((await f.publish({}, 'viewer')).statusCode, 403); assert.equal((await f.publish({}, 'member')).statusCode, 403);
  assert.equal((await f.request('GET', `/api/v1/webchat/hosted?agentId=${f.agent.id}`, undefined, 'member')).statusCode, 200);
  assert.equal((await f.publish({}, 'foreign')).statusCode, 404);
  for (const assistantSlug of ['Clara', 'cl', 'clara-', 'cla ra', 'a'.repeat(49)]) assert.equal((await f.publish({ assistantSlug })).statusCode, 400, assistantSlug);
  f.store.update(f.tenant, 'agents', f.agent.id, { status: 'draft' });
  const draft = await f.publish(); assert.equal(draft.statusCode, 409); assert.equal(draft.json().error.code, 'hosted_not_ready'); assert.match(draft.json().error.message, /Ative o assistente/);
  assert.equal(f.store.list(f.tenant, 'channels').length, 0);
  f.store.update(f.tenant, 'agents', f.agent.id, { status: 'active' }); assert.equal((await f.publish()).statusCode, 200);
  const other = f.store.create(f.tenant, 'agents', { name: 'Outro', status: 'active', tools: [], rules: [] });
  const taken = await f.publish({ agentId: other.id }); assert.equal(taken.statusCode, 409); assert.equal(taken.json().error.code, 'slug_taken');
  assert.equal((await f.publish({ agentId: other.id, assistantSlug: 'outro' })).statusCode, 200);
  delete process.env.OPENAI_API_KEY;
  const offline = await f.publish({ greeting: 'Nova' }); assert.equal(offline.statusCode, 409); assert.match(offline.json().error.message, /IA da Kloel/);
  const page = await f.app.inject({ url: `/api/v1/public/webchat/hosted?orgSlug=${technicalOrgSlug(f.tenant)}&assistantSlug=clara` }); assert.equal(page.statusCode, 503); assert.equal(page.json().error.code, 'chat_not_configured');
});

test('hosted visitors chat through the public pipeline: same-origin GET without Origin works, conversation lands in Conversas', async t => {
  const f = await fixture(t); await f.publish();
  const channel = f.store.list(f.tenant, 'channels')[0];
  const session = await f.chat('sessions', channel.id); assert.equal(session.statusCode, 201, session.body);
  assert.equal(session.json().greeting, 'Bem-vindo ao link da Clara!'); assert.equal(session.json().assistantName, 'Clara');
  const token = session.json().token as string;
  const stored = f.store.list(f.tenant, 'public-chat-sessions')[0]; assert.equal(stored.origin, kloel); assert.equal(stored.entry, 'hosted_link');
  const conversation = f.store.get(f.tenant, 'conversations', String(stored.conversationId))!; assert.equal(conversation.channel, 'webchat'); assert.equal(conversation.entry, 'hosted_link'); assert.equal(conversation.agentId, f.agent.id);
  const sent = await f.chat('messages', channel.id, 'POST', token, { message: 'Quais são os horários?', idempotencyKey: randomUUID() }); assert.equal(sent.statusCode, 200, sent.body);
  assert.equal(sent.json().status, 'answered'); assert.equal(sent.json().message.content, 'Resposta do assistente hospedado.');
  assert.equal(f.provider.length, 1); assert.equal(f.provider[0].url, 'https://api.openai.com/v1/responses'); assert.deepEqual(f.provider[0].body.input.at(-1), { role: 'user', content: 'Quais são os horários?' });
  const history = await f.chat('history', channel.id, 'GET', token); assert.equal(history.statusCode, 200, history.body);
  assert.deepEqual(history.json().items.map((m: any) => [m.role, m.content]), [['user', 'Quais são os horários?'], ['assistant', 'Resposta do assistente hospedado.']]);
  const messages = f.store.list(f.tenant, 'messages').filter(m => m.conversationId === conversation.id); assert.equal(messages.length, 2);
  // Sem o marcador do SPA, um GET sem Origin não é normalizado (nenhuma origem → recusado).
  assert.equal((await f.chat('history', channel.id, 'GET', token, undefined, { 'sec-fetch-site': 'same-origin', authorization: `Bearer ${token}` })).statusCode, 403);
  // Outro site não consegue se passar pela página hospedada.
  for (const headers of [{ 'x-kloel-hosted': '1', 'sec-fetch-site': 'cross-site', origin: site }, { 'x-kloel-hosted': '1', origin: site }, { 'x-kloel-hosted': '1', 'sec-fetch-site': 'cross-site' }]) assert.equal((await f.chat('sessions', channel.id, 'POST', undefined, {}, headers)).statusCode, 403, JSON.stringify(headers));
  const ended = await f.chat('end', channel.id, 'POST', token); assert.equal(ended.statusCode, 200, ended.body);
  assert.equal(f.store.get(f.tenant, 'conversations', conversation.id)!.status, 'closed');
});

test('unpublishing revokes the link and live sessions but keeps the customer widget working', async t => {
  const f = await fixture(t);
  const channel = f.store.create(f.tenant, 'channels', { name: 'Chat', agentId: f.agent.id, type: 'webchat', provider: 'openai', enabled: true, configuration: { allowedOrigins: [site], greeting: 'Widget' }, revision: 1 });
  assert.equal((await f.publish()).statusCode, 200); assert.equal(f.store.list(f.tenant, 'channels').length, 1);
  assert.deepEqual((f.store.get(f.tenant, 'channels', channel.id)!.configuration as any).allowedOrigins, [site]);
  const hosted = await f.chat('sessions', channel.id); assert.equal(hosted.statusCode, 201); const token = hosted.json().token;
  const widget = await f.chat('sessions', channel.id, 'POST', undefined, {}, { origin: site }); assert.equal(widget.statusCode, 201); assert.equal(widget.json().greeting, 'Widget');
  const removed = await f.request('DELETE', `/api/v1/webchat/hosted/${f.agent.id}`); assert.equal(removed.statusCode, 200, removed.body);
  assert.equal(removed.json().hosted.published, false); assert.equal(removed.json().hosted.assistantSlug, 'clara');
  assert.equal(f.store.get(f.tenant, 'channels', channel.id)!.enabled, true);
  assert.equal((await f.app.inject({ url: `/api/v1/public/webchat/hosted?orgSlug=${technicalOrgSlug(f.tenant)}&assistantSlug=clara` })).statusCode, 404);
  assert.equal((await f.chat('history', channel.id, 'GET', token)).statusCode, 403);
  assert.equal((await f.chat('sessions', channel.id)).statusCode, 403);
  assert.equal((await f.chat('history', channel.id, 'GET', widget.json().token, undefined, { origin: site, authorization: `Bearer ${widget.json().token}` })).statusCode, 200);
  // Sem sites do widget, despublicar desliga o canal.
  f.store.update(f.tenant, 'channels', channel.id, { configuration: { allowedOrigins: [], greeting: 'Widget' } });
  assert.equal((await f.publish()).statusCode, 200);
  assert.equal((await f.request('DELETE', `/api/v1/webchat/hosted/${f.agent.id}`)).statusCode, 200);
  assert.equal(f.store.get(f.tenant, 'channels', channel.id)!.enabled, false);
  // Assistente pausado depois da publicação → link indisponível.
  assert.equal((await f.publish()).statusCode, 200); f.store.update(f.tenant, 'agents', f.agent.id, { status: 'paused' });
  assert.equal((await f.app.inject({ url: `/api/v1/public/webchat/hosted?orgSlug=${technicalOrgSlug(f.tenant)}&assistantSlug=clara` })).statusCode, 404);
});

test('with the hosted link published, the widget may drop every site without disabling the channel', async t => {
  const f = await fixture(t);
  const channel = f.store.create(f.tenant, 'channels', { name: 'Chat', agentId: f.agent.id, type: 'webchat', provider: 'openai', enabled: true, configuration: { allowedOrigins: [site], greeting: 'Widget' }, revision: 1 });
  const current = async () => (await f.request('GET', `/api/v1/webchat/channels/${channel.id}`)).json();
  const patch = async (row: any) => f.request('PATCH', `/api/v1/webchat/channels/${channel.id}`, { expectedTenantId: f.tenant, expectedVersion: row.version, idempotencyKey: randomUUID(), configuration: { allowedOrigins: [] } });
  const refused = await patch(await current()); assert.equal(refused.statusCode, 409, 'sem link hospedado, o widget ativo não pode ficar sem sites');
  assert.equal((await f.publish()).statusCode, 200);
  const changed = await patch(await current()); assert.equal(changed.statusCode, 200, changed.body);
  assert.equal(changed.json().channel.enabled, true); assert.deepEqual(changed.json().channel.configuration.allowedOrigins, []); assert.equal(changed.json().channel.readiness.available, true);
  assert.equal((await f.chat('sessions', channel.id, 'POST', undefined, {}, { origin: site })).statusCode, 403, 'o site removido deixa de atender');
  assert.equal((await f.chat('sessions', channel.id)).statusCode, 201, 'o link hospedado continua atendendo');
});

test('the public link is resolved per company: other tenants (published, unpublished or forging the technical slug) never shadow it', async t => {
  const f = await fixture(t), tech = technicalOrgSlug(f.tenant);
  // Muitas empresas com o mesmo slug comum de assistente, gravadas ANTES do canal do dono (rowid menor).
  for (let i = 0; i < 205; i++) f.store.create('other-tenant-' + i, 'channels', { type: 'webchat', provider: 'openai', enabled: true, agentId: 'x', hosted: { published: i % 2 === 0, assistantSlug: 'clara', orgTechSlug: technicalOrgSlug('other-tenant-' + i) } });
  f.store.create('forger-tenant', 'channels', { type: 'webchat', provider: 'openai', enabled: true, agentId: 'x', hosted: { published: true, assistantSlug: 'clara', orgTechSlug: tech } });
  assert.equal((await f.request('PUT', '/api/v1/organization/public-slug', { slug: 'clinica-sol' })).statusCode, 200);
  assert.equal((await f.publish()).statusCode, 200);
  const channel = f.store.list(f.tenant, 'channels')[0];
  for (const org of [tech, 'clinica-sol']) {
    const resolved = await f.app.inject({ url: `/api/v1/public/webchat/hosted?orgSlug=${org}&assistantSlug=clara` }); assert.equal(resolved.statusCode, 200, org + ' ' + resolved.body);
    assert.equal(resolved.json().tenantId, f.tenant); assert.equal(resolved.json().channelId, channel.id);
  }
  // Despublicado: o link do dono some e nenhuma outra empresa assume o endereço.
  assert.equal((await f.request('DELETE', `/api/v1/webchat/hosted/${f.agent.id}`)).statusCode, 200);
  for (const org of [tech, 'clinica-sol']) assert.equal((await f.app.inject({ url: `/api/v1/public/webchat/hosted?orgSlug=${org}&assistantSlug=clara` })).statusCode, 404, org);
});

test('renaming the company slug keeps the old /w/ and /c links with the company; no other company takes the old slug while it is reserved', async t => {
  const f = await fixture(t); platformProviders(t);
  const other = foreignClara(f), tech = technicalOrgSlug(f.tenant);
  assert.equal((await f.companySlug('clinica-sol')).statusCode, 200);
  assert.equal((await f.publish()).json().hosted.path, '/w/clinica-sol/clara');
  // Outra empresa já publica o mesmo slug de assistente no próprio endereço técnico.
  assert.equal((await other.publish()).statusCode, 200);
  assert.equal((await f.companySlug('clinica-sol-nova')).statusCode, 200);
  assert.equal((await f.request('GET', `/api/v1/webchat/hosted?agentId=${f.agent.id}`)).json().hosted.path, '/w/clinica-sol-nova/clara');
  // O apelido anterior continua da empresa: indisponível para as outras, e os links antigos (/w e /c) seguem levando a ela.
  assert.equal((await f.request('GET', '/api/v1/organization/public-slug/availability?slug=clinica-sol', undefined, 'foreign')).json().available, false);
  const taken = await f.companySlug('clinica-sol', 'foreign'); assert.equal(taken.statusCode, 409); assert.equal(taken.json().error.code, 'slug_taken');
  for (const org of ['clinica-sol', 'clinica-sol-nova']) { const r = await f.resolve(org); assert.equal(r.statusCode, 200, org); assert.equal(r.json().tenantId, f.tenant, org); }
  const booking = await f.app.inject({ url: '/c/clinica-sol/consulta' }); assert.equal(booking.statusCode, 302); assert.equal(booking.headers.location, `/c/${tech}/consulta`);
  // A outra empresa continua no endereço que o painel dela mostra (o técnico), e ele funciona.
  const otherPath = (await other.view()).json().hosted.path; assert.equal(otherPath, `/w/${technicalOrgSlug(other.tenant)}/clara`);
  assert.equal((await f.resolve(technicalOrgSlug(other.tenant))).json().tenantId, other.tenant);
  // A própria empresa pode voltar ao apelido anterior; o que saiu agora fica reservado para ela.
  assert.equal((await f.request('GET', '/api/v1/organization/public-slug/availability?slug=clinica-sol')).json().available, true);
  assert.equal((await f.companySlug('clinica-sol')).statusCode, 200);
  assert.equal((await f.request('GET', `/api/v1/webchat/hosted?agentId=${f.agent.id}`)).json().hosted.path, '/w/clinica-sol/clara');
  assert.equal((await f.companySlug('clinica-sol-nova', 'foreign')).statusCode, 409);
  assert.deepEqual(f.retiredSlugs(), [`${f.tenant}:clinica-sol-nova`]);
});

test('an expired reservation never comes back over the current owner: the link shown in the new owner\'s panel stays its own', async t => {
  const f = await fixture(t); platformProviders(t);
  const c = foreignClara(f);
  /** O endereço que o painel de C mostra leva ao chat de C. */
  const shown = async () => {
    const path = (await c.view()).json().hosted.path as string, [, , org, assistant] = path.split('/');
    const r = await f.resolve(org, assistant); assert.equal(r.statusCode, 200, path); assert.equal(r.json().tenantId, c.tenant, path);
    return path;
  };
  // B usa "acme", publica clara e troca de apelido.
  assert.equal((await f.companySlug('acme')).statusCode, 200);
  assert.equal((await f.publish()).statusCode, 200);
  assert.equal((await f.companySlug('bco')).statusCode, 200);
  // C publica clara e tenta "acme" ainda reservado: recusado com B publicando ou não.
  assert.equal((await c.publish()).statusCode, 200);
  assert.equal((await f.companySlug('acme', 'foreign')).statusCode, 409);
  assert.equal(await shown(), `/w/${technicalOrgSlug(c.tenant)}/clara`);
  assert.equal((await f.request('DELETE', `/api/v1/webchat/hosted/${f.agent.id}`)).statusCode, 200);
  assert.equal((await f.companySlug('acme', 'foreign')).statusCode, 409);
  assert.equal((await f.publish()).statusCode, 200);
  // Prazo vencido: o endereço antigo deixa de levar a B e C pega o apelido.
  f.expire('acme');
  assert.equal((await f.resolve('acme')).statusCode, 404);
  assert.equal((await f.companySlug('acme', 'foreign')).statusCode, 200);
  assert.equal(await shown(), '/w/acme/clara');
  assert.deepEqual(f.retiredSlugs(), [], 'a reserva vencida sai quando outra empresa pega o apelido');
  // B despublica, republica e tenta voltar ao apelido: o link do painel de C continua de C.
  assert.equal((await f.request('DELETE', `/api/v1/webchat/hosted/${f.agent.id}`)).statusCode, 200);
  const again = await f.publish(); assert.equal(again.statusCode, 200); assert.equal(again.json().hosted.path, '/w/bco/clara');
  assert.equal(await shown(), '/w/acme/clara');
  assert.equal((await f.companySlug('acme')).statusCode, 409);
  assert.equal(await shown(), '/w/acme/clara');
  assert.equal((await f.resolve('bco')).json().tenantId, f.tenant);
});

test('reservations are bounded: at most 2 previous slugs reserved per company at a time, and a granted reservation is never cut short', async t => {
  const f = await fixture(t); platformProviders(t);
  const squatter = foreignClara(f);
  assert.equal((await f.companySlug('marca-0', 'foreign')).statusCode, 200);
  assert.equal((await squatter.publish()).statusCode, 200);
  for (let i = 1; i <= 5; i++) assert.equal((await f.companySlug('marca-' + i, 'foreign')).statusCode, 200);
  // Com 2 reservas vigentes, o apelido que sai fica livre na hora; as reservas já concedidas (o nome divulgado há mais tempo) continuam.
  assert.deepEqual(f.retiredSlugs(), [`${squatter.tenant}:marca-0`, `${squatter.tenant}:marca-1`]);
  for (const org of ['marca-0', 'marca-1']) { assert.equal((await f.resolve(org)).json().tenantId, squatter.tenant, org); assert.equal((await f.companySlug(org)).statusCode, 409, org); }
  for (const org of ['marca-2', 'marca-3', 'marca-4']) assert.equal((await f.resolve(org)).statusCode, 404, org);
  // A empresa que de fato se chama "marca-3" pega o apelido e publica: é dela, e a anterior não o toma de volta.
  assert.equal((await f.companySlug('marca-3')).statusCode, 200);
  const own = await f.publish(); assert.equal(own.statusCode, 200, own.body); assert.equal(own.json().hosted.path, '/w/marca-3/clara');
  assert.equal((await f.companySlug('marca-3', 'foreign')).statusCode, 409);
  assert.equal((await squatter.publish()).statusCode, 200);
  assert.equal((await f.resolve('marca-3')).json().tenantId, f.tenant);
  assert.equal((await f.app.inject({ url: '/c/marca-3/consulta' })).headers.location, `/c/${technicalOrgSlug(f.tenant)}/consulta`);
  // Vencida uma reserva, a próxima troca volta a reservar o apelido que sai.
  f.expire('marca-0');
  assert.equal((await f.companySlug('marca-6', 'foreign')).statusCode, 200);
  assert.deepEqual(f.retiredSlugs(), [`${squatter.tenant}:marca-1`, `${squatter.tenant}:marca-5`]);
  assert.equal((await f.companySlug('marca-0')).statusCode, 200, 'a reserva vencida não segura mais o apelido');
});

test('address reservations kept by the previous version become reservations of the previous company slug, once', async t => {
  const recent = new Date(Date.now() - 3600000).toISOString(), old = new Date(Date.now() - 200 * 86400000).toISOString();
  const f = await fixture(t, store => {
    store.create('hosted-tenant', 'company-slugs', { slug: 'clinica-nova' });
    store.create('third-hosted-tenant', 'company-slugs', { slug: 'casa-joana' });
    for (const [orgSlug, currentAt] of [['clinica-sol', recent], ['clinica-nova', recent], ['casa-joana', recent], ['muito-antiga', old]]) store.create('hosted-tenant', 'webchat-hosted-addresses', { orgSlug, assistantSlug: 'clara', currentAt });
  });
  platformProviders(t);
  assert.deepEqual(f.retiredSlugs(), ['hosted-tenant:clinica-sol'], 'só o apelido anterior ainda no prazo e sem outra dona');
  assert.equal((await f.publish()).json().hosted.path, '/w/clinica-nova/clara');
  for (const org of ['clinica-sol', 'clinica-nova']) assert.equal((await f.resolve(org)).json().tenantId, f.tenant, org);
  assert.equal((await f.companySlug('clinica-sol', 'foreign')).statusCode, 409);
  assert.equal((await f.companySlug('muito-antiga', 'foreign')).statusCode, 200);
  assert.equal((await f.companySlug('casa-joana', 'third')).statusCode, 200, 'a dona atual do apelido não é afetada');
  // Conversão única (marcador em engine_migrations): na próxima subida a reserva já liberada não volta.
  f.store.remove(f.tenant, 'company-slugs-retired', f.store.list(f.tenant, 'company-slugs-retired')[0].id);
  adoptAddressReservations(f.store);
  assert.deepEqual(f.retiredSlugs(), []);
});
