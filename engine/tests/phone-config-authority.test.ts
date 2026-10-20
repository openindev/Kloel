import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { phoneConfigFixture, phone, sid, hash } from './fixtures/phone-config.js';
import { seedMember } from './fixtures/membership.js';

test('owner/editor can configure; member cannot write and other actors cannot recover receipts', async t => {
  const f = await phoneConfigFixture(t), { row, key, body } = await f.create({}, 'editor');
  assert.equal((await f.request('GET', '/numbers/' + row.id, undefined, undefined, 'member')).statusCode, 200);
  assert.equal((await f.request('PATCH', '/numbers/' + row.id, f.control(row, { name: 'Denied' }), randomUUID(), 'member')).statusCode, 403);
  assert.equal((await f.request('GET', '/operations/' + key, undefined, undefined, 'member')).statusCode, 403);
  for (const actor of ['owner', 'other', 'foreign']) assert.equal((await f.request('GET', '/operations/' + key, undefined, undefined, actor)).statusCode, 404);
  const collision = await f.request('POST', '/numbers', body, key, 'owner'); assert.equal(collision.statusCode, 409); assert.equal(collision.json().error.code, 'idempotency_conflict'); assert.equal(f.calls.length, 1);
});

test('provider tenant mismatch refuses create and new routing before any I/O', async t => {
  const f = await phoneConfigFixture(t);
  const foreign = await f.request('POST', '/numbers', f.input({ expectedTenantId: f.actors.foreign.tenantId }), randomUUID(), 'foreign'); assert.equal(foreign.statusCode, 403); assert.equal(foreign.json().error.code, 'phone_provider_tenant_mismatch');
  const local = f.store.create(f.actors.foreign.tenantId, 'phone-numbers', { name: 'Foreign local', number: phone, provider: 'twilio', providerNumberId: sid, capabilities: ['voice'] });
  const agent = f.store.create(f.actors.foreign.tenantId, 'agents', { name: 'Foreign assistant', status: 'active' });
  const current = (await f.request('GET', '/numbers/' + local.id, undefined, undefined, 'foreign')).json();
  const route = await f.request('PATCH', '/numbers/' + local.id, { expectedTenantId: f.actors.foreign.tenantId, expectedVersion: current.version, agentId: agent.id }, randomUUID(), 'foreign');
  assert.equal(route.statusCode, 403); assert.equal(f.calls.length, 0); assert.equal(f.store.list(f.actors.foreign.tenantId, 'phone-config-operations').length, 0);
});

test('authority ABA during ownership GET denies commit even when the role returns to owner', async t => {
  const f = await phoneConfigFixture(t); f.hooks.provider = () => { f.aba(); };
  const response = await f.request('POST', '/numbers', f.input(), randomUUID()); assert.equal(response.statusCode, 409); assert.equal(response.json().error.code, 'context_changed_in_flight');
  assert.equal(f.store.list(f.tenant, 'phone-numbers').length, 0); assert.equal(f.store.list(f.tenant, 'phone-config-operations').length, 0); assert.equal(f.calls.length, 1);
});

test('headerless human calls still bind original authority across async ownership proof', async t => {
  const f = await phoneConfigFixture(t); f.hooks.provider = () => { f.aba(); };
  const response = await f.app.inject({ method: 'POST', url: '/api/v1/phone-config/numbers', headers: { cookie: 'kloel_session=' + f.cookies.owner, 'idempotency-key': randomUUID() }, payload: f.input() });
  assert.equal(response.statusCode, 409); assert.equal(response.json().error.code, 'context_changed_in_flight'); assert.equal(f.store.list(f.tenant, 'phone-numbers').length, 0);
});

test('session revocation during proof cannot create a local binding', async t => {
  const f = await phoneConfigFixture(t); f.hooks.provider = () => { f.store.db.prepare('DELETE FROM sessions WHERE hash=?').run(hash(f.cookies.owner)); };
  assert.equal((await f.request('POST', '/numbers', f.input(), randomUUID())).statusCode, 409); assert.equal(f.store.list(f.tenant, 'phone-numbers').length, 0);
});

test('provider account, token and tenant changes during proof invalidate local commit without logging values', async t => {
  for (const name of ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'PROVIDER_TENANT_ID']) await t.test(name, async child => {
    const f = await phoneConfigFixture(child); f.hooks.provider = () => { process.env[name] = 'synthetic-changed-private-value'; };
    const response = await f.request('POST', '/numbers', f.input(), randomUUID()); assert.equal(response.statusCode, 409); assert.equal(response.json().error.code, 'phone_provider_changed'); assert.equal(response.body.includes('synthetic-changed-private-value'), false);
    assert.equal(f.store.list(f.tenant, 'phone-numbers').length, 0); assert.equal(f.store.list(f.tenant, 'phone-config-operations').length, 0);
  });
});

test('channel/agent snapshots are revalidated after ownership GET, including still-valid changed references', async t => {
  for (const which of ['channel-disabled', 'agent-paused', 'agent-prompt']) await t.test(which, async child => {
    const f = await phoneConfigFixture(child);
    f.hooks.provider = () => {
      if (which === 'channel-disabled') f.store.update(f.tenant, 'channels', f.channel.id, { enabled: false });
      else f.store.update(f.tenant, 'agents', f.agent.id, which === 'agent-paused' ? { status: 'paused' } : { prompt: 'Changed while checking ownership' });
    };
    const response = await f.request('POST', '/numbers', f.input({ agentId: f.agent.id, channelId: f.channel.id }), randomUUID()); assert.equal(response.statusCode, 409);
    assert.equal(response.json().error.code, which === 'agent-prompt' ? 'phone_references_changed' : 'phone_route_invalid'); assert.equal(f.store.list(f.tenant, 'phone-numbers').length, 0);
  });
});

test('wrong-type, disabled, conflicting and cross-tenant route references are refused before provider I/O', async t => {
  const f = await phoneConfigFixture(t), different = f.store.create(f.tenant, 'agents', { name: 'Different', status: 'active' });
  const disabled = f.store.create(f.tenant, 'channels', { type: 'phone', provider: 'twilio', enabled: false, agentId: f.agent.id });
  const meta = f.store.create(f.tenant, 'channels', { type: 'whatsapp', provider: 'meta', enabled: true, agentId: f.agent.id });
  for (const patch of [{ channelId: disabled.id }, { channelId: meta.id }, { agentId: different.id, channelId: f.channel.id }, { agentId: 'foreign-or-missing' }]) {
    const res = await f.request('POST', '/numbers', f.input(patch), randomUUID()); assert.equal(res.statusCode, 409); assert.equal(res.json().error.code, 'phone_route_invalid');
  }
  assert.equal(f.calls.length, 0);
});

test('resource changes during proof cannot be overwritten and original expected version stays binding', async t => {
  const f = await phoneConfigFixture(t), { row } = await f.create(); f.calls.length = 0;
  f.hooks.provider = () => { f.store.update(f.tenant, 'phone-numbers', row.id, { name: 'Concurrent winner', revision: 2 }); };
  const res = await f.request('PATCH', '/numbers/' + row.id, f.control(row, { agentId: f.agent.id }), randomUUID()); assert.equal(res.statusCode, 409); assert.equal(res.json().error.code, 'phone_configuration_changed');
  const current = f.store.get(f.tenant, 'phone-numbers', row.id)!; assert.equal(current.name, 'Concurrent winner'); assert.equal(current.agentId, null); assert.equal(f.store.list(f.tenant, 'phone-config-operations').length, 1);
});

test('authority, references and provider config are checked again inside the commit transaction', async t => {
  for (const fault of ['authority', 'reference', 'provider']) await t.test(fault, async child => {
    const f = await phoneConfigFixture(child), transaction = f.store.transaction.bind(f.store); let count = 0;
    f.store.transaction = fn => transaction(() => {
      if (++count === 2) {
        if (fault === 'authority') f.aba();
        else if (fault === 'reference') f.store.update(f.tenant, 'agents', f.agent.id, { prompt: 'Changed at BEGIN' });
        else process.env.TWILIO_AUTH_TOKEN = 'changed-at-BEGIN';
      }
      return fn();
    });
    const response = await f.request('POST', '/numbers', f.input({ agentId: f.agent.id }), randomUUID()); assert.equal(response.statusCode, 409, response.body);
    assert.equal(f.store.list(f.tenant, 'phone-numbers').length, 0); assert.equal(f.store.list(f.tenant, 'phone-config-operations').length, 0);
  });
});

test('receipt/audit failures roll back local create, update and delete atomically', async t => {
  const f = await phoneConfigFixture(t), initial = await f.create(), create = f.store.create.bind(f.store);
  for (const kind of ['create', 'update', 'delete']) {
    const before = f.snapshot();
    f.store.create = (tenant, collection, data) => { if (collection === 'phone-config-audit') throw new Error('synthetic storage failure'); return create(tenant, collection, data); };
    let res;
    if (kind === 'create') { f.store.remove(f.tenant, 'phone-numbers', initial.row.id); res = await f.request('POST', '/numbers', f.input(), randomUUID()); assert.equal(f.store.list(f.tenant, 'phone-numbers').length, 0); f.store.db.prepare('INSERT INTO entities(id,tenant_id,collection,body) VALUES(?,?,?,?)').run(initial.row.id, f.tenant, 'phone-numbers', JSON.stringify(before.find(r => r.id === initial.row.id) && JSON.parse(String(before.find(r => r.id === initial.row.id)!.body)))); }
    else res = await f.request(kind === 'update' ? 'PATCH' : 'DELETE', '/numbers/' + initial.row.id, f.control(initial.row, kind === 'update' ? { name: 'Must roll back' } : {}), randomUUID());
    assert.equal(res.statusCode, 500); assert.deepEqual(f.snapshot().map(r => ({ ...r })).sort((a, b) => String(a.id).localeCompare(String(b.id))), before.map(r => ({ ...r })).sort((a, b) => String(a.id).localeCompare(String(b.id))));
    f.store.create = create;
  }
});

test('original session and membership generation own receipts across new login, ABA and reentry', async t => {
  const f = await phoneConfigFixture(t), created = await f.create();
  f.cookies.owner = 'synthetic-new-phone-login';
  f.store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(hash(f.cookies.owner), f.actors.owner.userId, f.tenant, Date.now() + 3600000);
  await f.refreshContext();
  assert.equal((await f.request('GET', '/operations/' + created.key)).statusCode, 404); assert.equal((await f.request('POST', '/numbers', created.body, created.key)).statusCode, 409);
  f.cookies.owner = 'synthetic-phone-cookie-owner'; await f.refreshContext(); assert.equal((await f.request('GET', '/operations/' + created.key)).statusCode, 200);
  f.aba(); await f.refreshContext(); assert.equal((await f.request('GET', '/operations/' + created.key)).statusCode, 404);
  f.store.db.prepare('DELETE FROM memberships WHERE tenant_id=? AND user_id=?').run(f.tenant, f.actors.owner.userId); seedMember(f.store, f.actors.owner); await f.refreshContext();
  assert.equal((await f.request('GET', '/operations/' + created.key)).statusCode, 404); assert.equal(f.calls.length, 1);
});

test('revocation while consuming provider response body prevents commit', async t => {
  const f = await phoneConfigFixture(t);
  f.hooks.provider = () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"incoming_phone_numbers":[')); }, pull(controller) { f.aba(); controller.close(); } }));
  const res = await f.request('POST', '/numbers', f.input(), randomUUID()); assert.equal(res.statusCode, 409); assert.equal(f.store.list(f.tenant, 'phone-numbers').length, 0);
});
