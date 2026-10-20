import test from 'node:test'
import assert from 'node:assert/strict'
import { createInviteCommands, loadTeam, projectInvitation } from '../src/services/casca/team'
import type { EngineContext } from '../src/services/engine/session'
import { EngineError } from '../src/services/engine/http'

const date = '2026-10-19T12:00:00Z'
const invitation = { id: 'invitation', tenantId: 'tenant', email: 'person@example.invalid', role: 'editor' as const, status: 'pending' as const, expiresAt: '2026-10-26T12:00:00Z', deliveryStatus: 'not_sent' as const, acceptedAt: null, createdAt: date, updatedAt: date, version: 'b'.repeat(64), revision: 1 }
const identity = { userId: 'owner', tenantId: 'tenant', membershipId: 'member', authorityVersion: 'a'.repeat(64) }
const draft = { email: invitation.email, role: invitation.role, firstName: 'Pessoa', lastName: 'Convidada' }
function fixture(options: { lostCreate?: boolean; lostMail?: boolean; failRefresh?: boolean; refuseCreate?: boolean } = {}) {
  const map = new Map<string, string>(), calls: { path: string; options: any }[] = []
  const storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v) }, removeItem: (k: string) => { map.delete(k) } }
  let active = true, mailKey = ''
  const context = { tenantId: 'tenant', generation: 1, assertCurrent() { if (!active) throw new Error('superseded') }, async request(path: string, requestOptions: any = {}) {
    calls.push({ path, options: requestOptions })
    if (path === '/invitations' && requestOptions.method === 'POST') {
      if (options.refuseCreate) throw new EngineError(409, 'invitation_pending', 'already pending')
      if (options.lostCreate) { options.lostCreate = false; throw new Error('lost creation') }
      return { ...invitation, localAcceptancePath: `/accept-invite#token=${'c'.repeat(64)}` }
    }
    if (path.endsWith('/recover-link')) return { ...invitation, localAcceptancePath: `/accept-invite#token=${'c'.repeat(64)}` }
    if (path.startsWith('/team/operations/')) return { status: 'succeeded', kind: 'invitation.create', invitation, linkRecoverable: true }
    if (/^\/invitations\/[^/]+\/email$/.test(path)) { mailKey = requestOptions.body.idempotencyKey; if (options.lostMail) { options.lostMail = false; throw new Error('lost mail') } return { status: 'accepted', messageId: 'mail' } }
    if (path === '/providers/operations') return { items: [{ key: mailKey, operation: 'resend.send', status: 'succeeded' }] }
    if (options.failRefresh && path === '/members') { options.failRefresh = false; throw new Error('list unavailable') }
    if (path === '/members') return { items: [], page: 1, limit: 25, total: 0, totalPages: 0 }
    if (path === '/invitations') return { items: [invitation], page: 1, limit: 25, total: 1, totalPages: 1 }
    throw new Error(`unexpected ${path}`)
  } } as EngineContext
  return { map, calls, context, api: createInviteCommands(context, identity, storage, 'http://127.0.0.1:3004'), expire() { active = false } }
}
test('projection never fabricates delivery timestamps or invitation acceptance', () => {
  const projected = projectInvitation(invitation, 'tenant')
  assert.equal(projected.status, 'pending'); assert.equal(projected.lastSentAt, '')
})
test('successful invitation uses the actual hosted acceptance path and clears only resolved references', async () => {
  const f = fixture(), result = await f.api.send(draft)
  assert.equal(result.id, invitation.id)
  assert.equal(f.calls.filter(c => /^\/invitations\/[^/]+\/email$/.test(c.path)).length, 1)
  assert.match(f.calls.find(c => /^\/invitations\/[^/]+\/email$/.test(c.path))!.options.body.acceptUrl, /http:\/\/127\.0\.0\.1:3004\/accept-invite#token=/)
  assert.equal(f.map.size, 0)
})
test('lost invitation creation recovers its receipt and never creates a second invitation', async () => {
  const f = fixture({ lostCreate: true })
  await assert.rejects(f.api.send(draft)); assert.equal(f.map.size, 1)
  assert.doesNotMatch([...f.map.values()].join(''), /example|Pessoa|token/)
  await f.api.send(draft)
  assert.equal(f.calls.filter(c => c.path === '/invitations' && c.options.method === 'POST').length, 1)
})
test('lost email response and failed list refresh both recover with the same idempotent delivery key', async () => {
  for (const options of [{ lostMail: true }, { failRefresh: true }]) {
    const f = fixture(options)
    await assert.rejects(f.api.send(draft))
    await f.api.send(draft)
    const mails = f.calls.filter(c => /^\/invitations\/[^/]+\/email$/.test(c.path))
    assert.ok(mails.length >= 1 && mails.length <= 2)
    assert.equal(new Set(mails.map(c => c.options.body.idempotencyKey)).size, 1)
    assert.equal(f.map.size, 0)
  }
})
test('pending invite cannot be reused for another recipient or a changed session', async () => {
  const f = fixture({ lostCreate: true })
  await assert.rejects(f.api.send(draft))
  await assert.rejects(f.api.send({ ...draft, email: 'other@example.invalid' }), /destinatário/)
  assert.equal(f.calls.filter(c => /^\/invitations\/[^/]+\/email$/.test(c.path)).length, 0)
  f.expire(); await assert.rejects(f.api.send(draft), /superseded/)
})
test('a definite refusal releases the unused operation reference without sending an email', async () => {
  const f = fixture({ refuseCreate: true })
  await assert.rejects(f.api.send(draft)); assert.equal(f.map.size, 0)
  assert.equal(f.calls.filter(c => /^\/invitations\/[^/]+\/email$/.test(c.path)).length, 0)
})

test('a lost legacy member invitation rotation recovers under its projected editor role without resending', async () => {
  const previous = { ...invitation, role: 'member' as const }, confirmed = { ...previous, revision: 2, version: 'c'.repeat(64) }
  const data = new Map<string, string>(), storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) }, removeItem: (key: string) => { data.delete(key) } }
  let rotations = 0, mails = 0
  const context: EngineContext = { tenantId: 'tenant', generation: 1, assertCurrent() {}, async request(path, options) {
    if (path === '/invitations/invitation/link') { rotations++; throw Error('lost rotation response') }
    if (path.endsWith('/recover-link')) return { ...confirmed, localAcceptancePath: `/accept-invite#token=${'c'.repeat(64)}` } as never
    if (path.startsWith('/team/operations/')) return { status: 'succeeded', kind: 'invitation.rotate', invitation: confirmed, linkRecoverable: true } as never
    if (/^\/invitations\/[^/]+\/email$/.test(path)) { mails++; return { status: 'accepted', messageId: 'mail' } as never }
    if (path === '/members') return { items: [], page: 1, limit: 25, total: 0, totalPages: 0 } as never
    if (path === '/invitations') return { items: [confirmed], page: 1, limit: 25, total: 1, totalPages: 1 } as never
    throw Error(`unexpected ${path} ${options?.method}`)
  } }
  const api = createInviteCommands(context, identity, storage, 'http://127.0.0.1:3004'), projected = projectInvitation(previous, 'tenant')
  assert.equal(projected.role, 'editor')
  await assert.rejects(api.send(projected, previous))
  await assert.rejects(api.send({ ...projected, role: 'admin' }, previous), /destinatário/)
  const result = await api.send(projected, previous)
  assert.equal(result.role, 'editor'); assert.equal(rotations, 1); assert.equal(mails, 1); assert.equal(data.size, 0)
})
