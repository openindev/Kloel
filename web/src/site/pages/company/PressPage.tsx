import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowDown, ChevronRight, Download } from 'lucide-react'
import { toast } from 'sonner'
import { KloelLogo, KloelMark } from '@/components/brand/KloelLogo'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { usePageTitle } from '@/site/components/usePageTitle'
import { SITE_COMPANY } from '@/site/layout/nav'
import { useReturnFocus } from '@/site/layout/useReturnFocus'
import { Chip, FinalCtaBand, SiteHeading, SoftAurora, siteButton } from './kit'
import { LeadDialog } from './LeadDialog'

/**
 * /imprensa — "Área de imprensa" (OBSERVADO [233]–[235]).
 * Releases, métricas e textos institucionais da Fonio NÃO são usados: tudo abaixo é ilustrativo (sem selos na página — E1).
 */
const PRESS_EMAIL = 'imprensa@kloel.ai'

interface Release {
  slug: string
  date: string
  title: string
  body: string[]
}

const RELEASES: Release[] = [
  {
    slug: 'kloel-ai-lancamento',
    date: '20.10.2026',
    title: 'Kloel AI lança assistentes de IA para telefone, WhatsApp e chat do site para pequenas e médias empresas',
    body: [
      'A Kloel Tecnologia Ltda., de Caldas Novas (GO), lançou a Kloel AI (www.kloel.ai), plataforma em que empresas criam assistentes de IA que atendem ligações, respondem no WhatsApp e conversam no chat do site, agendam compromissos e registram cada atendimento em uma caixa de conversas única.',
      'A contratação é feita direto no site, com planos mensais e anuais por produto, e o primeiro assistente fica pronto no primeiro acesso, com ligação de teste antes de conectar um número.',
      `Contato para imprensa: ${PRESS_EMAIL}.`,
    ],
  },
]

function downloadLogo(variant: 'claro' | 'escuro') {
  const fg = variant === 'claro' ? '#0F0F14' : '#FFFFFF'
  const bg = variant === 'claro' ? '#FFFFFF' : '#0F0F16'
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="200" viewBox="0 0 640 200"><rect width="640" height="200" fill="${bg}"/><text x="60" y="128" font-family="Arial, Helvetica, sans-serif" font-size="96" font-weight="700" letter-spacing="-4" fill="${fg}">kloel<tspan fill="#585DFE">.ai</tspan></text></svg>`
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `kloel-logo-${variant}.svg`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  toast.success(`Logo (${variant}) baixado em SVG.`)
}

/**
 * Kit de fotos para imprensa: ilustrações vetoriais (sem fotos reais de pessoas ou da sede).
 * Cada uma tem prévia na página e download em SVG (1600 × 1000).
 */
interface PressPhoto {
  slug: string
  title: string
  caption: string
  svg: string
}

const PRESS_PHOTOS: PressPhoto[] = [
  {
    slug: 'escritorio',
    title: 'Escritório da Kloel',
    caption: `Sede em ${SITE_COMPANY.hq}`,
    svg: `<rect width="1600" height="1000" fill="#EEF0FF"/><rect y="640" width="1600" height="360" fill="#DADDFB"/><rect x="140" y="140" width="420" height="380" rx="24" fill="#FFFFFF"/><rect x="170" y="170" width="170" height="320" rx="12" fill="#C7C9FF"/><rect x="360" y="170" width="170" height="320" rx="12" fill="#C7C9FF"/><rect x="760" y="250" width="560" height="300" rx="20" fill="#FFFFFF"/><rect x="800" y="290" width="200" height="40" rx="10" fill="#585DFE"/><rect x="800" y="360" width="440" height="20" rx="10" fill="#E1E3F4"/><rect x="800" y="400" width="360" height="20" rx="10" fill="#E1E3F4"/><rect x="620" y="600" width="760" height="40" rx="20" fill="#7378F6"/><rect x="660" y="640" width="30" height="220" fill="#585DFE"/><rect x="1310" y="640" width="30" height="220" fill="#585DFE"/><circle cx="300" cy="760" r="90" fill="#A3A8FB"/><rect x="250" y="760" width="100" height="180" rx="20" fill="#585DFE"/>`,
  },
  {
    slug: 'equipe',
    title: 'Equipe',
    caption: 'Time de produto e atendimento',
    svg: `<rect width="1600" height="1000" fill="#F4F5FF"/><circle cx="400" cy="420" r="120" fill="#C7C9FF"/><rect x="250" y="560" width="300" height="440" rx="150" fill="#585DFE"/><circle cx="800" cy="380" r="130" fill="#A5B4FC"/><rect x="640" y="530" width="320" height="470" rx="160" fill="#0F0F16"/><circle cx="1200" cy="420" r="120" fill="#C7C9FF"/><rect x="1050" y="560" width="300" height="440" rx="150" fill="#7378F6"/>`,
  },
  {
    slug: 'produto',
    title: 'Produto',
    caption: 'Painel do assistente de IA',
    svg: `<rect width="1600" height="1000" fill="#585DFE"/><rect x="200" y="140" width="1200" height="720" rx="28" fill="#FFFFFF"/><rect x="200" y="140" width="260" height="720" rx="28" fill="#F4F5FF"/><rect x="240" y="200" width="160" height="28" rx="14" fill="#585DFE"/><rect x="240" y="270" width="180" height="20" rx="10" fill="#E1E3F4"/><rect x="240" y="320" width="150" height="20" rx="10" fill="#E1E3F4"/><rect x="240" y="370" width="170" height="20" rx="10" fill="#E1E3F4"/><rect x="520" y="200" width="380" height="200" rx="20" fill="#EEF0FF"/><rect x="940" y="200" width="400" height="200" rx="20" fill="#EEF0FF"/><polyline points="540,360 620,320 700,340 780,280 880,250" fill="none" stroke="#585DFE" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/><rect x="520" y="440" width="820" height="360" rx="20" fill="#F7F8FB"/><rect x="560" y="480" width="520" height="56" rx="28" fill="#585DFE"/><rect x="760" y="570" width="540" height="56" rx="28" fill="#E1E3F4"/><rect x="560" y="660" width="460" height="56" rx="28" fill="#585DFE"/>`,
  },
]

const photoFile = (p: PressPhoto) => `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000">${p.svg}</svg>`

function downloadPhoto(p: PressPhoto) {
  const url = URL.createObjectURL(new Blob([photoFile(p)], { type: 'image/svg+xml' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `kloel-imprensa-${p.slug}.svg`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  toast.success(`Imagem “${p.title}” baixada em SVG.`)
}

export default function PressPage() {
  usePageTitle('Imprensa')
  const [params, setParams] = useSearchParams()
  const [pressOpen, setPressOpen] = useState(false)
  const [kit, setKit] = useState<'logos' | 'fotos' | null>(null)
  const release = RELEASES.find((r) => r.slug === params.get('release'))
  const releaseFocus = useReturnFocus(!!release)
  const kitFocus = useReturnFocus(!!kit)
  const setRelease = (slug: string | null) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p)
        if (slug) n.set('release', slug)
        else n.delete('release')
        return n
      },
      { preventScrollReset: true },
    )

  return (
    <main className="font-site">
      <section className="relative overflow-hidden">
        <SoftAurora intensity={0.6} fade />
        <div className="relative mx-auto flex max-w-[900px] flex-col items-center px-5 pb-24 pt-16 text-center sm:pb-[128px] sm:pt-20">
          <Chip>Área de imprensa</Chip>
          <SiteHeading as="h1" size="hero" className="mt-3">
            Recursos para
            <br />
            imprensa &amp; mídia
          </SiteHeading>
          <p className="mt-5 text-[16px] leading-6 text-neutral-900 sm:mt-[15px]">
            Para solicitações de imprensa, entre em contato por e-mail em:{' '}
            <a href={`mailto:${PRESS_EMAIL}`} className="font-medium text-ink hover:underline">
              {PRESS_EMAIL}
            </a>
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <button type="button" className={siteButton('dark')} onClick={() => setPressOpen(true)}>
              Solicitações de imprensa
            </button>
            <Link to="/contato" className={siteButton('brand')}>
              Solicitações de clientes
            </Link>
          </div>
        </div>
      </section>

      <section className="relative bg-[#F7F8FB] pb-12 pt-11 sm:py-[47px]">
        <div className="mx-auto flex max-w-[600px] flex-wrap items-start justify-center gap-x-16 gap-y-6 px-5 text-center">
          {[
            { label: 'Clientes', value: '1.000+' },
            { label: 'Ligações / mês', value: '100 mil+' },
          ].map((m) => (
            <div key={m.label}>
              <div className="text-[14px] text-body">{m.label}</div>
              <div className="mt-0.5 text-[30px] font-medium leading-9 tracking-[-0.3px] text-heading">{m.value}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="relative mx-auto max-w-[1000px] px-5 pt-20 text-center">
        <SiteHeading>Sobre nós</SiteHeading>
        <div className="mt-5 flex justify-center gap-6 text-[16px] font-medium text-heading sm:mt-[13px]">
          <button type="button" onClick={() => setKit('logos')} className="inline-flex items-center gap-1.5 underline underline-offset-4 hover:text-brand-blue">
            Logos <ArrowDown className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => setKit('fotos')} className="inline-flex items-center gap-1.5 underline underline-offset-4 hover:text-brand-blue">
            Fotos para imprensa <ArrowDown className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-8 flex flex-col gap-[27px] text-[17px] leading-[27px] text-heading sm:mt-[28px] sm:text-[18px]">
          <p>A Kloel é uma plataforma de IA para comunicação com clientes, criada para pequenas e médias empresas. Seus assistentes atendem ligações, conversam pelo WhatsApp e pelo chat do site, agendam compromissos e registram cada atendimento.</p>
          <p>A plataforma começou com o assistente telefônico e evolui para um atendimento omnicanal, com agenda própria, integrações com CRMs e ferramentas de automação e uma central de conversas unificada.</p>
          <p>
            A Kloel é desenvolvida pela {SITE_COMPANY.legalName}, com sede em {SITE_COMPANY.hq}, e atende empresas de todo o Brasil, de clínicas e escritórios a oficinas e restaurantes.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-[1192px] px-5 pb-24 pt-20 sm:pb-28 sm:pt-[160px]">
        <div className="relative">
          <SiteHeading className="text-center">Releases de imprensa</SiteHeading>
        </div>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {RELEASES.map((r) => (
            <article key={r.slug} className="group flex min-h-[197px] flex-col rounded-2xl border border-line bg-white p-5">
              <time className="text-[14px] leading-5 text-body">{r.date}</time>
              <h3 className="mt-5 text-[20px] font-medium leading-6 tracking-[-0.15px] text-heading">{r.title}</h3>
              <button type="button" onClick={() => setRelease(r.slug)} className="mt-auto inline-flex w-fit items-center gap-1.5 pt-6 text-[16px] font-medium leading-6 text-ink underline-offset-[6px] hover:underline">
                Ler artigo <ChevronRight className="h-4 w-4" />
              </button>
            </article>
          ))}
        </div>
      </section>

      <FinalCtaBand />

      <Dialog open={!!release} onOpenChange={(o) => !o && setRelease(null)}>
        <DialogContent className="max-w-[680px] gap-y-5 font-site sm:rounded-2xl" onCloseAutoFocus={releaseFocus}>
          {release && (
            <>
              <div>
                <time className="text-[14px] text-body">{release.date}</time>
                <DialogTitle className="mt-2 pr-8 text-[26px] font-medium leading-8 tracking-[-0.3px] text-heading">{release.title}</DialogTitle>
                <DialogDescription className="sr-only">Release de imprensa</DialogDescription>
              </div>
              <div className="flex flex-col gap-4 text-[16px] leading-7 text-body">
                {release.body.map((p) => (
                  <p key={p}>{p}</p>
                ))}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4 text-[14px] text-body">
                <span>
                  Contato de imprensa:{' '}
                  <a href={`mailto:${PRESS_EMAIL}`} className="text-brand-blue hover:underline">
                    {PRESS_EMAIL}
                  </a>
                </span>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!kit} onOpenChange={(o) => !o && setKit(null)}>
        <DialogContent className="max-w-[640px] gap-y-6 font-site sm:rounded-2xl" onCloseAutoFocus={kitFocus}>
          <div>
            <DialogTitle className="text-[22px] font-medium text-heading">{kit === 'logos' ? 'Logos da Kloel' : 'Fotos para imprensa'}</DialogTitle>
            <DialogDescription className="mt-1 text-[15px] text-body">{kit === 'logos' ? 'Baixe o logotipo em SVG para fundos claros ou escuros.' : 'Imagens em alta resolução (SVG, 1600 × 1000) para matérias sobre a Kloel. Precisa de outro formato ou de fotos de porta-vozes? Use o formulário de imprensa.'}</DialogDescription>
          </div>
          {kit === 'logos' ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {(['claro', 'escuro'] as const).map((v) => (
                <div key={v} className="overflow-hidden rounded-xl border border-slate-200">
                  <div className={v === 'claro' ? 'flex h-28 items-center justify-center gap-3 bg-white' : 'flex h-28 items-center justify-center gap-3 bg-[#0F0F16]'}>
                    <KloelMark className="h-8 w-8" />
                    <KloelLogo className={v === 'escuro' ? 'text-[28px] text-white' : 'text-[28px]'} />
                  </div>
                  <button type="button" onClick={() => downloadLogo(v)} className="flex w-full items-center justify-center gap-2 border-t border-slate-200 py-2.5 text-[14px] text-ink hover:bg-slate-50">
                    <Download className="h-4 w-4" /> Fundo {v} (SVG)
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" data-testid="press-photos">
              {PRESS_PHOTOS.map((p) => (
                <figure key={p.slug} className="overflow-hidden rounded-xl border border-slate-200">
                  <div className="relative">
                    <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(photoFile(p))}`} alt={p.caption} className="block aspect-[16/10] w-full object-cover" />
                  </div>
                  <figcaption className="px-3 pt-2.5 text-[13px] leading-5">
                    <b className="block font-medium text-ink">{p.title}</b>
                    <span className="text-body">{p.caption}</span>
                  </figcaption>
                  <button type="button" onClick={() => downloadPhoto(p)} className="mt-2 flex w-full items-center justify-center gap-2 border-t border-slate-200 py-2.5 text-[14px] text-ink hover:bg-slate-50">
                    <Download className="h-4 w-4" /> Baixar (SVG)
                  </button>
                </figure>
              ))}
              <button
                type="button"
                className={`${siteButton('dark', 'md')} sm:col-span-3`}
                onClick={() => {
                  setKit(null)
                  setPressOpen(true)
                }}
              >
                Solicitar outras fotos
              </button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <LeadDialog
        open={pressOpen}
        onOpenChange={setPressOpen}
        kind="contact"
        payload={{ type: 'imprensa' }}
        title="Solicitação de imprensa"
        description="Jornalistas e criadores de conteúdo: conte o que você precisa (entrevista, dados, imagens) e o prazo."
        fields={[
          { name: 'nome', label: 'Nome', required: true, half: true },
          { name: 'veiculo', label: 'Veículo', required: true, half: true, placeholder: 'Jornal, portal, podcast…' },
          { name: 'email', label: 'E-mail', type: 'email', required: true, half: true },
          { name: 'prazo', label: 'Prazo', half: true, placeholder: 'ex.: até sexta-feira' },
          { name: 'pedido', label: 'Pedido', type: 'textarea', required: true },
        ]}
        submitLabel="Enviar solicitação"
        successTitle="Solicitação enviada!"
        successText={`Respondemos pelo e-mail informado. Você também pode escrever para ${PRESS_EMAIL}.`}
      />
    </main>
  )
}
