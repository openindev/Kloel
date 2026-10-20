import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { sheetActionUIFixture } from './engine-sheets-actions-fixture'
import { actionConfiguration, actionVariables, parseActionPreview, parseActionReceipt, type ActionAttempt } from '../src/services/engine/sheets-actions'
import { createSheetActionJournal } from '../src/services/engine/sheets-action-journal'

function memory() { const values = new Map<string, string>(); return { values, getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v) }, removeItem: (k: string) => { values.delete(k) } } }
test('real HTTP configuration is disabled, flat receipt recovers locally after deletion and explicit enable remains separate', async t => {
  const f = await sheetActionUIFixture(t), { name, description, ...config } = f.queryConfig
  const a: ActionAttempt = { key: randomUUID(), kind: 'action.create', actionKind: 'query', agentId: f.agent.id, connectionId: f.connection.id, bindingId: f.binding.id, expectedBindingRevision: 1 }
  const receipt = await f.client.configure(a, 'query', name, description, config as any)
  assert.equal(receipt.resultRevision, 1); const action = (await f.client.list())[0]; assert.equal(action.enabled, false); assert.equal(action.bindingRevision, 1); assert.equal(f.requests.length, 0)
  await f.client.setEnabled({ key: randomUUID(), kind: 'action.set_enabled', agentId: f.agent.id, actionId: action.id, expectedRevision: 1, enabled: true }); assert.equal((await f.client.list())[0].enabled, true)
  f.store.remove(f.actor.tenantId, 'sheets-assistant-actions', action.id)
  assert.equal((await f.client.operation(a)).actionId, action.id); assert.equal(f.requests.length, 0)
})
test('real query preview projects explicit columns, formatted strings and no mutation/journal/provider POST', async t => {
  const f = await sheetActionUIFixture(t), action = await f.create('query')
  const result = await f.client.preview(action, { nome: 'Teste A' })
  assert.deepEqual(result.columns.map(c => c.a1), ['A', 'B']); assert.deepEqual(result.rows[0].cells, ['Teste A', '7']); assert.equal(result.coverage.wholeSheet, 'unknown'); assert.equal(f.requests.filter(r => r.method !== 'GET').length, 0); assert.doesNotMatch(JSON.stringify(result), /NAO_DIVULGAR|PRIVADO/)
  const malformed = structuredClone(result); malformed.columns[0].a1 = 'C'; assert.throws(() => parseActionPreview(malformed, action))
  await assert.rejects(() => f.client.preview(awaitActionAppend(action), {}))
  function awaitActionAppend(a: any) { return { ...a, kind: 'append', configuration: { sheetTitle: "Client's Data", inputDefinitions: [], range: 'A1:A1', row: [{ kind: 'literal', value: false }] } } }
})
test('preview drops cells when connection or action changes after provider response', async t => {
  const f = await sheetActionUIFixture(t), action = await f.create('query'), hook = f.hooks.provider
  f.hooks.provider = r => { const response = hook?.(r); if (r.method === 'GET' && r.url.pathname.includes('/values/')) f.store.update(f.actor.tenantId, 'sheets-assistant-actions', action.id, { revision: action.revision + 1 }); return response }
  await assert.rejects(() => f.client.preview(action, { nome: 'Teste A' })); assert.equal(f.requests.filter(r => r.method === 'POST').length, 0)
})
test('grant policy, replacement CAS and revoke use current original intent; historical GET is local', async t => {
  const f = await sheetActionUIFixture(t), action = await f.create('append'), channel = (await f.app.inject({ method: 'GET', url: `/api/v1/webchat/channels/${f.channel.id}`, cookies: f.cookies, headers: f.headers() })).json()
  const a: ActionAttempt = { key: randomUUID(), kind: 'grant.create', agentId: f.agent.id, actionId: action.id, expectedRevision: action.revision, channelId: channel.id, expectedChannelVersion: channel.version, previousGrant: null }
  const receipt = await f.client.grant(a, { expiresInDays: 1, maxCallsPerConversation: 1, maxCallsPerDay: 5, acknowledgePublicDisclosure: true, authorizeDelegatedAppend: true }, 'append'), grants = await f.client.grants(action)
  assert.equal(grants[0].mode, 'delegated_append'); assert.equal(receipt.grantId, grants[0].id)
  const revoke: ActionAttempt = { key: randomUUID(), kind: 'grant.revoke', agentId: f.agent.id, actionId: action.id, grantId: grants[0].id, expectedRevision: 1 }
  assert.equal((await f.client.revoke(revoke)).resultRevision, 2); assert.equal((await f.client.operation(a)).resultRevision, 1); assert.equal(f.requests.length, 0)
})
test('configuration validates typed inputs, full header/projection and zero/false without JSON interpolation', () => {
  const config = actionConfiguration('append', { sheetTitle: 'Data', inputDefinitions: [{ name: 'count', type: 'number' }, { name: 'active', type: 'boolean' }], range: 'A1:C1', row: [{ kind: 'literal', value: '=1+1' }, { kind: 'variable', name: 'count' }, { kind: 'variable', name: 'active' }] })
  assert.deepEqual({ ...actionVariables(config, { count: 0, active: false }) }, { count: 0, active: false })
  assert.throws(() => actionVariables(config, { count: '0', active: false })); assert.throws(() => actionVariables(config, { count: 0, active: false, extra: 'ignored' }))
  assert.throws(() => actionConfiguration('query', { sheetTitle: 'Data', inputDefinitions: [], scanRange: 'A1:B20', headers: true, filters: [], expectedHeaders: ['Nome', 'Nome'], returnColumns: ['C'], maxRows: 10 }))
})
test('opaque journal readback, independent revoke lane, original authority and resolved CAS preserve references', async t => {
  const f = await sheetActionUIFixture(t), storage = memory(), journal = createSheetActionJournal(storage, f.identity.context), id = randomUUID(), first: ActionAttempt = { key: randomUUID(), kind: 'action.update', actionKind: 'query', agentId: f.agent.id, actionId: id, expectedRevision: 1, expectedBindingRevision: 1 }
  journal.reserve(first, () => {}); assert.throws(() => journal.reserve({ ...first, key: randomUUID() }, () => {}))
  const revoke: ActionAttempt = { key: randomUUID(), kind: 'grant.revoke', agentId: f.agent.id, actionId: id, grantId: randomUUID(), expectedRevision: 1 }; journal.reserve(revoke, () => {})
  assert.equal(journal.read().length, 2); assert.doesNotMatch([...storage.values.values()].join(), /configuration|sheetTitle|spreadsheetId|inputDefinitions|token/)
  const receipt = { key: first.key, kind: first.kind, status: 'succeeded' as const, actionId: id, grantId: null, resultRevision: 2, replayed: false, automaticRetry: false as const }
  assert.throws(() => parseActionReceipt({ ...receipt, resultRevision: 3 }, first)); journal.resolve(first, receipt, () => {}); journal.removeResolved(first, () => {}); assert.equal(journal.read()[0].attempt.key, revoke.key)
  const corrupt = createSheetActionJournal({ ...storage, setItem() {} }, f.identity.context); assert.throws(() => corrupt.reserve(first, () => {}))
  const changed = createSheetActionJournal(storage, { ...f.identity.context, authorityVersion: 'a'.repeat(64) }); assert.equal(changed.read().length, 0)
})
test('lost write response GET404 never calls a second mutation and authority ABA hides recovery', async t => {
  const f = await sheetActionUIFixture(t), a: ActionAttempt = { key: randomUUID(), kind: 'action.create', actionKind: 'query', agentId: f.agent.id, connectionId: f.connection.id, bindingId: f.binding.id, expectedBindingRevision: 1 }, { name, description, ...config } = f.queryConfig
  f.state.before = async r => { if (r.method === 'POST' && r.path === f.base) throw Error('lost before dispatch') }
  await assert.rejects(() => f.client.configure(a, 'query', name, description, config as any)); f.state.before = undefined
  await assert.rejects(() => f.client.operation(a)); assert.equal(f.writes().length, 1); assert.equal(f.requests.length, 0)
  const receipt = await f.client.configure(a, 'query', name, description, config as any); assert.equal(receipt.resultRevision, 1); f.aba(); await assert.rejects(() => f.client.operation(a))
})

test('journal bounds unresolved intentions, preserves other lanes and refuses context change during storage readback', async t => {
  const f = await sheetActionUIFixture(t), storage = memory(), j = createSheetActionJournal(storage, f.identity.context)
  for (let i = 0; i < 40; i++) j.reserve({ key: randomUUID(), kind: 'grant.revoke', agentId: f.agent.id, actionId: randomUUID(), expectedRevision: 1, grantId: randomUUID() }, () => {})
  assert.equal(j.read().length, 40); assert.throws(() => j.reserve({ key: randomUUID(), kind: 'action.create', actionKind: 'query', agentId: f.agent.id, connectionId: f.connection.id, bindingId: f.binding.id, expectedBindingRevision: 1 }, () => {})); assert.equal(j.read().length, 40)
  const isolated = memory(); let checks = 0; const other = createSheetActionJournal(isolated, f.identity.context), a: ActionAttempt = { key: randomUUID(), kind: 'action.create', actionKind: 'query', agentId: f.agent.id, connectionId: f.connection.id, bindingId: f.binding.id, expectedBindingRevision: 1 }
  assert.throws(() => other.reserve(a, () => { if (++checks === 3) throw Error('authority changed after setItem') })); assert.equal(other.read()[0].attempt.key, a.key); assert.equal(f.requests.length, 0)
})

test('aborted preview never projects cells even when transport ignores cancellation', async t => {
  const f = await sheetActionUIFixture(t), action = await f.create(), abort = new AbortController()
  f.state.after = async (r, response) => { if (r.path.endsWith('/preview')) abort.abort(); return response }
  await assert.rejects(() => f.client.preview(action, { nome: 'Teste A' }, abort.signal)); assert.equal(f.requests.filter(r => r.method === 'POST').length, 0)
})
