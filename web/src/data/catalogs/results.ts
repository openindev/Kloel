import type { ConversationResult } from '@/domain/types'
// Resultados de conversa (submenu "Resultado" do filtro de Conversas, com as classes observadas).
export const RESULTS: Record<ConversationResult, { label: string; chip: string; dot: string }> = {
  unknown: { label: '–', chip: 'bg-muted text-muted-foreground', dot: 'bg-muted-foreground' },
  resolved: { label: 'Resolvido', chip: 'bg-green-50 text-green-800', dot: 'bg-green-500' },
  transferred: { label: 'Transferido', chip: 'bg-brand/10 text-brand', dot: 'bg-brand' },
  missed: { label: 'Não atendida', chip: 'bg-amber-50 text-amber-800', dot: 'bg-amber-500' },
  appointment: { label: 'Consulta agendada', chip: 'bg-green-50 text-green-800', dot: 'bg-green-500' },
  abandoned: { label: 'Abandonada', chip: 'bg-amber-50 text-amber-800', dot: 'bg-amber-500' },
  no_interaction: { label: 'Sem interação', chip: 'bg-muted text-muted-foreground', dot: 'bg-muted-foreground' },
  spam: { label: 'Spam', chip: 'bg-red-50 text-red-700', dot: 'bg-destructive' },
  voicemail: { label: 'Correio de voz', chip: 'bg-muted text-muted-foreground', dot: 'bg-muted-foreground' },
  outbound_no_answer: { label: 'Saída sem resposta', chip: 'bg-muted text-muted-foreground', dot: 'bg-muted-foreground' },
  inactivity: { label: 'Inatividade', chip: 'bg-amber-50 text-amber-800', dot: 'bg-amber-500' },
  time_limit: { label: 'Limite de tempo', chip: 'bg-amber-50 text-amber-800', dot: 'bg-amber-500' },
  recording_refused: { label: 'Gravação recusada', chip: 'bg-amber-50 text-amber-800', dot: 'bg-amber-500' },
}
export const RESULT_KEYS = Object.keys(RESULTS).filter(key => key !== 'unknown') as ConversationResult[]
export const CHANNEL_LABEL: Record<string, string> = { phone: 'Ligação', web: 'Chamada web', whatsapp: 'WhatsApp', webchat: 'Chatbot de IA' }
