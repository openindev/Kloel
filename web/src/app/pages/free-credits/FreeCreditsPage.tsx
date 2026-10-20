import { captureEngineContext } from '@/services/engine/session'
import { useEffect, useState, type ReactNode } from 'react'
import { Copy, Gift, ExternalLink, Link2Off } from 'lucide-react'
import { toast } from 'sonner'
import '@/domain/ext/mais-b'
import '@/domain/ext/billing'
import type { CreditClaim } from '@/domain/ext/mais-b'
import { useBillingProfile, useCurrentOrg, useCurrentUser, useStore } from '@/data/store'
import { PageTitle } from '@/components/app/Page'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { formatCurrencyBRL, uid } from '@/lib/utils'
import { referralLinkOf } from '@/app/pages/billing/referral'
import { BrandLogo } from '@/components/brand/IntegrationLogo'

/**
 * /app/free-credits — "Bônus grátis" (título "Desconto na sua próxima fatura"), igual à conta Fonio ao vivo
 * (fonio-live2/K-admin/14–16 · data/referral.json; texto e valores atualizados pela Fonio ao vivo em 2026-10-19 —
 * live-compare/K-admin/03–04): um cartão com 3 parágrafos e 8 itens. Logos de terceiros servidos em
 * public/brands (mesmas marcas exibidas pela Fonio); a marca própria usa a letra "k" no lugar do "f".
 * Links externos de terceiros ficam desativados neste ambiente local (DEV_GUIDE regra 2) e "por este formulário" abre o
 * formulário de envio local (no lugar do formulário externo).
 */

/** Marca própria (Fonio: /free-credits-logos/fonio.png — "f" em degradê índigo → preto, h-8). */
function KloelGlyph() {
  return (
    <span aria-hidden className="ml-1 inline-flex h-8 items-center bg-gradient-to-b from-[#585DFE] to-[#0b0b1a] bg-clip-text text-[34px] font-bold leading-none text-transparent">
      k
    </span>
  )
}

interface Reward {
  id: string
  title: string
  icon: ReactNode
  /** texto antes do link */
  text: string
  linkText: string
  /** destino externo (desativado localmente) ou mailto */
  external?: string
  mailto?: string
  amount: number | null
}

const CASE_STUDY_EMAIL = 'contato@kloel.ai'
/** Páginas da Kloel nos sites de avaliação/redes. Preencha com as URLs reais; vazio = o botão leva direto ao formulário. */
const REVIEW_URLS: Record<string, string> = { omr: '', capterra: '', g2: '', linkedin: '', blog: '', youtube: '' }

const REWARDS: Reward[] = [
  { id: 'omr', title: 'Avaliação no OMR', icon: <BrandLogo brand="omr" />, text: 'Escreva uma avaliação no OMR Reviews.', linkText: 'Link para nossa página no OMR', external: 'OMR Reviews', amount: 180 },
  { id: 'capterra', title: 'Capterra', icon: <BrandLogo brand="capterra" />, text: 'Escreva uma avaliação no Capterra.', linkText: 'Link para nossa página no Capterra', external: 'Capterra', amount: 180 },
  { id: 'g2', title: 'G2', icon: <BrandLogo brand="g2" />, text: 'Escreva uma avaliação no G2.', linkText: 'Link para nossa página no G2', external: 'G2', amount: 120 },
  { id: 'linkedin', title: 'LinkedIn', icon: <BrandLogo brand="linkedin" />, text: 'Faça uma publicação no LinkedIn sobre a kloel.', linkText: 'Link para nossa página no LinkedIn', external: 'LinkedIn', amount: 180 },
  { id: 'blog', title: 'Post sobre a kloel no blog', icon: <KloelGlyph />, text: 'Publique um post sobre a kloel no seu site.', linkText: 'Link para nosso blog', external: 'blog da kloel', amount: 300 },
  { id: 'case', title: 'Case study com entrevista em vídeo de 5 minutos', icon: <KloelGlyph />, text: 'Faça um case study com a gente para publicarmos na kloel.', linkText: `E-mail para ${CASE_STUDY_EMAIL}`, mailto: CASE_STUDY_EMAIL, amount: 600 },
  { id: 'youtube', title: 'YouTube', icon: <BrandLogo brand="youtube" />, text: 'Publique um vídeo no YouTube sobre a kloel.', linkText: 'Link para nosso canal no YouTube', external: 'YouTube', amount: null },
]
const rewardById = (id: string) => REWARDS.find((r) => r.id === id)
const money = (n: number | null) => (n === null ? 'Personalizado' : formatCurrencyBRL(n).replace(/,00$/, ''))
/** Valor exibido na lista: sempre "R$ " com espaço (Fonio ao vivo 2026-10-19, live-compare/K-admin/03–04: "R$ 180", "R$ 1.800"). */
const rewardMoney = (n: number | null) => (n === null ? 'Personalizado' : `R$ ${n.toLocaleString('pt-BR')}`)
const REFERRAL_VALUE = 'R$ 1.800'

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

function patchClaims(fn: (list: CreditClaim[]) => CreditClaim[]) {
  useStore.getState().patchBilling((b) => ({ ...b, creditClaims: fn(b.creditClaims ?? []) }))
}

/* ------------------- "por este formulário": envio da captura/link ------------------- */

function ClaimDialog({ open, onOpenChange, initialReward }: { open: boolean; onOpenChange: (o: boolean) => void; initialReward: string }) {
  const billing = useBillingProfile()
  const me = useCurrentUser()
  const [rewardId, setRewardId] = useState(initialReward)
  const [evidence, setEvidence] = useState('')
  const [note, setNote] = useState('')
  const [submitted, setSubmitted] = useState(false)
  useEffect(() => {
    if (!open) return
    setRewardId(initialReward)
    setEvidence('')
    setNote('')
    setSubmitted(false)
  }, [open, initialReward])
  const [claims, setClaims] = useState<{ rewardId: string; status: string }[]>([])
  const [sending, setSending] = useState(false)
  useEffect(() => { if (!open) return; const c = captureEngineContext(); void c.request<{ items: { rewardId: string; status: string }[] }>('/credit-claims').then(r => setClaims(r.items)).catch(() => {}) }, [open])
  const pendingSame = claims.some((c) => c.rewardId === rewardId && c.status === 'pending')
  const evErr = evidence.trim().length < 8 ? 'Informe o link da publicação ou descreva a captura de tela (mín. 8 caracteres).' : null
  const reward = rewardById(rewardId)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] grid-cols-[minmax(0,1fr)] gap-y-6 rounded-2xl p-5 sm:max-w-lg sm:p-6">
        <DialogHeader className="gap-y-2 pr-6 text-left">
          <DialogTitle>Desconto na sua próxima fatura</DialogTitle>
          <DialogDescription>Envie uma captura de tela ou um link e descontamos o valor da sua próxima fatura.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            setSubmitted(true)
            if (evErr || pendingSame || !reward || sending) return
            setSending(true)
            const c = captureEngineContext()
            c.request<{ rewardId: string; status: string }>('/credit-claims', { method: 'POST', body: { rewardId, evidence: evidence.trim(), note: note.trim() } }).then((r) => {
              setClaims((x) => [...x, r]); toast.success('Envio recebido', { description: `Vamos analisar e aplicar ${money(reward.amount)} de desconto na sua próxima fatura.` }); onOpenChange(false)
            }, (e) => toast.error(e instanceof Error ? e.message : 'Não foi possível enviar.')).finally(() => setSending(false))
          }}
        >
          <div className="grid gap-2">
            <Label>Recompensa</Label>
            <Select value={rewardId} onValueChange={setRewardId}>
              <SelectTrigger aria-label="Recompensa" className="min-w-0 [&>span]:truncate"><SelectValue /></SelectTrigger>
              <SelectContent>
                {REWARDS.map((r) => <SelectItem key={r.id} value={r.id}>{r.title} — {money(r.amount)}</SelectItem>)}
              </SelectContent>
            </Select>
            {pendingSame && <p className="text-sm font-medium text-destructive">Você já tem um envio em análise para esta recompensa.</p>}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="claim-evidence" className={submitted && evErr ? 'text-destructive' : undefined}>Link ou captura de tela</Label>
            <Input id="claim-evidence" value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="https://… ou descreva a captura de tela" aria-invalid={submitted && !!evErr} />
            {submitted && evErr && <p className="text-sm font-medium text-destructive">{evErr}</p>}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="claim-note">Observação (opcional)</Label>
            <Textarea id="claim-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
          </div>
          <DialogFooter className="mt-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={pendingSame || sending}>Enviar</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* --------------------------------- Página -------------------------------- */

export default function FreeCreditsPage() {
  const org = useCurrentOrg()
  const link = referralLinkOf(org)
  const [external, setExternal] = useState<Reward | null>(null)
  const [claimOpen, setClaimOpen] = useState(false)
  const [claimReward, setClaimReward] = useState('omr')

  const copyLink = async () => {
    if (!org?.referralCode) { toast.error('O link de indicação ainda não está disponível para esta organização.'); return }
    // Mesmo toast do cartão "Indique um amigo" da barra lateral (K-admin/15).
    if (await copyText(link)) toast.success('Link copiado para a área de transferência')
    else toast.info('Copie o link manualmente', { description: link })
  }
  const openClaim = (rewardId: string) => {
    setClaimReward(rewardId)
    setClaimOpen(true)
  }

  return (
    <div className="pt-10 lg:pt-20 pb-8 px-4 sm:px-8">
      <PageTitle className="mb-4 md:mb-8">Desconto na sua próxima fatura</PageTitle>

      <div className="rounded-xl border bg-white px-4 py-6 shadow sm:px-8 sm:py-8">
        <div className="space-y-3 text-sm">
          <div className="text-lg font-semibold">Ganhe um desconto na sua próxima fatura</div>
          <div>As primeiras avaliações costumam ser as mais difíceis — especialmente para startups.</div>
          <div>Se você nos apoiar, ficamos muito felizes e descontamos o valor da sua próxima fatura ❤️</div>
          <div>
            Basta nos enviar uma captura de tela ou um link{' '}
            <button type="button" className="text-blue-500" onClick={() => openClaim('omr')}>por este formulário</button>{' '}
            e descontamos o valor da sua próxima fatura.
          </div>
        </div>
        <div className="mt-6">
          <ul role="list" className="divide-y divide-gray-200">
            <li className="py-3 sm:py-4">
              <div className="flex items-center">
                <div className="w-10"><Gift className="ml-1 h-7 w-7" /></div>
                <div className="ms-4 min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-gray-900">Indique um amigo</div>
                  <div className="text-sm text-gray-500">
                    Compartilhe seu link com um amigo. Ele ganha 50% de desconto por 2 meses. Você recebe o crédito na sua conta depois que ele completar um mês como cliente.{' '}
                    <button type="button" onClick={copyLink} className="text-blue-500 hover:underline">
                      Copiar link
                      <Copy className="ml-1 inline h-3.5 w-3.5 align-[-2px]" />
                    </button>
                  </div>
                </div>
                <div className="ms-4 shrink-0">
                  <span className="inline-flex items-center text-base font-semibold text-gray-900">{REFERRAL_VALUE}</span>
                </div>
              </div>
            </li>
            {REWARDS.map((r) => (
              <li key={r.id} className="py-3 sm:py-4">
                <div className="flex items-center">
                  <div className="w-10">{r.icon}</div>
                  <div className="ms-4 min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-gray-900">{r.title}</div>
                    <div className="text-sm text-gray-500">
                      {r.text}{' '}
                      {r.mailto ? (
                        <a className="text-blue-500" href={`mailto:${r.mailto}`} target="_blank" rel="noreferrer">{r.linkText}</a>
                      ) : (
                        REVIEW_URLS[r.id] ? (
                          <a className="text-blue-500" href={REVIEW_URLS[r.id]} target="_blank" rel="noreferrer">{r.linkText}</a>
                        ) : (
                          <button type="button" className="text-left text-blue-500" onClick={() => setExternal(r)}>{r.linkText}</button>
                        )
                      )}
                    </div>
                  </div>
                  <div className="ms-4 shrink-0">
                    <span className="inline-flex items-center text-base font-semibold text-gray-900">{rewardMoney(r.amount)}</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Link de terceiro desativado neste ambiente local (DEV_GUIDE regra 2). */}
      <Dialog open={!!external} onOpenChange={(o) => !o && setExternal(null)}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] grid-cols-[minmax(0,1fr)] gap-y-6 rounded-2xl p-5 sm:max-w-lg sm:p-6" data-testid="external-link-dialog">
          <DialogHeader className="gap-y-2 pr-6 text-left">
            <DialogTitle className="flex items-start gap-2 leading-snug"><ExternalLink className="mt-0.5 h-5 w-5 shrink-0" /> {external?.title}</DialogTitle>
            <DialogDescription className="break-words">
              Publique sua avaliação ou conteúdo em {external?.external} e envie o link ou a captura de tela pelo formulário. O desconto é aplicado na sua próxima fatura depois da análise.
            </DialogDescription>
          </DialogHeader>
          {external && (
            <div className="flex min-w-0 items-center gap-3 rounded-lg border p-4">
              <div className="flex w-10 shrink-0 justify-center">{external.icon}</div>
              <div className="min-w-0 flex-1">
                <div className="break-words text-sm font-medium">{external.title}</div>
                <div className="text-xs text-muted-foreground">Desconto: {money(external.amount)}</div>
              </div>
              <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="secondary" onClick={() => setExternal(null)}>Fechar</Button>
            <Button
              onClick={() => {
                const id = external?.id ?? 'omr'
                setExternal(null)
                openClaim(id)
              }}
            >
              Abrir formulário
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ClaimDialog open={claimOpen} onOpenChange={setClaimOpen} initialReward={claimReward} />
    </div>
  )
}
