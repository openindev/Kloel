import { isPhoneBlockedForProvider } from './contact-blocks.js';
import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { AgentDispatchClient, RoomServiceClient, SipClient } from 'livekit-server-sdk';
import { z } from 'zod';

export const CALL_ME_PATH = '/api/v1/public/call-me';
const input = z.object({ phone: z.string().trim().regex(/^\+[1-9]\d{9,14}$/), name: z.string().trim().max(120).optional(), notes: z.string().trim().max(2000).optional(), context: z.string().trim().max(2000).optional() }).strict();

const inflight = new Set<string>();
const RETRY_EVERY_MS = Number(process.env.CALL_ME_RETRY_EVERY_MS || 20_000), RETRY_WINDOW_MS = Number(process.env.CALL_ME_RETRY_WINDOW_MS || 5 * 60_000);
type LkErr = { message?: string; sip?: string; sipStatus?: string };
const lkErr = (error: unknown): LkErr => { const e = error as { message?: string; metadata?: Record<string, string> }; return { message: e.message, sip: e.metadata?.['sip_status_code'], sipStatus: e.metadata?.['sip_status'] }; };
const CAPACITY_RE = /channel|limit|capacity|concurren|congest|overload|too many|quota|resource|request timed out/i;
/** Only trunk/channel capacity failures are retried; lead decline / no-answer / busy are NOT. */
export function isCapacityError(e: LkErr): boolean {
  const code = Number(e.sip || 0), text = `${e.sipStatus ?? ''} ${e.message ?? ''}`;
  if (code === 503 || code === 502 || code === 500) return true;
  if (CAPACITY_RE.test(text)) return true;
  return false;
}
export type CallOutcomeHooks = { onMissed?: (reason: string) => void; notes?: string };

/** True while a call to this number is ringing or in progress (dedupe: never redial the same number). */
export function isCallInFlight(phone: string): boolean { return inflight.has(phone.replace(/\D/g, '')); }

/**
 * Shared outbound dial (used by the public widget and by Joana on WhatsApp). No global concurrency cap.
 * Trunk capacity errors (channels full) are retried every ~20s for a few minutes; a decline/no-answer is not retried
 * and triggers hooks.onMissed so Joana can follow up on WhatsApp.
 */
export async function placeOutboundCall(phone: string, name: string | undefined, source: string, hooks: CallOutcomeHooks = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  const { LIVEKIT_URL: url, LIVEKIT_API_KEY: key, LIVEKIT_API_SECRET: secret, LIVEKIT_SIP_OUTBOUND_TRUNK_ID: trunk } = process.env;
  if (!url || !key || !secret || !trunk) return { status: 503, body: { error: { code: 'integration_not_configured', message: 'Ligação indisponível no momento.' } } };
  const body = input.parse({ phone, ...(name ? { name: name.slice(0, 120) } : {}) });
  if (isPhoneBlockedForProvider(body.phone)) return { status: 403, body: { error: { code: 'contact_blocked', message: 'Este contato está bloqueado.' } } };
  const dkey = body.phone.replace(/\D/g, '');
  if (inflight.has(dkey)) return { status: 202, body: { status: 'already_in_progress' } };
  const host = url.replace(/^wss:/, 'https:'), room = `kloel-out-${randomBytes(5).toString('hex')}`;
  const dialed = process.env.SIP_DIAL_FORMAT === 'plus' ? body.phone : process.env.SIP_DIAL_FORMAT === '00' ? '00' + body.phone.slice(1) : body.phone.slice(1);
  console.log('call_me_request', JSON.stringify({ dialed: dialed.slice(0, -4).replace(/\d/g, '*') + dialed.slice(-4), len: dialed.length, source, room }));
  inflight.add(dkey);
  const rooms = new RoomServiceClient(host, key, secret), sip = new SipClient(host, key, secret), firstAt = Date.now();
  const release = (why: string) => { if (inflight.delete(dkey)) console.log(why, room, Math.round((Date.now() - firstAt) / 1000) + 's'); };
  let attempt = 0;
  const dial = () => { attempt++; return sip.createSipParticipant(trunk, dialed, room, {
    fromNumber: process.env.KLOEL_CALLER_ID || '551152863804', participantIdentity: `lead-${randomBytes(3).toString('hex')}`, participantName: body.name || 'Lead', waitUntilAnswered: true, ringingTimeout: 45 }); };
  const watchUntilEnd = () => {
    const poll = async () => {
      try { if (Date.now() - firstAt > 25 * 60 * 1000 || !(await rooms.listRooms([room])).length) { release('call_me_ended'); return; } } catch { /* retry */ }
      setTimeout(poll, 3000);
    };
    setTimeout(poll, 3000);
  };
  const missed = async (e: LkErr, notify: boolean) => {
    console.log('call_me_not_answered', JSON.stringify({ room, attempt, sip: e.sip, sipStatus: e.sipStatus }));
    await rooms.deleteRoom(room).catch(() => undefined); release('call_me_released');
    if (notify) try { hooks.onMissed?.(e.sip ? `sip_${e.sip}` : 'no_answer'); } catch { /* ignore */ }
  };
  // Returns true if a retry was scheduled.
  const scheduleRetry = async (e: LkErr): Promise<boolean> => {
    if (Date.now() - firstAt + RETRY_EVERY_MS > RETRY_WINDOW_MS) { console.log('call_me_capacity_gave_up', room); await missed(e, true); return false; }
    console.log('call_me_retry_scheduled', JSON.stringify({ room, attempt, sip: e.sip, sipStatus: e.sipStatus, inMs: RETRY_EVERY_MS }));
    setTimeout(() => { track(dial()); }, RETRY_EVERY_MS);
    return true;
  };
  const track = (p: Promise<unknown>) => p.then(() => { console.log('call_me_answered', room, 'attempt', attempt); watchUntilEnd(); },
    async (error) => { const e = lkErr(error); console.error('call_me_failed', JSON.stringify({ ...e, attempt })); if (isCapacityError(e)) await scheduleRetry(e); else await missed(e, true); });
  try {
    const t0 = Date.now();
    await new AgentDispatchClient(host, key, secret).createDispatch(room, process.env.LIVEKIT_AGENT_NAME || 'kloel-phone-pilot', { metadata: JSON.stringify({ direction: 'outbound', name: body.name ?? '', phone: body.phone, ...(hooks.notes ? { notes: hooks.notes.slice(0, 2000) } : {}) }) });
    const p = dial();
    // Wait briefly: an immediate rejection (channels full / bad number) is reported synchronously; otherwise it's ringing.
    const early = await Promise.race([p.then(() => ({ ok: true as const }), (error) => ({ ok: false as const, e: lkErr(error) })), new Promise<null>(r => setTimeout(() => r(null), 2500))]);
    if (early === null) { track(p); console.log('call_me_ringing', room, (Date.now() - t0) + 'ms'); return { status: 202, body: { status: 'ringing', room } }; }
    if (early.ok) { console.log('call_me_answered', room, 'attempt', attempt); watchUntilEnd(); return { status: 202, body: { status: 'ringing', room } }; }
    console.error('call_me_failed', JSON.stringify({ ...early.e, attempt }));
    if (isCapacityError(early.e) && await scheduleRetry(early.e)) return { status: 202, body: { status: 'queued', room } };
    await missed(early.e, false);
    return { status: 202, body: { status: 'not_answered', room, sip: early.e.sip ?? null } };
  } catch (error) {
    console.error('call_me_failed', JSON.stringify(lkErr(error)));
    await rooms.deleteRoom(room).catch(() => undefined);
    inflight.delete(dkey);
    return { status: 502, body: { error: { code: 'call_failed', message: 'Não foi possível iniciar a ligação.' } } };
  }
}

const lastByPhone = new Map<string, number>();
const PER_PHONE_MS = Number(process.env.CALL_ME_PER_PHONE_MS || 60_000);
async function handle(req: { body: unknown; headers: Record<string, unknown> }, defaultSource: string) {
  const body = input.parse(req.body);
  const k = body.phone.replace(/\D/g, ''), now = Date.now();
  if (isCallInFlight(body.phone)) return { status: 202, body: { status: 'already_in_progress' } };
  if (now - (lastByPhone.get(k) ?? 0) < PER_PHONE_MS) return { status: 429, body: { error: { code: 'too_soon', message: 'Já estamos ligando para este número; aguarde um instante.' } } };
  lastByPhone.set(k, now);
  if (lastByPhone.size > 5000) for (const [p, t] of lastByPhone) if (now - t > PER_PHONE_MS) lastByPhone.delete(p);
  const source = req.headers['x-kloel-source'] ? String(req.headers['x-kloel-source']).slice(0, 40) : (req.headers.referer ? 'form' : defaultSource);
  const notes = body.notes || body.context;
  return placeOutboundCall(body.phone, body.name, source, notes ? { notes } : {});
}

/** Public "receive a call" widget: dials the visitor from the Kloel DID and dispatches Joana. Abuse-only limits (same number ~1/min; generous per IP). */
export function registerCallMe(app: FastifyInstance) {
  app.post(CALL_ME_PATH, { config: { rateLimit: { max: Number(process.env.CALL_ME_IP_MAX || 60), timeWindow: '10 minutes' } } }, async (req, reply) => {
    const r = await handle(req, 'api'); return reply.code(r.status).send(r.body);
  });
  // Internal/admin path (protected by the phone-runtime auth hook on /api/v1/internal/phone/*).
  app.post('/api/v1/internal/phone/call-me', async (req, reply) => {
    const r = await handle(req, 'admin'); return reply.code(r.status).send(r.body);
  });
}
