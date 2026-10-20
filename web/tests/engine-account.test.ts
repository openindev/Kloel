import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { buildApp } from '../../engine/src/app'
import { Store } from '../../engine/src/store'
import { seedMember } from '../../engine/tests/fixtures/membership'
import { createEngineClient, EngineError, type EngineRequest } from '../src/services/engine/http'
import { accountClient, authorizationUrl } from '../src/services/engine/account'

async function fixture(t: any) {
  const names = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'OAUTH_ENCRYPTION_KEY'], before = Object.fromEntries(names.map(n => [n, process.env[n]]))
  process.env.GOOGLE_CLIENT_ID = 'fixture-google'; process.env.GOOGLE_CLIENT_SECRET = 'fixture-only'; process.env.OAUTH_ENCRYPTION_KEY = randomBytes(32).toString('base64')
  t.after(() => { for (const name of names) if (before[name] === undefined) delete process.env[name]; else process.env[name] = before[name] })
  const store = new Store(), actor = { tenantId: randomUUID(), userId: randomUUID(), role: 'owner' as const }; seedMember(store, actor)
  store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(createHash('sha256').update('account-fixture-cookie').digest('hex'), actor.userId, actor.tenantId, Date.now() + 60000)
  const app = await buildApp(store, { workers: false }); t.after(() => app.close())
  const seen: any[] = []
  const request = createEngineClient((async (path, options = {}) => {
    assert.equal(options.credentials, 'include'); assert.equal((options.headers as any).Authorization, undefined); seen.push({ path: String(path), body: options.body ? JSON.parse(String(options.body)) : undefined })
    const response = await app.inject({ method: options.method as any ?? 'GET', url: String(path), headers: { ...options.headers as Record<string, string>, cookie: 'kloel_session=account-fixture-cookie' }, ...(options.body ? { payload: String(options.body) } : {}) })
    return new Response(response.statusCode === 204 ? null : response.body, { status: response.statusCode, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch)
  const context = { tenantId: actor.tenantId, generation: 1, assertCurrent() {}, request }
  return { store, actor, context, seen, client: accountClient(context, actor.userId) }
}

test('profile persists real identity metadata, preserves immutable fields and rejects stale revisions', async t => {
  const f = await fixture(t), initial = await f.client.profile()
  assert.equal(initial.revision, 0)
  const draft = { firstName: 'Ana', lastName: 'Silva', language: 'pt-BR', phone: '+55 (11) 99999-0000' }
  const saved = await f.client.saveProfile(initial, draft)
  assert.equal(saved.revision, 1); assert.equal(saved.phone, '+5511999990000'); assert.equal(saved.email, initial.email)
  assert.equal((await f.client.profile()).lastName, 'Silva')
  await assert.rejects(f.client.saveProfile(initial, { ...draft, firstName: 'Stale' }), (e: any) => e.code === 'profile_revision_conflict')
  assert.equal((await f.client.profile()).firstName, 'Ana')
  const sent = f.seen.find(call => call.body?.revision === 0).body
  assert.equal(sent.email, undefined); assert.equal(sent.password, undefined); assert.equal(sent.role, undefined)
  await assert.rejects(f.client.saveProfile({ ...saved, id: 'someone-else' }, draft), EngineError)
})

test('OAuth remains disconnected until callback, connection lists redact secrets and disconnect removes local authority', async t => {
  const f = await fixture(t), state = await f.client.status()
  assert.equal(state.find(p => p.provider === 'google')?.configured, true); assert.equal(state.find(p => p.provider === 'google')?.connectedAccounts, 0)
  const url = new URL(await f.client.start('google', ['calendar_write']))
  assert.equal(url.origin, 'https://accounts.google.com'); assert.match(url.searchParams.get('scope')!, /calendar/)
  assert.deepEqual(await f.client.connections(), [])
  assert.deepEqual(f.seen.find(call => call.path.endsWith('/oauth/google/start')).body, { capabilities: ['calendar_write'], visibility: 'personal' })
  const record = f.store.create(f.actor.tenantId, 'oauth-connections', { provider: 'google', userId: f.actor.userId, email: 'fixture@example.test', displayName: 'Fixture', visibility: 'personal', capabilities: ['calendar'], status: 'connected', authorizationGeneration: 1, encryptedTokens: 'fixture-sensitive-data', remoteId: 'private-provider-id' })
  f.store.create(f.actor.tenantId, 'oauth-connections', { ...record, userId: 'different-user', visibility: 'personal' })
  const connections = await f.client.connections(); assert.equal(connections.length, 1); assert.equal(connections[0].id, record.id)
  assert.equal(JSON.stringify(connections).includes('fixture-sensitive-data'), false); assert.equal(JSON.stringify(connections).includes('private-provider-id'), false)
  const revoked = await f.client.disconnect(record.id); assert.equal(revoked.revokedAtProvider, false)
  assert.equal(f.store.get(f.actor.tenantId, 'oauth-connections', record.id)?.encryptedTokens, null)
  assert.equal((await f.client.connections())[0].status, 'disconnected')
  f.store.db.prepare("UPDATE memberships SET role='viewer' WHERE user_id=?").run(f.actor.userId)
  await assert.rejects(f.client.start('google', ['email']), (e: any) => e.status === 403)
})

test('OAuth URLs reject unrelated destinations and uncertain requests are never retried', async () => {
  for (const url of ['https://accounts.google.com.evil.test/o/oauth2/v2/auth', 'https://accounts.google.com@evil.test/', 'javascript:alert(1)', 'http://accounts.google.com/o/oauth2/v2/auth', 'https://accounts.google.com/o/oauth2/v2/auth#token', 'https://accounts.google.com/other']) assert.throws(() => authorizationUrl(url, 'google'), EngineError)
  assert.equal(new URL(authorizationUrl('https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=test', 'microsoft')).hostname, 'login.microsoftonline.com')
  let attempts = 0
  const failing = accountClient({ tenantId: 'T', generation: 1, assertCurrent() {}, request: createEngineClient((async () => { attempts++; throw Error('lost') }) as typeof fetch) }, 'U')
  await assert.rejects(failing.start('google', ['calendar']), (e: any) => e.code === 'network_error'); assert.equal(attempts, 1)
  await assert.rejects(failing.start('microsoft', ['sheets_read']), EngineError); assert.equal(attempts, 1)
  const mismatched = accountClient({ tenantId: 'T', generation: 1, assertCurrent() {}, request: (async () => ({ id: 'different-user' })) as EngineRequest }, 'U')
  await assert.rejects(mismatched.profile(), EngineError)
})
