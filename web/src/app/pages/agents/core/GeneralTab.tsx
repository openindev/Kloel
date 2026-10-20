import { Component, Suspense, lazy, useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, Info, Settings } from 'lucide-react'
import { voiceById } from '@/data/catalogs/voices'
import { LANGUAGES } from '@/data/catalogs/languages'
import { SectionHeading, SectionLabel, SettingsCard, SettingsRow } from '@/components/app/Page'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { SimpleTooltip } from '@/components/ui/tooltip'
import { useAgentDraft } from './draft'
import { ChatHandlingSection, ChatTimeoutRow } from './ChatGeneral'
import { FORMALITY_LANGUAGES, FORMALITY_OPTIONS } from './chatSettings'
import { GreetingEditor } from './GreetingEditor'
import { GreetingRulesSheet } from './GreetingRulesSheet'
import { VoiceAvatar, VoicePickerDialog } from './VoicePickerDialog'
import { FieldError, VarText, LEFT_CHECK_ITEM } from './ui'

const ResourcesGrid = lazy(() => import('./ResourcesGrid'))

function ResourcesSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3" aria-busy>
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="h-[98px] animate-pulse rounded-xl border border-dashed bg-muted/30" />
      ))}
    </div>
  )
}

/** Isola falhas do módulo de recursos (outro módulo) para não derrubar a página do assistente. */
class ResourcesBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch() {
    /* falha registrada no estado; exibida abaixo */
  }
  render() {
    if (this.state.failed)
      return (
        <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          Não foi possível carregar os recursos agora.{' '}
          <button type="button" className="font-medium text-brand hover:underline" onClick={() => window.location.reload()}>
            Recarregar
          </button>
        </div>
      )
    return this.props.children
  }
}

/**
 * Aba "Geral" — voz: Básico (Nome, Voz, Idioma, + Formalidade nos idiomas com tratamento formal/informal), Mensagens iniciais
 * e Habilidades (capturas app-02 / spec 06; EM-01/FS-02 da Central de ajuda).
 * Chat (WC-03): Básico (Nome, Idioma ⓘ, Tempo limite da conversa), Gestão de conversas e Habilidades — sem Voz e sem
 * Mensagens iniciais (a saudação do chat é a "Mensagem de saudação" do Webchat, aberto pelo botão "Chatbot de IA" da barra).
 */
export function GeneralTab({ headerActions }: { headerActions?: ReactNode }) {
  const { agent, draft, update, issueFor } = useAgentDraft()
  const [voiceOpen, setVoiceOpen] = useState(false)
  const [rulesOpen, setRulesOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const greetingRef = useRef<HTMLDivElement>(null)
  const voice = voiceById(draft.voiceId)

  // sai do modo de edição ao clicar fora do cartão (o menu de variáveis fica num portal)
  useEffect(() => {
    if (!editing) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (greetingRef.current?.contains(t) || t.closest('[data-greeting-popover]') || t.closest('[role="tooltip"]')) return
      setEditing(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setEditing(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [editing])

  const nameError = issueFor('name')
  const greetingError = issueFor('greeting')

  return (
    <>
      <SectionHeading actions={headerActions}>Geral</SectionHeading>
      <form onSubmit={(e) => e.preventDefault()} noValidate>
        <div className="flex w-full flex-col gap-6">
          <div>
            <SectionLabel>Básico</SectionLabel>
            <SettingsCard>
              <SettingsRow label={<label htmlFor="agent-name">Nome</label>} compact>
                <div className="flex w-full max-w-[16rem] flex-col items-end gap-1">
                  <input
                    id="agent-name"
                    name="name"
                    value={draft.name}
                    placeholder="Kloel"
                    aria-invalid={!!nameError}
                    onChange={(e) => update({ name: e.target.value })}
                    className="h-8 w-full rounded-lg border border-input bg-background px-3 py-2 text-[13px] shadow-none outline-none focus-visible:ring-1 focus-visible:ring-ring aria-[invalid=true]:border-destructive"
                  />
                  <FieldError>{nameError}</FieldError>
                </div>
              </SettingsRow>
              {agent.type === 'voice' && (
              <SettingsRow label="Voz" compact>
                <button
                  type="button"
                  id="dialog-trigger-voice-select"
                  role="combobox"
                  aria-expanded={voiceOpen}
                  aria-label={`Voz: ${voice.name}`}
                  onClick={() => setVoiceOpen(true)}
                  className="inline-flex h-8 w-auto min-w-36 items-center justify-between gap-1.5 rounded-lg border border-input bg-background px-3 text-[13px] shadow-none hover:bg-accent/50"
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <VoiceAvatar voice={voice} />
                    <span className="truncate">{voice.name}</span>
                  </span>
                  <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
                </button>
              </SettingsRow>
              )}
              <SettingsRow
                label={
                  agent.type === 'chat' ? (
                    <span className="inline-flex items-center gap-1.5">
                      Idioma
                      <SimpleTooltip label="Idioma padrão das respostas e da saudação. Se o cliente escrever em outro idioma, o assistente acompanha.">
                        <button type="button" aria-label="Sobre o idioma" className="text-muted-foreground hover:text-foreground">
                          <Info className="size-3.5" />
                        </button>
                      </SimpleTooltip>
                    </span>
                  ) : (
                    'Idioma'
                  )
                }
                compact
              >
                <Select value={draft.language} onValueChange={(v) => update({ language: v })}>
                  <SelectTrigger aria-label="Idioma" className="h-8 w-auto gap-1.5 rounded-lg text-[13px] shadow-none md:max-w-[240px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="start">
                    {LANGUAGES.map((l) => (
                      <SelectItem key={l.value} value={l.value} className={LEFT_CHECK_ITEM}>
                        {l.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </SettingsRow>
              {agent.type === 'voice' && FORMALITY_LANGUAGES.has(draft.language) && (
                <SettingsRow label="Formalidade" compact>
                  <Select value={draft.formality ?? 'custom'} onValueChange={(v) => update({ formality: v as NonNullable<typeof draft.formality> })}>
                    <SelectTrigger aria-label="Formalidade" className="h-8 w-auto gap-1.5 rounded-lg text-[13px] shadow-none">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent align="start">
                      {FORMALITY_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value} className={LEFT_CHECK_ITEM}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </SettingsRow>
              )}
              {agent.type === 'chat' && <ChatTimeoutRow />}
            </SettingsCard>
          </div>

          {agent.type === 'chat' && <ChatHandlingSection />}

          {agent.type === 'voice' && (
          <div className="divide-y rounded-xl border bg-background">
            <div className="px-5 py-4">
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium leading-none">Mensagens iniciais</label>
                <div className="-mx-5 -mb-4 -mt-2 flex flex-col divide-y">
                  <div ref={greetingRef} data-greeting-root="" className="relative px-5 py-3">
                    {editing ? (
                      <GreetingEditor value={draft.greeting} onChange={(v) => update({ greeting: v })} invalid={!!greetingError} />
                    ) : (
                      <button
                        type="button"
                        aria-label="Editar a mensagem padrão"
                        onClick={() => setEditing(true)}
                        className="-mx-2 block w-[calc(100%+1rem)] rounded-md px-2 py-1 text-left transition-colors hover:bg-muted/60"
                      >
                        {draft.greeting ? (
                          <VarText text={draft.greeting} className="line-clamp-2 block text-sm text-foreground" />
                        ) : (
                          <span className="block text-sm text-muted-foreground">Clique para escrever a mensagem inicial…</span>
                        )}
                      </button>
                    )}
                    <FieldError className="mt-1.5">{greetingError}</FieldError>
                  </div>
                  <div className="flex items-center justify-between gap-3 px-5 py-3">
                    <label htmlFor="greeting-personalized" className="min-w-0 text-xs font-medium">
                      Personalizar
                    </label>
                    <div className="flex items-center gap-1.5">
                      <Button type="button" variant="ghost" size="icon-xs" aria-label="Regras da mensagem inicial" className="text-muted-foreground" onClick={() => setRulesOpen(true)}>
                        <Settings className="h-4 w-4" />
                      </Button>
                      <Switch id="greeting-personalized" checked={draft.greetingPersonalized} onCheckedChange={(v) => update({ greetingPersonalized: v })} />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          )}
        </div>
      </form>

      <div className="mt-8">
        <SectionLabel>Recursos</SectionLabel>
        <ResourcesBoundary>
          <Suspense fallback={<ResourcesSkeleton />}>
            <ResourcesGrid agent={agent} />
          </Suspense>
        </ResourcesBoundary>
      </div>

      <VoicePickerDialog
        open={voiceOpen}
        onOpenChange={setVoiceOpen}
        value={draft.voiceId}
        language={draft.language}
        agentName={draft.name}
        onSave={(id) => update({ voiceId: id })}
      />
      <GreetingRulesSheet
        open={rulesOpen}
        onOpenChange={setRulesOpen}
        greeting={draft.greeting}
        mode={draft.greetingMode}
        rules={draft.greetingRules}
        onDone={({ mode, rules }) => update({ greetingMode: mode, greetingRules: rules })}
      />
    </>
  )
}
