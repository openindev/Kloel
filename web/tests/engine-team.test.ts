import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { teamFixture } from './fixtures/team-engine'
import { seedMember } from '../../engine/tests/fixtures/membership'
import { createInvitationAcceptance, createTeamOperationStorage, createTeamService, invitationFragment, invitationPath, TeamWriteUncertain } from '../src/services/engine/team'

test('actual team roles and members support CAS edits, session revocation and membership removal while preserving last owner', async t => {
  const f = await teamFixture(t), rows = await f.service.members(), roles = await f.service.roles()
  assert.equal(rows.total, 3); assert.equal(roles.ownerCount, 1); assert.equal(roles.items.length, 6)
  assert.equal(roles.items.find(r => r.role === 'member')!.permissions.includes('billing:manage'), false)
  const member = rows.items.find(m => m.id === f.member.userId)!, owner = rows.items.find(m => m.id === f.owner.userId)!
  f.loginAs(f.member.userId); f.loginAs(f.owner.userId)
  const updated = await f.service.changeRole(member, 'builder'); assert.equal(updated.role, 'builder'); assert.ok(updated.revision > member.revision)
  await assert.rejects(f.service.removeMember(member), (e: any) => e.code === 'version_conflict')
  await assert.rejects(f.service.changeRole(owner, 'viewer'), (e: any) => e.code === 'last_owner')
  await assert.rejects(f.service.removeMember(owner), (e: any) => e.code === 'last_owner')
  f.loginAs(f.member.userId); f.loginAs(f.owner.userId)
  const revoked = await f.service.revokeSessions(updated); assert.equal(revoked.revokedSessions, 1)
  await f.service.removeMember(revoked.member)
  assert.equal((await f.service.members()).items.some(m => m.id === member.id), false)
  assert.ok(f.store.db.prepare('SELECT id FROM users WHERE id=?').get(member.id))
})

test('lost invitation creation recovers by safe read and reveals the same link without rotating, then CAS renewal and revocation fence old links', async t => {
  const f = await teamFixture(t), operationKey = randomUUID(), draft = { email: 'invitee@example.test', role: 'member' as const, expiresInHours: 24 }
  f.state.lostResponsePath = '/api/v1/invitations'
  await assert.rejects(f.service.createInvitation(draft, operationKey), TeamWriteUncertain)
  const operation = await f.service.operation(operationKey)
  assert.equal(operation.invitation.email, draft.email); assert.equal(operation.invitation.deliveryStatus, 'not_sent'); assert.equal(operation.linkRecoverable, true)
  assert.equal(JSON.stringify(operation).includes('token'), false)
  const exposed = await f.service.recoverLink(operationKey), firstToken = invitationFragment(exposed.localAcceptancePath!.split('#')[1])!
  assert.equal((await f.service.recoverLink(operationKey)).localAcceptancePath, exposed.localAcceptancePath)
  assert.equal(f.store.list(f.owner.tenantId, 'team-invitations').length, 1)
  const renewed = await f.service.rotateInvitation(exposed, 48, randomUUID())
  assert.notEqual(renewed.localAcceptancePath, exposed.localAcceptancePath)
  assert.equal((await f.service.operation(operationKey)).linkRecoverable, false)
  await assert.rejects(f.service.recoverLink(operationKey), (e: any) => e.code === 'link_unavailable')
  await assert.rejects(f.service.revokeInvitation(exposed), (e: any) => e.code === 'version_conflict')
  const accept = createInvitationAcceptance(f.request); f.state.cookie = ''
  await assert.rejects(accept.accept({ token: firstToken, email: draft.email, password: f.password }), (e: any) => e.code === 'invalid_invitation')
  f.loginAs(f.owner.userId); await f.service.revokeInvitation(renewed)
  assert.equal((await f.service.invitations()).items[0].status, 'revoked')
  assert.equal(f.state.requests.filter(r => r.path === '/api/v1/invitations' && r.method === 'POST').length, 1)
})

test('acceptance creates one identity/membership and safely recovers a lost response without a second accept or invitation token', async t => {
  const f = await teamFixture(t), invitation = await f.service.createInvitation({ email: 'new@example.test', role: 'member', expiresInHours: 24 }, randomUUID()), token = invitationFragment(invitation.localAcceptancePath!.split('#')[1])!
  const operation = createInvitationAcceptance(f.request); f.state.cookie = ''; f.state.lostResponsePath = '/api/v1/auth/accept-invite'; f.state.dropCookieOnLoss = true
  await assert.rejects(operation.accept({ token, email: invitation.email, password: f.password }))
  const recovered = await operation.recover(f.password)
  assert.equal(recovered.replayed, true); assert.equal(recovered.tenantId, f.owner.tenantId)
  assert.equal(Number(f.store.db.prepare('SELECT COUNT(*) AS n FROM users WHERE email=?').get(invitation.email)!.n), 1)
  assert.equal(Number(f.store.db.prepare('SELECT COUNT(*) AS n FROM memberships WHERE user_id=?').get(recovered.userId)!.n), 1)
  const calls = f.state.requests.filter(r => r.path === '/api/v1/auth/accept-invite')
  assert.equal(calls.length, 2); assert.equal(calls[0].body.action, 'accept'); assert.equal(calls[1].body.action, 'recover'); assert.equal(calls[1].body.token, undefined)
  await assert.rejects(operation.accept({ token, email: invitation.email, password: f.password }), (e: any) => e.code === 'already_started')
  assert.equal(f.state.requests.filter(r => r.path === '/api/v1/auth/accept-invite').length, 2)
})

test('existing invited identity requires its own credentials or matching session; admin cannot manage owners and member cannot invite', async t => {
  const f = await teamFixture(t), elsewhere = randomUUID()
  f.store.db.prepare("INSERT INTO organizations(id,name,status,created_at) VALUES(?,?,'active',?)").run(elsewhere, 'Other', new Date().toISOString())
  const invitedEmail = `${f.member.userId}@example.test`
  f.store.db.prepare('DELETE FROM memberships WHERE user_id=? AND tenant_id=?').run(f.member.userId, f.owner.tenantId)
  const invitation = await f.service.createInvitation({ email: invitedEmail, role: 'member', expiresInHours: 24 }, randomUUID()), token = invitationFragment(invitation.localAcceptancePath!.split('#')[1])!
  await assert.rejects(createInvitationAcceptance(f.request).accept({ token, email: invitedEmail }), (e: any) => e.code === 'identity_verification_required')
  f.loginAs(f.member.userId)
  const result = await createInvitationAcceptance(f.request).accept({ token, email: invitedEmail }); assert.equal(result.userId, f.member.userId)
  await assert.rejects(f.service.createInvitation({ email: 'denied@example.test', role: 'member', expiresInHours: 24 }, randomUUID()), (e: any) => e.status === 403)
  f.loginAs(f.admin.userId)
  assert.equal((await f.service.roles()).items.find(r => r.role === 'owner')!.canAssign, false)
  await assert.rejects(f.service.createInvitation({ email: 'denied@example.test', role: 'owner', expiresInHours: 24 }, randomUUID()), (e: any) => e.status === 403)
})

test('minimal operation journal is isolated and secret-free, fragment parsing rejects malformed tokens and stale context discards secrets', async t => {
  const f = await teamFixture(t), values = new Map<string, string>(), storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } }
  const journal = createTeamOperationStorage(storage, { userId: f.owner.userId, tenantId: f.owner.tenantId }), ref = { key: randomUUID(), kind: 'invitation.create' as const }
  journal.write({ ...ref, token: 'private', email: 'private@example.test', url: 'https://secret.invalid' } as any)
  assert.deepEqual(journal.read(), ref); assert.equal(/private|https|email|token/.test([...values.values()].join('')), false)
  assert.equal(createTeamOperationStorage(storage, { userId: f.member.userId, tenantId: f.owner.tenantId }).read(), undefined)
  assert.equal(createTeamOperationStorage(storage, { userId: f.owner.userId, tenantId: 'foreign' }).read(), undefined)
  for (const path of ['https://evil.test/accept-invite#token=' + 'a'.repeat(64), '/accept-invite?token=' + 'a'.repeat(64), '/other#token=' + 'a'.repeat(64)]) assert.throws(() => invitationPath(path))
  assert.equal(invitationFragment('#token=' + 'a'.repeat(64) + '&token=' + 'b'.repeat(64)), undefined)
  const invitation = await f.service.createInvitation({ email: 'stale@example.test', role: 'member', expiresInHours: 24 }, ref.key)
  assert.ok(invitation.localAcceptancePath)
  f.state.afterResponse = () => { if (f.state.requests.at(-1)?.path.endsWith('/recover-link')) f.invalidate() }
  await assert.rejects(f.service.recoverLink(ref.key), TeamWriteUncertain)
})

test('team service rejects mismatched member and invitation receipts without exposing a foreign link', async t => {
  const f = await teamFixture(t), previous = (await f.service.members()).items.find(m => m.id === f.member.userId)!, operationKey = randomUUID()
  const created = await f.service.createInvitation({ email: 'intended@example.test', role: 'member', expiresInHours: 24 }, operationKey)
  const raw = { ...created, tenantId: f.owner.tenantId }, operation = { kind: 'invitation.create', status: 'succeeded', invitation: raw, linkRecoverable: true }
  let response: unknown, safeOperation = operation
  const api = createTeamService({ ...f.context, request: (async (_path: string, options: any) => options?.method ? response : safeOperation) as any })
  response = { ...previous, id: randomUUID(), membershipId: randomUUID(), role: 'viewer' }
  await assert.rejects(api.changeRole(previous, 'viewer'), TeamWriteUncertain)
  response = { ...previous, role: 'owner' }; await assert.rejects(api.changeRole(previous, 'viewer'), TeamWriteUncertain)
  response = { userId: previous.id, revokedSessions: 1, member: { ...previous, membershipId: randomUUID() } }
  await assert.rejects(api.revokeSessions(previous), TeamWriteUncertain)
  for (const changed of [{ tenantId: randomUUID() }, { email: 'foreign@example.test' }, { role: 'owner' }]) {
    response = { ...raw, ...changed }
    await assert.rejects(api.createInvitation({ email: created.email, role: created.role, expiresInHours: 24 }, randomUUID()), TeamWriteUncertain)
  }
  response = { ...raw, id: randomUUID() }; await assert.rejects(api.rotateInvitation(created, 24, randomUUID()), TeamWriteUncertain)
  response = { ...raw, version: 'a'.repeat(64) }; await assert.rejects(api.recoverLink(operationKey), TeamWriteUncertain)
  safeOperation = { ...operation, invitation: { ...raw, tenantId: randomUUID() } }
  await assert.rejects(api.operation(operationKey), (e: any) => e.code === 'invalid_team_response')
  assert.throws(() => api.createInvitation({ email: created.email, role: created.role, expiresInHours: 24 }, 'invalid.key'), (e: any) => e.code === 'invalid_team_response')
})

test('captured organization is sent with invitation creation and a cookie switched in another tab cannot create in either organization', async t => {
  const f = await teamFixture(t), otherTenant = randomUUID()
  seedMember(f.store, { ...f.owner, tenantId: otherTenant })
  f.loginAs(f.owner.userId, otherTenant)
  assert.doesNotThrow(() => f.context.assertCurrent())
  await assert.rejects(f.service.createInvitation({ email: 'cross-tab@example.test', role: 'member', expiresInHours: 24 }, randomUUID()), (e: any) => e.status === 409)
  const request = f.state.requests.at(-1)!
  assert.equal(request.body.expectedTenantId, f.owner.tenantId)
  assert.equal(f.store.list(f.owner.tenantId, 'team-invitations').length, 0)
  assert.equal(f.store.list(otherTenant, 'team-invitations').length, 0)
})
