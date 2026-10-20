import type { ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'

/**
 * Moldura de página cheia SEM sidebar ("Alterar plano" / "Adicionar assinatura"), classes da captura ao vivo:
 * wrapper "flex min-h-full flex-col justify-center self-center pb-12 lg:pb-0" > "lg:h-fit … lg:-mt-16 mt-2" > "flex flex-col items-center w-full lg:pt-12".
 */
export function PlanPageFrame({ title, subtitle, onBack, children }: { title: ReactNode; subtitle?: ReactNode; onBack: () => void; children: ReactNode }) {
  return (
    <main className="flex min-h-svh w-full flex-col bg-background px-4 sm:px-8">
      <div className="flex min-h-full flex-1 flex-col justify-center self-center pb-12 lg:pb-0 w-full">
        <div className="mt-2 flex w-full flex-col justify-center self-center lg:-mt-16 lg:h-fit">
          <div className="flex w-full flex-col items-center pt-8 lg:pt-12">
            <div className="mb-8 text-center sm:ml-[-32px]">
              <div className="flex items-center justify-center text-2xl font-semibold">
                <button type="button" onClick={onBack} aria-label="Voltar" className="-ml-2 mr-1 inline-flex h-8 w-8 items-center justify-center rounded-md p-2 hover:bg-accent">
                  <ArrowLeft className="h-5 w-5" />
                </button>
                <span>{title}</span>
              </div>
              {subtitle && <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">{subtitle}</p>}
            </div>
            {children}
          </div>
        </div>
      </div>
    </main>
  )
}
