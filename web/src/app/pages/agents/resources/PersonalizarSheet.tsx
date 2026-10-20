import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { Agent, IntegrationAction } from '@/domain/types'
import { uid } from '@/lib/utils'
import { SideSheet } from '@/components/app/SideSheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { FieldRow, SheetFooter } from './shared/ui'
import { saveAgent, upsert } from './shared/hooks'
import { loadCommercial, saveCommercial, testCommercial, type CommercialProfile } from '@/services/casca/commercial'

const empty = {
  platformName: '', baseUrl: '', authType: 'bearer' as CommercialProfile['authType'], apiKeyHeader: 'X-Api-Key', secret: '', username: '', tokenUrl: '', clientId: '',
  actions: 'POST /orders | Cria o pedido quando a pessoa confirma | sim',
  maxDiscountPercent: '10', tiers: '7 5\n30 10', gifts: '', returnPolicy: '', contactFrom: '09:00', contactTo: '18:00', cadencePerDay: '1', maxAttempts: '5', offers: '', autoContact: false,
  fieldMap: 'nome=customer.name\ncpf=customer.document\ntelefone=customer.phone\nendereco=customer.address\nproduto=item.name\nvalor=item.amount\ndata=order.date\nstatus=order.status',
  pagarmeAccount: '', pagarmeMode: 'test' as 'test' | 'live', pagarmeSecret: '',
}

function parseActions(text: string) {
  return text.split('\n').map(line => line.trim()).filter(Boolean).map(line => {
    const [left, description = '', confirm = ''] = line.split('|').map(part => part.trim())
    const [method, ...path] = left.split(/\s+/)
    return { name: `${method} ${path.join(' ')}`.slice(0, 80), method: method.toUpperCase(), path: path.join(' ') || '/', description, confirm: /^s|sim|true|1/i.test(confirm) }
  }).filter(row => ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(row.method) && row.path.startsWith('/'))
}

/** Credenciais ficam cifradas no motor. O editor do assistente só guarda o nome, sem segredo. */
export function PersonalizarSheet({ agent, target, open, onOpenChange, onDone }: { agent: Agent; target?: IntegrationAction; open: boolean; onOpenChange: (open: boolean) => void; onDone: () => void }) {
  const [form, setForm] = useState(empty)
  const [inbound, setInbound] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (key: keyof typeof empty, value: string | boolean) => setForm(current => ({ ...current, [key]: value }))

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void loadCommercial(agent.id).then(result => {
      if (cancelled || !result.profile) return
      const profile = result.profile
      setForm(current => ({
        ...current,
        platformName: profile.platformName, baseUrl: profile.baseUrl, authType: profile.authType, apiKeyHeader: profile.apiKeyHeader || 'X-Api-Key', secret: '',
        actions: profile.actions.map(action => `${action.method} ${action.path} | ${action.description} | ${action.confirm ? 'sim' : 'nao'}`).join('\n'),
        maxDiscountPercent: String(profile.rules.maxDiscountPercent), tiers: profile.rules.tiers.map(tier => `${tier.days} ${tier.percent}`).join('\n'),
        gifts: profile.rules.gifts, returnPolicy: profile.rules.returnPolicy, contactFrom: profile.rules.contactFrom, contactTo: profile.rules.contactTo,
        cadencePerDay: String(profile.rules.cadencePerDay), maxAttempts: String(profile.rules.maxAttempts), offers: profile.rules.offers, autoContact: profile.rules.autoContact,
        fieldMap: Object.entries(profile.rules.fieldMap).map(([key, value]) => `${key}=${value}`).join('\n'),
        pagarmeAccount: profile.pagarme.accountId, pagarmeMode: profile.pagarme.mode, pagarmeSecret: '',
      }))
      setInbound(`${window.location.origin}${profile.inboundPath}`)
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [open, agent.id])

  async function save() {
    const actions = parseActions(form.actions)
    if (!form.platformName.trim() || !form.baseUrl.trim()) return toast.error('Informe o nome da plataforma e a URL base HTTPS.')
    if (!actions.length) return toast.error('Descreva ao menos uma ação: MÉTODO /caminho | descrição | sim')
    setBusy(true)
    try {
      const fieldMap = Object.fromEntries(form.fieldMap.split('\n').map(line => line.split('=')).filter(pair => pair[0]?.trim() && pair[1]?.trim()).map(([key, ...value]) => [key.trim(), value.join('=').trim()]))
      const tiers = form.tiers.split('\n').map(line => line.trim().split(/\s+/)).filter(pair => pair.length >= 2).map(([days, percent]) => ({ days: Number(days), percent: Number(percent) })).filter(tier => Number.isFinite(tier.days) && Number.isFinite(tier.percent))
      const saved = await saveCommercial(agent.id, {
        platformName: form.platformName.trim(), baseUrl: form.baseUrl.trim(), authType: form.authType, apiKeyHeader: form.apiKeyHeader.trim() || 'X-Api-Key',
        ...(form.secret.trim() ? { secret: form.secret } : {}), ...(form.username.trim() ? { username: form.username.trim() } : {}), ...(form.tokenUrl.trim() ? { tokenUrl: form.tokenUrl.trim() } : {}), ...(form.clientId.trim() ? { clientId: form.clientId.trim() } : {}),
        actions, rules: { maxDiscountPercent: Number(form.maxDiscountPercent) || 0, tiers, gifts: form.gifts, returnPolicy: form.returnPolicy, contactFrom: form.contactFrom, contactTo: form.contactTo, cadencePerDay: Number(form.cadencePerDay) || 0, maxAttempts: Number(form.maxAttempts) || 1, offers: form.offers, autoContact: form.autoContact, fieldMap },
        pagarme: { accountId: form.pagarmeAccount.trim(), mode: form.pagarmeMode, ...(form.pagarmeSecret.trim() ? { secretKey: form.pagarmeSecret } : {}) },
      })
      const row: IntegrationAction = { id: target?.id ?? uid('int'), integration: 'personalizar', name: form.platformName.trim(), timing: 'during', config: {}, connected: true, description: 'Plataforma conectada. Segredos ficam só no motor.' }
      await saveAgent(agent, () => ({ integrations: upsert(agent.integrations, row) }))
      if (saved.inboundSecret) setInbound(`${window.location.origin}${saved.profile.inboundPath}\nSegredo (guarde agora): ${saved.inboundSecret}`)
      toast.success('Personalizar salvo')
      onDone()
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Não foi possível salvar') }
    finally { setBusy(false) }
  }

  return (
    <SideSheet open={open} onOpenChange={onOpenChange} width={768} title="Personalizar" description={<span>Conecte qualquer plataforma. O cartão nunca é digitado aqui: a ligação envia um link da Pagar.me no WhatsApp.</span>} footer={<SheetFooter onSave={() => void save()} onCancel={onDone} saveLabel={busy ? 'Salvando…' : 'Salvar'} />}>
      <div className="flex flex-col gap-4">
        <FieldRow label="Plataforma"><Input value={form.platformName} onChange={event => set('platformName', event.target.value)} placeholder="Minha loja" /></FieldRow>
        <FieldRow label="URL base"><Input value={form.baseUrl} onChange={event => set('baseUrl', event.target.value)} placeholder="https://api.loja.com.br" /></FieldRow>
        <FieldRow label="Autenticação">
          <select aria-label="Autenticação" className="h-10 rounded-md border bg-background px-3 text-sm" value={form.authType} onChange={event => set('authType', event.target.value)}>
            <option value="api_key">Chave no cabeçalho</option>
            <option value="bearer">Bearer</option>
            <option value="basic">Basic</option>
            <option value="oauth2">OAuth2 client credentials</option>
          </select>
        </FieldRow>
        {form.authType === 'api_key' && <FieldRow label="Cabeçalho"><Input value={form.apiKeyHeader} onChange={event => set('apiKeyHeader', event.target.value)} /></FieldRow>}
        {form.authType === 'basic' && <FieldRow label="Usuário"><Input value={form.username} onChange={event => set('username', event.target.value)} /></FieldRow>}
        {form.authType === 'oauth2' && <FieldRow label="Token URL"><Input value={form.tokenUrl} onChange={event => set('tokenUrl', event.target.value)} placeholder="https://auth.loja.com.br/token" /></FieldRow>}
        {form.authType === 'oauth2' && <FieldRow label="Client ID"><Input value={form.clientId} onChange={event => set('clientId', event.target.value)} /></FieldRow>}
        <FieldRow label="Segredo"><Input type="password" value={form.secret} onChange={event => set('secret', event.target.value)} placeholder="Deixe em branco para manter o segredo já salvo" autoComplete="off" /></FieldRow>
        <FieldRow label="Ações">
          <Textarea value={form.actions} onChange={event => set('actions', event.target.value)} className="min-h-[96px] font-mono text-xs" />
          <p className="text-sm text-muted-foreground">Uma por linha: MÉTODO /caminho | descrição | sim (se a IA precisar confirmar). A resposta volta para a conversa.</p>
        </FieldRow>
        <FieldRow label="Mapeamento"><Textarea value={form.fieldMap} onChange={event => set('fieldMap', event.target.value)} className="min-h-[88px] font-mono text-xs" /></FieldRow>
        <FieldRow label="Desconto máximo (%)"><Input value={form.maxDiscountPercent} onChange={event => set('maxDiscountPercent', event.target.value)} /></FieldRow>
        <FieldRow label="Faixas (dias %)"><Textarea value={form.tiers} onChange={event => set('tiers', event.target.value)} className="min-h-[64px] font-mono text-xs" /></FieldRow>
        <FieldRow label="Ofertas e brindes"><Input value={form.offers} onChange={event => set('offers', event.target.value)} /></FieldRow>
        <FieldRow label="Brindes"><Input value={form.gifts} onChange={event => set('gifts', event.target.value)} /></FieldRow>
        <FieldRow label="Devolução e cancelamento"><Textarea value={form.returnPolicy} onChange={event => set('returnPolicy', event.target.value)} /></FieldRow>
        <FieldRow label="Horário de contato">
          <div className="flex gap-2"><Input value={form.contactFrom} onChange={event => set('contactFrom', event.target.value)} /><Input value={form.contactTo} onChange={event => set('contactTo', event.target.value)} /></div>
        </FieldRow>
        <FieldRow label="Tentativas por dia"><Input value={form.cadencePerDay} onChange={event => set('cadencePerDay', event.target.value)} /></FieldRow>
        <FieldRow label="Máximo de tentativas"><Input value={form.maxAttempts} onChange={event => set('maxAttempts', event.target.value)} /></FieldRow>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.autoContact} onChange={event => set('autoContact', event.target.checked)} /> Contatar automaticamente no horário (WhatsApp, se o número oficial estiver configurado)</label>
        <FieldRow label="Pagar.me conta"><Input value={form.pagarmeAccount} onChange={event => set('pagarmeAccount', event.target.value)} /></FieldRow>
        <FieldRow label="Pagar.me ambiente">
          <select aria-label="Ambiente Pagar.me" className="h-10 rounded-md border bg-background px-3 text-sm" value={form.pagarmeMode} onChange={event => set('pagarmeMode', event.target.value)}><option value="test">Teste</option><option value="live">Produção</option></select>
        </FieldRow>
        <FieldRow label="Pagar.me chave secreta"><Input type="password" value={form.pagarmeSecret} onChange={event => set('pagarmeSecret', event.target.value)} placeholder="sk_..." autoComplete="off" /></FieldRow>
        <p className="text-sm text-muted-foreground">Pix (copia e cola) e boleto saem da API. Cartão só por link de pagamento. Número e CVV não são gravados.</p>
        {inbound && <p className="whitespace-pre-wrap break-all text-sm">Webhook de entrada: {inbound}. Assine o corpo com HMAC-SHA256 no cabeçalho x-kloel-signature: v1=… Eventos: checkout_abandoned, order_created, order_paid, shipped, payment_overdue.</p>}
        <Button type="button" variant="secondary" disabled={busy} onClick={() => void testCommercial(agent.id).then(result => toast.success(`Conexão HTTP ${result.status}`)).catch(error => toast.error(error instanceof Error ? error.message : 'Falha no teste'))}>Testar conexão</Button>
      </div>
    </SideSheet>
  )
}
