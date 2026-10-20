import { useRef, useState } from 'react'
import { Mail } from 'lucide-react'
import { toast } from 'sonner'
import '@/domain/ext/agents-resources'
import type { Agent, EmailAction } from '@/domain/types'
import type { ActiveWindow, ExecutionTiming } from '@/domain/ext/agents-resources'
import { uid } from '@/lib/utils'
import { SideSheet } from '@/components/app/SideSheet'
import { ConfirmDialog } from '@/components/app/ConfirmDialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { AddRow, ChipsInput, DeleteFooterButton, EditableTitle, Field, FieldError, InfoBox, ListCard, ListRow, Pill, SectionCaps, SheetFooter, SheetSegmented, isEmail } from './shared/ui'
import { EXECUTION_LABEL, ExecutionControl } from './shared/timing'
import { saveAgent, upsert, useErrors, useHoursDraft } from './shared/hooks'
import { useListView, type ResourceProps } from './shared/listView'
import { DEFAULT_EMAIL_BODY, RichTextEditor, htmlHasContent, sanitizeHtml } from './shared/RichTextEditor'
import { VariablePicker } from './shared/VariablePicker'
import { VariableTextEditor, type VariableTextEditorHandle } from './shared/VariableTextEditor'
import { AFTER_ONLY_KEYS, usedVariableKeys } from './shared/variables'

const timingOf = (e: EmailAction): ExecutionTiming => e.executionTiming ?? e.timing

export function EmailResource({ agent, open, onOpenChange }: ResourceProps) {
  const lv = useListView(agent.emails.length > 0, () => onOpenChange(false), (id) => agent.emails.some((e) => e.id === id))
  const view = lv.view
  if (view.mode === 'list')
    return (
      <SideSheet open={open} onOpenChange={onOpenChange} title="Enviar e-mail" hideFooter contentClassName="pt-0">
        <ListCard>
          {agent.emails.map((e) => (
            <ListRow
              key={e.id}
              leading={<Mail className="size-4 shrink-0 text-muted-foreground" />}
              title={e.name}
              subtitle={`${EXECUTION_LABEL[timingOf(e)]} · ${e.when === 'always' ? 'Sempre' : `Somente se ${e.condition ?? ''}`}`}
              pills={
                <>
                  <Pill>{e.recipientsMode === 'ai' ? 'IA decide' : `${e.recipients.length} destinatário(s)`}</Pill>
                  <Pill tone="muted">{e.messageMode === 'ai' ? 'IA escreve' : 'Texto fixo'}</Pill>
                </>
              }
              onClick={() => lv.edit(e.id)}
            />
          ))}
          <AddRow onClick={() => lv.add()}>Adicionar e-mail</AddRow>
        </ListCard>
      </SideSheet>
    )
  const target = view.id ? agent.emails.find((e) => e.id === view.id) : undefined
  return <EmailEditor key={view.seq} agent={agent} target={target} open={open} onOpenChange={onOpenChange} onDone={lv.done} />
}

type ErrKey = 'condition' | 'recipients' | 'subject' | 'body' | 'aiInstruction' | 'window' | 'aiUsage'

function EmailEditor({ agent, target, open, onOpenChange, onDone }: { agent: Agent; target?: EmailAction; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const hours = useHoursDraft(agent)
  const { errors, setErrors, clear } = useErrors<ErrKey>()
  const [name, setName] = useState(target?.name ?? 'E-mail')
  const [timing, setTiming] = useState<ExecutionTiming>(target ? timingOf(target) : 'after')
  const [win, setWin] = useState<ActiveWindow>(target?.activeWindow ?? 'any')
  const [when, setWhen] = useState<EmailAction['when']>(target?.when ?? 'always')
  const [condition, setCondition] = useState(target?.condition ?? '')
  const [recipientsMode, setRecipientsMode] = useState<EmailAction['recipientsMode']>(target?.recipientsMode ?? 'fixed')
  const [recipients, setRecipients] = useState<string[]>(target?.recipients ?? [])
  const [pendingRecipient, setPendingRecipient] = useState('')
  const [recipientsInstruction, setRecipientsInstruction] = useState(target?.recipientsInstruction ?? '')
  const [subject, setSubject] = useState(target?.subject ?? 'Nova conversa')
  const [messageMode, setMessageMode] = useState<EmailAction['messageMode']>(target?.messageMode ?? 'manual')
  // corpo salvo passa pelo sanitizador ao abrir: chips gravados com a classe antiga voltam com a pílula atual (VAR_CHIP_CLASS)
  const [body, setBody] = useState(() => (target?.body ? sanitizeHtml(target.body) || target.body : DEFAULT_EMAIL_BODY))
  const [aiInstruction, setAiInstruction] = useState(target?.aiInstruction ?? '')
  // C-38/"Ordem Funil" 4.png: "Kloel via Kloel" (placeholder "Suporte")
  const [fromName, setFromName] = useState(target?.fromName ?? 'Kloel')
  // refs. EM-03/EM-04: durante a conversa a IA decide quando enviar ("Quando a IA deve usar isto?") e pode falar enquanto envia
  const [aiUsage, setAiUsage] = useState(target?.aiUsage ?? '')
  const [sendingPhrase, setSendingPhrase] = useState(target?.sendingPhrase ?? '')
  const before = timing === 'before'
  // ref. EM-03: antes da conversa só há endereços fixos e texto fixo; variáveis da conversa ficam vazias (chips riscados)
  const effRecipientsMode: EmailAction['recipientsMode'] = before ? 'fixed' : recipientsMode
  const effMessageMode: EmailAction['messageMode'] = before ? 'manual' : messageMode
  const [confirmDelete, setConfirmDelete] = useState(false)
  const subjectRef = useRef<VariableTextEditorHandle>(null)

  // ref. EM-03: antes da conversa as variáveis que só existem depois dela ficam riscadas no assunto
  const unavailableUsed = before ? usedVariableKeys(subject, body).filter((k) => AFTER_ONLY_KEYS.includes(k)) : []

  const save = async () => {
    try {
    const e: Partial<Record<ErrKey, string>> = {}
    let finalRecipients = recipients
    if (pendingRecipient.trim()) {
      if (isEmail(pendingRecipient)) finalRecipients = [...new Set([...recipients, pendingRecipient.trim()])]
      else e.recipients = `Endereço de e-mail inválido: ${pendingRecipient.trim()}`
    }
    if (timing === 'after' && when === 'only_if' && !condition.trim()) e.condition = 'Descreva a condição para enviar o e-mail.'
    if (timing === 'during' && !aiUsage.trim()) e.aiUsage = 'Descreva quando a IA deve enviar este e-mail.'
    if (effRecipientsMode === 'fixed' && !finalRecipients.length && !e.recipients) e.recipients = 'Informe pelo menos um destinatário.'
    if (!subject.trim()) e.subject = 'Informe o assunto.'
    if (effMessageMode === 'manual' && !htmlHasContent(body)) e.body = 'A mensagem é obrigatória.'
    if (effMessageMode === 'ai' && !aiInstruction.trim()) e.aiInstruction = 'Diga à IA o que o e-mail deve conter.'
    if (win !== 'any' && !hours.configured) e.window = 'Configure o horário de funcionamento para usar esta opção.'
    setErrors(e)
    if (Object.values(e).some(Boolean)) {
      toast.error('Corrija os campos destacados.')
      return
    }
    const next: EmailAction = {
      id: target?.id ?? uid('eml'),
      name: name.trim() || 'E-mail',
      timing: timing === 'after' ? 'after' : 'during',
      executionTiming: timing,
      activeWindow: win,
      // "Enviar: Sempre/Somente se…" só existe depois da conversa (refs. EM-03/EM-04 não mostram a linha)
      when: timing === 'after' ? when : 'always',
      condition: timing === 'after' && when === 'only_if' ? condition.trim() : undefined,
      aiUsage: timing === 'during' ? aiUsage.trim() : undefined,
      sendingPhrase: timing === 'during' ? sendingPhrase.trim() : undefined,
      recipientsMode: effRecipientsMode,
      recipients: effRecipientsMode === 'fixed' ? finalRecipients : [],
      recipientsInstruction: effRecipientsMode === 'ai' ? recipientsInstruction.trim() : undefined,
      messageMode: effMessageMode,
      subject: subject.trim(),
      body: effMessageMode === 'manual' ? sanitizeHtml(body) : target?.body ?? '',
      aiInstruction: effMessageMode === 'ai' ? aiInstruction.trim() : target?.aiInstruction,
      fromName: fromName.trim() || 'Kloel',
      businessHours: target?.businessHours,
    }
    await saveAgent(agent, (a) => ({ emails: upsert(a.emails, next), ...(hours.changed ? { businessHours: hours.hours } : {}) }))
    toast.success(target ? 'E-mail atualizado.' : 'E-mail adicionado.')
    onDone()
      } catch (error) { toast.error('Não foi possível salvar', { description: error instanceof Error ? error.message : 'Confira o acesso e tente novamente.' }) }
  }

  return (
    <SideSheet
      open={open}
      onOpenChange={onOpenChange}
      title={<EditableTitle value={name} onChange={setName} />}
      footer={<SheetFooter onSave={save} onCancel={onDone} left={target && <DeleteFooterButton onClick={() => setConfirmDelete(true)} />} />}
      contentClassName="pb-0"
    >
      {/* ref. 514: ≈20px entre campos (gap-5); Enviar a 16px dos seletores e MENSAGEM a 32px do segmentado; o editor começa 3px acima
          do padrão do painel e Assunto fica 22px abaixo de Para (medidas na captura 2x). Fonio ao vivo (fonio-live2 C-assistentes/38,
          1355×661): seletores de Execução em y=144 → o formulário começa 2px (não 3px) acima do padrão do painel. */}
      <div className="-mt-[2px] flex flex-col gap-5" data-testid="email-editor">
        {/* C-38: "Execução" = momento + janela (dois seletores) */}
        <Field label="Execução" error={errors.window}>
          <ExecutionControl
            timing={timing}
            onTimingChange={(v) => (setTiming(v), clear('condition'), clear('aiUsage'), clear('recipients'), clear('body'), clear('aiInstruction'))}
            win={win}
            onWinChange={(v) => (setWin(v), clear('window'))}
            hoursConfigured={hours.configured}
            onConfigure={hours.openSheet}
          />
        </Field>

        {timing === 'during' && (
          <>
            {/* ref. EM-04: a IA decide quando enviar e pode avisar enquanto envia */}
            <Field label="Quando a IA deve usar isto?" htmlFor="email-ai-usage" error={errors.aiUsage} className="-mt-1">
              <Textarea
                id="email-ai-usage"
                value={aiUsage}
                onChange={(e) => (setAiUsage(e.target.value), clear('aiUsage'))}
                placeholder="Descreva quando a IA deve recorrer a esta ferramenta."
                aria-invalid={!!errors.aiUsage || undefined}
                className="min-h-[68px]"
              />
            </Field>
            <Field label="Ao enviar, diga" htmlFor="email-saying" hint="Deixe vazio para ficar em silêncio.">
              <Input id="email-saying" value={sendingPhrase} onChange={(e) => setSendingPhrase(e.target.value)} placeholder="Um momento, estou enviando esse e-mail agora." />
            </Field>
          </>
        )}

        {/* ref. 517: a condição fica 4px abaixo do segmentado e mede 80px. Só depois da conversa (EM-03/EM-04 não têm "Enviar"). */}
        {timing === 'after' && (
          <div className="-mt-1 flex flex-col gap-1">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm font-medium">Enviar</span>
              <SheetSegmented<EmailAction['when']>
                ariaLabel="Enviar"
                value={when}
                onChange={setWhen}
                options={[
                  { value: 'always', label: 'Sempre' },
                  { value: 'only_if', label: 'Somente se…' },
                ]}
              />
            </div>
            {when === 'only_if' && (
              <>
                <Textarea
                  aria-label="Condição"
                  value={condition}
                  onChange={(e) => (setCondition(e.target.value), clear('condition'))}
                  placeholder="ex.: o chamador pediu um resumo por escrito."
                  aria-invalid={!!errors.condition || undefined}
                  className="min-h-[80px]"
                  autoFocus
                />
                <FieldError>{errors.condition}</FieldError>
              </>
            )}
          </div>
        )}

        <SectionCaps className={timing === 'after' ? 'pt-3' : 'pt-1'}>Mensagem</SectionCaps>

        {before && (
          // ref. EM-03: cartão informativo (ⓘ, título e texto cinza)
          <InfoBox tone="neutral" title="Antes da conversa" className="-mt-1" testId="email-before-info">
            Ainda não há contexto da conversa, então só é possível usar endereços fixos e um texto fixo.
          </InfoBox>
        )}

        <Field
          label="Para"
          className="mb-0.5"
          aside={
            !before && (
              <SheetSegmented<EmailAction['recipientsMode']>
                ariaLabel="Destinatários"
                value={recipientsMode}
                onChange={(v) => (setRecipientsMode(v), clear('recipients'))}
                options={[
                  { value: 'fixed', label: 'Endereços fixos' },
                  { value: 'ai', label: 'Deixar a IA decidir' },
                ]}
              />
            )
          }
          hint={effRecipientsMode === 'ai' ? 'A IA determina os destinatários a partir da conversa.' : undefined}
          error={effRecipientsMode === 'fixed' ? errors.recipients : undefined}
        >
          {effRecipientsMode === 'fixed' ? (
            <ChipsInput
              ariaLabel="Endereços de e-mail"
              values={recipients}
              onChange={(v) => (setRecipients(v), clear('recipients'))}
              onPendingChange={setPendingRecipient}
              placeholder="nome@empresa.com.br"
              invalid={!!errors.recipients}
              normalize={(s) => s.trim().toLowerCase()}
              validate={(v) => (isEmail(v) ? undefined : `Endereço de e-mail inválido: ${v}`)}
            />
          ) : (
            <Textarea aria-label="Instrução de destinatários" value={recipientsInstruction} onChange={(e) => setRecipientsInstruction(e.target.value)} placeholder="Envie para o endereço de e-mail que o cliente mencionar." className="min-h-[80px]" />
          )}
        </Field>

        <Field label="Assunto" htmlFor="email-subject" error={errors.subject}>
          {/* EM-02/EM-06: assunto de uma linha com "{ }"; variáveis aparecem como chips (mesmo estilo do corpo) */}
          <VariableTextEditor
            ref={subjectRef}
            id="email-subject"
            ariaLabel="Assunto"
            multiline={false}
            value={subject}
            onChange={(v) => (setSubject(v), clear('subject'))}
            invalid={!!errors.subject}
            unavailable={unavailableUsed}
            contentClassName="pr-11"
            adornment={
              <div className="absolute right-1.5 top-1/2 -translate-y-1/2">
                <VariablePicker
                  variant="braces"
                  restoreFocus={false}
                  context={before ? 'before' : 'default'}
                  onPick={(v) => {
                    subjectRef.current?.insertVariable(v.key)
                    requestAnimationFrame(() => subjectRef.current?.focus())
                  }}
                />
              </div>
            }
          />
        </Field>

        {/* Fonio ao vivo (live-compare 13): 45px da borda inferior do editor ao campo "De" — 2px a mais que o gap-5 */}
        <Field
          label="Mensagem"
          className="mb-0.5"
          aside={
            !before && (
              <SheetSegmented<EmailAction['messageMode']>
                ariaLabel="Mensagem"
                value={messageMode}
                onChange={(v) => (setMessageMode(v), clear('body'), clear('aiInstruction'))}
                options={[
                  { value: 'manual', label: 'Escrever você mesmo' },
                  { value: 'ai', label: 'Deixar a IA escrever' },
                ]}
              />
            )
          }
          hint={effMessageMode === 'ai' ? 'A IA escreve o e-mail completo a partir disto e da conversa.' : undefined}
          error={effMessageMode === 'manual' ? errors.body : errors.aiInstruction}
        >
          {effMessageMode === 'manual' ? (
            <RichTextEditor
              ariaLabel="Corpo do e-mail"
              value={body}
              onChange={(v) => (setBody(v), clear('body'))}
              invalid={!!errors.body}
              unavailable={before ? AFTER_ONLY_KEYS : undefined}
              variableContext={before ? 'before' : 'default'}
            />
          ) : (
            <Textarea
              aria-label="Instrução para a IA"
              value={aiInstruction}
              onChange={(e) => (setAiInstruction(e.target.value), clear('aiInstruction'))}
              placeholder="Escreva um resumo conciso da conversa para o cliente."
              aria-invalid={!!errors.aiInstruction || undefined}
              className="min-h-[80px]"
            />
          )}
        </Field>

        <Field label="De" htmlFor="email-from">
          <div className="flex h-10 w-full items-center rounded-md border border-input bg-background px-3 text-sm focus-within:ring-1 focus-within:ring-ring">
            <span className="inline-grid min-w-[2ch] max-w-[70%]">
              <span aria-hidden className="invisible col-start-1 row-start-1 overflow-hidden whitespace-pre">{fromName || 'Suporte'}</span>
              <input
                id="email-from"
                size={1}
                value={fromName}
                onChange={(e) => setFromName(e.target.value)}
                placeholder="Suporte"
                className="col-start-1 row-start-1 w-full min-w-0 bg-transparent outline-none placeholder:text-muted-foreground"
              />
            </span>
            <span className="shrink-0 whitespace-pre text-muted-foreground"> via Kloel</span>
          </div>
        </Field>

      </div>
      {hours.sheet}
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Excluir e-mail?"
        description={`A ação "${name}" deixará de enviar e-mails.`}
        confirmLabel="Excluir"
        onConfirm={async () => {
          await saveAgent(agent, (a) => ({ emails: a.emails.filter((x) => x.id !== target?.id) }))
          toast.success('E-mail excluído.')
          onDone()
        }}
      />
    </SideSheet>
  )
}
