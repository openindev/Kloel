import { createHash } from 'node:crypto';
import { whatsappConversationReplyFixture } from './whatsapp-conversation-reply.js';
import { whatsappJobVersion } from '../../src/providers/worker.js';

export async function whatsappWorkerOnceHttpFixture(t: any) {
  const f = await whatsappConversationReplyFixture(t); await f.control('open');
  process.env.WHATSAPP_AUTOREPLY_ENABLED = 'false';
  const job = f.store.list(f.tenant, 'reply-jobs')[0], initialVersion = whatsappJobVersion(job), path = '/jobs/' + job.id + '/manual-once';
  const generated = () => Response.json({ id: 'resp.http-once', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Synthetic generated answer only' }] }] });
  f.hooks.provider = url => url === 'https://api.openai.com/v1/responses' ? generated() : f.accepted('wamid.http-once');
  const input = { expectedTenantId: f.tenant, expectedVersion: initialVersion, confirm: true };
  const run = (body: unknown = input, who = 'owner') => f.request('POST', path, body, undefined, who);
  const receipt = (version = initialVersion, who = 'owner') => f.request('GET', path + '?expectedVersion=' + encodeURIComponent(version), undefined, undefined, who);
  return { ...f, job, initialVersion, path, input, run, receipt, generated, current: () => f.store.get(f.tenant, 'reply-jobs', job.id)!, sessionHash: createHash('sha256').update(f.cookies.owner).digest('hex') };
}
