import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, ChevronRight, Copy, ExternalLink, Plus } from 'lucide-react'
import { toast } from 'sonner'
import '@/domain/ext/mais-a'
import { cn } from '@/lib/utils'
import { useCollection, useEntity, useStore } from '@/data/store'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { WhatsAppIcon } from '@/components/brand/icons'
import { whatsappCommands } from '@/services/casca/whatsapp'
import { saveAgentFields } from '@/services/casca/agents'

export const STARTER_MAX = 200

/** Link wa.me do número com a mensagem inicial (OBSERVADO WA-02: "https://wa.me/<número>?text=…"). */
export function waLink(number: string, starter: string) {
  const digits = number.replace(/\D/g, '')
  if (!/^[1-9]\d{7,14}$/.test(digits)) return ''
  const text = starter.trim()
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ''}`
}

/**
 * "Números de WhatsApp deste assistente" (OBSERVADO: central de ajuda products/whatsapp, WA-02 e quadro de vídeo WA-V.6
 * "Activate WhatsApp"): marcar os números conectados que recebem mensagens para o assistente, links wa.me com copiar/abrir,
 * "Mensagem inicial" 0/200 e "Salvar números atribuídos". Grava WhatsAppAccount.agentId (+ número em Números de telefone)
 * e Agent.whatsappStarter.
 */
export function AssistantWhatsAppDialog({ agentId, open, onOpenChange }: { agentId?: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate()
  const agent = useEntity('agents', agentId)
  const agents = useCollection('agents')
  const accounts = useCollection('whatsappAccounts')
  const [checked, setChecked] = useState<string[]>([])
  const [starter, setStarter] = useState('')
  const [saving, setSaving] = useState(false)

  const initial = useMemo(() => accounts.filter((a) => a.agentId === agentId).map((a) => a.id), [accounts, agentId])
  useEffect(() => {
    if (open) {
      setChecked(initial)
      setStarter(agent?.whatsappStarter ?? 'Olá! Quero falar com alguém')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, agentId])

  if (!agent) return null
  const dirty = JSON.stringify([...checked].sort()) !== JSON.stringify([...initial].sort()) || starter !== (agent.whatsappStarter ?? 'Olá! Quero falar com alguém')

  const copy = async (v: string) => {
    try {
      await navigator.clipboard.writeText(v)
      toast.success('Link copiado')
    } catch {
      toast.error('Não foi possível copiar automaticamente', { description: 'Selecione o link e copie manualmente.' })
    }
  }

  async function save() {
    if (!agent || saving) return
    setSaving(true)
    try {
      const commands = whatsappCommands()
      for (const a of accounts) {
        const want = checked.includes(a.id)
        const next = want ? agent.id : a.agentId === agent.id ? undefined : a.agentId
        if (next !== a.agentId) await commands.assign(a, next ?? null)
      }
      if (starter.trim() !== (agent.whatsappStarter ?? 'Olá! Quero falar com alguém')) await saveAgentFields(agent, { whatsappStarter: starter.trim() })
      toast.success('Números de WhatsApp salvos', { description: checked.length ? `${checked.length} ${checked.length === 1 ? 'número atribuído' : 'números atribuídos'} a ${agent.name}` : `Nenhum número atribuído a ${agent.name}` })
      onOpenChange(false)
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Não foi possível salvar os números.'); }
    finally { setSaving(false) }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => !saving && onOpenChange(value)}>
      <DialogContent className="gap-0 p-0 sm:max-w-[672px]" onOpenAutoFocus={(e) => e.preventDefault()}>
        <div className="min-w-0 space-y-6 p-6 pt-12 sm:px-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
                <Check className="size-3.5" strokeWidth={3} />
              </span>
              <div className="min-w-0 space-y-1">
                <DialogTitle className="text-base font-semibold leading-6">Números de WhatsApp deste assistente</DialogTitle>
                <DialogDescription className="text-sm text-muted-foreground">Escolha quais números de WhatsApp recebem mensagens para {agent.name} e compartilhe os links wa.me.</DialogDescription>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 gap-1.5 self-start"
              onClick={() => {
                onOpenChange(false)
                navigate('/app/whatsapp?connect=1')
              }}
            >
              <Plus className="size-4" />
              Adicionar outro número de WhatsApp
            </Button>
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-sm font-medium">Atribuir números de WhatsApp</p>
                <p className="text-xs text-muted-foreground">Escolha um ou mais números de WhatsApp conectados para este assistente.</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  onOpenChange(false)
                  navigate('/app/whatsapp')
                }}
                className="inline-flex items-center gap-0.5 text-xs font-medium hover:underline"
              >
                Gerenciar perfis de número
                <ChevronRight className="size-3.5" />
              </button>
            </div>
            {accounts.length === 0 ? (
              <div className="flex items-center gap-3 rounded-lg border bg-background px-4 py-4 text-sm">
                <WhatsAppIcon className="size-4 text-emerald-600" />
                <span className="text-muted-foreground">Nenhum número de WhatsApp conectado. Use “Adicionar outro número de WhatsApp” para conectar.</span>
              </div>
            ) : (
              accounts.map((a) => {
                const on = checked.includes(a.id)
                const other = a.agentId && a.agentId !== agent.id ? agents.find((x) => x.id === a.agentId)?.name : undefined
                const link = waLink(a.number, starter)
                return (
                  <div key={a.id} className={cn('flex flex-col gap-2 rounded-lg border bg-background px-3 py-2.5 sm:flex-row sm:items-center', on && 'border-foreground/20')} data-testid="wa-assign-row">
                    <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
                      <Checkbox
                        className="mt-0.5"
                        checked={on}
                        disabled={saving}
                        aria-label={`Atribuir ${a.number}`}
                        onCheckedChange={(v) => setChecked((c) => (v ? [...c, a.id] : c.filter((x) => x !== a.id)))}
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{a.businessName}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {a.number} · {a.businessName}
                        </span>
                        {other && <span className="block text-xs text-amber-700">{on ? `Será transferido de ${other} para ${agent.name}` : `Atribuído a ${other}`}</span>}
                      </span>
                    </label>
                    <div className="flex min-w-0 items-center gap-1 sm:w-[55%] sm:shrink-0">
                      <span className="min-w-0 flex-1 truncate font-mono text-xs text-blue-600" title={link} data-testid="wa-link">
                        {link}
                      </span>
                      <Button type="button" variant="ghost" size="icon-xs" disabled={!link} aria-label={`Copiar link de ${a.number}`} onClick={() => copy(link)}>
                        <Copy className="size-3.5" />
                      </Button>
                      <Button asChild variant="ghost" size="icon-xs" aria-label={`Abrir link de ${a.number}`}>
                        <a href={link || undefined} aria-disabled={!link || undefined} target="_blank" rel="noreferrer">
                          <ExternalLink className="size-3.5" />
                        </a>
                      </Button>
                    </div>
                  </div>
                )
              })
            )}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="wa-starter" className="text-sm font-medium">
              Mensagem inicial
            </label>
            <Textarea id="wa-starter" rows={3} maxLength={STARTER_MAX} value={starter} disabled={saving} onChange={(e) => setStarter(e.target.value.slice(0, STARTER_MAX))} placeholder="Olá! Quero falar com alguém" />
            <p className="text-right text-xs tabular-nums text-muted-foreground" data-testid="wa-starter-count">
              {starter.length}/{STARTER_MAX}
            </p>
          </div>

          <div className="flex justify-end">
            <Button onClick={save} disabled={!dirty || saving}>
              Salvar números atribuídos
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
