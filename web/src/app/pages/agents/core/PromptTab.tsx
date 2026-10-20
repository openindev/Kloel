import { ExternalLink, Lightbulb } from 'lucide-react'
import { cn, formatNumber } from '@/lib/utils'
import { Alert } from '@/components/ui/alert'
import { SectionHeading } from '@/components/app/Page'
import { PROMPT_LIMIT, useAgentDraft } from './draft'
import { AutoTextarea, FieldError } from './ui'

/** Aba "Prompt personalizado" — captura app-04 / spec 07 [565]. */
export function PromptTab() {
  const { draft, update, issueFor } = useAgentDraft()
  const over = draft.prompt.length > PROMPT_LIMIT
  return (
    // sem gap entre os blocos: título (mb-7) → alerta (mb-4) → editor, como na captura ao vivo (alerta em y=160, editor em y≈254 a 1512px)
    <div className="flex w-full flex-col">
      <SectionHeading>Prompt personalizado</SectionHeading>
      <Alert variant="info" className="mb-4">
        <Lightbulb />
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">
          Um papel claro, instruções concretas e exemplos deixam seu assistente muito mais confiável.
          <a href="/ajuda/get-started/write-a-great-prompt" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium underline underline-offset-2">
            Como escrever um bom prompt
            <ExternalLink className="size-3.5" />
          </a>
        </div>
      </Alert>
      <div>
        <div className={cn('divide-y overflow-hidden rounded-xl border bg-background', over && 'border-destructive')}>
          <form onSubmit={(e) => e.preventDefault()}>
            <AutoTextarea
              name="prompt"
              aria-label="Prompt personalizado"
              aria-invalid={over}
              value={draft.prompt}
              onChange={(e) => update({ prompt: e.target.value })}
              placeholder="Instruções personalizadas para o assistente..."
              // textarea em linha (como na captura): a linha de base acrescenta ~6px abaixo, igual à referência [565]
              className="min-h-[480px] w-full rounded-none border-0 bg-muted/40 p-6 text-sm leading-relaxed outline-none focus-visible:ring-0"
            />
          </form>
        </div>
        <div className="mt-2 flex items-start justify-between gap-3">
          <FieldError>{issueFor('prompt')}</FieldError>
          <p className={cn('ml-auto text-right text-xs', over ? 'font-medium text-destructive' : 'text-muted-foreground')}>
            {formatNumber(draft.prompt.length)} / {formatNumber(PROMPT_LIMIT)} caracteres
          </p>
        </div>
      </div>
    </div>
  )
}
