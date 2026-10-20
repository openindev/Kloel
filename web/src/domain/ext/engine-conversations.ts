import type { ConversationEditorState } from '@/services/casca/conversation-editor'
import type { ConversationControl } from '@/services/engine/conversations'
import type {} from '@/domain/types'

declare module '@/domain/types' {
  interface Conversation {
    engineConversation?: {
      control: ConversationControl | null
      editor: ConversationEditorState
      closedAt: string | null
      analysisId: string | null
      loaded: boolean
    }
  }
}
export {}
