import { useState, type ReactNode } from 'react'
import { Building2, UserRound } from 'lucide-react'
import type { CalendarConnection } from '@/domain/types'
import { cn } from '@/lib/utils'
import { useDB } from '@/data/store'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ConnectAccountDialog } from '@/app/pages/company-settings/connections'

/**
 * Fluxo "Conectar um calendário agora." (refs. 499–502): "Para quem é esta conexão?" (Pessoal | Compartilhada)
 * → "Como você quer usar esta conta?" (Google/Microsoft + recursos) → services.oauth.connect (simulado) →
 * cria CalendarConnection. O segundo passo reutiliza o diálogo de Conexões de contas (módulo Configurações da empresa)
 * para que a conexão criada aqui seja a mesma vista em /app/company-settings?tab=connections.
 */
export function ConnectCalendarFlow({ open, onOpenChange, onConnected }: { open: boolean; onOpenChange: (o: boolean) => void; onConnected?: (c: CalendarConnection) => void }) {
  const [scope, setScope] = useState<'personal' | 'shared' | null>(null)
  const userId = useDB((db) => db.session.userId)
  const personal = useDB((db) => db.calendarConnections.find((c) => c.orgId === db.session.orgId && c.scope === 'personal' && c.ownerUserId === db.session.userId))

  const close = () => {
    setScope(null)
    onOpenChange(false)
  }

  return (
    <>
      <Dialog open={open && !scope} onOpenChange={(o) => !o && close()}>
        <DialogContent className="gap-y-4 sm:max-w-[512px] sm:rounded-xl">
          <DialogHeader>
            <DialogTitle>Para quem é esta conexão?</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ScopeCard
              icon={<UserRound className="size-5" />}
              title="Pessoal"
              example="Exemplo: ana@exemplo.com.br"
              text={personal ? `Você já conectou sua conta pessoal (${personal.email}).` : 'Você pode conectar apenas uma conta pessoal.'}
              disabled={!!personal || !userId}
              onClick={() => setScope('personal')}
            />
            <ScopeCard
              icon={<Building2 className="size-5" />}
              title="Compartilhada"
              example="Exemplo: info@exemplo.com.br"
              text="Você pode conectar várias conexões compartilhadas nesta empresa."
              onClick={() => setScope('shared')}
            />
          </div>
        </DialogContent>
      </Dialog>
      {scope && (
        <ConnectAccountDialog
          open={open && !!scope}
          scope={scope}
          // ref. 501: Agenda e IA de e-mail já vêm marcadas
          defaultFeatures={['calendar', 'email']}
          onOpenChange={(o) => {
            if (!o) close()
          }}
          onConnected={(conn) => onConnected?.(conn)}
        />
      )}
    </>
  )
}

/**
 * Cartão de escopo (ref. 500, 2x → CSS): 226×150 com borda (py 15px), ícone 20px + 12px até o texto (texto a 48px da borda), título 14/20,
 * exemplo 12/20 numa linha, descrição 12/20 (mesma largura de glifos da referência: 2 linhas em "Pessoal", 3 em "Compartilhada").
 * Título → cartões: 16px.
 */
function ScopeCard({ icon, title, example, text, onClick, disabled }: { icon: ReactNode; title: string; example: string; text: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex min-h-[150px] items-start gap-3 rounded-xl border py-[15px] pl-4 pr-2 text-left transition-colors hover:border-foreground/30 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        disabled && 'cursor-not-allowed opacity-60 hover:border-border hover:bg-transparent',
      )}
    >
      <span className="flex shrink-0 text-foreground">{icon}</span>
      <span className="flex min-w-0 flex-col gap-1">
        <span className="text-sm font-medium leading-5">{title}</span>
        <span className="whitespace-nowrap text-xs leading-5 text-muted-foreground">{example}</span>
        <span className="mt-2 text-xs leading-5 text-muted-foreground">{text}</span>
      </span>
    </button>
  )
}
