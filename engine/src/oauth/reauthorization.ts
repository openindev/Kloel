import type { Entity, Store } from '../store.js';
import { accessible, oauthAuthorizationGeneration, oauthAuthorizationIdentity, updateOAuthAuthorization, type Actor } from './access.js';
import { OAuthError, scopesFor, type Capability, type Provider } from './client.js';
import { bookingActions, bookingChoices, configuration as bookingActionConfiguration } from '../public-booking/assistant-authority.js';

/**
 * Grants persisted over one OAuth authorization. Each one is bound to the connection identity (and, when present,
 * generation) at issue time, and is re-validated against capabilities and scopes on every use.
 */
const dependents = [
  { collection: 'booking-grants', family: ['calendar', 'calendar_write'] },
  { collection: 'email-automation-grants', family: ['email', 'email_send'] },
  { collection: 'sheets-assistant-grants', family: ['sheets_read', 'sheets_append'] },
] as const;
const capabilities = (c: Entity) => Array.isArray(c.capabilities) ? c.capabilities.map(String) : [];
const normalized = (scope: string) => scope.replace('https://graph.microsoft.com/', '').toLowerCase();
const identityScopes = ['openid', 'email', 'offline_access', 'user.read'];

/**
 * "Reconectar caixa" re-authorizes ONE connection. Only the person who authorized it can do it (the callback matches
 * connections by owner, so anyone else would create a separate connection); another member's personal connection is not
 * disclosed. Throws before any authorization starts.
 */
export function reauthorizationTarget(store: Store, actor: Actor, provider: Provider, visibility: string, id: string): Entity {
  const c = store.get(actor.tenantId, 'oauth-connections', id);
  if (!c || c.status !== 'connected' || c.provider !== provider || c.visibility !== visibility || !accessible(actor, c)) throw new OAuthError(409, 'oauth_connection_changed', 'A conexão desta conta mudou. Atualize a página e tente novamente.');
  if (c.userId !== actor.userId) throw new OAuthError(403, 'oauth_reauthorization_owner', `Só quem conectou ${String(c.email ?? 'esta conta')} pode reconectá-la. Peça a essa pessoa para reconectar a caixa.`);
  return c;
}

/**
 * Re-authorizing a CONNECTED account keeps every feature the new token still covers, even when the connect dialog left it
 * unticked (ex.: E-Mail IA or Sheets on the account that also serves the Agenda): the provider grant decides, not the
 * checkboxes. Covered = the token still holds everything the previous authorization held (Google include_granted_scopes),
 * or the scopes that feature needs today. A feature the provider no longer grants is dropped (its grants stay revoked);
 * a disconnected connection (explicit revocation) only gets what was asked now.
 */
export function keptCapabilities(provider: Provider, previous: Entity, requested: Capability[], granted: Set<string>): Capability[] {
  if (previous.status !== 'connected') return requested;
  const covers = (scopes: string[]) => scopes.map(normalized).filter(s => !identityScopes.includes(s)).every(s => granted.has(s));
  const prior = String(previous.scopes ?? '').split(/\s+/).filter(Boolean), everything = prior.length > 0 && covers(prior);
  const held = capabilities(previous).filter(c => !requested.includes(c as Capability) && (everything || covers(scopesFor(provider, [c as Capability])))) as Capability[];
  return [...new Set([...requested, ...held])];
}

/** Snapshot an assistant booking action is bound to (see public-booking/assistant-authority `configuration`). */
const actionSnapshot = (store: Store, tenantId: string, action: Entity) => bookingActionConfiguration(store, tenantId, String(action.agentId), String(action.eventTypeId), String(action.audience), action.channelId, String(action.issuerUserId)).snapshot;
/** Assistant booking actions (chat/webchat) over these grants that are valid right now. */
function validAssistantActions(store: Store, tenantId: string, grantIds: Set<string>) {
  return store.list(tenantId, bookingActions).filter(a => grantIds.has(String(a.grantId)) && a.invalidated !== true).filter(a => { try { return actionSnapshot(store, tenantId, a) === a.snapshot; } catch { return false; } });
}

const bound = (connection: Entity) => { const identity = oauthAuthorizationIdentity(connection), generation = oauthAuthorizationGeneration(connection); return (g: Entity) => g.connectionIdentity === identity && (g.connectionGeneration === undefined || g.connectionGeneration === generation); };

/** Same mailbox address (provider addresses are case-insensitive). A missing address only matches a missing address. */
export const sameAddress = (a: unknown, b: unknown) => (typeof a === 'string' ? a.toLowerCase() : '') === (typeof b === 'string' ? b.toLowerCase() : '');
const names = (items: string[]) => items.length > 1 ? `${items.slice(0, -1).join(', ')} e ${items.at(-1)}` : items[0] ?? '';

/**
 * What stops working if this connection takes another address (account renamed at the provider): dependents are bound to
 * the address, so they are not rebound (see rebindOAuthDependents) — every grant valid on the current authorization and
 * every E-Mail IA mailbox of the connection. Empty when nothing depends on it.
 */
function dependentsOf(store: Store, connection: Entity) {
  const tenantId = connection.tenantId, isBound = bound(connection), now = Date.now();
  const live = (collection: string, statuses: string[]) => store.list(tenantId, collection).filter(g => isBound(g) && statuses.includes(String(g.status)) && !(Number(g.expiresAt) <= now));
  const bookings = live('booking-grants', ['active']);
  return {
    pages: bookings.map(g => `“${String(store.get(tenantId, 'booking-pages', String(g.pageId))?.name ?? 'sem nome')}”`),
    assistant: validAssistantActions(store, tenantId, new Set(bookings.map(g => g.id))).length,
    automations: live('email-automation-grants', ['active', 'baselining', 'paused']).map(g => `“${String(store.get(tenantId, 'email-mailboxes', String(g.mailboxId))?.name ?? 'sem nome')}”`),
    sheets: live('sheets-assistant-grants', ['active']).length,
    boxes: store.list(tenantId, 'email-mailboxes').filter(b => b.connectionId === connection.id),
  };
}

export function addressChangeStops(store: Store, connection: Entity): string[] {
  const { pages, assistant, automations, sheets, boxes } = dependentsOf(store, connection);
  return [
    ...pages.map(name => `a página de agendamento publicada ${name}`),
    ...(assistant ? [`o agendamento pelo assistente nessa agenda (${assistant} ${assistant === 1 ? 'ação' : 'ações'})`] : []),
    ...automations.map(name => `a automação de e-mail da caixa ${name}`),
    ...(sheets ? [`${sheets} ${sheets === 1 ? 'ação' : 'ações'} de planilha do assistente`] : []),
    ...boxes.map(b => `a caixa “${String(b.name)}” (${String(b.address)}) do E-Mail IA`),
  ];
}

/**
 * Callback check before writing over an existing CONNECTED connection: the provider returned the same account (remote id)
 * under another primary address. Accepting would silently stop everything bound to the old address, so it is refused and
 * nothing is written; the person decides. Nothing depending on it: the new address is taken.
 * The message does not claim the old authorization works (its token may already be dead); it says nothing changed and gives
 * the recovery steps in the order the product allows: a mailbox must leave E-Mail IA while its connection is still connected
 * (afterwards it stays bound to the old address and blocks a new one), then the account is disconnected and connected again.
 */
export function assertAddressKept(store: Store, existing: Entity, provider: Provider, email: string | undefined): void {
  if (existing.status !== 'connected' || sameAddress(existing.email, email)) return;
  const stops = addressChangeStops(store, existing);
  if (!stops.length) return;
  const { pages, assistant, automations, sheets, boxes } = dependentsOf(store, existing);
  const label = provider === 'google' ? 'Google' : 'Microsoft', before = String(existing.email ?? 'sem endereço');
  const inboxes = names(boxes.map(b => `“${String(b.name)}”`));
  const redo = [
    ...(boxes.length ? [`adicione a caixa de novo no E-Mail IA${automations.length ? ' (e ative a automação)' : ''}`] : automations.length ? ['ative de novo a automação de e-mail'] : []),
    ...(pages.length ? [`publique de novo ${pages.length === 1 ? 'a página' : 'as páginas'} ${names(pages)}`] : []),
    ...(assistant ? ['salve de novo o agendamento do assistente'] : []),
    ...(sheets ? ['salve de novo as ações de planilha do assistente'] : []),
  ];
  const steps = [
    ...(boxes.length ? [`no E-Mail IA, use “Desconectar caixa de entrada” em ${inboxes} (remove a caixa e a automação dela)`] : []),
    `desconecte a conta ${before}${boxes.length ? ', se ela ainda aparecer conectada' : ''}`,
    'conecte a conta de novo',
    `depois ${names(redo)}`,
  ];
  throw new OAuthError(409, 'oauth_reauthorization_address_changed', `O endereço desta conta ${label} mudou de ${before} para ${email ?? '(sem endereço)'}. Nada foi alterado: a conexão continua com ${before}, como estava. Reconectar com o novo endereço pararia ${names(stops)}. Para usar o novo endereço, nesta ordem: ${steps.map((s, i) => `${i + 1}) ${s}`).join('; ')}.`);
}

/**
 * OAuth callback write for an existing connection: new authorization (generation + 1), then its dependents follow it when
 * the same account kept the feature (see rebindOAuthDependents). Assistant booking actions are checked BEFORE the update:
 * only the ones valid over the previous authorization are carried. Call inside the callback transaction.
 */
export function reauthorizeConnection(store: Store, previous: Entity, changes: Record<string, unknown>): Entity {
  const actions = validAssistantActions(store, previous.tenantId, new Set(store.list(previous.tenantId, 'booking-grants').filter(bound(previous)).map(g => g.id)));
  const current = updateOAuthAuthorization(store, previous, changes);
  rebindOAuthDependents(store, previous, current, actions);
  return current;
}

/**
 * Re-authorizing the SAME connected account (same connection, provider, remote id, owner, visibility and address)
 * without dropping a feature does not change who delegated nor what was delegated: it only adds scopes (ex.: "Reconectar
 * caixa" asking gmail.modify / Mail.ReadWrite). Grants issued over the previous authorization are carried to the new
 * generation instead of being revoked in silence, and so are the given assistant booking actions (valid before, on a
 * rebound booking grant) with their open cards — the grant update would otherwise mark them invalid
 * (booking_assistant_invalidate) and their snapshot includes the authorization identity. A feature family that was dropped
 * keeps its grants revoked, and a disconnected connection (explicit revocation) never brings its grants back.
 */
export function rebindOAuthDependents(store: Store, previous: Entity, current: Entity, assistantActions: Entity[] = []): number {
  if (previous.status !== 'connected' || current.status !== 'connected' || previous.id !== current.id || previous.tenantId !== current.tenantId || previous.provider !== current.provider || previous.remoteId !== current.remoteId || previous.userId !== current.userId || previous.visibility !== current.visibility || !sameAddress(previous.email, current.email)) return 0;
  const after = oauthAuthorizationIdentity(current), generation = oauthAuthorizationGeneration(previous), next = oauthAuthorizationGeneration(current);
  if (next <= generation) return 0;
  const tenantId = previous.tenantId, held = capabilities(previous), kept = capabilities(current), wasBound = bound(previous), moved = new Set<string>();
  let rebound = 0;
  for (const { collection, family } of dependents) {
    if (family.some(c => held.includes(c) && !kept.includes(c))) continue;
    for (const grant of store.list(tenantId, collection).filter(wasBound)) {
      store.update(tenantId, collection, grant.id, { connectionIdentity: after, ...(grant.connectionGeneration === undefined ? {} : { connectionGeneration: next }) });
      rebound++; if (collection === 'booking-grants') moved.add(grant.id);
    }
  }
  for (const action of assistantActions.filter(a => moved.has(String(a.grantId)))) {
    let snapshot: string;
    try { snapshot = actionSnapshot(store, tenantId, action); } catch { continue; }
    store.update(tenantId, bookingActions, action.id, { snapshot, invalidated: false });
    for (const choice of store.list(tenantId, bookingChoices).filter(c => c.actionId === action.id && c.snapshot === action.snapshot)) store.update(tenantId, bookingChoices, choice.id, { snapshot });
  }
  return rebound;
}
