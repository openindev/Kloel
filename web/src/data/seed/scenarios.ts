import type { ConversationResult, TranscriptLine } from '@/domain/types'

/** Roteiros sintéticos de conversa usados no seed e nas simulações de ligação de teste. */
export interface Scenario {
  key: string
  title: string
  summary: string
  result: ConversationResult
  endedBy: 'assistant' | 'caller' | 'system'
  lines: [number, 'assistant' | 'caller', string][]
}

export const SCENARIOS: Scenario[] = [
  {
    key: 'agendar', title: 'Agendamento de avaliação', result: 'appointment', endedBy: 'assistant',
    summary: 'Pediu uma avaliação odontológica; consulta agendada para quinta às 14h e confirmação enviada por WhatsApp.',
    lines: [
      [0, 'assistant', 'Olá, aqui é a {agent} da {company}. Como posso te ajudar?'],
      [5, 'caller', 'Oi, eu queria marcar uma avaliação, por favor.'],
      [9, 'assistant', 'Claro! Pode me dizer seu nome completo?'],
      [13, 'caller', 'É {caller}.'],
      [17, 'assistant', 'Obrigada, {first}. Tenho horários na quinta-feira às 10h ou às 14h. Qual prefere?'],
      [25, 'caller', 'Às 14h fica ótimo.'],
      [29, 'assistant', 'Perfeito! Agendei sua avaliação para quinta às 14h. Vou enviar a confirmação pelo WhatsApp. Posso ajudar em mais alguma coisa?'],
      [41, 'caller', 'Não, só isso. Obrigado!'],
      [44, 'assistant', 'Eu que agradeço. Até quinta!'],
    ],
  },
  {
    key: 'horario', title: 'Horário de funcionamento', result: 'resolved', endedBy: 'caller',
    summary: 'Perguntou o horário de funcionamento no sábado; recebeu a informação e encerrou.',
    lines: [
      [0, 'assistant', 'Olá, aqui é a {agent} da {company}. Como posso te ajudar?'],
      [4, 'caller', 'Boa tarde! Vocês abrem no sábado?'],
      [8, 'assistant', 'Abrimos sim! Aos sábados atendemos das 8h às 12h. De segunda a sexta, das 8h às 19h.'],
      [17, 'caller', 'Ah, perfeito. Obrigada.'],
      [20, 'assistant', 'Por nada! Tenha um ótimo dia.'],
    ],
  },
  {
    key: 'preco', title: 'Valor do clareamento', result: 'resolved', endedBy: 'assistant',
    summary: 'Pediu o valor do clareamento dental; informado o preço a partir de R$ 890 e as formas de pagamento.',
    lines: [
      [0, 'assistant', 'Olá, aqui é a {agent} da {company}. Como posso te ajudar?'],
      [5, 'caller', 'Quanto custa o clareamento?'],
      [8, 'assistant', 'O clareamento a laser começa em R$ 890, e parcelamos em até 6 vezes sem juros. Quer agendar uma avaliação gratuita?'],
      [20, 'caller', 'Vou pensar e retorno depois.'],
      [24, 'assistant', 'Sem problemas! É só ligar quando quiser. Até logo!'],
    ],
  },
  {
    key: 'urgencia', title: 'Dor de dente – urgência', result: 'transferred', endedBy: 'system',
    summary: 'Relatou dor forte; a assistente transferiu a ligação para a recepção.',
    lines: [
      [0, 'assistant', 'Olá, aqui é a {agent} da {company}. Como posso te ajudar?'],
      [4, 'caller', 'Estou com muita dor de dente, preciso de atendimento hoje.'],
      [10, 'assistant', 'Sinto muito, {first}. Vou transferir você agora para a nossa recepção para um encaixe de urgência.'],
      [18, 'caller', 'Tá bom, obrigado.'],
    ],
  },
  {
    key: 'remarcar', title: 'Remarcação de consulta', result: 'appointment', endedBy: 'assistant',
    summary: 'Pediu para remarcar a consulta de segunda; nova data definida para quarta às 9h.',
    lines: [
      [0, 'assistant', 'Olá, aqui é a {agent} da {company}. Como posso te ajudar?'],
      [4, 'caller', 'Preciso remarcar minha consulta de segunda.'],
      [8, 'assistant', 'Claro. Encontrei sua consulta de segunda às 11h. Tenho quarta às 9h ou sexta às 16h.'],
      [17, 'caller', 'Quarta às 9h.'],
      [20, 'assistant', 'Pronto, remarcado para quarta às 9h. Enviei a nova confirmação.'],
    ],
  },
  {
    key: 'vendas', title: 'Oferta de serviço de marketing', result: 'spam', endedBy: 'assistant',
    summary: 'Ligação de vendas oferecendo marketing digital; recusada com educação.',
    lines: [
      [0, 'assistant', 'Olá, aqui é a {agent} da {company}. Como posso te ajudar?'],
      [4, 'caller', 'Olá, gostaria de apresentar nossa agência de marketing digital.'],
      [9, 'assistant', 'Agradeço o contato, mas no momento não temos interesse. Tenha um bom dia!'],
    ],
  },
  {
    key: 'silencio', title: 'Ligação sem interação', result: 'no_interaction', endedBy: 'system',
    summary: 'Ninguém falou durante a ligação; encerrada após o tempo de espera.',
    lines: [
      [0, 'assistant', 'Olá, aqui é a {agent} da {company}. Como posso te ajudar?'],
      [12, 'assistant', 'Alô? Consegue me ouvir?'],
    ],
  },
  {
    key: 'convenio', title: 'Dúvida sobre convênio', result: 'resolved', endedBy: 'caller',
    summary: 'Perguntou se a clínica aceita o convênio OdontoMais; confirmado e explicado o processo.',
    lines: [
      [0, 'assistant', 'Olá, aqui é a {agent} da {company}. Como posso te ajudar?'],
      [5, 'caller', 'Vocês aceitam o convênio OdontoMais?'],
      [9, 'assistant', 'Aceitamos sim! É só trazer a carteirinha e um documento com foto no dia da consulta.'],
      [17, 'caller', 'Ótimo, obrigada!'],
    ],
  },
]

export function renderLines(s: Scenario, vars: Record<string, string>): TranscriptLine[] {
  return s.lines.map(([t, speaker, text]) => ({ t, speaker, text: text.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '') }))
}
