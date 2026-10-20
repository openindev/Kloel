import type { KnowledgeEntry } from '@/domain/types'

/**
 * Base de conhecimento usada pelos testes simulados do site (WhatsApp "Teste em tempo real" e chat da página Webchat).
 * As respostas são geradas localmente por services.ai.chatReply (simulação, sem motor de IA).
 */
const QA: [string, string][] = [
  ['O que você consegue fazer pela minha empresa?', 'Posso atender seus clientes 24 horas por dia: respondo dúvidas com base nas informações da sua empresa, agendo horários, qualifico contatos e transfiro para sua equipe quando necessário — por telefone, WhatsApp ou no chat do seu site.'],
  ['Quanto custa a Kloel? Qual o preço dos planos?', 'Os planos variam conforme o volume de conversas ou minutos. Você encontra os valores na página Planos e pode começar criando sua conta.'],
  ['Preciso de um novo número de WhatsApp?', 'Você pode usar um número fornecido pela Kloel ou conectar o número do seu WhatsApp Business, desde que ele seja desvinculado do aplicativo.'],
  ['Como funciona a transferência para um humano atendente?', 'Quando a conversa precisa de uma pessoa, eu aviso sua equipe e transfiro o atendimento. Depois, a conversa pode voltar para a IA.'],
  ['A Kloel segue a LGPD? Meus dados ficam seguros e protegidos?', 'A Kloel trata dados conforme a LGPD. Os detalhes estão na página Proteção de dados da Central de ajuda.'],
  ['Quanto tempo leva para configurar e colocar no ar?', 'Em poucos minutos você cria o assistente, adiciona as informações da empresa pelo site ou por PDFs e já pode testar.'],
  ['Quais idiomas o assistente entende e fala?', 'Reconheço o idioma do cliente e respondo automaticamente nele — português, espanhol, inglês e muitos outros.'],
  ['Vocês agendam horários, consultas e compromissos? Consegue agendar na agenda?', 'Sim! Com a agenda conectada, verifico a disponibilidade e marco o horário durante a conversa.'],
  ['Entende áudio, mensagens de voz e documentos PDF?', 'Sim, entendo mensagens de voz e leio PDFs enviados pelo cliente para responder com precisão.'],
  ['Como falo com um especialista ou agendo uma demonstração?', 'É só clicar em “Agendar demonstração” no site e escolher um horário com nosso time.'],
]

export const KLOEL_KNOWLEDGE: KnowledgeEntry[] = QA.map(([question, answer], i) => ({
  id: `site-kb-${i}`,
  orgId: 'site',
  agentId: 'site',
  question,
  answer,
  source: 'manual',
  usageCount: 0,
  createdAt: '2026-10-18T00:00:00.000Z',
}))

export const KLOEL_SITE_AGENT = {
  name: 'Kloel',
  companyInfo: 'Kloel — assistentes de IA por voz, WhatsApp e webchat para PMEs.',
  greeting: 'Olá! Eu sou a assistente da Kloel. Como posso ajudar?',
}
