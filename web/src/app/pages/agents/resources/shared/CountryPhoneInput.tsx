import { useState } from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'

/**
 * Os 33 países do seletor de telefone da Fonio, com os nomes em inglês e em ordem alfabética, exatamente como na conta ao vivo
 * (fonio-live2 data/resources.json › Transferir ligações › countryPicker e data/admin.json › Conta › Phone number).
 */
export const FONIO_COUNTRIES: { code: string; name: string; dial: string }[] = [
  { code: 'at', name: 'Austria', dial: '+43' },
  { code: 'be', name: 'Belgium', dial: '+32' },
  { code: 'br', name: 'Brazil', dial: '+55' },
  { code: 'bg', name: 'Bulgaria', dial: '+359' },
  { code: 'ca', name: 'Canada', dial: '+1' },
  { code: 'hr', name: 'Croatia', dial: '+385' },
  { code: 'cy', name: 'Cyprus', dial: '+357' },
  { code: 'cz', name: 'Czech Republic', dial: '+420' },
  { code: 'dk', name: 'Denmark', dial: '+45' },
  { code: 'ee', name: 'Estonia', dial: '+372' },
  { code: 'fi', name: 'Finland', dial: '+358' },
  { code: 'fr', name: 'France', dial: '+33' },
  { code: 'de', name: 'Germany', dial: '+49' },
  { code: 'gr', name: 'Greece', dial: '+30' },
  { code: 'hu', name: 'Hungary', dial: '+36' },
  { code: 'ie', name: 'Ireland', dial: '+353' },
  { code: 'it', name: 'Italy', dial: '+39' },
  { code: 'lv', name: 'Latvia', dial: '+371' },
  { code: 'lt', name: 'Lithuania', dial: '+370' },
  { code: 'lu', name: 'Luxembourg', dial: '+352' },
  { code: 'mt', name: 'Malta', dial: '+356' },
  { code: 'nl', name: 'Netherlands', dial: '+31' },
  { code: 'no', name: 'Norway', dial: '+47' },
  { code: 'pl', name: 'Poland', dial: '+48' },
  { code: 'pt', name: 'Portugal', dial: '+351' },
  { code: 'ro', name: 'Romania', dial: '+40' },
  { code: 'sk', name: 'Slovakia', dial: '+421' },
  { code: 'si', name: 'Slovenia', dial: '+386' },
  { code: 'es', name: 'Spain', dial: '+34' },
  { code: 'se', name: 'Sweden', dial: '+46' },
  { code: 'ch', name: 'Switzerland', dial: '+41' },
  { code: 'gb', name: 'United Kingdom', dial: '+44' },
  { code: 'us', name: 'United States', dial: '+1' },
]

const digitsOf = (v: string) => v.replace(/\D/g, '')

/** País pelo prefixo mais longo do número (+1 → United States, como o padrão da biblioteca da Fonio). */
export function countryOfNumber(value: string, fallback = 'br') {
  const d = digitsOf(value)
  const matches = FONIO_COUNTRIES.filter((c) => d.startsWith(digitsOf(c.dial))).sort((a, b) => b.dial.length - a.dial.length || (a.code === 'us' ? -1 : 1))
  return matches[0]?.code ?? fallback
}

/**
 * Formata como a Fonio mostra (C-assistentes/31 e "Ordem Funil" 1.png: "+55 64 99312 8506"): DDI + DDD (2) + 4–5 + 4 para o
 * Brasil; demais países agrupam os dígitos em blocos de 3–4 depois do DDI.
 */
export function formatInternational(value: string, code: string) {
  const country = FONIO_COUNTRIES.find((c) => c.code === code)
  const d = digitsOf(value)
  if (!country) return value
  const cc = digitsOf(country.dial)
  if (!d.startsWith(cc)) return value.startsWith('+') ? value : `+${d}`
  const rest = d.slice(cc.length)
  if (!rest) return `+${cc}`
  if (code === 'br') {
    const ddd = rest.slice(0, 2)
    const n = rest.slice(2)
    if (!n) return `+${cc} ${ddd}`
    const head = n.length > 8 ? n.slice(0, 5) : n.slice(0, 4)
    const tail = n.slice(head.length)
    return [`+${cc}`, ddd, head, tail].filter(Boolean).join(' ')
  }
  const groups: string[] = []
  for (let i = 0; i < rest.length; i += i === 0 ? 3 : 4) groups.push(rest.slice(i, i === 0 ? 3 : i + 4))
  return [`+${cc}`, ...groups].join(' ')
}

/**
 * Campo de telefone com seletor de país da Fonio (fonio-live2 C-assistentes/31 e 36): botão com bandeira 24×16 + chevrons, campo
 * "tel" com o DDI ("+55"), placeholder "+99 99 99999 9999"; lista com busca "Pesquisar país...", bandeira, nome em inglês, DDI em
 * cinza à direita e ✓ no país atual.
 */
export function CountryPhoneInput({ value, onChange, invalid, id, ariaLabel = 'Número de telefone' }: { value: string; onChange: (v: string) => void; invalid?: boolean; id?: string; ariaLabel?: string }) {
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState(() => countryOfNumber(value))
  const current = FONIO_COUNTRIES.find((c) => c.code === code) ?? FONIO_COUNTRIES[2]!
  return (
    <Popover open={open} onOpenChange={setOpen}>
      {/* a lista ocupa a largura do campo inteiro (C-assistentes/36), não só a do botão do país */}
      <PopoverAnchor asChild>
        <div className="flex">
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Selecionar país"
              // Fonio ao vivo (C-assistentes/31; live-compare 12): botão px-3 com o chevron em -mr-2 → 61px (borda + 12 + 24 + 4 + 8 + 12),
              // "+55" em x=111 do painel; chevron com opacidade total e bandeira com cantos de 2px (o rounded-sm do tema daqui = 8px
              // deixava a bandeira oval)
              className="inline-flex h-10 shrink-0 items-center gap-1 rounded-e-none rounded-s-md border border-r-0 border-input bg-background px-3 text-sm hover:bg-accent focus:z-10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <span className="flex h-4 w-6 overflow-hidden rounded-[2px] bg-foreground/20">
                <span className={cn('fi', `fi-${current.code}`, 'h-full w-full bg-cover')} />
              </span>
              <ChevronsUpDown className="-mr-2 size-4" />
            </button>
          </PopoverTrigger>
          <input
            id={id}
            type="tel"
            aria-label={ariaLabel}
            aria-invalid={invalid || undefined}
            value={value}
            placeholder="+99 99 99999 9999"
            onChange={(e) => {
              const raw = e.target.value
              const next = raw.trim() ? formatInternational(raw.startsWith('+') ? raw : `+${raw}`, code) : ''
              const guessed = countryOfNumber(next, code)
              // o país acompanha o DDI digitado (mantém Canadá/EUA quando o DDI é +1)
              if (guessed !== code && !(digitsOf(next).startsWith('1') && (code === 'ca' || code === 'us'))) setCode(guessed)
              onChange(next)
            }}
            className="flex h-10 w-full min-w-0 rounded-e-md rounded-s-none border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring aria-[invalid=true]:border-destructive"
          />
        </div>
      </PopoverAnchor>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0">
        <Command>
          <CommandInput placeholder="Pesquisar país..." />
          <CommandList className="max-h-[200px]">
            <CommandEmpty>Nenhum resultado encontrado.</CommandEmpty>
            <CommandGroup>
              {FONIO_COUNTRIES.map((c) => (
                <CommandItem
                  key={c.code}
                  value={`${c.name} ${c.dial}`}
                  onSelect={() => {
                    const cc = digitsOf(current.dial)
                    const d = digitsOf(value)
                    const rest = d.startsWith(cc) ? d.slice(cc.length) : ''
                    setCode(c.code)
                    onChange(formatInternational(`${c.dial}${rest}`, c.code))
                    setOpen(false)
                  }}
                  className="gap-2"
                >
                  <span className="flex h-4 w-6 shrink-0 overflow-hidden rounded-[2px] bg-foreground/20">
                    <span className={cn('fi', `fi-${c.code}`, 'h-full w-full bg-cover')} />
                  </span>
                  <span className="flex-1 text-sm">{c.name}</span>
                  <span className="text-sm text-foreground/50">{c.dial}</span>
                  {c.code === code && <Check className="size-4" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
