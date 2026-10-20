import { useEffect, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import type { AgentTechnical } from '@/domain/types'
import { cn, uid } from '@/lib/utils'
import { SectionHeading } from '@/components/app/Page'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAgentDraft } from './draft'
import { FieldError, LEFT_CHECK_ITEM } from './ui'

function CheckCard({ id, label, description, checked, onChange, disabled, bare }: { id: string; label: string; description: string; checked: boolean; onChange?: (v: boolean) => void; disabled?: boolean; bare?: boolean }) {
  return (
    <div className={cn('flex flex-row items-start space-x-3 space-y-0', !bare && 'rounded-lg border bg-white p-6')}>
      <Checkbox id={id} checked={checked} disabled={disabled} onCheckedChange={(v) => onChange?.(v === true)} />
      <div className="space-y-1 leading-none">
        <label htmlFor={id} className={cn('text-sm font-medium leading-none', disabled ? 'cursor-not-allowed' : 'cursor-pointer')}>
          {label}
        </label>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}

function FieldHead({ label, description, htmlFor, muted }: { label: string; description?: ReactNode; htmlFor?: string; muted?: boolean }) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className={cn('text-sm font-medium leading-none', muted && 'text-muted-foreground')}>
        {label}
      </label>
      {description && <p className="text-sm text-muted-foreground">{description}</p>}
    </div>
  )
}

function SliderField({ label, description, value, onChange, min, max, step, left, right, disabled }: { label: string; description?: string; value: number; onChange: (v: number) => void; min: number; max: number; step: number; left: string; right: string; disabled?: boolean }) {
  // o Slider compartilhado não repassa o rótulo à alça (role="slider"); nomeia a alça para leitores de tela e testes
  const nameThumb = (el: HTMLDivElement | null) => el?.querySelectorAll('[role="slider"]').forEach((t) => t.setAttribute('aria-label', label))
  return (
    <div ref={nameThumb} className={cn('space-y-1', disabled && 'opacity-50')}>
      <FieldHead label={label} description={description} muted={disabled} />
      <Slider value={[value]} min={min} max={max} step={step} disabled={disabled} onValueChange={([v]) => onChange(v!)} aria-label={label} />
      <p className="flex justify-between text-sm text-muted-foreground">
        <span>{left}</span>
        <span>{right}</span>
      </p>
    </div>
  )
}

/** OBSERVADO (data/technical-and-prompt.json): só "Escritório" e "Sala de reunião"; "Sem sons ambiente" é o placeholder. */
const AMBIENT: { value: AgentTechnical['ambientSound']; label: string }[] = [
  { value: 'office', label: 'Escritório' },
  { value: 'keyboard_typing', label: 'Sala de reunião' },
]

/**
 * Aba "Técnico" — captura app-04 / spec 07 [567]–[570].
 * Assistentes de chat (INFERIDO): só os ajustes que valem para mensagens escritas (guardrails, criatividade e
 * processamento preciso); os de voz/telefonia (duração, gravação, sons, fala, interrupções, DTMF, transferência) ficam ocultos.
 */
export function TechnicalTab() {
  const { agent, draft, update, issueFor } = useAgentDraft()
  const isChat = agent.type === 'chat'
  const t = draft.technical
  /** Every field here reaches a runtime (phone worker via phone-runtime.ts; chat via agent-technical.ts). */
  const set = (patch: Partial<AgentTechnical>) => update((d) => ({ technical: { ...d.technical, ...patch } }))
  const [term, setTerm] = useState('')
  /** TE-07 (GIF): "Adicionar informação" cria a linha e põe o foco no nome */
  const [focusRow, setFocusRow] = useState<string | null>(null)
  useEffect(() => {
    if (!focusRow) return
    document.getElementById(`pe-name-${focusRow}`)?.focus()
    setFocusRow(null)
  }, [focusRow])
  const num = (v: string) => (v === '' ? Number.NaN : Number(v))

  function addTerm() {
    const v = term.trim()
    if (!v) return
    if (!t.technicalTerms.some((x) => x.toLowerCase() === v.toLowerCase())) set({ technicalTerms: [...t.technicalTerms, v] })
    setTerm('')
  }

  return (
    <div className="w-full">
      <SectionHeading>Técnico</SectionHeading>
      <form onSubmit={(e) => e.preventDefault()} noValidate>
        <div className="space-y-4">
          <CheckCard
            id="guardrails"
            checked
            disabled
            label="Guardrails e moderação de conteúdo"
            description="Monitora automaticamente as conversas em busca de violência, conteúdo sexual, assédio, discurso de ódio e outros conteúdos prejudiciais. Sempre ativado para garantir que cada conversa permaneça segura e profissional."
          />

          {!isChat && (
          <>
          <div className="space-y-4 rounded-lg border bg-white p-6">
            <div className="flex flex-col gap-6 sm:flex-row sm:gap-12">
              <div className="flex-1 space-y-1">
                <FieldHead htmlFor="maxCallDuration" label="Duração máxima da ligação" description="Depois desse tempo (em minutos), a ligação é encerrada automaticamente" />
                <Input
                  id="maxCallDuration"
                  name="maxCallDuration"
                  type="number"
                  min={1}
                  max={120}
                  placeholder="20"
                  value={Number.isFinite(t.maxCallDuration) ? t.maxCallDuration : ''}
                  aria-invalid={!!issueFor('maxCallDuration')}
                  onChange={(e) => set({ maxCallDuration: num(e.target.value) })}
                />
                <FieldError>{issueFor('maxCallDuration')}</FieldError>
              </div>
              <div className="flex-1 space-y-1">
                <FieldHead htmlFor="endCallAfterSilenceTimeout" label="Tempo máximo de espera" description="Depois desse tempo (em segundos) sem resposta, a ligação é encerrada" />
                <Input
                  id="endCallAfterSilenceTimeout"
                  name="endCallAfterSilenceTimeout"
                  type="number"
                  min={5}
                  max={600}
                  placeholder="60"
                  value={Number.isFinite(t.silenceTimeout) ? t.silenceTimeout : ''}
                  aria-invalid={!!issueFor('silenceTimeout')}
                  onChange={(e) => set({ silenceTimeout: num(e.target.value) })}
                />
                <FieldError>{issueFor('silenceTimeout')}</FieldError>
              </div>
            </div>
          </div>

          <CheckCard
            id="recordAudio"
            checked={t.recordAudio}
            onChange={(v) => set({ recordAudio: v })}
            label="Gravar áudio"
            description="Um arquivo de áudio será gravado e ficará disponível por 30 dias. O assistente deve informar no começo da conversa que a ligação está sendo gravada!"
          />
          <CheckCard
            id="autoDelete"
            checked={t.autoDeleteOnRefusal}
            onChange={(v) => set({ autoDeleteOnRefusal: v })}
            label="Exclusão automática (recomendado)"
            description="Se a pessoa recusar a gravação, a gravação e a transcrição serão excluídas automaticamente, e nenhuma ação pós-ligação ou extração será executada. Recomendamos escrever no prompt que, em caso de recusa, a ligação deve ser encerrada ou transferida!"
          />

          <div className="flex flex-col gap-6 rounded-lg border bg-white p-6 sm:flex-row sm:gap-12">
            {/* [568]: rótulo → seletor a 4px; "Limpar seleção" logo abaixo (sem margem), como na referência */}
            <div className="flex-1 space-y-1">
              <FieldHead label="Sons ambiente" />
              <Select value={t.ambientSound || ''} onValueChange={(v) => set({ ambientSound: v as AgentTechnical['ambientSound'] })}>
                <SelectTrigger className="h-10 w-full data-[placeholder]:text-foreground" aria-label="Sons ambiente">
                  <SelectValue placeholder="Sem sons ambiente" />
                </SelectTrigger>
                <SelectContent>
                  {AMBIENT.map((a) => (
                    <SelectItem key={a.value} value={a.value} className={LEFT_CHECK_ITEM}>
                      {a.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <button type="button" className="!mt-0 ml-2 cursor-pointer text-sm text-muted-foreground hover:underline disabled:cursor-default disabled:no-underline disabled:opacity-60" disabled={!t.ambientSound} onClick={() => set({ ambientSound: '' })}>
                Limpar seleção
              </button>
            </div>
            <div className="min-w-0 flex-1">
              <SliderField label="Volume do som ambiente" value={t.ambientVolume} min={0} max={2} step={0.1} left="Baixo" right="Alto" disabled={!t.ambientSound} onChange={(v) => set({ ambientVolume: v })} />
            </div>
          </div>

          <div className="space-y-6 rounded-lg border bg-white p-6">
            <div className="space-y-1">
              <FieldHead
                htmlFor="technical-terms"
                label="Termos técnicos"
                description="Armazene palavras raras e termos técnicos (por exemplo: nomes de produtos, ruas ou colaboradores) para que a IA os reconheça corretamente. Confirme com Enter."
              />
              <div className="flex min-h-10 w-full flex-wrap gap-2 rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm has-[:focus-visible]:ring-1 has-[:focus-visible]:ring-neutral-950">
                {t.technicalTerms.map((x) => (
                  <span key={x} className="inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-0.5 text-xs font-medium">
                    {x}
                    <button type="button" aria-label={`Remover ${x}`} onClick={() => set({ technicalTerms: t.technicalTerms.filter((y) => y !== x) })} className="text-muted-foreground hover:text-foreground">
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
                <input
                  id="technical-terms"
                  value={term}
                  onChange={(e) => setTerm(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addTerm()
                    } else if (e.key === 'Backspace' && !term && t.technicalTerms.length) {
                      set({ technicalTerms: t.technicalTerms.slice(0, -1) })
                    }
                  }}
                  className="min-w-[8rem] flex-1 bg-transparent outline-none placeholder:text-neutral-500 focus-visible:outline-none"
                />
              </div>
            </div>
            <SliderField label="Velocidade da fala" value={t.speechSpeed} min={0.5} max={2} step={0.05} left="Lento" right="Rápido" onChange={(v) => set({ speechSpeed: v })} />
            <SliderField
              label="Sensibilidade"
              description="Com maior sensibilidade, o assistente reage mais facilmente a interrupções, mas também a ruídos."
              value={t.sensitivity}
              min={0}
              max={1}
              step={0.05}
              left="Baixa"
              right="Alta"
              onChange={(v) => set({ sensitivity: v })}
            />
          </div>
          </>
          )}

          <div className="space-y-4 rounded-lg border bg-white p-6">
            <SliderField label="Criatividade (temperatura)" value={t.temperature} min={0} max={1} step={0.05} left="Segue o prompt à risca" right="Muito criativo" onChange={(v) => set({ temperature: v })} />
            {/* [569]: título em linha de 24px a 16px do controle acima; cabeçalho a 20px do texto; linhas a 4px; botão a 12px */}
            <div className="space-y-1">
              <p className="text-sm font-medium leading-6">Processamento preciso de informações</p>
              <p className="text-sm text-muted-foreground">
                {isChat
                  ? 'Defina quais informações o assistente deve coletar com precisão na conversa. Ele pede cada uma e confirma o valor com a pessoa antes de usá-lo.'
                  : 'Defina quais informações o assistente deve coletar com precisão na ligação. Ele pede cada uma e confirma o valor com a pessoa (soletrando e-mails e números, por exemplo).'}
                <br />
                → <a href="/ajuda/get-started/technical" target="_blank" rel="noreferrer" className="text-blue-500 hover:underline">
                  Vídeo tutorial
                </a>
              </p>
            </div>
            <div className="!mt-1">
              <div className="flex flex-row pt-4 text-sm text-muted-foreground">
                <div className="grid flex-grow grid-cols-2 gap-2 pr-10">
                  <span className="whitespace-nowrap">
                    Nome da informação ou gatilho <span className="text-xs">(a-z, A-Z, 0-9, -, _)</span>
                  </span>
                  <span className="pl-1">Formato de exemplo</span>
                </div>
              </div>
              {t.preciseExtraction.map((row) => {
                const err = issueFor(`pe:${row.id}`)
                const patchRow = (p: Partial<typeof row>) => set({ preciseExtraction: t.preciseExtraction.map((r) => (r.id === row.id ? { ...r, ...p } : r)) })
                return (
                  <div key={row.id} className="mt-1 py-1">
                    <div className="flex items-center space-x-2">
                      <div className="grid flex-grow grid-cols-2 gap-2">
                        <Input id={`pe-name-${row.id}`} className="h-8 text-sm" placeholder="Nome da informação — por exemplo: e-mail, endereço" value={row.name} aria-invalid={!!err} aria-label="Nome da informação" onChange={(e) => patchRow({ name: e.target.value })} />
                        <Input className="h-8 text-sm" placeholder="Exemplo" value={row.example} aria-label="Formato de exemplo" onChange={(e) => patchRow({ example: e.target.value })} />
                      </div>
                      <Button type="button" variant="ghost" className="h-8 rounded-md px-2" aria-label="Remover informação" onClick={() => set({ preciseExtraction: t.preciseExtraction.filter((r) => r.id !== row.id) })}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                    <FieldError className="mt-1">{err}</FieldError>
                  </div>
                )
              })}
              <Button type="button" variant="outline" className="mt-3 h-9 rounded-md px-3" onClick={() => {
                  const id = uid('pe')
                  set({ preciseExtraction: [...t.preciseExtraction, { id, name: '', example: '' }] })
                  setFocusRow(id)
                }}>
                Adicionar informação
              </Button>
            </div>
          </div>

          {!isChat && (
          <div className="space-y-4">
            <div className="space-y-6 rounded-lg border bg-white p-6">
              <CheckCard
                bare
                id="freeTransfer"
                checked={t.freeTransfer}
                onChange={(v) => set({ freeTransfer: v })}
                label="Transferência livre de ligações"
                description="O assistente pode transferir ligações livremente para outros números conforme definido no prompt. Atenção: isso deve ser bem restrito para que quem liga não consiga determinar esse comportamento."
              />
            </div>
            <CheckCard id="dtmf" checked={t.dtmf} onChange={(v) => set({ dtmf: v })} label="Envio de tons DTMF / discagem por tom" description="Permite que o assistente envie códigos de discagem por tom (por exemplo, dígitos) durante a ligação." />
            <CheckCard
              id="protectGreeting"
              checked={t.protectGreeting}
              onChange={(v) => set({ protectGreeting: v })}
              label="Impedir interrupção da mensagem inicial"
              description="Quem liga não pode interromper a mensagem inicial. Isso pode garantir, por exemplo, que informações legais sejam sempre transmitidas."
            />
            <CheckCard
              id="noInterruptions"
              checked={t.noInterruptions}
              onChange={(v) => set({ noInterruptions: v })}
              label="Impedir interrupções"
              description="Quem liga não pode interromper o agente em nenhum momento da chamada — ele sempre termina de falar. Útil quando quem liga precisa ser totalmente instruído, por exemplo, para orientações de serviço ou informações legais."
            />
            {/* [570]: seletor a ~6px da descrição */}
            <div className="space-y-1.5 rounded-lg border bg-white p-6">
              <FieldHead
                label="Rapidez de resposta"
                description={'Com que rapidez o assistente toma a palavra quando quem liga faz uma pausa. "Paciente" espera mais antes de responder, o que ajuda com pessoas que pausam no meio da frase, ao custo de respostas um pouco mais lentas.'}
              />
              <Select value={t.responseSpeed} onValueChange={(v) => set({ responseSpeed: v as AgentTechnical['responseSpeed'] })}>
                <SelectTrigger className="h-10" aria-label="Rapidez de resposta">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="normal" className={LEFT_CHECK_ITEM}>
                    Normal
                  </SelectItem>
                  <SelectItem value="patient" className={LEFT_CHECK_ITEM}>
                    Paciente
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          )}
        </div>
      </form>
    </div>
  )
}
