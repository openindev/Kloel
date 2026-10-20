import { Link } from 'react-router-dom'
import { Check, Info, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { productByKey, type PlanDef } from '@/data/catalogs/plans'
import type { ProductKey } from '@/domain/types'
import { SimpleTooltip } from '@/components/ui/tooltip'

export type BillingInterval = 'monthly' | 'annual'

const BRL = (n: number) => `R$${n.toLocaleString('pt-BR')}`

/**
 * Preço exibido nas páginas públicas (/planos e páginas de produto): anual = `plan.publicAnnual ?? plan.annual`
 * (OBSERVADO [295]: Webchat R$250/R$750 no site contra R$249/R$749 no app); Scale = valor "a partir de".
 */
export function publicPlanPrice(plan: PlanDef, interval: BillingInterval): number {
  if (plan.monthly === null) return (interval === 'monthly' ? plan.fromPrice?.monthly : plan.fromPrice?.annual) ?? 0
  if (interval === 'annual') return plan.publicAnnual ?? plan.annual ?? plan.monthly
  return plan.monthly
}

/** Selo do ciclo anual = mensal − preço exibido (reproduz [295]: R$299 → R$250 = "Economize R$49"); Scale usa o texto do catálogo. */
export function publicPlanSavings(plan: PlanDef, interval: BillingInterval): string | undefined {
  if (plan.monthly === null) return plan.savings
  if (interval !== 'annual') return undefined
  const diff = plan.monthly - publicPlanPrice(plan, 'annual')
  return diff > 0 ? `Economize R$${diff.toLocaleString('pt-BR')}` : undefined
}

/**
 * Seletor "Mensal | Anual" do site (trilho cinza, pílula branca no item ativo).
 * props: value, onChange, annualHint (ex.: "-20%" ou "Economize no anual")
 */
export function IntervalToggle({ value, onChange, annualHint = '-20%', className }: { value: BillingInterval; onChange: (v: BillingInterval) => void; annualHint?: string; className?: string }) {
  const opt = (v: BillingInterval, label: string, hint?: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={value === v}
      onClick={() => onChange(v)}
      className={cn('inline-flex h-10 items-center gap-2 rounded-[10px] px-4 text-[16px] transition-colors', value === v ? 'bg-white text-heading shadow-[0_1px_3px_rgba(15,15,22,.1)]' : 'text-body hover:text-heading')}
    >
      {label}
      {hint && <span className="text-[15px] text-brand-blue">{hint}</span>}
    </button>
  )
  return (
    <div role="radiogroup" aria-label="Período de cobrança" className={cn('inline-flex items-center gap-1 rounded-xl bg-[#F3F4F8] p-1', className)}>
      {opt('monthly', 'Mensal')}
      {opt('annual', 'Anual', annualHint)}
    </div>
  )
}

/** Explicação de cada recurso marcado com ⓘ (valores demonstrativos da casca; cada texto descreve o recurso ao lado). */
const FEATURE_INFO: Record<string, string> = {
  'Agenda + reservas': 'Durante a ligação, o assistente consulta a agenda conectada (ex.: Google Agenda ou Cal.com) e marca, remarca ou cancela horários.',
  'Tronco SIP dedicado': 'Conecte a Kloel à central telefônica (PABX) da sua empresa por um tronco SIP exclusivo, sem trocar de operadora.',
  'Ligações ativas': 'Além de atender, o assistente faz ligações de saída, como confirmações de consulta e lembretes de agendamento.',
  'A partir de 6000 minutos': 'Pacote mensal negociado conforme o seu volume; minutos além do pacote têm tarifa personalizada.',
  'Transferência para humano': 'Quando a IA não souber responder ou o cliente pedir, a conversa passa para alguém da sua equipe, que pode devolvê-la à IA depois.',
  'Agendamento automatizado': 'A IA consulta a agenda conectada e marca o horário pelo próprio WhatsApp, enviando a confirmação ao cliente.',
  Onboarding: 'Sessão guiada com o nosso time para configurar o assistente, conectar o número e revisar as respostas antes de entrar no ar.',
}

function featureInfo(text: string, extra?: string) {
  if (FEATURE_INFO[text]) return FEATURE_INFO[text]
  const conv = /^([\d.]+\+?) conversas$/.exec(text)
  if (conv) {
    const msgs = extra ? ` Limite total de mensagens: ${extra.replace(/^Até /, 'até ')}.` : ''
    return `Uma conversa é cada atendimento a um visitante do seu site, contada a partir da primeira mensagem dele. O plano inclui ${conv[1]} conversas por mês.${msgs}`
  }
  return `${text}: veja os detalhes completos na página Planos.`
}

function Item({ text, extra, negative, info, chip }: { text: string; extra?: string; negative?: boolean; info?: boolean; chip?: string }) {
  return (
    <li className="flex gap-3">
      {negative ? <X className="mt-1.5 h-4 w-4 shrink-0 text-slate-300" /> : <Check className="mt-1.5 h-4 w-4 shrink-0 text-brand-blue" />}
      <div className="min-w-0">
        <div className={cn('flex flex-wrap items-center gap-1.5 text-[16px] leading-7 text-heading', negative && 'text-slate-400 line-through')}>
          {text}
          {chip && <span className="rounded-md bg-[#F3F4F6] px-2 py-0.5 text-[14px] font-medium leading-5 text-heading">{chip}</span>}
          {info && (
            <SimpleTooltip label={featureInfo(text, extra)}>
              <button type="button" aria-label={`Mais informações sobre ${text}`} className="text-slate-400 hover:text-ink">
                <Info className="h-3.5 w-3.5" />
              </button>
            </SimpleTooltip>
          )}
        </div>
        {extra && <div className="-mt-0.5 pb-0.5 text-[13px] leading-5 text-body">{extra}</div>}
      </div>
    </li>
  )
}

/**
 * Cartões públicos de planos (Solo / Team "POPULAR" / Scale) a partir do catálogo local de planos (valores demonstrativos).
 * props:
 *  - product: 'voice' | 'whatsapp' | 'webchat'
 *  - interval: 'monthly' | 'annual'
 *  - ctaTo? (padrão "/criar-conta" — nota do operador: nenhum botão de compra leva a checkout)
 *  - onSelect?(tier) chamado no clique (antes da navegação)
 */
export function PricingCards({ product, interval, ctaTo = '/criar-conta', onSelect, className }: { product: Extract<ProductKey, 'voice' | 'whatsapp' | 'webchat'>; interval: BillingInterval; ctaTo?: string; onSelect?: (tier: string) => void; className?: string }) {
  const p = productByKey(product)
  return (
    <div className={cn('mx-auto grid max-w-[1150px] gap-4 lg:grid-cols-3', className)}>
      {p.plans.map((plan) => {
        const popular = !!plan.recommended
        const price = publicPlanPrice(plan, interval)
        const savings = publicPlanSavings(plan, interval)
        const isScale = plan.monthly === null
        return (
          <article key={plan.tier} className={cn('relative flex flex-col rounded-2xl border bg-white px-6 pb-6 pt-[31px]', popular ? 'border-brand-blue shadow-[0_10px_40px_-20px_rgba(88,93,254,.6)]' : 'border-[#E6E8EE]')}>
            {popular && <span className="absolute right-4 top-4 rounded-md bg-brand-blue px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.06em] text-white">Popular</span>}
            {/* espaçamentos da referência 05.png / 5.png (1460px), medidos por perfil de pixels a partir da borda superior do cartão: nome +38, descrição +68,
                preço +113, "Por mês" +155, botão de 50 px em +198, divisória +271, "Incluído" +301, 1º item +337 (28px por linha) */}
            <h3 className="text-[20px] font-medium leading-7 text-heading">{plan.name}</h3>
            <p className="mt-[3px] text-[16px] text-body">{plan.publicTagline}</p>
            <div className="mt-[19px] flex min-h-[40px] flex-wrap items-end gap-x-2.5 gap-y-2">
              {isScale && <span className="pb-1 text-[15px] text-body">{interval === 'monthly' ? 'a partir de' : 'A partir de'}</span>}
              <span className="text-[34px] font-medium leading-none tracking-[-0.02em] text-heading">{BRL(price)}</span>
              {interval === 'annual' && !isScale && savings && <span className="mb-1 rounded-md border border-brand-blue/50 px-2 py-0.5 text-[13px] text-brand-blue">{savings}</span>}
            </div>
            {/* Scale: a faixa do selo "Tarifas personalizadas" fica reservada também no mensal (invisível), por isso "Por mês" e o botão
                ficam ≈27px mais baixos que nos outros planos — como em 05.png (mensal) e 0b. Anual/01.png */}
            {isScale && (
              <span aria-hidden={interval === 'monthly' || undefined} className={cn('mt-2 w-fit rounded-md border border-brand-blue/50 px-2 py-0.5 text-[13px] leading-[18px] text-brand-blue', (interval === 'monthly' || !plan.savings) && 'invisible')}>
                {plan.savings ?? '—'}
              </span>
            )}
            <p className={cn('text-[15px] text-body', isScale ? 'mt-0' : 'mt-1')}>{interval === 'monthly' ? 'Por mês' : 'Por mês, cobrado anualmente'}</p>
            <Link
              to={ctaTo}
              onClick={() => onSelect?.(plan.tier)}
              className={cn('mt-[25px] flex h-[50px] items-center justify-center rounded-xl text-[16px] transition-colors', popular ? 'bg-brand-blue text-white hover:bg-[#4a4fe6]' : 'bg-heading text-white hover:bg-heading/90')}
            >
              {isScale ? 'Configurar plano' : 'Começar agora'}
            </Link>
            <div className="mb-6 mt-[23px] h-px bg-[#E6E8EE]" />
            <div className="text-[16px] font-medium text-heading">Incluído</div>
            <ul className="mt-2.5 flex flex-col">
              {plan.publicIncluded.map((it) => (
                <Item key={it.text} {...it} />
              ))}
            </ul>
            <div className="mt-[22px] text-[16px] font-medium text-heading">Funcionalidades</div>
            <ul className="mt-2.5 flex flex-col">
              {plan.publicFeatures.map((it) => (
                <Item key={it.text} {...it} />
              ))}
            </ul>
          </article>
        )
      })}
    </div>
  )
}
