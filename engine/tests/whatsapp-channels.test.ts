import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { whatsappChannelsFixture as fixture, digest } from './fixtures/whatsapp-channels.js';
import { seedMember } from './fixtures/membership.js';

test('local create is disabled, explicit enable checks readiness, receipts contain only historical metadata', async t => {
  const f = await fixture(t), made = await f.create(); assert.equal(made.row.enabled, false); assert.equal(made.row.revision, 1); assert.equal(made.row.readiness.canEnable, true); assert.equal(made.row.verificationStatus, 'unverified');
  const enabled = await f.change(made.row, 'enable'); assert.equal(enabled.enabled, true); assert.equal(enabled.revision, 2);
  const receipt = await f.request('GET', '/channel-operations/' + made.key); assert.equal(receipt.statusCode, 200); assert.equal(receipt.json().result.enabled, false);
  for (const secret of [made.body.name, made.body.address, made.body.externalId, 'sessionHash', 'fingerprint', ...Object.values(f.env).filter(x => x.startsWith('synthetic-'))]) assert.ok(!receipt.body.includes(secret));
  assert.equal(f.calls.length, 0);
});
test('CAS rejects the loser, no-op increases revision, ABA with frozen clock does not restore the old version', async t => {
  const f = await fixture(t); t.mock.timers.enable({ apis: ['Date'], now: Date.now() }); const first = (await f.create()).row;
  const second = await f.change(first, 'update', { name: 'B' }, 'other'), third = await f.change(second, 'update', { name: first.name });
  assert.equal(first.updatedAt, third.updatedAt); assert.equal(third.revision, 3); assert.notEqual(third.version, first.version);
  for (const method of ['PATCH', 'DELETE']) { const before = f.snapshot(), r = await f.request(method, '/channels/' + first.id, f.control(first, method === 'PATCH' ? { name: 'stale' } : {}), randomUUID()); assert.equal(r.json().error.code, 'whatsapp_channel_configuration_changed'); assert.deepEqual(f.snapshot(), before); }
  const fourth = await f.change(third, 'update', { name: third.name }); assert.equal(fourth.revision, 4); assert.notEqual(fourth.version, third.version);
});
test('duplicate identity is atomic, disabled legacy duplicates can still be renamed and removed', async t => {
  const f = await fixture(t), body = f.input(); const [a, b] = await Promise.all([f.request('POST', '/channels', body, randomUUID()), f.request('POST', '/channels', body, randomUUID())]); assert.deepEqual([a.statusCode, b.statusCode].sort(), [201, 409]);
  const legacy = f.store.create(f.tenant, 'channels', { name: 'Legacy duplicate', type: 'whatsapp', provider: 'meta', enabled: false, configuration: { externalId: body.externalId } });
  let row = await f.read(legacy.id); assert.equal(row.revision, 0); assert.ok(row.readiness.reasons.includes('duplicate_external_id')); row = await f.change(row, 'update', { name: 'Repair path' });
  assert.equal((await f.request('POST', '/channels/' + row.id + '/enable', f.control(row), randomUUID())).json().error.code, 'duplicate_channel');
  assert.equal((await f.request('DELETE', '/channels/' + row.id, f.control(row), randomUUID())).statusCode, 200); assert.equal(f.calls.length, 0);
});
test('delete receipt survives deletion and recadastro; original create replay never adopts replacement', async t => {
  const f = await fixture(t), first = await f.create(), deletionKey = randomUUID(), deletionBody = f.control(first.row);
  assert.equal((await f.request('DELETE', '/channels/' + first.row.id, deletionBody, deletionKey)).statusCode, 200);
  const replacement = await f.create({ name: 'Replacement' }); assert.notEqual(replacement.row.id, first.row.id);
  for (const k of Object.keys(f.env)) delete process.env[k];
  const replay = await f.request('POST', '/channels', first.body, first.key); assert.equal(replay.statusCode, 200); assert.equal(replay.json().operation.channelId, first.row.id);
  const removed = await f.request('GET', '/channel-operations/' + deletionKey); assert.equal(removed.statusCode, 200); assert.equal(removed.json().result.deleted, true); assert.equal(removed.json().result.revision, 2);
  assert.equal((await f.request('DELETE', '/channels/' + first.row.id, deletionBody, deletionKey)).statusCode, 200); assert.equal(f.store.get(f.tenant, 'channels', replacement.row.id)!.name, 'Replacement'); assert.equal(f.calls.length, 0);
});
test('post-COMMIT response failure keeps journal recoverable without applying twice', async t => {
  const f = await fixture(t), transaction = f.store.transaction.bind(f.store); let injected = false;
  f.store.transaction = fn => { const r = transaction(fn); if (!injected && f.store.list(f.tenant, 'whatsapp-channel-operations').length) { injected = true; throw Error('Synthetic lost result after commit'); } return r; };
  const key = randomUUID(), body = f.input(); assert.equal((await f.request('POST', '/channels', body, key)).statusCode, 500);
  const receipt = await f.request('GET', '/channel-operations/' + key); assert.equal(receipt.statusCode, 200); assert.equal((await f.request('POST', '/channels', body, key)).json().replayed, true); assert.equal(f.store.list(f.tenant, 'channels').length, 1); assert.equal(f.calls.length, 0);
});
test('audit failure rolls back configuration and receipt together', async t => {
  const f = await fixture(t), create = f.store.create.bind(f.store), before = f.snapshot();
  f.store.create = (tenant, collection, data) => { if (collection === 'whatsapp-channel-audit') throw Error('Synthetic audit failure'); return create(tenant, collection, data); };
  assert.equal((await f.request('POST', '/channels', f.input(), randomUUID())).statusCode, 500); assert.deepEqual(f.snapshot(), before);
});
for (const change of ['roleABA', 'tenant', 'rejoin'] as const) test('fresh authority inside BEGIN rejects ' + change + ' without configuration effects', async t => {
  const f = await fixture(t), transaction = f.store.transaction.bind(f.store); let first = true;
  f.store.transaction = fn => transaction(() => { if (first) { first = false; if (change === 'roleABA') f.aba(); if (change === 'tenant') f.store.db.prepare('UPDATE sessions SET tenant_id=? WHERE hash=?').run(f.actors.foreign.tenantId, digest(f.cookies.owner)); if (change === 'rejoin') { f.store.db.prepare('DELETE FROM memberships WHERE tenant_id=? AND user_id=?').run(f.tenant, f.actors.owner.userId); seedMember(f.store, f.actors.owner); } } return fn(); });
  const r = await f.request('POST', '/channels', f.input(), randomUUID()); assert.ok([401,403,409].includes(r.statusCode), r.body); assert.equal(f.store.list(f.tenant, 'channels').length, 0); assert.equal(f.store.list(f.tenant, 'whatsapp-channel-operations').length, 0);
});
test('historical receipt requires original operator/session/authority; changed intent cannot reuse key', async t => {
  const f = await fixture(t), first = await f.create();
  assert.equal((await f.request('GET', '/channel-operations/' + first.key, undefined, undefined, 'other')).statusCode, 404);
  assert.equal((await f.request('POST', '/channels', { ...first.body, name: 'Other' }, first.key)).statusCode, 409);
  const token = 'new-same-user-session'; f.store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(digest(token), f.actors.owner.userId, f.tenant, Date.now() + 3600000);
  assert.equal((await f.app.inject({ url: '/api/v1/whatsapp/channel-operations/' + first.key, headers: { cookie: 'kloel_session=' + token } })).statusCode, 404);
  f.aba(); await f.refreshContext(); assert.equal((await f.request('GET', '/channel-operations/' + first.key)).statusCode, 404); assert.equal(f.calls.length, 0);
});
test('permissions distinguish local maintenance from enabling automation; wrong tenant and bearer rejected', async t => {
  const f = await fixture(t), first = await f.create({}, 'editor'); assert.equal((await f.request('POST', '/channels/' + first.row.id + '/enable', f.control(first.row), randomUUID(), 'editor')).statusCode, 403);
  assert.equal((await f.request('POST', '/channels', f.input({ externalId: '999' }), randomUUID(), 'member')).statusCode, 403);
  assert.equal((await f.request('GET', '/channels/' + first.row.id, undefined, undefined, 'member')).statusCode, 200);
  assert.equal((await f.request('POST', '/channels', f.input({ externalId: '999', expectedTenantId: f.actors.foreign.tenantId }), randomUUID())).json().error.code, 'tenant_mismatch');
  assert.equal((await f.request('GET', '/channels', undefined, undefined, 'owner', { authorization: 'Bearer klo_key_invalid' })).statusCode, 400);
  assert.equal((await f.app.inject({ url: '/api/v1/whatsapp/channels', headers: { authorization: 'Bearer klo_key_invalid' } })).statusCode, 401);
  for (const k of Object.keys(f.env)) delete process.env[k]; let row = await f.change(first.row, 'update', { name: 'Local repair' }, 'editor'); row = await f.change(row, 'disable', {}, 'editor'); assert.equal((await f.request('DELETE', '/channels/' + row.id, f.control(row), randomUUID(), 'editor')).statusCode, 200); assert.equal(f.calls.length, 0);
});
test('enabled route changes require manage and readiness; identity changes require disabled channel', async t => {
  const f = await fixture(t); let row = (await f.create()).row; row = await f.change(row, 'enable');
  assert.equal((await f.request('PATCH', '/channels/' + row.id, f.control(row, { externalId: '999' }), randomUUID())).json().error.code, 'channel_must_be_disabled');
  assert.equal((await f.request('PATCH', '/channels/' + row.id, f.control(row, { agentId: null }), randomUUID(), 'editor')).statusCode, 403);
  assert.equal((await f.request('PATCH', '/channels/' + row.id, f.control(row, { agentId: null }), randomUUID())).json().error.code, 'channel_not_ready');
  row = await f.change(row, 'disable'); row = await f.change(row, 'update', { externalId: '999' }); assert.ok(row.readiness.reasons.includes('phone_id_mismatch'));
  assert.equal((await f.request('POST', '/channels/' + row.id + '/enable', f.control(row), randomUUID())).json().error.code, 'channel_not_ready');
});
test('legacy read never migrates; metadata preserves unknown fields and does not expose them', async t => {
  const f = await fixture(t), old = f.store.create(f.tenant, 'channels', { name: 'Legacy', type: 'whatsapp', provider: 'local', enabled: false, configuration: { externalId: '777', address: 'invalid', greeting: 'keep', accidentalPrivate: 'PRIVATE-FIXTURE' } });
  const before = f.snapshot(); let row = await f.read(old.id); assert.deepEqual(f.snapshot(), before); assert.equal(row.revision, 0); assert.equal(row.address, null); assert.equal(JSON.stringify(row).includes('PRIVATE-FIXTURE'), false); assert.ok(row.readiness.reasons.includes('provider_unsupported'));
  row = await f.change(row, 'update', { name: 'Repaired label' }); assert.equal((f.store.get(f.tenant, 'channels', old.id)!.configuration as any).greeting, 'keep'); assert.equal(row.revision, 1);
});
test('list cursor is scoped, filtered and stable across newer insertions; GET is local', async t => {
  const f = await fixture(t); await f.create(); await f.create({ externalId: '2' }); await f.create({ externalId: '3' });
  const first = await f.request('GET', '/channels?limit=2&agentId=' + f.agent.id); assert.equal(first.statusCode, 200); const page = first.json(); assert.equal(page.items.length, 2); assert.ok(page.nextCursor);
  await f.create({ externalId: '4' }); const next = await f.request('GET', '/channels?limit=2&agentId=' + f.agent.id + '&cursor=' + page.nextCursor); assert.equal(next.json().items.length, 1); assert.equal(next.json().nextCursor, null);
  for (const suffix of ['?limit=1&cursor=', '?limit=2&cursor=']) assert.equal((await f.request('GET', '/channels' + suffix + page.nextCursor)).statusCode, 400);
  assert.equal((await f.request('GET', '/channels?limit=2&agentId=' + f.agent.id + '&cursor=' + page.nextCursor.slice(0,-2) + 'xx')).statusCode, 400); assert.equal(f.calls.length, 0);
});
test('generic writers and type conversion cannot bypass CAS while other channel types remain unchanged', async t => {
  const f = await fixture(t), row = (await f.create()).row, phone = f.store.create(f.tenant, 'channels', { name: 'Phone', type: 'phone', provider: 'twilio', enabled: false });
  for (const [method, path, body] of [['POST', '/api/v1/channels', { name:'Bad',type:'whatsapp',provider:'meta' }], ['PATCH','/api/v1/channels/'+row.id,{name:'Bypass'}], ['DELETE','/api/v1/channels/'+row.id,undefined], ['PATCH','/api/v1/channels/'+row.id,{type:'phone'}], ['PATCH','/api/v1/channels/'+phone.id,{type:'whatsapp'}]] as const) assert.equal((await f.request(method,path,body)).json().error.code,'whatsapp_private_route_required');
  assert.equal((await f.request('PATCH','/api/v1/channels/'+phone.id,{name:'Phone intact'})).statusCode,200); assert.equal((await f.request('GET','/api/v1/channels/'+row.id)).statusCode,200);
});
test('invalid config/foreign agent never writes and channel changes preserve CRM reauthorization triggers',async t=>{
  const f=await fixture(t); for(const patch of [{enabled:true},{token:'secret'},{externalId:'not-numeric'},{address:'invalid'}]) assert.equal((await f.request('POST','/channels',f.input(patch),randomUUID())).statusCode,400);
  const foreign=f.store.create(f.actors.foreign.tenantId,'agents',{name:'Foreign',status:'active'});assert.equal((await f.request('POST','/channels',f.input({agentId:foreign.id}),randomUUID())).statusCode,404);
  const row=(await f.create()).row, grant=f.store.create(f.tenant,'crm-capture-grants',{status:'active',revision:1,bindings:[{channelId:row.id,agentId:f.agent.id}]});
  await f.change(row,'update',{name:'Changed'});assert.equal(f.store.get(f.tenant,'crm-capture-grants',grant.id)!.status,'needs_reauthorization');assert.equal(f.calls.length,0);
});
