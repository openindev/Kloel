import { guardedBoundary } from './fixtures/request-context.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { Store } from '../src/store.js';
import { registerAuth } from '../src/auth.js';
import { registerCRM } from '../src/crm.js';
import { registerCRMCapture } from '../src/crm-capture.js';
import { createContact, getContact, getSettings, saveSettings, transaction, updateContact } from '../src/crm/service.js';
import { activateCapture, initializeCRMCapture, resolveCapture, stopCapture, publicCaptureGrant } from '../src/crm/capture/authority.js';
import { recordCaptureIngress, sourceEvent } from '../src/crm/capture/source-events.js';
import { CRMCaptureWorker } from '../src/crm/capture/worker.js';
import { applyCaptureProposal, proposalData, publicProposal } from '../src/crm/capture/proposals.js';
import { grants, jobs, proposals } from '../src/crm/capture/schema.js';
import { seedMember } from './fixtures/membership.js';
import { createApiKey } from '../src/api-keys/service.js';

type Mock = (body: any) => Response | Promise<Response>;
async function fixture(t: any, options: { type?: 'phone' | 'webchat' | 'whatsapp'; definitions?: any[] } = {}) {
  const env = { ...process.env }; const tenant = 'capture-tenant'; let now = Date.now();
  process.env.PROVIDER_TENANT_ID = tenant; process.env.OPENAI_API_KEY = 'fixture-only'; process.env.OAUTH_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  const store = new Store(), actor = { userId: 'capture-owner', tenantId: tenant, role: 'owner' as const }; seedMember(store, actor);
  const session = 'capture-fixture-session', sessionHash = createHash('sha256').update(session).digest('hex'); store.db.prepare('INSERT INTO sessions(hash,user_id,expires,tenant_id) VALUES(?,?,?,?)').run(sessionHash, actor.userId, now + 86400000, tenant);
  initializeCRMCapture(store);
  const agent = store.create(tenant, 'agents', { name: 'Capture Agent', status: 'active', prompt: 'Assist', language: 'pt-BR' }), channel = store.create(tenant, 'channels', { type: options.type ?? 'whatsapp', provider: options.type === 'phone' ? 'openai' : options.type === 'webchat' ? 'local' : 'meta', agentId: agent.id, enabled: true, configuration: { externalId: 'fixture-channel' } });
  const settings = saveSettings(store, tenant, { autoCapture: true, creationGate: '', definitions: options.definitions ?? [] }, 0, actor.userId);
  const conversation = store.create(tenant, 'conversations', { channel: channel.type, channelId: channel.id, agentId: agent.id, status: 'open', ...(channel.type !== 'webchat' ? { externalContact: '+5511999990000' } : {}) });
  let calls = 0, mock: Mock = body => Response.json(output(body));
  const worker = new CRMCaptureWorker(store, { now: () => now, fetch: (async (url, init) => { calls++; assert.equal(url, 'https://api.openai.com/v1/responses'); const body = JSON.parse(String(init?.body)); assert.equal(body.store, false); assert.equal(body.tools, undefined); return mock(body); }) as typeof fetch });
  const app = Fastify(); await app.register(cookie); await registerAuth(app, store); await registerCRM(app, store); await registerCRMCapture(app, store, worker);
  t.after(async () => { await app.close(); store.close(); for (const k of ['PROVIDER_TENANT_ID', 'OPENAI_API_KEY', 'OAUTH_ENCRYPTION_KEY']) { if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; } });
  function activate(extra: any = {}) { const old = store.list(tenant, grants).at(-1); return activateCapture(store, actor, sessionHash, { optIn: true, mode: 'review', captureContacts: true, channelIds: [channel.id], reservedTokensPerDay: 1000000, ...extra }, getSettings(store, tenant).revision, old?.id ?? null, old ? Number(old.revision) : null, now); }
  function inbound(text = 'Meu nome é Ana Silva.', extras: any = {}) {
    now += 1000;
    return transaction(store, () => {
      const message = store.create(tenant, 'messages', { conversationId: conversation.id, role: 'user', content: text, source: 'fixture' });
      const event = recordCaptureIngress(store, { tenantId: tenant, conversationId: conversation.id, channelId: channel.id, agentId: agent.id, messageId: message.id, kind: channel.type === 'webchat' ? 'public_chat_visitor_message' : channel.type === 'phone' ? 'voice_final_user_transcript' : 'meta_verified_inbound', receiptId: randomUUID(), occurredAt: now, ...(channel.type === 'phone' ? { sessionStartedAt: now - 1 } : {}), ...(channel.type !== 'webchat' ? { transportIdentifier: '+5511999990000' } : {}), ...extras }, () => {}, now);
      return { message, event, job: store.list(tenant, jobs).at(-1) };
    });
  }
  const request = (method: any, url: string, payload?: any, headers?: Record<string,string>) => app.inject({ method, url, payload, headers, cookies: { kloel_session: session } });
  return { store, actor, session, sessionHash, tenant, agent, channel, settings, conversation, app, worker, activate, inbound, request, calls: () => calls, mock: (fn: Mock) => { mock = fn; }, now: () => now, advance: (n: number) => { now += n; } };
}
function extracted(body: any) {
  const input = JSON.parse(body.input), source = input.sources.at(-1), span = (value: string) => ({ sourceEventId: source.id, start: source.text.indexOf(value), end: source.text.indexOf(value) + value.length, quote: value });
  return { candidate: 'person', subject: 'current_participant', gate: { satisfied: true, evidence: [span('Ana Silva')] }, values: [{ fieldId: 'firstName', value: 'Ana', evidence: [span('Ana')] }, { fieldId: 'lastName', value: 'Silva', evidence: [span('Silva')] }], identityClaims: [] };
}
function output(body: any, edit?: (result: any) => void) { const result = extracted(body); edit?.(result); return { id: 'response_fixture', status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(result) }] }], usage: { input_tokens: 100, output_tokens: 80 } }; }
const code = (value: string) => (error: any) => error.code === value;

test('authenticated ingress is atomic, deduplicated, future-only and cannot be spoofed by CRUD metadata', async t => {
  const f = await fixture(t); const past = f.inbound(); assert.equal(past.event.jobs, 0); const grant = f.activate();
  f.store.create(f.tenant, 'messages', { conversationId: f.conversation.id, role: 'user', source: 'meta', providerMessageId: 'forged', content: 'Ana Silva' });
  await f.worker.tick(); assert.equal(f.calls(), 0);
  const next = f.inbound(); assert.equal(next.event.jobs, 1); const event = sourceEvent(f.store, f.tenant, next.event.eventId!);
  const { id, sequence, acceptedAt, contentHash, bindingHash, conversationContactId, expiresAt, encryptedText, dedupKey, ...original } = event;
  assert.equal(recordCaptureIngress(f.store, original, () => {}, f.now()).recorded, false); assert.equal(f.store.list(f.tenant, jobs).length, 1);
  const before = f.store.list(f.tenant, 'messages').length;
  assert.throws(() => transaction(f.store, () => { const m = f.store.create(f.tenant, 'messages', { conversationId: f.conversation.id, role: 'user', content: 'Ana Silva' }); recordCaptureIngress(f.store, { ...original, messageId: m.id, receiptId: 'denied' }, () => { throw new Error('Revoked ingress'); }, f.now()); }), /Revoked ingress/);
  assert.equal(f.store.list(f.tenant, 'messages').length, before); assert.ok(Number(grant.sourceBaselineSequence) >= past.event.jobs);
});

test('review creates an encrypted evidence proposal and human CAS application persists one real contact', async t => {
  const f = await fixture(t); f.activate(); const source = f.inbound(); await f.worker.tick();
  assert.equal(f.calls(), 1); assert.equal(f.store.list(f.tenant, 'contacts').length, 0); const proposal = f.store.list(f.tenant, proposals)[0];
  assert.ok(!JSON.stringify(proposal).includes('"Ana"')); const view = publicProposal(f.store, f.tenant, proposal.id); assert.equal(proposal.promptVersion, 3); assert.equal(view.diff[0].value, 'Ana'); assert.equal(view.diff[0].evidence[0].sourceEventId, source.event.eventId);
  const input = { actor: f.actor, sessionHash: f.sessionHash, key: 'review-apply-1', proposalRevision: 1, contactRevision: null };
  const applied = applyCaptureProposal(f.store, f.tenant, proposal.id, { kind: 'human', input }, f.now()); assert.equal(applied.replayed, false);
  const contact = getContact(f.store, f.tenant, String(applied.contactId)); assert.equal(contact.name, 'Ana Silva'); assert.equal(contact.consent && (contact.consent as any).whatsapp, false); assert.equal((contact.captureProvenance as any).firstName.origin, 'human_review');
  assert.equal(f.store.list(f.tenant, 'contact-permission-events').length, 0); assert.equal(f.store.get(f.tenant, 'conversations', f.conversation.id)?.contactId, contact.id);
  assert.equal(applyCaptureProposal(f.store, f.tenant, proposal.id, { kind: 'human', input }, f.now()).replayed, true); assert.equal(f.store.list(f.tenant, 'contacts').length, 1);
});

test('automatic mode creates contact with grant provenance and never consent or outbound messages', async t => {
  const f = await fixture(t); const grant = f.activate({ mode: 'auto_create_fill_empty' }); f.inbound(); const before = f.store.list(f.tenant, 'messages').length; await f.worker.tick();
  const contact = f.store.list(f.tenant, 'contacts')[0]; assert.ok(contact); assert.equal(contact.name, 'Ana Silva'); assert.equal(contact.source, 'automation');
  const row = f.store.list(f.tenant, proposals)[0]; assert.equal(row.status, 'applied'); assert.equal((row.authorization as any).kind, 'crm_capture_grant'); assert.equal((row.authorization as any).grantId, grant.id); assert.equal((row.authorization as any).userId, undefined);
  assert.equal(f.store.list(f.tenant, 'messages').length, before); assert.deepEqual(f.store.list(f.tenant, 'contact-permission-events'), []); await f.worker.tick(); assert.equal(f.calls(), 1);
});

test('auto fill preserves false, zero and manual text while applying an absent typed field', async t => {
  const f = await fixture(t, { definitions: [{ key: 'flag', label: 'Flag', type: 'boolean', aiFill: true }, { key: 'total', label: 'Total', type: 'number', aiFill: true }, { key: 'note', label: 'Note', type: 'text', aiFill: true }] });
  const [flag, total, note] = getSettings(f.store, f.tenant).definitions;
  const contact = createContact(f.store, f.tenant, { firstName: 'Original', lastName: 'Person', phones: [{ value: '+5511999990000' }], fieldValues: { [flag.id]: false, [total.id]: '0' } }, f.actor.userId);
  f.store.update(f.tenant, 'conversations', f.conversation.id, { contactId: contact.id });
  f.activate({ mode: 'auto_create_fill_empty', allowedFieldIds: [flag.id, total.id, note.id] });
  f.mock(body => Response.json(output(body, value => { const evidence = value.values[0].evidence, at = JSON.parse(body.input).sources.at(-1).text.indexOf('1'); value.values.push({ fieldId: flag.id, value: true, evidence }, { fieldId: total.id, value: '1', evidence: [{ ...evidence[0], start: at, end: at + 1, quote: '1' }] }, { fieldId: note.id, value: 'Ana', evidence }); })));
  f.inbound('Meu nome é Ana Silva.  1'); await f.worker.tick();
  const saved = getContact(f.store, f.tenant, contact.id); assert.equal(saved.firstName, 'Original'); assert.equal(saved.fieldValues[flag.id], false); assert.equal(saved.fieldValues[total.id], '0'); assert.equal(saved.fieldValues[note.id], 'Ana'); assert.equal(saved.revision, 2);
});

test('revocation during OpenAI await prevents proposal and contact, and never fabricates membership', async t => {
  const f = await fixture(t); f.activate({ mode: 'auto_create_fill_empty' }); f.inbound();
  f.mock(body => { f.store.db.prepare('DELETE FROM memberships WHERE tenant_id=? AND user_id=?').run(f.tenant, f.actor.userId); seedMember(f.store, f.actor); return Response.json(output(body)); });
  await f.worker.tick(); assert.equal(f.calls(), 1); assert.equal(f.store.list(f.tenant, 'contacts').length, 0); assert.equal(f.store.list(f.tenant, proposals).length, 0); assert.equal(f.store.list(f.tenant, grants)[0].status, 'revoked');
  await f.worker.tick(); assert.equal(f.calls(), 1);
});

test('role roundtrip, channel replacement and settings revision invalidate grants durably', async t => {
  const f = await fixture(t); let grant = f.activate();
  f.store.db.prepare("UPDATE memberships SET role='member' WHERE user_id=?").run(f.actor.userId); f.store.db.prepare("UPDATE memberships SET role='owner' WHERE user_id=?").run(f.actor.userId);
  assert.throws(() => resolveCapture(f.store, f.tenant, grant.id, f.now()), code('capture_grant_inactive'));
  grant = f.activate(); f.store.update(f.tenant, 'channels', f.channel.id, { configuration: { externalId: 'new-binding' } }); assert.equal(f.store.get(f.tenant, grants, grant.id)?.status, 'needs_reauthorization');
  grant = f.activate(); const settings = getSettings(f.store, f.tenant); saveSettings(f.store, f.tenant, { creationGate: settings.creationGate, definitions: [], autoCapture: false }, settings.revision, f.actor.userId); assert.equal(f.store.get(f.tenant, grants, grant.id)?.status, 'needs_reauthorization');
});

test('malicious output, fabricated evidence and third party cannot auto write', async t => {
  for (const kind of ['extra', 'quote', 'subject'] as const) {
    await t.test(kind, async child => {
      const f = await fixture(child); f.activate({ mode: 'auto_create_fill_empty' }); f.inbound();
      f.mock(body => Response.json(output(body, value => { if (kind === 'extra') value.consent = true; else if (kind === 'quote') value.values[0].evidence[0].quote = 'invented'; else value.subject = 'third_party'; })));
      await f.worker.tick(); assert.equal(f.store.list(f.tenant, 'contacts').length, 0); assert.equal(f.store.list(f.tenant, 'contact-permission-events').length, 0);
    });
  }
});

test('source mutation during await blocks extraction and stale contact CAS blocks review', async t => {
  const f = await fixture(t); f.activate(); const source = f.inbound();
  f.mock(body => { f.store.update(f.tenant, 'messages', source.message.id, { content: 'Changed' }); return Response.json(output(body)); });
  await f.worker.tick(); assert.equal(f.store.list(f.tenant, proposals).length, 0);
  const contact = createContact(f.store, f.tenant, { phones: [{ value: '+5511999990000' }] }, f.actor.userId); f.store.update(f.tenant, 'conversations', f.conversation.id, { contactId: contact.id });
  f.mock(body => Response.json(output(body))); f.inbound(); await f.worker.tick(); const row = f.store.list(f.tenant, proposals)[0]; assert.ok(row);
  updateContact(f.store, f.tenant, contact.id, { company: 'Human edit' }, contact.revision, f.actor.userId);
  assert.throws(() => applyCaptureProposal(f.store, f.tenant, row.id, { kind: 'human', input: { actor: f.actor, sessionHash: f.sessionHash, proposalRevision: 1, contactRevision: 1, key: 'stale-review-key' } }, f.now()), code('revision_conflict'));
});

test('ambiguous legacy multichannel identities remain pending, anonymous webchat cannot auto create', async t => {
  const f = await fixture(t); const a = createContact(f.store, f.tenant, { phones: [{ value: '+5511999990000' }] }, f.actor.userId); f.store.create(f.tenant, 'contacts', { ...a, phones: a.phones });
  f.activate({ mode: 'auto_create_fill_empty', allowTransportMatch: true }); f.inbound(); await f.worker.tick(); assert.equal(f.store.list(f.tenant, 'contacts').length, 2); assert.equal(f.store.list(f.tenant, proposals)[0].status, 'proposed');
  await t.test('anonymous chat', async child => { const g = await fixture(child, { type: 'webchat' }); g.activate({ mode: 'auto_create_fill_empty' }); g.inbound(); await g.worker.tick(); assert.equal(g.store.list(g.tenant, 'contacts').length, 0); assert.match(String(g.store.list(g.tenant, proposals)[0].reason), /identity_requires_review/); });
});

test('network uncertainty, quotas and recovered lease never silently retry a charged generation', async t => {
  const f = await fixture(t); f.activate({ jobsPerDay: 1 }); f.inbound(); f.mock(() => { throw new Error('Lost response'); });
  await f.worker.tick(); assert.equal(f.store.list(f.tenant, jobs)[0].status, 'generation_unknown'); await f.worker.tick(); assert.equal(f.calls(), 1);
  f.inbound(); await f.worker.tick(); assert.equal(f.calls(), 1); assert.equal(f.store.list(f.tenant, jobs)[1].reason, 'capture_quota_exceeded');
  f.store.update(f.tenant, jobs, f.store.list(f.tenant, jobs)[1].id, { status: 'running', leaseUntil: f.now() - 1, attemptedAt: f.now() - 1 });
  await f.worker.tick(); assert.equal(f.store.list(f.tenant, jobs)[1].status, 'generation_unknown'); assert.equal(f.calls(), 1);
});

test('HTTP boundaries require human scope, current session and tenant; reads never expose ciphertext', async t => {
  const f = await fixture(t); const grant = f.activate(); f.inbound(); await f.worker.tick(); const proposal = f.store.list(f.tenant, proposals)[0];
  const view = await f.request('GET', `/api/v1/crm/capture/proposals/${proposal.id}`); assert.equal(view.statusCode, 200, view.body); assert.ok(!view.body.includes('encryptedData')); assert.equal(view.headers['cache-control'], 'no-store');
  assert.equal((await f.app.inject(`/api/v1/crm/capture/proposals/${proposal.id}`)).statusCode, 401);
  assert.equal((await f.request('POST', `/api/v1/crm/capture/proposals/${proposal.id}/apply`, { contactRevision: null })).statusCode, 428);
  f.store.db.prepare('DELETE FROM sessions WHERE hash=?').run(f.sessionHash);
  assert.equal((await f.request('POST', `/api/v1/crm/capture/grants/${grant.id}/revoke`, {}, { 'if-match': `"capture-grant:${grant.id}:1"` })).statusCode, 401);
  assert.equal(publicCaptureGrant(f.store, grant, f.now()).schedulerRunning, false);
});

test('disabled capture does not retain inbound text or require an encryption key', async t => {
  const f = await fixture(t); delete process.env.OAUTH_ENCRYPTION_KEY; delete process.env.OPENAI_API_KEY;
  const incoming = f.inbound(); assert.equal(incoming.event.recorded, false); assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM crm_source_events').get()!.n, 0); assert.equal(f.store.list(f.tenant, jobs).length, 0);
});

test('old provider event and voice session begun before activation never produce jobs', async t => {
  const f = await fixture(t, { type: 'phone' }); const old = f.now() - 10000; f.activate();
  assert.equal(f.inbound('Meu nome é Ana Silva.', { sessionStartedAt: old }).event.recorded, false);
  assert.equal(f.inbound('Meu nome é Ana Silva.', { sessionStartedAt: old - 1, occurredAt: old }).event.recorded, false);
  await f.worker.tick(); assert.equal(f.calls(), 0); assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM crm_source_events').get()!.n, 0);
});

test('active journal failure rolls back message and event; application failure rolls back contact and receipt', async t => {
  const f = await fixture(t); f.activate();
  const create = f.store.create.bind(f.store); let failJob = true;
  f.store.create = ((tenant, collection, data) => { if (failJob && collection === jobs) throw new Error('Injected enqueue failure'); return create(tenant, collection, data); }) as typeof f.store.create;
  assert.throws(() => f.inbound(), /Injected enqueue/); assert.equal(f.store.list(f.tenant, 'messages').length, 0); assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM crm_source_events').get()!.n, 0);
  failJob = false; f.inbound(); await f.worker.tick(); const p = f.store.list(f.tenant, proposals)[0];
  f.store.create = ((tenant, collection, data) => { if (collection === 'crm-audit' && data.action === 'capture_proposal_applied') throw new Error('Injected audit failure'); return create(tenant, collection, data); }) as typeof f.store.create;
  assert.throws(() => applyCaptureProposal(f.store, f.tenant, p.id, { kind: 'human', input: { actor: f.actor, sessionHash: f.sessionHash, proposalRevision: 1, contactRevision: null, key: 'rollback-review' } }, f.now()), /Injected audit/);
  assert.equal(f.store.list(f.tenant, 'contacts').length, 0); assert.equal(f.store.get(f.tenant, 'conversations', f.conversation.id)?.contactId, undefined); assert.equal(f.store.get(f.tenant, proposals, p.id)?.status, 'proposed');
});

test('configuration change, expiry and missing source after request starts prevent any application', async t => {
  for (const mutation of ['agent', 'expiry', 'purge'] as const) await t.test(mutation, async child => {
    const f = await fixture(child); f.activate({ mode: 'auto_create_fill_empty' }); const source = f.inbound();
    f.mock(body => { if (mutation === 'agent') f.store.update(f.tenant, 'agents', f.agent.id, { prompt: 'Changed prompt' }); else if (mutation === 'expiry') f.advance(91 * 86400000); else f.store.remove(f.tenant, 'messages', source.message.id); return Response.json(output(body)); });
    await f.worker.tick(); assert.equal(f.store.list(f.tenant, 'contacts').length, 0); assert.equal(f.store.list(f.tenant, proposals).length, 0); assert.equal(f.calls(), 1);
  });
});

test('API keys, viewer and foreign organization cannot manage or inspect capture evidence', async t => {
  const f = await fixture(t); f.activate(); f.inbound(); await f.worker.tick(); const proposal = f.store.list(f.tenant, proposals)[0];
  const key = createApiKey(f.store, f.actor, { name: 'fixture', scopes: ['contacts:read', 'contacts:write'] });
  assert.equal((await f.app.inject({ url: `/api/v1/crm/capture/proposals/${proposal.id}`, headers: { authorization: `Bearer ${key.secret}` } })).statusCode, 403);
  f.store.db.prepare("UPDATE memberships SET role='viewer' WHERE user_id=?").run(f.actor.userId); assert.equal((await f.request('GET', `/api/v1/crm/capture/proposals/${proposal.id}`)).statusCode, 403);
  const outsider = { userId: 'capture-other', tenantId: 'other-tenant', role: 'owner' as const }; seedMember(f.store, outsider); const hash = createHash('sha256').update('other-session').digest('hex'); f.store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(hash, outsider.userId, outsider.tenantId, Date.now() + 100000);
  assert.equal((await f.app.inject({ url: `/api/v1/crm/capture/proposals/${proposal.id}`, cookies: { kloel_session: 'other-session' } })).statusCode, 404);
  assert.throws(() => applyCaptureProposal(f.store, f.tenant, proposal.id, { kind: 'human', input: { actor: outsider, sessionHash: hash, key: 'foreign-review', proposalRevision: 1, contactRevision: null } }), code('capture_tenant_mismatch'));
});

test('HTTP grant creation and review use actual ETags and return idempotent receipts', async t => {
  const f = await fixture(t), settings = getSettings(f.store, f.tenant);
  const policy = { mode: 'review', optIn: true, captureContacts: true, channelIds: [f.channel.id], reservedTokensPerDay: 1000000 };
  const headers = { 'if-match': `"crm-settings:${f.tenant}:${settings.revision}"`, 'idempotency-key': 'http-capture-grant' };
  const granted = await f.request('POST', '/api/v1/crm/capture/grants', { expectedTenantId: f.tenant, policy, previousGrantId: null, previousRevision: null }, headers); assert.equal(granted.statusCode, 201, granted.body);
  assert.equal((await f.request('POST', '/api/v1/crm/capture/grants', { expectedTenantId: f.tenant, policy, previousGrantId: null, previousRevision: null }, headers)).json().replayed, true);
  f.inbound(); await f.worker.tick(); const p = f.store.list(f.tenant, proposals)[0], etag = `"capture-proposal:${p.id}:1"`;
  const applied = await f.request('POST', `/api/v1/crm/capture/proposals/${p.id}/apply`, { expectedTenantId: f.tenant, contactRevision: null, overrides: { firstName: 'Anna' } }, { 'if-match': etag, 'idempotency-key': 'http-review-apply' }); assert.equal(applied.statusCode, 200, applied.body);
  assert.equal(f.store.list(f.tenant, 'contacts')[0].firstName, 'Anna'); assert.equal((f.store.list(f.tenant, 'contacts')[0].captureProvenance as any).firstName.humanOverride, true);
});

test('scheduler starts only explicitly, coalesces ticks and stops cleanly; proposal expiry purges evidence', async t => {
  const f = await fixture(t); const grant = f.activate(); f.inbound(); let release!: () => void;
  f.mock(async body => { await new Promise<void>(resolve => { release = resolve; }); return Response.json(output(body)); });
  const first = f.worker.tick(); await new Promise(resolve => setImmediate(resolve)); assert.equal((await f.worker.tick()).skipped, true); release(); await first;
  assert.equal(publicCaptureGrant(f.store, grant, f.now()).schedulerRunning, false); f.worker.start(60000); assert.equal(publicCaptureGrant(f.store, grant, f.now()).schedulerRunning, true); await f.worker.stop(); assert.equal(publicCaptureGrant(f.store, grant, f.now()).schedulerRunning, false);
  f.advance(31 * 86400000); await f.worker.tick(); assert.equal(f.store.list(f.tenant, proposals)[0].encryptedData, null); assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM crm_source_events').get()!.n, 0);
});

test('explicit preview forces review even when its queued ingress job belongs to an automatic grant', async t => {
  const f = await fixture(t); const grant = f.activate({ mode: 'auto_create_fill_empty' }), incoming = f.inbound();
  const result = await f.request('POST', '/api/v1/crm/capture/preview', { grantId: grant.id, sourceEventId: incoming.event.eventId });
  assert.equal(result.statusCode, 200, result.body); assert.equal(result.json().status, 'proposed'); assert.equal(f.store.list(f.tenant, 'contacts').length, 0); assert.equal(f.calls(), 1);
  await f.worker.tick(); assert.equal(f.store.list(f.tenant, 'contacts').length, 0);
});

test('unattempted recovered lease releases reservation before reclaiming daily quota', async t => {
  const f = await fixture(t); f.activate({ jobsPerDay: 1 }); const source = f.inbound();
  f.store.update(f.tenant, jobs, source.job!.id, { status: 'running', leaseUntil: f.now() - 1, quotaDay: new Date(f.now()).toISOString().slice(0, 10), reservedTokens: 10000 });
  await f.worker.tick(); assert.equal(f.calls(), 1); assert.equal(f.store.list(f.tenant, jobs)[0].status, 'proposed');
});

test('removed or altered source hides retained proposal evidence without erasing its receipt', async t => {
  for (const mutation of ['message', 'journal', 'conversation', 'changed'] as const) await t.test(mutation, async child => {
    const f = await fixture(child); f.activate({ mode: 'auto_create_fill_empty' }); const incoming = f.inbound(); await f.worker.tick();
    const row = f.store.list(f.tenant, proposals)[0]; assert.equal(publicProposal(f.store, f.tenant, row.id).evidenceAvailable, true);
    if (mutation === 'message') f.store.remove(f.tenant, 'messages', incoming.message.id);
    else if (mutation === 'journal') f.store.db.prepare('DELETE FROM crm_source_events WHERE id=?').run(incoming.event.eventId!);
    else if (mutation === 'conversation') f.store.remove(f.tenant, 'conversations', f.conversation.id);
    else f.store.update(f.tenant, 'messages', incoming.message.id, { content: 'Removed personal information' });
    const view = publicProposal(f.store, f.tenant, row.id); assert.equal(view.status, 'applied'); assert.ok(view.result); assert.equal(view.evidenceAvailable, false); assert.deepEqual(view.diff, []); assert.deepEqual(view.identityClaims, []); assert.equal(view.gate, null);
  });
});

test('manual changes supersede capture provenance only for the value changed', async t => {
  const f = await fixture(t); f.activate({ mode: 'auto_create_fill_empty' }); f.inbound(); await f.worker.tick();
  const initial = getContact(f.store, f.tenant, f.store.list(f.tenant, 'contacts')[0].id);
  const saved = updateContact(f.store, f.tenant, initial.id, { firstName: 'Anna' }, initial.revision, f.actor.userId, 'manual');
  const provenance = saved.captureProvenance as any;
  assert.equal(provenance.firstName.origin, 'automation'); assert.equal(provenance.firstName.supersededBy, f.actor.userId); assert.equal(provenance.firstName.supersededSource, 'manual'); assert.ok(provenance.firstName.supersededAt); assert.equal(provenance.lastName.supersededAt, undefined);
});

test('aiFill-only grant updates a linked contact without requiring or creating a new identity', async t => {
  const f = await fixture(t, { definitions: [{ key: 'note', label: 'Note', type: 'text', aiFill: true }] }); const field = getSettings(f.store, f.tenant).definitions[0];
  const contact = createContact(f.store, f.tenant, { displayName: 'Existing', nameMode: 'custom', phones: [{ value: '+5511999990000' }] }, f.actor.userId);
  f.store.update(f.tenant, 'conversations', f.conversation.id, { contactId: contact.id }); f.activate({ mode: 'auto_create_fill_empty', captureContacts: false, allowedFieldIds: [field.id] });
  f.mock(body => Response.json(output(body, value => { value.gate = { satisfied: false, evidence: [] }; value.values = [{ ...value.values[0], fieldId: field.id }]; })));
  f.inbound(); await f.worker.tick(); const saved = getContact(f.store, f.tenant, contact.id); assert.equal(saved.name, 'Existing'); assert.equal(saved.fieldValues[field.id], 'Ana'); assert.equal(f.store.list(f.tenant, 'contacts').length, 1); assert.equal(f.store.list(f.tenant, proposals)[0].status, 'applied');
});

test('unique exact evidence survives incorrect model offsets with UTF-16 positions derived from the original text', async t => {
  const f = await fixture(t); f.activate(); const original = '😀 Meu nome é Ana Silva. Café.';
  f.inbound(original);
  f.mock(body => Response.json(output(body, value => {
    for (const span of [...value.gate.evidence, ...value.values.flatMap((item: any) => item.evidence)]) { span.start = 1; span.end = 2; }
  })));
  await f.worker.tick();
  const row = f.store.list(f.tenant, proposals)[0]; assert.ok(row);
  const data = proposalData(row);
  for (const span of [...data.extraction.gate.evidence, ...data.extraction.values.flatMap(item => item.evidence)]) {
    assert.equal(span.start, original.indexOf(span.quote)); assert.equal(original.slice(span.start, span.end), span.quote);
  }
  assert.equal(data.extraction.values.find(item => item.fieldId === 'firstName')!.evidence[0].start, original.indexOf('Ana'));
  assert.equal(f.store.list(f.tenant, 'contacts').length, 0); assert.equal(f.calls(), 1);
});

test('offset repair never accepts an absent, paraphrased, cross-source or ambiguous quote', async t => {
  for (const variant of ['absent', 'paraphrased', 'source', 'ambiguous'] as const) await t.test(variant, async child => {
    const f = await fixture(child); f.activate({ mode: 'auto_create_fill_empty' });
    f.inbound(variant === 'ambiguous' ? 'Ana Silva. Meu nome é Ana Silva.' : 'Meu nome é Ana Silva.');
    f.mock(body => Response.json(output(body, value => {
      const span = value.values[0].evidence[0]; span.start = 1; span.end = 2;
      if (variant === 'absent') span.quote = 'invented';
      if (variant === 'paraphrased') span.quote = 'ana';
      if (variant === 'source') span.sourceEventId = randomUUID();
    })));
    await f.worker.tick();
    assert.equal(f.store.list(f.tenant, jobs)[0].reason, 'capture_invalid_evidence');
    assert.equal(f.store.list(f.tenant, proposals).length, 0); assert.equal(f.store.list(f.tenant, 'contacts').length, 0); assert.equal(f.calls(), 1);
  });
});

for (const boundary of [1, 2]) test(`HTTP capture grant rejects owner ABA at SAVEPOINT ${boundary} without grant or receipt`, async t => {
  const f = await fixture(t), guard = guardedBoundary(f.store, f.sessionHash, f.actor.userId), before = guard.snapshot();
  const policy = { mode: 'review', optIn: true, captureContacts: true, channelIds: [f.channel.id] };
  const disarm = guard.arm('SAVEPOINT', boundary);
  const response = await f.request('POST', '/api/v1/crm/capture/grants', { expectedTenantId: f.tenant, policy, previousGrantId: null, previousRevision: null }, { ...guard.headers, 'if-match': `"crm-settings:${f.tenant}:${f.settings.revision}"`, 'idempotency-key': 'context-capture-grant' });
  disarm(); guard.rejected(response); assert.deepEqual(guard.snapshot(), before); assert.equal(f.calls(), 0);
});
for (const action of ['pause', 'revoke'] as const) test(`HTTP capture ${action} rejects owner ABA inside SAVEPOINT and preserves grant revision`, async t => {
  const f = await fixture(t), grant = f.activate(), guard = guardedBoundary(f.store, f.sessionHash, f.actor.userId), before = guard.snapshot(), disarm = guard.arm('SAVEPOINT');
  const response = await f.request('POST', `/api/v1/crm/capture/grants/${grant.id}/${action}`, { expectedTenantId: f.tenant }, { ...guard.headers, 'if-match': `"capture-grant:${grant.id}:${grant.revision}"`, 'idempotency-key': 'context-capture-stop' });
  disarm(); guard.rejected(response); assert.deepEqual(guard.snapshot(), before);
});
for (const [action, boundary] of [['apply', 1], ['apply', 2], ['dismiss', 1]] as const) test(`HTTP capture ${action} rejects owner ABA at SAVEPOINT ${boundary} and preserves evidence and contacts`, async t => {
  const f = await fixture(t); f.activate(); f.inbound(); await f.worker.tick();
  const proposal = f.store.list(f.tenant, proposals)[0], guard = guardedBoundary(f.store, f.sessionHash, f.actor.userId), before = guard.snapshot(), disarm = guard.arm('SAVEPOINT', boundary);
  const response = await f.request('POST', `/api/v1/crm/capture/proposals/${proposal.id}/${action}`, action === 'apply' ? { expectedTenantId: f.tenant, contactRevision: null } : { expectedTenantId: f.tenant }, { ...guard.headers, 'if-match': `"capture-proposal:${proposal.id}:1"`, 'idempotency-key': 'context-capture-apply' });
  disarm(); guard.rejected(response); assert.deepEqual(guard.snapshot(), before); assert.equal(f.calls(), 1);
});
test('HTTP capture preview rejects owner ABA before changing the queued job or invoking AI', async t => {
  const f = await fixture(t), grant = f.activate({ mode: 'auto_create_fill_empty' }), incoming = f.inbound();
  const guard = guardedBoundary(f.store, f.sessionHash, f.actor.userId), before = guard.snapshot(), disarm = guard.arm('SAVEPOINT');
  const response = await f.request('POST', '/api/v1/crm/capture/preview', { grantId: grant.id, sourceEventId: incoming.event.eventId }, guard.headers);
  disarm(); guard.rejected(response); assert.deepEqual(guard.snapshot(), before); assert.equal(f.calls(), 0);
});
