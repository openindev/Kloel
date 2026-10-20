import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Headset, Phone, MessageCircle, MessageSquare } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import type { AgentType } from '@/domain/types'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { IntegrationLogo } from '@/components/brand/IntegrationLogo'
import { SimpleTooltip } from '@/components/ui/tooltip'
import { useStore, useCurrentOrg } from '@/data/store'
import { makeAgent } from '@/data/seed/defaults'
import { agentCommands } from '@/services/casca/agents'
import { FieldError } from './ui'

/** Diálogo "Criar assistente" (botão "+", "Novo assistente" do seletor, cartão promocional e estado vazio). */
export function CreateAgentDialog({ open, onOpenChange, initialType = 'voice' }: { open: boolean; onOpenChange: (o: boolean) => void; initialType?: AgentType }) {
  const navigate = useNavigate()
  const org = useCurrentOrg()
  const [type, setType] = useState<AgentType>(initialType)
  const [name, setName] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const pending = useRef(false), mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  useEffect(() => {
    if (open) {
      setType(initialType)
      setName('')
      setError(undefined)
    }
  }, [open, initialType])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (pending.current) return
    const n = name.trim()
    if (!n) return setError('O nome é obrigatório.')
    if (n.length > 60) return setError('O nome pode ter no máximo 60 caracteres.')
    if (!org) return
    pending.current = true; setBusy(true); setError(undefined)
    try {
      const draft = makeAgent(org.id, n, type, org.name)
      draft.technical.preciseExtraction = []
      const created = await agentCommands('create').create(draft)
      if (!mounted.current || useStore.getState().db.session.orgId !== org.id) return
      useStore.getState().insert('agents', created)
      onOpenChange(false)
      toast.success('Assistente criado', { description: `${created.name} foi adicionado à lista de assistentes.` })
      navigate(`/app/agents/${created.id}/general`)
    } catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : 'Não foi possível criar o assistente.') }
    finally { pending.current = false; if (mounted.current) setBusy(false) }
  }

  const cardCls = (selected: boolean) =>
    cn(
      'relative flex h-full min-h-[140px] cursor-pointer flex-col gap-2 rounded-xl p-4 text-left transition-[border-color,background-color,box-shadow] duration-150 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
      selected ? 'border-2 border-primary bg-[hsl(var(--primary)/0.04)]' : 'border-[1.5px] border-border hover:border-foreground/30',
    )

  return (
    <Dialog open={open} onOpenChange={(value) => !pending.current && onOpenChange(value)}>
      <DialogContent className="max-h-screen gap-y-8 overflow-y-auto border-0 sm:max-w-[860px]">
        <DialogHeader>
          <DialogTitle>Criar assistente</DialogTitle>
        </DialogHeader>
        <form className="flex flex-col gap-6" onSubmit={submit} noValidate>
          <div className="space-y-1">
            <Label id="assistant-type-label">Tipo de assistente</Label>
            <div role="radiogroup" aria-labelledby="assistant-type-label" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className={cardCls(type === 'voice')}>
                <input type="radio" name="assistant-type" value="voice" className="peer sr-only" checked={type === 'voice'} onChange={() => setType('voice')} />
                <span className="flex items-center gap-2">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-sky-700">
                    <Phone className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 truncate whitespace-nowrap text-[15px] font-semibold leading-5">Assistente de voz</span>
                </span>
                <span className="line-clamp-2 text-[13px] leading-5 text-muted-foreground">Assistente baseado em telefone para chamadas.</span>
              </label>
              <label className={cardCls(type === 'chat')}>
                <input type="radio" name="assistant-type" value="chat" className="peer sr-only" checked={type === 'chat'} onChange={() => setType('chat')} />
                <span className="flex items-center gap-2">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-500/10 text-violet-700">
                    <MessageCircle className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 truncate whitespace-nowrap text-[15px] font-semibold leading-5">Assistente de chat</span>
                </span>
                <span className="line-clamp-2 text-[13px] leading-5 text-muted-foreground">Assistente baseado em chat para:</span>
                {/* OBSERVADO (fonio-live2/C-assistentes/05–06): selos com tooltip preto com o nome */}
                <span className="mt-auto flex items-center gap-2 pt-1">
                  <SimpleTooltip label="WhatsApp" side="top">
                    <span role="img" aria-label="WhatsApp" className="flex h-7 items-center gap-1.5 rounded-lg bg-[#25D366]/15 px-2 text-green-700">
                      <IntegrationLogo slug="whatsapp-business" name="WhatsApp" surface="app" decorative className="h-4 w-4" />
                      <span className="text-xs font-medium">WhatsApp</span>
                    </span>
                  </SimpleTooltip>
                  <SimpleTooltip label="Chatbot de IA" side="top">
                    <span role="img" aria-label="Chatbot de IA" className="flex h-7 items-center gap-1.5 rounded-lg bg-violet-500/10 px-2 text-violet-700">
                      <MessageSquare className="h-4 w-4" />
                      <span className="text-xs font-medium">Chatbot de IA</span>
                    </span>
                  </SimpleTooltip>
                </span>
              </label>
              <label className={cardCls(type === 'omni')}>
                <input type="radio" name="assistant-type" value="omni" className="peer sr-only" checked={type === 'omni'} onChange={() => setType('omni')} />
                <span className="flex items-center gap-2">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-700">
                    <Headset className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 truncate whitespace-nowrap text-[15px] font-semibold leading-5">Chat + Ligação</span>
                </span>
                <span className="line-clamp-3 text-[13px] leading-5 text-muted-foreground">O mesmo assistente no WhatsApp, no chatbot e no telefone.</span>
              </label>
            </div>
          </div>
          <div className="grid flex-1 gap-2 space-y-1">
            <Label htmlFor="new-agent-name">Nome</Label>
            <Input
              id="new-agent-name"
              value={name}
              aria-invalid={!!error}
              placeholder={type === 'voice' ? 'Roberta' : type === 'omni' ? 'Ana' : 'Maria'}
              onChange={(e) => {
                setName(e.target.value)
                if (error) setError(undefined)
              }}
            />
            <FieldError>{error}</FieldError>
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={busy}>{busy ? 'Criando…' : 'Criar assistente'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
