import type { HelpArticle } from './types'

/**
 * Aba "Produto" da Central de ajuda: Ações, Produtos e Números de telefone.
 * Conteúdo reescrito a partir das notas de referência [170]–[180] e adaptado ao app local da Kloel
 * (rotas /app/*, cartões da seção Recursos do assistente, organização de demonstração "Clínica Bem Viver").
 */
export const PRODUCT_ARTICLES: HelpArticle[] = [
  /* ───────────────────────────────────────── Ações ───────────────────────────────────────── */
  {
    section: 'actions',
    slug: 'sms',
    title: 'Enviar SMS',
    description: 'Dispare SMS automáticos para quem ligou ou para a sua equipe antes, durante ou depois de uma ligação.',
    source: '[170]',
    related: ['actions/email', 'actions/whatsapp-messages', 'actions/appointments', 'get-started/troubleshooting'],
    keywords: ['sms', 'mensagem de texto', 'torpedo', 'confirmação por sms', 'remetente', 'variáveis', 'notificação'],
    body: `Uma ação de SMS deixa o assistente mandar uma mensagem de texto curta sem que ninguém da equipe precise digitar nada. Ela serve tanto para quem está do outro lado da linha — uma confirmação de consulta, um endereço, um link — quanto para avisar alguém da sua equipe de que chegou um pedido importante.

Você pode ter quantas ações de SMS quiser no mesmo assistente. Na Clínica Bem Viver, por exemplo, a Roberta poderia mandar a confirmação da avaliação para o paciente e, em paralelo, um alerta para a recepção sempre que alguém relatar dor forte.

::mockup{kind="agent-resources" highlight="sms" caption="Cartão Enviar SMS na seção Recursos do assistente"}

## Criar uma ação de SMS

::::steps
### Abra o assistente
Em [Assistentes](/app/agents), escolha o assistente e, na aba **Geral**, vá até a seção **Recursos**. O cartão **Enviar SMS** abre a folha lateral de configuração. Se já existir uma ação, adicione outra a partir da mesma folha.

### Escolha o momento do envio
Em **Execução**, defina se o SMS sai antes, durante ou depois da conversa (veja a tabela abaixo). No mesmo campo você limita o envio a **A qualquer momento**, **Durante o horário de funcionamento** ou **Fora do horário de funcionamento**.

### Defina a condição
Em **Enviar**, deixe **Sempre** para mandar o SMS em toda conversa que cumpra as demais regras, ou escolha **Somente se…** e descreva a situação em uma frase completa.

~~~text
Envie este SMS somente se ficou combinado que a clínica vai retornar a ligação.
~~~

### Escolha o destinatário
Em **Para**, selecione **Quem liga**, **Números fixos** ou **Deixar a IA decidir**.

### Dê um nome e defina o remetente
O nome da ação é interno e ajuda a diferenciar várias ações ("Confirmação de avaliação", "Alerta de urgência"). O **nome do remetente** é o que aparece no celular de quem recebe: troque o padrão pelo nome curto da sua empresa.

### Escreva a mensagem e salve
Em **Mensagem**, escolha **Escrever você mesmo** (texto fixo, com variáveis) ou **Deixar a IA escrever** (você dá a instrução e a IA redige a cada envio, então o texto varia um pouco). Clique em **Salvar**.
::::

:::warning[A condição fica na ação]
Quem decide se o SMS sai é o campo **Somente se…**. No prompt, descreva apenas como o assistente anuncia o envio ("vou te mandar o endereço por mensagem"). Repetir a regra nos dois lugares costuma gerar envios duplicados ou contraditórios.
:::

### Quando usar cada momento

| Momento | O que o assistente já sabe | Uso típico |
|---|---|---|
| Antes da conversa | Praticamente só o número de quem liga | Mensagens genéricas — raramente necessário |
| Durante a conversa | O que foi dito até ali | Mandar link, endereço ou código com a pessoa ainda na linha |
| Depois da conversa | Tudo o que foi coletado | Confirmações, pedidos de retorno e avisos internos (o mais comum) |

### Para quem vai o SMS

| Opção | Quando escolher |
|---|---|
| **Quem liga** | Confirmações e lembretes para a própria pessoa da ligação |
| **Números fixos** | Avisos internos que sempre vão para o mesmo celular, como o da recepção |
| **Deixar a IA decidir** | O destino depende do assunto (vendas, suporte, retorno) e a IA escolhe com base na conversa |

:::warning[Ligações encaminhadas]
Se as chamadas chegam à Kloel por desvio do seu PABX ou da sua operadora, o número original de quem liga precisa ser repassado. Sem isso, a opção **Quem liga** manda o SMS para o seu próprio sistema telefônico. Veja [Conectar seu número](/ajuda/get-started/connect-your-number).
:::

## Variáveis

Mensagens fixas ficam muito mais úteis com variáveis. Para criar uma variável própria, digite um marcador como \`{{nome_paciente}}\` no texto, escolha o tipo (**String**, **Number** ou **Boolean**) e explique em poucas palavras o que o assistente deve extrair da conversa. Depois da ligação, a Kloel troca o marcador pelo valor coletado.

Estas variáveis padrão funcionam em qualquer SMS:

~~~text
{{companyId}}        {{conversationId}}     {{conversationLink}}
{{agentNumber}}      {{personNumber}}       {{startTimestamp}}
{{direction}}        {{kloel.agent.name}}   {{kloel.company.name}}
~~~

O editor mostra a contagem de caracteres, quantos SMS a mensagem vai ocupar e o custo estimado. Textos longos são divididos automaticamente em partes. Letras como ã, õ e ê costumam reduzir o limite de cada parte (de 160 para 70 caracteres), então revise mensagens longas.

::mockup{kind="message" channel="sms" text="Clínica Bem Viver: Olá, Mariana! Sua avaliação está confirmada para 12/11 às 14h30. Até lá!" caption="Exemplo de SMS de confirmação enviado depois da ligação"}

## Modelos prontos

::::tabs
:::tab[Confirmar consulta]
- **Para:** Quem liga
- **Condição:** uma consulta foi marcada durante a ligação

~~~text
Olá, {{nome_paciente}}! Sua {{servico}} está marcada para {{data}} às {{horario}}. {{kloel.company.name}}
~~~
:::
:::tab[Enviar informações]
- **Para:** Quem liga
- **Condição:** o assistente prometeu mandar um link ou endereço por SMS

~~~text
Como combinado, aqui está o link com as orientações: {{link}}
~~~
:::
:::tab[Confirmar retorno]
- **Para:** Deixar a IA decidir
- **Condição:** a pessoa pediu que a clínica retornasse a ligação

~~~text
Recebemos seu pedido de retorno. Vamos ligar para você assim que possível.
~~~
:::
:::tab[Alertar a equipe]
- **Para:** Números fixos (ex.: +55 11 90000-0100)
- **Condição:** quem ligou relata um caso urgente

~~~text
URGENTE: {{nome_paciente}} ({{personNumber}}) – {{assunto}}
~~~
:::
::::

## Testar

Ligue de um celular para o número do assistente e provoque a condição configurada. Depois confira se o SMS saiu, se chegou ao número certo, se o remetente aparece como esperado, se todas as variáveis foram preenchidas e se o texto continua curto e claro.

## Se algo não estiver funcionando

| Sintoma | O que verificar |
|---|---|
| Nenhum SMS foi enviado | A condição de **Somente se…** aconteceu de fato na conversa? O filtro de horário permite o envio naquele momento? |
| SMS chegou ao número errado | Com **Quem liga**, confirme que o número original é repassado no desvio. Com **Deixar a IA decidir**, deixe as regras de destino mais explícitas. |
| Variável vazia ou estranha | Revise a descrição da variável e verifique se a informação foi realmente perguntada na ligação. |
| Remetente diferente do configurado | Algumas operadoras exibem um número curto no lugar do nome do remetente. |
| Mensagem dividida em várias partes | Encurte o texto ou troque palavras acentuadas desnecessárias. |

:::tip[Precisa de ajuda?]
Clique em **Suporte**, no topo desta central, e informe o nome do assistente, o horário da ligação de teste e o número que deveria ter recebido o SMS.
:::`,
  },

  {
    section: 'actions',
    slug: 'websearch',
    title: 'Usar a pesquisa na web',
    description: 'Deixe o assistente consultar páginas do seu site ao vivo para responder com informações que mudam com frequência.',
    source: '[171]',
    related: ['get-started/knowledge-base', 'get-started/write-a-great-prompt', 'products/webchat'],
    keywords: ['pesquisa na web', 'web search', 'busca no site', 'site', 'informações atualizadas', 'preços', 'disponibilidade'],
    body: `Com o recurso **Pesquisa na web**, o assistente abre páginas do seu site no meio da conversa e responde com o que está publicado naquele momento. É a saída para informações que mudam com frequência e que ficariam desatualizadas se você as copiasse para a base de conhecimento.

Na Clínica Bem Viver, por exemplo, a lista de convênios aceitos e as campanhas do mês mudam o tempo todo. Em vez de editar o conhecimento da Roberta toda semana, basta apontar a pesquisa para as páginas do site onde esses dados já são mantidos.

::mockup{kind="agent-resources" highlight="websearch" caption="Seção Recursos do assistente com o cartão Pesquisa na web em destaque"}

## Conhecimento ou pesquisa na web?

| Tipo de informação | Onde colocar |
|---|---|
| Endereço, especialidades, políticas, perguntas frequentes | [Base de conhecimento](/ajuda/get-started/knowledge-base) |
| Promoções, vagas, disponibilidade, eventos, catálogo atualizado | **Pesquisa na web** |
| Como o assistente deve falar e agir | [Prompt personalizado](/ajuda/get-started/write-a-great-prompt) |

Informações que quase nunca mudam continuam melhor na base de conhecimento: a resposta é imediata e não depende de o site estar no ar.

## Configurar a pesquisa

::::steps
### Abra o cartão
Em [Assistentes](/app/agents), abra o assistente, vá até **Geral → Recursos** e clique em **Pesquisa na web**. A folha de configuração abre à direita.

### Defina quando o recurso fica ativo
Em **Ativo**, escolha **A qualquer momento**, **Durante o horário de funcionamento** ou **Fora do horário de funcionamento**. Na maioria dos casos, **A qualquer momento** é a melhor escolha: quem liga às 23h também merece uma resposta atualizada. As opções por horário ficam disponíveis depois que você define o horário em **Configurar horário de funcionamento…**, no próprio seletor.

### Descreva para que serve
No campo **Usar para**, explique em uma frase completa em que situações a pesquisa deve acontecer. Quanto mais específica a descrição, melhor o assistente reconhece o momento certo.

~~~text
Use a pesquisa quando alguém perguntar quais convênios a clínica aceita ou quais promoções estão valendo neste mês.
~~~

### Informe as páginas exatas
Em **Sites**, cole o endereço de cada página que contém a informação e pressione **Enter** para confirmar cada uma. Você pode cadastrar várias.

### Escreva a frase de espera
Em **Ao pesquisar, dizer**, escreva o que o assistente fala enquanto consulta a página, como "Um instante, vou conferir isso no nosso site." Se deixar vazio, ele fica em silêncio durante a busca. Clique em **Salvar**.
::::

:::warning[O assistente lê só o que você listou]
A pesquisa abre exatamente as páginas cadastradas, ao vivo. Ela não navega pelo restante do site, não segue links e não faz buscas abertas na internet. Se uma informação está em outra página, essa página também precisa estar na lista.
:::

## Como montar a lista de páginas

Cadastrar apenas a página inicial quase nunca resolve, porque ela raramente traz os detalhes que as pessoas perguntam. Prefira as páginas internas onde a informação realmente está:

~~~text
Insuficiente (só esta página será lida):
https://www.exemplo.com.br

Melhor:
https://www.exemplo.com.br/convenios
https://www.exemplo.com.br/promocoes
https://www.exemplo.com.br/especialidades/ortodontia
~~~

::mockup{kind="resource-sheet" title="Pesquisa na web" fields="Ativo=A qualquer momento|Usar para=convênios aceitos e promoções do mês|Sites=exemplo.com.br/convenios, exemplo.com.br/promocoes|Ao pesquisar, dizer=Um instante, vou conferir no nosso site." caption="Folha de configuração da Pesquisa na web preenchida"}

## Boas práticas

- Escolha páginas com texto bem organizado. Conteúdo que existe só dentro de imagens pode não ser aproveitado.
- Mantenha essas páginas em dia: o assistente repete o que estiver publicado, inclusive informações vencidas.
- Evite deixar a mesma informação na base de conhecimento e no site com valores diferentes — o assistente pode escolher a versão antiga.
- Uma lista curta e certeira costuma responder mais rápido do que dezenas de endereços.
- Assistentes de chat também podem usar a pesquisa; veja [Chatbot de IA](/ajuda/products/webchat).

## Se algo não estiver funcionando

| Sintoma | O que verificar |
|---|---|
| O assistente não pesquisa | A descrição em **Usar para** cobre a pergunta feita? O seletor **Ativo** permite o uso naquele horário? |
| A resposta está desatualizada | A página listada foi realmente atualizada? A mesma informação pode estar também na base de conhecimento, com dado antigo. |
| "Não encontrei essa informação" | O dado está em uma página que não foi cadastrada em **Sites**. |
| Silêncio longo durante a busca | Preencha **Ao pesquisar, dizer** para avisar quem está na linha. |

:::tip[Precisa de ajuda?]
Clique em **Suporte**, no topo desta central, e envie o nome do assistente, a pergunta feita na ligação e as páginas cadastradas em **Sites**.
:::`,
  },

  {
    section: 'actions',
    slug: 'whatsapp-messages',
    title: 'Enviar uma mensagem de WhatsApp após uma ligação',
    description: 'Receba no WhatsApp da sua equipe um resumo automático de cada ligação importante.',
    source: '[172]',
    related: ['products/whatsapp', 'actions/email', 'actions/sms'],
    keywords: ['whatsapp', 'resumo da ligação', 'notificação interna', 'enviar whatsapp', 'aviso para a equipe', 'verificar número'],
    body: `Com o cartão **Enviar WhatsApp**, o assistente manda um resumo da ligação para um número de WhatsApp da sua equipe assim que a conversa termina. É uma forma prática de receber pedidos importantes direto no celular, sem precisar abrir o painel.

A mensagem é um aviso interno: segue um modelo fixo e só vai para números que você comprovou serem seus. Para mandar um texto personalizado a quem ligou, use [Enviar SMS](/ajuda/actions/sms) ou [Enviar e-mail](/ajuda/actions/email).

::mockup{kind="agent-resources" highlight="whatsapp" caption="Cartão Enviar WhatsApp na seção Recursos do assistente"}

## Antes de começar: verifique o número

O resumo só pode ser entregue a números de WhatsApp cuja propriedade foi confirmada. A verificação é feita uma vez por número, dentro da própria folha de configuração.

::::steps
### Abra a verificação
Na folha **WhatsApp**, clique em **Verificar propriedade do número**. Abre a janela **Verificar número do WhatsApp**.

### Envie a mensagem de confirmação
A janela mostra um QR code e um código no formato \`kloel verify …\`. No celular cujo WhatsApp vai receber os resumos, leia o QR code ou toque em **Abrir no WhatsApp** e envie a mensagem gerada sem alterar o texto.

### Aguarde a confirmação
Enquanto aparece "Aguardando a mensagem do WhatsApp…", a Kloel espera o código chegar. Quando ele é recebido, o número passa a aparecer na lista **Para**.
::::

:::info[Por que verificar?]
Ao comprovar a propriedade, você autoriza a Kloel a enviar mensagens de WhatsApp para aquele número. Isso impede que resumos de conversas cheguem a quem não deveria recebê-los.
:::

## Configurar o envio

::::steps
### Abra o cartão
Em [Assistentes](/app/agents), abra o assistente, vá em **Geral → Recursos** e clique em **Enviar WhatsApp**. Use o lápis ao lado do título para dar um nome claro à ação, como "Resumo para a recepção".

### Escolha quando enviar
Em **Enviar**, selecione **Sempre** para receber um resumo depois de cada ligação, ou **Somente se…** para receber apenas quando uma condição for atendida. Escreva a condição como uma frase completa:

~~~text
o paciente pediu que a clínica retornasse a ligação
~~~

### Selecione os destinatários
Em **Para**, escolha um ou mais números já verificados. Se a lista estiver vazia ("Nenhum resultado encontrado"), faça antes a verificação descrita acima.

### Confira a prévia e salve
A área **Prévia** mostra como o resumo vai chegar. Clique em **Salvar**.
::::

## O que vem na mensagem

O conteúdo é montado automaticamente e não pode ser editado. Cada resumo traz:

- data e horário da ligação;
- o número de quem ligou;
- um resumo curto do que foi conversado;
- o link para abrir a conversa completa em [Conversas](/app/inbox).

::mockup{kind="message" channel="whatsapp" text="Resumo da chamada – 12/11, 14:30. Quem ligou: +55 11 90000-0123. A paciente perguntou sobre clareamento e pediu retorno amanhã de manhã. Abrir conversa no painel." caption="Prévia do resumo que chega ao WhatsApp da equipe"}

:::warning[Somente para a sua equipe]
O **Enviar WhatsApp** não escreve para quem ligou e não aceita texto livre. Conversas de WhatsApp com clientes acontecem pelo canal [WhatsApp](/ajuda/products/whatsapp), com um assistente de chat conectado ao seu número.
:::

## Ideias de uso

| Objetivo | Configuração sugerida |
|---|---|
| Não perder pedidos de retorno | **Somente se…** "foi prometido um retorno a quem ligou" |
| Destacar urgências | **Somente se…** "quem ligou relatou dor forte ou um caso urgente" |
| Acompanhar o plantão noturno | **Sempre**, em um assistente que só recebe as ligações desviadas fora do expediente |
| Encaminhar dúvidas de cobrança | **Somente se…** "a pessoa perguntou sobre boletos, reembolsos ou valores", com o celular do financeiro em **Para** |

## Custos

As mensagens enviadas por esta ação são cobradas à parte, em pacotes contratados como add-on. A própria folha de configuração informa as condições atuais, e o consumo pode ser acompanhado em [Faturamento](/app/billing).

## Se algo não estiver funcionando

| Sintoma | O que verificar |
|---|---|
| A lista **Para** está vazia | Nenhum número foi verificado ainda. Use **Verificar propriedade do número**. |
| A verificação não termina | A mensagem saiu do mesmo número que deve receber os resumos? O código foi enviado sem alterações? |
| Nenhum resumo chegou | A condição de **Somente se…** aconteceu de fato? Ainda há mensagens disponíveis no pacote? |
| Chega resumo de todas as ligações | Troque **Sempre** por **Somente se…** e descreva o caso. |

:::faq[Posso enviar o resumo para mais de uma pessoa?]
Sim. Verifique cada número e selecione todos eles em **Para**. Se cada pessoa deve receber casos diferentes, crie uma ação para cada uma, com sua própria condição.
:::

:::tip[Precisa de ajuda?]
Clique em **Suporte**, no topo desta central, e informe o nome do assistente, o número de destino e o horário da ligação cujo resumo não chegou.
:::`,
  },

  {
    section: 'actions',
    slug: 'call-transfer',
    title: 'Transferir chamada',
    description: 'Configure em que situações o assistente passa a ligação para uma pessoa da sua equipe.',
    source: '[173]',
    related: ['get-started/connect-your-number', 'phone-systems/sip-numbers', 'phone-numbers/pbx', 'get-started/troubleshooting'],
    keywords: ['transferir ligação', 'transferência', 'encaminhar chamada', 'falar com atendente', 'blind transfer', 'sip', 'caixa postal'],
    body: `Com o recurso **Transferir ligações**, o assistente passa a chamada para alguém da sua equipe quando a conversa pede atendimento humano — uma urgência, uma negociação ou um pedido explícito para falar com uma pessoa.

A transferência é direta (também chamada de *blind transfer*): o assistente repassa a ligação na hora, sem consultar o destino antes. Cada transferência tem um único destino, uma condição e um período de atividade; para cenários diferentes, crie uma transferência para cada um.

::mockup{kind="agent-resources" highlight="transfer" caption="Cartão Transferir ligações na seção Recursos"}

## Configurar uma transferência

::::steps
### Abra o cartão
Em [Assistentes](/app/agents), abra o assistente e, em **Geral → Recursos**, clique em **Transferir ligações**.

### Escolha o tipo de destino
Em **Transferir para**, selecione **Número de telefone**, **Membro da equipe** ou **SIP** (detalhes abaixo).

### Descreva quando transferir
No campo **Transferir quando**, escreva a situação como uma regra clara de "se… então". Exemplo: "quem liga relata dor forte ou pede para falar com alguém da recepção".

### Defina o período ativo
Em **Ativo**, escolha **A qualquer momento**, **Durante o horário de funcionamento** ou **Fora do horário de funcionamento**. Se ainda não houver horário definido, use **Configurar horário de funcionamento…** no próprio seletor.

### Ative as opções que fizerem sentido
Em **Opções**, **Verificar disponibilidade** consulta o calendário do destino antes de transferir, e **E-mail em caso de falha** envia um resumo da conversa ao endereço informado sempre que a transferência não se completa.

### Dê um nome e salve
Use o lápis ao lado do título para nomear a transferência pelo destino — "Recepção", "Financeiro", "Dra. Helena". Clique em **Salvar**.
::::

### Tipos de destino

::::tabs
:::tab[Número de telefone]
Transfere para qualquer número válido, fixo ou celular, com código do país (ex.: +55 11 90000-0100). Use um número completo, não um ramal interno do seu PABX.
:::
:::tab[Membro da equipe]
Escolha alguém cadastrado em [Usuários](/app/users). A pessoa precisa ter um telefone no perfil — quem não tem aparece como "(número ausente)". A vantagem é poder consultar a agenda dela antes de transferir, desde que um calendário esteja conectado.
:::
:::tab[SIP]
Para sistemas telefônicos com SIP, informe o endereço SIP do destino, como \`sip:recepcao@pabx.exemplo.com.br\`. Veja [Números SIP](/ajuda/phone-systems/sip-numbers).
:::
::::

::mockup{kind="resource-sheet" title="Recepção" fields="Transferir para=Número de telefone|Número=+55 11 90000-0100|Transferir quando=quem liga relata dor forte ou pede para falar com a recepção|Ativo=A qualquer momento|E-mail em caso de falha=Ligado" caption="Folha de transferência configurada para a recepção da clínica"}

## Quando ninguém atende

O assistente só recupera a ligação se o destino **recusar ativamente** a chamada — manualmente, rejeitando-a, ou por uma regra do seu sistema telefônico. Nesse caso ele retoma a conversa, anota o recado e pode prometer um retorno.

Se a chamada continuar tocando e cair numa caixa postal, a transferência conta como concluída e o assistente sai da conversa. O tempo de toque antes do desvio é definido na sua operadora ou no seu PABX.

:::warning[Caixa postal encerra a participação do assistente]
Para que o assistente consiga oferecer um retorno, configure o destino para rejeitar a chamada depois de alguns toques, em vez de desviá-la para a caixa postal.
:::

## Blocos de prompt para copiar

Use o [prompt personalizado](/ajuda/get-started/write-a-great-prompt) para orientar como o assistente anuncia a transferência e o que faz se ela falhar:

~~~text
Antes de transferir, avise em uma frase curta que vai passar a ligação para a recepção.

Se a transferência não for concluída, peça desculpas, anote nome, telefone e motivo do contato e diga que a equipe vai retornar. Nunca prometa um horário que você não pode confirmar.
~~~

## Problemas comuns

| Sintoma | O que verificar |
|---|---|
| Falha ao transferir para outro país | Transferências internacionais (por exemplo, de uma ligação vinda de Portugal para um celular brasileiro) podem precisar de liberação. Peça pelo botão **Suporte**. |
| Aparece o número da empresa em vez do de quem ligou | Se a ligação chega por desvio, peça à operadora ou ao fornecedor do PABX que mantenha a identificação original de quem liga. |
| Ligações com número oculto não são transferidas | Chamadas anônimas não podem ser repassadas; a transferência falha. |
| O assistente não volta depois da recusa | Confirme que o destino recusou a chamada e que ela não foi atendida por uma caixa postal. |

## Testar

1. Ligue de outro telefone para o número do assistente e diga a frase que dispara a condição, como "quero falar com a recepção".
2. Atenda no destino e confirme que a conversa está conectada.
3. Ligue de novo e recuse a chamada no destino: o assistente deve retomar e oferecer retorno.
4. Deixe tocar sem atender. Se cair na caixa postal, ajuste o tempo de toque na operadora ou no PABX.
5. Abra [Conversas](/app/inbox) e confira como a transferência ficou registrada.

:::tip[Precisa de ajuda?]
Clique em **Suporte**, no topo desta central, e informe o nome da transferência, o número de destino e o horário da ligação de teste.
:::`,
  },

  {
    section: 'actions',
    slug: 'appointments',
    title: 'Configurar o agendador',
    description: 'Crie um tipo de compromisso no Agendador, defina a disponibilidade e conecte-o ao seu assistente.',
    source: '[174]',
    related: ['get-started/troubleshooting', 'actions/sms', 'actions/email', 'developers/http-request'],
    keywords: ['agendador', 'agendamento', 'marcar consulta', 'tipo de compromisso', 'calendário', 'disponibilidade', 'página de agendamento', 'lembretes'],
    body: `Com o Agendador da Kloel, o assistente consulta horários livres e marca, remarca ou cancela compromissos durante a conversa. Cada tipo de compromisso também ganha uma página pública, onde seus clientes escolhem um horário sozinhos.

A configuração tem duas partes que se complementam: no menu **Mais → [Agendador](/app/scheduling)** você define o que é oferecido (o tipo de compromisso); no assistente, o cartão **Agendar compromissos** decide quando e como esse tipo é usado.

:::warning[Duas etapas obrigatórias]
Um tipo de compromisso não fica disponível sozinho para os assistentes. Sem atribuí-lo e sem configurar o cartão **Agendar compromissos**, o assistente não consegue consultar nem reservar horários.
:::

## Antes de começar

Conecte uma conta Google ou Microsoft em [Conta](/app/account), no cartão **Conexão de conta**. O calendário conectado é usado para evitar conflitos e registrar os novos eventos.

::mockup{kind="scheduling" caption="Agendador com o tipo de compromisso Avaliação odontológica e a grade de disponibilidade"}

## 1. Criar o tipo de compromisso

::::steps
### Dados gerais
Abra o [Agendador](/app/scheduling) e crie um tipo ou abra um existente. Defina o **título** (ex.: "Avaliação odontológica"), a **duração** (15, 30, 60 minutos…), uma **descrição** curta — ela vai para o evento no Google Agenda ou no Outlook — e o **calendário** que recebe os compromissos.

### Local
Escolha **reunião online** (link do Google Meet ou do Microsoft Teams, conforme a conta conectada), **local físico** (informe o endereço, como Rua das Acácias, 200 – Vila Mariana, São Paulo/SP) ou **sem local**, útil para retornos por telefone.

### Disponibilidade
Selecione o fuso horário — \`America/Sao_Paulo\` para a maior parte do Brasil — e marque os dias e horários em que aceita reservas. Nas regras de agendamento, defina a **antecedência mínima** (ex.: 4 horas), o **intervalo entre compromissos** (ex.: 10 minutos) e a **janela máxima** (ex.: 30 dias ou sem limite).

### Notificações e lembretes
Edite os textos de confirmação, remarcação e cancelamento e o nome do remetente. Insira dados dinâmicos sempre pelo botão **Adicionar variável** (nome do convidado, data, horário, local, link da reunião, link de gerenciamento…). Inclua lembretes automáticos, como 24 horas e 2 horas antes.

### Dados coletados
Em reservas pelo assistente ou por SMS, nome e telefone são sempre pedidos; na página web, nome e e-mail. Você decide se o telefone é obrigatório, opcional ou não solicitado na página e pode incluir campos extras, como convênio ou motivo da consulta. Peça só o necessário.

### Atribua ao assistente
Na área de assistentes do tipo de compromisso, adicione quem poderá usá-lo — por exemplo, a Roberta.
::::

:::info[Disponibilidade não é horário de funcionamento]
A clínica pode atender das 8h às 19h e oferecer avaliações só pela manhã — ou o contrário. A grade de cada tipo é independente do horário de funcionamento da empresa.
:::

Nas opções avançadas você ainda pode ocultar o tipo da página geral da empresa (acesso só pelo assistente ou por link direto), definir o nome exibido na página, permitir que o cliente remarque ou cancele sozinho e cadastrar webhooks disparados quando um compromisso é criado, remarcado ou cancelado — veja [Requisição HTTP](/ajuda/developers/http-request). Convidados fixos (ex.: recepcao@exemplo.com.br) entram em todos os compromissos, mas a agenda deles não é consultada na busca por horários.

## 2. Ligar o tipo ao assistente

::::steps
### Adicione o agendamento
No assistente, abra **Geral → Recursos → Agendar compromissos**, clique em **Adicionar novo agendamento de calendário** e escolha **Adicionar Agendador de compromissos** (a opção recomendada, integrada à Kloel).

### Aba Geral
Em **Ativo**, defina se o agendamento vale a qualquer momento ou só dentro ou fora do horário de funcionamento — isso não altera os horários oferecidos. Escolha o tipo de evento, descreva em uma frase quando ele deve ser oferecido e dê um nome interno.

### Aba Configurações
Ligue **Permitir reservas** para que o assistente marque de fato; desligado, ele apenas consulta horários. Em **Destino da reserva**, escolha **SMS** ou **E-mail** para a confirmação.

### Aba Configurações avançadas
**Permitir links de reserva** deixa o assistente mandar o link da página quando a reserva direta falha. O **E-mail de substituição** cobre reservas por SMS, que tecnicamente exigem um e-mail: mantenha o valor padrão ou use um endereço válido que ninguém monitore.
::::

| Destino da reserva | Dado que precisa ser coletado |
|---|---|
| SMS | Telefone (o assistente pergunta se pode usar o número atual) |
| E-mail | Endereço de e-mail |

::mockup{kind="resource-sheet" title="Agendador de compromissos" fields="Ativo=A qualquer momento|Tipo de evento=Avaliação odontológica|Usar quando=a pessoa quer marcar a primeira avaliação|Permitir reservas=Ligado|Destino da reserva=SMS" caption="Configuração do agendamento dentro do assistente"}

:::warning[Condição no recurso, conversa no prompt]
A regra de quando oferecer cada tipo fica no campo do recurso. No prompt, descreva só o tom da conversa e quais dados pedir.
:::

## 3. Testar o fluxo completo

Abra a página de agendamento do seu tipo de evento (o link público fica em [Agendador](/app/scheduling), no formato \`/c/sua-empresa/seu-evento\`) e faça uma reserva de teste. Depois faça uma ligação de teste pedindo um horário e confira:

- só horários realmente livres são oferecidos, no fuso correto;
- o tipo de compromisso e os dados pedidos estão certos;
- o evento aparece no calendário conectado, com link de reunião quando previsto;
- a confirmação chega por SMS ou e-mail, e remarcar e cancelar funcionam;
- se a reserva falhar, o link da página é oferecido.

:::tip[Precisa de ajuda?]
Clique em **Suporte**, no topo desta central, e informe o tipo de compromisso, o assistente e o horário da tentativa de reserva.
:::`,
  },

  {
    section: 'actions',
    slug: 'email',
    title: 'Enviar e-mail',
    description: 'Envie e-mails automáticos com resumos, pedidos de retorno ou informações combinadas durante a conversa.',
    source: '[175]',
    related: ['actions/sms', 'actions/whatsapp-messages', 'products/tasks', 'get-started/troubleshooting'],
    keywords: ['e-mail', 'email', 'resumo por e-mail', 'notificação', 'enviar e-mail', 'variáveis', 'assunto'],
    body: `O recurso **Enviar e-mail** faz o assistente mandar mensagens automáticas a partir de uma conversa: um resumo para a recepção, um lead novo para o comercial ou as orientações que foram prometidas a quem ligou. Na Clínica Bem Viver, a Roberta já vem com a ação "Resumo para a equipe", que manda à recepção um resumo de cada ligação.

Você pode ter várias ações de e-mail no mesmo assistente, cada uma com seu destinatário, sua condição e seu texto.

::mockup{kind="agent-resources" highlight="email" caption="Cartão Enviar e-mail na seção Recursos"}

## Criar uma ação de e-mail

::::steps
### Abra o cartão
Em [Assistentes](/app/agents), abra o assistente e clique em **Enviar e-mail** em **Geral → Recursos**. Use o lápis ao lado do título para dar um nome interno claro.

### Defina a execução
Em **Execução**, escolha **Antes da conversa**, **Durante a conversa** ou **Após a conversa** e, no segundo seletor, se o envio vale **A qualquer momento** ou só dentro ou fora do horário de funcionamento.

### Escolha quando enviar
Em **Enviar**, deixe **Sempre** ou selecione **Somente se…** e descreva o caso, por exemplo "a pessoa pediu um resumo por escrito". Campo vazio equivale a enviar sempre.

### Escolha o destinatário
Em **Para**, use **Endereços fixos** para mandar sempre ao mesmo lugar, ou **Deixar a IA decidir** para que o endereço saia da conversa.

### Assunto, mensagem e remetente
Escreva o **Assunto** (o ícone **{ }** insere variáveis) e o corpo em **Mensagem**. No campo **De**, defina o nome exibido — ele aparece seguido de "via Kloel". Clique em **Salvar**.
::::

### Antes, durante ou após a conversa

::::tabs
:::tab[Antes]
Raramente necessário. Ainda não existem resumo nem transcrição, então só funcionam endereços fixos e texto fixo.
:::
:::tab[Durante]
Para quando algo precisa sair com a ligação em andamento. Descreva quando a IA deve usar a ação e, em **Ao enviar, diga**, o que ela fala enquanto envia — deixe vazio para ficar em silêncio.
:::
:::tab[Após]
A opção mais usada: o e-mail sai com tudo o que foi coletado, incluindo resumo, transcrição e link da conversa.
:::
::::

:::warning[Condição na ação, não no prompt]
O critério de envio fica em **Somente se…**. No prompt, oriente apenas o que o assistente pergunta (o e-mail da pessoa, por exemplo) e como ele anuncia o envio.
:::

## Destinatário definido pela IA

Com **Deixar a IA decidir**, escreva regras de "se… então" no campo de instrução e garanta que o assistente pergunte o e-mail de quem liga quando ele ainda não for conhecido.

~~~text
Se a pessoa quiser um orçamento de implante, envie para comercial@exemplo.com.br.
Se for uma dúvida de cobrança, envie para financeiro@exemplo.com.br.
Se a pessoa pedir as orientações por escrito, envie para o e-mail que ela informar.
~~~

## Texto fixo ou escrito pela IA

Com **Escrever você mesmo**, você monta o texto no editor e usa **Adicionar variável** para inserir dados da conversa. O modelo padrão já traz o número de quem ligou, o resumo, a transcrição e o link. Um exemplo com variáveis próprias:

~~~text
Olá,

{{nome_paciente}} pediu retorno sobre {{assunto}}.
Telefone: {{personNumber}}

Conversa completa: {{conversationLink}}
~~~

Com **Deixar a IA escrever**, você descreve o que o e-mail deve conter ("escreva um resumo curto e cordial para o paciente, com os próximos passos") e a IA redige a mensagem inteira a cada envio.

::mockup{kind="resource-sheet" title="Resumo para a equipe" fields="Execução=Após a conversa|Enviar=Sempre|Para=recepcao@exemplo.com.br|Assunto=Resumo da ligação|Mensagem=Deixar a IA escrever|De=Clínica Bem Viver via Kloel" caption="Ação que envia o resumo de cada ligação para a recepção"}

## Variáveis

Variáveis próprias funcionam como no [SMS](/ajuda/actions/sms): digite um marcador como \`{{nome_paciente}}\` no assunto ou no corpo, escolha o tipo (**String**, **Number** ou **Boolean**) e descreva o que extrair. As variáveis padrão são:

~~~text
{{companyId}}       {{conversationId}}    {{conversationLink}}
{{agentNumber}}     {{personNumber}}      {{startTimestamp}}
{{direction}}       {{kloel.agent.name}}  {{kloel.company.name}}
~~~

## Casos de uso

| Caso | Para | Condição | Conteúdo |
|---|---|---|---|
| Pedido de retorno | Endereço fixo da recepção | A pessoa pediu retorno | Nome, telefone, motivo e link da conversa |
| Orientações ao paciente | IA decide (e-mail informado na ligação) | Foram prometidas informações por escrito | Orientações, links e contatos |
| Registro de suporte | Endereço fixo do suporte | Relato de problema técnico | Identificação do cliente, problema e solução esperada |

## Testar

Use o botão **Ligação de teste** do assistente e provoque a condição configurada. Confira se o e-mail chegou ao destinatário certo (inclusive na pasta de spam), se as variáveis foram preenchidas e se assunto e texto estão fáceis de entender.

## Se algo não estiver funcionando

| Sintoma | O que verificar |
|---|---|
| Nenhum e-mail foi enviado | A condição aconteceu na conversa? O horário configurado permite o envio? |
| Chegou ao destinatário errado | As regras de "se… então" são ambíguas? O endereço fixo foi digitado corretamente? |
| Variável vazia | A informação foi perguntada na ligação? A descrição da variável está clara? |
| E-mail na pasta de spam | Peça a quem recebe para marcar o remetente como confiável. |

:::tip[Precisa de ajuda?]
Clique em **Suporte**, no topo desta central, e informe o nome da ação, o destinatário esperado e o horário da ligação de teste.
:::`,
  },

  /* ──────────────────────────────────────── Produtos ──────────────────────────────────────── */
  {
    section: 'products',
    slug: 'tasks',
    title: 'Tarefas',
    description: 'Crie tarefas manualmente ou deixe o assistente gerá-las ao fim de uma conversa e atribuí-las à sua equipe.',
    source: '[176]',
    related: ['actions/email', 'products/webchat', 'products/whatsapp'],
    keywords: ['tarefas', 'tasks', 'to-do', 'pendências', 'retorno de ligação', 'responsável', 'acompanhamento'],
    body: `A área de Tarefas reúne os próximos passos que saem das conversas: retornos prometidos, orçamentos pendentes, casos de suporte em aberto. Você pode criar tarefas à mão e distribuí-las entre as pessoas da empresa ou deixar que o assistente as crie sozinho ao fim de uma conversa, já com o contexto necessário.

Assim, nenhum pedido depende da memória de quem atendeu: cada pendência tem dono, prazo e histórico.

::mockup{kind="tasks" caption="Lista de tarefas com responsável, prioridade e vencimento"}

## Criar uma tarefa manualmente

::::steps
### Abra a área de Tarefas
Clique em nova tarefa.

### Preencha os campos
Informe o que precisa ser feito, quem cuida e até quando (veja a tabela abaixo). Status e tags podem ser criados ou ajustados ali mesmo.

### Salve
A tarefa aparece na lista da pessoa responsável, que recebe um aviso por e-mail.
::::

| Campo | Para que serve |
|---|---|
| Título | Resumo em poucas palavras ("Ligar para Mariana sobre o orçamento") |
| Descrição | Detalhes, contexto e o que foi combinado |
| Responsável | Pessoa do workspace que vai cuidar da tarefa |
| Status | Etapa atual; os status podem ser adaptados ao seu fluxo |
| Prioridade | Ajuda a decidir o que fazer primeiro |
| Vencimento | Data-limite |
| Tags | Categorias livres para filtrar depois |

## Organizar a lista

- Por padrão você vê as tarefas atribuídas a você; alterne para ver todas as do workspace.
- Ordene por prioridade ou vencimento para enxergar o que vem primeiro.
- Duplique tarefas que se repetem e exclua as que perderam o sentido.

## Histórico de atividades

Cada tarefa guarda o próprio histórico: quem a criou, para quem foi atribuída, quais campos mudaram e quando o status ou a prioridade foram alterados. Com várias pessoas mexendo na mesma lista, fica fácil entender o que já aconteceu.

## Tarefas criadas pelo assistente

Adicione ao assistente a integração **Criar tarefa**. Ao fim da conversa, o assistente resume o pedido e os próximos passos e registra a tarefa. Você define:

- em que situação uma tarefa deve ser criada;
- o status e a prioridade iniciais;
- quem é o responsável;
- quais tags entram — inclusive tags que só valem em certas condições.

~~~text
Adicione a tag "Retorno" somente se a pessoa pedir explicitamente que a clínica ligue de volta.
~~~

Um resultado típico: a tarefa "Retornar ligação sobre clareamento", com um resumo curto, o número +55 11 90000-0123 e o melhor horário informado pela paciente.

### Ligação com a conversa

Toda tarefa criada pelo assistente traz o link da conversa de origem. A partir dela, o responsável abre a conversa, lê o resumo e a transcrição, vê os dados coletados e sabe qual assistente atendeu — sem procurar nada.

## Notificações

Você recebe um e-mail quando uma tarefa é atribuída a você e outro quando uma das suas tarefas muda; a mensagem diz qual tarefa foi alterada e por quem.

## Boas práticas

- Padronize poucas tags curtas, como "Retorno", "Orçamento", "Suporte" e "Urgente".
- Defina um responsável padrão para cada tipo de pedido, para que nada fique sem dono.
- Use a condição de criação para não gerar tarefas em conversas que já terminaram resolvidas.

:::tip[Precisa de ajuda?]
Clique em **Suporte**, no topo desta central, e conte qual fluxo de tarefas você quer montar.
:::`,
  },

  {
    section: 'products',
    slug: 'webchat',
    title: 'Chatbot de IA',
    description: 'Crie um assistente de chat e publique-o no seu site como widget ou como página de chat hospedada.',
    source: '[177]',
    related: ['products/whatsapp', 'actions/websearch', 'get-started/knowledge-base', 'legal/protecao-de-dados'],
    keywords: ['chatbot', 'webchat', 'widget', 'chat no site', 'chatbot hospedado', 'assistente de chat', 'sdk', 'lgpd'],
    body: `O Chatbot de IA coloca um assistente de chat da Kloel para responder os visitantes do seu site, com o mesmo conhecimento, regras e recursos que você já usa nos outros assistentes. Ele pode ser publicado de duas formas:

| Forma | Como aparece |
|---|---|
| **Widget** | Um balão de chat dentro das páginas do seu site |
| **Chatbot hospedado** | Uma página de chat própria, compartilhada por link ou QR code, sem instalar código |

O caminho é sempre o mesmo: criar um assistente de chat, decidir quem atende cada conversa, ensinar o assistente, testar e publicar.

## Experimente antes de criar

Para ver um resultado em segundos, abra [Criar chatbot de IA](/webchat/criar) ("Tenha seu Chatbot de IA em 30 segundos"). Informe o endereço do site e clique em **Criar IA**: a página monta um assistente de exemplo e abre a [demonstração](/demo-ia) com um chat funcionando. Sem site, use **Continuar sem site** para ver um assistente genérico. Da demonstração você segue para [Criar conta](/criar-conta) ou [Agendar demo](/agendar-demo).

::mockup{kind="webchat" caption="Widget do Chatbot de IA aberto no site da Clínica Bem Viver"}

## 1. Criar o assistente de chat

::::steps
### Novo assistente
Em [Assistentes](/app/agents), abra o seletor no topo e clique em **Novo assistente**.

### Tipo de assistente
Na janela **Criar assistente**, escolha **Assistente de chat** — ele atende WhatsApp e Chatbot de IA (o **Assistente de voz** é para ligações). Dê um nome, como "Maria", e clique em **Criar assistente**.

### Configurações básicas
Na aba **Geral**, confira **Nome**, **Idioma** e **Tempo limite da conversa**: por quanto tempo uma conversa pode ficar sem mensagens novas antes de ser encerrada (de 15 minutos a 24 horas, ou um período personalizado). Tempos curtos combinam com dúvidas rápidas; tempos longos, com visitantes que respondem mais tarde.
::::

:::tip[Mais de um idioma]
O **Idioma** define a língua padrão. Se o assistente deve acompanhar o visitante, diga isso no prompt: "Se a pessoa escrever em outro idioma, continue a conversa nesse idioma."
:::

## 2. Gerenciamento de conversa

Esta seção decide quem atende e quando a equipe entra em cena.

### Entrada da conversa

| Opção | O que acontece |
|---|---|
| **A IA lida com todas as conversas** | Toda conversa começa com o assistente |
| **A equipe lida com todas as conversas** | Toda conversa começa direto com uma pessoa |
| **Decidir usando uma condição** | Uma regra escolhe quem começa; o restante vai para a IA |

Seja específico na condição: em vez de "assuntos importantes", escreva "reclamações, dúvidas de cobrança ou pedidos para falar com uma pessoa".

### Agenda de resposta

Define quando a IA ou a equipe assume novas conversas: sempre, durante ou fora do horário de funcionamento — que pode ser editado ali mesmo. Um arranjo comum é a equipe atender no expediente e a IA à noite e nos fins de semana.

### Transferência de conversa ativa

Ligue **Habilitar transferência para a equipe** para que um chat já em andamento possa passar para uma pessoa.

| Modo | Quando usar |
|---|---|
| **Condições padrão** | Motivos usuais: pedido explícito por um humano, assunto sensível, pergunta que a IA não responde com segurança |
| **Condições padrão e personalizadas** | Recomendado: mantém os motivos usuais e acrescenta os seus (ex.: cancelamento de contrato, pedido de reembolso) |
| **Apenas condições personalizadas** | Só as suas regras valem; descreva-as com precisão |

### Notificações da equipe

Escolha quem é avisado quando um chat é transferido — apenas quem realmente atende essas conversas. A pessoa assume o atendimento em [Conversas](/app/inbox).

:::warning[Evite regras conflitantes]
O prompt personalizado também influencia transferências. Confira se ele não contradiz o que foi definido em **Gerenciamento de conversa**.
:::

## 3. Ensinar o assistente

- **Recursos:** o assistente de chat usa os mesmos cartões dos demais, como [Enviar e-mail](/ajuda/actions/email), [Pesquisa na web](/ajuda/actions/websearch), [Agendar compromissos](/ajuda/actions/appointments), **Integrações** e **Webhooks**. A criação de [tarefas](/ajuda/products/tasks) segue a mesma lógica. A condição de cada recurso fica no próprio recurso.
- **Regras:** tópicos permitidos, dados que podem ser pedidos, como lidar com assuntos sensíveis e o que nunca prometer. Frases curtas funcionam melhor que parágrafos longos.
- **Conhecimento:** horários, preços, serviços, endereço e perguntas frequentes. Ative as fontes que o chat pode usar.
- **Prompt personalizado:** papel, tom e roteiro da conversa.

> Comportamento vai no prompt. Fatos vão na base de conhecimento.

~~~markdown
## Papel
Você é a Maria, assistente virtual da Clínica Bem Viver. Escreva de forma cordial, clara e em mensagens curtas.

## Roteiro
Cumprimente e pergunte como pode ajudar.
Use apenas a base de conhecimento para falar da clínica; se a informação não estiver lá, diga isso com franqueza.
Se a pessoa quiser falar com alguém da equipe, siga as regras de transferência configuradas.

## Regras importantes
Não invente preços, tratamentos ou horários disponíveis.
Peça somente os dados necessários para o pedido atual.
~~~

## 4. Testar

Clique em **Testar chat**, no canto inferior direito, e simule situações reais: uma pergunta respondida pela base de conhecimento, outra que exige pesquisa no site, um pedido de agendamento, um pedido para falar com uma pessoa, uma mensagem fora do horário e um caso que deve gerar e-mail ou tarefa. Observe idioma, tom e transferências.

## 5. Publicar

Na seção **Chatbot de IA** do assistente, você gerencia as duas formas de publicação.

::::tabs
:::tab[Widget]
1. Na aba **Widget**, ative o widget e informe o site em que ele pode aparecer, com o domínio exato (ex.: \`https://www.exemplo.com.br\`).
2. Escreva a **Mensagem inicial**, curta e acolhedora: "Olá! Como podemos ajudar?"
3. Escolha **Flutuante** (balão no canto da tela) ou **Inline** (incorporado a uma área da página — recurso do plano Scale do Chatbot de IA; veja [Planos](/planos)).
4. Copie o código de incorporação e cole antes de \`</body>\` em todas as páginas em que o widget deve aparecer. Com um modelo central de site ou um gerenciador de tags, basta inserir uma vez.

~~~html
  <!-- cole aqui o código do widget da Kloel -->
</body>
~~~
:::
:::tab[Chatbot hospedado]
Na aba **Hospedado**, defina o nome da empresa e o trecho personalizado do endereço. O link pronto pode ir para o site, a assinatura de e-mail, as redes sociais, a página de contato ou um QR code impresso na recepção. Não é preciso instalar nada.
:::
::::

:::tip[Teste depois de instalar]
Abra o site numa janela anônima e confira se o widget aparece, se um novo chat começa e se as mensagens chegam em [Conversas](/app/inbox).
:::

### Aparência

Ajuste nome e identidade, cores, saudação, posição do widget, ícones do botão e do chat e textos de rodapé. Salve, abra a pré-visualização e confira também no celular.

## Para desenvolvedores: SDK do widget

Depois que o script carrega, o widget pode ser controlado pelo objeto \`window.kloel.webchat\`.

| Método | O que faz |
|---|---|
| \`open()\` | Mostra o widget e abre a janela de chat |
| \`close()\` | Fecha a janela; o botão continua visível |
| \`toggle()\` | Alterna entre aberto e fechado |
| \`show()\` | Exibe o widget sem abrir o chat |
| \`hide()\` | Esconde o widget sem encerrar a conversa |
| \`startNewConversation()\` | Abre o widget e começa uma conversa nova |
| \`setContext(context)\` | Envia contexto da página para o assistente |
| \`on(evento, callback)\` | Assina um evento e retorna uma função para cancelar a assinatura |

Se o seu código pode rodar antes do script do widget, espere o carregamento. O exemplo abaixo também liga o chat a um botão próprio do site:

~~~js
const script = document.querySelector('[data-kloel-webchat-widget-id]')

function iniciarChat() {
  window.kloel.webchat.setContext({ cliente: { id: 'cli-0042' }, pagina: 'ortodontia' })
  document.querySelector('#falar-conosco')
    .addEventListener('click', () => window.kloel.webchat.open())
}

if (window.kloel && window.kloel.webchat) iniciarChat()
else if (script) script.addEventListener('load', iniciarChat, { once: true })
~~~

### Regras do contexto

- Cada chamada de \`setContext()\` substitui o contexto anterior por inteiro — nada é mesclado. \`setContext({})\` limpa tudo.
- Envie um objeto compatível com JSON de até 8 KiB, de preferência antes de abrir o chat. Atualizações valem a partir da próxima mensagem do visitante.
- O contexto é tratado como informação não confiável vinda do site: ajuda o assistente a entender o visitante, mas não substitui regras nem instruções.
- Nunca envie senhas, chaves de API, dados de saúde ou outros dados sensíveis.
- O contexto do site faz parte dos planos mais altos do Chatbot de IA e é liberado mediante solicitação; confira em [Planos](/planos).

### Eventos

O callback recebe \`{ type, widgetId, sessionId }\`; o \`sessionId\` vem nos eventos ligados a uma conversa.

| Evento | Quando dispara |
|---|---|
| \`opened\` | A janela flutuante foi aberta |
| \`closed\` | A janela flutuante foi fechada |
| \`started\` | A primeira mensagem do visitante foi aceita |
| \`ended\` | A conversa foi encerrada explicitamente |
| \`handover_requested\` | Foi pedida transferência para uma pessoa |
| \`handover_taken\` | Alguém da equipe assumiu o chat |

~~~js
const eventos = ['opened', 'closed', 'started', 'ended', 'handover_requested', 'handover_taken']

eventos.forEach((nome) => {
  window.kloel.webchat.on(nome, ({ type, sessionId }) => {
    window.dataLayer = window.dataLayer || []
    window.dataLayer.push({ event: 'kloel_webchat_' + type, webchat_session_id: sessionId })
  })
})
~~~

:::warning[Medição e conversões]
Consentimento de cookies, GA4, Google Ads e metas de conversão são configurados por você no seu site; a Kloel não envia conversões ao Google. \`started\` indica só o início de uma conversa, não um lead. \`opened\` e \`closed\` existem apenas no modo flutuante, e eventos ocorridos com a página fechada não são reenviados.
:::

## Aviso de privacidade (LGPD)

Ao instalar o chatbot, descreva o tratamento de dados no aviso de privacidade do seu site. Inclua pelo menos:

- quem é o controlador e que a Kloel atua como operadora do serviço de chat;
- a finalidade: responder e dar continuidade aos atendimentos;
- os dados tratados, como nome, contato, conteúdo das mensagens, IP, navegador e data e hora;
- a base legal da Lei 13.709/2018 — em geral, procedimentos preliminares ou execução de contrato (art. 7º, V) ou legítimo interesse (art. 7º, IX); se as conversas puderem conter dados de saúde, avalie as hipóteses do art. 11;
- o prazo de guarda ou o critério de exclusão;
- os direitos do titular (art. 18) e o canal do encarregado;
- transferências internacionais, se houver.

:::info[Não é aconselhamento jurídico]
Esta lista é um ponto de partida. Revise o texto com o seu jurídico ou com o encarregado de dados. Veja também [Proteção de dados](/ajuda/legal/protecao-de-dados).
:::

:::tip[Precisa de ajuda?]
Clique em **Suporte**, no topo desta central, e informe o nome do assistente de chat, o site em que o widget foi instalado e o que acontece ao abri-lo.
:::`,
  },

  {
    section: 'products',
    slug: 'whatsapp',
    title: 'WhatsApp',
    description: 'Conecte um assistente de chat ao seu número de WhatsApp Business e responda mensagens automaticamente.',
    source: '[178]',
    related: ['products/webchat', 'actions/whatsapp-messages', 'actions/appointments'],
    keywords: ['whatsapp', 'whatsapp business', 'waba', 'meta', 'coexistência', 'conectar número', 'chat', 'atendimento'],
    body: `Conectando um assistente de chat ao seu número de WhatsApp Business, a Kloel responde mensagens automaticamente, consulta a base de conhecimento, agenda compromissos e passa a conversa para a sua equipe quando uma pessoa precisa entrar. Você pode assumir qualquer chat a qualquer momento em [Conversas](/app/inbox).

:::info[Produto contratado à parte]
O WhatsApp é um produto próprio da Kloel (IA de WhatsApp), com planos separados do assistente telefônico. Compare as opções em [Planos](/planos) e ative em [Faturamento](/app/billing).
:::

## App ou conta WhatsApp Business?

São duas coisas diferentes, e a Kloel precisa da segunda:

| | App WhatsApp Business | Conta WhatsApp Business (WABA) |
|---|---|---|
| O que é | O aplicativo no celular, onde você responde manualmente | Uma conta técnica administrada no portfólio empresarial da Meta |
| Papel na Kloel | Pode continuar em uso pelo modo de coexistência | É o que permite ligar o número à Kloel |

## O que o assistente faz no WhatsApp

- Responde com prompt, regras, base de conhecimento e horário de funcionamento próprios.
- Agenda pelo [Agendador da Kloel](/ajuda/actions/appointments) ou por integrações de calendário.
- Aciona webhooks, [requisições HTTP](/ajuda/developers/http-request) e integrações — por exemplo, para avisar a equipe no [Slack](/ajuda/integrations/slack).
- Transfere a conversa para uma pessoa conforme as regras de gerenciamento de conversa.

:::note[Ainda não disponível]
Mensagens proativas de saída para contatos e o envio de modelos de WhatsApp a clientes durante ou depois de uma ligação. Para avisar a sua equipe depois de uma ligação, use [Enviar WhatsApp](/ajuda/actions/whatsapp-messages).
:::

::mockup{kind="whatsapp" caption="Conta de WhatsApp conectada e conversa atendida pela assistente Maria"}

## 1. Preparar o assistente de chat

::::steps
### Crie o assistente
Em [Assistentes](/app/agents), abra o seletor, clique em **Novo assistente**, escolha **Assistente de chat** e dê um nome.

### Configure a aba Geral
Defina idioma, tempo limite da conversa, entrada da conversa, agenda de resposta e transferência para a equipe — as mesmas opções explicadas em [Chatbot de IA](/ajuda/products/webchat).

### Conecte conhecimento e recursos
Em **Conhecimento**, ative as fontes que o assistente pode usar e adicione os recursos necessários: e-mail, agendamento, pesquisa na web, webhooks e integrações. Fatos ficam na base de conhecimento; comportamento fica no prompt.

### Teste no navegador
Use **Testar chat** com perguntas típicas dos seus clientes. O idioma está certo? A base de conhecimento é usada? Agendamentos e integrações funcionam? A transferência acontece nas condições certas? O tom se mantém até o fim?
::::

:::tip[Comece por um modelo]
Parta de um modelo de prompt e adapte à sua empresa. Regras curtas e claras funcionam melhor do que instruções longas que se contradizem.
:::

## 2. Conectar o número

::::steps
### Abra a área WhatsApp
No menu **Mais**, abra [WhatsApp](/app/whatsapp) e inicie a configuração.

### Escolha a origem do número
Use um número novo fornecido pela Kloel ou conecte um número próprio. Se o número já funciona no app WhatsApp Business e deve continuar lá, siga a seção **Coexistência**, abaixo — e não remova o número do app.

### Entre na Meta
Faça login com uma conta Meta que tenha permissão de administrador e aceite todas as permissões pedidas; recusar alguma costuma fazer a configuração falhar mais adiante. Escolha ou crie o portfólio empresarial e a conta WhatsApp Business.

### Verifique o número
Selecione o número e confirme com o código recebido por SMS ou por ligação.

### Defina a mensagem inicial
Escreva o texto que já vem preenchido quando alguém abre o seu link — genérico o bastante para qualquer assunto, como "Olá! Tenho uma dúvida sobre os atendimentos da clínica." Salve.

### Confira a atribuição
Verifique qual assistente de chat responde por esse número.
::::

## 3. Divulgar e testar

Depois da conexão, a Kloel gera um link que abre um chat direto com o seu número. Use-o no site, na assinatura de e-mail, nas redes sociais ou como QR code em cartões e na recepção.

Faça então um teste real: abra o link no celular e mande uma mensagem. Confira se ela chegou à Kloel, se o assistente certo respondeu com as informações corretas, se os recursos funcionaram e se a conversa apareceu em [Conversas](/app/inbox).

Na gestão de perfis do número, ajuste o que os clientes veem: nome da empresa, descrição e os demais dados disponíveis.

## 4. Assumir uma conversa

Em [Conversas](/app/inbox), abra o chat do WhatsApp e assuma a conversa para escrever direto ao cliente. As transferências automáticas ficam em **Gerenciamento de conversa**, por exemplo:

~~~text
Transfira para a equipe se o paciente pedir para falar com uma pessoa ou quiser registrar uma reclamação.
~~~

Defina também quem da equipe recebe o aviso de transferência.

::mockup{kind="inbox" caption="Conversa de WhatsApp em Conversas, pronta para ser assumida pela equipe"}

## Coexistência: app e Kloel no mesmo número

Com a coexistência, um número que já funciona no app WhatsApp Business é conectado à Kloel sem sair do app. Você continua respondendo pelo celular quando quiser, e o assistente atende pela Kloel.

Você vai precisar de: número ativo no app WhatsApp Business, o celular com o app por perto, um portfólio empresarial da Meta (ou permissão para criar um) e acesso à conta Meta usada na conexão.

::::steps
### Inicie a conexão
Em [WhatsApp](/app/whatsapp), escolha a opção de coexistência e informe o número completo com código do país, como +55 11 90000-0123.

### Selecione o portfólio
Na janela da Meta, confira o resumo e escolha o portfólio empresarial — se a empresa já tem um, use esse.

### Confirme no celular
O app WhatsApp Business recebe uma mensagem. Abra-a, toque em **Conectar** e siga as etapas exibidas.

### Decida sobre o histórico
Escolha se as conversas anteriores serão compartilhadas. Se sim, elas são importadas depois da conexão; se não, o número conecta do mesmo jeito, mas sem o histórico.

### Conclua no navegador
Volte à janela do navegador e avance pelas etapas finais da Meta até concluir. A conexão termina em segundo plano.

### Atribua e teste
Quando o número aparecer como conectado, atribua-o a um assistente de chat e teste com um segundo telefone: mensagens novas chegam? O assistente certo responde? Dá para assumir a conversa? O histórico importado aparece?
::::

:::warning[Não reinicie no meio do processo]
Espere a conexão em andamento terminar. Começar de novo nesse intervalo pode deixar várias tentativas abertas e embaralhar a configuração.
:::

:::info[Histórico importado]
Históricos grandes levam mais tempo para sincronizar. Imagens e outras mídias antigas podem não vir completas e aparecer como balões vazios; os textos são preservados.
:::

## Erros comuns

| Sintoma | O que verificar |
|---|---|
| Limite de números na conta WhatsApp Business | Confirme se a empresa está verificada na central de segurança do gerenciador de negócios da Meta e veja os números ligados no Gerenciador do WhatsApp. Uma vaga recém-liberada pode demorar a aparecer. |
| "Número já em uso" | O número está ligado a outra conta, outro provedor ou outra conexão. Remova o vínculo antigo — ou use a coexistência, se ele deve continuar no app. |
| PIN da confirmação em duas etapas não confere | Comum quando o número foi removido e adicionado de novo. Desative a confirmação em duas etapas no Gerenciador do WhatsApp e reconecte. |
| A janela da Meta não abre | A conta tem perfil de administrador? Todas as permissões foram aceitas? Pop-ups e cookies de terceiros estão liberados? A organização certa está selecionada? O número tem código do país? |
| Mensagens não chegam à Kloel | Conexão concluída, assistente ativo, número atribuído ao assistente certo e configuração salva? Teste pelo link gerado. |
| Responde o assistente errado | Revise a atribuição do número, salve de novo e comece um chat novo. |
| Coexistência: a mensagem não chegou no app | O número informado na Kloel é o mesmo que está ativo no app WhatsApp Business? |

## Antes de chamar o Suporte

Separe o e-mail de login da sua conta, o nome do assistente, o número em formato internacional, uma captura da mensagem de erro, o horário da última tentativa, a etapa em que o processo parou e se a conexão é normal ou por coexistência. Com isso, a análise começa direto pelo ponto certo.

:::tip[Precisa de ajuda?]
Clique em **Suporte**, no topo desta central, e envie as informações acima.
:::`,
  },

  /* ─────────────────────────────────── Números de telefone ─────────────────────────────────── */
  {
    section: 'phone-numbers',
    slug: 'import-number',
    title: 'Importar um número de telefone',
    description: 'Use o seu número comercial atual como identificação nas ligações de saída do assistente.',
    source: '[179]',
    related: ['developers/outbound-calls', 'get-started/connect-your-number', 'get-started/troubleshooting', 'phone-numbers/pbx'],
    keywords: ['importar número', 'número próprio', 'ligações de saída', 'outbound', 'caller id', 'verificação', 'e.164'],
    body: `Importar um número permite que o assistente use o seu número comercial atual como identificação nas ligações de saída. Quem recebe a chamada vê um número que já conhece, e a linha continua com a sua operadora — sem portabilidade, sem cancelar contrato e sem mexer nas chamadas recebidas.

Ao importar, você apenas comprova que tem acesso ao número e que pode usá-lo para ligar.

:::warning[Pré-requisitos]
A importação faz parte das ligações ativas dos planos Team e Scale do assistente telefônico. Antes de ligar para fora, conclua também a verificação de identidade em [Faturamento](/app/billing).
:::

## O que muda e o que não muda

| Continua igual | Passa a valer |
|---|---|
| O número segue com a sua operadora | O assistente pode ligar mostrando esse número |
| Chamadas recebidas funcionam como antes | O número aparece em [Números de telefone](/app/phone-numbers) como importado |
| Não há portabilidade nem contrato novo | Você escolhe qual assistente usa o número para ligar |

:::info[Somente ligações de saída]
A importação não faz o assistente atender as chamadas desse número. Para isso, desvie o número para um número da Kloel — veja [Conectar seu número](/ajuda/get-started/connect-your-number).
:::

::mockup{kind="phone-numbers" caption="Números de telefone com um número importado atribuído a um assistente"}

## Antes de começar

- O plano e a verificação de identidade estão em dia.
- Você tem acesso à linha e consegue atender a ligação automática de verificação.
- O telefone envia tons de teclado (DTMF) durante a chamada.
- O número está anotado no formato internacional.

## Formato do número

Use o padrão E.164: \`+\`, código do país, DDD e número, tudo junto — sem espaços, parênteses, zero inicial ou código de operadora.

::::tabs
:::tab[Correto]
~~~text
+5511900000123
~~~
:::
:::tab[Incorreto]
~~~text
(11) 90000-0123          sem o código do país
011 90000-0123           formato de discagem nacional
0 21 11 90000-0123       com código de operadora
+55 0 11 90000-0123      zero extra depois do +55
~~~
:::
::::

## Importar passo a passo

::::steps
### Inicie a importação
Em **Mais → [Números de telefone](/app/phone-numbers)**, clique em **Adicionar número → Importar número**.

### Digite o número
Informe o número no formato internacional e inicie a verificação. A Kloel exibe um código de confirmação — mantenha a janela aberta para consultá-lo durante a chamada.

### Atenda a ligação de verificação
Você recebe uma chamada automática, que pode vir de um número internacional. Atenda e digite o código no teclado do telefone. Quando ele é aceito, o número aparece como verificado.

### Atribua a um assistente
Abra o assistente e selecione o número importado como número de saída. Cada assistente tem um único número de saída; para usar vários, duplique o assistente e dê um número a cada cópia.

### Faça uma ligação de teste
Ligue para um único contato de teste antes de qualquer volume. Para listas de contatos, use [Campanhas outbound](/app/campaigns) — veja também [Ligações de saída](/ajuda/developers/outbound-calls).
::::

:::warning[Chamada vinda do exterior]
Se a sua operadora ou o seu PABX bloqueia chamadas internacionais ou de números desconhecidos, a verificação não chega. Avise também quem atende o telefone da empresa para não rejeitar a chamada automática.
:::

## Checklist do primeiro teste

- A chamada começou normalmente?
- O destinatário viu o número importado?
- O assistente certo falou, com a mensagem inicial esperada?
- A ligação aparece em [Conversas](/app/inbox)?

## Se algo não estiver funcionando

| Sintoma | O que verificar |
|---|---|
| A ligação de verificação não chega | Formato internacional correto; bloqueio de chamadas internacionais ou desconhecidas; PABX antes da linha; desvio para caixa postal; linha livre no momento. Depois, refaça a verificação. |
| O código não é aceito | Digite devagar e por completo; confirme que o aparelho envia DTMF e que o PABX não altera os tons. Se o código expirou, feche a janela e comece de novo. |
| Erro de número sem configuração de saída ("no outbound config set up") | A importação e a verificação foram concluídas? O número aparece como verificado e está atribuído como número de saída ao assistente certo? Identidade e plano estão em dia? Um número usado só para receber chamadas não vira número de saída sozinho. |
| O destinatário vê outro número (ou nenhum) | Confira a atribuição no assistente e repita o teste. |

:::tip[Precisa de ajuda?]
Clique em **Suporte**, no topo desta central, e envie: número importado, nome do assistente, número chamado no teste, data e hora exatas, link ou ID da conversa e uma captura das configurações do número.
:::`,
  },

  {
    section: 'phone-numbers',
    slug: 'pbx',
    title: 'Kloel PBX: seu sistema telefônico direto na Kloel',
    description: 'Atenda e faça ligações pelo navegador, distribua chamadas entre a equipe e deixe o assistente cobrir as ausências.',
    source: '[180]',
    related: ['actions/call-transfer', 'get-started/connect-your-number', 'get-started/contacts', 'phone-systems/sip-numbers'],
    keywords: ['pbx', 'pabx', 'central telefônica', 'telefone no navegador', 'ramais', 'caixa postal', 'distribuição de chamadas', 'posição pbx'],
    body: `O Kloel PBX é uma central telefônica completa dentro da Kloel. Sua equipe atende e faz ligações pelo navegador, compartilha um número, transfere chamadas entre colegas e conta com o assistente de IA para atender quando ninguém está disponível ou a empresa está fechada — sem comprar aparelhos nem instalar hardware.

::mockup{kind="pbx" caption="Telefone do navegador com ramais da equipe e discador"}

## Começar

::::steps
### Adicione um número PBX
Em **Mais → Números de telefone**, clique em **Adicionar número → Adicionar número PBX**. Dê um nome claro ("Recepção SP", "Comercial"), escolha o país, procure um número disponível e confirme a compra. O número entra na lista com o status **Pronto**.

### Libere posições para a equipe
Em [Usuários](/app/users), ative a **posição PBX** de cada pessoa que vai usar a central. A coluna mostra quantas posições estão em uso e quantas ainda restam.

### Recarregue e use o telefone do navegador
Depois de liberar a posição, recarregue a página: o telefone aparece no canto inferior direito. Permita o acesso ao microfone no navegador.
::::

| Área do telefone | Para que serve |
|---|---|
| **Teclado** | Digitar um número e ligar |
| **Internos** | Ligar direto para colegas |
| **Configurações** | Ajustar o telefone e a sua disponibilidade |

:::warning[Mantenha a Kloel aberta]
As chamadas só tocam no navegador enquanto a Kloel está aberta e a pessoa está conectada.
:::

## Distribuir as chamadas recebidas

Na página do número PBX, defina quem toca quando entra uma chamada:

| Opção | Comportamento |
|---|---|
| **Ninguém** | Não toca para a equipe; vale direto a regra de "quando ninguém atende" |
| **Uma pessoa** | Toca para alguém específico, por um tempo definido (padrão de 30 segundos) |
| **Grupo em paralelo** | Todos os selecionados tocam juntos; fica com a chamada quem atender primeiro — bom para recepção, vendas ou suporte |
| **Um após o outro** | Toca em sequência, em até 10 etapas, cada uma com pessoa, tempo de toque e posição |
| **Assistente de IA** | O assistente escolhido atende todas as chamadas, 24 horas por dia |

:::tip[Equipe e assistente juntos]
No expediente, deixe a equipe tocar primeiro; à noite, de madrugada e nos fins de semana, o assistente assume.
:::

### Contatos que pulam o assistente

Quando o assistente atende, ative a **lista de contatos liberados** para que certos números toquem direto para a equipe: colaboradores, clientes antigos, fornecedores ou familiares. Os números precisam estar salvos em [Contatos](/app/contacts), e o roteamento pode ser **Uma pessoa**, **Grupo em paralelo** ou **Um após o outro**. Chamadas com número oculto não são reconhecidas.

## Quando ninguém atende

Ao fim do tempo de toque — ou quando não há ninguém atribuído ao número —, escolha uma destas opções:

- **Não fazer nada:** a ligação é encerrada.
- **Caixa postal:** quem liga deixa recado. A saudação pode ser digitada, gerada automaticamente com uma voz escolhida ou enviada como arquivo de áudio. Os recados ficam na caixa de entrada do número.
- **Assistente assume:** o assistente registra o pedido, responde dúvidas, agenda, prepara um retorno ou transfere para outra pessoa.

## Horário de funcionamento

Por padrão, o número fica disponível 24 horas. Ative o horário de funcionamento, escolha o fuso (como \`America/Sao_Paulo\`) e defina os horários de cada dia — com duas faixas no mesmo dia para o almoço, como 08:00–12:00 e 13:00–17:00. Em **Fora do horário de funcionamento**, escolha entre encerrar a ligação, caixa postal ou assistente.

## Transferências

- **Entre colegas:** pelo telefone do navegador, transfira para uma pessoa ou um grupo. A transferência é direta, sem checar antes se a pessoa está livre — avise quem está na linha antes de passar.
- **Do assistente para o PBX:** no recurso [Transferir ligações](/ajuda/actions/call-transfer), escolha o número PBX como destino. A equipe recebe a chamada sabendo que ela vem do assistente, com o nome de quem liga e o pedido registrado até ali.

:::warning[Requisito da transferência para o PBX]
Ela só funciona se a ligação chegou ao assistente por um número PBX. Chamadas recebidas por um número comum da Kloel não podem ser passadas para o PBX.
:::

## Após a chamada e opções avançadas

- **Ação após a chamada:** adicione um e-mail automático com nome, telefone, resumo da conversa, pedido de retorno e link da conversa.
- **Identificação de chamadas:** escolha qual número aparece nas ligações de saída.
- **Acesso SIP:** conecte telefones de mesa e outros aparelhos SIP — veja [Números SIP](/ajuda/phone-systems/sip-numbers).
- **Gravação:** defina se as conversas são gravadas e transcritas.

:::warning[Gravação e LGPD]
Se gravar, avise quem liga já na mensagem inicial e trate as gravações conforme a LGPD, com finalidade e prazo de guarda definidos.
:::

## Testar a configuração

1. Ligue no horário de funcionamento e confira se as pessoas certas tocam.
2. Não atenda de propósito e veja se a caixa postal ou o assistente assume.
3. Ligue de um contato liberado e confirme que ele pula o assistente.
4. Faça uma ligação de saída pelo telefone do navegador.
5. Transfira uma chamada para uma pessoa e depois para um grupo.
6. Ligue fora do horário e confira a regra configurada.

## Limitações atuais

- Transferências pelo telefone do navegador e pelo assistente são sempre diretas (*blind transfer*).
- Ainda não é possível consultar o colega antes de passar a ligação.

:::tip[Precisa de ajuda?]
Clique em **Suporte**, no topo desta central, e descreva como o número PBX está configurado e o que aconteceu na chamada de teste.
:::`,
  },
]
