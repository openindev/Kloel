import type { HelpArticle } from './types'

/**
 * Central de ajuda — aba Integrações › Desenvolvedores e Sistemas telefônicos.
 * Fontes: INVENTORY [182]–[188] (notas de referência reescritas e adaptadas à Kloel / Brasil).
 */
export const DEVELOPER_ARTICLES: HelpArticle[] = [
  /* ------------------------------------------------------------------------------------------ */
  {
    section: 'developers',
    slug: 'http-request',
    title: 'Requisição HTTP',
    description: 'Chame um endpoint seu antes, durante ou depois de uma conversa para buscar ou registrar dados da ligação.',
    source: '[182]',
    related: ['developers/inbound-webhook', 'developers/test-context', 'developers/outbound-api', 'integrations/n8n'],
    keywords: ['webhook', 'API', 'endpoint', 'integração própria', 'POST', 'variáveis personalizadas', 'CRM', 'requisição'],
    body: `A **Requisição HTTP** liga o seu assistente a um sistema que você controla — CRM, banco de dados, ERP ou um fluxo no n8n ou no Make. Você define endereço, método e conteúdo, e a Kloel faz a chamada no momento escolhido, com dados da própria ligação:

| Momento | Para que serve |
|---|---|
| Antes da conversa | Avisar seu sistema de que uma ligação está chegando ou preparar dados a partir do número de quem liga |
| Durante a conversa | Consultar algo em tempo real — status de pedido, saldo, vaga na agenda — e responder na hora |
| Depois da conversa | Gravar no CRM o resultado, um pedido de retorno ou uma nova solicitação |

::mockup{kind="agent-resources" highlight="webhooks" caption="Cartão Webhooks na seção Recursos da aba Geral do assistente"}

## Como criar a requisição

::::steps
### Abra o cartão Webhooks
Em [Assistentes](/app/agents), escolha o assistente. Na aba **Geral**, desça até **Recursos** e clique no cartão **Webhooks**.

### Adicione a requisição
Na folha lateral, clique em **Adicionar novo webhook** e selecione **Adicionar requisição HTTP**. Dê um nome único que descreva a função, como "Consultar status do pedido".

### Defina o momento em Executar
Na aba **Geral** da requisição, o campo **Executar** oferece três opções:
- **Antes da conversa**: roda antes do atendimento. Só existe o que já se sabe nesse instante (número de quem liga, número chamado, contexto já carregado), então não dá para condicionar ao que será dito.
- **Durante a conversa**: o assistente decide quando chamar. Explique isso no campo **Quando a IA deve usar isso?**.
- **Depois da conversa**: roda quando a ligação termina. Uma condição opcional pode ser escrita na aba **Avançado**; sem ela, a requisição dispara ao fim de toda conversa.

### Escolha a disponibilidade
Indique se a requisição vale **Sempre**, apenas **Dentro do horário de funcionamento** ou apenas **Fora do horário de funcionamento**. A regra se aplica a qualquer um dos três momentos.
::::

## Endereço e método

Na aba **Requisição**, informe a URL do endpoint. Ela pode conter variáveis — insira-as pelo botão **Adicionar variável** para evitar erros de digitação:

~~~text
https://api.exemplo.com.br/pedidos/{{numero_pedido}}
~~~

Os métodos aceitos são **GET**, **POST**, **PUT**, **PATCH** e **DELETE**. Uma requisição GET não leva corpo: passe o necessário no caminho ou em parâmetros de consulta, como \`?pedido={{numero_pedido}}\`.

::mockup{kind="http-request" caption="Requisição HTTP com método, URL, cabeçalhos e corpo JSON com variáveis"}

## Cabeçalhos e corpo

Os **Headers** são escritos em JSON. O uso mais comum é a autenticação:

~~~json
{
  "Authorization": "Bearer SEU_TOKEN",
  "Content-Type": "application/json"
}
~~~

Em POST, PUT, PATCH e DELETE você pode enviar um corpo JSON, combinando variáveis do sistema com variáveis suas:

~~~json
{
  "pedido": "{{numero_pedido}}",
  "telefone": "{{personNumber}}",
  "linhaAtendida": "{{agentNumber}}",
  "conversa": "{{conversationLink}}"
}
~~~

| Variável do sistema | Conteúdo |
|---|---|
| \`{{personNumber}}\` | Número da pessoa do outro lado da linha |
| \`{{agentNumber}}\` | Número do assistente que atendeu ou fez a ligação |
| \`{{conversationLink}}\` | Link para a conversa em [Conversas](/app/inbox) |

:::warning[JSON válido]
Depois que as variáveis forem substituídas, cabeçalhos e corpo precisam continuar sendo JSON válido. Uma aspa faltando ou uma vírgula sobrando fazem a requisição falhar.
:::

## Variáveis personalizadas

Toda variável que você cria — como \`{{numero_pedido}}\` — aparece na lista **Variáveis personalizadas**. É o assistente quem preenche esses valores a partir da conversa, por isso cada uma pede:

- **Nome**
- **Tipo**: **String** (texto), **Number** (número) ou **Boolean** (sim/não)
- **Descrição**: o que exatamente deve ser capturado

Quanto mais precisa a descrição, melhor o preenchimento. Compare:

~~~text
Vaga:      pedido
Precisa:   Código do pedido dito pela pessoa. Começa com BV seguido de seis dígitos, por exemplo BV204518.
~~~

:::warning[Descrição obrigatória]
Sem descrição o assistente não sabe o que colocar na variável. O botão de salvar fica desativado até que todas as variáveis estejam descritas.
:::

## Frase de espera

Em requisições **durante a conversa**, a aba **Avançado** tem um campo para o que o assistente diz enquanto aguarda a resposta, evitando silêncio na linha:

~~~text
Só um instante, estou consultando o seu pedido.
~~~

## Como o assistente usa a resposta

Quando a requisição roda durante a conversa, o retorno do endpoint vira informação para o assistente. Exemplo: a pessoa pergunta pelo pedido, o assistente pede o código, a Kloel consulta o seu sistema e o assistente explica o status e a previsão de entrega com as próprias palavras.

São processados até **96.000 caracteres** de resposta; o excedente é descartado automaticamente.

:::tip[Responda pouco e bem estruturado]
Devolva só os campos de que o assistente precisa, num JSON pequeno. A resposta fica mais rápida e o risco de interpretação errada cai.
:::

## Reaproveitar dados do Webhook de entrada

Se você carrega dados antes da ligação com o [Webhook de entrada](/ajuda/developers/inbound-webhook), pode repassá-los em qualquer requisição pelo prefixo \`inboundContext\`:

~~~json
{
  "clienteId": "{{inboundContext.clienteId}}",
  "conversa": "{{conversationLink}}"
}
~~~

Esses valores chegam exatamente como seu sistema os enviou; o assistente não os reescreve. Prefira esse caminho para IDs de cliente, números de contrato, IDs de registro no CRM e status exatos.

## Exemplos

::::tabs
:::tab[Durante a conversa]
**Quando a IA deve usar isso?**

~~~text
Quando a pessoa quiser saber a situação de um pedido. Peça o código do pedido antes de consultar.
~~~

**Método e URL:** \`POST https://api.exemplo.com.br/status-pedido\`

~~~json
{ "pedido": "{{numero_pedido}}" }
~~~

**Frase de espera:** "Um momento, vou buscar as informações do seu pedido."
:::
:::tab[Depois da conversa]
**Condição (aba Avançado):**

~~~text
Execute somente se ficou combinado um retorno de ligação.
~~~

**Método e URL:** \`POST https://api.exemplo.com.br/retornos\`

~~~json
{
  "nome": "{{nome_cliente}}",
  "telefone": "{{personNumber}}",
  "assunto": "{{assunto}}",
  "conversa": "{{conversationLink}}"
}
~~~
:::
::::

## Liberar a Kloel no firewall

Se o endpoint só aceita endereços conhecidos, inclua na lista de permissões os IPs de saída da Kloel — por exemplo, \`203.0.113.10\`, \`203.0.113.11\` e \`198.51.100.20\`.

## Se algo não estiver funcionando

| Sintoma | O que verificar |
|---|---|
| A requisição nunca roda | O momento em **Executar**, a condição e a disponibilidade por horário |
| Seu sistema recusa a chamada | URL, método, cabeçalhos e credenciais |
| Não é possível salvar | Alguma variável personalizada está sem descrição |
| Uma variável chega vazia | A informação foi dita na conversa? A descrição é específica? |
| A resposta chega incompleta | O retorno passou de 96.000 caracteres |
| Silêncio durante a consulta | Falta a frase de espera em **Avançado** |
| Funciona só em parte das ligações | A disponibilidade está limitada ao horário de funcionamento |
| O firewall bloqueia a chamada | Os IPs da Kloel estão na lista de permissões? |

:::tip[Precisa de ajuda?]
Clique em **Suporte**, no topo desta central, e informe o nome do assistente, o nome da requisição e o horário de uma ligação em que ela falhou.
:::`,
  },

  /* ------------------------------------------------------------------------------------------ */
  {
    section: 'developers',
    slug: 'microsoft',
    title: 'Conectar conta Microsoft e caixas de correio compartilhadas',
    description: 'Saiba quais caixas de e-mail podem ser ligadas ao E-Mail IA e como conectar contas Microsoft, inclusive caixas compartilhadas.',
    source: '[183]',
    related: ['actions/email', 'get-started/troubleshooting', 'developers/http-request'],
    keywords: ['Outlook', 'Microsoft 365', 'shared mailbox', 'caixa compartilhada', 'Google Workspace', 'consentimento do administrador', 'E-Mail IA', 'Gmail'],
    body: `O [E-Mail IA](/app/email-agents) (Beta) lê as mensagens recebidas e prepara ou envia respostas. Para isso, ele precisa entrar em uma **caixa de correio de verdade**: com caixa de entrada própria e um login que funcione.

Endereços que só redistribuem mensagens não servem. Listas de distribuição, regras de encaminhamento e Google Groups entregam o e-mail na caixa de outras pessoas, mas não têm uma caixa própria onde o E-Mail IA possa trabalhar.

## Contas suportadas

| Tipo de conta | Pode conectar? |
|---|---|
| Conta Microsoft pessoal | Sim, diretamente |
| Caixa de usuário do Microsoft 365 | Sim, diretamente |
| Caixa compartilhada do Microsoft 365 | Sim, depois de uma preparação feita pelo administrador |
| Conta Google pessoal | Sim, diretamente |
| Caixa própria do Google Workspace | Sim, diretamente |
| Caixa Google delegada | Sim, mas quem conecta é o dono da conta |
| Google Group ou endereço de grupo | Não |

## Conectar uma conta Microsoft

::::steps
### Inicie a conexão
Abra [E-Mail IA](/app/email-agents), comece a conexão de uma nova caixa e escolha **Microsoft** como provedor.

### Entre com a conta certa
Faça login exatamente com a conta cujas mensagens o assistente deve ler e responder — que pode não ser a sua conta pessoal.

### Aceite as permissões
A Microsoft lista as permissões necessárias para ler a caixa e enviar respostas. Confirme para concluir. Em algumas empresas, esta etapa depende de aprovação do administrador (veja abaixo).

### Confira o resultado
A caixa deve aparecer como conectada. Valide os pontos da seção "Verificar a conexão".
::::

::mockup{kind="email-inbox" caption="E-Mail IA com a caixa conectada e um rascunho de resposta preparado"}

## Quando aparece a aprovação do administrador

Cada organização Microsoft decide se os usuários podem autorizar aplicativos sozinhos ou se precisam de uma liberação central. Se a tela mostrar **Approval required** ou **Administrator approval required**, peça ao administrador do Microsoft 365 que aprove o aplicativo para a empresa. Em seguida, quem cuida da caixa refaz a conexão.

:::warning[O administrador não deve entrar na janela de conexão]
Se o administrador fizer login ali mesmo, a caixa conectada será a dele. O correto é: ele libera o aplicativo de forma central e, depois, a conexão é iniciada de novo com a caixa desejada.
:::

## Verificar a conexão

- O endereço exibido é o esperado?
- As mensagens novas estão sendo sincronizadas?
- O E-Mail IA consegue criar um rascunho ou uma resposta?
- A resposta sai pelo endereço correto?
- A caixa do administrador não foi conectada por engano?

Para testar, envie uma mensagem a partir de outro endereço, como \`teste@exemplo.com.br\`.

## Caixas compartilhadas do Microsoft 365

Endereços como \`atendimento@exemplo.com.br\` ou \`contato@exemplo.com.br\` costumam ser caixas compartilhadas: várias pessoas da equipe acessam e respondem por elas. Por trás de cada uma existe uma conta de usuário, mas a Microsoft bloqueia o login direto nela por padrão — a caixa foi pensada para ser aberta por quem tem permissão, não com senha própria. Por isso há dois caminhos.

### Opção 1 (recomendada): caixa de usuário só para o E-Mail IA

Crie uma caixa de usuário comum, por exemplo \`assistente@exemplo.com.br\`, com caixa de entrada, credenciais e login normais, além das permissões de leitura e envio. Ela se conecta diretamente, sem ajustes especiais, e deixa claro a quais mensagens o assistente tem acesso.

### Opção 2: preparar a caixa compartilhada

A caixa compartilhada pode ser conectada como uma conta comum, desde que o administrador a prepare. Em geral, isso envolve:

- localizar a conta de usuário associada à caixa compartilhada;
- liberar o login direto e definir uma senha;
- conceder as permissões de e-mail e, se preciso, o consentimento do administrador;
- conectar a caixa no E-Mail IA com essas credenciais.

:::warning[Alinhe com o seu administrador]
A recomendação geral da Microsoft é manter bloqueado o login direto em caixas compartilhadas. Se a política de segurança da sua empresa não admitir essa exceção, siga a Opção 1.
:::

## E no Google?

O Google não tem uma caixa compartilhada como a da Microsoft. Há duas coisas diferentes:

- **Conta do Google Workspace** (ex.: \`contato@exemplo.com.br\`) com caixa e login próprios: pode ser conectada. Se outras pessoas precisarem dela, use a delegação do Google — mas a conexão com o E-Mail IA deve ser feita pelo **dono da conta**. Credenciais de quem tem só acesso delegado não funcionam.
- **Google Group**, que recebe e redistribui mensagens aos membros. Ele não tem caixa de entrada própria e, por isso, não pode ser conectado.

:::info[Grupo não é caixa compartilhada]
Várias pessoas recebendo pelo mesmo endereço não significa que exista uma caixa comum. Normalmente, cada cópia vai para a caixa pessoal de cada membro.
:::

Se você já usa um Google Group, há duas saídas: criar uma conta do Workspace com o endereço desejado (a opção mais limpa) ou conectar a conta de um membro que recebe as mensagens do grupo — sabendo que, nesse caso, o assistente também enxerga as demais mensagens daquela pessoa.

## Qual caminho seguir

| Situação | O que fazer |
|---|---|
| Caixa Microsoft pessoal ou de usuário do 365 | Conectar diretamente |
| Caixa compartilhada do Microsoft 365 | Criar uma caixa de usuário dedicada ou pedir a preparação ao administrador |
| Conta Google pessoal ou do Workspace | Conectar diretamente |
| Caixa Google delegada | O dono da conta faz a conexão |
| Google Group | Criar uma conta própria do Workspace |

## Se algo não estiver funcionando

| Sintoma | O que verificar |
|---|---|
| A Microsoft pede aprovação do administrador | O aplicativo precisa ser liberado centralmente; depois, conecte de novo com a caixa certa |
| A caixa conectada é a do administrador | Desconecte essa conta, peça a liberação central e refaça o login com o usuário correto |
| A caixa compartilhada não consegue entrar | O login direto está bloqueado: prepare a caixa (Opção 2) ou use uma caixa de usuário |
| O Google Group não aparece | Grupos não têm caixa; crie uma conta do Workspace ou use a de um membro |
| Usuário delegado não consegue conectar | Somente o dono da conta Google pode concluir a conexão |

:::tip[Precisa de ajuda?]
Use o botão **Suporte** no topo desta central. Informe o endereço da caixa, o provedor, o tipo (usuário, compartilhada ou grupo), se há aprovação de administrador pendente e uma captura da mensagem de erro. Nunca envie senhas.
:::`,
  },

  /* ------------------------------------------------------------------------------------------ */
  {
    section: 'developers',
    slug: 'test-context',
    title: 'Contexto de teste',
    description: 'Guarde valores de exemplo para as variáveis de webhook e teste o assistente sem depender do seu sistema real.',
    source: '[184]',
    related: ['developers/inbound-webhook', 'developers/http-request', 'get-started/write-a-great-prompt'],
    keywords: ['test context', 'valores de teste', 'variáveis', 'simular cliente', 'ligação de teste', 'JSON', 'placeholder'],
    body: `O **Contexto de teste** (Test Context) guarda valores de exemplo para as variáveis que, em produção, chegam pelo [Webhook de entrada](/ajuda/developers/inbound-webhook): nome do cliente, código de cadastro, situação do contrato e assim por diante.

Com ele você confere a mensagem inicial e o prompt na **Ligação de teste** sem fazer uma ligação real e sem consultar o seu sistema a cada tentativa.

## Configurar o Contexto de teste

::::steps
### Abra o cartão Webhooks
Em [Assistentes](/app/agents), escolha o assistente e, na aba **Geral**, vá até **Recursos** e clique em **Webhooks**.

### Selecione Contexto de teste
Na lista da folha lateral, abra o item **Contexto de teste**.

### Escreva os valores em JSON
Informe um objeto JSON válido. Cada chave vira uma variável com o mesmo nome. Use o exemplo abaixo como ponto de partida.

### Salve
Salve as alterações. Os valores passam a valer nos testes deste assistente.
::::

~~~json
{
  "nome": "Mariana",
  "clienteId": "BV-2087",
  "situacaoContrato": "ativo",
  "ultimaConsulta": "12 de setembro"
}
~~~

::mockup{kind="resource-sheet" title="Contexto de teste" fields="Tipo=Contexto de teste|Formato=JSON|Variáveis=nome, clienteId, situacaoContrato, ultimaConsulta" caption="Folha do cartão Webhooks com os valores de teste salvos"}

## Usar as variáveis no prompt e na mensagem inicial

As chaves do JSON funcionam como qualquer variável de webhook. Escreva-as entre chaves duplas nas **Mensagens iniciais** ou no **Prompt personalizado**:

~~~text
Olá, {{nome}}! Que bom falar com você de novo aqui na Clínica Bem Viver.
~~~

Com o contexto acima, a assistente Roberta diria:

~~~text
Olá, Mariana! Que bom falar com você de novo aqui na Clínica Bem Viver.
~~~

As variáveis também podem orientar regras, por exemplo na aba **Regras**:

~~~text
Se {{situacaoContrato}} for "suspenso", explique com gentileza que o agendamento depende da regularização e ofereça transferir para o financeiro.
~~~

## Validar com a Ligação de teste

Clique em **Ligação de teste** no assistente e converse normalmente. Observe:

- Todas as variáveis foram trocadas pelos valores? Nenhum \`{{...}}\` deve ser falado.
- Nomes, códigos e datas são pronunciados corretamente?
- As regras que dependem das variáveis disparam quando deveriam?
- O assistente se comporta bem quando um valor está ausente?

::mockup{kind="test-call" caption="Ligação de teste no navegador usando os valores do Contexto de teste"}

:::warning[Somente para testes]
O Contexto de teste fornece valores de teste. Em uma ligação real, os dados continuam vindo do Webhook de entrada. O Contexto de teste não envia nada ao seu sistema externo e não altera nenhum dado lá.
:::

## Testar vários cenários

Troque o JSON, salve e repita a Ligação de teste para simular perfis diferentes:

::::tabs
:::tab[Cliente ativo]
~~~json
{ "nome": "Mariana", "situacaoContrato": "ativo" }
~~~

O assistente deve seguir o atendimento normal.
:::
:::tab[Contrato suspenso]
~~~json
{ "nome": "Paulo", "situacaoContrato": "suspenso" }
~~~

A regra de contrato suspenso deve entrar em ação.
:::
:::tab[Sem cadastro]
~~~json
{}
~~~

Com o objeto vazio, confira se o assistente cumprimenta sem usar nome e pede os dados de que precisa.
:::
::::

## Contexto de teste ou valores padrão?

O Webhook de entrada também tem um campo de **Valores padrão**. Os dois se complementam:

| | Contexto de teste | Valores padrão do Webhook de entrada |
|---|---|---|
| Quando vale | Somente nos testes | Nas ligações reais (quando o webhook não devolve um campo) e nos testes |
| Objetivo | Simular cenários e ajustar o prompt | Garantir um valor de reserva seguro |

## Quando usar

- Ajustar uma mensagem inicial personalizada.
- Trabalhar no prompt enquanto o endpoint ainda não está pronto.
- Simular diferentes situações de cliente.
- Separar um erro de prompt de um erro de webhook: se tudo funciona com o Contexto de teste, o prompt está certo e a investigação vai para o webhook.
- Evitar ligações reais repetidas só para testar variáveis.

## Se algo não estiver funcionando

| Sintoma | O que verificar |
|---|---|
| Não consigo salvar | O conteúdo é JSON válido (aspas duplas, sem vírgula sobrando)? |
| O assistente fala o nome da variável | A grafia no prompt é idêntica à chave do JSON, inclusive maiúsculas? |
| Funciona no teste, falha na ligação real | O Webhook de entrada está ativo e devolve as mesmas chaves? |
| Um valor é pronunciado de forma estranha | Ajuste a pronúncia na aba **Regras** ou formate o valor de outro jeito |

:::tip[Precisa de ajuda?]
Clique em **Suporte**, no topo desta central, e descreva o assistente, o JSON usado e o que aconteceu na Ligação de teste.
:::`,
  },

  /* ------------------------------------------------------------------------------------------ */
  {
    section: 'developers',
    slug: 'inbound-webhook',
    title: 'Webhook de entrada',
    description: 'Busque dados do seu sistema antes de uma ligação recebida e use-os durante toda a conversa.',
    source: '[185]',
    related: ['developers/test-context', 'developers/http-request', 'developers/outbound-api', 'integrations/makecom'],
    keywords: ['inbound webhook', 'pré-carregar dados', 'identificar cliente', 'inboundContext', 'CRM', 'n8n', 'Make', 'valores padrão'],
    body: `Com o **Webhook de entrada**, a Kloel consulta o seu sistema no instante em que uma ligação chega, antes de o assistente dizer a primeira palavra. Assim, a Roberta já pode cumprimentar a pessoa pelo nome e saber o código do cadastro ou a situação do contrato.

## Como funciona

1. Uma ligação chega a um número atribuído ao assistente.
2. A Kloel envia ao seu endpoint o número de quem liga e o número chamado.
3. Seu sistema procura o cadastro correspondente e responde com um objeto JSON.
4. Cada campo da resposta vira uma variável disponível durante toda a conversa.

Exemplo de resposta e de mensagem inicial que a utiliza:

~~~json
{
  "nome": "Mariana",
  "clienteId": "BV-2087",
  "situacaoContrato": "ativo"
}
~~~

~~~text
Olá, {{nome}}! Aqui é a Roberta, da Clínica Bem Viver. Em que posso ajudar?
~~~

## O que você precisa

- Um endpoint acessível publicamente.
- Um backend próprio ou uma ferramenta de automação, como [n8n](/ajuda/integrations/n8n) ou [Make](/ajuda/integrations/makecom).
- Uma fonte de dados: CRM, banco de dados ou planilha.
- Opcional: um cliente HTTP para testes, como Postman ou \`curl\`.

## Configurar

::::steps
### Abra o Webhook de entrada
Em [Assistentes](/app/agents), escolha o assistente, vá em **Geral** → **Recursos** → **Webhooks** e abra **Webhook de entrada**. Ligue a opção **Webhook de entrada ativo**.

### Escolha o método
Somente **GET** e **POST** estão disponíveis. Com GET, os valores vão na própria URL; com POST, seguem em um corpo JSON.

:::info[Precisa de PUT, PATCH ou DELETE?]
Esses métodos ficam na [Requisição HTTP](/ajuda/developers/http-request), que é um recurso separado.
:::

### Informe a URL
Em **URL do webhook**, cole o endereço do endpoint. Use **Adicionar variável** para incluir valores conhecidos na URL.

### Defina cabeçalhos e corpo
Os cabeçalhos são escritos em JSON, geralmente para autenticação. No POST, o corpo define o que é enviado. Veja os exemplos abaixo.

### Preencha os valores padrão
Em **Valores padrão**, informe um JSON de reserva, usado quando o endpoint não devolve algum campo. Esses valores também valem na **Ligação de teste**.
::::

## Exemplos de configuração

Cabeçalhos:

~~~json
{
  "Authorization": "Bearer SEU_TOKEN",
  "Content-Type": "application/json"
}
~~~

Corpo de uma requisição POST — prefira inserir as variáveis por **Adicionar variável**, que garante o nome correto:

~~~json
{
  "deNumero": "{{personNumber}}",
  "paraNumero": "{{agentNumber}}"
}
~~~

Em números SIP, você também pode repassar cabeçalhos SIP com \`{{sipHeaders.nomeDoCabecalho}}\`.

Valores padrão:

~~~json
{
  "nome": "",
  "clienteId": "",
  "situacaoContrato": "não identificado"
}
~~~

:::tip[Valores padrão que soam naturais]
Os valores padrão podem aparecer em ligações reais. Escolha textos que façam sentido para quem liga e instrua o prompt a não usar o nome quando ele estiver vazio.
:::

::mockup{kind="http-request" caption="Webhook de entrada com método POST, URL, cabeçalhos e corpo com variáveis"}

## A resposta do seu endpoint

- Devolva sempre JSON válido. Se ninguém for encontrado, responda pelo menos \`{}\`.
- A resposta precisa chegar em até **5 segundos** (5.000 ms).
- Com POST, aceite e devolva \`application/json\`.

:::warning[Resposta lenta ou inválida]
Se o prazo estourar ou o JSON vier quebrado, os dados do seu sistema não entram na conversa.
:::

## Usar os valores no prompt

Todo campo da resposta vira variável. Com a resposta do exemplo, você pode escrever no **Prompt personalizado**:

~~~text
Cumprimente a pessoa pelo nome em {{nome}}.
Se ela pedir o número de cadastro, informe apenas o valor de {{clienteId}}.
~~~

## Exemplo com n8n ou Make

1. Um gatilho de webhook recebe a chamada da Kloel.
2. O fluxo procura o número no CRM ou na planilha.
3. Um ramo trata o cliente conhecido; outro, o desconhecido.
4. O fluxo responde com JSON.

::::tabs
:::tab[Cliente conhecido]
~~~json
{ "nome": "Mariana", "clienteId": "BV-2087" }
~~~
:::
:::tab[Cliente desconhecido]
~~~json
{}
~~~
:::
::::

## Levar os dados até o fim da conversa

Os valores do Webhook de entrada não mudam durante a ligação. No prompt e na mensagem inicial, use o nome direto (\`{{nome}}\`). Em uma [Requisição HTTP](/ajuda/developers/http-request) — depois da conversa, por exemplo — use o prefixo \`inboundContext\`, como em \`{{inboundContext.clienteId}}\`. Assim, o ID exato do início da ligação volta intacto ao seu CRM.

:::info[Contexto de entrada x variáveis personalizadas]
O \`inboundContext\` traz o que seu sistema enviou, sem interpretação do assistente. Já as variáveis personalizadas são extraídas da conversa. Para IDs, contratos e valores exatos, prefira sempre o contexto de entrada.
:::

## Testar

Primeiro, teste o endpoint isoladamente, com um número cadastrado e outro desconhecido:

~~~json
{
  "deNumero": "+5511900000123",
  "paraNumero": "+5511900000100"
}
~~~

Depois, faça uma ligação real para o número do assistente e confira se os dados aparecem na conversa. Para ajustar o prompt sem ligar, use o [Contexto de teste](/ajuda/developers/test-context).

:::warning[Ligação real necessária]
O Webhook de entrada é disparado por ligações recebidas de verdade. A Ligação de teste no navegador não o aciona da mesma forma.
:::

## Lista de permissões

Se o endpoint só aceita IPs conhecidos, libere os endereços de saída da Kloel — por exemplo, \`203.0.113.10\`, \`203.0.113.11\` e \`198.51.100.20\`.

## Se algo não estiver funcionando

| Sintoma | O que verificar |
|---|---|
| O webhook não é chamado | URL correta, endpoint público e **Webhook de entrada ativo** ligado |
| As variáveis ficam vazias | A resposta é JSON válido com os nomes de campo esperados? |
| O assistente fala o placeholder | A grafia da variável no prompt confere com o campo? |
| A conversa começa sem dados | O endpoint respondeu em menos de 5 segundos? |
| Um cliente cadastrado não é encontrado | Seu sistema guarda os números no mesmo formato internacional (+55…)? |
| O teste isolado funciona, a ligação não | Um firewall ou a lista de permissões está bloqueando a Kloel? |

:::tip[Precisa de ajuda?]
Clique em **Suporte**, no topo desta central, e informe o assistente, a URL configurada (sem tokens) e o horário de uma ligação afetada.
:::`,
  },

  /* ------------------------------------------------------------------------------------------ */
  {
    section: 'developers',
    slug: 'outbound-calls',
    title: 'Ligações outbound',
    description: 'Crie uma campanha para o assistente ligar para uma lista de contatos ou dispare ligações individuais pelo seu sistema.',
    source: '[186]',
    related: ['developers/outbound-api', 'phone-numbers/import-number', 'phone-systems/sip-numbers', 'get-started/contacts'],
    keywords: ['campanha', 'ligações de saída', 'outbound', 'CSV', 'lista de contatos', 'lembrete de consulta', 'disparo', 'E.164'],
    body: `Há duas formas de fazer o assistente ligar para alguém:

| Forma | Indicada para |
|---|---|
| [Campanhas outbound](/app/campaigns) | Ligar automaticamente para uma lista de contatos a partir do painel |
| [API de ligações outbound](/ajuda/developers/outbound-api) | Disparar ligações individuais a partir do seu CRM ou sistema |

Este artigo trata das campanhas, ideais para lembretes de consulta, retornos, follow-ups e avisos a clientes da base.

:::warning[Antes de começar]
Campanhas outbound estão disponíveis a partir do plano **Team**. Você também precisa de um número com saída habilitada e da **verificação de identidade** concluída em [Faturamento](/app/billing). Sem a verificação, nenhuma ligação de saída é iniciada. As ligações de saída consomem **créditos outbound**, cobrados à parte do plano.
:::

:::danger[Ligue só para quem pode receber]
Respeite a LGPD e as regras de telemarketing, como o cadastro Não Me Perturbe e as normas da Anatel. Tenha base legal para cada contato, principalmente em ligações de oferta.
:::

## 1. Prepare o número

Você pode usar:

- **Seu número comercial importado**: ele continua na operadora atual e é verificado só para aparecer como identificação nas ligações. Veja [Importar número](/ajuda/phone-numbers/import-number).
- **Um número SIP** com configuração de saída, se você já tem PABX ou tronco SIP. Veja [Números SIP](/ajuda/phone-systems/sip-numbers).

Em [Números de telefone](/app/phone-numbers), as configurações de cada número mostram se ele aceita ligações de entrada e de saída. Se aparecer o aviso de que não há configuração de saída, o número ainda não está pronto para campanhas.

:::info[Um número de saída por assistente]
Cada assistente liga a partir de um único número. Para usar vários números de origem, duplique o assistente e atribua um número a cada cópia.
:::

## 2. Prepare o assistente

O prompt de uma ligação de saída precisa deixar claro como o assistente se apresenta e por que está ligando, o que deve perguntar, como responde dúvidas, quando executa uma ação (como remarcar) e como encerra.

~~~text
Você é a Roberta, da Clínica Bem Viver.
Apresente-se e diga que está ligando para confirmar a consulta de {{nome}} em {{data_consulta}}.
Se a pessoa não puder comparecer, ofereça remarcar.
Antes de desligar, resuma o que foi combinado e agradeça.
~~~

Use a **Ligação de teste** do assistente para conferir saudação, ritmo e pronúncia, e depois teste o roteiro com o seu próprio número (veja a campanha de teste no passo 4).

## 3. Monte a lista de contatos (CSV)

Cada linha do arquivo é uma pessoa. A coluna obrigatória deve se chamar exatamente \`phone_number\` (minúsculas, com sublinhado), com números no formato internacional E.164: sinal de mais, código do país, DDD e número, sem espaços, parênteses ou traços.

| Certo | Errado |
|---|---|
| \`+5511900000123\` | \`(11) 90000-0123\` |
| \`+5521900000456\` | \`005521900000456\` ou \`+55 21 90000-0456\` |

As colunas extras viram variáveis no prompt, com o mesmo nome da coluna:

~~~csv
phone_number,nome,data_consulta,motivo
+5511900000123,Mariana,15/10 às 9h,confirmação de consulta
+5511900000124,Paulo,16/10 às 14h,retorno de exame
~~~

:::warning[Nomes das variáveis]
\`{{nome}}\` só funciona se a coluna se chamar \`nome\`. A grafia do prompt precisa ser idêntica à do cabeçalho do CSV.
:::

:::tip[Não perca o sinal de mais]
Planilhas costumam tratar telefone como número e apagar o \`+\`. Formate a coluna como texto antes de digitar ou comece a célula com apóstrofo (\`'+5511900000123\`). Para exportar: no Google Sheets, **Arquivo → Fazer download → Valores separados por vírgula (.csv)**; no Excel, **Arquivo → Salvar como** → CSV UTF-8, para manter os acentos.
:::

Antes de enviar, confira: coluna \`phone_number\` correta, todos os números começando com \`+55\`, nenhuma linha vazia e acentos legíveis.

## 4. Crie a campanha

::::steps
### Nova campanha
Abra [Campanhas outbound](/app/campaigns) e clique em **Nova campanha**.

### Preencha as configurações
Defina os campos da tabela abaixo e envie o CSV.

### Revise a pré-visualização
Após o upload, confira se todos os números foram reconhecidos e começam com \`+\`, se nomes e dados estão nas colunas certas, se há linhas ignoradas e se os acentos aparecem bem.

### Comece pequeno
Rode antes uma campanha de teste com um a três números seus. Só dispare a lista completa quando o roteiro e as variáveis estiverem corretos.
::::

| Campo | O que definir |
|---|---|
| Nome da campanha | Um nome interno fácil de reconhecer, como "Confirmações outubro 2026" |
| Número de telefone | O número que fará as ligações |
| Início | Data e hora de início, no fuso da empresa (ex.: America/Sao_Paulo) |
| Horários de ligação | A janela permitida, por exemplo de segunda a sexta, das 9h às 18h |
| Intervalo entre ligações | A pausa entre uma ligação e a seguinte |
| Lista de contatos | O seu arquivo CSV |

Se a lista não terminar dentro da janela, as ligações restantes continuam no próximo período permitido — algo importante em listas com centenas de contatos.

::mockup{kind="campaign" caption="Campanha outbound com o CSV carregado e o progresso das ligações"}

## 5. Acompanhe os resultados

Durante a execução, você vê para cada contato o número chamado, o horário de início, a duração, o resultado registrado, a transcrição completa e os dados das colunas extras. Abra uma ligação para analisar os detalhes.

Ao **pausar** a campanha, nenhuma ligação nova começa, mas as que já estão em andamento terminam normalmente.

## Se algo não estiver funcionando

| Sintoma | O que verificar |
|---|---|
| A campanha não começa | Verificação de identidade, número com saída atribuído a um assistente ativo, início dentro da janela de horários, CSV enviado e consumo excedente liberado em [Faturamento](/app/billing) se os créditos incluídos acabaram |
| Alguns números são ignorados | Formato E.164: \`+55\` + DDD + número, sem espaços nem zero inicial |
| Falta o sinal de mais | Coluna formatada como texto ou apóstrofo; exporte de novo |
| As variáveis ficam vazias | O nome no prompt é idêntico ao da coluna (\`nome_cliente\` → \`{{nome_cliente}}\`) |
| O assistente diz o nome errado | Linhas ou colunas deslocadas na exportação; confira a pré-visualização |

:::tip[Precisa de ajuda?]
Clique em **Suporte**, no topo desta central, e informe o nome da campanha, o assistente, o número usado, o horário de início previsto e um CSV de exemplo sem dados reais de clientes.
:::`,
  },

  /* ------------------------------------------------------------------------------------------ */
  {
    section: 'developers',
    slug: 'outbound-api',
    title: 'API de ligações outbound',
    description: 'Dispare ligações de saída individuais a partir do seu CRM, aplicativo ou fluxo de automação.',
    source: '[187]',
    related: ['developers/outbound-calls', 'developers/inbound-webhook', 'developers/http-request'],
    keywords: ['outbound API', 'API REST', 'iniciar ligação', 'chave de API', 'agentId', 'context', 'curl', 'retorno automático'],
    body: `A **API de ligações outbound** (Outbound API) permite que o seu sistema peça à Kloel para ligar para alguém no momento exato em que algo acontece: um retorno solicitado no CRM, um lembrete na véspera de um compromisso ou o primeiro contato com um lead que acabou de chegar.

Para listas maiores, prefira as campanhas descritas em [Ligações outbound](/ajuda/developers/outbound-calls).

## Requisitos

- Um assistente configurado e o **ID do assistente** (\`agentId\`).
- Um número com saída habilitada — importado ou [SIP](/ajuda/phone-systems/sip-numbers) — em [Números de telefone](/app/phone-numbers).
- A **verificação de identidade** concluída em [Faturamento](/app/billing).
- Uma chave válida, criada em [Chaves de API](/app/api-keys).

As ligações de saída consomem créditos outbound, cobrados à parte do plano.

::mockup{kind="api-keys" caption="Chaves de API com o prefixo klo_live_ e a data do último uso"}

## O endpoint

Toda ligação é criada com uma requisição \`POST\`:

~~~text
POST https://api.kloel.example/v1/outbound_call
~~~

Para ver o endereço e um corpo de exemplo já com o ID do assistente preenchido: em [Assistentes](/app/agents), abra o assistente, vá em **Geral** → **Recursos** → **Webhooks** e escolha **API de ligações outbound**.

## Corpo da requisição

O corpo é enviado em JSON:

~~~json
{
  "fromNumber": "+5511900000100",
  "toNumber": "+5511900000123",
  "agentId": "agt_7c41e2b9",
  "context": {
    "nome": "Mariana Souza",
    "dataConsulta": "15 de outubro às 9h"
  }
}
~~~

| Campo | Descrição |
|---|---|
| \`fromNumber\` | Número da sua conta Kloel que fará a ligação, em E.164 |
| \`toNumber\` | Número que vai receber a ligação, em E.164 |
| \`agentId\` | ID do assistente que conduzirá a conversa |
| \`context\` | Opcional: dados válidos somente para esta ligação |
| \`apiKey\` | Opcional: a chave, caso você não a envie no cabeçalho |

## Autenticação

A chave pode ir no corpo, mas o recomendado é enviá-la no cabeçalho \`Authorization\`:

~~~json
{
  "Authorization": "Bearer klo_live_SUA_CHAVE",
  "Content-Type": "application/json"
}
~~~

Nesse caso, retire \`apiKey\` do corpo.

:::danger[Mantenha a chave no servidor]
Chame a API somente a partir de um backend protegido ou de uma ferramenta de automação. Nunca coloque a chave em código de site, app público ou planilha compartilhada. Se ela vazar, exclua-a em [Chaves de API](/app/api-keys) e crie outra.
:::

## Usar o context

Tudo o que for enviado em \`context\` vira variável no prompt daquela ligação:

~~~text
Cumprimente a pessoa como {{nome}}.
Lembre a consulta marcada para {{dataConsulta}}.
Use {{clienteId}} apenas para registro interno; não o leia em voz alta.
~~~

:::tip[Envie o que você já sabe]
Coloque no \`context\` IDs, datas, horários e outros valores conhecidos. Assim o assistente não precisa perguntar de novo nem deduzir a informação pela conversa.
:::

## Exemplo com curl

~~~bash
curl -X POST "https://api.kloel.example/v1/outbound_call" \\
  -H "Authorization: Bearer klo_live_SUA_CHAVE" \\
  -H "Content-Type: application/json" \\
  -d '{
    "fromNumber": "+5511900000100",
    "toNumber": "+5511900000123",
    "agentId": "agt_7c41e2b9",
    "context": { "nome": "Mariana Souza", "dataConsulta": "15 de outubro às 9h" }
  }'
~~~

## Casos de uso

### Retorno pedido pelo CRM

Alguém da equipe clica em "Ligar de volta" no CRM. O CRM envia os dados do cliente à API e o assistente faz a ligação.

### Lembrete de compromisso

Um fluxo no [n8n](/ajuda/integrations/n8n) ou no [Make](/ajuda/integrations/makecom) roda na véspera e envia nome, data e horário no \`context\`.

### Mudança de status

Quando um pedido ou processo muda de situação, o seu sistema dispara uma ligação explicando a novidade.

### Lead novo

Assim que um lead entra pelo site, o sistema aciona o assistente para o primeiro contato.

## Checklist de teste

- A verificação de identidade foi concluída?
- O \`fromNumber\` tem saída habilitada?
- Os dois números estão em E.164 (\`+55\` + DDD + número)?
- O \`agentId\` é do assistente certo?
- A chave é válida e está no cabeçalho?
- As chaves do \`context\` aparecem com a mesma grafia no prompt?

## Se algo não estiver funcionando

| Sintoma | O que verificar |
|---|---|
| A ligação não sai | O número de origem permite ligações de saída? |
| A requisição é recusada | A chave de API é válida e a verificação de identidade foi concluída? |
| A ligação vai para a pessoa errada | \`toNumber\` está no formato internacional? |
| O assistente errado conduz a conversa | O \`agentId\` informado está correto? |
| As variáveis do context ficam vazias | Os nomes são idênticos no corpo e no prompt? |

:::tip[Precisa de ajuda?]
Clique em **Suporte**, no topo desta central, e envie o horário da requisição, o \`agentId\` e o código de resposta recebido. Nunca compartilhe a chave de API completa.
:::`,
  },

  /* ------------------------------------------------------------------------------------------ */
  {
    section: 'phone-systems',
    slug: 'sip-numbers',
    title: 'Números SIP',
    description: 'Conecte seu PABX ou tronco SIP à Kloel por um tronco estático baseado em IP e mantenha os números que você já usa.',
    source: '[188]',
    related: ['get-started/connect-your-number', 'actions/call-transfer', 'phone-numbers/pbx', 'get-started/troubleshooting'],
    keywords: ['SIP', 'tronco SIP', 'PABX', 'peer trunk', 'URI SIP', 'firewall', 'SBC', 'operadora'],
    body: `Com um **número SIP**, o seu sistema telefônico atual se conecta diretamente à Kloel. Você mantém os números e as linhas que já tem; o assistente atende as chamadas que o PABX encaminhar e, quando preciso, devolve a ligação para a equipe.

Números SIP estão disponíveis a partir do plano **Team**.

## Como a conexão funciona

A Kloel usa **troncos SIP estáticos baseados em IP**, também chamados de *peer trunks*. O PABX não se registra com usuário e senha: não há REGISTER, registrar nem credenciais de registro. A conexão se apoia em três dados:

- a **URI SIP** da sua conta Kloel;
- as **faixas de IP** da Kloel;
- o **IP fixo ou nome de host DNS** do seu PABX (DNS dinâmico também serve).

:::warning[Seu PABX só aceita registro?]
Se o equipamento só trabalha com troncos por registrar, ainda é possível conectar usando um gateway intermediário. Fale com o time pelo botão **Suporte** com o assunto "Tronco SIP com registrar".
:::

## O que ter em mãos

| Dado | Onde conseguir |
|---|---|
| URI SIP | [Números de telefone](/app/phone-numbers) → **Adicionar número** → **Criar número SIP** |
| Faixas de IP da Kloel | Neste artigo, logo abaixo dos passos |
| Host do seu PABX | IP público fixo ou nome DNS |
| Acesso a firewall e SBC | Você, o administrador de rede ou a operadora |
| Acesso ao PABX | Você ou o administrador do PABX |

## Configuração

::::steps
### Crie o número SIP
Em [Números de telefone](/app/phone-numbers), clique em **Adicionar número** → **Criar número SIP** e copie a URI SIP completa.

### Informe o host de destino
Envie ao time, pelo botão **Suporte**, o IP público fixo ou o nome de host do seu PABX. O gateway de voz do lado da Kloel é configurado para você.

### Libere as faixas de IP
No firewall e no Session Border Controller (SBC), libere as faixas da Kloel para **UDP e TCP**, tanto para a sinalização SIP quanto para a mídia.

### Crie o tronco estático no PABX
Use a URI SIP, o endpoint do gateway informado pelo time e as regras de numeração do PABX. Conforme o fabricante, a opção se chama Static Trunk, Peer Trunk, IP-based Trunk, SIP Peer ou Trusted Trunk. Se houver as duas opções, escolha o tronco estático, não o de registro.

### Ajuste o formato dos números
Envie os números em E.164 e retire o zero do DDD quando o código do país for incluído.

### Teste
Faça uma ligação recebida de teste e, se você usa saída, uma ligação de saída.
::::

~~~text
Faixas de IP da Kloel
203.0.113.0/24
198.51.100.0/24
192.0.2.0/24

Formato de número
Certo:  +5511900000123
Errado: +55011900000123   (zero do DDD mantido depois do +55)
~~~

:::warning[Faixa bloqueada, chamada perdida]
Se qualquer faixa ficar de fora, a ligação pode não chegar ao PABX ou chegar sem áudio.
:::

## O que conferir no teste

- A chamada chega ao número SIP e o número original de quem liga é repassado?
- Os dois lados se ouvem?
- A ligação aparece em [Conversas](/app/inbox) e o assistente atende?
- A [transferência](/ajuda/actions/call-transfer) de volta para o PABX funciona?

Anote em cada teste a data, o horário exato e os números de origem e de destino: com isso o time localiza a chamada muito mais rápido.

::mockup{kind="phone-numbers" caption="Números de telefone com um número SIP atribuído à assistente Roberta"}

## Guias por provedor

Os passos acima valem para qualquer sistema compatível; abaixo, o essencial de cada provedor do [Diretório de integrações](/integracoes). Os nomes de menu variam conforme a versão.

### 3CX

No console de administração, adicione um tronco SIP genérico baseado em IP, sem registro, apontando para o gateway informado pelo time e usando a URI SIP da Kloel. Libere as faixas da Kloel e crie as regras de roteamento que enviam ao tronco as chamadas que o assistente deve atender.

### Twilio

Em Elastic SIP Trunking, crie um tronco. Em *Origination*, aponte para a URI SIP da Kloel; em *Termination*, crie uma lista de controle de acesso por IP com as faixas da Kloel. Depois, associe os números Twilio ao tronco.

### Telnyx

Crie uma conexão SIP com autenticação por IP ou FQDN, defina a URI SIP da Kloel como destino das chamadas recebidas e cadastre as faixas da Kloel como IPs autorizados. Em seguida, vincule os números à conexão.

### Yeastar

No PABX Yeastar, crie um tronco do tipo *Peer* (não *Register*) com o host do gateway da Kloel. Libere as faixas da Kloel e ajuste as rotas de entrada e de saída para usar esse tronco.

### easybell

No portal do cliente, ative o tronco SIP com autenticação por IP, quando disponível no seu contrato, e encaminhe os números desejados para a URI SIP da Kloel. Confirme com a easybell se o tronco estático está liberado para a sua conta.

### Zadarma

No painel, encaminhe os números para a URI SIP da Kloel como destino SIP externo. Para ligações de saída, configure um tronco com autenticação por IP liberando as faixas da Kloel.

### Outros sistemas

Roteadores com central telefônica embutida (via DNS dinâmico), outras operadoras VoIP e outros equipamentos costumam funcionar se aceitarem troncos estáticos, forem alcançáveis por IP fixo ou DNS, liberarem as faixas da Kloel e enviarem números em formato internacional. O Microsoft Teams também pode ser conectado com um PABX ou gateway de voz compatível.

## Quem cuida de cada parte

| Parte | Responsável |
|---|---|
| Tronco no PABX, formato de números e regras de discagem | Você, o administrador do PABX ou o provedor |
| Firewall e NAT | Você ou o administrador de rede |
| Liberação de troncos estáticos | Sua operadora |
| Gateway de voz e URI SIP na Kloel | Time da Kloel |
| Confirmar se a chamada chegou à Kloel | Time da Kloel |

O time confirma a chegada ao gateway e a URI, mas não acessa a configuração interna do seu PABX ou da operadora.

## Se algo não estiver funcionando

| Sintoma | O que verificar |
|---|---|
| A chamada não chega | URI SIP completa, tronco estático e faixas liberadas |
| A chamada chega sem áudio | Mídia (UDP e TCP) liberada no firewall e no SBC; regras de NAT |
| O número de quem liga não aparece | O PABX envia os números em E.164? |
| Nada aparece em Conversas | IP ou host informado corretamente; operadora liberou o tronco estático |

:::tip[Precisa de ajuda?]
Clique em **Suporte**, no topo desta central, e informe o assistente, o fabricante e o modelo do PABX, a operadora, o IP fixo ou host, data e horário de uma ligação de teste, os números envolvidos e, se tiver, o código de resposta SIP. Nunca envie senhas ou chaves de API.
:::`,
  },
]
