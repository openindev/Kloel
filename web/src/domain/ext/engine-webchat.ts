import type { WebchatChannel } from '@/services/engine/webchat'
declare module '@/domain/types' {
  interface Agent {
    engineWebchat?: { generation: number; channels: WebchatChannel[] }
  }
}
declare module '@/domain/ext/mais-a' {
  interface WebchatSetup {
    /** Derived only from an authenticated channel read; never editor state. */
    engineAvailable?: boolean
  }
}
export {}
