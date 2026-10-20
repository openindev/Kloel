import type { HelpArticle } from './types'

/**
 * Integrações — parte B (Odoo → Zapier).
 * Fontes: notas [195]–[209] (03. Integrações, arquivos 15–28), reescritas e adaptadas ao Brasil.
 * Modelo: Síntese A/B de docs/reference/specs/04-recursos-ajuda-empresa-parceiros.md.
 */

export const INTEGRATION_ARTICLES_B: HelpArticle[] = [
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  {
    section: 'integrations',
    slug: 'odoo',
    title: 'Odoo',
    description: 'Seu assistente reconhece quem entra em contato pelos contatos do Odoo, cria leads no CRM e salva o resumo de cada conversa no chatter.',
    source: '[195]',
    related: ['get-started/troubleshooting', 'get-started/contacts', 'developers/inbound-webhook'],
    keywords: ['odoo', 'erp', 'crm', 'lead', 'chatter', 'chave de api', 'res.partner'],
    body: `Com o Odoo conectado, seu assistente consulta o mesmo cadastro da sua equipe: antes de atender, procura quem está entrando em contato; durante a conversa, abre um lead para quem é novo; no fim, deixa um resumo no chatter. Funciona com assistentes de voz e de chat.

:::warning[Acesso antecipado]
O Odoo ainda não aparece automaticamente em todas as contas. Se ele não estiver em [Integrações](/app/integrations), peça a liberação pelo botão **Suporte** no topo desta central.
:::

::::steps
### Gere uma chave de API no Odoo
Entre com o usuário que a Kloel vai usar, abra **Preferências → Segurança da conta**, crie uma **Nova chave de API** e copie-a.

:::warning[Chave, nunca senha]
A conexão aceita apenas chave de API. Não informe a senha de ninguém.
:::

Prefira um usuário de automação exclusivo, com leitura de contatos (\`res.partner\`, obrigatória), escrita no CRM (para leads) e escrita no chatter (para resumos).

### Conecte o Odoo à Kloel
Em [Integrações](/app/integrations) (menu **Mais**), clique em **Adicionar integração**, escolha **Odoo** e preencha:

- **URL do Odoo**: só o endereço da instância, sem caminho, acessível pela internet.
- **Banco de dados**: no Odoo Online, costuma ser o subdomínio.
- **Usuário** e **Chave de API**: o login do usuário de automação e a chave do passo anterior.

~~~text
https://bemviver.exemplo.com.br
~~~

Ao salvar, a Kloel confere as permissões e avisa sobre as que faltarem.

### Escolha o que seu assistente pode fazer
Todas as funções são opcionais:

- **Permitir a criação de leads**: registra quem é novo como lead de CRM. Sem o app CRM, cria um contato com a **tag de contato alternativa** (padrão \`Lead Kloel\`).
- **Compartilhar as notas do contato com o assistente**: libera o campo definido em **Campo de notas**. Só ative se ele não tiver observações internas ou sensíveis.
- **Escrever o resumo da conversa no chatter**: entrada interna com resumo e link, sem alterar o campo de notas.
- **Marcar contatos com tag após a conversa**: aplica a **tag de conversa** (padrão \`Atendido pela Kloel\`), criada se ainda não existir.
::::

::mockup{kind="integration-config" name="Odoo" mode="credentials" caption="Conexão do Odoo com URL, banco de dados, usuário e chave de API"}

## Antes da ligação

A Kloel compara o número de quem liga com todos os campos de telefone dos contatos; no chat, usa o e-mail do remetente. Sem contato, procura um lead de CRM aberto com o mesmo telefone. Sem correspondência, a pessoa é tratada como nova, e o assistente só pergunta o nome se a criação de leads estiver ativa.

:::tip[Fica entre você e seu assistente]
O assistente usa nome, notas e etapa do CRM, mas não diz que consultou o Odoo nem revela observações internas ou a posição no pipeline.
:::

## Durante a ligação

Quando alguém pede retorno ou deixa uma solicitação, o assistente abre um lead com nome, e-mail (se informado), telefone da ligação e resumo do pedido. Exemplo: a Juliana Prado liga do +55 11 90000-0137 pedindo um orçamento; como ela é nova, o assistente confirma o nome e registra o lead. Para quem já é contato, o lead é vinculado ao registro existente, sem duplicar.

## Depois da ligação

Conforme as funções ativas, o chatter recebe o resumo com link e o registro ganha a tag de conversa. A conversa completa fica em [Conversas](/app/inbox).

## Teste a integração

Cadastre um contato de teste com o seu celular, ligue desse número e peça um retorno. Confira se o assistente usou seu nome e se resumo e tag apareceram no chatter.

## Bom saber

- **Uma função a menos não derruba as outras**: sem o app CRM, leads viram contatos com tag; sem escrita no chatter, só o resumo deixa de ser salvo.
- **Leitura de contatos é a base**: sem ela, não há reconhecimento.
- **Revogue a chave** em **Segurança da conta** se parar de usar a integração.

## Se algo não estiver funcionando

| Mensagem | O que verificar |
|---|---|
| Não foi possível acessar a instância do Odoo | A URL está certa e responde pela internet? |
| O Odoo recusou as credenciais | Banco de dados, usuário e chave de API conferem? |
| O usuário do Odoo não tem acesso de leitura aos contatos | Conceda leitura em \`res.partner\`. |
| Nada aparece no CRM ou no chatter | A função está ativa e o usuário pode escrever ali? |

:::tip[Precisa de ajuda?]
Clique em **Suporte** no topo desta central e diga qual conversa não saiu como esperado. A gente analisa com você.
:::`,
  },

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  {
    section: 'integrations',
    slug: 'onoffice',
    title: 'onOffice',
    description: 'Seu assistente responde sobre os seus imóveis, agenda visitas na agenda dos corretores e registra cada ligação no onOffice.',
    source: '[196]',
    related: ['get-started/troubleshooting', 'actions/appointments', 'get-started/write-a-great-prompt'],
    keywords: ['onoffice', 'imobiliária', 'imóveis', 'visita', 'corretor', 'crm imobiliário'],
    body: `Com o onOffice conectado, seu assistente atende como o corretor de plantão que conhece toda a carteira: identifica contatos, acha o imóvel mesmo quando a pessoa só lembra da rua, marca visitas na agenda do corretor responsável, cadastra interessados e deixa cada ligação no registro de atividades.

:::warning[Acesso antecipado]
O onOffice ainda não está liberado para todas as contas. Se ele não aparecer em [Integrações](/app/integrations), peça a liberação pelo botão **Suporte** no topo desta central.
:::

::::steps
### Crie um usuário de API no onOffice
A API do onOffice enterprise é um módulo pago, ativado pelo próprio onOffice. Com ela ativa, vá em **Extras → Configurações → Usuários**, crie um usuário de API só para a Kloel e gere o token. Você recebe o **Token de API** (32 caracteres) e o **Secret** (64 caracteres, exibido uma única vez).

O usuário precisa ler endereços e imóveis e escrever em endereços, calendário e registro de atividades.

### Conecte o onOffice à Kloel
Em [Integrações](/app/integrations), adicione **onOffice** e cole as credenciais. Ao salvar, a Kloel testa a conexão.

~~~text
Token de API: 5e8a…b20c   (32 caracteres)
Secret:       c71d…09fa   (64 caracteres)
~~~

### Escolha o que seu assistente pode fazer
- **Nome**: padrão **onOffice**.
- **Imóveis sobre os quais o assistente pode falar**: só imóveis ativos. **Publicados no seu site** (padrão) ou **Status de comercialização aberto** (tudo que não foi vendido, alugado nem reservado).
- **Cadastrar interessados** (ligado): desligado, os dados ficam só na conversa da Kloel.
- **Registrar ligações** (ligado).
- **Agendar visitas** (ligado): desligado, o assistente anota o pedido e promete retorno.
- **Corretor padrão** (vazio): assume imóveis sem corretor.
- **Tipo de compromisso**: o tipo de compromisso que a sua imobiliária usa para visitas no onOffice (por exemplo, **Visita**).
- **Duração da visita (minutos)**: padrão 30.
- **Horários de visita**: lembrete. Todos os dias, das 08:00 às 18:00; para limitar, use o [prompt](/ajuda/get-started/write-a-great-prompt).
::::

::mockup{kind="integration-config" name="onOffice" mode="credentials" caption="Conexão do onOffice com Token de API e Secret"}

## Antes da ligação

O assistente procura o número entre os contatos, em qualquer formato. Encontrando, cumprimenta pelo nome; se o número for de vários contatos, pergunta o sobrenome. Ao mesmo tempo, separa os 20 imóveis com mais chance de interessar. Desconhecidos e números ocultos dizem o nome antes de qualquer visita ou cadastro.

:::tip[Fica entre você e seu assistente]
Códigos internos do onOffice nunca são lidos em voz alta, e imóveis fora da regra escolhida ficam invisíveis para o assistente.
:::

## Durante a ligação

- **Encontrar o imóvel**: "o apartamento da Rua Harmonia" ou "a casa de R$ 850 mil" bastam. A busca usa rua, região, compra ou aluguel, tipo, cômodos, orçamento ou código do anúncio.
- **Responder**: preço e custos, área, andar, ano, estado, animais e disponibilidade, só o que foi perguntado.
- **Agendar visita**: oferece só horários livres do corretor, soletra o sobrenome, recapitula e agenda após o "sim".
- **Cadastrar interessado**: em compra ou aluguel, reaproveitando o contato se ele já existir.

## Depois da ligação

A ligação entra no registro de atividades com resumo, duração e link para a conversa em [Conversas](/app/inbox), vinculada ao imóvel e à visita quando houver. Quem ligou pela primeira vez sem dizer o nome ganha um contato com o telefone, se **Cadastrar interessados** estiver ligado.

## Teste a integração

Ligue de um celular salvo num contato de teste e agende uma visita para amanhã. Confira o compromisso na agenda do corretor e a ligação no registro de atividades.

## Bom saber

- **Agenda**: a partir do dia seguinte, fins de semana incluídos; qualquer compromisso ocupa o horário.
- **Sem corretor nem Corretor padrão**, não há agendamento.
- **Números ocultos**: sem reconhecimento, visita ou cadastro.
- **Formato do número**: o reconhecimento compara o número de quem liga com os telefones dos contatos; cadastre-os com código do país e DDD (ex.: +55 11 90000-0158) para evitar falhas.
- **E-mail provisório**: contatos novos recebem um e-mail temporário; troque pelo real.

## Se algo não estiver funcionando

| Mensagem | O que verificar |
|---|---|
| O onOffice recusou este token e este secret. | Copie os dois de novo, sem espaços. O módulo de API está contratado? |
| Seu assistente não conhece um imóvel | Ele está ativo e dentro da regra escolhida? |
| Seu assistente não agenda visitas | **Agendar visitas** está ligado? Há corretor ou **Corretor padrão**? |
| Visitas ou ligações não aparecem | O usuário de API pode escrever em calendário e registro de atividades? |

:::tip[Precisa de ajuda?]
Use o botão **Suporte** no topo desta central e conte o que aconteceu. A gente ajuda a encontrar o ajuste.
:::`,
  },

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  {
    section: 'integrations',
    slug: 'pipedrive',
    title: 'Pipedrive',
    description: 'Seu assistente reconhece clientes pelo Pipedrive, informa o andamento de negócios e projetos, agenda com o vendedor certo e registra cada ligação.',
    source: '[197]',
    related: ['get-started/troubleshooting', 'actions/appointments', 'integrations/teamleader'],
    keywords: ['pipedrive', 'crm', 'negócios', 'deals', 'vendas', 'agenda do vendedor', 'token de api'],
    body: `Com o Pipedrive conectado, seu assistente atende como um vendedor veterano: cumprimenta cada cliente pelo nome, sabe em que pé está o negócio ou o projeto e marca reuniões direto na agenda da pessoa certa. Depois de cada ligação, a equipe encontra um resumo no contato.

:::warning[Acesso antecipado]
O Pipedrive ainda não está liberado para todas as contas. Se ele não aparecer em [Integrações](/app/integrations), peça a liberação pelo botão **Suporte** no topo desta central.
:::

::::steps
### Copie seu token de API no Pipedrive
Abra **Configurações → Preferências pessoais → API** e copie o token pessoal, de 40 caracteres. O assistente age como o dono do token: vê só o que ele vê e cria registros em nome dele. Prefira um administrador.

### Conecte o Pipedrive à Kloel
Em [Integrações](/app/integrations), adicione **Pipedrive** e preencha **Domínio da empresa** (só a primeira parte do endereço da sua conta) e **Token de API**. O token fica no servidor; o assistente nunca o vê. Ao salvar, a Kloel confere a conexão.

~~~text
Domínio da empresa: bemviver
Token de API:       9b3f0c…e17a
~~~

### Escolha o que seu assistente pode fazer
- **Nome**: padrão **Pipedrive**.
- **Informar negócios** (ligado): etapa e se está aberto ou ganho. Em **Campos de negócio que podem ser informados**, libere campos próprios, como data de entrega.
- **Informar projetos** (ligado): fase, datas previstas e marcos.
- **Registrar ligações** (ligado).
- **Agendar compromissos** (ligado): habilita as opções abaixo.
- **Quem recebe o compromisso**: dono do negócio; sem negócio, dono do contato; para quem é novo, o usuário padrão.
- **Usuário padrão** (vazio): sem ele, não há agendamento para quem liga pela primeira vez.
- **Tipo de atividade para visitas** (padrão **Reunião**) e **para compromissos remotos** (padrão **Chamada**).
- **Duração do compromisso (minutos)**: padrão 60.
- **Horários**: lembrete. Segunda a sexta, 08:00 às 18:00, no fuso do vendedor (por exemplo, São Paulo), a partir do dia útil seguinte. Para restringir, use o [prompt](/ajuda/get-started/write-a-great-prompt).
::::

::mockup{kind="integration-config" name="Pipedrive" mode="credentials" caption="Conexão do Pipedrive com domínio da empresa e token de API"}

## Antes da ligação

O assistente procura o número pelo **telefone principal** dos contatos. Encontrando, já sabe nome, empresa, negócios e projetos, inclusive os da empresa. Exemplo: o Rafael, da Construtora Horizonte, liga para saber quando chegam as esquadrias, e o assistente já conhece o negócio e a data de entrega.

Número ausente, privado ou de mais de um contato: o assistente ajuda sem revelar negócios ou projetos.

:::tip[Fica entre você e seu assistente]
O assistente só fala dos negócios de quem está na linha e nunca confirma nada sobre outras pessoas.
:::

## Durante a ligação

- **Andamento**: responde com o que está no Pipedrive; se faltar a informação, promete retorno. Nunca inventa progresso.
- **Compromissos**: pergunta se a pessoa prefere visita (pedindo o endereço) ou conversa remota, oferece só horários livres do vendedor, recapitula e agenda após o "sim". Quem é novo informa o nome e vira contato.
- **Imprevistos**: horário ocupado gera nova oferta; falha do Pipedrive é comunicada com sinceridade.

## Depois da ligação

A ligação aparece no contato com horário, duração, resumo e links para a conversa e a gravação, vinculada à empresa e ao negócio. Desconhecido não cadastrado não gera registro. Na Kloel, confira em [Conversas](/app/inbox).

## Teste a integração

Use seu celular como telefone principal de um contato de teste, ligue e marque uma reunião. Confira a atividade na agenda e o resumo no contato.

## Bom saber

- **Até 10 de cada**: os 10 negócios e 10 projetos mais recentes; perdidos e cancelados ficam de fora.
- **A empresa inteira conta**: qualquer contato da empresa ouve sobre os negócios dela.
- **Projetos** exigem o complemento Pipedrive Projects.
- **Agenda só do Pipedrive**: bloqueiam horário apenas atividades com hora e status ocupado.

## Se algo não estiver funcionando

| Mensagem | O que verificar |
|---|---|
| Informe só a primeira parte do endereço do Pipedrive. | Use apenas o subdomínio, como \`bemviver\`. |
| O Pipedrive recusou este token de API. | Copie o token de novo; ele é desta conta? |
| Seu assistente não reconhece um cliente | O número é o telefone principal de um único contato? |
| Seu assistente não agenda para quem é novo | Há um **Usuário padrão** ativo? |
| Nada aparece no contato depois | **Registrar ligações** está ligado? |

:::tip[Precisa de ajuda?]
Clique em **Suporte** no topo desta central e conte o que aconteceu. A gente olha com você.
:::`,
  },

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  {
    section: 'integrations',
    slug: 'servicetitan',
    title: 'ServiceTitan',
    description: 'Seu assistente transforma cada ligação com pedido de serviço real em uma reserva no ServiceTitan, pronta para a equipe agendar.',
    source: '[198]',
    related: ['get-started/troubleshooting', 'get-started/write-a-great-prompt'],
    keywords: ['servicetitan', 'field service', 'reserva', 'booking', 'ordem de serviço', 'manutenção'],
    body: `Com o ServiceTitan conectado, nenhum chamado se perde entre o telefone e a programação da equipe. Depois de cada ligação com pedido de verdade, seu assistente deixa uma reserva bem anotada, como um colega que escreve o recado completo antes de passar adiante. A equipe a encontra em **Calls → Bookings**, com a tag **kloel.ai**, e pode transformá-la em job.

:::warning[Acesso antecipado]
O ServiceTitan ainda não está liberado para todas as contas. Se ele não aparecer em [Integrações](/app/integrations), peça a liberação pelo botão **Suporte** no topo desta central.
:::

::::steps
### Reúna quatro credenciais no ServiceTitan
Com perfil de administrador no ServiceTitan:

1. No portal de desenvolvedores do ServiceTitan, crie um aplicativo de API para o seu tenant com leitura e escrita em **CRM → Bookings** e **CRM → Booking Provider Tags**. Nada além disso.
2. Copie a **App key** do aplicativo salvo.
3. No ServiceTitan, abra **Settings → Integrations → API Application Access**, conecte o aplicativo e autorize.
4. Copie na hora o **Client ID** e o **Client secret** (este aparece uma única vez). O **Tenant ID** fica na mesma tela.

### Conecte o ServiceTitan à Kloel
Em [Integrações](/app/integrations), adicione **ServiceTitan** e preencha os quatro campos. O Tenant ID tem só dígitos.

~~~text
Tenant ID:     1029384756
App key:       ak1.exemplo…
Client ID:     cid.exemplo…
Client secret: cs1.exemplo…
~~~

Ao salvar, a Kloel valida a conexão e cria no ServiceTitan a tag de provedor de reservas **kloel.ai**.

### Escolha o que seu assistente pode fazer
Só existe **Nome** (padrão **ServiceTitan**). O envio da reserva após cada ligação é automático.
::::

::mockup{kind="integration-config" name="ServiceTitan" mode="credentials" caption="Conexão do ServiceTitan com Tenant ID, App key, Client ID e Client secret"}

## Antes da ligação

Esta integração não consulta o ServiceTitan antes de atender: os escopos liberados servem só para criar reservas. Para colher bons dados, oriente no [prompt](/ajuda/get-started/write-a-great-prompt) que o assistente pergunte endereço completo, problema e quando haverá alguém no local.

:::tip[Fica entre você e seu assistente]
A reserva leva só o que a pessoa disse. O link da ligação abre na Kloel, então apenas quem tem acesso à sua conta ouve a gravação.
:::

## Durante a ligação

O assistente conversa normalmente e entende a necessidade. Se perguntarem se o pedido foi anotado, explica que ele segue para a equipe logo após a ligação e que vocês entrarão em contato para agendar. Dia e horário nunca são prometidos, porque quem programa a visita é a equipe.

## Depois da ligação

O assistente avalia se houve pedido real: conserto, orçamento ou retorno. Trote, engano, spam, oferta de vendas e ligação sem pedido não geram reserva. Quando há pedido, a reserva chega sem confirmação e traz:

- nome dito pela pessoa (ou o telefone) e e-mail, se informado;
- endereço só quando completo, com rua, cidade, estado, CEP e país;
- indicação de cliente novo, apenas se mencionada;
- nota curta com necessidade, local, urgência, horários, acesso e pendências;
- link para a ligação na Kloel.

Exemplo: o Sr. Antônio liga do +55 11 90000-0164 porque o aquecedor está vazando e só haverá alguém em casa depois das 15h. Quem programa lê exatamente isso. O resultado de cada envio aparece em [Conversas](/app/inbox).

## Teste a integração

Ligue interpretando um cliente real, com endereço e problema concretos; uma ligação claramente de teste é descartada. Depois, procure a reserva em **Calls → Bookings**.

## Bom saber

- **Uma reserva por ligação**, mesmo com novas tentativas.
- **Sem número de reserva durante a ligação**: ela só existe depois.
- **Sem e-mail de confirmação**: a equipe faz contato ao agendar.
- **Endereço incompleto** vai apenas para a nota.
- **Número oculto**: a reserva fica sem telefone e, sem nome, aparece como chamador desconhecido.
- **Mantenha a tag kloel.ai ativa** em **Settings → Integrations → Booking Provider Tags**.

## Se algo não estiver funcionando

| Mensagem | O que verificar |
|---|---|
| O ServiceTitan recusou este Client ID e Client secret. | Copie de novo em **API Application Access**; se perdeu o secret, gere outro. |
| O ServiceTitan recusou o acesso. | O aplicativo tem leitura e escrita nos dois escopos? |
| A tag kloel.ai está inativa no ServiceTitan. | Reative-a em **Booking Provider Tags**. |
| Uma ligação não virou reserva | Houve pedido real? Se a conversa mostrar **Falhou**, confira se o aplicativo segue conectado. |

:::tip[Precisa de ajuda?]
Clique em **Suporte** no topo desta central e informe a conversa que não gerou reserva. A gente investiga com você.
:::`,
  },

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  {
    section: 'integrations',
    slug: 'shopify',
    title: 'Shopify',
    description: 'Seu assistente informa onde está o pedido, ajuda a comprar e cuida de devoluções, trocas e cancelamentos direto na sua loja Shopify.',
    source: '[199]',
    related: ['get-started/troubleshooting', 'actions/sms', 'integrations/woocommerce'],
    keywords: ['shopify', 'loja virtual', 'e-commerce', 'pedido', 'rastreio', 'devolução', 'troca', 'cancelamento'],
    body: `Com o Shopify conectado, seu assistente conhece a loja como o vendedor que lembra de cada cliente: reconhece compradores pelo telefone, diz onde está o pacote ou quanto custa um produto e resolve devoluções, trocas e cancelamentos na própria ligação, sem ninguém caçar número de pedido.

:::warning[Acesso antecipado]
O Shopify ainda não está ativado para todas as contas. Se ele não aparecer em [Integrações](/app/integrations), peça a liberação pelo botão **Suporte** no topo desta central.
:::

::::steps
### Conecte sua loja
Em [Integrações](/app/integrations), adicione **Shopify** e clique em **Conectar**. O Shopify abre a tela de autorização da conexão: confirme o acesso, no mesmo navegador em que você está logado na Kloel. De volta, a loja aparece em **Conexão**.

O assistente passa a ler produtos, clientes e pedidos, montar carrinhos e solicitar devoluções, trocas e cancelamentos, sem alterar produtos, preços ou configurações. Cada conexão vale para uma loja; para outras, use **Conectar outro**.

### Escolha o que seu assistente pode fazer
Tudo vem ativado:

- **Nome**: padrão **Shopify**.
- **Nome do remetente do SMS**: padrão **Kloel**, até 11 letras ou números, como \`LojaAurora\`.
- **Consultas de pedidos**: itens, entrega, previsão e localização do pacote.
- **Compras online**: monta o carrinho e envia link de pagamento por SMS.
- **Solicitar devoluções** e **Solicitar trocas**: a aprovação continua no painel do Shopify.
- **Cancelar pedidos**: cancela e reembolsa na hora, sem aprovação prévia.
- **Carregar pedidos antes da ligação**: aparece com **Consultas de pedidos**; pré-carrega os cinco pedidos mais recentes.

Com qualquer opção ligada, o assistente também informa produtos, preços e estoque.
::::

:::warning[Os links vão por SMS]
Rastreio e pagamento dependem de SMS na conta. Se o envio estiver desativado, contrate um pacote ou ative a compra automática de complementos em [Faturamento](/app/billing).
:::

::mockup{kind="integration-config" name="Shopify" mode="oauth" caption="Shopify conectado por autorização, com a loja listada em Conexão"}

## Antes da ligação

Quando o telefone toca, o assistente procura o número na loja e carrega os cinco pedidos mais recentes, com itens e situação. Assim, quando a Camila liga do +55 11 90000-0171 por causa do tênis, ele já sabe de qual pedido se trata. Quem não tem pedidos ou oculta o número é tratado como cliente novo.

:::tip[Fica entre você e seu assistente]
O assistente só fala de pedidos feitos com o número de quem liga e nunca lê códigos de rastreio em voz alta: oferece enviá-los por SMS.
:::

## Durante a ligação

- **Onde está meu pedido?** Conta o que foi comprado, como está sendo entregue e quando chega.
- **Produto e estoque**: "tem a camiseta azul no M?" vira consulta real de preço, tamanho e estoque.
- **Compra**: monta o carrinho e envia o link de checkout. Pagamento por telefone, nunca.
- **Devolução e troca**: confere os itens elegíveis e usa os motivos da loja. A solicitação fica em análise; o assistente nunca diz que foi aprovada.
- **Cancelamento**: confirma pedido e intenção; o Shopify cancela, reembolsa e avisa o cliente. Pedido já enviado recebe oferta de devolução.

## Depois da ligação

Não há registro extra: solicitações e cancelamentos já ficam no pedido. A conversa fica em [Conversas](/app/inbox).

## Teste a integração

Faça um pedido de teste com o seu celular no cadastro, ligue desse número e peça uma troca. Evite testar cancelamento em pedido real: ele é imediato.

## Bom saber

- **Número oculto**: sem busca de pedidos, mas a compra continua; o assistente pergunta para qual número enviar o link.
- **O que está à venda**: produtos ativos em ao menos um canal de vendas.
- **Cancelamentos não se desfazem**: desligue **Cancelar pedidos** para revisar cada um.

## Se algo não estiver funcionando

| Mensagem | O que verificar |
|---|---|
| Falha na troca de token OAuth2 | Refaça a conexão e autorize no navegador logado na Kloel. |
| *Sua loja* (reconexão necessária) | Clique em **Conectar outro**, autorize e escolha a nova conexão. |
| O envio de SMS está desativado | Contrate um pacote de SMS. |
| Seu assistente não encontra os pedidos | O telefone está no pedido ou no perfil? |
| Oferece devolução em vez de cancelar | O pedido provavelmente já foi enviado. |

:::tip[Precisa de ajuda?]
Clique em **Suporte** no topo desta central e conte o que aconteceu. A gente resolve com você.
:::`,
  },

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  {
    section: 'integrations',
    slug: 'simplybook',
    title: 'SimplyBook.me',
    description: 'Seu assistente consulta horários livres e agenda, remarca ou cancela atendimentos direto na sua agenda do SimplyBook.me.',
    source: '[201]',
    related: ['get-started/troubleshooting', 'actions/appointments', 'actions/sms'],
    keywords: ['simplybook', 'simplybook.me', 'agenda', 'agendamento', 'remarcar', 'cancelar', 'reserva de horário'],
    body: `Com o SimplyBook.me conectado, seu assistente trabalha como a recepcionista com a agenda aberta na tela: informa horários livres, marca o que a pessoa escolher e, para clientes frequentes, também remarca ou cancela.

:::warning[Acesso antecipado]
O SimplyBook.me ainda não está liberado para todas as contas. Se ele não aparecer em [Integrações](/app/integrations), peça a liberação pelo botão **Suporte** no topo desta central.
:::

::::steps
### Pegue as chaves no SimplyBook.me
No painel, abra **Custom Features**, ative **API** e abra a página dela. Copie a chave da **API JSON-RPC** (não a da REST) e a chave secreta logo abaixo.

Para reconhecer clientes frequentes e alterar agendamentos antigos, crie também um usuário com acesso à agenda, de preferência exclusivo para a Kloel.

### Conecte o SimplyBook.me à Kloel
Em [Integrações](/app/integrations), adicione **SimplyBook.me** e preencha:

- **Login da empresa**: a primeira parte do endereço de agendamento, como \`bemviver\`.
- **Chave de API** e **Chave secreta**: as duas do passo anterior.
- **Usuário admin (opcional)** e **Senha do usuário admin (opcional)**: o login desse usuário, como \`recepcao@exemplo.com.br\`. Preencha os dois ou nenhum.

Ao salvar, a Kloel confere a conexão e aponta o que faltar.

### Escolha o que seu assistente pode fazer
- **Nome**: padrão **Agendamentos**.
- **Serviços que podem ser agendados**: padrão **Todos os serviços**, com o assistente perguntando o serviço antes.
- **Profissional**: padrão **Primeiro disponível**.
- **Antecedência máxima (dias)**: padrão 14, máximo 60.
- **Gerenciar agendamentos** (ligado): agenda após o "sim" e remarca ou cancela; com usuário admin, também agendamentos antigos. Desligado, só informa horários.
- **Pedir e-mail a quem liga** (desligado): o SimplyBook.me exige e-mail. Sem a opção, vale o e-mail salvo ou um endereço provisório gerado a partir do telefone; com ela, o assistente pede e soletra, o que alonga a ligação. Escolha uma vez e mantenha, para não gerar dois endereços para a mesma pessoa.
- **Enviar confirmação por SMS** (ligado): serviço, dia e hora.
- **Antecedência mínima para alterações (horas)**: padrão 2; 0 significa sem limite.
::::

::mockup{kind="integration-config" name="SimplyBook.me" mode="credentials" caption="Conexão do SimplyBook.me com login da empresa, chaves e usuário admin opcional"}

## Antes da ligação

O assistente já conhece seus serviços. Com usuário admin, procura o número na lista de clientes e sabe nome, próximos agendamentos e última visita. Exemplo: a Fernanda liga para remarcar a limpeza de pele de quinta na Clínica Bem Viver e não precisa de número de reserva. Desconhecidos e números ocultos são clientes novos.

:::tip[Fica entre você e seu assistente]
O assistente nunca diz que procurou alguém, só cita visitas anteriores quando ajudam e não lê números de reserva.
:::

## Durante a ligação

O assistente pergunta o serviço e oferece o primeiro dia livre, ou busca a partir do dia preferido. Antes de marcar, repete dia, hora e serviço e espera um "sim" claro; "talvez" não vale. Horário tomado nesse meio-tempo é avisado com sinceridade.

Remarcações e cancelamentos respeitam a antecedência mínima; abaixo dela, o assistente anota um recado. Sinal e pagamento ficam com você: dados de cartão nunca são pedidos.

## Depois da ligação

O agendamento aparece na agenda com nome e telefone, e a pessoa recebe o SMS. A conversa fica em [Conversas](/app/inbox).

## Teste a integração

Ligue, marque um serviço para amanhã e, na mesma ligação, peça para remarcar. Confira se ficou um único horário na agenda e se o SMS chegou.

## Bom saber

- **Sem usuário admin**: só altera o que marcou na mesma ligação; para os antigos, indica os links do e-mail de confirmação.
- **Client Rescheduling desligado**: a remarcação vira agendamento novo mais cancelamento do antigo.
- **Login obrigatório para clientes**: o assistente não consegue agendar e anota um recado.
- **Só serviços públicos** são oferecidos.
- **Número oculto**: sem reconhecimento nem SMS. Mais em [Enviar SMS](/ajuda/actions/sms).

## Se algo não estiver funcionando

| Mensagem | O que verificar |
|---|---|
| Preencha o login da empresa. | Use só a primeira parte do endereço de agendamento. |
| O SimplyBook.me recusou estas credenciais. | Login exato, API ativa e chave JSON-RPC copiada da mesma tela da secreta? |
| Nenhum serviço visível publicamente. | Deixe ao menos um visível em **Manage → Services**. |
| O login do usuário admin não foi aceito. | Confira e-mail e senha ou deixe os dois vazios. |
| Remarcação aparece como agendamento novo | Ative **Client Rescheduling** em **Custom Features**. |

:::tip[Precisa de ajuda?]
Clique em **Suporte** no topo desta central e diga qual agendamento não saiu como esperado. A gente verifica com você.
:::`,
  },

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  {
    section: 'integrations',
    slug: 'slack',
    title: 'Slack',
    description: 'Seu assistente publica os dados de uma ligação no canal do Slack em que sua equipe trabalha, antes, durante ou depois da conversa.',
    source: '[202]',
    related: ['actions/email', 'get-started/troubleshooting', 'integrations/zapier'],
    keywords: ['slack', 'canal', 'notificação', 'alerta', 'mensagem automática', 'workspace', 'variáveis'],
    body: `Com a integração do Slack, a Kloel publica uma mensagem automática num canal da equipe antes, durante ou depois de uma conversa. Se o time vive no Slack, os pedidos chegam onde todos já estão olhando, e fica claro na hora o que aconteceu e quem vai cuidar.

::::steps
### Adicione o Slack e escolha quando ele roda
Em [Integrações](/app/integrations), adicione **Slack** e dê um nome claro, como "Urgências da recepção". Em **Execução**, escolha:

- **Antes da conversa**: só dados básicos, como número de quem liga e assistente chamado.
- **Durante a conversa**: o assistente decide o momento conforme **Quando a IA deve usar isso?**, por exemplo "Se a pessoa disser que é urgente, avise no Slack."
- **Após a conversa**: tudo o que foi coletado.

Ao lado, defina a janela: **A qualquer momento**, **Durante o horário de funcionamento** ou **Fora do horário de funcionamento**.

### Conecte seu workspace
Clique em **Conectar** e escolha o workspace. O Slack pede permissão para ler e enviar mensagens em canais e conversas, e a conexão vale para o workspace inteiro. Avalie bem se houver canais sensíveis.

### Escolha o canal
Na aba **Configurações**, selecione o canal, de preferência um que a equipe acompanhe de verdade.

:::warning[Canais privados]
Adicione antes o app da Kloel como membro. Até lá, o canal pode não aparecer ou a mensagem pode não chegar.
:::

### Escreva a mensagem
Em **Modelo de mensagem**, **Adicionar variável** insere dados como nome e número do assistente, número de quem liga, direção e horário, motivo do encerramento, nome da empresa, link da conversa e contato. Um "?" marca variável que nem sempre existe; o ícone de informação mostra o valor. Comece pelo essencial e inclua o link.

~~~text
Nova ligação de {{personNumber}}
Assunto: {{assunto}}
Precisa de retorno: {{precisa_retorno}}
{{conversationLink}}
~~~

### Crie suas variáveis
Escreva \`{{nome_da_variavel}}\` no modelo e ela aparece em **Variáveis personalizadas**. Defina o tipo (**Texto**, **Número** ou **Booleano**) e uma descrição precisa; sem ela, **Salvar** fica desativado. Em vez de "Assunto", prefira "O motivo da ligação, resumido em uma frase".
::::

::mockup{kind="integration-config" name="Slack" mode="action" caption="Slack com execução, janela de horário, canal e modelo de mensagem"}

## Antes da ligação

Só valores já conhecidos funcionam: telefone, assistente, empresa e horário. Variáveis personalizadas ficam vazias, porque a conversa ainda não começou. Serve para avisar que uma ligação está entrando.

:::tip[Fica entre você e seu assistente]
Quem liga não percebe nada: a mensagem sai em segundo plano. Mande ao canal só o que a equipe precisa saber.
:::

## Durante a ligação

É a escolha para urgências: com uma regra clara, a equipe reage enquanto a pessoa ainda está na linha.

## Depois da ligação

É o uso mais comum, porque a mensagem pode trazer tudo o que foi dito. Ideias:

- **Leads para vendas**: empresa, pedido e orçamento estimado como variáveis personalizadas, no canal comercial.
- **Plantão**: janela **Fora do horário de funcionamento** e o canal do plantão.
- **Por assunto**: adicione o Slack várias vezes, cada um com canal e regra próprios.

::mockup{kind="message" channel="slack" text="Nova ligação de +55 11 90000-0142 · Assunto: segunda via de boleto · Precisa de retorno: sim" caption="Exemplo de mensagem publicada no canal da equipe"}

## Slack ou e-mail?

O Slack serve para o time interno reagir rápido; o [e-mail](/ajuda/actions/email), para pessoas de fora ou registro permanente. Dá para combinar os dois.

## Teste a integração

Faça uma **Ligação de teste** no assistente mencionando a informação que deve disparar a mensagem e confira o canal. Se algum campo vier vazio, veja na transcrição em [Conversas](/app/inbox) se o dado foi mesmo dito.

## Bom saber

- **Uma integração, um canal**: para outros destinos, adicione o Slack de novo.
- **Dado não dito fica vazio**: o assistente não inventa valores.

## Se algo não estiver funcionando

| Mensagem | O que verificar |
|---|---|
| As variáveis chegam vazias | A **Execução** está em **Antes da conversa**? |
| Uma variável fica vazia só às vezes | A informação foi mencionada na conversa? |
| Nada chega num canal privado | O app da Kloel é membro do canal? |
| Um canal não aparece na lista | Ele é privado ou de outro workspace? |
| **Salvar** continua desativado | Falta descrição em alguma variável personalizada? |
| A integração não roda em toda ligação | A janela de horário está limitando? |

:::tip[Precisa de ajuda?]
Clique em **Suporte** no topo desta central e conte o que aconteceu. A gente olha a configuração com você.
:::`,
  },

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  {
    section: 'integrations',
    slug: 'stora',
    title: 'Stora',
    description: 'Seu assistente reconhece clientes do Stora, informa os boxes livres com preço e abre um deal para cada pessoa que quer alugar.',
    source: '[203]',
    related: ['get-started/troubleshooting', 'get-started/contacts'],
    keywords: ['stora', 'self storage', 'guarda-volumes', 'box', 'aluguel de box', 'deal', 'inquilino'],
    body: `O Stora é um sistema de gestão de self storage. Conectado à Kloel, ele permite que seu assistente reconheça inquilinos pelo número, lembre o que perguntaram da última vez, informe boxes livres com preço e abra um deal no CRM do Stora para quem quer alugar, como um colega que conhece bem a clientela.

::::steps
### Conecte o Stora
Em [Integrações](/app/integrations), adicione **Stora**, clique em **Conectar**, entre com sua conta e autorize.

O assistente passa a ver unidades, boxes, preços e promoções; ler contatos, faturas e deals; criar contatos e deals; e adicionar registros à timeline. Nada além disso.

### Escolha o que seu assistente pode fazer
- **Nome**: padrão **Stora**.
- **Unidade**: obrigatória para salvar; boxes e deals são só dela.
- **Permitir criar deals de interessados** (ligado): desligado, o assistente apenas informa a disponibilidade e convida a pessoa a ligar no horário de atendimento, sem prometer retorno.
- **Etapa dos novos deals**: aparece com a opção anterior. Em branco, vale a primeira etapa do pipeline.
::::

::mockup{kind="integration-config" name="Stora" mode="oauth" caption="Stora conectado por autorização, com unidade e etapa dos novos deals"}

## Antes da ligação

O assistente procura o número e descobre se a pessoa é inquilina atual, ex-inquilina ou só pediu informações, além de faturas em aberto ou vencidas e deals abertos. A partir disso:

- inquilinos atuais recebem primeiro ajuda com aluguel, faturas ou acesso;
- ex-inquilinos e interessados são tratados como nova reserva;
- com fatura vencida, não há novo aluguel: o assistente cita o saldo e oferece passar para a equipe;
- com deal aberto, retoma de onde parou. A Patrícia ouve algo como "Vi que já temos seu pedido; é sobre o mesmo box?", e outro deal só nasce se o pedido for novo;
- desconhecidos que querem alugar informam nome completo e e-mail.

:::tip[Fica entre você e seu assistente]
O assistente nunca diz que procurou alguém e só fala de aluguéis ou faturas quando isso importa para a ligação.
:::

## Durante a ligação

Quando perguntam o que está livre, o assistente consulta a unidade na hora, sem exigir o tamanho antes. Informa o nome de cada tipo de box, a descrição de tamanho e o preço mensal, com promoções ativas e sua duração. A descrição é lida como está no Stora, então vale escrever o que cabe ali:

~~~text
Comporta os móveis de um quarto e cerca de 20 caixas.
~~~

Tipos ocultos nunca são oferecidos. Quem quer alugar ganha um deal antes do fim da ligação, com nota sobre o desejo, o tipo de box e a data de entrada. Quem é novo vira contato com o telefone, e a timeline recebe um registro **Lead recebido**.

## Depois da ligação

A timeline recebe um registro **Ligação recebida** com resumo e link para a conversa, que também fica em [Conversas](/app/inbox). Se a pessoa não estava no Stora e não deixou dados, nada é registrado.

## Teste a integração

Ligue de um número salvo num contato de teste, pergunte pelos boxes livres e diga que quer alugar. Confira o deal na etapa escolhida e o registro na timeline.

## Bom saber

- **Telefone com código do país**: salve como +55 11 90000-0158 para que todos sejam encontrados.
- **Número oculto**: sem reconhecimento; para abrir deal, o assistente pede nome e e-mail e salva o contato sem telefone.
- **Até cinco tipos de box**: os com mais unidades livres.
- **Sem pagamento nem reserva de box**: a equipe assume a partir do deal.
- **Contatos existentes não mudam**: o assistente só cria novos.
- **Fatura vencida** é toda fatura finalizada ainda não paga.
- **Só ligações recebidas** geram registro.

## Se algo não estiver funcionando

As mensagens aparecem na conversa correspondente, em [Conversas](/app/inbox).

| Mensagem | O que verificar |
|---|---|
| Stora (reconexão necessária) | Clique em **Conectar** e entre de novo. |
| Sua unidade não aparece na lista | Conecte com uma conta que enxergue essa unidade. |
| Não há boxes disponíveis nesta unidade. | A **Unidade** está certa e os boxes, marcados como disponíveis? |
| Não foi possível criar o contato no Stora. | Reconecte. Se o e-mail já é de um contato, adicione o telefone a ele. |
| Não foi possível abrir o deal no Stora. | A **Etapa dos novos deals** ainda existe? |

:::tip[Precisa de ajuda?]
Clique em **Suporte** no topo desta central e diga qual ligação deu errado. A gente ajuda com prazer.
:::`,
  },

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  {
    section: 'integrations',
    slug: 'teamleader',
    title: 'Teamleader',
    description: 'Seu assistente reconhece clientes do Teamleader, informa em que pé estão os deals e deixa uma nota no registro depois de cada ligação.',
    source: '[204]',
    related: ['get-started/troubleshooting', 'integrations/pipedrive'],
    keywords: ['teamleader', 'teamleader focus', 'crm', 'deals', 'nota de ligação', 'contato'],
    body: `Com o Teamleader conectado, seu assistente sabe quem está ligando, de qual empresa a pessoa é e o que ainda está em aberto com ela, como um colega que acompanha de perto a carteira. Depois de cada ligação, uma nota curta fica no registro e, se você quiser, um colega recebe aviso.

:::warning[Acesso antecipado]
O Teamleader ainda não está ativado para todas as contas. Se ele não aparecer em [Integrações](/app/integrations), peça a liberação pelo botão **Suporte** no topo desta central.
:::

::::steps
### Conecte o Teamleader
Em [Integrações](/app/integrations), adicione **Teamleader**, clique em **Conectar**, entre com sua conta do Teamleader Focus e autorize.

O assistente passa a ler e atualizar contatos, ler empresas e deals e ver os membros da equipe. Nada além disso. Ele enxerga o que a conta autorizadora enxerga, então use uma com acesso amplo.

### Escolha o que seu assistente pode fazer
O reconhecimento pelo número está sempre ativo. O resto é com você:

- **Nome**: padrão **Teamleader CRM**.
- **Falar sobre deals abertos** (ligado): etapa e responsável, sem alterar nada. Desligado, nem confirma que há algo em aberto.
- **Notificar este colega**: quem recebe aviso a cada nota. Padrão **Ninguém**.
- **Corrigir dados de contato** (desligado): atualiza nome ou e-mail na hora, mantendo os e-mails antigos. Desligado, a correção vai na nota.
- **Campo extra que pode preencher**: um campo personalizado de contato, como número de cliente. Padrão **Nenhum campo extra**.
- **Cadastrar quem liga pela primeira vez** (desligado): cria o contato quando a pessoa diz o sobrenome.
::::

::mockup{kind="integration-config" name="Teamleader" mode="oauth" caption="Teamleader conectado por autorização, com as opções do assistente"}

## Antes da ligação

O assistente procura o número e conhece nome, e-mail, tags, endereço, informações de contexto e as empresas e cargos da pessoa. Exemplo: a Sara liga do +55 11 90000-0183 sobre um orçamento e já é cumprimentada como cliente da Padaria Pão de Mel.

Se o número é de uma empresa, o assistente conhece a empresa e seu pessoal, mas pergunta com quem fala antes de qualquer dado pessoal. Sem registro, ou com vários no mesmo número, pergunta quem é.

:::tip[Fica entre você e seu assistente]
O assistente não diz que consultou o cadastro nem quantos registros achou, não lê dados bancários, documentos, nascimento ou dados de terceiros e não cita o Teamleader.
:::

## Durante a ligação

- **Deals**: cita até cinco abertos, com etapa e responsável. Valores, chances e datas de fechamento nunca; a pergunta vai para a nota.
- **Correções**: se permitido, repete o e-mail uma vez, salva e confirma.
- **Campo extra**: preenche o campo escolhido; se ele aceitar só certos valores, pergunta qual.
- **Quem é novo**: pergunta sobrenome e grafia e cadastra em silêncio com o número, o e-mail (se dito) e a empresa (se ligar do número dela). O contato recebe a tag **via Kloel**, após checagem de duplicidade.

Ele nunca altera ou fecha deals, não mexe em empresas e não apaga nada.

## Depois da ligação

A nota vai para o contato (ou para a empresa, ou para o contato recém-criado), assinada pelo assistente da Kloel, com número, horário, resumo e link para a conversa, que também fica em [Conversas](/app/inbox). O colega escolhido é avisado na hora.

## Teste a integração

Ligue de um número salvo num contato de teste com um deal aberto e pergunte pelo andamento. Confira a nota no contato e o aviso ao colega.

## Bom saber

- **Um número, um registro**: com vários registros no mesmo número, a ligação fica sem nota.
- **Qualquer formato de número funciona**.
- **Só registros ativos e deals abertos** entram na conversa.
- **Telefone não muda**: é a chave do reconhecimento.
- **Nada é apagado**.
- **Contexto não é instrução**: ordens escritas nos campos são ignoradas.

## Se algo não estiver funcionando

| Mensagem | O que verificar |
|---|---|
| Teamleader (reconexão necessária) | Clique em **Conectar** e entre de novo. |
| O colega não aparece na lista | Só usuários ativos aparecem. |
| O campo não aparece em **Campo extra que pode preencher** | Só campos personalizados de contato; crie-o antes. |
| Nenhum registro para esta conversa; nota ignorada. | Número oculto, repetido ou cadastro de novos desligado? |
| O CRM recusou a alteração. | A conta autorizada pode ler deals e editar ou criar contatos? |

:::tip[Precisa de ajuda?]
Clique em **Suporte** no topo desta central e conte o que aconteceu. A gente analisa com você.
:::`,
  },

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  {
    section: 'integrations',
    slug: 'thefork',
    title: 'TheFork',
    description: 'Seu assistente reserva mesas direto no TheFork Manager e reconhece clientes habituais pelo número de telefone.',
    source: '[205]',
    related: ['get-started/troubleshooting', 'actions/call-transfer', 'actions/sms'],
    keywords: ['thefork', 'restaurante', 'reserva de mesa', 'thefork manager', 'cliente habitual', 'alergias'],
    body: `Com o TheFork conectado, seu assistente consulta o TheFork Manager como a recepção do restaurante: informa as mesas livres, reserva a escolhida e reconhece os clientes habituais pelo número, inclusive para remarcar ou cancelar.

:::warning[Acesso antecipado]
O TheFork ainda não está ativado para todas as contas. Se ele não aparecer em [Integrações](/app/integrations), peça a liberação pelo botão **Suporte** no topo desta central.
:::

::::steps
### Peça o UUID do restaurante
O restaurante precisa ser gerenciado no TheFork Manager. Não há chave para copiar: peça o **UUID do Restaurante** pelo botão **Suporte**, com nome e endereço da casa. A Kloel cuida dessa parte.

### Conecte o TheFork à Kloel
Em [Integrações](/app/integrations), adicione **TheFork** e cole o código no único campo. Ao salvar, a Kloel avisa se o TheFork não o reconhecer.

~~~text
3c9e2a71-5b04-4d8f-a1c6-7e20f9b4d852
~~~

### Escolha o que seu assistente pode fazer
Consultar mesas e criar reservas está sempre ativo. Além disso:

- **Nome**: padrão **TheFork**.
- **Permitir remarcar ou cancelar mesas** (ligado): desligado, o assistente oferece transferir para a equipe.
- **Pedir o e-mail do cliente ao reservar** (desligado): o TheFork exige e-mail. Sem a opção, vale o já cadastrado ou um substituto gerado a partir do telefone, sem e-mail de confirmação. Com ela, o assistente soletra o endereço, uns 30 segundos a mais.
- **Carregar preferências e alergias do cliente** (desligado): alergias e restrições alimentares são dados pessoais sensíveis pela LGPD. Ative só se o seu aviso de privacidade e o [Acordo de proteção de dados](/ajuda/legal/protecao-de-dados) cobrirem mencioná-los em ligação gravada.
- **Enviar confirmação por SMS em vez de e-mail** (desligado): data, horário e pessoas; se você ainda precisa aceitar, o texto fala em pedido. Cada SMS é cobrado do pacote (aviso **Confirmações por SMS são cobradas**).
- **Nome do remetente do SMS**: padrão **Kloel**, até 11 caracteres.
::::

::mockup{kind="integration-config" name="TheFork" mode="credentials" caption="Conexão do TheFork com o UUID do restaurante"}

## Antes da ligação

Quando o telefone toca, a Kloel avisa o TheFork. O assistente já conhece cardápios e ofertas e procura o número no livro de clientes: nome, próximas reservas (inclusive pendentes) e, se liberadas, preferências. Quando o Marcos liga do +55 11 90000-0195 sobre "minha mesa de sexta", o assistente sabe qual é. Desconhecidos e números ocultos informam nome e sobrenome.

:::tip[Fica entre você e seu assistente]
O assistente cumprimenta o habitual pelo nome, mas não lê o cadastro de volta sem pedido, só cita preferências quando fazem sentido e nunca diz números de reserva.
:::

## Durante a ligação

O assistente pergunta quantas pessoas vêm e se é café da manhã, almoço ou jantar. Para o dia pedido, oferece dois ou três horários; com lotação, sugere os próximos dias livres. Menu fixo obrigatório é avisado com o preço.

Pedidos especiais (janela, cadeirão, aniversário) entram só na criação da reserva, que aparece no TheFork Manager com nome, telefone e a marcação "Reservado via Kloel e TheFork". Se você aceita reservas manualmente, o assistente fala em pedido, nunca em confirmação.

Para remarcar ou cancelar, confirma qual reserva é; se já existe mesa naquele dia, pergunta se é para remarcar essa.

## Depois da ligação

A Kloel avisa o TheFork do fim da ligação. Tudo já está no TheFork Manager, e a conversa fica em [Conversas](/app/inbox).

## Teste a integração

Ligue, reserve uma mesa para dois no jantar de amanhã e depois remarque. Confira no TheFork Manager e cancele a reserva de teste.

## Bom saber

- **Garantia de cartão ou pré-pagamento**: esses horários não são reservados por telefone; o aviso **Horários pré-pagos precisam de um membro da equipe** pede a [transferência de ligações](/ajuda/actions/call-transfer).
- **Até 30 dias à frente**.
- **Só as próprias reservas**, antes de começarem; mudam dia, hora e pessoas.
- **Cancelamento fora do prazo** vira transferência.
- **Número oculto**: pede e-mail antes de reservar e não envia SMS.

## Se algo não estiver funcionando

| Mensagem | O que verificar |
|---|---|
| O TheFork não reconhece este UUID. | Cole o código de novo, sem espaços. |
| O envio de SMS está desativado | Contrate um pacote. Veja [Enviar SMS](/ajuda/actions/sms). |
| Só a equipe pode reservar este horário | Ele exige garantia ou pré-pagamento. |
| Toda alteração vai para a equipe | **Permitir remarcar ou cancelar mesas** está ligado? |
| Um habitual não é reconhecido | O número está no livro de clientes? |

:::tip[Precisa de ajuda?]
Clique em **Suporte** no topo desta central e informe a reserva que deu problema. A gente verifica com você.
:::`,
  },

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  {
    section: 'integrations',
    slug: 'wincasa',
    title: 'WinCasa',
    description: 'Seu assistente reconhece inquilinos pelo número, abre tickets de danos no WinCasa e informa o andamento de cada aviso.',
    source: '[206]',
    related: ['get-started/troubleshooting', 'actions/call-transfer'],
    keywords: ['wincasa', 'software24', 'administração de imóveis', 'inquilino', 'ticket', 'aviso de dano', 'manutenção'],
    body: `O WinCasa é um software de administração de imóveis. Conectado à Kloel, ele permite que seu assistente reconheça inquilinos pelo número e saiba apartamento, rua e administrador responsável, como um colega que cuida do prédio há anos. Quando algo quebra, o assistente abre um ticket e depois registra a ligação no WinCasa.

::::steps
### Peça as credenciais à Software24
A Web-API do WinCasa é configurada pela Software24, fornecedora do sistema. Peça a **Web-API URL**, com o número do seu projeto, e um **Access token** com acesso a inquilinos, imóveis e CRM. Prefira um token exclusivo para a Kloel.

### Conecte o WinCasa à Kloel
Em [Integrações](/app/integrations), adicione **WinCasa** e preencha os dois campos exatamente como recebeu:

~~~text
Web-API URL:  https://<endereço da sua Web-API>/api/v1/<número do projeto>/
Access token: eyJhbGciOi…   (em geral começa assim)
~~~

O token fica guardado com a Kloel, e o assistente nunca o vê. Ao salvar, a conexão é testada.

### Escolha o que seu assistente pode fazer
- **Nome**: padrão **WinCasa**.
- **Aceitar avisos de quem não foi identificado** (ligado): o assistente pede o endereço, encontra o imóvel e marca o ticket como não verificado. Desligado, só inquilinos reconhecidos avisam; há menos spam, mas os telefones precisam estar atualizados, e os demais recebem o contato do administrador.
- **Ler notas do ticket para quem liga** (desligado): sem ela, o assistente só conhece assunto, status e data. Ligue apenas se as notas nunca tiverem comentários internos.
::::

::mockup{kind="integration-config" name="WinCasa" mode="credentials" caption="Conexão do WinCasa com Web-API URL e Access token"}

## Antes da ligação

O assistente procura o número entre os telefones do inquilino: fixo, segundo número e celular, inclusive de um segundo morador. Exemplo: a Renata liga do +55 11 90000-0126 por causa de uma torneira pingando; o assistente a cumprimenta pelo nome e menciona a Rua das Acácias de passagem, sem pedir prova de identidade.

Se vários inquilinos dividem o número, ele pergunta quem fala. Desconhecidos e números ocultos informam o endereço para registrar um aviso.

:::tip[Fica entre você e seu assistente]
O assistente nunca lê nem pede números de imóvel, de ticket ou outro código interno do WinCasa.
:::

## Durante a ligação

- **Avisar um dano**: a pessoa conta com as próprias palavras; o assistente redige assunto e detalhes e só pergunta o que falta, como desde quando ou onde. O ticket aparece no imóvel e no apartamento, com assunto iniciado por **Kloel:** e nota com detalhes, autor e telefone de retorno. Para não reconhecidos, o imóvel é localizado pela rua e o endereço, confirmado. Tickets existentes nunca são alterados nem fechados.
- **Perguntar sobre um aviso anterior**: o assistente confere os tickets do apartamento e informa o status, sem exigir número. Se não houver nada, diz isso com sinceridade.
- **Falar com o administrador**: informa nome e telefone ou, com a [transferência de ligações](/ajuda/actions/call-transfer) configurada, transfere.

## Depois da ligação

A ligação é registrada com resumo, número e duração, no ticket criado ou, sem ticket, no imóvel. A conversa completa fica em [Conversas](/app/inbox).

## Teste a integração

Ligue de um telefone salvo num inquilino de teste, relate um dano simples e pergunte pelo andamento. Confira o ticket com o prefixo **Kloel:** e a ligação registrada nele.

## Bom saber

- **Telefones no WinCasa**: só números cadastrados são reconhecidos, em qualquer formato.
- **Número oculto**: sem reconhecimento nem consulta; aviso novo só com a opção de não identificados ligada.
- **Imóveis arquivados** são ignorados.
- **Inquilino com vários imóveis**: sem ticket novo, a ligação não é registrada.
- **Desconhecido sem aviso**: não há onde registrar.
- **Só ligações recebidas** são registradas.
- **Avisos anteriores**: o assistente vê os 20 tickets mais recentes do apartamento.

## Se algo não estiver funcionando

| Mensagem | O que verificar |
|---|---|
| O WinCasa recusou o Access token. | Cole o token de novo, sem espaços. Ele ainda vale? |
| Não foi possível acessar a Web-API nesta URL. | A URL é a da Software24, com o número do projeto no fim? |
| Seu assistente não reconhece um inquilino | O número está no cadastro? O imóvel está arquivado? O token acessa inquilinos? |
| Seu assistente não aceita um aviso | Ligue **Aceitar avisos de quem não foi identificado** ou cadastre o número. |
| Não aparecem tickets nem ligações | Pergunte à Software24 se o token acessa o CRM. |

:::tip[Precisa de ajuda?]
Clique em **Suporte** no topo desta central e diga qual ligação não foi registrada. A gente ajuda com prazer.
:::`,
  },

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  {
    section: 'integrations',
    slug: 'woocommerce',
    title: 'WooCommerce',
    description: 'Seu assistente responde sobre produtos e pedidos e registra cancelamentos, devoluções, trocas e pedidos por telefone para a sua equipe.',
    source: '[207]',
    related: ['get-started/troubleshooting', 'actions/sms', 'actions/call-transfer', 'integrations/shopify'],
    keywords: ['woocommerce', 'wordpress', 'loja virtual', 'pedido', 'rest api', 'devolução', 'link de pagamento'],
    body: `Com o WooCommerce conectado, seu assistente atende como um vendedor com a loja aberta na tela: informa preço, estoque e situação dos pedidos, e registra cancelamentos, devoluções, trocas e compras por telefone para a equipe. A decisão sobre cada pedido continua sendo sua.

:::warning[Acesso antecipado]
O WooCommerce ainda não está liberado para todas as contas. Se ele não aparecer em [Integrações](/app/integrations), peça a liberação pelo botão **Suporte** no topo desta central.
:::

::::steps
### Gere uma chave REST no WordPress
No WordPress, vá em **WooCommerce → Configurações → Avançado → API REST** e adicione uma chave chamada "Kloel", para um administrador ou gerente da loja, com permissão de **leitura e escrita** (ou só **leitura**, se desligar as funções de escrita). Copie na hora a **Consumer key** e o **Consumer secret**: aparecem uma única vez.

A loja precisa usar https:// e ter os links permanentes em opção diferente de **Simples**.

### Conecte o WooCommerce à Kloel
Em [Integrações](/app/integrations), adicione **WooCommerce** e preencha **Endereço da loja**, **Consumer key** (começa com \`ck_\`) e **Consumer secret** (começa com \`cs_\`). Ao salvar, a Kloel confere se a chave lê produtos e pedidos.

~~~text
https://loja.exemplo.com.br
~~~

### Escolha o que seu assistente pode fazer
Perguntas sobre pedidos, produtos, preços e estoque são sempre respondidas. Além disso:

- **Nome**: padrão **Central da loja**; também é o remetente dos SMS (11 caracteres).
- **Receber pedidos de cancelamento** (ligado): pedidos ainda não concluídos. Só anota; nada é cancelado nem reembolsado.
- **Receber pedidos de devolução e troca** (ligado): pedidos concluídos, sem reembolso nem etiqueta.
- **Aceitar pedidos por telefone** (desligado): salva o pedido sem pagamento e envia link seguro por SMS.
- **Transferir acima deste valor**: na moeda da loja (ex.: R$ 1.500,00); 0 significa sem limite.
- **Mencionar produtos esgotados** (ligado).
- **Produtos por resposta**: padrão 3, máximo 10.
- **Enviar confirmações e links de pagamento por SMS** (ligado).
- **Oferecer encaminhamento quando não puder ajudar** (ligado): [transferência de ligações](/ajuda/actions/call-transfer) ou pedido de retorno.
::::

::mockup{kind="integration-config" name="WooCommerce" mode="credentials" caption="Conexão do WooCommerce com endereço da loja, Consumer key e Consumer secret"}

## Antes da ligação

O WooCommerce não pré-carrega pedidos pelo número: a identificação acontece durante a conversa.

:::tip[Fica entre você e seu assistente]
Se os dados de verificação não baterem, o assistente não confirma nem que o pedido existe.
:::

## Durante a ligação

- **Produtos**: "tem café em grãos de 250 g?" vira busca com nome, preço e estoque, ou o item mais parecido. Nunca chuta preço.
- **Pedidos**: pede o número do pedido. Ligação do telefone do pedido basta; senão, confirma e-mail ou CEP de entrega.
- **Cancelamento**: confere se ainda é possível e espera o "sim". O pedido recebe nota privada "SOLICITAÇÃO DE CANCELAMENTO" com motivo e contato.
- **Devolução e troca**: itens, motivo e substituto em notas "SOLICITAÇÃO DE DEVOLUÇÃO" ou "SOLICITAÇÃO DE TROCA".
- **Pedido por telefone**: produtos, total, nome, e-mail e endereço; após o "sim", salva como aguardando pagamento e envia o link.

Reembolso nunca é prometido, e dados de cartão nunca são pedidos.

## Depois da ligação

Notas e pedidos já estão no WooCommerce. A conversa fica em [Conversas](/app/inbox).

## Teste a integração

Ligue do telefone de um pedido de teste e peça o cancelamento. Confira a nota privada no pedido.

## Bom saber

- **Número oculto**: o assistente pede e-mail ou CEP e não envia SMS.
- **Ligações desviadas**: a central precisa repassar o número de origem; veja [Conecte seu número](/ajuda/get-started/connect-your-number).
- **Pedido por telefone**: até cinco produtos, sem variações; o total não inclui frete.
- **Revogue a chave** se parar de usar a integração.

## Se algo não estiver funcionando

| Mensagem | O que verificar |
|---|---|
| O endereço precisa começar com https:// | Inclua https://. |
| A Consumer key começa com ck_ | Cole a key inteira, não o secret. |
| Não foi possível acessar a API do WooCommerce. | Links permanentes fora de **Simples**? A hospedagem bloqueia o cabeçalho de autorização? |
| Seu assistente não registra cancelamentos | A chave tem permissão de escrita? |
| Seu assistente não aceita pedido por telefone | A opção está ligada? O produto tem variações? |

:::tip[Precisa de ajuda?]
Clique em **Suporte** no topo desta central e informe o pedido envolvido. A gente ajuda com prazer.
:::`,
  },

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  {
    section: 'integrations',
    slug: 'xero',
    title: 'Xero',
    description: 'Seu assistente reconhece quem liga pelos contatos do Xero, cadastra quem é novo e deixa uma nota no contato depois de cada ligação.',
    source: '[208]',
    related: ['get-started/troubleshooting', 'get-started/contacts'],
    keywords: ['xero', 'contabilidade', 'contatos', 'nota de ligação', 'contact code', 'organização'],
    body: `Com o Xero conectado, seu assistente cumprimenta pelo nome as pessoas dos seus contatos, como um colega que conhece os clientes de sempre. Quem liga pela primeira vez pode entrar no cadastro sem você mexer em nada, e cada ligação termina com uma nota curta no contato.

O alcance é só de contatos: faturas, despesas, saldos e orçamentos ficam de fora.

:::warning[Acesso antecipado]
O Xero ainda não está ativado para todas as contas. Se ele não aparecer em [Integrações](/app/integrations), peça a liberação pelo botão **Suporte** no topo desta central.
:::

::::steps
### Conecte o Xero
Em [Integrações](/app/integrations), adicione **Xero**, clique em **Conectar** e entre com sua conta. Com várias organizações no Xero, escolha aquela a que as ligações pertencem e permita o acesso.

O assistente passa a ler contatos, adicionar novos e deixar notas. Nada além disso.

### Escolha o que seu assistente pode fazer
- **Nome**: padrão **Xero**.
- **Organização do Xero**: padrão **A organização autorizada nesta conexão**, que serve quando há só uma.
- **Adicionar quem liga como contato** (desligado): ligado, o assistente cria o contato antes de atender, se a Kloel já souber o nome, ou assim que a pessoa disser. Os novos vão para o grupo **via Kloel**, com o número como código do contato, que é como o assistente reconhece a pessoa da próxima vez. Desligado, quem não está no cadastro não deixa rastro no Xero.
::::

::mockup{kind="integration-config" name="Xero" mode="oauth" caption="Xero conectado por autorização, com organização e cadastro de novos contatos"}

## Antes da ligação

O assistente procura quem liga pelo número ou, se a pessoa estiver em [Contatos](/app/contacts) da Kloel, pelo e-mail. De um cliente conhecido, sabe nome, e-mail e telefones. Exemplo: a Dona Lúcia, da padaria da esquina, liga do +55 11 90000-0119 e é cumprimentada pelo nome.

Se dois contatos têm o mesmo número, o assistente não chuta: pergunta quem fala. Os demais são tratados como novos.

:::tip[Fica entre você e seu assistente]
O assistente nunca diz que procurou ou cadastrou alguém, não pede e-mail nem que a pessoa leia o próprio número e não comenta nada sobre outros contatos.
:::

## Durante a ligação

Quando uma pessoa nova diz o nome, o assistente a adiciona na hora, sem pedir soletração, e segue com o assunto. Quem liga em nome de uma empresa é salvo com o nome dela; os demais, com o nome completo.

Perguntas sobre fatura, pagamento, saldo ou orçamento são recusadas com gentileza: o assistente não tem acesso a nada disso.

## Depois da ligação

O contato reconhecido ou adicionado recebe uma nota no histórico, começando com **Ligação Kloel:**, seguida de resumo e link para a conversa, que também fica em [Conversas](/app/inbox). Quem não foi reconhecido nem adicionado não recebe nota.

## Teste a integração

Com **Adicionar quem liga como contato** ligado, ligue de um número fora do Xero e diga seu nome. Confira o contato no grupo **via Kloel** e a nota; depois, ligue de novo para ver o reconhecimento.

## Bom saber

- **Contatos ficam como estão**: o assistente nunca altera nem exclui; só adiciona e deixa notas.
- **Reconhecimento pelo código do contato**: o Xero não busca por telefone, por isso o assistente usa o código que grava nos contatos que cria.
- **Contatos que você criou** são reconhecidos pelo e-mail, se a pessoa estiver nos [Contatos](/ajuda/get-started/contacts) da Kloel com o mesmo e-mail.
- **Nomes únicos**: com homônimo no Xero, nada é adicionado e não há nota.
- **Número oculto** ou **dois contatos no mesmo número**: sem nota.
- **Notas de até 250 caracteres**: resumos longos são encurtados.
- **Dados são contexto**: instruções escritas num contato são ignoradas.

## Se algo não estiver funcionando

As mensagens aparecem na conversa correspondente, em [Conversas](/app/inbox).

| Mensagem | O que verificar |
|---|---|
| Nenhum número recebido; não foi possível procurar quem ligou. | A pessoa ocultou o número. |
| Mais de um contato tem este número. | Mescle os contatos ou arquive o que sobrou. |
| Nenhum contato tem este número ou e-mail. | Ligue **Adicionar quem liga como contato** para cadastrar novos. |
| Xero (reconexão necessária) | Clique em **Conectar** e entre de novo; confira a **Organização do Xero**. |
| Já existe um contato com este nome. | É a mesma pessoa? Adicione-a aos Contatos da Kloel com o e-mail que ela tem no Xero. |

:::tip[Precisa de ajuda?]
Clique em **Suporte** no topo desta central e conte o que aconteceu. A gente ajuda com prazer.
:::`,
  },

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  {
    section: 'integrations',
    slug: 'zapier',
    title: 'Zapier',
    description: 'Seu assistente inicia seus Zaps a cada ligação, para que os detalhes cheguem aos sistemas em que a sua equipe trabalha.',
    source: '[209]',
    related: ['get-started/troubleshooting', 'developers/http-request', 'integrations/makecom'],
    keywords: ['zapier', 'zap', 'webhook', 'catch hook', 'automação', 'body json', 'variáveis'],
    body: `Com o Zapier conectado, cada ligação pode iniciar um Zap que você já criou: um lead novo no CRM, um aviso no chat da equipe, um pedido de retorno na lista de tarefas. O assistente funciona como o colega que nunca esquece de passar o recado: entrega os dados no momento certo, e o Zap faz o resto.

:::warning[Acesso antecipado]
O Zapier ainda não está liberado para todas as contas. Se ele não aparecer em [Integrações](/app/integrations), peça a liberação pelo botão **Suporte** no topo desta central.
:::

::::steps
### Crie o gatilho no Zapier
Crie um Zap e, na etapa **Trigger**, escolha **Webhooks by Zapier** com o evento **Catch Hook**. Na aba **Test**, copie a URL do webhook e deixe o Zap aberto. Webhooks não fazem parte do plano gratuito do Zapier.

### Conecte o Zapier à Kloel
Em [Integrações](/app/integrations), clique em **Adicionar integração**, escolha **Zapier** e, em **Conexão**, clique em **Conectar**. Preencha **Nome** (como "Zap de novos leads") e **URL do webhook**, que contém o caminho \`/hooks/catch/\`. Ao salvar, a Kloel valida a URL.

### Escolha o que seu assistente pode fazer
Cada integração inicia um Zap; para outros, adicione o Zapier de novo.

- **Nome**: aparece nas conversas. Padrão **Zapier**.
- **Execução**: **Antes da conversa**, **Durante a conversa** ou **Após a conversa** (padrão), com **A qualquer momento** (padrão), **Durante o horário de funcionamento** ou **Fora do horário de funcionamento**.
- **Quando a IA deve usar isso?**: obrigatório com **Durante a conversa**, como "Se a pessoa pedir retorno, pergunte nome e motivo e então use isto."
- **Body**: o que o Zap recebe; cada chave vira um campo nas etapas seguintes.

~~~json
{
  "conversationId": "{{conversationId}}",
  "from": "{{personNumber}}",
  "to": "{{agentNumber}}",
  "motivo": "{{motivo}}",
  "link": "{{conversationLink}}"
}
~~~

- **Adicionar variável**: **Conversa: Link** e, após a conversa, **Conversa: Resumo**, **Conversa: Transcrição simples** e **Chamada: Duração**.
- **Variáveis personalizadas**: as suas, como \`{{motivo}}\`, com tipo (**Texto**, **Número** ou **Booleano**) e descrição. Valem durante e depois da conversa.
- **Cabeçalhos**: quase nunca necessários; deixe \`{}\`.
- **Condição**: só com **Após a conversa**. Vazia, envia em toda ligação.
- **Aguardar resultado**: antes ou durante a conversa; ligado por padrão.
::::

::mockup{kind="integration-config" name="Zapier" mode="action" caption="Zapier com execução, regra de uso, Body e variáveis personalizadas"}

## Antes da ligação

Quando o telefone toca, o Zap recebe o número de quem liga, o número discado e o **Body**. Com **Aguardar resultado**, o assistente espera até cinco segundos pela confirmação. Número oculto chega vazio.

:::tip[Fica entre você e seu assistente]
Quem liga não percebe nada: o Zapier trabalha em segundo plano.
:::

## Durante a ligação

No momento descrito, o assistente reúne as variáveis, pergunta o que faltar e envia. O Zapier só confirma o recebimento: o assistente pode dizer "já passei para a equipe", mas não o que o Zap fez. Para consultar dados, use [Requisição HTTP](/ajuda/developers/http-request).

## Depois da ligação

O assistente confere a **Condição**, preenche as variáveis e envia; o que não foi dito fica vazio. Cada execução aparece em [Conversas](/app/inbox) como **Enviado ao Zapier.**, **Não enviado ao Zapier: …** ou **Falha ao enviar ao Zapier: …**.

## Teste a integração

1. Faça uma **Ligação de teste** que atenda à regra ou à condição.
2. No Zap, clique em **Test trigger** para ver os campos recebidos.
3. Adicione as próximas etapas e publique o Zap.

## Bom saber

- **Zap publicado e ligado**: caso contrário, nada roda.
- **Telefones** chegam no formato internacional, como \`+5511900000123\`.
- **Privacidade (LGPD)**: tudo no **Body** sai da Kloel para o Zapier. Envie só o necessário.

## Se algo não estiver funcionando

| Mensagem | O que verificar |
|---|---|
| Cole a URL do Catch Hook do seu Zap. | Copie de novo a URL da aba **Test**. |
| É necessária uma descrição. | Toda variável personalizada precisa de descrição. |
| Falha ao enviar ao Zapier: … | O Zap foi recriado? O **Body** é um JSON válido? |
| Não enviado ao Zapier: … | A **Condição** não foi atendida. |
| **Test trigger** não encontra nada | Faça a ligação antes e confira a URL. |

:::tip[Precisa de ajuda?]
Clique em **Suporte** no topo desta central e informe a conversa e o Zap envolvidos. A gente ajuda com prazer.
:::`,
  },
]
