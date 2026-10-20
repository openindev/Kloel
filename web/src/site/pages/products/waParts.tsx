import { useEffect, useState, type ReactNode } from 'react'
import { CalendarCheck, CheckCheck, ChevronLeft, Loader2, Mic, Phone, Play, Sparkles, UserRound, Video } from 'lucide-react'
import { cn } from '@/lib/utils'

/*
 * Peças visuais da página IA de WhatsApp medidas nas referências 01.png, 03.png, 03b.png e 03c.png
 * (viewport de 1460 px sem a moldura da gravação). Ficam no módulo para não alterar os mocks compartilhados.
 */

/** Padrão de rabiscos claros (papel de parede do WhatsApp) desenhado em SVG, que some na base do quadro. */
const DOODLE = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='132' height='132' fill='none' stroke='#E3E4EE' stroke-width='1.1' stroke-linecap='round' stroke-linejoin='round'>
<rect x='8' y='10' width='18' height='28' rx='4'/><path d='M14 33h6'/>
<path d='M52 14c4-4 10-4 14 0M56 18c2-2 4-2 6 0'/><circle cx='59' cy='22' r='1'/>
<path d='M96 10h22a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4h-14l-6 5v-5h-2a4 4 0 0 1-4-4V14a4 4 0 0 1 4-4z'/>
<path d='M20 70c-4-6 4-11 8-5 4-6 12-1 8 5l-8 8z'/>
<path d='m66 58 3 6 6 1-4.5 4 1 6-5.5-3-5.5 3 1-6-4.5-4 6-1z'/>
<path d='M100 56c6 0 10 4 10 10s-4 10-10 10-10-4-10-10 4-10 10-10zm0 5v5l3 3'/>
<path d='M12 104c3-3 6-3 8 0l3 3c1 1 1 3 0 4l-2 2c2 4 5 7 9 9l2-2c1-1 3-1 4 0l3 3c3 2 3 5 0 8-6 5-20-1-27-14-3-6-3-10 0-13z'/>
<rect x='56' y='100' width='24' height='18' rx='3'/><path d='m56 104 12 7 12-7'/>
<path d='M104 104v16M98 110h12M98 120h12'/><circle cx='122' cy='96' r='3'/>
</svg>`,
)}")`

export function Doodle({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn('pointer-events-none absolute inset-0 [mask-image:linear-gradient(180deg,#000_45%,transparent_98%)]', className)}
      style={{ backgroundImage: DOODLE, backgroundSize: '104px 104px' }}
    />
  )
}

/** Bolha de conversa: horário na última linha (como no WhatsApp), rabicho na enviada, borda fina na recebida. */
export function Bub({
  from, children, time, ticks = true, italic, spinner, tail = true, className, bubbleClassName, size = 'md',
}: { from: 'in' | 'out'; children: ReactNode; time?: string; ticks?: boolean; italic?: boolean; spinner?: boolean; tail?: boolean; className?: string; bubbleClassName?: string; size?: 'md' | 'sm' }) {
  const out = from === 'out'
  const sm = size === 'sm'
  return (
    <div className={cn('flex', out ? 'justify-end' : 'justify-start', className)}>
      <div
        className={cn(
          'relative max-w-[88%] font-sans text-[#111B21]',
          sm ? 'rounded-[6px] py-[3px] pl-[6px] pr-[5px] text-[9.5px] leading-[13px]' : 'rounded-[8px] py-[5px] pl-[9px] pr-[8px] text-[13.5px] leading-[19px]',
          out ? 'bg-[#D9FDD3]' : 'border border-[#E6E7EC] bg-white shadow-[0_1px_1px_rgba(11,20,26,.05)]',
          out && tail && 'rounded-br-[2px]',
          italic && 'italic text-[#3B4A54]',
          bubbleClassName,
        )}
      >
        {spinner && <Loader2 className="mr-1.5 inline h-3.5 w-3.5 -translate-y-px animate-spin align-middle text-[#8696A0]" />}
        <span className="whitespace-pre-wrap break-words">{children}</span>
        {time && <span aria-hidden className={cn('inline-block', sm ? (out && ticks ? 'w-[38px]' : 'w-[26px]') : out && ticks ? 'w-[58px]' : 'w-[36px]')} />}
        {time && (
          <span className={cn('absolute flex items-center gap-[3px] not-italic leading-none text-[#667781]', sm ? 'bottom-[3px] right-[5px] text-[7px]' : 'bottom-[5px] right-[8px] text-[11px]')}>
            {time}
            {out && ticks && <CheckCheck className={cn('text-[#667781]', sm ? 'h-2.5 w-2.5' : 'h-3.5 w-3.5')} />}
          </span>
        )}
        {out && tail && <span aria-hidden className="absolute -right-[7px] bottom-0 h-[11px] w-[8px] bg-[#D9FDD3] [clip-path:polygon(0_0,0_100%,100%_100%)]" />}
      </div>
    </div>
  )
}

export function DayPill({ children = 'Hoje', small }: { children?: ReactNode; small?: boolean }) {
  return (
    <div className="flex justify-center">
      <span className={cn('rounded-[6px] border border-[#E6E7EC] bg-white font-sans font-semibold text-[#111B21]', small ? 'px-[13px] text-[7px] leading-[10px]' : 'px-[30px] py-px text-[11px] leading-[15px]')}>{children}</span>
    </div>
  )
}

/* ------------------------------ Hero (01.png) ------------------------------ */

/**
 * Celular claro do hero: barra de status sem entalhe, cabeçalho com avatar cinza preenchido e nome à esquerda,
 * conversa sobre fundo lilás com rabiscos, esmaecendo na base. A conversa avança em laço.
 */
export function HeroPhone() {
  const [step, setStep] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setStep((s) => (s + 1) % 6), 1600)
    return () => clearInterval(id)
  }, [])
  return (
    <div className="relative mx-auto h-[270px] w-[234px] [mask-image:linear-gradient(180deg,#000_50%,transparent_100%)]">
      <div className="h-[330px] overflow-hidden rounded-[26px] border border-[#ECEDF3] bg-white font-sans shadow-[0_8px_30px_-18px_rgba(15,15,22,.25)]">
        <div className="flex items-center justify-between px-[17px] pb-[7px] pt-[13px] text-[11.5px] font-semibold leading-none text-[#111]">
          <span>23:59</span>
          <span className="flex items-center gap-1">
            <span className="flex items-end gap-[1.5px]">{[3, 5, 7, 9].map((h) => <span key={h} className="w-[2px] rounded-sm bg-[#111]" style={{ height: h }} />)}</span>
            <svg viewBox="0 0 16 12" className="h-[9px] w-[12px]" aria-hidden><path d="M8 11.5 1 4.3a10 10 0 0 1 14 0z" fill="#111" /></svg>
            <span className="rounded-[3px] bg-[#111] px-[3px] text-[7px] font-bold leading-[10px] text-white">100</span>
          </span>
        </div>
        <div className="flex items-center gap-2 px-2.5 pb-2 pt-1.5">
          <ChevronLeft className="h-[18px] w-[18px] text-[#111]" />
          <span className="flex h-[23px] w-[23px] items-center justify-center rounded-full bg-[#8E9199] text-white"><UserRound className="h-3.5 w-3.5" /></span>
          <span className="flex-1 text-left text-[12px] font-semibold text-[#111B21]">Cliente</span>
          <Video className="h-[17px] w-[17px] text-[#111]" />
          <Phone className="ml-2.5 mr-1 h-[15px] w-[15px] text-[#111]" />
        </div>
        <div className="relative flex h-[260px] flex-col gap-2 bg-[#EEF0FA] px-2.5 pt-3">
          <Doodle className="opacity-70 [mask-image:none]" />
          <div className="relative flex flex-col gap-2">
            <DayPill small />
            {step >= 1 && <Bub from="in" time="23:59" className="ks-fade-up" size="sm">Oi, tenho uma pergunta rápida!</Bub>}
            {step >= 2 && <Bub from="out" time="23:59" className="ks-fade-up" size="sm">Claro, como posso te ajudar?</Bub>}
            {step >= 3 && <Bub from="in" time="23:59" className="ks-fade-up" size="sm">Vocês abrem amanhã cedo?</Bub>}
            {step >= 4 && <Bub from="out" time="23:59" className="ks-fade-up" size="sm">Abrimos às 8h! Quer que eu reserve um horário?</Bub>}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ------------------------- Benefícios (03/03b/03c) ------------------------- */

function Illus({ children, className, free }: { children: ReactNode; className?: string; free?: boolean }) {
  return (
    <div className={cn('relative h-[262px] overflow-hidden', className)}>
      <Doodle />
      {free ? <div className="absolute inset-0">{children}</div> : <div className="relative flex h-full flex-col justify-center gap-2.5 px-[34px] pb-3">{children}</div>}
    </div>
  )
}

/** Rabicho da bolha enviada (canto inferior direito). */
function Tail({ className }: { className?: string }) {
  return <span aria-hidden className={cn('absolute -right-[7px] bottom-0 h-[11px] w-[8px] bg-[#D9FDD3] [clip-path:polygon(0_0,0_100%,100%_100%)]', className)} />
}

// posições medidas em 03b.png (cartão de 374 px): [bandeira, x, y, enviada?]
const FLAG_BUBBLES: [string, number, number, boolean][] = [
  ['fr', 79, 69, false], ['de', 175, 81, true], ['it', 221, 79, true], ['fr', 135, 99, true], ['nl', 248, 117, true],
  ['pl', 198, 122, true], ['in', 157, 135, true], ['br', 269, 157, true], ['us', 213, 162, true],
]

export const WA_BENEFIT_ILLUS: ReactNode[] = [
  <Illus key="1">
    <DayPill />
    <Bub from="in" time="19:43" bubbleClassName="max-w-[160px]">Oi, eu teria uma pergunta rápida!</Bub>
    <Bub from="out" time="19:43">Claro, como posso ajudar?</Bub>
  </Illus>,
  <Illus key="2">
    <Bub from="in" time="19:43" bubbleClassName="max-w-[245px]">Posso passar aí na próxima terça, no mesmo horário de sempre?</Bub>
    <Bub from="out" time="19:44">Claro, já vou te agendar!</Bub>
    <div className="flex justify-end">
      <div className="relative rounded-[8px] rounded-br-[2px] bg-[#D9FDD3] p-[4px] font-sans">
        <div className="flex items-center gap-2.5 rounded-[6px] bg-[#CCF2C4] py-[7px] pl-[7px] pr-[9px]">
          <span className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-white"><CalendarCheck className="h-4 w-4 text-[#111B21]" /></span>
          <span className="text-[13px] leading-[17px] text-[#111B21]"><span className="font-semibold">Agendado</span><br /><span className="text-[#54656F]">confirmado</span></span>
          <span className="self-end text-[11px] leading-none text-[#667781]">11:06</span>
        </div>
        <Tail />
      </div>
    </div>
  </Illus>,
  <Illus key="3" className="[&>div:last-child]:gap-3">
    <Bub from="out" time="11:06" italic spinner>Verificar preços</Bub>
    <Bub from="out" time="11:06" italic spinner className="-mr-[12px]">Confirmar horário de funcionamento</Bub>
  </Illus>,
  // 03b.png, cartão 4: anexo (x 60, y 25, 127×60), áudio (x 59, y 94, 203×49) e resposta citando a mensagem de voz (x 195, y 152, 119×78)
  <Illus key="4" free>
    <div className="absolute left-[60px] top-[25px] w-[127px] rounded-[8px] border border-[#E6E7EC] bg-white p-[3px] font-sans shadow-[0_1px_1px_rgba(11,20,26,.05)]">
      <div className="flex items-center gap-2 rounded-[6px] bg-[#F2F3F5] px-2 py-[7px]">
        <span className="flex h-[19px] w-[15px] items-center justify-center rounded-[2px] border border-[#E5E7EB] bg-white text-[6px] font-semibold text-red-500">pdf</span>
        <span className="min-w-0 text-[11px] leading-[13px] text-[#111B21]">Fatura<br /><span className="whitespace-nowrap text-[7.5px] text-[#667781]">2 páginas • 66 kB • pdf</span></span>
      </div>
      <div className="pr-1.5 pt-[5px] text-right text-[7.5px] leading-[9px] text-[#667781]">11:06</div>
    </div>
    <div className="absolute left-[59px] top-[94px] flex h-[49px] w-[203px] items-center gap-2 rounded-[8px] border border-[#E6E7EC] bg-white pl-3 pr-2 font-sans shadow-[0_1px_1px_rgba(11,20,26,.05)]">
      <Play className="h-[13px] w-[13px] fill-[#54656F] text-[#54656F]" />
      <span className="flex flex-1 flex-col gap-0.5 pt-2">
        <span className="flex h-[15px] items-center gap-[2px]">
          <span className="mr-0.5 h-[8px] w-[8px] shrink-0 rounded-full bg-[#3B82F6]" />
          {Array.from({ length: 26 }, (_, i) => <span key={i} className="w-[1.5px] shrink-0 rounded bg-[#A6AEB5]" style={{ height: `${4 + ((i * 7) % 10)}px` }} />)}
        </span>
        <span className="flex justify-between text-[7.5px] leading-[9px] text-[#667781]"><span>0:25</span><span>11:06</span></span>
      </span>
      <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#8E9199] text-white">
        <UserRound className="h-4 w-4" />
        <Mic className="absolute -bottom-0.5 -left-1.5 h-3.5 w-3.5 text-[#3B82F6]" />
      </span>
    </div>
    <div className="absolute left-[195px] top-[152px] w-[119px] rounded-[8px] rounded-br-[2px] bg-[#D9FDD3] p-[3px] font-sans">
      <div className="rounded-[5px] border-l-[3px] border-[#C2185B] bg-[#CBEFC3] px-2 py-[5px] leading-[12px]">
        <div className="text-[10px] font-semibold text-[#C2185B]">Cliente</div>
        <div className="flex items-center gap-1 text-[8.5px] text-[#54656F]"><Mic className="h-2.5 w-2.5" /> Mensagem de voz</div>
      </div>
      <div className="px-1.5 pt-1.5 text-[10.5px] leading-[13px] text-[#111B21]">Sim, posso verificar!</div>
      <div className="flex items-center justify-end gap-0.5 pr-1 text-[7.5px] leading-[10px] text-[#667781]">11:06 <CheckCheck className="h-2.5 w-2.5" /></div>
      <Tail className="-right-[6px] h-[9px] w-[7px]" />
    </div>
  </Illus>,
  // 03b.png, cartão 5: painel "Resumo" a 70 px da borda, cortado pela direita
  <Illus key="5" free>
    <div className="absolute left-[70px] top-[52px] h-[167px] w-[340px] rounded-l-[14px] bg-white pl-[31px] pt-[26px] font-sans shadow-[0_12px_40px_-14px_rgba(15,15,22,.22)] [mask-image:linear-gradient(180deg,#000_70%,transparent)]">
      <div className="text-[19px] font-semibold leading-6 text-[#111B21]">Resumo</div>
      <div className="mt-[14px] flex items-center gap-[9px]">
        <Sparkles className="h-[15px] w-[15px] shrink-0 fill-brand-blue text-brand-blue" />
        <span className="h-[21px] flex-1 rounded-l-[6px] bg-gradient-to-r from-[#E3E4FD] via-[#ECEDFE] to-[#F7F7FF]" />
      </div>
      {['from-[#E9EAFD]', 'from-[#EDEEFD]', 'from-[#F3F3FC]'].map((c) => (
        <div key={c} className={cn('mt-[7px] h-[20px] rounded-l-[6px] bg-gradient-to-r to-[#FAFAFF]', c)} />
      ))}
    </div>
  </Illus>,
  // 03b.png, cartão 6: bolhas só com bandeiras, com rabicho
  <Illus key="6" free>
    {FLAG_BUBBLES.map(([cc, x, y, out], i) => (
      <span
        key={i}
        role="img"
        aria-label={`Mensagem com a bandeira ${cc.toUpperCase()}`}
        className={cn('absolute flex h-[24px] w-[35px] items-center justify-center rounded-[8px] shadow-[0_1px_2px_rgba(11,20,26,.12)]', out ? 'rounded-br-[2px] bg-[#D9FDD3]' : 'rounded-bl-[2px] bg-white')}
        style={{ left: x, top: y }}
      >
        <span className={`fi fi-${cc} rounded-[1px] text-[11px]`} />
        {out ? <Tail className="-right-[5px] h-[8px] w-[6px]" /> : <span aria-hidden className="absolute -left-[5px] bottom-0 h-[8px] w-[6px] bg-white [clip-path:polygon(100%_0,0_100%,100%_100%)]" />}
      </span>
    ))}
  </Illus>,
  <Illus key="7" className="[&>div:last-child]:gap-2">
    <Bub from="out" time="19:44" className="-mx-[6px] opacity-50" bubbleClassName="max-w-[243px]">Vou chamar um atendente para assumir a partir daqui!</Bub>
    <div className="-mx-[6px] rounded-[8px] border border-[#E6E7EC] bg-white px-4 py-[7px] text-center font-sans text-[13.5px] leading-[17px] text-[#111B21] shadow-[0_2px_8px_-3px_rgba(11,20,26,.15)]">
      <UserRound className="mr-1.5 inline h-[13px] w-[13px] -translate-y-px rounded-full border border-[#111B21]" />A conversa foi transferida para um atendente.
    </div>
  </Illus>,
]
