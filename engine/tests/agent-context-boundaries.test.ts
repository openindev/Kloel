import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { Store } from '../src/store.js';
import { sessionDigest } from '../src/auth.js';
import { CONTEXT_HEADERS, assertRequestContext, resolveSessionContext } from '../src/request-context.js';
import { seedMember } from './fixtures/membership.js';
import { executeAgentTool, type AgentContext } from '../src/providers/agent-tools.js';
import { configureAction } from '../src/integrations/service.js';
import type { IntegrationTransport } from '../src/integrations/transport.js';
import { seal } from '../src/oauth/crypto.js';
import { tokenContext } from '../src/oauth/access.js';

function fixture(t: TestContext) {
  const previousKey = process.env.OAUTH_ENCRYPTION_KEY, previousFetch = globalThis.fetch;
  process.env.OAUTH_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  const store = new Store(), actor = { userId: 'tool-context-owner', tenantId: 'tool-context-tenant', role: 'owner' as const };
  seedMember(store, actor);
  const cookies = { kloel_session: 'tool-context-session' }, sessionHash = sessionDigest(cookies.kloel_session);
  store.db.prepare('INSERT INTO sessions(hash,user_id,expires,tenant_id) VALUES(?,?,?,?)').run(sessionHash, actor.userId, Date.now() + 60000, actor.tenantId);
  const agent = store.create(actor.tenantId, 'agents', { name: 'Synthetic assistant', status: 'active', tools: ['schedule_appointment'] });
  const context = (): AgentContext => {
    const value = resolveSessionContext(store, sessionHash)!.context;
    const headers = Object.fromEntries(Object.entries(CONTEXT_HEADERS).map(([key, name]) => [name, value[key as keyof typeof value] ?? '-']));
    return { tenantId: actor.tenantId, agent, actor, trustedOperator: true, operatorSessionHash: sessionHash, conversationId: 'synthetic-conversation', liveAuthorization: () => { try { assertRequestContext(store, { cookies, headers }); return true; } catch { return false; } } };
  };
  const roleABA = () => { store.db.prepare("UPDATE memberships SET role='admin' WHERE user_id=?").run(actor.userId); store.db.prepare("UPDATE memberships SET role='owner' WHERE user_id=?").run(actor.userId); };
  const arm = (occurrence = 1) => { const exec = store.db.exec.bind(store.db); let seen = 0, fired = false; store.db.exec = sql => { if (sql.startsWith('BEGIN') && ++seen === occurrence) { fired = true; roleABA(); } return exec(sql); }; return () => { store.db.exec = exec; assert.equal(fired, true); }; };
  t.after(() => { globalThis.fetch = previousFetch; store.close(); if (previousKey === undefined) delete process.env.OAUTH_ENCRYPTION_KEY; else process.env.OAUTH_ENCRYPTION_KEY = previousKey; });
  return { store, actor, agent, context, roleABA, arm };
}
function generic(f: ReturnType<typeof fixture>) {
  const action = configureAction(f.store, f.actor, { name: 'Synthetic action', url: 'https://example.com/synthetic', agentIds: [f.agent.id], argumentsSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false }, responsePaths: { id: '/id' } });
  const call = { id: 'generic-operation', name: `integration_${action.id.replaceAll('-', '')}`, arguments: JSON.stringify({ text: 'Synthetic input' }) };
  let writes = 0;
  const transport: IntegrationTransport = { resolve: async () => [{ address: '93.184.216.34', family: 4 }], request: async () => { writes++; return { status: 202, headers: {}, body: Buffer.from('{"id":"synthetic-accepted"}') }; } };
  return { call, transport, writes: () => writes };
}
function calendar(f: ReturnType<typeof fixture>, action: 'create' | 'update' | 'cancel' = 'create', local = false) {
  const scopes = 'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events';
  const connection = f.store.create(f.actor.tenantId, 'oauth-connections', { provider: 'google', remoteId: 'synthetic-calendar-owner', email: 'calendar@example.test', userId: f.actor.userId, status: 'connected', visibility: 'personal', capabilities: ['calendar', 'calendar_write'], scopes });
  f.store.update(f.actor.tenantId, 'oauth-connections', connection.id, { encryptedTokens: seal({ accessToken: 'synthetic-token', expiresAt: Date.now() + 3600000, scope: scopes }, tokenContext(connection)) });
  const cal = f.store.create(f.actor.tenantId, 'calendars', { name: 'Synthetic calendar', provider: local ? 'local' : 'google', agentId: f.agent.id, connectionId: connection.id, externalCalendarId: 'primary', enabled: true, timezone: 'UTC', appointmentDurationMinutes: 30, bufferMinutes: 0, availability: [] });
  const appointment = action === 'create' ? undefined : f.store.create(f.actor.tenantId, 'appointments', { calendarId: cal.id, agentId: f.agent.id, connectionId: connection.id, externalEventId: 'accepted-calendar-event', syncStatus: 'synced', status: 'scheduled', title: 'Existing fixture', timezone: 'UTC', startAt: '2099-01-05T09:00:00.000Z', endAt: '2099-01-05T09:30:00.000Z' });
  const input = { calendarId: cal.id, confirmedByUser: true, ...(action === 'create' ? { title: 'Synthetic event', timezone: 'UTC' } : { appointmentId: appointment!.id }), ...(action !== 'cancel' ? { startAt: '2099-01-05T10:00:00Z', endAt: '2099-01-05T10:30:00Z' } : {}) };
  const call = { id: `calendar-${action}-operation`, name: `${local ? '' : 'external_'}${action}_appointment`, arguments: JSON.stringify(input) };
  return { call, calendar: cal, connection, appointment, scopes };
}

test('generic agent tool checks captured authority after DNS and sends nothing after role ABA', async t => {
  const f = fixture(t), g = generic(f), context = f.context();
  const result = await executeAgentTool(f.store, context, g.call, { integrationTransport: { ...g.transport, resolve: async () => { f.roleABA(); return [{ address: '93.184.216.34', family: 4 }]; } } });
  assert.equal(result.error, 'operator_session_revoked'); assert.equal(g.writes(), 0);
  assert.equal(f.store.list(f.actor.tenantId, 'integration-operations')[0].status, 'not_sent');
});

test('generic agent tool checks captured authority inside BEGIN before creating its external receipt', async t => {
  const f = fixture(t), g = generic(f), context = f.context(), disarm = f.arm();
  const result = await executeAgentTool(f.store, context, g.call, { integrationTransport: g.transport });
  disarm(); assert.equal(result.error, 'operator_session_revoked'); assert.equal(g.writes(), 0); assert.equal(f.store.list(f.actor.tenantId, 'integration-operations').length, 0);
});

test('generic accepted effect survives late ABA in both journals and fresh same-key recovery does not send again', async t => {
  const f = fixture(t), g = generic(f), context = f.context(); let writes = 0;
  const transport = { ...g.transport, request: async () => { writes++; f.roleABA(); return { status: 202, headers: {}, body: Buffer.from('{"id":"synthetic-accepted"}') }; } };
  const result = await executeAgentTool(f.store, context, g.call, { integrationTransport: transport });
  assert.deepEqual(result, { ok: false, error: 'operator_session_revoked' }); assert.equal(f.store.list(f.actor.tenantId, 'integration-operations')[0].status, 'endpoint_acknowledged'); assert.equal(f.store.list(f.actor.tenantId, 'agent-tool-calls')[0].status, 'succeeded');
  const recovered = await executeAgentTool(f.store, f.context(), g.call, { integrationTransport: transport }); assert.equal(recovered.ok, true); assert.deepEqual(recovered.data, { id: '[redacted]-accepted' }); assert.equal(writes, 1);
});

test('external calendar availability cannot be followed by POST after role ABA', async t => {
  const f = fixture(t), c = calendar(f), context = f.context(); let writes = 0, reads = 0;
  globalThis.fetch = async (_url, init) => { if (!init?.method || init.method === 'GET') { reads++; f.roleABA(); return Response.json({ items: [] }); } writes++; return Response.json({ id: 'must-not-create' }); };
  const result = await executeAgentTool(f.store, context, c.call);
  assert.equal(result.error, 'operator_session_revoked'); assert.equal(reads, 1); assert.equal(writes, 0); assert.equal(f.store.list(f.actor.tenantId, 'oauth-calendar-operations').length, 0);
  assert.equal(f.store.list(f.actor.tenantId, 'appointments')[0].status, 'cancelled');
});

for (const boundary of ['action', 'local-appointment', 'oauth-receipt'] as const) test(`external calendar ${boundary} BEGIN rejects authority ABA before remote I/O`, async t => {
  const f = fixture(t), c = calendar(f), context = f.context(), disarm = f.arm(boundary === 'action' ? 1 : boundary === 'local-appointment' ? 2 : 3); let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ items: [] }); };
  const result = await executeAgentTool(f.store, context, c.call); disarm(); assert.equal(result.error, 'operator_session_revoked'); assert.equal(calls, 0);
  assert.equal(f.store.list(f.actor.tenantId, 'oauth-calendar-operations').length, 0);
  assert.ok(f.store.list(f.actor.tenantId, 'appointments').every(item => item.status === 'cancelled'));
});

test('local appointment tool checks captured authority inside its domain transaction', async t => {
  const f = fixture(t), c = calendar(f, 'create', true), context = f.context(), disarm = f.arm();
  const result = await executeAgentTool(f.store, context, c.call); disarm(); assert.equal(result.error, 'operator_session_revoked'); assert.equal(f.store.list(f.actor.tenantId, 'appointments').length, 0);
});

for (const action of ['create', 'update', 'cancel'] as const) test(`accepted calendar ${action} survives late ABA, preserves local truth and replays without another mutation`, async t => {
  const f = fixture(t), c = calendar(f, action), context = f.context(); let writes = 0;
  globalThis.fetch = async (_url, init) => { if (!init?.method || init.method === 'GET') return Response.json({ items: [] }); writes++; f.roleABA(); return action === 'cancel' ? new Response(null, { status: 204 }) : Response.json({ id: 'accepted-calendar-event' }); };
  const response = await executeAgentTool(f.store, context, c.call); assert.deepEqual(response, { ok: false, error: 'operator_session_revoked' });
  const receipt = f.store.list(f.actor.tenantId, 'oauth-calendar-operations')[0], appointment = f.store.list(f.actor.tenantId, 'appointments')[0];
  assert.equal(receipt.status, 'completed'); assert.equal(appointment.externalEventId, 'accepted-calendar-event'); assert.equal(appointment.syncStatus, 'synced'); assert.equal(appointment.status, action === 'cancel' ? 'cancelled' : 'scheduled');
  if (action === 'update') { assert.equal(appointment.startAt, '2099-01-05T10:00:00.000Z'); assert.equal(appointment.previousSyncInterval, null); }
  assert.equal(f.store.list(f.actor.tenantId, 'oauth-agent-calendar-actions')[0].status, 'completed'); assert.equal(f.store.list(f.actor.tenantId, 'agent-tool-calls')[0].status, 'succeeded');
  const recovered = await executeAgentTool(f.store, f.context(), c.call); assert.equal(recovered.ok, true); assert.equal((recovered.appointment as any).externalEventId, 'accepted-calendar-event'); assert.equal(writes, 1);
});

test('uncertain calendar update retains both intervals and never retries the same operation', async t => {
  const f = fixture(t), c = calendar(f, 'update'), context = f.context(); let writes = 0;
  globalThis.fetch = async (_url, init) => { if (!init?.method || init.method === 'GET') return Response.json({ items: [] }); writes++; throw new Error('synthetic unknown PATCH'); };
  const response = await executeAgentTool(f.store, context, c.call); assert.equal(response.requiresReconciliation, true);
  const appointment = f.store.get(f.actor.tenantId, 'appointments', c.appointment!.id)!; assert.equal(appointment.status, 'scheduled'); assert.equal(appointment.syncStatus, 'pending_reconciliation'); assert.equal(appointment.startAt, '2099-01-05T10:00:00.000Z'); assert.equal((appointment.previousSyncInterval as any).startAt, '2099-01-05T09:00:00.000Z');
  await executeAgentTool(f.store, context, c.call); assert.equal(writes, 1);
});

test('calendar cancel revoked during token refresh cannot dispatch DELETE', async t => {
  const f = fixture(t), c = calendar(f, 'cancel'), context = f.context(), names = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'PUBLIC_BASE_URL'] as const, previous = names.map(name => process.env[name]);
  process.env.GOOGLE_CLIENT_ID = 'synthetic-client'; process.env.GOOGLE_CLIENT_SECRET = 'synthetic-secret'; process.env.PUBLIC_BASE_URL = 'http://127.0.0.1:4310';
  t.after(() => names.forEach((name, index) => { if (previous[index] === undefined) delete process.env[name]; else process.env[name] = previous[index]; }));
  f.store.update(f.actor.tenantId, 'oauth-connections', c.connection.id, { encryptedTokens: seal({ accessToken: 'expired', refreshToken: 'synthetic-refresh', expiresAt: 1, scope: c.scopes }, tokenContext(c.connection)) });
  let refreshes = 0, writes = 0;
  globalThis.fetch = async url => { if (String(url) === 'https://oauth2.googleapis.com/token') { refreshes++; f.roleABA(); return Response.json({ access_token: 'synthetic-fresh', token_type: 'Bearer', expires_in: 3600, scope: c.scopes }); } writes++; return new Response(null, { status: 204 }); };
  const response = await executeAgentTool(f.store, context, c.call); assert.equal(response.error, 'operator_session_revoked'); assert.equal(refreshes, 1); assert.equal(writes, 0);
  assert.equal(f.store.get(f.actor.tenantId, 'appointments', c.appointment!.id)!.status, 'scheduled');
});
