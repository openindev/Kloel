import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { beforeContextFixture } from './fixtures/before-context.js';
const collections = ['before-context-configurations', 'before-context-config-operations', 'before-context-audit'];
test('configuration max-safe revision rejects a new intent atomically before any write', async t => {
  const f = await beforeContextFixture(t); await f.enable();
  const row = f.store.list(f.actor.tenantId, collections[0])[0]; f.store.update(f.actor.tenantId, collections[0], row.id, { revision: Number.MAX_SAFE_INTEGER });
  const snapshot = collections.map(c => f.store.list(f.actor.tenantId, c));
  const result = await f.save(f.sample, Number.MAX_SAFE_INTEGER); assert.equal(result.statusCode, 409, result.body); assert.equal(result.json().error.code, 'before_context_revision_exhausted');
  assert.deepEqual(collections.map(c => f.store.list(f.actor.tenantId, c)), snapshot); assert.equal(f.openAI.length, 0);
});
test('original configuration receipt replays before max-safe guard without writing or adopting current revision', async t => {
  const f = await beforeContextFixture(t), key = randomUUID(); const first = await f.save(f.sample, 0, key); assert.equal(first.statusCode, 200, first.body);
  const row = f.store.list(f.actor.tenantId, collections[0])[0]; f.store.update(f.actor.tenantId, collections[0], row.id, { revision: Number.MAX_SAFE_INTEGER });
  const snapshot = collections.map(c => f.store.list(f.actor.tenantId, c));
  const replay = await f.save(f.sample, 0, key); assert.equal(replay.statusCode, 200, replay.body); assert.equal(replay.json().replayed, true); assert.deepEqual(replay.json().operation, first.json().operation);
  const original = await f.request('GET', '/api/v1/before-context/config-operations/' + key); assert.deepEqual(original.json(), first.json().operation);
  assert.deepEqual(collections.map(c => f.store.list(f.actor.tenantId, c)), snapshot);
});
