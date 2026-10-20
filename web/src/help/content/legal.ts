import type { HelpArticle } from './types'

/**
 * Documentos legais da Kloel AI, com os dados cadastrais da KLOEL TECNOLOGIA LTDA (os mesmos publicados nos
 * termos do Kloel Finance/School). Redação própria conforme a legislação brasileira ([181] / [217] / [228]);
 * recomenda-se revisão periódica por assessoria jurídica.
 */

const COMPANY = '**KLOEL TECNOLOGIA LTDA**'
const CNPJ = '**66.303.607/0001-59**'
const ADDRESS = 'Alameda Carajás, s/n, Quadra 5, Lote 11, Residencial Aldeia das Thermas, Caldas Novas/GO, CEP 75694-720'
const DPO = 'Daniel Penin — [privacidade@kloel.ai](mailto:privacidade@kloel.ai)'
const VERSION = `:::note[Versão]
Versão **1.0**, vigente desde 20 de outubro de 2026. Alterações relevantes são avisadas com antecedência na plataforma ou por e-mail.
:::`

export const LEGAL_ARTICLES: HelpArticle[] = [
  {
    section: 'legal',
    slug: 'termos-e-condicoes',
    title: 'Termos e condições',
    description: 'Regras de uso da plataforma Kloel: contratação, créditos, responsabilidades e encerramento.',
    source: '[181] [217] [228] — nota do operador',
    related: ['legal/politica-de-privacidade', 'legal/protecao-de-dados', 'legal/aviso-legal'],
    keywords: ['termos de uso', 'contrato', 'condições gerais', 'assinatura', 'cancelamento'],
    body: `Estes Termos e condições regulam o uso da plataforma Kloel — assistentes de IA para telefone, WhatsApp, chat no site e e-mail — oferecida por ${COMPANY}, inscrita no CNPJ sob o nº ${CNPJ}, com sede em ${ADDRESS} ("Kloel").

## 1. Aceite

Ao criar uma conta em [Criar conta](/criar-conta) ou usar qualquer recurso da plataforma, você declara ter lido e aceitado estes Termos, a [Política de privacidade](/ajuda/legal/politica-de-privacidade) e o [Acordo de proteção de dados](/ajuda/legal/protecao-de-dados). Se você contrata em nome de uma empresa, declara ter poderes para representá-la.

## 2. Conta e acesso

- Cada organização tem um ou mais usuários, com papéis definidos em [Usuários](/app/users).
- Você é responsável por manter as credenciais em sigilo e por toda atividade realizada na sua conta.
- Informações cadastrais e de faturamento devem ser verdadeiras e mantidas atualizadas em [Configurações da empresa](/app/company-settings) e [Faturamento](/app/billing).

## 3. Planos, créditos e pagamento

- Os planos e valores vigentes estão em [Planos](/planos). Consumo de minutos, mensagens e números é registrado no painel.
- Assinaturas renovam automaticamente no fim de cada ciclo, salvo cancelamento antes da renovação.
- Créditos promocionais (por exemplo, de [Créditos grátis](/app/free-credits)) não são conversíveis em dinheiro e podem ter validade.
- O pagamento é feito por cartão de crédito no checkout seguro da Stripe, cobrado no início de cada ciclo (mensal ou anual). Tributos incidentes são informados na fatura.
- Reajustes de preço são comunicados com pelo menos 30 dias de antecedência e valem a partir do ciclo seguinte.

## 4. Uso aceitável

Você concorda em não usar a Kloel para:

- realizar ligações ou enviar mensagens sem base legal ou em desacordo com regras de telemarketing e de consentimento aplicáveis;
- se passar por outra pessoa ou ocultar que o atendimento é feito por um assistente de IA quando a lei exigir essa informação;
- tratar dados pessoais sensíveis sem base legal adequada;
- tentar contornar limites técnicos, testar vulnerabilidades sem autorização ou revender o serviço fora do programa de [Parceiros](/parceiros).

## 5. Conteúdo do cliente e respostas da IA

Prompts, bases de conhecimento, gravações e transcrições pertencem ao cliente. A Kloel trata esse conteúdo apenas para prestar o serviço, conforme o [Acordo de proteção de dados](/ajuda/legal/protecao-de-dados). Respostas geradas por IA podem conter imprecisões: o cliente deve revisar regras, prompts e integrações e acompanhar as conversas em [Conversas](/app/inbox).

## 6. Disponibilidade e suporte

A Kloel empenha esforços razoáveis para manter a plataforma disponível, exceto em manutenções programadas e eventos fora do seu controle (por exemplo, falhas de operadoras de telefonia ou de provedores de mensagens). O suporte é prestado pelos canais indicados na [Central de ajuda](/ajuda).

## 7. Responsabilidade

Na extensão permitida pela lei, a responsabilidade total da Kloel fica limitada aos valores pagos pelo cliente nos **12** meses anteriores ao evento. Nada nestes Termos limita direitos garantidos pelo Código de Defesa do Consumidor quando aplicável.

## 8. Encerramento

Você pode cancelar a qualquer momento em [Faturamento](/app/billing). A Kloel pode suspender contas que violem estes Termos, mediante aviso quando possível. Após o encerramento, os dados são tratados conforme os prazos da [Política de privacidade](/ajuda/legal/politica-de-privacidade).

## 9. Lei aplicável e foro

Aplica-se a legislação brasileira. Quando o cliente for consumidor, fica eleito o foro do seu domicílio; nos demais casos, o foro da comarca de Caldas Novas/GO.

${VERSION}`,
  },
  {
    section: 'legal',
    slug: 'politica-de-privacidade',
    title: 'Política de privacidade',
    description: 'Como a Kloel coleta, usa, compartilha e protege dados pessoais, conforme a LGPD.',
    source: '[181] [217] [228] — nota do operador',
    related: ['legal/protecao-de-dados', 'legal/termos-e-condicoes', 'legal/aviso-legal'],
    keywords: ['privacidade', 'lgpd', 'dados pessoais', 'cookies', 'titular', 'encarregado', 'dpo'],
    body: `Esta Política explica como ${COMPANY} (CNPJ ${CNPJ}, ${ADDRESS}) trata dados pessoais de visitantes do site, de usuários da plataforma e de pessoas que conversam com assistentes configurados por nossos clientes, nos termos da Lei nº 13.709/2018 (LGPD).

## Quem é o controlador

- **Dados de visitantes e usuários da conta:** a Kloel é a controladora.
- **Dados de quem liga ou escreve para um cliente da Kloel:** o cliente é o controlador e a Kloel atua como **operadora**, seguindo as instruções do [Acordo de proteção de dados](/ajuda/legal/protecao-de-dados).

## Dados que tratamos

| Categoria | Exemplos | Finalidade |
|---|---|---|
| Cadastro | nome, e-mail, telefone, empresa | criar e administrar a conta |
| Faturamento | CPF/CNPJ, endereço de cobrança | emitir cobranças e notas fiscais |
| Uso da plataforma | registros de acesso, configurações | segurança, suporte e melhoria do serviço |
| Conversas atendidas | número de telefone, transcrição, gravação (se ativada) | prestar o atendimento contratado pelo cliente |
| Site | cookies e dados de navegação | funcionamento do site e, com consentimento, métricas |

## Bases legais

Execução de contrato, cumprimento de obrigação legal, legítimo interesse (por exemplo, prevenção a fraudes) e consentimento, quando exigido — como para cookies não essenciais.

## Compartilhamento

Compartilhamos dados apenas com fornecedores necessários à operação, sob contrato e com medidas de segurança. Não vendemos dados pessoais. Suboperadores atuais:

| Fornecedor | Finalidade | Local |
|---|---|---|
| Railway | hospedagem da plataforma e do banco de dados | EUA |
| OpenAI | modelos de IA para texto e voz | EUA |
| LiveKit | infraestrutura de voz em tempo real | EUA |
| DIDLogic e Twilio | números de telefone e ligações | UE / EUA |
| Meta Platforms (WhatsApp Business) | envio e recebimento de mensagens de WhatsApp | EUA |
| Stripe | pagamentos e verificação de identidade | EUA |
| Resend | envio de e-mails | Brasil (São Paulo) / EUA |
| Google e Microsoft | login e calendários, quando conectados pelo cliente | EUA |

## Transferência internacional

Alguns fornecedores podem processar dados fora do Brasil. Nesses casos adotamos as salvaguardas previstas na LGPD e nas normas da ANPD.

## Retenção

Mantemos os dados pelo tempo necessário às finalidades acima ou pelo prazo legal. Gravações e transcrições seguem o período configurado pelo cliente em **Técnico** no assistente. Dados da conta são mantidos enquanto ela estiver ativa e, após o encerramento, eliminados ou anonimizados, ressalvadas as obrigações legais de guarda (como documentos fiscais).

## Seus direitos

Você pode solicitar confirmação de tratamento, acesso, correção, anonimização, portabilidade, eliminação, informação sobre compartilhamentos e revogação de consentimento. Se a sua conversa foi com um cliente da Kloel, encaminharemos o pedido a ele.

:::info[Encarregado de dados]
Encarregado (DPO): ${DPO}. Você também pode usar o botão **Suporte** no topo da central ou reclamar à ANPD.
:::

## Segurança

Usamos criptografia em trânsito, controle de acesso por papéis e registros de auditoria. Nenhum sistema é totalmente imune a incidentes; se ocorrer um incidente relevante, comunicaremos os afetados e a ANPD conforme a lei.

## Alterações

Podemos atualizar esta Política. A versão vigente fica sempre nesta página.

${VERSION}`,
  },
  {
    section: 'legal',
    slug: 'protecao-de-dados',
    title: 'Proteção de dados',
    description: 'Acordo de tratamento de dados (DPA) entre o cliente controlador e a Kloel como operadora.',
    source: '[181] [217] [228] — nota do operador',
    related: ['legal/politica-de-privacidade', 'legal/termos-e-condicoes', 'partner-legal/dpa-lgpd'],
    keywords: ['dpa', 'acordo de tratamento', 'operador', 'controlador', 'lgpd', 'suboperadores', 'confidencialidade'],
    body: `Este Acordo de Proteção de Dados ("Acordo") complementa os [Termos e condições](/ajuda/legal/termos-e-condicoes) e se aplica sempre que a Kloel tratar dados pessoais **em nome do cliente** — por exemplo, dados de quem liga para o número atendido por um assistente.

## Papéis

- **Cliente:** controlador, decide finalidades e meios do tratamento (o que o assistente pergunta, o que é gravado, para onde os dados são enviados).
- **Kloel:** operadora, trata os dados somente conforme instruções documentadas do cliente — que incluem as configurações feitas na plataforma.

## Objeto do tratamento

| Item | Descrição |
|---|---|
| Titulares | pessoas que ligam, escrevem ou são contatadas pelos assistentes do cliente |
| Dados | telefone, nome, conteúdo da conversa, gravação (opcional), dados enviados por integrações |
| Operações | recepção, transcrição, resumo, armazenamento, envio para sistemas indicados pelo cliente |
| Duração | vigência do contrato + período de retenção configurado |

## Obrigações da Kloel

::::steps
### Confidencialidade
Pessoas autorizadas a tratar os dados assumem dever de sigilo.

### Segurança
Medidas técnicas e administrativas adequadas, como criptografia, controle de acesso e registros de auditoria.

### Suboperadores
Uso de suboperadores somente com contrato equivalente a este Acordo. A lista vigente está na [Política de privacidade](/ajuda/legal/politica-de-privacidade#compartilhamento); mudanças são avisadas com antecedência.

### Apoio ao controlador
Auxílio razoável no atendimento a pedidos de titulares e em relatórios de impacto.

### Incidentes
Comunicação ao cliente sem demora injustificada após tomar conhecimento de incidente que afete seus dados.

### Término
Eliminação ou devolução dos dados ao fim do contrato, salvo obrigação legal de guarda.
::::

## Obrigações do cliente

- Ter base legal para os tratamentos que configurar (inclusive gravação de ligações e ligações outbound).
- Informar os titulares de forma clara, por exemplo na mensagem inicial do assistente.
- Não enviar dados sensíveis desnecessários por integrações e webhooks.

## Confidencialidade

As partes mantêm sob sigilo informações técnicas e comerciais recebidas uma da outra durante o contrato e por **5** anos após o término.

:::tip[Para parceiros]
Se você indica ou revende a Kloel, veja também [DPA e LGPD: indicação ou revenda](/ajuda/partner-legal/dpa-lgpd).
:::`,
  },
  {
    section: 'legal',
    slug: 'aviso-legal',
    title: 'Aviso legal',
    description: 'Dados de identificação da empresa responsável pela Kloel e pelo conteúdo deste site.',
    source: '[181] — nota do operador (imprint)',
    related: ['legal/termos-e-condicoes', 'legal/politica-de-privacidade', 'legal/protecao-de-dados'],
    keywords: ['imprint', 'cnpj', 'razão social', 'endereço', 'responsável', 'dados da empresa'],
    body: `## Identificação

| Campo | Valor |
|---|---|
| Razão social | ${COMPANY} |
| Nome fantasia | Kloel |
| CNPJ | ${CNPJ} |
| Endereço | ${ADDRESS} |
| Contato | [contato@kloel.ai](mailto:contato@kloel.ai) · WhatsApp [(64) 99312-8506](https://wa.me/5564993128506) · [Fale com o time](/contato) |
| Encarregado de dados | ${DPO} |

## Responsabilidade pelo conteúdo

As informações deste site e da Central de ajuda têm caráter informativo e podem mudar sem aviso.

## Marcas

"Kloel" e o logotipo kloel.ai são marcas de ${COMPANY}. Nomes de produtos de terceiros citados nas integrações pertencem aos respectivos titulares e são usados apenas para identificação.

## Links

A Kloel não se responsabiliza pelo conteúdo de sites de terceiros.`,
  },
]
