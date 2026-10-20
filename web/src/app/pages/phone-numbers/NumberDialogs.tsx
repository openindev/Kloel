import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CircleX, Copy, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import type { Agent, PhoneNumber } from '@/domain/types'
import '@/domain/ext/mais-a'
import { cn } from '@/lib/utils'
import { useCollection, useCurrentOrg, useStore } from '@/data/store'
import { runSteps, services } from '@/services'
import { useOperation } from '@/hooks/useOperation'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Alert } from '@/components/ui/alert'
import { PhoneInput } from '@/components/app/PhoneInput'
import { useNumberQuota } from '../overview/plan-usage'
import { OpError } from './OpStatus'
import { PURCHASE_COUNTRIES, countryFromPhone, countryShort } from './countries'
import { phoneCommands, createSipNumber, verifyImportedNumber, confirmImportCode, purchaseNumber, chargeExtraNumberAddon, loadNumberOffer, searchAvailableNumbers, type NumberOffer, type AvailableNumber } from '@/services/casca/phones'

/* --------------------------------- helpers --------------------------------- */

export function Field({ label, htmlFor, error, help, children }: { label: ReactNode; htmlFor?: string; error?: string; help?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor} className={cn(error && 'text-destructive')}>
        {label}
      </Label>
      {children}
      {help && !error && <p className="text-sm text-muted-foreground">{help}</p>}
      {error && <p className="text-sm font-medium text-destructive">{error}</p>}
    </div>
  )
}

/**
 * Campo dos diálogos de número (medido nas capturas fonio-live2/E-numeros/03–07 a 1355×661): centro do rótulo → controle
 * 16 px, controle → ajuda/erro 4 px, campos separados por 16 px.
 */
function FormField({ label, htmlFor, error, help, children, className }: { label: ReactNode; htmlFor?: string; error?: string; help?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn('space-y-1', className)}>
      <Label htmlFor={htmlFor} className={cn(error && 'text-destructive')}>
        {label}
      </Label>
      {children}
      {help && !error && <p className="text-sm text-muted-foreground">{help}</p>}
      {error && <p className="text-sm font-medium text-destructive">{error}</p>}
    </div>
  )
}

/**
 * `onOpenAutoFocus` de diálogos cujo primeiro campo é um PhoneInput: o foco inicial fica no botão de país, como na Fonio
 * (live-compare E-numeros/06). O PopoverTrigger do PhoneInput remonta o botão logo após montar (o PopoverAnchor se
 * registra num efeito); o foco automático do Radix cai no botão antigo, que sai do DOM, e o FocusScope devolve o foco ao
 * próprio DialogContent (contorno cinza no diálogo inteiro). Nos primeiros quadros, o foco passa ao botão novo.
 */
export function focusPhoneCountryOnOpen(e: Event) {
  const content = e.currentTarget instanceof HTMLElement ? e.currentTarget : null
  if (!content) return
  let frames = 0
  const tick = () => {
    if (!content.isConnected) return
    const active = document.activeElement
    const country = content.querySelector<HTMLButtonElement>('button[aria-label="Selecionar país"]')
    if (country && !country.disabled && (active === content || active === document.body)) country.focus({ preventScroll: true })
    if (++frames < 10) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

/** Agentes elegíveis: números de voz → assistentes de voz; números WhatsApp → assistentes de chat. */
export function eligibleAgents(agents: Agent[], whatsapp = false) {
  return agents.filter((a) => (whatsapp ? a.type === 'chat' || a.channels.includes('whatsapp') : a.type === 'voice')).sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Select "Assistente" + botão-link "Desvincular o assistente atual do número" (fonio-live2/E-numeros/03 e 07):
 * gatilho VAZIO (sem placeholder) e o link 4 px abaixo do select; no diálogo "Importar número" o link fica recuado 8 px.
 */
export function AgentField({ value, onChange, agents, id = 'agent', disabled, indentLink }: { value: string; onChange: (v: string) => void; agents: Agent[]; id?: string; disabled?: boolean; indentLink?: boolean }) {
  return (
    <div className={cn(disabled && 'opacity-70')}>
      <div className="space-y-1">
        <Label htmlFor={id} className={cn(disabled && 'text-muted-foreground')}>
          Assistente
        </Label>
        {/* valor "" = gatilho vazio (Radix Select 2.x): "Desvincular…" volta a ele */}
        <Select value={value} onValueChange={onChange} disabled={disabled}>
          <SelectTrigger id={id}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {agents.length === 0 && <div className="px-2 py-1.5 text-sm text-muted-foreground">Nenhum assistente disponível</div>}
            {agents.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button
        type="button"
        variant="link"
        disabled={disabled}
        className={cn('mt-1 h-auto justify-start p-0 font-normal text-muted-foreground hover:no-underline', indentLink && 'px-2')}
        onClick={() => onChange('')}
      >
        Desvincular o assistente atual do número
      </Button>
    </div>
  )
}

function PlanRestriction({ children }: { children: ReactNode }) {
  return (
    <Alert variant="destructive" className="border-destructive/50 text-destructive">
      <CircleX />
      <div className="text-sm">{children}</div>
    </Alert>
  )
}

/* ------------------------- Adicionar número (compra) ------------------------ */

/** DDDs do Brasil → cidade principal (seletor "DDD / cidade" da compra). */
export const BR_DDDS: [string, string][] = [['11','São Paulo'],['12','São José dos Campos'],['13','Santos'],['14','Bauru'],['15','Sorocaba'],['16','Ribeirão Preto'],['17','São José do Rio Preto'],['18','Presidente Prudente'],['19','Campinas'],
  ['21','Rio de Janeiro'],['22','Campos dos Goytacazes'],['24','Volta Redonda'],['27','Vitória'],['28','Cachoeiro de Itapemirim'],['31','Belo Horizonte'],['32','Juiz de Fora'],['33','Governador Valadares'],['34','Uberlândia'],['35','Poços de Caldas'],['37','Divinópolis'],['38','Montes Claros'],
  ['41','Curitiba'],['42','Ponta Grossa'],['43','Londrina'],['44','Maringá'],['45','Foz do Iguaçu'],['46','Francisco Beltrão'],['47','Joinville'],['48','Florianópolis'],['49','Chapecó'],['51','Porto Alegre'],['53','Pelotas'],['54','Caxias do Sul'],['55','Santa Maria'],
  ['61','Brasília'],['62','Goiânia'],['63','Palmas'],['64','Rio Verde'],['65','Cuiabá'],['66','Rondonópolis'],['67','Campo Grande'],['68','Rio Branco'],['69','Porto Velho'],
  ['71','Salvador'],['73','Ilhéus'],['74','Juazeiro'],['75','Feira de Santana'],['77','Vitória da Conquista'],['79','Aracaju'],['81','Recife'],['82','Maceió'],['83','João Pessoa'],['84','Natal'],['85','Fortaleza'],['86','Teresina'],['87','Petrolina'],['88','Juazeiro do Norte'],['89','Picos'],
  ['91','Belém'],['92','Manaus'],['93','Santarém'],['94','Marabá'],['95','Boa Vista'],['96','Macapá'],['97','Coari'],['98','São Luís'],['99','Imperatriz']]
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const fmtBr = (n: string) => { const d = n.replace(/\D/g, '').replace(/^55/, ''); return d.length >= 10 ? `(${d.slice(0, 2)}) ${d.slice(2, -4)}-${d.slice(-4)}` : n }

/**
 * Compra de número (Fonio "Adicionar número de telefone"): Brasil, DDD/cidade, número disponível e preço.
 * O 1º número do plano é incluído; os extras custam NUMBER_EXTRA_PRICE_BRL/mês (add-on em Assinatura e faturamento).
 */
export function AddNumberDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const agents = eligibleAgents(useCollection('agents'))
  const [offer, setOffer] = useState<NumberOffer | null>(null)
  const [offerError, setOfferError] = useState<string | null>(null)
  const [ddd, setDdd] = useState('')
  const [results, setResults] = useState<{ ddd: string; items: AvailableNumber[]; priceBRL: number; error?: string } | null>(null)
  const [searching, setSearching] = useState(false)
  const [picked, setPicked] = useState('')
  const [agentId, setAgentId] = useState('')
  // Número extra (fora do plano): primeiro a cobrança (assinatura +1 pró-rata ou checkout do Stripe), depois a compra na operadora.
  const op = useOperation(async (onProgress, label: string, opts: { ddd: string; phoneNumber?: string; agentId?: string; charge: boolean }) => {
    if (opts.charge) {
      onProgress({ step: 1, total: 3, label: 'Cobrando o número extra', percent: 15 })
      const paid = await chargeExtraNumberAddon()
      if (paid.status === 'checkout') { window.location.assign(paid.url); return new Promise<never>(() => undefined) }
    }
    const { charge: _charge, ...buy } = opts
    return purchaseNumber(label, onProgress, buy)
  })

  useEffect(() => {
    if (!open) return
    setDdd(''); setResults(null); setPicked(''); setAgentId(''); setOffer(null); setOfferError(null); op.reset()
    loadNumberOffer().then(setOffer, (e: unknown) => setOfferError(e instanceof Error ? e.message : 'Não foi possível carregar a oferta de números.'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!ddd) return
    let alive = true
    setSearching(true); setPicked('')
    searchAvailableNumbers(ddd).then(
      (r) => alive && setResults({ ddd, items: r.items, priceBRL: r.priceBRL }),
      (e: unknown) => alive && setResults({ ddd, items: [], priceBRL: 0, error: e instanceof Error ? e.message : 'Não foi possível buscar números.' }),
    ).finally(() => alive && setSearching(false))
    return () => { alive = false }
  }, [ddd])

  const a = offer?.allowance
  const restricted = !!offer && !op.isRunning && !a?.paid
  const included = !!a && a.remainingIncluded > 0
  const price = included ? 0 : offer?.extraMonthlyPriceBRL ?? 49
  // Busca por DDD liberada para toda org (inclusive sem plano); comprar exige plano (o botão leva à assinatura).
  const browseDisabled = !offer || op.isRunning || offer.enabled === false
  const disabled = browseDisabled || restricted
  const navigate = useNavigate()

  async function submit(e?: React.FormEvent) {
    e?.preventDefault()
    if (restricted) { onOpenChange(false); navigate('/app/change-plan/voice'); return }
    if (disabled || !ddd) return
    const r = await op.run(`Brasil (+55) · DDD ${ddd}`, { ddd, phoneNumber: picked || undefined, agentId: agentId || undefined, charge: !included && (a?.remainingExtra ?? 0) <= 0 })
    if (!r) return
    await phoneCommands().refresh().catch(() => null)
    toast.success('Número adquirido!', { description: `${fmtBr(r.number)}${agentId ? ` · vinculado a ${agents.find((x) => x.id === agentId)?.name ?? 'assistente'}` : ''}` })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !op.isRunning && onOpenChange(o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adicionar número de telefone</DialogTitle>
        </DialogHeader>
        <DialogDescription>Os números fornecidos por nós podem ser comprados diretamente na plataforma — nenhuma ação adicional é necessária.</DialogDescription>
        <form id="add-number-form" onSubmit={submit} className="space-y-4">
          {offerError && <PlanRestriction>{offerError}</PlanRestriction>}
          {offer && offer.enabled === false && <PlanRestriction>A compra de números será liberada em breve. Enquanto isso, você pode importar um número próprio.</PlanRestriction>}
          {restricted && (
            <PlanRestriction>
              {!a?.paid ? (
                <>Você ainda não tem um plano de telefone ativo.{' '}<Link to="/app/billing" className="underline underline-offset-4">Assine um plano</Link>{' '}para comprar números.</>
              ) : (
                <>Seu plano inclui {a.included} {a.included === 1 ? 'número' : 'números'} e todos estão em uso.{' '}<Link to="/app/billing" className="underline underline-offset-4">Adicione números extras</Link>{' '}({brl(offer?.extraMonthlyPriceBRL ?? 49)} / número / mês) ou{' '}<Link to="/app/change-plan/voice" className="underline underline-offset-4">faça upgrade do seu plano</Link>.</>
              )}
            </PlanRestriction>
          )}
          <FormField label="País"><Input value="Brasil (+55)" disabled readOnly /></FormField>
          <FormField label="DDD / cidade" htmlFor="ddd">
            <Select value={ddd} onValueChange={setDdd} disabled={browseDisabled}>
              <SelectTrigger id="ddd"><SelectValue placeholder="Escolha o DDD" /></SelectTrigger>
              <SelectContent className="max-h-[min(24rem,var(--radix-select-content-available-height))]">
                {BR_DDDS.map(([d, city]) => <SelectItem key={d} value={d}>{d} · {city}</SelectItem>)}
              </SelectContent>
            </Select>
          </FormField>
          {ddd && (
            <FormField label="Número" error={results?.ddd === ddd ? results.error : undefined}>
              {searching ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Buscando números disponíveis…</div>
              ) : results?.ddd === ddd && !results.error && results.items.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum número disponível neste DDD agora. Tente outro DDD.</p>
              ) : results?.ddd === ddd && !results.error ? (
                <div role="radiogroup" className="grid max-h-48 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
                  {results.items.map((n) => (
                    <button key={n.phoneNumber} type="button" role="radio" aria-checked={picked === n.phoneNumber} onClick={() => setPicked(n.phoneNumber)}
                      className={cn('rounded-md border px-3 py-2 text-left text-sm', picked === n.phoneNumber ? 'border-primary ring-1 ring-primary' : 'hover:bg-muted')}>
                      <div className="font-medium tabular-nums">{fmtBr(n.phoneNumber)}</div>
                      <div className="text-xs text-muted-foreground">{n.locality ?? BR_DDDS.find(([d]) => d === ddd)?.[1]}</div>
                    </button>
                  ))}
                </div>
              ) : null}
            </FormField>
          )}
          <AgentField value={agentId} onChange={setAgentId} agents={agents} id="add-agent" disabled={disabled} />
          {offer && offer.enabled !== false && (
            <div className="flex items-center justify-between rounded-md bg-muted px-3 py-2 text-sm">
              <span>Preço</span>
              <span className="font-medium">{restricted ? '1 número incluído em cada plano de voz · extras R$ 49,00 / mês' : included ? 'Incluído no seu plano' : `${brl(price)} / mês`}</span>
            </div>
          )}
          <OpError error={op.status === 'error' ? op.error : undefined} onRetry={() => submit()} />
        </form>
        <DialogFooter>
          <Button variant="secondary" type="button" onClick={() => onOpenChange(false)} disabled={op.isRunning}>Cancelar</Button>
          <Button type="submit" form="add-number-form" disabled={restricted ? false : disabled || !ddd || (!!results?.items.length && !picked)}>
            {op.isRunning && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {restricted ? 'Assinar plano para comprar' : included || !offer ? 'Adicionar número de telefone' : `Comprar por ${brl(price)}/mês`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------ Criar número SIP ----------------------------- */

/** Host de originação SIP da organização: identificador estável de 11 caracteres (como na Fonio) no domínio da Kloel. */
export function sipOriginHost(orgId?: string) {
  let h = 0x811c9dc5
  for (const ch of orgId ?? 'org') h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let id = ''
  for (let i = 0; i < 11; i++) {
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0
    id += alphabet[h % alphabet.length]
  }
  return `${id}.sip.kloel.ai`
}

/**
 * OBSERVADO (fonio-live2/E-numeros/05, 06 + dump): validação imediata EM INGLÊS ("Number / Name must be at least 4
 * characters long.") com rótulo e campo em vermelho; Originação somente leitura + copiar; "Opcional: ligações outbound"
 * (URL de terminação, Nome de usuário, Senha); sem complemento no plano: alerta vermelho (circle-x) em texto simples e
 * "Criar número SIP" desabilitado.
 */
export function SipDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const org = useCurrentOrg()
  const numbers = useCollection('phoneNumbers')
  const insert = useStore((s) => s.insert)
  const quota = useNumberQuota()
  const [name, setName] = useState('')
  const [termination, setTermination] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const host = services.simulated ? sipOriginHost(org?.id) : ''

  useEffect(() => {
    if (open) {
      setName('')
      setTermination('')
      setUsername('')
      setPassword('')
    }
  }, [open])

  const restricted = !quota.sipAllowed
  const v = name.trim()
  const error =
    v.length < 4
      ? 'Number / Name must be at least 4 characters long.'
      : numbers.some((n) => n.number.toLowerCase() === v.toLowerCase())
        ? 'Number / Name already exists.'
        : undefined

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (restricted || error) return
    try { await createSipNumber() } catch (error) { toast.error(error instanceof Error ? error.message : 'Não foi possível criar o número SIP.') }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Criar número SIP</DialogTitle>
          <DialogDescription>
            Ao criar números SIP, você pode usar seus próprios números de telefone, desde que sua operadora ofereça suporte.
            <br />
            Você encontra instruções para operadoras compatíveis na nossa{' '}
            <a href="/ajuda/phone-systems/sip-numbers" target="_blank" rel="noreferrer" className="text-blue-500 underline">
              documentação
            </a>
            .
          </DialogDescription>
        </DialogHeader>
        <form id="sip-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <FormField label="Número / nome" htmlFor="sip-name" error={error}>
            <Input
              id="sip-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="+55xxxxxxxxx"
              aria-invalid={!!error || undefined}
              className={cn(error && 'border-2 border-destructive text-destructive placeholder:text-destructive/50 focus-visible:ring-destructive/30')}
            />
          </FormField>
          <FormField label="Originação" htmlFor="sip-origin">
            <div className="relative !mt-4">
              <Input id="sip-origin" readOnly value={host} className="bg-gray-100 pr-12 focus-visible:ring-0" />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Copiar originação"
                disabled={!host}
                className="absolute right-0 top-0 h-10 w-10 hover:bg-transparent"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(host)
                  } catch {
                    /* sem acesso à área de transferência */
                  }
                  toast.success('Copiado para a área de transferência')
                }}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </FormField>
          <div className="pt-8 text-sm font-semibold">Opcional: ligações outbound</div>
          <FormField label="URL de terminação" htmlFor="sip-term">
            <Input id="sip-term" value={termination} onChange={(e) => setTermination(e.target.value)} placeholder="demo.pstn.twilio.com" />
          </FormField>
          <FormField label="Nome de usuário" htmlFor="sip-user" help="Deixe vazio se nenhum nome de usuário tiver sido configurado">
            <Input id="sip-user" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Nome de usuário" autoComplete="off" />
          </FormField>
          <FormField label="Senha" htmlFor="sip-pass" help="Deixe vazio se nenhuma senha tiver sido configurada">
            <Input id="sip-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Senha" autoComplete="new-password" />
          </FormField>
        </form>
        {restricted && <PlanRestriction>Seu plano atual não oferece complementos para esse recurso. Faça upgrade do seu plano.</PlanRestriction>}
        <DialogFooter>
          <Button variant="secondary" type="button" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="submit" form="sip-form" disabled={restricted}>
            Criar número SIP
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------ Importar número ------------------------------ */

/**
 * OBSERVADO (fonio-live2/E-numeros/07): observação com negritos, PhoneInput "+55", Assistente vazio e link recuado.
 * Depois de "Importar número" (central de ajuda IM-01.6): o código de 6 dígitos aparece com "Sua solicitação de
 * importação está sendo processada." — a ligação de verificação (em que o código seria digitado) é simulada pelo
 * serviço de telefonia e, ao terminar, o número entra na lista.
 */
export function ImportNumberDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const numbers = useCollection('phoneNumbers')
  const agents = eligibleAgents(useCollection('agents'))
  const insert = useStore((s) => s.insert)
  const [phone, setPhone] = useState('+55')
  const [agentId, setAgentId] = useState('')
  const [formError, setFormError] = useState<string>()
  const session = useRef(0)
  const verify = useOperation((_onProgress, n: string) => verifyImportedNumber(n))
  const call = useOperation(async (_onProgress, n: string, code: string, token: number) => {
    for (let attempt = 0; attempt < 20; attempt++) {
      if (token !== session.current) return false
      if (await confirmImportCode(n, code)) return true
      await new Promise(resolve => setTimeout(resolve, 3000))
    }
    throw new Error('A operadora ainda não confirmou a verificação. Atenda a ligação e consulte novamente.')
  })

  useEffect(() => {
    session.current++
    if (open) {
      setPhone('+55')
      setAgentId('')
      setFormError(undefined)
      verify.reset()
      call.reset()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const normalized = phone.replace(/[^\d+]/g, '')
  const code = verify.status === 'success' ? verify.result?.code : undefined
  const busy = verify.isRunning || call.isRunning

  async function start(e?: React.FormEvent) {
    e?.preventDefault()
    if (busy) return
    if (normalized.replace(/\D/g, '').length < 10) return setFormError('Digite um número de telefone válido.')
    if (numbers.some((n) => n.number.replace(/[^\d+]/g, '') === normalized)) return setFormError('Este número já está na sua lista.')
    if (agentId) return setFormError('A vinculação de assistente a um número importado ainda não está disponível.')
    setFormError(undefined)
    call.reset()
    const token = session.current
    const r = await verify.run(normalized)
    if (!r || token !== session.current) return
    const ok = await call.run(normalized, r.code, token)
    if (!ok || token !== session.current) return
    toast.success('Número importado', { description: phone.trim() })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onOpenAutoFocus={focusPhoneCountryOnOpen}>
        <DialogHeader>
          <DialogTitle>Importar número</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-y-2 text-left text-sm text-muted-foreground">
          <b>Observação sobre o número importado</b>
          <ul className="list-disc pl-6">
            <li>
              Números importados podem <b>ser usados apenas para ligações outbound</b>.
            </li>
            <li>
              <b>Ligações de entrada</b> não são possíveis com esta opção. Para isso, use uma das outras duas opções de número.
            </li>
          </ul>
          <p>
            Depois de clicar em 'Importar número', você verá um <b>código de confirmação de 6 dígitos</b> e receberá uma ligação em que deverá digitar esse código.
          </p>
          <p>
            A <b>ligação</b> será <b>em inglês dos EUA</b>. Basta abrir o teclado e digitar o código.
          </p>
        </div>

        <form id="import-form" onSubmit={start} className="space-y-4">
          <FormField label="Número de telefone" htmlFor="import-phone" error={formError}>
            <div className={cn(busy && 'pointer-events-none opacity-60')}>
              <PhoneInput id="import-phone" value={phone} onChange={(v) => { setPhone(v); setFormError(undefined) }} invalid={!!formError} />
            </div>
          </FormField>
          <AgentField value={agentId} onChange={setAgentId} agents={agents} id="import-agent" disabled={busy} indentLink />
          {code && call.status !== 'error' && (
            <div className="space-y-1.5 rounded-lg bg-muted/60 px-3 py-2.5 text-sm" data-testid="import-pending">
              <p>
                Código de validação:{' '}
                <span className="rounded bg-brand/15 px-1 font-mono font-semibold tracking-wider tabular-nums" data-testid="import-code">
                  {code}
                </span>
              </p>
              <p className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Sua solicitação de importação está sendo processada.
              </p>
            </div>
          )}
          <OpError error={verify.status === 'error' ? verify.error : call.status === 'error' ? call.error : undefined} onRetry={() => start()} />
        </form>

        <DialogFooter>
          <Button variant="secondary" type="button" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="submit" form="import-form" disabled={busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Importar número
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* --------------------------- Renomear / Vincular --------------------------- */

export function RenameDialog({ number, onOpenChange }: { number?: PhoneNumber; onOpenChange: (o: boolean) => void }) {
  const patch = useStore((s) => s.patch)
  const [name, setName] = useState('')
  const [error, setError] = useState<string>()
  useEffect(() => {
    if (number) {
      setName(number.name)
      setError(undefined)
    }
  }, [number])
  return (
    <Dialog open={!!number} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Renomear número</DialogTitle>
        </DialogHeader>
        <form
          id="rename-form"
          onSubmit={async (e) => {
            e.preventDefault()
            if (!number) return
            if (name.trim().length < 2) return setError('O nome deve ter pelo menos 2 caracteres.')
            try { await phoneCommands().update(number, { name: name.trim() }); toast.success('Número renomeado'); onOpenChange(false) }
            catch (error) { setError(error instanceof Error ? error.message : 'Não foi possível renomear o número.') }
          }}
        >
          <Field label="Nome" htmlFor="rename" error={error}>
            <Input id="rename" autoFocus value={name} onChange={(e) => { setName(e.target.value); setError(undefined) }} aria-invalid={!!error || undefined} />
          </Field>
        </form>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="submit" form="rename-form">
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function LinkAgentDialog({ number, onOpenChange }: { number?: PhoneNumber; onOpenChange: (o: boolean) => void }) {
  const all = useCollection('agents')
  const patch = useStore((s) => s.patch)
  const agents = eligibleAgents(all, !!number?.capabilities.includes('whatsapp'))
  const [agentId, setAgentId] = useState('')
  useEffect(() => {
    if (number) setAgentId(number.agentId ?? '')
  }, [number])
  return (
    <Dialog open={!!number} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="gap-y-2">
          <DialogTitle>Vincular assistente</DialogTitle>
          <DialogDescription>
            {number?.name} · {number?.number}
          </DialogDescription>
        </DialogHeader>
        <AgentField value={agentId} onChange={setAgentId} agents={agents} id="link-agent" />
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={async () => {
              if (!number) return
              try {
                await phoneCommands().update(number, { agentId: agentId || null })
                const a = all.find((x) => x.id === agentId)
                toast.success(a ? `Número vinculado a ${a.name}` : 'Assistente desvinculado do número')
                onOpenChange(false)
              } catch (error) { toast.error(error instanceof Error ? error.message : 'Não foi possível vincular o assistente.') }
            }}
          >
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
