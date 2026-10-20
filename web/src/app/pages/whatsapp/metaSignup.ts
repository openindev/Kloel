import { create } from 'zustand'
import { toast } from 'sonner'
import { connectWhatsAppBusiness } from '@/services/casca/whatsapp'

export const useMetaSignup = create<{ connecting: boolean }>(() => ({ connecting: false }))
/** The existing button remains the signup entry point; only a real Meta handshake may create a connection. */
export async function startMetaSignup(_orgName: string) {
  if (useMetaSignup.getState().connecting) return
  useMetaSignup.setState({ connecting: true })
  try { await connectWhatsAppBusiness(); toast.success('WhatsApp Business conectado!') }
  catch (error) { toast.error(error instanceof Error ? error.message : 'Não foi possível conectar a conta.') }
  finally { useMetaSignup.setState({ connecting: false }) }
}
