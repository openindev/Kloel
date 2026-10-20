import assert from 'node:assert/strict'
import test from 'node:test'
import { sheetsFixture, appendInput } from './engine-sheets-fixture'
import { sheetQueryInput, sheetQueryBody, parseSheetQueryResult, type SheetQueryInput } from '../src/services/engine/sheets-query'
import { queryFromDraft } from '../src/services/engine/sheets-query-draft'

const input = (): SheetQueryInput => ({ sheetTitle: appendInput.sheetTitle, scanRange: 'A1:C5', headers: true, filters: [], variables: [], maxRows: 50 })
const rows = [['Nome', 'Quantidade', 'Ativo'], ['Teste A', '7', 'true'], ['Teste B', '0', 'false'], ['<img src=x onerror=alert(1)>', '10', 'TRUE']]
async function fixture(t: any) { const f = await sheetsFixture(t); f.hooks.provider = r => r.url.pathname.includes('/values/') ? Response.json({ range: "'Client''s Data'!A1:C5", values: rows }) : undefined; const binding = await f.client.get(f.connection.id, f.binding.id); return { ...f, binding } }

test('query uses real readonly route, formatted strings, exact variables and no receipt/write/verification mutation', async t => {
  const f = await fixture(t), before = f.store.get(f.actor.tenantId, 'oauth-sheets-bindings', f.binding.id)
  const q = queryFromDraft(input().sheetTitle, 'a1:c5', { headers: true, maxRows: '50', variables: [{ name: 'zero', type: 'number', value: '0' }, { name: 'no', type: 'boolean', value: 'false' }], filters: [{ column: 'Quantidade', op: 'eq', value: { kind: 'variable', name: 'zero' } }, { column: 'Ativo', op: 'eq', value: { kind: 'variable', name: 'no' } }] })
  const result = await f.client.query(f.binding, q)
  assert.deepEqual(result.rows, [{ rowNumber: 3, cells: rows[2] }]); assert.equal(result.coverage.examinedRows, 4)
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].method, 'GET'); assert.equal(f.calls[0].url.searchParams.get('valueRenderOption'), 'FORMATTED_VALUE')
  const request = f.requests.find(r => r.path.endsWith('/query'))!; assert.equal(request.body.expectedRevision, 1); assert.equal(request.body.expectedTenantId, f.actor.tenantId); assert.equal(new Headers(request.headers).has('Idempotency-Key'), false); assert.equal(new Headers(request.headers).get('X-Kloel-Expected-Authority'), f.identity.context.authorityVersion)
  assert.deepEqual(f.store.get(f.actor.tenantId, 'oauth-sheets-bindings', f.binding.id), before); assert.equal(f.store.list(f.actor.tenantId, 'oauth-sheets-http-operations').length, 0)
})

test('query parses bounded partial results and literal markup while server alone evaluates AND/in/regex/textual gt', async t => {
  const f = await fixture(t)
  const result = await f.client.query(f.binding, { ...input(), filters: [{ column: 'Quantidade', op: 'gt', value: { kind: 'literal', value: '1' } }, { column: 'Nome', op: 'in', values: [{ kind: 'literal', value: rows[1][0] }, { kind: 'literal', value: rows[3][0] }] }, { column: 'Ativo', op: 'regex', pattern: '^true$', flags: 'i' }], maxRows: 1 })
  assert.equal(result.coverage.matchedRows, 2); assert.deepEqual(result.truncationReasons, ['max_rows']); assert.deepEqual(result.rows[0].cells, rows[1])
  const markup = await f.client.query(f.binding, { ...input(), filters: [{ column: 'Nome', op: 'eq', value: { kind: 'literal', value: rows[3][0] } }] }); assert.equal(markup.rows[0].cells[0], rows[3][0])
})

test('invalid requests reject before transport, preserve false/zero/empty and never interpolate patterns', async t => {
  const f = await fixture(t)
  const bad: any[] = [ { ...input(), extra: true }, { ...input(), scanRange: 'A1' }, { ...input(), scanRange: 'A1:AX401' }, { ...input(), scanRange: 'A2:C5' }, { ...input(), headers: false, filters: [{ column: 'Nome', op: 'eq', value: { kind: 'literal', value: '' } }] }, { ...input(), variables: [{ name: 'unused', type: 'text', value: '' }] }, { ...input(), filters: [{ column: 'Nome', op: 'eq', value: { kind: 'variable', name: 'absent' } }] }, { ...input(), filters: [{ column: 'Nome', op: 'regex', pattern: { kind: 'variable', name: 'x' }, flags: '' }] }, { ...input(), maxRows: 0 } ]
  for (const q of bad) await assert.rejects(f.client.query(f.binding, q))
  assert.equal(f.calls.length, 0); assert.equal(f.requests.filter(r => r.path.endsWith('/query')).length, 0)
  assert.equal(sheetQueryInput({ ...input(), filters: [{ column: 'Nome', op: 'eq', value: { kind: 'literal', value: '{{name}}' } }] }).filters[0].op, 'eq')
  assert.throws(() => queryFromDraft('Aba', 'A1:B2', { headers: true, filters: [], variables: [{ name: 'x', type: 'number', value: '' }], maxRows: '50' }))
  assert.throws(() => sheetQueryBody({ ...input(), filters: Array.from({ length: 12 }, () => ({ column: 'Nome', op: 'in', values: Array.from({ length: 50 }, () => ({ kind: 'literal', value: 'é'.repeat(2000) })) })) } as any, f.actor.tenantId, 1))
})

test('parser refuses wrong binding/shape/header/count/budget/truncation rather than exposing foreign or malformed rows', async t => {
  const f = await fixture(t), q = input(), good = await f.client.query(f.binding, q)
  const patches = [{ connectionId: 'another' }, { bindingRevision: 2 }, { expectedTenantId: f.actor.tenantId }, { scanRange: 'A1:D5' }, { coverage: { ...good.coverage, wholeSheet: 'complete' } }, { coverage: { ...good.coverage, matchedRows: 0 } }, { resultBytes: good.resultBytes + 1 }, { truncationReasons: ['max_rows'] }, { queriedAt: 'not a date' }, { columns: [{ ...good.columns[0], header: '' }, ...good.columns.slice(1)] }, { rows: [{ rowNumber: 2, cells: ['x', 0, false] }] }, { rows: [good.rows[1], good.rows[0]] }]
  for (const patch of patches) assert.throws(() => parseSheetQueryResult({ ...good, ...patch }, f.binding, q), String(Object.keys(patch)))
})

test('late revision/OAuth authority or user context denies cells and does not retry readonly POST', async t => {
  const f = await fixture(t)
  f.state.after = async (path, _method, response) => { if (path.endsWith('/query')) f.store.update(f.actor.tenantId, 'oauth-sheets-bindings', f.binding.id, { revision: 2 }); return response }
  await assert.rejects(f.client.query(f.binding, input()), (e: any) => e.code === 'spreadsheet_configuration_changed'); assert.equal(f.calls.length, 1)
  f.state.after = undefined; const b = await f.client.get(f.connection.id, f.binding.id)
  f.state.after = async (path, _method, response) => { if (path.endsWith('/query')) f.store.update(f.actor.tenantId, 'oauth-connections', f.connection.id, { authorizationGeneration: 2 }); return response }
  await assert.rejects(f.client.query(b, input()), (e: any) => e.code === 'oauth_connection_changed'); assert.equal(f.calls.length, 2)
  f.state.after = async (path, _method, response) => { if (path.endsWith('/query')) f.state.current = false; return response }
  await assert.rejects(f.client.query(b, input()), (e: any) => e.code === 'superseded'); assert.equal(f.calls.length, 3)
})

test('server refusal is not an empty result and original input snapshot survives caller mutation', async t => {
  const f = await fixture(t), q = input(), callerBinding = { ...f.binding }
  f.state.before = async path => { if (path.endsWith('/query')) { q.scanRange = 'B1:C5'; q.headers = false; callerBinding.revision = 3 }; return undefined }
  assert.equal((await f.client.query(callerBinding, q)).scanRange, 'A1:C5')
  f.state.before = undefined; f.hooks.provider = () => Response.json({ range: "'Client''s Data'!A1:C5", values: [['Nome', 'Nome', 'Ativo']] })
  await assert.rejects(f.client.query(f.binding, input()), (e: any) => e.code === 'sheet_query_headers_invalid' && e.status === 422)
})

test('query forwards abort through preflight, POST and subsequent verification and hides results on aborted operation', async t => {
  const f = await fixture(t), abort = new AbortController(); abort.abort()
  await assert.rejects(f.client.query(f.binding, input(), abort.signal)); assert.equal(f.calls.length, 0)
  const running = new AbortController()
  f.state.after = async (path, _method, response) => { if (path.endsWith('/query')) running.abort(); return response }
  await assert.rejects(f.client.query(f.binding, input(), running.signal)); assert.equal(f.calls.length, 1)
  assert.equal(f.requests.at(-1)!.path.endsWith('/query'), true)
})

test('UTF8 byte-limited results preserve complete row prefix and flags; headers false reports absolute column and row numbers', async t => {
  const f = await fixture(t)
  f.hooks.provider = () => Response.json({ range: "'Client''s Data'!A1:C5", values: [rows[0], ['é'.repeat(30000), '', ''], ['界'.repeat(20000), '', ''], ['small', '', '']] })
  const limited = await f.client.query(f.binding, input()); assert.deepEqual(limited.truncationReasons, ['result_bytes']); assert.equal(limited.rows.length, 1); assert.equal(limited.rows[0].cells[0].length, 30000); assert.equal(limited.coverage.matchedRows, 3)
  f.hooks.provider = () => Response.json({ range: "'Client''s Data'!B8:C9", values: [['__proto__', 'constructor']] })
  const offset = await f.client.query(f.binding, { ...input(), headers: false, scanRange: 'B8:C9' }); assert.deepEqual(offset.columns, [{ index: 2, a1: 'B', header: null }, { index: 3, a1: 'C', header: null }]); assert.equal(offset.rows[0].rowNumber, 8); assert.equal(offset.coverage.examinedRows, 2)
})
