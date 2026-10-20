import { useContext, useMemo } from 'react'
import { useContactSettings } from '@/data/store'
import { isVariableAllowed, type VariableScope } from '../resources/shared/variables'
import { DraftContext } from './draft'
import { VARIABLES, smartVariables, type VariableDef } from './variables'

/** Todas as variáveis conhecidas da mensagem inicial: fixas + campos inteligentes da organização (rótulos dos chips). */
export function useGreetingVariableDefs(): VariableDef[] {
  const settings = useContactSettings()
  const smart = settings?.smartFields
  return useMemo(() => [...VARIABLES, ...smartVariables(smart ?? [])], [smart])
}

/**
 * Variáveis oferecidas no menu "Adicionar variável" da mensagem inicial, no mesmo escopo dos menus de e-mail/webhooks:
 * só o que "Conectar contatos" libera para o assistente aberto (contatos ligados, detalhes marcados, campos inteligentes
 * marcados como "Contato: <campo>"). Fora do AgentPage: catálogo completo.
 */
export function useGreetingMenuVariables(): { vars: VariableDef[] } {
  const all = useGreetingVariableDefs()
  const settings = useContactSettings()
  const agent = useContext(DraftContext)?.agent
  const enabled = agent?.contactsEnabled
  const fields = agent?.contactAccess?.fields
  const smart = settings?.smartFields
  const hasAgent = !!agent
  return useMemo(() => {
    if (!hasAgent) return { vars: all }
    const scope: VariableScope = { contactsEnabled: !!enabled, fields: fields ?? null, smartFields: (smart ?? []).map((f) => ({ id: f.id, label: f.label, description: f.description })) }
    return { vars: all.filter((v) => isVariableAllowed(v.key, scope)) }
  }, [all, hasAgent, enabled, fields, smart])
}
