import type { ApiKey, DemoDB, Invite } from '@/domain/types'
import '@/domain/ext/mais-b'

/**
 * Seed adicional do módulo "mais-b" (arrays são concatenados ao seed base).
 *
 * Decisão documentada (docs/coverage/mais-b.md):
 * - E-Mail IA: a organização demo ("Clínica Bem Viver") NÃO tem assinatura E-Mail IA no seed base, então
 *   mantemos o estado OBSERVADO na Fonio (sem caixa de entrada + diálogo de assinatura). Nenhuma caixa é
 *   semeada. Ao conectar uma caixa (E-Mail IA, Configurações da empresa ou Conta, recurso "IA de e-mail"),
 *   a primeira sincronização simulada cria 8 e-mails recebidos + 2 enviados fictícios (ver
 *   src/app/pages/email-agents/mailbox.ts).
 * - Integrações, Usuários (membros), Conexões e Indicações vêm do seed base (src/data/seed/demo.ts).
 * - Rodada 2 (paginação observável): +11 chaves de API e +11 convites históricos (expirados/revogados) fictícios,
 *   para que as tabelas de Chaves de API e Convites tenham mais de uma página (10 linhas por página).
 *   Os convites NÃO são pendentes, então não consomem o limite de usuários do plano (Voice Solo = 3).
 */
const DAY = 86400_000

const KEYS: [name: string, last4: string, createdDaysAgo: number, lastUsedDaysAgo: number | null][] = [
  ['Make — agenda de retornos', '7c21', 2, 0],
  ['Zapier — planilha de leads', 'a90e', 4, 1],
  ['Site institucional (formulário)', '51bd', 6, 2],
  ['Teste local — recepção', 'e3f4', 9, null],
  ['n8n (homologação)', '0d6a', 13, 8],
  ['CRM da clínica — sincronização', '88c2', 17, 3],
  ['Painel interno de relatórios', 'b4e7', 24, 5],
  ['Lembretes por WhatsApp (script)', '3a19', 31, 12],
  ['Importação de contatos (CSV)', 'f052', 38, 37],
  ['Webhook do agendador', '6e8d', 45, 20],
  ['Integração antiga (desativar)', 'c7b0', 70, 64],
]

const INVITES: [first: string, last: string, email: string, role: Invite['role'], status: 'expired' | 'revoked', createdDaysAgo: number][] = [
  ['Renata', 'Lopes', 'renata.lopes@exemplo.com.br', 'editor', 'expired', 15],
  ['Bruno', 'Teixeira', 'bruno.teixeira@exemplo.com.br', 'viewer', 'revoked', 18],
  ['Juliana', 'Prado', 'juliana.prado@exemplo.com.br', 'builder', 'expired', 22],
  ['Marcos', 'Viana', 'marcos.viana@exemplo.com.br', 'viewer', 'revoked', 27],
  ['Fernanda', 'Rocha', 'fernanda.rocha@exemplo.com.br', 'editor', 'expired', 33],
  ['Tiago', 'Barros', 'tiago.barros@exemplo.com.br', 'viewer', 'expired', 41],
  ['Camila', 'Nunes', 'camila.nunes@exemplo.com.br', 'builder', 'revoked', 48],
  ['Rafael', 'Moura', 'rafael.moura@exemplo.com.br', 'viewer', 'expired', 55],
  ['Larissa', 'Campos', 'larissa.campos@exemplo.com.br', 'editor', 'revoked', 63],
  ['Diego', 'Farias', 'diego.farias@exemplo.com.br', 'viewer', 'expired', 72],
  ['Patrícia', 'Gomes', 'patricia.gomes@exemplo.com.br', 'admin', 'revoked', 84],
]

export default function seed(now: Date): Partial<DemoDB> {
  const orgId = 'org_bemviver'
  const t = now.getTime()
  const iso = (ms: number) => new Date(ms).toISOString()
  const apiKeys: ApiKey[] = KEYS.map(([name, last4, created, used], i) => ({
    id: `key_mb_${i + 1}`,
    orgId,
    name,
    prefix: 'klo_live_',
    secret: `klo_live_••••••••••••${last4}`,
    last4,
    createdAt: iso(t - created * DAY - (i + 1) * 3600_000),
    lastUsedAt: used === null ? undefined : iso(t - used * DAY - 2 * 3600_000),
    createdByUserId: i % 3 === 1 ? 'usr_carlos' : 'usr_ana',
  }))
  const invites: Invite[] = INVITES.map(([firstName, lastName, email, role, status, created], i) => ({
    id: `inv_mb_${i + 1}`,
    orgId,
    email,
    firstName,
    lastName,
    role,
    status,
    createdAt: iso(t - created * DAY),
    lastSentAt: iso(t - created * DAY),
    expiresAt: iso(t - (created - 7) * DAY),
    invitedByUserId: 'usr_ana',
    sendCount: 1,
    revokedAt: status === 'revoked' ? iso(t - (created - 2) * DAY) : undefined,
  }))
  return { apiKeys, invites }
}
