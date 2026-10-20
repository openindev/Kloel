import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { RealtimeSidebands } from '../src/providers/realtime.js';

test('hangup receipts preserve HTTP outcomes without treating rejection as completion or storing response content', async t => {
  for (const [httpStatus, expected] of [[200, 'accepted'], [404, 'rejected'], [429, 'rejected'], [503, 'unknown']] as const) {
    await t.test(String(httpStatus), async () => {
      const store = new Store(), original = globalThis.fetch;
      const sidebands = new RealtimeSidebands(store);
      let attempts = 0;
      globalThis.fetch = (async () => {
        attempts++;
        return new Response('PRIVATE_PROVIDER_RESPONSE', { status: httpStatus, headers: { 'x-request-id': 'PRIVATE_HEADER' } });
      }) as typeof fetch;
      try {
        assert.equal(await sidebands.stopCall('rtc_diagnostic', 'PRIVATE_KEY', 'diagnostics', 'realtime_control_disconnected'), expected);
        const receipt = store.list('diagnostics', 'voice-stop-operations')[0];
        assert.equal(receipt.status, expected); assert.equal(receipt.providerHttpStatus, httpStatus);
        assert.equal(receipt.outcomeKind, 'http_response');
        assert.doesNotMatch(JSON.stringify(receipt), /PRIVATE_PROVIDER_RESPONSE|PRIVATE_HEADER|PRIVATE_KEY/);
        assert.equal(await sidebands.stopCall('rtc_diagnostic', 'PRIVATE_KEY', 'diagnostics', 'user_cancelled'), expected);
        assert.equal(attempts, 1); assert.equal(store.list('diagnostics', 'voice-stop-operations').length, 1);
        assert.equal(store.list('diagnostics', 'voice-stop-operations')[0].reason, 'realtime_control_disconnected');
      } finally { await sidebands.close(); globalThis.fetch = original; store.close(); }
    });
  }
});

test('network failure retains uncertainty and no fabricated HTTP status; reading the receipt never retries', async () => {
  const store = new Store(), original = globalThis.fetch, sidebands = new RealtimeSidebands(store);
  let attempts = 0;
  globalThis.fetch = (async () => { attempts++; throw new Error('PRIVATE_NETWORK_DIAGNOSTIC'); }) as typeof fetch;
  try {
    assert.equal(await sidebands.stopCall('rtc_network', 'PRIVATE_KEY', 'diagnostics', 'realtime_control_failed'), 'unknown');
    const receipt = store.list('diagnostics', 'voice-stop-operations')[0];
    assert.equal(receipt.providerHttpStatus, null); assert.equal(receipt.outcomeKind, 'network_error');
    assert.doesNotMatch(JSON.stringify(receipt), /PRIVATE_NETWORK_DIAGNOSTIC|PRIVATE_KEY/);
    assert.equal(await sidebands.stopCall('rtc_network', 'PRIVATE_KEY', 'diagnostics', 'user_cancelled'), 'unknown');
    assert.equal(attempts, 1);
  } finally { await sidebands.close(); globalThis.fetch = original; store.close(); }
});

test('a locally expired hangup timeout is recorded without repeating the request', async t => {
  const store = new Store(), original = globalThis.fetch, sidebands = new RealtimeSidebands(store);
  const expired = AbortSignal.abort(new DOMException('PRIVATE_TIMEOUT', 'TimeoutError'));
  t.mock.method(AbortSignal, 'timeout', () => expired);
  let attempts = 0;
  globalThis.fetch = (async (_url, options) => { attempts++; options?.signal?.throwIfAborted(); throw new Error('expected expired signal'); }) as typeof fetch;
  try {
    assert.equal(await sidebands.stopCall('rtc_timeout', 'PRIVATE_KEY', 'diagnostics', 'realtime_control_failed'), 'unknown');
    const receipt = store.list('diagnostics', 'voice-stop-operations')[0];
    assert.equal(receipt.providerHttpStatus, null); assert.equal(receipt.outcomeKind, 'timeout');
    assert.doesNotMatch(JSON.stringify(receipt), /PRIVATE_TIMEOUT|PRIVATE_KEY/);
    assert.equal(await sidebands.stopCall('rtc_timeout', 'PRIVATE_KEY', 'diagnostics', 'user_cancelled'), 'unknown');
    assert.equal(attempts, 1);
  } finally { await sidebands.close(); globalThis.fetch = original; store.close(); t.mock.restoreAll(); }
});

test('existing stop receipts remain unchanged and do not invent historical provider diagnostics', async () => {
  const store = new Store(), original = globalThis.fetch, sidebands = new RealtimeSidebands(store);
  const receipt = store.create('diagnostics', 'voice-stop-operations', { callId: 'rtc_historical', status: 'rejected', reason: 'realtime_control_disconnected' });
  let attempts = 0;
  globalThis.fetch = (async () => { attempts++; throw new Error('must not request'); }) as typeof fetch;
  try {
    assert.equal(await sidebands.stopCall('rtc_historical', 'PRIVATE_KEY', 'diagnostics', 'user_cancelled'), 'rejected');
    assert.deepEqual(store.get('diagnostics', 'voice-stop-operations', receipt.id), receipt);
    assert.equal(attempts, 0);
  } finally { await sidebands.close(); globalThis.fetch = original; store.close(); }
});

test('disposing an HTTP response body cannot erase its observed outcome', async () => {
  const store = new Store(), original = globalThis.fetch, sidebands = new RealtimeSidebands(store);
  globalThis.fetch = (async () => ({
    ok: false, status: 404,
    body: { cancel: async () => { throw new Error('PRIVATE_DISPOSAL_ERROR'); } },
  } as unknown as Response)) as typeof fetch;
  try {
    assert.equal(await sidebands.stopCall('rtc_body', 'PRIVATE_KEY', 'diagnostics', 'realtime_control_disconnected'), 'rejected');
    const receipt = store.list('diagnostics', 'voice-stop-operations')[0];
    assert.equal(receipt.providerHttpStatus, 404); assert.equal(receipt.outcomeKind, 'http_response');
    assert.doesNotMatch(JSON.stringify(receipt), /PRIVATE_DISPOSAL_ERROR|PRIVATE_KEY/);
  } finally { await sidebands.close(); globalThis.fetch = original; store.close(); }
});
