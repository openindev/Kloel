import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { Store } from '../src/store.js';
import { createContact, getContact, getSettings, saveSettings, transaction } from '../src/crm/service.js';
import { activateCapture, initializeCRMCapture } from '../src/crm/capture/authority.js';
import { recordCaptureIngress } from '../src/crm/capture/source-events.js';
import { CRMCaptureWorker } from '../src/crm/capture/worker.js';
import { proposals } from '../src/crm/capture/schema.js';
import { seedMember } from './fixtures/membership.js';

/** "Manter atualizado" / "Como a Kloel deve encontrar isso?" / "Atualizar somente quando…" reach the model and the application rule. */
test('keepUpdated replaces a changed value with evidence; other filled fields stay fill-empty', async t => {
  const env = { ...process.env }, tenant = 'keep-tenant'; let now = Date.now();
  process.env.PROVIDER_TENANT_ID = tenant; process.env.OPENAI_API_KEY = 'fixture-only'; process.env.OAUTH_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
  const store = new Store(), actor = { userId: 'keep-owner', tenantId: tenant, role: 'owner' as const }; seedMember(store, actor);
  const sessionHash = createHash('sha256').update('keep-session').digest('hex'); store.db.prepare('INSERT INTO sessions(hash,user_id,expires,tenant_id) VALUES(?,?,?,?)').run(sessionHash, actor.userId, now + 86400000, tenant);
  t.after(() => { store.close(); for (const k of ['PROVIDER_TENANT_ID', 'OPENAI_API_KEY', 'OAUTH_ENCRYPTION_KEY']) { if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; } });
  initializeCRMCapture(store);
  const agent = store.create(tenant, 'agents', { name: 'Agent', status: 'active', prompt: 'Assist', language: 'pt-BR' }), channel = store.create(tenant, 'channels', { type: 'whatsapp', provider: 'meta', agentId: agent.id, enabled: true, configuration: { externalId: 'keep-channel' } });
  saveSettings(store, tenant, { autoCapture: false, creationGate: '', definitions: [
    { key: 'plano', label: 'Plano', type: 'text', aiFill: true, keepUpdated: true, updateWhen: 'a pessoa diz que trocou de plano', findHint: 'Frases como “meu plano é …”.' },
    { key: 'cidade', label: 'Cidade', type: 'text', aiFill: true },
  ] }, 0, actor.userId);
  const [plano, cidade] = getSettings(store, tenant).definitions;
  const contact = createContact(store, tenant, { firstName: 'Ana', lastName: 'Silva', phones: [{ value: '+5511999990000' }], fieldValues: { [plano!.id]: 'Unimed', [cidade!.id]: 'Goiânia' } }, actor.userId);
  const conversation = store.create(tenant, 'conversations', { channel: 'whatsapp', channelId: channel.id, agentId: agent.id, status: 'open', externalContact: '+5511999990000', contactId: contact.id });
  let seen: any;
  const worker = new CRMCaptureWorker(store, { now: () => now, fetch: (async (_url: string, init: any) => {
    const body = JSON.parse(String(init.body)), input = JSON.parse(body.input); seen = { instructions: body.instructions, fields: input.fields };
    const source = input.sources.at(-1), span = (value: string) => ({ sourceEventId: source.id, start: source.text.indexOf(value), end: source.text.indexOf(value) + value.length, quote: value });
    const result = { candidate: 'person', subject: 'current_participant', gate: { satisfied: false, evidence: [] }, values: [{ fieldId: plano!.id, value: 'Bradesco', evidence: [span('meu plano é Bradesco')] }, { fieldId: cidade!.id, value: 'Anápolis', evidence: [span('moro em Anápolis')] }], identityClaims: [] };
    return Response.json({ id: 'resp', status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(result) }] }], usage: { input_tokens: 10, output_tokens: 10 } });
  }) as typeof fetch });
  activateCapture(store, actor, sessionHash, { optIn: true, mode: 'auto_create_fill_empty', captureContacts: false, channelIds: [channel.id], allowedFieldIds: [plano!.id, cidade!.id], reservedTokensPerDay: 1000000 }, getSettings(store, tenant).revision, null, null, now);
  now += 1000;
  transaction(store, () => {
    const message = store.create(tenant, 'messages', { conversationId: conversation.id, role: 'user', content: 'Troquei de plano: agora meu plano é Bradesco e moro em Anápolis.', source: 'fixture' });
    recordCaptureIngress(store, { tenantId: tenant, conversationId: conversation.id, channelId: channel.id, agentId: agent.id, messageId: message.id, kind: 'meta_verified_inbound', receiptId: randomUUID(), occurredAt: now, transportIdentifier: '+5511999990000' }, () => {}, now);
  });
  await worker.tick();
  const sentPlano = seen.fields.find((f: any) => f.id === plano!.id);
  assert.equal(sentPlano.label, 'Plano'); assert.equal(sentPlano.keepUpdated, true); assert.equal(sentPlano.currentValue, 'Unimed'); assert.equal(sentPlano.updateWhen, 'a pessoa diz que trocou de plano'); assert.match(sentPlano.findHint, /meu plano é/);
  assert.match(seen.instructions, /keepUpdated/);
  const proposal = store.list(tenant, proposals)[0]!; assert.equal(proposal.status, 'applied', JSON.stringify(proposal.reason));
  const updated = getContact(store, tenant, contact.id);
  assert.equal(updated.fieldValues[plano!.id], 'Bradesco'); assert.equal(updated.fieldValues[cidade!.id], 'Goiânia');
  assert.equal((updated.captureProvenance as any)[plano!.id].replacedValue, 'Unimed');
  assert.deepEqual((proposal.result as any).skippedFields, [cidade!.id]);
});
