import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { buildApp } from '../../src/app.js';
import { Store } from '../../src/store.js';
import { seedMember } from './membership.js';
export const digest = (v: string) => createHash('sha256').update(v).digest('hex');
export async function whatsappChannelsFixture(t: any) {
  const tenant = 'wa-config', oldEnv = { ...process.env }, oldFetch = globalThis.fetch;
  const env = { PROVIDER_TENANT_ID: tenant, META_PHONE_NUMBER_ID: '12345', META_ACCESS_TOKEN: 'synthetic-meta-token', META_GRAPH_VERSION: 'v25.0', META_APP_SECRET: 'synthetic-app-secret', META_VERIFY_TOKEN: 'synthetic-verify-token', OPENAI_API_KEY: 'synthetic-openai-key', OPENAI_MODEL: 'synthetic-model', WHATSAPP_AUTOREPLY_ENABLED: 'true' };
  Object.assign(process.env, env); const calls: { url: string; init: RequestInit }[] = [], hooks: { provider?: (url: string, init: RequestInit) => Promise<Response> | Response } = {};
  globalThis.fetch = (async (url: any, init: RequestInit = {}) => { calls.push({ url: String(url), init }); if (!hooks.provider) throw Error('Unexpected network denied'); return hooks.provider(String(url), init); }) as typeof fetch;
  const store = new Store(), actors = { owner: { userId: 'wa-owner', tenantId: tenant, role: 'owner' as const }, other: { userId: 'wa-other', tenantId: tenant, role: 'owner' as const }, editor: { userId: 'wa-editor', tenantId: tenant, role: 'editor' as const }, member: { userId: 'wa-member', tenantId: tenant, role: 'member' as const }, foreign: { userId: 'wa-foreign', tenantId: 'wa-foreign-tenant', role: 'owner' as const } };
  const cookies: Record<string, string> = {}, contexts: Record<string, Record<string, string>> = {};
  for (const [name, actor] of Object.entries(actors)) { seedMember(store, actor); cookies[name] = 'synthetic-wa-cookie-' + name; store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(digest(cookies[name]), actor.userId, actor.tenantId, Date.now() + 3600000); }
  const agent = store.create(tenant, 'agents', { name: 'WhatsApp agent', status: 'active', tools: [], settings: {}, prompt: 'Synthetic only' });
  const app = await buildApp(store, { workers: false }); await app.ready();
  t.after(async () => { await app.close(); globalThis.fetch = oldFetch; for (const k of Object.keys(env)) if (oldEnv[k] === undefined) delete process.env[k]; else process.env[k] = oldEnv[k]; });
  const refreshContext = async (name = 'owner') => { const r = await app.inject({ url: '/api/v1/auth/me', headers: { cookie: 'kloel_session=' + cookies[name] } }); assert.equal(r.statusCode, 200, r.body); const c = r.json().context; contexts[name] = { 'x-kloel-expected-user': c.userId, 'x-kloel-expected-tenant': c.tenantId, 'x-kloel-expected-membership': c.membershipId, 'x-kloel-expected-authority': c.authorityVersion }; };
  for (const name of Object.keys(actors)) await refreshContext(name);
  const request = (method: any, path: string, payload?: unknown, key?: string, who = 'owner', extra: Record<string, string> = {}) => app.inject({ method, url: path.startsWith('/api/') ? path : '/api/v1/whatsapp' + path, headers: { cookie: 'kloel_session=' + cookies[who], ...contexts[who], ...(key ? { 'idempotency-key': key } : {}), ...extra }, ...(payload === undefined ? {} : { payload }) });
  const input = (extra: Record<string, unknown> = {}) => ({ expectedTenantId: tenant, name: 'WhatsApp local', externalId: '12345', address: '+5511999999999', agentId: agent.id, ...extra });
  const read = async (id: string, who = 'owner') => { const r = await request('GET', '/channels/' + id, undefined, undefined, who); assert.equal(r.statusCode, 200, r.body); return r.json(); };
  const create = async (extra: Record<string, unknown> = {}, who = 'owner') => { const key = randomUUID(), body = input(extra), r = await request('POST', '/channels', body, key, who); assert.equal(r.statusCode, 201, r.body); return { row: await read(r.json().operation.channelId, who), operation: r.json().operation, body, key }; };
  const control = (row: any, extra: Record<string, unknown> = {}) => ({ expectedTenantId: tenant, expectedVersion: row.version, ...extra });
  const change = async (row: any, kind: 'update' | 'enable' | 'disable', extra: Record<string, unknown> = {}, who = 'owner') => { const key = randomUUID(), r = await request(kind === 'update' ? 'PATCH' : 'POST', '/channels/' + row.id + (kind === 'update' ? '' : '/' + kind), control(row, extra), key, who); assert.equal(r.statusCode, 200, r.body); return read(row.id, who); };
  const aba = () => { for (const role of ['admin', 'owner']) store.db.prepare('UPDATE memberships SET role=? WHERE tenant_id=? AND user_id=?').run(role, tenant, actors.owner.userId); };
  return { app, store, tenant, actors, cookies, contexts, refreshContext, request, input, read, create, control, change, aba, agent, env, calls, hooks, snapshot: () => store.db.prepare('SELECT * FROM entities ORDER BY rowid').all() };
}
