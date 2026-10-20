import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { Store } from '../src/store.js';
import { buildApp } from '../src/app.js';
import { seedMember } from './fixtures/membership.js';
import { getSettings, saveSettings, transaction } from '../src/crm/service.js';
import { activateCapture, resolveCapture } from '../src/crm/capture/authority.js';
import { recordCaptureIngress } from '../src/crm/capture/source-events.js';
import { CRMCaptureWorker } from '../src/crm/capture/worker.js';
import { applyCaptureProposal } from '../src/crm/capture/proposals.js';
import { captureOperations } from '../src/crm/capture/operations.js';
import { grants, jobs, proposals } from '../src/crm/capture/schema.js';

const base = '/api/v1/crm/capture', sha = (s: string) => createHash('sha256').update(s).digest('hex');
const snapshot = (store: Store) => store.db.prepare('SELECT * FROM entities ORDER BY rowid').all();
const sourceText = 'Meu nome é Ana Silva. Meu telefone é +5511888877777 e meu email é ana@example.test.';
async function fixture(t: any, type: 'webchat' | 'whatsapp' = 'webchat') {
  const previous = { ...process.env }, oldFetch = globalThis.fetch, tenant = 'capture-http-tenant';
  Object.assign(process.env, { PROVIDER_TENANT_ID: tenant, OPENAI_API_KEY: 'fixture-only', OAUTH_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') });
  globalThis.fetch = (async () => { throw new Error('External transport forbidden'); }) as typeof fetch;
  const store = new Store(':memory:'), actor = { tenantId: tenant, userId: 'capture-http-owner', role: 'owner' as const };
  const identities = { owner: actor, other: { ...actor, userId: 'capture-other' }, member: { ...actor, userId: 'capture-member', role: 'member' as const }, foreign: { ...actor, userId: 'capture-foreign', tenantId: 'other-capture-tenant' } };
  const cookies: Record<string, string> = {};
  for (const [name, member] of Object.entries(identities)) {
    seedMember(store, member); cookies[name] = 'fixture-cookie-' + name;
    store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(sha(cookies[name]), member.userId, member.tenantId, Date.now() + 86400000);
  }
  const app = await buildApp(store, { workers: false });
  const agent = store.create(tenant, 'agents', { name: 'Synthetic capture', status: 'active' });
  const channel = store.create(tenant, 'channels', { name: 'Synthetic channel', type, provider: type === 'webchat' ? 'openai' : 'meta', enabled: true, agentId: agent.id, configuration: { allowedOrigins: ['https://synthetic.example'] } });
  const settings = saveSettings(store, tenant, { autoCapture: true, creationGate: '', definitions: [] }, 0, actor.userId);
  let now = Date.now(), calls = 0, intercept: undefined | ((body: any) => Promise<void>);
  const worker = new CRMCaptureWorker(store, { now: () => now, fetch: (async (_url, init) => {
    calls++; const body = JSON.parse(String(init?.body)); if (intercept) await intercept(body);
    const source = JSON.parse(body.input).sources.at(-1), span = (value: string) => ({ sourceEventId: source.id, start: source.text.indexOf(value), end: source.text.indexOf(value) + value.length, quote: value });
    const output = { candidate: 'person', subject: 'current_participant', gate: { satisfied: true, evidence: [span('Ana Silva')] }, values: [{ fieldId: 'firstName', value: 'Ana', evidence: [span('Ana')] }, { fieldId: 'lastName', value: 'Silva', evidence: [span('Silva')] }], identityClaims: [{ kind: 'phone', value: '+5511888877777', evidence: [span('+5511888877777')] }, { kind: 'email', value: 'ana@example.test', evidence: [span('ana@example.test')] }] };
    return Response.json({ id: 'synthetic-response', status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(output) }] }], usage: { input_tokens: 1, output_tokens: 1 } });
  }) as typeof fetch });
  t.after(async () => { await worker.stop(); await app.close(); globalThis.fetch = oldFetch; for (const k of ['PROVIDER_TENANT_ID', 'OPENAI_API_KEY', 'OAUTH_ENCRYPTION_KEY']) { if (previous[k] === undefined) delete process.env[k]; else process.env[k] = previous[k]; } });
  const contextHeaders = async (name = 'owner') => {
    const me = await app.inject({ url: '/api/v1/auth/me', cookies: { kloel_session: cookies[name] } }); assert.equal(me.statusCode, 200, me.body);
    const c = me.json().context; return { 'x-kloel-expected-user': c.userId, 'x-kloel-expected-tenant': c.tenantId, 'x-kloel-expected-membership': c.membershipId, 'x-kloel-expected-authority': c.authorityVersion };
  };
  const contexts: Record<string, Record<string, string>> = {}; for (const name of Object.keys(identities)) contexts[name] = await contextHeaders(name);
  const request = (method: any, path: string, body?: unknown, headers: Record<string, string> = {}, name = 'owner') => app.inject({ method, url: base + path, cookies: { kloel_session: cookies[name] }, headers: { ...contexts[name], ...headers }, ...(body === undefined ? {} : { payload: body }) });
  const policy = { mode: 'review', optIn: true, captureContacts: true, channelIds: [channel.id], reservedTokensPerDay: 1000000 };
  const grantInput = (prior: any = null) => ({ expectedTenantId: tenant, policy, previousGrantId: prior?.id ?? null, previousRevision: prior?.revision ?? null });
  const grantHeaders = (key = randomUUID()) => ({ 'if-match': `"crm-settings:${tenant}:${settings.revision}"`, 'idempotency-key': key });
  const createGrant = async (prior: any = null, key = randomUUID()) => {
    const response = await request('POST', '/grants', grantInput(prior), grantHeaders(key)); assert.equal(response.statusCode, 201, response.body);
    const grant = store.get(tenant, grants, response.json().operation.targetId)!; return { grant, response, key };
  };
  const inbound = () => {
    now = Math.max(now + 1000, Date.now() + 1000);
    return transaction(store, () => {
      const conversation = store.create(tenant, 'conversations', { channel: type, channelId: channel.id, agentId: agent.id, status: 'open', ...(type === 'whatsapp' ? { externalContact: '+5511999990000' } : {}) });
      const message = store.create(tenant, 'messages', { conversationId: conversation.id, role: 'user', content: sourceText });
      const event = recordCaptureIngress(store, { tenantId: tenant, conversationId: conversation.id, messageId: message.id, channelId: channel.id, agentId: agent.id, kind: type === 'webchat' ? 'public_chat_visitor_message' : 'meta_verified_inbound', receiptId: randomUUID(), occurredAt: now, ...(type === 'whatsapp' ? { transportIdentifier: '+5511999990000' } : {}) }, () => {}, now);
      const job = store.list(tenant, jobs).find(j => j.sourceEventId === event.eventId); return { event, job, conversation };
    });
  };
  const makeProposal = async () => {
    const incoming = inbound(); assert.ok(incoming.job); await worker.generate(tenant, incoming.job.id);
    const row = store.list(tenant, proposals).find(p => p.jobId === incoming.job!.id)!; assert.ok(row); return row;
  };
  const actionHeaders = (kind: 'grant' | 'proposal', row: any, key = randomUUID()) => ({ 'if-match': `"capture-${kind}:${row.id}:${row.revision}"`, 'idempotency-key': key });
  return { app, store, actor, tenant, cookies, contexts, contextHeaders, agent, channel, settings, worker, request, policy, grantInput, grantHeaders, createGrant, makeProposal, inbound, actionHeaders, calls: () => calls, setIntercept: (fn: typeof intercept) => { intercept = fn; } };
}

test('grant CAS binds ID and revision: stale G1 cannot replace G2 with the same revision', async t => {
  const f = await fixture(t), first = await f.createGrant(), second = await f.createGrant(first.grant), before = snapshot(f.store);
  assert.equal(first.grant.revision, second.grant.revision);
  const stale = await f.request('POST', '/grants', f.grantInput(first.grant), f.grantHeaders());
  assert.equal(stale.statusCode, 409, stale.body); assert.equal(stale.json().error.code, 'capture_grant_revision_conflict'); assert.deepEqual(snapshot(f.store), before);
  assert.equal(f.store.get(f.tenant, grants, second.grant.id)?.status, 'active');
  for (const body of [{ ...f.grantInput(), previousGrantId: undefined }, { ...f.grantInput(), previousGrantId: second.grant.id }, { ...f.grantInput(), previousRevision: 1 }]) assert.equal((await f.request('POST', '/grants', body, f.grantHeaders())).statusCode, 400);
});

test('grant receipt survives lost response, replacement and revocation; canonical defaults replay before CAS', async t => {
  const f = await fixture(t), key = randomUUID(), input = f.grantInput(), headers = f.grantHeaders(key);
  const first = await f.request('POST', '/grants', input, headers); assert.equal(first.statusCode, 201, first.body);
  const operation = first.json().operation, grant = f.store.get(f.tenant, grants, operation.targetId)!;
  await f.createGrant(grant);
  const before = snapshot(f.store), recovery = await f.request('GET', '/operations/' + key); assert.equal(recovery.statusCode, 200); assert.deepEqual(recovery.json(), operation); assert.deepEqual(snapshot(f.store), before);
  const equivalent = { previousRevision: null, previousGrantId: null, policy: { ...input.policy, expiresInDays: 30, jobsPerDay: 20, allowedFieldIds: [], allowTransportMatch: false, maxMessagesPerJob: 10, maxInputChars: 12000 }, expectedTenantId: f.tenant };
  const replay = await f.request('POST', '/grants', equivalent, headers); assert.equal(replay.statusCode, 200, replay.body); assert.deepEqual(replay.json(), { operation, replayed: true }); assert.deepEqual(snapshot(f.store), before);
  for (const forbidden of ['policy', 'sessionHash', 'authorityVersion', 'membershipId', 'synthetic', 'encrypted']) assert.equal(recovery.body.includes(forbidden), false, forbidden);
  assert.equal(recovery.headers['cache-control'], 'no-store'); assert.equal(f.calls(), 0);
});

for (const action of ['pause', 'revoke'] as const) test(`${action} has historical recovery and never increments twice after response loss`, async t => {
  const f = await fixture(t), { grant } = await f.createGrant(), key = randomUUID(), headers = f.actionHeaders('grant', grant, key), body = { expectedTenantId: f.tenant };
  const first = await f.request('POST', `/grants/${grant.id}/${action}`, body, headers); assert.equal(first.statusCode, 200, first.body);
  const operation = first.json().operation; assert.equal(operation.result.status, action === 'pause' ? 'paused' : 'revoked');
  f.store.update(f.tenant, grants, grant.id, { status: 'expired', revision: 80 });
  const before = snapshot(f.store), read = await f.request('GET', '/operations/' + key); assert.deepEqual(read.json(), operation);
  const replay = await f.request('POST', `/grants/${grant.id}/${action}`, body, headers); assert.equal(replay.json().replayed, true); assert.deepEqual(replay.json().operation, operation); assert.deepEqual(snapshot(f.store), before);
});

for (const action of ['apply', 'dismiss'] as const) test(`${action} recovers without evidence or active grant and does not repeat contact/audit effects`, async t => {
  const f = await fixture(t); const { grant } = await f.createGrant(), proposal = await f.makeProposal(), key = randomUUID();
  const headers = f.actionHeaders('proposal', proposal, key), body = action === 'apply' ? { expectedTenantId: f.tenant, contactRevision: null, overrides: { lastName: 'Silva', firstName: 'Anna' }, selectedFieldIds: ['lastName', 'firstName'] } : { expectedTenantId: f.tenant };
  const first = await f.request('POST', `/proposals/${proposal.id}/${action}`, body, headers); assert.equal(first.statusCode, 200, first.body);
  const operation = first.json().operation; assert.equal(operation.kind, 'proposal.' + action);
  f.store.update(f.tenant, grants, grant.id, { status: 'revoked', revision: 2 }); f.store.update(f.tenant, proposals, proposal.id, { encryptedData: null, expiresAt: 1 }); f.store.db.exec('DELETE FROM crm_source_events');
  const before = snapshot(f.store), read = await f.request('GET', '/operations/' + key); assert.equal(read.statusCode, 200); assert.deepEqual(read.json(), operation);
  const equivalent = action === 'apply' ? { ...body, overrides: { firstName: 'Anna', lastName: 'Silva' }, selectedFieldIds: ['firstName', 'lastName'] } : body;
  const replay = await f.request('POST', `/proposals/${proposal.id}/${action}`, equivalent, headers); assert.equal(replay.statusCode, 200, replay.body); assert.deepEqual(replay.json(), { operation, replayed: true }); assert.deepEqual(snapshot(f.store), before);
  assert.equal(f.store.list(f.tenant, 'contacts').length, action === 'apply' ? 1 : 0);
});

test('operation namespace binds key across kinds, targets and request payloads; concurrent same-key creates one effect', async t => {
  const f = await fixture(t), key = randomUUID(), body = f.grantInput(), headers = f.grantHeaders(key);
  const results = await Promise.all([f.request('POST', '/grants', body, headers), f.request('POST', '/grants', body, headers)]); assert.deepEqual(results.map(r => r.statusCode).sort(), [200, 201]);
  const grant = f.store.list(f.tenant, grants)[0], before = snapshot(f.store);
  const wrongKind = await f.request('POST', `/grants/${grant.id}/pause`, { expectedTenantId: f.tenant }, f.actionHeaders('grant', grant, key)); assert.equal(wrongKind.json().error.code, 'idempotency_conflict');
  const changed = await f.request('POST', '/grants', { ...body, policy: { ...body.policy, jobsPerDay: 5 } }, headers); assert.equal(changed.json().error.code, 'idempotency_conflict');
  assert.deepEqual(snapshot(f.store), before);
});

test('receipt binds tenant, operator, original session and membership authority; stale and fresh ABA requests cannot adopt it', async t => {
  const f = await fixture(t), { key, grant } = await f.createGrant(), before = snapshot(f.store);
  for (const name of ['other', 'member', 'foreign']) assert.equal((await f.request('GET', '/operations/' + key, undefined, {}, name)).statusCode, 404);
  const oldCookie = f.cookies.owner; f.cookies.owner = 'replacement-session'; f.store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(sha(f.cookies.owner), f.actor.userId, f.tenant, Date.now() + 3600000);
  assert.equal((await f.request('GET', '/operations/' + key)).statusCode, 409);
  f.contexts.owner = await f.contextHeaders(); assert.equal((await f.request('GET', '/operations/' + key)).statusCode, 404);
  f.cookies.owner = oldCookie; f.contexts.owner = await f.contextHeaders();
  f.store.db.prepare("UPDATE memberships SET role='admin' WHERE tenant_id=? AND user_id=?").run(f.tenant, f.actor.userId);
  f.store.db.prepare("UPDATE memberships SET role='owner' WHERE tenant_id=? AND user_id=?").run(f.tenant, f.actor.userId);
  assert.equal((await f.request('GET', '/operations/' + key)).statusCode, 409); f.contexts.owner = await f.contextHeaders(); assert.equal((await f.request('GET', '/operations/' + key)).statusCode, 404);
  const replay = await f.request('POST', '/grants', f.grantInput(), f.grantHeaders(key)); assert.equal(replay.json().error.code, 'idempotency_conflict');
  assert.equal(resolveCapture(f.store, f.tenant, grant.id).grant.id, grant.id); assert.deepEqual(snapshot(f.store), before);
});

test('missing preconditions, wrong tenant and cross-tab cookie cause no effects', async t => {
  const f = await fixture(t), before = snapshot(f.store);
  const wrongTenant = await f.request('POST', '/grants', { ...f.grantInput(), expectedTenantId: 'different' }, f.grantHeaders()); assert.equal(wrongTenant.json().error.code, 'tenant_mismatch');
  const wrongCookie = await f.app.inject({ method: 'POST', url: base + '/grants', cookies: { kloel_session: f.cookies.foreign }, headers: { ...f.contexts.owner, ...f.grantHeaders() }, payload: f.grantInput() }); assert.equal(wrongCookie.statusCode, 409);
  const absent = await f.request('POST', '/grants', f.grantInput(), { 'idempotency-key': randomUUID() }); assert.equal(absent.statusCode, 428);
  const manager = await f.request('POST', '/grants', f.grantInput(), f.grantHeaders(), 'member'); assert.equal(manager.statusCode, 403);
  assert.deepEqual(snapshot(f.store), before);
});

test('new journal refuses legacy grant receipt collisions instead of minting current authority', async t => {
  const f = await fixture(t), key = randomUUID();
  const old = activateCapture(f.store, f.actor, sha(f.cookies.owner), f.policy, f.settings.revision, null, null);
  f.store.create(f.tenant, 'crm-receipts', { key, fingerprint: 'legacy-hash', result: old });
  f.cookies.owner = 'fresh-session'; f.store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(sha(f.cookies.owner), f.actor.userId, f.tenant, Date.now() + 3600000); f.contexts.owner = await f.contextHeaders();
  const before = snapshot(f.store), response = await f.request('POST', '/grants', f.grantInput(), f.grantHeaders(key));
  assert.equal(response.statusCode, 409); assert.equal(response.json().error.code, 'legacy_operation_unrecoverable'); assert.equal((await f.request('GET', '/operations/' + key)).statusCode, 404); assert.deepEqual(snapshot(f.store), before);
});

test('already-applied legacy proposal cannot acquire a new-session receipt even with its exact original key/body', async t => {
  const f = await fixture(t); await f.createGrant(); const proposal = await f.makeProposal(), key = randomUUID();
  applyCaptureProposal(f.store, f.tenant, proposal.id, { kind: 'human', input: { actor: f.actor, sessionHash: sha(f.cookies.owner), key, proposalRevision: 1, contactRevision: null, overrides: {} } });
  f.cookies.owner = 'fresh-legacy-session'; f.store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(sha(f.cookies.owner), f.actor.userId, f.tenant, Date.now() + 3600000); f.contexts.owner = await f.contextHeaders();
  const before = snapshot(f.store), response = await f.request('POST', `/proposals/${proposal.id}/apply`, { expectedTenantId: f.tenant, contactRevision: null }, f.actionHeaders('proposal', proposal, key));
  assert.equal(response.json().error.code, 'legacy_operation_unrecoverable'); assert.equal((await f.request('GET', '/operations/' + key)).statusCode, 404); assert.deepEqual(snapshot(f.store), before);
});

for (const kind of ['grant.create', 'grant.pause', 'grant.revoke', 'proposal.apply', 'proposal.dismiss'] as const) test(`${kind} rolls back effect, audit and receipt when final session guard fails`, async t => {
  const f = await fixture(t); let path = '/grants', body: any = f.grantInput(), headers = f.grantHeaders();
  if (kind !== 'grant.create') {
    const { grant } = await f.createGrant();
    if (kind.startsWith('grant.')) { path = `/grants/${grant.id}/${kind.split('.')[1]}`; body = { expectedTenantId: f.tenant }; headers = f.actionHeaders('grant', grant); }
    else { const proposal = await f.makeProposal(); path = `/proposals/${proposal.id}/${kind.split('.')[1]}`; body = { expectedTenantId: f.tenant, ...(kind === 'proposal.apply' ? { contactRevision: null } : {}) }; headers = f.actionHeaders('proposal', proposal); }
  }
  const before = snapshot(f.store), original = f.store.create.bind(f.store);
  f.store.create = (tenant, collection, data) => { const result = original(tenant, collection, data); if (collection === captureOperations) f.store.db.prepare('DELETE FROM sessions WHERE hash=?').run(sha(f.cookies.owner)); return result; };
  const response = await f.request('POST', path, body, headers); f.store.create = original;
  assert.equal(response.statusCode, 409, response.body); assert.equal(response.json().error.code, 'context_changed_in_flight'); assert.deepEqual(snapshot(f.store), before);
  assert.ok(f.store.db.prepare('SELECT hash FROM sessions WHERE hash=?').get(sha(f.cookies.owner)));
});

test('receipt insertion failure cannot leave unreceipted contact application', async t => {
  const f = await fixture(t); await f.createGrant(); const proposal = await f.makeProposal(), before = snapshot(f.store), original = f.store.create.bind(f.store);
  f.store.create = (tenant, collection, data) => { if (collection === captureOperations) throw new Error('Synthetic storage failure'); return original(tenant, collection, data); };
  const response = await f.request('POST', `/proposals/${proposal.id}/apply`, { expectedTenantId: f.tenant, contactRevision: null }, f.actionHeaders('proposal', proposal)); f.store.create = original;
  assert.equal(response.statusCode, 500); assert.deepEqual(snapshot(f.store), before);
});

for (const type of ['webchat', 'whatsapp'] as const) test(`review creationIdentifiers exactly matches ${type} application and never implies consent`, async t => {
  const f = await fixture(t, type); await f.createGrant(); const proposal = await f.makeProposal();
  const read = (await f.request('GET', '/proposals/' + proposal.id)).json();
  assert.deepEqual(read.creationIdentifiers, [{ kind: 'phone', value: type === 'whatsapp' ? '+5511999990000' : '+5511888877777', source: type === 'whatsapp' ? 'transport' : 'claim' }, { kind: 'email', value: 'ana@example.test', source: 'claim' }]);
  const applied = await f.request('POST', `/proposals/${proposal.id}/apply`, { expectedTenantId: f.tenant, contactRevision: null }, f.actionHeaders('proposal', proposal)); assert.equal(applied.statusCode, 200, applied.body);
  const contact = f.store.get(f.tenant, 'contacts', applied.json().operation.result.contactId)!;
  assert.deepEqual((contact.phones as any[]).map(p => p.normalized), read.creationIdentifiers.filter((i: any) => i.kind === 'phone').map((i: any) => i.value));
  assert.deepEqual((contact.emails as any[]).map(p => p.normalized), read.creationIdentifiers.filter((i: any) => i.kind === 'email').map((i: any) => i.value));
  assert.equal(f.store.list(f.tenant, 'contact-permission-events').length, 0);
  f.store.update(f.tenant, proposals, proposal.id, { encryptedData: null }); assert.deepEqual((await f.request('GET', '/proposals/' + proposal.id)).json().creationIdentifiers, []);
});

test('grant worker survives issuer logout but queued old grant cannot run after replacement', async t => {
  const f = await fixture(t), { grant: first } = await f.createGrant(), old = f.inbound(); assert.ok(old.job);
  const { grant: second } = await f.createGrant(first);
  await assert.rejects(() => f.worker.generate(f.tenant, old.job!.id)); assert.equal(f.calls(), 0);
  const fresh = f.inbound(); assert.ok(fresh.job); assert.equal(fresh.job.grantId, second.id);
  f.store.db.prepare('DELETE FROM sessions WHERE hash=?').run(sha(f.cookies.owner));
  const result = await f.worker.generate(f.tenant, fresh.job.id); assert.equal(result.status, 'proposed'); assert.equal(f.calls(), 1); assert.equal(f.store.list(f.tenant, 'contacts').length, 0);
  assert.equal(resolveCapture(f.store, f.tenant, second.id).grant.id, second.id);
});

test('in-flight old generation and existing proposal cannot apply across grant replacement', async t => {
  const f = await fixture(t), { grant } = await f.createGrant(), proposal = await f.makeProposal(), incoming = f.inbound(); let release!: () => void;
  f.setIntercept(async () => new Promise<void>(resolve => { release = resolve; }));
  const generation = f.worker.generate(f.tenant, incoming.job!.id); await new Promise(resolve => setImmediate(resolve));
  await f.createGrant(grant); release(); await assert.rejects(() => generation);
  const response = await f.request('POST', `/proposals/${proposal.id}/apply`, { expectedTenantId: f.tenant, contactRevision: null }, f.actionHeaders('proposal', proposal));
  assert.equal(response.statusCode, 403); assert.equal(f.store.list(f.tenant, 'contacts').length, 0); assert.equal(f.store.list(f.tenant, proposals).length, 1);
});

test('malformed or contradictory stored receipt fails closed and never returns raw metadata', async t => {
  const f = await fixture(t), { key } = await f.createGrant(), receipt = f.store.list(f.tenant, captureOperations)[0];
  f.store.update(f.tenant, captureOperations, receipt.id, { result: { grantId: 'other-target', revision: 1, status: 'active', secret: 'must-not-leak' } });
  const before = snapshot(f.store), response = await f.request('GET', '/operations/' + key); assert.equal(response.statusCode, 409); assert.equal(response.body.includes('must-not-leak'), false); assert.deepEqual(snapshot(f.store), before);
});

test('removed and recreated membership cannot recover or adopt the original receipt', async t => {
  const f = await fixture(t), { key, grant } = await f.createGrant();
  const oldMembership = f.store.db.prepare('SELECT id FROM memberships WHERE tenant_id=? AND user_id=?').get(f.tenant, f.actor.userId)!.id;
  f.store.db.prepare('DELETE FROM memberships WHERE tenant_id=? AND user_id=?').run(f.tenant, f.actor.userId);
  seedMember(f.store, f.actor);
  assert.notEqual(f.store.db.prepare('SELECT id FROM memberships WHERE tenant_id=? AND user_id=?').get(f.tenant, f.actor.userId)!.id, oldMembership);
  assert.equal((await f.request('GET', '/operations/' + key)).statusCode, 409);
  f.contexts.owner = await f.contextHeaders(); const before = snapshot(f.store);
  assert.equal((await f.request('GET', '/operations/' + key)).statusCode, 404);
  const replay = await f.request('POST', '/grants', f.grantInput(), f.grantHeaders(key));
  assert.equal(replay.statusCode, 409); assert.equal(replay.json().error.code, 'idempotency_conflict');
  assert.equal(f.store.get(f.tenant, grants, grant.id)?.status, 'revoked'); assert.deepEqual(snapshot(f.store), before);
});

for (const code of ['capture_grant_inactive', 'capture_grant_changed'] as const) test(`apply ${code} is a local rejection after receipt lookup, with no effect or receipt`, async t => {
  const f = await fixture(t), { grant } = await f.createGrant(), proposal = await f.makeProposal(), key = randomUUID();
  f.store.update(f.tenant, grants, grant.id, code === 'capture_grant_inactive' ? { status: 'revoked', revision: 2 } : { revision: 2 });
  const before = snapshot(f.store), calls = f.calls(), body = { expectedTenantId: f.tenant, contactRevision: null }, headers = f.actionHeaders('proposal', proposal, key);
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await f.request('POST', `/proposals/${proposal.id}/apply`, body, headers);
    assert.equal(response.statusCode, 403); assert.equal(response.json().error.code, code); assert.deepEqual(snapshot(f.store), before);
  }
  assert.equal((await f.request('GET', '/operations/' + key)).statusCode, 404); assert.equal(f.calls(), calls); assert.equal(f.store.list(f.tenant, 'contacts').length, 0);
});
