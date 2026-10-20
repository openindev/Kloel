import type { Conversation, DemoDB, TranscriptLine } from '@/domain/types'
import '@/domain/ext/inbox-contacts'

/**
 * Seed adicional do módulo "inbox-contacts" (arrays são concatenados ao seed base).
 * Acrescenta duas conversas de hoje: uma chamada web de configuração, inspirada na referência [575]
 * (texto próprio, sem reproduzir o teste do operador; sem gravação, como na referência) e uma ligação
 * COM gravação simulada (para o player e o destaque por linha).
 * Rodada "Central de ajuda" (2026-10-18): um chat de WhatsApp EM ANDAMENTO (WA-03: "Sem assunto", chip "Ativo",
 * "A IA está atendendo este chat") e dados de "Extração" na ligação com gravação (AN-08). Textos próprios e fictícios.
 */
export default function seed(now: Date): Partial<DemoDB> {
  const orgId = 'org_bemviver'
  const at = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60000).toISOString()
  const L = (t: number, speaker: TranscriptLine['speaker'], text: string): TranscriptLine => ({ t, speaker, text })

  const setup: TranscriptLine[] = [
    L(0, 'assistant', 'Olá, aqui é a Roberta da Clínica Bem Viver. Como posso te ajudar?'),
    L(6, 'caller', 'Oi, Roberta, tudo bem?'),
    L(9, 'assistant', 'Tudo ótimo, e com você? Em que posso ajudar hoje?'),
    L(21, 'caller', 'Só um minutinho, estou terminando uma coisa aqui.'),
    L(27, 'assistant', 'Claro, fico aguardando. Pode falar quando estiver pronta.'),
    L(48, 'assistant', 'Alô? Continuo por aqui.'),
    L(51, 'caller', 'Pronto. Eu estou configurando o atendimento da Kloel AI e queria entender umas coisas.'),
    L(60, 'assistant', 'Perfeito! Posso explicar como eu atendo as ligações e o que você pode ajustar no painel.'),
    L(72, 'caller', 'Você sabe como funciona a configuração do assistente?'),
    L(78, 'assistant', 'Sei sim. No painel você define a saudação, as regras de atendimento, o conhecimento da clínica e as ações, como transferências e agendamentos.'),
    L(101, 'caller', 'E aqui na ligação aparece a opção de atribuir um número. O que acontece se eu atribuir um número?'),
    L(112, 'assistant', 'Ao atribuir um número de telefone, todas as ligações recebidas nesse número passam a ser atendidas por mim. Você pode trocar ou remover o número quando quiser.'),
    L(135, 'caller', 'Entendi. E o número precisa ser novo?'),
    L(140, 'assistant', 'Não precisa. Você pode comprar um número novo ou conectar o número atual da clínica por desvio de chamada ou SIP.'),
    L(158, 'caller', 'Ótimo, era isso. Obrigada, Roberta!'),
    L(163, 'assistant', 'Eu que agradeço! Qualquer dúvida, é só ligar. Tenha um ótimo dia.'),
  ]

  const callback: TranscriptLine[] = [
    L(0, 'assistant', 'Olá, aqui é a Roberta da Clínica Bem Viver. Como posso te ajudar?'),
    L(5, 'caller', 'Oi, eu fiz um orçamento de implante semana passada e queria falar com o doutor sobre o valor.'),
    L(14, 'assistant', 'Entendi, Mariana. O orçamento de implante é tratado diretamente com a equipe clínica. Posso pedir para alguém retornar sua ligação hoje à tarde?'),
    L(26, 'caller', 'Pode sim, depois das 15h é melhor.'),
    L(31, 'assistant', 'Combinado. Anotei o pedido de retorno depois das 15h para este número. Posso ajudar em mais alguma coisa?'),
    L(41, 'caller', 'Não, só isso. Obrigada.'),
    L(44, 'assistant', 'Obrigada pela ligação. Até mais tarde!'),
  ]

  // Chat de WhatsApp em andamento (WA-03): contato escreve, a Maria (assistente de chat) responde; sem assunto/resumo ainda.
  const activeChat: TranscriptLine[] = [
    L(0, 'caller', 'Oi, boa tarde!'),
    L(4, 'assistant', 'Olá! Aqui é a Maria, da Clínica Bem Viver. Como posso ajudar?'),
    L(71, 'caller', 'Vocês têm horário amanhã à tarde para limpeza?'),
    L(78, 'assistant', 'Temos sim! Amanhã há horários às 14h e às 16h30. Qual fica melhor para você?'),
    L(196, 'caller', '16h30, por favor'),
  ]

  const conversations: Conversation[] = [
    {
      id: 'cnv_web_setup', orgId, agentId: 'agt_roberta', channel: 'web', direction: 'inbound',
      title: 'Configuração da Kloel AI',
      summary: 'Perguntou sobre a configuração do assistente e o que acontece ao atribuir um número; recebeu a explicação e encerrou.',
      result: 'resolved', startedAt: at(38), durationSec: 182, transcript: setup, endedBy: 'assistant',
      // Sem gravação: a referência ao vivo ([575] / app-inbox) mostra esta chamada web sem player, com o resumo logo abaixo do título.
      starred: false, archived: false, read: false, tagIds: [], simulated: true,
    },
    {
      id: 'cnv_retorno_implante', orgId, agentId: 'agt_roberta', channel: 'phone', direction: 'inbound',
      title: 'Retorno sobre orçamento de implante',
      summary: 'Pediu para falar com a equipe sobre o orçamento de implante; retorno solicitado para depois das 15h.',
      result: 'resolved', startedAt: at(95), durationSec: 52, callerNumber: '+55 11 90000-0001', calleeNumber: '+55 11 90000-0200',
      contactId: 'cnt_1', transcript: callback, endedBy: 'assistant',
      starred: true, archived: false, read: false, tagIds: ['tag_retorno'], simulated: true, recording: { durationSec: 52 },
      // "Extração" (AN-08): variáveis capturadas pelo assistente durante a ligação (chaves no formato das variáveis das ações).
      extraction: { nome_do_chamador: 'Mariana Almeida', motivo_do_retorno: 'Orçamento de implante', horario_desejado: 'depois das 15h' },
    },
    {
      id: 'cnv_wa_ativo', orgId, agentId: 'agt_maria', channel: 'whatsapp', direction: 'inbound',
      title: 'Sem assunto', summary: '',
      // Sem resultado enquanto o chat está ativo (o campo é obrigatório no modelo; a interface não o exibe nem filtra).
      result: 'resolved', chatActive: true, startedAt: at(55), durationSec: 196, callerNumber: '+55 11 90000-0003',
      contactId: 'cnt_3', transcript: activeChat, endedBy: 'system',
      starred: false, archived: false, read: false, tagIds: [], simulated: true,
    },
  ]

  return { conversations }
}
