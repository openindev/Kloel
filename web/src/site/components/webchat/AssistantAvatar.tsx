import { useId } from 'react'
import { cn } from '@/lib/utils'

/** Avatar ilustrado da assistente gerada (vetor próprio; substitui o avatar 3D da referência). accent = cor da blusa. */
export function AssistantAvatar({ accent = '#22C55E', className }: { accent?: string; className?: string }) {
  const id = useId().replace(/:/g, '')
  return (
    <svg viewBox="0 0 80 80" className={cn('h-full w-full', className)} aria-hidden>
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#F5F7FF" />
          <stop offset="1" stopColor="#E3E8FF" />
        </linearGradient>
        <linearGradient id={`${id}-skin`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#E7B48F" />
          <stop offset="1" stopColor="#CF9370" />
        </linearGradient>
      </defs>
      <rect width="80" height="80" fill={`url(#${id}-bg)`} />
      <path d="M21 42c0-17 8-28 19-28s19 11 19 28v20H21z" fill="#2A1A16" />
      <rect x="35" y="47" width="10" height="11" rx="3" fill="#C98763" />
      <path d="M12 82c2-15 12-23 28-23s26 8 28 23z" fill="#1E2A5A" />
      <path d="M33 59l7 13 7-13z" fill={accent} />
      <path d="M30 59l10 17-14-11zM50 59 40 76l14-11z" fill="#16204A" />
      <ellipse cx="40" cy="35" rx="12.5" ry="14.5" fill={`url(#${id}-skin)`} />
      <path d="M26 33c1-12 8-17 15-16 7 1 12 6 12 14-6-5-13-7-27 2z" fill="#2A1A16" />
      <ellipse cx="35" cy="37" rx="1.6" ry="2" fill="#2A1A16" />
      <ellipse cx="45" cy="37" rx="1.6" ry="2" fill="#2A1A16" />
      <path d="M35.5 43.5c2.5 2.2 6.5 2.2 9 0" stroke="#9A4B3A" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      <circle cx="31.5" cy="41.5" r="2.2" fill="#F2A3A0" opacity=".45" />
      <circle cx="48.5" cy="41.5" r="2.2" fill="#F2A3A0" opacity=".45" />
    </svg>
  )
}
