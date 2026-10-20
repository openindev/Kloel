import { forwardRef, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Campos de formulário no estilo do site público (Roboto, raio 10–12px, borda clara, foco na cor da marca). */
export function SiteField({ label, required, error, children, className, hint, htmlFor }: { label: ReactNode; required?: boolean; error?: string | null; children: ReactNode; className?: string; hint?: ReactNode; htmlFor?: string }) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-[14px] font-medium text-heading">
        {label}
        {required && <span className="text-slate-300">*</span>}
      </label>
      {children}
      {hint && !error && <span className="text-[12.5px] text-body">{hint}</span>}
      {error && <span role="alert" className="text-[13px] text-red-600">{error}</span>}
    </div>
  )
}

export const SiteInput = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(({ className, invalid, ...props }, ref) => (
  <input
    ref={ref}
    aria-invalid={invalid || undefined}
    className={cn('h-11 w-full rounded-[10px] border border-[#E1E3EA] bg-white px-3.5 text-[15px] text-ink outline-none transition-shadow placeholder:text-slate-400 focus:border-brand-blue focus:ring-[3px] focus:ring-brand-blue/15 disabled:bg-slate-50', invalid && 'border-red-400 focus:border-red-400 focus:ring-red-100', className)}
    {...props}
  />
))
SiteInput.displayName = 'SiteInput'

export const SiteTextarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(({ className, invalid, ...props }, ref) => (
  <textarea
    ref={ref}
    aria-invalid={invalid || undefined}
    className={cn('min-h-[88px] w-full rounded-[10px] border border-[#E1E3EA] bg-white px-3.5 py-2.5 text-[15px] text-ink outline-none transition-shadow placeholder:text-slate-400 focus:border-brand-blue focus:ring-[3px] focus:ring-brand-blue/15', invalid && 'border-red-400', className)}
    {...props}
  />
))
SiteTextarea.displayName = 'SiteTextarea'

/**
 * Select nativo no estilo do site. O chevron é um ícone SVG inline (lucide `ChevronDown`) sobreposto ao campo:
 * a classe `bg-[url(...)]` com espaços não era gerada pelo Tailwind e o select ficava sem seta.
 */
export const SiteSelect = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean; wrapperClassName?: string }>(({ className, wrapperClassName, invalid, children, ...props }, ref) => (
  <span className={cn('relative block w-full', wrapperClassName)}>
    <select
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn('h-11 w-full appearance-none rounded-[10px] border border-[#E1E3EA] bg-white px-3.5 pr-9 text-[15px] text-ink outline-none focus:border-brand-blue focus:ring-[3px] focus:ring-brand-blue/15 disabled:bg-slate-50', invalid && 'border-red-400', className)}
      {...props}
    >
      {children}
    </select>
    <ChevronDown aria-hidden className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
  </span>
))
SiteSelect.displayName = 'SiteSelect'

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function validateEmail(v: string) {
  if (!v.trim()) return 'Informe seu e-mail.'
  if (!EMAIL_RE.test(v.trim())) return 'Informe um e-mail válido, por exemplo maria@empresa.com.br.'
  return null
}

export function validatePhoneBR(v: string) {
  const d = v.replace(/\D/g, '')
  if (!d) return 'Informe seu telefone.'
  if (d.length < 10 || d.length > 13) return 'Informe um telefone válido com DDD, por exemplo (11) 90000-0123.'
  return null
}
