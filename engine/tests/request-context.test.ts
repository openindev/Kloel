import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { ZodError } from 'zod';
import { registerAuth, hashPassword, sessionDigest } from '../src/auth.js';
import { registerMembers } from '../src/members.js';
import { Store } from '../src/store.js';
import { requireRequestPermission } from '../src/memberships/access.js';
import { assertRequestContext, CONTEXT_HEADERS, parseExpectedRequestContext, resolveSessionContext, type ExpectedRequestContext } from '../src/request-context.js';
import { seedMember } from './fixtures/membership.js';

const password = 'request-context-test-password';
const passwordHash = hashPassword(password);
const headersOf = (context: ExpectedRequestContext) => Object.fromEntries(Object.entries(CONTEXT_HEADERS).map(([key, header]) => [header, context[key as keyof ExpectedRequestContext] ?? '-']));
const cookieOf = (response: any) => ({ kloel_session: response.cookies.find((item: any) => item.name === 'kloel_session').value as string });
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };

async function fixture(t: TestContext, configure?: (app: FastifyInstance, store: Store) => void) {
  const store = new Store(), app = Fastify();
  await app.register(cookie);
  app.setErrorHandler((error, _request, reply) => {
    const e = error as { statusCode?: number; code?: string; message?: string };
    reply.code(error instanceof ZodError ? 400 : e.statusCode || 500).send({ error: { code: e.code || 'validation_error', message: e.message } });
  });
  seedMember(store, { userId: 'owner-a', tenantId: 'tenant-a', role: 'owner' });
  seedMember(store, { userId: 'owner-a', tenantId: 'tenant-b', role: 'owner' });
  seedMember(store, { userId: 'owner-b', tenantId: 'tenant-b', role: 'owner' });
  store.db.prepare('UPDATE users SET password=?').run(passwordHash);
  for (const [token, user, tenant] of [['context-token-a', 'owner-a', 'tenant-a'], ['context-token-b', 'owner-b', 'tenant-b']]) {
    store.db.prepare('INSERT INTO sessions(hash,user_id,expires,tenant_id) VALUES(?,?,?,?)').run(sessionDigest(token), user, Date.now() + 60000, tenant);
  }
  await registerAuth(app, store);
  app.get('/api/v1/context-probe', async request => ({ actor: requireRequestPermission(store, request, 'contacts:read') }));
  app.get('/api/v1/contacts', async request => ({ tenantId: requireRequestPermission(store, request, 'contacts:read').tenantId }));
  app.post('/api/v1/context-probe', async request => store.transaction(() => {
    const actor = requireRequestPermission(store, request, 'contacts:write');
    return store.create(actor.tenantId, 'context-probe', { userId: actor.userId });
  }));
  configure?.(app, store);
  t.after(async () => { await app.close(); store.close(); });
  const cookies = { kloel_session: 'context-token-a' }, context = resolveSessionContext(store, sessionDigest(cookies.kloel_session))!.context;
  return { app, store, cookies, context, headers: headersOf(context) };
}

test('auth/me publishes a stable opaque context bound to the live session and selected membership', async t => {
  const f = await fixture(t), first = await f.app.inject({ url: '/api/v1/auth/me', cookies: f.cookies });
  assert.equal(first.statusCode, 200, first.body);
  const dto = first.json(); assert.deepEqual(dto.context, f.context);
  assert.equal(dto.context.userId, dto.userId); assert.equal(dto.context.tenantId, dto.tenantId);
  assert.equal(dto.context.membershipId, dto.organizations.find((org: any) => org.tenantId === dto.tenantId).membershipId);
  assert.match(dto.context.authorityVersion, /^[a-f0-9]{64}$/);
  assert.ok(!first.body.includes(f.cookies.kloel_session)); assert.ok(!first.body.includes(sessionDigest(f.cookies.kloel_session)));
  const second = await f.app.inject({ url: '/api/v1/auth/me', cookies: f.cookies, headers: f.headers });
  assert.deepEqual(second.json().context, f.context);
  f.store.db.prepare('UPDATE organizations SET name=? WHERE id=?').run('Presentation only', 'tenant-a');
  f.store.db.prepare('UPDATE users SET email=? WHERE id=?').run('renamed@example.test', 'owner-a');
  assert.deepEqual((await f.app.inject({ url: '/api/v1/auth/me', cookies: f.cookies, headers: f.headers })).json().context, f.context);
});

test('all headers absent deliberately preserves legacy cookie and public credential callers', async t => {
  const f = await fixture(t);
  assert.equal((await f.app.inject({ method: 'POST', url: '/api/v1/context-probe', cookies: f.cookies })).statusCode, 200);
  assert.equal(f.store.list('tenant-a', 'context-probe').length, 1);
  const login = await f.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'owner-a@example.test', password } });
  assert.equal(login.statusCode, 200, login.body);
  const context = login.json().context;
  assert.notEqual(context.authorityVersion, f.context.authorityVersion);
  assert.deepEqual((await f.app.inject({ url: '/api/v1/auth/me', cookies: cookieOf(login), headers: headersOf(context) })).json().context, context);
});

for (const key of Object.keys(CONTEXT_HEADERS) as (keyof ExpectedRequestContext)[]) {
  test(`mismatched ${key} rejects before any private effect`, async t => {
    const f = await fixture(t), headers = { ...f.headers, [CONTEXT_HEADERS[key]]: key === 'authorityVersion' ? 'a'.repeat(64) : 'foreign-value' };
    const response = await f.app.inject({ method: 'POST', url: '/api/v1/context-probe', cookies: f.cookies, headers });
    assert.equal(response.statusCode, 409, response.body); assert.equal(response.json().error.code, 'context_mismatch');
    assert.equal(f.store.list('tenant-a', 'context-probe').length, 0); assert.equal(f.store.list('tenant-b', 'context-probe').length, 0);
    assert.ok(!response.body.includes(f.context.membershipId!));
  });
}

test('cookie switched to another tenant before dispatch cannot apply the captured old intention', async t => {
  const f = await fixture(t);
  const switched = await f.app.inject({ method: 'POST', url: '/api/v1/auth/select-organization', cookies: f.cookies, headers: f.headers, payload: { tenantId: 'tenant-b' } });
  assert.equal(switched.statusCode, 200, switched.body);
  const response = await f.app.inject({ method: 'POST', url: '/api/v1/context-probe', cookies: cookieOf(switched), headers: f.headers });
  assert.equal(response.statusCode, 409); assert.equal(response.json().error.code, 'context_mismatch');
  assert.equal(f.store.list('tenant-a', 'context-probe').length, 0); assert.equal(f.store.list('tenant-b', 'context-probe').length, 0);
});

test('another user cookie cannot read old hydration context or create under the new identity', async t => {
  const f = await fixture(t), cookies = { kloel_session: 'context-token-b' };
  for (const url of ['/api/v1/auth/me', '/api/v1/organizations', '/api/v1/context-probe']) {
    const response = await f.app.inject({ url, cookies, headers: f.headers });
    assert.equal(response.statusCode, 409, response.body); assert.equal(response.json().error.code, 'context_mismatch');
    assert.ok(!response.body.includes('owner-b'));
  }
  assert.equal((await f.app.inject({ method: 'POST', url: '/api/v1/context-probe', cookies, headers: f.headers })).statusCode, 409);
  assert.equal(f.store.list('tenant-b', 'context-probe').length, 0);
});

test('session A to B to A cannot revive an earlier context despite identical user, tenant and role', async t => {
  const f = await fixture(t);
  const b = await f.app.inject({ method: 'POST', url: '/api/v1/auth/select-organization', cookies: f.cookies, headers: f.headers, payload: { tenantId: 'tenant-b' } });
  const a = await f.app.inject({ method: 'POST', url: '/api/v1/auth/select-organization', cookies: cookieOf(b), headers: headersOf(b.json().context), payload: { tenantId: 'tenant-a' } });
  assert.equal(a.statusCode, 200, a.body); assert.equal(a.json().context.membershipId, f.context.membershipId);
  assert.notEqual(a.json().context.authorityVersion, f.context.authorityVersion);
  assert.equal((await f.app.inject({ url: '/api/v1/auth/me', cookies: cookieOf(a), headers: f.headers })).statusCode, 409);
});

test('role ABA and member remove/rejoin each invalidate old versions', async t => {
  const f = await fixture(t);
  f.store.db.prepare("UPDATE memberships SET role='member' WHERE id=?").run(f.context.membershipId!);
  f.store.db.prepare("UPDATE memberships SET role='owner' WHERE id=?").run(f.context.membershipId!);
  const changed = resolveSessionContext(f.store, sessionDigest(f.cookies.kloel_session))!.context;
  assert.notEqual(changed.authorityVersion, f.context.authorityVersion);
  assert.equal((await f.app.inject({ url: '/api/v1/context-probe', cookies: f.cookies, headers: f.headers })).statusCode, 409);
  f.store.db.prepare('DELETE FROM memberships WHERE id=?').run(f.context.membershipId!);
  seedMember(f.store, { userId: 'owner-a', tenantId: 'tenant-a', role: 'owner' });
  const rejoined = resolveSessionContext(f.store, sessionDigest(f.cookies.kloel_session))!.context;
  assert.notEqual(rejoined.membershipId, f.context.membershipId);
  assert.equal((await f.app.inject({ url: '/api/v1/context-probe', cookies: f.cookies, headers: headersOf(changed) })).statusCode, 409);
});

test('nullable organization context remains valid for create then select, without inventing membership', async t => {
  const f = await fixture(t);
  f.store.db.prepare('UPDATE sessions SET tenant_id=NULL WHERE hash=?').run(sessionDigest(f.cookies.kloel_session));
  const me = (await f.app.inject({ url: '/api/v1/auth/me', cookies: f.cookies })).json();
  assert.equal(me.context.tenantId, null); assert.equal(me.context.membershipId, null);
  const headers = headersOf(me.context);
  assert.equal(headers[CONTEXT_HEADERS.tenantId], '-');
  const created = await f.app.inject({ method: 'POST', url: '/api/v1/organizations', cookies: f.cookies, headers, payload: { name: 'New organization' } });
  assert.equal(created.statusCode, 201, created.body);
  assert.deepEqual((await f.app.inject({ url: '/api/v1/auth/me', cookies: f.cookies, headers })).json().context, me.context);
  const selected = await f.app.inject({ method: 'POST', url: '/api/v1/auth/select-organization', cookies: f.cookies, headers, payload: { tenantId: created.json().tenantId } });
  assert.equal(selected.statusCode, 200); assert.equal(selected.json().context.tenantId, created.json().tenantId);
});

for (const mode of ['partial', 'empty', 'duplicate', 'bad-version', 'mismatched-null'] as const) {
  test(`malformed ${mode} context cannot downgrade on cookie, public or Bearer paths`, async t => {
    const f = await fixture(t);
    const headers: Record<string, string> = mode === 'partial' ? { [CONTEXT_HEADERS.userId]: 'owner-a' } : { ...f.headers };
    if (mode === 'empty') headers[CONTEXT_HEADERS.userId] = '';
    if (mode === 'duplicate') headers[CONTEXT_HEADERS.userId] = 'owner-a, owner-a';
    if (mode === 'bad-version') headers[CONTEXT_HEADERS.authorityVersion] = 'not-a-version';
    if (mode === 'mismatched-null') headers[CONTEXT_HEADERS.tenantId] = '-';
    for (const [url, authorization] of [['/api/v1/context-probe', undefined], ['/api/v1/auth/login', undefined], ['/api/v1/contacts', 'Bearer invalid-key']] as const) {
      const result = await f.app.inject({ method: 'POST', url, cookies: f.cookies, headers: { ...headers, ...(authorization ? { authorization } : {}) }, payload: {} });
      assert.equal(result.statusCode, 400, result.body); assert.equal(result.json().error.code, 'invalid_context');
    }
  });
}

test('complete context is refused for public proofs and API keys while headerless key authority remains valid', async t => {
  const f = await fixture(t);
  const key = await f.app.inject({ method: 'POST', url: '/api/v1/api-keys', cookies: f.cookies, headers: f.headers, payload: { name: 'Context test', scopes: ['contacts:read'] } });
  assert.equal(key.statusCode, 201, key.body);
  const authorization = `Bearer ${key.json().secret}`;
  assert.equal((await f.app.inject({ url: '/api/v1/contacts', headers: { authorization } })).statusCode, 200);
  for (const [url, auth] of [['/api/v1/auth/login', undefined], ['/api/v1/contacts', authorization]] as const) {
    const response = await f.app.inject({ url, headers: { ...f.headers, ...(auth ? { authorization: auth } : {}) }, cookies: f.cookies });
    assert.equal(response.statusCode, 400); assert.equal(response.json().error.code, 'context_not_applicable');
  }
  assert.equal((await f.app.inject({ url: '/api/v1/contacts', cookies: f.cookies, headers: { authorization: 'Bearer invalid' } })).statusCode, 401);
});

test('captured headers are immutable after admission even if a handler rewrites raw headers', async t => {
  const f = await fixture(t, (app, store) => app.post('/api/v1/rewrite-headers', async request => {
    store.db.prepare('UPDATE memberships SET revision=revision+1 WHERE id=?').run(parseExpectedRequestContext(request)!.membershipId!);
    const fresh = resolveSessionContext(store, sessionDigest(request.cookies.kloel_session!))!.context;
    Object.assign(request.headers, headersOf(fresh));
    assertRequestContext(store, request);
    return { unexpected: true };
  }));
  const response = await f.app.inject({ method: 'POST', url: '/api/v1/rewrite-headers', cookies: f.cookies, headers: f.headers });
  assert.equal(response.statusCode, 409); assert.equal(response.json().error.code, 'context_changed_in_flight');
});

for (const action of ['create', 'select', 'logout'] as const) {
  test(`${action} auth command rechecks context inside its transaction`, async t => {
    const f = await fixture(t), transact = f.store.transaction.bind(f.store);
    let intercepted = false;
    f.store.transaction = fn => {
      if (!intercepted) { intercepted = true; f.store.db.prepare('UPDATE memberships SET revision=revision+1 WHERE id=?').run(f.context.membershipId!); }
      return transact(fn);
    };
    const url = action === 'create' ? '/api/v1/organizations' : `/api/v1/auth/${action === 'select' ? 'select-organization' : 'logout'}`;
    const payload = action === 'create' ? { name: 'Must not exist' } : action === 'select' ? { tenantId: 'tenant-b' } : undefined;
    const response = await f.app.inject({ method: 'POST', url, cookies: f.cookies, headers: f.headers, payload });
    assert.equal(response.statusCode, 409, response.body); assert.equal(response.json().error.code, 'context_changed_in_flight');
    assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM organizations').get()!.n, 2);
    assert.equal(f.store.db.prepare('SELECT tenant_id FROM sessions WHERE hash=?').get(sessionDigest(f.cookies.kloel_session))!.tenant_id, 'tenant-a');
    assert.equal(response.cookies.length, 0);
  });
}

test('fresh permission helper stops a late continuation but accepted effect receipt remains durable', async t => {
  const entered = deferred(), release = deferred(); let calls = 0;
  const f = await fixture(t, (app, store) => app.post('/api/v1/remote-probe', async request => {
    const actor = requireRequestPermission(store, request, 'contacts:write');
    calls++; entered.resolve(); await release.promise;
    // An upstream acceptance must be recorded before checking whether the caller still has access.
    store.transaction(() => store.create(actor.tenantId, 'accepted-receipts', { upstreamId: 'synthetic-accepted' }));
    requireRequestPermission(store, request, 'contacts:write');
    return { secretResult: 'must-not-return' };
  }));
  const pending = f.app.inject({ method: 'POST', url: '/api/v1/remote-probe', cookies: f.cookies, headers: f.headers }).then(response => response);
  await entered.promise;
  f.store.db.prepare('DELETE FROM sessions WHERE hash=?').run(sessionDigest(f.cookies.kloel_session));
  release.resolve(); const response = await pending;
  assert.equal(response.statusCode, 409, response.body); assert.equal(response.json().error.code, 'context_changed_in_flight');
  assert.ok(!response.body.includes('must-not-return')); assert.equal(calls, 1);
  assert.equal(f.store.list('tenant-a', 'accepted-receipts').length, 1);
});

for (const change of ['role-aba', 'session-revoked'] as const) {
  test(`preHandler rejects ${change} during body parsing before any handler effect`, async t => {
    const entered = deferred(), release = deferred();
    const f = await fixture(t, app => app.addHook('preParsing', async (request, _reply, payload) => {
      if (request.url === '/api/v1/context-probe') { entered.resolve(); await release.promise; }
      return payload;
    }));
    const pending = f.app.inject({ method: 'POST', url: '/api/v1/context-probe', cookies: f.cookies, headers: f.headers, payload: { prepared: true } }).then(value => value);
    await entered.promise;
    if (change === 'role-aba') {
      f.store.db.prepare("UPDATE memberships SET role='member' WHERE id=?").run(f.context.membershipId!);
      f.store.db.prepare("UPDATE memberships SET role='owner' WHERE id=?").run(f.context.membershipId!);
    } else f.store.db.prepare('DELETE FROM sessions WHERE hash=?').run(sessionDigest(f.cookies.kloel_session));
    release.resolve(); const response = await pending;
    assert.equal(response.statusCode, 409, response.body); assert.equal(response.json().error.code, 'context_mismatch');
    assert.equal(f.store.list('tenant-a', 'context-probe').length, 0); assert.equal(f.store.list('tenant-b', 'context-probe').length, 0);
  });
}

test('public invitation accept and recovery each return the proof of their newly rotated session', async t => {
  const previous = process.env.OAUTH_ENCRYPTION_KEY; process.env.OAUTH_ENCRYPTION_KEY = Buffer.alloc(32, 53).toString('base64');
  t.after(() => { if (previous === undefined) delete process.env.OAUTH_ENCRYPTION_KEY; else process.env.OAUTH_ENCRYPTION_KEY = previous; });
  const f = await fixture(t); await registerMembers(f.app, f.store);
  const invitation = await f.app.inject({ method: 'POST', url: '/api/v1/invitations', cookies: f.cookies, headers: f.headers,
    payload: { email: 'new-context@example.test', role: 'member', expectedTenantId: 'tenant-a', idempotencyKey: randomUUID() } });
  assert.equal(invitation.statusCode, 201, invitation.body);
  const token = new URL(invitation.json().localAcceptancePath, 'http://localhost').hash.slice('#token='.length), idempotencyKey = randomUUID();
  const accepted = await f.app.inject({ method: 'POST', url: '/api/v1/auth/accept-invite', payload: { email: 'new-context@example.test', password, token, idempotencyKey } });
  assert.equal(accepted.statusCode, 201, accepted.body);
  const first = accepted.json();
  assert.equal(first.context.userId, first.userId); assert.equal(first.context.tenantId, first.tenantId); assert.equal(first.context.membershipId, first.membershipId);
  assert.deepEqual((await f.app.inject({ url: '/api/v1/auth/me', cookies: cookieOf(accepted), headers: headersOf(first.context) })).json().context, first.context);
  const recovered = await f.app.inject({ method: 'POST', url: '/api/v1/auth/accept-invite', payload: { action: 'recover', email: 'new-context@example.test', password, idempotencyKey } });
  assert.equal(recovered.statusCode, 200, recovered.body);
  assert.notEqual(recovered.json().context.authorityVersion, first.context.authorityVersion);
  assert.equal(recovered.json().context.membershipId, first.context.membershipId);
  const staleLogout = await f.app.inject({ method: 'POST', url: '/api/v1/auth/logout', cookies: cookieOf(recovered), headers: headersOf(first.context) });
  assert.equal(staleLogout.statusCode, 409);
  const logout = await f.app.inject({ method: 'POST', url: '/api/v1/auth/logout', cookies: cookieOf(recovered), headers: headersOf(recovered.json().context) });
  assert.equal(logout.statusCode, 200, logout.body);
});
