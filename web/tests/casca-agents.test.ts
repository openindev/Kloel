import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createAgentCommands, createAgentJournal, editorState, parseEditorView, parseEditorOperation, projectAgent, voiceProviderMap } from '../src/services/casca/agents'
import { EngineError } from '../src/services/engine/http'
import type { EngineAgent } from '../src/services/engine/agents'

const tenantId = 'tenant-casca', now = '2026-10-19T12:00:00.000Z', agentId = randomUUID()
const runtime = (): EngineAgent => ({ id: agentId, tenantId, name: 'Ana', prompt: 'Atenda com clareza.', initialMessage: 'Olá', language: 'pt-BR', voice: 'marin', status: 'draft', settings: { temperature: 0.7, maxResponseTokens: 1024, timezone: 'America/Sao_Paulo', recordingEnabled: false, humanHandoffEnabled: true }, tools: ['search_knowledge'], rules: [], createdAt: now, updatedAt: now })
const view = () => ({ agent: runtime(), agentVersion: 'a'.repeat(64), revision: 0, state: {}, lastWrite: null })
const operation = (key: string, kind = 'agent.editor.update', revision = 1) => ({ key, kind, agentId, tenantId, expectedRevision: revision - 1, revision, agentVersion: 'a'.repeat(64), fingerprint: 'b'.repeat(64), status: 'succeeded', createdAt: now, automaticRetry: false })
function fixture() { const calls: { path: string; options: any }[] = [], values = new Map<string, string>(), storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v) }, removeItem: (k: string) => { values.delete(k) } }, scope = { tenantId, userId: randomUUID(), membershipId: randomUUID(), authorityVersion: 'c'.repeat(64) }, journal = createAgentJournal(storage, scope, agentId)
  let current = true, run = async (_path: string, _options: any): Promise<any> => view()
  const context = { tenantId, generation: 3, assertCurrent() { if (!current) throw new EngineError(0, 'superseded', 'Changed') }, request: async <T,>(path: string, options?: any): Promise<T> => { calls.push({ path, options }); return await run(path, options) as T } }
  return { calls, values, journal, context, commands: createAgentCommands(context, journal), set: (fn: typeof run) => { run = fn }, revoke: () => { current = false } }
}
test('legacy projection is deterministic, tenant-bound and preserves the complete voice catalog mapping', () => {
  assert.deepEqual(projectAgent(runtime()), projectAgent(runtime())); assert.equal(Object.keys(voiceProviderMap).length, 148)
  const parsed = parseEditorView(view(), tenantId, agentId), projected = projectAgent(parsed.agent, parsed, 3)
  assert.equal(projected.name, 'Ana'); assert.equal(projected.orgId, tenantId); assert.equal(projected.technical.recordAudio, false); assert.equal(projected.cascaEditor?.generation, 3)
  assert.throws(() => parseEditorView(view(), 'other')); assert.throws(() => parseEditorView({ ...view(), state: { id: 'foreign' } }, tenantId))
})
test('editor payload removes credential/derived/private transport fields while retaining nested zero and false', () => {
  const clean = editorState({ id: 'not-state', orgId: 'other', technical: { ambientVolume: 0, dtmf: false }, webhooks: [{ id: 'local', enabled: true, url: 'https://private.example', headers: [{ key: 'Authorization', value: 'secret' }], body: 'secret', defaults: 'secret', lastTest: { ok: true }, description: 'Descrição', nested: { api_key: 'secret', safe: 0 } }], integrations: [{ id: 'local', config: { password: 'secret' }, connected: true, name: 'Destino' }], companyInfo: 'Empresa' })
  assert.deepEqual(clean.technical, { ambientVolume: 0, dtmf: false }); assert.deepEqual(clean.webhooks, [{ id: 'local', enabled: true, description: 'Descrição', nested: { safe: 0 } }]); assert.deepEqual(clean.integrations, [{ id: 'local', name: 'Destino' }]); assert.doesNotMatch(JSON.stringify(clean), /secret|private.example|password|orgId/)
  assert.throws(() => editorState({ technical: { value: Infinity } })); assert.throws(() => editorState({ technical: JSON.parse('{"__proto__":{}}') }))
})
test('editor update keeps both original CAS fences and writes one atomic request', async () => {
  const f = fixture(), base = projectAgent(runtime(), view(), 3)
  f.set(async (_path, options) => { assert.equal(options.method, 'PUT'); const op = operation(options.body.idempotencyKey); return { ...view(), agent: { ...runtime(), name: 'Nova' }, revision: 1, state: options.body.state, lastWrite: op, operation: op, replayed: false } })
  const result = await f.commands.update(base, { name: 'Nova' }); assert.equal(result.name, 'Nova'); assert.equal(f.calls.length, 1)
  assert.equal(f.calls[0].options.body.expectedRevision, 0); assert.equal(f.calls[0].options.body.expectedAgentVersion, 'a'.repeat(64)); assert.deepEqual(f.calls[0].options.body.agent, { name: 'Nova' }); assert.equal(f.journal.read(), null)
})
test('lost committed create response recovers original receipt by GET without another POST or payload in journal', async () => {
  const f = fixture(), input = projectAgent(runtime()), newId = agentId; let key = ''
  f.set(async (path, options) => { if (options?.method === 'POST') { key = options.body.idempotencyKey; assert.equal(f.journal.read()?.key, key); assert.doesNotMatch([...f.values.values()].join(''), /Atenda|voiceId|configuration|prompt/); throw Error('response lost after commit') } if (path.endsWith('/operations/' + key)) return operation(key, 'agent.editor.create'); return { ...view(), agent: { ...runtime(), id: newId }, revision: 1, lastWrite: operation(key, 'agent.editor.create') } })
  const result = await f.commands.create(input); assert.equal(result.id, newId); assert.equal(f.calls.filter(r => r.options?.method === 'POST').length, 1); assert.equal(f.journal.read(), null)
})
test('unknown write retains opaque reference; another click only queries that reference and storage failure blocks dispatch', async () => {
  const f = fixture(), base = projectAgent(runtime(), view(), 3)
  f.set(async (_path, options) => { if (options?.method === 'PUT') throw Error('lost'); throw new EngineError(404, 'not_found', 'Unknown') })
  await assert.rejects(() => f.commands.update(base, { name: 'Mudança' })); const pending = f.journal.read()!; await assert.rejects(() => f.commands.update(base, { name: 'Outra mudança' })); assert.equal(f.calls.filter(r => r.options?.method === 'PUT').length, 1); assert.equal(f.journal.read()?.key, pending.key)
  const denied = createAgentJournal({ getItem: () => null, setItem() { throw Error('quota') }, removeItem() {} }, { tenantId, userId: randomUUID(), membershipId: randomUUID(), authorityVersion: 'c'.repeat(64) }, 'create'); const commands = createAgentCommands(f.context, denied), before = f.calls.length
  await assert.rejects(() => commands.create(projectAgent(runtime()))); assert.equal(f.calls.length, before)
})
test('receipts bind key, operator scope and original revision, while current agent may have a later version', () => {
  const op = operation(randomUUID()), expected = { key: op.key, kind: 'agent.editor.update' as const, agentId, expectedRevision: 0 }
  assert.equal(parseEditorOperation(op, tenantId, expected).key, op.key)
  for (const patch of [{ tenantId: 'other' }, { key: randomUUID() }, { revision: 2 }, { agentId: randomUUID() }, { automaticRetry: true }]) assert.throws(() => parseEditorOperation({ ...op, ...patch }, tenantId, expected))
  assert.equal(parseEditorView({ ...view(), revision: 1, agentVersion: 'd'.repeat(64), lastWrite: op }, tenantId).lastWrite?.agentVersion, 'a'.repeat(64))
})
test('late authority prevents projected publication and delete404 confirms only in the original context', async () => {
  const f = fixture(); f.set(async () => { f.revoke(); return view() }); await assert.rejects(() => f.commands.read(agentId), /Changed/)
  const g = fixture(); g.set(async (_path, options) => { if (options?.method === 'DELETE') throw Error('lost delete'); throw new EngineError(404, 'not_found', 'gone') }); await g.commands.remove(agentId); assert.deepEqual(g.calls.map(r => r.options?.method ?? 'GET'), ['DELETE','GET'])
})

test('duplicate and generic save cannot activate automatic actions without executors', async () => {
  for (const key of ['transfers', 'emails', 'whatsapps'] as const) {
    const f = fixture(), base = projectAgent(runtime(), view(), 3)
    const row = { id: 'legacy', enabled: true }
    await assert.rejects(() => f.commands.create({ ...base, [key]: [row] } as any), /Nenhuma configuração foi ativada/)
    await assert.rejects(() => f.commands.update(base, { [key]: [row] } as any), /Nenhuma configuração foi ativada/)
    assert.equal(f.calls.length, 0)
    assert.equal(f.journal.read(), null)
  }
})
test('legacy automatic action drafts remain readable without asserting readiness', () => {
  const state = { transfers: [{ id: 'transfer' }], emails: [{ id: 'email' }], whatsapps: [{ id: 'whatsapp' }] }
  const projected = projectAgent(runtime(), { ...view(), state }, 3)
  assert.deepEqual(projected.transfers, state.transfers)
  assert.deepEqual(projected.emails, state.emails)
  assert.deepEqual(projected.whatsapps, state.whatsapps)
  assert.deepEqual(projected.engineResourceReadiness, { transfers: false, emails: false, whatsapps: false })
  assert.equal(editorState(projected as any).engineResourceReadiness, undefined)
})

test('Técnico settings the runtimes apply are saved; invalid or unknown ones are rejected before dispatch', async () => {
  const f = fixture(), base = projectAgent(runtime(), view(), 3)
  await assert.rejects(() => f.commands.update(base, { technical: { ...base.technical, preciseExtraction: [{ id: 'new', name: 'nome com espaço', example: '' }] } }), /Nenhuma alteração foi salva/)
  await assert.rejects(() => f.commands.update(base, { technical: { ...base.technical, unknownSetting: true } as any }), /Nenhuma alteração foi salva/)
  await assert.rejects(() => f.commands.update(base, { chat: { timeoutMinutes: 5 } as any }), /Nenhuma alteração foi salva/)
  assert.equal(f.calls.length, 0)
  f.set(async (_path, options) => { const op = operation(options.body.idempotencyKey); return { ...view(), agent: { ...runtime(), name: 'Nova' }, revision: 1, state: options.body.state, lastWrite: op, operation: op, replayed: false } })
  const technical = { ...base.technical, maxCallDuration: 45, silenceTimeout: 30, ambientSound: 'office' as const, ambientVolume: 0.5, sensitivity: 0.3, speechSpeed: 0.9, responseSpeed: 'patient' as const, noInterruptions: true, dtmf: true, freeTransfer: true, technicalTerms: ['Caldas Novas'], preciseExtraction: [{ id: 'new', name: 'Email', example: 'maria@exemplo.com.br' }] }
  const result = await f.commands.update(base, { name: 'Nova', technical })
  assert.equal(result.name, 'Nova'); assert.equal(f.calls.length, 1)
  const saved = f.calls[0].options.body.state.technical
  for (const key of ['maxCallDuration', 'silenceTimeout', 'ambientSound', 'ambientVolume', 'sensitivity', 'speechSpeed', 'responseSpeed', 'noInterruptions', 'dtmf', 'freeTransfer', 'technicalTerms', 'preciseExtraction'] as const) assert.deepEqual(saved[key], technical[key], key)
})

test('create and duplicate save Técnico settings and still reject unsupported chat settings before dispatch', async () => {
  const f = fixture(), base = projectAgent(runtime())
  await assert.rejects(() => f.commands.create({ ...base, chat: { timeoutMinutes: 5 } as any }), /Nenhuma alteração foi salva/)
  await assert.rejects(() => f.commands.create({ ...base, technical: { ...base.technical, preciseExtraction: [{ id: 'x', name: 'Endereço', example: '' }] } }), /Nenhuma alteração foi salva/)
  assert.equal(f.calls.length, 0); assert.equal(f.journal.read(), null)
})
test('missing or stale editor fence re-reads editor-state and still issues one PUT', async () => {
  const f = fixture()
  const respond = async (_path: string, options: any) => {
    if (options?.method !== 'PUT') return view()
    const op = operation(options.body.idempotencyKey)
    return { ...view(), agent: { ...runtime(), name: 'Nova' }, revision: 1, state: options.body.state, lastWrite: op, operation: op, replayed: false }
  }
  f.set(respond)
  const missing = projectAgent(runtime())
  assert.equal(missing.cascaEditor, undefined)
  const saved = await f.commands.update(missing, { name: 'Nova' })
  assert.equal(saved.name, 'Nova')
  assert.deepEqual(f.calls.map(call => call.options?.method ?? 'GET'), ['GET', 'PUT'])
  assert.equal(f.calls[1].options.body.expectedRevision, 0)
  assert.equal(f.calls[1].options.body.expectedAgentVersion, 'a'.repeat(64))
  assert.deepEqual(f.calls[1].options.body.agent, { name: 'Nova' })
  assert.equal(f.journal.read(), null)
  f.calls.length = 0
  const stale = projectAgent(runtime(), view(), 1)
  assert.equal(stale.cascaEditor?.generation, 1)
  const again = await f.commands.update(stale, { name: 'Nova' })
  assert.equal(again.name, 'Nova')
  assert.deepEqual(f.calls.map(call => call.options?.method ?? 'GET'), ['GET', 'PUT'])
})
test('an assistant from another organization is not fetched or saved', async () => {
  const f = fixture(), other = projectAgent(runtime(), view(), 3)
  other.orgId = 'other-org'
  await assert.rejects(() => f.commands.update(other, { name: 'Nova' }), /organização da sessão mudou/)
  assert.equal(f.calls.length, 0)
  assert.equal(f.journal.read(), null)
})
test('canonicalizing old empty or whitespace-only preferences does not block an unrelated rename', async () => {
  const f = fixture(), base = projectAgent(runtime(), view(), 3)
  base.technical.preciseExtraction = [{ id: 'empty', name: ' ', example: '' }, { id: 'kept', name: ' Email ', example: ' ' }]
  base.chat = { timeoutMinutes: 60, entry: { mode: 'condition', condition: ' condição ' }, schedule: 'always', handover: { enabled: true, mode: 'custom', custom: ' regra ' }, notifications: { enabled: false, onTeamEntry: true, onHandover: true, userIds: [] } }
  f.set(async (_path, options) => { const op = operation(options.body.idempotencyKey); return { ...view(), agent: { ...runtime(), name: 'Nova' }, revision: 1, state: options.body.state, lastWrite: op, operation: op, replayed: false } })
  const result = await f.commands.update(base, { name: 'Nova', technical: { ...base.technical, preciseExtraction: [{ id: 'kept', name: 'Email', example: '' }] }, chat: { ...base.chat, entry: { ...base.chat.entry, condition: 'condição' }, handover: { ...base.chat.handover, custom: 'regra' } } })
  assert.equal(result.name, 'Nova'); assert.equal(f.calls.length, 1)
  assert.deepEqual(f.calls[0].options.body.agent, { name: 'Nova' })
})
