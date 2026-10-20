// Catálogo de integrações — idêntico a app.fonio.ai/integrations (levantamento ao vivo 2026-10-18,
// docs/reference/fonio-live2/data/integrations.json): 113 cartões na ordem original, 27 Disponível, 20 Acesso antecipado,
// 66 Em breve; 11 categorias com a mesma participação. Troca só de marca nas descrições (Fonio/fonio → Kloel; "ao/do fonio"
// → "à/da Kloel"). "Abrir guia" (fonio.info/pt-br/…) aponta para o artigo local /ajuda/<path>[#âncora]; "Começar agora!" usa a
// rota interna original (a página prefixa /app). Logos: arquivo original servido pela Fonio, baixado e higienizado por
// scripts/fetch-integration-logos.mjs em public/integrations/ (campo `logo`, relativo a public/), exibido por <IntegrationLogo/>.
// Fidelidade: a Fonio usa o mesmo arquivo para Protel e eTermin (mesmo sha256) e hubspot.svg para HubSpot e HubSpot Calling.

export type IntegrationCategory = "CRM" | "Agenda" | "Comunicação" | "PABX" | "E-commerce" | "Automação" | "Saúde" | "Gestão de imóveis" | "Hotelaria" | "Beleza & Fitness" | "Ofícios"

/** Disponível · Acesso antecipado · Em breve. */
export type IntegrationStatus = 'available' | 'early_access' | 'coming_soon'

/**
 * CTA do cartão por status (Fonio): Disponível → "Começar agora!" (rota interna) ou "Abrir guia" (central de ajuda);
 * Acesso antecipado → "Solicitar acesso"; Em breve → "Notifique-me".
 */
export type IntegrationCta = { kind: 'internal'; path: string } | { kind: 'guide'; path: string } | { kind: 'request' } | { kind: 'notify' }

export interface CatalogIntegration {
  /** Posição no catálogo da Fonio (1–113). */
  order: number
  slug: string
  name: string
  status: IntegrationStatus
  category: IntegrationCategory
  /** Logo original, caminho relativo a public/ (ex.: "integrations/hubspot.svg"). */
  logo: string
  description: string
  cta: IntegrationCta
}

/** Chip "Todas" (primeiro, ativo por padrão) seguido das 11 categorias na ordem da Fonio. */
export const INTEGRATION_ALL_CATEGORY = 'Todas'
export const INTEGRATION_CATEGORIES: IntegrationCategory[] = ["CRM", "Agenda", "Comunicação", "PABX", "E-commerce", "Automação", "Saúde", "Gestão de imóveis", "Hotelaria", "Beleza & Fitness", "Ofícios"]

export const INTEGRATION_STATUS_LABEL: Record<IntegrationStatus, string> = { available: 'Disponível', early_access: 'Acesso antecipado', coming_soon: 'Em breve' }

/** Cores do badge de status (base: rounded-full border-transparent px-3 py-0.5 text-sm font-semibold). */
export const INTEGRATION_STATUS_BADGE_CLASS: Record<IntegrationStatus, string> = {
  available: 'bg-emerald-100 text-emerald-700',
  early_access: 'bg-brand/10 text-brand',
  coming_soon: 'bg-secondary text-secondary-foreground',
}

/** Rótulo, ícone lucide (nome no DOM da Fonio) e estilo do botão de cada CTA (h-9 w-full, mt-auto pt-1). */
export const INTEGRATION_CTA: Record<IntegrationCta['kind'], { label: string; icon: 'arrow-right' | 'external-link' | 'key-round' | 'bell'; variant: 'secondary' | 'outline'; newTab?: true }> = {
  internal: { label: 'Começar agora!', icon: 'arrow-right', variant: 'secondary' },
  guide: { label: 'Abrir guia', icon: 'external-link', variant: 'outline', newTab: true },
  request: { label: 'Solicitar acesso', icon: 'key-round', variant: 'outline' },
  notify: { label: 'Notifique-me', icon: 'bell', variant: 'outline' },
}

export const INTEGRATIONS: CatalogIntegration[] = [
  { order: 1, slug: "whatsapp-business", name: "WhatsApp Business", status: 'available', category: "Comunicação", logo: "integrations/whatsapp-business.svg", description: "Deixe seu agente de IA responder às solicitações dos clientes também pelo WhatsApp.", cta: { kind: 'internal', path: "/whatsapp" } },
  { order: 2, slug: "microsoft-outlook-mail", name: "Microsoft Outlook Mail", status: 'available', category: "Comunicação", logo: "integrations/microsoft-outlook-mail.svg", description: "Automatize seus fluxos de trabalho de e-mail e colabore com um agente de IA.", cta: { kind: 'internal', path: "/email-agents" } },
  { order: 3, slug: "google-mail", name: "Google Mail", status: 'available', category: "Comunicação", logo: "integrations/google-mail.svg", description: "Automatize seus fluxos de trabalho de e-mail e colabore com um agente de IA.", cta: { kind: 'internal', path: "/email-agents" } },
  { order: 4, slug: "hubspot", name: "HubSpot", status: 'early_access', category: "CRM", logo: "integrations/hubspot.svg", description: "Reconhece quem liga a partir dos seus contatos e empresas no HubSpot, cria leads e registra cada chamada com resumo e gravação.", cta: { kind: 'request' } },
  { order: 5, slug: "hubspot-calling", name: "HubSpot Calling", status: 'early_access', category: "CRM", logo: "integrations/hubspot.svg", description: "Leve sua telefonia Kloel para o HubSpot e ligue para contatos direto do registro.", cta: { kind: 'request' } },
  { order: 6, slug: "microsoft-outlook-calendar", name: "Microsoft Outlook Calendar", status: 'available', category: "Agenda", logo: "integrations/microsoft-outlook-calendar.svg", description: "Com o Agendador Kloel — verifique disponibilidade em tempo real, agende compromissos, envie confirmações e lembretes, tudo durante uma chamada.", cta: { kind: 'internal', path: "/scheduling" } },
  { order: 7, slug: "calendly", name: "Calendly", status: 'available', category: "Agenda", logo: "integrations/calendly.svg", description: "Agende compromissos durante chamadas verificando a disponibilidade e enviando links de confirmação.", cta: { kind: 'guide', path: "actions/appointments" } },
  { order: 8, slug: "odoo", name: "Odoo", status: 'early_access', category: "CRM", logo: "integrations/odoo.svg", description: "Reconhece quem liga a partir dos seus contatos no Odoo, cria novos leads e escreve um resumo de cada conversa no chatter.", cta: { kind: 'request' } },
  { order: 9, slug: "n8n", name: "n8n", status: 'available', category: "Automação", logo: "integrations/n8n.svg", description: "Acione fluxos de trabalho automatizados e conecte-se a centenas de serviços via n8n.", cta: { kind: 'guide', path: "integrations/n8n" } },
  { order: 10, slug: "twilio", name: "Twilio", status: 'available', category: "PABX", logo: "integrations/twilio.svg", description: "Conecte seus números Twilio à Kloel via Elastic SIP Trunking.", cta: { kind: 'guide', path: "phone-systems/sip-numbers#twilio" } },
  { order: 11, slug: "google-calendar", name: "Google Calendar", status: 'available', category: "Agenda", logo: "integrations/google-calendar.svg", description: "Com o Agendador Kloel — verifique disponibilidade em tempo real, agende compromissos, envie confirmações e lembretes, tudo durante uma chamada.", cta: { kind: 'internal', path: "/scheduling" } },
  { order: 12, slug: "3cx", name: "3CX", status: 'available', category: "PABX", logo: "integrations/3cx.png", description: "Conecte seu PABX 3CX à Kloel via tronco SIP.", cta: { kind: 'guide', path: "phone-systems/sip-numbers#3cx" } },
  { order: 13, slug: "make", name: "Make", status: 'available', category: "Automação", logo: "integrations/makecom.svg", description: "Dispare cenários do Make antes, durante ou depois de uma conversa e conecte milhares de apps.", cta: { kind: 'guide', path: "integrations/makecom" } },
  { order: 14, slug: "notion", name: "Notion", status: 'available', category: "Automação", logo: "integrations/notion.svg", description: "Carregue páginas e bancos de dados selecionados do Notion no contexto do seu agente antes de cada conversa.", cta: { kind: 'guide', path: "integrations/notion" } },
  { order: 15, slug: "fritz-box", name: "FRITZ!Box", status: 'available', category: "PABX", logo: "integrations/fritzbox.png", description: "Encaminhe chamadas da sua FRITZ!Box para o seu agente Kloel via SIP.", cta: { kind: 'guide', path: "phone-systems/sip-numbers" } },
  { order: 16, slug: "pipedrive", name: "Pipedrive", status: 'early_access', category: "CRM", logo: "integrations/pipedrive.svg", description: "Reconhece quem liga, informa o status de negócios e projetos, agenda reuniões com o vendedor responsável e registra cada chamada.", cta: { kind: 'request' } },
  { order: 17, slug: "google-sheets", name: "Google Sheets", status: 'available', category: "Automação", logo: "integrations/google-sheets.svg", description: "Leia linhas de uma planilha ou adicione novas — antes, durante ou depois de uma chamada.", cta: { kind: 'guide', path: "integrations/google-sheets" } },
  { order: 18, slug: "cal-com", name: "Cal.com", status: 'available', category: "Agenda", logo: "integrations/cal-com.svg", description: "Agende reuniões facilmente com disponibilidade de horários em tempo real durante as conversas.", cta: { kind: 'guide', path: "actions/appointments" } },
  { order: 19, slug: "zapier", name: "Zapier", status: 'available', category: "Automação", logo: "integrations/zapier.png", description: "Acione fluxos de trabalho automatizados e conecte-se a milhares de aplicativos via Zapier.", cta: { kind: 'guide', path: "integrations/zapier" } },
  { order: 20, slug: "yealink", name: "Yealink", status: 'early_access', category: "PABX", logo: "integrations/yealink.png", description: "Use telefones de mesa Yealink com o PABX da Kloel.", cta: { kind: 'request' } },
  { order: 21, slug: "woocommerce", name: "WooCommerce", status: 'early_access', category: "E-commerce", logo: "integrations/woocommerce.svg", description: "Responde a perguntas sobre sua loja e seus pedidos e cuida de cancelamentos, devoluções e pedidos por telefone.", cta: { kind: 'request' } },
  { order: 22, slug: "gohighlevel", name: "GoHighLevel", status: 'available', category: "CRM", logo: "integrations/gohighlevel.png", description: "Reconhece quem liga na sua subconta, mantém os contatos atualizados, agenda, remarca e cancela compromissos e salva notas da chamada.", cta: { kind: 'guide', path: "integrations/gohighlevel" } },
  { order: 23, slug: "easybell", name: "easybell", status: 'available', category: "PABX", logo: "integrations/easybell.png", description: "Conecte sua linha easybell à Kloel via tronco SIP.", cta: { kind: 'guide', path: "phone-systems/sip-numbers#easybell" } },
  { order: 24, slug: "xero", name: "Xero", status: 'early_access', category: "CRM", logo: "integrations/xero.svg", description: "Reconhece quem liga, adiciona novos contatos ao Xero e salva uma nota de cada chamada.", cta: { kind: 'request' } },
  { order: 25, slug: "airtable", name: "Airtable", status: 'available', category: "Automação", logo: "integrations/airtable.svg", description: "Pesquise registros ou crie novos antes, durante ou depois de uma conversa.", cta: { kind: 'guide', path: "integrations/airtable" } },
  { order: 26, slug: "etermin", name: "eTermin", status: 'available', category: "Agenda", logo: "integrations/etermin.svg", description: "Agende e gerencie compromissos pelo sistema de agendamento online do eTermin.", cta: { kind: 'internal', path: "/agents" } },
  { order: 27, slug: "slack", name: "Slack", status: 'available', category: "Comunicação", logo: "integrations/slack.svg", description: "Envie resumos de chamadas, alertas e tarefas de acompanhamento para canais da equipe em tempo real.", cta: { kind: 'guide', path: "integrations/slack" } },
  { order: 28, slug: "thefork", name: "TheFork", status: 'early_access', category: "Hotelaria", logo: "integrations/thefork.svg", description: "Verifica mesas disponíveis, faz reservas e as altera ou cancela por telefone.", cta: { kind: 'request' } },
  { order: 29, slug: "onoffice", name: "onOffice", status: 'early_access', category: "Gestão de imóveis", logo: "integrations/onoffice.svg", description: "Responde a perguntas sobre seus imóveis, agenda visitas no calendário do corretor responsável, registra interessados e cada chamada.", cta: { kind: 'request' } },
  { order: 30, slug: "teamleader", name: "Teamleader", status: 'early_access', category: "CRM", logo: "integrations/teamleader.svg", description: "Reconhece quem liga, informa os negócios em aberto no Teamleader e cria ou atualiza contatos.", cta: { kind: 'request' } },
  { order: 31, slug: "baselinker", name: "BaseLinker", status: 'early_access', category: "E-commerce", logo: "integrations/baselinker.svg", description: "Diga a quem liga onde está o pedido e envie o link de rastreamento, direto do BaseLinker.", cta: { kind: 'request' } },
  { order: 32, slug: "simplybook-me", name: "SimplyBook.me", status: 'early_access', category: "Agenda", logo: "integrations/simplybook.svg", description: "Verifica horários livres, agenda compromissos durante a chamada e pode remarcá-los ou cancelá-los.", cta: { kind: 'request' } },
  { order: 33, slug: "yeastar", name: "Yeastar", status: 'available', category: "PABX", logo: "integrations/yeastar.png", description: "Conecte seu PABX Yeastar à Kloel via tronco SIP.", cta: { kind: 'guide', path: "phone-systems/sip-numbers#yeastar" } },
  { order: 34, slug: "telnyx", name: "Telnyx", status: 'available', category: "PABX", logo: "integrations/telnyx.png", description: "Conecte seus números Telnyx à Kloel via tronco SIP.", cta: { kind: 'guide', path: "phone-systems/sip-numbers#telnyx" } },
  { order: 35, slug: "hostaway", name: "Hostaway", status: 'early_access', category: "Hotelaria", logo: "integrations/hostaway.svg", description: "Encontra as reservas dos hóspedes que ligam e compartilha códigos de porta e dados do Wi-Fi para estadias confirmadas.", cta: { kind: 'request' } },
  { order: 36, slug: "zadarma", name: "Zadarma", status: 'available', category: "PABX", logo: "integrations/zadarma.png", description: "Conecte seus números Zadarma à Kloel via tronco SIP.", cta: { kind: 'guide', path: "phone-systems/sip-numbers#zadarma" } },
  { order: 37, slug: "peoplefone", name: "peoplefone", status: 'available', category: "PABX", logo: "integrations/peoplefone.png", description: "Conecte seu Elastic SIP Trunk da peoplefone à Kloel.", cta: { kind: 'guide', path: "phone-systems/sip-numbers" } },
  { order: 38, slug: "magicline", name: "Magicline", status: 'early_access', category: "Beleza & Fitness", logo: "integrations/magicline.png", description: "Agenda aulas e treinos experimentais, cancela reservas e responde aos membros sobre seus pagamentos.", cta: { kind: 'request' } },
  { order: 39, slug: "servicetitan", name: "ServiceTitan", status: 'early_access', category: "Ofícios", logo: "integrations/servicetitan.svg", description: "Envia cada solicitação de serviço real ao ServiceTitan como reserva após a chamada, pronta para sua equipe transformar em um serviço.", cta: { kind: 'request' } },
  { order: 40, slug: "bexio", name: "Bexio", status: 'early_access', category: "CRM", logo: "integrations/bexio.svg", description: "Reconhece quem liga, responde sobre faturas, orçamentos, pedidos e projetos, reenvia faturas e cria tarefas de retorno de ligação.", cta: { kind: 'request' } },
  { order: 41, slug: "google-address-validation", name: "Google Address Validation", status: 'early_access', category: "Automação", logo: "integrations/google-address-validation.svg", description: "Verifica e corrige endereços postais durante a chamada e sinaliza os incompletos.", cta: { kind: 'request' } },
  { order: 42, slug: "wincasa", name: "WinCasa", status: 'available', category: "Gestão de imóveis", logo: "integrations/wincasa.svg", description: "Identifica inquilinos pelo número de telefone, cria tickets de danos e registra as chamadas.", cta: { kind: 'guide', path: "integrations/wincasa" } },
  { order: 43, slug: "baserow", name: "Baserow", status: 'available', category: "Automação", logo: "integrations/baserow.svg", description: "Consulte registros de clientes ou adicione linhas a uma tabela Baserow durante as conversas.", cta: { kind: 'internal', path: "/agents" } },
  { order: 44, slug: "livespace", name: "Livespace", status: 'early_access', category: "CRM", logo: "integrations/livespace.svg", description: "Reconhece quem liga a partir do seu CRM Livespace, cria leads, agenda compromissos e salva notas da chamada.", cta: { kind: 'request' } },
  { order: 45, slug: "idobooking", name: "IdoBooking", status: 'early_access', category: "Hotelaria", logo: "integrations/idobooking.svg", description: "Responde a perguntas sobre seus quartos, verifica disponibilidade e preços e cria ou cancela reservas.", cta: { kind: 'request' } },
  { order: 46, slug: "stora", name: "Stora", status: 'available', category: "Gestão de imóveis", logo: "integrations/stora.svg", description: "Reconhece clientes pelo número de telefone, verifica unidades disponíveis e abre um negócio quando alguém quer alugar.", cta: { kind: 'guide', path: "integrations/stora" } },
  { order: 47, slug: "idosell", name: "IdoSell", status: 'early_access', category: "E-commerce", logo: "integrations/idosell.svg", description: "Responde a perguntas sobre pedidos, produtos e vales e cuida de cancelamentos, devoluções, assinaturas e pedidos por telefone.", cta: { kind: 'request' } },
  { order: 48, slug: "microsoft-teams", name: "Microsoft Teams", status: 'coming_soon', category: "Comunicação", logo: "integrations/microsoft-teams.svg", description: "Publique resultados de chamadas em canais e notifique os membros da equipe sobre ações necessárias.", cta: { kind: 'notify' } },
  { order: 49, slug: "shopify", name: "Shopify", status: 'coming_soon', category: "E-commerce", logo: "integrations/shopify.svg", description: "Informe o status de pedidos e produtos, receba pedidos por link de checkout e gerencie devoluções, trocas e cancelamentos.", cta: { kind: 'notify' } },
  { order: 50, slug: "datev", name: "DATEV", status: 'coming_soon', category: "CRM", logo: "integrations/datev.svg", description: "Recupere dados contábeis de clientes e sincronize registros de chamadas para fluxos de trabalho de consultoria fiscal.", cta: { kind: 'notify' } },
  { order: 51, slug: "stripe", name: "Stripe", status: 'coming_soon', category: "CRM", logo: "integrations/stripe.svg", description: "Verifique o status do pagamento, consulte faturas e processe cobranças durante as chamadas.", cta: { kind: 'notify' } },
  { order: 52, slug: "doctolib", name: "Doctolib", status: 'coming_soon', category: "Saúde", logo: "integrations/doctolib.svg", description: "Agende e gerencie consultas médicas durante chamadas de pacientes.", cta: { kind: 'notify' } },
  { order: 53, slug: "telegram", name: "Telegram", status: 'coming_soon', category: "Comunicação", logo: "integrations/telegram.svg", description: "Notifique equipes ou clientes com atualizações de chamadas e links de agendamento via Telegram.", cta: { kind: 'notify' } },
  { order: 54, slug: "ms-teams-phone", name: "MS Teams Phone", status: 'coming_soon', category: "PABX", logo: "integrations/ms-teams-phone.svg", description: "Roteie chamadas pelo Microsoft Teams Phone via CSP ou Operator Connect.", cta: { kind: 'notify' } },
  { order: 55, slug: "starface", name: "STARFACE", status: 'coming_soon', category: "PABX", logo: "integrations/starface.png", description: "Integre o PBX em nuvem ou híbrido STARFACE com gerenciamento de chamadas por IA.", cta: { kind: 'notify' } },
  { order: 56, slug: "zoho-crm", name: "Zoho CRM", status: 'coming_soon', category: "CRM", logo: "integrations/zoho-crm.svg", description: "Crie e atualize leads, registre atividades de chamadas e acione fluxos de trabalho a partir dos resultados.", cta: { kind: 'notify' } },
  { order: 57, slug: "zendesk", name: "Zendesk", status: 'coming_soon', category: "CRM", logo: "integrations/zendesk.svg", description: "Crie e atualize tickets de suporte a partir de chamadas, com transcrições anexadas automaticamente.", cta: { kind: 'notify' } },
  { order: 58, slug: "shopware", name: "Shopware", status: 'coming_soon', category: "E-commerce", logo: "integrations/shopware.svg", description: "Acesse catálogos de produtos e histórico de pedidos para auxiliar clientes durante as chamadas.", cta: { kind: 'notify' } },
  { order: 59, slug: "freshdesk", name: "Freshdesk", status: 'coming_soon', category: "CRM", logo: "integrations/freshdesk.svg", description: "Converta chamadas em tickets, anexe gravações e direcione para a fila de suporte correta.", cta: { kind: 'notify' } },
  { order: 60, slug: "confluence", name: "Confluence", status: 'coming_soon', category: "Automação", logo: "integrations/confluence.svg", description: "Pesquise wikis e documentação da empresa para encontrar respostas durante uma chamada.", cta: { kind: 'notify' } },
  { order: 61, slug: "opentable", name: "OpenTable", status: 'coming_soon', category: "Hotelaria", logo: "integrations/opentable.svg", description: "Verifique disponibilidade e faça reservas em restaurantes para quem liga.", cta: { kind: 'notify' } },
  { order: 62, slug: "salesforce", name: "Salesforce", status: 'coming_soon', category: "CRM", logo: "integrations/salesforce.svg", description: "Registre resultados de chamadas, crie tarefas de acompanhamento e atualize estágios de oportunidades em tempo real.", cta: { kind: 'notify' } },
  { order: 63, slug: "sap", name: "SAP", status: 'coming_soon', category: "CRM", logo: "integrations/sap.svg", description: "Acesse dados ERP corporativos de pedidos, estoque e registros de clientes durante as chamadas.", cta: { kind: 'notify' } },
  { order: 64, slug: "tomedo", name: "Tomedo", status: 'coming_soon', category: "Saúde", logo: "integrations/tomedo.svg", description: "Consulte prontuários de pacientes e agende visitas médicas a partir de chamadas.", cta: { kind: 'notify' } },
  { order: 65, slug: "telekom-companyflex", name: "Telekom CompanyFlex", status: 'coming_soon', category: "PABX", logo: "integrations/telekom-companyflex.svg", description: "SIP trunking de operadora DACH com suporte Operator Connect para Teams.", cta: { kind: 'notify' } },
  { order: 66, slug: "zoho", name: "Zoho", status: 'coming_soon', category: "CRM", logo: "integrations/zoho.svg", description: "Conecte-se ao pacote de negócios da Zoho para contatos, faturas e automação de fluxos de trabalho.", cta: { kind: 'notify' } },
  { order: 67, slug: "personio", name: "Personio", status: 'coming_soon', category: "CRM", logo: "integrations/personio.svg", description: "Automatize triagens telefônicas de candidatos e sincronize resultados com perfis de candidatura.", cta: { kind: 'notify' } },
  { order: 68, slug: "nfon", name: "NFON", status: 'coming_soon', category: "PABX", logo: "integrations/nfon.png", description: "Conecte o PBX em nuvem líder do DACH para gerenciar fluxos de chamada e ramais.", cta: { kind: 'notify' } },
  { order: 69, slug: "propstack", name: "Propstack", status: 'coming_soon', category: "Gestão de imóveis", logo: "integrations/propstack.svg", description: "Consulte detalhes de imóveis e atualize registros de CRM a partir de chamadas.", cta: { kind: 'notify' } },
  { order: 70, slug: "asana", name: "Asana", status: 'coming_soon', category: "Automação", logo: "integrations/asana.svg", description: "Crie tarefas e atualize o status do projeto com base nos resultados das chamadas.", cta: { kind: 'notify' } },
  { order: 71, slug: "casavi", name: "Casavi", status: 'coming_soon', category: "Gestão de imóveis", logo: "integrations/casavi.png", description: "Gerencie solicitações de inquilinos e coordene tarefas de gestão imobiliária por telefone.", cta: { kind: 'notify' } },
  { order: 72, slug: "immoware24", name: "Immoware24", status: 'coming_soon', category: "Gestão de imóveis", logo: "integrations/immoware24.svg", description: "Acesse dados de inquilinos e gerencie consultas imobiliárias por telefone.", cta: { kind: 'notify' } },
  { order: 73, slug: "immocloud", name: "Immocloud", status: 'coming_soon', category: "Gestão de imóveis", logo: "integrations/immocloud.svg", description: "Gerencie imóveis para locação e responda a consultas de inquilinos durante as chamadas.", cta: { kind: 'notify' } },
  { order: 74, slug: "dr-flex", name: "Dr. Flex", status: 'coming_soon', category: "Saúde", logo: "integrations/dr-flex.svg", description: "Agende consultas médicas e envie confirmações aos pacientes automaticamente.", cta: { kind: 'notify' } },
  { order: 75, slug: "mews", name: "MEWS", status: 'coming_soon', category: "Hotelaria", logo: "integrations/mews.svg", description: "Gerencie reservas de hotel, verifique a disponibilidade de quartos e atenda solicitações de hóspedes por telefone.", cta: { kind: 'notify' } },
  { order: 76, slug: "planity", name: "Planity", status: 'coming_soon', category: "Beleza & Fitness", logo: "integrations/planity.svg", description: "Reserve horários em salões e gerencie agendas de estilistas durante as chamadas.", cta: { kind: 'notify' } },
  { order: 77, slug: "timify", name: "Timify", status: 'coming_soon', category: "Agenda", logo: "integrations/timify.svg", description: "Agende compromissos presenciais ou de serviço durante chamadas com disponibilidade por filial.", cta: { kind: 'notify' } },
  { order: 78, slug: "domus", name: "DOMUS", status: 'coming_soon', category: "Gestão de imóveis", logo: "integrations/domus.svg", description: "Acesse dados de gestão imobiliária e gerencie comunicação com inquilinos por telefone.", cta: { kind: 'notify' } },
  { order: 79, slug: "gastronovi", name: "gastronovi", status: 'coming_soon', category: "Hotelaria", logo: "integrations/gastronovi.svg", description: "Processe reservas de restaurante e gerencie reservas para jantar por telefone.", cta: { kind: 'notify' } },
  { order: 80, slug: "latido", name: "Latido", status: 'coming_soon', category: "Saúde", logo: "integrations/latido.jpg", description: "Coordene consultas de saúde e comunicação com pacientes por telefone.", cta: { kind: 'notify' } },
  { order: 81, slug: "langfuse", name: "Langfuse", status: 'coming_soon', category: "Automação", logo: "integrations/langfuse.svg", description: "Acompanhe o desempenho de agentes de IA, monitore a qualidade das chamadas e depure fluxos de conversação.", cta: { kind: 'notify' } },
  { order: 82, slug: "fireflies-ai", name: "Fireflies.ai", status: 'coming_soon', category: "Automação", logo: "integrations/fireflies.svg", description: "Sincronize transcrições de chamadas para notas de reunião pesquisáveis e extração de itens de ação.", cta: { kind: 'notify' } },
  { order: 83, slug: "acuity-scheduling", name: "Acuity Scheduling", status: 'coming_soon', category: "Agenda", logo: "integrations/acuity-scheduling.svg", description: "Permita que os chamadores se auto-agendem em slots de serviço disponíveis com confirmações automáticas.", cta: { kind: 'notify' } },
  { order: 84, slug: "repdoc", name: "repdoc", status: 'coming_soon', category: "Ofícios", logo: "integrations/repdoc.png", description: "Gerencie ordens de oficina, dados de veículos e comunicação com clientes para oficinas automotivas.", cta: { kind: 'notify' } },
  { order: 85, slug: "resmio", name: "Resmio", status: 'coming_soon', category: "Hotelaria", logo: "integrations/resmio.svg", description: "Reserve mesas em restaurantes e gerencie reservas durante as chamadas.", cta: { kind: 'notify' } },
  { order: 86, slug: "samedi", name: "Samedi", status: 'coming_soon', category: "Saúde", logo: "integrations/samedi.svg", description: "Agende consultas médicas e gerencie reservas de pacientes durante as chamadas.", cta: { kind: 'notify' } },
  { order: 87, slug: "werbas-ksr", name: "WERBAS//KSR", status: 'coming_soon', category: "Ofícios", logo: "integrations/werbas.svg", description: "Em preparação. Acesse agendas de oficina, registros de veículos e ordens de serviço durante chamadas automotivas.", cta: { kind: 'notify' } },
  { order: 88, slug: "etg24", name: "etg24", status: 'coming_soon', category: "Gestão de imóveis", logo: "integrations/etg24.svg", description: "Processe solicitações de gestão imobiliária e notifique moradores a partir de chamadas.", cta: { kind: 'notify' } },
  { order: 89, slug: "justimmo", name: "JUSTIMMO", status: 'coming_soon', category: "Gestão de imóveis", logo: "integrations/justimmo.svg", description: "Pesquise listagens de imóveis e gerencie leads imobiliários durante as chamadas.", cta: { kind: 'notify' } },
  { order: 90, slug: "smoobu", name: "Smoobu", status: 'coming_soon', category: "Hotelaria", logo: "integrations/smoobu.png", description: "Sincronize reservas de aluguel de temporada e gerencie a disponibilidade de imóveis durante as chamadas.", cta: { kind: 'notify' } },
  { order: 91, slug: "intercom", name: "Intercom", status: 'coming_soon', category: "CRM", logo: "integrations/intercom.svg", description: "Exiba o contexto do cliente durante as chamadas e sincronize o histórico de conversas com os threads do Intercom.", cta: { kind: 'notify' } },
  { order: 92, slug: "lightspeed", name: "Lightspeed", status: 'coming_soon', category: "Hotelaria", logo: "integrations/lightspeed.svg", description: "Acesse dados do PDV, verifique pedidos e gerencie operações de restaurante por telefone.", cta: { kind: 'notify' } },
  { order: 93, slug: "attio", name: "Attio", status: 'coming_soon', category: "CRM", logo: "integrations/attio.svg", description: "Enriqueça registros de contatos com dados de chamadas e mantenha as linhas do tempo de relacionamento atualizadas.", cta: { kind: 'notify' } },
  { order: 94, slug: "swyx-enreach", name: "Swyx (Enreach)", status: 'coming_soon', category: "PABX", logo: "integrations/swyx.png", description: "Roteie chamadas Swyx UCaaS pelos agentes de IA Kloel no DACH e Benelux.", cta: { kind: 'notify' } },
  { order: 95, slug: "win-pharma", name: "Win Pharma", status: 'coming_soon', category: "Saúde", logo: "integrations/win-pharma.svg", description: "Acesse o estoque da farmácia e gerencie pedidos de receitas por telefone.", cta: { kind: 'notify' } },
  { order: 96, slug: "docsbot", name: "DocsBot", status: 'coming_soon', category: "Automação", logo: "integrations/docsbot.png", description: "Consulte bases de conhecimento com IA para fornecer respostas durante as chamadas.", cta: { kind: 'notify' } },
  { order: 97, slug: "protel", name: "Protel", status: 'coming_soon', category: "Hotelaria", logo: "integrations/protel.svg", description: "Gerencie operações de recepção de hotel e reservas de quartos por telefone.", cta: { kind: 'notify' } },
  { order: 98, slug: "cisco-webex-calling", name: "Cisco Webex Calling", status: 'coming_soon', category: "PABX", logo: "integrations/cisco-webex-calling.svg", description: "Integre Cisco Webex Calling para telefonia de IA empresarial.", cta: { kind: 'notify' } },
  { order: 99, slug: "booksy", name: "Booksy", status: 'coming_soon', category: "Beleza & Fitness", logo: "integrations/booksy.png", description: "Gerencie reservas de beleza e bem-estar, perfis de clientes e agendas de compromissos durante as chamadas.", cta: { kind: 'notify' } },
  { order: 100, slug: "idwell", name: "IDwell", status: 'coming_soon', category: "Gestão de imóveis", logo: "integrations/idwell.svg", description: "Acompanhe solicitações de manutenção e coordene com inquilinos por telefone.", cta: { kind: 'notify' } },
  { order: 101, slug: "smart-rx", name: "Smart RX", status: 'coming_soon', category: "Saúde", logo: "integrations/smart-rx.svg", description: "Processe renovações de receitas e gerencie fluxos de trabalho de farmácia por telefone.", cta: { kind: 'notify' } },
  { order: 102, slug: "ringcentral", name: "RingCentral", status: 'coming_soon', category: "PABX", logo: "integrations/ringcentral.svg", description: "Roteie chamadas UCaaS premium RingCentral via Kloel para fluxos com IA.", cta: { kind: 'notify' } },
  { order: 103, slug: "pharmony", name: "Pharmony", status: 'coming_soon', category: "Saúde", logo: "integrations/pharmony.png", description: "Gerencie operações de farmácia e responda a consultas sobre medicamentos durante as chamadas.", cta: { kind: 'notify' } },
  { order: 104, slug: "factorial", name: "Factorial", status: 'coming_soon', category: "CRM", logo: "integrations/factorial.svg", description: "Agende e registre chamadas de RH, e atualize registros de funcionários a partir dos resultados das chamadas.", cta: { kind: 'notify' } },
  { order: 105, slug: "hottgenroth", name: "Hottgenroth", status: 'coming_soon', category: "Ofícios", logo: "integrations/hottgenroth.png", description: "Gerencie projetos de consultoria em HVAC e energia e dados de clientes por telefone.", cta: { kind: 'notify' } },
  { order: 106, slug: "lgpi-pharmacie", name: "LGPI Pharmacie", status: 'coming_soon', category: "Saúde", logo: "integrations/lgpi-pharmacie.svg", description: "Gerencie pedidos de farmácia e verifique a disponibilidade de medicamentos durante as chamadas.", cta: { kind: 'notify' } },
  { order: 107, slug: "phorest", name: "Phorest", status: 'coming_soon', category: "Beleza & Fitness", logo: "integrations/phorest.svg", description: "Gerencie reservas em salões, registros de clientes e lembretes de consultas por telefone.", cta: { kind: 'notify' } },
  { order: 108, slug: "ivoris", name: "Ivoris", status: 'coming_soon', category: "Saúde", logo: "integrations/ivoris.png", description: "Agende consultas odontológicas e acesse prontuários de pacientes durante as chamadas.", cta: { kind: 'notify' } },
  { order: 109, slug: "selectline", name: "SelectLine", status: 'coming_soon', category: "CRM", logo: "integrations/selectline.svg", description: "Acesse dados de ERP para pedidos, estoque e registros de clientes durante as chamadas.", cta: { kind: 'notify' } },
  { order: 110, slug: "gong", name: "Gong", status: 'coming_soon', category: "Automação", logo: "integrations/gong.svg", description: "Envie gravações e transcrições de chamadas para inteligência de negócios e coaching de vendas.", cta: { kind: 'notify' } },
  { order: 111, slug: "pascom", name: "pascom", status: 'coming_soon', category: "PABX", logo: "integrations/pascom.png", description: "Conecte o PBX em nuvem whitelabel pascom com integração nativa Microsoft Teams.", cta: { kind: 'notify' } },
  { order: 112, slug: "gorgias", name: "Gorgias", status: 'coming_soon', category: "CRM", logo: "integrations/gorgias.svg", description: "Crie tickets de suporte a partir de chamadas e gerencie consultas de clientes de e-commerce.", cta: { kind: 'notify' } },
  { order: 113, slug: "casablanca", name: "Casablanca", status: 'coming_soon', category: "Hotelaria", logo: "integrations/casablanca.svg", description: "Processe reservas de hotel e gerencie serviços para hóspedes durante as chamadas.", cta: { kind: 'notify' } },
]

const BY_SLUG = new Map(INTEGRATIONS.map((i) => [i.slug, i]))
export const integrationBySlug = (slug: string | undefined): CatalogIntegration | undefined => (slug ? BY_SLUG.get(slug) : undefined)

/** Slugs de cada categoria na ordem do catálogo (equivale a byCategoryOrderIndexes do levantamento). */
export const INTEGRATIONS_BY_CATEGORY = Object.fromEntries(
  INTEGRATION_CATEGORIES.map((c) => [c, INTEGRATIONS.filter((i) => i.category === c).map((i) => i.slug)]),
) as Record<IntegrationCategory, string[]>

/** Contagem por status (Fonio: 27 / 20 / 66). */
export const INTEGRATION_STATUS_COUNTS = INTEGRATIONS.reduce<Record<IntegrationStatus, number>>(
  (acc, i) => ({ ...acc, [i.status]: acc[i.status] + 1 }),
  { available: 0, early_access: 0, coming_soon: 0 },
)
