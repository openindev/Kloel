/**
 * LiveKit SIP plumbing for numbers that reach the voice worker without Twilio (Fonio parity: "Criar número SIP" shows the
 * LiveKit SIP host as "Originação"). Each routed number gets its own inbound trunk (numbers=[number]) and an individual
 * dispatch rule with the `kloel-tw-` room prefix — the only prefix for which the voice worker asks
 * /internal/phone/number-route who owns the dialed number. Optional outbound termination = one outbound trunk.
 * `sipBackend.current` is swapped by tests; nothing here stores the outbound password (LiveKit keeps it).
 */
import { RoomAgentDispatch, RoomConfiguration, SipClient } from 'livekit-server-sdk';
import { NumberProviderError } from './providers.js';

export const ROUTED_ROOM_PREFIX = 'kloel-tw-';
export type Termination = { address: string; username?: string; password?: string };
export interface SipBackend {
  /** Human-readable (pt-BR) list of what is missing to provision SIP routes; empty = ready. */
  missing(): string[];
  originationHost(): string | null;
  createInbound(input: { number: string; label: string; tenantId: string; allowedAddresses?: string[] }): Promise<{ trunkId: string; dispatchRuleId: string }>;
  createOutbound(input: { number: string; label: string; tenantId: string; termination: Termination }): Promise<{ trunkId: string }>;
  removeTrunk(id: string): Promise<void>;
  removeDispatchRule(id: string): Promise<void>;
}
const fail = (status: number, code: string, message: string): never => { throw new NumberProviderError(status, code, message); };
const host = () => (process.env.LIVEKIT_SIP_INBOUND_URI?.trim() || '').replace(/^sips?:/i, '').replace(/^.*@/, '').replace(/[/;].*$/, '') || null;
const client = () => {
  const { LIVEKIT_URL: url, LIVEKIT_API_KEY: key, LIVEKIT_API_SECRET: secret } = process.env;
  if (!url || !key || !secret) return fail(503, 'sip_not_configured', 'Os números SIP ainda não estão configurados nesta plataforma.');
  return new SipClient(url.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:'), key, secret);
};
/** LiveKit errors become a provider-neutral 502; a duplicate number is a 409 the user can act on. */
const guard = async <T>(fn: () => Promise<T>, what: string): Promise<T> => {
  try { return await fn(); }
  catch (e) {
    if (e instanceof NumberProviderError) throw e;
    const text = String((e as { message?: string })?.message ?? '');
    console.log('livekit_sip_error', what, text.slice(0, 160));
    return /already|exists|conflict|duplicate/i.test(text) ? fail(409, 'sip_number_taken', 'Este número / nome já está em uso em outro tronco SIP.') : fail(502, 'sip_provider_failed', 'O servidor de voz não confirmou a configuração SIP. Tente novamente.');
  }
};
const meta = (tenantId: string, kind: string) => JSON.stringify({ kloel: kind, tenantId });

export const livekitSip: SipBackend = {
  missing() {
    const m: string[] = [];
    if (!process.env.LIVEKIT_URL || !process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET) m.push('credenciais do servidor de voz LiveKit (LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET)');
    if (!host()) m.push('endereço SIP de entrada do LiveKit (LIVEKIT_SIP_INBOUND_URI)');
    return m;
  },
  originationHost: host,
  async createInbound({ number, label, tenantId, allowedAddresses }) {
    const sip = client();
    const trunk = await guard(() => sip.createSipInboundTrunk(`kloel ${tenantId.slice(0, 8)} ${label}`.slice(0, 120), [number], { metadata: meta(tenantId, 'inbound'), ...(allowedAddresses?.length ? { allowedAddresses } : {}) }), 'inbound_trunk');
    try {
      const rule = await guard(() => sip.createSipDispatchRule({ type: 'individual', roomPrefix: ROUTED_ROOM_PREFIX }, {
        name: `kloel ${tenantId.slice(0, 8)} ${label}`.slice(0, 120), trunkIds: [trunk.sipTrunkId], hidePhoneNumber: false, metadata: meta(tenantId, 'dispatch'),
        roomConfig: new RoomConfiguration({ emptyTimeout: 60, departureTimeout: 20, maxParticipants: 2, agents: [new RoomAgentDispatch({ agentName: process.env.LIVEKIT_AGENT_NAME || 'kloel-phone-pilot' })] }),
      }), 'dispatch_rule');
      return { trunkId: trunk.sipTrunkId, dispatchRuleId: rule.sipDispatchRuleId };
    } catch (e) { await sip.deleteSipTrunk(trunk.sipTrunkId).catch(() => undefined); throw e; }
  },
  async createOutbound({ number, label, tenantId, termination }) {
    const sip = client();
    // transport 0 = SIP_TRANSPORT_AUTO
    const trunk = await guard(() => sip.createSipOutboundTrunk(`kloel ${tenantId.slice(0, 8)} ${label} saída`.slice(0, 120), termination.address, [number], {
      transport: 0 as never, metadata: meta(tenantId, 'outbound'), ...(termination.username ? { authUsername: termination.username } : {}), ...(termination.password ? { authPassword: termination.password } : {}) }), 'outbound_trunk');
    return { trunkId: trunk.sipTrunkId };
  },
  async removeTrunk(id) { await guard(async () => { try { await client().deleteSipTrunk(id); } catch (e) { if (!/not.?found|404/i.test(String((e as Error)?.message))) throw e; } }, 'delete_trunk'); },
  async removeDispatchRule(id) { await guard(async () => { try { await client().deleteSipDispatchRule(id); } catch (e) { if (!/not.?found|404/i.test(String((e as Error)?.message))) throw e; } }, 'delete_dispatch'); },
};
export const sipBackend: { current: SipBackend } = { current: livekitSip };
