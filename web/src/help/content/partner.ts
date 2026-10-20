import type { HelpArticle } from './types'

/**
 * Aba "Parceiros" da Central de ajuda.
 *
 * Não há notas de referência para esta aba: todo o conteúdo é DEMONSTRATIVO (demo: true).
 * Percentuais, valores, prazos e regras comerciais citados são ilustrativos (sem marcadores no texto — problema E1 do operador).
 * A "área do parceiro" não é uma tela deste app local; ela aparece apenas como ::mockup{kind="partner-portal"}.
 */
export const PARTNER_ARTICLES: HelpArticle[] = [
  // ─── Início ────────────────────────────────────────────────────────────────────────────────────
  {
    section: 'home',
    slug: 'partner-hub',
    title: 'Central de Conhecimento do Parceiro',
    description: 'Tudo o que você precisa para indicar, vender, implantar e dar suporte à Kloel, organizado por etapa do trabalho.',
    source: 'DEMONSTRATIVO',
    demo: true,
    related: ['home/partner-academy', 'partner-program/become-a-partner', 'onboarding/welcome', 'sales-resources/demo-that-closes'],
    keywords: ['parceiro', 'central do parceiro', 'hub', 'programa de parceria', 'revenda', 'indicação', 'agência'],
    body: `Esta é a base de conhecimento para agências, integradores de telefonia, consultores e software houses que levam a Kloel aos próprios clientes. Aqui você encontra como o programa funciona, roteiros de venda, respostas para as perguntas dos clientes, orientações de jurídico e cobrança, e o passo a passo técnico da implantação.

Se esta é sua primeira visita, comece pela [Kloel Partner Academy](/ajuda/home/partner-academy): ela organiza os artigos abaixo em uma trilha de estudo com entregas práticas.

::mockup{kind="partner-portal" caption="Área do parceiro: clientes, status de cada conta e comissões"}

## Comece por aqui

:::cards
- [Kloel Partner Academy](/ajuda/home/partner-academy) Trilha em módulos, do primeiro contato ao cliente em produção.
- [Como me tornar um parceiro Kloel?](/ajuda/partner-program/become-a-partner) Etapas para entrar no programa.
- [Bem-vindo como parceiro](/ajuda/onboarding/welcome) O roteiro da sua primeira semana.
:::

## Programa e onboarding

:::cards
- [Indicar ou revender?](/ajuda/partner-program/refer-or-resell) Compare os dois modelos e escolha por cliente.
- [Requisitos para parceiros](/ajuda/partner-program/requirements) O que esperamos antes e depois da entrada.
- [Teste a Kloel com sua conta de parceiro](/ajuda/onboarding/test-with-partner-account) Use os minutos de demonstração.
- [Quem te ajuda com o quê](/ajuda/onboarding/who-helps-with-what) Parcerias, suporte e financeiro.
:::

## Vender

:::cards
- [Primeiro contato por telefone](/ajuda/sales-resources/first-phone-contact) Roteiro curto para marcar a demo.
- [A demo que fecha negócio](/ajuda/sales-resources/demo-that-closes) Estrutura de 30 minutos.
- [Biblioteca de objeções](/ajuda/sales-resources/objection-library) Dez respostas prontas para adaptar.
- [Modelo de proposta](/ajuda/sales-resources/proposal-template) Texto base para copiar e personalizar.
:::

## Clientes

:::cards
- [Quem compra a Kloel e por quê](/ajuda/customers/who-buys) Perfis, dores e decisores.
- [Casos de uso por setor](/ajuda/customers/use-cases-by-industry) Saúde, imobiliário, serviços e mais.
- [Os primeiros 30 dias após a compra](/ajuda/customers/first-30-days) Do kick-off à primeira revisão.
:::

## Operação: jurídico, cobrança e configuração

:::cards
- [DPA e LGPD: indicação ou revenda](/ajuda/partner-legal/dpa-lgpd) Papéis e acordos em cada modelo.
- [Faturas e cobrança](/ajuda/pricing-billing/invoices-and-billing) Quem fatura, quem paga e onde ver.
- [Integrações: o que funciona, o que está por vir](/ajuda/setup/integrations-status) Status antes de prometer.
- [Problemas comuns de suporte após o go-live](/ajuda/setup/common-support-issues) Sintomas e soluções.
:::

## Marketing

:::cards
- [Material de marketing](/ajuda/marketing-resources/marketing-material) O que existe e como usar.
- [Modelos de mídia](/ajuda/marketing-resources/media-templates) Posts, e-mails e mensagens prontos.
- [Modelos de panfletos](/ajuda/marketing-resources/flyer-templates) Impressos e regras de uso da marca.
:::

:::tip[Precisa de ajuda?]
Use o botão **Suporte** no topo desta central ou [agende uma conversa de parceria](/parceiros/agendar).
:::`,
  },
  {
    section: 'home',
    slug: 'partner-academy',
    title: 'Kloel Partner Academy',
    description: 'Uma trilha de estudo em sete módulos para você sair do cadastro e chegar ao primeiro cliente em produção.',
    source: 'DEMONSTRATIVO',
    demo: true,
    related: ['home/partner-hub', 'onboarding/welcome', 'sales-resources/build-customer-demo', 'customers/first-30-days'],
    keywords: ['academy', 'treinamento', 'curso', 'trilha', 'capacitação', 'formação de parceiros'],
    body: `A Partner Academy é o jeito recomendado de estudar esta central. Em vez de ler os artigos em qualquer ordem, você percorre sete módulos curtos. Cada um combina leitura, um exercício na sua própria conta e uma entrega concreta que prova que você está pronto para a etapa seguinte.

Os módulos são sequenciais, mas você pode pular os que já domina. Se você vem do mercado de telefonia, por exemplo, provavelmente avança rápido no módulo 6; se vem de marketing, talvez queira dedicar mais tempo ao módulo 2.

## A trilha

| Módulo | O que você aprende | Leitura principal | Entrega |
|---|---|---|---|
| 1. Fundamentos | Como o programa funciona e qual modelo usar | [Indicar ou revender?](/ajuda/partner-program/refer-or-resell) | Modelo escolhido para seus três primeiros clientes |
| 2. Produto na prática | Criar, treinar e testar um assistente | [Teste a Kloel com sua conta de parceiro](/ajuda/onboarding/test-with-partner-account) | Um assistente de demonstração atendendo bem |
| 3. Prospecção | Primeiro contato e qualificação | [Qualificando antes da demo](/ajuda/sales-resources/qualifying-before-demo) | Lista com 10 prospects qualificados |
| 4. Demo e fechamento | Conduzir a demo e tratar objeções | [A demo que fecha negócio](/ajuda/sales-resources/demo-that-closes) | Uma demo gravada para autoavaliação |
| 5. Proposta e preço | Montar pacotes e escrever a proposta | [Modelo de proposta](/ajuda/sales-resources/proposal-template) | Proposta-modelo da sua empresa |
| 6. Implantação | Go-live, integrações e webhooks | [Os primeiros 30 dias](/ajuda/customers/first-30-days) | Checklist de go-live preenchido |
| 7. Crescimento | Retenção, upsell e marketing | [Manual de upsell](/ajuda/sales-resources/upsell-playbook) | Plano de conta para um cliente ativo |

::mockup{kind="test-call" caption="Exercício do módulo 2: ligação de teste com o assistente de demonstração"}

## Como estudar cada módulo

::::steps
### Leia os artigos do módulo
Comece pela leitura principal e siga os links de "Relacionados" no fim de cada página. Use a busca (⌘K) quando surgir um termo novo.

### Pratique na sua conta
Todo módulo tem um exercício que você faz no app. Use os minutos de demonstração da sua conta de parceiro e nunca dados reais de clientes.

### Registre a entrega
Guarde a entrega em uma pasta da sua equipe. Ela vira material reaproveitável: o assistente do módulo 2 vira sua demo padrão, a proposta do módulo 5 vira seu modelo comercial.

### Revise com o time de parcerias
Se quiser uma segunda opinião sobre a demo ou a proposta, peça uma revisão pelo botão **Suporte**.
::::

## Ritmo sugerido

- **Semana 1:** módulos 1 e 2.
- **Semana 2:** módulos 3 e 4, com as primeiras ligações reais.
- **Semana 3:** módulos 5 a 7, idealmente já com um cliente em implantação.

:::note[Certificação]
A Academy não emite certificado. Use as entregas como checklist interno de prontidão da sua equipe.
:::

:::tip[Precisa de ajuda?]
Ficou travado em algum módulo? Use o botão **Suporte** no topo desta central.
:::`,
  },

  // ─── Programa de parceiros ─────────────────────────────────────────────────────────────────────
  {
    section: 'partner-program',
    slug: 'become-a-partner',
    title: 'Como me tornar um parceiro Kloel?',
    description: 'As etapas para entrar no programa de parceiros da Kloel, da conversa inicial ao primeiro cliente registrado.',
    source: 'DEMONSTRATIVO',
    demo: true,
    related: ['partner-program/refer-or-resell', 'partner-program/requirements', 'portal-tracking/account-activation', 'onboarding/welcome'],
    keywords: ['cadastro de parceiro', 'entrar no programa', 'inscrição', 'parceria', 'conta de parceiro', 'agendar conversa'],
    body: `O programa de parceiros da Kloel é para empresas e profissionais que querem oferecer assistentes de voz com IA aos próprios clientes, seja indicando a Kloel, seja revendendo com a sua marca à frente. A entrada é simples e começa com uma conversa.

Você usa uma única conta de parceiro para os dois modelos e decide, cliente a cliente, se vai indicar ou revender.

::::steps
### Conheça os modelos
Leia a página [Parceiros](/parceiros) e o artigo [Indicar ou revender?](/ajuda/partner-program/refer-or-resell). Chegue à conversa sabendo qual modelo combina mais com a sua operação.

### Agende uma conversa de parceria
Em [Agendar conversa de parceria](/parceiros/agendar), informe quantos clientes você imagina atender, escolha um horário, preencha seus dados de contato e confirme. Os horários são exibidos no fuso de Brasília (America/Sao_Paulo).

### Crie sua conta Kloel
Se ainda não tem conta, use [Criar conta](/criar-conta) com um e-mail profissional da sua empresa, de preferência um endereço de função como parcerias@exemplo.com.br. Isso facilita a [transferência da conta](/ajuda/portal-tracking/account-transfer) no futuro.

### Aguarde a ativação
Depois da conversa, o time de parcerias ativa o perfil de parceiro na sua conta. Veja os status possíveis em [Ativação da conta de parceiro](/ajuda/portal-tracking/account-activation).

### Registre o primeiro cliente
Compartilhe seu link de indicação ou crie a conta do cliente revendido pela área do parceiro.
::::

::mockup{kind="partner-portal" caption="Área do parceiro logo após a ativação"}

## O que você recebe

- Conta de parceiro gratuita, com um volume mensal de minutos para demonstrações.
- Acesso a toda esta aba da central: roteiros, modelos e orientações técnicas.
- Área do parceiro para acompanhar clientes e comissões.
- Um contato no time de parcerias para dúvidas comerciais.

:::faq[Preciso pagar para ser parceiro?]
A conta de parceiro começa gratuita e permanece assim enquanto você trouxer ao menos um cliente nos três primeiros meses. A regra vigente é confirmada na conversa de parceria.
:::

:::faq[Preciso ter CNPJ?]
Para revender, sim: você emite a nota fiscal ao cliente. Para indicar, o recebimento de comissões também exige dados cadastrais e fiscais; confirme o formato aceito na conversa.
:::

:::tip[Precisa de ajuda?]
Dúvidas antes de entrar? Use o botão **Suporte** no topo desta central.
:::`,
  },
  {
    section: 'partner-program',
    slug: 'refer-or-resell',
    title: 'Indicar ou revender?',
    description: 'Compare os dois modelos do programa e escolha, cliente a cliente, quem fatura e quem dá o suporte.',
    source: 'DEMONSTRATIVO',
    demo: true,
    related: ['partner-program/become-a-partner', 'partner-legal/dpa-lgpd', 'pricing-billing/invoices-and-billing', 'sales-resources/pricing-setups'],
    keywords: ['indicação', 'revenda', 'comissão', 'desconto', 'níveis de parceiro', 'nota fiscal', 'referral'],
    body: `Uma conta de parceiro, dois modelos. Ao **indicar**, você apresenta o cliente e a Kloel cuida de cobrança, onboarding e suporte; você recebe comissão recorrente. Ao **revender**, você compra a Kloel com desconto, define o preço final, emite a nota fiscal e atende o cliente em primeiro nível.

A decisão é tomada por cliente. Você pode indicar uma clínica pequena que não quer mais um fornecedor e revender para uma rede de imobiliárias que já compra outros serviços seus.

## Comparação lado a lado

| | Indicar | Revender |
|---|---|---|
| Quem emite a nota ao cliente | Kloel | Você |
| Como você ganha | Comissão recorrente sobre o que o cliente paga | Desconto na compra + sua margem |
| Preço para o cliente | Tabela pública de [Planos](/planos) | Definido por você |
| Suporte de primeiro nível | Kloel | Você |
| Contato da Kloel com o cliente | Sim | Opcional: pode ficar só com você |
| Conta do cliente | Própria, em nome do cliente | Própria, com assinatura fornecida por você |
| Combina com | Quem quer receita sem operar | Quem já fatura serviços e quer nota única |

## Níveis de parceria

Os níveis sobem conforme o faturamento anual gerado pelos seus clientes. No modelo revender, o primeiro nível começa em Prata.

| Nível | Indicar: comissão | Revender: desconto |
|---|---|---|
| Bronze | 15% | — |
| Prata | 20% | 20% |
| Ouro | 25% | 25% |
| Platina | 30% | 30% |
| Diamante | 35% | 35% |

::mockup{kind="partner-portal" caption="Área do parceiro com clientes marcados como Indicação ou Revenda"}

## Como decidir

- **Indique** quando o cliente prefere contratar direto, quando você não quer assumir suporte ou quando a venda é pontual.
- **Revenda** quando você já tem contrato e cobrança recorrente com o cliente, quando quer controlar o preço ou quando a Kloel faz parte de um pacote maior seu.

:::info[Serviços próprios em paralelo]
Nos dois modelos você pode cobrar à parte por consultoria, implantação e integrações. Se quiser faturar tudo em uma única nota, use a revenda.
:::

:::faq[A comissão de indicação é vitalícia?]
Sim: ela continua enquanto o cliente indicado mantiver a assinatura.
:::

:::tip[Precisa de ajuda?]
Em dúvida sobre um cliente específico? Use o botão **Suporte** ou [agende uma conversa de parceria](/parceiros/agendar).
:::`,
  },
  {
    section: 'partner-program',
    slug: 'requirements',
    title: 'Requisitos para parceiros',
    description: 'O que esperamos de um parceiro Kloel antes e depois de entrar no programa, em cada modelo.',
    source: 'DEMONSTRATIVO',
    demo: true,
    related: ['partner-program/become-a-partner', 'partner-program/refer-or-resell', 'partner-legal/dpa-lgpd', 'marketing-resources/flyer-templates'],
    keywords: ['requisitos', 'critérios', 'pré-requisitos', 'obrigações do parceiro', 'CNPJ', 'regras do programa'],
    body: `Não existe prova de entrada para o programa. Os requisitos servem para proteger os clientes finais e a reputação de todos os parceiros: quem vende a Kloel precisa conhecer o produto, prometer apenas o que ele faz e tratar dados pessoais com cuidado.

Os requisitos variam conforme o modelo. Na revenda, você assume mais responsabilidades porque fatura e atende o cliente.

## Requisitos por modelo

| Requisito | Indicar | Revender |
|---|---|---|
| Conta Kloel ativa com perfil de parceiro | Sim | Sim |
| Dados cadastrais e fiscais | Para receber comissões | CNPJ obrigatório, pois você emite a nota |
| Assistente de demonstração funcionando | Recomendado | Obrigatório |
| Suporte de primeiro nível ao cliente | Não | Sim |
| Aceite dos termos do programa | Sim | Sim, mais acordo de tratamento de dados com cada cliente |
| Atividade mínima | Ao menos 1 cliente nos 3 primeiros meses | Igual |

::mockup{kind="agent-general" caption="Assistente de demonstração configurado: requisito para revendedores"}

## Conduta esperada

- **Prometa só o que existe.** Antes de citar uma integração, confira [Integrações: o que funciona, o que está por vir](/ajuda/setup/integrations-status).
- **Não invente resultados.** Use números do próprio cliente ou deixe claro quando um valor é estimativa.
- **Respeite a LGPD.** Oriente o cliente sobre aviso de gravação e bases legais. Veja [DPA e LGPD](/ajuda/partner-legal/dpa-lgpd).
- **Use a marca corretamente.** Siga as regras em [Modelos de panfletos](/ajuda/marketing-resources/flyer-templates).
- **Não compartilhe senhas.** Acesse contas de clientes como usuário convidado em [Usuários](/app/users).

:::warning[Uso responsável]
Não é permitido usar a Kloel para ligações em massa sem base legal, para se passar por outra empresa ou para enganar quem atende. Violações podem levar à suspensão da conta de parceiro.
:::

## Perfis que costumam ir bem

Agências de marketing digital, integradores de telefonia e PABX, consultores de CRM e automação, e software houses que atendem um nicho específico, como clínicas, imobiliárias ou oficinas.

:::tip[Precisa de ajuda?]
Quer confirmar se o seu perfil se encaixa? Use o botão **Suporte** no topo desta central.
:::`,
  },
  {
    section: 'partner-program',
    slug: 'white-label',
    title: 'White label e co-branding',
    description: 'O que pode levar a sua marca, o que continua identificado como Kloel e como pedir uma personalização maior.',
    source: 'DEMONSTRATIVO',
    demo: true,
    related: ['partner-program/refer-or-resell', 'marketing-resources/flyer-templates', 'products/webchat', 'partner-legal/templates-and-documents'],
    keywords: ['white label', 'marca própria', 'co-branding', 'powered by', 'personalização de marca', 'rebranding'],
    body: `Existem dois níveis de personalização para parceiros. No **co-branding**, que vale para todo o programa, sua marca aparece à frente e a Kloel aparece como tecnologia, com o selo "powered by kloel.ai". No **white label**, que depende de acordo específico, a presença da Kloel é reduzida ao mínimo possível.

## Co-branding x white label

| | Co-branding | White label |
|---|---|---|
| Sua marca em propostas, materiais e treinamentos | Sim | Sim |
| Selo "powered by kloel.ai" | Visível | Removido onde for possível |
| Painel usado pelo cliente | Kloel | Sob consulta |
| Nome, voz e personalidade do assistente | Livres | Livres |
| Disponibilidade | Padrão do programa | Acordo personalizado |

## O que o cliente final percebe

- **Ao telefone:** quem liga ouve o nome do assistente (por exemplo, "Roberta") e o nome da empresa do cliente. A Kloel só é mencionada se você colocar isso nas **Mensagens iniciais** ou no prompt.
- **No chat do site:** no plano Solo do Webchat de IA, o widget exibe "Powered by kloel.ai"; no plano Team, a marca Kloel sai do widget. Confira em [Planos](/planos).
- **WhatsApp e e-mail:** as mensagens saem dos canais conectados pelo próprio cliente.
- **Cobrança:** na revenda, a nota fiscal é sua.

::mockup{kind="webchat" caption="Widget de chat no site do cliente com o selo powered by kloel.ai"}

## Como pedir white label

::::steps
### Reúna os números
Estime quantos clientes e quantos minutos por mês você pretende atender nos próximos 12 meses.

### Agende uma conversa
Use [Agendar conversa de parceria](/parceiros/agendar) e diga que o assunto é white label.

### Avalie a proposta
O time de parcerias responde com o escopo do que pode ser personalizado e as condições.
::::

:::tip[Precisa de ajuda?]
Use o botão **Suporte** no topo desta central para dúvidas sobre o uso da marca.
:::`,
  },
  {
    section: 'partner-program',
    slug: 'refer-without-implementing',
    title: 'Indicar sem implementar você mesmo',
    description: 'Como ganhar comissão indicando a Kloel quando você não quer configurar nem dar suporte ao assistente.',
    source: 'DEMONSTRATIVO',
    demo: true,
    related: ['partner-program/refer-or-resell', 'portal-tracking/customer-not-showing', 'sales-resources/qualifying-before-demo', 'onboarding/who-helps-with-what'],
    keywords: ['só indicar', 'indicação simples', 'link de indicação', 'comissão sem implantação', 'consultor', 'créditos grátis'],
    body: `Nem todo parceiro quer implantar. Contadores, consultores de gestão, associações comerciais e fornecedores de software costumam conhecer muitas empresas que perdem ligações, mas não querem se tornar especialistas em assistentes de voz. Para esses casos, a indicação pura funciona bem: você apresenta, a Kloel faz o resto.

::::steps
### Pegue seu link de indicação
O link de parceiro fica na área do parceiro. Ele registra o cliente em seu nome quando a conta é criada.

### Faça a apresentação
Envie uma mensagem curta ao cliente explicando por que você acha que a Kloel ajuda, junto com o link. Se ele preferir conversar antes, indique [Agendar demo](/agendar-demo) e peça que cite o nome da sua empresa no formulário.

### A Kloel conduz a venda
O time da Kloel faz a demonstração, ajuda na configuração inicial e cuida da cobrança e do suporte.

### Acompanhe e receba
Na área do parceiro você vê o status do cliente e a comissão apurada.
::::

::mockup{kind="partner-portal" caption="Área do parceiro com o link de indicação e os clientes indicados"}

## Indicação de parceiro x Créditos grátis

São programas diferentes. Não confunda na hora de orientar alguém.

| | Indicação de parceiro | Créditos grátis |
|---|---|---|
| Para quem | Parceiros com perfil ativo | Qualquer cliente da Kloel |
| Recompensa | Comissão recorrente | Créditos de uso na própria conta |
| Onde acompanhar | Área do parceiro | [Créditos grátis](/app/free-credits) |

## Para a indicação virar cliente

- Indique empresas que já reclamam de ligações perdidas ou de recepção sobrecarregada. Veja [Qualificando antes da demo](/ajuda/sales-resources/qualifying-before-demo).
- Na apresentação, conte em uma frase o contexto do cliente. Isso encurta a primeira reunião.
- Combine com o cliente que ele use o seu link ao criar a conta.

:::warning[Atribuição]
Se o cliente criar a conta sem o seu link e sem citar você, ele pode não aparecer na sua área. O que fazer nesse caso está em [Cliente não aparece na área de parceiros](/ajuda/portal-tracking/customer-not-showing).
:::

:::tip[Precisa de ajuda?]
Use o botão **Suporte** no topo desta central.
:::`,
  },
  {
    section: 'partner-program',
    slug: 'release-updates',
    title: 'Atualizações de lançamento para parceiros',
    description: 'Como acompanhar as novidades do produto e preparar seus clientes para cada lançamento sem vender o que ainda não existe.',
    source: 'DEMONSTRATIVO',
    demo: true,
    related: ['setup/integrations-status', 'onboarding/where-to-find-resources', 'sales-resources/upsell-playbook', 'customers/why-customers-stay-or-leave'],
    keywords: ['novidades', 'lançamentos', 'changelog', 'roadmap', 'beta', 'acesso antecipado', 'atualizações'],
    body: `A Kloel evolui com frequência: novas integrações, vozes, canais e ajustes no painel. Como parceiro, você é a primeira pessoa a quem seus clientes perguntam "isso já funciona?". Este artigo mostra onde acompanhar as novidades e como transformá-las em oportunidades sem criar expectativas erradas.

## Onde as novidades aparecem

- **Esta central:** os artigos são atualizados quando um recurso muda. Confira a seção de configuração antes de cada proposta.
- **Comunicado aos parceiros:** um resumo periódico enviado ao e-mail cadastrado na conta de parceiro (exemplo: mensal).
- **Encontro de lançamento:** apresentação online para lançamentos maiores, com espaço para perguntas.
- **Selos no app:** itens marcados como **Beta** (como o [E-Mail IA](/app/email-agents)) ou **Acesso antecipado** em [Integrações](/app/integrations).

::mockup{kind="integrations" caption="Integrações com selo de acesso antecipado"}

## O que cada estágio significa

| Estágio | O que significa | Como tratar com clientes |
|---|---|---|
| Disponível | Liberado para todas as contas | Pode vender e implantar |
| Beta | Funciona, mas ainda pode mudar | Ofereça como piloto, com aviso |
| Acesso antecipado | Liberado sob solicitação, para um grupo | Peça acesso antes de prometer; não coloque em contrato |
| Em breve | Planejado, sem data garantida | Não prometa nem use como argumento de fechamento |

## Checklist a cada lançamento

::::steps
### Leia a nota de lançamento
Entenda para quem é o recurso, em quais planos está e quais limites tem.

### Teste na sua conta de parceiro
Configure o recurso no seu assistente de demonstração e faça uma ligação de teste.

### Mapeie quem se beneficia
Liste os clientes que pediram algo parecido ou que têm o problema que o recurso resolve.

### Comunique e atualize materiais
Avise esses clientes, ajuste suas propostas e apresentações e, se fizer sentido, ofereça a ativação como serviço.
::::

:::warning[Não venda roadmap]
Recursos "em breve" podem mudar de escopo ou de data. Feche negócios com base no que está disponível hoje.
:::

:::tip[Precisa de ajuda?]
Quer saber se um recurso já está liberado para um cliente? Use o botão **Suporte** no topo desta central.
:::`,
  },

  // ─── Onboarding ────────────────────────────────────────────────────────────────────────────────
  {
    section: 'onboarding',
    slug: 'welcome',
    title: 'Bem-vindo como parceiro',
    description: 'Seu roteiro para a primeira semana como parceiro Kloel, com uma tarefa concreta por dia.',
    source: 'DEMONSTRATIVO',
    demo: true,
    related: ['home/partner-academy', 'onboarding/test-with-partner-account', 'onboarding/where-to-find-resources', 'portal-tracking/account-activation'],
    keywords: ['boas-vindas', 'primeira semana', 'começar como parceiro', 'onboarding do parceiro', 'primeiros passos'],
    body: `Que bom ter você no programa. A primeira semana define o ritmo da parceria: quem sai dela com um assistente de demonstração redondo e uma lista de prospects costuma fechar o primeiro cliente bem mais rápido do que quem espera "ter tempo para estudar".

O roteiro abaixo cabe em cerca de uma hora por dia. Se preferir uma trilha mais completa, siga a [Kloel Partner Academy](/ajuda/home/partner-academy).

::::steps
### Dia 1: confirme seu acesso
Entre no app e verifique se o perfil de parceiro está ativo. Se algo estiver pendente, veja [Ativação da conta de parceiro](/ajuda/portal-tracking/account-activation). Convide um colega em [Usuários](/app/users) para que a conta não dependa de uma pessoa só.

### Dia 2: crie seu assistente de demonstração
Siga [Crie uma demo para o cliente em minutos](/ajuda/sales-resources/build-customer-demo) usando uma empresa de teste, como a Clínica Bem Viver. Termine com uma **Ligação de teste**.

### Dia 3: escolha seu modelo
Leia [Indicar ou revender?](/ajuda/partner-program/refer-or-resell) e decida como vai atuar com os três primeiros clientes.

### Dia 4: monte sua lista
Use [Quem compra a Kloel e por quê](/ajuda/customers/who-buys) para listar 10 empresas da sua carteira com potencial.

### Dia 5: marque a primeira conversa
Ligue para dois ou três prospects com o roteiro de [Primeiro contato por telefone](/ajuda/sales-resources/first-phone-contact) e tente agendar uma demo.
::::

::mockup{kind="overview" caption="Visão geral da conta: acompanhe as ligações do seu assistente de demonstração"}

## Combinados importantes

- As comunicações do programa vão para o e-mail cadastrado na conta de parceiro. Mantenha-o atualizado.
- Condições comerciais são confirmadas pelo time de parcerias.
- Em testes, use dados de teste: nomes inventados, telefones como +55 11 90000-0123 e e-mails @exemplo.com.br.

:::tip[Precisa de ajuda?]
Use o botão **Suporte** no topo desta central a qualquer momento.
:::`,
  },
  {
    section: 'onboarding',
    slug: 'test-with-partner-account',
    title: 'Teste a Kloel com sua conta de parceiro',
    description: 'Use os minutos de demonstração da sua conta de parceiro para conhecer o produto e mostrar a Kloel a prospects.',
    source: 'DEMONSTRATIVO',
    demo: true,
    related: ['pricing-billing/test-calls-and-credits', 'sales-resources/build-customer-demo', 'get-started/first-steps', 'sales-resources/seven-wow-moments'],
    keywords: ['conta de teste', 'minutos de demonstração', 'testar', 'ligação de teste', 'demo', 'sandbox'],
    body: `Sua conta de parceiro inclui um volume mensal de minutos para demonstrações. Use-os para aprender o produto por dentro e para mostrar a prospects como ficaria o atendimento da empresa deles.

Teste do jeito que o cliente vai usar: com uma empresa concreta, perguntas reais do dia a dia e os recursos que ele precisaria.

::::steps
### Crie um assistente
Em [Assistentes](/app/agents), crie um novo e preencha na aba **Geral** o **Nome**, a **Voz**, o **Idioma** e as **Mensagens iniciais**. Um nome como "Demo – Clínica Bem Viver" ajuda a organizar.

### Dê conhecimento a ele
Na aba **Conhecimento**, adicione o site da empresa, um PDF com preços ou serviços e algumas perguntas e respostas. Veja [Base de conhecimento](/ajuda/get-started/knowledge-base).

### Ative um ou dois recursos
Em **Recursos**, experimente **Agendar compromissos** e **Transferir ligações**. São os que mais impressionam em demonstração.

### Faça a ligação de teste
Clique em **Ligação de teste** e converse pelo navegador. Tente perguntas fora do roteiro e interrupções.

### Revise a conversa
Abra [Conversas](/app/inbox) e leia a transcrição e o resumo. Ajuste **Regras** e **Conhecimento** onde o assistente hesitou.
::::

::mockup{kind="test-call" caption="Ligação de teste no navegador com transcrição em tempo real"}

## Boas práticas

- Mantenha um assistente por prospect e apague os antigos depois de fechar ou perder a venda.
- Nunca use dados reais de pacientes ou clientes finais em testes.
- Grave uma ligação de teste bem-sucedida para ter um plano B caso a demo ao vivo falhe.

::mockup{kind="inbox" caption="Conversas: transcrição e resumo da ligação de teste"}

:::info[Minutos acabaram?]
Veja como o consumo é contado e como ampliar o volume em [Chamadas de teste no painel e créditos](/ajuda/pricing-billing/test-calls-and-credits).
:::

:::tip[Precisa de ajuda?]
Use o botão **Suporte** no topo desta central.
:::`,
  },
  {
    section: 'onboarding',
    slug: 'where-to-find-resources',
    title: 'Onde encontrar recursos',
    description: 'Um mapa rápido de onde fica cada material: esta central, o app, a área do parceiro e as páginas públicas.',
    source: 'DEMONSTRATIVO',
    demo: true,
    related: ['home/partner-hub', 'marketing-resources/marketing-material', 'sales-resources/presentations', 'onboarding/who-helps-with-what'],
    keywords: ['materiais', 'onde fica', 'recursos de parceiro', 'downloads', 'mapa', 'links úteis'],
    body: `Os recursos do programa estão espalhados em quatro lugares: esta central de ajuda, o app da Kloel, a área do parceiro e as páginas públicas do site. Use a tabela abaixo como mapa.

## Mapa de recursos

| Preciso de… | Onde encontrar |
|---|---|
| Explicar o programa para alguém | Página [Parceiros](/parceiros) |
| Conversar com o time de parcerias | [Agendar conversa de parceria](/parceiros/agendar) |
| Roteiros de venda e objeções | Grupo **Recursos de vendas** desta aba, a partir de [Primeiro contato por telefone](/ajuda/sales-resources/first-phone-contact) |
| Apresentações | [Apresentações](/ajuda/sales-resources/presentations) |
| Material de marketing e modelos | [Material de marketing](/ajuda/marketing-resources/marketing-material) |
| Preços públicos | [Planos](/planos) |
| Demo conduzida pela Kloel para um cliente indicado | [Agendar demo](/agendar-demo) |
| Clientes, status e comissões | Área do parceiro |
| Faturas da sua própria conta | [Faturamento](/app/billing) |
| Créditos por indicação de clientes | [Créditos grátis](/app/free-credits) |
| Documentação técnica | [Requisição HTTP](/ajuda/developers/http-request) e grupo **Desenvolvedores** |
| Documentos jurídicos | [Jurídico: modelos e documentos](/ajuda/partner-legal/templates-and-documents) |

::mockup{kind="partner-portal" caption="Área do parceiro: clientes, comissões e materiais"}

## Atalhos desta central

- **⌘K** abre a busca em todos os artigos, inclusive das outras abas.
- **⌘I** abre o assistente da central para perguntas em linguagem natural.
- **Copiar página** copia o artigo em Markdown, útil para montar a base interna da sua equipe.

:::tip[Precisa de ajuda?]
Não achou um material? Use o botão **Suporte** no topo desta central.
:::`,
  },
  {
    section: 'onboarding',
    slug: 'who-helps-with-what',
    title: 'Quem te ajuda com o quê',
    description: 'Quem procurar em cada situação: time de parcerias, suporte técnico, financeiro e o que fica com você.',
    source: 'DEMONSTRATIVO',
    demo: true,
    related: ['onboarding/supporting-customers', 'partner-program/refer-or-resell', 'setup/common-support-issues', 'pricing-billing/invoices-and-billing'],
    keywords: ['contato', 'suporte', 'responsabilidades', 'escalonamento', 'chamado', 'time de parcerias', 'financeiro'],
    body: `Saber a quem recorrer economiza dias. A divisão de responsabilidades depende do modelo: na indicação, a Kloel atende o cliente diretamente; na revenda, você é o primeiro ponto de contato e a Kloel entra como segundo nível.

## Quem faz o quê

| Assunto | Indicação | Revenda |
|---|---|---|
| Dúvidas sobre programa, níveis e contrato | Time de parcerias | Time de parcerias |
| Demonstração para o cliente | Você ou a Kloel | Você |
| Configuração do assistente | Kloel ou você, se preferir | Você |
| Suporte de primeiro nível (dúvidas de uso) | Kloel | Você |
| Falhas técnicas e erros da plataforma | Suporte Kloel | Suporte Kloel, acionado por você |
| Cobrança do cliente | Kloel | Você |
| Comissões, descontos e repasses | Financeiro Kloel | Financeiro Kloel |

## Como abrir um chamado

::::steps
### Clique em Suporte
Use o botão **Suporte** no topo desta central ou o link [Fale com o time](/contato).

### Identifique a conta
Informe o nome da empresa cliente e o e-mail da conta. Na revenda, diga que você é o parceiro responsável.

### Descreva o caso
Inclua o horário da ocorrência (horário de Brasília), o número que ligou, o assistente envolvido e o que era esperado.

### Anexe evidências
O link da conversa em [Conversas](/app/inbox) e um print da transcrição resolvem a maioria das dúvidas na primeira resposta.
::::

::mockup{kind="inbox" caption="Conversas: o link da conversa é a evidência mais útil em um chamado"}

:::tip[Chamados que andam rápido]
"A Roberta não transferiu a ligação de +55 11 90000-0123 às 14h10 de hoje; a regra de transferência está ativa; segue o link da conversa" resolve em uma troca. "O assistente não funciona" precisa de três.
:::

:::warning[Incidentes amplos]
Se várias chamadas de clientes diferentes falharem ao mesmo tempo, diga isso logo na primeira linha do chamado.
:::`,
  },
  {
    section: 'onboarding',
    slug: 'supporting-customers',
    title: 'Dando suporte aos seus clientes e escalando',
    description: 'Como organizar o suporte aos seus clientes e crescer de poucos para dezenas de contas sem perder qualidade.',
    source: 'DEMONSTRATIVO',
    demo: true,
    related: ['onboarding/who-helps-with-what', 'setup/common-support-issues', 'pricing-billing/setup-and-care-packages', 'customers/why-customers-stay-or-leave'],
    keywords: ['suporte ao cliente', 'escalar', 'operação', 'manutenção', 'SLA', 'gestão de contas'],
    body: `Na revenda, e muitas vezes também na indicação com implantação, o cliente vai procurar você primeiro. Um assistente de voz não é "instalar e esquecer": as primeiras semanas pedem ajustes, e depois disso uma revisão leve e regular mantém a qualidade.

## Monte seu modelo de suporte

- **Um canal só:** um e-mail ou WhatsApp dedicado ao suporte, não o celular pessoal de quem vendeu.
- **Horário e prazo claros:** por exemplo, resposta em até 4 horas úteis. Escreva isso na proposta.
- **Acesso correto:** peça para ser convidado como usuário em [Usuários](/app/users) na conta de cada cliente. Nunca peça a senha.

:::warning[Senhas]
Não compartilhe nem guarde senhas de clientes. Um usuário convidado pode ser removido quando o contrato terminar; uma senha compartilhada, não.
:::

## Rotina semanal por cliente

::::steps
### Leia as conversas da semana
Em [Conversas](/app/inbox), filtre as ligações mais longas ou sem resolução e leia as transcrições.

### Ajuste regras e conhecimento
Corrija respostas imprecisas na aba **Conhecimento** e reforce limites na aba **Regras**.

### Confira o consumo
Veja minutos usados em [Visão geral](/app) e [Faturamento](/app/billing). Consumo subindo rápido é sinal de upsell; consumo caindo é sinal de risco.

### Registre pedidos
Anote o que o cliente pediu e ainda não existe. Isso alimenta seu [manual de upsell](/ajuda/sales-resources/upsell-playbook).
::::

## Escalando a operação

| Fase | Foco | O que padronizar |
|---|---|---|
| 1 a 5 clientes | Você faz tudo | Checklist de go-live e de revisão semanal |
| 6 a 20 clientes | Repetibilidade | Um assistente-modelo por setor, com prompt pronto |
| 21 a 50 clientes | Especialização | Separar implantação de suporte e vender pacotes de manutenção |

::mockup{kind="prompt-builder" caption="Construtor de prompt: base para padronizar assistentes por setor"}

:::tip[Precisa de ajuda?]
Use o botão **Suporte** no topo desta central.
:::`,
  },

  // ─── Acompanhamento no portal ──────────────────────────────────────────────────────────────────
  {
    section: 'portal-tracking',
    slug: 'customer-not-showing',
    title: 'Cliente não aparece na área de parceiros',
    description: 'O que verificar quando um cliente indicado ou revendido não aparece na sua área de parceiro e como pedir a correção.',
    source: 'DEMONSTRATIVO',
    demo: true,
    related: ['portal-tracking/account-activation', 'partner-program/refer-without-implementing', 'onboarding/who-helps-with-what', 'pricing-billing/invoices-and-billing'],
    keywords: ['cliente sumiu', 'atribuição', 'vínculo', 'indicação não registrada', 'cliente não aparece', 'portal do parceiro'],
    body: `Quando um cliente que você trouxe não aparece na área do parceiro, quase sempre o motivo é o vínculo entre a conta dele e a sua: o cadastro foi feito sem o seu link, com outro e-mail ou antes de você entrar no programa. Confira a tabela antes de abrir um chamado.

::mockup{kind="partner-portal" caption="Área do parceiro: lista de clientes com status Ativo, Pendente e Em teste"}

## Se algo não estiver funcionando

| Sintoma | O que verificar |
|---|---|
| O cliente criou a conta, mas não aparece | Ele usou o seu link de indicação? Abriu o link no mesmo navegador em que criou a conta? |
| Aparece como "Pendente" | A conta ainda não tem plano pago ativo. A comissão só começa após o primeiro pagamento. |
| Aparece vinculado a outro parceiro | Vale o primeiro vínculo registrado. Envie evidências de que a indicação foi sua. |
| O cliente já era da Kloel | Clientes existentes não são atribuídos retroativamente. |
| Conta revendida não aparece | A conta foi criada fora da sua área do parceiro, por exemplo direto em [Criar conta](/criar-conta). |
| Cliente recém-cadastrado | A sincronização pode levar até 24 horas. Aguarde antes de abrir chamado. |

## Como pedir a correção

::::steps
### Reúna os dados
Nome da empresa, CNPJ, e-mail usado no cadastro, data aproximada da criação da conta e o modelo (indicação ou revenda).

### Junte evidências
A mensagem em que você enviou o link ou o convite para a demo, com data, ajuda a comprovar a indicação.

### Abra um chamado
Use o botão **Suporte** e escolha o assunto de parcerias. O time verifica o cadastro e corrige o vínculo quando for o caso.
::::

:::warning[Prazo para reivindicar]
Pedidos de vínculo são aceitos em até 30 dias após a criação da conta do cliente. Não deixe acumular.
:::

:::faq[Ativei a conta com um e-mail pessoal. Dá para mudar?]
Sim. Adicione o e-mail profissional em [Usuários](/app/users) e peça a troca do responsável pelo botão **Suporte**. Veja também [Transferência de conta](/ajuda/portal-tracking/account-transfer).
:::

:::info[Comissões]
Comissões apuradas pertencem à empresa parceira cadastrada, e não à pessoa que vendeu. A transferência de responsável não altera o histórico.
:::`,
  },

  // ─── Recursos de vendas ────────────────────────────────────────────────────────────────────────
  {
    section: 'sales-resources',
    slug: 'first-phone-contact',
    title: 'Primeiro contato por telefone',
    description: 'Um roteiro curto para a primeira ligação com um prospect, do gancho ao agendamento da demo.',
    source: 'DEMONSTRATIVO',
    demo: true,
    related: ['sales-resources/qualifying-before-demo', 'sales-resources/discovery-questions', 'sales-resources/objection-library', 'sales-resources/build-customer-demo'],
    keywords: ['cold call', 'prospecção', 'ligação fria', 'roteiro de ligação', 'primeira ligação', 'abordagem'],
    body: `O objetivo da primeira ligação não é vender a Kloel. É conseguir 30 minutos na agenda do prospect para uma demonstração. Tudo o que não ajuda nisso pode ficar para depois.

Um bom primeiro contato dura de dois a cinco minutos e segue uma estrutura simples.

::::steps
### Abertura (10 segundos)
Diga quem você é e por que está ligando, sem rodeio. Peça permissão para tomar dois minutos.

### Gancho
Faça uma pergunta que toque na dor: "Quantas ligações vocês deixam de atender em um dia cheio?".

### Diagnóstico rápido
Duas ou três perguntas, no máximo. Use as do [catálogo de perguntas](/ajuda/sales-resources/discovery-questions) marcadas como essenciais.

### Proposta em uma frase
Conecte a dor ao resultado: "Um assistente de voz atende todas as ligações, agenda e passa para a equipe só o que precisa de gente".

### Próximo passo concreto
Proponha dois horários para a demo. Evite "posso te mandar um material?" como fim de conversa.
::::

## Roteiro de exemplo

~~~text
Você: Oi, Carla, tudo bem? Aqui é o Marcos, da Agência Exemplo. A gente
ajuda clínicas a não perder ligação de paciente. Posso tomar dois minutos?

Carla: Pode, mas estou entre atendimentos.

Você: Rapidinho, então. Em dia de agenda cheia, quantas ligações vocês
acabam não atendendo?

Carla: Muitas. A recepção não dá conta, principalmente de manhã.

Você: É exatamente isso que a gente resolve. Um assistente de voz atende,
marca a consulta e passa para a recepção só o que for urgente. Posso te
mostrar funcionando em 30 minutos? Quinta às 10h ou sexta às 15h?
~~~

## Deixe o prospect ouvir

Antes de ligar, crie um assistente com o nome da empresa do prospect seguindo [Crie uma demo para o cliente em minutos](/ajuda/sales-resources/build-customer-demo). Na ligação, ofereça: "Quer ouvir como seria o atendimento de vocês?". Ouvir o próprio nome da empresa costuma valer mais que qualquer argumento.

::mockup{kind="test-call" caption="Assistente de demonstração com o nome da empresa do prospect"}

:::tip[Caiu na caixa postal?]
Deixe uma mensagem de até 20 segundos com seu nome, o motivo em uma frase e um retorno combinado: "ligo de novo amanhã às 9h".
:::`,
  },
  {
    section: 'sales-resources',
    slug: 'qualifying-before-demo',
    title: 'Qualificando antes da demo',
    description: 'Critérios para decidir se vale a pena fazer a demo e como preparar a reunião para quem tem potencial real.',
    source: 'DEMONSTRATIVO',
    demo: true,
    related: ['sales-resources/first-phone-contact', 'sales-resources/discovery-questions', 'customers/who-buys', 'sales-resources/demo-that-closes'],
    keywords: ['qualificação', 'lead qualificado', 'fit', 'critérios', 'BANT', 'pré-venda'],
    body: `Uma demo bem feita leva tempo: preparar o assistente, conduzir a reunião, enviar a proposta. Qualificar antes evita gastar esse esforço com quem não tem o problema, o orçamento ou a decisão.

Qualificar não é interrogar. São cinco ou seis perguntas que cabem no primeiro contato ou em um e-mail curto.

## Critérios de qualificação

| Critério | Sinal verde | Sinal de atenção |
|---|---|---|
| Volume de ligações | 10 ou mais por dia, com picos | Menos de 5 por dia |
| Ligações perdidas | Fora do horário, no almoço ou em picos | Quase nenhuma |
| Tipo de atendimento | Repetitivo: agendar, informar, triar | Cada ligação é uma consultoria única |
| Sistemas | Agenda ou CRM com integração disponível | Sistema fechado, sem API nem exportação |
| Decisor | Participa da demo | Ninguém com poder de decisão na reunião |
| Orçamento | Compatível com os [Planos](/planos) | Nenhum orçamento previsto |

Três ou mais sinais verdes: faça a demo personalizada. Dois ou menos: ofereça uma demo curta e genérica, ou combine de voltar a falar em alguns meses.

## Perguntas rápidas

1. Quantas ligações vocês recebem em um dia normal? E em um dia cheio?
2. O que acontece com uma ligação que ninguém atende?
3. Quais são os três motivos mais comuns de ligação?
4. Que sistema vocês usam para agenda ou cadastro de clientes?
5. Quem, além de você, participa dessa decisão?

## Preparação da demo

- Visite o site do prospect e anote serviços, horários e perguntas frequentes.
- Monte o assistente com esses dados. Veja [Crie uma demo para o cliente em minutos](/ajuda/sales-resources/build-customer-demo).
- Confirme por escrito quem vai participar e quanto tempo vocês terão.

::mockup{kind="agent-knowledge" caption="Base de conhecimento com o site do prospect para personalizar a demo"}

:::warning[Desqualificar também é resultado]
Dizer "agora não é o momento" com clareza preserva o relacionamento e o seu tempo. Registre o motivo para retomar no futuro.
:::`,
  },
  {
    section: 'sales-resources',
    slug: 'seven-wow-moments',
    title: 'Sete momentos uau na demo',
    description: 'Sete momentos que fazem o cliente entender o valor da Kloel durante a demonstração, e como prepará-los.',
    source: 'DEMONSTRATIVO',
    demo: true,
    related: ['sales-resources/demo-that-closes', 'sales-resources/build-customer-demo', 'onboarding/test-with-partner-account', 'actions/appointments'],
    keywords: ['demo', 'momento uau', 'demonstração', 'impacto', 'apresentação ao vivo', 'efeito wow'],
    body: `Prospects esquecem slides, mas lembram do que viram acontecer. Estes sete momentos transformam uma explicação sobre assistentes de voz em uma experiência. Você não precisa usar todos em toda demo: escolha os que conversam com a dor que apareceu na qualificação.

::::steps
### O assistente atende com o nome da empresa dele
Comece ligando para o assistente configurado com o nome, os serviços e o horário do prospect. A primeira frase já é dele.

### O próprio prospect liga
Entregue o controle: peça que ele mesmo fale com o assistente e faça a pergunta que quiser. Confiança nasce aqui.

### Uma pergunta difícil, respondida
Pergunte algo que só está no site ou no PDF do cliente, como "vocês atendem convênio aos sábados?". A resposta vem da aba **Conhecimento**.

### Agendamento ao vivo
Marque um horário durante a ligação e mostre o compromisso aparecendo no [Agendador](/app/scheduling) ou na agenda conectada.

### Transferência para uma pessoa
Peça para falar com alguém da equipe e mostre a ligação sendo transferida. Isso desarma a objeção "e se o cliente quiser um humano?".

### Resumo pronto segundos depois
Abra [Conversas](/app/inbox) e mostre a transcrição e o resumo da ligação que acabou de acontecer.

### A confirmação chega no celular
Mostre a mensagem de confirmação enviada por WhatsApp ou e-mail logo após o agendamento.
::::

::mockup{kind="inbox" caption="Conversas: transcrição e resumo aparecem logo após a ligação"}

::mockup{kind="message" channel="whatsapp" text="Olá! Sua consulta na Clínica Bem Viver está confirmada para terça-feira, às 14h. Responda 1 para confirmar ou 2 para remarcar." caption="Confirmação por WhatsApp enviada logo após o agendamento"}

## Ordem recomendada

Siga a ordem acima: ela vai do mais simples (ouvir) ao mais concreto (ver o resultado no sistema e no celular). Termine sempre com o momento que responde à maior dor do prospect.

:::warning[Teste tudo antes]
Faça uma ligação de teste completa até 30 minutos antes da reunião. Tenha uma gravação de uma boa ligação como plano B caso a internet ou o áudio falhem.
:::`,
  },
  {
    section: 'sales-resources',
    slug: 'demo-that-closes',
    title: 'A demo que fecha negócio',
    description: 'Uma estrutura de 30 minutos para conduzir a demonstração e terminar a reunião com uma decisão ou um próximo passo datado.',
    source: 'DEMONSTRATIVO',
    demo: true,
    related: ['sales-resources/seven-wow-moments', 'sales-resources/objection-library', 'sales-resources/proposal-template', 'sales-resources/qualifying-before-demo'],
    keywords: ['fechamento', 'demo', 'reunião de vendas', 'apresentação', 'roteiro de demo', 'conversão'],
    body: `A diferença entre uma demo agradável e uma demo que fecha está no começo e no fim. No começo, você confirma a dor com as palavras do cliente. No fim, você pede uma decisão. O meio, a demonstração em si, é o que menos varia.

## Agenda de 30 minutos

| Minutos | Etapa | Objetivo |
|---|---|---|
| 0 a 5 | Contexto | Confirmar a dor, o volume e quem decide |
| 5 a 8 | Resumo | Repetir o que você ouviu e perguntar se faltou algo |
| 8 a 20 | Demonstração | Mostrar os [momentos uau](/ajuda/sales-resources/seven-wow-moments) ligados à dor |
| 20 a 25 | Proposta | Apresentar o pacote e o investimento |
| 25 a 30 | Próximos passos | Sair com decisão ou com data marcada |

::::tabs
:::tab[Antes]
- Envie a agenda da reunião por escrito na véspera.
- Configure o assistente com os dados do cliente e faça uma ligação de teste.
- Prepare uma proposta preliminar com o pacote mais provável.
- Confirme se o decisor estará presente.
:::
:::tab[Durante]
- Deixe o cliente falar primeiro e anote as palavras que ele usa para a dor.
- Na demonstração, peça que ele mesmo ligue para o assistente.
- Quando surgir uma objeção, trate na hora com a [biblioteca de objeções](/ajuda/sales-resources/objection-library).
- Mostre o preço sem pedir desculpas e sem descontos espontâneos.
:::
:::tab[Depois]
- Envie a proposta no mesmo dia, usando o [modelo de proposta](/ajuda/sales-resources/proposal-template).
- Mande um resumo de três linhas com o que foi combinado.
- Faça o follow-up na data acordada, não "quando der".
:::
::::

## Perguntas de fechamento

- "Pelo que vimos, faz sentido começar pelo atendimento fora do horário?"
- "O que falta para vocês decidirem até sexta?"
- "Podemos marcar o kick-off para a semana que vem?"

::mockup{kind="test-call" caption="Demonstração ao vivo: o cliente liga para o próprio assistente"}

:::tip[Comece pequeno]
Propor um primeiro passo limitado, como atender só fora do horário comercial durante 30 dias, reduz o risco percebido e acelera o sim.
:::`,
  },
  {
    section: 'sales-resources',
    slug: 'build-customer-demo',
    title: 'Crie uma demo para o cliente em minutos',
    description: 'Monte um assistente personalizado para o prospect usando o site dele e cerca de dez minutos de configuração.',
    source: 'DEMONSTRATIVO',
    demo: true,
    related: ['onboarding/test-with-partner-account', 'sales-resources/seven-wow-moments', 'get-started/write-a-great-prompt', 'get-started/knowledge-base'],
    keywords: ['demo personalizada', 'assistente de demonstração', 'configurar demo', 'protótipo', 'mockup de assistente'],
    body: `Uma demo personalizada converte muito mais do que uma genérica, e ela não precisa ser trabalhosa. Com o site do prospect aberto em outra aba, você monta um assistente convincente em cerca de dez minutos usando os minutos de demonstração da sua conta de parceiro.

O exemplo abaixo usa a Clínica Bem Viver e a assistente Roberta.

::::steps
### Crie o assistente
Em [Assistentes](/app/agents), crie um novo. Na aba **Geral**, preencha **Nome** ("Roberta"), escolha uma **Voz** e defina o **Idioma** como português do Brasil.

### Escreva a mensagem inicial
Em **Mensagens iniciais**, use algo como "Clínica Bem Viver, aqui é a Roberta, assistente virtual. Como posso ajudar?".

### Alimente o conhecimento
Na aba **Conhecimento**, adicione o site do prospect como fonte, informe o horário de funcionamento e cadastre três ou quatro perguntas e respostas frequentes.

### Gere o prompt
Use o construtor de prompt para escolher setor, nome e tom, e cole o resultado na aba **Prompt personalizado**. Dicas em [Escreva um ótimo prompt](/ajuda/get-started/write-a-great-prompt).

### Ative um recurso de impacto
Em **Recursos**, ative **Agendar compromissos** ou **Transferir ligações**, conforme a dor do prospect.

### Teste
Faça uma **Ligação de teste** e corrija o que soar estranho antes da reunião.
::::

::mockup{kind="agent-general" caption="Aba Geral com nome, voz, idioma e mensagem inicial da Roberta"}

::mockup{kind="prompt-builder" caption="Construtor de prompt: setor, nome e tom geram um prompt copiável"}

## Checklist de dez minutos

| Item | Tempo aproximado |
|---|---|
| Nome, voz, idioma e mensagem inicial | 2 min |
| Site e perguntas frequentes no Conhecimento | 3 min |
| Prompt pelo construtor | 2 min |
| Um recurso ativado | 1 min |
| Ligação de teste | 2 min |

:::tip[Reaproveite]
Mantenha um assistente-modelo por setor (clínica, imobiliária, oficina). Para cada novo prospect, copie o prompt e troque só nome, serviços e horários.
:::`,
  },
  {
    section: 'sales-resources',
    slug: 'discovery-questions',
    title: 'Catálogo de perguntas para primeiras reuniões',
    description: 'Perguntas organizadas por tema para entender a operação do prospect e escolher o que demonstrar.',
    source: 'DEMONSTRATIVO',
    demo: true,
    related: ['sales-resources/qualifying-before-demo', 'sales-resources/first-phone-contact', 'customers/questions-before-buying', 'sales-resources/demo-that-closes'],
    keywords: ['discovery', 'perguntas', 'diagnóstico', 'levantamento', 'primeira reunião', 'entrevista'],
    body: `Boas perguntas fazem o prospect chegar sozinho à conclusão de que precisa resolver o problema. Escolha de oito a dez perguntas deste catálogo para cada reunião; as marcadas com (essencial) valem para quase todos os casos.

::::tabs
:::tab[Atendimento]
- (essencial) Quantas ligações vocês recebem por dia? E no dia mais cheio da semana?
- (essencial) Quem atende hoje e o que essa pessoa faz entre uma ligação e outra?
- O que acontece com ligações no almoço, à noite e no fim de semana?
- Quais são as cinco perguntas que mais aparecem ao telefone?
- Vocês também recebem pedidos por WhatsApp ou pelo site?
:::
:::tab[Dores]
- (essencial) O que acontece quando uma ligação não é atendida?
- Vocês já perderam um cliente por demora no atendimento? Como souberam?
- Quanto tempo da equipe vai para tarefas repetitivas, como confirmar horários?
- Existe reclamação recorrente sobre o atendimento telefônico?
:::
:::tab[Sistemas]
- (essencial) Onde fica a agenda ou o cadastro de clientes?
- Esse sistema permite integração ou exportação de dados?
- Vocês usam alguma central telefônica ou só celulares?
- Quem cuida de tecnologia por aqui?
:::
:::tab[Decisão]
- (essencial) Quem mais participa da decisão?
- Como vocês costumam contratar ferramentas novas: teste, piloto, contrato direto?
- Existe um orçamento ou uma data limite para resolver isso?
- O que faria vocês dizerem não, mesmo gostando da solução?
:::
::::

## Da resposta para a demo

| Se o prospect disser… | Demonstre |
|---|---|
| "Perdemos muita ligação no almoço" | Atendimento fora do horário com desvio de chamadas |
| "A recepção passa o dia marcando horário" | **Agendar compromissos** ao vivo |
| "Muita gente pergunta preço e endereço" | Respostas vindas da aba **Conhecimento** |
| "Às vezes precisa falar com o dono" | **Transferir ligações** |
| "Ninguém anota direito o que o cliente pediu" | Resumo e transcrição em [Conversas](/app/inbox) |

::mockup{kind="overview" caption="Visão geral com volume de chamadas: útil para discutir números com o prospect"}

:::tip[Anote as palavras do cliente]
Use as expressões exatas do prospect na proposta. "Recepção sobrecarregada às segundas" convence mais que "otimização do atendimento".
:::`,
  },
  {
    section: 'sales-resources',
    slug: 'objection-library',
    title: 'Biblioteca de objeções: 10 objeções comuns',
    description: 'As dez objeções que mais aparecem na venda da Kloel, com uma forma de responder e o que mostrar em cada caso.',
    source: 'DEMONSTRATIVO',
    demo: true,
    related: ['sales-resources/demo-that-closes', 'customers/questions-before-buying', 'partner-legal/dpa-lgpd', 'sales-resources/seven-wow-moments'],
    keywords: ['objeções', 'contorno de objeções', 'resposta a objeção', 'está caro', 'robô', 'resistência'],
    body: `Objeção não é recusa: quase sempre é um pedido de mais segurança. As respostas abaixo são pontos de partida. Adapte ao seu jeito de falar e, sempre que possível, troque argumento por demonstração.

## Método em quatro tempos

1. **Escute** até o fim, sem interromper.
2. **Valide** a preocupação: "faz todo sentido se preocupar com isso".
3. **Pergunte** para entender o que está por trás: "o que te preocupa exatamente?".
4. **Mostre** em vez de explicar, sempre que der.

::mockup{kind="agent-rules" caption="Aba Regras: limites claros respondem à objeção 'e se a IA errar?'"}

## As dez objeções

:::faq[1. "Meus clientes não querem falar com robô."]
Concorde que ninguém gosta de menus do tipo "digite 1". Explique que o assistente conversa em linguagem natural e que a alternativa real, muitas vezes, é a ligação não ser atendida. Mostre: peça que o prospect ligue para o assistente e avalie por conta própria.
:::

:::faq[2. "É caro."]
Pergunte "caro em comparação com o quê?". Compare com o custo de uma pessoa a mais na recepção ou com o valor de um cliente perdido por mês. Mostre a tabela de [Planos](/planos) e proponha começar pelo plano menor.
:::

:::faq[3. "Já tenho uma recepcionista."]
A Kloel não substitui a recepção: ela atende quando a recepção está ocupada, no almoço e fora do horário, e passa para a equipe o que precisa de gente. Mostre a transferência de ligação.
:::

:::faq[4. "E se a IA errar ou inventar uma resposta?"]
Mostre a aba **Regras** e a aba **Conhecimento**: o assistente responde com base no que foi cadastrado e pode ser instruído a transferir ou anotar o recado quando não souber. Ofereça um período de ajustes acompanhado.
:::

:::faq[5. "E a LGPD? Vocês gravam as ligações?"]
A gravação é configurável na aba **Técnico**, e a mensagem inicial pode avisar quem liga. Explique os papéis de cada parte com base em [DPA e LGPD](/ajuda/partner-legal/dpa-lgpd), sem dar parecer jurídico.
:::

:::faq[6. "Não tenho tempo para implantar."]
Na revenda ou com um pacote de configuração, quem implanta é você. Mostre o plano dos [primeiros 30 dias](/ajuda/customers/first-30-days) e quantas horas o cliente realmente precisa dedicar.
:::

:::faq[7. "Meu sistema não integra."]
Verifique na hora em [Integrações: o que funciona, o que está por vir](/ajuda/setup/integrations-status). Se não houver integração nativa, ainda há agendamento próprio, envio de resumo por e-mail ou webhook para o sistema do cliente.
:::

:::faq[8. "Vou perder o atendimento humanizado."]
Pergunte como é o atendimento hoje em um dia cheio. Um assistente com tom acolhedor, que resolve rápido e transfere quando necessário, costuma ser mais humano do que uma ligação que toca sem resposta.
:::

:::faq[9. "Já testei outro bot e não funcionou."]
Pergunte o que deu errado. Normalmente foi falta de conhecimento cadastrado ou de ajustes depois do go-live. Mostre como você revisa as conversas semanalmente.
:::

:::faq[10. "Preciso pensar" ou "preciso falar com meu sócio".]
Pergunte o que exatamente precisa ser pensado e ofereça uma segunda reunião curta com o sócio, já com data. Envie a proposta no mesmo dia.
:::

:::tip[Registre as objeções]
Anote quais objeções aparecem em cada venda. Depois de dez reuniões, você saberá quais tratar antes mesmo de surgirem.
:::`,
  },
  {
    section: 'sales-resources',
    slug: 'presentations',
    title: 'Apresentações',
    description: 'Quais apresentações usar em cada etapa da venda e como adaptá-las à sua marca e ao cliente.',
    source: 'DEMONSTRATIVO',
    demo: true,
    related: ['marketing-resources/marketing-material', 'sales-resources/demo-that-closes', 'partner-program/white-label', 'onboarding/where-to-find-resources'],
    keywords: ['apresentação', 'slides', 'deck', 'pitch', 'material de venda', 'powerpoint'],
    body: `Apresentação boa é curta e serve para apoiar a conversa, não para substituir a demo. Use slides para dar contexto e para fechar com proposta; o meio da reunião é o produto funcionando.

## Apresentações disponíveis

| Apresentação | Quando usar | Duração |
|---|---|---|
| Visão geral da Kloel | Primeira reunião com qualquer prospect | 8 a 10 slides |
| Versões por setor | Saúde, imobiliário, serviços técnicos, hotelaria | 10 a 12 slides |
| Técnica | Reunião com TI: integrações, webhooks, telefonia | 12 a 15 slides |
| Executiva | Decisor com pouco tempo | 5 slides |
| Kick-off do cliente | Primeira reunião após a assinatura | 8 slides |

## Estrutura recomendada

1. O problema, com as palavras do cliente.
2. O que acontece hoje com uma ligação não atendida.
3. Como a Kloel atende, agenda e transfere.
4. Demonstração ao vivo (fora dos slides).
5. Integrações relevantes para aquele cliente.
6. Plano de implantação em 30 dias.
7. Investimento e próximos passos.

::mockup{kind="partner-portal" caption="Biblioteca de materiais na área do parceiro"}

## Como adaptar

- **Sua marca primeiro:** use seu logotipo na capa e o selo "powered by kloel.ai" conforme [White label e co-branding](/ajuda/partner-program/white-label).
- **Números do cliente:** use dados que o próprio prospect informou. Se usar estimativas, escreva "(estimativa)".
- **Nada de resultados inventados:** não cite clientes, percentuais de ganho ou certificações que você não pode comprovar.
- **Capturas reais:** prefira telas do app com o assistente de demonstração que você montou.

:::tip[Precisa de ajuda?]
Quer que o time de parcerias revise sua apresentação adaptada? Use o botão **Suporte** no topo desta central.
:::`,
  },
  {
    section: 'sales-resources',
    slug: 'pricing-setups',
    title: 'Configurações de preço e pacotes de manutenção',
    description: 'Como combinar plano Kloel, taxa de implantação e manutenção mensal em pacotes fáceis de entender e de vender.',
    source: 'DEMONSTRATIVO',
    demo: true,
    related: ['pricing-billing/setup-and-care-packages', 'sales-resources/proposal-template', 'partner-program/refer-or-resell', 'sales-resources/upsell-playbook'],
    keywords: ['precificação', 'pacotes', 'setup', 'manutenção', 'mensalidade', 'margem', 'preço de revenda'],
    body: `Clientes compram pacotes, não peças. Em vez de apresentar plano, minutos, horas de configuração e suporte separadamente, agrupe tudo em duas ou três opções com nomes claros.

Na **revenda**, você define o preço final de tudo. Na **indicação**, o cliente paga o plano direto à Kloel pela tabela pública, e você cobra à parte apenas pelos seus serviços.

## Os três componentes

| Componente | O que inclui | Cobrança |
|---|---|---|
| Plano Kloel | Minutos, números, ligações simultâneas e usuários, conforme [Planos](/planos) | Mensal ou anual |
| Implantação (setup) | Configuração, prompt, base de conhecimento, integrações e testes | Única |
| Manutenção | Revisão de conversas, ajustes, relatório mensal e suporte | Mensal |

## Pacotes de exemplo

Os valores abaixo são apenas ilustrativos, para mostrar a lógica. Defina os seus de acordo com seus custos e seu mercado.

| Pacote | Para quem | Implantação | Manutenção |
|---|---|---|---|
| Essencial | Um assistente, agendamento, uma unidade | R$ 1.500 | R$ 300/mês |
| Profissional | Integração com CRM, WhatsApp, transferências | R$ 4.000 | R$ 800/mês |
| Completo | Várias unidades, campanhas outbound, relatórios | R$ 9.000 | R$ 1.800/mês |

::mockup{kind="partner-portal" caption="Área do parceiro com o pacote contratado por cliente"}

## Boas práticas

- **Sempre cobre implantação.** Ela paga o seu trabalho inicial e mostra ao cliente que existe um projeto, não só uma assinatura.
- **Ofereça contrato anual** com condição melhor; os planos da Kloel também têm preço anual menor.
- **Deixe claro o excedente:** o que acontece se o cliente passar dos minutos do plano.
- **Use três opções:** a maioria escolhe a do meio.

:::warning[Indicação e tabela pública]
Ao indicar, não prometa descontos sobre os [Planos](/planos) que a Kloel não oferece. Se quiser controlar o preço final, use a revenda.
:::

:::tip[Precisa de ajuda?]
Use o botão **Suporte** no topo desta central para validar um pacote antes de enviá-lo.
:::`,
  },
  {
    section: 'sales-resources',
    slug: 'proposal-template',
    title: 'Modelo de proposta',
    description: 'Um texto base em Markdown para montar propostas comerciais claras, com espaço para escopo, prazos e investimento.',
    source: 'DEMONSTRATIVO',
    demo: true,
    related: ['sales-resources/pricing-setups', 'sales-resources/demo-that-closes', 'customers/first-30-days', 'partner-legal/templates-and-documents'],
    keywords: ['proposta comercial', 'orçamento', 'template', 'modelo', 'documento de proposta', 'escopo'],
    body: `Uma boa proposta repete o que o cliente disse na demo, mostra o que será entregue e deixa o próximo passo óbvio. O modelo abaixo segue essa lógica. Copie, troque os campos entre chaves duplas e remova o que não se aplica.

Envie a proposta no mesmo dia da demo, enquanto a conversa ainda está fresca.

## Como usar

- Substitua cada \`{{campo}}\` pelo dado real do cliente.
- Use as palavras do cliente na seção "O que ouvimos".
- Mantenha o investimento em uma tabela simples, com três opções no máximo.
- Converta para PDF com a sua marca antes de enviar.

## Modelo

~~~markdown
# Proposta: atendimento telefônico com IA para {{nomeDoCliente}}

Preparada por {{suaEmpresa}} em {{data}} · válida por 15 dias

## O que ouvimos
- {{dor1}} (ex.: ligações perdidas no horário de almoço)
- {{dor2}} (ex.: recepção ocupada com confirmações de horário)
- Volume informado: {{ligacoesPorDia}} ligações por dia

## O que vamos entregar
- Assistente de voz "{{nomeDoAssistente}}" atendendo em português
- Base de conhecimento com serviços, preços e horários
- Agendamento automático em {{sistemaDeAgenda}}
- Transferência para {{setorOuPessoa}} quando necessário
- Resumo de cada ligação enviado para {{emailDoCliente}}

## Como vamos implantar
1. Kick-off e coleta de informações (semana 1)
2. Configuração e testes internos (semana 2)
3. Go-live parcial: fora do horário comercial (semana 3)
4. Ajustes e revisão de 30 dias (semana 4)

## Investimento
| Opção | Implantação | Mensal |
|---|---|---|
| {{opcao1}} | R$ {{setup1}} | R$ {{mensal1}} |
| {{opcao2}} | R$ {{setup2}} | R$ {{mensal2}} |

Valores em reais. Plano Kloel incluído conforme a opção escolhida.

## Próximos passos
1. Aprovação desta proposta até {{dataLimite}}
2. Assinatura do contrato e do acordo de tratamento de dados
3. Agendamento do kick-off

Contato: {{seuNome}} · {{seuTelefone}} · {{seuEmail}}
~~~

::mockup{kind="message" channel="email" text="Olá, Carla! Segue a proposta da Agência Exemplo para o atendimento com IA da Clínica Bem Viver, conforme conversamos hoje." caption="E-mail de envio da proposta no mesmo dia da demo"}

## Checklist antes de enviar

- Os valores batem com o pacote apresentado na demo?
- O prazo de validade está preenchido?
- O nome do assistente e do sistema de agenda estão corretos?
- Na revenda, o acordo de tratamento de dados está mencionado? Veja [Jurídico: modelos e documentos](/ajuda/partner-legal/templates-and-documents).

:::tip[Precisa de ajuda?]
Use o botão **Suporte** no topo desta central se quiser uma revisão da proposta.
:::`,
  },
  {
    section: 'sales-resources',
    slug: 'upsell-playbook',
    title: 'Manual de upsell',
    description: 'Quando e como ampliar a conta de um cliente satisfeito, com sinais claros e ofertas que fazem sentido.',
    source: 'DEMONSTRATIVO',
    demo: true,
    related: ['customers/why-customers-stay-or-leave', 'sales-resources/pricing-setups', 'onboarding/supporting-customers', 'partner-program/release-updates'],
    keywords: ['upsell', 'cross-sell', 'expansão', 'upgrade de plano', 'crescimento de conta', 'venda adicional'],
    body: `O melhor momento para vender mais é quando o cliente já viu o valor. Upsell bom não é empurrar plano maior: é responder a um sinal que o próprio uso mostra. Por isso, ele nasce da rotina de suporte, não de uma campanha.

## Sinais e ofertas

| Sinal | Oferta | Onde verificar |
|---|---|---|
| Minutos acabando antes do fim do mês | Plano maior, por exemplo de Solo para Team | [Faturamento](/app/billing) |
| Ligações chegando ao mesmo tempo | Plano com ligações simultâneas | [Visão geral](/app) |
| Clientes pedindo atendimento por WhatsApp | IA de WhatsApp | [WhatsApp](/app/whatsapp) |
| Muitas perguntas repetidas no site | Webchat de IA | [Planos](/planos) |
| Lista de contatos parada | [Campanhas outbound](/app/campaigns), a partir do plano Team | [Contatos](/app/contacts) |
| Equipe digitando dados das ligações no CRM | Integração com o CRM | [Integrações](/app/integrations) |
| Nova unidade ou nova linha de serviço | Novo assistente e número adicional | [Números de telefone](/app/phone-numbers) |

::mockup{kind="overview" caption="Visão geral: volume de ligações e minutos consumidos indicam a hora do upgrade"}

## Revisão trimestral

::::steps
### Prepare os números
Ligações atendidas, agendamentos feitos, transferências e minutos consumidos nos últimos três meses.

### Mostre o resultado
Comece pelo que funcionou. Use os números do próprio cliente, sem extrapolar.

### Traga um sinal
Escolha um ou dois sinais da tabela e pergunte se aquilo também é uma dor.

### Proponha um piloto
Ofereça a expansão por um período curto, com critério de sucesso combinado.
::::

:::tip[Espere o valor aparecer]
Evite propor expansão antes de 30 dias de uso estável. Primeiro o cliente precisa confiar no que já contratou.
:::

:::warning[Não venda o que não existe]
Antes de oferecer uma integração ou um canal novo, confira o status em [Integrações: o que funciona, o que está por vir](/ajuda/setup/integrations-status).
:::`,
  },
  {
    section: 'sales-resources',
    slug: 'sell-with-phone-system',
    title: 'Vender a Kloel junto com seu sistema telefônico',
    description: 'Como oferecer a Kloel em conjunto com o PABX, os troncos SIP ou os números que você já fornece aos seus clientes.',
    source: 'DEMONSTRATIVO',
    demo: true,
    related: ['phone-systems/sip-numbers', 'get-started/connect-your-number', 'phone-numbers/pbx', 'actions/call-transfer'],
    keywords: ['PABX', 'telefonia', 'SIP', 'tronco', 'integrador de telefonia', 'central telefônica', 'VoIP'],
    body: `Se você já vende telefonia, PABX ou números virtuais, a Kloel é uma extensão natural do seu portfólio: o assistente vira o atendente digital da central que você já administra. O cliente mantém o número e a estrutura que conhece, e você ganha uma receita recorrente a mais.

## Formas de conectar

| Cenário | Como funciona | Leia |
|---|---|---|
| Desvio de chamadas | O número atual desvia para o número Kloel quando está ocupado, não atende ou fora do horário | [Conecte seu número](/ajuda/get-started/connect-your-number) |
| Tronco SIP | O assistente recebe ligações pelo tronco do seu sistema | [Números SIP](/ajuda/phone-systems/sip-numbers) |
| Importar número | O número do cliente passa a ser gerenciado na Kloel | [Importar número](/ajuda/phone-numbers/import-number) |
| Central no navegador | Ramais e discador dentro da Kloel | [PABX](/ajuda/phone-numbers/pbx) |

::mockup{kind="call-forwarding" caption="Desvio de chamadas: códigos de operadora para ocupado, sem resposta e sempre"}

## Pacote combinado

- **Atendente digital na entrada:** o assistente atende primeiro e transfere para os ramais certos. Veja [Transferência de chamadas](/ajuda/actions/call-transfer).
- **Atendimento fora do horário:** o desvio entra só à noite e nos fins de semana. É o jeito mais fácil de começar.
- **Uma única fatura:** na revenda, telefonia e Kloel vão na mesma nota.

## Argumentos para o seu cliente

- Nenhuma troca de número nem de aparelho.
- Implantação gradual: começa no fora do horário e cresce.
- Quem já confia em você para a telefonia não precisa avaliar um fornecedor novo.

::mockup{kind="pbx" caption="Central telefônica no navegador com ramais e discador"}

:::tip[Precisa de ajuda?]
Para validar a compatibilidade do seu sistema telefônico, use o botão **Suporte** no topo desta central.
:::`,
  },

  // ─── Clientes ──────────────────────────────────────────────────────────────────────────────────
  {
    section: 'customers',
    slug: 'who-buys',
    title: 'Quem compra a Kloel e por quê',
    description: 'Os perfis de empresa que mais se beneficiam da Kloel, quem decide a compra e quando o produto não é a melhor escolha.',
    source: 'DEMONSTRATIVO',
    demo: true,
    related: ['customers/use-cases-by-industry', 'sales-resources/qualifying-before-demo', 'customers/questions-before-buying', 'customers/why-customers-stay-or-leave'],
    keywords: ['perfil de cliente', 'ICP', 'público-alvo', 'quem compra', 'segmentos', 'persona'],
    body: `A Kloel faz mais diferença em empresas que recebem muitas ligações parecidas entre si e que perdem dinheiro quando o telefone toca sem resposta. Em geral, são pequenas e médias empresas de serviço, em que a mesma pessoa atende o telefone, o balcão e o WhatsApp.

## Perfis que mais compram

| Perfil | Dor principal | O que costumam usar |
|---|---|---|
| Clínicas e consultórios | Recepção sobrecarregada, pacientes que desistem de ligar | Agendamento, confirmação, triagem de urgência |
| Imobiliárias | Contatos sobre imóveis chegando fora do horário | Qualificação do interessado e agendamento de visita |
| Serviços técnicos e oficinas | Equipe em campo sem poder atender | Registro do chamado, orçamento e retorno |
| Restaurantes e hotelaria | Pico de ligações para reservas | Reservas, cardápio, horários |
| Comércio e e-commerce | Perguntas sobre pedido e entrega | Status de pedido via integração |
| Escritórios de contabilidade e advocacia | Interrupções constantes da equipe | Triagem e recado estruturado |

## Quem decide

- **Dono ou sócio:** decide em empresas menores; quer ver resultado e preço.
- **Gerente de operação ou de atendimento:** sente a dor no dia a dia; é seu maior aliado.
- **TI ou fornecedor de sistemas:** entra quando há integração; quer saber de segurança e dados.

::mockup{kind="overview" caption="Visão geral: indicadores de ligações que interessam ao dono e ao gerente"}

## Por que compram

1. Para não perder clientes por ligação não atendida.
2. Para atender fora do horário sem pagar plantão.
3. Para liberar a equipe de tarefas repetitivas.
4. Para padronizar o atendimento, inclusive em várias unidades.

:::warning[Quando não é o melhor encaixe]
Empresas com pouquíssimas ligações, atendimento que exige julgamento profissional em toda chamada ou nenhum processo minimamente repetitivo tendem a ver pouco valor. Seja honesto: isso preserva sua reputação.
:::`,
  },
  {
    section: 'customers',
    slug: 'use-cases-by-industry',
    title: 'Casos de uso por setor',
    description: 'Cenários práticos por setor, com os recursos e integrações que costumam fazer sentido em cada um.',
    source: 'DEMONSTRATIVO',
    demo: true,
    related: ['customers/who-buys', 'sales-resources/build-customer-demo', 'setup/integrations-status', 'actions/appointments'],
    keywords: ['casos de uso', 'setores', 'verticais', 'exemplos', 'clínica', 'imobiliária', 'restaurante'],
    body: `Cada setor usa a Kloel de um jeito. Use as abas abaixo para preparar a demo e a proposta de acordo com o tipo de cliente. Os cenários são exemplos; adapte à realidade de cada empresa.

::mockup{kind="agent-resources" highlight="scheduling" caption="Recursos do assistente com Agendar compromissos em destaque"}

::::tabs
:::tab[Saúde]
**Cenário:** a Clínica Bem Viver recebe ligações para marcar, confirmar e remarcar consultas, além de dúvidas sobre convênios.

- **Recursos:** Agendar compromissos, Transferir ligações para a recepção em urgências, Enviar WhatsApp com a confirmação.
- **Conhecimento:** especialidades, convênios aceitos, preparo para exames, endereço.
- **Cuidado:** o assistente não deve dar orientação médica. Defina isso na aba **Regras** e veja [Hospedagem, retenção de dados, dados de saúde](/ajuda/partner-legal/hosting-retention-health-data).
:::
:::tab[Imobiliário]
**Cenário:** interessados ligam à noite sobre anúncios de imóveis.

- **Recursos:** qualificação (bairro, faixa de preço, financiamento), Agendar compromissos para visitas, Enviar e-mail com o resumo ao corretor.
- **Integrações:** CRM imobiliário ou planilha via automação.
- **Dica:** peça o código do anúncio logo no início da ligação.
:::
:::tab[Serviços técnicos]
**Cenário:** técnicos em campo não conseguem atender pedidos de orçamento e chamados.

- **Recursos:** registro do problema, endereço e urgência; Transferir ligações para o plantão em emergências.
- **Integrações:** envio do chamado por webhook ou para uma planilha.
- **Dica:** use variáveis personalizadas para capturar tipo de serviço e endereço.
:::
:::tab[Hotelaria e restaurantes]
**Cenário:** pico de ligações para reservas nos fins de semana.

- **Recursos:** reservas, informações de cardápio e horário, Enviar WhatsApp com a confirmação.
- **Integrações:** sistemas de reserva com integração disponível.
- **Dica:** configure respostas diferentes dentro e fora do horário de funcionamento.
:::
:::tab[Comércio]
**Cenário:** clientes ligam para saber onde está o pedido.

- **Recursos:** consulta de status por requisição HTTP durante a conversa, Pesquisa na web para políticas da loja.
- **Integrações:** plataforma de e-commerce, quando disponível, ou API própria.
- **Dica:** peça o número do pedido e confirme repetindo em voz alta.
:::
:::tab[Escritórios]
**Cenário:** contadores e advogados interrompidos o dia todo por ligações.

- **Recursos:** triagem por assunto, recado estruturado enviado por e-mail, Transferir ligações só para casos combinados.
- **Integrações:** e-mail e mensageria interna, como o Slack.
- **Dica:** deixe claro na mensagem inicial que se trata de um assistente virtual.
:::
::::

:::tip[Precisa de ajuda?]
Tem um setor que não está aqui? Use o botão **Suporte** no topo desta central para trocar ideias com o time de parcerias.
:::`,
  },
  {
    section: 'customers',
    slug: 'questions-before-buying',
    title: 'O que os clientes perguntam antes de comprar',
    description: 'As perguntas mais comuns de quem está avaliando a Kloel, com respostas curtas e onde aprofundar cada uma.',
    source: 'DEMONSTRATIVO',
    demo: true,
    related: ['sales-resources/objection-library', 'customers/who-buys', 'partner-legal/dpa-lgpd', 'setup/integrations-status'],
    keywords: ['perguntas frequentes', 'dúvidas de clientes', 'FAQ comercial', 'antes de comprar', 'avaliação'],
    body: `Quem está avaliando a Kloel costuma fazer as mesmas perguntas, quase sempre nesta ordem: primeiro sobre a experiência de quem liga, depois sobre implantação, por fim sobre dados e contrato. Ter respostas curtas e um link para aprofundar passa segurança.

## Respostas rápidas

| Pergunta | Resposta curta | Aprofunde em |
|---|---|---|
| Preciso trocar meu número? | Não. Dá para desviar as ligações do número atual. | [Conecte seu número](/ajuda/get-started/connect-your-number) |
| A voz parece robótica? | As vozes são naturais e escolhidas por você. Ouça na demo. | [Primeiros passos](/ajuda/get-started/first-steps) |
| Ele entende sotaques e interrupções? | Sim, e há ajustes de ruído e pausas na aba **Técnico**. | [Configurações técnicas](/ajuda/get-started/technical) |
| Atende em outros idiomas? | Sim, o idioma é configurável por assistente. | [Idiomas](/ajuda/get-started/languages) |
| Integra com minha agenda? | Google Calendar, Outlook e Calendly estão entre as opções. | [Agendamentos](/ajuda/actions/appointments) |
| E se ele não souber responder? | Ele pode transferir, anotar recado ou enviar um resumo. | [Transferência de chamadas](/ajuda/actions/call-transfer) |
| Quanto custa? | Depende do volume; veja a tabela pública. | [Planos](/planos) |
| Os dados ficam seguros? | Há acordo de tratamento de dados e controles de gravação. | [Proteção de dados](/ajuda/legal/protecao-de-dados) |
| Tem fidelidade? | Há planos mensais e anuais. | [Reembolsos e cancelamentos](/ajuda/pricing-billing/refunds-and-cancellations) |

::mockup{kind="agent-technical" caption="Aba Técnico: duração máxima, gravação, ruído e pausas"}

## Perguntas que pedem conversa

:::faq[Quanto tempo leva para colocar no ar?]
Um assistente simples fica pronto em poucos dias; com integrações, o normal é seguir o plano dos [primeiros 30 dias](/ajuda/customers/first-30-days). Evite prometer prazos antes de conhecer os sistemas do cliente.
:::

:::faq[Vou conseguir ver o que o assistente falou?]
Sim. Toda conversa fica em [Conversas](/app/inbox) com transcrição e resumo, conforme as configurações de gravação e retenção.
:::

:::faq[Posso testar antes?]
Sim. Mostre a ligação de teste na demo ou ofereça um piloto limitado, por exemplo atendendo só fora do horário.
:::

:::tip[Precisa de ajuda?]
Recebeu uma pergunta que não está aqui? Use o botão **Suporte** no topo desta central.
:::`,
  },
  {
    section: 'customers',
    slug: 'first-30-days',
    title: 'Os primeiros 30 dias após a compra',
    description: 'Um plano de implantação em etapas, do kick-off à revisão de 30 dias, para o cliente chegar ao go-live com segurança.',
    source: 'DEMONSTRATIVO',
    demo: true,
    related: ['setup/common-support-issues', 'onboarding/supporting-customers', 'customers/why-customers-stay-or-leave', 'get-started/connect-your-number'],
    keywords: ['implantação', 'onboarding do cliente', 'go-live', 'kick-off', 'primeiro mês', 'plano de implantação'],
    body: `Os primeiros 30 dias decidem se o cliente vai renovar. A regra é simples: começar pequeno, medir, ajustar e só então ampliar. Um go-live gradual reduz o risco e dá ao cliente tempo para confiar no assistente.

::::steps
### Dia 0: kick-off
Reunião de uma hora com quem conhece o atendimento. Levante os motivos de ligação, horários, regras de transferência, sistemas usados e quem aprova o resultado.

### Dias 1 a 3: configuração
Crie o assistente, preencha **Conhecimento** e **Regras**, escreva o prompt e conecte agenda ou integrações. Convide o cliente como usuário para acompanhar.

### Dias 4 a 7: testes internos
Faça ligações de teste com a equipe do cliente, cobrindo os dez motivos de ligação mais comuns. Ajuste o que ficou estranho.

:::tip[Roteiro de teste]
Peça que pessoas da equipe liguem fingindo ser clientes difíceis: apressados, confusos, que interrompem. São esses casos que aparecem no go-live.
:::

### Dias 8 a 10: go-live parcial
Ative o desvio de chamadas só fora do horário comercial ou só quando a linha estiver ocupada. Veja [Conecte seu número](/ajuda/get-started/connect-your-number).

### Dias 11 a 20: ajustes
Leia as conversas diariamente na primeira semana e depois a cada dois dias. Corrija respostas e regras.

### Dias 21 a 30: ampliação e revisão
Se os indicadores estiverem bons, amplie o horário de atendimento. No dia 30, apresente os resultados ao cliente e combine a rotina de manutenção.
::::

::mockup{kind="call-forwarding" caption="Desvio de chamadas usado no go-live parcial"}

## O que medir

| Indicador | Onde ver | Sinal de alerta |
|---|---|---|
| Ligações atendidas | [Visão geral](/app) | Muito abaixo do esperado: verifique o desvio |
| Ligações transferidas | [Conversas](/app/inbox) | Muitas transferências: falta conhecimento |
| Agendamentos criados | [Agendador](/app/scheduling) | Zero: confira a conexão da agenda |
| Ligações curtas, abaixo de 15 segundos | [Conversas](/app/inbox) | Quem liga desliga: revise a mensagem inicial |

:::tip[Precisa de ajuda?]
Use o botão **Suporte** no topo desta central durante a implantação.
:::`,
  },
  {
    section: 'customers',
    slug: 'why-customers-stay-or-leave',
    title: 'Por que clientes ficam ou saem',
    description: 'Os motivos mais comuns de renovação e de cancelamento, os sinais de risco e o que fazer em cada caso.',
    source: 'DEMONSTRATIVO',
    demo: true,
    related: ['sales-resources/upsell-playbook', 'customers/first-30-days', 'onboarding/supporting-customers', 'pricing-billing/refunds-and-cancellations'],
    keywords: ['retenção', 'churn', 'cancelamento', 'renovação', 'satisfação', 'risco de perda'],
    body: `Clientes raramente cancelam por causa da tecnologia em si. Eles saem quando deixam de enxergar o valor ou quando um problema pequeno fica sem dono. E ficam quando o assistente vira parte invisível da rotina.

## Por que ficam e por que saem

| Ficam porque… | Saem porque… |
|---|---|
| Perceberam que não perdem mais ligações | Nunca viram um número que mostrasse o resultado |
| O assistente foi ajustado nas primeiras semanas | O assistente foi configurado e esquecido |
| Alguém revisa as conversas com regularidade | Um erro repetido não foi corrigido |
| A integração tirou trabalho manual da equipe | A equipe continuou fazendo tudo à mão |
| Sabem a quem recorrer quando algo muda | Não sabiam quem chamar e desistiram |

## Sinais de risco e o que fazer

| Sinal | Ação |
|---|---|
| Queda forte no volume de ligações | Verifique se o desvio de chamadas foi desativado |
| Muitas ligações curtas | Revise a mensagem inicial e a voz |
| Cliente parou de responder relatórios | Marque uma conversa curta para entender a percepção |
| Reclamação sobre uma resposta específica | Corrija em até um dia útil e avise o cliente |
| Troca do responsável no cliente | Faça um novo kick-off curto com a pessoa nova |

::mockup{kind="overview" caption="Visão geral: queda de volume é um dos primeiros sinais de risco"}

## Hábitos que retêm

- Um relatório mensal simples: ligações atendidas, agendamentos e principais motivos.
- Uma revisão trimestral com uma melhoria proposta. Veja [Manual de upsell](/ajuda/sales-resources/upsell-playbook).
- Comunicar ao cliente cada ajuste que você fez, mesmo os pequenos.

:::info[Cancelamento a caminho?]
Antes de aceitar o cancelamento, pergunte o motivo e ofereça uma correção concreta. Se a decisão se mantiver, siga [Reembolsos e cancelamentos](/ajuda/pricing-billing/refunds-and-cancellations).
:::`,
  },

  // ─── Jurídico do parceiro ──────────────────────────────────────────────────────────────────────
  {
    section: 'partner-legal',
    slug: 'dpa-lgpd',
    title: 'DPA e LGPD: indicação ou revenda',
    description: 'Quem é controlador, quem é operador e qual acordo de tratamento de dados se aplica em cada modelo de parceria.',
    source: 'DEMONSTRATIVO',
    demo: true,
    related: ['partner-legal/templates-and-documents', 'partner-legal/hosting-retention-health-data', 'partner-program/refer-or-resell', 'legal/protecao-de-dados'],
    keywords: ['LGPD', 'DPA', 'acordo de tratamento de dados', 'controlador', 'operador', 'suboperador', 'privacidade'],
    body: `Toda ligação atendida por um assistente envolve dados pessoais: o número de quem liga, a voz, o que a pessoa diz. Pela LGPD, é importante deixar claro quem decide sobre esses dados e quem apenas os trata em nome de outro. Os papéis mudam conforme o modelo de parceria.

:::warning[Não é aconselhamento jurídico]
Este artigo é informativo e simplificado. Para decidir sobre contratos e bases legais, consulte a assessoria jurídica ou o encarregado de dados da sua empresa e do cliente.
:::

## Papéis em cada modelo

| | Indicação | Revenda |
|---|---|---|
| Contrato de serviço | Cliente com a Kloel | Cliente com você; você com a Kloel |
| Controlador | O cliente | O cliente |
| Operador | A Kloel | Você |
| Suboperador | — | A Kloel, contratada por você |
| Acordo de tratamento de dados (DPA) | Entre cliente e Kloel, conforme [Proteção de dados](/ajuda/legal/protecao-de-dados) | Você firma com o cliente; a Kloel firma com você |

## Na revenda, o que fica com você

::::steps
### Firme um DPA com cada cliente
Use como base o modelo indicado em [Jurídico: modelos e documentos](/ajuda/partner-legal/templates-and-documents), revisado pela sua assessoria.

### Informe a Kloel como suboperadora
O cliente precisa saber que a plataforma usada é a Kloel e para que fins os dados são tratados.

### Repasse pedidos de titulares
Se alguém pedir acesso ou exclusão dos próprios dados, encaminhe ao cliente (controlador) e ajude a executar o pedido na conta.

### Comunique incidentes sem demora
Se souber de um incidente, avise o cliente imediatamente, conforme o combinado no DPA.
::::

## Pontos de atenção nas ligações

- **Aviso ao interlocutor:** use as **Mensagens iniciais** para informar que é um assistente virtual e, se houver gravação, que a ligação é gravada.
- **Minimização:** colete só o necessário para o atendimento.
- **Dados sensíveis:** em saúde, veja [Hospedagem, retenção de dados, dados de saúde](/ajuda/partner-legal/hosting-retention-health-data).

::mockup{kind="agent-general" caption="Mensagens iniciais com aviso de assistente virtual e de gravação"}`,
  },
  {
    section: 'partner-legal',
    slug: 'templates-and-documents',
    title: 'Jurídico: modelos e documentos',
    description: 'Os documentos que entram em uma parceria com a Kloel, para que serve cada um e onde encontrá-los.',
    source: 'DEMONSTRATIVO',
    demo: true,
    related: ['partner-legal/dpa-lgpd', 'partner-legal/hosting-retention-health-data', 'sales-resources/proposal-template', 'legal/termos-e-condicoes'],
    keywords: ['contratos', 'modelos jurídicos', 'documentos', 'termos', 'DPA', 'aviso de gravação'],
    body: `Uma parceria envolve poucos documentos, mas cada um tem um papel. Na indicação, quase tudo é assinado entre o cliente e a Kloel. Na revenda, você também firma documentos com seus clientes.

:::warning[Não é aconselhamento jurídico]
Os modelos citados são pontos de partida. Revise-os com sua assessoria jurídica antes de usar.
:::

## Documentos da parceria

| Documento | Para que serve | Quem assina | Onde obter |
|---|---|---|---|
| Termos do programa de parceiros | Regras de comissão, desconto, marca e conduta | Você e a Kloel | Enviados na ativação |
| Termos e condições da Kloel | Uso da plataforma | Cliente (indicação) ou você (revenda) | [Termos e condições](/ajuda/legal/termos-e-condicoes) |
| Política de privacidade | Como a Kloel trata dados | Informativo | [Política de privacidade](/ajuda/legal/politica-de-privacidade) |
| Acordo de tratamento de dados | Papéis e obrigações na LGPD | Cliente e Kloel, ou você e Kloel | [Proteção de dados](/ajuda/legal/protecao-de-dados) |
| Modelo de DPA parceiro–cliente | Base para o seu acordo com o cliente na revenda | Você e o cliente | Pedido pelo botão **Suporte** |
| Contrato de revenda | Condições comerciais da revenda | Você e a Kloel | Enviado após a conversa de parceria |

::mockup{kind="partner-portal" caption="Área do parceiro com os documentos da parceria"}

## Modelo de aviso na ligação

Um texto curto nas **Mensagens iniciais** atende à transparência com quem liga. Adapte ao cliente:

~~~text
Olá, você ligou para a Clínica Bem Viver. Eu sou a Roberta, assistente
virtual da clínica. Esta ligação pode ser gravada para melhorar o
atendimento. Como posso ajudar?
~~~

## Cláusulas para a sua proposta (revenda)

~~~text
O atendimento será realizado por assistente virtual operado na plataforma
Kloel, que atua como suboperadora de dados. As partes firmarão acordo de
tratamento de dados pessoais conforme a LGPD antes do início do serviço.
~~~

## Hospedagem

Os locais de processamento e a lista de suboperadores estão descritos em [Proteção de dados](/ajuda/legal/protecao-de-dados). Não prometa ao cliente uma localização específica sem conferir essa página ou confirmar com o time de parcerias.

## Retenção

- **Gravação:** pode ser ativada ou desativada por assistente, na aba **Técnico**.
- **Transcrições e resumos:** ficam em [Conversas](/app/inbox) enquanto a conta estiver ativa, conforme a política vigente.
- **Sem retenção:** a tabela de [Planos](/planos) lista a opção de não reter dados no plano Scale.
- **Exclusão:** pedidos de exclusão de titulares devem ser encaminhados ao controlador (o cliente) e executados na conta.

::mockup{kind="agent-technical" caption="Aba Técnico: controle de gravação de chamadas"}

## Dados de saúde

A LGPD trata dados de saúde como dados pessoais sensíveis, com regras mais rígidas. Na prática, para clínicas e consultórios:

- Use o assistente para **logística**: agendar, confirmar, informar endereço, preparo e convênios.
- Evite coletar sintomas, diagnósticos ou histórico clínico por telefone sem necessidade e base legal definida pelo cliente.
- Configure na aba **Regras** que o assistente não dá orientação médica e transfere casos de urgência.

:::faq[O assistente pode perguntar o motivo da consulta?]
Prefira perguntar a especialidade ou o tipo de atendimento, e não os sintomas. A decisão sobre o que coletar é do cliente, como controlador.
:::

:::faq[Posso desativar a gravação só para um assistente?]
Sim. A configuração de gravação fica na aba **Técnico** de cada assistente.
:::`,
  },

  // ─── Preços e cobrança ─────────────────────────────────────────────────────────────────────────
  {
    section: 'pricing-billing',
    slug: 'prepaid-to-subscription',
    title: 'De crédito pré-pago para assinatura',
    description: 'Como e quando migrar um cliente que começou com créditos de teste para uma assinatura mensal ou anual.',
    source: 'DEMONSTRATIVO',
    demo: true,
    related: ['pricing-billing/test-calls-and-credits', 'pricing-billing/invoices-and-billing', 'sales-resources/pricing-setups', 'sales-resources/upsell-playbook'],
    keywords: ['créditos', 'pré-pago', 'assinatura', 'migração de plano', 'upgrade', 'mensal', 'anual'],
    body: `Muitos clientes começam com créditos: os que vêm na criação da conta, os ganhos por indicação em [Créditos grátis](/app/free-credits) ou um pacote pontual para um piloto. Quando o uso se estabiliza, a assinatura costuma sair mais barata por minuto e evita que o assistente pare por falta de saldo.

## Quando propor a migração

- O cliente usa o assistente todos os dias há pelo menos duas semanas.
- O saldo de créditos acabou ou está perto de acabar.
- O cliente quer recursos que dependem de plano, como ligações simultâneas ou campanhas outbound.
- O piloto combinado atingiu o critério de sucesso.

::::steps
### Estime o volume
Use os minutos consumidos no período de teste para escolher entre os planos. A tabela pública fica em [Planos](/planos).

### Escolha mensal ou anual
O preço anual é menor por mês; o mensal dá flexibilidade nos primeiros meses.

### Altere o plano
Em [Faturamento](/app/billing), use **Alterar plano**, escolha o plano e conclua o pagamento.

### Confira o resultado
Verifique em Faturamento se a assinatura aparece ativa e se os minutos do plano foram creditados.
::::

::mockup{kind="overview" caption="Visão geral: consumo do período de teste ajuda a escolher o plano"}

:::info[O que acontece com os créditos restantes?]
Créditos ainda válidos continuam disponíveis até a data de expiração e são usados depois dos minutos do plano. Confirme a regra vigente antes de prometer ao cliente.
:::

## Na revenda

Você contrata a assinatura em nome do cliente, na conta dele, e cobra o valor que definiu. Combine com o cliente quem acompanha o consumo para evitar surpresas com excedentes.

:::tip[Precisa de ajuda?]
Use o botão **Suporte** no topo desta central.
:::`,
  },
  {
    section: 'pricing-billing',
    slug: 'invoices-and-billing',
    title: 'Faturas e cobrança',
    description: 'Onde encontrar faturas, quem paga o quê em cada modelo e como funcionam os repasses de comissão.',
    source: 'DEMONSTRATIVO',
    demo: true,
    related: ['pricing-billing/refunds-and-cancellations', 'partner-program/refer-or-resell', 'portal-tracking/customer-not-showing', 'onboarding/who-helps-with-what'],
    keywords: ['fatura', 'nota fiscal', 'cobrança', 'pagamento', 'comissão', 'repasse', 'boleto'],
    body: `A cobrança depende do modelo de cada cliente. Na indicação, a Kloel cobra o cliente e repassa a comissão a você. Na revenda, a Kloel cobra você, com desconto, e você cobra o cliente pelo preço que definiu.

## Quem cobra quem

| | Indicação | Revenda |
|---|---|---|
| Fatura do plano ao cliente | Kloel | Você |
| Seus serviços (implantação, manutenção) | Você, em nota própria | Você, na mesma nota ou separado |
| Pagamento à Kloel | Cliente | Você |
| Seu ganho | Comissão repassada pela Kloel | Diferença entre seu preço e o custo com desconto |

## Onde ver faturas

::::steps
### Abra Faturamento
No menu da conta, abra [Faturamento](/app/billing) na conta em questão: a sua ou a do cliente, se você tiver acesso como usuário.

### Consulte o histórico
A lista mostra as faturas com data, valor e situação do pagamento.

### Baixe ou atualize os dados
Pelo portal de cobrança você baixa faturas e atualiza a forma de pagamento e os dados de cobrança, como CNPJ e endereço.
::::

::mockup{kind="partner-portal" caption="Área do parceiro: comissão apurada e repasses"}

## Repasse de comissões

- A comissão é apurada mensalmente sobre os pagamentos confirmados dos clientes indicados.
- O repasse pode ser solicitado a partir de um saldo mínimo de R$ 600.
- Peça o repasse pelo botão **Suporte**, informando a empresa parceira.
- Para receber, a empresa parceira emite nota fiscal de serviço à Kloel no valor da comissão.

:::warning[Dados cadastrais]
Repasses só são feitos para a empresa parceira cadastrada. Mantenha CNPJ e dados bancários atualizados com o time de parcerias.
:::

:::tip[Precisa de ajuda?]
Dúvidas sobre uma fatura específica? Use o botão **Suporte** no topo desta central.
:::`,
  },
  {
    section: 'pricing-billing',
    slug: 'refunds-and-cancellations',
    title: 'Reembolsos e cancelamentos',
    description: 'Como cancelar uma assinatura, quando cabe reembolso e o que acontece com sua comissão em cada caso.',
    source: 'DEMONSTRATIVO',
    demo: true,
    related: ['pricing-billing/invoices-and-billing', 'customers/why-customers-stay-or-leave', 'pricing-billing/prepaid-to-subscription', 'legal/termos-e-condicoes'],
    keywords: ['cancelamento', 'reembolso', 'estorno', 'cancelar assinatura', 'devolução', 'fidelidade'],
    body: `Cancelamentos fazem parte do negócio. O importante é que o processo seja claro para o cliente e previsível para você. As regras gerais da plataforma estão em [Termos e condições](/ajuda/legal/termos-e-condicoes); este artigo resume o que muda para parceiros.

## Cenários comuns

| Cenário | O que acontece | Efeito para o parceiro |
|---|---|---|
| Cliente mensal cancela | A assinatura segue até o fim do período pago e não renova | A comissão para a partir do mês seguinte |
| Cliente anual cancela antes do fim | Segue as condições do plano anual contratado | Comissão já apurada não é alterada |
| Cobrança indevida reembolsada | O valor volta ao cliente | A comissão correspondente é estornada |
| Cliente revendido cancela com você | Você decide a política com o seu cliente | Você cancela a assinatura na conta dele |
| Cliente troca para plano menor | O novo valor vale a partir do próximo ciclo | A comissão acompanha o novo valor |

## Como cancelar

::::steps
### Converse antes
Pergunte o motivo e ofereça uma correção concreta. Veja [Por que clientes ficam ou saem](/ajuda/customers/why-customers-stay-or-leave).

### Exporte o que for necessário
Se o cliente quiser guardar transcrições ou contatos, faça isso antes do fim do período.

### Cancele em Faturamento
Em [Faturamento](/app/billing), acesse a assinatura e escolha cancelar. O cancelamento deve ser feito por alguém com acesso à conta.

### Desative o desvio de chamadas
Garanta que o número do cliente volte a tocar só na empresa, para nenhuma ligação ficar sem resposta.
::::

::mockup{kind="partner-portal" caption="Área do parceiro: cliente com assinatura cancelada"}

:::danger[Desvio esquecido]
Se a assinatura acabar e o desvio de chamadas continuar ativo, as ligações do cliente podem cair em um número sem atendimento. Sempre inclua a desativação no checklist.
:::

:::tip[Precisa de ajuda?]
Use o botão **Suporte** no topo desta central para casos de reembolso.
:::`,
  },
  {
    section: 'pricing-billing',
    slug: 'setup-and-care-packages',
    title: 'Pacotes de configuração e manutenção da Kloel',
    description: 'Os serviços de implantação e acompanhamento que a própria Kloel pode oferecer e como eles convivem com os seus.',
    source: 'DEMONSTRATIVO',
    demo: true,
    related: ['sales-resources/pricing-setups', 'partner-program/refer-without-implementing', 'customers/first-30-days', 'onboarding/supporting-customers'],
    keywords: ['pacote de configuração', 'implantação Kloel', 'manutenção', 'onboarding assistido', 'serviços profissionais'],
    body: `Além da assinatura, a Kloel pode oferecer pacotes de configuração e de manutenção para clientes que não têm quem implante. Para você, eles são úteis principalmente na indicação: o cliente recebe ajuda na implantação e você não precisa assumir esse trabalho.

Na revenda, a expectativa é que você mesmo preste esses serviços, com os seus pacotes. Veja [Configurações de preço e pacotes de manutenção](/ajuda/sales-resources/pricing-setups).

## Pacotes disponíveis

| Pacote | O que inclui | Formato |
|---|---|---|
| Configuração essencial | Um assistente, prompt, base de conhecimento e ligação de teste acompanhada | Pagamento único |
| Configuração com integração | Tudo do essencial, mais uma integração de agenda ou CRM | Pagamento único |
| Manutenção mensal | Revisão de conversas, ajustes e reunião mensal | Mensal |

Os planos de WhatsApp já listam onboarding entre os benefícios de alguns níveis; confira em [Planos](/planos).

::mockup{kind="agent-prompt" caption="Prompt personalizado revisado durante o pacote de configuração"}

## Quem faz o quê

| Situação | Recomendação |
|---|---|
| Você indica e não quer implantar | Ofereça o pacote de configuração da Kloel |
| Você indica e quer implantar | Venda sua implantação à parte; a Kloel cuida da assinatura |
| Você revende | Você implanta e mantém, com seus próprios pacotes |
| Projeto grande ou com integração complexa | Converse com o time de parcerias para dividir o escopo |

:::info[Sem concorrência com você]
Quando o cliente é seu, a Kloel não oferece serviços concorrentes aos seus sem combinar antes. Registre na área do parceiro quem cuida da implantação de cada cliente.
:::

:::tip[Precisa de ajuda?]
Para incluir um pacote da Kloel na sua proposta, use o botão **Suporte** no topo desta central.
:::`,
  },
  {
    section: 'pricing-billing',
    slug: 'test-calls-and-credits',
    title: 'Chamadas de teste no painel e créditos',
    description: 'Como os minutos de teste e de demonstração são contados e o que fazer quando eles acabam.',
    source: 'DEMONSTRATIVO',
    demo: true,
    related: ['onboarding/test-with-partner-account', 'pricing-billing/prepaid-to-subscription', 'sales-resources/build-customer-demo', 'get-started/analytics'],
    keywords: ['minutos de teste', 'créditos', 'consumo', 'ligação de teste', 'saldo', 'minutos de demonstração'],
    body: `Toda conversa com um assistente consome minutos, inclusive as de teste. Entender de onde saem esses minutos evita a surpresa de ficar sem saldo no meio de uma demo importante.

## O que consome minutos

| Uso | Consome? | De onde sai |
|---|---|---|
| **Ligação de teste** no navegador | Sim | Minutos de demonstração da conta de parceiro |
| Ligação real para um número da Kloel | Sim | Plano ou créditos da conta |
| Ligação ativa (outbound) | Sim | Plano ou créditos da conta |
| Edição de prompt, regras e conhecimento | Não | — |
| Leitura de conversas e resumos | Não | — |

::mockup{kind="test-call" caption="Ligação de teste no navegador: consome minutos de demonstração"}

## Acompanhe o consumo

::::steps
### Veja o resumo
Em [Visão geral](/app), confira o volume de ligações e minutos do período.

### Confira o saldo
Em [Faturamento](/app/billing), veja minutos do plano, créditos restantes e a data de renovação.

### Ganhe créditos por indicação
Em [Créditos grátis](/app/free-credits), copie seu link e indique outras empresas para ganhar créditos de uso.
::::

## Para economizar minutos de demonstração

- Teste uma coisa por vez: ajuste, ligue, confira, ajuste de novo.
- Defina uma duração máxima de ligação na aba **Técnico** para testes longos não consumirem o saldo.
- Grave uma boa ligação de teste e reutilize a gravação em apresentações.

:::info[Minutos de demonstração acabaram?]
O volume mensal de minutos de demonstração do parceiro é renovado todo mês e pode ser ampliado pelo time de parcerias. Peça pelo botão **Suporte**.
:::

:::tip[Precisa de ajuda?]
Use o botão **Suporte** no topo desta central.
:::`,
  },

  // ─── Configuração ──────────────────────────────────────────────────────────────────────────────
  {
    section: 'setup',
    slug: 'integrations-status',
    title: 'Integrações: o que funciona, o que está por vir',
    description: 'O status das integrações mais pedidas pelos clientes, para você saber o que pode prometer em cada proposta.',
    source: 'DEMONSTRATIVO',
    demo: true,
    related: ['setup/post-call-webhook', 'partner-program/release-updates', 'developers/http-request', 'sales-resources/upsell-playbook'],
    keywords: ['integrações', 'status', 'disponível', 'acesso antecipado', 'CRM', 'agenda', 'roadmap'],
    body: `"Integra com o meu sistema?" é uma das perguntas que mais decidem uma venda. Antes de responder, confira o status abaixo e o catálogo completo em [Integrações](/app/integrations). Prometer uma integração que ainda está em acesso antecipado é uma das causas mais comuns de cliente insatisfeito.

O status desta tabela reflete o catálogo do app e pode mudar. Em caso de dúvida, o catálogo do app é a referência.

## Status das integrações mais pedidas

| Integração | Categoria | Status | Guia |
|---|---|---|---|
| Google Calendar e Outlook Calendar | Agenda | Disponível | Pelo [Agendador](/app/scheduling) |
| Calendly | Agenda | Disponível | [Agendamentos](/ajuda/actions/appointments) |
| WhatsApp Business | Comunicação | Disponível | [WhatsApp](/ajuda/products/whatsapp) |
| Slack | Comunicação | Disponível | [Slack](/ajuda/integrations/slack) |
| Google Sheets | Automação | Disponível | [Google Sheets](/ajuda/integrations/google-sheets) |
| Airtable | Automação | Disponível | [Airtable](/ajuda/integrations/airtable) |
| Notion | Automação | Disponível | [Notion](/ajuda/integrations/notion) |
| Zapier | Automação | Disponível | [Zapier](/ajuda/integrations/zapier) |
| Make | Automação | Disponível | [Make](/ajuda/integrations/makecom) |
| n8n | Automação | Disponível | [n8n](/ajuda/integrations/n8n) |
| GoHighLevel | CRM | Disponível | [GoHighLevel](/ajuda/integrations/gohighlevel) |
| Pipedrive | CRM | Acesso antecipado | [Pipedrive](/ajuda/integrations/pipedrive) |
| HubSpot e Salesforce | CRM | Acesso antecipado | Solicitar no catálogo |
| Shopify e WooCommerce | E-commerce | Acesso antecipado | [Shopify](/ajuda/integrations/shopify) · [WooCommerce](/ajuda/integrations/woocommerce) |
| Odoo, Xero e Teamleader | Gestão | Acesso antecipado | [Odoo](/ajuda/integrations/odoo) · [Xero](/ajuda/integrations/xero) |
| Qualquer sistema com API | Desenvolvedores | Disponível via requisição HTTP | [Requisição HTTP](/ajuda/developers/http-request) |

::mockup{kind="integrations" highlight="Google Sheets" caption="Catálogo de Integrações com status Disponível e Acesso antecipado"}

## Como responder ao cliente

- **Disponível:** pode entrar na proposta e no cronograma.
- **Acesso antecipado:** solicite o acesso pelo cartão da integração antes de prometer; deixe a integração como fase dois, fora do prazo principal.
- **Não listada:** avalie automação (Zapier, Make, n8n) ou um webhook. Veja [Webhook pós-chamada e variáveis](/ajuda/setup/post-call-webhook).

:::warning[Combine o plano B por escrito]
Se a integração desejada não estiver disponível, escreva na proposta qual alternativa será usada até lá, por exemplo resumo por e-mail ou planilha.
:::

:::tip[Precisa de ajuda?]
Use o botão **Suporte** no topo desta central para confirmar o status de uma integração.
:::`,
  },
  {
    section: 'setup',
    slug: 'post-call-webhook',
    title: 'Webhook pós-chamada e variáveis',
    description: 'Envie os dados de cada conversa para o sistema do cliente assim que ela termina, usando variáveis do sistema e personalizadas.',
    source: 'DEMONSTRATIVO',
    demo: true,
    related: ['developers/http-request', 'developers/test-context', 'setup/integrations-status', 'developers/inbound-webhook'],
    keywords: ['webhook', 'pós-chamada', 'variáveis', 'requisição HTTP', 'API', 'integração personalizada', 'JSON'],
    body: `O webhook pós-chamada é a forma mais flexível de integrar a Kloel a qualquer sistema do cliente: ao fim de cada conversa, o assistente envia uma requisição HTTP com os dados que você escolher. É a solução padrão quando não existe integração nativa.

O passo a passo completo de requisições HTTP está em [Requisição HTTP](/ajuda/developers/http-request). Aqui está o resumo voltado à implantação.

::::steps
### Abra os webhooks do assistente
No assistente, na aba **Geral**, abra o cartão **Webhooks** em **Recursos**, adicione um novo webhook e escolha a requisição HTTP.

### Defina quando executar
Na configuração geral, escolha executar **depois da conversa**. Se quiser, defina uma condição na parte avançada; sem condição, a requisição roda após toda conversa.

### Escolha a disponibilidade
Sempre, só dentro ou só fora do horário de funcionamento.

### Informe URL, método e cabeçalhos
Normalmente POST, com o endpoint do sistema do cliente e o cabeçalho de autenticação. O resultado precisa ser um JSON válido.

### Monte o corpo com variáveis
Insira variáveis do sistema pelo seletor e crie variáveis personalizadas para o que o assistente deve extrair da conversa.
::::

::mockup{kind="http-request" caption="Requisição HTTP: método, URL, cabeçalhos e corpo JSON com variáveis"}

## Exemplo de corpo

~~~json
{
  "origem": "kloel",
  "telefone": "{{personNumber}}",
  "linkDaConversa": "{{conversationLink}}",
  "nomeDoCliente": "{{nome_cliente}}",
  "motivo": "{{motivo_ligacao}}",
  "urgente": "{{urgente}}"
}
~~~

## Variáveis

| Variável | Tipo | Origem |
|---|---|---|
| \`{{personNumber}}\` | Sistema | Número de quem ligou |
| \`{{conversationLink}}\` | Sistema | Link da conversa em Conversas |
| \`{{nome_cliente}}\` | Personalizada, texto | Extraída da conversa |
| \`{{motivo_ligacao}}\` | Personalizada, texto | Extraída da conversa |
| \`{{urgente}}\` | Personalizada, booleano | Extraída da conversa |

Variáveis personalizadas têm nome, tipo (texto, número ou booleano) e descrição. A descrição é obrigatória e precisa dizer exatamente o que capturar: "motivo principal da ligação em até cinco palavras" funciona melhor que "motivo".

:::tip[Teste antes do go-live]
Aponte a URL para um endpoint de teste do cliente, faça algumas ligações de teste e confira o que chegou. Veja [Contexto de teste](/ajuda/developers/test-context).
:::

:::warning[Credenciais]
Use chaves de API do sistema do cliente com o menor acesso possível e nunca as cole em e-mails ou chamados.
:::`,
  },
  {
    section: 'setup',
    slug: 'common-support-issues',
    title: 'Problemas comuns de suporte após o go-live',
    description: 'Os problemas que mais aparecem nas primeiras semanas de uso, com a causa provável e o que fazer.',
    source: 'DEMONSTRATIVO',
    demo: true,
    related: ['get-started/troubleshooting', 'customers/first-30-days', 'onboarding/who-helps-with-what', 'setup/post-call-webhook'],
    keywords: ['problemas', 'erros', 'solução de problemas', 'troubleshooting', 'suporte', 'go-live'],
    body: `Depois do go-live, a maior parte dos chamados se repete: ligações que não chegam, respostas imprecisas, transferências que falham. Resolva a maioria sozinho com a tabela abaixo antes de escalar ao suporte da Kloel.

## Se algo não estiver funcionando

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| As ligações não chegam ao assistente | Desvio de chamadas inativo ou configurado só para ocupado | Refaça o desvio com o código da operadora e teste de outro telefone |
| O assistente atende, mas ninguém ouve | Problema de rede ou do tronco SIP | Teste com uma ligação de celular; revise [Números SIP](/ajuda/phone-systems/sip-numbers) |
| Respostas erradas sobre preço ou horário | Conhecimento desatualizado | Atualize a aba **Conhecimento** e as perguntas e respostas |
| O assistente fala demais | Prompt sem limite de tamanho de resposta | Peça respostas curtas na aba **Prompt personalizado** |
| Transferência não completa | Número de destino errado ou ocupado | Revise o cartão **Transferir ligações** e o horário de transferência |
| Agendamento não aparece na agenda | Agenda desconectada ou sem disponibilidade | Reconecte no [Agendador](/app/scheduling) e confira os horários |
| Webhook não chega | URL, cabeçalho ou JSON inválido | Teste a requisição; veja [Webhook pós-chamada](/ajuda/setup/post-call-webhook) |
| Quem liga desliga logo | Mensagem inicial longa ou voz inadequada | Encurte as **Mensagens iniciais** e teste outra **Voz** |
| Ligações cortadas no meio | Duração máxima muito baixa | Ajuste a duração máxima na aba **Técnico** |
| Minutos acabando antes do previsto | Volume maior que o estimado | Revise o plano em [Faturamento](/app/billing) |

::mockup{kind="inbox" caption="Conversas: a transcrição mostra onde o atendimento falhou"}

## Antes de abrir um chamado

1. Reproduza o problema com uma **Ligação de teste**.
2. Copie o link da conversa em [Conversas](/app/inbox).
3. Anote horário, número de origem e assistente.
4. Consulte também [Solução de problemas](/ajuda/get-started/troubleshooting).

:::tip[Precisa de ajuda?]
Não resolveu? Use o botão **Suporte** no topo desta central com as informações acima.
:::`,
  },

  // ─── Recursos de marketing ─────────────────────────────────────────────────────────────────────
  {
    section: 'marketing-resources',
    slug: 'marketing-material',
    title: 'Material de marketing',
    description: 'Os materiais disponíveis para divulgar a Kloel junto com a sua marca e as regras para usá-los.',
    source: 'DEMONSTRATIVO',
    demo: true,
    related: ['marketing-resources/media-templates', 'marketing-resources/flyer-templates', 'sales-resources/presentations', 'partner-program/white-label'],
    keywords: ['marketing', 'materiais', 'kit de marca', 'logo', 'divulgação', 'co-marketing'],
    body: `Você pode divulgar a Kloel nos seus canais: site, redes sociais, e-mail, eventos e materiais impressos. Para facilitar, o programa oferece um kit com logotipos, imagens do produto e textos base. A regra geral é: sua marca à frente, a Kloel como tecnologia, e nenhuma promessa que não possa ser comprovada.

## O que existe no kit

| Material | Formato | Uso |
|---|---|---|
| Logotipo kloel.ai e selo "powered by kloel.ai" | SVG e PNG, versões clara e escura | Site, apresentações, impressos |
| Imagens do produto | PNG em alta resolução | Posts, landing pages, propostas |
| Textos base | Documento de texto | Página de serviço, e-mails, anúncios |
| Modelos de posts e e-mails | Veja [Modelos de mídia](/ajuda/marketing-resources/media-templates) | Redes sociais e e-mail |
| Panfletos | Veja [Modelos de panfletos](/ajuda/marketing-resources/flyer-templates) | Eventos e visitas |

::mockup{kind="partner-portal" caption="Área do parceiro com o kit de marketing"}

## Regras de comunicação

- **Pode:** descrever o que o assistente faz, mostrar telas reais do app, usar o selo "powered by kloel.ai".
- **Pode, com cuidado:** citar resultados de um cliente seu, com autorização por escrito e números verificáveis.
- **Não pode:** dizer que é a Kloel, usar o nome da Kloel no seu domínio ou nas redes, criar anúncios que pareçam oficiais da Kloel.
- **Não pode:** inventar números, rankings, certificações ou depoimentos.

:::warning[Anúncios pagos]
Não compre palavras-chave com a marca Kloel nem use "Kloel" no título de anúncios sem autorização do time de parcerias.
:::

## Página de serviço no seu site

Uma página "Atendimento com IA" no seu site é o material de marketing mais eficiente. Inclua: o problema, como funciona, um vídeo curto da demo, seus pacotes e um botão para agendar uma conversa com você.

:::tip[Precisa de ajuda?]
Use o botão **Suporte** no topo desta central para pedir os modelos editáveis.
:::`,
  },
  {
    section: 'marketing-resources',
    slug: 'flyer-templates',
    title: 'Modelos de panfletos',
    description: 'Modelos de panfletos para eventos e visitas, com especificações de impressão e as regras de uso da marca kloel.ai.',
    source: 'DEMONSTRATIVO',
    demo: true,
    related: ['marketing-resources/marketing-material', 'marketing-resources/media-templates', 'partner-program/white-label', 'partner-program/requirements'],
    keywords: ['panfleto', 'flyer', 'impresso', 'uso da marca', 'logotipo', 'manual de marca', 'brand'],
    body: `Panfletos funcionam bem em feiras, eventos de associações e visitas presenciais. Os modelos do programa trazem a estrutura pronta: título, três benefícios, um passo a passo simples e um QR code para o prospect agendar uma conversa com você.

## Modelos disponíveis

| Modelo | Público | Mensagem principal |
|---|---|---|
| Geral | Pequenas empresas de serviço | Nunca mais perca uma ligação |
| Saúde | Clínicas e consultórios | Sua recepção atende, a IA agenda |
| Imobiliário | Imobiliárias e corretores | Atenda interessados a qualquer hora |
| Serviços técnicos | Oficinas e prestadores | Seu técnico no serviço, a IA no telefone |

## Especificações de impressão

- Formato A5 (148 × 210 mm) ou A4 dobrado.
- Arquivo em PDF com 3 mm de sangria e marcas de corte.
- Imagens em 300 dpi, cores em CMYK.
- QR code com pelo menos 2 × 2 cm, apontando para a sua página de agendamento.

::mockup{kind="partner-portal" caption="Área do parceiro com os modelos de panfleto"}

## Regras de uso da marca

- **Wordmark:** use sempre o logotipo **kloel.ai** dos arquivos oficiais, em minúsculas, como está.
- **Não altere o logotipo:** sem mudar cores, proporções, fonte ou inclinação; sem sombras, contornos ou efeitos.
- **Área de respiro:** mantenha ao redor do logotipo um espaço livre de pelo menos a altura da letra "k".
- **Tamanho mínimo:** 20 mm de largura no impresso e 80 px na tela.
- **Fundo:** use a versão escura em fundos claros e a versão clara em fundos escuros, com bom contraste.
- **Co-branding:** sua marca em destaque e o selo "powered by kloel.ai" menor, no rodapé.
- **Nome:** escreva "Kloel" no texto corrido; não crie variações como "Kloel IA" ou "K-loel".

:::danger[Não faça]
Não crie logotipos combinando a sua marca com a da Kloel, não use a marca em nomes de domínio ou perfis de redes sociais e não imprima materiais que pareçam ter sido emitidos pela própria Kloel.
:::`,
  },
  // ─── Artigos adicionados: acompanhamento, marketing e jurídico ─────────────────────────────────
  {
    section: 'portal-tracking',
    slug: 'account-activation',
    title: 'Ativação da conta de parceiro',
    description: 'Como a conta de parceiro é ativada, o que significa cada status e o que fazer quando a ativação demora.',
    source: 'DEMONSTRATIVO',
    demo: true,
    related: ['partner-program/become-a-partner', 'portal-tracking/customer-not-showing', 'portal-tracking/account-transfer', 'onboarding/who-helps-with-what'],
    keywords: ['ativação', 'conta de parceiro', 'perfil de parceiro', 'pendente', 'aprovação', 'status do parceiro'],
    body: `Depois da conversa com o time de parcerias, a sua conta Kloel ganha o perfil de parceiro. A partir daí você acessa a área do parceiro, gera links de indicação e cria contas de clientes na revenda.

::mockup{kind="partner-portal" caption="Área do parceiro: status do perfil e próximos passos"}

## Status possíveis

| Status | O que significa | O que fazer |
|---|---|---|
| Em análise | Recebemos o seu cadastro e o time está revisando os dados da empresa. | Aguarde. A análise leva até 2 dias úteis. |
| Aguardando documentos | Falta algum dado, como CNPJ ou responsável legal. | Responda ao e-mail do time de parcerias com o que foi pedido. |
| Ativo | O perfil de parceiro está liberado. | Gere o seu link de indicação e convide o primeiro cliente. |
| Suspenso | Houve um problema com as regras do programa ou com pagamentos. | Fale com o time pelo botão **Suporte**. |

## Como ativar

::::steps
### Crie a conta da empresa
Use [Criar conta](/criar-conta) com um e-mail profissional, de preferência um endereço de função como parcerias@suaempresa.com.br.

### Agende a conversa de parceria
Marque um horário em [Agendar conversa de parceria](/parceiros/agendar). Na conversa, definimos o modelo: indicação ou revenda.

### Confirme os dados
Envie CNPJ, razão social e o nome do responsável. Sem esses dados a conta não sai de "Aguardando documentos".

### Comece a usar
Com o status **Ativo**, a área do parceiro aparece no menu do app.
::::

:::tip[Dica]
Convide pelo menos mais uma pessoa da sua equipe em [Usuários](/app/users). Assim a conta não depende de uma pessoa só.
:::

:::faq[A ativação passou de 2 dias úteis. E agora?]
Abra um chamado pelo botão **Suporte** com o nome da empresa e o e-mail usado no cadastro. Nós verificamos o que está pendente.
:::`,
  },
  {
    section: 'portal-tracking',
    slug: 'account-transfer',
    title: 'Transferência de conta',
    description: 'Como trocar o responsável por uma conta de parceiro ou passar a conta de um cliente para outro dono, sem perder histórico.',
    source: 'DEMONSTRATIVO',
    demo: true,
    related: ['portal-tracking/account-activation', 'portal-tracking/customer-not-showing', 'pricing-billing/invoices-and-billing', 'onboarding/who-helps-with-what'],
    keywords: ['transferir conta', 'trocar responsável', 'mudar dono', 'saída de funcionário', 'transferência de cliente'],
    body: `Pessoas mudam de cargo ou saem da empresa. A conta continua sendo da empresa. Aqui está o que dá para transferir e como pedir.

## O que pode ser transferido

| Situação | É possível? | Observação |
|---|---|---|
| Trocar o responsável da sua conta de parceiro | Sim | A nova pessoa precisa ser usuária da conta. |
| Passar a conta de um cliente revendido para o próprio cliente | Sim | O faturamento passa a ser direto com a Kloel. |
| Mover um cliente de um parceiro para outro | Sim, com aceite das duas partes | Vale a partir da data da transferência. |
| Transferir comissões já apuradas | Não | O histórico fica com a empresa parceira original. |

## Como pedir

::::steps
### Adicione a nova pessoa
Convide quem vai assumir em [Usuários](/app/users) com um e-mail profissional.

### Abra um chamado
Use o botão **Suporte** e informe a conta, o responsável atual, o novo responsável e o motivo.

### Confirme por e-mail
Enviamos uma confirmação para o responsável atual e para o novo. Se o responsável atual não estiver mais na empresa, um representante legal pode confirmar.
::::

:::warning[Antes de transferir um cliente]
Combine com o cliente quem vai cuidar do faturamento e do suporte. Os números de telefone, os assistentes e o histórico de chamadas continuam na conta.
:::

:::info[Prazo]
Depois da confirmação, a transferência é concluída em até 2 dias úteis.
:::`,
  },
  {
    section: 'marketing-resources',
    slug: 'media-templates',
    title: 'Modelos de mídia',
    description: 'Posts, e-mails e mensagens de WhatsApp prontos para apresentar a Kloel aos seus clientes, e como adaptá-los.',
    source: 'DEMONSTRATIVO',
    demo: true,
    related: ['marketing-resources/marketing-material', 'marketing-resources/flyer-templates', 'sales-resources/presentations', 'onboarding/where-to-find-resources'],
    keywords: ['modelos', 'posts', 'redes sociais', 'e-mail marketing', 'mensagem whatsapp', 'divulgação', 'texto pronto'],
    body: `Para divulgar a Kloel você não precisa começar do zero. Use os modelos abaixo como base e adapte ao tom da sua empresa.

## O que está disponível

| Formato | Uso indicado | Onde encontrar |
|---|---|---|
| Posts para redes sociais | LinkedIn e Instagram, em formato quadrado e vertical | Área do parceiro, em **Materiais** |
| E-mail de apresentação | Primeiro contato com clientes da sua base | Área do parceiro, em **Materiais** |
| Mensagem de WhatsApp | Convite curto para uma demo | Logo abaixo |
| Estudo de caso curto | Mostrar resultado de um cliente parecido | [Material de marketing](/ajuda/marketing-resources/marketing-material) |

## Mensagem de WhatsApp pronta

> Oi, [nome]! Sabe aquelas ligações que ficam sem resposta fora do horário? A Kloel atende por voz, 24 horas, agenda e qualifica clientes. Posso te mostrar em 15 minutos como ficaria na [empresa]?

## E-mail de apresentação

> **Assunto:** Nenhuma ligação perdida na [empresa]
>
> Oi, [nome]. A Kloel é uma assistente de IA que atende o telefone, o WhatsApp e o chat do site em português, a qualquer hora. Ela responde dúvidas, marca horários e passa para a sua equipe só o que precisa de uma pessoa. Quer ver uma demonstração com o seu caso?

## Como adaptar

- Troque os campos entre colchetes e cite o setor do cliente.
- Use números reais do cliente só com autorização dele.
- Mantenha o nome **Kloel** e o logo como estão. As regras estão em [Modelos de panfletos](/ajuda/marketing-resources/flyer-templates).

:::danger[Não faça]
Não prometa preços, prazos ou resultados que não estão nos materiais oficiais e não envie mensagens em massa para listas sem consentimento.
:::`,
  },
  {
    section: 'partner-legal',
    slug: 'hosting-retention-health-data',
    title: 'Hospedagem, retenção e dados de saúde',
    description: 'Onde os dados ficam, por quanto tempo são guardados e os cuidados ao atender clínicas e outros clientes que tratam dados de saúde.',
    source: 'DEMONSTRATIVO',
    demo: true,
    related: ['partner-legal/dpa-lgpd', 'partner-legal/templates-and-documents', 'sales-resources/demo-that-closes', 'customers/questions-before-buying'],
    keywords: ['hospedagem', 'retenção', 'dados de saúde', 'dado sensível', 'lgpd', 'clínica', 'gravação', 'exclusão'],
    body: `Clientes da área da saúde perguntam sempre as mesmas três coisas: onde ficam os dados, por quanto tempo e quem acessa. Use este artigo para responder com segurança, sem dar parecer jurídico.

## Hospedagem

Os dados das contas ficam em provedores de nuvem com criptografia em trânsito e em repouso. O acesso interno é restrito a quem precisa para operar e dar suporte.

## Retenção

| Tipo de dado | Prazo padrão | Pode mudar? |
|---|---|---|
| Gravações de chamadas | 90 dias | Sim, na aba **Técnico** do assistente, ou desligando a gravação |
| Transcrições e resumos | Enquanto a conta estiver ativa | O cliente pode excluir registros pelo app |
| Dados de contato dos leads | Enquanto a conta estiver ativa | Exclusão sob pedido do titular |
| Dados após o cancelamento | Até 30 dias, depois excluídos | Exportação antes do prazo, pelo botão **Suporte** |

## Dados de saúde

Dados de saúde são dados sensíveis na LGPD. Para clínicas, consultórios e laboratórios, oriente o cliente a:

- Avisar no início da ligação que ela é atendida por uma assistente virtual e pode ser gravada.
- Configurar o assistente para não pedir diagnóstico, exames ou histórico médico. Agendar, confirmar e tirar dúvidas gerais é suficiente.
- Definir quem da equipe acessa as transcrições em [Usuários](/app/users).
- Assinar o acordo de tratamento de dados. Veja [DPA e LGPD](/ajuda/partner-legal/dpa-lgpd).

:::warning[Papéis]
O cliente é o controlador dos dados dos pacientes dele, e a Kloel é a operadora. Na revenda, o parceiro também pode ser operador. Os detalhes estão em [Jurídico: modelos e documentos](/ajuda/partner-legal/templates-and-documents).
:::

:::info[Pedidos de titulares]
Se um paciente pedir acesso ou exclusão dos dados, o cliente registra o pedido pelo botão **Suporte** e nós ajudamos a atender no prazo legal.
:::`,
  },
]
