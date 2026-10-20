import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Store, Entity } from '../store.js';
import { digest } from '../oauth/crypto.js';
import { oauthAuthorizationIdentity } from '../oauth/access.js';
import { resolveMembershipActor } from '../memberships/service.js';
import { parseExpectedRequestContext, resolveSessionContext, sameRequestContext } from '../request-context.js';
import { allowedChatOrigin, chatMode, chatGeneration } from '../conversation-replies-shared.js';
import { captureBookingOperator } from './operator-reschedule.js';
import { authorizeBookingCalendar, BookingError, type BookingAuthority } from './authority.js';
import { eventTypeConfigFromRecord } from '../scheduling/service.js';

export const bookingActions = 'booking-assistant-actions', bookingActionReceipts = 'booking-assistant-action-operations';
export const bookingChoices = 'booking-assistant-choices', bookingOperations = 'booking-assistant-operations';
export const uuid = z.string().uuid(), revision = z.number().int().positive().safe();
export const hash = (v: unknown) => digest(JSON.stringify(v));
export const fail = (status: number, code: string): never => { throw new BookingError(status, code, 'O agendamento mudou ou está indisponível. Consulte a referência original antes de outra tentativa.'); };
export type Operator = ReturnType<typeof captureBookingOperator>;
export const ownerScope = (a: Operator) => ({ userId: a.actor.userId, sessionHash: a.sessionHash, membershipId: a.context.membershipId, authorityVersion: a.context.authorityVersion });
export type Audience = { kind: 'private'; tenantId: string; operator: Operator } | { kind: 'webchat'; tenantId: string; sessionId: string; channelId: string; conversationId: string; origin: string; tokenHash: string };
export const scope = (a: Audience) => a.kind === 'private' ? { kind: 'private', ...ownerScope(a.operator) } : { kind: 'webchat', sessionId: a.sessionId, channelId: a.channelId, origin: a.origin, tokenHash: a.tokenHash };
export function privateAudience(store: Store, request: FastifyRequest): Audience {
  if (!parseExpectedRequestContext(request)) fail(400, 'expected_context_required');
  if (request.headers.authorization) fail(401, 'authentication_required');
  return { kind: 'private', tenantId: request.actor.tenantId, operator: captureBookingOperator(store, request) };
}
export function assertAudience(store: Store, a: Audience, now: number, active = false) {
  if (a.kind === 'private') {
    a.operator.assertLive(); const live = resolveSessionContext(store, a.operator.sessionHash);
    if (!live?.actor || live.actor.role !== 'owner' || !sameRequestContext(live.context, a.operator.context)) fail(403, 'booking_authority_changed');
    return;
  }
  const s = store.get(a.tenantId, 'public-chat-sessions', a.sessionId);
  if (!s || s.tokenHash !== a.tokenHash || s.origin !== a.origin || s.channelId !== a.channelId || s.conversationId !== a.conversationId || !['active', ...(active ? [] : ['ended'])].includes(String(s.status)) || Number(s.expiresAt) <= now) fail(401, 'booking_session_expired');
}
export function publicAudience(store: Store, request: FastifyRequest, now: number): Audience {
  const q = z.object({ tenantId: z.string().min(1).max(128), channelId: uuid, operationKey: uuid.optional() }).strict().parse(request.query);
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.authorization ?? '');
  if (!match || typeof request.headers.origin !== 'string') return fail(401, 'booking_session_expired');
  const s = store.list(q.tenantId, 'public-chat-sessions').find(s => s.tokenHash === digest(match[1]));
  if (!s) return fail(401, 'booking_session_expired');
  const a: Audience = { kind: 'webchat', tenantId: q.tenantId, channelId: q.channelId, sessionId: s.id, conversationId: String(s.conversationId), origin: request.headers.origin, tokenHash: digest(match[1]) };
  assertAudience(store, a, now); return a;
}
function issuer(store: Store, tenantId: string, userId: string) {
  const actor = resolveMembershipActor(store, userId, tenantId), m = store.db.prepare('SELECT id,revision FROM memberships WHERE tenant_id=? AND user_id=?').get(tenantId, userId);
  if (actor?.role !== 'owner' || !m) return fail(403, 'booking_owner_required');
  return { id: String(m.id), revision: Number(m.revision) };
}
export function configuration(store: Store, tenantId: string, agentId: string, eventTypeId: string, audience: string, channelId: unknown, userId: string) {
  const agent = store.get(tenantId, 'agents', agentId), page = store.get(tenantId, 'booking-pages', eventTypeId);
  if (!agent || agent.status !== 'active' || !page || !Array.isArray(page.agentIds) || !page.agentIds.includes(agentId)) return fail(409, 'booking_configuration_unavailable');
  const authority: BookingAuthority = { kind: 'grant', tenantId, grantId: String(page.grantId), purpose: 'availability' };
  const target = authorizeBookingCalendar(store, authority), member = issuer(store, tenantId, userId);
  if (target.connection.provider !== 'google' || target.connection.userId !== userId || target.grant!.publisherUserId !== userId) return fail(403, 'booking_owner_required');
  const channel = audience === 'webchat' ? store.get(tenantId, 'channels', String(channelId)) : undefined;
  if (audience === 'webchat' && (!channel || channel.agentId !== agentId || channel.enabled !== true || channel.type !== 'webchat' || channel.provider !== 'openai')) return fail(409, 'booking_channel_unavailable');
  return { ...target, agent, channel, member, snapshot: hash([agent, page, target.grant, target.calendar, oauthAuthorizationIdentity(target.connection), channel ?? null, member]) };
}
export function resolveAction(store: Store, a: Audience, actionId: string, conversationId: string | undefined, now: number, expectedRevision?: number) {
  assertAudience(store, a, now, true);
  const action = store.get(a.tenantId, bookingActions, actionId);
  if (!action || action.enabled !== true || action.invalidated === true || Number(action.expiresAt) <= now || action.audience !== a.kind || a.kind === 'webchat' && action.channelId !== a.channelId || expectedRevision !== undefined && action.revision !== expectedRevision) return fail(409, 'booking_action_unavailable');
  if (a.kind === 'private' && action.issuerUserId !== a.operator.actor.userId) fail(403, 'booking_owner_required');
  const target = configuration(store, a.tenantId, String(action.agentId), String(action.eventTypeId), String(action.audience), action.channelId, String(action.issuerUserId));
  if (target.snapshot !== action.snapshot) return fail(409, 'booking_action_reauthorization_required');
  let conversation: Entity | undefined;
  if (conversationId) {
    conversation = store.get(a.tenantId, 'conversations', conversationId);
    if (!conversation || conversation.agentId !== action.agentId || conversation.channel !== 'webchat' || chatMode(conversation) !== 'ai' || a.kind === 'webchat' && (a.conversationId !== conversation.id || conversation.channelId !== a.channelId || !allowedChatOrigin(target.channel!, a.origin))) return fail(403, 'booking_conversation_unavailable');
    if (a.kind === 'private' && !store.list(a.tenantId, 'provider-operations').some(r => r.operation === 'openai.chat' && r.chatConversationId === conversationId && hash(r.bookingAuthority) === hash(ownerScope(a.operator)))) return fail(404, 'booking_conversation_unavailable');
  }
  const generation = conversation ? chatGeneration(conversation) : null, actionHash = hash(action);
  const check = () => {
    assertAudience(store, a, Date.now(), true);
    const current = store.get(a.tenantId, bookingActions, action.id);
    if (!current || hash(current) !== actionHash || Number(current.expiresAt) <= Date.now()) fail(409, 'booking_action_changed');
    const fresh = configuration(store, a.tenantId, String(action.agentId), String(action.eventTypeId), String(action.audience), action.channelId, String(action.issuerUserId));
    if (fresh.snapshot !== action.snapshot) fail(409, 'booking_action_reauthorization_required');
    if (conversation) { const c = store.get(a.tenantId, 'conversations', conversation.id); if (!c || c.agentId !== action.agentId || chatGeneration(c) !== generation || chatMode(c) !== 'ai' || a.kind === 'webchat' && (c.channelId !== a.channelId || !allowedChatOrigin(fresh.channel!, a.origin))) fail(409, 'booking_conversation_changed'); }
  };
  const authority: BookingAuthority = { kind: 'grant', tenantId: a.tenantId, grantId: target.grant!.id, purpose: 'create', assertAccess: check };
  return { action, ...target, conversation, authority, check };
}
export function projectAction(store: Store, action: Entity, a: Audience, now: number) {
  let available = false, unavailableReason: string | null = null;
  try {
    assertAudience(store,a,now);
    if(a.kind!=='private'||action.issuerUserId!==a.operator.actor.userId)fail(403,'booking_owner_required');
    if(action.enabled!==true||action.invalidated===true||Number(action.expiresAt)<=now)fail(409,'booking_action_unavailable');
    const target=configuration(store,a.tenantId,String(action.agentId),String(action.eventTypeId),String(action.audience),action.channelId,String(action.issuerUserId));
    if(target.snapshot!==action.snapshot)fail(409,'booking_action_reauthorization_required');
    available=true;
  } catch (e) { unavailableReason = e instanceof BookingError ? e.code : 'booking_configuration_unavailable'; }
  return { id: action.id, agentId: String(action.agentId), eventTypeId: String(action.eventTypeId), audience: action.audience, channelId: action.channelId ?? null, revision: Number(action.revision), enabled: action.enabled === true, allowCreate: action.allowCreate === true, expiresAt: new Date(Number(action.expiresAt)).toISOString(), maxBookingsPerDay: Number(action.maxBookingsPerDay), available, unavailableReason };
}
export function initializeAssistantBooking(store: Store) {
  store.db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS booking_assistant_action_key ON entities(tenant_id,json_extract(body,'$.key')) WHERE collection='booking-assistant-action-operations';
    CREATE UNIQUE INDEX IF NOT EXISTS booking_assistant_operation_key ON entities(tenant_id,json_extract(body,'$.key')) WHERE collection='booking-assistant-operations';
    CREATE TRIGGER IF NOT EXISTS booking_assistant_invalidate AFTER UPDATE OF body ON entities WHEN NEW.collection IN ('agents','channels','booking-pages','booking-grants','calendars') BEGIN
      UPDATE entities SET body=json_set(body,'$.invalidated',json('true')) WHERE tenant_id=NEW.tenant_id AND collection='booking-assistant-actions' AND
      ((NEW.collection='agents' AND json_extract(body,'$.agentId')=NEW.id) OR (NEW.collection='channels' AND json_extract(body,'$.channelId')=NEW.id) OR (NEW.collection='booking-pages' AND json_extract(body,'$.eventTypeId')=NEW.id) OR (NEW.collection='booking-grants' AND json_extract(body,'$.grantId')=NEW.id) OR (NEW.collection='calendars' AND json_extract(body,'$.calendarId')=NEW.id));
    END;
    CREATE TRIGGER IF NOT EXISTS booking_assistant_org_suspend AFTER UPDATE OF status ON organizations WHEN NEW.status!='active' BEGIN
      UPDATE entities SET body=json_set(body,'$.invalidated',json('true')) WHERE tenant_id=NEW.id AND collection='booking-assistant-actions';
    END;
  `);
}
export function actionOptions(store: Store, a: Audience, agentId: string) {
  if (a.kind !== 'private') return fail(403, 'booking_owner_required');
  const eventTypes = store.list(a.tenantId, 'booking-pages').flatMap(page => { try { const t = configuration(store, a.tenantId, agentId, page.id, 'private', null, a.operator.actor.userId), c = eventTypeConfigFromRecord(t.page!); return [{ id: page.id, name: c.name, timezone: c.timezone, durationMinutes: c.durationMinutes, revision: page.revision }]; } catch { return []; } });
  return { eventTypes, channels: store.list(a.tenantId, 'channels').filter(c => c.agentId === agentId && c.type === 'webchat' && c.provider === 'openai' && c.enabled === true).map(c => ({ id: c.id, name: String(c.name ?? 'Webchat') })) };
}
