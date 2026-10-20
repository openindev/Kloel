import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Globe, Trash2, MoreHorizontal, Mail, Check, X, CircleAlert } from 'lucide-react'
import { toast } from 'sonner'
import '@/domain/ext/mais-b'
import type { CalendarConnection, EmailInbox } from '@/domain/types'
import { useCollection, useCurrentOrg, useCurrentRole, useCurrentUser, useStore } from '@/data/store'
import { PageTitle, WhiteCard } from '@/components/app/Page'
import { ConfirmDialog } from '@/components/app/ConfirmDialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { SimpleTooltip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { ConnectAccountDialog, ProviderIcon, featureLabel, removeConnection, connectionImpact } from './connections'
import { canManageShared, useEmailCapacity } from './plan'
import { disconnectInbox, inboxAccess } from '@/app/pages/email-agents/mailbox'
import { PageLoadError, PageSkeleton, usePageLoad } from '@/components/app/PageLoad'
import { saveEmailInbox } from '@/services/casca/email'
import { captureEngineContext, engineSession } from '@/services/engine/session'
import { schedulingClient } from '@/services/engine/scheduling'

const TABS = ['general', 'connections', 'email-ai'] as const
type Tab = (typeof TABS)[number]

const RESERVED = new Set(['app', 'api', 'admin', 'ajuda', 'login', 'kloel', 'www', 'suporte', 'planos'])

export function validateSlug(slug: string, orgId: string | undefined, orgs: { id: string; slug: string }[]) {
  if (!slug) return 'Informe a URL da empresa.'
  if (slug.length < 3) return 'A URL precisa ter pelo menos 3 caracteres.'
  if (slug.length > 48) return 'A URL pode ter no máximo 48 caracteres.'
  if (!/^[a-z0-9-]+$/.test(slug)) return 'Use apenas letras minúsculas, números e hífens (sem espaços ou acentos).'
  if (slug.startsWith('-') || slug.endsWith('-')) return 'A URL não pode começar nem terminar com hífen.'
  if (slug.includes('--')) return 'Não use dois hífens seguidos.'
  if (RESERVED.has(slug)) return 'Esta URL é reservada. Escolha outra.'
  if (orgs.some((o) => o.id !== orgId && o.slug === slug)) return 'Esta URL já está em uso por outra empresa.'
  return null
}

/**
 * URL da empresa como na Fonio (fonio-live2/K-admin/20a–20d): o campo é saneado enquanto se digita (minúsculas; caracteres fora
 * de [a-z0-9-] são removidos — "_X!" → "x") e a disponibilidade é consultada (aqui, contra as organizações locais e os
 * endereços reservados): "Disponível" (verde, check) ou "Já em uso" (vermelho, circle-alert, Salvar desabilitado).
 * Campo vazio: sem mensagem e Salvar desabilitado.
 */
export const sanitizeSlug = (v: string) => v.toLowerCase().replace(/[^a-z0-9-]/g, '')
export function slugAvailability(slug: string, orgId: string | undefined, orgs: { id: string; slug: string }[]): 'available' | 'taken' | null {
  if (!slug) return null
  if (RESERVED.has(slug) || orgs.some((o) => o.id !== orgId && o.slug === slug)) return 'taken'
  return 'available'
}

function useUserName() {
  const users = useStore((s) => s.db.users)
  const me = useStore((s) => s.db.session.userId)
  return (id?: string) => {
    const u = users.find((x) => x.id === id)
    if (!u) return '—'
    const n = `${u.firstName} ${u.lastName}`.trim() || u.email
    return id === me ? `${n} (você)` : n
  }
}

/* --------------------------------- Geral --------------------------------- */

function GeneralTab() {
  const org = useCurrentOrg()
  const role = useCurrentRole()
  const orgs = useStore((s) => s.db.organizations)
  const isAdmin = role === 'admin'
  const [slug, setSlug] = useState('')
  const [publishedSlug, setPublishedSlug] = useState('')
  useEffect(() => {
    let active = true
    setSlug(''); setPublishedSlug('')
    {
      const context = captureEngineContext()
      void context.request<{ slug: string | null; technicalSlug: string }>('/organization/public-slug').then(async r => {
        context.assertCurrent()
        let value = r.slug ?? ''
        if (!value && engineSession.can('calendars:read')) {
          const events = await schedulingClient(context).events().catch(() => [])
          value = events.find(event => event.publicPath)?.publicPath?.split('/')[2] ?? ''
        }
        if (active) { setSlug(value); setPublishedSlug(value) }
      }).catch(() => { /* A failed read cannot establish a public address. */ })
    }
    return () => { active = false }
  }, [org?.id])
  const dirty = slug !== publishedSlug
  const status = dirty && slugAvailability(slug, org?.id, orgs) === 'taken' ? 'taken' : null
  const canSave = isAdmin && dirty && !validateSlug(slug, org?.id, orgs)

  return (
    <div className="space-y-6">
      <WhiteCard className="px-4 py-6 sm:px-8 sm:py-8">
        <div className="mb-1 font-semibold">Geral</div>
        <div className="text-sm text-muted-foreground">Nome da empresa</div>
        <div className="mt-1" data-testid="org-name">{org?.name}</div>
      </WhiteCard>

      <WhiteCard className="px-4 py-6 sm:px-8 sm:py-8">
        <form
          className="space-y-6"
          onSubmit={(e) => {
            e.preventDefault()
            if (!canSave) return
            const context = captureEngineContext('organization:write')
            context.request<{ slug: string }>('/organization/public-slug', { method: 'PUT', body: { slug } }).then(r => {
              context.assertCurrent(); setSlug(r.slug); setPublishedSlug(r.slug)
              toast.success('URL da empresa salva', { description: `${window.location.origin}/c/${r.slug}` })
            }, (e) => toast.error(e instanceof Error ? e.message : 'Não foi possível salvar a URL da empresa.'))
          }}
        >
          <div>
            <div className="font-semibold">URL da empresa</div>
            <p className="mt-1 text-sm text-muted-foreground">Escolha uma URL exclusiva para sua empresa — ela será a base para todos os seus links voltados para clientes.</p>
          </div>
          <div className="space-y-1">
            <label className="flex h-10 w-full cursor-text items-center gap-2 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-within:ring-1 focus-within:ring-ring">
              <Globe className="size-5 shrink-0 text-muted-foreground" />
              <span className="flex min-w-0 flex-1 items-center overflow-x-auto whitespace-nowrap [scrollbar-width:thin]">
                <span className="shrink-0 whitespace-nowrap text-muted-foreground">{window.location.origin}/c/</span>
                <input
                  value={slug}
                  disabled={!isAdmin}
                  onChange={(e) => setSlug(sanitizeSlug(e.target.value))}
                  placeholder="minha-empresa"
                  aria-label="URL da empresa"
                  aria-invalid={status === 'taken' || undefined}
                  aria-describedby={status ? 'org-slug-status' : undefined}
                  data-testid="org-slug-input"
                  className="shrink-0 border-0 bg-transparent p-0 font-medium text-foreground outline-none [field-sizing:content] placeholder:font-normal placeholder:text-muted-foreground disabled:cursor-not-allowed"
                />
                <span className="shrink-0 text-muted-foreground">/…</span>
              </span>
              {status === 'taken' && <CircleAlert className="size-4 shrink-0 text-destructive" aria-hidden />}
            </label>
            {status && (
              <p id="org-slug-status" role="status" className={cn('text-sm', 'text-destructive')}>
                Já em uso
              </p>
            )}
          </div>
          <Button type="submit" disabled={!canSave}>Salvar</Button>
        </form>
      </WhiteCard>
    </div>
  )
}

/* -------------------------- Conexões de contas -------------------------- */

function ConnectionsTab() {
  const connections = useCollection('calendarConnections')
  const role = useCurrentRole()
  const me = useCurrentUser()
  const nameOf = useUserName()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [toRemove, setToRemove] = useState<CalendarConnection | null>(null)
  const allowedShared = canManageShared(role)
  const list = useMemo(() => {
    const t = q.trim().toLowerCase()
    return [...connections].sort((a, b) => b.connectedAt.localeCompare(a.connectedAt)).filter((c) => !t || c.email.toLowerCase().includes(t) || nameOf(c.ownerUserId).toLowerCase().includes(t))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connections, q])
  const canRemove = (c: CalendarConnection) => (c.scope === 'personal' ? c.ownerUserId === me?.id : allowedShared)
  const impact = toRemove ? connectionImpact(toRemove.id) : null

  return (
    <div className="rounded-xl border bg-white px-4 py-6 sm:px-8 sm:py-8 shadow">
      <div className="font-semibold">Conexões de contas</div>
      <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">
        Todas as contas conectadas a esta empresa. As contas pessoais são gerenciadas por seus proprietários. As contas compartilhadas são gerenciadas por membros autorizados da equipe.
      </p>
      {/* K-admin/21: espaçador pt-4 antes da barra "flex items-center justify-between gap-4 py-4". */}
      <div className="pt-4" />
      <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pesquisar" aria-label="Pesquisar contas" className="h-10 max-w-sm" />
        {allowedShared ? (
          <Button onClick={() => setOpen(true)}>Conectar conta compartilhada</Button>
        ) : (
          <SimpleTooltip label="Contas compartilhadas podem ser gerenciadas por: Admin e Editor.">
            <span tabIndex={0}><Button disabled>Conectar conta compartilhada</Button></span>
          </SimpleTooltip>
        )}
      </div>
      <div className="rounded-md border shadow">
        <Table className="table-fixed rounded-xl bg-white">
          <TableHeader>
            <TableRow>
              <TableHead>Conta</TableHead>
              <TableHead className="hidden w-56 sm:table-cell">Usuário</TableHead>
              <TableHead className="w-20"><span className="sr-only">Ações</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.length === 0 ? (
              <TableRow><TableCell colSpan={3} className="h-24 text-center">Nenhuma conta conectada.</TableCell></TableRow>
            ) : (
              list.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <div className="flex min-w-0 items-start gap-3">
                      <ProviderIcon provider={c.provider} className="mt-0.5 size-5 shrink-0" />
                      <div className="min-w-0">
                        <div className="truncate font-medium">{c.email}</div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          <Badge variant={c.scope === 'shared' ? 'brand' : 'secondary'} className="font-medium">{c.scope === 'shared' ? 'Compartilhada' : 'Pessoal'}</Badge>
                          {c.features.map((f) => <Badge key={f} variant="outline" className="font-medium">{featureLabel(f)}</Badge>)}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground sm:hidden">{nameOf(c.ownerUserId)}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden truncate sm:table-cell">{nameOf(c.ownerUserId)}</TableCell>
                  <TableCell className="text-right">
                    {canRemove(c) ? (
                      <SimpleTooltip label="Remover conexão">
                        <Button variant="ghost" className="h-8 w-8 p-0" aria-label={`Remover conexão ${c.email}`} onClick={() => setToRemove(c)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </SimpleTooltip>
                    ) : (
                      <SimpleTooltip label={c.scope === 'personal' ? 'Contas pessoais só podem ser removidas pelo proprietário.' : 'Somente Admin e Editor podem remover contas compartilhadas.'}>
                        <span tabIndex={0}><Button variant="ghost" className="h-8 w-8 p-0" disabled aria-label="Remover conexão"><Trash2 className="h-4 w-4" /></Button></span>
                      </SimpleTooltip>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      <ConnectAccountDialog open={open} onOpenChange={setOpen} scope="shared" />
      <ConfirmDialog
        open={!!toRemove}
        onOpenChange={(o) => !o && setToRemove(null)}
        title="Remover conexão?"
        description={
          toRemove ? (
            <>
              A conta <b>{toRemove.email}</b> será desconectada da empresa.
              {impact && impact.inboxes.length > 0 && <> A caixa de entrada do E-Mail IA e os e-mails sincronizados também serão removidos.</>}
              {impact && impact.events.length > 0 && <> {impact.events.length === 1 ? '1 tipo de evento do Agendador ficará' : `${impact.events.length} tipos de evento do Agendador ficarão`} sem calendário.</>}
            </>
          ) : null
        }
        confirmLabel="Remover"
        onConfirm={async () => {
          if (!toRemove) return
          await removeConnection(toRemove.id)
          toast.success('Conexão removida', { description: toRemove.email })
        }}
      />
    </div>
  )
}

/* -------------------------------- E-Mail IA ------------------------------- */

function EmailAiTab() {
  const inboxes = useCollection('emailInboxes')
  const cap = useEmailCapacity()
  const nameOf = useUserName()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [toRemove, setToRemove] = useState<EmailInbox | null>(null)
  const role = useCurrentRole()
  const me = useCurrentUser()
  const connections = useCollection('calendarConnections')
  const users = useStore((s) => s.db.users)
  const list = inboxes.filter((i) => !q.trim() || i.address.toLowerCase().includes(q.trim().toLowerCase()))
  const n = cap.active
  return (
    <section className="rounded-xl border bg-white px-4 py-6 sm:px-8 sm:py-8 shadow">
      <h2 className="font-semibold">Uso de caixas da empresa</h2>
      {/* Fonio (K-admin/22): só a contagem de agentes em uso. */}
      <p className="mt-1 text-sm text-muted-foreground">
        {n <= 1 ? <>Atualmente, {n} agente de e-mail está em uso.</> : <>Atualmente, {n} agentes de e-mail estão em uso.</>}
      </p>
      <div className="py-4">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pesquisar" aria-label="Pesquisar caixas" className="h-10 max-w-sm" />
      </div>
      <div className="rounded-md border shadow">
        <Table className="table-fixed rounded-xl bg-white">
          <TableHeader>
            <TableRow>
              <TableHead>Conta</TableHead>
              <TableHead className="hidden w-56 sm:table-cell">Usuário</TableHead>
              <TableHead className="w-20"><span className="sr-only">Ações</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.length === 0 ? (
              <TableRow><TableCell colSpan={3} className="h-24 text-center">Nenhum agente de e-mail está configurado no momento.</TableCell></TableRow>
            ) : (
              list.map((i) => {
                const acc = inboxAccess(i, role, me?.id, connections, users)
                return (
                <TableRow key={i.id}>
                  <TableCell>
                    <div className="flex min-w-0 items-start gap-3">
                      <ProviderIcon provider={i.provider} className="mt-0.5 size-5 shrink-0" />
                      <div className="min-w-0">
                        <div className="truncate font-medium">{i.address}</div>
                        <Badge variant={i.agentEnabled ? 'success' : 'secondary'} className="mt-1 font-medium">{i.agentEnabled ? 'Agente ativo' : 'Agente inativo'}</Badge>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden truncate sm:table-cell">{nameOf(i.ownerUserId)}</TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="h-8 w-8 p-0"><span className="sr-only">Abrir menu</span><MoreHorizontal className="h-4 w-4" /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel className="text-sm font-semibold text-foreground">Ações</DropdownMenuLabel>
                        <DropdownMenuItem onSelect={() => navigate(`/app/email-agents/${i.id}/inbox`)}><Mail className="text-muted-foreground" /> Abrir no E-Mail IA</DropdownMenuItem>
                        {i.agentEnabled && (
                          <DropdownMenuItem disabled={!acc.canManage} onSelect={async () => {
                            if (!acc.canManage) return
                            try { await saveEmailInbox(i.id, { agentEnabled: false }); toast.success('Agente de e-mail desativado', { description: i.address }) }
                            catch (error) { toast.error(error instanceof Error ? error.message : 'Não foi possível desativar o agente.') }
                          }}>
                            <X className="text-muted-foreground" /> Desativar agente
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem disabled={!acc.canManage} className="text-destructive focus:text-destructive" onSelect={() => acc.canManage && setToRemove(i)}><Trash2 /> Desconectar caixa</DropdownMenuItem>
                        {!acc.canManage && <p className="max-w-[240px] px-2 pb-1.5 pt-1 text-xs text-muted-foreground" data-testid="inbox-manage-reason">{acc.manageReason}</p>}
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
      <ConfirmDialog
        open={!!toRemove}
        onOpenChange={(o) => !o && setToRemove(null)}
        title="Desconectar caixa de entrada?"
        description={toRemove ? <>A caixa <b>{toRemove.address}</b> e os e-mails sincronizados serão removidos. O agente deixa de responder por esta caixa.</> : null}
        confirmLabel="Desconectar"
        onConfirm={async () => {
          if (!toRemove) return
          await disconnectInbox(toRemove.id)
          toast.success('Caixa de entrada desconectada', { description: toRemove.address })
        }}
      />
    </section>
  )
}

export default function CompanySettingsPage() {
  const load = usePageLoad('company-settings')
  const [params, setParams] = useSearchParams()
  const tabParam = params.get('tab')
  const tab: Tab = TABS.includes(tabParam as Tab) ? (tabParam as Tab) : 'general'
  if (load.isLoading || load.isError) {
    return (
      <div className="pt-10 lg:pt-20 pb-8 px-4 sm:px-8">{load.isError ? <PageLoadError onRetry={load.retry} /> : <PageSkeleton rows={3} />}</div>
    )
  }
  return (
    <div className="pt-10 lg:pt-20 pb-8 px-4 sm:px-8">
      <PageTitle className="mb-4 md:mb-8">Configurações da empresa</PageTitle>
      <Tabs
        value={tab}
        onValueChange={(v) => {
          const next = new URLSearchParams(params)
          if (v === 'general') next.delete('tab')
          else next.set('tab', v)
          setParams(next, { replace: true })
        }}
      >
        <div className="max-w-full overflow-x-auto">
          <TabsList className="mb-6 h-10 w-fit rounded-md bg-muted p-1">
            <TabsTrigger value="general">Geral</TabsTrigger>
            <TabsTrigger value="connections">Conexões de contas</TabsTrigger>
            <TabsTrigger value="email-ai">E-Mail IA</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="general" className="mt-2"><GeneralTab /></TabsContent>
        <TabsContent value="connections" className="mt-2"><ConnectionsTab /></TabsContent>
        <TabsContent value="email-ai" className="mt-2"><EmailAiTab /></TabsContent>
      </Tabs>
    </div>
  )
}
