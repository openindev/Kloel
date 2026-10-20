import { EngineError, parseExpectedContext, type EngineRequest } from './http'
import type { EngineContext } from './session'
import type { EngineRole } from './types'

export const teamRoles: EngineRole[] = ['owner', 'admin', 'editor', 'builder', 'member', 'viewer']
export const teamRoleLabels: Record<EngineRole, string> = { owner: 'Proprietário', admin: 'Administrador', editor: 'Editor', builder: 'Construtor', member: 'Membro', viewer: 'Leitor' }
export type TeamMember = { id: string; membershipId: string; email: string; role: EngineRole; joinedAt: string; isCurrentUser: boolean; version: string; revision: number }
export type TeamInvitation = { id: string; email: string; role: EngineRole; status: 'pending' | 'expired' | 'revoked' | 'accepted'; expiresAt: string; deliveryStatus: 'not_sent'; lastSentAt: string | null; acceptedAt: string | null; createdAt: string; updatedAt: string; version: string; revision: number }
export type TeamPage<T> = { items: T[]; page: number; limit: number; total: number; totalPages: number }
export type TeamRoles = { items: { role: EngineRole; permissions: string[]; canAssign: boolean }[]; ownerCount: number }
export type InvitationResult = TeamInvitation & { localAcceptancePath?: string }
export type InvitationDraft = { email: string; role: EngineRole; expiresInHours: number }
export type TeamOperationKind = 'invitation.create' | 'invitation.rotate'
export type TeamOperation = { status: 'succeeded'; kind: TeamOperationKind; invitation: TeamInvitation; linkRecoverable: boolean }
export type TeamOperationReference = { key: string; kind: TeamOperationKind; invitationId?: string }
export type InvitationAcceptance = { userId: string; tenantId: string; role: EngineRole; membershipId: string; replayed: boolean; context: import('./types').ExpectedContext }
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const number = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0
const date = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v))
const email = (v: unknown): v is string => typeof v === 'string' && v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
const role = (v: unknown): v is EngineRole => teamRoles.includes(v as EngineRole)
function invalid(): never { throw new EngineError(0, 'invalid_team_response', 'Não foi possível confirmar os dados da equipe.') }
function id(v: unknown): string { if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(v)) invalid(); return v }
function version(v: unknown): string { if (typeof v !== 'string' || !/^[a-f0-9]{64}$/.test(v)) invalid(); return v }
function key(v: unknown): string { if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(v)) invalid(); return v }
export function invitationPath(value: unknown): string {
  if (typeof value !== 'string' || !/^\/accept-invite#token=[a-f0-9]{64}$/.test(value)) invalid()
  return value
}
function member(raw: unknown): TeamMember {
  if (!object(raw) || !email(raw.email) || !role(raw.role) || !date(raw.joinedAt) || typeof raw.isCurrentUser !== 'boolean' || !number(raw.revision)) invalid()
  return { id: id(raw.id), membershipId: id(raw.membershipId), email: raw.email, role: raw.role, joinedAt: raw.joinedAt, isCurrentUser: raw.isCurrentUser, version: version(raw.version), revision: raw.revision }
}
function invitation(raw: unknown): TeamInvitation {
  if (!object(raw) || !email(raw.email) || !role(raw.role) || !['pending', 'expired', 'revoked', 'accepted'].includes(String(raw.status)) || !date(raw.expiresAt) || !date(raw.createdAt) || !date(raw.updatedAt) || raw.acceptedAt !== null && !date(raw.acceptedAt) || raw.deliveryStatus !== 'not_sent' || !number(raw.revision)) invalid()
  return { id: id(raw.id), email: raw.email, role: raw.role, status: raw.status as TeamInvitation['status'], expiresAt: raw.expiresAt, deliveryStatus: 'not_sent', lastSentAt: date(raw.lastSentAt) ? raw.lastSentAt : null, acceptedAt: raw.acceptedAt, createdAt: raw.createdAt, updatedAt: raw.updatedAt, version: version(raw.version), revision: raw.revision }
}
function invitationResult(raw: unknown): InvitationResult { const item = invitation(raw); return { ...item, ...(object(raw) && raw.localAcceptancePath !== undefined ? { localAcceptancePath: invitationPath(raw.localAcceptancePath) } : {}) } }
function page<T>(raw: unknown, parse: (raw: unknown) => T): TeamPage<T> {
  if (!object(raw) || !Array.isArray(raw.items) || !number(raw.page) || raw.page < 1 || !number(raw.limit) || raw.limit < 1 || !number(raw.total) || !number(raw.totalPages)) invalid()
  return { items: raw.items.map(parse), page: raw.page, limit: raw.limit, total: raw.total, totalPages: raw.totalPages }
}
function roles(raw: unknown): TeamRoles {
  if (!object(raw) || !number(raw.ownerCount) || !Array.isArray(raw.items) || raw.items.length !== teamRoles.length) invalid()
  const items = raw.items.map(item => {
    if (!object(item) || !role(item.role) || !Array.isArray(item.permissions) || item.permissions.some(p => typeof p !== 'string' || !/^[a-z_]+:[a-z_]+$/.test(p)) || typeof item.canAssign !== 'boolean') invalid()
    return { role: item.role, permissions: item.permissions as string[], canAssign: item.canAssign }
  })
  if (new Set(items.map(item => item.role)).size !== teamRoles.length) invalid()
  return { items, ownerCount: raw.ownerCount }
}
export class TeamWriteUncertain extends EngineError { constructor() { super(0, 'team_outcome_unknown', 'O resultado não foi confirmado. Consulte os registros antes de qualquer nova alteração.') } }
export function teamErrorMessage(error: unknown): string {
  if (error instanceof EngineError && error.code === 'tenant_mismatch') return 'Sua sessão mudou de organização. Atualize a página antes de preparar o convite.'
  if (error instanceof EngineError && error.code === 'idempotency_conflict') return 'Esta chave já foi vinculada a outros dados. Consulte a operação anterior para confirmar o que foi registrado.'
  if (error instanceof EngineError && error.code === 'invitation_key_unavailable') return 'O servidor ainda não pode preparar links de convite. Esta tentativa não foi gravada. Tente novamente após a configuração ser concluída.'
  if (error instanceof EngineError && error.code === 'invitation_recovery_unavailable') return 'A operação permanece registrada, mas o link não está disponível com a configuração atual. Consulte o estado do convite antes de continuar.'
  const messages: Record<string, string> = { last_owner: 'A organização precisa manter pelo menos um proprietário.', forbidden: 'Seu papel não permite esta alteração.', stale_version: 'Os dados mudaram. Atualize os registros antes de confirmar outra alteração.', version_conflict: 'Os dados mudaram. Atualize os registros antes de confirmar outra alteração.', already_member: 'Este e-mail já pertence à organização.', invitation_pending: 'Já existe um convite pendente para este e-mail.', invitation_accepted: 'Este convite já foi aceito. Gerencie o vínculo na lista de membros.', invalid_invitation: 'O convite é inválido, expirou ou foi revogado.', identity_verification_required: 'Confirme a identidade convidada com a senha atual ou entre na conta correta.', password_required: 'Informe uma senha de 12 a 128 caracteres para criar sua conta.', team_outcome_unknown: 'O resultado não foi confirmado. Consulte os registros; a solicitação não será repetida automaticamente.', invitation_not_pending: 'Este convite não pode mais ser renovado.', recovery_unavailable: 'Não foi possível guardar o identificador da operação nesta aba. Nenhuma solicitação foi enviada.' }
  if (error instanceof EngineError && messages[error.code]) return messages[error.code]
  if (error instanceof EngineError && error.status === 409) return 'Os dados ou a autorização mudaram. Atualize os registros antes de continuar.'
  if (error instanceof EngineError && error.status === 404) return 'Este registro não está disponível para a sessão atual.'
  return 'Não foi possível concluir a solicitação. Confira os dados e o estado atual antes de continuar.'
}

export function createTeamService(context: EngineContext) {
  const scopedInvitation = (raw: unknown) => { if (!object(raw) || raw.tenantId !== context.tenantId) invalid(); return invitation(raw) }
  const scopedResult = (raw: unknown) => { scopedInvitation(raw); return invitationResult(raw) }
  const expectedMember = (raw: unknown, previous: TeamMember, nextRole = previous.role) => { const result = member(raw); if (result.id !== previous.id || result.membershipId !== previous.membershipId || result.role !== nextRole) invalid(); return result }
  const parseOperation = (raw: unknown): TeamOperation => { if (!object(raw) || raw.status !== 'succeeded' || !['invitation.create', 'invitation.rotate'].includes(String(raw.kind)) || typeof raw.linkRecoverable !== 'boolean') invalid(); return { status: 'succeeded', kind: raw.kind as TeamOperationKind, invitation: scopedInvitation(raw.invitation), linkRecoverable: raw.linkRecoverable } }
  async function read<T>(path: string, parse: (raw: unknown) => T, query?: Record<string, number>) { context.assertCurrent(); const raw = await context.request(path, { query }); context.assertCurrent(); return parse(raw) }
  async function write<T>(path: string, method: 'POST' | 'PATCH' | 'DELETE', body: unknown, parse: (raw: unknown) => T) {
    context.assertCurrent()
    try { const raw = await context.request(path, { method, body }); context.assertCurrent(); return parse(raw) }
    catch (error) { if (error instanceof EngineError && (error.status > 0 && error.status < 500 || error.status === 503 && ['invitation_key_unavailable', 'invitation_recovery_unavailable'].includes(error.code))) throw error; throw new TeamWriteUncertain() }
  }
  return {
    members: (pageNumber = 1) => read('/members', value => page(value, member), { page: pageNumber, limit: 25 }),
    invitations: (pageNumber = 1) => read('/invitations', value => page(value, scopedInvitation), { page: pageNumber, limit: 25 }),
    roles: () => read('/members/roles', roles),
    changeRole: (previous: TeamMember, next: EngineRole) => { if (!role(next)) invalid(); return write(`/members/${id(previous.id)}`, 'PATCH', { role: next, expectedVersion: version(previous.version) }, raw => expectedMember(raw, previous, next)) },
    removeMember: (previous: TeamMember) => write(`/members/${id(previous.id)}`, 'DELETE', { expectedVersion: version(previous.version) }, raw => { if (raw !== undefined) invalid() }),
    revokeSessions: (previous: TeamMember) => write(`/members/${id(previous.id)}/revoke-sessions`, 'POST', { expectedVersion: version(previous.version) }, raw => { if (!object(raw) || raw.userId !== previous.id || !number(raw.revokedSessions)) invalid(); return { userId: previous.id, revokedSessions: raw.revokedSessions, member: expectedMember(raw.member, previous) } }),
    createInvitation: (draft: InvitationDraft, operationKey: string) => { if (!email(draft.email.trim().toLowerCase()) || !role(draft.role) || !Number.isInteger(draft.expiresInHours) || draft.expiresInHours < 1 || draft.expiresInHours > 168) invalid(); return write('/invitations', 'POST', { expectedTenantId: context.tenantId, email: draft.email.trim().toLowerCase(), role: draft.role, expiresInHours: draft.expiresInHours, idempotencyKey: key(operationKey) }, raw => { const result = scopedResult(raw); if (result.email !== draft.email.trim().toLowerCase() || result.role !== draft.role) invalid(); return result }) },
    rotateInvitation: (previous: TeamInvitation, expiresInHours: number, operationKey: string) => { if (!Number.isInteger(expiresInHours) || expiresInHours < 1 || expiresInHours > 168) invalid(); return write(`/invitations/${id(previous.id)}/link`, 'POST', { expiresInHours, expectedVersion: version(previous.version), idempotencyKey: key(operationKey) }, raw => { const result = scopedResult(raw); if (result.id !== previous.id || result.email !== previous.email || result.role !== previous.role) invalid(); return result }) },
    revokeInvitation: (previous: TeamInvitation) => write(`/invitations/${id(previous.id)}`, 'DELETE', { expectedVersion: version(previous.version) }, raw => { if (raw !== undefined) invalid() }),
    operation: (operationKey: string) => read(`/team/operations/${key(operationKey)}`, parseOperation),
    recoverLink: async (operationKey: string) => { const operation = await read(`/team/operations/${key(operationKey)}`, parseOperation); return write(`/team/operations/${key(operationKey)}/recover-link`, 'POST', {}, raw => { const result = scopedResult(raw); if (result.id !== operation.invitation.id || result.version !== operation.invitation.version) invalid(); return result }) },
  }
}

export function createTeamOperationStorage(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, scope: { userId: string; tenantId: string }) {
  const storageKey = `kloel:team:operation:v1:${id(scope.userId)}:${id(scope.tenantId)}`
  const parse = (raw: unknown): TeamOperationReference => { if (!object(raw) || !['invitation.create', 'invitation.rotate'].includes(String(raw.kind))) invalid(); return { key: key(raw.key), kind: raw.kind as TeamOperationKind, ...(raw.invitationId !== undefined ? { invitationId: id(raw.invitationId) } : {}) } }
  return {
    read(): TeamOperationReference | undefined { try { const raw = storage.getItem(storageKey); if (!raw) return; if (raw.length > 1024) invalid(); return parse(JSON.parse(raw)) } catch { throw new EngineError(0, 'recovery_unavailable', 'Registro local indisponível.') } },
    write(ref: TeamOperationReference) { try { const raw = JSON.stringify(parse(ref)); storage.setItem(storageKey, raw); if (storage.getItem(storageKey) !== raw) throw Error('storage') } catch { throw new EngineError(0, 'recovery_unavailable', 'Registro local indisponível.') } },
    clear() { storage.removeItem(storageKey) },
  }
}

export function invitationFragment(hash: string): string | undefined {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const token = params.get('token')
  return params.size === 1 && token && /^[a-f0-9]{64}$/.test(token) ? token : undefined
}
export function createInvitationAcceptance(request: EngineRequest, operationKey: string = crypto.randomUUID()) {
  key(operationKey); let started = false, address = ''
  const parse = (raw: unknown): InvitationAcceptance => { if (!object(raw) || !role(raw.role) || typeof raw.replayed !== 'boolean') invalid(); const context = parseExpectedContext(raw.context); if (context.userId !== raw.userId || context.tenantId !== raw.tenantId || context.membershipId !== raw.membershipId) invalid(); return { userId: id(raw.userId), tenantId: id(raw.tenantId), membershipId: id(raw.membershipId), role: raw.role, replayed: raw.replayed, context } }
  return { key: operationKey,
    async accept(input: { token: string; email: string; password?: string }) {
      if (started) throw new EngineError(409, 'already_started', 'Consulte a aceitação anterior.')
      if (!/^[a-f0-9]{64}$/.test(input.token) || !email(input.email.trim().toLowerCase()) || input.password !== undefined && (input.password.length < 12 || input.password.length > 128)) invalid()
      started = true; address = input.email.trim().toLowerCase()
      return parse(await request('/auth/accept-invite', { method: 'POST', body: { action: 'accept', token: input.token, email: address, ...(input.password ? { password: input.password } : {}), idempotencyKey: operationKey } }))
    },
    async recover(password?: string) {
      if (!started || !address || password !== undefined && (password.length < 12 || password.length > 128)) invalid()
      return parse(await request('/auth/accept-invite', { method: 'POST', body: { action: 'recover', email: address, ...(password ? { password } : {}), idempotencyKey: operationKey } }))
    },
  }
}
