import { Component, Suspense, lazy, type ReactNode } from 'react'
import { toast } from 'sonner'
import type { Agent } from '@/domain/types'
import type { WebchatSetup } from '@/domain/ext/mais-a'
import { defaultWebchat, hostedActive, validateOrigin, webchatOf, widgetActive } from '@/app/pages/whatsapp/webchat/model'
import type { WebchatTab } from '@/app/pages/whatsapp/webchat/WebchatDialog'

/**
 * "Configurar/Gerenciar Webchat" (Central de ajuda WC-08…WC-14) é implementado pelo módulo de canais (whatsapp/webchat);
 * aqui ele é aberto pelo botão "Chatbot de IA" da barra do assistente de chat (WC-02/WC-03).
 * Carregado sob demanda e isolado por uma fronteira de erro (módulo de outra área).
 */
const WebchatDialog = lazy(() => import('@/app/pages/whatsapp/webchat/WebchatDialog').then((m) => ({ default: m.WebchatDialog })))

class Boundary extends Component<{ children: ReactNode; onError: () => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch() {
    this.props.onError()
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

export function ManageWebchatDialog({ agentId, open, onOpenChange, initialTab }: { agentId: string; open: boolean; onOpenChange: (o: boolean) => void; initialTab?: WebchatTab }) {
  if (!open) return null
  return (
    <Boundary
      onError={() => {
        onOpenChange(false)
        toast.error('Não foi possível abrir o Chatbot de IA agora.')
      }}
    >
      <Suspense fallback={null}>
        <WebchatDialog agentId={agentId} open={open} onOpenChange={onOpenChange} initialTab={initialTab} />
      </Suspense>
    </Boundary>
  )
}

/** Chatbot de IA ativo = widget do site (algum site permitido) ou link hospedado ativo — mesmo critério dos selos "Ativo". */
export function webchatLive(agent: Agent) {
  const w = webchatOf(agent)
  return widgetActive(w) || hostedActive(w)
}

/** Origem (https://dominio[:porta]) de um endereço digitado no antigo campo "Site" do Canal; inválido → undefined. */
function originOf(site?: string) {
  const t = site?.trim()
  if (!t) return undefined
  try {
    const o = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`).origin
    return validateOrigin(o, []) ? undefined : o
  } catch {
    return undefined
  }
}

/**
 * Migração do modelo antigo do Canal (`Agent.webchat`: título, cor, posição, site) para o modelo único do Chatbot de IA
 * (`Agent.webchatSetup`, editado pelo "Gerenciar Webchat"): cor → cor de destaque (já é o padrão de `defaultWebchat`),
 * título diferente do nome → nome de exibição, site → primeiro "site permitido" do widget. A saudação continua sendo a
 * "Mensagem de saudação" do assistente (widget/link vazios caem nela). Só roda para assistentes de chat sem `webchatSetup`.
 * Devolve a configuração a gravar (ou null se não há nada a migrar).
 */
export function legacyWebchatMigration(agent: Agent): WebchatSetup | null {
  if (agent.type !== 'chat' || agent.webchatSetup || !agent.webchat) return null
  const legacy = agent.webchat
  const title = legacy.title?.trim() ?? ''
  const origin = originOf(legacy.website)
  return { ...defaultWebchat(agent), displayName: title && title !== agent.name ? title.slice(0, 60) : '', allowedSites: origin ? [origin] : [] }
}
