import { CloudOff, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function InboxLoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div data-engine-state="error" role="alert" className="flex flex-col items-center px-6 py-12 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-50">
        <CloudOff className="h-5 w-5 text-red-600" />
      </div>
      <p className="text-sm font-medium">Não foi possível carregar as conversas</p>
      <p className="mt-1 max-w-[260px] text-xs text-muted-foreground">Nenhum dado foi perdido. Tente novamente.</p>
      <Button variant="outline" size="xs" className="mt-4 gap-1.5" onClick={onRetry}>
        <RotateCw className="h-3 w-3" /> Tentar novamente
      </Button>
    </div>
  )
}
