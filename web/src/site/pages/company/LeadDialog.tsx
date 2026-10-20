import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { CheckCircle2, History, Loader2, RotateCcw, XCircle } from 'lucide-react'
import type { Lead } from '@/domain/types'
import { cn } from '@/lib/utils'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { useReturnFocus } from '@/site/layout/useReturnFocus'
import { SiteField, SiteInput, SiteTextarea, isEmail, phoneDigits, siteButton } from './kit'

export interface LeadField {
  name: string
  label: string
  type?: 'text' | 'email' | 'tel' | 'url' | 'textarea' | 'select'
  required?: boolean
  placeholder?: string
  options?: string[]
  half?: boolean
}

/** Formulário público do site: o motor guarda o contato e o envia por e-mail ao time da Kloel (POST /api/v1/public/leads). */
export function LeadDialog({
  open, onOpenChange, title, description, kind, fields, payload, submitLabel = 'Enviar', successTitle = 'Recebemos sua mensagem!', successText, consent, initial, children,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: ReactNode
  description?: ReactNode
  kind: Lead['kind']
  fields: LeadField[]
  payload?: Record<string, string>
  submitLabel?: string
  successTitle?: string
  successText?: ReactNode
  consent?: string
  initial?: Record<string, string>
  children?: ReactNode
}) {
  // aberto por estado (sem DialogTrigger): devolve o foco ao botão que abriu o formulário
  const onCloseAutoFocus = useReturnFocus(open)
  const allLeads = useMemo<Lead[]>(() => [], [])
  const payloadKey = JSON.stringify(payload ?? {})
  // Envios anteriores do mesmo formulário (mesmo tipo de lead e mesmo contexto) salvos neste navegador.
  const previous = useMemo(() => {
    const ctx = Object.entries(JSON.parse(payloadKey) as Record<string, string>)
    return allLeads.filter((l) => l.kind === kind && ctx.every(([k, v]) => l.payload[k] === v)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }, [allLeads, kind, payloadKey])
  const last = previous[0]
  const lastLabel = last ? new Date(last.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
  const [values, setValues] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [agreed, setAgreed] = useState(false)
  const [status, setStatus] = useState<'idle' | 'running' | 'success' | 'error'>('idle')
  const [label, setLabel] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) {
      setValues(initial ?? {})
      setErrors({})
      setAgreed(false)
      setStatus('idle')
      setError('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const validate = () => {
    const e: Record<string, string> = {}
    for (const f of fields) {
      const v = (values[f.name] ?? '').trim()
      if (f.required && !v) e[f.name] = f.type === 'select' ? 'Selecione uma opção.' : `Preencha o campo “${f.label}”.`
      else if (v && f.type === 'email' && !isEmail(v)) e[f.name] = 'Informe um e-mail válido.'
      else if (v && f.type === 'tel' && phoneDigits(v) < 10) e[f.name] = 'Informe um telefone válido com DDD.'
      else if (v && f.type === 'url' && !/^(https?:\/\/)?[^\s.]+\.[^\s]{2,}/i.test(v)) e[f.name] = 'Informe um endereço válido.'
    }
    if (consent && !agreed) e.__consent = 'É preciso aceitar para continuar.'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const submit = async () => {
    if (!validate()) return
    setStatus('running')
    setLabel('Enviando')
    setError('')
    try {
      const body = {
        kind, page: window.location.pathname, consent: consent ? agreed : false,
        title: typeof title === 'string' ? title.slice(0, 200) : '',
        context: Object.fromEntries(Object.entries(payload ?? {}).filter(([, v]) => v).map(([k, v]) => [k.slice(0, 60), String(v).slice(0, 300)])),
        fields: Object.fromEntries(fields.map((f) => [f.label.slice(0, 60), (values[f.name] ?? '').trim().slice(0, 4000)]).filter(([, v]) => v)),
      }
      const response = await fetch('/api/v1/public/leads', { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) })
      if (response.status === 429) throw new Error('Muitos envios em sequência. Aguarde alguns minutos e tente novamente.')
      if (!response.ok) throw new Error('Não foi possível enviar agora. Tente novamente em instantes.')
      setStatus('success')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível enviar.')
      setStatus('error')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[560px] gap-y-6 font-site sm:rounded-2xl" onCloseAutoFocus={onCloseAutoFocus}>
        {status === 'success' ? (
          <div className="flex flex-col items-start gap-4 py-2" data-testid="lead-success">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
              <CheckCircle2 className="h-6 w-6" />
            </span>
            <DialogTitle className="text-[22px] font-medium text-heading">{successTitle}</DialogTitle>
            <DialogDescription className="text-[15px] leading-6 text-body">{successText ?? 'Nossa equipe vai responder em breve pelo e-mail informado.'}</DialogDescription>
            {last && (
              <p className="text-[13px] text-body" data-testid="lead-protocol">
                Protocolo <b className="font-medium text-ink">#{last.id.slice(-6).toUpperCase()}</b> · registrado em {lastLabel}
              </p>
            )}
            <button type="button" className={cn(siteButton('dark', 'md'), 'mt-2')} onClick={() => onOpenChange(false)}>
              Fechar
            </button>
          </div>
        ) : (
          <>
            <div>
              <DialogTitle className="pr-8 text-[22px] font-medium leading-7 text-heading">{title}</DialogTitle>
              {description && <DialogDescription className="mt-2 text-[15px] leading-6 text-body">{description}</DialogDescription>}
            </div>
            {children}
            {last && (
              <div className="flex items-start gap-2.5 rounded-xl border border-slate-200 bg-slate-50 p-3 text-[13px] leading-5 text-body" data-testid="lead-previous">
                <History className="mt-0.5 h-4 w-4 shrink-0 text-brand-blue" />
                <span>
                  Você já enviou {previous.length === 1 ? 'uma solicitação' : `${previous.length} solicitações`} por este formulário (última em {lastLabel}, protocolo #{last.id.slice(-6).toUpperCase()}). Enviar de novo cria um novo registro.
                </span>
              </div>
            )}
            <form
              noValidate
              className="grid gap-4 sm:grid-cols-2"
              onSubmit={(ev) => {
                ev.preventDefault()
                void submit()
              }}
            >
              {fields.map((f) => {
                const id = `lead-${f.name}`
                const common = {
                  id,
                  value: values[f.name] ?? '',
                  invalid: !!errors[f.name],
                  placeholder: f.placeholder,
                }
                const onChange = (v: string) => {
                  setValues((x) => ({ ...x, [f.name]: v }))
                  if (errors[f.name]) setErrors((x) => ({ ...x, [f.name]: '' }))
                }
                return (
                  <SiteField key={f.name} label={f.label} htmlFor={id} required={f.required} error={errors[f.name]} className={f.half ? '' : 'sm:col-span-2'}>
                    {f.type === 'textarea' ? (
                      <SiteTextarea {...common} onChange={(e) => onChange(e.target.value)} />
                    ) : f.type === 'select' ? (
                      <select id={id} value={values[f.name] ?? ''} aria-invalid={!!errors[f.name] || undefined} onChange={(e) => onChange(e.target.value)} className="h-11 w-full rounded-[10px] border border-slate-200 bg-[#F9FAFB] px-3 text-[16px] text-ink focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/15 aria-[invalid=true]:border-red-400">
                        <option value="">Selecione</option>
                        {f.options?.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <SiteInput {...common} type={f.type === 'url' ? 'text' : f.type ?? 'text'} onChange={(e) => onChange(e.target.value)} />
                    )}
                  </SiteField>
                )
              })}
              {consent && (
                <label className="flex items-start gap-2.5 text-[14px] leading-5 text-body sm:col-span-2">
                  <input type="checkbox" checked={agreed} onChange={(e) => { setAgreed(e.target.checked); setErrors((x) => ({ ...x, __consent: '' })) }} className="mt-0.5 h-4 w-4 accent-[#585DFE]" />
                  <span>
                    {consent}
                    {errors.__consent && <span className="block text-[13px] text-red-600">{errors.__consent}</span>}
                  </span>
                </label>
              )}
              {status === 'error' && (
                <div role="alert" data-engine-state="error" className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-[14px] text-red-700 sm:col-span-2">
                  <XCircle className="h-4 w-4 shrink-0" />
                  <span className="flex-1">{error}</span>
                  <button type="button" onClick={() => void submit()} className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-2.5 py-1 text-[13px] hover:bg-red-50">
                    <RotateCcw className="h-3.5 w-3.5" /> Tentar novamente
                  </button>
                </div>
              )}
              <div className="flex flex-col-reverse gap-2 sm:col-span-2 sm:flex-row sm:justify-end">
                <button type="button" className={siteButton('outline', 'md')} onClick={() => onOpenChange(false)}>
                  Cancelar
                </button>
                <button type="submit" disabled={status === 'running'} className={siteButton('dark', 'md')}>
                  {status === 'running' && <Loader2 className="h-4 w-4 animate-spin" />}
                  {status === 'running' ? `${label}…` : submitLabel}
                </button>
              </div>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
