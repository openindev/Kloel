import type { ConfiguredPhone } from '@/services/engine/phone-config'
import type { CallerId, OwnedPhone } from '@/services/engine/phones'
declare module '@/domain/types' {
  interface PhoneNumber {
    enginePhone?: { local: ConfiguredPhone | null; owned: OwnedPhone | null; callerId: CallerId | null; inboundReady: boolean }
  }
}
export {}
