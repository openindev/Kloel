import type { Invite, Role, User } from '@/domain/types'
import { useStore } from '@/data/store'
import { createTeamService, createTeamOperationStorage, invitationPath, type TeamMember, type TeamInvitation, type TeamOperationReference } from '../engine/team'
import { captureEngineContext, engineSession, type EngineContext } from '../engine/session'
import type { ExpectedContext } from '../engine/types'
import { EngineError, parseExpectedContext } from '../engine/http'
import { createProfileCommands } from './profile'
import { publishSlice, type DataSlice } from './data'

const displayRole = (role: TeamMember['role']): Role => role === 'owner' ? 'admin' : role === 'member' ? 'editor' : role
const snapshots = new Map<string, { members: TeamMember[]; invites: TeamInvitation[] }>()
const scope = (c: EngineContext) => `${c.generation}:${c.tenantId}`
export function projectInvitation(invite: TeamInvitation, tenantId: string): Invite {
  return { id: invite.id, orgId: tenantId, email: invite.email, role: displayRole(invite.role), status: invite.status, createdAt: invite.createdAt, lastSentAt: invite.lastSentAt ?? '', expiresAt: invite.expiresAt }
}
export async function loadTeam(context: EngineContext): Promise<DataSlice> {
  const api = createTeamService(context)
  async function all<T>(read: (page: number) => Promise<{ items: T[]; total: number; totalPages: number }>): Promise<T[]> {
    const items: T[] = []
    for (let page = 1; page <= 100; page++) {
      const result = await read(page); items.push(...result.items)
      if (page >= result.totalPages) { if (items.length !== result.total) throw new Error('A equipe mudou durante o carregamento. Tente novamente.'); return items }
    }
    throw new Error('A equipe ultrapassou o limite desta tela. Nenhuma lista parcial foi utilizada.')
  }
  const [members, invites] = await Promise.all([all(api.members), all(api.invitations)])
  context.assertCurrent(); snapshots.clear(); snapshots.set(scope(context), { members, invites })
  const currentUsers = useStore.getState().db.users
  const users: User[] = members.map(member => {
    const known = currentUsers.find(user => user.id === member.id)
    return { id: member.id, email: member.email, firstName: known?.firstName ?? '', lastName: known?.lastName ?? '', password: '', language: known?.language ?? '', phone: known?.phone, createdAt: known?.createdAt ?? '' }
  })
  return { users, memberships: members.map(m => ({ id: m.membershipId, orgId: context.tenantId, userId: m.id, role: displayRole(m.role), joinedAt: m.joinedAt })), invites: invites.map(i => projectInvitation(i, context.tenantId)) }
}
function current() {
  const context = captureEngineContext('team:manage'), snapshot = snapshots.get(scope(context))
  if (!snapshot) throw new Error('Atualize a lista da equipe antes de continuar.')
  return { context, snapshot, api: createTeamService(context) }
}
export async function removeMember(userId: string) {
  const { context, snapshot, api } = current(), member = snapshot.members.find(m => m.id === userId)
  if (!member) throw new Error('Atualize o membro antes de removê-lo.')
  await api.removeMember(member); context.assertCurrent()
  publishSlice(context, await loadTeam(context))
}
export async function revokeInvitation(id: string) {
  const { context, snapshot, api } = current(), invite = snapshot.invites.find(i => i.id === id)
  if (!invite) throw new Error('Atualize o convite antes de revogá-lo.')
  await api.revokeInvitation(invite); context.assertCurrent()
  publishSlice(context, await loadTeam(context))
}
export async function saveMemberPhone(userId: string, phone: string) {
  const context = captureEngineContext(), profile = engineSession.getSnapshot().data!.profile
  if (profile.id !== userId) throw new Error('A alteração do telefone de outro membro ainda não está disponível.')
  await createProfileCommands(context, profile).save({ ...profile, phone: phone || null })
  context.assertCurrent(); await engineSession.refresh()
}

/** Invite and email have independent receipts: a lost response never sends another invitation or message. */
export function createInviteCommands(context: EngineContext, identity: ExpectedContext, storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, origin: string) {
  identity = parseExpectedContext(identity)
  if (identity.tenantId !== context.tenantId || !identity.membershipId) throw new Error('Atualize a sessão antes de preparar o convite.')
  const api = createTeamService(context)
  const prefix = `${identity.membershipId}:${identity.authorityVersion}:`
  const scopedStorage = { getItem: (k: string) => storage.getItem(prefix + k), setItem: (k: string, v: string) => storage.setItem(prefix + k, v), removeItem: (k: string) => storage.removeItem(prefix + k) }
  const journal = createTeamOperationStorage(scopedStorage, { userId: identity.userId, tenantId: context.tenantId })
  let busy = false
  return {
    async send(input: { email: string; firstName?: string; lastName?: string; role: Role }, previous?: TeamInvitation) {
      context.assertCurrent()
      if (busy) throw new Error('Aguarde a confirmação do convite.')
      busy = true
      try {
        const pending = journal.read()
        const kind = previous ? 'invitation.rotate' : 'invitation.create'
        const ref: TeamOperationReference = pending ?? { key: crypto.randomUUID(), kind, ...(previous ? { invitationId: previous.id } : {}) }
        if (ref.kind !== kind || previous && ref.invitationId !== previous.id) throw new Error('Consulte o convite pendente antes de preparar outro.')
        let result
        if (pending) {
          const operation = await api.operation(ref.key)
          if (operation.invitation.email !== input.email.trim().toLowerCase() || displayRole(operation.invitation.role) !== input.role || previous && operation.invitation.role !== previous.role) throw new Error('O convite anterior pertence a outro destinatário. Consulte-o antes de enviar outro.')
          result = await api.recoverLink(ref.key)
        } else {
          journal.write(ref); context.assertCurrent()
          try {
            result = previous ? await api.rotateInvitation(previous, 168, ref.key) : await api.createInvitation({ email: input.email.trim(), role: input.role, expiresInHours: 168 }, ref.key)
          } catch (error) {
            if (error instanceof EngineError && error.status >= 400 && error.status < 500 && !['idempotency_conflict', 'context_mismatch'].includes(error.code)) { context.assertCurrent(); journal.clear() }
            throw error
          }
        }
        if (!result.localAcceptancePath) throw new Error('O convite foi criado, mas o link não está disponível. Tente consultar novamente.')
        const href = new URL(invitationPath(result.localAcceptancePath), origin).href
        const mailKey = `team_mail_${ref.key}`, receiptKey = `${prefix}kloel-team-mail:${context.tenantId}:${ref.key}`
        storage.setItem(receiptKey, mailKey)
        context.assertCurrent()
        // Rota própria do convite (o motor confere o link e só envia para o e-mail convidado; reenvio com a mesma chave é idempotente).
        const sent = await context.request<{ status: string; messageId: string }>(`/invitations/${encodeURIComponent(result.id)}/email`, { method: 'POST', body: { acceptUrl: href, ...(input.firstName ? { firstName: input.firstName } : {}), ...(input.lastName ? { lastName: input.lastName } : {}), idempotencyKey: mailKey }, timeoutMs: 60000 })
        context.assertCurrent()
        if (sent.status !== 'accepted' || !sent.messageId) throw new Error('Não foi possível confirmar o envio do convite. Consulte novamente.')
        context.assertCurrent()
        // Keep both references until the authoritative list refresh has completed.
        publishSlice(context, await loadTeam(context))
        journal.clear(); storage.removeItem(receiptKey)
        return projectInvitation(result, context.tenantId)
      } finally { busy = false }
    },
  }
}
export async function sendInvitation(input: { email: string; firstName?: string; lastName?: string; role: Role }, previousId?: string) {
  const { context, snapshot } = current(), identity = engineSession.getSnapshot().data!.identity.context
  const previous = previousId ? snapshot.invites.find(i => i.id === previousId) : undefined
  if (previousId && !previous) throw new Error('Atualize o convite antes de reenviar.')
  return createInviteCommands(context, identity, sessionStorage, window.location.origin).send(input, previous)
}
