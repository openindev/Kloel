import type { ReactNode } from 'react'
import { CalendarCheck, Mail, MessageSquareText, MousePointer2, SendHorizontal, Sparkles, UserRound, Webhook } from 'lucide-react'
import { cn } from '@/lib/utils'

/*
 * Ilustrações dos cartões "Benefícios e Habilidades" do Webchat medidas em 3. Webchat/03.png e 03a.png
 * (cartões de 374×395 px a 1460 px; quadro de 214 px de altura, sem fundo; posições horizontais relativas ao centro do cartão,
 * equivalentes às medidas a 374 px e sem estourar no cartão de 86vw do celular).
 */

function Frame({ children }: { children: ReactNode }) {
  return <div className="relative h-[214px] overflow-hidden font-sans">{children}</div>
}

/** Janela de chat aberta na base (borda fina, cantos superiores arredondados) que some para baixo. */
function ChatWindow({ className, children }: { className?: string; children?: ReactNode }) {
  return (
    <div className={cn('absolute rounded-t-[14px] border border-b-0 border-[#ECEEF2] bg-white [mask-image:linear-gradient(180deg,#000_78%,transparent)]', className)}>
      <div className="flex h-[40px] items-center gap-[9px] border-b border-[#F0F1F4] px-[17px]">
        <span className="h-[21px] w-[21px] rounded-full bg-[#F1F2F5]" />
        <span className="h-[10px] w-[62px] rounded-full bg-[#F1F2F5]" />
      </div>
      {children}
    </div>
  )
}

function Cursor({ className }: { className?: string }) {
  return <MousePointer2 aria-hidden className={cn('absolute h-[13px] w-[13px] fill-[#111] text-[#111]', className)} />
}

const CHIP = 'absolute left-[21px] flex h-[32px] items-center gap-[6px] rounded-[10px] border border-[#E7E9EE] bg-white px-[11px] text-[10.5px] text-[#1F2430] shadow-[0_1px_2px_rgba(15,15,22,.04)]'

export const WC_BENEFIT_ILLUS: ReactNode[] = [
  // 03.png, cartão 1: janela de chat (69, 35, 252 px), saudação e pergunta do visitante
  <Frame key="1">
    <ChatWindow className="left-[calc(50%-118px)] top-[35px] h-[165px] w-[252px]">
      <div className="absolute left-[17px] top-[58px] rounded-[10px] border border-[#ECEEF2] bg-[#F7F8FA] px-[11px] py-[7px] text-[10px] leading-[16px] text-[#1F2430]">
        Olá! Como posso<br />te ajudar hoje?
      </div>
      <div className="absolute right-[16px] top-[114px] rounded-[10px] bg-brand-blue px-[10px] py-[7px] text-[10px] leading-[16px] text-white">
        Tenho uma <b>pergunta</b>
      </div>
    </ChatWindow>
  </Frame>,
  // cartão 2: janela (69, 22) com pedidos executados
  <Frame key="2">
    <ChatWindow className="left-[calc(50%-118px)] top-[22px] h-[200px] w-[253px]">
      <span className={cn(CHIP, 'top-[60px]')}><CalendarCheck className="h-[11px] w-[11px] text-brand-blue" /> Agendamento feito</span>
      <span className={cn(CHIP, 'top-[100px]')}><Webhook className="h-[11px] w-[11px] text-brand-blue" /> Webhooks acionados</span>
      <span className={cn(CHIP, 'top-[140px]')}><Mail className="h-[11px] w-[11px] text-brand-blue" /> E-mails enviados</span>
      <span className={cn(CHIP, 'top-[180px] opacity-40')}><Sparkles className="h-[11px] w-[11px] text-brand-blue" /> Lead qualificado</span>
    </ChatWindow>
  </Frame>,
  // cartão 3: área tracejada (37, 33, 299×149) para enviar documentos ou o site
  <Frame key="3">
    <div className="absolute left-1/2 top-[33px] flex h-[149px] w-[299px] max-w-[calc(100%-16px)] -translate-x-1/2 flex-col items-center rounded-[10px] border border-dashed border-[#E3E5EA] pt-[30px]">
      <div className="flex -space-x-1.5">
        {([['X', 'bg-[#1D7044]', '-rotate-[8deg]'], ['PDF', 'bg-[#E5534B]', ''], ['W', 'bg-[#2B5CB8]', 'rotate-[8deg]']] as const).map(([t, c, r]) => (
          <span key={t} className={cn('flex h-[27px] w-[24px] items-center justify-center rounded-[4px] border-2 border-white text-[7px] font-bold text-white shadow-[0_2px_6px_rgba(15,15,22,.18)]', c, r)}>{t}</span>
        ))}
      </div>
      <div className="mt-[9px] text-[10.5px] text-[#1F2430]">Adicione seus <b>docs</b> ou <b>site</b></div>
      <div className="relative mt-[9px] flex h-[29px] w-[153px] items-center justify-center rounded-[6px] border border-[#ECEEF2] bg-[#F3F4F7] text-[10.5px] text-[#9CA3AF]">
        cole seu site
        <Cursor className="-right-[4px] top-[12px]" />
      </div>
    </div>
  </Frame>,
  // 03a.png, cartão 4: janela cortada no topo com o aviso de controle humano e o campo de mensagem
  <Frame key="4">
    <div className="absolute left-[calc(50%-132px)] top-[-8px] h-[163px] w-[253px] rounded-b-[14px] border border-t-0 border-[#ECEEF2] bg-white">
      <div className="mx-[10px] mt-[8px] h-[22px] w-[140px] rounded-[10px] border border-[#F0F1F4] opacity-60" />
      <div className="absolute left-[49px] top-[71px] flex h-[24px] items-center gap-[5px] rounded-[8px] border border-[#E7E9EE] bg-white px-[11px] text-[10px] text-[#1F2430] shadow-[0_1px_2px_rgba(15,15,22,.05)]">
        <Sparkles className="h-[8px] w-[8px]" /> Agora você controla o chat
      </div>
      <div className="absolute inset-x-0 top-[115px] border-t border-[#F0F1F4]" />
      <div className="absolute left-[11px] top-[124px] flex h-[31px] w-[194px] items-center rounded-[8px] border border-brand-blue px-[9px] text-[10.5px] text-[#9CA3AF]">Escreva sua mensagem.</div>
      <div className="absolute left-[212px] top-[124px] flex h-[31px] w-[31px] items-center justify-center rounded-[8px] border border-[#E7E9EE]"><SendHorizontal className="h-[11px] w-[11px] text-[#1F2430]" /></div>
    </div>
    <Cursor className="left-[calc(50%+73px)] top-[167px]" />
  </Frame>,
  // cartão 5: navegador (59, 27) na página /planos com o balão contextual do widget
  <Frame key="5">
    <div className="absolute left-[calc(50%-128px)] top-[27px] h-[166px] w-[254px] rounded-[12px] border border-[#ECEEF2] bg-white">
      <div className="flex h-[25px] items-center gap-[4px] px-[9px]">
        {[0, 1, 2].map((i) => <span key={i} className="h-[4px] w-[4px] rounded-full bg-[#D5D8DE]" />)}
      </div>
      <span className="absolute -top-[5px] left-[41px] flex h-[20px] w-[100px] items-center rounded-[6px] border border-[#ECEEF2] bg-white px-[9px] text-[9.5px] text-[#1F2430]">/planos</span>
      <div className="absolute bottom-0 left-[52px] top-[25px] w-[155px] rounded-t-[8px] bg-[#F3F4F7]" />
      <div className="absolute left-[99px] top-[70px] flex items-center gap-[6px] rounded-[8px] border border-[#ECEEF2] bg-white px-[9px] py-[7px] text-[9.5px] leading-[13px] text-[#1F2430] shadow-[0_2px_8px_-3px_rgba(15,15,22,.15)]">
        <span className="flex h-[16px] w-[16px] items-center justify-center rounded-full bg-[#2B2F3A] text-white"><UserRound className="h-[10px] w-[10px]" /></span>
        <span>Olá! Dúvidas sobre<br />nossos <b>planos</b>?</span>
      </div>
      <span className="absolute left-[206px] top-[123px] flex h-[29px] w-[29px] items-center justify-center rounded-full bg-brand-blue text-white"><MessageSquareText className="h-[13px] w-[13px]" /></span>
    </div>
    <Cursor className="left-[calc(50%+101px)] top-[170px]" />
  </Frame>,
]
