import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sheetsActionsFixture } from './fixtures/sheets-actions.js';
import { sheetExecutions, sheetGrants } from '../src/oauth/sheets-agent-actions.js';

test('query real private route reaches Google and OpenAI round2 without persisting cells in tool journals', async t => {
  const f = await sheetsActionsFixture(t), action = await f.create(); f.toolRound(action, { nome: 'Teste A' });
  const result = await f.askPrivate(); assert.equal(result.statusCode, 200, result.body); assert.equal(f.openAI.length, 2);
  const output = JSON.parse(f.openAI[1].input.at(-1).output); assert.equal(output.kind, 'query'); assert.deepEqual(output.rows[0].cells, ['Teste A', '7']); assert.ok(!JSON.stringify(f.openAI).includes('NAO_DIVULGAR'));
  assert.equal(f.requests.filter(r => r.url.hostname === 'sheets.googleapis.com').length, 1);
  const technical = [...f.store.list(f.actor.tenantId, 'agent-tool-calls'), ...f.store.list(f.actor.tenantId, sheetExecutions), ...f.store.list(f.actor.tenantId, 'messages').filter(r => r.role === 'tool')];
  assert.ok(!JSON.stringify(technical).includes('Teste A')); assert.ok(!JSON.stringify(technical).includes('NAO_DIVULGAR'));
});
test('public query is absent without grant; explicit grant yields projection and real round2', async t => {
  const f = await sheetsActionsFixture(t), action = await f.create(); f.toolRound(action, { nome: 'Teste A' }); const a = await f.session();
  assert.equal((await f.publicRequest(a.token)).statusCode, 200); assert.equal(f.requests.length, 0); assert.equal(JSON.parse(f.openAI[1].input.at(-1).output).error, 'tool_not_enabled');
  await f.grant(action); const b = await f.session(); assert.match(b.sheetsNotice, /planilhas/); f.openAI.length = 0;
  const response = await f.publicRequest(b.token); assert.equal(response.statusCode, 200, response.body); assert.equal(f.openAI.length, 2); assert.equal(JSON.parse(f.openAI[1].input.at(-1).output).kind, 'query');
});
test('public append delegates exactly one RAW row and subsequent turns cannot repeat it', async t => {
  const f = await sheetsActionsFixture(t), action = await f.create('append'); await f.grant(action); const s = await f.session(); f.toolRound(action, { nome: '=literal', qtd: 0, ativo: false });
  const first = await f.publicRequest(s.token); assert.equal(first.statusCode, 200, first.body); const writes = () => f.requests.filter(r => r.method === 'POST' && r.url.hostname === 'sheets.googleapis.com'); assert.equal(writes().length, 1);
  assert.deepEqual((writes()[0].body as any).values, [['=literal', 0, false]]); assert.equal(writes()[0].url.searchParams.get('valueInputOption'), 'RAW');
  f.toolRound(action, { nome: 'Outra', qtd: 1, ativo: true }, 'different_call'); assert.equal((await f.publicRequest(s.token, 'Outra')).statusCode, 200); assert.equal(writes().length, 1);
  const history = await f.history(s.token); assert.equal(history.json().sheetOperations[0].status, 'appended'); assert.ok(!history.body.includes('synthetic_spreadsheet'));
});
test('configuration writes replay original receipt before stale CAS and reject authority ABA', async t => {
  const f = await sheetsActionsFixture(t), action = await f.create(), key = randomUUID(), body = { expectedTenantId: f.actor.tenantId, expectedRevision: action.revision, enabled: false };
  const first = await f.request('PATCH', `${f.base}/${action.id}`, body, key); assert.equal(first.statusCode, 200);
  const second = await f.request('PATCH', `${f.base}/${action.id}`, body, key); assert.equal(second.statusCode, 200); assert.equal(second.json().replayed, true);
  f.aba(); assert.equal((await f.request('GET', `/api/v1/oauth/sheets/action-operations/${key}`, undefined, undefined, f.headers())).statusCode, 404);
});
test('grant revocation during Google read suppresses round2 and cells', async t => {
  const f = await sheetsActionsFixture(t), action = await f.create(); const grant = await f.grant(action); const s = await f.session(); f.toolRound(action, { nome: 'Teste A' });
  f.hooks.provider = () => { f.store.update(f.actor.tenantId, sheetGrants, grant.grantId, { status: 'revoked', revision: 2 }); return Response.json({ range: "'Client''s Data'!A1:C20", values: [['Nome', 'Qtd', 'Interno'], ['Teste A', '7', 'PRIVATE']] }); };
  const result = await f.publicRequest(s.token); assert.notEqual(result.statusCode, 200); assert.equal(f.openAI.length, 1); assert.equal(f.store.list(f.actor.tenantId, 'messages').filter(m => m.role === 'assistant').length, 0);
});

test('preview uses projection/evaluator and does not enable action, grant, or mutate verification', async t => {
  const f = await sheetsActionsFixture(t), action = await f.create('query', false), before = f.store.get(f.actor.tenantId, 'oauth-sheets-bindings', f.binding.id);
  const result = await f.request('POST', `${f.base}/${action.id}/preview`, { expectedTenantId: f.actor.tenantId, expectedRevision: 1, variables: { nome: 'Teste B' } });
  assert.equal(result.statusCode, 200, result.body); assert.deepEqual(result.json().columns.map((c: any) => [c.index, c.a1]), [[1, 'A'], [2, 'B']]); assert.deepEqual(result.json().rows[0].cells, ['Teste B', '0']);
  assert.equal(f.store.list(f.actor.tenantId, sheetGrants).length, 0); assert.equal(f.store.list(f.actor.tenantId, sheetExecutions).length, 0); assert.deepEqual(f.store.get(f.actor.tenantId, 'oauth-sheets-bindings', f.binding.id), before); assert.equal((await f.list())[0].enabled, false);
});
for (const [label, changes] of [
  ['duplicate variables', { inputDefinitions: [{ name: 'nome', type: 'text' }, { name: 'nome', type: 'text' }] }],
  ['column outside range', { returnColumns: ['D'] }], ['duplicate headers', { expectedHeaders: ['Nome', 'Nome', 'Interno'] }],
  ['extra remote URL', { url: 'https://other.invalid' }], ['missing variable binding', { inputDefinitions: [] }],
] as const) test(`configuration rejects ${label} before provider I/O`, async t => {
  const f = await sheetsActionsFixture(t); const response = await f.request('POST', f.base, { expectedTenantId: f.actor.tenantId, expectedBindingRevision: 1, configuration: { connectionId: f.connection.id, bindingId: f.binding.id, kind: 'query', ...f.queryConfig, ...changes } }, randomUUID());
  assert.equal(response.statusCode, 400, response.body); assert.equal(f.requests.length, 0); assert.equal((await f.list()).length, 0);
});
test('query rejects changed headers and input extras without disclosure', async t => {
  const f = await sheetsActionsFixture(t), action = await f.create();
  const bad = await f.request('POST', `${f.base}/${action.id}/preview`, { expectedTenantId: f.actor.tenantId, expectedRevision: action.revision, variables: { nome: 'Teste A', range: 'A1:Z99' } }); assert.equal(bad.statusCode, 400); assert.equal(f.requests.length, 0);
  f.hooks.provider = () => Response.json({ range: "'Client''s Data'!A1:C20", values: [['Nome', 'Senha', 'Interno'], ['Teste A', 'SECRET', 'SECRET']] });
  const result = await f.request('POST', `${f.base}/${action.id}/preview`, { expectedTenantId: f.actor.tenantId, expectedRevision: action.revision, variables: { nome: 'Teste A' } }); assert.equal(result.statusCode, 409); assert.ok(!result.body.includes('SECRET'));
});
test('management requires four headers and exact tenant, foreign cookie cannot use captured authority', async t => {
  const f = await sheetsActionsFixture(t), action = await f.create();
  assert.equal((await f.app.inject({ url: f.base, cookies: f.cookies })).statusCode, 400);
  const bad = await f.request('PATCH', `${f.base}/${action.id}`, { expectedTenantId: randomUUID(), expectedRevision: action.revision, enabled: false }, randomUUID()); assert.equal(bad.statusCode, 409); assert.equal((await f.list())[0].enabled, true);
  const { digest } = await import('../src/oauth/crypto.js'); const newCookie = randomUUID(); f.store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(digest(newCookie), f.actor.userId, f.actor.tenantId, Date.now() + 60000);
  const wrong = await f.app.inject({ method: 'PATCH', url: `${f.base}/${action.id}`, cookies: { kloel_session: newCookie }, headers: { ...f.originalHeaders, 'idempotency-key': randomUUID() }, payload: { expectedTenantId: f.actor.tenantId, expectedRevision: action.revision, enabled: false } }); assert.equal(wrong.statusCode, 409); assert.equal((await f.list())[0].enabled, true);
});
test('agent PATCH no-op and A→B→A advance server delegation generation and invalidate grant', async t => {
  const f = await sheetsActionsFixture(t), action = await f.create(); await f.grant(action);
  for (const name of ['Sheets helper', 'B', 'Sheets helper']) { const r = await f.request('PATCH', `/api/v1/agents/${f.agent.id}`, { name }); assert.equal(r.statusCode, 200, r.body); }
  const current = f.store.get(f.actor.tenantId, 'agents', f.agent.id)!; assert.equal(current.delegationGeneration, 3);
  assert.equal((await f.request('GET', `${f.base}/${action.id}/grants`)).json().items[0].status, 'needs_reauthorization');
  const spoof = await f.request('PATCH', `/api/v1/agents/${f.agent.id}`, { delegationGeneration: 0 }); assert.equal(spoof.statusCode, 400);
  f.toolRound(action, { nome: 'Teste A' }); const s = await f.session(); assert.equal((await f.publicRequest(s.token)).statusCode, 200); assert.equal(f.requests.length, 0);
});
test('grant ID+revision precondition rejects G1→G2 ABA and expiry hides public tool', async t => {
  const f = await sheetsActionsFixture(t), action = await f.create(), one = await f.grant(action), two = await f.grant(action, { id: one.grantId, revision: 1 });
  const { sheetChannelVersion } = await import('../src/oauth/sheets-agent-actions.js');
  const response = await f.request('POST', `${f.base}/${action.id}/grants`, { expectedTenantId: f.actor.tenantId, expectedActionRevision: action.revision, expectedChannelVersion: sheetChannelVersion(f.store.get(f.actor.tenantId, 'channels', f.channel.id)!), channelId: f.channel.id, previousGrant: { id: one.grantId, revision: 1 }, policy: { expiresInDays: 1, maxCallsPerConversation: 1, maxCallsPerDay: 10, acknowledgePublicDisclosure: true } }, randomUUID()); assert.equal(response.statusCode, 409);
  f.store.update(f.actor.tenantId, sheetGrants, two.grantId, { expiresAt: 1 }); f.toolRound(action, { nome: 'Teste A' }); const s = await f.session(); assert.equal(s.sheetsNotice, null); assert.equal((await f.publicRequest(s.token)).statusCode, 200); assert.equal(f.requests.length, 0);
});
test('malformed 2xx append is uncertain, new grant/revision/turn never repeats provider write', async t => {
  const f = await sheetsActionsFixture(t), action = await f.create('append'), one = await f.grant(action), s = await f.session(); f.toolRound(action, { nome: 'A', qtd: 0, ativo: false });
  f.hooks.provider = r => r.method === 'POST' ? new Response('{broken', { status: 200 }) : undefined;
  assert.equal((await f.publicRequest(s.token)).statusCode, 200); const operation = f.store.list(f.actor.tenantId, sheetExecutions)[0]; assert.equal(operation.status, 'uncertain'); assert.equal(operation.positiveHttpStatus, 200);
  assert.equal((await f.request('PATCH', `${f.base}/${action.id}`, { expectedTenantId: f.actor.tenantId, expectedRevision: 2, enabled: false }, randomUUID())).statusCode, 200);
  assert.equal((await f.request('PATCH', `${f.base}/${action.id}`, { expectedTenantId: f.actor.tenantId, expectedRevision: 3, enabled: true }, randomUUID())).statusCode, 200);
  const latest = (await f.list())[0], previous = f.store.get(f.actor.tenantId, sheetGrants, one.grantId)!; await f.grant(latest, { id: previous.id, revision: previous.revision }); f.toolRound(latest, { nome: 'B', qtd: 1, ativo: true }, 'new_after_reload');
  assert.equal((await f.publicRequest(s.token, 'Segunda')).statusCode, 200); assert.equal(f.requests.filter(r => r.method === 'POST').length, 1); assert.equal((await f.history(s.token)).json().sheetOperations[0].status, 'uncertain');
});
test('accepted append survives late grant revocation without disclosing final answer', async t => {
  const f = await sheetsActionsFixture(t), action = await f.create('append'), grant = await f.grant(action), s = await f.session(); f.toolRound(action, { nome: 'A', qtd: 0, ativo: false });
  f.hooks.provider = r => { if (r.method !== 'POST') return; f.store.update(f.actor.tenantId, sheetGrants, grant.grantId, { status: 'revoked', revision: 2 }); return Response.json({ spreadsheetId: f.binding.spreadsheetId, updates: { updatedRange: "'Client''s Data'!A21:C21", updatedRows: 1, updatedColumns: 3, updatedCells: 3 } }); };
  assert.notEqual((await f.publicRequest(s.token)).statusCode, 200); assert.equal(f.store.list(f.actor.tenantId, sheetExecutions)[0].status, 'appended'); assert.equal((await f.history(s.token)).json().sheetOperations[0].status, 'appended'); assert.equal(f.openAI.length, 1); assert.equal(f.requests.length, 1);
  const other = await f.session(); assert.equal((await f.history(other.token)).json().sheetOperations.length, 0);
});
test('public human handoff during query prevents result and append until explicitly resumed', async t => {
  const f = await sheetsActionsFixture(t), action = await f.create(); await f.grant(action); const s = await f.session(); f.toolRound(action, { nome: 'Teste A' });
  f.hooks.provider = () => { const conv = f.store.list(f.actor.tenantId, 'conversations')[0]; f.store.update(f.actor.tenantId, 'conversations', conv.id, { status: 'pending' }); return Response.json({ range: "'Client''s Data'!A1:C20", values: [['Nome', 'Qtd', 'Interno'], ['Teste A', '7', 'SECRET']] }); };
  const response = await f.publicRequest(s.token); assert.equal(response.statusCode, 200); assert.equal(response.json().status, 'human_pending'); assert.equal(f.openAI.length, 1); assert.equal(f.store.list(f.actor.tenantId, 'messages').filter(m => m.role === 'assistant').length, 0);
});
test('unknown private append receipt is local/read-only and original authority survives resource removal', async t => {
  const f = await sheetsActionsFixture(t), action = await f.create('append'); f.toolRound(action, { nome: 'A', qtd: 0, ativo: false }); f.hooks.provider = r => { if (r.method === 'POST') throw new Error('simulated response loss'); };
  assert.equal((await f.askPrivate()).statusCode, 200); const operation = f.store.list(f.actor.tenantId, sheetExecutions)[0]; assert.equal(operation.status, 'uncertain');
  f.store.remove(f.actor.tenantId, 'oauth-connections', f.connection.id); f.store.remove(f.actor.tenantId, 'sheets-assistant-actions', action.id); const before = f.requests.length, entities = f.store.db.prepare('SELECT * FROM entities ORDER BY id').all();
  const result = await f.request('GET', `/api/v1/oauth/sheets/action-executions/${operation.id}`); assert.equal(result.statusCode, 200); assert.equal(result.json().status, 'uncertain'); assert.equal(f.requests.length, before); assert.deepEqual(f.store.db.prepare('SELECT * FROM entities ORDER BY id').all(), entities);
  f.aba(); assert.equal((await f.request('GET', `/api/v1/oauth/sheets/action-executions/${operation.id}`, undefined, undefined, f.headers())).statusCode, 404);
});

test('organization suspension permanently invalidates only Sheets grants across reactivation and rolls back atomically', async t => {
  const f = await sheetsActionsFixture(t), action = await f.create(), receipt = await f.grant(action);
  const before = f.store.get(f.actor.tenantId, sheetGrants, receipt.grantId)!;
  const unrelated = f.store.create(f.actor.tenantId, 'unrelated-test-grants', { status: 'active', revision: 1 });
  assert.throws(() => f.store.transaction(() => { f.store.db.prepare("UPDATE organizations SET status='suspended' WHERE id=?").run(f.actor.tenantId); throw new Error('rollback'); }), /rollback/);
  assert.deepEqual(f.store.get(f.actor.tenantId, sheetGrants, before.id), before);
  f.store.db.prepare("UPDATE organizations SET status='suspended' WHERE id=?").run(f.actor.tenantId);
  f.store.db.prepare("UPDATE organizations SET status='active' WHERE id=?").run(f.actor.tenantId);
  const after = f.store.get(f.actor.tenantId, sheetGrants, before.id)!;
  assert.equal(after.status, 'needs_reauthorization'); assert.equal(after.revision, 2);
  assert.deepEqual(f.store.get(f.actor.tenantId, 'unrelated-test-grants', unrelated.id), unrelated);
  f.toolRound(action, { nome: 'Teste A' }); const s = await f.session(); assert.equal(s.sheetsNotice, null);
  assert.equal((await f.publicRequest(s.token)).statusCode, 200); assert.equal(f.requests.length, 0);
});

async function privateTurn(f: Awaited<ReturnType<typeof sheetsActionsFixture>>, conversationId: string, operationId = randomUUID()) {
  const { createSheetTurn, captureSheetOperator } = await import('../src/oauth/agent-sheets.js');
  const { resolveSessionContext, sameRequestContext } = await import('../src/request-context.js');
  const expected = resolveSessionContext(f.store, f.sessionHash)!.context;
  const assertCurrent = () => assert.ok(sameRequestContext(resolveSessionContext(f.store, f.sessionHash)!.context, expected));
  return createSheetTurn({ tenantId: f.actor.tenantId, agentId: f.agent.id, conversationId, operationId, operator: captureSheetOperator(f.store, f.sessionHash, expected, assertCurrent), assertBase: assertCurrent });
}
function actionCall(action: any, variables: unknown, id = randomUUID()) { return { id, name: `sheets_${action.kind}_${action.id.replaceAll('-', '')}`, arguments: JSON.stringify({ variables }) }; }

test('two concurrent append turns reserve one durable conversation/action slot before transport', async t => {
  const f = await sheetsActionsFixture(t), action = await f.create('append');
  const { executeSheetAgentTool } = await import('../src/oauth/agent-sheets.js');
  const conversation = f.store.create(f.actor.tenantId, 'conversations', { channel: 'webchat', agentId: f.agent.id, status: 'open' });
  let release!: () => void, entered!: () => void; const waiting = new Promise<void>(r => { release = r; }), started = new Promise<void>(r => { entered = r; });
  f.hooks.provider = async r => { if (r.method !== 'POST') return; entered(); await waiting; return Response.json({ spreadsheetId: f.binding.spreadsheetId, updates: { updatedRange: "'Client''s Data'!A21:C21", updatedRows: 1, updatedColumns: 3, updatedCells: 3 } }); };
  const variables = { nome: 'A', qtd: 7, ativo: true };
  const first = executeSheetAgentTool(f.store, await privateTurn(f, conversation.id), actionCall(action, variables));
  await started; const concurrent = await executeSheetAgentTool(f.store, await privateTurn(f, conversation.id), actionCall(action, variables));
  assert.equal(concurrent.status, 'pending'); assert.equal(concurrent.replayed, true); assert.equal(concurrent.automaticRetry, false);
  assert.equal(f.requests.filter(r => r.method === 'POST').length, 1); release(); assert.equal((await first).status, 'appended');
  assert.equal(f.store.list(f.actor.tenantId, sheetExecutions).length, 1);
});
test('private query cache is turn-local and restart cannot reveal stored cells or repeat the read', async t => {
  const f = await sheetsActionsFixture(t), action = await f.create(), conversation = f.store.create(f.actor.tenantId, 'conversations', { channel: 'webchat', agentId: f.agent.id, status: 'open' });
  const { executeSheetAgentTool } = await import('../src/oauth/agent-sheets.js');
  const turn = await privateTurn(f, conversation.id), call = actionCall(action, { nome: 'Teste A' });
  const first = await executeSheetAgentTool(f.store, turn, call); assert.equal(first.rows[0].cells[0], 'Teste A'); first.rows[0].cells[0] = 'tampered';
  assert.equal((await executeSheetAgentTool(f.store, turn, call)).rows[0].cells[0], 'Teste A');
  const restarted = await privateTurn(f, conversation.id, turn.operationId), unavailable = await executeSheetAgentTool(f.store, restarted, call);
  assert.equal(unavailable.error, 'result_unavailable'); assert.equal(f.requests.length, 1); assert.ok(!JSON.stringify(f.store.list(f.actor.tenantId, sheetExecutions)).includes('Teste A'));
});
test('query preview returns selected columns in the explicit configured order', async t => {
  const f = await sheetsActionsFixture(t), action = await f.create();
  assert.equal((await f.request('PUT', `${f.base}/${action.id}`, { expectedTenantId: f.actor.tenantId, expectedRevision: action.revision, expectedBindingRevision: 1, configuration: { ...f.queryConfig, returnColumns: ['B', 'A'] } }, randomUUID())).statusCode, 200);
  const response = await f.request('POST', `${f.base}/${action.id}/preview`, { expectedTenantId: f.actor.tenantId, expectedRevision: 3, variables: { nome: 'Teste A' } });
  assert.equal(response.statusCode, 200, response.body); assert.deepEqual(response.json().columns.map((c: any) => c.a1), ['B', 'A']); assert.deepEqual(response.json().rows[0].cells, ['7', 'Teste A']);
});
for (const [label, updatedRange, updatedColumns, updatedCells] of [
  ['foreign sheet', 'Other!A21:C21', 3, 3], ['different first column', "'Client''s Data'!B21:D21", 3, 3],
  ['more than one row', "'Client''s Data'!A21:C22", 3, 3], ['inconsistent cells', "'Client''s Data'!A21:C21", 3, 2],
] as const) test(`positive append acknowledgement with ${label} remains uncertain without retry`, async t => {
  const f = await sheetsActionsFixture(t), action = await f.create('append'); f.toolRound(action, { nome: 'A', qtd: 0, ativo: false });
  f.hooks.provider = () => Response.json({ spreadsheetId: f.binding.spreadsheetId, updates: { updatedRange, updatedRows: 1, updatedColumns, updatedCells } });
  assert.equal((await f.askPrivate()).statusCode, 200); const row = f.store.list(f.actor.tenantId, sheetExecutions)[0];
  assert.equal(row.status, 'uncertain'); assert.equal(row.positiveHttpStatus, 200); assert.equal(f.requests.length, 1);
});
test('accepted acknowledgement committed before a local callback error remains recoverable without another POST', async t => {
  const f = await sheetsActionsFixture(t), action = await f.create('append'); f.toolRound(action, { nome: 'A', qtd: 0, ativo: false });
  const update = f.store.update.bind(f.store); let failed = false;
  f.store.update = ((tenant, collection, id, patch) => { const value = update(tenant, collection, id, patch); if (!failed && collection === sheetExecutions && patch.status === 'appended') { failed = true; throw new Error('synthetic post-commit callback failure'); } return value; }) as typeof f.store.update;
  assert.equal((await f.askPrivate()).statusCode, 200); assert.equal(failed, true);
  const row = f.store.list(f.actor.tenantId, sheetExecutions)[0]; assert.equal(row.status, 'appended');
  const result = await f.request('GET', `/api/v1/oauth/sheets/action-executions/${row.id}`); assert.equal(result.json().status, 'appended'); assert.equal(f.requests.length, 1);
});
test('delegated grant survives issuer logout but organization, membership and scopes remain authoritative', async t => {
  const f = await sheetsActionsFixture(t), action = await f.create(); await f.grant(action); const s = await f.session();
  f.store.db.prepare('DELETE FROM sessions WHERE hash=?').run(f.sessionHash); f.toolRound(action, { nome: 'Teste A' });
  assert.equal((await f.publicRequest(s.token)).statusCode, 200); assert.equal(f.requests.length, 1);
  f.aba(); const next = await f.publicRequest(s.token, 'Outra pergunta'); assert.equal(next.statusCode, 200); assert.equal(f.requests.length, 1); assert.equal((await f.history(s.token)).json().sheetsNotice, null);
});
test('public query quota persists across turns and regrant and prevents Google access', async t => {
  const f = await sheetsActionsFixture(t), action = await f.create(), one = await f.grant(action, null, { maxCallsPerConversation: 1 }), s = await f.session();
  f.toolRound(action, { nome: 'Teste A' }); assert.equal((await f.publicRequest(s.token)).statusCode, 200);
  await f.grant(action, { id: one.grantId, revision: 1 }, { maxCallsPerConversation: 1 });
  assert.equal((await f.publicRequest(s.token, 'Outra')).statusCode, 200); assert.equal(f.requests.length, 1); assert.equal(JSON.parse(f.openAI.at(-1)!.input.at(-1).output).error, 'sheet_action_quota');
});
test('revocation during OAuth refresh stops append before the first mutating Google request', async t => {
  const f = await sheetsActionsFixture(t), action = await f.create('append'), grant = await f.grant(action), s = await f.session(); f.setTokens(1); f.toolRound(action, { nome: 'A', qtd: 0, ativo: false });
  f.hooks.provider = r => { assert.equal(r.url.hostname, 'oauth2.googleapis.com'); f.store.update(f.actor.tenantId, sheetGrants, grant.grantId, { status: 'revoked', revision: 2 }); return Response.json({ access_token: 'synthetic-sheet-token', token_type: 'Bearer', expires_in: 3600, scope: f.connection.scopes }); };
  assert.notEqual((await f.publicRequest(s.token)).statusCode, 200); assert.equal(f.requests.filter(r => r.url.hostname === 'sheets.googleapis.com').length, 0); assert.equal(f.store.list(f.actor.tenantId, sheetExecutions)[0].status, 'not_sent');
});

test('private chat and original chat receipt expose typed append references without cells or remote identifiers', async t => {
  const f = await sheetsActionsFixture(t), action = await f.create('append'); f.toolRound(action, { nome: 'PRIVATE_ROW', qtd: 0, ativo: false });
  const response = await f.askPrivate(); assert.equal(response.statusCode, 200, response.body);
  const row = f.store.list(f.actor.tenantId, sheetExecutions)[0], original = f.store.list(f.actor.tenantId, 'provider-operations').find(r => r.operation === 'openai.chat')!;
  const expected = { kind: 'append', operationRef: row.id, status: 'appended', rowsAppended: 1, requiresReconciliation: false, automaticRetry: false };
  assert.deepEqual(response.json().sheetOperations, [expected]); assert.deepEqual((original.result as any).sheetOperations, [expected]);
  const before = f.store.list(f.actor.tenantId, sheetExecutions), count = f.requests.length;
  const recovered = await f.request('GET', `/api/v1/ai/chat/operations/${original.key}`); assert.equal(recovered.statusCode, 200, recovered.body); assert.deepEqual(recovered.json().result.sheetOperations, [expected]);
  const detail = await f.request('GET', `/api/v1/oauth/sheets/action-executions/${row.id}`); assert.deepEqual(detail.json(), expected);
  assert.ok(!JSON.stringify(recovered.json().result.sheetOperations).includes('PRIVATE_ROW')); assert.ok(!JSON.stringify(recovered.json().result.sheetOperations).includes(String(f.binding.spreadsheetId)));
  assert.deepEqual(f.store.list(f.actor.tenantId, sheetExecutions), before); assert.equal(f.requests.length, count);
  f.aiHooks.openAI = () => Response.json({ id: 'response_other', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Outro turno.' }] }] });
  const other = await f.askPrivate(response.json().conversationId); assert.equal(other.statusCode, 200, other.body); assert.equal(Object.hasOwn(other.json(), 'sheetOperations'), false);
  assert.deepEqual((await f.request('GET', `/api/v1/ai/chat/operations/${original.key}`)).json().result.sheetOperations, [expected]);
});
test('private failed round2 recovers committed append from chat receipt without another provider call', async t => {
  const f = await sheetsActionsFixture(t), action = await f.create('append'); f.toolRound(action, { nome: 'A', qtd: 0, ativo: false });
  const normal = f.aiHooks.openAI!; f.aiHooks.openAI = body => body.input.some((p: any) => p.type === 'function_call_output') ? new Response('synthetic failure', { status: 503 }) : normal(body);
  assert.notEqual((await f.askPrivate()).statusCode, 200); const original = f.store.list(f.actor.tenantId, 'provider-operations').find(r => r.operation === 'openai.chat')!;
  const before = f.requests.length, aiBefore = f.openAI.length, recovered = await f.request('GET', `/api/v1/ai/chat/operations/${original.key}`);
  assert.equal(recovered.statusCode, 200, recovered.body); assert.notEqual(recovered.json().status, 'succeeded'); assert.equal(recovered.json().sheetOperations[0].status, 'appended'); assert.equal(f.requests.length, before); assert.equal(f.openAI.length, aiBefore);
});
test('private chat receipt never exposes old append reference to authority renewed after membership ABA', async t => {
  const f = await sheetsActionsFixture(t), action = await f.create('append'); f.toolRound(action, { nome: 'A', qtd: 0, ativo: false });
  const response = await f.askPrivate(); assert.equal(response.statusCode, 200);
  const operation = f.store.list(f.actor.tenantId, 'provider-operations').find(r => r.operation === 'openai.chat')!, reference = response.json().sheetOperations[0].operationRef;
  f.aba(); const recovered = await f.request('GET', `/api/v1/ai/chat/operations/${operation.key}`, undefined, undefined, f.headers());
  assert.equal(recovered.statusCode, 200, recovered.body); assert.equal(Object.hasOwn(recovered.json().result, 'sheetOperations'), false); assert.ok(!recovered.body.includes(reference));
  assert.equal((await f.request('GET', `/api/v1/oauth/sheets/action-executions/${reference}`, undefined, undefined, f.headers())).statusCode, 404);
});

test('private chat GET without Sheets effects preserves legacy shape while metadata-only GET returns an empty collection', async t => {
  const f = await sheetsActionsFixture(t), response = await f.askPrivate(); assert.equal(response.statusCode, 200, response.body);
  const operation = f.store.list(f.actor.tenantId, 'provider-operations').find(r => r.operation === 'openai.chat')!;
  const before = f.store.list(f.actor.tenantId, 'provider-operations'), requests = f.requests.length, modelCalls = f.openAI.length;
  const recovered = await f.request('GET', `/api/v1/ai/chat/operations/${operation.key}`);
  assert.equal(recovered.statusCode, 200, recovered.body);
  assert.equal(Object.hasOwn(response.json(), 'sheetOperations'), false);
  assert.deepEqual(recovered.json(), { status: 'succeeded', result: response.json() });
  const metadata = await f.request('GET', `/api/v1/oauth/sheets/chat-operations/${operation.key}`);
  assert.equal(metadata.statusCode, 200, metadata.body); assert.deepEqual(metadata.json(), { sheetOperations: [] });
  assert.equal(f.requests.length, requests); assert.equal(f.openAI.length, modelCalls); assert.deepEqual(f.store.list(f.actor.tenantId, 'provider-operations'), before);
});

test('capability catalog describes only the implemented assistant transports without claiming live validation', async t => {
  const f = await sheetsActionsFixture(t); const { integrationRuntimeMatrix } = await import('../src/integrations/capabilities.js');
  const item = integrationRuntimeMatrix(f.store, f.actor).items.find(row => row.name === 'Google Sheets')!;
  assert.ok(item.capabilities.includes('private_assistant_query')); assert.ok(item.capabilities.includes('private_assistant_append')); assert.ok(item.capabilities.includes('revocable_webchat_actions'));
  assert.match(item.limits.join(' '), /WhatsApp\/voz/); assert.match(item.limits.join(' '), /conta real ainda pendente/); assert.ok(!item.limits.join(' ').includes('sem execução por assistentes'));
  assert.equal(item.implementation, 'native_partial'); assert.equal(item.runtime.endToEndValidation, 'not_recorded_by_this_registry'); assert.equal(f.requests.length, 0);
});

test('lost chat response then paused agent recovers only original Sheets metadata by chat key without configuration or I/O', async t => {
  const f = await sheetsActionsFixture(t), action = await f.create('append'); f.toolRound(action, { nome: 'A', qtd: 0, ativo: false });
  // The caller retains only its original key; intentionally discard the POST body.
  const chatKey = randomUUID(); assert.equal((await f.request('POST', '/api/v1/ai/chat', { agentId: f.agent.id, message: 'Registrar.', idempotencyKey: chatKey })).statusCode, 200);
  f.store.update(f.actor.tenantId, 'agents', f.agent.id, { status: 'paused' }); f.store.remove(f.actor.tenantId, 'oauth-connections', f.connection.id); f.store.remove(f.actor.tenantId, 'sheets-assistant-actions', action.id);
  const count = f.requests.length, aiCount = f.openAI.length, before = f.store.list(f.actor.tenantId, sheetExecutions);
  assert.equal((await f.request('GET', `/api/v1/ai/chat/operations/${chatKey}`)).statusCode, 409);
  const response = await f.request('GET', `/api/v1/oauth/sheets/chat-operations/${chatKey}`); assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(Object.keys(response.json()), ['sheetOperations']); assert.equal(response.json().sheetOperations[0].status, 'appended'); assert.equal(response.json().sheetOperations[0].operationRef, before[0].id);
  assert.ok(!response.body.includes('Resultado confirmado.')); assert.ok(!response.body.includes(String(f.binding.spreadsheetId))); assert.equal(f.requests.length, count); assert.equal(f.openAI.length, aiCount); assert.deepEqual(f.store.list(f.actor.tenantId, sheetExecutions), before);
  const chat = f.store.list(f.actor.tenantId, 'provider-operations').find(r => r.key === chatKey)!;
  f.store.update(f.actor.tenantId, 'provider-operations', chat.id, { sheetAuthority: null }); assert.equal((await f.request('GET', `/api/v1/oauth/sheets/chat-operations/${chatKey}`)).statusCode, 404);
  f.store.update(f.actor.tenantId, 'provider-operations', chat.id, { sheetAuthority: chat.sheetAuthority }); f.aba();
  assert.equal((await f.request('GET', `/api/v1/oauth/sheets/chat-operations/${chatKey}`, undefined, undefined, f.headers())).statusCode, 404); assert.equal(f.requests.length, count);
});
