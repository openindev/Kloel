import type { Agent } from '@/domain/types'

const editorialOnly = [] as const
type ResourceState = Pick<Agent, 'emails' | 'transfers' | 'whatsapps'>

const executableTransfer = (row: Agent['transfers'][number]) => ((row.mode === 'phone' || row.mode === 'member') && /^\+[1-9]\d{7,14}$/.test(String(row.destination ?? '').replace(/[\s()-]/g, ''))) || (row.mode === 'sip' && /^sips?:\S{3,200}$/.test(String(row.destination ?? '')))
const executableWhatsApp = (row: Agent['whatsapps'][number]) => (row.when === 'always' || (row.when === 'only_if' && !!row.condition?.trim())) && (row.recipientsMode === 'caller' || (row.recipientsMode === 'fixed' && Array.isArray(row.recipients) && row.recipients.length > 0))
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/
/** E-mails are sent by the engine (Resend, noreply@kloel.ai) when the call ends. */
export const executableEmail = (row: Agent['emails'][number]) => (row.when === 'always' || (row.when === 'only_if' && !!row.condition?.trim())) && ((row.recipientsMode === 'fixed' && Array.isArray(row.recipients) && row.recipients.length > 0 && row.recipients.every(r => EMAIL.test(String(r).trim()))) || (row.recipientsMode === 'ai' && !!row.recipientsInstruction?.trim())) && (row.messageMode === 'ai' || !!(row.subject?.trim() || row.body?.trim()))
/** Saved editorial rows are not executable actions. Permit removing old drafts, never activate them. */
export function assertExecutableResourceChanges(base: ResourceState, patch: Partial<ResourceState>) {
  // Phone/SIP transfers are executed by the voice worker (SIP REFER); transfers to a team member are still editorial.
  if (patch.transfers !== undefined) {
    const prev = base.transfers, next = patch.transfers
    if (new Set(next.map(row => row.id)).size !== next.length || next.some(row => !executableTransfer(row) && !prev.some(old => old.id === row.id && JSON.stringify(old) === JSON.stringify(row))))
      throw Error('Esta ação automática ainda não está disponível para este assistente. Nenhuma configuração foi ativada.')
  }
  if (patch.whatsapps !== undefined) {
    const prev = base.whatsapps, next = patch.whatsapps
    if (new Set(next.map(row => row.id)).size !== next.length || next.some(row => !executableWhatsApp(row) && !prev.some(old => old.id === row.id && JSON.stringify(old) === JSON.stringify(row))))
      throw Error('Esta ação automática ainda não está disponível para este assistente. Nenhuma configuração foi ativada.')
  }
  if (patch.emails !== undefined) {
    const prev = base.emails, next = patch.emails
    if (new Set(next.map(row => row.id)).size !== next.length || next.some(row => !executableEmail(row) && !prev.some(old => old.id === row.id && JSON.stringify(old) === JSON.stringify(row))))
      throw Error('Preencha os destinatários (e-mails válidos), a condição e a mensagem antes de salvar. Nenhuma configuração foi ativada.')
  }
  for (const key of editorialOnly as readonly ('emails')[]) {
    const next = patch[key]
    if (next === undefined) continue
    const previous = base[key]
    const unique = new Set(next.map(row => row.id)).size === next.length
    if (!unique || next.some(row => !previous.some(old => old.id === row.id && JSON.stringify(old) === JSON.stringify(row)))) {
      throw Error('Esta ação automática ainda não está disponível para este assistente. Nenhuma configuração foi ativada.')
    }
  }
}
