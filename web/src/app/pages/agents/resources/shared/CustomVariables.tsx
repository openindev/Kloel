import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { CustomVariable } from '@/domain/ext/agents-resources'
import { cn } from '@/lib/utils'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export const CUSTOM_TYPE_LABEL: Record<CustomVariable['type'], string> = { string: 'Texto', number: 'Número', boolean: 'Booleano' }

/** Lista de variáveis personalizadas na ordem em que aparecem no texto, preservando tipo/descrição já preenchidos. */
export function syncCustomVariables(names: string[], current: CustomVariable[] | undefined): CustomVariable[] {
  return names.map((name) => current?.find((v) => v.name === name) ?? { name, type: 'string', description: '' })
}

export const customVariablesValid = (vars: CustomVariable[]) => vars.every((v) => v.description.trim())

/**
 * "VARIÁVEIS PERSONALIZADAS" (Central de ajuda SM-05 / HR-07): cada {{nome}} digitado que não é do catálogo vira uma variável
 * que a IA preenche durante a conversa — tipo Texto/Número/Booleano e descrição obrigatória ("A descrição é obrigatória.").
 * O selo vermelho conta as variáveis ainda sem descrição.
 */
export function CustomVariablesSection({ value, onChange, collapsible = true }: { value: CustomVariable[]; onChange: (v: CustomVariable[]) => void; collapsible?: boolean }) {
  const [open, setOpen] = useState(true)
  if (!value.length) return null
  const missing = value.filter((v) => !v.description.trim()).length
  const set = (name: string, patch: Partial<CustomVariable>) => onChange(value.map((v) => (v.name === name ? { ...v, ...patch } : v)))
  const title = (
    <span className="flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-foreground/60">
      {collapsible && <ChevronDown className={cn('size-4 transition-transform', !open && '-rotate-90')} />}
      Variáveis personalizadas
      {/* SM-05: selo vermelho na seção recolhível; HR-07 (seção fixa) não tem selo */}
      {collapsible && missing > 0 && (
        <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 text-[11px] font-semibold leading-5 tracking-normal text-white" aria-label={`${missing} sem descrição`}>
          {missing}
        </span>
      )}
    </span>
  )
  return (
    <div className="flex flex-col gap-3 border-t pt-6" data-testid="custom-variables">
      {collapsible ? (
        <button type="button" className="self-start" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {title}
        </button>
      ) : (
        title
      )}
      {open &&
        value.map((v) => {
          const invalid = !v.description.trim()
          return (
            <div key={v.name} className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-4" data-testid={`custom-variable-${v.name}`}>
              <div className="flex items-center justify-between gap-3">
                <code className="truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[13px] text-foreground">{`{{${v.name}}}`}</code>
                <Select value={v.type} onValueChange={(t) => set(v.name, { type: t as CustomVariable['type'] })}>
                  <SelectTrigger aria-label={`Tipo de ${v.name}`} className="h-8 w-[132px] shrink-0 text-[13px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(CUSTOM_TYPE_LABEL) as CustomVariable['type'][]).map((t) => (
                      <SelectItem key={t} value={t} className="pl-8 pr-2 [&>span:first-child]:left-2 [&>span:first-child]:right-auto">
                        {CUSTOM_TYPE_LABEL[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Textarea
                  aria-label={`Descrição de ${v.name}`}
                  aria-invalid={invalid || undefined}
                  value={v.description}
                  onChange={(e) => set(v.name, { description: e.target.value })}
                  placeholder="Descreva o que o assistente deve preencher aqui..."
                  className={cn('min-h-[68px] bg-background', invalid && 'border-destructive placeholder:text-destructive/60 focus-visible:ring-destructive')}
                />
                {invalid && <p className="text-xs font-medium text-destructive">A descrição é obrigatória.</p>}
              </div>
            </div>
          )
        })}
    </div>
  )
}
