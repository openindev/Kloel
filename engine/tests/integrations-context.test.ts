import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { Store } from '../src/store.js';
import { registerAuth, sessionDigest } from '../src/auth.js';
import { CONTEXT_HEADERS, type ExpectedRequestContext } from '../src/request-context.js';
import { registerIntegrations } from '../src/integrations.js';
import { configureAction, actionCollection, operationCollection } from '../src/integrations/service.js';
import { configureBaserowTable, baserowBindings, baserowOperations } from '../src/integrations/baserow.js';
import { configureAirtableTable, airtableBindings, airtableOperations } from '../src/integrations/airtable.js';
import type { IntegrationTransport } from '../src/integrations/transport.js';
import type { Actor } from '../src/oauth/access.js';
import { unseal } from '../src/oauth/crypto.js';
import { MembershipError } from '../src/memberships/service.js';
import { seedMember } from './fixtures/membership.js';

type Connector = 'generic' | 'baserow' | 'airtable';
const connectors: Connector[] = ['generic', 'baserow', 'airtable'];
const fieldId = 'fld00000000000001', tableId = 'tbl00000000000001', baseId = 'app00000000000001', recordId = 'rec00000000000001';
const privateValue = 'synthetic-private-record-value';
const address = { address: '93.184.216.34', family: 4 };
const json = (value: unknown) => ({ status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify(value)) });
const config = {
  generic: { name: 'Context fixture', url: 'https://workflow.example.com/hook', method: 'POST', headers: { Authorization: 'Bearer fixture-http-credential' }, argumentsSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'], additionalProperties: false }, bodyTemplate: { name: { $arg: '/name' } }, responsePaths: { providerId: '/id', value: '/value' } },
  baserow: { name: 'Context fixture', instanceUrl: 'https://database.example.com', tableId: 123, token: 'fixture-baserow-credential', allowCreate: true },
  airtable: { name: 'Context fixture', baseId, tableId, fieldIds: [fieldId], token: 'fixture-airtable-credential', allowCreate: true },
};
const collections = { generic: actionCollection, baserow: baserowBindings, airtable: airtableBindings };
const operations = { generic: operationCollection, baserow: baserowOperations, airtable: airtableOperations };
const createPaths = { generic: '/api/v1/integrations/actions', baserow: '/api/v1/integrations/baserow/tables', airtable: '/api/v1/integrations/airtable/tables' };
const operationPaths = { generic: '/api/v1/integrations/operations', baserow: '/api/v1/integrations/baserow/operations', airtable: '/api/v1/integrations/airtable/operations' };
const headersOf = (context: ExpectedRequestContext) => Object.fromEntries(Object.entries(CONTEXT_HEADERS).map(([key, header]) => [header, context[key as keyof ExpectedRequestContext] ?? '-']));

async function fixture(t: TestContext, connector: Connector, read = false) {
  const previous = process.env.OAUTH_ENCRYPTION_KEY;
  process.env.OAUTH_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  const store = new Store(':memory:'), app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof MembershipError) return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
    return reply.code(500).send({ error: { code: 'unexpected_fixture_error' } });
  });
  const actor: Actor = { userId: randomUUID(), tenantId: randomUUID(), role: 'owner' };
  seedMember(store, actor);
  const token = randomBytes(32).toString('base64url'), cookies = { kloel_session: token };
  store.db.prepare('INSERT INTO sessions(hash,user_id,expires,tenant_id) VALUES(?,?,?,?)').run(sessionDigest(token), actor.userId, Date.now() + 60_000, actor.tenantId);
  const binding = connector === 'generic'
    ? configureAction(store, actor, read ? { ...config.generic, method: 'GET', bodyTemplate: undefined } : config.generic)
    : connector === 'baserow' ? configureBaserowTable(store, actor, config.baserow) : configureAirtableTable(store, actor, config.airtable);
  const calls: { method: string; pathname: string }[] = [];
  const hooks: { resolve?: () => void; response?: (method: string, pathname: string) => void } = {};
  const transport: IntegrationTransport = {
    resolve: async () => { hooks.resolve?.(); return [address]; },
    request: async (url, _address, spec) => {
      calls.push({ method: spec.method, pathname: url.pathname });
      hooks.response?.(spec.method, url.pathname);
      if (connector === 'generic') return json({ id: 'accepted-remote-id', value: privateValue });
      if (connector === 'baserow') return json(url.pathname.includes('/fields/')
        ? [{ id: 1, name: 'Name', type: 'text' }]
        : spec.method === 'POST' ? { id: 4321, field_1: privateValue } : { count: 1, next: null, results: [{ id: 4321, field_1: privateValue }] });
      return json(url.pathname.includes('/meta/')
        ? { tables: [{ id: tableId, fields: [{ id: fieldId, name: 'Name', type: 'singleLineText' }] }] }
        : { records: [{ id: recordId, createdTime: '2026-10-18T09:00:00.000Z', fields: { [fieldId]: privateValue } }] });
    },
  };
  await app.register(cookie);
  await registerAuth(app, store);
  await registerIntegrations(app, store, transport);
  t.after(async () => {
    await app.close(); store.close();
    if (previous === undefined) delete process.env.OAUTH_ENCRYPTION_KEY; else process.env.OAUTH_ENCRYPTION_KEY = previous;
  });
  const freshHeaders = async () => {
    const me = await app.inject({ url: '/api/v1/auth/me', cookies });
    assert.equal(me.statusCode, 200, me.body);
    return headersOf(me.json().context as ExpectedRequestContext);
  };
  const headers = await freshHeaders();
  const aba = () => {
    store.db.prepare("UPDATE memberships SET role='viewer' WHERE user_id=? AND tenant_id=?").run(actor.userId, actor.tenantId);
    store.db.prepare("UPDATE memberships SET role='owner' WHERE user_id=? AND tenant_id=?").run(actor.userId, actor.tenantId);
  };
  const writePath = connector === 'generic' ? `${createPaths.generic}/${binding.id}/execute` : `${createPaths[connector]}/${binding.id}/${connector === 'baserow' ? 'rows' : 'records'}`;
  const readPath = connector === 'generic' ? writePath : `${createPaths[connector]}/${binding.id}/query`;
  const payload = connector === 'generic' ? { arguments: { name: 'synthetic-name' } } : { expectedTenantId: actor.tenantId, expectedRevision: binding.revision, values: connector === 'baserow' ? { field_1: 'synthetic-name' } : { [fieldId]: 'synthetic-name' } };
  const key = randomUUID();
  const send = (overrideHeaders = headers) => app.inject({ method: 'POST', url: read ? readPath : writePath, cookies, headers: { ...overrideHeaders, 'idempotency-key': key }, payload: read && connector !== 'generic' ? {} : payload });
  return { app, store, actor, cookies, binding, headers, freshHeaders, hooks, calls, aba, send, key };
}

function assertChanged(response: { statusCode: number; body: string; json: () => any }) {
  assert.equal(response.statusCode, 409, response.body);
  assert.equal(response.json().error.code, 'context_changed_in_flight');
  for (const value of [privateValue, 'accepted-remote-id', recordId, 'fixture-http-credential', 'fixture-baserow-credential', 'fixture-airtable-credential']) assert.ok(!response.body.includes(value), value);
}

for (const connector of connectors) {
  for (const mutation of ['role-aba', 'logout'] as const) {
    test(`${connector}: ${mutation} during DNS blocks any provider request`, async t => {
      const f = await fixture(t, connector);
      f.hooks.resolve = () => {
        delete f.hooks.resolve;
        if (mutation === 'role-aba') f.aba(); else f.store.db.prepare('DELETE FROM sessions WHERE hash=?').run(sessionDigest(f.cookies.kloel_session));
      };
      assertChanged(await f.send());
      assert.equal(f.calls.length, 0);
      const receipts = f.store.list(f.actor.tenantId, operations[connector]);
      assert.equal(receipts.length, connector === 'generic' ? 1 : 0);
      if (receipts[0]) assert.equal(receipts[0].status, 'not_sent');
    });
  }

  test(`${connector}: late read after role ABA never exposes provider data`, async t => {
    const f = await fixture(t, connector, true);
    f.hooks.response = () => { delete f.hooks.response; f.aba(); };
    assertChanged(await f.send());
    assert.equal(f.calls.length, 1);
    if (connector !== 'generic') assert.equal(f.store.get(f.actor.tenantId, collections[connector], f.binding.id)!.lastReadAt, undefined);
  });

  if (connector !== 'generic') test(`${connector}: revocation after schema read but during write DNS keeps not-sent receipt`, async t => {
    const f = await fixture(t, connector);
    f.hooks.response = () => {
      delete f.hooks.response;
      f.hooks.resolve = () => { delete f.hooks.resolve; f.aba(); };
    };
    assertChanged(await f.send());
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].method, 'GET');
    const receipts = f.store.list(f.actor.tenantId, operations[connector]);
    assert.equal(receipts.length, 1); assert.equal(receipts[0].status, 'not_sent');
    assert.ok(receipts[0].encryptedResult);
  });

  test(`${connector}: accepted write after role ABA keeps receipt and ID before refusing stale response`, async t => {
    const f = await fixture(t, connector);
    f.hooks.response = method => { if (method === 'POST') { delete f.hooks.response; f.aba(); } };
    assertChanged(await f.send());
    assert.equal(f.calls.filter(c => c.method === 'POST').length, 1);
    const receipts = f.store.list(f.actor.tenantId, operations[connector]);
    assert.equal(receipts.length, 1);
    const receipt = receipts[0];
    assert.equal(receipt.status, connector === 'generic' ? 'endpoint_acknowledged' : 'created');
    assert.equal(receipt.tenantId, f.actor.tenantId);
    assert.equal(receipt.userId, f.actor.userId);
    if (connector === 'baserow') assert.equal(receipt.rowId, 4321);
    if (connector === 'airtable') assert.equal(receipt.recordId, recordId);
    const encrypted = unseal<any>(String(receipt.encryptedResult), `${f.actor.tenantId}:${receipt.id}:${connector === 'generic' ? 'integration' : connector}-result`);
    assert.equal(encrypted.ok, true);
    if (connector === 'generic') assert.equal(encrypted.data.providerId, 'accepted-remote-id');
    const fresh = await f.freshHeaders();
    const recovered = await f.app.inject({ url: operationPaths[connector], cookies: f.cookies, headers: fresh });
    assert.equal(recovered.statusCode, 200, recovered.body);
    assert.equal(recovered.json().items[0].id, receipt.id);
    assert.equal(recovered.json().items[0].status, receipt.status);
    assert.ok(!recovered.body.includes(privateValue));
    assert.ok(!recovered.body.includes('encryptedResult'));
    const before = f.calls.length;
    const replay = await f.send(fresh);
    assert.equal(replay.statusCode, connector !== 'generic' ? 409 : 200, replay.body);
    if (connector !== 'generic') assert.equal(replay.json().error.code, 'idempotency_conflict');
    else assert.equal(replay.json().operation.id, receipt.id);
    assert.equal(f.calls.length, before, 'explicit same-key replay must not send again');
  });

  test(`${connector}: lost provider response after revocation preserves uncertain receipt without retry`, async t => {
    const f = await fixture(t, connector);
    f.hooks.response = method => { if (method === 'POST') { delete f.hooks.response; f.aba(); throw new Error('synthetic-lost-response'); } };
    assertChanged(await f.send());
    const receipts = f.store.list(f.actor.tenantId, operations[connector]);
    assert.equal(receipts.length, 1); assert.equal(receipts[0].status, 'uncertain');
    assert.ok(receipts[0].encryptedResult);
    const before = f.calls.length;
    const replay = await f.send(await f.freshHeaders());
    assert.equal(replay.statusCode, connector !== 'generic' ? 409 : 200, replay.body);
    if (connector !== 'generic') assert.equal(replay.json().error.code, 'idempotency_conflict');
    else { assert.equal(replay.json().operation.status, 'uncertain'); assert.equal(replay.json().operation.automaticRetry, false); }
    assert.equal(f.calls.length, before);
  });

  test(`${connector}: configuration rechecks context inside BEGIN before storing secrets`, async t => {
    const f = await fixture(t, connector), original = f.store.transaction.bind(f.store);
    let changed = false;
    f.store.transaction = fn => { if (!changed) { changed = true; f.aba(); } return original(fn); };
    const configuration = { ...config[connector], name: 'Must never be stored' };
    const response = await f.app.inject({ method: 'POST', url: createPaths[connector], cookies: f.cookies, headers: { ...f.headers, 'idempotency-key': randomUUID() }, payload: connector !== 'generic' ? { expectedTenantId: f.actor.tenantId, configuration } : configuration });
    assertChanged(response);
    assert.equal(changed, true);
    assert.equal(f.store.list(f.actor.tenantId, collections[connector]).length, 1);
    assert.equal(f.calls.length, 0);
  });

  test(`${connector}: operation reservation rechecks context inside BEGIN before provider write`, async t => {
    const f = await fixture(t, connector), original = f.store.transaction.bind(f.store);
    let changed = false;
    f.store.transaction = fn => { if (!changed) { changed = true; f.aba(); } return original(fn); };
    assertChanged(await f.send());
    assert.equal(changed, true);
    assert.equal(f.store.list(f.actor.tenantId, operations[connector]).length, 0);
    assert.equal(f.calls.filter(c => c.method === 'POST').length, 0);
  });

  test(`${connector}: stale admission and malformed expected headers fail before provider I/O`, async t => {
    const f = await fixture(t, connector);
    const malformed = { ...f.headers, [CONTEXT_HEADERS.authorityVersion]: 'invalid' };
    const invalid = await f.send(malformed);
    assert.equal(invalid.statusCode, 400, invalid.body);
    assert.equal(invalid.json().error.code, 'invalid_context');
    f.aba(); const stale = await f.send();
    assert.equal(stale.statusCode, 409, stale.body);
    assert.equal(stale.json().error.code, 'context_mismatch');
    assert.equal(f.calls.length, 0);
    assert.equal(f.store.list(f.actor.tenantId, operations[connector]).length, 0);
  });
}
