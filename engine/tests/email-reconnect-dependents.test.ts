import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { randomBytes, randomUUID } from 'node:crypto';
import { Store } from '../src/store.js';
import { registerAuth } from '../src/auth.js';
import { registerOAuth } from '../src/oauth.js';
import { seedMember } from './fixtures/membership.js';
import { digest, seal } from '../src/oauth/crypto.js';
import { oauthAuthorizationGeneration, oauthAuthorizationIdentity, tokenContext, updateOAuthAuthorization } from '../src/oauth/access.js';
import { PublicBookingService } from '../src/public-booking/service.js';
import { authorizeBookingCalendar } from '../src/public-booking/authority.js';
import { validateEventTypeConfig } from '../src/scheduling/service.js';
import { authorized, configureEmailMailbox, listEmailMailboxes, organizeAccess } from '../src/email-agents/service.js';
import { activateAutomation, resolveAutomation } from '../src/email-automation/authority.js';
import type { MembershipActor } from '../src/memberships/service.js';
import { assistantBookingFixture } from './fixtures/assistant-booking.js';
import { addressChangeStops, reauthorizeConnection } from '../src/oauth/reauthorization.js';
import { accessTokens } from '../src/oauth/access.js';
import { readBookingCalendar } from '../src/oauth/booking-calendar.js';
import { disconnectEmailConnection } from '../src/email-agents/mailbox-actions.js';

/**
 * "Reconectar caixa" (E-Mail IA) reautoriza a MESMA conta Google/Microsoft para ganhar gmail.modify / Mail.ReadWrite.
 * Páginas de agendamento publicadas e a automação de e-mail emitidas sobre essa conta não podem ser revogadas em
 * silêncio por essa reautorização. Provedor simulado por fetch injetado; nenhuma chamada externa real.
 */
const LEGACY_GOOGLE = 'openid email https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send';
const env = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET', 'MICROSOFT_TENANT_ID', 'OAUTH_ENCRYPTION_KEY', 'PUBLIC_BASE_URL'];

async function fixture(t: any, provider: 'google' | 'microsoft' = 'google') {
  const previous = Object.fromEntries(env.map(n => [n, process.env[n]])), originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; for (const [n, v] of Object.entries(previous)) if (v === undefined) delete process.env[n]; else process.env[n] = v; });
  for (const n of env) delete process.env[n];
  Object.assign(process.env, { GOOGLE_CLIENT_ID: 'google-test', GOOGLE_CLIENT_SECRET: 'test-google-secret', MICROSOFT_CLIENT_ID: 'microsoft-test', MICROSOFT_CLIENT_SECRET: 'test-microsoft-secret', OAUTH_ENCRYPTION_KEY: randomBytes(32).toString('base64'), PUBLIC_BASE_URL: 'http://127.0.0.1:4310' });
  const store = new Store(), actor: MembershipActor = { tenantId: randomUUID(), userId: randomUUID(), role: 'owner' }; seedMember(store, actor);
  const rawCookie = randomBytes(32).toString('hex'), sessionHash = digest(rawCookie);
  store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(sessionHash, actor.userId, actor.tenantId, Date.now() + 3600000);
  const scopes = provider === 'google' ? LEGACY_GOOGLE : 'offline_access User.Read Calendars.ReadWrite Mail.Read Mail.Send';
  // Conta conectada antes da permissão de organizar: agenda + e-mail na mesma conexão (gmail.readonly / Mail.Read).
  const connection = store.create(actor.tenantId, 'oauth-connections', { provider, remoteId: 'same-remote', email: 'owner@example.test', userId: actor.userId, visibility: 'personal', status: 'connected', capabilities: ['calendar', 'calendar_write', 'email', 'email_send'], scopes, authorizationGeneration: 1 });
  store.update(actor.tenantId, 'oauth-connections', connection.id, { encryptedTokens: seal({ accessToken: 'mock-oauth-token', refreshToken: 'mock-refresh', expiresAt: Date.now() + 3600000, scope: scopes }, tokenContext(connection)) });
  // Página de agendamento publicada (grant real do PublicBookingService) sobre a agenda desta conta.
  const calendar = store.create(actor.tenantId, 'calendars', { enabled: true, provider, connectionId: connection.id, externalCalendarId: 'primary', timezone: 'UTC' });
  const page = store.create(actor.tenantId, 'booking-pages', { ...validateEventTypeConfig({ name: 'Consulta', slug: 'consulta', calendarId: calendar.id, timezone: 'UTC', durationMinutes: 30, bufferMinutes: 0, minimumNoticeMinutes: 0, horizonDays: 30, dailyLimit: 20, slotIntervalMinutes: 15, availability: Array.from({ length: 7 }, (_, weekday) => ({ weekday, start: '00:00', end: '24:00' })) }), revision: 1, publicationStatus: 'draft' });
  let provide: (url: URL, init: RequestInit) => Response | undefined = () => undefined;
  globalThis.fetch = (async (input: any, init: RequestInit = {}) => {
    const url = new URL(String(input)), custom = provide(url, init); if (custom) return custom;
    assert.match(url.hostname, /^(www\.googleapis\.com|graph\.microsoft\.com)$/, 'only the simulated calendar is contacted');
    return Response.json({ id: 'canonical-calendar', canEdit: true, accessRole: 'owner', primary: true, isDefaultCalendar: true });
  }) as typeof fetch;
  await new PublicBookingService(store).publish(actor, sessionHash, page.id, 1);
  const bookingGrant = store.list(actor.tenantId, 'booking-grants')[0]!;
  // Caixa do E-Mail IA + automação ativa sobre a mesma conexão.
  const agent = store.create(actor.tenantId, 'agents', { name: 'E-mail', status: 'active', prompt: 'Responda com fatos verificados.' });
  const box = configureEmailMailbox(store, actor, { name: 'Atendimento', connectionId: connection.id, agentId: agent.id });
  const automation = activateAutomation(store, actor, sessionHash, box.id, { mode: 'draft_review', optIn: true });
  const app = Fastify(); await app.register(cookie); await registerAuth(app, store); await registerOAuth(app, store);
  t.after(async () => { await app.close(); store.close(); });
  /** Same flow as the web "Reconectar caixa": start → provider consent (simulated) → callback. */
  let lastAuthorize: URL | undefined;
  async function reconnect(capabilities: string[], identity: { remoteId?: string; email?: string } = {}, granted?: (requested: string) => string, target: { connectionId?: string; visibility?: 'personal' | 'shared' } = {}, headers: Record<string, string> = {}) {
    const begin = await app.inject({ method: 'POST', url: `/api/v1/oauth/${provider}/start`, cookies: { kloel_session: rawCookie }, payload: { capabilities, visibility: target.visibility ?? 'personal', ...(target.connectionId ? { connectionId: target.connectionId } : {}) } });
    assert.equal(begin.statusCode, 200, begin.body);
    const authorize = lastAuthorize = new URL(begin.json().authorizationUrl), requested = authorize.searchParams.get('scope')!;
    provide = url => {
      if (url.pathname.endsWith('/token')) return Response.json({ access_token: 'mock-oauth-token-2', refresh_token: 'mock-refresh-2', token_type: 'Bearer', expires_in: 3600, scope: granted ? granted(requested) : requested });
      if (url.hostname === 'openidconnect.googleapis.com') return Response.json({ sub: identity.remoteId ?? 'same-remote', email: identity.email ?? 'owner@example.test' });
      if (url.hostname === 'graph.microsoft.com' && url.pathname === '/v1.0/me') return Response.json({ id: identity.remoteId ?? 'same-remote', mail: identity.email ?? 'owner@example.test', displayName: 'Owner' });
      return undefined;
    };
    const done = await app.inject({ url: `/api/v1/oauth/${provider}/callback?state=${encodeURIComponent(authorize.searchParams.get('state')!)}&code=test-code`, cookies: { kloel_session: rawCookie }, headers });
    provide = () => undefined;
    return done;
  }
  const booking = () => authorizeBookingCalendar(store, { kind: 'grant', tenantId: actor.tenantId, grantId: bookingGrant.id, purpose: 'availability' });
  const automationWorks = () => resolveAutomation(store, actor.tenantId, automation.id);
  const current = () => store.get(actor.tenantId, 'oauth-connections', connection.id)!;
  /** Simulated provider for calls outside reconnect (token refresh, calendar reads). */
  const respond = (handler: typeof provide) => { provide = handler; };
  return { store, actor, app, connection, bookingGrant, automation, box, page, rawCookie, reconnect, respond, booking, automationWorks, current, sessionHash, authorizeUrl: () => lastAuthorize! };
}
const code = (expected: string) => (error: any) => error?.code === expected;

test('Reconectar caixa (Google) keeps the published booking page and the email automation of the same account working', async t => {
  const f = await fixture(t);
  assert.ok(f.booking()); assert.ok(f.automationWorks());
  assert.equal(organizeAccess(f.current()).canOrganize, false);
  // Google devolve os escopos já concedidos + gmail.modify (include_granted_scopes=true).
  const done = await f.reconnect(['calendar', 'calendar_write', 'email', 'email_send'], {}, requested => `${LEGACY_GOOGLE} ${requested}`);
  assert.equal(done.statusCode, 200, done.body);
  assert.equal(done.json().connection.id, f.connection.id, 'the same connection is upgraded');
  assert.equal(oauthAuthorizationGeneration(f.current()), 2, 'the authorization generation still advances');
  assert.equal(organizeAccess(f.current()).canOrganize, true, 'the mailbox can now organize mail');
  assert.doesNotThrow(() => f.booking(), 'published booking page keeps showing slots and booking');
  assert.doesNotThrow(() => f.automationWorks(), 'email automation keeps running without reactivation');
  const grant = f.store.get(f.actor.tenantId, 'booking-grants', f.bookingGrant.id)!;
  assert.equal(grant.status, 'active'); assert.equal(grant.connectionGeneration, 2); assert.equal(grant.connectionIdentity, oauthAuthorizationIdentity(f.current()));
  const listed = listEmailMailboxes(f.store, f.actor).items[0]!;
  assert.equal(listed.canOrganize, true); assert.equal(listed.automation?.status, 'baselining'); assert.equal(listed.automation?.enabled, true);
});

test('Reconectar caixa (Microsoft) upgrades Mail.Read to Mail.ReadWrite without revoking booking or automation', async t => {
  const f = await fixture(t, 'microsoft');
  const done = await f.reconnect(['calendar', 'calendar_write', 'email', 'email_send']);
  assert.equal(done.statusCode, 200, done.body); assert.equal(done.json().connection.id, f.connection.id);
  assert.equal(organizeAccess(f.current()).canOrganize, true);
  assert.doesNotThrow(() => f.booking()); assert.doesNotThrow(() => f.automationWorks());
});

test('a reauthorization that drops the calendar still revokes the booking grant, but keeps the email automation', async t => {
  const f = await fixture(t);
  const done = await f.reconnect(['email', 'email_send']);
  assert.equal(done.statusCode, 200, done.body);
  assert.throws(() => f.booking(), (e: any) => e?.status === 403, 'calendar capability is gone: booking cannot keep working');
  assert.equal(f.store.get(f.actor.tenantId, 'booking-grants', f.bookingGrant.id)!.connectionGeneration, 1, 'no rebinding for a family that was dropped');
  assert.doesNotThrow(() => f.automationWorks(), 'the email family was kept');
});

test('a renamed account is never rebound in silence, and a disconnect followed by reconnect never resurrects dependent grants', async t => {
  const f = await fixture(t);
  // Same remote id but another address, through a connect dialog (Configurações), not "Reconectar caixa": refused, nothing changes.
  const renamed = await f.reconnect(['calendar', 'calendar_write', 'email', 'email_send'], { email: 'other@example.test' });
  assert.equal(renamed.statusCode, 409, renamed.body); assert.equal(renamed.json().error.code, 'oauth_reauthorization_address_changed');
  assert.equal(f.current().email, 'owner@example.test'); assert.equal(oauthAuthorizationGeneration(f.current()), 1);
  assert.doesNotThrow(() => f.booking()); assert.doesNotThrow(() => f.automationWorks());

  const g = await fixture(t);
  // Explicit disconnect revokes; a later reconnect of the same account must not bring the old grants back.
  g.store.transaction(() => updateOAuthAuthorization(g.store, g.current(), { status: 'disconnected', encryptedTokens: null }));
  assert.throws(() => g.booking());
  const again = await g.reconnect(['calendar', 'calendar_write', 'email', 'email_send']);
  assert.equal(again.statusCode, 200, again.body);
  assert.throws(() => g.booking(), code('booking_grant_revoked'));
  assert.throws(() => g.automationWorks(), code('email_automation_connection_changed'));
});

/**
 * Revisão: "Reconectar caixa" de UMA caixa (conexão alvo) quando o provedor entra com OUTRA conta já conectada pela mesma
 * pessoa (sessão do navegador). Antes, o callback achava a outra conexão e SUBSTITUÍA as capacidades dela pelas da caixa,
 * derrubando a Agenda e a página de agendamento publicada dela. Agora a reautorização carrega a conexão alvo no estado OAuth
 * e o callback recusa sem gravar nada quando a conta devolvida não é a da caixa.
 */
test('Reconectar caixa refuses, writing nothing, when the provider signs in another already connected account', async t => {
  const f = await fixture(t);
  // Caixa só de e-mail (gmail.readonly) da mesma pessoa, em outra conta Google.
  const inbox = f.store.create(f.actor.tenantId, 'oauth-connections', { provider: 'google', remoteId: 'inbox-remote', email: 'inbox@example.test', userId: f.actor.userId, visibility: 'personal', status: 'connected', capabilities: ['email', 'email_send'], scopes: 'openid email https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send', authorizationGeneration: 1 });
  const before = { account: f.current(), inbox: f.store.get(f.actor.tenantId, 'oauth-connections', inbox.id)!, count: f.store.list(f.actor.tenantId, 'oauth-connections').length };
  // Exatamente o pedido da web para a caixa (só e-mail), mas o provedor entra com a conta da Agenda (same-remote).
  const done = await f.reconnect(['email', 'email_send'], { remoteId: 'same-remote', email: 'owner@example.test' }, requested => `${LEGACY_GOOGLE} ${requested}`, { connectionId: inbox.id });
  assert.equal(f.authorizeUrl().searchParams.get('login_hint'), 'inbox@example.test', 'the provider is told which account to use');
  assert.equal(done.statusCode, 409, done.body); assert.equal(done.json().error.code, 'oauth_reauthorization_account_mismatch');
  assert.match(done.json().error.message, /owner@example\.test.*Nada foi alterado.*inbox@example\.test/);
  assert.deepEqual(f.current(), before.account, 'the other account (Agenda + booking page) is untouched');
  assert.deepEqual(f.store.get(f.actor.tenantId, 'oauth-connections', inbox.id), before.inbox, 'the inbox is untouched');
  assert.equal(f.store.list(f.actor.tenantId, 'oauth-connections').length, before.count, 'no connection is created');
  assert.doesNotThrow(() => f.booking(), 'the published booking page of the other account keeps working');
  assert.doesNotThrow(() => f.automationWorks());
});

test('a targeted reauthorization asks again for every feature of the connection, even when the request omits some', async t => {
  const f = await fixture(t);
  const done = await f.reconnect(['email', 'email_send'], {}, requested => `${LEGACY_GOOGLE} ${requested}`, { connectionId: f.connection.id });
  const scopes = f.authorizeUrl().searchParams.get('scope')!.split(' ');
  assert.ok(scopes.includes('https://www.googleapis.com/auth/calendar.events') && scopes.includes('https://www.googleapis.com/auth/gmail.modify'), scopes.join(' '));
  assert.equal(f.authorizeUrl().searchParams.get('login_hint'), 'owner@example.test');
  assert.equal(done.statusCode, 200, done.body);
  assert.deepEqual([...(f.current().capabilities as string[])].sort(), ['calendar', 'calendar_write', 'email', 'email_send']);
  assert.doesNotThrow(() => f.booking()); assert.doesNotThrow(() => f.automationWorks());
});

test('a connect dialog with Agenda unticked keeps the calendar the provider still grants (no silent revocation)', async t => {
  const f = await fixture(t);
  // E-Mail IA / Configurações sem a Agenda marcada, mesma conta: o Google devolve também os escopos já concedidos.
  const done = await f.reconnect(['email', 'email_send'], {}, requested => `${LEGACY_GOOGLE} ${requested}`);
  assert.equal(done.statusCode, 200, done.body);
  assert.ok((f.current().capabilities as string[]).includes('calendar_write'), 'the calendar the token still covers is kept');
  assert.doesNotThrow(() => f.booking(), 'published booking page keeps working');
  assert.doesNotThrow(() => f.automationWorks());
});

test('only the person who connected a shared account can reconnect it: a colleague is refused before consent', async t => {
  const f = await fixture(t);
  const shared = f.store.create(f.actor.tenantId, 'oauth-connections', { provider: 'google', remoteId: 'shared-remote', email: 'contato@example.test', userId: f.actor.userId, visibility: 'shared', status: 'connected', capabilities: ['email', 'email_send'], scopes: 'openid email https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send', authorizationGeneration: 1 });
  const colleague = { tenantId: f.actor.tenantId, userId: randomUUID(), role: 'admin' as const }; seedMember(f.store, colleague);
  const cookie = randomBytes(32).toString('hex');
  f.store.db.prepare('INSERT INTO sessions(hash,user_id,tenant_id,expires) VALUES(?,?,?,?)').run(digest(cookie), colleague.userId, colleague.tenantId, Date.now() + 3600000);
  const begin = await f.app.inject({ method: 'POST', url: '/api/v1/oauth/google/start', cookies: { kloel_session: cookie }, payload: { capabilities: ['email', 'email_send'], visibility: 'shared', connectionId: shared.id } });
  assert.equal(begin.statusCode, 403, begin.body); assert.equal(begin.json().error.code, 'oauth_reauthorization_owner');
  assert.equal(f.store.list(f.actor.tenantId, 'oauth-states').filter(s => s.userId === colleague.userId).length, 0, 'no authorization is started (no duplicate connection later)');
  // Uma conexão de outra pessoa que nem é visível (pessoal) não é revelada.
  const hidden = await f.app.inject({ method: 'POST', url: '/api/v1/oauth/google/start', cookies: { kloel_session: cookie }, payload: { capabilities: ['email'], visibility: 'personal', connectionId: f.connection.id } });
  assert.equal(hidden.statusCode, 409, hidden.body); assert.equal(hidden.json().error.code, 'oauth_connection_changed');
});

/**
 * Revisão: a página religada também é usada pelo assistente (agendamento no chat privado/webchat). O gatilho
 * booking_assistant_invalidate marcava a ação como inválida a cada atualização do booking-grant e o retrato (snapshot) da
 * ação inclui a identidade da autorização: depois de "Reconectar caixa" o assistente parava de agendar até o dono regravar.
 * Ações válidas antes da reautorização da MESMA conta seguem válidas (e os cartões abertos também).
 * O fixture do assistente usa um tenant que não é UUID (o estado OAuth exige UUID), então a reautorização é aplicada com a
 * mesma escrita do callback (reauthorizeConnection) na mesma transação.
 */
async function assistantScenario(t: any) {
  const f = await assistantBookingFixture(t);
  const tenant = f.actor.tenantId, connection = () => f.store.get(tenant, 'oauth-connections', f.connection.id)!;
  // Conexões reais sempre têm o endereço: o fixture não grava; ajusta antes de criar a ação.
  const withEmail = f.store.update(tenant, 'oauth-connections', f.connection.id, { email: 'owner@example.test' })!;
  for (const g of f.store.list(tenant, 'booking-grants')) f.store.update(tenant, 'booking-grants', g.id, { connectionIdentity: oauthAuthorizationIdentity(withEmail) });
  /** "Reconectar caixa" na mesma conta: Agenda mantida, e-mail com gmail.modify acrescentado. */
  const reconnect = () => f.store.transaction(() => {
    const before = connection();
    reauthorizeConnection(f.store, before, { capabilities: [...(before.capabilities as string[]), 'email', 'email_send'], scopes: `${before.scopes} https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send`, status: 'connected' });
    return f.store.list(tenant, 'booking-grants').filter(g => g.connectionIdentity === oauthAuthorizationIdentity(connection())).length;
  });
  return { ...f, tenant, connection, reconnect };
}

test('Reconectar caixa keeps the assistant booking action of the same account working (open card and new booking)', async t => {
  const f = await assistantScenario(t);
  const webchat = await f.create('webchat'), action = await f.create(); f.toolRound(action);
  const open = (await f.askPrivate()).json().bookingChoices[0]; assert.ok(open, 'card offered before the reconnection');
  assert.deepEqual((await f.request('GET', f.base)).json().items.map((i: any) => i.available), [true, true]);
  const generation = oauthAuthorizationGeneration(f.connection());
  assert.ok(f.reconnect() >= 1); assert.equal(oauthAuthorizationGeneration(f.connection()), generation + 1);
  assert.doesNotThrow(() => authorizeBookingCalendar(f.store, { kind: 'grant', tenantId: f.tenant, grantId: String(f.store.get(f.tenant, 'booking-pages', f.page.id)!.grantId), purpose: 'availability' }));
  const items = (await f.request('GET', f.base)).json().items;
  assert.deepEqual(items.map((i: any) => [i.id, i.available, i.revision]), [[webchat.id, true, webchat.revision], [action.id, true, action.revision]], 'private and webchat actions stay available, no owner re-save needed');
  assert.equal(f.store.get(f.tenant, 'booking-assistant-actions', action.id)!.invalidated, false);
  // O cartão já aberto no chat continua confirmando; um pedido novo também recebe horários.
  const booked = await f.book(open); assert.equal(booked.statusCode, 200, booked.body); assert.equal(booked.json().operation.status, 'confirmed');
  const next = (await f.askPrivate()).json().bookingChoices[0]; assert.ok(next, 'the assistant keeps offering slots');
});

test('an assistant booking action that was already invalid is not revived by the reconnection', async t => {
  const f = await assistantScenario(t);
  const action = await f.create();
  // Ação invalidada antes (ex.: assistente ou canal alterado) segue exigindo que o dono a grave de novo.
  f.store.update(f.tenant, 'booking-assistant-actions', action.id, { invalidated: true });
  f.reconnect();
  assert.equal(f.store.get(f.tenant, 'booking-assistant-actions', action.id)!.invalidated, true);
  assert.equal((await f.request('GET', f.base)).json().items[0].available, false);
});

/**
 * Revisão (rodada 2): o endereço principal da conta mudou no provedor (Workspace renomeou o usuário, troca de endereço no
 * Gmail, Microsoft trocando `mail` × `userPrincipalName`) — mesmo remoteId, outro e-mail. Antes, o callback gravava o novo
 * endereço com geração + 1 e não religava nada (o vínculo é ao endereço): a página publicada parava (booking_grant_revoked),
 * a automação parava e a própria caixa passava a falhar (email_mailbox_identity_changed), enquanto a tela dizia
 * "Nada é desconectado" e "Caixa reconectada". Agora a reautorização é recusada sem gravar nada e diz o que pararia.
 */
test('Reconectar caixa refuses, writing nothing, when the account primary address changed at the provider, and says what would stop', async t => {
  for (const provider of ['google', 'microsoft'] as const) {
    const f = await fixture(t, provider);
    const snapshot = () => ({ connection: f.current(), grants: f.store.list(f.actor.tenantId, 'booking-grants'), automation: f.store.list(f.actor.tenantId, 'email-automation-grants'), boxes: f.store.list(f.actor.tenantId, 'email-mailboxes'), connections: f.store.list(f.actor.tenantId, 'oauth-connections').length });
    const before = snapshot();
    const done = await f.reconnect(['email', 'email_send'], { email: 'Renamed@Example.test' }, provider === 'google' ? requested => `${LEGACY_GOOGLE} ${requested}` : undefined, { connectionId: f.connection.id });
    assert.equal(done.statusCode, 409, `${provider}: ${done.body}`); assert.equal(done.json().error.code, 'oauth_reauthorization_address_changed');
    const message: string = done.json().error.message;
    assert.match(message, /owner@example\.test/); assert.match(message, /renamed@example\.test/i); assert.match(message, /Nada foi alterado/);
    // Exatamente o que depende desta conexão: a página publicada, a automação e a caixa do E-Mail IA.
    assert.match(message, /página de agendamento publicada “Consulta”/);
    assert.match(message, /automação de e-mail da caixa “Atendimento”/);
    assert.match(message, /caixa “Atendimento” \(owner@example\.test\) do E-Mail IA/);
    assert.match(message, /desconecte/);
    assert.deepEqual(snapshot(), before, `${provider}: the connection, its grants and the mailbox are untouched`);
    assert.doesNotThrow(() => f.booking(), 'the published booking page keeps working');
    assert.doesNotThrow(() => f.automationWorks(), 'the email automation keeps working');
    assert.doesNotThrow(() => authorized(f.store, f.actor, f.box.id), 'the mailbox keeps working');
  }
});

test('an address that only differs in letter case is the same account: reconnected and dependents rebound', async t => {
  const f = await fixture(t);
  const done = await f.reconnect(['email', 'email_send'], { email: 'OWNER@Example.test' }, requested => `${LEGACY_GOOGLE} ${requested}`, { connectionId: f.connection.id });
  assert.equal(done.statusCode, 200, done.body); assert.equal(oauthAuthorizationGeneration(f.current()), 2);
  assert.doesNotThrow(() => f.booking()); assert.doesNotThrow(() => f.automationWorks());
});

test('a renamed account that nothing depends on is reconnected with its new address', async t => {
  const f = await fixture(t);
  const lone = f.store.create(f.actor.tenantId, 'oauth-connections', { provider: 'google', remoteId: 'lone-remote', email: 'lone@example.test', userId: f.actor.userId, visibility: 'personal', status: 'connected', capabilities: ['email', 'email_send'], scopes: 'openid email https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send', authorizationGeneration: 1 });
  const done = await f.reconnect(['email', 'email_send'], { remoteId: 'lone-remote', email: 'lone-new@example.test' });
  assert.equal(done.statusCode, 200, done.body); assert.equal(done.json().connection.id, lone.id);
  assert.equal(f.store.get(f.actor.tenantId, 'oauth-connections', lone.id)!.email, 'lone-new@example.test');
  assert.doesNotThrow(() => f.booking(), 'the other account is untouched');
});

test('the address-change refusal also names the assistant booking that uses the page of that account', async t => {
  const f = await assistantScenario(t);
  await f.create();
  const stops = addressChangeStops(f.store, f.connection()).join(' | ');
  assert.match(stops, /página de agendamento publicada/); assert.match(stops, /agendamento pelo assistente nessa agenda \(1 ação\)/);
});

/**
 * Revisão (cético 2): a recusa (endereço mudado ou outra conta) chega DEPOIS do consentimento no provedor. A Microsoft devolve,
 * a cada renovação, todos os escopos já consentidos para o Graph, mesmo sem pedi-los: depois de consentir Mail.ReadWrite numa
 * reconexão recusada, o token antigo renovado lista Mail.ReadWrite. Antes a renovação exigia escopos IGUAIS aos da conexão e,
 * em até 1 hora, a página publicada, a automação e a caixa paravam (reauthorization_required), embora a recusa dissesse que
 * nada mudou. Escopo a mais é ignorado (o token guardado fica com os escopos da conexão); escopo PERDIDO ainda exige autorização.
 */
test('after a refused Microsoft reconnection, a refresh listing the newly consented Mail.ReadWrite keeps booking, automation and the mailbox working', async t => {
  const f = await fixture(t, 'microsoft');
  const refused = await f.reconnect(['email', 'email_send'], { email: 'renamed@example.test' }, undefined, { connectionId: f.connection.id });
  assert.equal(refused.statusCode, 409, refused.body); assert.equal(refused.json().error.code, 'oauth_reauthorization_address_changed');
  const stored = String(f.current().scopes), identity = oauthAuthorizationIdentity(f.current());
  const expire = () => f.store.update(f.actor.tenantId, 'oauth-connections', f.connection.id, { encryptedTokens: seal({ accessToken: 'expired', refreshToken: 'mock-refresh', expiresAt: 0, scope: stored }, tokenContext(f.current())) });
  // O token de acesso expira; o provedor renova com os escopos antigos + Mail.ReadWrite (consentido na janela recusada).
  let refreshes = 0, refreshed = `${stored} Mail.ReadWrite openid profile email`;
  f.respond(url => {
    if (url.pathname.endsWith('/token')) { refreshes++; return Response.json({ access_token: `refreshed-${refreshes}`, refresh_token: 'mock-refresh', token_type: 'Bearer', expires_in: 3600, scope: refreshed }); }
    if (url.pathname.endsWith('/calendarView')) return Response.json({ value: [] });
    return undefined;
  });
  expire();
  const availability = { kind: 'grant' as const, tenantId: f.actor.tenantId, grantId: f.bookingGrant.id, purpose: 'availability' as const };
  const from = new Date(Date.now() + 86400000).toISOString(), to = new Date(Date.now() + 2 * 86400000).toISOString();
  assert.deepEqual(await readBookingCalendar(f.store, availability, from, to), [], 'the published booking page keeps reading the calendar');
  assert.equal(refreshes, 1);
  const tokens = await accessTokens(f.store, f.current());
  assert.doesNotMatch(tokens.scope.toLowerCase(), /mail\.readwrite/, 'the kept token carries only what the connection was authorized for');
  assert.equal(oauthAuthorizationIdentity(f.current()), identity); assert.equal(f.current().scopes, stored); assert.equal(oauthAuthorizationGeneration(f.current()), 1);
  assert.equal(organizeAccess(f.current()).canOrganize, false, 'organizing mail still needs an accepted reconnection');
  assert.doesNotThrow(() => f.automationWorks()); assert.doesNotThrow(() => authorized(f.store, f.actor, f.box.id));
  // Escopo perdido (ex.: o administrador retirou Calendars.ReadWrite): nova autorização, nada gravado.
  refreshed = stored.split(' ').filter(s => s !== 'Calendars.ReadWrite').join(' '); expire();
  const before = f.current().encryptedTokens;
  await assert.rejects(readBookingCalendar(f.store, availability, from, to), code('reauthorization_required'));
  assert.equal(f.current().encryptedTokens, before);
});

/**
 * Revisão (cético 2): a mensagem da recusa não afirma que tudo funciona (o token antigo pode já estar morto) e dá os passos na
 * ordem que o produto permite. A caixa precisa sair do E-Mail IA enquanto a conexão ainda está conectada: desconectando a conta
 * antes, a caixa fica presa ao endereço antigo (email_mailbox_identity_changed) e impede outra (email_mailbox_exists).
 * Seguidos na ordem, os passos levam a caixa, a automação e a página de agendamento a funcionar no novo endereço.
 */
test('the address-change refusal gives recovery steps that, followed in order, bring everything back on the new address', async t => {
  const f = await fixture(t);
  const refused = await f.reconnect(['email', 'email_send'], { email: 'renamed@example.test' }, requested => `${LEGACY_GOOGLE} ${requested}`, { connectionId: f.connection.id });
  assert.equal(refused.statusCode, 409, refused.body);
  const message: string = refused.json().error.message;
  assert.doesNotMatch(message, /continua funcionando/, 'no claim about the health of the old authorization');
  assert.match(message, /Nada foi alterado: a conexão continua com owner@example\.test/);
  assert.match(message, /1\) no E-Mail IA, use “Desconectar caixa de entrada” em “Atendimento”.*2\) desconecte a conta owner@example\.test.*3\) conecte a conta de novo.*4\) depois adicione a caixa de novo no E-Mail IA \(e ative a automação\) e publique de novo a página “Consulta”/);
  // 1) E-Mail IA → Desconectar caixa de entrada (a conexão continua para a Agenda).
  assert.equal(disconnectEmailConnection(f.store, f.actor, f.connection.id, { confirmed: true }).connection, 'kept_for_other_features');
  // 2) Desconectar a conta.
  const removed = await f.app.inject({ method: 'DELETE', url: `/api/v1/oauth/connections/${f.connection.id}`, cookies: { kloel_session: f.rawCookie } });
  assert.equal(removed.statusCode, 200, removed.body);
  // 3) Conectar de novo: a mesma conta, agora com o novo endereço.
  const again = await f.reconnect(['calendar', 'calendar_write', 'email', 'email_send'], { email: 'renamed@example.test' });
  assert.equal(again.statusCode, 200, again.body); assert.equal(f.current().email, 'renamed@example.test');
  // 4) Caixa de novo no E-Mail IA, com o novo endereço e a automação; página publicada outra vez.
  const box = configureEmailMailbox(f.store, f.actor, { name: 'Atendimento', connectionId: f.connection.id, agentId: String(f.box.agentId) });
  assert.equal(box.address, 'renamed@example.test');
  assert.doesNotThrow(() => authorized(f.store, f.actor, box.id));
  const automation = activateAutomation(f.store, f.actor, f.sessionHash, box.id, { mode: 'draft_review', optIn: true });
  assert.ok(resolveAutomation(f.store, f.actor.tenantId, automation.id));
  const service = new PublicBookingService(f.store);
  service.unpublish(f.actor, f.sessionHash, f.page.id);
  await service.publish(f.actor, f.sessionHash, f.page.id, Number(f.store.get(f.actor.tenantId, 'booking-pages', f.page.id)!.revision));
  const grantId = String(f.store.get(f.actor.tenantId, 'booking-pages', f.page.id)!.grantId);
  assert.doesNotThrow(() => authorizeBookingCalendar(f.store, { kind: 'grant', tenantId: f.actor.tenantId, grantId, purpose: 'availability' }));
});

/**
 * Revisão (cético 2): nas janelas de conexão (Configurações, Agenda, Planilhas, Reconectar caixa) a recusa aparecia como JSON
 * cru. A navegação do navegador (Accept text/html) recebe uma página legível com o motivo; clientes de API seguem com JSON.
 */
test('the provider callback shows a browser a readable page with the refusal reason (escaped), and keeps JSON for API clients', async t => {
  const f = await fixture(t);
  f.store.update(f.actor.tenantId, 'email-mailboxes', f.box.id, { name: 'Vendas <b>&</b>' });
  const browser = { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' };
  const page = await f.reconnect(['email', 'email_send'], { email: 'renamed@example.test' }, requested => `${LEGACY_GOOGLE} ${requested}`, { connectionId: f.connection.id }, browser);
  assert.equal(page.statusCode, 409); assert.match(String(page.headers['content-type']), /^text\/html; charset=utf-8/);
  assert.match(String(page.headers['content-security-policy']), /default-src 'none'/);
  assert.doesNotMatch(page.body, /"error"/, 'no raw JSON');
  assert.match(page.body, /<h1[^>]*>A conexão não foi concluída<\/h1>/);
  assert.match(page.body, /O endereço desta conta Google mudou de owner@example\.test para renamed@example\.test\. Nada foi alterado/);
  assert.match(page.body, /caixa “Vendas &lt;b&gt;&amp;&lt;\/b&gt;”/, 'names typed by users are escaped');
  assert.doesNotMatch(page.body, /<b>&<\/b>/);
  assert.equal(oauthAuthorizationGeneration(f.current()), 1, 'nothing was written');
  const api = await f.reconnect(['email', 'email_send'], { email: 'renamed@example.test' }, requested => `${LEGACY_GOOGLE} ${requested}`, { connectionId: f.connection.id });
  assert.equal(api.statusCode, 409); assert.equal(api.json().error.code, 'oauth_reauthorization_address_changed');
  const done = await f.reconnect(['email', 'email_send'], {}, requested => `${LEGACY_GOOGLE} ${requested}`, { connectionId: f.connection.id }, browser);
  assert.equal(done.statusCode, 200); assert.match(done.body, /Conta conectada/); assert.equal(oauthAuthorizationGeneration(f.current()), 2);
});
