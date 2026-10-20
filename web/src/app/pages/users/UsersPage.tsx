import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Info, MoreHorizontal, Send, Ban, CircleX, UserCheck, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import '@/domain/ext/mais-b'
import type { Invite, Membership, Role, User } from '@/domain/types'
import { useCollection, useCurrentRole, useCurrentUser, useStore } from '@/data/store'
import { ROLES, roleLabel } from '@/data/catalogs/roles'
import { PageTitle } from '@/components/app/Page'
import { ConfirmDialog } from '@/components/app/ConfirmDialog'
import { PhoneInput } from '@/components/app/PhoneInput'
import { OperationStatusView } from '@/components/app/misc'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Alert } from '@/components/ui/alert'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { SimpleTooltip } from '@/components/ui/tooltip'
import { useOperation } from '@/hooks/useOperation'
import { sendInvitation, revokeInvitation, removeMember, saveMemberPhone } from '@/services/casca/team'
import { engineSession } from '@/services/engine/session'
import { uid } from '@/lib/utils'
import { canManageUsers, useUserLimit } from '@/app/pages/company-settings/plan'
import { EMAIL_RE, phoneError, normalizePhone } from './validation'
import { PaginationBar, usePagination } from '@/components/app/Pagination'
import { PageLoadError, PageSkeleton, usePageLoad } from '@/components/app/PageLoad'

const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleString('pt-BR') : '—')
const fmtShort = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—')
const INVITE_DAYS = 7
/** Linhas por página nas tabelas Membros e Convites (paginação local; não exibida na conta capturada da Fonio). INFERIDO. */
export const USERS_PAGE_SIZE = 10

function RolesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-y-6">
        <DialogHeader>
          <DialogTitle>Descrições das funções</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">As funções definem o que os membros podem acessar na plataforma.</p>
        <ul className="space-y-3 text-sm">
          {ROLES.map((r) => (
            <li key={r.value}>
              <span className="font-medium text-foreground">{r.label}</span> <span className="text-muted-foreground">— {r.description}</span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  )
}

function inviteStatus(i: Invite, now = Date.now()): Invite['status'] {
  if (i.status === 'pending' && new Date(i.expiresAt).getTime() <= now) return 'expired'
  return i.status
}
const STATUS: Record<Invite['status'], { label: string; variant: 'warning' | 'success' | 'secondary' | 'outline'; cls?: string }> = {
  pending: { label: 'Pendente', variant: 'warning' },
  accepted: { label: 'Aceito', variant: 'success' },
  expired: { label: 'Expirado', variant: 'secondary' },
  revoked: { label: 'Revogado', variant: 'outline', cls: 'border-transparent bg-red-50 text-red-700' },
}

/* -------------------------------- Membros -------------------------------- */

/**
 * Aba Membros igual à Fonio (fonio-live2/K-admin/23–25): colunas Nome · E-mail · "Phone number" · Função · Entrou em · ⋯;
 * menu "Ações" com "Edit phone number" e "Remover usuário" (vermelho), sem ícones; diálogo "Edit phone number" em inglês
 * com só o botão Salvar.
 */
function MembersTab() {
  const memberships = useCollection('memberships')
  const users = useStore((s) => s.db.users)
  const me = useCurrentUser()
  const myRole = useCurrentRole()
  const isAdmin = engineSession.can('team:manage')
  const [q, setQ] = useState('')
  const [rolesOpen, setRolesOpen] = useState(false)
  const [phoneFor, setPhoneFor] = useState<User | null>(null)
  const [phone, setPhone] = useState('')
  const [phoneTouched, setPhoneTouched] = useState(false)
  const [removeFor, setRemoveFor] = useState<{ m: Membership; u: User } | null>(null)

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase()
    return memberships
      .map((m) => ({ m, u: users.find((u) => u.id === m.userId) }))
      .filter((r): r is { m: Membership; u: User } => !!r.u)
      .filter(({ u, m }) => !t || `${u.firstName} ${u.lastName} ${u.email} ${roleLabel(m.role)}`.toLowerCase().includes(t))
      .sort((a, b) => (a.m.joinedAt ?? '').localeCompare(b.m.joinedAt ?? ''))
  }, [memberships, users, q])
  const pg = usePagination(rows, USERS_PAGE_SIZE, q)
  const adminCount = memberships.filter((m) => m.role === 'admin').length
  const isLastAdmin = (m: Membership) => m.role === 'admin' && adminCount <= 1
  const pErr = phoneError(phone)
  const fullName = (u: User) => `${u.firstName} ${u.lastName}`.trim() || u.email

  return (
    <div className="rounded-xl border bg-white px-4 py-6 shadow sm:px-8 sm:py-8">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div className="font-semibold">Membros</div>
        <Button variant="link" className="flex h-10 items-center gap-2 px-0 py-2" onClick={() => setRolesOpen(true)}>
          <Info className="h-4 w-4" /> Detalhes da função
        </Button>
      </div>
      <div className="w-full">
        <div className="flex items-center justify-between py-4">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pesquisar" aria-label="Pesquisar membros" className="h-10 max-w-sm" />
        </div>
        {/* Como na Fonio: todas as colunas sempre visíveis; em telas estreitas a tabela rola na horizontal (overflow-auto do Table). */}
        <div className="rounded-md border shadow">
          <Table className="rounded-xl bg-white">
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>E-mail</TableHead>
                <TableHead>Phone number</TableHead>
                <TableHead>Função</TableHead>
                <TableHead>Entrou em</TableHead>
                <TableHead><span className="sr-only">Ações</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="h-24 text-center">Nenhum membro encontrado</TableCell></TableRow>
              ) : (
                pg.pageItems.map(({ m, u }) => {
                  const self = u.id === me?.id
                  return (
                    <TableRow key={m.id}>
                      <TableCell>
                        <div className="flex items-center gap-2"><span>{`${u.firstName} ${u.lastName}`.trim() || '—'}</span></div>
                      </TableCell>
                      <TableCell className="max-w-[220px] truncate"><div>{u.email}</div></TableCell>
                      <TableCell className="whitespace-nowrap">{u.phone ? u.phone : <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell><div className="capitalize">{roleLabel(m.role)}</div></TableCell>
                      <TableCell className="whitespace-nowrap"><div>{fmt(m.joinedAt)}</div></TableCell>
                      <TableCell>
                        <div className="flex justify-end">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" className="h-8 w-8 p-0" disabled={!isAdmin && !self}>
                                <span className="sr-only">Open menu</span>
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            {/* Sem devolver o foco ao ⋯: o diálogo "Edit phone number" foca o seletor de país, como na Fonio (K-admin/25). */}
                            <DropdownMenuContent align="end" onCloseAutoFocus={(e) => e.preventDefault()}>
                              <DropdownMenuLabel className="text-sm font-semibold text-foreground">Ações</DropdownMenuLabel>
                              <DropdownMenuItem onSelect={() => { setPhoneFor(u); setPhone(u.phone || '+55'); setPhoneTouched(false) }}>
                                Edit phone number
                              </DropdownMenuItem>
                              {isAdmin && (
                                <DropdownMenuItem
                                  className="text-destructive focus:text-destructive"
                                  onSelect={() => {
                                    if (self) toast.error('Você não pode remover a si mesmo.')
                                    else if (isLastAdmin(m)) toast.error('A empresa precisa de pelo menos um Admin.')
                                    else setRemoveFor({ m, u })
                                  }}
                                >
                                  Remover usuário
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>
      <PaginationBar {...pg} />

      <RolesDialog open={rolesOpen} onOpenChange={setRolesOpen} />

      <Dialog open={!!phoneFor} onOpenChange={(o) => !o && setPhoneFor(null)}>
        <DialogContent className="gap-y-6">
          <DialogHeader>
            <DialogTitle>Edit phone number</DialogTitle>
            <DialogDescription>Set the phone number for {phoneFor ? fullName(phoneFor) : ''}.</DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={async (e) => {
              e.preventDefault()
              setPhoneTouched(true)
              if (!phoneFor || pErr) return
              const value = normalizePhone(phone)
              try {
                await saveMemberPhone(phoneFor.id, value)
                toast.success(value ? 'Telefone atualizado' : 'Telefone removido', { description: fullName(phoneFor) })
                setPhoneFor(null)
              } catch (error) { toast.error(error instanceof Error ? error.message : 'Não foi possível salvar o telefone.') }
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="member-phone" className={phoneTouched && pErr ? 'text-destructive' : undefined}>Phone number</Label>
              <PhoneInput id="member-phone" value={phone} onChange={setPhone} invalid={phoneTouched && !!pErr} />
              {phoneTouched && pErr && <p className="text-sm font-medium text-destructive">{pErr}</p>}
            </div>
            <DialogFooter>
              <Button type="submit">Salvar</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!removeFor}
        onOpenChange={(o) => !o && setRemoveFor(null)}
        title="Remover usuário?"
        description={removeFor ? <><b>{fullName(removeFor.u)}</b> perderá o acesso a esta empresa imediatamente. A conta do usuário não é excluída.</> : null}
        confirmLabel="Remover usuário"
        onConfirm={async () => {
          if (!removeFor) return
          await removeMember(removeFor.u.id)
          toast.success('Usuário removido', { description: removeFor.u.email })
        }}
      />
    </div>
  )
}

/* -------------------------------- Convites -------------------------------- */


function InvitesTab() {
  const invites = useCollection('invites')
  const memberships = useCollection('memberships')
  const users = useStore((s) => s.db.users)
  const myRole = useCurrentRole()
  const me = useCurrentUser()
  const isAdmin = engineSession.can('team:manage')
  const lim = { ...useUserLimit(), reached: false } // The API enforces actual entitlements; no inferred local quota.
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ email: '', firstName: '', lastName: '', role: 'editor' as Role })
  const [touched, setTouched] = useState(false)
  const [revokeFor, setRevokeFor] = useState<Invite | null>(null)
  const [deleteFor, setDeleteFor] = useState<Invite | null>(null)

  const inviteOp = useOperation(async (onProgress, f: typeof form) => {
    onProgress({ step: 0, total: 1, percent: 0, label: 'Preparando e enviando o convite' })
    return sendInvitation(f)
  })
  const resendOp = useOperation(async (onProgress, inv: Invite) => {
    onProgress({ step: 0, total: 1, percent: 0, label: 'Reenviando o convite' })
    return sendInvitation(inv, inv.id)
  })
  const [resending, setResending] = useState<Invite | null>(null)

  const memberEmails = new Set(memberships.map((m) => users.find((u) => u.id === m.userId)?.email.toLowerCase()).filter(Boolean))
  // Fonio (K-admin/29): e-mail vazio ou inválido → rótulo/borda vermelhos e a mensagem genérica "Ocorreu um erro!".
  const emailErr = (() => {
    const e = form.email.trim().toLowerCase()
    if (!e || !EMAIL_RE.test(e)) return 'Ocorreu um erro!'
    if (memberEmails.has(e)) return 'Este e-mail já pertence a um membro da empresa.'
    if (invites.some((i) => i.email.toLowerCase() === e && inviteStatus(i) === 'pending')) return 'Já existe um convite pendente para este e-mail.'
    return null
  })()

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase()
    return [...invites].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).filter((i) => !t || `${i.email} ${i.firstName ?? ''} ${i.lastName ?? ''}`.toLowerCase().includes(t))
  }, [invites, q])
  const pg = usePagination(rows, USERS_PAGE_SIZE, q)

  const accept = (_inv: Invite) => {
    toast.error('O convite deve ser aceito pelo destinatário pelo link recebido por e-mail.')
  }

  const openInvite = () => {
    setForm({ email: '', firstName: '', lastName: '', role: 'editor' })
    setTouched(false)
    inviteOp.reset()
    setOpen(true)
  }

  return (
    <div className="rounded-xl border bg-white px-4 py-6 shadow sm:px-8 sm:py-8">
      <div className="mb-6 font-semibold">Convites</div>
      <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pesquisar" aria-label="Pesquisar convites" className="h-10 max-w-sm" />
        {isAdmin ? (
          <Button onClick={openInvite}>Convidar usuário</Button>
        ) : (
          <SimpleTooltip label="Somente Admin pode convidar usuários.">
            <span tabIndex={0}><Button disabled>Convidar usuário</Button></span>
          </SimpleTooltip>
        )}
      </div>
      {resending && (
        <OperationStatusView
          className="mt-4"
          status={resendOp.status}
          progress={resendOp.progress}
          error={resendOp.error}
          onRetry={() => void resendOp.retry()}
          successText={<>Convite reenviado para {resending.email}.</>}
        />
      )}
      <div className="rounded-md border shadow">
        <Table className="rounded-xl bg-white">
          <TableHeader>
            <TableRow>
              <TableHead>E-mail</TableHead>
              <TableHead>Função</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Criado em</TableHead>
              <TableHead>Último envio</TableHead>
              <TableHead>Expira em</TableHead>
              <TableHead><span className="sr-only">Ações</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="h-24 text-center">Nenhum convite encontrado</TableCell></TableRow>
            ) : (
              pg.pageItems.map((i) => {
                const st = inviteStatus(i)
                return (
                  <TableRow key={i.id}>
                    <TableCell className="max-w-[240px]">
                      <div className="truncate font-medium">{i.email}</div>
                      {(i.firstName || i.lastName) && <div className="truncate text-xs text-muted-foreground">{`${i.firstName ?? ''} ${i.lastName ?? ''}`.trim()}</div>}
                    </TableCell>
                    <TableCell>{roleLabel(i.role)}</TableCell>
                    <TableCell><Badge variant={STATUS[st].variant} className={`font-medium ${STATUS[st].cls ?? ''}`}>{STATUS[st].label}</Badge></TableCell>
                    <TableCell className="whitespace-nowrap">{fmtShort(i.createdAt)}</TableCell>
                    <TableCell className="whitespace-nowrap">{fmt(i.lastSentAt)}</TableCell>
                    <TableCell className="whitespace-nowrap">{st === 'pending' || st === 'expired' ? fmtShort(i.expiresAt) : '—'}</TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" className="h-8 w-8 p-0" disabled={!isAdmin}>
                            <span className="sr-only">Abrir menu</span>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel className="text-sm font-semibold text-foreground">Ações</DropdownMenuLabel>
                          {(st === 'pending' || st === 'expired') && (
                            <DropdownMenuItem
                              disabled={resendOp.isRunning || (st === 'expired' && lim.reached)}
                              onSelect={() => { setResending(i); void resendOp.run(i) }}
                            >
                              <Send className="text-muted-foreground" /> Reenviar
                            </DropdownMenuItem>
                          )}
                          {st === 'pending' && (
                            <DropdownMenuItem onSelect={() => accept(i)}>
                              <UserCheck className="text-muted-foreground" /> Marcar como aceito
                            </DropdownMenuItem>
                          )}
                          {st === 'pending' && <DropdownMenuSeparator />}
                          {st === 'pending' ? (
                            <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setRevokeFor(i)}>
                              <Ban /> Revogar
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setDeleteFor(i)}>
                              <Trash2 /> Excluir convite
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>
      <PaginationBar {...pg} />

      <Dialog open={open} onOpenChange={(o) => !inviteOp.isRunning && setOpen(o)}>
        <DialogContent className="gap-y-6">
          <DialogHeader>
            <DialogTitle>Convidar um usuário</DialogTitle>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={async (e) => {
              e.preventDefault()
              setTouched(true)
              if (emailErr || lim.reached || inviteOp.isRunning) return
              const r = await inviteOp.run(form)
              if (r) {
                toast.success('Convite enviado', { description: `${r.email} · expira em ${INVITE_DAYS} dias` })
                // convites são listados do mais recente ao mais antigo: volta à 1ª página para mostrar o novo
                pg.setPage(0)
                setOpen(false)
              }
            }}
          >
            {lim.reached && (
              <Alert variant="destructive" data-testid="user-limit-alert">
                <CircleX />
                <div>
                  Seu plano {lim.label} inclui até {lim.limit} {lim.limit === 1 ? 'usuário' : 'usuários'} ({lim.members} {lim.members === 1 ? 'membro' : 'membros'} + {lim.pending} {lim.pending === 1 ? 'convite pendente' : 'convites pendentes'}). Revogue um convite pendente, remova um usuário ou{' '}
                  <Link to={`/app/change-plan/${lim.source?.product ?? 'voice'}`} className="font-medium underline underline-offset-4">faça upgrade do seu plano</Link>.
                </div>
              </Alert>
            )}
            <div className="space-y-1">
              <Label htmlFor="inv-email" className={touched && emailErr ? 'text-destructive' : undefined}>E-mail</Label>
              <Input id="inv-email" name="email" type="email" autoFocus value={form.email} aria-invalid={touched && !!emailErr} onChange={(e) => setForm({ ...form, email: e.target.value })} onBlur={() => setTouched(true)} placeholder="name@company.com" disabled={lim.reached} />
              {touched && emailErr && <p className="text-sm font-medium text-destructive">{emailErr}</p>}
            </div>
            <div className="space-y-1">
              <Label htmlFor="inv-first">Nome</Label>
              <Input id="inv-first" name="firstName" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} placeholder="João" disabled={lim.reached} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="inv-last">Sobrenome</Label>
              <Input id="inv-last" name="lastName" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} placeholder="Silva" disabled={lim.reached} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="inv-role">Função</Label>
              <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as Role })} disabled={lim.reached}>
                <SelectTrigger id="inv-role" aria-label="Função"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <OperationStatusView status={inviteOp.status} progress={inviteOp.progress} error={inviteOp.error} onRetry={() => void inviteOp.retry()} />
            <DialogFooter className="mt-4">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={inviteOp.isRunning}>Cancelar</Button>
              <Button type="submit" disabled={lim.reached || inviteOp.isRunning}>{inviteOp.isRunning ? 'Enviando…' : 'Enviar convite'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!revokeFor}
        onOpenChange={(o) => !o && setRevokeFor(null)}
        title="Revogar convite?"
        description={revokeFor ? <>O link enviado para <b>{revokeFor.email}</b> deixará de funcionar.</> : null}
        confirmLabel="Revogar"
        onConfirm={async () => {
          if (!revokeFor) return
          await revokeInvitation(revokeFor.id)
          toast.success('Convite revogado', { description: revokeFor.email })
        }}
      />
      <ConfirmDialog
        open={!!deleteFor}
        onOpenChange={(o) => !o && setDeleteFor(null)}
        title="Excluir convite?"
        description={deleteFor ? <>O convite de <b>{deleteFor.email}</b> será removido do histórico.</> : null}
        confirmLabel="Excluir"
        onConfirm={() => {
          if (!deleteFor) return
          throw new Error('O histórico dos convites é preservado. Revogue o convite para impedir o acesso.')
        }}
      />
    </div>
  )
}

const TABS = ['members', 'invites'] as const
type Tab = (typeof TABS)[number]

export default function UsersPage() {
  const load = usePageLoad('users')
  // Como na Fonio, trocar Membros/Convites não altera a URL (/users): a aba é estado local. Um ?tab=invites antigo só define a aba inicial.
  const [params] = useSearchParams()
  const [tab, setTab] = useState<Tab>(() => {
    const t = params.get('tab')
    return TABS.includes(t as Tab) ? (t as Tab) : 'members'
  })
  if (load.isLoading || load.isError) {
    return (
      <div className="pt-10 lg:pt-20 pb-8 px-4 sm:px-8">
        <div className="mx-auto w-full max-w-[1200px]">{load.isError ? <PageLoadError onRetry={load.retry} /> : <PageSkeleton rows={4} />}</div>
      </div>
    )
  }
  return (
    <div className="pt-10 lg:pt-20 pb-8 px-4 sm:px-8">
      <div className="mx-auto w-full max-w-[1200px]">
        <PageTitle className="mb-4 md:mb-8">Usuários</PageTitle>
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as Tab)}
        >
          <TabsList className="mb-6 h-10 w-fit bg-muted">
            <TabsTrigger value="members">Membros</TabsTrigger>
            <TabsTrigger value="invites">Convites</TabsTrigger>
          </TabsList>
          <TabsContent value="members" className="mt-2"><MembersTab /></TabsContent>
          <TabsContent value="invites" className="mt-2"><InvitesTab /></TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
