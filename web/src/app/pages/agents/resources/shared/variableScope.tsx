import { createContext, useContext, useMemo, type ReactNode } from 'react'
import '@/domain/ext/agents-resources'
import type { Agent } from '@/domain/types'
import { useContactSettings } from '@/data/store'
import { scopedVariables, type VariableScope } from './variables'

const ScopeContext = createContext<VariableScope | null>(null)

/**
 * Disponibiliza para os menus de variáveis dos painéis de recurso o que "Conectar contatos" libera para este assistente
 * (contatos ligados, detalhes marcados e campos inteligentes). Envolve cada painel em `ResourceSheet` (index.tsx).
 */
export function VariableScopeProvider({ agent, children }: { agent: Agent; children: ReactNode }) {
  const settings = useContactSettings()
  const smart = settings?.smartFields
  const fields = agent.contactAccess?.fields
  const value = useMemo<VariableScope>(
    () => ({ contactsEnabled: agent.contactsEnabled, fields: fields ?? null, smartFields: (smart ?? []).map((f) => ({ id: f.id, label: f.label, description: f.description })) }),
    [agent.contactsEnabled, fields, smart],
  )
  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>
}

/** Escopo do assistente atual (`null` fora de um painel de recurso = catálogo completo). */
export function useVariableScope() {
  return useContext(ScopeContext)
}

export function useScopedVariables() {
  const scope = useVariableScope()
  return useMemo(() => scopedVariables(scope), [scope])
}
