import { useState } from 'react'
import type { Agent, BusinessHours } from '@/domain/types'
import { useStore } from '@/data/store'
import { BusinessHoursSheet } from './BusinessHoursSheet'
import { saveResourceFields } from '@/services/casca/resource-save'

/** Persiste alterações do assistente (com updatedAt). */
export async function saveAgent(agent: Agent, update: (a: Agent) => Partial<Agent>) { await saveResourceFields(agent, update(agent)) }

export function upsert<T extends { id: string }>(list: T[], item: T): T[] {
  return list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item]
}

/**
 * Rascunho do horário de funcionamento do assistente, editado pelo sub-painel empilhado.
 * Só é gravado junto com o "Salvar" do painel do recurso ("Cancelar" descarta).
 */
export function useHoursDraft(agent: Agent) {
  const [hours, setHours] = useState<BusinessHours>(agent.businessHours)
  const [open, setOpen] = useState(false)
  return {
    hours,
    configured: !!hours?.enabled,
    changed: hours !== agent.businessHours,
    openSheet: () => setOpen(true),
    sheet: <BusinessHoursSheet open={open} onOpenChange={setOpen} value={hours} onConfirm={setHours} />,
  }
}

/** Erros de validação por campo. */
export function useErrors<K extends string = string>() {
  const [errors, setErrors] = useState<Partial<Record<K, string>>>({})
  const clear = (k: K) => setErrors((e) => (e[k] ? { ...e, [k]: undefined } : e))
  return { errors, setErrors, clear, has: Object.values(errors).some(Boolean) }
}
