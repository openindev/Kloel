import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'
import { KloelLogo } from '@/components/brand/KloelLogo'
import { WhatsAppIcon } from '@/components/brand/icons'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { SITE_CONTACT, SITE_EXTERNAL, type SiteExternalKey } from './nav'
import { useReturnFocus } from './useReturnFocus'
import { DemoAvatarStack } from '@/site/components/sections/HeroSocialProof'

/** Prova social do rodapé [329]: avatares + "Clientes" + avaliação (números da Fonio substituídos pelos da Kloel). */
export function SocialProof({ compact }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <DemoAvatarStack />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 text-[16px] font-semibold leading-6 text-ink">
          1.000+ Clientes
        </div>
      </div>
    </div>
  )
}

/** Ramo de louro em cinza (selos de conformidade da barra inferior). */
function Laurel({ flip }: { flip?: boolean }) {
  return (
    <svg viewBox="0 0 12 28" className={cn('h-7 w-3 shrink-0 text-slate-300', flip && '-scale-x-100')} aria-hidden fill="currentColor">
      <path d="M9.5 27C5 23 3.2 17 4.6 10.6 5.4 6.8 7.4 3.4 9.8 1" fill="none" stroke="currentColor" strokeWidth="1" />
      <ellipse cx="3.2" cy="21.5" rx="1.4" ry="2.6" transform="rotate(-35 3.2 21.5)" />
      <ellipse cx="2.4" cy="15.6" rx="1.3" ry="2.5" transform="rotate(-15 2.4 15.6)" />
      <ellipse cx="3.4" cy="9.8" rx="1.2" ry="2.3" transform="rotate(10 3.4 9.8)" />
      <ellipse cx="6" cy="4.6" rx="1.1" ry="2.1" transform="rotate(35 6 4.6)" />
    </svg>
  )
}

function Seal({ prefix, strong }: { prefix: string; strong: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[13px] leading-tight text-slate-500">
      <Laurel />
      <span>
        {prefix} <b className="font-medium text-slate-700">{strong}</b>
      </span>
      <Laurel flip />
    </span>
  )
}

const linkCls = 'text-[15px] leading-[22.5px] text-ink transition-colors hover:text-brand-blue'

/**
 * Rodapé global do site [329]: marca + contato + redes + prova social à esquerda; colunas Navegação / Sobre a Kloel / Recursos à direita;
 * barra inferior cinza com direitos, links legais e selos de conformidade (0. Footer.png: LGPD e EU AI Act).
 */
export function SiteFooter() {
  const [notice, setNotice] = useState<SiteExternalKey | null>(null)
  const info = notice ? SITE_EXTERNAL[notice] : null
  const onCloseAutoFocus = useReturnFocus(!!notice)
  return (
    <footer className="w-full bg-white pt-12 font-site sm:pt-16 lg:pt-[68px]">
      <div className="mx-auto flex max-w-[1360px] flex-col gap-12 px-5 pb-14 lg:flex-row lg:justify-between lg:gap-10 lg:pb-[64px]">
        <div className="flex flex-col items-start">
          <Link to="/" aria-label="kloel.ai — início" className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/30">
            <KloelLogo className="text-[30px] lg:text-[33px]" />
          </Link>
          <p className="mt-1.5 text-[15px] leading-[22.5px] text-ink">{SITE_CONTACT.tagline}</p>
          <a href={`mailto:${SITE_CONTACT.email}`} className={cn(linkCls, 'mt-[39px]')}>
            {SITE_CONTACT.email}
          </a>
          <a href={SITE_CONTACT.whatsappUrl} target="_blank" rel="noopener noreferrer" className={cn(linkCls, 'mt-2.5 flex items-center gap-2')} data-testid="footer-whatsapp">
            <WhatsAppIcon className="h-[18px] w-[18px] text-ink" /> {SITE_CONTACT.phoneLabel}
          </a>
          <div className="mt-[15px] flex items-center gap-[18px] text-[#2B3040]">
            <button type="button" aria-label="Instagram" aria-haspopup="dialog" onClick={() => setNotice('instagram')} className="block rounded-md hover:text-brand-blue">
              <InstagramGlyph />
            </button>
            <button type="button" aria-label="LinkedIn" aria-haspopup="dialog" onClick={() => setNotice('linkedin')} className="block rounded-md hover:text-brand-blue">
              <LinkedinGlyph />
            </button>
            <button type="button" aria-label="YouTube" aria-haspopup="dialog" onClick={() => setNotice('youtube')} className="block rounded-md hover:text-brand-blue">
              <YoutubeGlyph />
            </button>
          </div>
          <div className="mt-9">
            <SocialProof />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 lg:flex lg:gap-0 lg:pt-[11px]">
          <FooterColumn title="Navegação">
            <Link className={linkCls} to="/casos-de-sucesso">Depoimentos</Link>
            <Link className={linkCls} to="/planos">Planos</Link>
          </FooterColumn>
          <FooterColumn title="Sobre a Kloel">
            <Link className={linkCls} to="/contato">Contato</Link>
          </FooterColumn>
          <FooterColumn title="Recursos" last>
            <a className={linkCls} href="/ajuda" target="_blank" rel="noreferrer">Central de ajuda</a>
          </FooterColumn>
        </div>
      </div>
      <div id="site-footer-bottom" className="bg-[#F3F3F3]">
        <div className="mx-auto flex max-w-[1360px] flex-col gap-4 px-5 py-5 text-[14px] text-neutral-800 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <span>© Todos os direitos reservados. kloel.ai {new Date().getFullYear()}</span>
            <a href="/ajuda/legal/aviso-legal" target="_blank" rel="noreferrer" className="hover:text-brand-blue">Aviso legal</a>
            <a href="/ajuda/legal/protecao-de-dados" target="_blank" rel="noreferrer" className="hover:text-brand-blue">Proteção de dados</a>
          </div>
          {/* 0. Footer.png: ≈39 px entre os dois selos */}
          <div className="flex flex-wrap items-center gap-x-10 gap-y-2">
            <Seal prefix="em conformidade com a" strong="LGPD" />
            <Seal prefix="em conformidade com o" strong="EU AI Act" />
          </div>
        </div>
      </div>

      <Dialog open={!!notice} onOpenChange={(o) => !o && setNotice(null)}>
        <DialogContent className="max-w-[440px] gap-y-5 font-site sm:rounded-2xl" data-testid="footer-external-notice" onCloseAutoFocus={onCloseAutoFocus}>
          {info && (
            <>
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#F1F1FE] text-brand-blue">
                <ExternalLink className="h-5 w-5" />
              </span>
              <div>
                <DialogTitle className="text-[20px] font-medium text-heading">{info.title}</DialogTitle>
                <DialogDescription className="mt-2 text-[15px] leading-6 text-body">
                  {info.text} Enquanto isso, fale com a equipe pelo WhatsApp {SITE_CONTACT.phoneLabel} ou pela página de contato.
                </DialogDescription>
              </div>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button type="button" onClick={() => setNotice(null)} className="inline-flex h-[38px] items-center justify-center rounded-[10px] border border-line bg-white px-3.5 text-[14px] text-neutral-950 hover:bg-slate-50">
                  Fechar
                </button>
                <a href={SITE_CONTACT.whatsappUrl} target="_blank" rel="noopener noreferrer" onClick={() => setNotice(null)} className="inline-flex h-[38px] items-center justify-center gap-2 rounded-[10px] border border-line bg-white px-3.5 text-[14px] text-neutral-950 hover:bg-slate-50">
                  <WhatsAppIcon className="h-4 w-4" /> WhatsApp
                </a>
                <Link to="/contato" onClick={() => setNotice(null)} className="inline-flex h-[38px] items-center justify-center rounded-[10px] bg-heading px-3.5 text-[14px] text-white hover:bg-heading/90">
                  Ir para Contato
                </Link>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </footer>
  )
}

function FooterColumn({ title, children, last }: { title: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div className={cn('flex flex-col', !last && 'lg:w-[164px]')}>
      <div className="mb-[17px] text-[15px] font-medium leading-[22.5px] text-ink">{title}</div>
      <div className="flex flex-col items-start gap-[7px]">{children}</div>
    </div>
  )
}

/* Ícones das redes no tamanho e preenchimento de [329]: Instagram em contorno; LinkedIn e YouTube preenchidos (22 px). */
function InstagramGlyph() {
  return (
    <svg viewBox="0 0 22 22" className="h-[22px] w-[22px]" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="1" y="1" width="20" height="20" rx="5.5" />
      <circle cx="11" cy="11" r="4.4" />
      <circle cx="16.6" cy="5.4" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  )
}

function LinkedinGlyph() {
  return (
    <svg viewBox="0 0 22 22" className="h-[22px] w-[22px]" fill="currentColor" aria-hidden>
      <path
        fillRule="evenodd"
        d="M3 0h16a3 3 0 0 1 3 3v16a3 3 0 0 1-3 3H3a3 3 0 0 1-3-3V3a3 3 0 0 1 3-3Zm2.6 3.7a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5ZM4.1 8.6V18h3V8.6h-3Zm5.2 0V18h3v-4.6c0-1.4.8-2.3 2-2.3s1.6.9 1.6 2.2V18h3v-5.3c0-2.7-1-4.4-3.6-4.4-1.5 0-2.6.7-3.1 1.6V8.6H9.3Z"
      />
    </svg>
  )
}

function YoutubeGlyph() {
  return (
    <svg viewBox="0 0 22 22" className="h-[22px] w-[22px]" fill="currentColor" aria-hidden>
      <path
        fillRule="evenodd"
        d="M1.5 6.2c.15-1.5 1.2-2.6 2.7-2.75C6.1 3.25 8.5 3.2 11 3.2s4.9.05 6.8.25c1.5.15 2.55 1.25 2.7 2.75.2 1.55.3 3.1.3 4.8s-.1 3.25-.3 4.8c-.15 1.5-1.2 2.6-2.7 2.75-1.9.2-4.3.25-6.8.25s-4.9-.05-6.8-.25c-1.5-.15-2.55-1.25-2.7-2.75-.2-1.55-.3-3.1-.3-4.8s.1-3.25.3-4.8ZM9 7.6v6.8l5.9-3.4L9 7.6Z"
      />
    </svg>
  )
}
