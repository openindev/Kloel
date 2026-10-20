import type { BeforeConfig } from '@/services/engine/before-context'
import type { HttpSource } from '@/services/engine/before-http'

declare module '@/domain/types' {
  interface Agent {
    /** Confirmed configuration, never serialized into the editorial sidecar. */
    engineBefore?: { generation: number; context: BeforeConfig; http: HttpSource | null }
  }
  interface WebhookConfig {
    engineBeforeHttp?: { sourceId: string; revision: number; beforeRevision: number | null }
  }
}
export {}
