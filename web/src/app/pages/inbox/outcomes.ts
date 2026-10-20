/**
 * Desfechos adicionais da análise da conversa (Fonio ao vivo, exportação: Resultado "Informação fornecida, Resolvido" —
 * docs/evidence/live-compare/D-conversas/conversa-fonio.json). A lista e o painel mostram só o selo do `result`; a
 * exportação junta os desfechos e o resultado. Module augmentation local ao módulo de Conversas.
 */
import type {} from '@/domain/types'

declare module '@/domain/types' {
  interface Conversation {
    /** Rótulos dos desfechos extras, na ordem da Fonio (ex.: ["Informação fornecida"]). */
    outcomes?: string[]
  }
}

export {}
