import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { REFERRAL_PUBLIC_PATH, recordReferralSignup } from './referral-codes.js';
import { SITE_LEADS_PATH } from './site-leads.js';
import { DEMO_BOOKING_PATHS } from './demo-booking.js';
import { SITE_PREVIEW_PATH } from './site-preview.js';
import { scryptSync, randomBytes, createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Store } from './store.js';
import { assertRequestContext, parseExpectedRequestContext, rejectExpectedRequestContext, resolveSessionContext, sameRequestContext } from './request-context.js';
import { PUBLIC_CHAT_PATHS } from './public-chat.js';
import { PUBLIC_BOOKING_PATHS } from './public-booking.js';
import { capabilitiesFor } from './memberships/permissions.js';
import { registerApiKeys } from './api-keys.js';
import { apiKeyPermission, auditApiKey, authenticateApiKey, requireApiKeyScope } from './api-keys/service.js';
import { createOrganizationForUser, listOrganizations, MembershipError, registerIdentityWithOrganization, resolveSessionIdentity, selectOrganizationForSession } from './memberships/service.js';

export const sessionDigest = (value: string) => createHash('sha256').update(value).digest('hex');
export const hashPassword = (value: string) => { const salt = randomBytes(16).toString('hex'); return `${salt}:${scryptSync(value, salt, 64).toString('hex')}`; };
export function validPassword(value: string, hash: string): boolean {
  const [salt, hex] = hash.split(':');
  if (!salt || !hex || !/^[a-f0-9]{128}$/.test(hex)) return false;
  return timingSafeEqual(scryptSync(value, salt, 64), Buffer.from(hex, 'hex'));
}
const credentials = z.object({ email: z.string().trim().toLowerCase().email().max(254), password: z.string().min(12).max(128) }).strict();
const registration = credentials.extend({ organization: z.string().trim().min(2).max(120), referralCode: z.string().trim().max(64).optional() });
const publicPaths = new Set(['/api/v1/public/call-me', '/api/v1/admin/google-calendar/start', '/api/v1/admin/google-calendar/callback', '/api/v1/internal/google-calendar-token', ...PUBLIC_CHAT_PATHS, '/api/v1/auth/bootstrap', '/api/v1/auth/signup', '/api/v1/auth/login', '/api/v1/auth/accept-invite', '/api/v1/webhooks/stripe', '/api/v1/webhooks/meta', '/api/v1/webhooks/twilio/voice', '/api/v1/webhooks/twilio/caller-id', '/api/v1/webhooks/openai', '/api/v1/oauth/google/callback', '/api/v1/oauth/microsoft/callback','/api/v1/calendly/oauth/callback']);
const identityPaths = new Set(['/api/v1/auth/me', '/api/v1/auth/logout', '/api/v1/organizations', '/api/v1/auth/select-organization', '/api/v1/account/profile']);
publicPaths.add('/api/v1/auth/forgot-password');
publicPaths.add('/api/v1/auth/google');
publicPaths.add('/api/v1/auth/google/callback');
publicPaths.add('/api/v1/health');
publicPaths.add('/api/v1/auth/reset-password');
publicPaths.add(SITE_LEADS_PATH);
for (const path of PUBLIC_BOOKING_PATHS) publicPaths.add(path);
for (const path of DEMO_BOOKING_PATHS) publicPaths.add(path);
publicPaths.add(SITE_PREVIEW_PATH);
publicPaths.add('/api/v1/public/webchat/hosted'); // link hospedado /w/<empresa>/<assistente> (webchat-hosted.ts)

export function setSessionCookie(reply: FastifyReply, token: string) {
  reply.setCookie('kloel_session', token, { httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === 'true', path: '/', maxAge: 86400 });
}

export async function registerAuth(app: FastifyInstance, store: Store) {
  app.decorateRequest('actor');
  app.decorateRequest('identity');
  app.decorateRequest('apiKey');
  app.addHook('onRequest', async (req, reply) => {
    const path = req.url.split('?')[0];
    if (!path.startsWith('/api/v1/')) return;
    // Parse before authentication: partial or duplicated groups never downgrade to legacy.
    parseExpectedRequestContext(req);
    if (req.headers.authorization !== undefined) {
      rejectExpectedRequestContext(req);
      if (PUBLIC_BOOKING_PATHS.has(path) && /^Booking(?:Manage)? [A-Za-z0-9_-]{43}$/.test(req.headers.authorization)) return;
      const match = /^Bearer ([A-Za-z0-9_-]+)$/i.exec(req.headers.authorization);
      if (!match) throw new MembershipError(401, 'invalid_api_key', 'Envie a chave no cabeçalho Authorization: Bearer.');
      // Visitor tokens have their own origin/channel/session verification in public-chat.
      // They never authenticate REST routes; prefixed Kloel keys still use the allowlist below.
      if (PUBLIC_CHAT_PATHS.has(path) && /^[A-Za-z0-9_-]{43}$/.test(match[1]) && !match[1].startsWith('klo_key_')) return;
      const authentication = authenticateApiKey(store, match[1]);
      req.actor = authentication.actor;
      req.identity = { userId: authentication.actor.userId };
      req.apiKey = authentication.context;
      const permission = apiKeyPermission(req.method, path);
      if (!permission) throw new MembershipError(403, 'api_key_route_forbidden', 'Esta rota não aceita autenticação por chave de API.');
      requireApiKeyScope(store, authentication.context, permission);
      return;
    }
    if (publicPaths.has(path) || REFERRAL_PUBLIC_PATH.test(path) || path.startsWith('/api/v1/internal/phone/') || /^\/api\/v1\/public\/demo-booking\/[a-f0-9]{24}$/.test(path)) { rejectExpectedRequestContext(req); return; }
    const token = req.cookies.kloel_session;
    const snapshot = token ? resolveSessionContext(store, sessionDigest(token)) : undefined;
    if (!snapshot) return reply.code(401).send({ error: { code: 'unauthorized', message: 'Autenticação necessária.' } });
    req.identity = snapshot.identity;
    if (snapshot.actor) req.actor = snapshot.actor;
    assertRequestContext(store, req, 'admission');
    if (!snapshot.actor && !identityPaths.has(path)) return reply.code(403).send({ error: { code: 'organization_required', message: 'Selecione uma organização ativa.' } });
  });
  app.addHook('preHandler', async request => {
    // Parsing/validation can await after onRequest. No handler has started yet,
    // so a changed precondition here is a definite admission rejection.
    if (request.url.split('?')[0].startsWith('/api/v1/')) assertRequestContext(store, request, 'admission');
  });
  app.addHook('onResponse', async (request, reply) => {
    if (!request.apiKey || !request.actor) return;
    auditApiKey(store, { tenantId: request.actor.tenantId, keyId: request.apiKey.id, actorId: request.actor.userId, action: 'request', method: request.method, route: request.routeOptions.url ?? '/unmatched', statusCode: reply.statusCode });
    if (reply.statusCode < 400) store.db.prepare('UPDATE api_keys SET last_used_at=? WHERE id=? AND tenant_id=? AND revoked_at IS NULL').run(new Date().toISOString(), request.apiKey.id, request.actor.tenantId);
  });
  const session = (reply: FastifyReply, userId: string, tenantId: string | null, previous?: string) => {
    const token = randomBytes(32).toString('hex');
    store.transaction(() => {
      store.db.prepare('INSERT INTO sessions(hash,user_id,expires,tenant_id) VALUES(?,?,?,?)').run(sessionDigest(token), userId, Date.now() + 86400000, tenantId);
      if (previous) store.db.prepare('DELETE FROM sessions WHERE hash=?').run(sessionDigest(previous));
    });
    setSessionCookie(reply, token);
    return sessionDigest(token);
  };
  const identityView = (sessionHash: string) => {
    const snapshot = resolveSessionContext(store, sessionHash);
    if (!snapshot) throw new MembershipError(401, 'unauthorized', 'Autenticação necessária.');
    const organizations = listOrganizations(store, snapshot.identity.userId);
    const fresh = resolveSessionContext(store, sessionHash);
    if (!fresh || !sameRequestContext(snapshot.context, fresh.context)) throw new MembershipError(409, 'context_changed_in_flight', 'O contexto mudou durante a consulta. Atualize a sessão.');
    return { userId: snapshot.identity.userId, email: snapshot.email, tenantId: snapshot.context.tenantId, role: snapshot.actor?.role ?? null,
      permissions: snapshot.actor ? capabilitiesFor(snapshot.actor.role) : [], organizations, context: snapshot.context };
  };
  const identity = (request: FastifyRequest) => {
    assertRequestContext(store, request);
    const current = resolveSessionIdentity(store, sessionDigest(request.cookies.kloel_session || ''));
    if (!current) throw new MembershipError(401, 'unauthorized', 'Autenticação necessária.');
    return current;
  };
  const signUp = (input: z.infer<typeof registration>, reply: FastifyReply, previous?: string) => {
    const result = registerIdentityWithOrganization(store, { email: input.email, passwordHash: hashPassword(input.password), organization: { name: input.organization } });
    // A referral never blocks the signup: an unknown code is simply not recorded.
    if (input.referralCode) { try { recordReferralSignup(store, input.referralCode, { tenantId: result.organization.tenantId, organization: input.organization }); } catch (error) { console.warn('referral_record_failed', error instanceof Error ? error.message : 'unknown'); } }
    const sessionHash = session(reply, result.userId, result.organization.tenantId, previous);
    return reply.code(201).send(identityView(sessionHash));
  };
  app.post('/api/v1/auth/bootstrap', async (req, reply) => {
    const input = registration.parse(req.body);
    if (Number(store.db.prepare('SELECT COUNT(*) AS n FROM users').get()?.n) > 0) return reply.code(409).send({ error: { code: 'already_initialized', message: 'Organização já inicializada.' } });
    return signUp(input, reply, req.cookies.kloel_session);
  });
  app.post('/api/v1/auth/signup', async (req, reply) => signUp(registration.parse(req.body), reply, req.cookies.kloel_session));
  app.post('/api/v1/auth/login', async (req, reply) => {
    const input = credentials.extend({ tenantId: z.string().min(1).max(128).optional() }).parse(req.body);
    const user = store.db.prepare('SELECT id,password FROM users WHERE lower(email)=?').get(input.email);
    if (!user || !validPassword(input.password, String(user.password))) return reply.code(401).send({ error: { code: 'invalid_credentials', message: 'Credenciais inválidas.' } });
    const organizations = listOrganizations(store, String(user.id));
    const selected = input.tenantId ? organizations.find(item => item.tenantId === input.tenantId) : organizations[0];
    if (input.tenantId && !selected) throw new MembershipError(403, 'organization_unavailable', 'Organização indisponível para esta identidade.');
    const sessionHash = session(reply, String(user.id), selected?.tenantId ?? null, req.cookies.kloel_session);
    return identityView(sessionHash);
  });
  // Entrar com Google (OpenID Connect). Redirect URI a cadastrar no Google Cloud: ${PUBLIC_BASE_URL}/api/v1/auth/google/callback
  const googleRedirect = () => new URL('/api/v1/auth/google/callback', process.env.PUBLIC_BASE_URL || 'https://www.kloel.ai').toString();
  const stateKey = () => process.env.OAUTH_ENCRYPTION_KEY || process.env.ADMIN_SETUP_KEY || '';
  const signState = (v: string) => createHmac('sha256', stateKey()).update(v).digest('base64url');
  const safeNext = (n: unknown) => typeof n === 'string' && /^\/(app|criar-conta|planos)(\/[A-Za-z0-9/_-]*)?(\?[A-Za-z0-9=&%_.-]*)?$/.test(n) ? n : '/app';
  app.get('/api/v1/health', async () => ({ ok: true }));
  app.get('/api/v1/auth/google', async (req, reply) => {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !stateKey()) return reply.redirect('/login?erro=google_indisponivel');
    const q = req.query as Record<string, string>, nonce = randomBytes(16).toString('hex');
    const payload = Buffer.from(JSON.stringify({ n: nonce, next: safeNext(q.next), t: Date.now() })).toString('base64url');
    reply.setCookie('kloel_oauth', nonce, { httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === 'true', path: '/api/v1/auth/google', maxAge: 900 });
    const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    for (const [k, v] of Object.entries({ client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: googleRedirect(), response_type: 'code', scope: 'openid email profile', prompt: 'select_account', state: `${payload}.${signState(payload)}` })) u.searchParams.set(k, v);
    return reply.redirect(u.toString());
  });
  app.get('/api/v1/auth/google/callback', async (req, reply) => {
    const q = req.query as Record<string, string>, [payload, mac] = String(q.state || '').split('.');
    const fail = (code: string) => reply.redirect(`/login?erro=${code}`);
    if (!payload || !mac || mac.length !== signState(payload).length || !timingSafeEqual(Buffer.from(mac), Buffer.from(signState(payload)))) return fail('google_estado');
    const st = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { n: string; next: string; t: number };
    if (st.n !== req.cookies.kloel_oauth || Date.now() - st.t > 900000 || !q.code) return fail('google_expirado');
    reply.clearCookie('kloel_oauth', { path: '/api/v1/auth/google' });
    const tr = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code: q.code, client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, redirect_uri: googleRedirect(), grant_type: 'authorization_code' }) });
    const tok = await tr.json().catch(() => ({})) as { access_token?: string };
    if (!tr.ok || !tok.access_token) return fail('google_token');
    const ur = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${tok.access_token}` } });
    const info = await ur.json().catch(() => ({})) as { email?: string; email_verified?: boolean; name?: string };
    const email = String(info.email || '').trim().toLowerCase();
    if (!ur.ok || !email || info.email_verified !== true) return fail('google_email');
    const user = store.db.prepare('SELECT id FROM users WHERE lower(email)=?').get(email);
    if (user) {
      const organizations = listOrganizations(store, String(user.id));
      session(reply, String(user.id), organizations[0]?.tenantId ?? null, req.cookies.kloel_session);
      return reply.redirect(st.next);
    }
    const orgName = (info.name?.trim() || email.split('@')[0]!).slice(0, 120).padEnd(2, ' ').trim() || 'Minha empresa';
    const result = registerIdentityWithOrganization(store, { email, passwordHash: hashPassword(randomBytes(32).toString('hex')), organization: { name: orgName.length >= 2 ? orgName : 'Minha empresa' } });
    session(reply, result.userId, result.organization.tenantId, req.cookies.kloel_session);
    return reply.redirect(st.next === '/app' ? '/app/billing?onboarding=1' : st.next);
  });
  app.get('/api/v1/auth/me', async req => {
    identity(req);
    const result = identityView(sessionDigest(req.cookies.kloel_session!));
    assertRequestContext(store, req);
    return result;
  });
  app.get('/api/v1/organizations', async req => {
    identity(req);
    const snapshot = identityView(sessionDigest(req.cookies.kloel_session!));
    assertRequestContext(store, req);
    return { items: snapshot.organizations, selectedTenantId: snapshot.tenantId };
  });
  app.post('/api/v1/organizations', async (req, reply) => {
    const organization = createOrganizationForUser(store, identity(req).userId, req.body, () => { identity(req); });
    return reply.code(201).send(organization);
  });
  app.post('/api/v1/auth/select-organization', async (req, reply) => {
    const { tenantId } = z.object({ tenantId: z.string().min(1).max(128) }).strict().parse(req.body);
    const token = randomBytes(32).toString('hex');
    selectOrganizationForSession(store, sessionDigest(req.cookies.kloel_session!), tenantId, sessionDigest(token), Date.now(), () => { identity(req); });
    setSessionCookie(reply, token);
    return identityView(sessionDigest(token));
  });
  app.post('/api/v1/auth/logout', async (req, reply) => {
    store.transaction(() => {
      identity(req);
      store.db.prepare('DELETE FROM sessions WHERE hash=?').run(sessionDigest(req.cookies.kloel_session || ''));
    });
    reply.clearCookie('kloel_session', { path: '/' });
    return { ok: true };
  });
  await registerApiKeys(app, store);
}
