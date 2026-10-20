import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { ChevronDown, Copy, ExternalLink, Eye, EyeOff, X, Globe, ImageUp, Info, Play, Plus, QrCode as QrIcon, RotateCcw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { WebchatSetup } from '@/domain/ext/mais-a'
import '@/domain/ext/mais-a'
import { cn } from '@/lib/utils'
import { useCollection, useCurrentOrg, useEntity, useStore } from '@/data/store'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ConfirmDialog } from '@/components/app/ConfirmDialog'
import { QrCode } from '@/app/pages/agents/resources/shared/QrCode'
import { validateSlug } from '@/app/pages/company-settings/CompanySettingsPage'
import { AgentPicture, ChatWindow, DefaultAvatar, type ChatMsg } from './ChatWindow'
import { PageLoadError, PageSkeleton } from '@/components/app/PageLoad'
import { engineSession } from '@/services/engine/session'
import { captureEngineContext } from '@/services/engine/session'
import { createHostedLinkService, type HostedView } from '@/services/engine/hosted-webchat'
import { webchatCommands, webchatSetup, unsupportedWebchat, webchatAvailabilityMessage } from '@/services/casca/webchat'
import type { WebchatChannel } from '@/services/engine/webchat'
import {
  DEFAULT_ACCENT,
  GREETING_MAX,
  defaultGreeting,
  defaultWebchat,
  displayNameOf,
  hostedUrl,
  slugify,
  validateAssistantSlug,
  validateOrigin,
  webchatOf,
} from './model'

export type WebchatTab = 'widget' | 'hosted' | 'customize'

/** Mesmos textos do motor (webchat-hosted.ts) para requisitos do link hospedado. */
const hostedReasonText = (reasons: string[]) => reasons.includes('agent_missing') ? 'Assistente não encontrado nesta organização.'
  : reasons.includes('agent_inactive') ? 'Ative o assistente antes de publicar o link hospedado.'
  : reasons.includes('installation_unavailable') ? 'O endereço público da Kloel não está configurado.'
  : 'A IA da Kloel ainda não está disponível para esta organização.'

const CUSTOMIZE_KEYS = ['avatar', 'avatarUpload', 'avatarBorder', 'displayName', 'attachments', 'theme', 'accent', 'accentMode'] as const

function ActiveBadge() {
  return <span className="inline-flex h-[18px] items-center rounded-full bg-brand/10 px-1.5 text-[10px] font-medium text-brand">Ativo</span>
}

function BetaPill() {
  return <span className="inline-flex h-5 items-center rounded-full bg-brand px-2 text-[10px] font-semibold uppercase tracking-wide text-white">Beta</span>
}

function GreetingField({ id, value, onChange, help, placeholder }: { id: string; value: string; onChange: (v: string) => void; help: string; placeholder: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        Mensagem de saudação
      </label>
      <Textarea id={id} rows={4} value={value} maxLength={GREETING_MAX} placeholder={placeholder} onChange={(e) => onChange(e.target.value.slice(0, GREETING_MAX))} />
      <div className="flex items-start justify-between gap-4">
        <p className="text-xs text-muted-foreground">{help}</p>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground" data-testid={`${id}-count`}>
          {value.length}/{GREETING_MAX}
        </span>
      </div>
    </div>
  )
}

function Accordion({ title, description, open, onToggle, children }: { title: string; description: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div className="rounded-xl border">
      <button type="button" aria-expanded={open} onClick={onToggle} className="flex w-full items-center gap-3 px-4 py-3.5 text-left">
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{title}</span>
          <span className="block text-xs text-muted-foreground">{description}</span>
        </span>
        <ChevronDown className={cn('size-4 shrink-0 transition-transform', open && 'rotate-180')} />
      </button>
      {open && <div className="space-y-4 border-t px-4 py-4">{children}</div>}
    </div>
  )
}

async function readAvatar(file: File): Promise<{ dataUrl: string } | { error: string }> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return { error: 'Use uma imagem PNG, JPEG ou WebP.' }
  if (file.size > 1024 * 1024) return { error: 'A imagem pode ter no máximo 1 MB.' }
  const dataUrl = await new Promise<string>((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result))
    r.onerror = () => rej(new Error('read'))
    r.readAsDataURL(file)
  })
  const dims = await new Promise<{ w: number; h: number }>((res) => {
    const img = new Image()
    img.onload = () => res({ w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = () => res({ w: 0, h: 0 })
    img.src = dataUrl
  })
  if (!dims.w || dims.w !== dims.h) return { error: 'A imagem precisa ser quadrada.' }
  if (dims.w < 128 || dims.w > 1024) return { error: 'Use uma imagem entre 128 e 1024 px.' }
  return { dataUrl }
}



/**
 * "Configurar/Gerenciar Webchat" do assistente de chat (OBSERVADO: central de ajuda products/webchat, WC-08…WC-12 e WC-14):
 * abas Widget do site · Link hospedado · Personalizar, com prévia Widget/Hospedado. Grava Agent.webchatSetup e o slug da empresa.
 */
export function WebchatDialog({ agentId, open, onOpenChange, initialTab = 'widget' }: { agentId?: string; open: boolean; onOpenChange: (o: boolean) => void; initialTab?: WebchatTab }) {
  const session = useSyncExternalStore(engineSession.subscribe, engineSession.getSnapshot)
  return <WebchatEditor key={`${session.generation}:${session.data?.identity.context.userId}:${session.data?.identity.context.tenantId}:${agentId}`} agentId={agentId} open={open} onOpenChange={onOpenChange} initialTab={initialTab} />
}

function WebchatEditor({ agentId, open, onOpenChange, initialTab = 'widget' }: { agentId?: string; open: boolean; onOpenChange: (o: boolean) => void; initialTab?: WebchatTab }) {
  const agent = useEntity('agents', agentId)
  const agents = useCollection('agents')
  const org = useCurrentOrg()
  const orgs = useStore((s) => s.db.organizations)
  const saved = useMemo(() => (agent ? webchatOf(agent) : undefined), [agent])
  const [tab, setTab] = useState<WebchatTab>(initialTab)
  const [draft, setDraft] = useState<WebchatSetup>()
  const [orgSlug, setOrgSlug] = useState('')
  const [siteErrors, setSiteErrors] = useState<Record<number, string>>({})
  const [preview, setPreview] = useState(true)
  const [previewKind, setPreviewKind] = useState<'widget' | 'hosted'>('widget')
  const [frame, setFrame] = useState<'desktop' | 'mobile'>('desktop')
  const [, setPlayed] = useState(0)
  const [openSections, setOpenSections] = useState<string[]>(['identity'])
  const [confirm, setConfirm] = useState<'widget' | 'hosted'>()
  const [avatarError, setAvatarError] = useState<string>()
  const fileRef = useRef<HTMLInputElement>(null)
  const timers = useRef<number[]>([])
  const commands = useMemo(() => agentId ? webchatCommands(agentId) : null, [agentId])
  const [channel, setChannel] = useState<WebchatChannel | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [retry, setRetry] = useState(0)
  const running = useRef(false)
  const hostedApi = useMemo(() => { try { return agentId ? createHostedLinkService(captureEngineContext(), agentId) : null } catch { return null } }, [agentId])
  const [hostedView, setHostedView] = useState<HostedView | null>(null)
  const canEditOrg = engineSession.can('organization:write'), canWrite = engineSession.can('channels:write')
  const alive = useRef(true)

  useEffect(() => {
    if (open && agent) {
      setTab(initialTab)
      const w = webchatOf(agent)
      setDraft({ ...w, assistantSlug: w.assistantSlug ?? slugify(agent.name) })
      setOrgSlug(org?.slug ?? '')
      setSiteErrors({})
      setAvatarError(undefined)
      setPlayed(0)
    }
    return () => timers.current.forEach((t) => window.clearTimeout(t))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, agentId])

  useEffect(() => {
    alive.current = true
    let current = true
    if (!open || !commands) return
    setLoading(true); setLoadError(undefined)
    // Widget (canal) e link hospedado (publicação no mesmo canal) chegam juntos do motor.
    void Promise.all([commands.load(), hostedApi ? hostedApi.read() : Promise.reject(Error('Abra sua sessão novamente.'))]).then(([row, view]) => {
      if (!current) return
      setChannel(row); setHostedView(view)
      setOrgSlug(view.customOrgSlug ?? (canEditOrg ? org?.slug || slugify(org?.name ?? '') : view.technicalSlug))
      setDraft(d => d ? { ...d, ...webchatSetup(row), ...(view.hosted ? { assistantSlug: view.hosted.assistantSlug, hostedGreeting: view.hosted.greeting } : {}) } : d); setLoading(false)
    }, error => {
      if (!current) return
      setLoadError(error instanceof Error ? error.message : 'Não foi possível consultar o widget.'); setLoading(false)
    })
    return () => { current = false; alive.current = false }
  }, [open, commands, hostedApi, retry])

  if (!agent || !saved || !draft) return null
  const set = (p: Partial<WebchatSetup>) => setDraft((d) => (d ? { ...d, ...p } : d))
  // O canal também atende o link hospedado: widget ativo = canal disponível COM sites permitidos.
  const wActive = channel?.readiness.available === true && channel.configuration.allowedOrigins.length > 0
  const hosted = hostedView?.hosted ?? null
  const hActive = hosted?.published === true
  const publishedOrgSlug = hostedView ? hostedView.customOrgSlug ?? hostedView.technicalSlug : ''
  const name = displayNameOf(draft, agent)
  const greeting = (previewKind === 'widget' ? draft.widgetGreeting : draft.hostedGreeting).trim() || defaultGreeting(agent, org?.name)

  const slugErr = validateAssistantSlug(draft.assistantSlug ?? '', agent.id, agents)
  const orgErr = canEditOrg && orgSlug !== hostedView?.customOrgSlug ? validateSlug(orgSlug, org?.id, orgs) : null
  const normalize = (w: WebchatSetup) => JSON.stringify({ ...w, hostedEnabled: undefined, assistantSlug: undefined, hostedGreeting: undefined })
  const dirty = normalize(draft) !== normalize(saved)
  const hostedDirty = hActive && (orgSlug !== publishedOrgSlug || draft.assistantSlug !== hosted?.assistantSlug || draft.hostedGreeting.trim() !== hosted?.greeting)
  // Configuração inicial do link hospedado: "Salvar" publica (OBSERVADO WC-12); no widget, só com site (WC-09 × WC-10)
  const canSave = tab === 'hosted' ? canWrite && !!hostedView && !slugErr && !orgErr && (!hActive || hostedDirty) : dirty || tab === 'widget' && !wActive && draft.allowedSites.length > 0

  const title =
    tab === 'customize' ? 'Personalizar Chatbot de IA' : tab === 'widget' ? (wActive ? 'Gerenciar widget do site' : 'Configurar widget do site') : hActive ? 'Gerenciar Webchat' : 'Configurar Webchat'
  const subtitle =
    tab === 'customize' ? 'Personalize como este assistente aparece nas experiências do Chatbot de IA.' : tab === 'widget' ? 'Controle quais sites podem incorporar este assistente.' : 'Configure o link hospedado deste assistente.'

  async function save() {
    if (!agent || !draft || !commands || running.current || loading || loadError) return
    if (tab === 'hosted') return saveHosted()
    if (tab !== 'widget') { try { unsupportedWebchat(tab) } catch (error) { toast.error((error as Error).message) }; return }
    const errs: Record<number, string> = {}
    draft.allowedSites.forEach((s, i) => {
      const e = validateOrigin(s, draft.allowedSites.filter((_, j) => j !== i && j < i))
      if (e) errs[i] = e
    })
    setSiteErrors(errs)
    if (Object.keys(errs).length) {
      setTab('widget')
      return
    }
    running.current = true; setBusy(true)
    try {
      const result = await commands.saveWidget(channel, { name: agent.name, allowedSites: draft.allowedSites, greeting: draft.widgetGreeting.trim() || defaultGreeting(agent, org?.name), keepEnabled: hActive })
      if (!alive.current) return
      setChannel(result.channel); setDraft(d => d ? { ...d, ...webchatSetup(result.channel) } : d)
      if (result.recovered) toast('A alteração anterior foi confirmada. Confira a configuração antes de salvar novamente.')
      else if (!result.channel.configuration.allowedOrigins.length) toast.success('Widget do site desativado')
      else if (result.channel.readiness.available) toast.success(wActive ? 'Widget do site salvo' : 'Widget do site ativado')
      else toast(webchatAvailabilityMessage(result.channel))
    } catch (error) { if (alive.current) { const message = error instanceof Error ? error.message : 'Não foi possível salvar o widget.'; setLoadError(message); toast.error(message) } }
    finally { running.current = false; if (alive.current) setBusy(false) }
  }

  /** Recarrega o canal depois de publicar/despublicar (a versão do canal muda junto com o link). */
  async function refreshChannel() {
    if (!commands) return
    const row = await commands.load()
    if (alive.current) { setChannel(row); setDraft(d => d ? { ...d, ...webchatSetup(row) } : d) }
  }

  /** Link hospedado: grava a URL da empresa (se mudou) e publica /w/<empresa>/<assistente> no canal do assistente — sem mexer nos sites do widget. */
  async function saveHosted() {
    if (!agent || !draft || !hostedApi || running.current || loading || loadError) return
    if (slugErr || orgErr) { toast.error(slugErr || orgErr || ''); return }
    running.current = true; setBusy(true)
    try {
      // Requisitos atuais antes de qualquer gravação (o slug da empresa só muda se o link puder ser publicado).
      const fresh = await hostedApi.read()
      if (!alive.current) return
      setHostedView(fresh)
      if (fresh.reasons.length) throw Error(hostedReasonText(fresh.reasons))
      if (canEditOrg && orgSlug !== fresh.customOrgSlug) {
        const saved = await captureEngineContext('organization:write').request<{ slug: string }>('/organization/public-slug', { method: 'PUT', body: { slug: orgSlug } })
        if (alive.current) setHostedView(v => v ? { ...v, orgSlug: saved.slug, customOrgSlug: saved.slug } : v)
      }
      const view = await hostedApi.publish({ assistantSlug: draft.assistantSlug ?? '', greeting: draft.hostedGreeting.trim() || defaultGreeting(agent, org?.name) })
      if (!alive.current) return
      setHostedView(view); setOrgSlug(view.orgSlug)
      if (view.hosted) { const h = view.hosted; setDraft(d => d ? { ...d, assistantSlug: h.assistantSlug, hostedGreeting: h.greeting } : d) }
      toast.success(hActive ? 'Link hospedado salvo' : 'Link hospedado publicado', { description: view.hosted ? window.location.origin + view.hosted.path : undefined })
      await refreshChannel().catch(() => {})
    } catch (error) { if (alive.current) toast.error(error instanceof Error ? error.message : 'Não foi possível publicar o link.') }
    finally { running.current = false; if (alive.current) setBusy(false) }
  }

  async function remove(kind: 'widget' | 'hosted') {
    if (kind === 'hosted') {
      if (!hostedApi || running.current) return
      running.current = true; setBusy(true)
      try {
        const view = await hostedApi.unpublish()
        if (!alive.current) return
        setHostedView(view)
        if (view.hosted?.published) throw Error('O link hospedado continua publicado. Confira a configuração.')
        toast.success('Webchat removido', { description: 'O link hospedado deixou de funcionar.' })
        await refreshChannel().catch(() => {})
      } catch (error) { if (alive.current) toast.error(error instanceof Error ? error.message : 'Não foi possível remover o link.'); throw error }
      finally { running.current = false; if (alive.current) setBusy(false) }
      return
    }
    if (!commands || running.current) return
    running.current = true; setBusy(true)
    try {
      const result = await commands.removeWidget(channel, hActive)
      if (!alive.current) return
      setChannel(result.channel); setDraft(d => d ? { ...d, ...webchatSetup(result.channel) } : d)
      if (result.recovered) toast('A alteração anterior foi confirmada. Confira o widget antes de removê-lo.')
      else if (result.channel.enabled && !hActive || result.channel.configuration.allowedOrigins.length) throw Error('O widget continua habilitado. Confira a configuração.')
      else toast.success('Widget do site removido', { description: 'O script deixa de carregar o chat nos sites.' })
    } catch (error) { if (alive.current) setLoadError(error instanceof Error ? error.message : 'Não foi possível remover o widget.'); throw error }
    finally { running.current = false; if (alive.current) setBusy(false) }
  }

  function play(kind: 'desktop' | 'mobile') {
    timers.current.forEach((t) => window.clearTimeout(t))
    setFrame(kind)
    setPlayed(0)
    timers.current = [window.setTimeout(() => setPlayed(1), 600), window.setTimeout(() => setPlayed(2), 1600)]
  }

  const copy = async (v: string, label: string) => {
    try {
      await navigator.clipboard.writeText(v)
      toast.success(`${label} copiado`)
    } catch {
      toast.error('Não foi possível copiar automaticamente', { description: 'Selecione o texto e copie manualmente.' })
    }
  }

  const previewMsgs: ChatMsg[] = [{ id: 'g', from: 'assistant', text: greeting }]
  const showPreview = tab === 'customize' && preview
  const url = hActive && hosted ? `${window.location.origin}${hosted.path}` : hostedUrl(orgSlug || 'empresa', draft.assistantSlug || 'assistente')

  const tabs: { v: WebchatTab; label: string; active?: boolean }[] = [
    { v: 'widget', label: showPreview ? 'Widget' : 'Widget do site', active: wActive },
    { v: 'hosted', label: showPreview ? 'Hospedado' : 'Link hospedado', active: hActive },
    { v: 'customize', label: 'Personalizar' },
  ]

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className={cn('max-h-[calc(100vh-2rem)] gap-0 overflow-hidden p-0', showPreview ? 'sm:max-w-[900px]' : 'sm:max-w-[600px]')} hideClose onOpenAutoFocus={(e) => e.preventDefault()}>
          <div className={cn('grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)]', showPreview && 'md:grid-cols-[minmax(0,1fr)_340px]')}>
            <div className="flex max-h-[calc(100vh-2rem)] min-h-0 min-w-0 flex-col">
              <div className="space-y-1 px-6 pb-4 pt-6">
                <div className="flex items-start gap-3">
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                    <DialogTitle className="text-xl font-semibold leading-8">{title}</DialogTitle>
                    {tab !== 'customize' && <BetaPill />}
                  </div>
                  {tab === 'customize' && (
                    <button type="button" onClick={() => setPreview((p) => !p)} className="mt-1 hidden shrink-0 items-center gap-1.5 text-sm font-medium md:inline-flex">
                      {preview ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                      {preview ? 'Ocultar prévia' : 'Mostrar prévia'}
                    </button>
                  )}
                  <DialogClose className="mt-1.5 shrink-0 rounded-sm opacity-70 hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring">
                    <X className="size-4" />
                    <span className="sr-only">Fechar</span>
                  </DialogClose>
                </div>
                <DialogDescription className="text-sm text-muted-foreground">{subtitle}</DialogDescription>
                <div role="tablist" aria-label="Seções do Webchat" className="mt-3 grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
                  {tabs.map((t) => (
                    <button
                      key={t.v}
                      type="button"
                      role="tab"
                      aria-selected={tab === t.v}
                      onClick={() => setTab(t.v)}
                      className={cn('inline-flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-md px-2 text-sm font-medium', tab === t.v ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
                    >
                      <span className="truncate">{t.label}</span>
                      {t.active && <ActiveBadge />}
                    </button>
                  ))}
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto border-t px-6 py-6" aria-busy={loading || busy}>
                {loading ? <PageSkeleton rows={2} /> : loadError ? <PageLoadError description={loadError} onRetry={() => setRetry(value => value + 1)} /> : <>
                {tab === 'widget' && (
                  <div className="space-y-6">
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-sm font-medium">Sites permitidos</p>
                          <p className="text-sm text-muted-foreground">Adicione a origem exata de cada site que pode incorporar o widget, por exemplo https://exemplo.com.br.</p>
                        </div>
                        <Button type="button" variant="outline" className="shrink-0 gap-1.5" onClick={() => set({ allowedSites: [...draft.allowedSites, ''] })}>
                          <Plus className="size-4" />
                          Adicionar site
                        </Button>
                      </div>
                      {draft.allowedSites.length === 0 ? (
                        <div className="flex items-center gap-2.5 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
                          <Info className="size-4 shrink-0 text-blue-600" />
                          Adicione pelo menos um site para ativar o widget.
                        </div>
                      ) : (
                        draft.allowedSites.map((s, i) => (
                          <div key={i} className="space-y-1">
                            <div className="flex items-center gap-2">
                              <Input
                                aria-label={`Site permitido ${i + 1}`}
                                placeholder="https://exemplo.com.br"
                                value={s}
                                aria-invalid={!!siteErrors[i] || undefined}
                                autoFocus={!s}
                                onChange={(e) => {
                                  set({ allowedSites: draft.allowedSites.map((x, j) => (j === i ? e.target.value : x)) })
                                  setSiteErrors((m) => ({ ...m, [i]: '' }))
                                }}
                                className="h-10"
                              />
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label={`Remover site ${i + 1}`}
                                onClick={() => {
                                  set({ allowedSites: draft.allowedSites.filter((_, j) => j !== i) })
                                  setSiteErrors({})
                                }}
                              >
                                <Trash2 className="size-4" />
                              </Button>
                            </div>
                            {siteErrors[i] && <p className="text-xs font-medium text-destructive">{siteErrors[i]}</p>}
                          </div>
                        ))
                      )}
                    </div>
                    <GreetingField
                      id="wc-widget-greeting"
                      value={draft.widgetGreeting}
                      onChange={(v) => set({ widgetGreeting: v })}
                      placeholder={defaultGreeting(agent, org?.name)}
                      help="Exibida como a primeira mensagem do assistente em cada nova conversa do widget. Deixe vazio para usar a saudação do assistente (ou o padrão do idioma)."
                    />
                    {wActive && channel?.installation && (
                      <div className="space-y-2">
                        <p className="text-sm font-medium">Instalação</p>
                        <p className="text-sm text-muted-foreground">Cole este script no HTML do seu site, de preferência antes do fechamento da tag &lt;/body&gt;. Inclua-o em todas as páginas em que o widget deve aparecer.</p>
                        <div className="relative rounded-lg border bg-muted/40 p-3 pr-10">
                          <pre className="overflow-x-auto whitespace-pre font-mono text-xs leading-5" data-testid="wc-script">
                            {channel?.installation?.snippet ?? ''}
                          </pre>
                          <Button type="button" variant="ghost" size="icon-xs" aria-label="Copiar script" className="absolute right-2 top-2" disabled={!channel?.installation || busy} onClick={() => channel?.installation && copy(channel.installation.snippet, 'Script')}>
                            <Copy className="size-4" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {tab === 'hosted' && (
                  <div className="space-y-6">
                    <div className="flex items-center justify-between gap-4 rounded-lg border px-4 py-3">
                      <div>
                        <p className="text-sm font-medium">Link público</p>
                        <p className="text-xs text-muted-foreground">{hActive ? 'Publicado: qualquer pessoa com o link conversa com este assistente.' : 'Publique para que qualquer pessoa com o link converse com este assistente, sem instalar o widget.'}</p>
                      </div>
                      <Switch aria-label="Publicar link hospedado" checked={hActive} disabled={busy || !canWrite || (!hActive && (!!slugErr || !!orgErr))} onCheckedChange={(v) => (v ? void saveHosted() : setConfirm('hosted'))} />
                    </div>
                    {hActive && hostedView && !hostedView.available && (
                      <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" data-testid="wc-hosted-warning">
                        <Info className="mt-0.5 size-4 shrink-0 text-amber-600" />
                        {hostedView.reasons.includes('agent_inactive') || hostedView.reasons.includes('agent_missing') ? 'O assistente não está ativo: o link mostra "Chatbot indisponível" até você ativá-lo.' : 'A IA da Kloel está indisponível no momento: o link mostra uma mensagem de atendimento indisponível.'}
                      </div>
                    )}
                    <div className="space-y-1.5">
                      <label htmlFor="wc-org-slug" className={cn('text-sm font-medium', orgErr && 'text-destructive')}>
                        Slug da empresa
                      </label>
                      <Input id="wc-org-slug" value={orgSlug} disabled={!canEditOrg} aria-invalid={!!orgErr || undefined} onChange={(e) => setOrgSlug(e.target.value.toLowerCase())} className="h-10" />
                      <p className="text-sm text-muted-foreground">{canEditOrg ? 'Este slug é compartilhado por todas as URLs de Webchat hospedado e de agendamento da sua empresa.' : 'Somente administradores alteram o slug da empresa (Configurações da empresa).'}</p>
                      {orgErr ? <p className="text-xs font-medium text-destructive">{orgErr}</p> : (!hActive || orgSlug !== publishedOrgSlug) && <p className="text-xs text-muted-foreground">Ainda não publicado</p>}
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor="wc-agent-slug" className={cn('text-sm font-medium', slugErr && 'text-destructive')}>
                        Slug do assistente
                      </label>
                      <Input id="wc-agent-slug" value={draft.assistantSlug ?? ''} aria-invalid={!!slugErr || undefined} onChange={(e) => set({ assistantSlug: e.target.value.toLowerCase() })} className="h-10" />
                      <p className="text-sm text-muted-foreground">Este slug identifica o assistente na URL do Webchat e precisa ser único na sua empresa.</p>
                      {slugErr ? <p className="text-xs font-medium text-destructive">{slugErr}</p> : (!hActive || draft.assistantSlug !== hosted?.assistantSlug) && <p className="text-xs text-muted-foreground">Ainda não publicado</p>}
                    </div>
                    <div className="overflow-hidden rounded-lg border bg-muted/30">
                      <p className="border-b px-3 py-2 text-xs text-muted-foreground">URL do Webchat</p>
                      <div className="flex items-center gap-2 px-3 py-3">
                        <Globe className="size-5 shrink-0 text-muted-foreground" />
                        <span className="flex min-w-0 flex-1 text-sm" data-testid="wc-hosted-url">
                          {hActive && hosted ? (
                            <>
                              {/* Vem do hosted.path do motor: o mesmo endereço que Copiar, QR e Abrir usam. */}
                              <span className="truncate text-muted-foreground">{`${window.location.origin}${hosted.path.slice(0, hosted.path.length - hosted.assistantSlug.length)}`}</span>
                              <span className="max-w-[60%] shrink-0 truncate font-semibold">{hosted.assistantSlug}</span>
                            </>
                          ) : (
                            <span className="truncate text-muted-foreground">Não publicado</span>
                          )}
                        </span>
                        <Button type="button" variant="ghost" size="icon-xs" aria-label="Copiar URL do Webchat" disabled={!hActive} onClick={() => copy(url, 'Link')}>
                          <Copy className="size-4" />
                        </Button>
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button type="button" variant="ghost" size="icon-xs" aria-label="Mostrar QR code" disabled={!hActive}>
                              <QrIcon className="size-4" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-4 text-center" align="end">
                            <QrCode value={url} size={160} />
                          </PopoverContent>
                        </Popover>
                        {hActive ? (
                          <Button variant="ghost" size="icon-xs" aria-label="Abrir Webchat" asChild>
                            <a href={url} target="_blank" rel="noopener noreferrer"><ExternalLink className="size-4" /></a>
                          </Button>
                        ) : (
                          <Button type="button" variant="ghost" size="icon-xs" aria-label="Abrir Webchat" disabled><ExternalLink className="size-4" /></Button>
                        )}
                      </div>
                    </div>
                    <GreetingField
                      id="wc-hosted-greeting"
                      value={draft.hostedGreeting}
                      onChange={(v) => set({ hostedGreeting: v })}
                      placeholder={defaultGreeting(agent, org?.name)}
                      help="Exibida como a primeira mensagem do assistente em cada nova conversa. Deixe vazio para usar a saudação do assistente (ou o padrão do idioma)."
                    />
                  </div>
                )}

                {tab === 'customize' && (
                  <div className="space-y-3">
                    <Accordion title="Identidade" description="Escolha o nome e a foto que os visitantes veem." open={openSections.includes('identity')} onToggle={() => setOpenSections((o) => (o.includes('identity') ? o.filter((x) => x !== 'identity') : [...o, 'identity']))}>
                      <div className="space-y-2">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Foto</p>
                        <div className="flex items-center gap-3">
                          {(['feminino', 'masculino'] as const).map((k) => (
                            <button key={k} type="button" aria-label={`Avatar padrão ${k}`} aria-pressed={draft.avatar === k} onClick={() => set({ avatar: k })} className={cn('size-16 overflow-hidden rounded-full ring-offset-2', draft.avatar === k ? 'ring-2 ring-foreground' : 'hover:ring-1 hover:ring-border')}>
                              <DefaultAvatar kind={k} className="size-full" />
                            </button>
                          ))}
                          <span className="h-12 w-px bg-border" />
                          {draft.avatarUpload && (
                            <button type="button" aria-label="Foto enviada" aria-pressed={draft.avatar === 'upload'} onClick={() => set({ avatar: 'upload' })} className={cn('size-16 overflow-hidden rounded-full ring-offset-2', draft.avatar === 'upload' ? 'ring-2 ring-foreground' : 'hover:ring-1 hover:ring-border')}>
                              <img src={draft.avatarUpload.dataUrl} alt="" className="size-full object-cover" />
                            </button>
                          )}
                          <button type="button" aria-label="Enviar foto" onClick={() => fileRef.current?.click()} className="flex size-16 items-center justify-center rounded-full border hover:bg-muted/50">
                            <ImageUp className="size-5" />
                          </button>
                          <input
                            ref={fileRef}
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            className="hidden"
                            aria-label="Arquivo da foto"
                            onChange={async (e) => {
                              const f = e.target.files?.[0]
                              e.target.value = ''
                              if (!f) return
                              const r = await readAvatar(f)
                              if ('error' in r) return setAvatarError(r.error)
                              setAvatarError(undefined)
                              set({ avatar: 'upload', avatarUpload: { name: f.name, dataUrl: r.dataUrl } })
                            }}
                          />
                        </div>
                        <p className="text-xs text-muted-foreground">Escolha um padrão ou envie a sua: PNG, JPEG ou WebP quadrado, de 128 a 1024 px, até 1 MB.</p>
                        {avatarError && <p className="text-xs font-medium text-destructive">{avatarError}</p>}
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="text-sm font-medium">Borda da foto</p>
                          <p className="text-xs text-muted-foreground">Mostra uma borda sutil ao redor da foto do assistente.</p>
                        </div>
                        <Switch aria-label="Borda da foto" checked={draft.avatarBorder} onCheckedChange={(v) => set({ avatarBorder: v })} />
                      </div>
                      <div className="space-y-1.5 border-t pt-4">
                        <label htmlFor="wc-display-name" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Nome de exibição
                        </label>
                        <Input id="wc-display-name" value={draft.displayName} maxLength={60} placeholder={agent.name} onChange={(e) => set({ displayName: e.target.value })} className="h-10" />
                        <p className="text-xs text-muted-foreground">Deixe vazio para acompanhar o nome do assistente automaticamente.</p>
                      </div>
                    </Accordion>
                    <Accordion title="Entrada de mensagem" description="Escolha o que os visitantes podem enviar no Chatbot de IA." open={openSections.includes('input')} onToggle={() => setOpenSections((o) => (o.includes('input') ? o.filter((x) => x !== 'input') : [...o, 'input']))}>
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="text-sm font-medium">Permitir anexos</p>
                          <p className="text-xs text-muted-foreground">Mostra o botão de clipe para os visitantes enviarem arquivos.</p>
                        </div>
                        <Switch aria-label="Permitir anexos" checked={draft.attachments} onCheckedChange={(v) => set({ attachments: v })} />
                      </div>
                    </Accordion>
                    <Accordion title="Tema e cores" description="Escolha um tema e como a cor de destaque é aplicada." open={openSections.includes('theme')} onToggle={() => setOpenSections((o) => (o.includes('theme') ? o.filter((x) => x !== 'theme') : [...o, 'theme']))}>
                      <div className="flex items-center justify-between gap-4">
                        <p className="text-sm font-medium">Tema</p>
                        <div role="radiogroup" aria-label="Tema" className="inline-flex rounded-lg bg-muted p-1">
                          {(
                            [
                              ['light', 'Claro'],
                              ['dark', 'Escuro'],
                            ] as const
                          ).map(([v, l]) => (
                            <button key={v} type="button" role="radio" aria-checked={draft.theme === v} onClick={() => set({ theme: v })} className={cn('h-7 rounded-md px-3 text-sm font-medium', draft.theme === v ? 'bg-background shadow-sm' : 'text-muted-foreground')}>
                              {l}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <label htmlFor="wc-accent" className="text-sm font-medium">
                          Cor de destaque
                        </label>
                        <div className="flex items-center gap-2">
                          <input type="color" aria-label="Escolher cor de destaque" value={/^#[0-9a-f]{6}$/i.test(draft.accent) ? draft.accent : DEFAULT_ACCENT} onChange={(e) => set({ accent: e.target.value })} className="h-9 w-10 cursor-pointer rounded-md border bg-background p-0.5" />
                          <Input id="wc-accent" value={draft.accent} onChange={(e) => set({ accent: e.target.value })} className={cn('h-9 w-28 font-mono text-[13px]', !/^#[0-9a-f]{6}$/i.test(draft.accent) && 'border-destructive')} />
                        </div>
                      </div>
                      {!/^#[0-9a-f]{6}$/i.test(draft.accent) && <p className="text-xs font-medium text-destructive">Use uma cor no formato #RRGGBB.</p>}
                      <div className="flex items-center justify-between gap-4">
                        <p className="text-sm font-medium">Aplicar a cor em</p>
                        <div role="radiogroup" aria-label="Aplicar a cor em" className="inline-flex rounded-lg bg-muted p-1">
                          {(
                            [
                              ['buttons', 'Botões'],
                              ['header', 'Cabeçalho e botões'],
                            ] as const
                          ).map(([v, l]) => (
                            <button key={v} type="button" role="radio" aria-checked={draft.accentMode === v} onClick={() => set({ accentMode: v })} className={cn('h-7 rounded-md px-3 text-sm font-medium', draft.accentMode === v ? 'bg-background shadow-sm' : 'text-muted-foreground')}>
                              {l}
                            </button>
                          ))}
                        </div>
                      </div>
                    </Accordion>
                  </div>
                )}
                </>}
              </div>

              <div className="flex flex-col-reverse gap-3 border-t px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  {tab === 'widget' && channel && (channel.enabled || channel.configuration.allowedOrigins.length > 0) && !loading && !loadError && (
                    <button type="button" disabled={busy} onClick={() => setConfirm('widget')} className="inline-flex items-center gap-2 text-sm font-medium text-red-600 hover:text-red-700">
                      <Trash2 className="size-4" />
                      Remover widget
                    </button>
                  )}
                  {tab === 'hosted' && hActive && (
                    <button type="button" onClick={() => setConfirm('hosted')} className="inline-flex items-center gap-2 text-sm font-medium text-red-600 hover:text-red-700">
                      <Trash2 className="size-4" />
                      Remover Webchat
                    </button>
                  )}
                  {tab === 'customize' && (
                    <button
                      type="button"
                      onClick={() => {
                        const d = defaultWebchat(agent)
                        set(Object.fromEntries(CUSTOMIZE_KEYS.map((k) => [k, d[k]])) as Partial<WebchatSetup>)
                        setAvatarError(undefined)
                      }}
                      className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
                    >
                      <RotateCcw className="size-4" />
                      Restaurar padrões
                    </button>
                  )}
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => onOpenChange(false)}>
                    Cancelar
                  </Button>
                  <Button onClick={save} disabled={busy || loading || !!loadError || !canSave || !/^#[0-9a-f]{6}$/i.test(draft.accent)}>
                    Salvar
                  </Button>
                </div>
              </div>
            </div>

            {showPreview && (
              <aside className="hidden min-h-0 flex-col gap-3 border-l bg-muted/20 p-4 md:flex" aria-label="Prévia">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold">Prévia</p>
                  <div className="flex gap-1.5">
                    <Button type="button" variant="outline" size="xs" className="gap-1" onClick={() => play('desktop')}>
                      <Play className="size-3" />
                      Desktop
                    </Button>
                    <Button type="button" variant="outline" size="xs" className="gap-1" onClick={() => play('mobile')}>
                      <Play className="size-3" />
                      Celular
                    </Button>
                  </div>
                </div>
                <div className="flex justify-end">
                  <div role="radiogroup" aria-label="Tipo de prévia" className="inline-flex rounded-lg border bg-background p-0.5">
                    {(
                      [
                        ['widget', 'Widget'],
                        ['hosted', 'Hospedado'],
                      ] as const
                    ).map(([v, l]) => (
                      <button key={v} type="button" role="radio" aria-checked={previewKind === v} onClick={() => setPreviewKind(v)} className={cn('h-7 rounded-md px-3 text-sm font-medium', previewKind === v ? 'bg-muted text-foreground' : 'text-muted-foreground')}>
                        {l}
                      </button>
                    ))}
                  </div>
                </div>
                <div className={cn('relative flex min-h-[480px] flex-1 flex-col rounded-xl bg-muted/50 p-3', frame === 'mobile' && 'mx-auto w-[230px]')} data-testid="wc-preview" data-frame={frame}>
                  {previewKind === 'widget' ? (
                    <>
                      <ChatWindow w={draft} name={name} messages={previewMsgs} compact className="h-[400px] rounded-xl border shadow-md" />
                      <span className="absolute bottom-3 right-3 flex size-11 items-center justify-center rounded-full text-white shadow-lg" style={{ backgroundColor: /^#[0-9a-f]{6}$/i.test(draft.accent) ? draft.accent : DEFAULT_ACCENT }} aria-hidden>
                        <span className="text-xl leading-none">×</span>
                      </span>
                    </>
                  ) : (
                    <ChatWindow w={draft} name={name} messages={previewMsgs} compact className="h-full min-h-[400px] rounded-lg border" />
                  )}
                </div>
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <AgentPicture w={draft} className="size-4" />
                  Prévia local. A publicação da personalização ainda não está disponível.
                </p>
              </aside>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(undefined)}
        title={confirm === 'widget' ? 'Remover widget do site?' : 'Remover Webchat?'}
        description={confirm === 'widget' ? 'Os sites permitidos serão apagados e o script deixará de carregar o chat. A saudação e a personalização continuam salvas.' : 'O link hospedado deixará de funcionar. Você pode ativá-lo novamente depois.'}
        confirmLabel={confirm === 'widget' ? 'Remover widget' : 'Remover Webchat'}
        onConfirm={() => confirm && remove(confirm)}
      />
    </>
  )
}
