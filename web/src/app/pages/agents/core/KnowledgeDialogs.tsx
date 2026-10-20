import { useEffect, useRef, useState, type FormEvent } from 'react'
import { FileText, Sparkles, X } from 'lucide-react'
import { toast } from 'sonner'
import type { Agent } from '@/domain/types'
import '@/domain/ext/agents'
import { services } from '@/services'
import { saveAgentFields } from '@/services/casca/agents'
import type { ProgressFn } from '@/services/runtime'
import { useOperation } from '@/hooks/useOperation'
import { useCollection, useCurrentOrg } from '@/data/store'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { SideSheet } from '@/components/app/SideSheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { FieldError, OpProgress } from './ui'

export const SITE_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/.*)?$/i
export const normalizeSite = (url: string) => url.trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '')
export const MAX_PDF = 20 * 1024 * 1024

export function formatBytes(n?: number) {
  if (!n && n !== 0) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`
}

/** Importa um site: cria a fonte + entradas (origem "site"). Reaproveitado por "Atualizar". */
export async function importWebsite(agent: Agent, domain: string, onProgress?: ProgressFn) {
  const result = await services.ai.crawlWebsite(domain, onProgress, { agentId: agent.id })
  return { pages: result.pages, entries: result.entries.length }
}

/** Diálogo "Adicionar site" (URL do site + Importar) — spec 07 [555]. */
export function AddSiteDialog({ agent, open, onOpenChange }: { agent: Agent; open: boolean; onOpenChange: (o: boolean) => void }) {
  const sources = useCollection('knowledgeSources')
  const [url, setUrl] = useState('')
  const [error, setError] = useState<string>()
  const op = useOperation((onProgress, domain: string) => importWebsite(agent, domain, onProgress))

  useEffect(() => {
    if (open) {
      setUrl('')
      setError(undefined)
      op.reset()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  async function submit(e: FormEvent) {
    e.preventDefault()
    const domain = normalizeSite(url)
    if (!domain) return setError('Informe a URL do site.')
    if (!SITE_RE.test(domain)) return setError('Digite um endereço de site válido, por exemplo minhaempresa.com.br.')
    if (sources.some((s) => s.agentId === agent.id && s.type === 'website' && s.label === domain)) return setError('Este site já foi importado.')
    setError(undefined)
    finish(await op.run(domain))
  }

  /** Sucesso (na 1ª tentativa ou ao repetir): avisa e fecha; a fonte já foi criada por importWebsite. */
  function finish(r: Awaited<ReturnType<typeof importWebsite>> | undefined) {
    if (!r) return
    toast.success('Site importado', { description: `${r.pages} páginas · ${r.entries} entradas` })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !op.isRunning && onOpenChange(o)}>
      {/* [555]: 512px (max-w-lg padrão do diálogo) */}
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Adicionar site</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
          <div className="grid gap-2">
            <Label htmlFor="site-url">URL do site</Label>
            <Input
              id="site-url"
              autoFocus
              placeholder="https://example.com"
              value={url}
              disabled={op.isRunning}
              aria-invalid={!!error}
              onChange={(e) => {
                setUrl(e.target.value)
                setError(undefined)
              }}
            />
            <FieldError>{error}</FieldError>
          </div>
          <OpProgress status={op.status} progress={op.progress} error={op.error} onRetry={() => void op.retry()?.then(finish)} />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={op.isRunning}>
              Cancelar
            </Button>
            <Button type="submit" disabled={op.isRunning}>
              {op.isRunning ? 'Importando…' : 'Importar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Verifica cabeçalho %PDF e presença de fontes (texto copiável) — PDFs só com imagem são recusados. */
async function inspectPdf(file: File): Promise<string | undefined> {
  try {
    const buf = await file.arrayBuffer()
    const bytes = new Uint8Array(buf)
    const head = String.fromCharCode(...bytes.slice(0, 5))
    if (head !== '%PDF-') return 'O arquivo não é um PDF válido.'
    const sample = new TextDecoder('latin1').decode(bytes.length > 4_000_000 ? bytes.slice(0, 4_000_000) : bytes)
    if (!/\/Font\b/.test(sample) && !/\/ToUnicode\b/.test(sample)) return 'O texto no PDF precisa poder ser copiado — arquivos só com imagem (documentos escaneados) não serão processados.'
    return undefined
  } catch {
    return 'Não foi possível ler o arquivo.'
  }
}

/** Folha "Enviar documento" (nome, aviso, seletor de arquivo PDF ≤ 20 MB, processamento simulado) — spec 07 [556]/[557]. */
export function DocumentSheet({ agent, open, onOpenChange }: { agent: Agent; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [name, setName] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string>()
  const [nameError, setNameError] = useState<string>()
  const fileRef = useRef<HTMLInputElement>(null)
  const op = useOperation(async (onProgress, f: File, label: string) => {
    const result = await services.ai.processDocument(f, onProgress, { agentId: agent.id, title: label })
    return result.entries.length
  })

  useEffect(() => {
    if (open) {
      setName('')
      setFile(null)
      setError(undefined)
      setNameError(undefined)
      op.reset()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  async function pick(f: File | undefined) {
    if (!f) return
    setError(undefined)
    if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') {
      setFile(null)
      return setError('No momento, apenas arquivos PDF podem ser enviados.')
    }
    if (f.size > MAX_PDF) {
      setFile(null)
      return setError(`O tamanho máximo do arquivo é 20 MB (arquivo selecionado: ${formatBytes(f.size)}).`)
    }
    const problem = await inspectPdf(f)
    if (problem) {
      setFile(null)
      return setError(problem)
    }
    setFile(f)
    if (!name.trim()) setName(f.name.replace(/\.pdf$/i, ''))
  }

  async function submit() {
    if (!file) return
    if (!name.trim()) return setNameError('O nome do documento é obrigatório.')
    finishDoc(await op.run(file, name.trim()), file.name)
  }

  function finishDoc(n: number | undefined, fileName: string) {
    if (n === undefined) return
    toast.success('Documento enviado', { description: `${n} ${n === 1 ? 'entrada criada' : 'entradas criadas'} a partir de ${fileName}` })
    onOpenChange(false)
  }

  return (
    <SideSheet
      open={open}
      onOpenChange={(o) => !op.isRunning && onOpenChange(o)}
      title="Enviar documento"
      // [556]: o painel de documento é mais estreito (560px) que o padrão de 576px
      width={560}
      onSave={submit}
      saveLabel={op.isRunning ? 'Enviando…' : 'Enviar documento'}
      saveDisabled={!file || !name.trim() || op.isRunning}
    >
      {/* espaçamentos da captura [556]: rótulo → campo → aviso (12px) → "Selecionar documento" */}
      <div className="-mt-0.5 flex flex-col gap-3">
        <div className="grid gap-2">
          <Label htmlFor="doc-name">Nome do documento</Label>
          <Input
            id="doc-name"
            autoFocus
            value={name}
            aria-invalid={!!nameError}
            onChange={(e) => {
              setName(e.target.value)
              setNameError(undefined)
            }}
          />
          <FieldError>{nameError}</FieldError>
        </div>
        <div className="rounded-xl border p-5 text-sm leading-5 text-orange-600">
          <p className="font-semibold">Importante:</p>
          <ul className="mt-1 list-disc pl-4">
            <li>O tamanho máximo do arquivo é 20 MB.</li>
            <li>No momento, apenas arquivos PDF podem ser enviados.</li>
            <li>O texto no PDF precisa poder ser copiado — arquivos só com imagem (documentos escaneados) não serão processados.</li>
          </ul>
        </div>
        <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="hidden" data-testid="document-file" onChange={(e) => void pick(e.target.files?.[0] ?? undefined).finally(() => (e.target.value = ''))} />
        {file ? (
          <div className="flex items-center gap-3 rounded-lg border p-3">
            <FileText className="size-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{file.name}</p>
              <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
            </div>
            <button type="button" className="text-sm text-blue-500 hover:underline" onClick={() => fileRef.current?.click()} disabled={op.isRunning}>
              Trocar
            </button>
            <button type="button" aria-label="Remover arquivo" onClick={() => setFile(null)} disabled={op.isRunning} className="text-muted-foreground hover:text-foreground">
              <X className="size-4" />
            </button>
          </div>
        ) : (
          <button type="button" className="self-start text-sm text-blue-500 hover:underline" onClick={() => fileRef.current?.click()}>
            Selecionar documento
          </button>
        )}
        <FieldError>{error}</FieldError>
        <OpProgress status={op.status} progress={op.progress} error={op.error} onRetry={() => file && void op.retry()?.then((n) => finishDoc(n, file.name))} />
      </div>
    </SideSheet>
  )
}

/**
 * Diálogo largo "Informações da empresa" (OBSERVADO: fonio-live2/C-assistentes/85–86 + DOM do verificador lado a lado,
 * live-compare/C-assistentes/19): campo clicável `flex items-center gap-2 rounded-lg border border-brand/20 bg-background py-1.5 pl-3
 * pr-1.5` (42px) com ✨, rótulo sobreposto "Gerar automaticamente a partir do seu site" e campo de URL embutido (placeholder
 * "https://suaempresa.com.br"; Enter gera o texto); cabeçalho com `border-b border-border/70`; área `bg-muted/60 p-6 border-x-0
 * border-border/70 rounded-none` com o foco inicial; rodapé Cancelar / Salvar.
 */
export function CompanyInfoDialog({ agent, open, onOpenChange }: { agent: Agent; open: boolean; onOpenChange: (o: boolean) => void }) {
  const org = useCurrentOrg()
  const sources = useCollection('knowledgeSources')
  const [text, setText] = useState(agent.companyInfo)
  const [asking, setAsking] = useState(false)
  const [url, setUrl] = useState('')
  const [urlError, setUrlError] = useState<string>()
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const urlRef = useRef<HTMLInputElement>(null)
  const suggested = org?.website || sources.find((s) => s.agentId === agent.id && s.type === 'website')?.label || ''
  const op = useOperation((onProgress, site: string) => services.ai.generateCompanyInfo(site, onProgress, { agentId: agent.id }))

  useEffect(() => {
    if (open) {
      setText(agent.companyInfo)
      setAsking(false)
      setUrl('')
      setUrlError(undefined)
      op.reset()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  async function generate() {
    const domain = normalizeSite(url || suggested)
    if (!domain || !SITE_RE.test(domain)) return setUrlError('Digite um endereço de site válido.')
    setUrlError(undefined)
    const r = await op.run(domain)
    if (r) {
      setText(r)
      setAsking(false)
      setUrl('')
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !op.isRunning && !savingRef.current && onOpenChange(o)}>
      <DialogContent
        className="flex max-h-[calc(100svh-2rem)] flex-col gap-0 p-0 sm:h-[562px] sm:max-w-[896px]"
        onOpenAutoFocus={(e) => {
          // foco inicial na área de texto (cursor visível na referência), não no campo "Gerar automaticamente"
          e.preventDefault()
          textRef.current?.focus()
        }}
      >
        <DialogHeader className="px-6 pb-8 pt-6">
          <DialogTitle>Informações da empresa</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 border-b border-border/70 px-6 pb-4">
          <div
            onClick={() => {
              if (op.isRunning) return
              setAsking(true)
              urlRef.current?.focus()
            }}
            className={cn(
              'flex h-[42px] cursor-pointer items-center gap-2 rounded-lg border border-brand/20 bg-background py-1.5 pl-3 pr-1.5 transition-colors hover:border-brand/40',
              urlError && 'border-destructive hover:border-destructive',
            )}
          >
            <Sparkles className="size-4 shrink-0 text-brand" />
            <div className="relative h-7 min-w-0 flex-1">
              <input
                ref={urlRef}
                id="company-info-site"
                aria-label="Site da empresa"
                value={url}
                disabled={op.isRunning || saving}
                placeholder="https://suaempresa.com.br"
                aria-invalid={!!urlError}
                onFocus={() => setAsking(true)}
                onBlur={() => {
                  if (!url.trim() && !op.isRunning) {
                    setAsking(false)
                    setUrlError(undefined)
                  }
                }}
                onChange={(e) => {
                  setUrl(e.target.value)
                  setUrlError(undefined)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void generate()
                  }
                  if (e.key === 'Escape' && !url) {
                    e.stopPropagation()
                    setAsking(false)
                    urlRef.current?.blur()
                  }
                }}
                className={cn('h-7 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground', !asking && 'opacity-0')}
              />
              {!asking && (
                <label htmlFor="company-info-site" className="absolute inset-0 flex cursor-pointer items-center truncate text-sm font-medium text-brand">
                  Gerar automaticamente a partir do seu site
                </label>
              )}
            </div>
          </div>
          <FieldError>{urlError}</FieldError>
          <OpProgress status={op.status} progress={op.progress} error={op.error} onRetry={() => void generate()} />
        </div>
        <textarea
          ref={textRef}
          aria-label="Informações da empresa"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Informações sobre sua empresa, horário de funcionamento, perguntas frequentes..."
          className="min-h-[200px] flex-1 resize-none rounded-none border-x-0 border-y border-border/70 bg-muted/60 p-6 text-sm outline-none placeholder:text-muted-foreground"
        />
        <div className="flex items-center justify-end gap-2 px-6 py-4">
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={op.isRunning || saving}>
            Cancelar
          </Button>
          <Button
            disabled={op.isRunning || saving}
            onClick={async () => {
              if (savingRef.current) return
              savingRef.current = true; setSaving(true)
              try { await saveAgentFields(agent, { companyInfo: text.trim() }); toast.success('Informações da empresa salvas'); onOpenChange(false) }
              catch (error) { toast.error('Não foi possível salvar', { description: error instanceof Error ? error.message : 'Confira o acesso e tente novamente.' }) }
              finally { savingRef.current = false; setSaving(false) }
            }}
          >
            Salvar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
