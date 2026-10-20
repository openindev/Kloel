import { ArrowDown, ArrowRight, CalendarDays, Check, ChevronLeft, ChevronRight, FolderKanban, Phone, PhoneCall, PhoneIncoming, Star, Users, Database } from 'lucide-react'
import { cn } from '@/lib/utils'
import { KloelLogo } from '@/components/brand/KloelLogo'

/** Ilustrações dos cartões "Vantagens…" das páginas de solução (mocks de UI traduzidos para PT-BR; "€" → "R$"). */
export type IllustrationKey = 'triage' | 'languages' | 'docs' | 'savings' | 'transfer' | 'productivity' | 'availability' | 'always' | 'quality' | 'nocode'

function Frame({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('ks-dot-grid relative flex h-[190px] items-center justify-center overflow-hidden font-sans', className)}>{children}</div>
}

const Chip = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', className)}>{children}</span>
)

function Triage() {
  const rows = [
    { c: 'bg-red-50 text-red-600', t: 'Urgente' },
    { c: 'bg-orange-50 text-orange-600', t: 'Média' },
    { c: 'bg-sky-50 text-sky-600', t: 'Info' },
  ]
  return (
    <Frame>
      <div className="relative h-[156px] w-[250px]">
        {rows.map((r, i) => (
          <div key={r.t} className="absolute w-[190px] rounded-lg border border-slate-200 bg-white p-2.5 shadow-sm" style={{ left: i * 26, top: i * 26 }}>
            <div className="flex items-center gap-1.5 text-[11px] text-slate-700"><PhoneCall className="h-3 w-3" /> Ligação salva <Chip className={r.c}>{r.t}</Chip></div>
            {i === 2 && (
              <div className="mt-2">
                <div className="text-[11px] font-medium text-slate-900">Transcrição</div>
                {[90, 75, 82].map((w, k) => <div key={k} className="mt-1.5 h-1.5 rounded-full bg-slate-100" style={{ width: `${w}%` }} />)}
              </div>
            )}
          </div>
        ))}
      </div>
    </Frame>
  )
}

function Languages() {
  const flags = ['br', 'pt', 'es', 'us', 'gb', 'fr', 'de', 'it', 'mx', 'ar', 'nl', 'jp']
  return (
    <Frame>
      <div className="grid grid-cols-6 gap-2.5">
        {flags.map((f, i) => (
          <span key={f} className={cn('flex h-10 w-10 items-center justify-center rounded-lg border border-slate-100 bg-white shadow-sm', i % 2 && 'translate-y-2')}>
            <span className={`fi fi-${f} rounded-[2px] text-[16px]`} />
          </span>
        ))}
      </div>
    </Frame>
  )
}

function Docs() {
  return (
    <Frame>
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 380 190" fill="none" aria-hidden preserveAspectRatio="none">
        <path d="M110 90 C 150 30, 230 30, 270 90" stroke="#818CF8" strokeDasharray="4 4" />
        <path d="M190 50 L 190 124" stroke="#818CF8" strokeDasharray="4 4" />
      </svg>
      <span className="absolute left-[12%] top-[44%] flex items-center gap-1.5 rounded-md border-l-2 border-brand-blue bg-white px-2 py-1 text-[11px] text-slate-700 shadow-sm"><Database className="h-3 w-3" /> Sistemas de CRM</span>
      <span className="absolute right-[8%] top-[44%] flex items-center gap-1.5 rounded-md border-l-2 border-brand-blue bg-white px-2 py-1 text-[11px] text-slate-700 shadow-sm"><FolderKanban className="h-3 w-3" /> Ferramentas de gestão</span>
      <span className="absolute left-1/2 top-[66%] flex -translate-x-1/2 items-center gap-1.5 rounded-md border-l-2 border-brand-blue bg-white px-2 py-1 text-[11px] text-slate-700 shadow-sm"><CalendarDays className="h-3 w-3" /> Agenda de compromissos</span>
    </Frame>
  )
}

function Savings() {
  return (
    <Frame>
      <div className="relative flex h-28 w-28 items-center justify-center rounded-3xl border border-slate-100 bg-white text-[46px] font-semibold text-brand-blue shadow-md">
        R$
        <span className="absolute -bottom-3 -right-3 flex h-9 w-9 items-center justify-center rounded-full bg-indigo-100 text-brand-blue"><ArrowDown className="h-5 w-5" /></span>
      </div>
    </Frame>
  )
}

function Transfer() {
  return (
    <Frame>
      <div className="flex items-center gap-3">
        <div className="flex flex-col gap-3">
          <span className="flex items-center gap-1.5 rounded-md bg-white px-2 py-1 text-[11px] shadow-sm"><PhoneIncoming className="h-3 w-3 text-emerald-600" /> Ligação recebida</span>
          <span className="flex items-center gap-1.5 rounded-md bg-white px-2 py-1 text-[11px] shadow-sm"><Phone className="h-3 w-3 text-brand-blue" /> Em ligação</span>
        </div>
        <ArrowRight className="h-4 w-4 text-slate-400" />
        <div className="flex items-center gap-2 rounded-xl border border-slate-100 bg-white p-2.5 shadow-md">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100 text-[11px] font-semibold text-indigo-700">R</span>
          <div className="text-[11px] leading-4"><div className="font-medium text-slate-900">Roberta</div><div className="text-slate-500">Assistente telefônica IA</div></div>
        </div>
      </div>
    </Frame>
  )
}

function Productivity() {
  return (
    <Frame>
      <div className="w-[220px] rounded-xl border border-slate-100 bg-white p-3 shadow-md">
        <div className="flex items-center justify-between text-[11px] text-slate-700">
          <span className="flex items-center gap-1.5"><Users className="h-3.5 w-3.5" /> Equipe</span>
          <span className="flex -space-x-1.5">{['bg-indigo-200', 'bg-emerald-200', 'bg-amber-200'].map((c) => <span key={c} className={cn('h-5 w-5 rounded-full border-2 border-white', c)} />)}</span>
        </div>
        <div className="mt-3 text-[11px] text-slate-500">Satisfação</div>
        <div className="mt-1 h-2 rounded-full bg-gradient-to-r from-red-400 via-amber-300 to-emerald-500" />
        <div className="mt-1 text-right text-[11px] font-medium text-emerald-600">Muito alta</div>
      </div>
    </Frame>
  )
}

function Availability() {
  const days = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB']
  const nums = [29, 30, 31, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
  return (
    <Frame>
      <div className="relative w-[230px] rounded-xl border border-slate-100 bg-white p-3 shadow-md">
        <div className="flex items-center justify-between text-[12px] font-medium text-slate-900"><ChevronLeft className="h-3.5 w-3.5" /> Abril 2026 <ChevronRight className="h-3.5 w-3.5" /></div>
        <div className="mt-2 grid grid-cols-7 gap-1 text-center text-[9px] text-slate-400">{days.map((d) => <span key={d}>{d}</span>)}</div>
        <div className="mt-1 grid grid-cols-7 gap-1 text-center text-[11px] text-slate-700">{nums.map((n, i) => <span key={i} className={i < 3 ? 'text-slate-300' : ''}>{n}</span>)}</div>
        <span className="absolute -bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-full bg-brand-blue px-2.5 py-1 text-[11px] font-medium text-white shadow"><Check className="h-3 w-3" /> Disponível 24/7</span>
      </div>
    </Frame>
  )
}

function Always() {
  return (
    <Frame>
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 380 190" fill="none" aria-hidden preserveAspectRatio="none">
        {[[95, 50], [285, 50], [95, 140], [285, 140]].map(([x, y]) => <path key={`${x}${y}`} d={`M${x} ${y} L190 95`} stroke="#C7D2FE" strokeDasharray="4 4" />)}
      </svg>
      {[['left-[19%] top-[19%]'], ['right-[19%] top-[19%]'], ['left-[19%] bottom-[19%]'], ['right-[19%] bottom-[19%]']].map(([p]) => (
        <span key={p} className={cn('absolute flex h-10 w-10 items-center justify-center rounded-xl border border-slate-100 bg-white shadow-sm', p)}><Phone className="h-4 w-4 text-slate-600" /></span>
      ))}
      <span className="relative rounded-full border border-slate-100 bg-white px-3 py-1.5 shadow-md"><KloelLogo size="sm" /></span>
    </Frame>
  )
}

function Quality() {
  return (
    <Frame>
      <div className="flex flex-col gap-2">
        <span className="w-fit rounded-md bg-white px-2 py-1 text-[11px] shadow-sm"><PhoneIncoming className="mr-1 inline h-3 w-3 text-emerald-600" />Ligação recebida</span>
        {['“Muito satisfeito”', '“Atendimento excelente!”'].map((q, i) => (
          <div key={q} className={cn('w-[200px] rounded-lg border border-slate-100 bg-white p-2 shadow-sm', i && 'ml-8')}>
            <div className="flex items-center justify-between text-[10.5px] text-slate-500">Avaliação do paciente <span className="flex">{Array.from({ length: 5 }, (_, k) => <Star key={k} className="h-2.5 w-2.5 fill-amber-400 text-amber-400" />)}</span></div>
            <div className="mt-0.5 text-[12px] text-slate-900">{q}</div>
          </div>
        ))}
      </div>
    </Frame>
  )
}

function NoCode() {
  return (
    <Frame>
      <div className="flex flex-col items-center gap-3">
        <span className="flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-[12px] font-medium text-slate-900 shadow-md">
          <span className="h-6 w-6 rounded-full bg-indigo-200" /> Assistente IA
        </span>
        <span className="flex h-8 items-center gap-[3px]">{Array.from({ length: 28 }, (_, i) => <span key={i} className="w-[3px] rounded-full bg-brand-blue" style={{ height: `${6 + ((i * 11) % 24)}px`, opacity: 0.5 + ((i * 3) % 5) / 10 }} />)}</span>
        <div className="flex gap-2">{['Simpática', 'Confiável', 'Competente'].map((t) => <span key={t} className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[11px] text-slate-700">{t}</span>)}</div>
      </div>
    </Frame>
  )
}

export const ILLUSTRATIONS: Record<IllustrationKey, () => JSX.Element> = {
  triage: Triage, languages: Languages, docs: Docs, savings: Savings, transfer: Transfer, productivity: Productivity, availability: Availability, always: Always, quality: Quality, nocode: NoCode,
}

/** "Foto" ilustrativa da seção "Para quem é adequado…" (recepção com ripas de madeira) desenhada em CSS — substitui a foto de banco de imagens. */
export function ReceptionIllustration({ className }: { className?: string }) {
  return (
    <div className={cn('relative h-[250px] w-full max-w-[420px] rotate-[2deg] overflow-hidden rounded-2xl border-4 border-white bg-[repeating-linear-gradient(90deg,#7a4a2b_0_10px,#5b341d_10px_14px)] shadow-xl sm:h-[272px]', className)}>
      <div className="absolute left-6 top-6 h-10 w-10 rounded-full border-4 border-slate-200 bg-white" />
      {[30, 52, 74].map((x) => <span key={x} className="absolute top-0 h-12 w-px bg-black/40" style={{ left: `${x}%` }}><span className="absolute -left-1.5 bottom-0 h-3 w-3 rounded-full bg-amber-200 shadow-[0_0_14px_4px_rgba(253,230,138,.7)]" /></span>)}
      <div className="absolute inset-x-0 bottom-0 h-[34%] bg-gradient-to-b from-[#e7c9a0] to-[#c9a47a]" />
      <div className="absolute bottom-[24%] left-1/2 w-[64%] -translate-x-1/2 rounded-xl bg-white/95 p-3 font-sans shadow-lg">
        <div className="flex items-center gap-2 text-[12px] font-medium text-slate-900"><span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" /> Ligação em andamento</div>
        <div className="mt-1 text-[11px] text-slate-500">Atendedor automático por IA · 00:42</div>
        <div className="mt-2 flex h-5 items-end gap-[2px]">{Array.from({ length: 30 }, (_, i) => <span key={i} className="w-[3px] rounded-full bg-brand-blue/70" style={{ height: `${4 + ((i * 7) % 16)}px` }} />)}</div>
      </div>
    </div>
  )
}
