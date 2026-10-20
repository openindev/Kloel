import { useState, useRef } from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'

export interface PhoneCountry {
  code: string
  name: string
  dial: string
}

/**
 * Países do seletor de telefone da Fonio (fonio-live2/data/admin.json → account.country_picker e data/resources.json →
 * Transferir ligações): 33 países, nomes em inglês, ordem alfabética. Código ISO = classe da bandeira (flag-icons).
 */
export const PHONE_COUNTRIES: PhoneCountry[] = [
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

/**
 * Lista curta anterior (Brasil primeiro, nomes em português) — mantida só para quem ainda a importa fora do app
 * (site: CallbackWidget). O PhoneInput do app usa PHONE_COUNTRIES.
 */
export const COUNTRIES: PhoneCountry[] = [
  { code: 'br', name: 'Brasil', dial: '+55' },
  { code: 'pt', name: 'Portugal', dial: '+351' },
  { code: 'us', name: 'Estados Unidos', dial: '+1' },
  { code: 'ar', name: 'Argentina', dial: '+54' },
  { code: 'mx', name: 'México', dial: '+52' },
  { code: 'es', name: 'Espanha', dial: '+34' },
  { code: 'de', name: 'Alemanha', dial: '+49' },
  { code: 'gb', name: 'Reino Unido', dial: '+44' },
]

const BY_DIAL_LENGTH = [...PHONE_COUNTRIES].sort((a, b) => b.dial.length - a.dial.length)
const DEFAULT_COUNTRY = PHONE_COUNTRIES.find((c) => c.code === 'br')!

/** País pelo prefixo do número (DDI mais longo primeiro; +1 → United States, salvo escolha explícita de Canada). */
export function countryOfPhone(value: string, preferred?: string): PhoneCountry | undefined {
  const v = value.replace(/\s/g, '')
  const pref = PHONE_COUNTRIES.find((c) => c.code === preferred)
  if (pref && v.startsWith(pref.dial)) return pref
  const hits = BY_DIAL_LENGTH.filter((c) => v.startsWith(c.dial))
  if (!hits.length) return undefined
  return hits[0]!.dial === '+1' ? PHONE_COUNTRIES.find((c) => c.code === 'us') : hits[0]
}

function Flag({ code, className }: { code: string; className?: string }) {
  return (
    <span className={cn('flex h-4 w-6 shrink-0 overflow-hidden rounded-[4px] bg-foreground/20', className)}>
      <span className={cn('fi', `fi-${code}`, 'h-full w-full bg-cover')} />
    </span>
  )
}

/**
 * Campo de telefone com seletor de país, como o PhoneInput da Fonio (fonio-live2/K-admin/30, 35): botão com bandeira 24×16 +
 * chevrons-up-down; o popover ocupa a largura do campo inteiro, com a busca "Pesquisar país..." e os 33 países (bandeira, nome,
 * DDI à direita e check no selecionado).
 */
export function PhoneInput({ value, onChange, placeholder = '+55 11 96123 4567', className, invalid, id }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string; invalid?: boolean; id?: string }) {
  const [open, setOpen] = useState(false)
  const [chosen, setChosen] = useState<string | undefined>(undefined)
  const current = countryOfPhone(value, chosen) ?? (value.trim() ? undefined : DEFAULT_COUNTRY)
  // O popover tem a largura do campo inteiro. Sem PopoverAnchor: o Radix troca o elemento do gatilho depois de montar quando há
  // âncora própria, o botão é remontado e um diálogo perde o foco inicial (contorno cinza no diálogo inteiro). A largura do
  // campo é medida ao abrir e o conteúdo fica alinhado à borda esquerda do botão (= borda esquerda do campo).
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState<number | undefined>(undefined)
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        if (o) setWidth(wrapRef.current?.offsetWidth)
        setOpen(o)
      }}
    >
        <div ref={wrapRef} className={cn('flex', className)}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Selecionar país"
              className="flex h-10 items-center justify-center gap-1 whitespace-nowrap rounded-md rounded-e-none rounded-s-md border border-r-0 border-input bg-background px-3 py-2 text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {current ? <Flag code={current.code} /> : <span className="flex h-4 w-6 shrink-0 rounded-[4px] bg-foreground/20" />}
              {/* -mr-2 como no PhoneInput da Fonio (divisória a 61 px da borda esquerda). */}
              <ChevronsUpDown className="-mr-2 size-4 opacity-100" />
            </button>
          </PopoverTrigger>
          <input
            id={id}
            type="tel"
            value={value}
            aria-invalid={invalid || undefined}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className="flex h-10 w-full rounded-md rounded-e-md rounded-s-none border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-visible:ring-destructive"
          />
        </div>
      <PopoverContent className="p-0" style={{ width }} align="start">
        <Command>
          <CommandInput placeholder="Pesquisar país..." />
          <CommandList className="max-h-[200px]">
            <CommandEmpty>Nenhum país encontrado.</CommandEmpty>
            <CommandGroup>
              {PHONE_COUNTRIES.map((c) => (
                <CommandItem
                  key={c.code}
                  value={`${c.name} ${c.dial}`}
                  onSelect={() => {
                    const rest = value.replace(/^\+\d+\s?/, '')
                    setChosen(c.code)
                    onChange(rest ? `${c.dial} ${rest}` : c.dial)
                    setOpen(false)
                  }}
                >
                  <Flag code={c.code} />
                  <span className="flex-1 text-sm">{c.name}</span>
                  <span className="text-sm text-foreground/50">{c.dial}</span>
                  <Check className={cn('ml-auto size-4', current?.code === c.code ? 'opacity-100' : 'opacity-0')} />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
