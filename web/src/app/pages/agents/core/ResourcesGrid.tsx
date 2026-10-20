import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Check, Plus } from 'lucide-react'
import type { Agent, Organization } from '@/domain/types'
import { cn } from '@/lib/utils'
import { useCurrentOrg } from '@/data/store'
import { RESOURCE_DEFS, RESOURCE_SLUG, ResourceSheet, resourceKindFromSlug, type ResourceDef, type ResourceKind } from '../resources'
import type { ResourceRoute } from '../resources/shared/listView'

/** Entradas do histórico criadas pela folha: quantas foram empilhadas, se a de baixo é a página sem folha e se esta é de um item. */
type SheetHistory = { depth: number; base: boolean; item: boolean }

function sheetHistory(state: unknown): SheetHistory | null {
  const v = (state as { kloelResource?: SheetHistory } | null)?.kloelResource
  return v && typeof v.depth === 'number' ? v : null
}

/**
 * Cartões da grade (OBSERVADO ao vivo: fonio-live2/C-assistentes/02 + data/resources.json): exatamente 8, na ordem FIXA do contrato
 * RESOURCE_DEFS — Conectar contatos, Transferir ligações, Enviar e-mail, Enviar WhatsApp, Agendar compromissos, Pesquisa na web,
 * Integrações, Webhooks — sem pôr os ativos primeiro e sem "Enviar SMS" (não existe na referência).
 * Assistente de chat (Central de ajuda WC-03/TK-V05): sem as ações de ligação (Transferir, Enviar WhatsApp); "Criar tarefa" só com Tarefas (BETA).
 * A disponibilidade declarada pelo contrato (`ResourceDef.types` / `ResourceDef.hidden`) tem precedência.
 */
const NOT_IN_REFERENCE = new Set<string>()
const VOICE_ONLY = new Set(['transfer', 'whatsapp'])
const CHAT_ONLY = new Set(['task'])

/**
 * Cor do ícone dos cartões ATIVOS quando a definição não traz `iconClassName` — só cores observadas: Conectar contatos rosa (ao vivo);
 * Enviar e-mail azul, Agendar laranja, Integrações índigo e Criar tarefa laranja (Central de ajuda FS-10/EM-01/TK-V05).
 * Demais cartões ativos (Transferir, WhatsApp, Pesquisa na web, Webhooks) não aparecem ativos nas referências: cor do texto.
 */
const ACTIVE_ICON_COLOR: Partial<Record<string, string>> = {
  contacts: 'text-rose-500',
  email: 'text-blue-500',
  scheduling: 'text-orange-500',
  integrations: 'text-indigo-500',
  task: 'text-orange-500',
}

/** Campos opcionais do contrato (adicionados pelo módulo de Tarefas) lidos de forma tolerante. */
type DefExtras = { types?: Agent['type'][]; hidden?: (ctx: { org: Organization | undefined }) => boolean }

/** O recurso existe para este assistente/organização? (tipo do assistente + `hidden`, ex.: "Criar tarefa" sem o BETA de Tarefas). */
export function resourceAvailable(def: ResourceDef, agent: Agent, org: Organization | undefined) {
  const { types, hidden } = def as ResourceDef & DefExtras
  if (NOT_IN_REFERENCE.has(def.kind)) return false
  if (types ? !types.includes(agent.type) : agent.type === 'chat' ? VOICE_ONLY.has(def.kind) : CHAT_ONLY.has(def.kind)) return false
  try {
    return !hidden?.({ org })
  } catch {
    return true
  }
}

export function visibleResourceDefs(agent: Agent, org?: Organization) {
  return RESOURCE_DEFS.filter((d) => resourceAvailable(d, agent, org))
}

/**
 * Grade "Recursos" da aba Geral (cartões ativo/inativo como capturados em app-02).
 * As folhas são do módulo "agents-resources" (contrato ResourceSheet). Carregado sob demanda pela aba Geral.
 *
 * A folha aberta fica na URL (INFERIDO, padrão `?sheet=` de Contatos): `?recurso=<slug>` e, dentro dela, `?item=<id|novo|tela>`.
 * Abrir empilha uma entrada no histórico (Voltar fecha), recarregar reabre a mesma folha/sub-tela e fechar remove os parâmetros.
 */
export default function ResourcesGrid({ agent }: { agent: Agent }) {
  const location = useLocation()
  const navigate = useNavigate()
  const org = useCurrentOrg()
  const params = new URLSearchParams(location.search)
  const defs = visibleResourceDefs(agent, org)
  // ?recurso= de um recurso indisponível (outro tipo de assistente, BETA desligado) não abre folha
  const requested = resourceKindFromSlug(params.get('recurso'))
  const kind = requested && defs.some((d) => d.kind === requested) ? requested : null
  const item = kind ? params.get('item') : null
  const hist = sheetHistory(location.state)

  // mantém a última folha montada enquanto ela anima o fechamento
  const [shown, setShown] = useState<ResourceKind | null>(kind)
  if (kind && kind !== shown) setShown(kind)

  // um "voltar" já pedido e ainda não concluído (popstate assíncrono) não é repetido por um segundo clique/fechamento
  const popPending = useRef(false)
  useEffect(() => {
    popPending.current = false
  }, [location.key])

  const setQuery = (mutate: (q: URLSearchParams) => void, opts: { replace?: boolean; state: unknown }) => {
    const q = new URLSearchParams(location.search)
    mutate(q)
    const search = q.toString()
    navigate({ pathname: location.pathname, search: search ? `?${search}` : '', hash: location.hash }, { replace: opts.replace, state: opts.state })
  }
  const back = (n: number) => {
    if (popPending.current) return
    popPending.current = true
    navigate(-n)
  }

  const openSheet = (k: ResourceKind) =>
    setQuery(
      (q) => {
        q.set('recurso', RESOURCE_SLUG[k])
        q.delete('item')
      },
      { replace: !!kind, state: { kloelResource: { depth: 1, base: true, item: false } satisfies SheetHistory } },
    )

  const closeSheet = () => {
    if (!kind || popPending.current) return
    // folha aberta por clique (entrada empilhada sobre a página sem folha): Voltar até ela; aberta por URL direta: remove os parâmetros
    if (hist?.base && hist.depth > 0) back(hist.depth)
    else
      setQuery(
        (q) => {
          q.delete('recurso')
          q.delete('item')
        },
        { replace: true, state: null },
      )
  }

  const route: ResourceRoute = {
    item,
    pushItem: (it) => setQuery((q) => q.set('item', it), { state: { kloelResource: { depth: (hist?.depth ?? 0) + 1, base: hist?.base ?? false, item: true } satisfies SheetHistory } }),
    replaceItem: (it) => setQuery((q) => (it ? q.set('item', it) : q.delete('item')), { replace: true, state: location.state }),
    clearItem: () => {
      if (hist?.item) back(1)
      else setQuery((q) => q.delete('item'), { replace: true, state: location.state })
    },
  }
  // durante a animação de fechamento a sub-tela não troca (a URL já não tem ?item=)
  const frozen = useRef<ResourceRoute | null>(null)
  if (kind) frozen.current = route
  const sheetRoute = kind ? route : frozen.current

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
        {defs.map((def) => {
          const active = def.isActive(agent)
          const Icon = def.icon
          const activeColor = def.iconClassName ?? ACTIVE_ICON_COLOR[def.kind]
          return (
            <button
              key={def.kind}
              type="button"
              onClick={() => openSheet(def.kind)}
              data-resource={RESOURCE_SLUG[def.kind]}
              className={cn('flex flex-col gap-6 rounded-xl border bg-background p-4 text-left transition-colors hover:border-foreground/30', !active && 'border-dashed')}
            >
              <span className="flex w-full items-center justify-between">
                <span className={cn('[&>svg]:h-[18px] [&>svg]:w-[18px]', active ? activeColor : 'text-muted-foreground')}>
                  <Icon className={active ? activeColor : undefined} />
                </span>
                {active ? (
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">
                    <Check className="h-3 w-3" />
                    <span className="sr-only">Ativo</span>
                  </span>
                ) : (
                  <span className="flex h-5 w-5 items-center justify-center rounded-full border border-dashed border-muted-foreground/50 text-muted-foreground">
                    <Plus className="h-3 w-3" />
                    <span className="sr-only">Configurar</span>
                  </span>
                )}
              </span>
              <span className={cn('truncate text-sm', active ? 'font-semibold text-foreground' : 'font-medium text-muted-foreground')}>{def.label}</span>
            </button>
          )
        })}
      </div>
      {shown && <ResourceSheet key={shown} kind={shown} agent={agent} open={kind === shown} onOpenChange={(o) => !o && closeSheet()} route={sheetRoute} />}
    </>
  )
}
