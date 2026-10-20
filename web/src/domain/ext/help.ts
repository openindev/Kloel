/**
 * Extensões de tipo do módulo "help" (Central de ajuda).
 * Module augmentation: campos opcionais, para não quebrar dados persistidos antes desta extensão.
 */
import type { ISODate } from '@/domain/types'

declare module '@/domain/types' {
  interface UiPrefs {
    /** Central de ajuda: respostas a "Esta página foi útil?" por artigo (chave `seção/slug`). */
    helpFeedback?: Record<string, { vote: 'yes' | 'no'; comment?: string; at: ISODate }>
  }
}

export {}
