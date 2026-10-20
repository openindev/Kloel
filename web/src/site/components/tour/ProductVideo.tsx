import { useEffect, useState } from 'react'
import {
  CalendarDays, ChevronRight, CircleHelp, CirclePlus, ClipboardList, Contact, Mail, MessageSquare, Pause, PhoneForwarded, Play, Plus, Sparkles, UserRound, Webhook, X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { ScaledStage } from './ScaledStage'
import { TourPlayer, type TourScene } from './TourPlayer'
import { CreateAssistantMock } from '../mocks/AppMocks'

type VideoAbility = { icon: React.ComponentType<{ className?: string }>; title: string; nav?: boolean; group?: string; action: string }

/** Habilidades mostradas no "vídeo" (referência 02.png: Essenciais, Responder perguntas, Transferir ligações, Enviar e-mail, Recursos avançados…). */
const VOICE_ABILITIES: VideoAbility[] = [
  { icon: Sparkles, title: 'Essenciais', nav: true, action: 'Editar nome, voz e idioma' },
  { icon: CircleHelp, title: 'Responder perguntas', action: 'Adicionar informações da empresa' },
  { icon: PhoneForwarded, title: 'Transferir ligações', action: 'Adicionar número de transferência' },
  { icon: Mail, title: 'Enviar e-mail', action: 'Adicionar destinatário de e-mail' },
  { icon: Contact, title: 'Conectar contatos', group: 'Recursos avançados', action: 'Conectar lista de contatos' },
  { icon: Sparkles, title: 'Prompt personalizado / instruções', nav: true, action: 'Escrever instruções personalizadas' },
  { icon: MessageSquare, title: 'Enviar SMS', action: 'Adicionar modelo de SMS' },
  { icon: CalendarDays, title: 'Agendar compromissos', nav: true, action: 'Adicionar novo agendamento de calendário' },
  { icon: Webhook, title: 'Webhooks', action: 'Adicionar webhook' },
]
/** Assistente de CHAT (WhatsApp / webchat): sem ligações nem SMS. */
const CHAT_ABILITIES: VideoAbility[] = [
  { icon: Sparkles, title: 'Essenciais', nav: true, action: 'Editar nome e idioma' },
  { icon: CircleHelp, title: 'Responder perguntas', action: 'Adicionar informações da empresa' },
  { icon: UserRound, title: 'Transferir para humano', action: 'Escolher quem assume a conversa' },
  { icon: Mail, title: 'Enviar e-mail', action: 'Adicionar destinatário de e-mail' },
  { icon: Contact, title: 'Conectar contatos', group: 'Recursos avançados', action: 'Conectar lista de contatos' },
  { icon: Sparkles, title: 'Prompt personalizado / instruções', nav: true, action: 'Escrever instruções personalizadas' },
  { icon: ClipboardList, title: 'Coletar dados do cliente', action: 'Escolher os dados coletados' },
  { icon: CalendarDays, title: 'Agendar compromissos', nav: true, action: 'Adicionar novo agendamento de calendário' },
  { icon: Webhook, title: 'Webhooks', action: 'Adicionar webhook' },
]

/**
 * Loop "vídeo padrão" da página: UI da plataforma em perspectiva 3D, alternando lista de habilidades e modal "Criar assistente".
 * Composição medida nas referências 02.png e 03.png (caixa de 1152×648 a 1460px; palco 960×540 → escala 1,2):
 * - fase 1: coluna de habilidades (linhas tracejadas de ~53px, rótulo em negrito, + verde ou ›) entre x≈21% e x≈51% da caixa,
 *   inclinada em perspectiva (linhas crescem para baixo e para a esquerda), primeira linha cortada no topo; painel da habilidade
 *   em destaque à direita (título + "⊕ Adicionar…"); fundo #F9F9F9;
 * - fase 2: tabela de assistentes ao fundo ("Tipo", "Conexão"), véu preto a 25% e o modal "Criar assistente" grande (≈63% da
 *   largura), levemente à esquerda do centro e em perspectiva.
 * WhatsApp e Webchat mostram as habilidades de um assistente de CHAT e o modal com "Assistente de chat" (referência 3. Webchat/02.png).
 */
export function PlatformLoop({ variant = 'voice', paused }: { variant?: 'voice' | 'whatsapp' | 'webchat'; paused?: boolean }) {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (paused) return
    const id = setInterval(() => setTick((t) => t + 1), 900)
    return () => clearInterval(id)
  }, [paused])
  const phase = Math.floor(tick / 8) % 2 // 0 = habilidades, 1 = modal
  const items = variant === 'voice' ? VOICE_ABILITIES : CHAT_ABILITIES
  // começa (e repousa) em "Agendar compromissos", como no quadro da referência; depois percorre as demais habilidades
  const highlight = (7 + (tick % 8)) % items.length || 1
  const current = items[highlight]!
  const name = variant === 'whatsapp' ? 'Marina' : variant === 'webchat' ? 'Lorena' : 'Roberta'
  const typedLen = Math.min(name.length, (tick % 8) + 1)
  return (
    <div className="absolute inset-0 overflow-hidden bg-[#F9F9F9]">
      {phase === 0 ? (
        <div className="absolute inset-0 [perspective:1100px]">
          <div className="absolute left-[208px] top-[-12px] w-[720px] [transform-origin:62%_0%] [transform:rotateX(23deg)_rotateZ(1.2deg)]">
            <div className="flex items-start gap-[22px] font-sans">
              <div className="flex w-[280px] shrink-0 flex-col gap-[9px]">
                {items.map((it, i) => (
                  <div key={it.title}>
                    {it.group && <div className="mb-[16px] mt-[22px] pl-2 text-[12.5px] text-slate-500">{it.group}</div>}
                    <div
                      className={cn(
                        'flex h-[44px] items-center gap-3 rounded-[10px] border border-dashed px-3.5 transition-colors duration-300',
                        i === highlight ? 'border-slate-200 bg-slate-100 text-brand-blue' : 'border-slate-300/80 bg-white/70 text-slate-900',
                      )}
                    >
                      <it.icon className={cn('h-[17px] w-[17px] shrink-0', i === highlight ? 'text-brand-blue' : 'text-slate-600')} />
                      <span className="min-w-0 flex-1 truncate text-[14px] font-semibold tracking-[-0.01em]">{it.title}</span>
                      {it.nav || i === highlight ? (
                        <ChevronRight className={cn('h-4 w-4 shrink-0', i === highlight ? 'text-brand-blue' : 'text-slate-500')} />
                      ) : (
                        <span className="flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
                          <Plus className="h-3 w-3" strokeWidth={3} />
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-[22px] w-[418px] shrink-0 rounded-xl border border-slate-200/80 bg-white/80 font-sans">
                <div className="flex items-center justify-between px-4 pb-3 pt-4">
                  <span className="text-[14.5px] font-semibold text-slate-800">{current.title}</span>
                  <X className="h-4 w-4 text-slate-500" />
                </div>
                <div className="flex items-center justify-center gap-1.5 border-t border-slate-200/80 px-4 py-4 text-[12.5px] text-brand-blue/90">
                  <CirclePlus className="h-3.5 w-3.5" /> {current.action}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="absolute inset-0">
          {/* tabela de assistentes ao fundo (cabeçalhos "Tipo" e "Conexão" visíveis acima e à direita do modal) */}
          <div className="absolute inset-x-0 top-0 font-sans text-[12.5px] text-slate-500">
            <div className="flex h-[32px] items-center border-b border-slate-200">
              <span className="absolute left-[292px]">Tipo</span>
              <span className="absolute left-[589px]">Conexão</span>
            </div>
            {['Conectado', 'Conectado', 'Desconectado', 'Conectado'].map((c, i) => (
              <div key={i} className="relative h-[76px] border-b border-slate-200">
                <span className="absolute left-[292px] top-[29px] text-slate-700">{i === 2 ? 'Chat' : 'Voz'}</span>
                <span className="absolute left-[790px] top-[29px] text-slate-700">{c}</span>
              </div>
            ))}
          </div>
          <div className="absolute inset-0 bg-black/25" />
          <div className="absolute inset-0 flex items-center justify-center [perspective:1200px]">
            {/* [311] 03.png: modal entre y 149 e 697 da janela (centro 9 px acima do centro do palco) */}
            <div className="[transform:translate(-20px,-9px)_rotateX(7deg)_scale(1.13)]">
              <CreateAssistantMock size="video" className="w-[640px] max-w-[640px]" typed={name.slice(0, typedLen)} selected={variant === 'voice' ? 'voice' : 'chat'} chatChannels={variant === 'webchat' ? 'both' : 'whatsapp'} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Bloco de "vídeo" de produto: loop animado da plataforma + pílula "Veja o tour… / 100 segundos ▶" que abre o TourPlayer inline (OBSERVADO: troca o vídeo padrão pelo tour).
 * props: scenes (tour), pillTitle, pillSubtitle (padrão "100 segundos"), variant do loop, tourTitle, noTour (só loop com pausa)
 */
export function ProductVideo({
  scenes, pillTitle = 'Veja o tour pela plataforma', pillSubtitle = '100 segundos', variant = 'voice', tourTitle = 'Tour pela plataforma', noTour, className,
}: { scenes?: TourScene[]; pillTitle?: string; pillSubtitle?: string; variant?: 'voice' | 'whatsapp' | 'webchat'; tourTitle?: string; noTour?: boolean; className?: string }) {
  const [mode, setMode] = useState<'loop' | 'tour'>('loop')
  const [paused, setPaused] = useState(false)
  if (mode === 'tour' && scenes) {
    return <TourPlayer scenes={scenes} title={tourTitle} onClose={() => setMode('loop')} className={className} />
  }
  return (
    <div className={cn('relative overflow-hidden rounded-2xl', className)}>
      <ScaledStage width={960} height={540}>
        <PlatformLoop variant={variant} paused={paused} />
      </ScaledStage>
      {!noTour && scenes && (
        <button
          type="button"
          onClick={() => setMode('tour')}
          className="group absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-4 rounded-2xl bg-brand-blue py-2.5 pl-4 pr-2.5 text-left font-site text-white shadow-[0_18px_40px_-12px_rgba(88,93,254,.75)] transition-transform hover:scale-[1.03] sm:gap-6 sm:py-3 sm:pl-5 sm:pr-3"
          data-testid="tour-open"
        >
          <span className="flex flex-col">
            <span className="text-[14px] font-medium leading-5 sm:text-[17px] sm:leading-6">{pillTitle}</span>
            <span className="text-[12px] text-white/85 sm:text-[14px]">{pillSubtitle}</span>
          </span>
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-brand-blue sm:h-12 sm:w-12">
            <Play className="ml-0.5 h-5 w-5 fill-current" />
          </span>
        </button>
      )}
      <button
        type="button"
        onClick={() => setPaused((v) => !v)}
        className="absolute bottom-3 right-3 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-ink shadow-sm hover:bg-white"
        aria-label={paused ? 'Retomar animação' : 'Pausar animação'}
      >
        {paused ? <Play className="ml-0.5 h-3.5 w-3.5 fill-current" /> : <Pause className="h-3.5 w-3.5 fill-current" />}
      </button>
    </div>
  )
}
