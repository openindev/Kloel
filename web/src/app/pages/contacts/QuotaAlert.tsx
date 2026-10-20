import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { CircleX } from 'lucide-react'
import { Alert } from '@/components/ui/alert'
import { formatInt, type ContactQuota } from './lib'

/** Aviso de restrição por plano (cota de contatos atingida). */
export function ContactQuotaAlert({ quota, action = 'criar novos contatos', lead }: { quota: ContactQuota; action?: string; lead?: ReactNode }) {
  return (
    <Alert variant="destructive" className="border-destructive/50 text-destructive" data-testid="contact-quota-alert">
      <CircleX />
      <div className="text-sm">
        {lead ?? (
          <>
            Seu plano {quota.planName} inclui {formatInt(quota.limit)} contatos e todos estão em uso ({formatInt(quota.used)} de {formatInt(quota.limit)}).
          </>
        )}{' '}
        Para {action},{' '}
        <Link to={`/app/change-plan/${quota.product ?? 'voice'}`} className="underline underline-offset-4">
          faça upgrade do seu plano
        </Link>{' '}
        (contatos adicionais: 1.000 por R$ 120/mês) ou exclua contatos que não usa mais.
      </div>
    </Alert>
  )
}

