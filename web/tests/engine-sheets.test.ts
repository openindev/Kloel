import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { sheetsFixture, appendInput, spreadsheetId } from './engine-sheets-fixture'
import { createSheetsService, sheetAttempt, sheetAppend, sheetRange, parseSheetOperation, parseSheetBinding, parseSheetTabs, parseSheetValues } from '../src/services/engine/sheets'
import { EngineError } from '../src/services/engine/http'

test('Sheets config CAS: create disabled, immutable identity, explicit enable/update and local inspection offline', async t => {
  const f = await sheetsFixture(t), accounts = await f.client.accounts(); assert.equal(accounts.length, 1)
  const a = sheetAttempt('binding.create', f.connection.id), configuration = { spreadsheetId: 'synthetic_second_1234567890', name: '  Segunda  ', allowAppend: false, enabled: false }
  const made = await f.client.configure(a, configuration); assert.equal(made.status, 'succeeded'); assert.equal(made.revision, 1)
  let b = await f.client.get(f.connection.id, made.bindingId); assert.equal(b.name, 'Segunda'); assert.equal(b.enabled, false)
  assert.deepEqual(await f.client.configure(a, configuration), made)
  await f.client.setEnabled(sheetAttempt('binding.set_enabled', f.connection.id, b, true)); b = await f.client.get(f.connection.id, b.id); assert.equal(b.revision, 2)
  await f.client.configure(sheetAttempt('binding.update', f.connection.id, b), { ...configuration, name: 'Editada' }); const current = await f.client.get(f.connection.id, b.id); assert.equal(current.revision, 3)
  await assert.rejects(f.client.configure(sheetAttempt('binding.update', f.connection.id, b), configuration), (e: any) => e.status === 409 && e.code === 'spreadsheet_configuration_changed')
  f.store.update(f.actor.tenantId, 'oauth-connections', f.connection.id, { status: 'disconnected', encryptedTokens: null })
  await f.client.setEnabled(sheetAttempt('binding.set_enabled', f.connection.id, current, false)); assert.equal((await f.client.accounts())[0].status, 'disconnected')
  assert.equal((await f.client.list(f.connection.id)).length, 2); assert.deepEqual(await f.client.operation(a), made); assert.equal(f.calls.length, 0)
})

test('Sheets reads capture revision, return untrusted typed text and never execute markup', async t => {
  const f = await sheetsFixture(t), b = await f.client.get(f.connection.id, f.binding.id)
  const tabs = await f.client.tabs(b); assert.equal(tabs[0].sheetId, 0); assert.equal(tabs[0].title, appendInput.sheetTitle)
  const values = await f.client.values(b, { sheetTitle: appendInput.sheetTitle, range: 'a1:c20' }); assert.match(String(values.values[0][0]), /<img/)
  assert.equal((await f.client.get(b.connectionId, b.id)).status, 'read_verified'); assert.ok(f.requests.filter(r => /\/(tabs|values)\?/.test(r.path)).every(r => r.path.includes('expectedRevision=1')))
  assert.equal(f.calls.filter(r => r.method === 'POST').length, 0)
})

test('Sheets stale provider read and late HTTP response are discarded, original revision never adopted', async t => {
  const f = await sheetsFixture(t), b = await f.client.get(f.connection.id, f.binding.id)
  f.hooks.provider = () => { f.store.update(f.actor.tenantId, 'oauth-sheets-bindings', b.id, { revision: 2 }); return undefined }
  await assert.rejects(f.client.tabs(b), (e: any) => e.code === 'spreadsheet_configuration_changed')
  assert.equal(f.store.get(f.actor.tenantId, 'oauth-sheets-bindings', b.id)!.lastVerifiedRevision, undefined)
  f.hooks.provider = undefined; const current = await f.client.get(b.connectionId, b.id)
  f.state.after = async (path, _method, response) => { if (path.includes('/values?')) f.store.update(f.actor.tenantId, 'oauth-sheets-bindings', b.id, { revision: 3 }); return response }
  await assert.rejects(f.client.values(current, { sheetTitle: appendInput.sheetTitle, range: 'A1:C20' }), (e: any) => e.code === 'spreadsheet_configuration_changed')
  assert.equal(current.revision, 2)
})

test('Sheets append RAW, exact result metadata, durable GET after lost response and disable', async t => {
  const f = await sheetsFixture(t), b = await f.client.get(f.connection.id, f.binding.id), attempt = sheetAttempt('rows.append', b.connectionId, b)
  f.state.after = async (path, method, response) => { if (method === 'POST' && path.endsWith('/append')) throw Error('lost HTTP response'); return response }
  await assert.rejects(f.client.append(attempt, appendInput)); f.state.after = undefined
  const post = f.calls.find(c => c.method === 'POST')!; assert.equal(post.url.searchParams.get('valueInputOption'), 'RAW'); assert.equal(post.url.searchParams.get('insertDataOption'), 'INSERT_ROWS'); assert.equal(post.url.searchParams.get('includeValuesInResponse'), 'false'); assert.deepEqual(post.body.values, appendInput.rows)
  const result = await f.client.operation(attempt); assert.equal(result.status, 'appended'); assert.equal(result.result?.valueInputOption, 'RAW'); assert.ok(!JSON.stringify(result).includes('SUM'))
  await f.client.setEnabled(sheetAttempt('binding.set_enabled', b.connectionId, b, false)); f.store.update(f.actor.tenantId, 'oauth-connections', f.connection.id, { status: 'disconnected', encryptedTokens: null })
  const reloaded = createSheetsService(f.context, f.actor.userId); assert.deepEqual(await reloaded.operation(attempt), result); assert.equal(f.calls.filter(c => c.method === 'POST').length, 1)
})

test('Sheets uncertain append is not resent; configuration has independent operation', async t => {
  const f = await sheetsFixture(t), b = await f.client.get(f.connection.id, f.binding.id), attempt = sheetAttempt('rows.append', b.connectionId, b)
  f.hooks.provider = r => { if (r.method === 'POST') throw Error('network outcome unknown') }
  await assert.rejects(f.client.append(attempt, appendInput)); const op = await f.client.operation(attempt); assert.equal(op.status, 'uncertain'); assert.equal(op.requiresReconciliation, true)
  assert.equal((await f.client.append(attempt, appendInput)).status, 'uncertain')
  await f.client.setEnabled(sheetAttempt('binding.set_enabled', b.connectionId, b, false)); assert.equal((await f.client.get(b.connectionId, b.id)).enabled, false)
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 1)
})

test('Sheets 404 is inconclusive and GET does not reserve a receipt or transport', async t => {
  const f = await sheetsFixture(t), b = await f.client.get(f.connection.id, f.binding.id), attempt = sheetAttempt('rows.append', b.connectionId, b)
  await assert.rejects(f.client.operation(attempt), (e: any) => e.code === 'sheets_operation_not_found')
  assert.equal(f.store.list(f.actor.tenantId, 'oauth-sheets-http-operations').length, 0); assert.equal(f.calls.length, 0)
})

test('Sheets exclusive admission refusal differs from configuration conflict after accepted POST', async t => {
  const f = await sheetsFixture(t), b = await f.client.get(f.connection.id, f.binding.id), stale = sheetAttempt('rows.append', b.connectionId, b)
  f.store.update(f.actor.tenantId, 'oauth-sheets-bindings', b.id, { revision: 2 })
  await assert.rejects(f.client.append(stale, appendInput), (e: any) => e.code === 'sheets_admission_revision_conflict')
  assert.equal(f.calls.length, 0); assert.equal(f.store.list(f.actor.tenantId, 'oauth-sheets-http-operations').length, 0)
  const fresh = await f.client.get(b.connectionId, b.id), attempt = sheetAttempt('rows.append', b.connectionId, fresh)
  f.hooks.provider = r => { if (r.method === 'POST') f.store.update(f.actor.tenantId, 'oauth-sheets-bindings', b.id, { revision: 3 }) }
  await assert.rejects(f.client.append(attempt, appendInput), (e: any) => e.code === 'oauth_connection_changed')
  assert.equal((await f.client.operation(attempt)).status, 'appended'); assert.equal(f.calls.filter(c => c.method === 'POST').length, 1)
})

test('Sheets original context guards ABA and foreign cookie before dispatch', async t => {
  const f = await sheetsFixture(t), b = await f.client.get(f.connection.id, f.binding.id), attempt = sheetAttempt('rows.append', b.connectionId, b)
  f.aba(); await assert.rejects(f.client.append(attempt, appendInput), (e: any) => e.code === 'context_mismatch'); assert.equal(f.calls.length, 0)
  f.state.cookie = randomUUID(); await assert.rejects(f.client.list(f.connection.id)); assert.equal(f.calls.length, 0)
})

test('Sheets append preparation not_sent remains an explicit terminal receipt', async t => {
  const f = await sheetsFixture(t), b = await f.client.get(f.connection.id, f.binding.id), attempt = sheetAttempt('rows.append', b.connectionId, b); f.setTokens(0)
  f.hooks.provider = r => { if (r.url.hostname === 'oauth2.googleapis.com') return Response.json({ error: 'invalid_grant' }, { status: 400 }) }
  await assert.rejects(f.client.append(attempt, appendInput)); const result = await f.client.operation(attempt); assert.equal(result.status, 'not_sent'); assert.equal(result.requiresReconciliation, false); assert.equal(f.calls.filter(c => c.method === 'POST' && c.url.hostname === 'sheets.googleapis.com').length, 0)
})

test('Sheets parsers reject mismatched identity/revision/status/results and invalid reads', async t => {
  const f = await sheetsFixture(t), b = await f.client.get(f.connection.id, f.binding.id), attempt = sheetAttempt('rows.append', b.connectionId, b), op = await f.client.append(attempt, appendInput)
  for (const patch of [{ key: randomUUID() }, { connectionId: randomUUID() }, { bindingId: randomUUID() }, { revision: 2 }, { kind: 'binding.update' }, { requiresReconciliation: true }, { result: { ...op.result, valueInputOption: 'USER_ENTERED' } }, { result: { ...op.result, updatedCells: 4 } }, { result: { ...op.result, values: [['private']] } }]) assert.throws(() => parseSheetOperation({ ...op, ...patch }, attempt))
  assert.throws(() => parseSheetBinding({ ...b, connectionId: randomUUID() }, b.connectionId)); assert.throws(() => parseSheetBinding({ ...b, status: 'read_verified' }))
  assert.throws(() => parseSheetTabs({ bindingId: b.id, bindingRevision: 2, spreadsheetId, source: 'google_sheets', providerVerified: true, title: 'Sheet', items: [] }, b))
  assert.throws(() => parseSheetValues({ bindingId: b.id, bindingRevision: b.revision, spreadsheetId, source: 'google_sheets', providerVerified: true, requestedRange: 'wrong', dataSource: 'untrusted_spreadsheet_content', majorDimension: 'ROWS', range: 'A1', values: [] }, b, { sheetTitle: 'Aba', range: 'A1' }))
})

test('Sheets client limits match RAW boundaries and reject unknown/formula object cells without I/O', async t => {
  const f = await sheetsFixture(t), b = await f.client.get(f.connection.id, f.binding.id), attempt = sheetAttempt('rows.append', b.connectionId, b)
  assert.equal(sheetRange({ sheetTitle: 'Aba', range: 'a1:ax400' }).columns, 50)
  for (const range of ['A1:AY1', 'A1:A1001', 'A1:AX401', 'B2:A1', 'A0', 'A:A']) assert.throws(() => sheetRange({ sheetTitle: 'Aba', range }))
  for (const rows of [[], [[null]], [[{}]], [[Infinity]], Array.from({ length: 101 }, () => [1]), [['x'.repeat(50001)]], [Array(51).fill(1)], Array.from({ length: 6 }, () => ['x'.repeat(50000)])]) await assert.rejects(f.client.append(attempt, { ...appendInput, rows } as any))
  assert.deepEqual(sheetAppend(appendInput).rows, appendInput.rows); assert.equal(f.calls.length, 0); assert.equal(f.requests.filter(r => r.method === 'POST').length, 0)
})

test('Sheets late context change suppresses cells and malformed operation never becomes success', async t => {
  const f = await sheetsFixture(t), b = await f.client.get(f.connection.id, f.binding.id)
  f.state.after = async (path, _method, response) => { if (path.includes('/tabs?')) f.state.current = false; return response }
  await assert.rejects(f.client.tabs(b), (e: any) => e.code === 'superseded')
  assert.ok(f.calls.length > 0); f.state.current = true
  const attempt = sheetAttempt('rows.append', b.connectionId, b)
  f.state.after = async (path, _method, response) => { if (path.endsWith('/append')) { const body = await response.json(); body.operation.bindingId = randomUUID(); return Response.json(body) } return response }
  await assert.rejects(f.client.append(attempt, appendInput), (e: any) => e instanceof EngineError && e.status === 0)
})

for (const change of ['disconnect', 'reauthorize'] as const) test(`Sheets discards delivered cells after account ${change} even when binding revision is unchanged`, async t => {
  const f = await sheetsFixture(t), b = await f.client.get(f.connection.id, f.binding.id)
  f.state.after = async (path, _method, response) => {
    if (path.includes('/values?')) f.store.update(f.actor.tenantId, 'oauth-connections', f.connection.id, change === 'disconnect' ? { status: 'disconnected' } : { authorizationGeneration: 2 })
    return response
  }
  await assert.rejects(f.client.values(b, { sheetTitle: appendInput.sheetTitle, range: 'A1:C20' }), (e: any) => e.code === 'oauth_connection_changed')
  assert.equal(f.store.get(f.actor.tenantId, 'oauth-sheets-bindings', b.id)!.revision, 1)
  assert.equal(f.calls.length, 1)
})

test('Sheets pending append from parallel GET/replay never repeats provider POST', async t => {
  const f = await sheetsFixture(t), b = await f.client.get(f.connection.id, f.binding.id), attempt = sheetAttempt('rows.append', b.connectionId, b)
  let release!: () => void, reached!: () => void; const gate = new Promise<void>(r => { release = r }), started = new Promise<void>(r => { reached = r })
  f.hooks.provider = async r => { if (r.method === 'POST') { reached(); await gate } }
  const result = f.client.append(attempt, appendInput); await started
  assert.equal((await f.client.operation(attempt)).status, 'pending'); assert.equal((await f.client.append(attempt, appendInput)).status, 'pending')
  assert.equal(f.calls.filter(r => r.method === 'POST').length, 1); release(); assert.equal((await result).status, 'appended')
})
