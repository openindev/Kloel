import { useEffect, useMemo, useState } from 'react'
import { Check, ListFilter, Play, Square } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { VOICE_FILTERS, voicePhotoUrl, voicesForLanguage, type Voice } from '@/data/catalogs/voices'
import { LANGUAGES } from '@/data/catalogs/languages'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { speakPreview, stopSpeech } from './ui'

type Gender = 'all' | 'Feminino' | 'Masculino'

const FILTER_LABEL: Record<string, string> = { all: 'Todos', ...Object.fromEntries(LANGUAGES.map((l) => [l.value, l.label])) }

/**
 * Avatar da voz (referência: `span.rounded-full` com `img.aspect-square` da foto; sem foto, inicial em
 * `rounded-full font-semibold text-white bg-<cor>-600`). A foto só é usada quando o arquivo existe localmente (voicePhotoUrl).
 */
export function VoiceAvatar({ voice, size = 'sm' }: { voice: Voice; size?: 'sm' | 'md' }) {
  const photo = voicePhotoUrl(voice)
  return (
    <span className={cn('relative flex shrink-0 overflow-hidden rounded-full', size === 'sm' ? 'h-5 w-5' : 'h-8 w-8')}>
      {photo ? (
        <img src={photo} alt={voice.name} className="aspect-square h-full w-full" />
      ) : (
        <span className={cn('flex h-full w-full items-center justify-center rounded-full font-semibold text-white', voice.color, size === 'sm' ? 'text-[10px]' : 'text-xs')}>
          {voice.name.charAt(0)}
        </span>
      )}
    </span>
  )
}

/** Texto falado na prévia, no idioma da voz (vozes de sotaque neutro usam o idioma do filtro/assistente). */
function previewText(v: Voice, agentName: string) {
  const first = v.name.split(' ')[0]
  const lang = v.language
  if (lang.startsWith('de')) return `Hallo, ich bin ${first}. Wie kann ich Ihnen helfen?`
  if (lang.startsWith('en')) return `Hi, I'm ${first}. How can I help you today?`
  if (lang === 'es' || lang === 'ca') return `Hola, soy ${first}. ¿En qué puedo ayudarte?`
  if (lang === 'fr') return `Bonjour, je suis ${first}. Comment puis-je vous aider ?`
  if (lang === 'it') return `Ciao, sono ${first}. Come posso aiutarti?`
  if (lang === 'nl') return `Hallo, ik ben ${first}. Hoe kan ik je helpen?`
  if (lang === 'pl') return `Dzień dobry, jestem ${first}. W czym mogę pomóc?`
  return `Olá, aqui é a ${first}${agentName ? ` de ${agentName}` : ''}. Como posso te ajudar?`
}

const SPEECH_LANG: Record<string, string> = { 'pt-BR': 'pt-BR', de: 'de-DE', 'de-CH': 'de-CH', es: 'es-ES', ca: 'ca-ES', fr: 'fr-FR', it: 'it-IT', nl: 'nl-NL', pl: 'pl-PL', 'en-US': 'en-US', 'en-GB': 'en-GB', hu: 'hu-HU', zh: 'zh-CN', ar: 'ar-SA', tr: 'tr-TR' }

/**
 * Diálogo "Selecionar voz" (OBSERVADO ao vivo: fonio-live2/C-assistentes/09–12 + data/voices.json + DOM do verificador lado a lado,
 * live-compare/C-assistentes/04–05, 23): aba única "Todas", select de idioma de 150px (lista de 280px) com "Todos" + 41 idiomas (abre
 * no idioma do assistente), botão Filtrar (menu "Filtro / Gênero: Todos · Feminino · Masculino"), 148 vozes na ordem de cada filtro
 * (neutras com 🌍 no lugar da bandeira) e rodapé Cancelar / Salvar (`border-t px-8 pb-6 pt-4`; altura natural 739px, abaixo da dobra
 * em telas de 661px). Clicar numa voz só marca o rádio; "Salvar" aplica (alteração pendente na barra) e fecha. Hover no avatar = prévia.
 */
export function VoicePickerDialog({
  open,
  onOpenChange,
  value,
  language,
  agentName,
  onSave,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  value: string
  language: string
  agentName: string
  onSave: (voiceId: string) => void
}) {
  const [lang, setLang] = useState(language)
  const [gender, setGender] = useState<Gender>('all')
  const [selected, setSelected] = useState(value)
  const [playing, setPlaying] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setLang(VOICE_FILTERS.includes(language) ? language : 'all')
      setGender('all')
      setSelected(value)
    } else {
      stopSpeech()
      setPlaying(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => () => stopSpeech(), [])

  const voices = useMemo(() => voicesForLanguage(lang).filter((v) => gender === 'all' || v.gender === gender), [lang, gender])

  function play(v: Voice) {
    if (playing === v.id) {
      stopSpeech()
      setPlaying(null)
      return
    }
    const speechLang = SPEECH_LANG[v.language === 'multi' ? (lang === 'all' || lang === 'multi' ? language : lang) : v.language] ?? 'pt-BR'
    const ok = speakPreview(previewText(v.language === 'multi' ? { ...v, language: speechLang } : v, agentName), {
      gender: v.gender,
      lang: speechLang,
      onEnd: () => setPlaying((p) => (p === v.id ? null : p)),
    })
    if (!ok) {
      toast.error('Prévia de áudio indisponível', { description: 'Este navegador não oferece síntese de voz.' })
      return
    }
    setPlaying(v.id)
  }

  function save() {
    stopSpeech()
    setPlaying(null)
    if (selected !== value) onSave(selected)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-screen gap-0 overflow-hidden border-0 p-0 sm:max-w-[480px]" closeClassName="right-8 top-8">
        <DialogHeader className="space-y-0 px-8 pb-1 pt-8 text-left">
          <DialogTitle className="text-xl font-semibold tracking-[-0.03em]">Selecionar voz</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-6 overflow-hidden px-8 py-6 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <nav role="tablist" className="flex items-center gap-6">
              <button type="button" role="tab" aria-selected className="border-b-2 border-black py-3 text-sm font-semibold text-foreground transition-colors">
                Todas
              </button>
            </nav>
            <div className="flex items-center gap-3">
              <div className="w-[150px]">
                <Select value={lang} onValueChange={setLang}>
                  <SelectTrigger className="h-9 w-full rounded-md shadow-sm [&>span]:truncate" aria-label="Idioma das vozes">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-[min(24rem,var(--radix-select-content-available-height))] w-[280px] max-w-[280px]">
                    {VOICE_FILTERS.map((code) => (
                      <SelectItem key={code} value={code}>
                        {FILTER_LABEL[code] ?? code}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    title="Filtrar"
                    aria-label="Filtrar"
                    className={cn(
                      'inline-flex h-9 w-9 items-center justify-center rounded-md border border-input bg-background shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground',
                      gender !== 'all' && 'bg-muted',
                    )}
                  >
                    <ListFilter className="h-3 w-3" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <div className="px-2 py-1.5 text-sm font-semibold">Filtro</div>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Gênero</DropdownMenuLabel>
                  <DropdownMenuRadioGroup value={gender} onValueChange={(v) => setGender(v as Gender)}>
                    <DropdownMenuRadioItem value="all">Todos</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="Feminino">Feminino</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="Masculino">Masculino</DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          <div role="listbox" aria-label="Vozes" className="max-h-[480px] overflow-y-auto rounded-lg">
            {voices.map((v) => {
              const isSel = v.id === selected
              const isPlaying = playing === v.id
              return (
                <div
                  key={v.id}
                  role="option"
                  aria-selected={isSel}
                  tabIndex={0}
                  data-voice={v.id}
                  onClick={() => setSelected(v.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setSelected(v.id)
                    }
                  }}
                  className={cn(
                    'group flex w-full cursor-pointer items-center gap-3 rounded-lg p-3 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:ring-1 focus-visible:ring-ring',
                    isSel && 'bg-muted/60',
                  )}
                >
                  <div className="relative h-8 w-8">
                    <VoiceAvatar voice={v} size="md" />
                    <button
                      type="button"
                      aria-label={isPlaying ? 'Parar' : 'Reproduzir'}
                      onClick={(e) => {
                        e.stopPropagation()
                        play(v)
                      }}
                      className={cn(
                        'absolute inset-0 flex items-center justify-center rounded-full bg-black/60 transition-opacity focus-visible:opacity-100',
                        isPlaying ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                      )}
                    >
                      {isPlaying ? <Square className="h-3 w-3 fill-white text-white" /> : <Play className="h-3.5 w-3.5 fill-white text-white" />}
                    </button>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-sm font-medium leading-none text-foreground">
                      {v.name}
                      {v.popular && <span className="rounded-md bg-brand/10 px-1.5 py-0.5 text-[10px] font-medium leading-3 text-brand">Popular</span>}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1 text-xs tracking-[0.01em] text-muted-foreground">
                      {v.flag ? (
                        <div className="relative flex h-[16px] w-[21px] shrink-0 items-center">
                          <span className={cn('fi rounded-[2px]', `fi-${v.flag}`)} />
                        </div>
                      ) : (
                        // vozes de sotaque neutro: 🌍 no lugar da bandeira (referência: div.relative h-[16px] w-[21px] flex items-center justify-center)
                        <div className="relative flex h-[16px] w-[21px] shrink-0 items-center justify-center">
                          <span>🌍</span>
                        </div>
                      )}
                      <span className="truncate">{v.detail}</span>
                    </div>
                  </div>
                  {isSel ? (
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-black">
                      <Check className="h-3 w-3 text-white" strokeWidth={3} />
                    </span>
                  ) : (
                    <span className="h-4 w-4 shrink-0 rounded-full border border-input" />
                  )}
                </div>
              )
            })}
          </div>
        </div>
        <DialogFooter className="border-t px-8 pb-6 pt-4">
          <Button type="button" variant="outline" className="h-9 px-4" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" className="h-9 px-4" data-e2e="voice-dialog-save-button" onClick={save}>
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
