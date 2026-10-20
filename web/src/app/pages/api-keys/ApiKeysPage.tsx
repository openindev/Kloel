import { useEffect, useMemo, useRef, useState } from 'react'
import { Copy, Check, MoreHorizontal, Pencil, Ban, TriangleAlert, KeyRound } from 'lucide-react'
import { toast } from 'sonner'
import '@/domain/ext/mais-b'
import type { ApiKey } from '@/domain/types'
import { useCollection, useCurrentRole, useStore } from '@/data/store'
import { PageTitle } from '@/components/app/Page'
import { ConfirmDialog } from '@/components/app/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert } from '@/components/ui/alert'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { SimpleTooltip } from '@/components/ui/tooltip'
import { canManageApiKeys } from '@/app/pages/company-settings/plan'
import { PaginationBar, usePagination } from '@/components/app/Pagination'
import { PageLoadError, PageSkeleton, usePageLoad } from '@/components/app/PageLoad'
import { currentApiKeyCommands } from '@/services/casca/api-keys';
import { engineSession, useEngineSession } from '@/services/engine/session'

/** Linhas por página da tabela (paginação local; a Fonio não exibe paginação com os dados da conta capturada). INFERIDO. */
export const API_KEYS_PAGE_SIZE = 10

export function maskKey(k: Pick<ApiKey, 'prefix' | 'secret' | 'last4'>) {
  if (k.secret.includes('•')) return k.secret
  const last4 = k.last4 ?? k.secret.slice(-4)
  return `${k.prefix}••••••••••••${last4}`
}

const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—')

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export default function ApiKeysPage() {
  const load = usePageLoad('api-keys')
  const keys = useCollection('apiKeys')
  const role = useCurrentRole()
  const allowed = engineSession.can('api_keys:manage')
  const session = useEngineSession()
  const commands = useMemo(() => allowed ? currentApiKeyCommands() : undefined, [session.generation, allowed])
  const submitting = useRef(false)
  const [busy, setBusy] = useState(false)
  const [q, setQ] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [touched, setTouched] = useState(false)
  const [created, setCreated] = useState<{ name: string; secret: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [rename, setRename] = useState<ApiKey | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [revoke, setRevoke] = useState<ApiKey | null>(null)
  useEffect(() => { setCreated(null); setCreateOpen(false); setRename(null); setRevoke(null) }, [session.generation])

  const list = useMemo(() => {
    const t = q.trim().toLowerCase()
    return [...keys].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).filter((k) => !t || k.name.toLowerCase().includes(t) || maskKey(k).toLowerCase().includes(t))
  }, [keys, q])
  const pg = usePagination(list, API_KEYS_PAGE_SIZE, q)

  const nameError = (v: string, exceptId?: string) => {
    const t = v.trim()
    if (!t) return 'Informe um nome para a chave.'
    if (t.length > 80) return 'O nome pode ter no máximo 80 caracteres.'
    if (keys.some((k) => k.id !== exceptId && k.name.trim().toLowerCase() === t.toLowerCase())) return 'Já existe uma chave com este nome.'
    return null
  }
  const createErr = nameError(name)

  const openCreate = () => {
    setName('')
    setTouched(false)
    setCreated(null)
    setCopied(false)
    setCreateOpen(true)
  }

  const save = async () => {
    setTouched(true)
    if (createErr || submitting.current || !commands) return
    submitting.current = true; setBusy(true)
    try { setCreated(await commands.create(name)); pg.setPage(0) }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Não foi possível confirmar a chave. Confira a lista antes de tentar novamente.') }
    finally { submitting.current = false; setBusy(false) }
  }

  if (load.isLoading || load.isError) {
    return (
      <div className="pt-10 lg:pt-20 pb-8 px-4 sm:px-8">
        {load.isError ? <PageLoadError onRetry={load.retry} /> : <PageSkeleton rows={4} />}
      </div>
    )
  }

  return (
    <div className="pt-10 lg:pt-20 pb-8 px-4 sm:px-8">
      <PageTitle className="mb-4 md:mb-8">Chaves de API</PageTitle>
      {/* K-admin/17: "flex items-center py-4 justify-between"; o botão fica num invólucro px-2 py-1.5 (gatilho do diálogo). */}
      <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pesquisar" aria-label="Pesquisar chaves de API" className="h-10 max-w-sm" />
        <div className="rounded-sm sm:px-2 sm:py-1.5">
          {allowed ? (
            <Button onClick={openCreate}>Criar chave de API</Button>
          ) : (
            <SimpleTooltip label="Somente Admin e Editor podem gerenciar chaves de API.">
              <span tabIndex={0}>
                <Button disabled>Criar chave de API</Button>
              </span>
            </SimpleTooltip>
          )}
        </div>
      </div>
      {/* Como na Fonio: todas as colunas sempre visíveis; em telas estreitas a tabela rola na horizontal (overflow-auto do Table). */}
      <div className="rounded-md border shadow">
        <Table className="rounded-xl bg-white">
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Chave</TableHead>
              <TableHead>Data de criação</TableHead>
              <TableHead>Último uso</TableHead>
              <TableHead><span className="sr-only">Ações</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center">
                  Nenhuma chave de API encontrada
                </TableCell>
              </TableRow>
            ) : (
              pg.pageItems.map((k) => (
                <TableRow key={k.id}>
                  <TableCell className="font-medium">
                    {k.name}
                  </TableCell>
                  <TableCell>
                    <code className="whitespace-nowrap rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{maskKey(k)}</code>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{fmt(k.createdAt)}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{k.lastUsedAt ? fmt(k.lastUsedAt) : 'Nunca usada'}</TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="h-8 w-8 p-0" disabled={!allowed}>
                          <span className="sr-only">Abrir menu</span>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel className="text-sm font-semibold text-foreground">Ações</DropdownMenuLabel>
                        <DropdownMenuItem onSelect={() => { setRename(k); setRenameValue(k.name) }}>
                          <Pencil className="text-muted-foreground" /> Renomear
                        </DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setRevoke(k)}>
                          <Ban /> Revogar
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      <PaginationBar {...pg} />

      {/* Criar chave → segredo exibido uma única vez (INFERIDO) */}
      <Dialog open={createOpen} onOpenChange={open => { if (!submitting.current) { setCreateOpen(open); if (!open) setCreated(null) } }}>
        <DialogContent className="gap-y-4">
          {!created ? (
            <form
              className="grid gap-y-4"
              onSubmit={(e) => {
                e.preventDefault()
                save()
              }}
            >
              <DialogHeader>
                <DialogTitle>Chave de API</DialogTitle>
              </DialogHeader>
              <div className="mt-1.5 grid gap-2">
                <Label htmlFor="api-key-name" className={touched && createErr ? 'text-destructive' : undefined}>Nome</Label>
                <Input
                  id="api-key-name"
                  disabled={busy}
                  autoFocus
                  value={name}
                  aria-invalid={touched && !!createErr}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={(e) => {
                    // Sair do campo para um botão (Cancelar, fechar ×, Salvar) não exibe a validação: Cancelar/fechar
                    // descartam o formulário e Salvar valida por conta própria.
                    if ((e.relatedTarget as HTMLElement | null)?.closest('button')) return
                    setTouched(true)
                  }}
                  placeholder="Chave de API de produção do make.com"
                />
                {touched && createErr && <p className="text-sm font-medium text-destructive">{createErr}</p>}
              </div>
              <DialogFooter>
                <Button type="button" variant="secondary" disabled={busy} onClick={() => setCreateOpen(false)}>Cancelar</Button>
                <Button type="submit" disabled={busy}>Salvar</Button>
              </DialogFooter>
            </form>
          ) : (
            <div className="grid gap-y-4">
              <DialogHeader className="gap-y-2">
                <DialogTitle className="flex items-center gap-2"><KeyRound className="h-4 w-4" /> Chave criada: {created.name}</DialogTitle>
                <DialogDescription>Copie a chave agora e guarde-a em um local seguro.</DialogDescription>
              </DialogHeader>
              <Alert variant="warning">
                <TriangleAlert />
                <div>Por segurança, esta chave será exibida <b>somente uma vez</b>. Depois de fechar esta janela, apenas os últimos 4 caracteres ficarão visíveis.</div>
              </Alert>
              <div className="flex gap-2">
                <Input readOnly value={created.secret} className="font-mono text-xs" aria-label="Chave de API gerada" onFocus={(e) => e.currentTarget.select()} data-testid="api-secret" />
                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0 gap-1.5"
                  onClick={async () => {
                    const ok = await copy(created.secret)
                    // "Copiada" só quando a área de transferência aceitou o texto; na falha, seleciona a chave para cópia manual.
                    setCopied(ok)
                    if (!ok) {
                      const el = document.querySelector<HTMLInputElement>('[data-testid="api-secret"]')
                      el?.focus()
                      el?.select()
                    }
                    toast[ok ? 'success' : 'info'](ok ? 'Chave copiada' : 'Não foi possível copiar automaticamente', ok ? undefined : { description: 'A chave foi selecionada: use Ctrl+C (ou ⌘+C) para copiar.' })
                  }}
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? 'Copiada' : 'Copiar'}
                </Button>
              </div>
              <DialogFooter>
                <Button onClick={() => { setCreateOpen(false); setCreated(null) }}>Concluir</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Renomear */}
      <Dialog open={!!rename} onOpenChange={(o) => !o && setRename(null)}>
        <DialogContent className="gap-y-4">
          <form
            className="grid gap-y-4"
            onSubmit={async (e) => {
              e.preventDefault()
              if (!rename || nameError(renameValue, rename.id) || submitting.current || !commands) return
              submitting.current = true; setBusy(true)
              try { await commands.rename(rename.id, renameValue); toast.success('Chave renomeada'); setRename(null) }
              catch (error) { toast.error(error instanceof Error ? error.message : 'Não foi possível renomear a chave.') }
              finally { submitting.current = false; setBusy(false) }
            }}
          >
            <DialogHeader>
              <DialogTitle>Renomear chave de API</DialogTitle>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor="api-key-rename">Nome</Label>
              <Input id="api-key-rename" autoFocus value={renameValue} onChange={(e) => setRenameValue(e.target.value)} aria-invalid={!!(rename && nameError(renameValue, rename.id))} />
              {rename && nameError(renameValue, rename.id) && <p className="text-sm font-medium text-destructive">{nameError(renameValue, rename.id)}</p>}
            </div>
            <DialogFooter className="mt-2">
              <Button type="button" variant="secondary" onClick={() => setRename(null)}>Cancelar</Button>
              <Button type="submit" disabled={busy || !rename || !!nameError(renameValue, rename.id) || renameValue.trim() === rename.name}>Salvar</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!revoke}
        onOpenChange={(o) => !o && setRevoke(null)}
        title="Revogar chave de API?"
        description={revoke ? <>A chave <b>{revoke.name}</b> ({maskKey(revoke)}) deixará de funcionar imediatamente e será removida da lista. Esta ação não pode ser desfeita.</> : null}
        confirmLabel="Revogar"
        onConfirm={async () => {
          if (!revoke || !commands) return
          await commands.revoke(revoke.id)
          toast.success('Chave revogada', { description: revoke.name })
        }}
      />
    </div>
  )
}
