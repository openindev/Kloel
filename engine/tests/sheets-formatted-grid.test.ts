import test from 'node:test';
import assert from 'node:assert/strict';
import { sheetsFixture, spreadsheetId } from './fixtures/sheets-http.js';
import { sheetsActionsFixture } from './fixtures/sheets-actions.js';
import { readFormattedSheetRectangle } from '../src/oauth/sheets.js';
import { evaluateSheetQuery, prepareSheetQuery } from '../src/oauth/sheets-query.js';

type Fixture = Awaited<ReturnType<typeof sheetsFixture>>;
const title = 'Dados';
const input = (f: Fixture, patch: Record<string, unknown> = {}) => ({ expectedTenantId: f.actor.tenantId, expectedRevision: 1, sheetTitle: title, scanRange: 'A1:C20', headers: true, filters: [], variables: [], ...patch });
const query = (f: Fixture, patch: Record<string, unknown> = {}) => f.request('POST', `${f.prefix}/${f.binding.id}/query`, input(f, patch));
const metadata = (sheetTitle = title, rowCount = 4, columnCount = 3) => ({ spreadsheetId, sheets: [{ properties: { sheetId: 0, title: sheetTitle, sheetType: 'GRID', gridProperties: { rowCount, columnCount } } }] });
const cells = [['Nome', 'Quantidade', 'Ativo'], ['Teste A', '7', 'TRUE'], ['Teste B', '0', 'FALSE'], ['Teste C', '12', 'TRUE']];
const values = { range: 'Dados!A1:C4', majorDimension: 'ROWS', values: cells };

test('formatted query accepts a response clipped exactly to the authenticated sheet grid', async t => {
  const f = await sheetsFixture(t), before = f.store.db.prepare('SELECT * FROM entities ORDER BY id').all();
  f.hooks.provider = r => r.url.pathname.includes('/values/')
    ? Response.json({ range: 'Dados!A1:C4', majorDimension: 'ROWS', values: [['Nome', 'Quantidade', 'Ativo'], ['Teste A', '7', 'TRUE'], ['Teste B', '0', 'FALSE'], ['Teste C', '12', 'TRUE']] })
    : Response.json({ spreadsheetId, sheets: [{ properties: { sheetId: 0, title: 'Dados', sheetType: 'GRID', gridProperties: { rowCount: 4, columnCount: 3 } } }] });
  const result = await f.request('POST', `${f.prefix}/${f.binding.id}/query`, {
    expectedTenantId: f.actor.tenantId, expectedRevision: 1, sheetTitle: 'Dados', scanRange: 'A1:C20', headers: true, filters: [], variables: [],
  });
  assert.equal(result.statusCode, 200, result.body);
  assert.deepEqual(result.json().rows, [{ rowNumber: 2, cells: ['Teste A', '7', 'TRUE'] }, { rowNumber: 3, cells: ['Teste B', '0', 'FALSE'] }, { rowNumber: 4, cells: ['Teste C', '12', 'TRUE'] }]);
  assert.equal(result.json().coverage.wholeSheet, 'unknown');
  assert.equal(f.requests.length, 2); assert.ok(f.requests.every(r => r.method === 'GET'));
  assert.equal(f.requests[1].headers.get('authorization'), f.requests[0].headers.get('authorization'));
  assert.deepEqual(f.store.db.prepare('SELECT * FROM entities ORDER BY id').all(), before);
});

test('original provider range and metadata evidence stay separate and are not persisted', async t => {
  const f = await sheetsFixture(t), before = f.store.db.prepare('SELECT * FROM entities ORDER BY id').all();
  f.hooks.provider = r => Response.json(r.url.pathname.includes('/values/') ? values : metadata());
  const read = await readFormattedSheetRectangle(f.store, f.actor, f.connection.id, f.binding.id, { sheetTitle: title, range: 'A1:C20' }, () => {}, 1);
  assert.deepEqual(read.response, values);
  assert.deepEqual(read.gridEvidence, { requestedRange: "'Dados'!A1:C20", providerRange: 'Dados!A1:C4', sheetId: 0, rowCount: 4, columnCount: 3 });
  assert.equal(f.requests[1].url.searchParams.get('ranges'), "'Dados'");
  assert.equal(f.requests[1].url.searchParams.get('fields'), 'spreadsheetId,sheets(properties(sheetId,title,sheetType,gridProperties(rowCount,columnCount)))');
  assert.ok(!f.requests[1].url.searchParams.get('fields')!.includes('data('));
  assert.deepEqual(f.store.db.prepare('SELECT * FROM entities ORDER BY id').all(), before);
});

test('pure evaluator cannot accept clipped output without separate exact metadata evidence', async t => {
  const f = await sheetsFixture(t), prepared = prepareSheetQuery(input(f));
  assert.throws(() => evaluateSheetQuery(prepared, values), { code: 'provider_response_invalid' });
  assert.throws(() => evaluateSheetQuery(prepared, { ...values, gridEvidence: { rowCount: 4, columnCount: 3 } }), { code: 'provider_response_invalid' });
  const proof = { requestedRange: "'Dados'!A1:C20", providerRange: 'Dados!A1:C4', sheetId: 0, rowCount: 4, columnCount: 3 };
  assert.equal(evaluateSheetQuery(prepared, values, proof).rows.length, 3);
  assert.throws(() => evaluateSheetQuery(prepared, { ...values, values: [...cells, ['extra']] }, proof), { code: 'provider_response_invalid' });
  assert.throws(() => evaluateSheetQuery(prepared, values, { ...proof, requestedRange: "'Dados'!A1:C21" }), { code: 'provider_response_invalid' });
});

test('column and row clipping preserve absolute coordinates and no invented records', async t => {
  const f = await sheetsFixture(t);
  f.hooks.provider = r => Response.json(r.url.pathname.includes('/values/') ? { range: 'Dados!B2:C4', values: [['left', 'right'], [], ['last']] } : metadata());
  const result = await query(f, { scanRange: 'B2:D20', headers: false });
  assert.equal(result.statusCode, 200, result.body);
  assert.deepEqual(result.json().rows, [{ rowNumber: 2, cells: ['left', 'right', ''] }, { rowNumber: 4, cells: ['last', '', ''] }]);
  assert.deepEqual(result.json().columns.map((c: any) => c.a1), ['B', 'C', 'D']);
  assert.equal(result.json().coverage.examinedRows, 19); assert.equal(result.json().coverage.nonEmptyRows, 2);
  assert.equal(result.json().coverage.wholeSheet, 'unknown'); assert.equal(f.requests.length, 2);
});

test('column clipping does not create valid headers for nonexistent columns', async t => {
  const f = await sheetsFixture(t);
  f.hooks.provider = r => Response.json(r.url.pathname.includes('/values/') ? { range: 'Dados!A1:B4', values: [['A', 'B'], ['x', 'y']] } : metadata(title, 4, 2));
  const result = await query(f); assert.equal(result.statusCode, 422); assert.equal(result.json().error.code, 'sheet_query_headers_invalid');
});

for (const [label, response] of [
  ['different sheet', { ...values, range: 'Other!A1:C4' }],
  ['shifted row', { ...values, range: 'Dados!A2:C5' }],
  ['shifted column', { ...values, range: 'Dados!B1:D4' }],
  ['expanded range', { ...values, range: 'Dados!A1:C21' }],
  ['reversed range', { ...values, range: 'Dados!C4:A1' }],
  ['wrong dimension', { ...values, majorDimension: 'COLUMNS' }],
  ['non-string cell', { ...values, values: [['x', 7]] }],
  ['row beyond provider rectangle', { ...values, values: [...cells, ['extra']] }],
  ['column beyond provider rectangle', { ...values, range: 'Dados!A1:B4' }],
] as const) test(`rejects ${label} before metadata lookup`, async t => {
  const f = await sheetsFixture(t); f.hooks.provider = () => Response.json(response);
  const result = await query(f); assert.equal(result.statusCode, 502); assert.equal(result.json().error.code, 'provider_response_invalid');
  assert.equal(f.requests.length, 1);
});

for (const [label, grid] of [
  ['wrong spreadsheet', { ...metadata(), spreadsheetId: 'different_spreadsheet' }],
  ['wrong title', metadata('Other')],
  ['ambiguous sheets', { ...metadata(), sheets: [...metadata().sheets, ...metadata().sheets] }],
  ['missing dimensions', { spreadsheetId, sheets: [{ properties: { sheetId: 0, title } }] }],
  ['non-grid sheet', { spreadsheetId, sheets: [{ properties: { ...metadata().sheets[0].properties, sheetType: 'OBJECT' } }] }],
  ['grid grew after values', metadata(title, 5)],
  ['grid shrank after values', metadata(title, 3)],
  ['column contradicts values', metadata(title, 4, 2)],
  ['unsafe dimension', metadata(title, Number.MAX_SAFE_INTEGER + 1)],
] as const) test(`rejects metadata ${label} without pretending coverage`, async t => {
  const f = await sheetsFixture(t); f.hooks.provider = r => Response.json(r.url.pathname.includes('/values/') ? values : grid);
  const result = await query(f); assert.equal(result.statusCode, 502); assert.equal(result.json().error.code, 'provider_response_invalid'); assert.equal(f.requests.length, 2);
});

test('same scope-checked token is reused even when encrypted token expires before metadata', async t => {
  const f = await sheetsFixture(t);
  f.hooks.provider = r => { if (r.url.pathname.includes('/values/')) { f.setTokens(1); return Response.json(values); } return Response.json(metadata()); };
  assert.equal((await query(f)).statusCode, 200);
  assert.equal(f.requests.length, 2); assert.ok(f.requests.every(r => r.url.hostname === 'sheets.googleapis.com' && r.method === 'GET'));
  assert.equal(f.requests[0].headers.get('authorization'), f.requests[1].headers.get('authorization'));
});

for (const when of ['values', 'metadata'] as const) test(`membership ABA during ${when} denies result and avoids additional requests`, async t => {
  const f = await sheetsFixture(t);
  f.hooks.provider = r => { const valueRead = r.url.pathname.includes('/values/'); if (valueRead === (when === 'values')) f.aba(); return Response.json(valueRead ? values : metadata()); };
  const result = await query(f); assert.notEqual(result.statusCode, 200); assert.ok(!result.body.includes('Teste A'));
  assert.equal(f.requests.length, when === 'values' ? 1 : 2);
});

test('binding revision changed during metadata denies cells without verification writes', async t => {
  const f = await sheetsFixture(t);
  f.hooks.provider = r => { if (r.url.pathname.includes('/values/')) return Response.json(values); f.store.update(f.actor.tenantId, 'oauth-sheets-bindings', f.binding.id, { revision: 2 }); return Response.json(metadata()); };
  const result = await query(f); assert.equal(result.statusCode, 409); assert.ok(!result.body.includes('Teste A'));
  assert.equal(f.store.get(f.actor.tenantId, 'oauth-sheets-bindings', f.binding.id)!.lastVerifiedAt, undefined);
});

for (const mode of ['private', 'public'] as const) test(`${mode} action executes clipped query through projection and OpenAI round two`, async t => {
  const f = await sheetsActionsFixture(t), action = await f.create(); f.toolRound(action, { nome: 'Teste A' });
  f.hooks.provider = r => Response.json(r.url.pathname.includes('/values/') ? { range: "'Client''s Data'!A1:C4", values: [['Nome', 'Qtd', 'Interno'], ['Teste A', '7', 'SECRET']] } : metadata(f.queryConfig.sheetTitle));
  if (mode === 'public') await f.grant(action);
  const result = mode === 'public' ? await f.publicRequest((await f.session()).token) : await f.askPrivate();
  assert.equal(result.statusCode, 200, result.body); assert.equal(f.openAI.length, 2);
  const output = JSON.parse(f.openAI[1].input.at(-1).output); assert.equal(output.ok, true); assert.deepEqual(output.rows[0].cells, ['Teste A', '7']);
  assert.ok(!JSON.stringify(f.openAI).includes('SECRET')); assert.equal(f.requests.length, 2); assert.ok(f.requests.every(r => r.method === 'GET'));
});

test('channel ABA during metadata revokes public grant before cells reach round two', async t => {
  const f = await sheetsActionsFixture(t), action = await f.create(); await f.grant(action); const session = await f.session(); f.toolRound(action, { nome: 'Teste A' });
  f.hooks.provider = r => {
    if (r.url.pathname.includes('/values/')) return Response.json({ range: "'Client''s Data'!A1:C4", values: [['Nome', 'Qtd', 'Interno'], ['Teste A', '7', 'SECRET']] });
    f.store.update(f.actor.tenantId, 'channels', f.channel.id, { name: 'B' }); f.store.update(f.actor.tenantId, 'channels', f.channel.id, { name: f.channel.name });
    return Response.json(metadata(f.queryConfig.sheetTitle));
  };
  const result = await f.publicRequest(session.token); assert.notEqual(result.statusCode, 200); assert.equal(f.openAI.length, 1);
  assert.ok(!result.body.includes('Teste A')); assert.equal(f.store.list(f.actor.tenantId, 'messages').filter(m => m.role === 'assistant').length, 0);
});
