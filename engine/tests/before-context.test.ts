import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { beforeContextFixture } from './fixtures/before-context.js';
import { defaultConfiguration, parseConfiguration } from '../src/before-context/schema.js';
import { resolveBefore } from '../src/before-context/resolve.js';

test('before virtual config is readonly; preview validates types and uses explicit synthetic examples only', async t => {
  const f = await beforeContextFixture(t), before = f.store.list(f.actor.tenantId, 'before-context-configurations');
  const get = await f.request('GET', f.beforeBase); assert.equal(get.statusCode, 200, get.body); assert.equal(get.json().revision, 0); assert.deepEqual(f.store.list(f.actor.tenantId, 'before-context-configurations'), before);
  const p = await f.request('POST', f.beforeBase + '/preview', { configuration: f.sample, testFacts: { startedAt: '2026-10-19T12:00:00.000Z' } });
  assert.equal(p.statusCode, 200, p.body); assert.equal(p.json().greeting, 'Olá Exemplo sintético: 7 / true.'); assert.equal(p.json().facts.localTime, '09:00'); assert.equal(p.json().externalSources, false); assert.equal(f.openAI.length, 0);
});
test('private live opening stores one greeting and supplies typed untrusted data outside model instructions', async t => {
  const f = await beforeContextFixture(t); await f.enable(); const key = randomUUID(), r = await f.open('live', key); assert.equal(r.statusCode, 200, r.body); const op = r.json().operation;
  assert.equal(op.status, 'ready'); assert.equal(op.mode, 'live'); assert.equal((await f.opening(key)).json().openingId, op.openingId);
  const history = await f.openingHistory(key); assert.equal(history.statusCode, 200, history.body); assert.equal(history.json().items[0].content, 'Olá Visitante: 0 / false.');
  assert.equal((await f.open('live', key)).json().replayed, true); assert.equal((await f.openingHistory(key)).json().items.length, 1);
  const chat = await f.askPrivate(op.conversationId); assert.equal(chat.statusCode, 200, chat.body); assert.equal(f.openAI.length, 1);
  const first = f.openAI[0]; assert.match(first.input[0].content, /"quantidade":0/); assert.match(first.input[0].content, /"ativo":false/); assert.doesNotMatch(first.instructions, /Visitante|Exemplo sintético/);
  assert.equal((await f.openingHistory(key)).json().items.length, 3);
});
test('webchat bootstrap suppresses legacy greeting; bearer opening precedes chat and history stores one greeting', async t => {
  const f = await beforeContextFixture(t); await f.enable(); const s = await f.session(); assert.equal(s.greeting, ''); assert.deepEqual(s.beforeContext, { enabled: true, revision: 1 });
  const denied = await f.publicRequest(s.token, 'messages', { message: 'Olá', idempotencyKey: randomUUID() }); assert.equal(denied.statusCode, 409, denied.body); assert.equal(f.openAI.length, 0);
  const key = randomUUID(), opened = await f.publicOpen(s.token, key); assert.equal(opened.statusCode, 200, opened.body);
  const h = await f.publicRequest(s.token, 'history'); assert.equal(h.statusCode, 200, h.body); assert.equal(h.json().items.length, 1); assert.equal(h.json().items[0].content, 'Olá Visitante: 0 / false.');
  const answer = await f.publicRequest(s.token, 'messages', { message: 'Olá', idempotencyKey: randomUUID() }); assert.equal(answer.statusCode, 200, answer.body); assert.equal(f.openAI.length, 1);
});
test('typed false/zero/empty, first matching rule, overnight boundary and no recursive interpolation', () => {
  const c = parseConfiguration({ ...defaultConfiguration(), variables: [{ name: 'text', type: 'text', defaultValue: '{{system.phone}}' }, { name: 'zero', type: 'number', defaultValue: 0 }, { name: 'flag', type: 'boolean', defaultValue: false }], defaultGreeting: '{{vars.text}}', greetingRules: [
    { conditions: [{ field: 'vars.zero', operator: 'equals', value: 0 }, { field: 'vars.flag', operator: 'equals', value: false }, { field: 'system.localTime', operator: 'time_between', value: { start: '22:00', end: '06:00', overnight: true } }], greeting: 'primeira {{vars.text}}' },
    { conditions: [{ field: 'vars.zero', operator: 'equals', value: 0 }], greeting: 'segunda' },
  ] });
  const base = { mode: 'live' as const, agentName: 'A', companyName: 'C', surface: 'private' as const, startedAt: '2026-10-19T01:00:00.000Z' };
  assert.equal(resolveBefore(c, base).greeting, 'primeira {{system.phone}}'); assert.equal(resolveBefore(c, { ...base, startedAt: '2026-10-19T09:00:00.000Z' }).greeting, 'segunda');
  for (const raw of [{ ...c, timezone: 'Invalid/Machine' }, { ...c, greetingRules: [{ conditions: [{ field: 'vars.zero', operator: 'unknown' }], greeting: 'x' }] }, { ...c, testContext: { flag: 'false' } }, { ...c, defaultGreeting: '{{vars.missing}}' }, JSON.parse('{"enabled":false,"timezone":"UTC","variables":[],"defaultGreeting":"","greetingRules":[],"testContext":{"__proto__":"x"}}')]) assert.throws(() => parseConfiguration(raw));
});

test('configuration CAS increments on noop, original replay precedes current config and agent removal', async t => {
  const f = await beforeContextFixture(t), key = randomUUID(); const first = await f.save(f.sample, 0, key); assert.equal(first.statusCode, 200, first.body);
  assert.equal((await f.save(f.sample, 1)).json().operation.revision, 2);
  assert.equal((await f.save(f.sample, 1)).json().error.code, 'before_context_revision_conflict');
  f.store.remove(f.actor.tenantId, 'agents', f.agent.id);
  const replay = await f.save(f.sample, 0, key); assert.equal(replay.statusCode, 200, replay.body); assert.equal(replay.json().replayed, true); assert.equal(replay.json().operation.revision, 1);
  const receipt = await f.request('GET', '/api/v1/before-context/config-operations/' + key); assert.equal(receipt.statusCode, 200, receipt.body); assert.ok(!receipt.body.includes('Exemplo sintético'));
});
test('opening metadata/history are original and local after pause/config change, but continuation fails closed', async t => {
  const f = await beforeContextFixture(t); await f.enable(); const key = randomUUID(), opened = (await f.open('test', key)).json().operation;
  await f.save({ ...f.sample, enabled: false }, 1); f.store.update(f.actor.tenantId, 'agents', f.agent.id, { status: 'paused' });
  const old = await f.opening(key), history = await f.openingHistory(key); assert.equal(old.statusCode, 200, old.body); assert.equal(history.statusCode, 200, history.body); assert.equal(history.json().items[0].content, 'Olá Exemplo sintético: 7 / true.');
  assert.equal((await f.open('test', key)).json().replayed, true); assert.equal(f.openAI.length, 0);
  f.store.update(f.actor.tenantId, 'agents', f.agent.id, { status: 'active' }); const blocked = await f.askPrivate(opened.conversationId); assert.equal(blocked.statusCode, 409, blocked.body); assert.equal(f.openAI.length, 0);
});
for (const kind of ['config', 'agent', 'organization'] as const) test(`private ${kind} ABA during model await suppresses output without recomputing defaults`, async t => {
  const f = await beforeContextFixture(t); await f.enable(); const key = randomUUID(), opening = (await f.open('live', key)).json().operation;
  f.aiHooks.openAI = async () => {
    if (kind === 'config') { await f.save({ ...f.sample, defaultGreeting: 'changed' }, 1); await f.save(f.sample, 2); }
    else if (kind === 'agent') { const old = f.store.get(f.actor.tenantId, 'agents', f.agent.id)!; f.store.update(f.actor.tenantId, 'agents', f.agent.id, { status: 'paused' }); f.store.update(f.actor.tenantId, 'agents', f.agent.id, old); }
    else { f.store.db.prepare('UPDATE organizations SET status=? WHERE id=?').run('suspended', f.actor.tenantId); f.store.db.prepare('UPDATE organizations SET status=? WHERE id=?').run('active', f.actor.tenantId); }
    return Response.json({ id: 'private_response', output: [{ type: 'message', content: [{ type: 'output_text', text: 'MUST_NOT_PUBLISH' }] }] });
  };
  const result = await f.askPrivate(opening.conversationId); assert.equal(result.statusCode, 409, result.body); assert.ok(!result.body.includes('MUST_NOT_PUBLISH'));
  const all = f.store.list(f.actor.tenantId, 'messages').filter(m => m.conversationId === opening.conversationId); assert.equal(all.length, 1); assert.equal(all[0].content, 'Olá Visitante: 0 / false.');
  if (kind === 'organization') assert.equal((await f.openingHistory(key)).statusCode, 404);
});
test('membership ABA cannot adopt config or opening receipts/history', async t => {
  const f = await beforeContextFixture(t); const configured = await f.enable(), key = randomUUID(); await f.open('live', key);
  f.aba(); const fresh = await f.freshHeaders();
  for (const url of ['/api/v1/before-context/config-operations/' + configured.key, '/api/v1/ai/conversation-openings/' + key, '/api/v1/ai/conversation-openings/' + key + '/history']) {
    const result = await f.request('GET', url, undefined, fresh); assert.equal(result.statusCode, 404, result.body);
  }
  assert.equal(f.openAI.length, 0);
});
test('test mode/context is explicit; live rejects synthetic facts and cannot adopt another mode/key', async t => {
  const f = await beforeContextFixture(t); await f.enable(); const key = randomUUID(); const bad = await f.open('live', key, 1, { phone: '+5511999999999' }); assert.equal(bad.statusCode, 400, bad.body);
  assert.equal(f.store.list(f.actor.tenantId, 'before-context-openings').length, 0);
  const good = await f.open('test', key, 1, { phone: '+5511999999999', startedAt: '2026-10-19T12:00:00Z' }); assert.equal(good.statusCode, 200, good.body);
  assert.equal((await f.open('live', key)).statusCode, 409);
  assert.equal((await f.open('live')).statusCode, 200); assert.equal(f.store.list(f.actor.tenantId, 'before-context-openings').length, 2);
});
test('enabled config denies legacy private chat and all private voice admissions before provider I/O', async t => {
  const f = await beforeContextFixture(t); await f.enable(); let outbound = 0; const original = globalThis.fetch; globalThis.fetch = async () => { outbound++; throw Error('unexpected transport'); }; t.after(() => { globalThis.fetch = original; });
  const denied = await f.askPrivate(); assert.equal(denied.statusCode, 409, denied.body);
  for (const [path, payload] of [['token', { agentId: f.agent.id, preview: true }], ['session', { agentId: f.agent.id, preview: true, sdp: 'v=0\r\nsynthetic', idempotencyKey: randomUUID() }]] as const) {
    const r = await f.request('POST', '/api/v1/ai/realtime/' + path, payload); assert.equal(r.statusCode, 409, r.body); assert.equal(r.json().error.code, 'before_context_requires_managed_voice');
  }
  assert.equal(outbound, 0); assert.equal(f.store.list(f.actor.tenantId, 'voice-start-operations').length, 0);
});
test('public channel ABA during model await prevents publishing resolved data and generated reply', async t => {
  const f = await beforeContextFixture(t); await f.enable(); const session = await f.session(); await f.publicOpen(session.token);
  f.aiHooks.openAI = () => { const old = f.store.get(f.actor.tenantId, 'channels', f.channel.id)!; f.store.update(f.actor.tenantId, 'channels', f.channel.id, { enabled: false }); f.store.update(f.actor.tenantId, 'channels', f.channel.id, old); return Response.json({ id: 'private', output: [{ type: 'message', content: [{ type: 'output_text', text: 'MUST_NOT_PUBLISH' }] }] }); };
  const r = await f.publicRequest(session.token, 'messages', { message: 'hello', idempotencyKey: randomUUID() }); assert.ok(r.statusCode >= 400, r.body); assert.ok(!r.body.includes('MUST_NOT_PUBLISH'));
  assert.equal(f.store.list(f.actor.tenantId, 'messages').filter(m => m.content === 'MUST_NOT_PUBLISH').length, 0);
});
test('disabled agent configuration preserves legacy bootstrap and chat DTO; no empty before metadata', async t => {
  const f = await beforeContextFixture(t); const s = await f.session(); assert.equal('beforeContext' in s, false); assert.ok(s.greeting); const r = await f.askPrivate(); assert.equal(r.statusCode, 200, r.body); assert.equal('beforeContext' in r.json(), false);
});
test('configuration and preview reject invalid shape/oversize values; empty string stays present typed data', () => {
  const base = defaultConfiguration(); assert.throws(() => parseConfiguration({ ...base, variables: [{ name: 'a', type: 'number', defaultValue: false }] }));
  assert.throws(() => parseConfiguration({ ...base, greetingRules: [{ greeting: 'x', conditions: [{ field: 'system.localTime', operator: 'time_between', value: { start: '23:00', end: '01:00', overnight: false } }] }] }));
  const c = parseConfiguration({ ...base, variables: [{ name: 'text', type: 'text', defaultValue: '' }], defaultGreeting: '[{{vars.text}}]' });
  assert.equal(resolveBefore(c, { mode: 'live', agentName: '', companyName: '', surface: 'private', startedAt: '2026-10-19T12:00:00Z' }).greeting, '[]');
  const tooLarge = parseConfiguration({ ...base, variables: [{ name: 'text', type: 'text', defaultValue: 'x'.repeat(1000) }], defaultGreeting: '{{vars.text}}{{vars.text}}' });
  assert.throws(() => resolveBefore(tooLarge, { mode: 'live', agentName: '', companyName: '', surface: 'private', startedAt: '2026-10-19T12:00:00Z' }));
});
test('public human handoff still records visitor input for the team without before context or AI output', async t => {
  const f = await beforeContextFixture(t); await f.enable(); const s = await f.session(), op = (await f.publicOpen(s.token)).json().operation;
  f.store.update(f.actor.tenantId, 'conversations', op.conversationId, { status: 'pending', webchatHuman: true });
  const r = await f.publicRequest(s.token, 'messages', { message: 'Mensagem para a equipe', idempotencyKey: randomUUID() });
  assert.equal(r.statusCode, 200, r.body); assert.equal(r.json().status, 'human_pending'); assert.equal(f.openAI.length, 0); assert.equal(f.store.list(f.actor.tenantId, 'messages').filter(m => m.content === 'Mensagem para a equipe').length, 1);
});
for (const surface of ['private', 'webchat'] as const) test(`enabling before during legacy ${surface} model await blocks the late result`, async t => {
  const f = await beforeContextFixture(t); const s = surface === 'webchat' ? await f.session() : undefined;
  f.aiHooks.openAI = async () => { await f.enable(); return Response.json({ id: 'late_result', output: [{ type: 'message', content: [{ type: 'output_text', text: 'MUST_NOT_PUBLISH' }] }] }); };
  const r = surface === 'private' ? await f.askPrivate() : await f.publicRequest(s!.token, 'messages', { message: 'hi', idempotencyKey: randomUUID() });
  assert.equal(r.statusCode, 409, r.body); assert.ok(!r.body.includes('MUST_NOT_PUBLISH')); assert.equal(f.store.list(f.actor.tenantId, 'messages').filter(m => m.content === 'MUST_NOT_PUBLISH').length, 0);
});

test('public original opening remains GET-only recoverable with CORS after channel deletion and explicit session end', async t => {
  const f = await beforeContextFixture(t); await f.enable(); const s = await f.session(), op = (await f.publicOpen(s.token)).json().operation;
  await f.publicRequest(s.token, 'end', {}); f.store.remove(f.actor.tenantId, 'channels', f.channel.id);
  const preflight = await f.app.inject({ method: 'OPTIONS', url: f.publicPath('opening'), headers: { origin: f.origin, 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization' } });
  assert.equal(preflight.statusCode, 204, preflight.body); assert.equal(preflight.headers['access-control-allow-origin'], f.origin);
  const r = await f.publicRequest(s.token, 'opening'); assert.equal(r.statusCode, 200, r.body); assert.equal(r.json().openingId, op.openingId); assert.ok(!r.body.includes('Visitante')); assert.equal(f.openAI.length, 0);
  for (const headers of [{ origin: 'https://foreign.example.test', 'access-control-request-method': 'GET' }, { origin: f.origin, 'access-control-request-method': 'POST' }]) assert.equal((await f.app.inject({ method: 'OPTIONS', url: f.publicPath('opening'), headers })).statusCode, 403);
});
test('system fields cannot inherit prototype names and private APIs require all original context headers', async t => {
  for (const key of ['constructor', '__proto__', 'toString']) assert.throws(() => parseConfiguration({ ...defaultConfiguration(), defaultGreeting: '{{system.' + key + '}}' }));
  const f = await beforeContextFixture(t); await f.enable();
  for (const headers of [{}, Object.fromEntries(Object.entries(f.headers).filter(([k]) => k !== 'x-kloel-expected-membership'))]) {
    const r = await f.request('POST', '/api/v1/ai/conversations/open', { expectedTenantId: f.actor.tenantId, agentId: f.agent.id, expectedConfigRevision: 1, idempotencyKey: randomUUID(), mode: 'live' }, headers); assert.equal(r.statusCode, 400, r.body);
  }
  assert.equal(f.store.list(f.actor.tenantId, 'before-context-openings').length, 0);
});
test('new cookie session of the same owner cannot adopt an original opening', async t => {
  const { createHash } = await import('node:crypto'); const f = await beforeContextFixture(t); await f.enable(); const key = randomUUID(); await f.open('live', key);
  const cookie = 'new-before-session'; f.store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(createHash('sha256').update(cookie).digest('hex'), f.actor.userId, f.actor.tenantId, Date.now() + 3600000);
  const { CONTEXT_HEADERS } = await import('../src/request-context.js');
  const me = await f.app.inject({ url: '/api/v1/auth/me', cookies: { kloel_session: cookie } }); assert.equal(me.statusCode, 200, me.body);
  const fresh = Object.fromEntries(Object.entries(CONTEXT_HEADERS).map(([name, header]) => [header, me.json().context[name] ?? '-']));
  const r = await f.app.inject({ url: '/api/v1/ai/conversation-openings/' + key, cookies: { kloel_session: cookie }, headers: fresh }); assert.equal(r.statusCode, 404, r.body);
});
for (const surface of ['token', 'session'] as const) test(`voice ${surface} enabled during provider wait never publishes credential/SDP; prior GET remains accessible`, async t => {
  const f = await beforeContextFixture(t), previousModel = process.env.OPENAI_REALTIME_MODEL; process.env.OPENAI_REALTIME_MODEL = 'synthetic-realtime';
  const original = globalThis.fetch, urls: string[] = []; t.after(() => { globalThis.fetch = original; if (previousModel === undefined) delete process.env.OPENAI_REALTIME_MODEL; else process.env.OPENAI_REALTIME_MODEL = previousModel; });
  globalThis.fetch = async input => { const url = String(input); urls.push(url); if (url.endsWith('/hangup')) return new Response(null, { status: 200 }); await f.enable(); return surface === 'token' ? Response.json({ value: 'ek_MUST_NOT_PUBLISH', expires_at: 9999999999 }) : new Response('v=0\r\nMUST_NOT_PUBLISH', { status: 201, headers: { location: '/v1/realtime/calls/rtc_before' } }); };
  const key = randomUUID(), r = await f.request('POST', '/api/v1/ai/realtime/' + surface, { agentId: f.agent.id, ...(surface === 'session' ? { sdp: 'v=0\r\nsynthetic-offer', idempotencyKey: key } : {}) });
  assert.ok(!r.body.includes('MUST_NOT_PUBLISH'), r.body);
  if (surface === 'token') assert.equal(r.statusCode, 409, r.body);
  else { assert.equal(r.statusCode, 200, r.body); assert.equal(r.json().status, 'unknown'); assert.equal(r.json().hangupStatus, 'accepted'); const get = await f.request('GET', '/api/v1/ai/realtime/operations/' + key); assert.equal(get.statusCode, 200, get.body); assert.equal(get.json().callId, 'rtc_before'); }
  assert.equal(urls.filter(url => !url.endsWith('/hangup')).length, 1); assert.equal(f.store.list(f.actor.tenantId, 'voice-sessions').length, 0);
});
for (const stage of ['during'] as const) test(`signed incoming voice ${stage} accept rejects changed context and preserves accepted call cleanup`, async t => {
  const { createHmac } = await import('node:crypto'); const f = await beforeContextFixture(t), old = Object.fromEntries(['OPENAI_REALTIME_MODEL', 'OPENAI_INBOUND_AGENT_ID', 'OPENAI_WEBHOOK_SECRET'].map(k => [k, process.env[k]]));
  const secret = Buffer.from('synthetic-before-hook').toString('base64'); Object.assign(process.env, { OPENAI_REALTIME_MODEL: 'synthetic-realtime', OPENAI_INBOUND_AGENT_ID: f.agent.id, OPENAI_WEBHOOK_SECRET: 'whsec_' + secret });
  const original = globalThis.fetch, urls: string[] = []; t.after(() => { globalThis.fetch = original; for (const [k, v] of Object.entries(old)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
  globalThis.fetch = async input => { const url = String(input); urls.push(url); if (url.endsWith('/accept')) await f.enable(); return new Response(null, { status: 200 }); };
  const raw = JSON.stringify({ type: 'realtime.call.incoming', data: { call_id: 'call_before_' + stage, sip_headers: [] } }), id = 'event_before_' + stage, timestamp = String(Math.floor(Date.now() / 1000)), signature = createHmac('sha256', Buffer.from(secret, 'base64')).update(`${id}.${timestamp}.${raw}`).digest('base64');
  const r = await f.app.inject({ method: 'POST', url: '/api/v1/webhooks/openai', payload: raw, headers: { 'content-type': 'application/json', 'webhook-id': id, 'webhook-timestamp': timestamp, 'webhook-signature': `v1,${signature}` } });
  assert.equal(r.statusCode, 403, r.body); assert.equal(urls.filter(u => u.endsWith('/accept')).length, 1); assert.equal(urls.filter(u => u.endsWith('/hangup')).length, 1); assert.equal(f.store.list(f.actor.tenantId, 'voice-sessions').length, 0);
  if (stage === 'during') { assert.equal(f.store.list(f.actor.tenantId, 'calls')[0].providerCallId, 'call_before_during'); assert.equal(f.store.list(f.actor.tenantId, 'calls')[0].status, 'hangup_requested'); assert.equal(f.store.list(f.actor.tenantId, 'voice-stop-operations')[0].status, 'accepted'); }
});
test('editor can edit and preview but cannot open a private test; availability does not project private examples', async t => {
  const f = await beforeContextFixture(t); await f.enable();
  const metadata = await f.request('GET', f.beforeBase + '/availability'); assert.equal(metadata.statusCode, 200, metadata.body); assert.deepEqual(Object.keys(metadata.json()).sort(), ['agentId', 'enabled', 'revision', 'supportedSurfaces']); assert.ok(!metadata.body.includes('Exemplo sintético'));
  f.store.db.prepare('UPDATE memberships SET role=? WHERE user_id=?').run('editor', f.actor.userId); const headers = await f.freshHeaders();
  const preview = await f.request('POST', f.beforeBase + '/preview', { configuration: f.sample }, headers); assert.equal(preview.statusCode, 200, preview.body);
  const denied = await f.request('POST', '/api/v1/ai/conversations/open', { expectedTenantId: f.actor.tenantId, agentId: f.agent.id, expectedConfigRevision: 1, idempotencyKey: randomUUID(), mode: 'test' }, headers); assert.equal(denied.statusCode, 403, denied.body); assert.equal(f.openAI.length, 0);
});
