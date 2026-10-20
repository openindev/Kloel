import { useStore } from '@/data/store'
import '@/domain/ext/agents-resources'
import { captureEngineContext } from '../engine/session'

export interface OwnershipChallenge { code: string; message: string; to: string; link: string }
/** Real "kloel verify" flow: the engine issues a code; the user sends it from their WhatsApp to Kloel's official number. */
export async function startOwnership(): Promise<OwnershipChallenge> {
  return captureEngineContext('agents:write').request<OwnershipChallenge>('/whatsapp/ownership', { method: 'POST', body: {} })
}
export async function ownershipStatus(code: string): Promise<{ status: 'pending' | 'verified'; number: string | null }> {
  return captureEngineContext('agents:read').request(`/whatsapp/ownership/${encodeURIComponent(code)}`)
}
export async function syncVerifiedNumbers() {
  const r = await captureEngineContext('agents:read').request<{ items: { number: string; verifiedAt: string }[] }>('/whatsapp/verified-numbers')
  useStore.getState().patchOrg({ verifiedWhatsAppNumbers: r.items })
  return r.items
}
