import { useEffect, useState, type ReactNode } from 'react'
import { ChevronRight, CirclePlus, Volume2, X } from 'lucide-react'
import { toast } from 'sonner'
import type { AgentRules, CustomRule } from '@/domain/types'
import { cn, uid } from '@/lib/utils'
import { SectionHeading, SectionLabel, SettingsCard, SettingsRow } from '@/components/app/Page'
import { SideSheet, SheetSectionTitle, SheetSwitchRow } from '@/components/app/SideSheet'
import { ConfirmDialog } from '@/components/app/ConfirmDialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useAgentDraft } from './draft'
import { FieldError, speakPreview, LEFT_CHECK_ITEM } from './ui'

const SYSTEM_RULES = [
  ['Respostas curtas e claras', 'Respostas precisas, sem monólogos longos'],
  ['Pergunta quando algo não está claro', 'Faz perguntas automaticamente quando algo não está claro'],
  ['Educado, calmo e profissional', 'Responde de forma breve, compreensível e amigável'],
  ['Perguntas objetivas', 'Faz as perguntas uma após a outra e nunca pede a mesma informação duas vezes'],
] as const

export const AI_DISCLOSURE: { value: AgentRules['aiDisclosure']; label: string }[] = [
  { value: 'never', label: 'Não mencionar' },
  { value: 'if_asked', label: 'Somente se perguntado' },
  { value: 'start', label: 'No início da conversa' },
  { value: 'start_consent', label: 'No início, consentimento obrigatório' },
]
export const STYLES: { value: AgentRules['style']; label: string }[] = [
  { value: 'default', label: 'Padrão' },
  { value: 'professional', label: 'Profissional e amigável' },
  { value: 'casual', label: 'Casual e descontraído' },
  { value: 'formal', label: 'Formal e objetivo' },
  { value: 'empathetic', label: 'Empático e acolhedor' },
]
const OFFTOPIC = [
  ['POINT_OUT_NOT_RESPONSIBLE', 'Indicar que não é responsável por isso'],
  ['REDIRECT_TO_RIGHT_CONTACT', 'Encaminhar ao contato certo'],
  ['EXPLAIN_SCOPE', 'Explicar no que pode ajudar'],
] as const
const SMALLTALK = [
  ['ENGAGE_BRIEFLY', 'Responder brevemente e voltar ao assunto'],
  ['REDIRECT_FRIENDLY', 'Voltar ao assunto de forma amigável'],
  ['MATCH_MOOD', 'Acompanhar o humor da outra pessoa'],
] as const
const ANGRY = [
  ['STAY_CALM_AND_LISTEN', 'Manter a calma e ouvir'],
  ['SHOW_EMPATHY_OFFER_SOLUTION', 'Demonstrar compreensão e oferecer uma solução'],
  ['STAY_FACTUAL_LOG_REQUEST', 'Manter-se objetivo e registrar a solicitação'],
] as const
const SALES = [
  ['DECLINE_FRIENDLY', 'Recusar com educação'],
  ['DECLINE_AND_LOG', 'Recusar e anotar a solicitação'],
  ['DECLINE_BRIEFLY', 'Recusar brevemente'],
] as const
const COMPETITORS = [
  ['STAY_NEUTRAL', 'Manter-se neutro'],
  ['HIGHLIGHT_STRENGTHS', 'Destacar os próprios pontos fortes'],
  ['LOG_AND_FORWARD', 'Anotar e encaminhar'],
] as const

function OptionSelect({ value, onChange, options, label, disabled }: { value: string; onChange: (v: string) => void; options: readonly (readonly [string, string])[]; label: string; disabled?: boolean }) {
  return (
    <div className="space-y-2">
      <Label className={cn(disabled && 'opacity-60')}>{label}</Label>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger className="h-10" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map(([v, l]) => (
            <SelectItem key={v} value={v} className={LEFT_CHECK_ITEM}>
              {l}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function RuleRowButton({ title, description, onClick, badge }: { title: string; description: ReactNode; onClick: () => void; badge?: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="flex min-h-14 w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-muted/20">
      <div className="min-w-0">
        <span className="block text-sm font-medium">{title}</span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">{description}</span>
      </div>
      <span className="flex shrink-0 items-center gap-2">
        {badge}
        <ChevronRight className="size-4 text-muted-foreground" />
      </span>
    </button>
  )
}

type SheetId = 'offTopic' | 'angry' | 'sales' | 'pronunciation' | 'custom' | null

/** Aba "Regras": Sistema (fixas), Suas regras, 4 folhas de regra e regras próprias — capturas app-03 / spec 07 [549]–[551]. */
export function RulesTab() {
  const { draft, update } = useAgentDraft()
  const rules = draft.rules
  const [sheet, setSheet] = useState<SheetId>(null)
  const [local, setLocal] = useState<AgentRules>(rules)
  const [customEditing, setCustomEditing] = useState<CustomRule | null>(null)
  const [pronErrors, setPronErrors] = useState(false)

  const open = (id: Exclude<SheetId, null>) => {
    // OBSERVADO (fonio-live2/C-assistentes/76): sem pronúncias, a folha abre só com o botão "Adicionar pronúncia"
    setLocal(JSON.parse(JSON.stringify(rules)) as AgentRules)
    setPronErrors(false)
    setSheet(id)
  }
  const applyRules = (patch: Partial<AgentRules>) => update((d) => ({ rules: { ...d.rules, ...patch } }))

  function saveSheet() {
    if (sheet === 'offTopic') applyRules({ offTopic: local.offTopic })
    if (sheet === 'angry') applyRules({ angry: local.angry })
    if (sheet === 'sales') applyRules({ sales: local.sales })
    if (sheet === 'pronunciation') {
      const partial = local.pronunciation.some((p) => !!p.term.trim() !== !!p.pronunciation.trim())
      if (partial) {
        setPronErrors(true)
        toast.error('Preencha a palavra e a pronúncia de cada linha (ou remova a linha).')
        return
      }
      applyRules({ pronunciation: local.pronunciation.filter((p) => p.term.trim()).map((p) => ({ ...p, term: p.term.trim(), pronunciation: p.pronunciation.trim() })) })
    }
    setSheet(null)
  }

  const status = (active: boolean) => (active ? 'Ativado' : 'Desativado')

  return (
    <div className="w-full">
      <SectionHeading>Regras</SectionHeading>
      <div className="flex flex-col gap-6">
        <section>
          <SectionLabel>Sistema</SectionLabel>
          <SettingsCard>
            {SYSTEM_RULES.map(([t, d]) => (
              <SettingsRow key={t} label={t} description={d}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex" tabIndex={0}>
                      <Switch checked disabled aria-label={t} />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>Parte fixa de todo assistente</TooltipContent>
                </Tooltip>
              </SettingsRow>
            ))}
          </SettingsCard>
        </section>

        <section>
          <SectionLabel>Suas regras</SectionLabel>
          <SettingsCard>
            <SettingsRow label="Aviso de IA" description="Se e quando o seu assistente menciona que é uma IA">
              <Select value={rules.aiDisclosure} onValueChange={(v) => applyRules({ aiDisclosure: v as AgentRules['aiDisclosure'] })}>
                <SelectTrigger aria-label="Aviso de IA" className="h-8 w-auto gap-1.5 rounded-lg text-[13px] shadow-none">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="start">
                  {AI_DISCLOSURE.map((o) => (
                    <SelectItem key={o.value} value={o.value} className={LEFT_CHECK_ITEM}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingsRow>
            <SettingsRow label="Estilo de comunicação" description="Tom com que o seu assistente se comunica">
              <Select value={rules.style} onValueChange={(v) => applyRules({ style: v as AgentRules['style'] })}>
                <SelectTrigger aria-label="Estilo de comunicação" className="h-8 w-auto gap-1.5 rounded-lg text-[13px] shadow-none">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="start">
                  {STYLES.map((o) => (
                    <SelectItem key={o.value} value={o.value} className={LEFT_CHECK_ITEM}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingsRow>
            <RuleRowButton title="Perguntas fora do tema e conversa informal" description={status(rules.offTopic.active)} onClick={() => open('offTopic')} />
            <RuleRowButton title="Pessoa irritada" description={status(rules.angry.active)} onClick={() => open('angry')} />
            <RuleRowButton title="Ligações de vendas e comparações com concorrentes" description={status(rules.sales.active)} onClick={() => open('sales')} />
            <RuleRowButton title="Pronúncia" description="Como o seu assistente pronuncia nomes de empresas e termos técnicos" onClick={() => open('pronunciation')} />
            {rules.custom.map((r) => (
              <RuleRowButton
                key={r.id}
                title={r.condition}
                description={r.instruction}
                onClick={() => {
                  setCustomEditing(r)
                  setSheet('custom')
                }}
                badge={!r.active ? <span className="rounded-md border px-2 py-0.5 text-xs text-muted-foreground">Desativada</span> : undefined}
              />
            ))}
            <button
              type="button"
              onClick={() => {
                setCustomEditing(null)
                setSheet('custom')
              }}
              className="flex w-full cursor-pointer flex-row items-center justify-center border-t px-5 py-4 font-medium first:border-0 last:rounded-b-xl hover:bg-gray-50"
            >
              <span className="flex items-center gap-2 rounded-lg px-3 text-sm font-medium leading-5 text-brand hover:brightness-90">
                <CirclePlus className="size-4" />
                Adicionar regra própria
              </span>
            </button>
          </SettingsCard>
        </section>
      </div>

      {/* Perguntas fora do tema e conversa informal */}
      <SideSheet
        open={sheet === 'offTopic'}
        onOpenChange={(o) => !o && setSheet(null)}
        title="Perguntas fora do tema e conversa informal"
        description="Defina como o seu assistente reage a perguntas que não têm a ver com a sua empresa."
        onSave={saveSheet}
      >
        <div className="flex flex-col gap-8">
          <SheetSwitchRow label="Regra ativa">
            <Switch checked={local.offTopic.active} onCheckedChange={(v) => setLocal((l) => ({ ...l, offTopic: { ...l.offTopic, active: v } }))} aria-label="Regra ativa" />
          </SheetSwitchRow>
          <section className="space-y-4">
            <SheetSectionTitle>Perguntas fora do tema</SheetSectionTitle>
            <OptionSelect label="Comportamento" value={local.offTopic.behavior} options={OFFTOPIC} onChange={(v) => setLocal((l) => ({ ...l, offTopic: { ...l.offTopic, behavior: v } }))} />
            <SheetSwitchRow label="Anotar a solicitação e oferecer o encaminhamento">
              <Switch checked={local.offTopic.noteAndOffer} onCheckedChange={(v) => setLocal((l) => ({ ...l, offTopic: { ...l.offTopic, noteAndOffer: v } }))} aria-label="Anotar a solicitação e oferecer o encaminhamento" />
            </SheetSwitchRow>
          </section>
          <section className="space-y-4">
            <SheetSectionTitle>Conversa informal</SheetSectionTitle>
            <OptionSelect label="Comportamento" value={local.offTopic.smallTalk} options={SMALLTALK} onChange={(v) => setLocal((l) => ({ ...l, offTopic: { ...l.offTopic, smallTalk: v } }))} />
          </section>
        </div>
      </SideSheet>

      {/* Pessoa irritada */}
      <SideSheet open={sheet === 'angry'} onOpenChange={(o) => !o && setSheet(null)} title="Pessoa irritada" description="Defina como o seu assistente lida com pessoas irritadas." onSave={saveSheet}>
        <div className="flex flex-col gap-8">
          <SheetSwitchRow label="Regra ativa">
            <Switch checked={local.angry.active} onCheckedChange={(v) => setLocal((l) => ({ ...l, angry: { ...l.angry, active: v } }))} aria-label="Regra ativa" />
          </SheetSwitchRow>
          <section className="space-y-4">
            <OptionSelect label="Com pessoas irritadas" value={local.angry.behavior} options={ANGRY} onChange={(v) => setLocal((l) => ({ ...l, angry: { ...l.angry, behavior: v } }))} />
            <SheetSwitchRow label="Oferecer transferência para um membro da equipe">
              <Switch checked={local.angry.offerTransfer} onCheckedChange={(v) => setLocal((l) => ({ ...l, angry: { ...l.angry, offerTransfer: v } }))} aria-label="Oferecer transferência para um membro da equipe" />
            </SheetSwitchRow>
          </section>
        </div>
      </SideSheet>

      {/* Vendas e concorrentes */}
      <SideSheet
        open={sheet === 'sales'}
        onOpenChange={(o) => !o && setSheet(null)}
        title="Ligações de vendas e comparações com concorrentes"
        description="Defina como o seu assistente reage a ligações de vendas e perguntas sobre concorrentes."
        onSave={saveSheet}
      >
        <div className="flex flex-col gap-8">
          <SheetSwitchRow label="Regra ativa">
            <Switch checked={local.sales.active} onCheckedChange={(v) => setLocal((l) => ({ ...l, sales: { ...l.sales, active: v } }))} aria-label="Regra ativa" />
          </SheetSwitchRow>
          <section className="space-y-4">
            <SheetSectionTitle>Ligações de vendas</SheetSectionTitle>
            <OptionSelect label="Reação" value={local.sales.reaction} options={SALES} onChange={(v) => setLocal((l) => ({ ...l, sales: { ...l.sales, reaction: v } }))} />
            <SheetSwitchRow label="Encerrar a ligação em seguida">
              <Switch checked={local.sales.hangUp} onCheckedChange={(v) => setLocal((l) => ({ ...l, sales: { ...l.sales, hangUp: v } }))} aria-label="Encerrar a ligação em seguida" />
            </SheetSwitchRow>
          </section>
          <section className="space-y-4">
            <SheetSectionTitle>Comparações com concorrentes</SheetSectionTitle>
            <SheetSwitchRow label="Tratar comparações com concorrentes">
              <Switch checked={local.sales.handleCompetitors} onCheckedChange={(v) => setLocal((l) => ({ ...l, sales: { ...l.sales, handleCompetitors: v } }))} aria-label="Tratar comparações com concorrentes" />
            </SheetSwitchRow>
            <OptionSelect
              label="Comportamento"
              disabled={!local.sales.handleCompetitors}
              value={local.sales.competitorBehavior}
              options={COMPETITORS}
              onChange={(v) => setLocal((l) => ({ ...l, sales: { ...l.sales, competitorBehavior: v } }))}
            />
          </section>
        </div>
      </SideSheet>

      {/* Pronúncia — OBSERVADO (fonio-live2/C-assistentes/76–77) */}
      <SideSheet
        open={sheet === 'pronunciation'}
        onOpenChange={(o) => !o && setSheet(null)}
        title="Pronúncia"
        description="Digite uma palavra e como ela deve ser falada (por exemplo, o nome de uma empresa). Coloque a transcrição fonética (IPA) entre barras, por exemplo /kloːel/."
        onSave={saveSheet}
      >
        <div className="flex flex-col items-start gap-2">
          {local.pronunciation.length > 0 && (
            <div className="flex w-full items-center gap-2 text-xs text-muted-foreground">
              <div className="grid flex-1 grid-cols-2 gap-2">
                <span>Palavra</span>
                <span>Pronunciada como</span>
              </div>
              <span className="w-[4.5rem] shrink-0" />
            </div>
          )}
          {local.pronunciation.map((p) => {
            const invalid = pronErrors && !!p.term.trim() !== !!p.pronunciation.trim()
            const setP = (patch: Partial<typeof p>) => setLocal((l) => ({ ...l, pronunciation: l.pronunciation.map((x) => (x.id === p.id ? { ...x, ...patch } : x)) }))
            return (
              <div key={p.id} className="flex w-full items-center gap-2">
                <div className="grid flex-1 grid-cols-2 gap-2">
                  <Input className="h-8" placeholder="Kloel" value={p.term} aria-label="Palavra" aria-invalid={invalid && !p.term.trim()} onChange={(e) => setP({ term: e.target.value })} />
                  <Input className="h-8" placeholder="Klohel ou /kloːel/" value={p.pronunciation} aria-label="Pronunciada como" aria-invalid={invalid && !p.pronunciation.trim()} onChange={(e) => setP({ pronunciation: e.target.value })} />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0 text-muted-foreground"
                  aria-label="Ouvir pronúncia"
                  disabled={!p.term.trim() && !p.pronunciation.trim()}
                  onClick={() => {
                    const spoken = p.pronunciation.trim() && !p.pronunciation.trim().startsWith('/') ? p.pronunciation : p.term
                    if (!speakPreview(spoken)) toast.error('Prévia de áudio indisponível neste navegador.')
                  }}
                >
                  <Volume2 className="size-4" />
                </Button>
                <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0" aria-label="Remover pronúncia" onClick={() => setLocal((l) => ({ ...l, pronunciation: l.pronunciation.filter((x) => x.id !== p.id) }))}>
                  <X className="size-4" />
                </Button>
              </div>
            )
          })}
          <Button
            type="button"
            variant="outline"
            className="h-9 px-3"
            onClick={() => setLocal((l) => ({ ...l, pronunciation: [...l.pronunciation, { id: uid('pr'), term: '', pronunciation: '' }] }))}
          >
            Adicionar pronúncia
          </Button>
        </div>
      </SideSheet>

      <CustomRuleSheet
        open={sheet === 'custom'}
        onOpenChange={(o) => !o && setSheet(null)}
        rule={customEditing}
        onSave={(r) => {
          update((d) => ({ rules: { ...d.rules, custom: d.rules.custom.some((x) => x.id === r.id) ? d.rules.custom.map((x) => (x.id === r.id ? r : x)) : [...d.rules.custom, r] } }))
          setSheet(null)
        }}
        onDelete={(id) => {
          update((d) => ({ rules: { ...d.rules, custom: d.rules.custom.filter((x) => x.id !== id) } }))
          setSheet(null)
        }}
      />
    </div>
  )
}

/** Folha "Adicionar regra própria" (Regra ativa, Condição, Instrução 0/1000) — spec 07 [551]. */
function CustomRuleSheet({
  open,
  onOpenChange,
  rule,
  onSave,
  onDelete,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  rule: CustomRule | null
  onSave: (r: CustomRule) => void
  onDelete: (id: string) => void
}) {
  const [active, setActive] = useState(true)
  const [condition, setCondition] = useState('')
  const [instruction, setInstruction] = useState('')
  const [errors, setErrors] = useState<{ condition?: string; instruction?: string }>({})
  const [confirm, setConfirm] = useState(false)

  useEffect(() => {
    if (open) {
      setActive(rule?.active ?? true)
      setCondition(rule?.condition ?? '')
      setInstruction(rule?.instruction ?? '')
      setErrors({})
    }
  }, [open, rule])

  function save() {
    const e: typeof errors = {}
    if (!condition.trim()) e.condition = 'A condição é obrigatória.'
    if (!instruction.trim()) e.instruction = 'A instrução é obrigatória.'
    else if (instruction.length > 1000) e.instruction = 'A instrução pode ter no máximo 1000 caracteres.'
    setErrors(e)
    if (Object.keys(e).length) return
    onSave({ id: rule?.id ?? uid('cr'), active, title: condition.trim(), condition: condition.trim(), instruction: instruction.trim() })
  }

  return (
    <>
      <SideSheet
        open={open}
        onOpenChange={onOpenChange}
        title={rule ? 'Editar regra própria' : 'Adicionar regra própria'}
        description="Descreva a situação e o que o seu assistente deve fazer nela."
        onSave={save}
        footerLeft={
          rule ? (
            <Button type="button" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setConfirm(true)}>
              Excluir regra
            </Button>
          ) : undefined
        }
      >
        <div className="flex flex-col gap-6">
          <SheetSwitchRow label="Regra ativa">
            <Switch checked={active} onCheckedChange={setActive} aria-label="Regra ativa" />
          </SheetSwitchRow>
          {/* [551]: rótulo em bloco, dica a 8px e campo a 6px da dica */}
          <div className="mt-1 space-y-2">
            <Label htmlFor="cr-condition" className="block">
              Condição
            </Label>
            <p className="text-xs text-muted-foreground">Formule a situação como uma frase completa, começando com “Se ...”</p>
            <Input
              className="!mt-1.5"
              id="cr-condition"
              placeholder="Se alguém perguntar sobre preços"
              value={condition}
              aria-invalid={!!errors.condition}
              onChange={(e) => {
                setCondition(e.target.value)
                setErrors((x) => ({ ...x, condition: undefined }))
              }}
            />
            <FieldError>{errors.condition}</FieldError>
          </div>
          <div className="mt-1 space-y-2">
            <Label htmlFor="cr-instruction" className="block">
              Instrução
            </Label>
            <p className="text-xs text-muted-foreground">O que o seu assistente deve fazer nessa situação</p>
            <Textarea
              id="cr-instruction"
              rows={5}
              maxLength={1000}
              className="!mt-1.5 min-h-[127px] resize-y"
              placeholder="Não informe valores específicos e ofereça enviar um orçamento por e-mail"
              value={instruction}
              aria-invalid={!!errors.instruction}
              onChange={(e) => {
                setInstruction(e.target.value)
                setErrors((x) => ({ ...x, instruction: undefined }))
              }}
            />
            <div className="!mt-1 flex items-start justify-between gap-2">
              <FieldError>{errors.instruction}</FieldError>
              <span className="ml-auto text-xs text-muted-foreground">{instruction.length}/1000</span>
            </div>
          </div>
        </div>
      </SideSheet>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        description="Esta regra própria será removida do assistente quando você salvar as alterações."
        confirmLabel="Excluir regra"
        onConfirm={() => { if (rule) onDelete(rule.id) }}
      />
    </>
  )
}
