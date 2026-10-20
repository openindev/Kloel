import type { FastifyInstance } from 'fastify';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const GCAL_PUBLIC_PATHS = ['/api/v1/admin/google-calendar/start', '/api/v1/admin/google-calendar/callback', '/api/v1/internal/google-calendar-token'];
const SCOPES = 'openid email https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.freebusy';
const file = () => resolve(dirname(process.env.DATABASE_PATH || 'data/engine.sqlite'), 'google-calendar.json');
const eq = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const sign = (v: string) => createHmac('sha256', process.env.ADMIN_SETUP_KEY || '').update(v).digest('hex');
const redirect = () => new URL('/api/v1/admin/google-calendar/callback', process.env.PUBLIC_BASE_URL).toString();

/** One-time owner consent that stores the demo calendar refresh token on the engine volume for the voice worker. */
export function registerGoogleCalendarSetup(app: FastifyInstance) {
  app.get('/api/v1/admin/google-calendar/start', async (req, reply) => {
    const key = String((req.query as Record<string, string>).key || ''), admin = process.env.ADMIN_SETUP_KEY || '';
    if (!admin || !eq(key, admin) || !process.env.GOOGLE_CLIENT_ID) return reply.code(403).send({ error: { code: 'forbidden', message: 'Acesso negado.' } });
    const ts = String(Date.now()), state = `${ts}.${sign(ts)}`;
    const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    for (const [k, v] of Object.entries({ client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: redirect(), response_type: 'code', scope: SCOPES, access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state, login_hint: process.env.DEMO_OWNER_EMAIL || 'penin@kloel.com' })) u.searchParams.set(k, v);
    return reply.redirect(u.toString());
  });
  app.get('/api/v1/admin/google-calendar/callback', async (req, reply) => {
    const q = req.query as Record<string, string>, [ts, mac] = String(q.state || '').split('.');
    if (!ts || !mac || !eq(mac, sign(ts)) || Date.now() - Number(ts) > 15 * 60 * 1000 || !q.code) return reply.code(400).type('text/plain; charset=utf-8').send('Link expirado ou inválido. Gere um novo.');
    const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code: q.code, client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, redirect_uri: redirect(), grant_type: 'authorization_code' }) });
    const tok = await res.json() as { refresh_token?: string; scope?: string };
    if (!res.ok || !tok.refresh_token) return reply.code(502).type('text/plain; charset=utf-8').send('O Google não devolveu um token de acesso offline. Tente novamente.');
    mkdirSync(dirname(file()), { recursive: true });
    writeFileSync(file(), JSON.stringify({ refresh_token: tok.refresh_token, scope: tok.scope, savedAt: new Date().toISOString() }), { mode: 0o600 });
    return reply.type('text/html; charset=utf-8').send('<p style="font-family:sans-serif">Google Agenda conectado. A Joana já pode agendar demonstrações. Pode fechar esta aba.</p>');
  });
  app.get('/api/v1/internal/google-calendar-token', async (req, reply) => {
    const auth = String(req.headers['x-kloel-internal'] || ''), key = process.env.INTERNAL_TOKEN || '';
    if (!key || !eq(auth, key) || !existsSync(file())) return reply.code(404).send({ error: { code: 'not_found', message: 'Indisponível.' } });
    return { refresh_token: JSON.parse(readFileSync(file(), 'utf8')).refresh_token };
  });
}
