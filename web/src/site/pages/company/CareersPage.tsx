import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { BadgeCheck, Briefcase, ChevronRight, MapPin, SearchX } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { usePageTitle } from '@/site/components/usePageTitle'
import { useReturnFocus } from '@/site/layout/useReturnFocus'
import { Chip, FinalCtaBand, SiteHeading, SoftAurora, siteButton } from './kit'
import { LeadDialog } from './LeadDialog'
import { JOBS, VALUES, type Job } from './careers-content'

const ALL = 'todos'
type FilterKey = 'department' | 'type' | 'location' | 'mode'
const FILTERS: { key: FilterKey; label: string; param: string }[] = [
  { key: 'department', label: 'Departamento', param: 'departamento' },
  { key: 'type', label: 'Tipo de contratação', param: 'contratacao' },
  { key: 'location', label: 'Localização', param: 'local' },
  { key: 'mode', label: 'Modelo de trabalho', param: 'modelo' },
]

/** /carreiras — OBSERVADO [229]–[232] (página da Fonio em inglês; traduzida). Só vagas reais; sem vagas, a candidatura espontânea chega ao time por e-mail. */
export default function CareersPage() {
  usePageTitle('Carreiras')
  const [params, setParams] = useSearchParams()
  const [applyFor, setApplyFor] = useState<Job | 'espontanea' | null>(null)
  const setParam = (k: string, v: string | null) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p)
        if (v === null || v === ALL) n.delete(k)
        else n.set(k, v)
        return n
      },
      { replace: true, preventScrollReset: true },
    )
  const clearFilters = () =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p)
        FILTERS.forEach((f) => n.delete(f.param))
        return n
      },
      { replace: true, preventScrollReset: true },
    )
  const filters = Object.fromEntries(FILTERS.map((f) => [f.key, params.get(f.param) ?? ALL])) as Record<FilterKey, string>
  const options = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.key, Array.from(new Set(JOBS.map((j) => j[f.key])))])) as Record<FilterKey, string[]>, [])
  const jobs = JOBS.filter((j) => FILTERS.every((f) => filters[f.key] === ALL || j[f.key] === filters[f.key]))
  const groups = useMemo(() => {
    const m = new Map<string, Job[]>()
    for (const j of jobs) {
      const k = `${j.department}|${j.team}`
      m.set(k, [...(m.get(k) ?? []), j])
    }
    return [...m.entries()]
  }, [jobs])
  const openJob = JOBS.find((j) => j.slug === params.get('vaga'))
  const jobFocus = useReturnFocus(!!openJob)
  // mantém o conteúdo da vaga durante a animação de saída do diálogo (sem piscar em branco)
  const lastJob = useRef<Job | undefined>(openJob)
  if (openJob) lastJob.current = openJob
  const shownJob = openJob ?? lastJob.current
  const anyFilter = FILTERS.some((f) => filters[f.key] !== ALL)

  return (
    <main className="font-site">
      <section className="relative overflow-hidden">
        <SoftAurora intensity={0.6} fade />
        <div className="relative mx-auto flex max-w-[960px] flex-col items-center px-5 pb-12 pt-16 text-center sm:pb-16 sm:pt-[128px]">
          <Chip icon={<BadgeCheck className="h-[18px] w-[18px] fill-brand-blue text-white" />}>Carreiras na kloel.ai</Chip>
          <SiteHeading as="h1" size="hero" className="mt-6 max-w-[900px]">
            Junte-se a nós para construir a suíte de comunicação com IA para PMEs.
          </SiteHeading>
          <a href="#vagas" className={cn(siteButton('dark'), 'mt-8')}>
            {JOBS.length ? 'Ver vagas abertas' : 'Trabalhe com a gente'}
          </a>
        </div>
        <div className="relative mx-auto max-w-[1412px] px-5">
          <div className="relative aspect-[16/7] overflow-hidden rounded-3xl bg-[radial-gradient(80%_120%_at_10%_10%,#DCFCE7_0%,#C7C9FF_35%,#7C80FF_70%,#3B3FD0_100%)]">
            <div className="absolute inset-0 grid grid-cols-6 gap-3 p-6 opacity-50 sm:grid-cols-12 sm:gap-4 sm:p-10">
              {Array.from({ length: 36 }, (_, i) => (
                <span key={i} className="aspect-square rounded-full bg-white/40" />
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1192px] px-5 pt-20 sm:pt-[98px]">
        <SiteHeading>Como trabalhamos</SiteHeading>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {VALUES.map((v) => (
            <div key={v.title} className="flex min-h-[181px] flex-col justify-between gap-6 rounded-2xl border border-line bg-white p-6">
              <h3 className="text-[18px] font-medium leading-7 tracking-[-0.15px] text-heading">{v.title}</h3>
              <p className="text-[16px] leading-6 text-body">{v.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="vagas" className="mx-auto max-w-[1000px] scroll-mt-24 px-5 pb-24 pt-20 sm:pt-28" data-testid="vagas">
        <div className="flex flex-col items-center gap-4 text-center">
          <SiteHeading className="max-w-[640px]">Junte-se ao time para avançar rápido e se divertir no caminho.</SiteHeading>
          <p className="text-[16px] leading-6 text-body">Não mora na cidade da vaga? Sem problema: temos vagas remotas e ajudamos na mudança.</p>
        </div>
        {JOBS.length === 0 ? (
          <div className="mx-auto mt-16 flex max-w-[672px] flex-col items-center gap-4 rounded-2xl border border-dashed border-slate-200 p-10 text-center" data-testid="jobs-none">
            <p className="text-[20px] font-medium text-heading">No momento não há vagas abertas.</p>
            <p className="max-w-[520px] text-[16px] leading-6 text-body">Envie sua candidatura espontânea: o time da Kloel recebe o seu contato e responde pelo e-mail informado quando surgir uma oportunidade com o seu perfil.</p>
            <button type="button" className={siteButton('dark', 'md')} onClick={() => setApplyFor('espontanea')}>
              Enviar candidatura
            </button>
          </div>
        ) : (
        <div className="mx-auto mt-16 max-w-[672px]">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="text-[24px] font-semibold tracking-[-0.24px] text-heading">Vagas abertas</h2>
          <span className="text-[14px] text-slate-400" data-testid="jobs-count">({jobs.length})</span>
        </div>
        <div className="mt-7 flex items-center justify-between">
          <span className="text-[12px] font-medium uppercase tracking-[0.05em] text-body">Filtros:</span>
          {anyFilter && (
            <button type="button" onClick={clearFilters} className="text-[14px] text-brand-blue hover:underline">
              Limpar filtros
            </button>
          )}
        </div>
        <div className="mt-[15px] grid gap-3 sm:grid-cols-2">
          {FILTERS.map((f) => (
            <Select key={f.key} value={filters[f.key]} onValueChange={(v) => setParam(f.param, v)}>
              <SelectTrigger aria-label={f.label} className="h-[33px] rounded-[8px] border-zinc-200 bg-white px-3 text-[14px] text-ink focus:ring-2 focus:ring-brand-blue font-site [&>svg]:opacity-80">
                <SelectValue placeholder={f.label}>{filters[f.key] === ALL ? f.label : filters[f.key]}</SelectValue>
              </SelectTrigger>
              <SelectContent className="font-site">
                <SelectItem value={ALL}>Todos</SelectItem>
                {options[f.key].map((o) => (
                  <SelectItem key={o} value={o}>
                    {o}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ))}
        </div>
        <div className="mt-[43px] flex flex-col gap-10 [overflow-anchor:none]">
          {groups.length === 0 && (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-200 p-10 text-center" data-testid="jobs-empty">
              <SearchX className="h-8 w-8 text-slate-400" />
              <p className="text-[17px] text-ink">Nenhuma vaga encontrada com esses filtros.</p>
              <button type="button" onClick={clearFilters} className={siteButton('outline', 'md')}>
                Limpar filtros
              </button>
            </div>
          )}
          {groups.map(([key, list]) => {
            const [dept, team] = key.split('|')
            return (
              <div key={key}>
                <div className="flex items-center gap-1 text-[16px] text-slate-400">
                  {dept} <ChevronRight className="h-3.5 w-3.5" />
                </div>
                <h3 className="mt-0.5 text-[20px] font-semibold tracking-[-0.15px] text-[#2B3040]">{team}</h3>
                <div className="mt-2.5 flex flex-col gap-1 sm:-mx-4">
                  {list.map((j) => (
                    <button key={j.slug} type="button" onClick={() => setParam('vaga', j.slug)} className="rounded-lg border border-zinc-200 bg-white px-5 py-3 text-left transition-colors hover:border-brand-blue/40 hover:bg-[#FAFAFF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/30">
                      <div className="text-[16px] font-medium leading-5 text-heading">{j.title}</div>
                      <div className="mt-0.5 text-[14px] leading-5 text-body">
                        {j.team} • {j.location} • {j.type} • {j.mode}
                      </div>
                      <div className="mt-[5px] text-[13px] leading-5 text-body">
                        {j.salary}
                        {j.equity && ' • Oferece participação (stock options)'}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
        </div>
        )}
      </section>

      <FinalCtaBand
        title="Não encontrou a vaga ideal?"
        text="Envie uma candidatura espontânea. Guardamos o seu contato e avisamos quando surgir uma oportunidade com o seu perfil."
        cta="Enviar candidatura espontânea"
        onClick={() => setApplyFor('espontanea')}
      />

      <Dialog open={!!openJob} onOpenChange={(o) => !o && setParam('vaga', null)}>
        <DialogContent className="max-w-[640px] gap-y-6 font-site sm:rounded-2xl" onCloseAutoFocus={jobFocus}>
          {shownJob && (
            <>
              <div>
                <DialogTitle className="pr-8 text-[24px] font-medium leading-8 text-heading">{shownJob.title}</DialogTitle>
                <DialogDescription className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[14px] text-body">
                  <span className="inline-flex items-center gap-1">
                    <Briefcase className="h-4 w-4" /> {shownJob.department} · {shownJob.team}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-4 w-4" /> {shownJob.location} · {shownJob.mode}
                  </span>
                  <span>{shownJob.type}</span>
                </DialogDescription>
              </div>
              <p className="text-[16px] leading-7 text-ink">{shownJob.summary}</p>
              <JobList title="O que você vai fazer" items={shownJob.responsibilities} />
              <JobList title="O que buscamos" items={shownJob.requirements} />
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 p-4 text-[15px]">
                <span className="text-body">
                  Faixa: <b className="font-medium text-ink">{shownJob.salary}</b>
                </span>
                <button type="button" className={siteButton('dark', 'md')} onClick={() => {
                    setApplyFor(shownJob)
                    setParam('vaga', null)
                  }}>
                  Candidatar-se a esta vaga
                </button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <LeadDialog
        open={!!applyFor}
        onOpenChange={(o) => !o && setApplyFor(null)}
        kind="career"
        payload={{ vaga: applyFor === 'espontanea' ? 'Candidatura espontânea' : applyFor?.title ?? '', slug: applyFor === 'espontanea' ? 'espontanea' : applyFor?.slug ?? '' }}
        title={applyFor === 'espontanea' ? 'Candidatura espontânea' : `Candidatura: ${applyFor?.title ?? ''}`}
        description="Preencha seus dados. Nosso time de pessoas responde a todas as candidaturas."
        fields={[
          { name: 'nome', label: 'Nome completo', required: true, half: true },
          { name: 'email', label: 'E-mail', type: 'email', required: true, half: true, placeholder: 'voce@email.com' },
          { name: 'telefone', label: 'Telefone', type: 'tel', half: true, placeholder: '+55 11 91234-5678' },
          { name: 'linkedin', label: 'LinkedIn ou portfólio', type: 'url', required: true, half: true, placeholder: 'linkedin.com/in/…' },
          { name: 'mensagem', label: 'Por que você quer trabalhar na Kloel?', type: 'textarea', required: true },
        ]}
        consent="Autorizo o uso dos meus dados para este processo seletivo, conforme a política de privacidade."
        submitLabel="Enviar candidatura"
        successTitle="Candidatura enviada!"
        successText="Obrigado! Vamos analisar o seu perfil e responder pelo e-mail informado."
      />
    </main>
  )
}

function JobList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h4 className="text-[16px] font-medium text-heading">{title}</h4>
      <ul className={cn('mt-2 flex list-disc flex-col gap-1.5 pl-5 text-[15px] leading-6 text-body')}>
        {items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
    </div>
  )
}
