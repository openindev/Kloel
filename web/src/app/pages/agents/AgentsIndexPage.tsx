import { useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { Plus, UserRoundPen } from 'lucide-react'
import { useCollection } from '@/data/store'
import { EmptyState } from '@/components/app/misc'
import { Button } from '@/components/ui/button'
import { CreateAgentDialog } from './core/CreateAgentDialog'

/**
 * /app/agents → redireciona para a aba Geral do primeiro assistente (OBSERVADO ao vivo: /agents → /agents/:id/general).
 * A referência não tem página de lista de assistentes (a troca é pelo seletor da coluna do assistente).
 * Sem assistentes → estado vazio com "Criar assistente" (INFERIDO).
 */
export default function AgentsIndexPage() {
  const agents = useCollection('agents')
  const first = useMemo(() => [...agents].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0], [agents])
  const [open, setOpen] = useState(false)
  if (first) return <Navigate to={`/app/agents/${first.id}/general`} replace />
  return (
    <div className="mx-auto w-full max-w-[764px] grow px-4 pb-8 pt-10 sm:px-8 lg:pt-20">
      <div className="mb-7 flex items-start justify-between gap-4 pt-4">
        <h1 className="text-3xl font-semibold tracking-tight">Assistentes</h1>
      </div>
      <EmptyState
        icon={<UserRoundPen />}
        title="Nenhum assistente ainda"
        action={
          <Button onClick={() => setOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            Criar assistente
          </Button>
        }
      />
      <CreateAgentDialog open={open} onOpenChange={setOpen} />
    </div>
  )
}
