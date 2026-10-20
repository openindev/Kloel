import test from 'node:test';
import assert from 'node:assert/strict';
import { providerJson } from '../src/oauth/client.js';

for (const [label, body] of [['invalid JSON', '{'], ['oversized JSON', JSON.stringify({ text: 'x'.repeat(2_000_001) })], ['array JSON', '[]']] as const) {
  test(`positive HTTP receipt survives ${label} before parsing`, async t => {
    const old = globalThis.fetch; let calls = 0, observed = 0;
    globalThis.fetch = (async (_url, init) => { calls++; assert.equal(init?.redirect, 'error'); assert.ok(init?.signal); return new Response(body, { status: 200 }); }) as typeof fetch;
    t.after(() => { globalThis.fetch = old; });
    await assert.rejects(providerJson('https://synthetic.invalid', {}, false, status => { assert.equal(status, 200); observed++; }), (e: any) => e.code === 'provider_response_invalid');
    assert.equal(observed, 1); assert.equal(calls, 1);
  });
}
test('callback exceptions are not masked as parsing failures and never retry', async t => {
  const old = globalThis.fetch; let calls = 0, receipt = false;
  globalThis.fetch = (async () => { calls++; return Response.json({ ok: true }); }) as typeof fetch;
  t.after(() => { globalThis.fetch = old; });
  const error = new Error('synthetic storage failure after commit');
  await assert.rejects(providerJson('https://synthetic.invalid', {}, false, () => { receipt = true; throw error; }), e => e === error);
  assert.equal(receipt, true); assert.equal(calls, 1);
});
test('non-2xx never invokes positive callback; legacy callers keep errors and parsing', async t => {
  const old = globalThis.fetch; let status = 412, called = 0;
  globalThis.fetch = (async () => Response.json({ ok: true }, { status })) as typeof fetch;
  t.after(() => { globalThis.fetch = old; });
  await assert.rejects(providerJson('https://synthetic.invalid', {}, false, () => { called++; }), (e: any) => e.upstreamStatus === 412);
  assert.equal(called, 0); status = 200;
  assert.deepEqual(await providerJson('https://synthetic.invalid'), { ok: true });
});
test('204 empty legacy response and 202 positive status remain distinct', async t => {
  const old = globalThis.fetch; let status = 204; const statuses: number[] = [];
  globalThis.fetch = (async () => new Response(null, { status })) as typeof fetch;
  t.after(() => { globalThis.fetch = old; });
  assert.deepEqual(await providerJson('https://synthetic.invalid', {}, true), {});
  status = 202; assert.deepEqual(await providerJson('https://synthetic.invalid', {}, true, value => statuses.push(value)), {});
  assert.deepEqual(statuses, [202]);
});
