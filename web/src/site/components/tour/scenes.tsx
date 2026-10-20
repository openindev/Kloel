import { CheckCircle2, Link2, Loader2, MousePointer2, Phone, ShieldCheck, Sparkles, UserRound } from 'lucide-react'
import { cn } from '@/lib/utils'
import { KloelLogo } from '@/components/brand/KloelLogo'
import { WhatsAppIcon } from '@/components/brand/icons'
import {
  AbilitiesList, AssistantsTableMock, CallsHistoryMock, CreateAssistantMock, EditAssistantHeader, FloatingTestBar, KnowledgeMock, MockSidebar, MockWindow, PhoneCallMock,
} from '../mocks/AppMocks'
import { WaBubble, WaDayLabel, WaPhone, WaSystemNote } from '../mocks/WhatsAppMocks'
import type { TourScene } from './TourPlayer'

/** progresso local entre a e b (0..1) */
export const seg = (p: number, a: number, b: number) => Math.max(0, Math.min(1, (p - a) / (b - a)))
export const typed = (s: string, p: number) => s.slice(0, Math.ceil(s.length * Math.max(0, Math.min(1, p))))

function Backdrop({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_0%,#ffffff_0%,#eef0fb_60%,#e3e6fb_100%)]', className)}>{children}</div>
}

function Cursor({ x, y, click }: { x: number; y: number; click?: boolean }) {
  return (
    <div className="absolute z-20 transition-all duration-700 ease-out" style={{ left: x, top: y }}>
      <MousePointer2 className={cn('h-6 w-6 fill-slate-900 text-white drop-shadow', click && 'scale-90')} />
      {click && <span className="absolute -left-2 -top-2 h-8 w-8 animate-ping rounded-full bg-brand-blue/30" />}
    </div>
  )
}

function AppFrame({ active, children }: { active: string; children: React.ReactNode }) {
  return (
    <MockWindow className="absolute inset-x-10 bottom-14 top-14 flex">
      <MockSidebar active={active} />
      <div className="relative min-w-0 flex-1 overflow-hidden p-5">{children}</div>
    </MockWindow>
  )
}

function Intro({ p, label }: { p: number; label: string }) {
  const n = Math.min(100, Math.round(seg(p, 0.05, 0.7) * 100))
  return (
    <Backdrop className="flex flex-col items-center justify-center bg-[radial-gradient(90%_90%_at_50%_30%,#6d72ff_0%,#3b3fc9_55%,#14153d_100%)] text-white">
      <KloelLogo className="text-[26px] text-white [&>span]:text-[#c7c9ff]" />
      <div className="mt-6 font-site text-[150px] font-semibold leading-none tracking-[-0.04em] tabular-nums">{n}</div>
      <div className="mt-2 font-site text-[22px] tracking-[0.6em]">SEGUNDOS</div>
      <div className="mt-8 rounded-full bg-white/15 px-4 py-1.5 font-site text-[15px] backdrop-blur">{label}</div>
    </Backdrop>
  )
}

/* ------------------------------ Tour: voz ------------------------------ */

export const VOICE_TOUR: TourScene[] = [
  { id: 'intro', title: 'Introdução', duration: 8, caption: 'Em 100 segundos, veja como colocar um assistente de voz da Kloel para atender suas ligações.', render: (p) => <Intro p={p} label="Tour pela plataforma Kloel" /> },
  {
    id: 'criar', title: 'Criar assistente', duration: 16,
    caption: 'Tudo começa em “Criar assistente”: escolha o tipo (voz ou chat), dê um nome e pronto.',
    render: (p) => (
      <Backdrop>
        <AppFrame active="Assistentes">
          <AssistantsTableMock rows={[{ name: 'Helena', type: 'Voz', conn: '+55 11 90000-0103' }]} />
        </AppFrame>
        <div className="absolute inset-0 bg-slate-900/25" />
        <div className="absolute left-1/2 top-[70px] w-[540px] -translate-x-1/2">
          <CreateAssistantMock typed={typed('Roberta', seg(p, 0.15, 0.6))} selected="voice" pressing={p > 0.85} />
        </div>
        <Cursor x={p < 0.7 ? 360 : 640} y={p < 0.7 ? 200 : 445} click={p > 0.85} />
      </Backdrop>
    ),
  },
  {
    id: 'comportamento', title: 'Comportamento', duration: 18,
    caption: 'Defina o que ele faz: responder perguntas, transferir ligações, enviar e-mails e agendar compromissos.',
    render: (p) => {
      const h = 1 + Math.min(6, Math.floor(p * 7))
      const added = [1, 2, 3, 7].filter((i) => i < h || (i === 7 && p > 0.9))
      return (
        <Backdrop>
          <AppFrame active="Assistentes">
            <EditAssistantHeader />
            <div className="mt-3 w-[560px]">
              <AbilitiesList highlight={h} added={added} compact={false} />
            </div>
            <FloatingTestBar className="absolute bottom-4 left-1/2 -translate-x-1/2" items={['+55 11 90000-0101']} primary="Testar ligação" />
          </AppFrame>
        </Backdrop>
      )
    },
  },
  {
    id: 'conhecimento', title: 'Conhecimento', duration: 16,
    caption: 'Cole o endereço do seu site e a Kloel importa as informações da empresa para a base de conhecimento.',
    render: (p) => (
      <Backdrop>
        <AppFrame active="Conhecimento">
          <KnowledgeMock progress={Math.min(1, seg(p, 0.1, 0.6))} entries={Math.round(seg(p, 0.35, 0.95) * 5)} className="w-[600px] p-0" />
        </AppFrame>
      </Backdrop>
    ),
  },
  {
    id: 'numero', title: 'Número', duration: 14,
    caption: 'Ative um número de telefone (ou encaminhe o seu) e o assistente passa a atender na hora.',
    render: (p) => (
      <Backdrop>
        <AppFrame active="Números de telefone">
          <div className="font-sans text-[15px] font-semibold text-slate-900">Números de telefone</div>
          <div className="mt-4 w-[600px] overflow-hidden rounded-lg border border-slate-200 font-sans text-[12px]">
            {[
              { n: '+55 11 90000-0101', a: 'Roberta', on: p > 0.35 },
              { n: '+55 11 90000-0103', a: 'Helena', on: true },
            ].map((r) => (
              <div key={r.n} className="flex items-center gap-3 border-b border-slate-100 px-4 py-3 last:border-0">
                <Phone className="h-4 w-4 text-slate-400" />
                <span className="w-[160px] font-medium text-slate-900">{r.n}</span>
                <span className="flex-1 text-slate-600">{r.a}</span>
                <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors', r.on ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500')}>{r.on ? 'Ativo' : 'Ativando…'}</span>
              </div>
            ))}
          </div>
          {p > 0.4 && (
            <div className="ks-pop absolute right-6 top-5 flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 font-sans text-[12px] text-white shadow-lg">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" /> Número ativado para Roberta
            </div>
          )}
        </AppFrame>
      </Backdrop>
    ),
  },
  {
    id: 'ligacao', title: 'Ligação', duration: 16,
    caption: 'Quando um cliente liga, a IA atende com voz natural em português, entende o pedido e resolve.',
    render: (p) => {
      const lines = [
        { who: 'ai', text: 'Olá! Aqui é a Roberta, da Clínica Bem Viver. Como posso ajudar?' },
        { who: 'caller', text: 'Oi, queria marcar um retorno com a Dra. Ana.' },
        { who: 'ai', text: 'Claro! Tenho quinta às 14h ou sexta às 10h. Qual prefere?' },
        { who: 'caller', text: 'Quinta às 14h, por favor.' },
        { who: 'ai', text: 'Pronto, agendado! Vou enviar a confirmação por SMS.' },
      ]
      const shown = Math.ceil(p * lines.length)
      return (
        <Backdrop className="flex items-center justify-center gap-10">
          <div className="h-[420px]">
            <PhoneCallMock seconds={Math.round(p * 52)} name="Roberta · IA" />
          </div>
          <div className="flex w-[440px] flex-col gap-2 font-sans text-[13px]">
            {lines.slice(0, shown).map((l, i) => (
              <div key={i} className={cn('ks-fade-up max-w-[85%] rounded-xl px-3 py-2', l.who === 'ai' ? 'bg-white text-slate-800 shadow-sm' : 'ml-auto bg-brand-blue text-white')}>
                {l.text}
              </div>
            ))}
          </div>
        </Backdrop>
      )
    },
  },
  {
    id: 'historico', title: 'Histórico', duration: 12,
    caption: 'Cada ligação vira registro: transcrição, resumo e resultado, prontos para sua equipe.',
    render: (p) => (
      <Backdrop>
        <AppFrame active="Conversas">
          <CallsHistoryMock selected={Math.min(2, Math.floor(p * 3))} className="h-full" />
        </AppFrame>
      </Backdrop>
    ),
  },
]

/* ---------------------------- Tour: WhatsApp ---------------------------- */

export const WHATSAPP_TOUR: TourScene[] = [
  { id: 'intro', title: 'Introdução', duration: 8, caption: 'O chatbot com IA da Kloel para o WhatsApp, em 100 segundos.', render: (p) => <Intro p={p} label="Chatbot de IA para WhatsApp" /> },
  {
    id: 'criar', title: 'Criar assistente', duration: 16,
    caption: 'Crie um assistente de chat: escolha “Assistente de chat” e dê um nome.',
    render: (p) => (
      <Backdrop>
        <AppFrame active="Assistentes">
          <AssistantsTableMock rows={[{ name: 'Helena', type: 'Voz', conn: '+55 11 90000-0103' }]} />
        </AppFrame>
        <div className="absolute inset-0 bg-slate-900/25" />
        <div className="absolute left-1/2 top-[70px] w-[540px] -translate-x-1/2">
          <CreateAssistantMock typed={typed('Marina', seg(p, 0.2, 0.6))} selected={p > 0.12 ? 'chat' : 'voice'} pressing={p > 0.85} />
        </div>
        <Cursor x={p < 0.12 ? 380 : p < 0.7 ? 640 : 640} y={p < 0.12 ? 230 : p < 0.7 ? 200 : 445} click={p > 0.85 || (p > 0.08 && p < 0.14)} />
      </Backdrop>
    ),
  },
  {
    id: 'conectar', title: 'Conectar WhatsApp', duration: 16,
    caption: 'Conecte sua conta do WhatsApp Business ou use um número fornecido pela Kloel.',
    render: (p) => {
      const steps = ['Entrar com a conta Meta', 'Selecionar a conta comercial', 'Verificar o número', 'WhatsApp conectado']
      const done = Math.floor(p * 4.4)
      return (
        <Backdrop>
          <AppFrame active="Assistentes">
            <div className="w-[520px] rounded-xl border border-slate-200 p-5 font-sans">
              <div className="flex items-center gap-2 text-[15px] font-semibold text-slate-900">
                <WhatsAppIcon className="h-5 w-5 text-[#25D366]" /> Ativar WhatsApp
              </div>
              <p className="mt-1 text-[12px] text-slate-500">Número: +55 11 90000-0102 · Marina</p>
              <div className="mt-4 flex flex-col gap-2.5 text-[13px]">
                {steps.map((s, i) => (
                  <div key={s} className="flex items-center gap-2.5">
                    {i < done ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : i === done ? <Loader2 className="h-4 w-4 animate-spin text-brand-blue" /> : <span className="h-4 w-4 rounded-full border border-slate-300" />}
                    <span className={i <= done ? 'text-slate-900' : 'text-slate-400'}>{s}</span>
                  </div>
                ))}
              </div>
              {done >= 4 && <div className="ks-pop mt-4 flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-[12px] text-emerald-800"><ShieldCheck className="h-4 w-4" /> Conexão concluída</div>}
            </div>
          </AppFrame>
        </Backdrop>
      )
    },
  },
  {
    id: 'conhecimento', title: 'Conhecimento', duration: 16,
    caption: 'Adicione as informações do seu negócio pela URL do site ou enviando PDFs.',
    render: (p) => (
      <Backdrop>
        <AppFrame active="Conhecimento">
          <KnowledgeMock progress={Math.min(1, seg(p, 0.1, 0.6))} entries={Math.round(seg(p, 0.35, 0.95) * 5)} className="w-[600px] p-0" />
        </AppFrame>
      </Backdrop>
    ),
  },
  {
    id: 'conversa', title: 'Conversa', duration: 20,
    caption: 'Seus clientes escrevem no WhatsApp e a IA responde em segundos, inclusive à noite e nos fins de semana.',
    render: (p) => {
      const msgs: { from: 'in' | 'out'; text: string; time: string }[] = [
        { from: 'in', text: 'Oi! Vocês atendem convênio?', time: '22:14' },
        { from: 'out', text: 'Olá! Sou a Marina, da Clínica Bem Viver. Atendemos os principais convênios. Qual é o seu?', time: '22:14' },
        { from: 'in', text: 'Bem Saúde. Dá pra marcar para amanhã?', time: '22:15' },
        { from: 'out', text: 'Dá sim! Tenho 9h ou 15h. Qual prefere?', time: '22:15' },
        { from: 'in', text: '15h 👍', time: '22:16' },
        { from: 'out', text: 'Agendado para amanhã às 15h. Até lá! ✅', time: '22:16' },
      ]
      const shown = Math.ceil(p * msgs.length)
      return (
        <Backdrop className="flex items-center justify-center gap-12">
          <WaPhone title="Clínica Bem Viver" subtitle="conta comercial" className="h-[470px] w-[270px]">
            <WaDayLabel />
            {msgs.slice(0, shown).map((m, i) => (
              <WaBubble key={i} from={m.from === 'in' ? 'in' : 'out'} time={m.time} className="ks-fade-up">
                {m.text}
              </WaBubble>
            ))}
          </WaPhone>
          <div className="w-[300px] font-site text-[15px] text-heading">
            <div className="flex items-center gap-2 text-[13px] text-body"><Sparkles className="h-4 w-4 text-brand-blue" /> IA respondendo</div>
            <div className="mt-2 text-[26px] font-medium leading-8 tracking-[-0.02em]">Responde em segundos, 24 horas por dia.</div>
          </div>
        </Backdrop>
      )
    },
  },
  {
    id: 'transferir', title: 'Transferência', duration: 12,
    caption: 'Se for preciso, sua equipe assume a conversa e depois devolve para a IA.',
    render: () => (
      <Backdrop className="flex items-center justify-center">
        <WaPhone title="Clínica Bem Viver" subtitle="conta comercial" className="h-[440px] w-[270px]">
          <WaBubble from="in" time="10:02">Preciso falar com alguém sobre um reembolso.</WaBubble>
          <WaBubble from="out" time="10:02" italic>Vou chamar um atendente para assumir a partir daqui!</WaBubble>
          <WaSystemNote>A conversa foi transferida para um atendente.</WaSystemNote>
          <WaBubble from="out" time="10:04">Oi, aqui é a Paula, da recepção. Vou verificar para você.</WaBubble>
        </WaPhone>
      </Backdrop>
    ),
  },
  {
    id: 'resumo', title: 'Resumo', duration: 12,
    caption: 'Ao final, a Kloel envia um resumo da conversa para a pessoa certa da equipe.',
    render: (p) => (
      <Backdrop className="flex items-center justify-center">
        <div className="w-[520px] rounded-2xl border border-slate-200 bg-white p-6 font-sans shadow-xl">
          <div className="flex items-center gap-2 text-[14px] font-semibold text-slate-900"><Sparkles className="h-4 w-4 text-brand-blue" /> Resumo da conversa</div>
          <div className="mt-4 flex flex-col gap-2 text-[13px] text-slate-700">
            {['Cliente: +55 11 90000-0456', 'Assunto: agendamento pelo convênio Bem Saúde', 'Resultado: consulta marcada para amanhã às 15h', 'Próximo passo: enviar lembrete 2 horas antes'].slice(0, Math.ceil(p * 4)).map((l) => (
              <div key={l} className="ks-fade-up flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-600" /> {l}</div>
            ))}
          </div>
          <div className="mt-5 flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-[12px] text-slate-500"><UserRound className="h-4 w-4" /> Enviado para recepcao@exemplo.com.br <Link2 className="ml-auto h-3.5 w-3.5" /></div>
        </div>
      </Backdrop>
    ),
  },
]
