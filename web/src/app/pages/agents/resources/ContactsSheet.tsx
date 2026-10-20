import { useState } from 'react'
import { toast } from 'sonner'
import '@/domain/ext/agents-resources'
import { useContactSettings } from '@/data/store'
import { SideSheet } from '@/components/app/SideSheet'
import { Switch } from '@/components/ui/switch'
import { SectionCaps, SheetFooter } from './shared/ui'
import { saveAgent } from './shared/hooks'
import type { ResourceProps } from './shared/listView'

/** Dados do contato que o assistente pode usar (fonio-live2 data/resources.json › "Conectar contatos"), na ordem da Fonio. */
const BASE_FIELDS = [
  { id: 'firstName', label: 'Nome' },
  { id: 'lastName', label: 'Sobrenome' },
  { id: 'company', label: 'Empresa' },
  { id: 'notes', label: 'Anotações' },
  { id: 'phones', label: 'Números de telefone' },
  { id: 'emails', label: 'Endereços de e-mail' },
]

/** Padrão da Fonio: tudo ligado exceto "Anotações". Campos inteligentes da organização (dado demo) entram ligados. */
const DEFAULT_FIELDS = (smartIds: string[]) => [...BASE_FIELDS.filter((f) => f.id !== 'notes').map((f) => f.id), ...smartIds]

/**
 * "Conectar contatos" (fonio-live2 C-assistentes/30 + data/resources.json): descrição, seção "DADOS QUE SEU ASSISTENTE ESTÁ
 * AUTORIZADO A USAR" (6 switches, linhas min-h-8 a cada 48px) e "AVANÇADO" com "Buscar contatos pelo número fixo" + ajuda.
 * Sem nenhum dado ligado o assistente não reconhece contatos e o cartão fica inativo (`contactsEnabled=false`).
 */
export function ContactsResource({ agent, open, onOpenChange }: ResourceProps) {
  const settings = useContactSettings()
  const smart = settings?.smartFields ?? []
  const smartIds = smart.map((f) => `smart:${f.id}`)
  // assistente desligado começa com tudo desligado; nunca configurado = padrão da Fonio ("Anotações" desligado)
  const [fields, setFields] = useState<string[]>(() => (!agent.contactsEnabled ? [] : (agent.contactAccess?.fields ?? DEFAULT_FIELDS(smartIds))))
  const [matchLandline, setMatchLandline] = useState(agent.contactAccess?.matchLandline ?? false)
  const enabled = fields.length > 0

  const toggle = (id: string, on: boolean) => setFields((prev) => (on ? [...new Set([...prev, id])] : prev.filter((x) => x !== id)))

  const save = async () => {
    try {
    await saveAgent(agent, () => ({ contactsEnabled: enabled, contactAccess: { fields, matchLandline } }))
    toast.success(enabled ? 'Contatos conectados ao assistente.' : 'Contatos desconectados do assistente.')
    onOpenChange(false)
      } catch (error) { toast.error('Não foi possível salvar', { description: error instanceof Error ? error.message : 'Confira o acesso e tente novamente.' }) }
  }

  const row = (id: string, label: string) => (
    <div key={id} className="flex min-h-8 items-center justify-between gap-4" data-testid={`contact-field-${id}`}>
      <label htmlFor={`cf-${id}`} className="min-w-0 cursor-pointer truncate text-sm font-medium leading-none">
        {label}
      </label>
      <Switch id={`cf-${id}`} checked={fields.includes(id)} onCheckedChange={(v) => toggle(id, v)} aria-label={label} />
    </div>
  )

  return (
    <SideSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Conectar contatos"
      description="Quando o assistente reconhece um chamador salvo nos seus contatos, ele pode usar os dados salvos para tornar a conversa mais pessoal."
      footer={<SheetFooter onSave={save} onCancel={() => onOpenChange(false)} />}
      contentClassName="pt-0 pb-0"
    >
      <div className="flex flex-col gap-8" data-testid="contacts-sheet">
        <div className="flex flex-col gap-4">
          <SectionCaps>Dados que seu assistente está autorizado a usar</SectionCaps>
          <div className="flex flex-col gap-4">
            {BASE_FIELDS.map((f) => row(f.id, f.label))}
            {smart.map((f) => row(`smart:${f.id}`, f.label))}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <SectionCaps className="pt-0">Avançado</SectionCaps>
          <div className="flex flex-col gap-1">
            <div className="flex min-h-8 items-center justify-between gap-4">
              <label htmlFor="cf-landline" className="cursor-pointer text-sm font-medium leading-none">
                Buscar contatos pelo número fixo
              </label>
              <Switch id="cf-landline" aria-label="Buscar contatos pelo número fixo" checked={matchLandline} disabled={!enabled} onCheckedChange={setMatchLandline} />
            </div>
            <p className="text-xs text-muted-foreground">
              Números fixos costumam ser usados por várias pessoas. Ativar esta opção pode associar o contato errado. Contatos nunca são criados automaticamente a partir de números fixos.
            </p>
          </div>
        </div>
      </div>
    </SideSheet>
  )
}
