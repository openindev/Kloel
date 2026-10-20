import type { ReactNode } from 'react'
import {
  ArrowLeft, BookOpen, CalendarDays, ChevronRight, CircleHelp, Contact, FileText, Globe, Headphones, Home, Mail, MessageSquare, MessageSquareText,
  MicOff, MoreHorizontal, Phone, PhoneForwarded, Plus, Search, Settings2, Sparkles, Users, Video, Volume2, Webhook, X, Check, Copy, Trash2, Loader2, UserRound, ClipboardList,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { KloelLogo } from '@/components/brand/KloelLogo'
import { WhatsAppIcon } from '@/components/brand/icons'

/*
 * Mocks de interface do app Kloel, construídos com componentes reais (não são capturas de tela).
 * Usados no tour da plataforma, nos "vídeos" de produto e nas ilustrações dos cartões.
 * Fonte do app: Geist (font-sans).
 */

export function MockWindow({ children, className, dots = false, url }: { children: ReactNode; className?: string; dots?: boolean; url?: string }) {
  return (
    <div className={cn('overflow-hidden rounded-xl border border-slate-200 bg-white font-sans shadow-[0_20px_60px_-24px_rgba(15,15,22,.35)]', className)}>
      {dots && (
        <div className="flex h-9 items-center gap-1.5 border-b border-slate-100 px-3">
          <span className="h-2.5 w-2.5 rounded-full bg-[#FF5F57]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#FEBC2E]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28C840]" />
          {url && <span className="ml-3 truncate rounded-md bg-slate-50 px-2 py-0.5 text-[11px] text-slate-500">{url}</span>}
        </div>
      )}
      {children}
    </div>
  )
}

const NAV = [
  { icon: Home, label: 'Visão geral' },
  { icon: Users, label: 'Assistentes' },
  { icon: MessageSquareText, label: 'Conversas' },
  { icon: BookOpen, label: 'Conhecimento' },
  { icon: Phone, label: 'Números de telefone' },
  { icon: CalendarDays, label: 'Agendador' },
  { icon: Contact, label: 'Contatos' },
]

export function MockSidebar({ active = 'Assistentes', className }: { active?: string; className?: string }) {
  return (
    <aside className={cn('flex w-[160px] shrink-0 flex-col gap-0.5 border-r border-slate-100 bg-[#FAFAFA] p-2.5 text-[11px]', className)}>
      <KloelLogo size="sm" className="mb-3 px-1.5 text-[14px]" />
      {NAV.map((n) => (
        <span key={n.label} className={cn('flex items-center gap-2 whitespace-nowrap rounded-md px-1.5 py-1.5 text-slate-600', active === n.label && 'bg-white font-medium text-slate-900 shadow-sm')}>
          <n.icon className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{n.label}</span>
        </span>
      ))}
      <span className="mt-auto flex items-center gap-2 rounded-md px-1.5 py-1.5 text-slate-600">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-100 text-[9px] font-semibold text-indigo-700">CB</span>
        Clínica Bem Viver
      </span>
    </aside>
  )
}

export function AbilityRow({
  icon: Icon, title, desc, state = 'add', chip, active, className, badge,
}: { icon: React.ComponentType<{ className?: string }>; title: string; desc?: string; state?: 'add' | 'added' | 'chevron'; chip?: string; active?: boolean; className?: string; badge?: string }) {
  return (
    <div
      className={cn(
        'flex items-center gap-2.5 rounded-lg border bg-white px-3 py-2.5 text-[12px] transition-all duration-300',
        state === 'add' ? 'border-dashed border-slate-200' : 'border-slate-200',
        active && 'border-brand-blue/50 bg-indigo-50/60 text-brand-blue shadow-[0_0_0_3px_rgba(88,93,254,.12)]',
        className,
      )}
    >
      <Icon className={cn('h-4 w-4 shrink-0', active ? 'text-brand-blue' : 'text-slate-500')} />
      <span className={cn('shrink-0 font-medium', active ? 'text-brand-blue' : 'text-slate-900')}>{title}</span>
      {badge && <span className="rounded-full bg-brand-blue px-1.5 text-[9px] font-semibold uppercase text-white">{badge}</span>}
      {desc && <span className="min-w-0 flex-1 truncate text-right text-[11px] text-slate-400">{desc}</span>}
      {!desc && <span className="flex-1" />}
      {/* o chip encolhe com reticências: a seta › nunca sai da borda da linha */}
      {chip && <span className="min-w-0 truncate rounded-full border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-600">{chip}</span>}
      {state === 'add' && (
        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
          <Plus className="h-3 w-3" />
        </span>
      )}
      {state === 'added' && (
        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
          <Check className="h-3 w-3" />
        </span>
      )}
      {state === 'chevron' && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />}
    </div>
  )
}

type AbilityItem = { icon: React.ComponentType<{ className?: string }>; title: string; desc: string; chip?: string; group?: string; badge?: string }

/** Habilidades de um assistente de CHAT (WhatsApp / webchat): sem ligações, SMS ou transferência de chamadas. */
const CHAT_ABILITIES = (name: string): AbilityItem[] => [
  { icon: Sparkles, title: 'Essenciais', desc: '', chip: name },
  { icon: CircleHelp, title: 'Responder perguntas', desc: 'Responda dúvidas com a base de conhecimento.' },
  { icon: UserRound, title: 'Transferir para humano', desc: 'Sua equipe assume a conversa quando preciso.' },
  { icon: Mail, title: 'Enviar e-mail', desc: 'Resumo da conversa para a pessoa certa.' },
  { icon: Contact, title: 'Conectar contatos', desc: 'Reconheça clientes que já conversaram.', group: 'Recursos avançados', badge: 'Novo' },
  { icon: Sparkles, title: 'Prompt personalizado / instruções', desc: 'Personalize com um prompt.' },
  { icon: ClipboardList, title: 'Coletar dados do cliente', desc: 'Nome, e-mail e telefone no chat.' },
  { icon: CalendarDays, title: 'Agendar compromissos', desc: 'Agende direto na conversa.' },
  { icon: Webhook, title: 'Webhooks', desc: 'Integrações via API de entrada e saída.' },
]

/**
 * Lista de habilidades do assistente ("Comportamento"). `highlight` = índice destacado; `added` = conjunto já adicionado.
 * kind: 'voice' (padrão — ligações, SMS) | 'chat' (WhatsApp / webchat).
 */
export function AbilitiesList({ highlight, added = [], name = 'Roberta', compact, className, kind = 'voice' }: { highlight?: number; added?: number[]; name?: string; compact?: boolean; className?: string; kind?: 'voice' | 'chat' }) {
  const items: AbilityItem[] = kind === 'chat' ? CHAT_ABILITIES(name) : [
    { icon: Sparkles, title: 'Essenciais', desc: '', chip: name },
    { icon: CircleHelp, title: 'Responder perguntas', desc: 'Responda dúvidas com a base de conhecimento.' },
    { icon: PhoneForwarded, title: 'Transferir ligações', desc: 'Encaminhe para sua equipe ou outros números.' },
    { icon: Mail, title: 'Enviar e-mail', desc: 'E-mails automáticos com os dados da ligação.' },
    { icon: Contact, title: 'Conectar contatos', desc: 'Reconheça quem liga.', group: 'Recursos avançados', badge: 'Novo' },
    { icon: Sparkles, title: 'Prompt personalizado / instruções', desc: 'Personalize com um prompt.' },
    { icon: MessageSquare, title: 'Enviar SMS', desc: 'Mensagens após a ligação.' },
    { icon: CalendarDays, title: 'Agendar compromissos', desc: 'Agende automaticamente para quem ligou.' },
    { icon: Webhook, title: 'Webhooks', desc: 'Integrações via API de entrada e saída.' },
  ]
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {items.slice(0, compact ? 6 : items.length).map((it, i) => (
        <div key={it.title}>
          {it.group && <div className="mb-2 mt-2 text-[11px] text-slate-400">{it.group}</div>}
          <AbilityRow icon={it.icon} title={it.title} desc={it.desc} chip={it.chip} badge={it.badge} state={i === 0 ? 'chevron' : added.includes(i) ? 'added' : 'add'} active={highlight === i} />
        </div>
      ))}
    </div>
  )
}

/**
 * Modal "Criar assistente" (tipo voz/chat + nome). typed = texto já "digitado" no nome.
 * size: 'tour' (padrão, cenas do tour) | 'video' (loop do vídeo da home/produtos, medido em [311] 03.png a 1460 px: modal de
 * ≈548 px de altura exibida com título 16,5 px, rótulos 13,5 px, cartões de tipo com 134 px, descrição 12,5/19 px em 2 linhas,
 * campo e botões de 39 px). Só o espaçamento interno muda; o conteúdo é o mesmo.
 */
export function CreateAssistantMock({ typed = 'Roberta', selected = 'voice', pressing, chatChannels = 'whatsapp', className, size = 'tour' }: { typed?: string; selected?: 'voice' | 'chat'; pressing?: boolean; chatChannels?: 'whatsapp' | 'both'; className?: string; size?: 'tour' | 'video' }) {
  const v = size === 'video'
  return (
    <div className={cn('w-full max-w-[560px] rounded-2xl border border-slate-200 bg-white font-sans shadow-[0_30px_80px_-30px_rgba(15,15,22,.45)]', v ? 'px-6 pb-6 pt-[18px]' : 'p-6', className)}>
      <div className="flex items-center justify-between">
        <div className={cn('font-semibold text-slate-900', v ? 'text-[16.5px]' : 'text-[18px]')}>Criar assistente</div>
        <X className="h-4 w-4 text-slate-400" />
      </div>
      <div className={cn('font-medium text-slate-700', v ? 'mt-[27px] text-[13.5px]' : 'mt-5 text-[13px]')}>Tipo de assistente</div>
      <div className={cn('grid grid-cols-2 gap-3', v ? 'mt-1' : 'mt-2')}>
        {(['voice', 'chat'] as const).map((t) => (
          <div key={t} className={cn('relative rounded-xl border transition-all duration-300', v ? 'min-h-[134px] px-3.5 pb-3.5 pt-[17px]' : 'p-3.5', selected === t ? 'border-slate-900 shadow-[0_0_0_1px_#0f0f16]' : 'border-slate-200')}>
            {t === 'chat' && <span className="absolute right-2.5 top-2.5 rounded-full bg-brand-blue px-1.5 py-0.5 text-[9px] font-semibold uppercase text-white">Novo</span>}
            <div className="flex items-center gap-2">
              <span className={cn('flex h-7 w-7 items-center justify-center rounded-lg', t === 'voice' ? 'bg-sky-50 text-sky-600' : 'bg-violet-50 text-violet-600')}>
                {t === 'voice' ? <Phone className="h-3.5 w-3.5" /> : <MessageSquare className="h-3.5 w-3.5" />}
              </span>
              <span className={cn('font-semibold text-slate-900', v ? 'text-[14.5px]' : 'text-[13px]')}>{t === 'voice' ? 'Assistente de voz' : 'Assistente de chat'}</span>
            </div>
            <p className={cn('text-slate-500', v ? 'mt-3 text-[12.5px] leading-[19px]' : 'mt-2 text-[11.5px] leading-4')}>{t === 'voice' ? 'Assistente baseado em telefone para chamadas.' : 'Assistente baseado em chat para:'}</p>
            {t === 'chat' && (
              <div className="mt-2 flex gap-1.5">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-50"><WhatsAppIcon className="h-3.5 w-3.5 text-emerald-600" /></span>
                {chatChannels === 'both' && <span className="flex h-6 w-6 items-center justify-center rounded-full bg-violet-50"><Globe className="h-3.5 w-3.5 text-violet-600" /></span>}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className={cn('font-medium text-slate-700', v ? 'mt-[22px] text-[13.5px]' : 'mt-4 text-[13px]')}>Nome</div>
      <div className={cn('flex items-center rounded-lg border border-slate-300 px-3 text-slate-900', v ? 'mt-2.5 h-[39px] text-[14px]' : 'mt-1.5 h-9 text-[13px]')}>
        {typed}
        <span className="ks-caret ml-px inline-block h-4 w-px bg-slate-900" />
      </div>
      <div className={cn('flex justify-end gap-2', v ? 'mt-6' : 'mt-5')}>
        <span className={cn('rounded-lg bg-slate-100 font-medium text-slate-700', v ? 'flex h-[39px] items-center px-3.5 text-[13.5px]' : 'px-3 py-2 text-[12px]')}>Cancelar</span>
        <span className={cn('rounded-lg bg-slate-900 font-medium text-white transition-transform', v ? 'flex h-[39px] items-center px-3.5 text-[13.5px]' : 'px-3 py-2 text-[12px]', pressing && 'scale-95 bg-slate-700')}>Criar assistente</span>
      </div>
    </div>
  )
}

/** Tabela "Assistentes" (nome / tipo / conexão). */
export function AssistantsTableMock({ rows, className, title = 'Assistentes' }: { rows?: { name: string; type: string; conn: string }[]; className?: string; title?: string }) {
  const data = rows ?? [
    { name: 'Roberta', type: 'Voz', conn: '+55 11 90000-0101' },
    { name: 'Marina', type: 'WhatsApp', conn: '+55 11 90000-0102' },
    { name: 'Sofia', type: 'Webchat', conn: 'clinicabemviver.com.br' },
    { name: 'Helena', type: 'Voz', conn: '+55 11 90000-0103' },
  ]
  return (
    <div className={cn('bg-white p-4 font-sans', className)}>
      <div className="text-[15px] font-semibold text-slate-900">{title}</div>
      <div className="mt-3 flex items-center gap-2">
        <div className="flex h-8 flex-1 items-center gap-2 rounded-md border border-slate-200 px-2 text-[11px] text-slate-400">
          <Search className="h-3.5 w-3.5" /> Buscar
        </div>
        <span className="rounded-md bg-slate-900 px-2.5 py-2 text-[11px] font-medium text-white">Criar assistente</span>
      </div>
      <div className="mt-3 overflow-hidden rounded-lg border border-slate-200 text-[11px]">
        <div className="grid grid-cols-[1.3fr_.8fr_1.4fr_20px] gap-2 border-b border-slate-100 bg-slate-50/60 px-3 py-2 text-slate-500">
          <span>Nome</span>
          <span>Tipo</span>
          <span>Conexão</span>
          <span />
        </div>
        {data.map((r) => (
          <div key={r.name} className="grid grid-cols-[1.3fr_.8fr_1.4fr_20px] items-center gap-2 border-b border-slate-100 px-3 py-2.5 last:border-b-0">
            <span className="flex items-center gap-2 text-slate-900">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-[9px] font-semibold">{r.name[0]}</span>
              {r.name}
            </span>
            <span className="text-slate-600">{r.type}</span>
            <span className="truncate text-slate-600">{r.conn}</span>
            <MoreHorizontal className="h-3.5 w-3.5 text-slate-400" />
          </div>
        ))}
      </div>
    </div>
  )
}

/** Tela de ligação em um celular (status, duração, nome, controles). */
export function PhoneCallMock({ seconds = 16, name = 'Assistente IA', className, live = true }: { seconds?: number; name?: string; className?: string; live?: boolean }) {
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
  const ss = String(seconds % 60).padStart(2, '0')
  return (
    <div className={cn('relative h-full w-[210px] overflow-hidden rounded-[30px] border-[5px] border-slate-900 bg-[linear-gradient(180deg,#6b6b78_0%,#55555f_45%,#3d3d47_100%)] font-sans text-white shadow-xl', className)}>
      <div className="flex items-center justify-between px-4 pt-2.5 text-[9px]">
        <span>14:18</span>
        <span className="h-3.5 w-14 rounded-full bg-black" />
        <span>●●● 5G</span>
      </div>
      <div className="mt-8 text-center">
        <div className="text-[10px] text-white/70">{live ? `${mm}:${ss}` : 'chamando…'}</div>
        <div className="mt-0.5 text-[16px] font-medium">{name}</div>
      </div>
      <div className="absolute inset-x-0 bottom-6 flex justify-center gap-4">
        {[Volume2, Video, MicOff].map((I, i) => (
          <span key={i} className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 backdrop-blur">
            <I className="h-4 w-4" />
          </span>
        ))}
      </div>
    </div>
  )
}

/**
 * Painel "Instalação" do widget de webchat (código de incorporação com atributos data-kloel-*).
 * Compacto como o modal da referência 3. Webchat/04.png (≈280px de altura): as ações do rodapé ficam sempre visíveis.
 */
export function InstallCodeMock({ copied, className }: { copied?: boolean; className?: string }) {
  return (
    <div className={cn('bg-white px-4 py-3 font-sans text-[10px] leading-[14px]', className)}>
      <div className="text-[12px] font-semibold leading-4 text-slate-900">Instalação</div>
      <p className="mt-1 truncate text-slate-500">Escolha como o widget deve aparecer e adicione o código gerado ao seu site.</p>
      <div className="mt-2.5 font-medium text-slate-800">Modo de exibição</div>
      <div className="mt-1 inline-flex rounded-md border border-slate-200 bg-slate-50 p-0.5">
        <span className="rounded bg-white px-2 py-1 font-medium shadow-sm">Flutuante</span>
        <span className="px-2 py-1 text-slate-500">Incorporado</span>
      </div>
      <p className="mt-1 truncate text-slate-500">Exibe um botão de abertura e abre o widget sobre o conteúdo da página.</p>
      <div className="mt-2.5 flex items-center justify-between font-medium text-slate-800">
        Código de incorporação
        <span className={cn('flex items-center gap-1 rounded px-1.5 py-0.5', copied ? 'bg-emerald-50 text-emerald-700' : 'text-slate-400')}>
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} {copied ? 'Copiado' : ''}
        </span>
      </div>
      <pre className="mt-1 overflow-hidden rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-[9px] leading-[12px] text-slate-700">
{`<script
  src="https://www.kloel.ai/widget/kloel.js"
  data-kloel-tenant="sua-empresa"
  data-kloel-channel="seu-canal"
  async
></script>`}
      </pre>
      <div className="-mx-4 mt-2.5 flex items-center justify-between border-t border-slate-100 px-4 pt-2">
        <span className="flex items-center gap-1 text-red-600"><Trash2 className="h-3 w-3" /> Remover widget</span>
        <span className="flex gap-1.5">
          <span className="rounded-md border border-slate-200 px-2 py-1">Cancelar</span>
          <span className="rounded-md bg-slate-200 px-2 py-1 text-slate-500">Salvar</span>
        </span>
      </div>
    </div>
  )
}

/** Barra flutuante escura de teste (ex.: "Ativar WhatsApp | Testar chat"). */
export function FloatingTestBar({ items, primary, className }: { items: string[]; primary: string; className?: string }) {
  return (
    <div className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-xl bg-slate-900 p-1 pl-3 font-sans text-[11px] text-white shadow-lg', className)}>
      {items.map((i) => (
        <span key={i} className="px-1.5 text-white/80">{i}</span>
      ))}
      <span className="flex items-center gap-1 rounded-lg bg-brand-blue px-2.5 py-1.5 font-medium">
        <Headphones className="h-3 w-3" /> {primary}
      </span>
    </div>
  )
}

/** Base de conhecimento: importação por URL com progresso e entradas. */
export function KnowledgeMock({ url = 'clinicabemviver.com.br', progress = 1, entries = 4, className }: { url?: string; progress?: number; entries?: number; className?: string }) {
  const rows = ['Quais convênios vocês aceitam?', 'Qual o horário de funcionamento?', 'Como remarcar uma consulta?', 'Onde fica a clínica?', 'Vocês fazem exames no local?']
  return (
    <div className={cn('bg-white p-4 font-sans text-[11px]', className)}>
      <div className="text-[13px] font-semibold text-slate-900">Base de conhecimento</div>
      <div className="mt-3 flex gap-2">
        <div className="flex h-8 flex-1 items-center gap-2 rounded-md border border-slate-200 px-2 text-slate-700">
          <Globe className="h-3.5 w-3.5 text-slate-400" /> {url}
        </div>
        <span className="flex items-center gap-1 rounded-md bg-slate-900 px-2.5 text-white">
          {progress < 1 ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} {progress < 1 ? 'Lendo…' : 'Importado'}
        </span>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full bg-brand-blue transition-[width] duration-500" style={{ width: `${Math.round(progress * 100)}%` }} />
      </div>
      <div className="mt-3 flex flex-col gap-1.5">
        {rows.slice(0, entries).map((q) => (
          <div key={q} className="ks-fade-up flex items-center gap-2 rounded-md border border-slate-100 px-2.5 py-2">
            <FileText className="h-3.5 w-3.5 text-slate-400" />
            <span className="flex-1 truncate text-slate-800">{q}</span>
            <span className="rounded bg-sky-50 px-1.5 text-[9px] text-sky-700">site</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Histórico de ligações com resumo e resultado. */
export function CallsHistoryMock({ selected = 0, className }: { selected?: number; className?: string }) {
  const calls = [
    { when: 'Hoje, 09:42', who: '+55 11 90000-0123', summary: 'Paciente agendou consulta de retorno para quinta às 14h.', chip: 'Agendamento', color: 'bg-emerald-50 text-emerald-700' },
    { when: 'Hoje, 09:15', who: '+55 11 90000-0456', summary: 'Dúvida sobre convênios aceitos — respondida.', chip: 'Resolvido', color: 'bg-sky-50 text-sky-700' },
    { when: 'Ontem, 18:03', who: '+55 11 90000-0789', summary: 'Pedido de orçamento transferido para a recepção.', chip: 'Transferido', color: 'bg-amber-50 text-amber-700' },
  ]
  return (
    <div className={cn('grid grid-cols-[1fr_1.1fr] bg-white font-sans text-[11px]', className)}>
      <div className="border-r border-slate-100 p-3">
        <div className="mb-2 text-[13px] font-semibold text-slate-900">Conversas</div>
        {calls.map((c, i) => (
          <div key={c.when} className={cn('mb-1.5 rounded-lg border p-2 transition-colors', i === selected ? 'border-brand-blue/40 bg-indigo-50/50' : 'border-slate-100')}>
            <div className="flex items-center justify-between text-slate-500">
              <span>{c.when}</span>
              <span className={cn('rounded px-1.5 py-0.5 text-[9px] font-medium', c.color)}>{c.chip}</span>
            </div>
            <div className="mt-1 line-clamp-2 text-slate-800">{c.summary}</div>
          </div>
        ))}
      </div>
      <div className="p-3">
        <div className="text-[12px] font-semibold text-slate-900">{calls[selected]!.who}</div>
        <div className="text-slate-500">Ligação de entrada · 54 s</div>
        <div className="mt-2 flex gap-2 border-b border-slate-100 pb-1.5 text-slate-500">
          <span className="border-b-2 border-slate-900 pb-1 font-medium text-slate-900">Transcrição</span>
          <span>Resumo</span>
          <span>Extração</span>
        </div>
        <div className="mt-2 flex flex-col gap-1.5">
          <div className="max-w-[90%] rounded-lg bg-slate-100 px-2 py-1.5">Olá, aqui é a Roberta da Clínica Bem Viver. Como posso ajudar?</div>
          <div className="ml-auto max-w-[90%] rounded-lg bg-brand-blue px-2 py-1.5 text-white">Queria marcar um retorno com a Dra. Ana.</div>
          <div className="max-w-[90%] rounded-lg bg-slate-100 px-2 py-1.5">Claro! Tenho quinta às 14h. Posso confirmar?</div>
        </div>
      </div>
    </div>
  )
}

/** Cabeçalho "Editar assistente" com abas Comportamento/Técnico. */
export function EditAssistantHeader({ name = 'Roberta', className }: { name?: string; className?: string }) {
  return (
    <div className={cn('font-sans', className)}>
      <div className="flex items-center gap-2 text-[14px] font-semibold text-slate-900">
        <ArrowLeft className="h-4 w-4" /> Editar assistente
        <span className="ml-auto"><Settings2 className="h-4 w-4 text-slate-400" /></span>
      </div>
      <div className="ml-6 text-[11px] text-slate-500">{name}</div>
      <div className="mt-3 flex gap-4 border-b border-slate-100 text-[12px]">
        <span className="border-b-2 border-slate-900 pb-1.5 font-medium text-slate-900">Comportamento</span>
        <span className="pb-1.5 text-slate-500">Técnico</span>
      </div>
    </div>
  )
}

