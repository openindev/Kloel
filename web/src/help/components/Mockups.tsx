import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  BookUser, PhoneForwarded, Mail, MessageSquare, Calendar, Globe, Plug, Webhook, Check, Plus, ChevronDown, Search, Upload, Phone, PhoneOff, Mic, FileText,
  Copy, Clock, Send, Hash, KeyRound, Users, CircleDot, Sparkles, Settings2, Ellipsis, X, Play,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Monogram } from '@/components/brand/KloelLogo'
import { IntegrationLogo } from '@/components/brand/IntegrationLogo'
import { WhatsAppIcon } from '@/components/brand/icons'
import { copyText } from '../lib/ui'

/**
 * Mini interfaces ilustrativas (NÃO são screenshots): reproduzem, em escala reduzida, telas desta casca
 * com os dados fictícios da organização de demonstração "Clínica Bem Viver".
 */

type Attrs = Record<string, string>

export function Mockup({ kind, attrs }: { kind: string; attrs: Attrs }) {
  const render = RENDERERS[kind]
  const interactive = kind === 'call-forwarding' || kind === 'prompt-builder'
  return (
    <figure className="my-7" data-mockup={kind}>
      <div className="rounded-2xl border border-zinc-200 bg-zinc-50/70 p-2 sm:p-3">
        <div
          className="relative overflow-hidden rounded-xl border border-zinc-200 bg-white text-[12px] leading-5 text-zinc-800 shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
          {...(interactive ? {} : { role: 'img', 'aria-label': `Ilustração: ${attrs.caption ?? kind}` })}
        >
          {render ? render(attrs) : <Fallback kind={kind} />}
        </div>
      </div>
      <figcaption className="mt-2 flex items-center justify-center gap-2 px-2 text-center text-[13px] text-zinc-500">
        {attrs.caption ?? 'Ilustração da interface da Kloel'}
      </figcaption>
    </figure>
  )
}

function Fallback({ kind }: { kind: string }) {
  return <div className="p-6 text-center text-zinc-400">Ilustração “{kind}”</div>
}

/* ----------------------------- peças comuns ----------------------------- */

function Bar({ path, right }: { path: string[]; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-zinc-100 bg-zinc-50/60 px-3 py-2">
      <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-zinc-500">
        <span className="flex size-4 items-center justify-center rounded bg-brand text-[9px] font-bold text-white">K</span>
        {path.map((p, i) => (
          <span key={i} className={cn('truncate', i === path.length - 1 && 'font-medium text-zinc-800')}>
            {i > 0 && <span className="mr-1.5 text-zinc-300">/</span>}
            {p}
          </span>
        ))}
      </div>
      {right}
    </div>
  )
}

function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex min-h-10 items-center justify-between gap-3 px-3 py-1.5', className)}>
      <span className="shrink-0 font-medium text-zinc-700">{label}</span>
      <div className="flex min-w-0 items-center justify-end">{children}</div>
    </div>
  )
}

function Pill({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('inline-flex h-6 min-w-0 items-center gap-1 truncate rounded-md border border-zinc-200 bg-white px-2 text-[11px] text-zinc-800', className)}>{children}</span>
}

function Toggle({ on = true }: { on?: boolean }) {
  return (
    <span className={cn('inline-flex h-[14px] w-[26px] shrink-0 items-center rounded-full p-[2px]', on ? 'bg-brand' : 'bg-zinc-200')}>
      <span className={cn('size-[10px] rounded-full bg-white shadow-sm transition-transform', on && 'translate-x-[12px]')} />
    </span>
  )
}

function Btn({ children, dark, className }: { children: ReactNode; dark?: boolean; className?: string }) {
  return (
    <span className={cn('inline-flex h-6 items-center gap-1 rounded-md px-2 text-[11px] font-medium', dark ? 'bg-zinc-900 text-white' : 'border border-zinc-200 bg-white text-zinc-800', className)}>
      {children}
    </span>
  )
}

function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('rounded-lg border border-zinc-200 bg-white', className)}>{children}</div>
}

function Label({ children }: { children: ReactNode }) {
  return <p className="mb-1.5 px-1 text-[10px] font-medium uppercase tracking-wide text-zinc-400">{children}</p>
}

function Chip({ children, tone = 'zinc' }: { children: ReactNode; tone?: 'zinc' | 'green' | 'amber' | 'brand' | 'red' | 'sky' }) {
  const tones = {
    zinc: 'bg-zinc-100 text-zinc-700',
    green: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    brand: 'bg-brand/10 text-brand',
    red: 'bg-red-50 text-red-700',
    sky: 'bg-sky-50 text-sky-700',
  }
  return <span className={cn('inline-flex items-center gap-1 rounded px-1.5 py-px text-[10px] font-medium', tones[tone])}>{children}</span>
}

/* ------------------------------- telas ------------------------------- */

const RESOURCE_CARDS = [
  { k: 'contacts', label: 'Conectar contatos', icon: BookUser, active: true },
  { k: 'transfer', label: 'Transferir ligações', icon: PhoneForwarded, active: true },
  { k: 'email', label: 'Enviar e-mail', icon: Mail, active: true },
  { k: 'whatsapp', label: 'Enviar WhatsApp', icon: WhatsAppIcon, active: false },
  { k: 'scheduling', label: 'Agendar compromissos', icon: Calendar, active: true },
  { k: 'websearch', label: 'Pesquisa na web', icon: Globe, active: false },
  { k: 'integrations', label: 'Integrações', icon: Plug, active: false },
  { k: 'webhooks', label: 'Webhooks', icon: Webhook, active: false },
  // 9º cartão do app (RESOURCE_DEFS: "Enviar SMS", central de ajuda SM-01) — grade 3×3 como nas capturas da central.
  { k: 'sms', label: 'Enviar SMS', icon: MessageSquare, active: false },
]

function AgentTabs({ active }: { active: string }) {
  return (
    <div className="no-scrollbar flex gap-1 overflow-x-auto border-b border-zinc-100 px-3 pt-2">
      {['Geral', 'Regras', 'Conhecimento', 'Prompt personalizado', 'Técnico'].map((t) => (
        <span key={t} className={cn('shrink-0 rounded-t-md px-2 pb-1.5 pt-1 text-[11px]', t === active ? 'border-b-2 border-zinc-900 font-medium text-zinc-900' : 'text-zinc-500')}>
          {t}
        </span>
      ))}
    </div>
  )
}

const RENDERERS: Record<string, (a: Attrs) => ReactNode> = {
  overview: () => {
    const bars = [12, 18, 9, 22, 30, 26, 14, 19, 28, 34, 25, 17]
    return (
      <>
        <Bar path={['Visão geral']} right={<Pill>Últimos 30 dias <ChevronDown className="size-3" /></Pill>} />
        <div className="grid grid-cols-3 gap-2 p-3">
          {[
            ['Chamadas', '128'],
            ['Minutos', '412'],
            ['Resolvidas pela IA', '86%'],
          ].map(([l, v]) => (
            <Card key={l} className="p-2.5">
              <p className="text-[10px] text-zinc-500">{l}</p>
              <p className="mt-0.5 text-base font-semibold tracking-tight">{v}</p>
            </Card>
          ))}
        </div>
        <div className="mx-3 mb-3 flex h-24 items-end gap-1.5 rounded-lg border border-zinc-200 px-3 pb-2 pt-3">
          {bars.map((h, i) => (
            <span key={i} className="flex-1 rounded-sm bg-brand/70" style={{ height: `${(h / 34) * 100}%` }} />
          ))}
        </div>
      </>
    )
  },

  'agent-general': () => (
    <>
      <Bar path={['Assistentes', 'Roberta', 'Geral']} right={<Btn dark><Phone className="size-3" /> Ligação de teste</Btn>} />
      <AgentTabs active="Geral" />
      <div className="space-y-3 p-3">
        <div>
          <Label>Básico</Label>
          <Card className="divide-y divide-zinc-100">
            <Field label="Nome"><Pill className="w-32">Roberta</Pill></Field>
            <Field label="Voz"><Pill><span className="flex size-3.5 items-center justify-center rounded-full bg-teal-600 text-[8px] text-white">C</span>Camila<ChevronDown className="size-3" /></Pill></Field>
            <Field label="Idioma"><Pill>Português (Brasil)<ChevronDown className="size-3" /></Pill></Field>
          </Card>
        </div>
        <Card className="p-3">
          <p className="font-medium">Mensagens iniciais</p>
          <p className="mt-1.5 rounded-md bg-zinc-50 px-2 py-1.5 text-zinc-600">Olá, aqui é a Roberta, da Clínica Bem Viver. Como posso ajudar?</p>
          <div className="mt-2 flex items-center justify-between text-[11px]">
            <span className="font-medium">Personalizar</span>
            <Toggle on={false} />
          </div>
        </Card>
      </div>
    </>
  ),

  'agent-resources': (a) => (
    <>
      <Bar path={['Assistentes', 'Roberta', 'Geral']} />
      <div className="p-3">
        <Label>Recursos</Label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {RESOURCE_CARDS.map((r) => {
            const hl = a.highlight === r.k
            const Icon = r.icon
            return (
              <div key={r.k} className={cn('flex flex-col gap-3 rounded-lg border bg-white p-2.5', r.active ? 'border-zinc-200' : 'border-dashed border-zinc-300', hl && 'border-solid border-brand ring-2 ring-brand/25')}>
                <span className="flex items-center justify-between">
                  <Icon className={cn('size-3.5', r.k === 'contacts' ? 'text-rose-500' : r.active ? 'text-zinc-800' : 'text-zinc-400')} />
                  {r.active ? (
                    <span className="flex size-3.5 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600"><Check className="size-2.5" /></span>
                  ) : (
                    <span className="flex size-3.5 items-center justify-center rounded-full border border-dashed border-zinc-400 text-zinc-400"><Plus className="size-2.5" /></span>
                  )}
                </span>
                <span className={cn('truncate text-[11px]', r.active || hl ? 'font-semibold text-zinc-900' : 'text-zinc-500')}>{r.label}</span>
              </div>
            )
          })}
        </div>
      </div>
    </>
  ),

  'agent-rules': () => (
    <>
      <Bar path={['Assistentes', 'Roberta', 'Regras']} right={<Btn><Plus className="size-3" /> Nova regra</Btn>} />
      <AgentTabs active="Regras" />
      <div className="space-y-3 p-3">
        <div>
          <Label>Regras do sistema</Label>
          <Card className="divide-y divide-zinc-100">
            {['Confirmar nome e telefone antes de encerrar', 'Não informar valores que não estejam na base', 'Encerrar educadamente após 2 silêncios'].map((r, i) => (
              <Field key={r} label={r}><Toggle on={i !== 2} /></Field>
            ))}
          </Card>
        </div>
        <div>
          <Label>Regras próprias</Label>
          <Card className="p-2.5">
            <p><span className="font-semibold">Se</span> a pessoa pedir orçamento de implante, <span className="font-semibold">então</span> ofereça agendar uma avaliação.</p>
          </Card>
        </div>
        <Card className="flex items-center justify-between p-2.5">
          <span className="font-medium">Pronúncia</span>
          <span className="font-mono text-[11px] text-zinc-600">Kloel → /ˈklɔ.ew/</span>
        </Card>
      </div>
    </>
  ),

  'agent-knowledge': () => (
    <>
      <Bar path={['Assistentes', 'Roberta', 'Conhecimento']} right={<Btn><Plus className="size-3" /> Adicionar fonte</Btn>} />
      <AgentTabs active="Conhecimento" />
      <div className="space-y-3 p-3">
        <div>
          <Label>Fontes</Label>
          <Card className="divide-y divide-zinc-100">
            <div className="flex items-center gap-2 px-3 py-2"><Globe className="size-3.5 text-zinc-400" /><span className="font-medium">bemviver.example</span><span className="ml-auto text-[10px] text-zinc-400">Atualizado há 1 hora</span><Chip>5 páginas</Chip></div>
            <div className="flex items-center gap-2 px-3 py-2"><FileText className="size-3.5 text-zinc-400" /><span className="font-medium">tabela-de-servicos.pdf</span><Chip tone="green">Processado</Chip></div>
          </Card>
        </div>
        <div>
          <Label>Informações</Label>
          <Card className="divide-y divide-zinc-100">
            {[
              ['Vocês atendem convênio?', 'Sim, aceitamos os principais convênios odontológicos.'],
              ['Onde fica a clínica?', 'Rua das Flores, 100 — Centro.'],
            ].map(([q, r]) => (
              <div key={q} className="px-3 py-2"><p className="font-medium">{q}</p><p className="text-zinc-500">{r}</p></div>
            ))}
          </Card>
        </div>
        <Card className="flex items-center gap-2 p-2.5"><Clock className="size-3.5 text-zinc-400" /><span className="font-medium">Horário de funcionamento</span><span className="ml-auto text-zinc-600">Seg–Sex · 08:00–18:00</span></Card>
      </div>
    </>
  ),

  'agent-prompt': () => (
    <>
      <Bar path={['Assistentes', 'Roberta', 'Prompt personalizado']} right={<Btn><Sparkles className="size-3 text-brand" /> Gerar com IA</Btn>} />
      <AgentTabs active="Prompt personalizado" />
      <div className="p-3">
        <Card className="p-3 font-mono text-[11px] leading-5 text-zinc-700">
          <p className="font-sans text-[11px] font-semibold text-zinc-900"># Papel</p>
          <p>Você é a Roberta, recepcionista da Clínica Bem Viver.</p>
          <p className="mt-1.5 font-sans text-[11px] font-semibold text-zinc-900"># Objetivo</p>
          <p>Tirar dúvidas e agendar avaliações. Use o agendador quando a pessoa quiser marcar horário.</p>
          <p className="mt-1.5 font-sans text-[11px] font-semibold text-zinc-900"># Estilo</p>
          <p>Frases curtas, tom acolhedor, uma pergunta por vez.</p>
        </Card>
        <p className="mt-1.5 text-right text-[10px] text-zinc-400">312 / 8.000 caracteres</p>
      </div>
    </>
  ),

  'agent-technical': () => (
    <>
      <Bar path={['Assistentes', 'Roberta', 'Técnico']} />
      <AgentTabs active="Técnico" />
      <div className="space-y-3 p-3">
        <Card className="divide-y divide-zinc-100">
          <Field label="Duração máxima da ligação"><Pill>10 minutos<ChevronDown className="size-3" /></Pill></Field>
          <Field label="Gravar áudio"><Toggle /></Field>
          <Field label="Redução de ruído de fundo"><Toggle /></Field>
          <Field label="Processamento preciso"><Toggle on={false} /></Field>
        </Card>
        <Card className="space-y-3 p-3">
          {[
            ['Criatividade', 35],
            ['Velocidade da fala', 55],
            ['Espera antes de responder', 40],
          ].map(([l, v]) => (
            <div key={l as string}>
              <div className="mb-1 flex justify-between"><span className="font-medium">{l}</span><span className="text-zinc-400">{v}%</span></div>
              <div className="h-1.5 rounded-full bg-zinc-100"><div className="relative h-full rounded-full bg-zinc-900" style={{ width: `${v}%` }}><span className="absolute -right-1.5 -top-1 size-3.5 rounded-full border border-zinc-300 bg-white shadow" /></div></div>
            </div>
          ))}
        </Card>
      </div>
    </>
  ),

  'resource-sheet': (a) => {
    const fields = (a.fields ?? 'Execução=Depois da conversa|Quando=Sempre|Para=Quem ligou').split('|').map((f) => {
      const [l, ...v] = f.split('=')
      return [l!.trim(), v.join('=').trim()] as const
    })
    return (
      <div className="flex min-h-[220px]">
        <div className="hidden flex-1 bg-zinc-100/70 p-3 sm:block">
          <div className="space-y-2 opacity-60">
            <div className="h-3 w-24 rounded bg-zinc-200" />
            <div className="grid grid-cols-2 gap-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-12 rounded-lg border border-zinc-200 bg-white" />)}</div>
          </div>
        </div>
        <div className="w-full border-l border-zinc-200 bg-white sm:w-[62%]">
          <div className="flex items-center justify-between border-b border-zinc-100 px-3 py-2.5">
            <span className="text-[13px] font-semibold">{a.title ?? 'Recurso'}</span>
            <X className="size-3.5 text-zinc-400" />
          </div>
          <div className="divide-y divide-zinc-100">
            {fields.map(([l, v]) => (
              <Field key={l} label={l}><Pill className="max-w-[170px]">{v}<ChevronDown className="size-3 shrink-0" /></Pill></Field>
            ))}
          </div>
          <div className="flex justify-end gap-1.5 border-t border-zinc-100 px-3 py-2"><Btn>Cancelar</Btn><Btn dark>Salvar</Btn></div>
        </div>
      </div>
    )
  },

  'phone-numbers': () => (
    <>
      <Bar path={['Números de telefone']} right={<Btn dark><Plus className="size-3" /> Adicionar número</Btn>} />
      <div className="overflow-x-auto p-3">
        <table className="w-full min-w-[380px] text-left text-[11px]">
          <thead className="text-zinc-400"><tr><th className="pb-1.5 font-medium">Nome</th><th className="pb-1.5 font-medium">Número</th><th className="pb-1.5 font-medium">Tipo</th><th className="pb-1.5 font-medium">Assistente</th></tr></thead>
          <tbody className="divide-y divide-zinc-100">
            {[
              ['Recepção SP', '+55 11 90000-0200', 'Comprado', 'Roberta'],
              ['PABX da clínica', 'sip-bemviver-01', 'SIP', 'Joana'],
              ['Linha comercial', '+55 11 90000-0310', 'Importado', '—'],
            ].map((r) => (
              <tr key={r[0]}><td className="py-2 font-medium">{r[0]}</td><td className="py-2 font-mono">{r[1]}</td><td className="py-2"><Chip>{r[2]}</Chip></td><td className="py-2">{r[3] === '—' ? <Btn>Atribuir</Btn> : <Pill>{r[3]}<ChevronDown className="size-3" /></Pill>}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  ),

  'call-forwarding': (a) => <CallForwarding initial={a.number} />,

  'test-call': () => (
    <div className="mx-auto max-w-sm p-4">
      <div className="flex items-center gap-2"><span className="flex size-8 items-center justify-center rounded-full bg-brand/10 text-brand"><Phone className="size-4" /></span><div><p className="font-semibold">Ligação de teste · Roberta</p><p className="text-[11px] text-emerald-600">Em andamento · 00:42</p></div></div>
      <div className="mt-3 space-y-2">
        <p className="w-fit max-w-[85%] rounded-lg rounded-tl-sm bg-zinc-100 px-2.5 py-1.5">Olá, aqui é a Roberta, da Clínica Bem Viver. Como posso ajudar?</p>
        <p className="ml-auto w-fit max-w-[85%] rounded-lg rounded-tr-sm bg-brand px-2.5 py-1.5 text-white">Queria marcar uma avaliação para quinta.</p>
        <p className="w-fit max-w-[85%] rounded-lg rounded-tl-sm bg-zinc-100 px-2.5 py-1.5">Claro! Tenho 9h ou 14h30. Qual prefere?</p>
      </div>
      <div className="mt-4 flex justify-center gap-3"><span className="flex size-8 items-center justify-center rounded-full border border-zinc-200"><Mic className="size-3.5" /></span><span className="flex size-8 items-center justify-center rounded-full bg-red-500 text-white"><PhoneOff className="size-3.5" /></span></div>
    </div>
  ),

  inbox: () => (
    <>
      <Bar path={['Conversas']} />
      <div className="flex min-h-[210px]">
        <div className="w-[42%] shrink-0 divide-y divide-zinc-100 border-r border-zinc-100">
          {[
            ['Mariana Alves', 'Agendou avaliação', 'green', '09:12'],
            ['+55 11 90000-0147', 'Pediu retorno', 'amber', '08:40'],
            ['Carlos Souza', 'Dúvida respondida', 'sky', 'ontem'],
          ].map(([n, r, t, h], i) => (
            <div key={n} className={cn('px-2.5 py-2', i === 0 && 'bg-zinc-50')}>
              <div className="flex justify-between gap-1"><span className="truncate font-medium">{n}</span><span className="shrink-0 text-[10px] text-zinc-400">{h}</span></div>
              <Chip tone={t as 'green'}>{r}</Chip>
            </div>
          ))}
        </div>
        <div className="min-w-0 flex-1 p-3">
          <p className="text-[13px] font-semibold">Agendamento de avaliação</p>
          <div className="mt-2 rounded-md bg-brand/5 p-2 text-zinc-600"><span className="font-medium text-zinc-800">Resumo: </span>Mariana quer avaliação na quinta às 9h. Horário confirmado e e-mail enviado à recepção.</div>
          <div className="mt-2 flex items-center gap-2 rounded-md border border-zinc-200 px-2 py-1.5"><Play className="size-3" /><div className="h-1 flex-1 rounded-full bg-zinc-200"><div className="h-1 w-1/3 rounded-full bg-zinc-800" /></div><span className="text-[10px] text-zinc-400">02:13</span></div>
        </div>
      </div>
    </>
  ),

  contacts: () => (
    <>
      <Bar path={['Contatos']} right={<span className="flex gap-1.5"><Btn><Upload className="size-3" /> Importar CSV</Btn><Btn dark><Plus className="size-3" /> Novo contato</Btn></span>} />
      <div className="p-3">
        <div className="mb-2 flex h-7 items-center gap-1.5 rounded-md border border-zinc-200 px-2 text-zinc-400"><Search className="size-3" /> Buscar contatos…</div>
        <table className="w-full text-left text-[11px]">
          <thead className="text-zinc-400"><tr><th className="pb-1.5 font-medium">Nome</th><th className="pb-1.5 font-medium">Telefone</th><th className="hidden pb-1.5 font-medium sm:table-cell">E-mail</th><th className="pb-1.5 font-medium">Etiqueta</th></tr></thead>
          <tbody className="divide-y divide-zinc-100">
            {[
              ['Mariana Alves', '+55 11 90000-0101', 'mariana@exemplo.com.br', 'Paciente'],
              ['Carlos Souza', '+55 11 90000-0102', 'carlos@exemplo.com.br', 'VIP'],
              ['Ana Lima', '+55 11 90000-0103', 'ana@exemplo.com.br', 'Novo'],
            ].map((r) => (
              <tr key={r[0]}><td className="py-1.5 font-medium">{r[0]}</td><td className="py-1.5 font-mono">{r[1]}</td><td className="hidden py-1.5 text-zinc-500 sm:table-cell">{r[2]}</td><td className="py-1.5"><Chip tone="brand">{r[3]}</Chip></td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  ),

  scheduling: () => (
    <>
      <Bar path={['Agendador', 'Avaliação odontológica']} right={<Btn><Copy className="size-3" /> Copiar link</Btn>} />
      <div className="grid gap-3 p-3 sm:grid-cols-2">
        <Card className="p-3">
          <p className="text-[13px] font-semibold">Avaliação odontológica</p>
          <p className="text-zinc-500">30 min · Presencial</p>
          <p className="mt-2 font-mono text-[10px] text-brand">/c/clinica-bem-viver/avaliacao</p>
          <div className="mt-2 flex gap-1"><Chip tone="green">Google Agenda conectado</Chip></div>
        </Card>
        <Card className="divide-y divide-zinc-100">
          {['Seg', 'Ter', 'Qua', 'Qui', 'Sex'].map((d) => (
            <div key={d} className="flex items-center justify-between px-3 py-1"><span className="font-medium">{d}</span><span className="text-zinc-500">08:00 – 12:00 · 13:00 – 18:00</span></div>
          ))}
        </Card>
      </div>
    </>
  ),

  whatsapp: () => (
    <>
      <Bar path={['WhatsApp']} />
      <div className="grid gap-3 p-3 sm:grid-cols-2">
        <Card className="p-3">
          <div className="flex items-center gap-2"><span className="flex size-7 items-center justify-center rounded-full bg-emerald-500 text-white"><WhatsAppIcon className="size-4" /></span><div><p className="font-semibold">Clínica Bem Viver</p><p className="font-mono text-[10px] text-zinc-500">+55 11 90000-0300</p></div></div>
          <div className="mt-2 flex flex-wrap gap-1"><Chip tone="green">Conectado</Chip><Chip>Assistente: Joana</Chip></div>
        </Card>
        <div className="rounded-lg bg-[#efe7dd] p-2.5">
          <p className="ml-auto w-fit max-w-[85%] rounded-md bg-[#d9fdd3] px-2 py-1">Vocês abrem sábado?</p>
          <p className="mt-1.5 w-fit max-w-[85%] rounded-md bg-white px-2 py-1">Abrimos aos sábados das 8h às 12h. Quer agendar um horário?</p>
        </div>
      </div>
    </>
  ),

  webchat: () => (
    <div className="relative min-h-[240px] bg-gradient-to-b from-zinc-50 to-white">
      <div className="flex items-center gap-2 border-b border-zinc-100 bg-white px-3 py-2"><span className="size-2 rounded-full bg-zinc-300" /><span className="text-[11px] text-zinc-500">bemviver.example</span></div>
      <div className="space-y-2 p-4 pr-[52%] opacity-60"><div className="h-4 w-3/4 rounded bg-zinc-200" /><div className="h-2.5 w-full rounded bg-zinc-100" /><div className="h-2.5 w-5/6 rounded bg-zinc-100" /><div className="h-16 w-full rounded-lg bg-zinc-100" /></div>
      <div className="absolute bottom-3 right-3 w-[46%] min-w-[170px] overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-lg">
        <div className="flex items-center gap-2 bg-brand px-2.5 py-2 text-white"><span className="flex size-5 items-center justify-center rounded-full bg-white/20 text-[10px] font-semibold">J</span><span className="font-medium">Joana · Bem Viver</span></div>
        <div className="space-y-1.5 p-2">
          <p className="w-fit max-w-[90%] rounded-md bg-zinc-100 px-2 py-1">Oi! Posso ajudar a marcar sua consulta?</p>
          <p className="ml-auto w-fit max-w-[90%] rounded-md bg-brand/10 px-2 py-1">Quanto custa a limpeza?</p>
        </div>
        <div className="flex items-center gap-1 border-t border-zinc-100 px-2 py-1.5 text-zinc-400">Escreva uma mensagem…<Send className="ml-auto size-3 text-brand" /></div>
      </div>
    </div>
  ),

  'email-inbox': () => (
    <>
      <Bar path={['E-Mail IA', 'recepcao@bemviver.example']} right={<Chip tone="brand">Beta</Chip>} />
      <div className="flex min-h-[200px]">
        <div className="w-[40%] shrink-0 divide-y divide-zinc-100 border-r border-zinc-100">
          {[
            ['Reagendamento', 'Mariana Alves'],
            ['Nota fiscal', 'Carlos Souza'],
            ['Dúvida sobre convênio', 'Ana Lima'],
          ].map(([s, f], i) => (
            <div key={s} className={cn('px-2.5 py-2', i === 0 && 'bg-zinc-50')}><p className="truncate font-medium">{s}</p><p className="truncate text-zinc-500">{f}</p></div>
          ))}
        </div>
        <div className="min-w-0 flex-1 p-3">
          <p className="font-semibold">Re: Reagendamento</p>
          <div className="mt-2 rounded-md border border-dashed border-brand/40 bg-brand/5 p-2"><p className="mb-1 flex items-center gap-1 text-[10px] font-medium text-brand"><Sparkles className="size-3" /> Rascunho da IA</p><p className="text-zinc-600">Olá, Mariana! Remarcamos sua avaliação para sexta às 10h. Até lá!</p></div>
          <div className="mt-2 flex justify-end gap-1.5"><Btn>Editar</Btn><Btn dark><Send className="size-3" /> Enviar</Btn></div>
        </div>
      </div>
    </>
  ),

  integrations: (a) => {
    const names = ['Google Sheets', 'Pipedrive', 'Slack', 'Zapier', 'n8n', 'Shopify', 'Notion', 'Make']
    const hl = a.highlight
    const list = hl && !names.includes(hl) ? [hl, ...names.slice(0, 7)] : names
    return (
      <>
        <Bar path={['Integrações']} right={<span className="flex h-6 items-center gap-1 rounded-md border border-zinc-200 px-2 text-[11px] text-zinc-400"><Search className="size-3" />Buscar</span>} />
        <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-4">
          {list.map((n) => (
            <Card key={n} className={cn('p-2.5', n === hl && 'border-brand ring-2 ring-brand/20')}>
              <IntegrationLogo name={n} className="size-6 text-[10px]" />
              <p className="mt-1.5 truncate font-semibold">{n}</p>
              <div className="mt-1.5">{n === hl ? <Btn dark className="h-5 text-[10px]">Conectar</Btn> : <span className="text-[10px] text-zinc-400">Disponível</span>}</div>
            </Card>
          ))}
        </div>
      </>
    )
  },

  'integration-config': (a) => {
    const name = a.name ?? 'Integração'
    const mode = a.mode ?? 'credentials'
    return (
      <div className="p-3">
        <div className="mb-3 flex items-center gap-2"><IntegrationLogo name={name} className="size-7" /><div><p className="text-[13px] font-semibold">{name}</p><p className="text-[11px] text-zinc-500">Integrações › {name}</p></div><Chip tone="green">Conexão verificada</Chip></div>
        <Card className="divide-y divide-zinc-100">
          <Field label="Nome"><Pill className="w-36">{name} · Roberta</Pill></Field>
          {mode === 'credentials' && (
            <>
              <Field label="Chave de API"><Pill className="w-36 font-mono">••••••••••3f9a</Pill></Field>
              <Field label="Endereço da conta"><Pill className="w-36">minhaempresa</Pill></Field>
            </>
          )}
          {mode === 'oauth' && (
            <Field label="Conta"><span className="flex items-center gap-1.5"><Pill>recepcao@exemplo.com.br</Pill><Btn>Conectar outra</Btn></span></Field>
          )}
          {mode === 'action' && (
            <>
              <Field label="Execução">
                <span className="flex rounded-md bg-zinc-100 p-0.5 text-[10px]">
                  {['Antes', 'Durante', 'Após'].map((x) => <span key={x} className={cn('rounded px-1.5 py-0.5', x === 'Após' && 'bg-white font-medium shadow-sm')}>{x}</span>)}
                </span>
              </Field>
              <Field label="Janela"><Pill>A qualquer momento<ChevronDown className="size-3" /></Pill></Field>
              <div className="px-3 py-2"><p className="mb-1 font-medium">Corpo (JSON)</p><pre className="rounded-md bg-zinc-950 p-2 font-mono text-[10px] leading-4 text-zinc-100">{'{\n  "telefone": "{{personNumber}}",\n  "resumo": "{{summary}}"\n}'}</pre></div>
            </>
          )}
          {mode !== 'action' && (
            <>
              <Field label="Reconhecer quem liga"><Toggle /></Field>
              <Field label="Criar e atualizar registros"><Toggle /></Field>
              <Field label="Registrar resumo após a ligação"><Toggle /></Field>
            </>
          )}
        </Card>
      </div>
    )
  },

  'http-request': () => (
    <div className="space-y-2.5 p-3">
      <div className="flex gap-1.5"><Pill className="font-semibold text-emerald-700">POST<ChevronDown className="size-3" /></Pill><Pill className="flex-1 font-mono">https://api.exemplo.com.br/webhooks/kloel</Pill></div>
      <Card className="divide-y divide-zinc-100">
        <Field label="Execução"><Pill>Após a conversa<ChevronDown className="size-3" /></Pill></Field>
        <Field label="Cabeçalho"><Pill className="font-mono">Authorization: Bearer ••••</Pill></Field>
      </Card>
      <pre className="overflow-x-auto rounded-lg bg-zinc-950 p-2.5 font-mono text-[10.5px] leading-4 text-zinc-100">{'{\n  "telefone": "{{personNumber}}",\n  "assistente": "{{agentNumber}}",\n  "conversa": "{{conversationLink}}",\n  "motivo": "{{motivo}}"\n}'}</pre>
      <div className="flex justify-end gap-1.5"><Btn><Hash className="size-3" /> Adicionar variável</Btn><Btn dark>Testar requisição</Btn></div>
    </div>
  ),

  campaign: () => (
    <>
      <Bar path={['Campanhas outbound', 'Retorno de orçamentos']} right={<Chip tone="green">Em execução</Chip>} />
      <div className="space-y-3 p-3">
        <Card className="flex items-center gap-2 p-2.5"><FileText className="size-4 text-zinc-400" /><div><p className="font-medium">lista-retorno.csv</p><p className="text-[10px] text-zinc-500">120 contatos · colunas: telefone, nome, procedimento</p></div></Card>
        <div><div className="mb-1 flex justify-between"><span className="font-medium">Progresso</span><span className="text-zinc-500">77 / 120</span></div><div className="h-1.5 rounded-full bg-zinc-100"><div className="h-full w-[64%] rounded-full bg-brand" /></div></div>
        <div className="grid grid-cols-3 gap-2 text-center">
          {[['Atendidas', '58'], ['Sem resposta', '15'], ['Reagendar', '4']].map(([l, v]) => <Card key={l} className="p-2"><p className="text-base font-semibold">{v}</p><p className="text-[10px] text-zinc-500">{l}</p></Card>)}
        </div>
      </div>
    </>
  ),

  'api-keys': () => (
    <>
      <Bar path={['Chaves de API']} right={<Btn dark><Plus className="size-3" /> Criar chave</Btn>} />
      <div className="p-3">
        <Card className="divide-y divide-zinc-100">
          {[
            ['Integração n8n (produção)', 'klo_live_••••••••3f9a', 'usada ontem'],
            ['Testes internos', 'klo_test_••••••••a01c', 'nunca usada'],
          ].map(([n, k, u]) => (
            <div key={n} className="flex items-center gap-2 px-3 py-2"><KeyRound className="size-3.5 text-zinc-400" /><div className="min-w-0"><p className="font-medium">{n}</p><p className="font-mono text-[10px] text-zinc-500">{k}</p></div><span className="ml-auto text-[10px] text-zinc-400">{u}</span><Ellipsis className="size-3.5 text-zinc-400" /></div>
          ))}
        </Card>
      </div>
    </>
  ),

  pbx: () => (
    <div className="flex min-h-[220px] flex-col sm:flex-row">
      <div className="flex-1 divide-y divide-zinc-100 border-b border-zinc-100 sm:border-b-0 sm:border-r">
        <p className="px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-zinc-400">Ramais</p>
        {[
          ['Recepção', '201', 'Disponível', 'green'],
          ['Dra. Paula', '202', 'Em ligação', 'amber'],
          ['Roberta (IA)', '200', 'Atendendo 2 ligações', 'brand'],
          ['Financeiro', '203', 'Ausente', 'zinc'],
        ].map(([n, r, s, t]) => (
          <div key={n} className="flex items-center gap-2 px-3 py-1.5"><CircleDot className={cn('size-3', t === 'green' ? 'text-emerald-500' : t === 'amber' ? 'text-amber-500' : t === 'brand' ? 'text-brand' : 'text-zinc-300')} /><span className="font-medium">{n}</span><span className="text-zinc-400">{r}</span><span className="ml-auto text-[10px] text-zinc-500">{s}</span></div>
        ))}
      </div>
      <div className="flex w-full flex-col items-center p-3 sm:w-[40%]">
        <p className="font-mono text-[13px]">+55 11 90000-0</p>
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'].map((d) => <span key={d} className="flex size-7 items-center justify-center rounded-full bg-zinc-100 text-[12px] font-medium">{d}</span>)}
        </div>
        <span className="mt-2 flex size-8 items-center justify-center rounded-full bg-emerald-500 text-white"><Phone className="size-3.5" /></span>
      </div>
    </div>
  ),

  tasks: () => (
    <>
      <Bar path={['Tarefas']} right={<Btn dark><Plus className="size-3" /> Nova tarefa</Btn>} />
      <div className="divide-y divide-zinc-100">
        {[
          ['Retornar para Mariana sobre orçamento', 'Criada pela IA', 'Recepção', false],
          ['Enviar segunda via do boleto para Carlos', 'Criada pela IA', 'Financeiro', false],
          ['Confirmar agenda da Dra. Paula', 'Manual', 'Recepção', true],
        ].map(([t, o, r, done]) => (
          <div key={t as string} className="flex items-center gap-2 px-3 py-2">
            <span className={cn('flex size-3.5 items-center justify-center rounded border', done ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-300')}>{done && <Check className="size-2.5" />}</span>
            <span className={cn('min-w-0 flex-1 truncate', done && 'text-zinc-400 line-through')}>{t}</span>
            <Chip tone={o === 'Manual' ? 'zinc' : 'brand'}>{o}</Chip>
            <span className="hidden items-center gap-1 text-[10px] text-zinc-500 sm:flex"><Users className="size-3" />{r}</span>
          </div>
        ))}
      </div>
    </>
  ),

  message: (a) => {
    const ch = a.channel ?? 'sms'
    const text = a.text ?? 'Olá! Sua avaliação está confirmada para quinta, 9h. Clínica Bem Viver.'
    if (ch === 'whatsapp')
      return (
        <div className="bg-[#efe7dd] p-4">
          <div className="mx-auto max-w-xs"><p className="mb-1.5 text-center text-[10px] text-zinc-500">WhatsApp · Recepção</p><p className="w-fit rounded-lg bg-white px-2.5 py-1.5 shadow-sm">{text}<span className="ml-2 text-[9px] text-zinc-400">10:24</span></p></div>
        </div>
      )
    if (ch === 'email')
      return (
        <div className="p-3">
          <Card className="p-3"><p className="text-[10px] text-zinc-500">De: Roberta (Kloel) · Para: recepcao@exemplo.com.br</p><p className="mt-1 font-semibold">Resumo da ligação</p><p className="mt-1.5 whitespace-pre-line text-zinc-600">{text}</p></Card>
        </div>
      )
    if (ch === 'slack')
      return (
        <div className="p-3">
          <p className="mb-2 flex items-center gap-1 text-[11px] font-semibold text-zinc-600"><Hash className="size-3" />atendimento</p>
          <div className="flex gap-2"><span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-brand text-[11px] font-bold text-white">K</span><div><p className="text-[11px]"><span className="font-semibold">Kloel</span> <Chip>APP</Chip> <span className="text-zinc-400">10:24</span></p><p className="mt-0.5 whitespace-pre-line text-zinc-700">{text}</p></div></div>
        </div>
      )
    return (
      <div className="p-4">
        <div className="mx-auto max-w-xs rounded-2xl border border-zinc-200 p-3"><p className="mb-2 text-center text-[10px] text-zinc-400">SMS · Clínica Bem Viver</p><p className="w-fit rounded-2xl rounded-bl-sm bg-zinc-100 px-3 py-2">{text}</p></div>
      </div>
    )
  },

  'partner-portal': () => (
    <>
      <Bar path={['Área do parceiro']} />
      <div className="grid grid-cols-3 gap-2 p-3">
        {[['Clientes ativos', '12'], ['Em teste', '3'], ['Comissão do mês', 'R$ 1.840']].map(([l, v]) => (
          <Card key={l} className="p-2.5"><p className="text-[10px] text-zinc-500">{l}</p><p className="mt-0.5 text-[15px] font-semibold tracking-tight">{v}</p></Card>
        ))}
      </div>
      <div className="px-3 pb-3">
        <Card className="divide-y divide-zinc-100">
          {[
            ['Padaria Pão Dourado', 'Team', 'green', 'Ativo'],
            ['Academia Movimento', 'Teste', 'amber', 'Em teste'],
            ['Oficina Ponto Certo', 'Solo', 'green', 'Ativo'],
          ].map(([n, p, t, s]) => (
            <div key={n} className="flex items-center gap-2 px-3 py-1.5"><Monogram name={n} className="size-5 text-[9px]" /><span className="font-medium">{n}</span><span className="text-zinc-400">{p}</span><span className="ml-auto"><Chip tone={t as 'green'}>{s}</Chip></span></div>
          ))}
        </Card>
      </div>
    </>
  ),

  'prompt-builder': () => <PromptBuilder />,
}

/* -------------------------- interativos -------------------------- */

const FORWARD_TYPES = [
  { id: '21', label: 'Sempre (incondicional)' },
  { id: '67', label: 'Quando ocupado' },
  { id: '61', label: 'Quando não atender' },
  { id: '62', label: 'Quando inacessível' },
] as const

function CallForwarding({ initial }: { initial?: string }) {
  const [number, setNumber] = useState(initial ?? '+55 11 90000-0200')
  const [type, setType] = useState<string>('61')
  const digits = number.replace(/[^\d+]/g, '')
  const valid = digits.replace(/\D/g, '').length >= 10
  const activate = `**${type}*${digits}#`
  const deactivate = `##${type}#`
  const copy = async (v: string) => {
    if (await copyText(v)) toast.success('Código copiado', { description: v })
    else toast.error('Não foi possível copiar.')
  }
  return (
    <div className="p-3 sm:p-4">
      <p className="text-[13px] font-semibold">Desvio de chamadas para a Kloel</p>
      <p className="mt-0.5 text-[11px] text-zinc-500">Gere o código para digitar no telefone da sua linha comercial.</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium">Número da Kloel (destino)</span>
          <input value={number} onChange={(e) => setNumber(e.target.value)} className="h-8 w-full rounded-md border border-zinc-200 px-2 font-mono text-[12px] outline-none focus:border-brand/50 focus:ring-2 focus:ring-brand/15" aria-label="Número da Kloel" />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium">Quando desviar</span>
          <select value={type} onChange={(e) => setType(e.target.value)} className="h-8 w-full rounded-md border border-zinc-200 bg-white px-2 text-[12px] outline-none focus:border-brand/50" aria-label="Quando desviar">
            {FORWARD_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>
      </div>
      {valid ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {[
            ['Ativar', activate],
            ['Desativar', deactivate],
          ].map(([l, v]) => (
            <div key={l} className="flex items-center justify-between gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-2">
              <div className="min-w-0"><p className="text-[10px] text-zinc-500">{l}</p><p className="truncate font-mono text-[13px] font-semibold">{v}</p></div>
              <button type="button" onClick={() => copy(v!)} className="inline-flex shrink-0 items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] hover:bg-zinc-100"><Copy className="size-3" /> Copiar</button>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 rounded-md bg-red-50 px-2.5 py-2 text-[11px] text-red-700">Informe um número com DDI e DDD (ex.: +55 11 90000-0200).</p>
      )}
      <p className="mt-2 text-[10px] text-zinc-400">Códigos GSM padrão. Algumas operadoras usam códigos próprios — confirme com a sua.</p>
    </div>
  )
}

const SECTORS: Record<string, { goal: string; info: string }> = {
  'Clínica / saúde': { goal: 'tirar dúvidas sobre procedimentos e agendar consultas', info: 'Nunca dê orientação médica; em caso de urgência, oriente a procurar atendimento de emergência.' },
  Imobiliária: { goal: 'qualificar interessados em imóveis e agendar visitas', info: 'Pergunte bairro, faixa de preço e se é compra ou aluguel.' },
  Restaurante: { goal: 'fazer reservas e responder sobre cardápio e horários', info: 'Confirme data, horário, número de pessoas e nome da reserva.' },
  Academia: { goal: 'apresentar planos e agendar aulas experimentais', info: 'Não negocie valores; ofereça falar com um consultor.' },
  'Oficina / serviços': { goal: 'registrar pedidos de orçamento e agendar visitas técnicas', info: 'Anote endereço completo, tipo de serviço e melhor horário.' },
  'Escritório (advocacia/contábil)': { goal: 'triar novos contatos e marcar uma primeira reunião', info: 'Não dê parecer jurídico ou contábil pelo telefone.' },
}

function PromptBuilder() {
  const [sector, setSector] = useState(Object.keys(SECTORS)[0]!)
  const [company, setCompany] = useState('Clínica Bem Viver')
  const [name, setName] = useState('Roberta')
  const [tone, setTone] = useState<'amigável' | 'formal'>('amigável')
  const prompt = useMemo(() => {
    const s = SECTORS[sector]!
    return [
      '# Papel',
      `Você é ${name || 'o assistente'}, atendente virtual da ${company || 'empresa'}.`,
      '',
      '# Objetivo',
      `Seu objetivo é ${s.goal}.`,
      '',
      '# Estilo',
      tone === 'formal' ? 'Use linguagem formal, trate a pessoa por "senhor" ou "senhora" e seja objetivo.' : 'Use um tom acolhedor e natural, com frases curtas e uma pergunta por vez.',
      '',
      '# Regras',
      `- ${s.info}`,
      '- Responda somente com base na base de conhecimento; se não souber, diga que vai verificar com a equipe.',
      '- Antes de encerrar, confirme nome e telefone de retorno.',
    ].join('\n')
  }, [sector, company, name, tone])
  return (
    <div className="grid gap-3 p-3 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] sm:p-4">
      <div className="space-y-2">
        <p className="text-[13px] font-semibold">Construtor de prompt</p>
        <label className="block"><span className="mb-1 block text-[11px] font-medium">Setor</span>
          <select value={sector} onChange={(e) => setSector(e.target.value)} className="h-8 w-full rounded-md border border-zinc-200 bg-white px-2 text-[12px]" aria-label="Setor">
            {Object.keys(SECTORS).map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <label className="block"><span className="mb-1 block text-[11px] font-medium">Empresa</span><input value={company} onChange={(e) => setCompany(e.target.value)} className="h-8 w-full rounded-md border border-zinc-200 px-2 text-[12px]" aria-label="Empresa" /></label>
        <label className="block"><span className="mb-1 block text-[11px] font-medium">Nome do assistente</span><input value={name} onChange={(e) => setName(e.target.value)} className="h-8 w-full rounded-md border border-zinc-200 px-2 text-[12px]" aria-label="Nome do assistente" /></label>
        <div><span className="mb-1 block text-[11px] font-medium">Tom</span>
          <div className="flex rounded-md bg-zinc-100 p-0.5">
            {(['amigável', 'formal'] as const).map((t) => (
              <button key={t} type="button" onClick={() => setTone(t)} className={cn('flex-1 rounded px-2 py-1 text-[11px] capitalize', tone === t ? 'bg-white font-medium shadow-sm' : 'text-zinc-500')}>{t}</button>
            ))}
          </div>
        </div>
      </div>
      <div className="flex min-w-0 flex-col">
        <pre className="min-h-[180px] flex-1 overflow-auto whitespace-pre-wrap rounded-lg bg-zinc-950 p-3 font-mono text-[11px] leading-5 text-zinc-100">{prompt}</pre>
        <div className="mt-2 flex justify-end gap-1.5">
          <button type="button" onClick={async () => ((await copyText(prompt)) ? toast.success('Prompt copiado') : toast.error('Não foi possível copiar.'))} className="inline-flex h-7 items-center gap-1 rounded-md border border-zinc-200 px-2 text-[11px] font-medium hover:bg-zinc-50"><Copy className="size-3" /> Copiar prompt</button>
          <Link to="/app/agents" className="inline-flex h-7 items-center gap-1 rounded-md bg-zinc-900 px-2 text-[11px] font-medium text-white hover:bg-zinc-800"><Settings2 className="size-3" /> Abrir assistentes</Link>
        </div>
      </div>
    </div>
  )
}

