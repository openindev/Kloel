import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { humanFixture } from './fixtures/human-webchat.js';
import { seedMember } from './fixtures/membership.js';

test('human conversation is bidirectional while agent paused, publishes only own safe messages and makes zero AI calls', async t => {
  const f = await humanFixture(t), visitor = await f.open(), other = await f.open();
  await f.command(visitor.id, 'takeover'); f.store.update(f.tenantId, 'agents', f.agent.id, { status: 'paused' }); delete process.env.OPENAI_API_KEY;
  const input = { message: 'Preciso da equipe', idempotencyKey: randomUUID() };
  const incoming = await f.publicRequest('POST', 'messages', visitor.token, input); assert.equal(incoming.statusCode, 200); assert.equal(incoming.json().status, 'human_pending');
  assert.deepEqual((await f.publicRequest('POST', 'messages', visitor.token, input)).json(), incoming.json());
  const reply = await f.command(visitor.id, 'replies', 'Resposta humana <b>literal</b>'); assert.equal(reply.value.result.delivery, 'available_in_chat');
  assert.equal((await f.request('GET', visitor.id, 'reply-context')).json().capabilities.release, false);
  f.store.create(f.tenantId, 'messages', { conversationId: visitor.id, role: 'system', kind: 'internal_note', content: 'INTERNAL-MARKER' });
  f.store.create(f.tenantId, 'messages', { conversationId: visitor.id, role: 'assistant', source: 'manual', deliveryStatus: 'recorded', content: 'LOCAL-MARKER' });
  const history = await f.publicRequest('GET', 'history', visitor.token); assert.equal(history.statusCode, 200); assert.equal(history.json().items.length, 2);
  assert.deepEqual(history.json().items.map((row: any) => row.authorType), ['visitor', 'human']);
  for (const secret of ['INTERNAL-MARKER', 'LOCAL-MARKER', f.owner.userId, f.tenantId, 'authorMembershipId']) assert.ok(!history.body.includes(secret));
  assert.equal((await f.publicRequest('GET', 'history', other.token)).json().items.length, 0); assert.equal(f.calls.length, 0);
});

test('reply transaction gives one durable receipt across response loss, concurrent same-key replay and changed payload', async t => {
  const f = await humanFixture(t), v = await f.open(); await f.command(v.id, 'takeover'); const body = await f.body(v.id, 'Uma cópia');
  const [one, two] = await Promise.all([f.request('POST', v.id, 'replies', body), f.request('POST', v.id, 'replies', body)]);
  assert.equal(one.statusCode, 200); assert.deepEqual(two.json(), one.json());
  assert.equal((await f.request('POST', v.id, 'replies', { ...body, content: 'Outra cópia' })).json().error.code, 'idempotency_conflict');
  const lookup = await f.request('GET', v.id, 'reply-operations/' + body.idempotencyKey); assert.deepEqual(lookup.json(), one.json());
  assert.equal(lookup.headers['cache-control'], 'no-store'); assert.ok(!lookup.body.includes('Uma cópia')); assert.ok(!lookup.body.includes('fingerprint'));
  assert.equal(f.store.list(f.tenantId, 'messages').length, 1);
  assert.equal((await f.request('GET', v.id, 'reply-operations/' + body.idempotencyKey, undefined, 'other')).statusCode, 404);
});

test('CAS and stale-tenant body fail before effects; owner-to-viewer before BEGIN is freshly denied', async t => {
  const f = await humanFixture(t), v = await f.open(), initial = await f.body(v.id);
  assert.equal((await f.request('POST', v.id, 'takeover', { ...initial, expectedTenantId: 'wrong' })).json().error.code, 'tenant_mismatch');
  const results = await Promise.all([f.request('POST', v.id, 'takeover', initial), f.request('POST', v.id, 'takeover', { ...initial, idempotencyKey: randomUUID() })]);
  assert.deepEqual(results.map(row => row.statusCode).sort(), [200, 409]); assert.equal(f.store.list(f.tenantId, 'conversation-reply-operations').length, 1);
  const payload = await f.body(v.id, 'Must not commit'); const transaction = f.store.transaction.bind(f.store); let armed = true;
  f.store.transaction = fn => { if (armed) { armed = false; f.store.db.prepare("UPDATE memberships SET role='viewer' WHERE user_id=? AND tenant_id=?").run(f.owner.userId, f.tenantId); } return transaction(fn); };
  const denied = await f.request('POST', v.id, 'replies', payload); assert.equal(denied.statusCode, 403); assert.equal(f.store.list(f.tenantId, 'messages').length, 0);
});

test('cookie tenant switch before BEGIN cannot write into either organization', async t => {
  const f = await humanFixture(t), v = await f.open(), body = await f.body(v.id);
  const transaction = f.store.transaction.bind(f.store); let armed = true;
  f.store.transaction = fn => { if (armed) { armed = false; f.store.db.prepare('UPDATE sessions SET tenant_id=? WHERE user_id=?').run('other-tenant', f.owner.userId); } return transaction(fn); };
  assert.equal((await f.request('POST', v.id, 'takeover', body)).statusCode, 401);
  assert.equal(f.store.list(f.tenantId, 'conversation-reply-operations').length, 0); assert.equal(f.store.list('other-tenant', 'conversation-reply-operations').length, 0);
});

test('receipt recovery rejects role ABA, removal/rejoin, missing human cookie and viewer writes', async t => {
  const f = await humanFixture(t), v = await f.open(), taken = await f.command(v.id, 'takeover'), path = 'reply-operations/' + taken.payload.idempotencyKey;
  assert.equal((await f.request('POST', v.id, 'replies', await f.body(v.id, 'Denied'), 'viewer')).statusCode, 403);
  assert.equal((await f.app.inject('/api/v1/conversations/' + v.id + '/' + path)).statusCode, 401);
  f.store.db.prepare("UPDATE memberships SET role='admin' WHERE user_id=? AND tenant_id=?").run(f.owner.userId, f.tenantId);
  f.store.db.prepare("UPDATE memberships SET role='owner' WHERE user_id=? AND tenant_id=?").run(f.owner.userId, f.tenantId);
  assert.equal((await f.request('GET', v.id, path)).statusCode, 404);
  const reply = await f.command(v.id, 'replies', 'Before rejoin');
  f.store.db.prepare('DELETE FROM memberships WHERE user_id=? AND tenant_id=?').run(f.owner.userId, f.tenantId); seedMember(f.store, f.owner);
  assert.equal((await f.request('GET', v.id, 'reply-operations/' + reply.payload.idempotencyKey)).statusCode, 404);
});

test('transaction rollback cannot leave an unreceipted human message and pending receipts never repeat', async t => {
  const f = await humanFixture(t), v = await f.open(); await f.command(v.id, 'takeover'); const body = await f.body(v.id, 'Atomic only');
  const create = f.store.create.bind(f.store);
  f.store.create = (tenant, collection, data) => { if (collection === 'conversation-reply-operations') throw Error('synthetic persistence failure'); return create(tenant, collection, data); };
  assert.equal((await f.request('POST', v.id, 'replies', body)).statusCode, 500); assert.equal(f.store.list(f.tenantId, 'messages').length, 0); f.store.create = create;
  const committed = await f.request('POST', v.id, 'replies', body); assert.equal(committed.statusCode, 200);
  const op = f.store.list(f.tenantId, 'conversation-reply-operations').find(row => row.key === body.idempotencyKey)!;
  f.store.update(f.tenantId, 'conversation-reply-operations', op.id, { status: 'unknown' });
  const replay = await f.request('POST', v.id, 'replies', body); assert.equal(replay.json().status, 'unknown'); assert.equal(replay.json().result, undefined); assert.equal(f.store.list(f.tenantId, 'messages').length, 1);
});

for (const via of ['takeover', 'control', 'crud'] as const) test(`AI publication is fenced across ${via} human/AI ABA while input stays recorded`, async t => {
  const f = await humanFixture(t), v = await f.open(); let release!: () => void, entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  f.state.respond = async () => { entered(); await new Promise<void>(resolve => { release = resolve; }); return Response.json({ id: 'late', output: [{ type: 'message', content: [{ type: 'output_text', text: 'STALE-ANSWER' }] }] }); };
  const body = { message: 'Pergunta em voo', idempotencyKey: randomUUID() }, pending = f.publicRequest('POST', 'messages', v.token, body); await started;
  if (via === 'takeover') { await f.command(v.id, 'takeover'); await f.command(v.id, 'release'); }
  else for (const status of ['pending', 'open']) { const previous = (await f.request('GET', v.id, 'control')).json(); const change = await f.request('PATCH', v.id, via === 'control' ? 'control' : '', { ...(via === 'control' ? { expectedVersion: previous.version } : {}), status }); assert.equal(change.statusCode, 200, change.body); }
  release(); const response = await pending; assert.equal(response.statusCode, 200, response.body); assert.equal(response.json().responseState, 'suppressed');
  assert.deepEqual((await f.publicRequest('POST', 'messages', v.token, body)).json(), response.json());
  assert.equal(f.calls.length, 1); assert.ok(!JSON.stringify(f.store.list(f.tenantId, 'messages')).includes('STALE-ANSWER'));
});

test('history pages use own message cursor, exclude notes and reject foreign cursor; model uses same safe projection', async t => {
  const f = await humanFixture(t), v = await f.open(), other = await f.open();
  for (let n = 0; n < 85; n++) f.store.create(f.tenantId, 'messages', { conversationId: v.id, role: 'user', authorType: 'visitor', content: 'visible-' + n, source: 'public_widget' });
  f.store.create(f.tenantId, 'messages', { conversationId: v.id, role: 'assistant', content: 'LOCAL-SECRET', source: 'manual', deliveryStatus: 'recorded' });
  const first = (await f.publicRequest('GET', 'history', v.token)).json(); assert.equal(first.items.length, 80); assert.equal(first.hasMore, true);
  const second = (await f.publicRequest('GET', 'history', v.token, undefined, '&after=' + first.cursor)).json(); assert.equal(second.items.length, 5); assert.equal(second.hasMore, false);
  assert.equal((await f.publicRequest('GET', 'history', other.token, undefined, '&after=' + first.cursor)).statusCode, 400);
  assert.equal((await f.publicRequest('POST', 'messages', v.token, { message: 'Resumo', idempotencyKey: randomUUID() })).statusCode, 200);
  assert.ok(!JSON.stringify(f.calls).includes('LOCAL-SECRET'));
});

for (const change of ['closed', 'expired', 'disabled', 'origin', 'agent_deleted'] as const) test(`${change} denies human writes and visitor access coherently`, async t => {
  const f = await humanFixture(t), v = await f.open(); await f.command(v.id, 'takeover');
  if (change === 'closed') f.store.update(f.tenantId, 'conversations', v.id, { status: 'closed' });
  if (change === 'expired') f.advance(13 * 3600000);
  if (change === 'disabled') f.store.update(f.tenantId, 'channels', f.channel.id, { enabled: false });
  if (change === 'origin') f.store.update(f.tenantId, 'channels', f.channel.id, { configuration: { allowedOrigins: [] } });
  if (change === 'agent_deleted') f.store.remove(f.tenantId, 'agents', f.agent.id);
  const context = (await f.request('GET', v.id, 'reply-context')).json(); assert.equal(context.capabilities.reply, false);
  assert.equal((await f.request('POST', v.id, 'replies', { expectedTenantId: f.tenantId, expectedVersion: context.version, idempotencyKey: randomUUID(), content: 'Denied' })).statusCode, 409);
  assert.ok([401, 403, 410].includes((await f.publicRequest('GET', 'history', v.token)).statusCode)); assert.equal(f.store.list(f.tenantId, 'messages').length, 0);
});

test('unknown-input continuation proof requires its own public message and absence of every session inFlight', async t => {
  const f = await humanFixture(t), visitor = await f.open(), key = randomUUID(); f.state.respond = async () => { throw Error('synthetic unknown'); };
  assert.equal((await f.publicRequest('POST', 'messages', visitor.token, { message: 'Recorded input', idempotencyKey: key })).statusCode, 502);
  const status = async () => (await f.publicRequest('GET', 'history', visitor.token, undefined, '&operationKey=' + key)).json().operation;
  assert.equal((await status()).inputRecorded, true); assert.equal((await status()).canContinue, true);
  f.store.update(f.tenantId, 'public-chat-sessions', visitor.session.id, { inFlight: randomUUID() });
  assert.equal((await status()).canContinue, false);
  f.store.update(f.tenantId, 'public-chat-sessions', visitor.session.id, { inFlight: null });
  const op = f.store.list(f.tenantId, 'public-chat-operations')[0]; f.store.update(f.tenantId, 'public-chat-operations', op.id, { visitorMessageId: randomUUID() });
  assert.equal((await status()).inputRecorded, false); assert.equal((await status()).canContinue, false); assert.equal((await status()).messageId, null);
});
