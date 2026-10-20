import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** Wrapper de conteúdo das páginas do app (padding observado: pt-10 lg:pt-20 pb-8 px-4 sm:px-8). */
export function PageContainer({ children, width = 'wide', className }: { children: ReactNode; width?: 'wide' | 'narrow' | 'full'; className?: string }) {
  if (width === 'narrow') return <div className={cn('pt-10 lg:pt-20 pb-8 px-4 sm:px-8 grow w-full max-w-[764px] mx-auto', className)}>{children}</div>
  if (width === 'full') return <div className={cn('pt-10 lg:pt-20 pb-8 px-4 sm:px-8', className)}>{children}</div>
  return (
    <div className={cn('pt-10 lg:pt-20 pb-8 px-4 sm:px-8', className)}>
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6">{children}</div>
    </div>
  )
}

/** Título de página "xl:text-3xl text-2xl font-semibold tracking-tight". */
export function PageTitle({ children, className, actions }: { children: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-3', className)}>
      <div className="xl:text-3xl text-2xl font-semibold tracking-tight flex flex-row items-center min-w-0">
        <span className="min-w-0 overflow-hidden">{children}</span>
      </div>
      {actions}
    </div>
  )
}

/** Cabeçalho das seções de assistente: h1 text-3xl. */
export function SectionHeading({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-7 flex items-start justify-between gap-4 pt-4">
      <h1 className="text-3xl font-semibold tracking-tight">{children}</h1>
      {actions}
    </div>
  )
}

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('px-3 mb-3 text-xs font-medium text-muted-foreground', className)}>{children}</p>
}

export function SettingsCard({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('rounded-xl border bg-background divide-y', className)}>{children}</div>
}

export function SettingsRow({
  label,
  description,
  children,
  compact,
  className,
  wrapDescription,
}: {
  label: ReactNode
  description?: ReactNode
  children?: ReactNode
  compact?: boolean
  className?: string
  /** por padrão a descrição é truncada em 1 linha (observado na Fonio); use para permitir quebra */
  wrapDescription?: boolean
}) {
  return (
    <div className={cn('flex min-h-14 items-center justify-between gap-4 px-5', compact ? 'py-2' : 'py-4', className)}>
      <div className={cn('min-w-0', compact && 'shrink-0')}>
        <span className="block text-sm font-medium">{label}</span>
        {description && <span className={cn('mt-0.5 block text-xs text-muted-foreground', !wrapDescription && 'truncate')}>{description}</span>}
      </div>
      <div className="flex min-w-0 flex-1 items-center justify-end">{children}</div>
    </div>
  )
}

/** Cartão branco das páginas de conta/empresa: "bg-white rounded-xl border shadow px-8 py-8". */
export function WhiteCard({ children, className, title, description }: { children?: ReactNode; className?: string; title?: ReactNode; description?: ReactNode }) {
  return (
    <div className={cn('bg-white rounded-xl border shadow px-8 py-8', className)}>
      {title && <div className={cn('font-semibold', description ? 'mb-1' : 'mb-8')}>{title}</div>}
      {description && <div className="mb-6 text-sm text-muted-foreground">{description}</div>}
      {children}
    </div>
  )
}
