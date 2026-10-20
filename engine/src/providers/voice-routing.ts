import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Entity, Store } from '../store.js';
import { digest, seal, unseal } from '../oauth/crypto.js';
import { providerAllowedForTenant, platformProvidersEnabled } from '../platform-providers.js';

const collection = 'voice-routing-tickets';
const routeHeader = 'x-kloel-route';
const tokenFormat = /^[A-Za-z0-9_-]{43}$/;
const headersSchema = z.array(z.object({ name: z.string().max(128), value: z.string().max(2048) })).max(100);
const context = (tenant: string, id: string) => `${tenant}:${id}:voice-route`;
export class VoiceRoutingError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message = 'Roteamento de voz indisponível.') { super(message); }
}
function fail(code: string, status = 403): never { throw new VoiceRoutingError(status, code); }
function organization(store: Store, tenant: string) {
  if (!providerAllowedForTenant(tenant) || store.db.prepare('SELECT status FROM organizations WHERE id=?').get(tenant)?.status !== 'active') fail('voice_organization_unavailable');
}
function resolveNumber(store: Store, tenant: string, number: Entity) {
  organization(store, tenant);
  if (number.provider !== 'twilio' || !Array.isArray(number.capabilities) || !number.capabilities.includes('voice')) fail('voice_number_unavailable');
  const channel = number.channelId ? store.get(tenant, 'channels', String(number.channelId)) : undefined;
  if (number.channelId && (!channel || channel.type !== 'phone' || channel.provider !== 'twilio' || channel.enabled !== true)) fail('voice_channel_unavailable');
  if (number.agentId && channel?.agentId && number.agentId !== channel.agentId) fail('voice_binding_conflict');
  const agentId = String(number.agentId || channel?.agentId || '');
  const agent = store.get(tenant, 'agents', agentId);
  if (!agent || agent.status !== 'active') fail('voice_agent_unavailable');
  const identity = digest(JSON.stringify({
    number: [number.id, number.number, number.provider, number.providerNumberId ?? null, number.agentId ?? null, number.channelId ?? null, number.capabilities],
    channel: channel ? [channel.id, channel.enabled, channel.agentId, channel.provider, channel.type] : null,
    agent, account: process.env.TWILIO_ACCOUNT_SID, sip: process.env.OPENAI_SIP_URI,
  }));
  return { agent, identity };
}

/** Called only after verifying the Twilio signature and the bound AccountSid. */
export function routeSignedTwilioCall(store: Store, tenant: string, params: Record<string, string>, sip: string, now = Date.now()) {
  organization(store, tenant);
  // Unconfigured and outbound routes retain the explicit server-wide default;
  // they do not get number-specific authority from caller-supplied SIP metadata.
  if (params.Direction !== 'inbound') return { sipUri: sip, agentId: null, routingId: null };
  const candidates = store.list(tenant, 'phone-numbers').filter(number => number.number === params.To);
  if (!candidates.length) return { sipUri: sip, agentId: null, routingId: null };
  if (candidates.length !== 1 || !params.CallSid) fail('voice_binding_conflict');
  const number = candidates[0], current = resolveNumber(store, tenant, number);
  return store.transaction(() => {
    const existing = store.list(tenant, collection).find(row => row.twilioCallSid === params.CallSid);
    let row = existing;
    let token: string;
    if (row) {
      if (row.numberId !== number.id || row.routingIdentity !== current.identity || Number(row.expiresAt) <= now) fail('voice_route_expired');
      token = unseal<string>(String(row.encryptedToken), context(tenant, row.id));
      if (!tokenFormat.test(token) || digest(token) !== row.tokenHash) fail('voice_route_invalid');
    } else {
      token = randomBytes(32).toString('base64url');
      row = store.create(tenant, collection, {
        twilioCallSid: params.CallSid, numberId: number.id, agentId: current.agent.id,
        routingIdentity: current.identity, tokenHash: digest(token), expiresAt: now + 10 * 60000,
        status: 'issued',
      });
      row = store.update(tenant, collection, row.id, { encryptedToken: seal(token, context(tenant, row.id)) })!;
    }
    return { sipUri: `${sip}?${routeHeader}=${token}`, agentId: current.agent.id, routingId: row.id };
  });
}

/** OpenAI's signature proves delivery by OpenAI; SIP headers alone are not authority. */
export function resolveIncomingVoiceAgent(store: Store, tenant: string, callId: string, sipHeaders: unknown, now = Date.now()) {
  organization(store, tenant);
  const parsed = headersSchema.safeParse(sipHeaders ?? []);
  if (!parsed.success) fail('voice_headers_invalid', 400);
  const matches = parsed.data.filter(header => header.name.toLowerCase() === routeHeader);
  if (!matches.length) {
    const agentId = process.env.OPENAI_INBOUND_AGENT_ID;
    if (!agentId) fail('voice_default_agent_unconfigured', 503);
    return { agentId, routingId: null };
  }
  if (matches.length !== 1 || !tokenFormat.test(matches[0].value)) fail('voice_route_invalid');
  const tokenHash = digest(matches[0].value);
  return store.transaction(() => {
    const row = store.list(tenant, collection).find(ticket => ticket.tokenHash === tokenHash);
    if (!row || Number(row.expiresAt) <= now && row.openaiCallId !== callId) fail('voice_route_expired');
    if (row.openaiCallId && row.openaiCallId !== callId) fail('voice_route_already_claimed');
    const number = store.get(tenant, 'phone-numbers', String(row.numberId));
    if (!number) fail('voice_number_unavailable');
    const current = resolveNumber(store, tenant, number);
    if (current.identity !== row.routingIdentity || current.agent.id !== row.agentId) fail('voice_binding_changed');
    if (!row.openaiCallId) store.update(tenant, collection, row.id, { openaiCallId: callId, status: 'claimed', claimedAt: now });
    return { agentId: current.agent.id, routingId: row.id };
  });
}

/** Read-only check for a previously claimed server route; safe inside ingress transactions. */
export function authorizeClaimedIncomingVoiceAgent(store: Store, tenant: string, callId: string, route: { agentId: string; routingId: string | null }) {
  organization(store, tenant);
  if (route.routingId === null) {
    if (!process.env.OPENAI_INBOUND_AGENT_ID || process.env.OPENAI_INBOUND_AGENT_ID !== route.agentId) fail('voice_default_agent_changed');
    return route;
  }
  const row = store.get(tenant, collection, route.routingId);
  if (!row || row.status !== 'claimed' || row.openaiCallId !== callId || row.agentId !== route.agentId) fail('voice_route_not_claimed');
  const number = store.get(tenant, 'phone-numbers', String(row.numberId));
  if (!number) fail('voice_number_unavailable');
  const current = resolveNumber(store, tenant, number);
  if (current.identity !== row.routingIdentity || current.agent.id !== route.agentId) fail('voice_binding_changed');
  return { agentId: current.agent.id, routingId: row.id };
}
