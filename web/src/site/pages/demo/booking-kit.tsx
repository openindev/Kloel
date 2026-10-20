import { forwardRef, useRef, type InputHTMLAttributes, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { KloelLogo } from '@/components/brand/KloelLogo'
import { COUNTRIES } from '@/components/app/PhoneInput'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { siteInputCls } from '../company/kit'

/** Cabeçalho simplificado das páginas de agendamento (sem navegação global, como nas capturas [7]/[240]). */
export function BookingTopBar({ backTo = '/', backLabel = 'Voltar ao site', centered, overlay }: { backTo?: string; backLabel?: string; centered?: boolean; overlay?: boolean }) {
  if (centered) {
    return (
      <header className="relative z-10 flex h-[96px] items-center justify-center px-5 sm:h-[130px]">
        <Link to="/" aria-label="kloel.ai — início">
          <KloelLogo className="text-[30px] sm:text-[34px]" />
        </Link>
        <Link to={backTo} className="absolute left-5 top-1/2 hidden -translate-y-1/2 items-center gap-1.5 text-[14px] text-body hover:text-ink sm:inline-flex lg:left-[28px]">
          <ArrowLeft className="h-4 w-4" /> {backLabel}
        </Link>
      </header>
    )
  }
  return (
    <header className={cn('relative z-20 mx-auto flex h-[72px] w-full max-w-[1240px] items-center justify-between px-5 lg:px-8', overlay && 'lg:absolute lg:inset-x-0 lg:top-0 lg:h-[64px]')}>
      <Link to="/" aria-label="kloel.ai — início">
        <KloelLogo className="text-[23px]" />
      </Link>
      <Link to={backTo} className="inline-flex items-center gap-1.5 rounded-[10px] px-2 py-1.5 text-[14px] text-body hover:bg-slate-50 hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> {backLabel}
      </Link>
    </header>
  )
}

/** Códigos do mais longo para o mais curto: "+351…" é Portugal, não um "+3…" qualquer. */
const BY_DIAL = [...COUNTRIES].sort((a, b) => b.dial.length - a.dial.length)

/** País do número digitado — pelo código no início, com ou sem espaço depois dele ("+351912…" ou "+351 912…"). */
export function countryOfPhone(value: string) {
  const v = value.trim()
  return BY_DIAL.find((c) => v.startsWith(c.dial)) ?? COUNTRIES[0]!
}

/** Insere o espaço depois do código do país quando o número é digitado colado a ele ("+351912" → "+351 912"). */
export function spaceAfterDial(value: string) {
  const v = value.replace(/^\s+/, '')
  const c = BY_DIAL.find((x) => v.startsWith(x.dial))
  if (!c) return value
  const rest = v.slice(c.dial.length)
  return /^\d/.test(rest) ? `${c.dial} ${rest}` : v
}

/**
 * Campo de celular com bandeira + seletor de país embutidos (como em [9]/[277]): bandeira a ~11px da borda,
 * chevron pequeno e cinza, número logo depois. O país acompanha o código digitado.
 * O anel do campo só aparece com o foco no número (`has-[input:focus]`): clicar no seletor de país com o mouse não acende
 * o campo inteiro; o seletor tem o próprio anel apenas na navegação por teclado (`focus-visible`).
 */
export function PhoneField({ id, value, onChange, invalid, placeholder = '+55 11 91234-5678', className, inputClassName }: { id?: string; value: string; onChange: (v: string) => void; invalid?: boolean; placeholder?: string; className?: string; inputClassName?: string }) {
  const current = countryOfPhone(value)
  const inputRef = useRef<HTMLInputElement>(null)
  const picked = useRef(false)
  return (
    <div className={cn(siteInputCls, 'flex items-center gap-1.5 px-0 has-[input:focus]:border-brand-blue has-[input:focus]:bg-white has-[input:focus]:ring-2 has-[input:focus]:ring-brand-blue/15', invalid && 'border-red-400', className, 'px-0')}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label="Selecionar país" title={current.name} data-country={current.code} className="ml-[7px] flex h-8 shrink-0 items-center gap-0.5 rounded-md px-1 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40">
            <span className={cn('fi rounded-[2px]', `fi-${current.code}`)} />
            <ChevronDown className="h-3 w-3 text-slate-500" strokeWidth={2.25} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="w-56 font-site"
          onCloseAutoFocus={(e) => {
            // Escolheu um país: o foco vai para o número (o Radix devolveria o foco à bandeira depois de qualquer setTimeout).
            if (!picked.current) return
            picked.current = false
            e.preventDefault()
            const el = inputRef.current
            el?.focus()
            el?.setSelectionRange(el.value.length, el.value.length)
          }}
        >
          {COUNTRIES.map((c) => (
            <DropdownMenuItem
              key={c.code}
              onSelect={() => {
                const rest = value.trim().replace(new RegExp(`^\\${current.dial}\\s?`), '').replace(/^\+\d*\s?/, '')
                onChange(`${c.dial} ${rest}`)
                picked.current = true
              }}
            >
              <span className={cn('fi rounded-[2px]', `fi-${c.code}`)} />
              <span className="flex-1">{c.name}</span>
              <span className="text-muted-foreground">{c.dial}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <input
        ref={inputRef}
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        value={value}
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange(spaceAfterDial(e.target.value.replace(/[^\d+\s()-]/g, '')))}
        placeholder={placeholder}
        className={cn('h-full min-w-0 flex-1 bg-transparent pr-4 text-[16px] text-ink placeholder:text-slate-400 focus:outline-none', inputClassName)}
      />
    </div>
  )
}

/**
 * Campo do formulário "Seus dados" da demo, nas medidas de [9]/[277] (rótulo 14px, 9px até o campo,
 * campo 44px com texto 15px, asterisco cinza-claro; bordas dos campos medidas em [277]: 197–241, 289–333, 411–455…).
 * Mensagens de erro em PT logo abaixo do campo.
 */
export function DemoField({ label, htmlFor, required, error, children, className }: { label: ReactNode; htmlFor?: string; required?: boolean; error?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-[9px]', className)}>
      <label htmlFor={htmlFor} className="text-[14px] leading-5 text-ink">
        {label}
        {required && <span className="ml-0.5 text-slate-300">*</span>}
      </label>
      {children}
      {error && (
        <p role="alert" className="-mt-1 text-[13px] leading-5 text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}

export const demoInputCls = 'h-[44px] px-3.5 text-[15px]'

export const DemoInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(({ className, invalid, ...props }, ref) => (
  <input ref={ref} aria-invalid={invalid || undefined} className={cn(siteInputCls, demoInputCls, className)} {...props} />
))
DemoInput.displayName = 'DemoInput'
