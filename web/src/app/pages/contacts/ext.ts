/**
 * Campos de "Configurações avançadas" de um campo inteligente, como na Fonio ao vivo
 * (fonio-live2/I-contatos/00-contatos-dom-resumo.txt): "Como a Kloel deve encontrar isso? (opcional)",
 * "Manter atualizado" e "Atualizar somente quando…". Module augmentation local ao módulo Contatos.
 */
import type {} from '@/domain/types'

declare module '@/domain/types' {
  interface SmartFieldDef {
    /** Instrução usada apenas pela Kloel para encontrar o valor; vazia = usa a descrição. */
    findHint?: string
    /** A Kloel atualiza o valor com base nas conversas recentes quando ele muda (padrão: ligado). */
    keepUpdated?: boolean
    /** Condição para atualizar; vazia = atualiza sempre que o valor mudar claramente. */
    updateWhen?: string
  }
}

export {}
