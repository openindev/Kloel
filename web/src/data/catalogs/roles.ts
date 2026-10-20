import type { Role } from '@/domain/types'
export const ROLES: { value: Role; label: string; description: string }[] = [
  { value: 'admin', label: 'Admin', description: 'Acesso total, incluindo faturamento, pagamentos, usuários e gerenciamento de todos os recursos.' },
  { value: 'editor', label: 'Editor', description: 'Gerencia assistentes, base de conhecimento, números de telefone, gravações de ligações e chaves de API.' },
  { value: 'builder', label: 'Builder', description: 'Gerencia assistentes e base de conhecimento, com acesso de leitura a números de telefone, histórico de ligações e histórico de chats.' },
  { value: 'viewer', label: 'Visualizador', description: 'Acesso somente leitura à lista de assistentes, base de conhecimento, números de telefone, histórico de ligações e histórico de chats.' },
]
export const roleLabel = (r: Role) => ROLES.find((x) => x.value === r)?.label ?? r
