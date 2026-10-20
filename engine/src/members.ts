import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Entity, Store } from './store.js';
import { DomainError } from './domains.js';
import { hashPassword, sessionDigest as digest, setSessionCookie, validPassword } from './auth.js';
import { canManageRole, capabilitiesFor, hasPermission, roleSchema as roles } from './memberships/permissions.js';
import { changeOrganizationRole, membership, MembershipError, removeOrganizationMember, resolveMembershipActor, resolveSessionActor, resolveSessionIdentity, revokeOrganizationSessions, type MembershipActor as Actor } from './memberships/service.js';
import { seal, unseal } from './oauth/crypto.js';
import { assertRequestContext, resolveSessionContext } from './request-context.js';

const emailSchema = z.string().trim().toLowerCase().email().max(254);
const keySchema = z.string().regex(/^[A-Za-z0-9_-]{8,128}$/);
const versionSchema = z.string().regex(/^[a-f0-9]{64}$/);
const expirySchema = z.number().int().min(1).max(168).default(48);
const invitationSchema = z.object({ email: emailSchema, role: roles.default('member'), expiresInHours: expirySchema, idempotencyKey: keySchema, expectedTenantId: z.string().min(1).max(128) }).strict();
const collection = 'team-invitations', operations = 'team-operations', acceptOperations = 'team-accept-operations';
const pageSchema = z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) }).strict();

/** Team administration always requires the exact current human cookie, including standalone registration. */
function currentActor(store: Store, request: FastifyRequest, manage = false): Actor {
  assertRequestContext(store, request);
  const token = request.cookies.kloel_session;
  const actor = token && !request.apiKey && request.headers.authorization === undefined ? resolveSessionActor(store, digest(token)) : undefined;
  if (!actor || !request.actor || actor.userId !== request.actor.userId || actor.tenantId !== request.actor.tenantId) throw new DomainError(401, 'unauthorized', 'Sessão atual necessária.');
  if (!hasPermission(actor.role, manage ? 'team:manage' : 'team:read')) throw new DomainError(403, 'forbidden', 'Seu papel não permite esta operação na equipe.');
  return actor;
}
function idFrom(request: FastifyRequest) { return z.object({ id: z.string().min(1).max(128) }).strict().parse(request.params).id; }
function operationKey(request: FastifyRequest) { return z.object({ key: keySchema }).strict().parse(request.params).key; }
function memberView(store: Store, actor: Actor, userId: string) {
  const row = membership(store, actor.tenantId, userId);
  const user = store.db.prepare('SELECT email FROM users WHERE id=?').get(userId)!;
  return { id: userId, membershipId: row.id, email: String(user.email), role: row.role, joinedAt: row.joinedAt, isCurrentUser: actor.userId === userId, revision: row.revision, version: row.version };
}
function invitationVersion(item: Entity): string {
  return digest(JSON.stringify([item.id, item.tenantId, item.revision ?? 0, item.status, item.email, item.role, item.tokenHash, item.expiresAt, item.invitedBy, item.issuerMembershipId, item.issuerVersion, item.acceptedAt, item.acceptedUserId]));
}
// Último envio do convite (gravado à parte, para não mudar a versão do convite).
let deliveryStore: Store | undefined;
function lastSentAt(item: Entity) { const rows = deliveryStore?.list(String(item.tenantId), 'invitation-deliveries').filter(r => r.invitationId === item.id) ?? []; return rows.map(r => String(r.sentAt)).sort().pop() ?? null; }
function invitationView(item: Entity) {
  return { id: item.id, tenantId: item.tenantId, email: item.email, role: item.role,
    status: item.status === 'pending' && Date.parse(String(item.expiresAt)) <= Date.now() ? 'expired' : item.status,
    expiresAt: item.expiresAt, deliveryStatus: 'not_sent' as const, lastSentAt: lastSentAt(item), invitedBy: item.invitedBy,
    acceptedAt: item.acceptedAt ?? null, createdAt: item.createdAt, updatedAt: item.updatedAt,
    revision: Number(item.revision || 0), version: invitationVersion(item) };
}
function invitationLink(rawToken: string) { return `/accept-invite#token=${encodeURIComponent(rawToken)}`; }
function getInvitation(store: Store, tenantId: string, id: string) {
  const item = store.get(tenantId, collection, id);
  if (!item) throw new DomainError(404, 'not_found', 'Convite não encontrado.');
  return item;
}
function requireRoleManagement(actor: Actor, role: unknown) {
  if (!canManageRole(actor.role, roles.parse(role))) throw new DomainError(403, 'forbidden', 'Apenas proprietários gerenciam proprietários ou administradores.');
}
function checkInvitationVersion(item: Entity, expected: string) {
  if (invitationVersion(item) !== expected) throw new DomainError(409, 'version_conflict', 'O convite mudou; consulte a lista atual.');
}
function issuerValid(store: Store, item: Entity): boolean {
  const actor = resolveMembershipActor(store, String(item.invitedBy), item.tenantId);
  if (!actor || !canManageRole(actor.role, roles.parse(item.role))) return false;
  const current = membership(store, item.tenantId, actor.userId);
  // Legacy links have no historical membership identity and must be rotated explicitly.
  return current.id === item.issuerMembershipId && current.version === item.issuerVersion;
}
function findOperation(store: Store, tenantId: string, key: string) {
  return store.list(tenantId, operations).find(item => item.keyHash === digest(key));
}
function ownOperation(store: Store, actor: Actor, key: string) {
  const operation = findOperation(store, actor.tenantId, key), current = membership(store, actor.tenantId, actor.userId);
  if (!operation || operation.operatorUserId !== actor.userId || operation.operatorMembershipId !== current.id || operation.operatorVersion !== current.version) throw new DomainError(404, 'operation_not_found', 'Operação indisponível para esta sessão.');
  return operation;
}
function cipherContext(tenantId: string, userId: string, membershipId: string, key: string) { return JSON.stringify(['team-invitation-link', tenantId, userId, membershipId, digest(key)]); }
function linkRecoverable(store: Store, actor: Actor, operation: Entity, invitation: Entity) {
  return actor.role === 'owner' && typeof operation.encryptedToken === 'string' && invitation.status === 'pending' && Date.parse(String(invitation.expiresAt)) > Date.now() && invitationVersion(invitation) === operation.invitationVersion && issuerValid(store, invitation);
}
function operationView(store: Store, actor: Actor, operation: Entity) {
  const invitation = getInvitation(store, actor.tenantId, String(operation.invitationId));
  return { status: 'succeeded' as const, kind: operation.kind, invitation: invitationView(invitation), linkRecoverable: linkRecoverable(store, actor, operation, invitation) };
}
function recoverLink(store: Store, request: FastifyRequest, key: string) {
  const actor = currentActor(store, request, true), operation = ownOperation(store, actor, key);
  const invitation = getInvitation(store, actor.tenantId, String(operation.invitationId));
  if (!linkRecoverable(store, actor, operation, invitation)) throw new DomainError(409, 'link_unavailable', 'Este link não está mais disponível; consulte o estado do convite.');
  let token: string;
  try { token = z.string().regex(/^[a-f0-9]{64}$/).parse(unseal<{ token: string }>(String(operation.encryptedToken), cipherContext(actor.tenantId, actor.userId, String(operation.operatorMembershipId), key)).token); }
  catch { throw new DomainError(503, 'invitation_recovery_unavailable', 'O convite já foi registrado, mas a chave local não permite recuperar seu link.'); }
  currentActor(store, request, true);
  ownOperation(store, actor, key);
  if (digest(token) !== invitation.tokenHash) throw new DomainError(409, 'link_unavailable', 'O link mudou.');
  return { ...invitationView(invitation), localAcceptancePath: invitationLink(token) };
}
function recordOperation(store: Store, actor: Actor, key: string, fingerprint: string, kind: string, invitation: Entity, token: string) {
  const current = membership(store, actor.tenantId, actor.userId);
  let encryptedToken: string | null = null;
  if (actor.role === 'owner') {
    try { encryptedToken = seal({ token }, cipherContext(actor.tenantId, actor.userId, current.id, key)); }
    catch { throw new DomainError(503, 'invitation_key_unavailable', 'Configure a chave local de cifragem para recuperar convites com segurança.'); }
  }
  return store.create(actor.tenantId, operations, { keyHash: digest(key), fingerprint, kind, operatorUserId: actor.userId, operatorMembershipId: current.id, operatorVersion: current.version, invitationId: invitation.id, invitationVersion: invitationVersion(invitation), encryptedToken });
}
function replayOperation(store: Store, request: FastifyRequest, actor: Actor, key: string, fingerprint: string) {
  if (!findOperation(store, actor.tenantId, key)) return;
  const operation = ownOperation(store, actor, key);
  if (operation.fingerprint !== fingerprint) throw new DomainError(409, 'idempotency_conflict', 'Esta chave já identifica outra operação.');
  const view = operationView(store, actor, operation);
  return view.linkRecoverable ? recoverLink(store, request, key) : { ...view.invitation, actionRequired: 'link_unavailable' };
}
function wrap(fn: (request: FastifyRequest, reply: FastifyReply) => unknown) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    reply.header('Cache-Control', 'no-store');
    try { return await fn(request, reply); }
    catch (error) {
      if (error instanceof DomainError || error instanceof MembershipError) return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
      if (error instanceof z.ZodError) return reply.code(400).send({ error: { code: 'validation_error', message: 'Requisição de equipe inválida.' } });
      throw error;
    }
  };
}

export async function registerMembers(app: FastifyInstance, store: Store): Promise<void> {
  deliveryStore = store;
  app.get('/api/v1/members', wrap(request => {
    const actor = currentActor(store, request), query = pageSchema.parse(request.query);
    const rows = store.db.prepare('SELECT u.id FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=? ORDER BY u.email').all(actor.tenantId);
    return { items: rows.slice((query.page - 1) * query.limit, query.page * query.limit).map(row => memberView(store, actor, String(row.id))), ...query, total: rows.length, totalPages: Math.ceil(rows.length / query.limit) };
  }));
  app.get('/api/v1/members/roles', wrap(request => {
    const actor = currentActor(store, request);
    return { items: roles.options.map(role => ({ role, permissions: capabilitiesFor(role), canAssign: canManageRole(actor.role, role, role) })), ownerCount: Number(store.db.prepare("SELECT COUNT(*) AS n FROM memberships WHERE tenant_id=? AND role='owner'").get(actor.tenantId)?.n) };
  }));
  app.patch('/api/v1/members/:id', wrap(request => {
    const actor = currentActor(store, request, true), id = idFrom(request);
    const { role, expectedVersion } = z.object({ role: roles, expectedVersion: versionSchema }).strict().parse(request.body);
    const previous = membership(store, actor.tenantId, id);
    const updated = changeOrganizationRole(store, actor, id, role, expectedVersion, () => { currentActor(store, request, true); });
    return { ...memberView(store, actor, id), sessionsRevoked: previous.role !== updated.role };
  }));
  app.delete('/api/v1/members/:id', wrap((request, reply) => {
    const actor = currentActor(store, request, true), { expectedVersion } = z.object({ expectedVersion: versionSchema }).strict().parse(request.body);
    removeOrganizationMember(store, actor, idFrom(request), expectedVersion, () => { currentActor(store, request, true); });
    return reply.code(204).send();
  }));
  app.post('/api/v1/members/:id/revoke-sessions', wrap(request => {
    const actor = currentActor(store, request, true), id = idFrom(request);
    const { expectedVersion } = z.object({ expectedVersion: versionSchema }).strict().parse(request.body);
    const revokedSessions = revokeOrganizationSessions(store, actor, id, expectedVersion, () => { currentActor(store, request, true); });
    return { userId: id, revokedSessions, member: memberView(store, actor, id) };
  }));
  app.get('/api/v1/invitations', wrap(request => {
    const actor = currentActor(store, request, true), query = pageSchema.parse(request.query);
    const rows = store.list(actor.tenantId, collection);
    return { items: rows.slice((query.page - 1) * query.limit, query.page * query.limit).map(invitationView), ...query, total: rows.length, totalPages: Math.ceil(rows.length / query.limit) };
  }));
  app.post('/api/v1/invitations', wrap((request, reply) => {
    currentActor(store, request, true);
    const input = invitationSchema.parse(request.body);
    return store.transaction(() => {
      const actor = currentActor(store, request, true);
      if (input.expectedTenantId !== actor.tenantId) throw new DomainError(409, 'tenant_mismatch', 'A organização da sessão mudou; nenhuma criação foi realizada.');
      requireRoleManagement(actor, input.role);
      // Tenant binding is an authorization guard, not a change to legacy effect fingerprints.
      const { expectedTenantId: _expectedTenantId, ...effectInput } = input;
      const fingerprint = digest(JSON.stringify(['invitation.create', effectInput]));
      const replay = replayOperation(store, request, actor, input.idempotencyKey, fingerprint);
      if (replay) return replay;
      const alreadyMember = store.db.prepare('SELECT m.id FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=? AND lower(u.email)=?').get(actor.tenantId, input.email);
      if (alreadyMember) throw new DomainError(409, 'already_member', 'Esta identidade já pertence à organização.');
      if (store.list(actor.tenantId, collection).some(item => item.email === input.email && item.status === 'pending' && Date.parse(String(item.expiresAt)) > Date.now())) throw new DomainError(409, 'invitation_pending', 'Já existe convite ativo para este e-mail.');
      const issuer = membership(store, actor.tenantId, actor.userId), token = randomBytes(32).toString('hex');
      const invitation = store.create(actor.tenantId, collection, { email: input.email, role: input.role, invitedBy: actor.userId, issuerMembershipId: issuer.id, issuerVersion: issuer.version, revision: 1, status: 'pending', tokenHash: digest(token), expiresAt: new Date(Date.now() + input.expiresInHours * 3600000).toISOString(), deliveryStatus: 'not_sent', acceptedAt: null });
      recordOperation(store, actor, input.idempotencyKey, fingerprint, 'invitation.create', invitation, token);
      reply.code(201);
      return { ...invitationView(invitation), ...(actor.role === 'owner' ? { localAcceptancePath: invitationLink(token) } : { actionRequired: 'owner_must_generate_local_link' }) };
    });
  }));
  app.post('/api/v1/invitations/:id/link', wrap(request => {
    const actor = currentActor(store, request, true), id = idFrom(request);
    if (actor.role !== 'owner') throw new DomainError(403, 'forbidden', 'Apenas proprietários podem gerar links locais.');
    const input = z.object({ expiresInHours: expirySchema, expectedVersion: versionSchema, idempotencyKey: keySchema }).strict().parse(request.body);
    return store.transaction(() => {
      const actor = currentActor(store, request, true);
      if (actor.role !== 'owner') throw new DomainError(403, 'forbidden', 'Apenas proprietários podem gerar links locais.');
      const fingerprint = digest(JSON.stringify(['invitation.rotate', id, input]));
      const replay = replayOperation(store, request, actor, input.idempotencyKey, fingerprint);
      if (replay) return replay;
      const old = getInvitation(store, actor.tenantId, id);
      checkInvitationVersion(old, input.expectedVersion);
      if (old.status !== 'pending') throw new DomainError(409, 'invitation_closed', 'Convite já encerrado.');
      const token = randomBytes(32).toString('hex'), issuer = membership(store, actor.tenantId, actor.userId);
      const invitation = store.update(actor.tenantId, collection, id, { tokenHash: digest(token), invitedBy: actor.userId, issuerMembershipId: issuer.id, issuerVersion: issuer.version, revision: Number(old.revision || 0) + 1, expiresAt: new Date(Date.now() + input.expiresInHours * 3600000).toISOString(), deliveryStatus: 'not_sent' })!;
      recordOperation(store, actor, input.idempotencyKey, fingerprint, 'invitation.rotate', invitation, token);
      return { ...invitationView(invitation), localAcceptancePath: invitationLink(token) };
    });
  }));
  // Envio do convite por e-mail (Resend da plataforma). Só para o e-mail do próprio convite e só com o link válido
  // (o token do link precisa bater com o tokenHash atual), então não serve como envio genérico de e-mail.
  app.post('/api/v1/invitations/:id/email', wrap(async request => {
    const actor = currentActor(store, request, true), id = idFrom(request);
    const input = z.object({ acceptUrl: z.string().url().max(2000), firstName: z.string().max(120).optional(), lastName: z.string().max(120).optional(), idempotencyKey: keySchema }).strict().parse(request.body);
    const invitation = getInvitation(store, actor.tenantId, id);
    if (invitation.status !== 'pending' || Date.parse(String(invitation.expiresAt)) <= Date.now()) throw new DomainError(409, 'invitation_closed', 'Convite já encerrado ou expirado.');
    const url = new URL(input.acceptUrl);
    const allowed = new Set([process.env.APP_ORIGIN, 'https://www.kloel.ai', typeof request.headers.origin === 'string' ? request.headers.origin : undefined].filter(Boolean));
    const token = new URLSearchParams(url.hash.replace(/^#/, '')).get('token') ?? '';
    if (url.protocol !== 'https:' && url.hostname !== '127.0.0.1' && url.hostname !== 'localhost' || !allowed.has(url.origin) || url.pathname !== '/accept-invite' || !token || digest(token) !== invitation.tokenHash) throw new DomainError(400, 'invalid_link', 'Link de convite inválido.');
    if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM) throw new DomainError(503, 'email_not_configured', 'O envio de e-mails não está configurado.');
    const hello = [input.firstName, input.lastName].filter(Boolean).join(' ').trim() || 'Olá';
    const text = `${hello}, você recebeu um convite para entrar na Kloel AI.\n\nAceite seu convite: ${url.href}\n\nO convite expira em ${new Date(String(invitation.expiresAt)).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.`;
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': `team-invite-${invitation.id}-${input.idempotencyKey}` },
      body: JSON.stringify({ from: process.env.RESEND_FROM, to: [String(invitation.email)], subject: 'Convite para a Kloel AI', text }), redirect: 'error', signal: AbortSignal.timeout(15000),
    }).catch(() => undefined);
    const data = response?.ok ? await response.json().catch(() => ({})) as { id?: unknown } : undefined;
    if (!data || typeof data.id !== 'string') { await response?.body?.cancel().catch(() => undefined); throw new DomainError(502, 'email_failed', 'Não foi possível enviar o e-mail do convite.'); }
    store.create(actor.tenantId, 'invitation-deliveries', { invitationId: invitation.id, sentAt: new Date().toISOString(), messageId: data.id });
    return { status: 'accepted', messageId: data.id };
  }));
  app.delete('/api/v1/invitations/:id', wrap((request, reply) => {
    currentActor(store, request, true);
    const id = idFrom(request), { expectedVersion } = z.object({ expectedVersion: versionSchema }).strict().parse(request.body);
    store.transaction(() => {
      const actor = currentActor(store, request, true);
      const invitation = getInvitation(store, actor.tenantId, id);
      requireRoleManagement(actor, invitation.role); checkInvitationVersion(invitation, expectedVersion);
      if (invitation.status === 'accepted') throw new DomainError(409, 'invitation_closed', 'Convite já aceito.');
      store.update(actor.tenantId, collection, id, { status: 'revoked', tokenHash: null, revokedBy: actor.userId, revision: Number(invitation.revision || 0) + 1 });
    });
    return reply.code(204).send();
  }));
  app.get('/api/v1/team/operations/:key', wrap(request => {
    return store.transaction(() => {
      const actor = currentActor(store, request, true), operation = ownOperation(store, actor, operationKey(request));
      return operationView(store, actor, operation);
    });
  }));
  app.post('/api/v1/team/operations/:key/recover-link', wrap(request => {
    z.object({}).strict().parse(request.body ?? {});
    return store.transaction(() => recoverLink(store, request, operationKey(request)));
  }));
  app.post('/api/v1/auth/accept-invite', wrap((request, reply) => {
    const common = { email: emailSchema, password: z.string().min(12).max(128).optional(), idempotencyKey: keySchema };
    const input = z.discriminatedUnion('action', [
      z.object({ ...common, action: z.literal('accept'), token: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
      z.object({ ...common, action: z.literal('recover') }).strict(),
    ]).parse({ action: 'accept', ...(request.body as object) });
    const keyHash = digest(JSON.stringify([input.email, input.idempotencyKey]));
    const sessionToken = randomBytes(32).toString('hex'), sessionHash = digest(sessionToken);
    const result = store.transaction(() => {
      const user = store.db.prepare('SELECT id,password FROM users WHERE lower(email)=?').get(input.email);
      const sessionIdentity = request.cookies.kloel_session ? resolveSessionIdentity(store, digest(request.cookies.kloel_session)) : undefined;
      const proveIdentity = () => {
        if (!user || (sessionIdentity?.userId !== user.id && (!input.password || !validPassword(input.password, String(user.password))))) throw new DomainError(401, 'identity_verification_required', 'Entre na conta convidada ou informe sua senha atual.');
      };
      const oldRow = store.db.prepare("SELECT body FROM entities WHERE collection=? AND json_extract(body,'$.keyHash')=?").get(acceptOperations, keyHash);
      if (oldRow) {
        const operation = JSON.parse(String(oldRow.body)) as Entity;
        proveIdentity();
        if (input.action === 'accept' && digest(input.token) !== operation.tokenHash) throw new DomainError(409, 'idempotency_conflict', 'Esta chave já identifica outro aceite.');
        const invitation = getInvitation(store, operation.tenantId, String(operation.invitationId));
        const actor = resolveMembershipActor(store, String(user!.id), operation.tenantId);
        const oldSession = store.db.prepare('SELECT user_id,tenant_id,expires FROM sessions WHERE hash=? AND expires>?').get(String(operation.sessionHash), Date.now());
        if (!actor || operation.userId !== actor.userId || invitation.status !== 'accepted' || invitationVersion(invitation) !== operation.invitationVersion || !issuerValid(store, invitation) || membership(store, actor.tenantId, actor.userId).version !== operation.memberVersion || !oldSession || oldSession.user_id !== actor.userId || oldSession.tenant_id !== actor.tenantId) throw new DomainError(409, 'acceptance_recovery_unavailable', 'O aceite não pode restaurar uma autorização revogada ou expirada; entre normalmente na conta.');
        store.db.prepare('DELETE FROM sessions WHERE hash=?').run(String(operation.sessionHash));
        store.db.prepare('INSERT INTO sessions(hash,user_id,expires,tenant_id) VALUES(?,?,?,?)').run(sessionHash, actor.userId, Number(oldSession.expires), actor.tenantId);
        if (request.cookies.kloel_session) store.db.prepare('DELETE FROM sessions WHERE hash=?').run(digest(request.cookies.kloel_session));
        store.update(actor.tenantId, acceptOperations, operation.id, { sessionHash });
        const context = resolveSessionContext(store, sessionHash)?.context;
        if (!context || context.userId !== actor.userId || context.tenantId !== actor.tenantId || context.membershipId !== membership(store, actor.tenantId, actor.userId).id) throw new DomainError(409, 'context_changed_in_flight', 'A autorização mudou durante o aceite. Consulte o resultado antes de tentar novamente.');
        return { userId: actor.userId, tenantId: actor.tenantId, role: actor.role, membershipId: context.membershipId, replayed: true, context };
      }
      if (input.action === 'recover') {
        proveIdentity();
        throw new DomainError(404, 'operation_not_found', 'Aceite não encontrado; nenhum novo vínculo foi criado.');
      }
      const row = store.db.prepare("SELECT body FROM entities WHERE collection=? AND json_extract(body,'$.tokenHash')=?").get(collection, digest(input.token));
      const invitation = row ? JSON.parse(String(row.body)) as Entity : undefined;
      if (!invitation || invitation.status !== 'pending' || invitation.email !== input.email || Date.parse(String(invitation.expiresAt)) <= Date.now() || !issuerValid(store, invitation)) throw new DomainError(400, 'invalid_invitation', 'Convite inválido, expirado ou revogado.');
      if (user) proveIdentity();
      else if (!input.password) throw new DomainError(400, 'password_required', 'Defina uma senha para a nova conta.');
      const userId = user ? String(user.id) : randomUUID(), tenantId = invitation.tenantId, role = roles.parse(invitation.role);
      if (store.db.prepare('SELECT id FROM memberships WHERE user_id=? AND tenant_id=?').get(userId, tenantId)) throw new DomainError(409, 'already_member', 'Esta identidade já pertence à organização.');
      if (!user) store.db.prepare('INSERT INTO users(id,tenant_id,email,password,role) VALUES(?,?,?,?,?)').run(userId, tenantId, input.email, hashPassword(input.password!), role);
      const membershipId = randomUUID();
      store.db.prepare('INSERT INTO memberships(id,user_id,tenant_id,role,joined_at) VALUES(?,?,?,?,?)').run(membershipId, userId, tenantId, role, new Date().toISOString());
      store.db.prepare('INSERT INTO sessions(hash,user_id,expires,tenant_id) VALUES(?,?,?,?)').run(sessionHash, userId, Date.now() + 86400000, tenantId);
      if (request.cookies.kloel_session) store.db.prepare('DELETE FROM sessions WHERE hash=?').run(digest(request.cookies.kloel_session));
      const accepted = store.update(tenantId, collection, invitation.id, { status: 'accepted', tokenHash: null, acceptedAt: new Date().toISOString(), acceptedUserId: userId, revision: Number(invitation.revision || 0) + 1 })!;
      store.create(tenantId, acceptOperations, { keyHash, tokenHash: digest(input.token), userId, memberVersion: membership(store, tenantId, userId).version, invitationId: invitation.id, invitationVersion: invitationVersion(accepted), sessionHash });
      const context = resolveSessionContext(store, sessionHash)?.context;
      if (!context || context.userId !== userId || context.tenantId !== tenantId || context.membershipId !== membershipId) throw new DomainError(409, 'context_changed_in_flight', 'A autorização mudou durante o aceite. Consulte o resultado antes de tentar novamente.');
      return { userId, tenantId, role, membershipId, replayed: false, context };
    });
    setSessionCookie(reply, sessionToken);
    return reply.code(result.replayed ? 200 : 201).send(result);
  }));
}
