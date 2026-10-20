import { useState, type ComponentType } from 'react'
import { BookUser, PhoneForwarded, Mail, Calendar, Globe, Plug, Webhook } from 'lucide-react'
import '@/domain/ext/agents-resources'
import '@/domain/ext/tasks'
import type { Agent, AgentType, Organization } from '@/domain/types'
import { useEntity } from '@/data/store'
import { ContactsResource } from './ContactsSheet'
import { TransferResource } from './TransferSheet'
import { EmailResource } from './EmailSheet'
import { WhatsAppResource } from './WhatsAppSheet'
import { SchedulingResource } from './SchedulingSheet'
import { WebSearchResource } from './WebSearchSheet'
import { IntegrationsResource } from './IntegrationsSheet'
import { WebhooksResource } from './WebhooksSheet'
import { TaskResource } from './TaskSheet'
import { ResourceRouteContext, type ResourceProps, type ResourceRoute } from './shared/listView'
import { VariableScopeProvider } from './shared/variableScope'
import { WhatsAppMaskIcon } from './shared/WhatsAppMaskIcon'

/**
 * CONTRATO entre o módulo "Assistentes – página Geral" (renderiza a grade de recursos)
 * e o módulo "Assistentes – Recursos/Ações" (implementa as folhas). A assinatura abaixo é fixa.
 */
export type ResourceKind = 'contacts' | 'transfer' | 'email' | 'whatsapp' | 'scheduling' | 'websearch' | 'integrations' | 'webhooks' | 'task'

export interface ResourceDef {
  kind: ResourceKind
  label: string
  icon: ComponentType<{ className?: string }>
  iconClassName?: string
  isActive: (agent: Agent) => boolean
  /** tipos de assistente que têm o recurso (ausente = regra padrão da grade) — módulo Tarefas */
  types?: AgentType[]
  /** oculta o recurso para a organização (ex.: "Criar tarefa" sem Tarefas BETA ativado) — módulo Tarefas */
  hidden?: (ctx: { org: Organization | undefined }) => boolean
}

/**
 * Os 8 recursos da Fonio, na ordem fixa da grade ao vivo (fonio-live2 C-assistentes/02 e data/resources.json › grid.order):
 * Conectar contatos · Transferir ligações · Enviar e-mail · Enviar WhatsApp · Agendar compromissos · Pesquisa na web ·
 * Integrações · Webhooks. "Enviar SMS" não existe na Fonio (removido). "Criar tarefa" (Tarefas BETA) também não aparece na
 * conta ao vivo: a folha continua registrada em IMPLEMENTATIONS (dados preservados), mas fica fora da grade.
 */
export const RESOURCE_DEFS: ResourceDef[] = [
  { kind: 'contacts', label: 'Conectar contatos', icon: BookUser, iconClassName: 'text-rose-500', isActive: (a) => a.contactsEnabled },
  { kind: 'transfer', label: 'Transferir ligações', icon: PhoneForwarded, isActive: (a) => a.engineResourceReadiness?.transfers ?? a.transfers.length > 0 },
  { kind: 'email', label: 'Enviar e-mail', icon: Mail, isActive: (a) => a.engineResourceReadiness?.emails ?? a.emails.length > 0 },
  // ícone em máscara (span inline-block bg-current 18×18), não svg: ver WhatsAppMaskIcon (altura 103px da 2ª linha da grade)
  { kind: 'whatsapp', label: 'Enviar WhatsApp', icon: WhatsAppMaskIcon, isActive: (a) => a.engineResourceReadiness?.whatsapps ?? a.whatsapps.length > 0 },
  { kind: 'scheduling', label: 'Agendar compromissos', icon: Calendar, isActive: (a) => a.scheduling.length > 0 },
  { kind: 'websearch', label: 'Pesquisa na web', icon: Globe, isActive: (a) => a.webSearch.enabled },
  { kind: 'integrations', label: 'Integrações', icon: Plug, isActive: (a) => a.integrations.length > 0 },
  // "Contexto de teste" sozinho não ativa o recurso; webhooks de entrada/requisições HTTP ativos sim.
  { kind: 'webhooks', label: 'Webhooks', icon: Webhook, isActive: (a) => a.webhooks.some((w) => w.enabled && w.kind !== 'test_context') },
]

/** Valor de `?recurso=` na URL da aba Geral (folha aberta sobrevive a recarregar e fecha com Voltar). */
export const RESOURCE_SLUG: Record<ResourceKind, string> = {
  contacts: 'contatos',
  transfer: 'transferencia',
  email: 'email',
  whatsapp: 'whatsapp',
  scheduling: 'agendamento',
  websearch: 'pesquisa-web',
  integrations: 'integracoes',
  webhooks: 'webhooks',
  task: 'tarefa',
}

export function resourceKindFromSlug(slug: string | null): ResourceKind | null {
  if (!slug) return null
  return (Object.keys(RESOURCE_SLUG) as ResourceKind[]).find((k) => RESOURCE_SLUG[k] === slug) ?? null
}

/** Link para abrir uma folha (e sub-tela) de recurso de um assistente, ex.: contexto de teste dos webhooks. */
export function resourceHref(agentId: string, kind: ResourceKind, item?: string) {
  const q = new URLSearchParams({ recurso: RESOURCE_SLUG[kind] })
  if (item) q.set('item', item)
  return `/app/agents/${agentId}/general?${q.toString()}`
}

const IMPLEMENTATIONS: Record<ResourceKind, ComponentType<ResourceProps>> = {
  contacts: ContactsResource,
  transfer: TransferResource,
  email: EmailResource,
  whatsapp: WhatsAppResource,
  scheduling: SchedulingResource,
  websearch: WebSearchResource,
  integrations: IntegrationsResource,
  webhooks: WebhooksResource,
  task: TaskResource,
}

/**
 * Folha lateral de configuração de um recurso.
 * Cada abertura inicia uma nova "sessão" (rascunho descartado ao Cancelar); "Salvar" grava no store
 * (useStore.getState().patch('agents', agent.id, …)) e o cartão da grade passa a "Ativo" via RESOURCE_DEFS.isActive.
 */
export function ResourceSheet({
  kind,
  agent,
  open,
  onOpenChange,
  route = null,
}: {
  kind: ResourceKind
  agent: Agent
  open: boolean
  onOpenChange: (o: boolean) => void
  /** sub-tela na URL (?item=); sem ele a folha usa só estado local */
  route?: ResourceRoute | null
}) {
  // sessão derivada da transição fechado → aberto (sem efeito, para não reanimar a folha)
  const [lastOpen, setLastOpen] = useState(open)
  const [session, setSession] = useState(0)
  if (open !== lastOpen) {
    setLastOpen(open)
    if (open) setSession((s) => s + 1)
  }
  const live = useEntity('agents', agent.id) ?? agent
  const Impl = IMPLEMENTATIONS[kind]
  return (
    <ResourceRouteContext.Provider value={route}>
      <VariableScopeProvider agent={live}>
        <Impl key={`${kind}-${session}`} agent={live} open={open} onOpenChange={onOpenChange} />
      </VariableScopeProvider>
    </ResourceRouteContext.Provider>
  )
}
