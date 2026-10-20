import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createConversationActions } from '../src/services/casca/conversation-actions'
import { EngineError } from '../src/services/engine/http'
import type { Conversation } from '../src/domain/types'

function fixture(status: 'succeeded' | 'failed' = 'succeeded') {
  const values = new Map<string, string>(), storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v) }, removeItem: (k: string) => { values.delete(k) } }
  const identity = { tenantId: 'tenant', userId: 'user', membershipId: 'member', authorityVersion: 'a'.repeat(64) }
  const conversation = { id: randomUUID(), orgId: identity.tenantId, channel: 'webchat' } as Conversation
  let writes = 0, reads = 0, receipt: any, refreshFailure = false
  const context = { tenantId: identity.tenantId, generation: 1, assertCurrent() {}, request: async <T>(path: string, options?: any) => {
    if (path.endsWith('/reply-context')) return { tenantId: identity.tenantId, conversationId: conversation.id, channel: 'webchat', version: 'b'.repeat(64), mode: 'human', capabilities: { takeover: false, release: true, reply: true }, maxLength: 4000, reasonCode: null, delivery: 'available_in_chat' } as T
    if (options?.method === 'POST') { writes++; receipt = { key: options.body.idempotencyKey, conversationId: conversation.id, tenantId: identity.tenantId, kind: 'reply', status, automaticRetry: false, ...(status === 'succeeded' ? { result: { version: 'c'.repeat(64), mode: 'human', messageId: 'message', delivery: 'available_in_chat' } } : {}) }; return receipt as T }
    if (path.includes('/reply-operations/')) { reads++; assert.equal(path.split('/').at(-1), receipt.key); return receipt as T }
    throw Error('Unexpected request')
  } }
  const refresh = async () => { if (refreshFailure) throw new EngineError(0, 'network_error', 'Could not reload'); return conversation }
  const actions = createConversationActions(context, conversation, identity, storage, refresh)
  return { actions, values, storage, identity, context, conversation, refresh, counts: () => ({ writes, reads }), failRefresh: (value: boolean) => { refreshFailure = value } }
}

test('successful send followed by failed transcript refresh retains reference and only GET recovers', async () => {
  const f = fixture(); f.failRefresh(true)
  await assert.rejects(f.actions.command('reply', 'Private message text'), (e: any) => e.code === 'network_error')
  assert.equal(f.actions.pending(), true)
  await assert.rejects(f.actions.command('reply', 'Never repeat'), (e: any) => e.code === 'reply_outcome_unknown')
  assert.deepEqual(f.counts(), { writes: 1, reads: 0 })
  assert.equal([...f.values.values()].join('').includes('Private message text'), false)
  await assert.rejects(f.actions.recover(), (e: any) => e.code === 'network_error'); assert.equal(f.actions.pending(), true)
  f.failRefresh(false)
  assert.equal((await f.actions.recover()).outcome, 'succeeded'); assert.equal(f.actions.pending(), false)
  assert.deepEqual(f.counts(), { writes: 1, reads: 2 })
})
test('terminal failure returns failure explicitly and never becomes a successful send', async () => {
  const f = fixture('failed')
  await assert.rejects(f.actions.command('reply', 'Unsent text'), (e: any) => e.code === 'reply_outcome_unknown')
  assert.equal(f.actions.pending(), true)
  assert.equal((await f.actions.recover()).outcome, 'failed'); assert.equal(f.actions.pending(), false)
  assert.deepEqual(f.counts(), { writes: 1, reads: 1 })
})
test('pending references are isolated by membership and authority even for the legacy web journal', async () => {
  const f = fixture(); f.failRefresh(true)
  await assert.rejects(f.actions.command('reply', 'Private message'))
  for (const identity of [{ ...f.identity, membershipId: 'replacement' }, { ...f.identity, authorityVersion: 'd'.repeat(64) }]) {
    const actions = createConversationActions(f.context, f.conversation, identity, f.storage, f.refresh)
    assert.equal(actions.pending(), false)
  }
  assert.equal(f.actions.pending(), true); assert.deepEqual(f.counts(), { writes: 1, reads: 0 })
})
