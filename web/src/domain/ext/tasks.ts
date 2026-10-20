/**
 * Extensões de tipo do módulo "tasks" (Tarefas BETA — Central de ajuda, artigo products/tasks: quadros TK-V01…TK-V05).
 * Somente campos OPCIONAIS — dados antigos e o seed base continuam válidos.
 *
 * Persistência: as tarefas ficam em `DemoDB.tasks` (opcional; ausente em bancos gravados antes deste módulo).
 * Leitura/escrita: use os helpers de `src/app/pages/tasks/model.ts` (useTasks, createTask, updateTask…).
 */
import type { ID, ISODate } from '@/domain/types'

/** Estados da tarefa (rótulos PT-BR em TASK_STATUS_LABEL). */
export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'canceled'
/** Prioridade ("Sem prioridade" = 'none'). */
export type TaskPriority = 'none' | 'low' | 'medium' | 'high'

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  todo: 'A fazer',
  in_progress: 'Em andamento',
  done: 'Concluída',
  canceled: 'Cancelada',
}

export const TASK_PRIORITY_LABEL: Record<TaskPriority, string> = {
  none: 'Sem prioridade',
  low: 'Baixa',
  medium: 'Média',
  high: 'Alta',
}

/** Ordem para "a maior prioridade correspondente é usada" (TK-V04) e para ordenação. */
export const TASK_PRIORITY_RANK: Record<TaskPriority, number> = { none: 0, low: 1, medium: 2, high: 3 }

/** Entrada do log "Atividade" (TK-V03): autor (usuário ou 'ai'), instante e a mudança ("Título: A → B", "Criou esta tarefa"). */
export interface TaskActivity {
  id: ID
  at: ISODate
  /** id do usuário que fez a mudança; 'ai' quando criada/alterada pela IA; ausente = sistema. */
  userId?: ID | 'ai'
  change: string
}

export interface Task {
  id: ID
  orgId: ID
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  assigneeUserId?: ID
  dueAt?: ISODate
  tags: string[]
  createdBy: 'ai' | 'user'
  /** assistente que criou a tarefa (habilidade "Criar tarefa") */
  agentId?: ID
  /** conversa de origem — o detalhe abre /app/inbox/<id> */
  conversationId?: ID
  contactId?: ID
  activity: TaskActivity[]
  /** criada por uma simulação local (habilidade "Criar tarefa" em conversa de teste/seed) */
  simulated?: boolean
  createdAt: ISODate
  updatedAt: ISODate
}

/** Regra da habilidade "Criar tarefa" (TK-V04): tags + responsável + prioridade, aplicada Sempre ou Somente se… */
export interface TaskAbilityRule {
  id: ID
  tags: string[]
  assigneeUserId?: ID
  priority?: TaskPriority
  when: 'always' | 'only_if'
  /** "Somente se…": condição descrita em linguagem natural (simulada por palavras-chave na demonstração). */
  condition?: string
}

/** Configuração da habilidade "Criar tarefa" de um assistente de chat (folha "CONFIGURAÇÕES DA TAREFA"). */
export interface TaskAbilityConfig {
  enabled: boolean
  /** nome exibido no título da folha (✎); padrão "Criar tarefa" */
  name?: string
  /** "Instruções da tarefa" — o que o título e a descrição devem conter. */
  instructions: string
  /** "Status inicial" das tarefas criadas. */
  initialStatus: TaskStatus
  /** switch "Adicionar atribuições, tags ou prioridades" */
  rulesEnabled: boolean
  rules: TaskAbilityRule[]
  updatedAt?: ISODate
}

export const DEFAULT_TASK_INSTRUCTIONS =
  'Resuma a solicitação e os próximos passos. Inclua os dados de contato quando disponíveis.'

declare module '@/domain/types' {
  interface Organization {
    /** Recursos em BETA ativados pela organização. `tasks` liga o módulo Tarefas (BETA). */
    betaFeatures?: { tasks?: boolean }
  }
  interface Agent {
    /** Habilidade "Criar tarefa" (somente assistentes de chat). */
    taskActions?: TaskAbilityConfig
  }
  interface UiPrefs {
    /** Últimos filtros/ordenação da lista de Tarefas (query string), restaurados ao voltar para /app/tasks sem parâmetros. */
    tasks?: { query?: string }
  }
  interface DemoDB {
    /**
     * Tarefas (BETA). Chave obrigatória no tipo (um campo opcional quebraria `CollectionKey`), mas bancos gravados
     * antes deste módulo não a têm em tempo de execução: leia sempre via `db.tasks ?? []` (helpers de tasks/model.ts).
     * Não está em ORG_SCOPED do store: filtre por `orgId` (useTasks) e informe `orgId` ao inserir.
     */
    tasks: Task[]
  }
}
