import type { ConfiguredWhatsAppChannel } from '@/services/engine/whatsapp-channels'
import type { WhatsAppConnectionVerification } from '@/services/engine/whatsapp-connection'
declare module '@/domain/types' {
  interface WhatsAppAccount {
    engineWhatsApp?: { channel: ConfiguredWhatsAppChannel; verification: WhatsAppConnectionVerification | null }
  }
}
export {}
