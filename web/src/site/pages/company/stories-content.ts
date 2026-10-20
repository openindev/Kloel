/**
 * Histórias de clientes — página INFERIDA (o menu "Histórias de clientes" não tem pasta de referência).
 * Empresas, pessoas, citações e números ilustrativos (sem selos na página — E1).
 * Os nomes coincidem com os logos do módulo site-core (DEMO_LOGOS).
 */
export type Sector = 'Saúde' | 'Imobiliário' | 'Automotivo' | 'Serviços' | 'Varejo' | 'Turismo'
export type StoryProduct = 'voice' | 'whatsapp' | 'webchat'

export interface Story {
  slug: string
  company: string
  sector: Sector
  city: string
  products: StoryProduct[]
  title: string
  excerpt: string
  metrics: { value: string; label: string }[]
  challenge: string
  solution: string
  results: string[]
  quote: string
  person: string
  role: string
}

export const PRODUCT_NAMES: Record<StoryProduct, string> = { voice: 'Assistente telefônico IA', whatsapp: 'IA de WhatsApp', webchat: 'Webchat de IA' }

export const STORIES: Story[] = [
  {
    slug: 'clinica-bem-viver',
    company: 'Clínica Bem Viver',
    sector: 'Saúde',
    city: 'São Paulo, SP',
    products: ['voice', 'webchat'],
    title: 'Recepção que atende todas as ligações, até fora do horário',
    excerpt: 'A clínica deixou de perder pacientes nos horários de pico e passou a agendar avaliações 24 horas por dia.',
    metrics: [
      { value: '98%', label: 'das ligações atendidas' },
      { value: '+35%', label: 'avaliações agendadas' },
    ],
    challenge: 'Nos horários de pico, a recepção não conseguia atender todas as ligações e muitos pacientes desistiam de agendar.',
    solution: 'A assistente Roberta atende as ligações, tira dúvidas sobre especialidades e convênios e marca avaliações direto na agenda. Urgências são transferidas para a recepção.',
    results: ['Nenhuma ligação perdida no horário comercial', 'Agendamentos feitos também à noite e aos fins de semana', 'Resumo de cada ligação enviado por e-mail à equipe'],
    quote: 'Nossa assistente atende todas as ligações da recepção e manda o resumo de cada uma por e-mail. Nenhum paciente fica mais sem retorno.',
    person: 'Carla Menezes',
    role: 'Gestora',
  },
  {
    slug: 'odonto-sorriso',
    company: 'Odonto Sorriso',
    sector: 'Saúde',
    city: 'Campinas, SP',
    products: ['voice', 'whatsapp'],
    title: 'Confirmações de consulta sem esforço da equipe',
    excerpt: 'Com lembretes e confirmações automáticas, as faltas diminuíram e a agenda ficou mais previsível.',
    metrics: [
      { value: '-40%', label: 'faltas em consultas' },
      { value: '24h', label: 'atendimento por dia' },
    ],
    challenge: 'Faltas frequentes deixavam horários ociosos e a equipe passava horas ligando para confirmar consultas.',
    solution: 'A IA de WhatsApp confirma as consultas do dia seguinte e oferece remarcação; o assistente telefônico atende quem prefere ligar.',
    results: ['Confirmações feitas automaticamente', 'Remarcações registradas na agenda', 'Equipe focada no atendimento presencial'],
    quote: 'Passamos a atender 24 horas por dia sem aumentar a equipe.',
    person: 'Ricardo Alves',
    role: 'Sócio',
  },
  {
    slug: 'lar-novo-imoveis',
    company: 'Lar Novo Imóveis',
    sector: 'Imobiliário',
    city: 'Belo Horizonte, MG',
    products: ['voice', 'webchat'],
    title: 'Leads qualificados e visitas agendadas a qualquer hora',
    excerpt: 'Interessados em imóveis recebem respostas na hora e já saem com a visita marcada.',
    metrics: [
      { value: '3x', label: 'mais visitas agendadas' },
      { value: '< 1 min', label: 'tempo de resposta' },
    ],
    challenge: 'Muitos contatos chegavam à noite e só eram respondidos no dia seguinte, quando o interessado já tinha procurado outra imobiliária.',
    solution: 'O assistente responde sobre imóveis, qualifica o interesse (compra, aluguel, faixa de preço) e agenda visitas no calendário dos corretores.',
    results: ['Leads registrados no CRM com resumo', 'Visitas agendadas sem troca de mensagens', 'Corretores recebem só contatos qualificados'],
    quote: 'Agendamento, qualificação e transferência acontecem sozinhos. A integração com a agenda e o CRM funcionou de primeira.',
    person: 'Fernanda Lima',
    role: 'Diretora',
  },
  {
    slug: 'rota-sul-auto',
    company: 'Rota Sul Auto',
    sector: 'Automotivo',
    city: 'Porto Alegre, RS',
    products: ['voice'],
    title: 'Oficina que agenda revisões enquanto a equipe trabalha',
    excerpt: 'Os mecânicos não precisam mais parar o serviço para atender o telefone.',
    metrics: [
      { value: '+50%', label: 'revisões agendadas' },
      { value: '0', label: 'ligações perdidas' },
    ],
    challenge: 'O telefone tocava o dia todo e interrompia o trabalho na oficina.',
    solution: 'O assistente informa horários, serviços e preços de referência e agenda revisões, enviando confirmação por SMS.',
    results: ['Equipe sem interrupções', 'Clientes recebem confirmação automática', 'Histórico de cada ligação disponível'],
    quote: 'Hoje o telefone não interrompe mais a oficina, e a agenda está sempre cheia.',
    person: 'Sérgio Paiva',
    role: 'Proprietário',
  },
  {
    slug: 'contabil-prisma',
    company: 'Contábil Prisma',
    sector: 'Serviços',
    city: 'Curitiba, PR',
    products: ['whatsapp', 'webchat'],
    title: 'Escritório contábil com respostas rápidas na época do imposto',
    excerpt: 'Perguntas repetitivas passaram a ser respondidas pela IA, liberando os contadores.',
    metrics: [
      { value: '70%', label: 'das dúvidas resolvidas pela IA' },
      { value: '-5h', label: 'por semana em atendimento' },
    ],
    challenge: 'Na época da declaração, o volume de perguntas no WhatsApp era maior do que a equipe conseguia responder.',
    solution: 'A IA responde dúvidas frequentes com base na base de conhecimento do escritório e encaminha casos complexos para o contador responsável.',
    results: ['Fila do WhatsApp sob controle', 'Encaminhamento com contexto completo', 'Clientes mais satisfeitos no período crítico'],
    quote: 'A IA tira as dúvidas simples e o time cuida do que realmente precisa de um contador.',
    person: 'Marina Duarte',
    role: 'Sócia',
  },
  {
    slug: 'pet-amigo',
    company: 'Pet Amigo',
    sector: 'Varejo',
    city: 'Recife, PE',
    products: ['whatsapp'],
    title: 'Pet shop que vende e agenda banho e tosa pelo WhatsApp',
    excerpt: 'Agendamentos de banho e tosa e dúvidas sobre produtos são resolvidos na conversa.',
    metrics: [
      { value: '+28%', label: 'agendamentos de banho e tosa' },
      { value: '4,9/5', label: 'satisfação nas conversas' },
    ],
    challenge: 'As mensagens se acumulavam aos sábados, o dia de maior movimento da loja.',
    solution: 'A IA de WhatsApp agenda serviços, informa horários e preços e avisa a equipe quando o cliente quer falar com uma pessoa.',
    results: ['Agenda de serviços sempre atualizada', 'Equipe da loja focada no atendimento presencial', 'Respostas imediatas mesmo aos sábados'],
    quote: 'Os clientes agendam o banho do pet em segundos, direto pelo WhatsApp.',
    person: 'Thiago Rocha',
    role: 'Gerente',
  },
  {
    slug: 'estrela-turismo',
    company: 'Estrela Turismo',
    sector: 'Turismo',
    city: 'Salvador, BA',
    products: ['webchat', 'voice'],
    title: 'Agência de viagens que atende turistas em vários idiomas',
    excerpt: 'Turistas estrangeiros recebem atendimento no próprio idioma, a qualquer hora.',
    metrics: [
      { value: '5', label: 'idiomas atendidos' },
      { value: '+22%', label: 'reservas pelo site' },
    ],
    challenge: 'Pedidos de informação chegavam de madrugada e em outros idiomas.',
    solution: 'O Webchat de IA responde sobre passeios em vários idiomas e o assistente telefônico confirma as reservas.',
    results: ['Atendimento multilíngue 24 horas', 'Reservas registradas automaticamente', 'Menos retrabalho para a equipe'],
    quote: 'Atendemos turistas do mundo todo sem precisar de uma equipe de plantão.',
    person: 'Patrícia Gomes',
    role: 'Diretora comercial',
  },
  {
    slug: 'estudio-forma',
    company: 'Estúdio Forma',
    sector: 'Serviços',
    city: 'Florianópolis, SC',
    products: ['voice', 'whatsapp'],
    title: 'Estúdio de pilates com aulas experimentais agendadas automaticamente',
    excerpt: 'Interessados marcam aulas experimentais por telefone ou WhatsApp, sem esperar retorno.',
    metrics: [
      { value: '+45%', label: 'aulas experimentais' },
      { value: '2 min', label: 'para agendar' },
    ],
    challenge: 'As professoras estavam em aula e não conseguiam responder novos alunos.',
    solution: 'O assistente apresenta os planos, agenda aulas experimentais e envia o endereço e as orientações por mensagem.',
    results: ['Novos alunos atendidos na hora', 'Agenda das aulas organizada', 'Professoras sem interrupções'],
    quote: 'Configurei meu assistente em uma tarde e hoje ele cuida de todas as aulas experimentais.',
    person: 'Aline Barbosa',
    role: 'Fundadora',
  },
]

export const SECTORS: Sector[] = ['Saúde', 'Imobiliário', 'Automotivo', 'Serviços', 'Varejo', 'Turismo']
