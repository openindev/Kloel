import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Info, Phone, Server } from 'lucide-react'
import { toast } from 'sonner'
import type { Agent } from '@/domain/types'
import { cn } from '@/lib/utils'
import { useCollection, useStore } from '@/data/store'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'

/**
 * CONTRATO: diálogo "Atribuir número" (vincula PhoneNumber.agentId). Usado no assistente e no onboarding.
 * Sem números: texto e caixa informativa OBSERVADOS (vídeo da ligação de teste, f_015) + "Adicionar novo número" → /app/phone-numbers.
 * Com números: lista com seleção (atribuir/remover) — INFERIDO.
 */
export function AssignNumberDialog({ agent, open, onOpenChange }: { agent: Agent; open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate()
  const numbers = useCollection('phoneNumbers')
  const agents = useCollection('agents')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (open) setSelected(new Set(numbers.filter((n) => n.agentId === agent.id).map((n) => n.id)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, agent.id])

  const initial = useMemo(() => new Set(numbers.filter((n) => n.agentId === agent.id).map((n) => n.id)), [numbers, agent.id])
  const dirty = selected.size !== initial.size || [...selected].some((id) => !initial.has(id))
  const agentName = (id?: string) => agents.find((a) => a.id === id)?.name

  function save() {
    const { patch } = useStore.getState()
    let added = 0
    let removed = 0
    numbers.forEach((n) => {
      const want = selected.has(n.id)
      if (want && n.agentId !== agent.id) {
        patch('phoneNumbers', n.id, { agentId: agent.id })
        added++
      } else if (!want && n.agentId === agent.id) {
        patch('phoneNumbers', n.id, { agentId: undefined })
        removed++
      }
    })
    onOpenChange(false)
    toast.success('Números atualizados', {
      description: [added && `${added} atribuído${added > 1 ? 's' : ''} a ${agent.name}`, removed && `${removed} removido${removed > 1 ? 's' : ''}`].filter(Boolean).join(' · '),
    })
  }

  const goAdd = () => {
    onOpenChange(false)
    navigate('/app/phone-numbers')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* vídeo da ligação de teste (f_016): título, descrição, caixa e rodapé separados por 32px (gap-y-8 padrão do diálogo) */}
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Atribuir número</DialogTitle>
        </DialogHeader>
        <DialogDescription>
          {numbers.length === 0 ? 'Você ainda não tem números disponíveis.' : `Escolha quais números de telefone devem ser atendidos por ${agent.name}.`}
        </DialogDescription>

        {numbers.length === 0 ? (
          <div className="flex gap-3 rounded-xl border p-4 text-sm leading-5">
            <Info className="mt-0.5 size-4 shrink-0" />
            <div className="space-y-[30px]">
              <p>Os números fornecidos por nós podem ser comprados diretamente na plataforma — nenhuma ação adicional é necessária.</p>
              <p>
                Seus próprios números podem ser importados usando o recurso{' '}
                <button type="button" onClick={goAdd} className="text-blue-500 hover:underline">
                  SIP Trunk
                </button>{' '}
                (Adicionar número → Criar número SIP) e depois atribuídos aqui.
              </p>
            </div>
          </div>
        ) : (
          <ul className="max-h-[50vh] divide-y overflow-y-auto rounded-xl border">
            {numbers.map((n) => {
              const checked = selected.has(n.id)
              const other = n.agentId && n.agentId !== agent.id ? agentName(n.agentId) : undefined
              const Icon = n.kind === 'sip' ? Server : Phone
              return (
                <li key={n.id}>
                  <label className={cn('flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40', checked && 'bg-muted/30')}>
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(v) =>
                        setSelected((s) => {
                          const next = new Set(s)
                          if (v) next.add(n.id)
                          else next.delete(n.id)
                          return next
                        })
                      }
                      aria-label={`Atribuir ${n.number}`}
                    />
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      <Icon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{n.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{n.number}</span>
                    </span>
                    <span className="shrink-0 text-right text-xs text-muted-foreground">
                      {n.agentId === agent.id
                        ? checked
                          ? 'Atribuído a este assistente'
                          : 'Será removido'
                        : other
                          ? checked
                            ? `Será transferido de ${other}`
                            : `Atribuído a ${other}`
                          : checked
                            ? 'Será atribuído'
                            : 'Disponível'}
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
        )}

        <DialogFooter className={cn(numbers.length > 0 && 'sm:justify-between')}>
          {numbers.length > 0 && (
            <Button variant="ghost" className="text-brand hover:text-brand" onClick={goAdd}>
              Adicionar novo número
            </Button>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            {numbers.length === 0 ? (
              <Button onClick={goAdd}>Adicionar novo número</Button>
            ) : (
              <Button onClick={save} disabled={!dirty}>
                Salvar
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
