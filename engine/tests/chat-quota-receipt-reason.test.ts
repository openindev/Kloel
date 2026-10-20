import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { billingQuotaFixture } from './fixtures/billing-quotas.js';
import { PlanError } from '../src/billing/plans.js';

type Fixture = Awaited<ReturnType<typeof billingQuotaFixture>>;
const receipt = (f: Fixture, key: string) => f.store.list(f.tenant, 'provider-operations').find(row => row.operation === 'openai.chat' && row.key === key)!;
const read = (f: Fixture, key: string) => f.request('GET', `/api/v1/ai/chat/operations/${key}`);
const counts = (f: Fixture) => ({ openAI: f.openAI.length, sheets: f.requests.length, stripe: f.stripeRequests.length, slots: f.slots(), messages: f.store.list(f.tenant, 'messages'), usage: f.store.list(f.tenant, 'provider-usage') });
const conversation = (f: Fixture) => f.store.create(f.tenant, 'conversations', { channel: 'webchat', agentId: f.agent.id, status: 'open' });

test('quota before the first round survives original GET without effect, retry or current-balance inference', async t => {
  const f = await billingQuotaFixture(t); await f.configure(0);
  const thread = conversation(f), key = randomUUID(), before = counts(f);
  const post = await f.ask(key, thread.id);
  assert.equal(post.statusCode, 429); assert.equal(post.json().error.code, 'plan_quota_exhausted');
  assert.deepEqual(counts(f), before);
  assert.equal(receipt(f, key).status, 'unknown');
  const original = await read(f, key);
  assert.equal(original.statusCode, 200);
  assert.deepEqual(original.json(), { status: 'unknown', errorCode: 'plan_quota_exhausted' });
  assert.equal(receipt(f, key).errorCode, 'plan_quota_exhausted');
  assert.deepEqual(counts(f), before);
  f.policy(5);
  assert.deepEqual((await read(f, key)).json(), original.json());
  assert.equal((await f.ask(key, thread.id)).statusCode, 409);
  assert.equal((await f.ask(randomUUID(), thread.id)).statusCode, 409);
  assert.equal(f.store.list(f.tenant, 'provider-operations').filter(row => row.operation === 'openai.chat').length, 1);
  assert.deepEqual(counts(f), before);
  assert.equal((await read(f, randomUUID())).statusCode, 404);
  f.store.db.prepare('DELETE FROM sessions WHERE hash=?').run(f.sessionHash);
  const denied = await read(f, key); assert.ok([401, 403].includes(denied.statusCode));
  assert.doesNotMatch(denied.body, /plan_quota_exhausted/);
  assert.deepEqual(counts(f), before);
});

test('quota after a completed append preserves the unknown chat reason and original effect receipt without another round', async t => {
  const f = await billingQuotaFixture(t), action = await f.create('append');
  f.toolRound(action, { nome: 'synthetic', qtd: 1, ativo: true }); await f.configure(1);
  const thread = conversation(f), key = randomUUID();
  const post = await f.ask(key, thread.id);
  assert.equal(post.statusCode, 429); assert.equal(post.json().error.code, 'plan_quota_exhausted');
  assert.equal(f.openAI.length, 1);
  assert.equal(f.requests.filter(row => row.method === 'POST').length, 1);
  assert.equal(f.slots().length, 1); assert.equal(f.slots()[0].state, 'observed');
  assert.equal(f.store.list(f.tenant, 'provider-usage').length, 1);
  const operation = await read(f, key);
  assert.equal(operation.statusCode, 200);
  assert.equal(operation.json().status, 'unknown');
  assert.equal(operation.json().errorCode, 'plan_quota_exhausted');
  assert.equal(operation.json().result, undefined);
  const refs = operation.json().sheetOperations;
  assert.equal(refs.length, 1); assert.equal(refs[0].status, 'appended'); assert.equal(refs[0].rowsAppended, 1); assert.equal(refs[0].automaticRetry, false);
  const after = counts(f);
  const discovery = await f.request('GET', `/api/v1/oauth/sheets/chat-operations/${key}`);
  assert.equal(discovery.statusCode, 200); assert.deepEqual(discovery.json().sheetOperations, refs);
  f.policy(5);
  assert.deepEqual((await read(f, key)).json(), operation.json());
  assert.equal((await f.ask(key, thread.id)).statusCode, 409);
  assert.equal((await f.ask(randomUUID(), thread.id)).statusCode, 409);
  assert.deepEqual(counts(f), after);
  assert.equal(receipt(f, key).status, 'unknown');
});

test('only the genuine quota PlanError is projected; generic code and other PlanError remain private', async t => {
  for (const kind of ['impostor', 'other_plan_error'] as const) await t.test(kind, async t => {
    const f = await billingQuotaFixture(t), key = randomUUID(), thread = conversation(f);
    const update = f.store.update.bind(f.store);
    f.store.update = ((tenant, collection, id, body) => {
      if (collection === 'provider-operations' && body.chatConversationId) {
        if (kind === 'impostor') throw Object.assign(new Error('SENSITIVE_SYNTHETIC_FAILURE'), { code: 'plan_quota_exhausted' });
        throw new PlanError(403, 'plan_not_eligible', 'SENSITIVE_SYNTHETIC_FAILURE');
      }
      return update(tenant, collection, id, body);
    }) as typeof f.store.update;
    const post = await f.ask(key, thread.id);
    assert.equal(post.statusCode, kind === 'impostor' ? 500 : 403);
    f.store.update = update;
    assert.equal(receipt(f, key).status, 'unknown'); assert.equal(receipt(f, key).errorCode, 'internal_error');
    const recovery = await read(f, key);
    assert.equal(recovery.statusCode, 200); assert.deepEqual(recovery.json(), { status: 'unknown', errorCode: 'internal_error' });
    assert.doesNotMatch(recovery.body, /SENSITIVE|plan_quota_exhausted|plan_not_eligible/);
    assert.equal(f.openAI.length, 0); assert.equal(f.slots().length, 0);
  });
});
