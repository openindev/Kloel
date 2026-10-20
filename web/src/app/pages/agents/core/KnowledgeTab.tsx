import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ChevronRight, CirclePlus, Ellipsis, FileText, Globe, Loader2, Upload, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import type { KnowledgeEntry, KnowledgeSource } from '@/domain/types'
import '@/domain/ext/agents'
import { cn } from '@/lib/utils'
import { useCollection } from '@/data/store'
import { knowledgeCommands } from '@/services/casca/knowledge'
import { saveAgentFields } from '@/services/casca/agents'
import { SectionHeading } from '@/components/app/Page'
import { CountBadge } from '@/components/app/misc'
import { ConfirmDialog } from '@/components/app/ConfirmDialog'
import { Tabs, TabsContent, UnderlineTabsList, UnderlineTabsTrigger } from '@/components/ui/tabs'
import { Switch } from '@/components/ui/switch'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useAgentDraft } from './draft'
import { AddSiteDialog, CompanyInfoDialog, DocumentSheet, formatBytes } from './KnowledgeDialogs'
import { BusinessHoursSheet } from './BusinessHoursSheet'
import { KnowledgeEntries } from './KnowledgeEntries'
import { entriesOfSource } from './knowledge'

export function relativeTime(iso: string) {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime())
  const min = Math.round(diff / 60000)
  if (min < 1) return 'agora mesmo'
  if (min < 60) return `há ${min} ${min === 1 ? 'minuto' : 'minutos'}`
  const h = Math.round(min / 60)
  if (h < 24) return `há ${h} ${h === 1 ? 'hora' : 'horas'}`
  const d = Math.round(h / 24)
  if (d < 30) return `há ${d} ${d === 1 ? 'dia' : 'dias'}`
  const m = Math.round(d / 30)
  return `há ${m} ${m === 1 ? 'mês' : 'meses'}`
}

export { entriesOfSource } from './knowledge'

const deleteText = (label: string, n: number) =>
  n === 0 ? `A fonte "${label}" será excluída permanentemente.` : `A fonte "${label}" e ${n === 1 ? 'a entrada gerada' : `as ${n} entradas geradas`} a partir dela serão excluídas permanentemente.`

/**
 * Aba "Conhecimento" (OBSERVADO: fonio-live2/C-assistentes/80–91 + data/knowledge.json): abas Fontes / Informações com contador e
 * "Horário de funcionamento ›". Fontes: "Base de conhecimento" (N entradas + interruptor), uma linha por site/documento
 * ("Atualizado há…", "N páginas", "…" → Excluir), "Informações da empresa ›" e "⊕ Adicionar fonte" (Site / Documentos).
 */
export function KnowledgeTab() {
  const { agent } = useAgentDraft()
  // Como na referência, trocar Fontes / Informações não altera a URL (fica /agents/<id>/knowledge). Links antigos com
  // ?aba=informacoes ainda abrem a aba Informações; o parâmetro é removido da URL em seguida.
  const [params, setParams] = useSearchParams()
  const [view, setView] = useState<'fontes' | 'informacoes'>(() => (params.get('aba') === 'informacoes' ? 'informacoes' : 'fontes'))
  useEffect(() => {
    if (!params.has('aba')) return
    if (params.get('aba') === 'informacoes') setView('informacoes')
    const next = new URLSearchParams(params)
    next.delete('aba')
    setParams(next, { replace: true })
  }, [params, setParams])
  const allEntries = useCollection('knowledgeEntries')
  const allSources = useCollection('knowledgeSources')
  const entries = useMemo(() => allEntries.filter((e) => e.agentId === agent.id), [allEntries, agent.id])
  const sources = useMemo(() => allSources.filter((s) => s.agentId === agent.id), [allSources, agent.id])
  const [hoursOpen, setHoursOpen] = useState(false)
  const [siteOpen, setSiteOpen] = useState(false)
  const [docOpen, setDocOpen] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)
  const [toDelete, setToDelete] = useState<KnowledgeSource | null>(null)

  const saving = useRef(false)
  const [busy, setBusy] = useState(false)
  async function deleteSource(src: KnowledgeSource) {
    await knowledgeCommands(agent.id, src.id).remove(src.id)
    toast.success('Fonte excluída', { description: `${src.label} foi removida.` })
  }
  async function toggleKnowledge(enabled: boolean) {
    if (saving.current) return
    saving.current = true; setBusy(true)
    try {
      await saveAgentFields(agent, { knowledgeBaseEnabled: enabled })
      toast.success(enabled ? 'Base de conhecimento ativada' : 'Base de conhecimento desativada')
    } catch (error) { toast.error('Não foi possível salvar', { description: error instanceof Error ? error.message : 'Confira o acesso e tente novamente.' }) }
    finally { saving.current = false; setBusy(false) }
  }

  const kbOn = agent.knowledgeBaseEnabled

  return (
    <div className="mx-auto w-full max-w-[800px]">
      <SectionHeading>Conhecimento</SectionHeading>
      <Tabs value={view} onValueChange={(v) => setView(v === 'informacoes' ? 'informacoes' : 'fontes')}>
        <div className="flex flex-wrap items-end justify-between gap-x-4 border-b">
          <UnderlineTabsList>
            <UnderlineTabsTrigger value="fontes">
              Fontes <CountBadge>{sources.length}</CountBadge>
            </UnderlineTabsTrigger>
            <UnderlineTabsTrigger value="informacoes">
              Informações <CountBadge>{entries.length}</CountBadge>
            </UnderlineTabsTrigger>
          </UnderlineTabsList>
          <button type="button" onClick={() => setHoursOpen(true)} className="mb-1 flex h-10 items-center gap-2 rounded-md px-2 py-2 text-sm font-medium text-foreground hover:bg-transparent hover:underline sm:px-4">
            Horário de funcionamento
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <TabsContent value="fontes" className="mt-6">
          <div className="divide-y overflow-hidden rounded-xl border bg-white">
            <div className="flex items-center gap-3 p-4">
              <span className="flex-1 truncate text-sm font-medium text-foreground">Base de conhecimento</span>
              <span className="rounded-md border border-border px-2 py-0.5 text-xs font-medium text-foreground">
                {entries.length} {entries.length === 1 ? 'entrada' : 'entradas'}
              </span>
              <Switch
                checked={kbOn}
                aria-label="Base de conhecimento"
                disabled={busy}
                onCheckedChange={(value) => void toggleKnowledge(value)}
              />
            </div>
            {sources.map((src) => {
              const processing = src.status === 'processing'
              const Icon = src.type === 'website' ? Globe : FileText
              return (
                <div key={src.id} data-source-row={src.id} className="flex items-center gap-3 p-4">
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  {src.type === 'website' ? (
                    <a href={`https://${src.url ?? src.label}`} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-left text-sm leading-none">
                      <span className="font-medium text-foreground hover:underline">{src.label}</span>
                    </a>
                  ) : (
                    <span className="min-w-0 flex-1 truncate text-sm font-medium leading-none" title={src.fileName}>
                      {src.label}
                    </span>
                  )}
                  <span className="flex shrink-0 items-center gap-2">
                    {processing ? (
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Loader2 className="size-3.5 animate-spin" /> Importando…
                      </span>
                    ) : src.status === 'error' ? (
                      <span className="flex items-center gap-1 text-xs text-destructive" title={src.error}>
                        <AlertCircle className="size-3.5" /> Falha ao importar
                      </span>
                    ) : (
                      <span className="hidden text-xs text-muted-foreground sm:inline" title={new Date(src.updatedAt).toLocaleString('pt-BR')}>
                        Atualizado {relativeTime(src.updatedAt)}
                      </span>
                    )}
                    <span className="rounded-md border border-border px-2 py-0.5 text-xs font-medium text-foreground" title={src.type === 'document' ? formatBytes(src.sizeBytes) : undefined}>
                      {src.type === 'website' ? `${src.pages ?? 0} ${src.pages === 1 ? 'página' : 'páginas'}` : src.sizeBytes ? formatBytes(src.sizeBytes) : 'Mídia'}
                    </span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button type="button" aria-label="Ações" className="flex h-4 w-4 items-center justify-center text-muted-foreground hover:text-foreground">
                          <Ellipsis className="h-4 w-4" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => {
                          void knowledgeCommands(agent.id, `faq-${src.id}`).generate(src.id)
                            .then((n) => toast.success(n ? `${n} informações atualizadas` : 'Nenhuma informação nova'))
                            .catch((error: unknown) => toast.error(error instanceof Error ? error.message : 'Não foi possível gerar as informações'))
                        }}>
                          Gerar informações
                        </DropdownMenuItem>
                        <DropdownMenuItem className="text-red-500 focus:text-red-500" onSelect={() => setToDelete(src)}>
                          Excluir
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </span>
                </div>
              )
            })}
            <button type="button" onClick={() => setInfoOpen(true)} className="flex w-full items-center gap-3 p-4 text-left hover:bg-gray-50">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">Informações da empresa</p>
                <p className="truncate text-xs text-muted-foreground">Informações básicas sobre sua empresa</p>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="flex w-full items-center justify-center gap-2 p-3.5 text-sm font-medium text-brand hover:bg-gray-50">
                  <CirclePlus className="size-4" />
                  Adicionar fonte
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center">
                <DropdownMenuItem onSelect={() => setSiteOpen(true)}>
                  <Globe /> Site
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setDocOpen(true)}>
                  <Upload /> Mídias
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </TabsContent>

        <TabsContent value="informacoes" className="mt-6">
          <KnowledgeEntries agent={agent} entries={entries} />
        </TabsContent>
      </Tabs>

      <BusinessHoursSheet
        open={hoursOpen}
        onOpenChange={setHoursOpen}
        value={agent.businessHours}
        onSave={async (bh) => {
          await saveAgentFields(agent, { businessHours: bh })
          toast.success('Horário de funcionamento salvo')
        }}
      />
      <AddSiteDialog agent={agent} open={siteOpen} onOpenChange={setSiteOpen} />
      <DocumentSheet agent={agent} open={docOpen} onOpenChange={setDocOpen} />
      <CompanyInfoDialog agent={agent} open={infoOpen} onOpenChange={setInfoOpen} />
      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        description={toDelete ? deleteText(toDelete.label, entriesOfSource(entries, toDelete).length) : undefined}
        confirmLabel="Excluir fonte"
        onConfirm={async () => { if (toDelete) await deleteSource(toDelete) }}
      />
    </div>
  )
}
