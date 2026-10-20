import { useState } from 'react'
import { toast } from 'sonner'
import '@/domain/ext/agents-resources'
import type { ActiveWindow } from '@/domain/ext/agents-resources'
import { SideSheet } from '@/components/app/SideSheet'
import { ConfirmDialog } from '@/components/app/ConfirmDialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ChipsInput, DeleteFooterButton, EditableTitle, Field, SheetFooter } from './shared/ui'
import { WindowControl } from './shared/timing'
import { saveAgent, useErrors, useHoursDraft } from './shared/hooks'
import type { ResourceProps } from './shared/listView'

function normalizeUrl(v: string) {
  const t = v.trim()
  if (!t) return t
  return /^https?:\/\//i.test(t) ? t : `https://${t}`
}

function urlError(v: string, all: string[]) {
  try {
    const u = new URL(v)
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.')) return `URL inválida: ${v}`
  } catch {
    return `URL inválida: ${v}`
  }
  if (all.includes(v)) return 'Este site já foi adicionado.'
  if (all.length >= 20) return 'Você pode adicionar até 20 sites.'
  return undefined
}

/**
 * "Pesquisa na web" (fonio-live2 C-assistentes/54 + data/resources.json): título com ✎, Ativo, Usar para, Sites (Enter confirma),
 * Ao pesquisar, dizer. Salvar ativa o recurso; com o recurso ativo, "Desativar" (rodapé esquerdo) o remove com confirmação.
 */
export function WebSearchResource({ agent, open, onOpenChange }: ResourceProps) {
  const ws = agent.webSearch
  const hours = useHoursDraft(agent)
  const { errors, setErrors, clear } = useErrors<'instruction' | 'sites' | 'window'>()
  const [name, setName] = useState(ws.name ?? 'Pesquisa na web')
  const [win, setWin] = useState<ActiveWindow>(ws.activeWindow ?? 'any')
  const [instruction, setInstruction] = useState(ws.instruction)
  const [sites, setSites] = useState<string[]>(ws.allowedDomains)
  const [pending, setPending] = useState('')
  const [phrase, setPhrase] = useState(ws.searchingPhrase ?? '')
  const [confirmOff, setConfirmOff] = useState(false)

  const save = async () => {
    try {
    const e: typeof errors = {}
    let finalSites = sites
    // texto digitado e não confirmado com Enter também entra (mesma regra do campo: espaços separam entradas)
    for (const part of pending.split(/\s+/).map(normalizeUrl).filter(Boolean)) {
      const err = urlError(part, finalSites)
      if (err) {
        e.sites = err
        break
      }
      finalSites = [...finalSites, part]
    }
    if (!instruction.trim()) e.instruction = 'Descreva quando o assistente deve consultar os sites.'
    if (!finalSites.length && !e.sites) e.sites = 'Adicione pelo menos um site e confirme com Enter.'
    if (win !== 'any' && !hours.configured) e.window = 'Configure o horário de funcionamento para usar esta opção.'
    setErrors(e)
    if (Object.values(e).some(Boolean)) {
      toast.error('Corrija os campos destacados.')
      return
    }
    await saveAgent(agent, () => ({
      webSearch: { ...ws, enabled: true, name: name.trim() || 'Pesquisa na web', activeWindow: win, instruction: instruction.trim(), allowedDomains: finalSites, searchingPhrase: phrase.trim() },
      ...(hours.changed ? { businessHours: hours.hours } : {}),
    }))
    toast.success(ws.enabled ? 'Pesquisa na web atualizada.' : 'Pesquisa na web ativada.')
    onOpenChange(false)
      } catch (error) { toast.error('Não foi possível salvar', { description: error instanceof Error ? error.message : 'Confira o acesso e tente novamente.' }) }
  }

  return (
    <SideSheet
      open={open}
      onOpenChange={onOpenChange}
      title={<EditableTitle value={name} onChange={setName} />}
      footer={<SheetFooter onSave={save} onCancel={() => onOpenChange(false)} left={ws.enabled && <DeleteFooterButton label="Desativar" onClick={() => setConfirmOff(true)} />} />}
      contentClassName="pb-0"
    >
      {/* ref. 535: 1º rótulo 3px acima do padrão do painel, 22px entre campos e "Usar para" com 80px */}
      <div className="-mt-[3px] flex flex-col gap-[22px]" data-testid="websearch-sheet">
        <Field label="Ativo" htmlFor="ws-window" error={errors.window}>
          <WindowControl id="ws-window" value={win} onChange={(v) => (setWin(v), clear('window'))} hoursConfigured={hours.configured} onConfigure={hours.openSheet} />
        </Field>
        <Field label="Usar para" htmlFor="ws-use" error={errors.instruction}>
          <Textarea
            id="ws-use"
            value={instruction}
            onChange={(e) => (setInstruction(e.target.value), clear('instruction'))}
            placeholder="perguntas sobre produtos, ex.: preços e variantes"
            aria-invalid={!!errors.instruction || undefined}
            className="min-h-20"
          />
        </Field>
        <Field
          label="Sites"
          hint={
            <>
              A IA lê exatamente essas páginas ao vivo durante a conversa – não consegue navegar pelo site, seguir links nem pesquisar na web. Confirme cada entrada com <b className="text-foreground">Enter</b>.
            </>
          }
          error={errors.sites}
        >
          <ChipsInput
            ariaLabel="Sites"
            values={sites}
            onChange={(v) => (setSites(v), clear('sites'))}
            onPendingChange={setPending}
            placeholder="https://exemplo.com/pagina"
            normalize={normalizeUrl}
            validate={urlError}
            // URLs podem conter vírgulas (ex.: ?q=a,b): só Enter confirma e só espaço/quebra de linha separa entradas coladas
            separator={/\s+/}
            commaConfirms={false}
            invalid={!!errors.sites}
            // ref. WS-03: chips cinza com texto semibold e ×
            chipClassName="rounded-full px-2.5 text-xs font-semibold"
            keepPlaceholder
          />
        </Field>
        <Field label="Ao pesquisar, dizer" htmlFor="ws-say" hint="Deixe vazio para ficar em silêncio.">
          <Input id="ws-say" value={phrase} onChange={(e) => setPhrase(e.target.value)} placeholder="Um momento, estou verificando." />
        </Field>
      </div>
      {hours.sheet}
      <ConfirmDialog
        open={confirmOff}
        onOpenChange={setConfirmOff}
        title="Desativar pesquisa na web?"
        description="O assistente deixará de consultar os sites durante as conversas. Os sites configurados são mantidos."
        confirmLabel="Desativar"
        onConfirm={async () => {
          await saveAgent(agent, (a) => ({ webSearch: { ...a.webSearch, enabled: false } }))
          toast.success('Pesquisa na web desativada.')
          onOpenChange(false)
        }}
      />
    </SideSheet>
  )
}
