import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { Store } from '../src/store.js';
import { buildApp } from '../src/app.js';
import { registerAuth } from '../src/auth.js';
import { TaskAutomationWorker, hasTaskAutomation, registerTasks, runTaskAutomation, taskNotifications, taskRuns, tasksCollection } from '../src/tasks.js';
import { seedMember } from './fixtures/membership.js';

const env = { ...process.env };
afterEach(() => { for (const k of ['OPENAI_API_KEY', 'PROVIDER_TENANT_ID', 'PLATFORM_AI_PROVIDERS', 'RESEND_API_KEY']) { if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; } });
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

/** App real (buildApp) ou só auth + tarefas com worker/e-mail falsos; membros extras com sessão própria. */
async function fixture(t: any, worker?: (store: Store) => TaskAutomationWorker) {
  delete process.env.RESEND_API_KEY;
  const store = new Store();
  const app = worker ? Fastify() : await buildApp(store);
  let automation: TaskAutomationWorker | undefined;
  if (worker) { await app.register(cookie); await registerAuth(app, store); automation = worker(store); await registerTasks(app, store, automation); }
  t.after(async () => { await app.close(); store.close(); });
  const signup = await app.inject({ method: 'POST', url: '/api/v1/auth/signup', payload: { email: `tasks-${randomUUID()}@example.test`, password: 'synthetic-password-long', organization: 'Tarefas Org' } });
  assert.equal(signup.statusCode, 201, signup.body);
  const tenant = signup.json().tenantId as string, owner = { token: signup.cookies.find(c => c.name === 'kloel_session')!.value, userId: signup.json().userId as string };
  const member = (role: 'member' | 'viewer' | 'owner', tenantId = tenant) => { const userId = `u-${role}-${randomUUID().slice(0, 8)}`, token = `tok-${randomUUID()}`; seedMember(store, { userId, tenantId, role }); store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(hash(token), userId, tenantId, Date.now() + 3600000); return { token, userId }; };
  const as = (who: { token: string }) => (method: any, url: string, payload?: unknown, headers: Record<string, string> = {}) => app.inject({ method, url, cookies: { kloel_session: who.token }, payload: payload as any, headers });
  return { store, app, tenant, owner, member, as, req: as(owner), automation: automation! };
}
const userIdOf = (store: Store, token: string) => String(store.db.prepare('SELECT user_id FROM sessions WHERE hash=?').get(hash(token))!.user_id);

test('Tarefas (BETA): ligar o recurso, criar, alterar com Atividade, duplicar, excluir, permissões e isolamento', async t => {
  const f = await fixture(t), ownerId = userIdOf(f.store, f.owner.token), ana = f.member('member'), viewer = f.member('viewer'), outsider = f.member('owner', 'other-tenant');
  const settings = await f.req('GET', '/api/v1/tasks/settings'); assert.equal(settings.statusCode, 200, settings.body);
  assert.equal(settings.json().enabled, false); assert.equal(settings.json().canManage, true); assert.equal(settings.json().notifications.email, false);
  assert.equal((await f.req('POST', '/api/v1/tasks', { title: 'Antes do BETA' })).json().error.code, 'tasks_disabled');
  assert.equal((await f.as(ana)('PUT', '/api/v1/tasks/settings', { enabled: true })).statusCode, 403, 'só quem administra a organização liga recursos em BETA');
  const on = await f.req('PUT', '/api/v1/tasks/settings', { enabled: true }); assert.equal(on.statusCode, 200, on.body); assert.equal(on.json().enabled, true);

  const contact = f.store.create(f.tenant, 'contacts', { schemaVersion: 2, revision: 1, name: 'Paula Lima', displayName: 'Paula Lima', phones: [], emails: [], fieldValues: {} });
  const conversation = f.store.create(f.tenant, 'conversations', { channel: 'phone', status: 'closed', subject: 'Orçamento de implante', contactId: contact.id, startedAt: new Date().toISOString() });
  const body = { title: '  Retornar ligação  ', description: '<script>alert(1)</script><b onclick="x()">Paciente</b> pediu retorno', priority: 'high', assigneeUserId: ana.userId, dueAt: '2026-10-21T18:00:00.000Z', tags: ['Retorno', 'retorno', ' Financeiro '], conversationId: conversation.id };
  const created = await f.req('POST', '/api/v1/tasks', body, { 'idempotency-key': 'create-task-0001' }); assert.equal(created.statusCode, 201, created.body);
  const task = created.json();
  assert.equal(task.title, 'Retornar ligação'); assert.equal(task.status, 'todo'); assert.equal(task.description, '<b>Paciente</b> pediu retorno');
  assert.deepEqual(task.tags, ['Retorno', 'Financeiro']); assert.equal(task.assigneeUserId, ana.userId); assert.equal(task.createdBy, 'user'); assert.equal(task.createdByUserId, ownerId);
  assert.equal(task.contactId, contact.id, 'o contato vem da conversa'); assert.deepEqual(task.origin.conversation, { id: conversation.id, title: 'Orçamento de implante', channel: 'phone', startedAt: conversation.startedAt });
  assert.deepEqual(task.origin.contact, { id: contact.id, name: 'Paula Lima' });
  assert.deepEqual(task.activity.map((a: any) => [a.userId, a.change]), [[ownerId, 'Criou esta tarefa']]);
  const replay = await f.req('POST', '/api/v1/tasks', body, { 'idempotency-key': 'create-task-0001' }); assert.equal(replay.statusCode, 200); assert.equal(replay.json().id, task.id);
  assert.equal((await f.req('POST', '/api/v1/tasks', { title: 'Outra' }, { 'idempotency-key': 'create-task-0001' })).json().error.code, 'idempotency_conflict');
  assert.equal(f.store.list(f.tenant, tasksCollection).length, 1);
  assert.equal((await f.req('POST', '/api/v1/tasks', { title: 'X', assigneeUserId: outsider.userId })).json().error.code, 'assignee_not_member');
  assert.equal((await f.req('POST', '/api/v1/tasks', { title: '' })).statusCode, 400);

  const patched = await f.as(ana)('PATCH', `/api/v1/tasks/${task.id}`, { status: 'in_progress', priority: 'medium', assigneeUserId: null, dueAt: null, tags: ['Retorno', 'Urgente'], title: 'Retornar ligação hoje', description: '<b>Paciente</b> pediu retorno' });
  assert.equal(patched.statusCode, 200, patched.body); const p = patched.json();
  assert.equal(p.revision, 2); assert.equal(p.status, 'in_progress'); assert.equal(p.assigneeUserId, null); assert.equal(p.dueAt, null);
  assert.deepEqual(p.activity.slice(1).map((a: any) => [a.userId, a.change]), [
    [ana.userId, 'Título: Retornar ligação → Retornar ligação hoje'], [ana.userId, 'Estado: A fazer → Em andamento'], [ana.userId, 'Prioridade: Alta → Média'],
    [ana.userId, `Responsável: ${ana.userId}@example.test → Sem responsável`], [ana.userId, 'Data de vencimento: 21/10/2026, 15:00 → Sem data'],
    [ana.userId, 'Tags adicionadas: Urgente'], [ana.userId, 'Tags removidas: Financeiro']]);
  const same = await f.req('PATCH', `/api/v1/tasks/${task.id}`, { status: 'in_progress' }); assert.equal(same.json().revision, 2, 'sem mudança real não cria Atividade');
  assert.equal((await f.as(viewer)('PATCH', `/api/v1/tasks/${task.id}`, { status: 'done' })).statusCode, 403);
  assert.equal((await f.as(viewer)('GET', '/api/v1/tasks')).json().items.length, 1, 'quem só visualiza lê as tarefas');
  assert.equal((await f.as(outsider)('GET', `/api/v1/tasks/${task.id}`)).statusCode, 404);
  assert.equal((await f.as(outsider)('GET', '/api/v1/tasks')).json().items.length, 0);
  const assignees = (await f.req('GET', '/api/v1/tasks/assignees')).json().items.map((m: any) => m.userId).sort();
  assert.deepEqual(assignees, [ownerId, ana.userId, viewer.userId].sort());

  const copy = await f.req('POST', `/api/v1/tasks/${task.id}/duplicate`); assert.equal(copy.statusCode, 201, copy.body);
  assert.equal(copy.json().title, 'Retornar ligação hoje (cópia)'); assert.equal(copy.json().conversationId, conversation.id);
  assert.deepEqual(copy.json().activity.map((a: any) => a.change), ['Criou esta tarefa', 'Duplicou a tarefa “Retornar ligação hoje”']);
  assert.equal((await f.req('DELETE', `/api/v1/tasks/${task.id}`)).statusCode, 204);
  assert.equal((await f.req('GET', `/api/v1/tasks/${task.id}`)).statusCode, 404);
  assert.deepEqual((await f.req('GET', '/api/v1/tasks')).json().items.map((x: any) => x.id), [copy.json().id]);
  const bearer = await f.app.inject({ method: 'GET', url: '/api/v1/tasks', headers: { authorization: 'Bearer klo_key_x' } }); assert.ok([401, 403].includes(bearer.statusCode));
});

test('o responsável recebe e-mail quando a tarefa é atribuída a ele ou alterada por outra pessoa', async t => {
  const sent: any[] = [];
  const f = await fixture(t, store => new TaskAutomationWorker(store, { sendEmail: async m => { sent.push(m); return true; } })), ana = f.member('member');
  await f.req('PUT', '/api/v1/tasks/settings', { enabled: true });
  const mine = (await f.req('POST', '/api/v1/tasks', { title: 'Minha tarefa', assigneeUserId: userIdOf(f.store, f.owner.token) })).json();
  const theirs = (await f.req('POST', '/api/v1/tasks', { title: 'Ligar para Paula' })).json();
  await new Promise(r => setTimeout(r, 20)); assert.equal(sent.length, 0, 'atribuir a si mesmo ou sem responsável não envia');
  await f.req('PATCH', `/api/v1/tasks/${theirs.id}`, { assigneeUserId: ana.userId });
  await f.as(ana)('PATCH', `/api/v1/tasks/${theirs.id}`, { status: 'done' });
  await f.req('PATCH', `/api/v1/tasks/${theirs.id}`, { priority: 'high' });
  await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(sent.map(m => [m.to, m.subject]), [[`${ana.userId}@example.test`, 'Tarefa atribuída a você: Ligar para Paula'], [`${ana.userId}@example.test`, 'Tarefa atualizada: Ligar para Paula']]);
  assert.match(sent[1].text, /Prioridade: Sem prioridade → Alta/); assert.match(sent[1].text, new RegExp(`/app/tasks/${theirs.id}`));
  assert.deepEqual(f.store.list(f.tenant, taskNotifications).map(n => n.status), ['sent', 'sent']);
  assert.ok(mine.id);
});

const answer = (output: unknown) => Response.json({ id: 'resp_task', status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(output) }] }] });
async function automationFixture(t: any, reply: (body: any) => Response) {
  const calls: any[] = []; let now = Date.now();
  const f = await fixture(t, store => new TaskAutomationWorker(store, { now: () => now, idleMinutes: 30, sendEmail: async () => true, fetch: (async (url: string, init: any) => { assert.equal(url, 'https://api.openai.com/v1/responses'); const body = JSON.parse(String(init.body)); calls.push(body); return reply(body); }) as typeof fetch }));
  Object.assign(process.env, { OPENAI_API_KEY: 'fixture-only', PROVIDER_TENANT_ID: f.tenant }); delete process.env.PLATFORM_AI_PROVIDERS;
  await f.req('PUT', '/api/v1/tasks/settings', { enabled: true });
  const ana = f.member('member'), agent = f.store.create(f.tenant, 'agents', { name: 'Roberta' });
  const config = { enabled: true, instructions: 'Resuma o pedido e o horário desejado para o retorno.', initialStatus: 'in_progress', rulesEnabled: true, rules: [
    { id: 'r-sempre', tags: ['Criada por IA'], when: 'always' }, { id: 'r-retorno', tags: ['Retorno de ligação'], assigneeUserId: ana.userId, priority: 'high', when: 'only_if', condition: 'A pessoa pede explicitamente um retorno.' }] };
  const editor = f.store.create(f.tenant, 'agent-editor-states', { agentId: agent.id, state: { name: 'Roberta', taskActions: config } });
  const conversation = (channel: string, extra: Record<string, unknown>, text = 'Quero que alguém da clínica me ligue amanhã às 15h sobre o implante.') => {
    const c = f.store.create(f.tenant, 'conversations', { channel, agentId: agent.id, externalContact: '+5511988887777', subject: 'Conversa', startedAt: new Date(now).toISOString(), ...extra });
    f.store.create(f.tenant, 'messages', { conversationId: c.id, role: 'user', content: text, createdAt: new Date(now).toISOString() });
    f.store.create(f.tenant, 'messages', { conversationId: c.id, role: 'assistant', content: 'Combinado, vou registrar o pedido.' });
    return c;
  };
  return { ...f, ana, agent, config, editor, calls, conversation, clock: { get: () => now, set: (v: number) => { now = v; } } };
}
const aiOutput = (body: any) => answer({ create: true, title: 'Agendar retorno de ligação', description: 'Paciente pediu retorno amanhã às 15h sobre o implante.\nTelefone: +55 11 98888-7777', ...(body.text.format.schema.properties.conditions ? { conditions: [{ ruleId: 'r-retorno', matched: true }] } : {}) });

test('"Criar tarefa": ao fim da ligação a IA cria uma tarefa com regras, uma única vez, e só para conversas após a ativação', async t => {
  const f = await automationFixture(t, aiOutput);
  const before = f.conversation('phone', { status: 'closed', endedAt: new Date(f.clock.get() - 3600_000 * 3).toISOString() });
  assert.equal(hasTaskAutomation(f.store, f.tenant, f.agent.id), true);
  await f.automation.tick(); assert.equal(f.calls.length, 0, 'ligação encerrada antes da ativação não gera tarefa retroativa');
  f.clock.set(f.clock.get() + 60_000);
  const open = f.conversation('phone', { status: 'open' }), call = f.conversation('phone', { status: 'closed', endedAt: new Date(f.clock.get()).toISOString() });
  assert.deepEqual(await f.automation.tick(), { processed: 1 });
  assert.equal(f.calls.length, 1); const body = f.calls[0], input = JSON.parse(body.input);
  assert.equal(body.store, false); assert.equal(body.text.format.name, 'task_from_conversation'); assert.deepEqual(body.text.format.schema.properties.conditions.items.properties.ruleId.enum, ['r-retorno']);
  assert.equal(input.instrucoesDaTarefa, 'Resuma o pedido e o horário desejado para o retorno.'); assert.equal(input.contato.telefone, '+5511988887777'); assert.equal(input.mensagens[0].role, 'contato');
  const tasks = f.store.list(f.tenant, tasksCollection); assert.equal(tasks.length, 1); const task = tasks[0]!;
  assert.equal(task.title, 'Agendar retorno de ligação'); assert.equal(task.description, '<div>Paciente pediu retorno amanhã às 15h sobre o implante.</div><div>Telefone: +55 11 98888-7777</div>');
  assert.equal(task.status, 'in_progress'); assert.equal(task.priority, 'high'); assert.equal(task.assigneeUserId, f.ana.userId); assert.deepEqual(task.tags, ['Criada por IA', 'Retorno de ligação']);
  assert.equal(task.createdBy, 'ai'); assert.equal(task.agentId, f.agent.id); assert.equal(task.conversationId, call.id); assert.equal(task.simulated, false);
  assert.deepEqual((task.activity as any[]).map(a => [a.userId, a.change]), [['ai', 'Criou esta tarefa']]);
  const run = f.store.list(f.tenant, taskRuns)[0]!; assert.equal(run.status, 'created'); assert.equal(run.aiUsed, true); assert.deepEqual(run.appliedRuleIds, ['r-sempre', 'r-retorno']);
  await f.automation.tick(); assert.equal(f.calls.length, 1); assert.equal((await runTaskAutomation(f.store, f.tenant, call.id, { trigger: 'chat_end' })).reasonCode, 'already_processed');
  assert.equal(f.store.list(f.tenant, tasksCollection).length, 1, 'worker, fim de chat e reinício nunca criam duas tarefas');
  assert.ok(before && open);
  const listed = (await f.req('GET', '/api/v1/tasks')).json().items[0]; assert.deepEqual(listed.origin.agent, { id: f.agent.id, name: 'Roberta' });
});

test('chat parado gera a tarefa; condição não satisfeita não aplica a regra; habilidade desligada não cria nada', async t => {
  const f = await automationFixture(t, body => answer({ create: true, title: 'Enviar orçamento', description: 'Cliente quer o orçamento por e-mail.', ...(body.text.format.schema.properties.conditions ? { conditions: [{ ruleId: 'r-retorno', matched: false }] } : {}) }));
  await f.automation.tick(); f.clock.set(f.clock.get() + 60_000);
  const chat = f.conversation('webchat', { status: 'open', lastMessageAt: new Date(f.clock.get()).toISOString() }, 'Pode me mandar o orçamento por e-mail?');
  await f.automation.tick(); assert.equal(f.calls.length, 0, 'chat ainda ativo');
  f.clock.set(f.clock.get() + 31 * 60_000); await f.automation.tick();
  const task = f.store.list(f.tenant, tasksCollection)[0]!; assert.equal(task.conversationId, chat.id); assert.equal(task.title, 'Enviar orçamento');
  assert.equal(task.assigneeUserId, null); assert.equal(task.priority, 'none'); assert.deepEqual(task.tags, ['Criada por IA']);
  f.store.update(f.tenant, 'agent-editor-states', f.editor.id, { state: { taskActions: { ...f.config, enabled: false } } });
  f.conversation('phone', { status: 'closed', endedAt: new Date(f.clock.get()).toISOString() });
  await f.automation.tick(); assert.equal(f.store.list(f.tenant, tasksCollection).length, 1); assert.equal(hasTaskAutomation(f.store, f.tenant, f.agent.id), false);
});

test('ablação: sem provedor de IA a tarefa sai com resumo simples e "Somente se…" não é aplicada', async t => {
  const f = await automationFixture(t, () => { throw Error('Nenhuma chamada ao provedor esperada'); });
  delete process.env.OPENAI_API_KEY;
  await f.automation.tick(); f.clock.set(f.clock.get() + 60_000);
  const call = f.conversation('phone', { status: 'closed', endedAt: new Date(f.clock.get()).toISOString(), subject: 'Retorno sobre implante' });
  await f.automation.tick(); assert.equal(f.calls.length, 0);
  const task = f.store.list(f.tenant, tasksCollection)[0]!;
  assert.equal(task.title, 'Retorno sobre implante'); assert.match(String(task.description), /Solicitação: Quero que alguém da clínica me ligue/); assert.match(String(task.description), /Contato: \+5511988887777/);
  assert.deepEqual(task.tags, ['Criada por IA']); assert.equal(task.assigneeUserId, null, 'regra condicional exige a avaliação da IA');
  const run = f.store.list(f.tenant, taskRuns)[0]!; assert.equal(run.aiUsed, false); assert.equal(run.reasonCode, 'provider_not_configured'); assert.equal(run.conditionsEvaluated, false); assert.equal(run.conversationId, call.id);
});

test('"Criar tarefa de teste" usa o rascunho da folha numa conversa do assistente e marca a tarefa como teste', async t => {
  const f = await automationFixture(t, aiOutput);
  const call = f.conversation('phone', { status: 'closed', endedAt: new Date(f.clock.get()).toISOString() }), other = f.store.create(f.tenant, 'conversations', { channel: 'phone', status: 'closed' });
  const draft = { ...f.config, initialStatus: 'todo', rules: [{ id: 'r-retorno', tags: ['Teste'], when: 'only_if', condition: 'A pessoa pede retorno.' }] };
  assert.equal((await f.req('POST', '/api/v1/tasks/automation/test', { agentId: f.agent.id, conversationId: other.id, config: draft })).json().error.code, 'conversation_agent_mismatch');
  const res = await f.req('POST', '/api/v1/tasks/automation/test', { agentId: f.agent.id, conversationId: call.id, config: draft }); assert.equal(res.statusCode, 201, res.body);
  assert.equal(res.json().task.simulated, true); assert.equal(res.json().task.status, 'todo'); assert.deepEqual(res.json().task.tags, ['Teste']); assert.deepEqual(res.json().run, { aiUsed: true, reasonCode: null, appliedRuleIds: ['r-retorno'], conditionsEvaluated: true });
  await f.automation.tick(); assert.equal(f.store.list(f.tenant, tasksCollection).length, 1, 'o teste não consome a tarefa automática… e esta conversa terminou antes da ativação');
});
