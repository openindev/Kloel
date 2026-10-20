import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createWhatsAppWorker, whatsappJobVersion } from '../src/providers/worker.js';
import { resolveSessionContext } from '../src/request-context.js';
import { whatsappConversationReplyFixture } from './fixtures/whatsapp-conversation-reply.js';

function gate() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }

test('stop followed by start must not revive the stopped one-job execution', async t => {
  const f = await whatsappConversationReplyFixture(t); await f.control('open');
  process.env.WHATSAPP_AUTOREPLY_ENABLED = 'false';
  const job = f.store.list(f.tenant, 'reply-jobs')[0], worker = createWhatsAppWorker(f.store);
  t.after(() => worker.stop());
  const sessionHash = createHash('sha256').update(f.cookies.owner).digest('hex');
  const input = { tenantId: f.tenant, jobId: job.id, expectedVersion: whatsappJobVersion(job), authority: { sessionHash, context: resolveSessionContext(f.store, sessionHash)!.context }, assertAccess: () => {} };
  const entered = gate(), release = gate();
  f.hooks.provider = async url => {
    if (url === 'https://api.openai.com/v1/responses') {
      entered.release(); await release.promise;
      return Response.json({ id: 'resp.independent-stop', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Synthetic stopped turn' }] }] });
    }
    return f.accepted('wamid.independent-stopped');
  };
  const running = worker.runJobOnce(input).then(value => ({ value, error: null }), error => ({ value: null, error }));
  await entered.promise;
  await worker.stop();
  worker.start();
  release.release();
  const result = await running;
  assert.equal(f.calls.filter(call => call.url.startsWith('https://graph.facebook.com/')).length, 0, 'A stopped execution must not dispatch Meta after a later start');
  assert.equal(result.error?.code, 'worker_stopped');
  assert.equal(f.store.get(f.tenant, 'reply-jobs', job.id)!.manualOnceEffect, 'not_dispatched');
  assert.equal(process.env.WHATSAPP_AUTOREPLY_ENABLED, 'false');
});
