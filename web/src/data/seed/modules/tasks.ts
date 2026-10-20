import type { Conversation, DemoDB } from '@/domain/types'
import type { Task, TaskActivity } from '@/domain/ext/tasks'
import '@/domain/ext/tasks'
import { buildDemoOrg } from '../demo'

/**
 * Seed adicional do módulo "tasks" (Tarefas BETA — TK-V01…TK-V05). Arrays são concatenados ao seed base.
 * 11 tarefas fictícias da "Clínica Bem Viver", ligadas a conversas/contatos/assistentes do seed
 * (algumas "Criada por IA" pela Maria, assistente de chat — marcadas como simuladas).
 *
 * As conversas do seed base têm ids determinísticos (cnv_001…cnv_072, mesmo PRNG): este módulo recalcula
 * a lista para escolher conversas reais por roteiro e assistente, mantendo contato e assistente coerentes.
 * As conversas fixas do módulo inbox-contacts (cnv_retorno_implante, cnv_wa_ativo) são citadas pelo id.
 *
 * `buildTaskSeed` também é usado pela página quando o banco salvo é anterior a este módulo (sem `tasks`).
 */
export function buildTaskSeed(now: Date, conversations?: Conversation[]): Task[] {
  const orgId = 'org_bemviver'
  const day = 86400000
  const hour = 3600000
  const base = conversations ?? ((buildDemoOrg(now).conversations ?? []) as Conversation[])

  /** Primeira conversa (mais recente) do assistente com o título do roteiro e, de preferência, com contato. */
  const pick = (agentId: string, title: string) =>
    base.find((c) => c.agentId === agentId && c.title === title && c.contactId) ?? base.find((c) => c.agentId === agentId && c.title === title)

  /** Vencimento: dia relativo + hora local (horário de São Paulo na demonstração). */
  const dueAt = (days: number, h: number, m = 0) => {
    const d = new Date(now.getTime() + days * day)
    d.setHours(h, m, 0, 0)
    return d.toISOString()
  }
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString()

  let seq = 0
  const act = (at: string, userId: TaskActivity['userId'], change: string): TaskActivity => ({ id: `tka_seed_${++seq}`, at, userId, change })

  const tasks: Task[] = []
  const add = (t: Omit<Task, 'orgId' | 'updatedAt'> & { updatedAt?: string }) => {
    const last = t.activity[t.activity.length - 1]?.at ?? t.createdAt
    tasks.push({ orgId, updatedAt: t.updatedAt ?? last, ...t })
  }

  // 1 — retorno pedido na ligação com gravação (inbox-contacts): criada pela Ana, prioridade alterada pelo Carlos (TK-V03)
  add({
    id: 'tsk_retorno_implante', title: 'Retornar ligação sobre orçamento de implante',
    description: '<div>Paciente pediu para falar com a equipe clínica sobre o valor do implante.</div><div><b>Melhor horário:</b> depois das 15h.</div>',
    status: 'in_progress', priority: 'high', assigneeUserId: 'usr_carlos', dueAt: dueAt(1, 15, 30), tags: ['Retorno', 'Financeiro'],
    createdBy: 'user', agentId: 'agt_roberta', conversationId: 'cnv_retorno_implante', contactId: 'cnt_1', createdAt: ago(80 * 60000),
    activity: [
      act(ago(80 * 60000), 'usr_ana', 'Criou esta tarefa'),
      act(ago(70 * 60000), 'usr_ana', 'Responsável: Sem responsável → Carlos Mendes'),
      act(ago(42 * 60000), 'usr_carlos', 'Prioridade: Média → Alta'),
      act(ago(41 * 60000), 'usr_carlos', 'Estado: A fazer → Em andamento'),
    ],
  })

  // 2 — chat de WhatsApp em andamento (inbox-contacts): criada pela IA (habilidade "Criar tarefa", simulada)
  add({
    id: 'tsk_confirmar_limpeza', title: 'Confirmar limpeza amanhã às 16h30',
    description: '<div>O contato pediu horário para limpeza amanhã à tarde e escolheu <b>16h30</b>.</div><div>Próximo passo: confirmar o encaixe na agenda e avisar pelo WhatsApp.</div><div>Contato: +55 11 90000-0003</div>',
    status: 'todo', priority: 'medium', assigneeUserId: 'usr_ana', dueAt: dueAt(1, 12), tags: ['Agendamento', 'Criada por IA'],
    createdBy: 'ai', agentId: 'agt_maria', conversationId: 'cnv_wa_ativo', contactId: 'cnt_3', simulated: true, createdAt: ago(50 * 60000),
    activity: [act(ago(50 * 60000), 'ai', 'Criou esta tarefa')],
  })

  // 3 — "Arrange callback from a human agent" (TK-V03): IA, sem prioridade e sem responsável
  const chatHuman = pick('agt_maria', 'Remarcação de consulta') ?? pick('agt_maria', 'Agendamento de avaliação')
  add({
    id: 'tsk_atendente_humano', title: 'Organizar retorno com um atendente humano',
    description: '<div>O contato pediu para continuar a conversa com uma pessoa da recepção.</div><div>Próximo passo: ligar ou responder pelo mesmo canal ainda hoje.</div>',
    status: 'in_progress', priority: 'none', tags: ['Retorno', 'Criada por IA'],
    createdBy: 'ai', agentId: 'agt_maria', conversationId: chatHuman?.id, contactId: chatHuman?.contactId, simulated: true, createdAt: ago(5 * hour),
    activity: [act(ago(5 * hour), 'ai', 'Criou esta tarefa')],
  })

  // 4 — "Verify invoice update" (TK-V03): manual, Financeiro, sem conversa
  add({
    id: 'tsk_fatura_padaria', title: 'Verificar atualização de fatura da Padaria Pão Dourado',
    description: '<div>Conferir se a fatura do convênio empresarial foi atualizada com os novos colaboradores.</div>',
    status: 'in_progress', priority: 'none', assigneeUserId: 'usr_ana', tags: ['Financeiro'],
    createdBy: 'user', createdAt: ago(2 * day),
    activity: [act(ago(2 * day), 'usr_ana', 'Criou esta tarefa'), act(ago(2 * day - 20 * 60000), 'usr_ana', 'Estado: A fazer → Em andamento')],
  })

  // 5 — dúvida de convênio no chat: IA, prioridade baixa
  const chatConvenio = pick('agt_maria', 'Dúvida sobre convênio') ?? pick('agt_maria', 'Horário de funcionamento')
  add({
    id: 'tsk_tabela_convenios', title: 'Enviar tabela de convênios ao paciente',
    description: '<div>Paciente perguntou quais convênios são aceitos. Enviar a tabela de convênios 2026 e explicar o reembolso.</div>',
    status: 'todo', priority: 'low', assigneeUserId: 'usr_ana', dueAt: dueAt(3, 10), tags: ['Convênio', 'Criada por IA'],
    createdBy: 'ai', agentId: 'agt_maria', conversationId: chatConvenio?.id, contactId: chatConvenio?.contactId, simulated: true, createdAt: ago(1 * day),
    activity: [act(ago(1 * day), 'ai', 'Criou esta tarefa'), act(ago(1 * day - hour), 'usr_ana', 'Responsável: Sem responsável → Ana Ribeiro')],
  })

  // 6 — urgência (Roberta): concluída
  const urg = pick('agt_roberta', 'Dor de dente – urgência')
  add({
    id: 'tsk_encaixe_urgencia', title: 'Encaixe de urgência – dor de dente',
    description: '<div>Paciente com dor forte transferido para a recepção. Confirmar o encaixe no mesmo dia.</div>',
    status: 'done', priority: 'high', assigneeUserId: 'usr_carlos', dueAt: dueAt(-2, 17), tags: ['Urgência'],
    createdBy: 'user', agentId: 'agt_roberta', conversationId: urg?.id, contactId: urg?.contactId, createdAt: ago(3 * day),
    activity: [
      act(ago(3 * day), 'usr_ana', 'Criou esta tarefa'),
      act(ago(3 * day - 30 * 60000), 'usr_ana', 'Responsável: Sem responsável → Carlos Mendes'),
      act(ago(2 * day + 5 * hour), 'usr_carlos', 'Estado: Em andamento → Concluída'),
    ],
  })

  // 7 — orçamento de clareamento (Roberta): a fazer, Comercial
  const preco = pick('agt_roberta', 'Valor do clareamento')
  add({
    id: 'tsk_clareamento', title: 'Ligar para paciente interessado em clareamento',
    description: '<div>Pediu o valor do clareamento e disse que retornaria. Oferecer a avaliação gratuita e o parcelamento em 6x.</div>',
    status: 'todo', priority: 'medium', assigneeUserId: 'usr_ana', dueAt: dueAt(2, 9, 30), tags: ['Comercial'],
    createdBy: 'user', agentId: 'agt_roberta', conversationId: preco?.id, contactId: preco?.contactId, createdAt: ago(20 * hour),
    activity: [act(ago(20 * hour), 'usr_ana', 'Criou esta tarefa')],
  })

  // 8 — remarcação: atrasada (vencida ontem)
  const remarcar = pick('agt_roberta', 'Remarcação de consulta')
  add({
    id: 'tsk_remarcacao', title: 'Confirmar remarcação de quarta às 9h',
    description: '<div>Consulta remarcada pela assistente. Conferir se a confirmação chegou ao paciente.</div>',
    status: 'todo', priority: 'medium', assigneeUserId: 'usr_ana', dueAt: dueAt(-1, 11), tags: ['Agendamento'],
    createdBy: 'user', agentId: 'agt_roberta', conversationId: remarcar?.id, contactId: remarcar?.contactId, createdAt: ago(2 * day + 3 * hour),
    activity: [act(ago(2 * day + 3 * hour), 'usr_carlos', 'Criou esta tarefa'), act(ago(2 * day), 'usr_carlos', 'Responsável: Carlos Mendes → Ana Ribeiro')],
  })

  // 9 — cadastro: concluída, baixa
  add({
    id: 'tsk_cadastro_odontomais', title: 'Atualizar cadastro do convênio OdontoMais',
    description: '<div>Atualizar o código de credenciamento na tabela de convênios.</div>',
    status: 'done', priority: 'low', assigneeUserId: 'usr_carlos', tags: ['Cadastro', 'Convênio'],
    createdBy: 'user', createdAt: ago(9 * day),
    activity: [act(ago(9 * day), 'usr_carlos', 'Criou esta tarefa'), act(ago(6 * day), 'usr_carlos', 'Estado: A fazer → Concluída')],
  })

  // 10 — chat sobre horário: IA, cancelada
  const horario = pick('agt_maria', 'Horário de funcionamento')
  add({
    id: 'tsk_horario_sabado', title: 'Responder dúvida sobre atendimento no sábado',
    description: '<div>O contato perguntou se há atendimento no sábado. A própria assistente respondeu; nenhuma ação necessária.</div>',
    status: 'canceled', priority: 'none', tags: ['Criada por IA'],
    createdBy: 'ai', agentId: 'agt_maria', conversationId: horario?.id, contactId: horario?.contactId, simulated: true, createdAt: ago(4 * day),
    activity: [act(ago(4 * day), 'ai', 'Criou esta tarefa'), act(ago(4 * day - 2 * hour), 'usr_ana', 'Estado: A fazer → Cancelada')],
  })

  // 11 — interna, sem vencimento
  add({
    id: 'tsk_boas_vindas_chat', title: 'Revisar a mensagem de boas-vindas do chat',
    description: '<div>Deixar a saudação da Maria mais curta e incluir o horário de atendimento.</div>',
    status: 'todo', priority: 'none', assigneeUserId: 'usr_ana', tags: ['Interno'],
    createdBy: 'user', agentId: 'agt_maria', createdAt: ago(6 * hour),
    activity: [act(ago(6 * hour), 'usr_ana', 'Criou esta tarefa')],
  })

  return tasks
}

export default function seed(now: Date): Partial<DemoDB> {
  return { tasks: buildTaskSeed(now) }
}
