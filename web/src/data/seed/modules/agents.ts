import type { DemoDB, KnowledgeEntry, KnowledgeSource } from '@/domain/types'
import '@/domain/ext/agents'

/**
 * Seed adicional do módulo "agents" (arrays são concatenados ao seed base).
 * Dados fictícios da organização de demonstração "Clínica Bem Viver" (org_bemviver).
 * - Entradas "Gerado automaticamente" (ícone ✨) e um documento PDF para a Roberta.
 * - Algumas entradas manuais para a Maria (assistente de chat). Joana fica sem conhecimento (estado vazio).
 */
export default function seed(now: Date): Partial<DemoDB> {
  const orgId = 'org_bemviver'
  const day = 86400000
  const iso = (ms: number) => new Date(ms).toISOString()

  const knowledgeSources: KnowledgeSource[] = [
    {
      id: 'kbs_doc_convenios', orgId, agentId: 'agt_roberta', type: 'document', label: 'Tabela de convênios 2026', fileName: 'tabela-de-convenios-2026.pdf',
      sizeBytes: 1_284_000, status: 'ready', enabled: true, updatedAt: iso(now.getTime() - 3 * day),
    },
  ]

  const auto: [string, string][] = [
    ['A Clínica Bem Viver atende qual perfil de paciente?', 'Atendemos adultos e crianças, com foco em tratamentos odontológicos preventivos, estéticos e de reabilitação.'],
    ['Há quanto tempo a clínica funciona?', 'A Clínica Bem Viver atende na Vila Mariana desde 2012.'],
    ['A clínica tem estacionamento?', 'Sim, há estacionamento conveniado ao lado da clínica, com 1 hora gratuita para pacientes.'],
    ['Quais são os diferenciais da clínica?', 'Avaliação gratuita para novos pacientes, parcelamento sem juros e atendimento de urgência no mesmo dia.'],
  ]
  const docs: [string, string][] = [
    ['Quais convênios odontológicos são aceitos?', 'OdontoMais, Sorriso Total e Dental Prime. Outros convênios podem ser atendidos por reembolso.'],
    ['O convênio cobre clareamento?', 'Na maioria dos planos, o clareamento não tem cobertura. Consulte a tabela do seu plano na recepção.'],
  ]
  const maria: [string, string][] = [
    ['Posso agendar pelo WhatsApp?', 'Sim! Informe seu nome, o melhor dia e horário, e confirmamos a avaliação pelo próprio WhatsApp.'],
    ['Vocês respondem fora do horário comercial?', 'A assistente responde 24 horas; pedidos fora do horário são retornados pela equipe no próximo dia útil.'],
    ['Como envio meus exames?', 'Você pode enviar fotos ou PDF dos exames aqui mesmo na conversa; eles serão anexados ao seu cadastro.'],
  ]

  const knowledgeEntries: KnowledgeEntry[] = [
    ...auto.map(([question, answer], i) => ({
      id: `kbe_auto_${i + 1}`, orgId, agentId: 'agt_roberta', question, answer, source: 'auto' as const, usageCount: i === 2 ? 2 : 0,
      createdAt: iso(now.getTime() - 99 * day),
    })),
    ...docs.map(([question, answer], i) => ({
      id: `kbe_doc_${i + 1}`, orgId, agentId: 'agt_roberta', question, answer, source: 'document' as const, sourceLabel: 'Tabela de convênios 2026',
      sourceId: 'kbs_doc_convenios', usageCount: i === 0 ? 4 : 0, createdAt: iso(now.getTime() - 3 * day),
    })),
    ...maria.map(([question, answer], i) => ({
      id: `kbe_maria_${i + 1}`, orgId, agentId: 'agt_maria', question, answer, source: 'manual' as const, usageCount: i === 0 ? 3 : 0,
      createdAt: iso(now.getTime() - 20 * day),
    })),
  ]

  return { knowledgeSources, knowledgeEntries }
}
