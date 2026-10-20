import { useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { ShieldCheck } from 'lucide-react'
import type { Contact } from '@/domain/types'
import type { PermissionInput, PermissionState } from '@/services/engine/crm'
import { usePermission } from '@/services/engine/session'
import { loadContactPermissions, recordContactPermission } from '@/services/casca/contacts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const CHANNEL: Record<PermissionInput['channel'], string> = { whatsapp: 'WhatsApp', phone: 'Ligações', email: 'E-mail' }
const PURPOSE: Record<PermissionInput['purpose'], string> = { service: 'Atendimento', marketing: 'Marketing' }

/**
 * "Consentimento" (LGPD): decisões registradas por destino (telefone/e-mail) e finalidade, sempre com a evidência
 * informada por quem registrou. O registro não envia mensagens; ele documenta a permissão da pessoa.
 */
export function ContactConsent({ contact }: { contact: Contact }) {
  const canRecord = usePermission('contacts:consent')
  const [state, setState] = useState<PermissionState | null>(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<{ channel: PermissionInput['channel']; identifier: string; purpose: PermissionInput['purpose']; event: PermissionInput['event']; source: string; occurredAt: string }>({ channel: 'whatsapp', identifier: '', purpose: 'service', event: 'granted', source: '', occurredAt: '' })
  const revision = (contact as { updatedAt?: string }).updatedAt
  useEffect(() => {
    let active = true
    setError('')
    loadContactPermissions(contact.id).then((value) => active && setState(value), (e) => active && setError(e instanceof Error ? e.message : 'Não foi possível consultar os consentimentos.'))
    return () => { active = false }
  }, [contact.id, revision])
  const destinations = useMemo(() => (form.channel === 'email' ? contact.emails : contact.phones).map((d) => d.value), [contact, form.channel])
  const start = () => {
    const channel = contact.phones.length ? 'whatsapp' : 'email'
    const first = (channel === 'email' ? contact.emails : contact.phones)[0]?.value ?? ''
    setForm({ channel, identifier: first, purpose: 'service', event: 'granted', source: '', occurredAt: format(new Date(), "yyyy-MM-dd'T'HH:mm") })
    setOpen(true)
  }
  const save = async () => {
    if (saving) return
    if (!form.identifier) return toast.error('Escolha o telefone ou e-mail do contato.')
    if (!form.source.trim()) return toast.error('Informe como a pessoa deu ou retirou o consentimento.')
    const when = new Date(form.occurredAt)
    if (Number.isNaN(when.getTime())) return toast.error('Informe a data e a hora da decisão.')
    setSaving(true)
    try {
      // O motor exige telefone internacional: "+55 (62) 9..." vira "+55629...".
      const identifier = form.channel === 'email' ? form.identifier.trim() : '+' + form.identifier.replace(/\D/g, '')
      await recordContactPermission(contact.id, { channel: form.channel, identifier, purpose: form.purpose, event: form.event, occurredAt: when.toISOString(), source: form.source.trim() })
      toast.success(form.event === 'granted' ? 'Consentimento registrado' : 'Revogação registrada')
      setOpen(false)
      setState(await loadContactPermissions(contact.id))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível registrar o consentimento.')
    } finally {
      setSaving(false)
    }
  }
  const items = state?.items ?? []
  return (
    <section aria-label="Consentimento">
      <div className="mb-3 flex items-center justify-between gap-2 px-3">
        <p className="text-xs font-medium text-muted-foreground">Consentimento (LGPD)</p>
        {canRecord && (contact.phones.length > 0 || contact.emails.length > 0) && (
          <Button variant="ghost" size="xs" className="h-6 gap-1 text-[11.5px] text-brand" onClick={start}>
            <ShieldCheck className="h-3 w-3" /> Registrar decisão
          </Button>
        )}
      </div>
      <div className="overflow-hidden rounded-lg border bg-white" data-testid="contact-consent">
        {error ? (
          <p className="px-5 py-3 text-xs text-muted-foreground">{error}</p>
        ) : !state ? (
          <p className="px-5 py-3 text-xs text-muted-foreground">Consultando…</p>
        ) : items.length === 0 ? (
          <p className="px-5 py-3 text-xs text-muted-foreground">Nenhuma decisão registrada. O cadastro sozinho não concede permissão de contato.</p>
        ) : (
          items.map((item) => (
            <div key={`${item.channel}:${item.identifier}:${item.purpose}`} className="flex min-h-[52px] items-center gap-3 border-b py-2.5 pl-5 pr-6 last:border-b-0">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{CHANNEL[item.channel as PermissionInput['channel']] ?? item.channel} · {PURPOSE[item.purpose as PermissionInput['purpose']] ?? item.purpose}</span>
                <span className="block truncate text-[11.5px] text-muted-foreground" title={item.source}>
                  {item.identifier}
                  {item.occurredAt ? ` · ${format(new Date(item.occurredAt), 'dd/MM/yyyy HH:mm')}` : ''}
                  {item.source ? ` · ${item.source}` : ''}
                </span>
              </span>
              <span className={item.effective ? 'shrink-0 rounded bg-green-50 px-1.5 py-0.5 text-[10.5px] font-medium text-green-700' : 'shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10.5px] font-medium text-muted-foreground'}>
                {item.status === 'granted' ? (item.destinationPresent ? 'Concedido' : 'Destino removido') : 'Revogado'}
              </span>
            </div>
          ))
        )}
      </div>
      <Dialog open={open} onOpenChange={(o) => !saving && setOpen(o)}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>Registrar consentimento</DialogTitle>
            <DialogDescription>Documente a decisão da pessoa. Nada é enviado ao contato.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-normal">Canal</Label>
                <Select value={form.channel} onValueChange={(v) => { const channel = v as PermissionInput['channel']; setForm((f) => ({ ...f, channel, identifier: (channel === 'email' ? contact.emails : contact.phones)[0]?.value ?? '' })) }}>
                  <SelectTrigger aria-label="Canal"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(['whatsapp', 'phone', 'email'] as const).filter((c) => (c === 'email' ? contact.emails : contact.phones).length).map((c) => <SelectItem key={c} value={c}>{CHANNEL[c]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-normal">Destino</Label>
                <Select value={form.identifier} onValueChange={(identifier) => setForm((f) => ({ ...f, identifier }))}>
                  <SelectTrigger aria-label="Destino"><SelectValue placeholder="Escolha" /></SelectTrigger>
                  <SelectContent>{destinations.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-normal">Finalidade</Label>
                <Select value={form.purpose} onValueChange={(v) => setForm((f) => ({ ...f, purpose: v as PermissionInput['purpose'] }))}>
                  <SelectTrigger aria-label="Finalidade"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="service">Atendimento</SelectItem><SelectItem value="marketing">Marketing</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-normal">Decisão</Label>
                <Select value={form.event} onValueChange={(v) => setForm((f) => ({ ...f, event: v as PermissionInput['event'] }))}>
                  <SelectTrigger aria-label="Decisão"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="granted">Concedeu</SelectItem><SelectItem value="revoked">Revogou</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="consent-when" className="text-xs font-normal">Quando</Label>
              <Input id="consent-when" type="datetime-local" value={form.occurredAt} onChange={(e) => setForm((f) => ({ ...f, occurredAt: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="consent-source" className="text-xs font-normal">Como foi a decisão (evidência)</Label>
              <Input id="consent-source" value={form.source} maxLength={500} placeholder="ex.: Pediu por WhatsApp para receber lembretes de consulta." onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" disabled={saving} onClick={() => setOpen(false)}>Cancelar</Button>
            <Button disabled={saving} onClick={() => void save()}>Registrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
