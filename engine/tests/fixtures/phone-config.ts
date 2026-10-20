import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { buildApp } from '../../src/app.js';
import { Store } from '../../src/store.js';
import { seedMember } from './membership.js';

export const phone = '+551132345678', sid = 'PN' + '1'.repeat(32), account = 'AC' + '2'.repeat(32);
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export async function phoneConfigFixture(t: any) {
  const tenant = 'phone-config-tenant', savedEnv = { ...process.env }, savedFetch = globalThis.fetch;
  const env = { PROVIDER_TENANT_ID: tenant, TWILIO_ACCOUNT_SID: account, TWILIO_AUTH_TOKEN: 'synthetic-phone-token' };
  Object.assign(process.env, env);
  const calls: { url: string; method: string; redirect: string | undefined }[] = [];
  const hooks: { provider?: (url: URL, init: RequestInit) => Response | void | Promise<Response | void> } = {};
  globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input.toString() : input.url);
    calls.push({ url: url.href, method: init.method ?? 'GET', redirect: init.redirect });
    assert.equal(url.origin, 'https://api.twilio.com'); assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error');
    assert.equal(url.pathname, `/2010-04-01/Accounts/${account}/IncomingPhoneNumbers.json`);
    const mocked = await hooks.provider?.(url, init); if (mocked) return mocked;
    return Response.json({ incoming_phone_numbers: [{ sid, account_sid: account, phone_number: phone, capabilities: { voice: true, sms: true } }], next_page_uri: null });
  }) as typeof fetch;
  const store = new Store(':memory:');
  const actors = {
    owner: { tenantId: tenant, userId: 'phone-owner', role: 'owner' as const },
    other: { tenantId: tenant, userId: 'phone-other', role: 'owner' as const },
    editor: { tenantId: tenant, userId: 'phone-editor', role: 'editor' as const },
    member: { tenantId: tenant, userId: 'phone-member', role: 'member' as const },
    foreign: { tenantId: 'phone-foreign', userId: 'phone-foreign-owner', role: 'owner' as const },
  };
  const cookies: Record<string, string> = {};
  for (const [name, actor] of Object.entries(actors)) {
    seedMember(store, actor); cookies[name] = 'synthetic-phone-cookie-' + name;
    store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(hash(cookies[name]), actor.userId, actor.tenantId, Date.now() + 3600000);
  }
  const agent = store.create(tenant, 'agents', { name: 'Phone assistant', status: 'active', prompt: 'Synthetic', settings: {}, tools: [] });
  const channel = store.create(tenant, 'channels', { name: 'Phone channel', type: 'phone', provider: 'twilio', enabled: true, agentId: agent.id });
  const app = await buildApp(store, { workers: false }); await app.ready();
  t.after(async () => { await app.close(); globalThis.fetch = savedFetch; for (const key of Object.keys(env)) { if (savedEnv[key] === undefined) delete process.env[key]; else process.env[key] = savedEnv[key]; } });
  const contexts: Record<string, Record<string, string>> = {};
  const refreshContext = async (name = 'owner') => {
    const res = await app.inject({ url: '/api/v1/auth/me', headers: { cookie: 'kloel_session=' + cookies[name] } }); assert.equal(res.statusCode, 200, res.body);
    const c = res.json().context;
    contexts[name] = { 'x-kloel-expected-user': c.userId, 'x-kloel-expected-tenant': c.tenantId ?? '-', 'x-kloel-expected-membership': c.membershipId ?? '-', 'x-kloel-expected-authority': c.authorityVersion };
  };
  for (const name of Object.keys(actors)) await refreshContext(name);
  const request = (method: any, path: string, body?: unknown, key?: string, name = 'owner', extra: Record<string, string> = {}) => app.inject({ method, url: path.startsWith('/api/') ? path : '/api/v1/phone-config' + path,
    headers: { cookie: 'kloel_session=' + cookies[name], ...contexts[name], ...(key ? { 'idempotency-key': key } : {}), ...extra }, ...(body === undefined ? {} : { payload: body }) });
  const input = (extra: Record<string, unknown> = {}) => ({ expectedTenantId: tenant, name: 'Local phone', number: phone, providerNumberId: sid, agentId: null, channelId: null, ...extra });
  const create = async (extra: Record<string, unknown> = {}, name = 'owner') => {
    const key = randomUUID(), body = input(extra), response = await request('POST', '/numbers', body, key, name); assert.equal(response.statusCode, 201, response.body);
    const operation = response.json().operation, read = await request('GET', '/numbers/' + operation.numberId, undefined, undefined, name); assert.equal(read.statusCode, 200, read.body);
    return { row: read.json(), operation, key, body };
  };
  const control = (row: any, extra: Record<string, unknown> = {}) => ({ expectedTenantId: tenant, expectedVersion: row.version, ...extra });
  const snapshot = () => store.db.prepare('SELECT * FROM entities ORDER BY rowid').all();
  const aba = () => { for (const role of ['admin', 'owner']) store.db.prepare('UPDATE memberships SET role=? WHERE tenant_id=? AND user_id=?').run(role, tenant, actors.owner.userId); };
  return { app, store, tenant, actors, cookies, contexts, refreshContext, agent, channel, request, input, create, control, calls, hooks, snapshot, aba };
}
