import type { IllustrationKey } from './illustrations'

/**
 * Conteúdo das 5 páginas de solução (template único — spec 03).
 * Textos transcritos das capturas e adaptados para a Kloel. Trechos não capturados (texto completo de "Leia mais")
 * foram redigidos para a Kloel e estão marcados como INFERIDO na cobertura. Números de resultado da referência
 * ("98% das perguntas", "15 ligações em paralelo", "10.000 clientes") foram suavizados ou marcados como exemplo.
 */
export interface SolutionData {
  slug: string
  menuLabel: string
  hero: { title: string; subtitle: string; subtitleFull?: string }
  whatIs?: { title: string; items: { title: string; text: string }[]; cta: boolean }
  steps: { title: string; background: 'gray' | 'white'; columns: 2 | 3; items: { title: string; text: string }[]; cta?: boolean }
  advantages?: { title: string; intro: string; cards: { title: string; text: string; illustration: IllustrationKey }[] }
  audience?: { title: string; intro: string; quote: string; items: { q: string; a: string }[] }
  testimonialsSubtitle?: string
  accordion?: { title: string; items: { q: string; a: string }[] }
}

export const SOLUTIONS: SolutionData[] = [
  {
    slug: 'agente-de-suporte-com-ia',
    menuLabel: 'Agente de suporte com IA',
    hero: { title: 'Agente de suporte com IA', subtitle: 'Seu agente de suporte com IA, sempre disponível.' },
    steps: {
      title: 'Configurar agente de suporte com IA',
      background: 'gray',
      columns: 3,
      items: [
        { title: 'Escolher voz e definir saudação', text: 'Escolha uma voz natural e defina uma mensagem de boas-vindas amigável para que cada cliente se sinta bem atendido desde o primeiro segundo da ligação.' },
        { title: 'Fornecer informações para a IA de telefone', text: 'Insira no prompt perguntas frequentes e informações detalhadas sobre sua empresa, produtos e políticas. Quanto mais completo o conteúdo, mais precisas são as respostas do agente.' },
        { title: 'Configurar conexões telefônicas', text: 'Adquira um número dedicado para seu assistente de IA e integre-o ao seu fluxo de atendimento, por exemplo encaminhando as ligações do número principal nos horários desejados.' },
        { title: 'Conectar ferramentas como agenda e CRM', text: 'Sincronize sua agenda, CRM ou outros sistemas para que a IA agende compromissos, consulte dados de clientes e registre cada atendimento automaticamente.' },
        { title: 'Configurar processamento automatizado', text: 'Defina quando e como transcrições ou informações devem ser enviadas para sua equipe — por e-mail, SMS ou webhook — logo após cada ligação.' },
      ],
    },
    accordion: {
      title: 'Por que você deve usar o agente de suporte com IA da kloel.ai?',
      items: [
        { q: 'Integração profunda e configuração simples', a: 'Seja agenda, CRM ou integração por API – a Kloel se integra perfeitamente e fica pronta em poucos minutos.' },
        { q: 'Condução inteligente de conversas', a: 'A IA por voz reconhece solicitações de forma autônoma, faz perguntas específicas e resolve muitos problemas imediatamente – sem tempo de espera.' },
        { q: 'Sempre disponível', a: 'Nossa IA por voz está disponível 24/7 e pode processar várias ligações simultaneamente – mesmo fora do horário comercial.' },
      ],
    },
  },
  {
    slug: 'agendamentos-e-perguntas-frequentes',
    menuLabel: 'Agendamentos e perguntas frequentes',
    hero: { title: 'Agendamentos e perguntas frequentes', subtitle: 'Agende compromissos por telefone e responda perguntas frequentes' },
    steps: {
      title: 'Configurar agendamentos',
      background: 'gray',
      columns: 3,
      cta: true,
      items: [
        { title: 'Escolher voz e definir saudação inicial', text: 'Escolha uma voz natural para a IA e defina uma mensagem inicial amigável, que já informe ao cliente que ele pode marcar, remarcar ou cancelar horários pelo telefone.' },
        { title: 'Sincronizar agenda', text: 'Conecte sua agenda (por exemplo, Google Agenda ou Outlook) via Calendly, Cal.com ou integração direta, para que a IA consulte a disponibilidade em tempo real.' },
        { title: 'Testar agendamento', text: 'Ligue para a IA e agende um compromisso para garantir que tudo funciona como esperado: horário, confirmação e envio dos detalhes para a sua equipe.' },
      ],
    },
    accordion: {
      title: 'Agendamentos e respostas a perguntas frequentes',
      items: [
        { q: 'Pós-processamento automático', a: 'Após cada ligação, os detalhes são enviados por e-mail ou SMS para facilitar ainda mais a gestão de compromissos para você.' },
        { q: 'Integração perfeita com agenda', a: 'Use nossas integrações nativas com Calendly ou Cal.com para sincronizar sua agenda.' },
        { q: 'Organização eficiente de compromissos', a: 'A IA gerencia seus agendamentos por telefone e oferece disponibilidades da sua agenda em tempo real.' },
      ],
    },
  },
  {
    slug: 'recepcionista-virtual-com-ia',
    menuLabel: 'Recepcionista virtual com IA',
    hero: {
      title: 'Recepcionista virtual com IA',
      subtitle: 'Nossa recepcionista virtual com IA é um assistente virtual que, por meio de Inteligência Artificial, possibilita um serviço telefônico profissional para empresas.',
      subtitleFull:
        'Nossa recepcionista virtual com IA é um assistente virtual que, por meio de Inteligência Artificial, possibilita um serviço telefônico profissional para empresas. A recepcionista virtual com IA assume o atendimento inteligente de ligações e a transferência de chamadas 24 horas por dia. Por meio de processos automatizados, a recepcionista virtual com IA facilita o dia a dia do escritório. A recepcionista virtual com IA da Kloel recebe ligações e mensagens e identifica e compreende as solicitações dos clientes que ligam. As capacidades da recepcionista virtual com IA são transferir as ligações para o departamento ou pessoa responsável de acordo com a solicitação. Se o funcionário correspondente não atender, a recepcionista virtual com IA envia um e-mail para essa pessoa com as informações mais importantes sobre a solicitação do cliente. Nossa recepcionista virtual com IA é personalizável de acordo com as necessidades e requisitos da empresa. A recepcionista virtual é uma solução confiável para todas as empresas que desejam economizar custos com pessoal, estão frequentemente sobrecarregadas ou têm, em geral, um alto volume de ligações. Nossa recepcionista virtual com IA é fácil de usar, pois não requer conhecimento técnico profundo.',
    },
    whatIs: {
      title: 'O que é uma recepcionista virtual com IA?',
      cta: true,
      items: [
        { title: 'Recepcionista com IA', text: 'Como uma recepcionista humana, a recepcionista com IA cuida do atendimento telefônico nas empresas. Após uma breve saudação, ela entende o motivo da ligação, responde dúvidas comuns e encaminha o cliente para a pessoa certa — sem fila de espera e sem ligações perdidas.' },
        { title: 'Assistente de telefone digital', text: 'Uma recepcionista virtual com IA é um assistente de telefone digital inteligente que executa autonomamente tarefas como triagem de ligações, agendamento, envio de recados por e-mail e transferência, seguindo as regras que você definir.' },
      ],
    },
    steps: {
      title: 'Como funciona a recepcionista virtual com IA?',
      background: 'white',
      columns: 2,
      items: [
        { title: 'Deixe a IA assumir suas ligações', text: 'A recepcionista de IA funciona ao assumir todas as ligações recebidas, compreendê-las e executar as ações desejadas. A IA identifica o assunto, responde o que já sabe e decide o próximo passo de acordo com as suas regras.' },
        { title: 'Definir comportamento e pós-processamento', text: 'Durante a configuração da recepcionista de IA, é definido para qual colaborador a IA deve transferir quem ligou em determinadas situações e quais informações devem ser enviadas por e-mail ao final da conversa.' },
        { title: 'Nenhuma ligação é perdida', text: 'Se o colaborador não atender, a recepcionista virtual com IA informa ao cliente e diz que enviará um e-mail com a solicitação ao responsável, garantindo o retorno sem que ninguém precise anotar recados.' },
        { title: 'Integrada perfeitamente à sua infraestrutura', text: 'A partir do número principal da empresa, é configurada uma transferência de chamada para o número da IA, para que a recepcionista assuma o atendimento nos horários definidos — sem trocar de operadora.' },
      ],
    },
    advantages: {
      title: 'Vantagens da nossa recepcionista virtual com IA',
      intro: 'As principais vantagens da nossa recepcionista virtual com IA são a disponibilidade 24 horas por dia, o aumento da produtividade da equipe, a triagem inteligente das ligações e a documentação precisa de cada atendimento, com custos menores do que manter uma recepção dedicada em tempo integral.',
      cards: [
        { title: 'Triagem de ligações', text: 'A recepcionista virtual com IA classifica ligações antecipadamente e processa os pedidos por prioridade, para que os casos urgentes cheguem primeiro à sua equipe.', illustration: 'triage' },
        { title: 'Multilíngue', text: 'Nossa recepcionista virtual com IA é multilíngue e capaz de processar ligações e responder no idioma de quem liga.', illustration: 'languages' },
        { title: 'Documentação precisa de cada ligação', text: 'A recepcionista virtual com IA documenta cada ligação com precisão, salvando a transcrição e o resumo no CRM, na agenda ou na ferramenta de gestão que você usa.', illustration: 'docs' },
        { title: 'Vantagem competitiva', text: 'Nossa recepcionista virtual com IA oferece uma vantagem competitiva às empresas, que passam a atender todas as ligações com rapidez e qualidade constante.', illustration: 'savings' },
        { title: 'Transferência confiável', text: 'A recepcionista virtual com IA cuida da transferência de chamadas de forma confiável, encaminhando cada pessoa para o setor ou colaborador certo.', illustration: 'transfer' },
        { title: 'Aumenta a produtividade', text: 'O uso da nossa recepcionista virtual com IA aumenta a produtividade na empresa, pois a equipe deixa de ser interrompida por ligações rotineiras.', illustration: 'productivity' },
        { title: 'Disponibilidade 24 horas por dia', text: 'A recepcionista virtual com IA garante disponibilidade 24 horas por dia para a sua empresa, inclusive à noite, nos fins de semana e feriados.', illustration: 'availability' },
      ],
    },
    testimonialsSubtitle: 'As avaliações a seguir mostram o feedback de clientes satisfeitos com a nossa recepcionista virtual com IA.',
    accordion: {
      title: 'Kloel Recepcionista Virtual com IA',
      items: [
        { q: 'Empresas de todos os tamanhos confiam na Kloel', a: 'Nós da Kloel somos especializados em fornecer assistentes de atendimento por IA e recepcionistas virtuais inteligentes. Nosso objetivo é aliviar empresas de todos os tamanhos através do atendimento telefônico automatizado com nossa recepcionista virtual, criando mais tempo para o que realmente importa.' },
        { q: 'Configurado em minutos', a: 'Para implementar a recepcionista virtual com IA da Kloel, primeiro você define uma voz de IA e formula uma saudação. No próximo passo, você escreve um prompt para a recepcionista virtual com IA que define os colaboradores com seus respectivos números de telefone para transferências e as regras de comportamento para a IA. Por fim, os endereços de e-mail para as transcrições são registrados no prompt, caso o colaborador responsável não atenda ao telefone. Com o registro dos endereços de e-mail, garante-se o processamento contínuo de todas as ligações recebidas.' },
        { q: 'Nenhuma ligação fica sem resposta', a: 'A recepcionista virtual com IA da Kloel atende as ligações para empresas e age como uma atendente de telefone real. Ela é configurada em minutos, é adequada para qualquer tipo de empresa e atende várias ligações em paralelo, de modo que mesmo nos horários de pico não há tempo de espera para quem liga.' },
      ],
    },
  },
  {
    slug: 'atendedor-automatico-por-ia',
    menuLabel: 'Atendedor automático por IA',
    hero: {
      title: 'Atendedor automático por IA',
      subtitle: 'O atendedor automático por IA da Kloel é um assistente telefônico automatizado com IA que atende o telefone quando nenhum funcionário está disponível.',
      subtitleFull:
        'O atendedor automático por IA da Kloel é um assistente telefônico automatizado com IA que atende o telefone quando nenhum funcionário está disponível. O atendedor automático por IA conversa com quem liga em linguagem natural, entende o motivo do contato, responde perguntas frequentes e registra os pedidos. Em vez de uma caixa postal que ninguém escuta, sua equipe recebe por e-mail ou SMS um resumo claro de cada ligação, com a transcrição completa e os próximos passos. Assim, nenhuma oportunidade se perde fora do horário comercial, nos fins de semana ou quando todos estão ocupados.',
    },
    steps: {
      title: 'Como funciona o atendedor automático por IA?',
      background: 'white',
      columns: 2,
      items: [
        { title: 'Nenhuma ligação é perdida.', text: 'O atendedor automático por IA funciona quando a inteligência artificial atende ligações automaticamente, analisa e responde de forma natural, registrando cada pedido para que sua equipe retorne no momento certo.' },
        { title: 'Transferência de acordo com suas regras. Transcrição incluída.', text: 'Com o atendedor automático por IA, empresas ou profissionais autônomos definem horários durante os quais uma transferência para a equipe é permitida. Fora desses horários, a IA anota o pedido e envia a transcrição.' },
        { title: 'Configure uma vez. Economize tempo para sempre.', text: 'Nosso atendedor automático por IA é capaz de responder à grande maioria das perguntas dos clientes e resolver problemas. As perguntas são respondidas com base nas informações que você cadastra uma única vez.' },
        { title: 'Integrado perfeitamente aos seus sistemas.', text: 'Com nosso atendedor automático por IA, é possível buscar informações em tempo real da internet durante a conversa, consultar seu CRM ou agenda e registrar os dados automaticamente.' },
      ],
    },
    advantages: {
      title: 'Vantagens do nosso atendedor automático por IA',
      intro: 'As principais vantagens do nosso atendedor automático por IA são: economiza tempo e custos, está sempre disponível e não exige que ninguém ouça mensagens gravadas. Além disso, garante qualidade consistente em todas as ligações e pode ser configurado sem conhecimentos técnicos.',
      cards: [
        { title: 'Não é necessário ouvir mensagens gravadas', text: 'Com nosso atendedor automático por IA, não é mais necessário que colaboradores ouçam mensagens de voz: cada ligação chega transcrita, resumida e classificada.', illustration: 'triage' },
        { title: 'Sempre disponível', text: 'O atendedor automático por IA está sempre disponível e atende ligações 24/7, o que é ideal para empresas com atendimento fora do horário comercial.', illustration: 'always' },
        { title: 'Economia de tempo e custos', text: 'Com nosso atendedor automático por IA você economiza tempo e custos, pois alivia a equipe das ligações rotineiras e reduz a necessidade de plantões.', illustration: 'savings' },
        { title: 'Qualidade consistente', text: 'O atendedor automático por IA garante qualidade consistente, permitindo um atendimento cordial e padronizado em todas as ligações.', illustration: 'quality' },
        { title: 'Não requer conhecimentos técnicos', text: 'Para configurar nosso atendedor automático por IA não são necessários conhecimentos técnicos: basta escolher a voz, escrever as instruções e ativar o número.', illustration: 'nocode' },
        { title: 'Mais de 35 idiomas e dialetos', text: 'Nosso atendedor automático por IA está disponível em diversos idiomas e dialetos e reconhece automaticamente o idioma de quem liga.', illustration: 'languages' },
      ],
    },
    audience: {
      title: 'Para quem é adequado um atendedor automático por IA?',
      intro: 'Nosso atendedor automático por IA é adequado para empresas de todos os tamanhos e segmentos que desejam melhorar e tornar mais eficiente a comunicação com seus clientes — de profissionais autônomos a clínicas e redes com várias unidades.',
      quote: 'Soa como um recepcionista humano.',
      items: [
        { q: 'Atendedor automático por IA para prestadores de serviços', a: 'Um atendedor automático por IA é indicado para prestadores de serviços, atendendo ligações mesmo quando o profissional está em visita a clientes, canteiros de obra ou instalações. O atendedor automático por IA assume de forma autônoma pedidos e agendamentos quando o assistente de IA está conectado à agenda. Um atendedor automático por IA para prestadores de serviços também é capaz de calcular o tempo de deslocamento até o cliente ao receber uma solicitação.' },
        { q: 'Atendedor automático por IA para clínicas médicas', a: 'Um atendedor automático por IA é indicado para clínicas médicas, respondendo dúvidas de pacientes, agendando consultas e exames, e enviando confirmações por SMS ou e-mail. Para agendar e confirmar consultas, o atendedor automático por IA tem acesso à agenda da clínica. O assistente de IA é capaz de selecionar um horário disponível para o paciente e inseri-lo diretamente na agenda. Um atendedor automático para clínicas aumenta a satisfação dos pacientes, pois atende ligações mesmo fora do horário de funcionamento.' },
        { q: 'Atendedor automático por IA para empresas', a: 'Atendedores automáticos por IA são indicados para empresas assumirem o atendimento quando nenhum funcionário está disponível, como nos finais de semana, à noite, em feriados, durante férias ou reuniões. Na ausência da equipe, atendedores automáticos por IA são capazes de receber ligações e processá-las automaticamente, respondendo perguntas frequentes e direcionando solicitações importantes para a pessoa certa da equipe. O atendedor automático por IA da Kloel realiza follow-ups automatizados por e-mail e SMS e, quando necessário, consulta sistemas internos de CRM ou sites via API.' },
      ],
    },
    testimonialsSubtitle: 'Abaixo você encontra avaliações de clientes que mostram a satisfação com nosso atendedor automático por IA.',
    accordion: {
      title: 'Atendedor automático por IA Kloel',
      items: [
        { q: 'Seu número de IA. Pronto quando você estiver.', a: 'Os modelos de prompt podem ser personalizados individualmente para a própria empresa antes de testar o atendedor automático por IA. Se você estiver satisfeito, é possível adquirir um número de telefone com apenas um clique pela Kloel, através do qual o atendedor inteligente pode ser contatado e para o qual as ligações podem ser redirecionadas nos horários desejados.' },
        { q: 'Configurado em minutos', a: 'O atendedor automático por IA da Kloel pode ser integrado aos sistemas internos da empresa (como agenda de compromissos, CRM e armazenamento de documentos). A IA é capaz de acessar os dados importantes durante as ligações quando conectada aos sistemas correspondentes. Na Kloel, oferecemos diferentes tipos de atendedores automáticos por IA — desde apenas receber a ligação e enviar por e-mail até um assistente interativo que solicita números de pedidos, responde às perguntas padrão e transfere para um colaborador responsável.' },
        { q: 'Configure individualmente. Disponível automaticamente.', a: 'O atendedor automático por IA da Kloel assume todas as ligações desejadas com voz e saudação definidas individualmente. Além disso, é inserido um prompt com todas as informações importantes e regras de comportamento (escrito por você mesmo ou selecionado de um dos modelos de prompt para atendedores automáticos inteligentes).' },
      ],
    },
  },
  {
    slug: 'assistente-de-ia-para-equipe-externa',
    menuLabel: 'Assistente de IA para equipe externa',
    hero: { title: 'Assistente de IA para equipe externa', subtitle: 'Realiza um breve debriefing por telefone e registra imediatamente no CRM.' },
    steps: {
      title: 'Como funciona',
      background: 'white',
      columns: 2,
      items: [
        { title: 'Ligue para seu assistente de IA', text: 'Simplesmente direto pelo viva-voz do carro, através do número de telefone atribuído ao assistente de IA.' },
        { title: 'Faça debriefings e deixe a IA entrevistá-lo', text: 'Diferente de um gravador passivo, você treina seu assistente de IA para buscar informações que faltam de forma ativa. Ele conduz a conversa com perguntas objetivas sobre o cliente, a proposta e os próximos passos, até que o registro esteja completo.' },
        { title: 'Processamento inteligente', text: 'Linguagem falada vira dados estruturados. Filtra palavras de preenchimento e conversa informal. Reconhece entidades como empresas, valores, datas e contatos e organiza tudo nos campos certos.' },
        { title: 'Sincronização com CRM e fechamento', text: 'Antes de chegar ao próximo compromisso, a última reunião já está documentada no HubSpot, Salesforce ou Pipedrive, por exemplo.' },
      ],
    },
  },
]

export const solutionBySlug = (slug?: string) => SOLUTIONS.find((s) => s.slug === slug)
