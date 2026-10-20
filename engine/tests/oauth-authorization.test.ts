import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { Store } from '../src/store.js';
import { seal, unseal } from '../src/oauth/crypto.js';
import { accessTokens, tokenContext, oauthAuthorizationGeneration, oauthAuthorizationIdentity, updateOAuthAuthorization } from '../src/oauth/access.js';
import { authorizedOAuthRequest } from '../src/oauth/authorization.js';
import type { Tokens } from '../src/oauth/client.js';
import { seedMember } from './fixtures/membership.js';

const scope = 'https://www.googleapis.com/auth/gmail.readonly';
const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
const response = (access = 'new-fixture-access', nextScope = scope) => json({ access_token: access, token_type: 'Bearer', expires_in: 3600, scope: nextScope });
function fixture(t: any) {
  const env = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'OAUTH_ENCRYPTION_KEY', 'PUBLIC_BASE_URL'];
  const previous = Object.fromEntries(env.map(name => [name, process.env[name]])), fetchBefore = globalThis.fetch;
  process.env.GOOGLE_CLIENT_ID = 'fixture-client'; process.env.GOOGLE_CLIENT_SECRET = 'fixture-secret'; process.env.OAUTH_ENCRYPTION_KEY = randomBytes(32).toString('base64'); delete process.env.PUBLIC_BASE_URL;
  const store = new Store(), actor = { userId: randomUUID(), tenantId: randomUUID(), role: 'owner' as const }; seedMember(store, actor);
  const created = store.create(actor.tenantId, 'oauth-connections', { provider: 'google', remoteId: 'fixture-remote', email: 'mail@example.test', userId: actor.userId, visibility: 'personal', capabilities: ['email'], scopes: scope, status: 'connected' });
  const connection = store.update(actor.tenantId, 'oauth-connections', created.id, { encryptedTokens: seal({ accessToken: 'expired-fixture', refreshToken: 'fixture-refresh', expiresAt: 0, scope }, tokenContext(created)) })!;
  globalThis.fetch = async () => { throw new Error('Unexpected unmocked transport'); };
  t.after(() => { store.close(); globalThis.fetch = fetchBefore; for (const [name, value] of Object.entries(previous)) if (value === undefined) delete process.env[name]; else process.env[name] = value; });
  const current = () => store.get(actor.tenantId, 'oauth-connections', connection.id)!;
  const change = (patch: Record<string, unknown>) => store.transaction(() => updateOAuthAuthorization(store, current(), patch));
  return { store, actor, connection, current, change };
}

test('authorization helpers preserve legacy zero, reject invalid versions and ignore only token bookkeeping', t => {
  const f = fixture(t), identity = oauthAuthorizationIdentity(f.connection);
  assert.equal(oauthAuthorizationGeneration(f.connection), 0);
  assert.equal(oauthAuthorizationIdentity({ ...f.connection, encryptedTokens: 'new-cipher', updatedAt: 'later', displayName: 'Renamed' }), identity);
  for (const patch of [{ authorizationGeneration: 1 }, { provider: 'microsoft' }, { remoteId: 'another' }, { userId: 'another' }, { email: 'other@example.test' }, { visibility: 'shared' }, { capabilities: ['email', 'email_send'] }, { scopes: `${scope} https://www.googleapis.com/auth/gmail.send` }, { status: 'disconnected' }]) assert.notEqual(oauthAuthorizationIdentity({ ...f.connection, ...patch }), identity);
  for (const authorizationGeneration of [-1, 1.5, '1', null, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => oauthAuthorizationGeneration({ ...f.connection, authorizationGeneration }), (e: any) => e.code === 'oauth_authorization_invalid');
  const reordered = { ...f.connection, capabilities: ['email_send', 'email'], scopes: `${scope} https://www.googleapis.com/auth/gmail.send` };
  assert.equal(oauthAuthorizationIdentity(reordered), oauthAuthorizationIdentity({ ...reordered, capabilities: ['email', 'email_send', 'email'], scopes: `https://www.googleapis.com/auth/gmail.send  ${scope}` }));
  assert.notEqual(oauthAuthorizationIdentity(f.connection), oauthAuthorizationIdentity({ ...f.connection, scopes: scope.toUpperCase() }));
});

test('ordinary refresh coalesces callers and preserves authorization generation and identity', async t => {
  const f = fixture(t), identity = oauthAuthorizationIdentity(f.connection); let calls = 0;
  globalThis.fetch = async () => { calls++; await new Promise(resolve => setImmediate(resolve)); return response(); };
  const [first, second] = await Promise.all([accessTokens(f.store, f.connection), accessTokens(f.store, f.connection)]);
  assert.equal(calls, 1); assert.deepEqual(first, second); assert.equal(oauthAuthorizationGeneration(f.current()), 0); assert.equal(oauthAuthorizationIdentity(f.current()), identity);
  assert.equal(unseal<Tokens>(String(f.current().encryptedTokens), tokenContext(f.current())).accessToken, 'new-fixture-access');
});

test('authorization mutation increments the current version and rejects stale mutation snapshots', t => {
  const f = fixture(t);
  let current = f.change({ visibility: 'shared' }); assert.equal(oauthAuthorizationGeneration(current), 1);
  current = f.change({ capabilities: ['email', 'email_send'], scopes: `${scope} https://www.googleapis.com/auth/gmail.send` }); assert.equal(oauthAuthorizationGeneration(current), 2);
  current = f.change({ status: 'disconnected', encryptedTokens: null }); assert.equal(oauthAuthorizationGeneration(current), 3);
  assert.throws(() => f.store.transaction(() => updateOAuthAuthorization(f.store, f.connection, { visibility: 'personal' })), (e: any) => e.code === 'oauth_connection_changed');
  assert.equal(f.current().visibility, 'shared'); assert.equal(f.current().encryptedTokens, null);
});

test('stale connection snapshots are rejected before returning a cached unexpired token', async t => {
  const f = fixture(t); let calls = 0; globalThis.fetch = async () => { calls++; return response(); };
  f.change({ encryptedTokens: seal({ accessToken: 'new-consent', expiresAt: Date.now() + 3600000, scope }, tokenContext(f.connection)) });
  await assert.rejects(accessTokens(f.store, f.connection), (e: any) => e.code === 'oauth_connection_changed'); assert.equal(calls, 0);
});

test('refresh result cannot overwrite changed consent identity even if a writer omitted its generation bump', async t => {
  const f = fixture(t); const before = f.current().encryptedTokens;
  globalThis.fetch = async () => { f.store.update(f.actor.tenantId, 'oauth-connections', f.connection.id, { remoteId: 'changed-identity' }); return response(); };
  await assert.rejects(accessTokens(f.store, f.connection), (e: any) => e.code === 'oauth_connection_changed');
  assert.equal(f.current().encryptedTokens, before);
});

test('late pre-reconnect refresh neither joins nor overwrites the new authorization refresh', async t => {
  const f = fixture(t); let oldRelease: (value: Response) => void = () => {}; let calls = 0;
  globalThis.fetch = async (_url, init) => { calls++; const body = new URLSearchParams(String(init?.body)); if (body.get('refresh_token') === 'fixture-refresh') return new Promise(resolve => { oldRelease = resolve; }); return response('new-generation-access'); };
  const oldWork = accessTokens(f.store, f.connection); const rejected = assert.rejects(oldWork, (e: any) => e.code === 'oauth_connection_changed');
  await new Promise(resolve => setImmediate(resolve));
  f.change({ status: 'disconnected', encryptedTokens: null });
  const connected = f.change({ status: 'connected', encryptedTokens: seal({ accessToken: 'reconnected-expired', refreshToken: 'new-generation-refresh', expiresAt: 0, scope }, tokenContext(f.connection)) });
  const fresh = await accessTokens(f.store, connected); assert.equal(fresh.accessToken, 'new-generation-access'); assert.equal(calls, 2);
  oldRelease(response('obsolete-access')); await rejected;
  assert.equal(oauthAuthorizationGeneration(f.current()), 2); assert.equal(unseal<Tokens>(String(f.current().encryptedTokens), tokenContext(f.current())).accessToken, 'new-generation-access');
});

test('refresh racing with a token replacement cannot overwrite newer credentials within the same consent', async t => {
  const f = fixture(t); const newer = seal({ accessToken: 'other-refresh', expiresAt: Date.now() + 3600000, scope }, tokenContext(f.connection));
  globalThis.fetch = async () => { f.store.update(f.actor.tenantId, 'oauth-connections', f.connection.id, { encryptedTokens: newer }); return response('late-refresh'); };
  await assert.rejects(accessTokens(f.store, f.connection), (e: any) => e.code === 'oauth_tokens_changed'); assert.equal(f.current().encryptedTokens, newer);
});

test('refresh that lost a provider scope requires consent again and does not mutate authorization', async t => {
  const f = fixture(t), before = f.current().encryptedTokens;
  globalThis.fetch = async () => response('changed-scope-token', 'https://www.googleapis.com/auth/gmail.send');
  await assert.rejects(accessTokens(f.store, f.connection), (e: any) => e.code === 'reauthorization_required');
  assert.equal(f.current().encryptedTokens, before); assert.equal(oauthAuthorizationGeneration(f.current()), 0);
});

/**
 * Providers may list scopes consented in another authorization of the same account (Microsoft returns every scope consented
 * for Graph on refresh; ex.: Mail.ReadWrite granted in a reconnection the callback refused). That must not stop the connection,
 * and must not widen it either: the kept token carries only the connection's scopes, and the authorization is unchanged.
 */
test('refresh listing extra scopes consented elsewhere keeps working without widening the authorization', async t => {
  const f = fixture(t), identity = oauthAuthorizationIdentity(f.connection);
  globalThis.fetch = async () => response('wider-token', `${scope} https://www.googleapis.com/auth/gmail.send`);
  const fresh = await accessTokens(f.store, f.connection);
  assert.equal(fresh.accessToken, 'wider-token'); assert.equal(fresh.scope, scope);
  assert.equal(unseal<Tokens>(String(f.current().encryptedTokens), tokenContext(f.current())).scope, scope);
  assert.equal(f.current().scopes, scope); assert.equal(oauthAuthorizationIdentity(f.current()), identity); assert.equal(oauthAuthorizationGeneration(f.current()), 0);
});

test('authorized reads suppress provider output when authorization changes during the request', async t => {
  const f = fixture(t);
  const current = f.store.update(f.actor.tenantId, 'oauth-connections', f.connection.id, { encryptedTokens: seal({ accessToken: 'valid', expiresAt: Date.now() + 3600000, scope }, tokenContext(f.connection)) })!;
  globalThis.fetch = async () => { f.change({}); return json({ privateMessages: ['must-not-publish'] }); };
  await assert.rejects(authorizedOAuthRequest(f.store, f.actor, current, 'https://gmail.googleapis.com/gmail/v1/users/me/messages', {}, false, 'email'), (e: any) => e.code === 'oauth_connection_changed');
});
