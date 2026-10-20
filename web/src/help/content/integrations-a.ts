import type { HelpArticle } from './types'

/**
 * Integrações (parte A): Airtable → Notion, na ordem da sidebar.
 * Reescrita própria a partir das notas [189]–[194] e [200], [210]–[216], seguindo o modelo
 * "Síntese A/B" de docs/reference/specs/04-recursos-ajuda-empresa-parceiros.md.
 * Exemplos adaptados ao Brasil (BRL, America/Sao_Paulo, telefones fictícios +55 11 90000-0NNN).
 */

export const INTEGRATION_ARTICLES_A: HelpArticle[] = [
  // ───────────────────────────────────────────────────────────── Airtable
  {
    section: 'integrations',
    slug: 'airtable',
    title: 'Airtable',
    description: 'Seu assistente consulta registros das suas bases do Airtable ou cria novos, antes, durante ou depois de cada ligação.',
    source: '[189]',
    related: ['integrations/google-sheets', 'get-started/contacts', 'get-started/troubleshooting'],
    keywords: ['airtable', 'base de dados', 'registros', 'tabela', 'fórmula de busca', 'criar registro', 'registro de ligações'],
    body: `Com o Airtable conectado, seu assistente usa suas bases como alguém da equipe: reconhece o cliente frequente, confere um pedido com a pessoa na linha ou anota um pedido de retorno.

É como uma recepcionista que nunca fecha a lista de clientes.

::::steps
### Autorize o acesso no Airtable
Em [Integrações](/app/integrations), clique em **Adicionar integração**, escolha **Airtable** e depois **Conectar**. Na janela do Airtable, entre com sua conta, marque as bases que o assistente pode usar e confirme a autorização.

A permissão cobre apenas ver tabelas, ler e criar registros nessas bases. Para incluir outra base depois, conecte de novo e marque-a.

### Defina o modo e o momento
- **Nome**: padrão **Nova integração Airtable**; prefira algo como "Reconhecer pacientes".
- **Modo**: **Consultar** (padrão) apenas lê; **Criar** adiciona um registro.
- **Execução**: **Antes da conversa** (padrão), **Durante a conversa** ou **Após a conversa**, com a janela **A qualquer momento** (padrão), **Durante o horário de funcionamento** ou **Fora do horário de funcionamento**. **Consultar** não roda após a conversa.
- **Quando a IA deve usar isso?**: obrigatório com **Durante a conversa**; escreva como regra "se…, então…":

~~~text
Se a pessoa perguntar por um pedido, peça o número do pedido e consulte a tabela.
~~~

### Escolha a tabela e os campos
Selecione **Base** e **Tabela**. A **Pré-visualização** mostra as primeiras linhas para você conferir os nomes das colunas.

- **Fórmula de busca** (só **Consultar**): fórmula do Airtable com colunas entre chaves; **Adicionar variável** insere dados da ligação. Vazia, traz todos os registros. O Airtable valida a fórmula ao salvar.

~~~text
{Telefone} = "{{personNumber}}"
~~~

- **Campos do registro** (só **Criar**): JSON de coluna e valor; o padrão grava o número de quem liga em **Name**. **Variáveis personalizadas** são preenchidas pela conversa e exigem tipo e descrição.

~~~json
{
  "Nome": "{{nome_cliente}}",
  "Telefone": "{{personNumber}}",
  "Motivo": "{{motivo}}",
  "Ligação": "{{conversationLink}}"
}
~~~

- Em **Avançado**: **O que dizer durante a execução** (vazio = silêncio), **Campos retornados** (vazio = todas as colunas) e **Máx. de registros** (de 1 a 100; padrão 5).
::::

::mockup{kind="integration-config" name="Airtable" mode="oauth" caption="Airtable conectado: modo, execução, base, tabela e fórmula de busca"}

## Antes da ligação

No modo **Consultar**, a busca roda quando o telefone toca, normalmente pelo número: se a Carla Mendes está na tabela, é cumprimentada pelo nome. No modo **Criar**, cada ligação vira um registro com o número. Variáveis personalizadas ainda não existem nessa fase.

:::tip[Fica entre você e seu assistente]
O assistente nunca conta que fez uma consulta. Para quem liga, fica só a sensação de ser lembrado.
:::

## Durante a ligação

No momento descrito, o assistente pede o que falta (como o número do pedido), consulta e responde; se nada corresponder, avisa. No modo **Criar**, reúne nome e motivo e grava com a pessoa na linha. O Airtable tem até 15 segundos.

## Depois da ligação

No modo **Criar** com **Após a conversa**, o assistente revisa a conversa, preenche as variáveis e adiciona o registro. Com \`{{conversationLink}}\` nos campos, você vai do Airtable direto para a ligação. Cada execução aparece na ligação, em [Conversas](/app/inbox).

## Teste a integração

Cadastre seu celular na tabela, no formato internacional, e faça uma **Ligação de teste**. Confira se o assistente usou o nome certo, se a execução deu certo em [Conversas](/app/inbox) e, no modo **Criar**, se o registro apareceu.

## Bom saber

- **Uma tabela por integração.** Para outra tabela, modo ou momento, adicione o Airtable de novo.
- **Nomes de coluna idênticos**, inclusive maiúsculas, minúsculas e espaços. Uma coluna desconhecida faz a criação falhar.
- **Colunas de seleção única** só aceitam opções que já existem no Airtable.
- **Telefones** chegam como \`+5511900000123\`. Guarde-os no mesmo formato; número oculto chega vazio.
- **Privacidade (LGPD):** tudo o que o assistente encontra entra na conversa. Deixe anotações internas fora de **Campos retornados**.

## Se algo não estiver funcionando

| Mensagem | O que verificar |
| --- | --- |
| O Airtable recusou a fórmula | As colunas estão entre chaves, com o nome exato? Os textos estão entre aspas? |
| O modo Consultar não pode rodar após a conversa | Escolha outra **Execução** ou use o modo **Criar**. |
| Descreva quando a IA deve usar isso | Preencha **Quando a IA deve usar isso?**. |
| Os campos do registro precisam ser um JSON válido | Confira aspas, vírgulas e chaves; tudo dentro de um único \`{ }\`. |
| Não foi possível criar o registro | Os nomes das colunas batem? O valor combina com o tipo da coluna? |
| A base não aparece em **Base** | Conecte de novo e marque a base. |

:::tip[Precisa de ajuda?]
Clique no botão **Suporte**, no topo desta central, ou fale com a gente em [Fale com o time](/contato).
:::`,
  },

  // ───────────────────────────────────────────────────────────── BaseLinker
  {
    section: 'integrations',
    slug: 'baselinker',
    title: 'BaseLinker',
    description: 'Seu assistente informa a quem liga em que etapa está o pedido, lendo os dados direto do BaseLinker.',
    source: '[200]',
    related: ['actions/sms', 'actions/call-transfer', 'get-started/troubleshooting'],
    keywords: ['baselinker', 'status do pedido', 'rastreio', 'onde está meu pedido', 'e-commerce', 'marketplace', 'transportadora'],
    body: `Com o BaseLinker conectado, seu assistente responde à pergunta que uma loja mais ouve: "onde está meu pedido?". Ele localiza o pedido e explica em que etapa está, como alguém do atendimento com a lista aberta.

Clientes recorrentes são reconhecidos pelo número e muitas vezes nem precisam do código. A integração só lê: nada muda no BaseLinker.

:::warning[Acesso antecipado]
O BaseLinker ainda não está liberado para todas as contas. Se ele não aparece em [Integrações](/app/integrations), peça a liberação pelo botão **Suporte**.
:::

::::steps
### Gere o token no BaseLinker
Na área de API das configurações da conta no BaseLinker, gere um token e copie a linha inteira (ela tem dois hífens). Trate-o como senha: ele abre a conta toda, embora a Kloel só leia pedidos, status e pacotes. A conta precisa ter ao menos um status de pedido cadastrado.

### Conecte o BaseLinker à Kloel
Em [Integrações](/app/integrations), adicione o **BaseLinker** e cole o token em **Token de API**:

~~~text
1234567-1234567-A1B2C3…
~~~

Ao salvar, a Kloel confere na hora se o token funciona.

### Escolha o que o assistente pode fazer
- **Nome**: padrão **Central de pedidos**.
- **Números de pedido aceitos** (aviso): o assistente busca pelo número do BaseLinker, da loja virtual ou do marketplace — os dois últimos só se a integração da loja os gravar no pedido. Código de rastreio não serve.
- **Dias para listar pedidos de quem liga**: padrão 7, máximo 14.
- **Informar rastreio**: ligado; transportadora, código e última atualização, nunca uma data de entrega.
- **Nota de entrega da equipe**: desligado. Se a equipe anota a previsão em **Campo adicional 1** ou **2**, escolha o campo; o texto é lido literalmente.
- **Informar itens do pedido**: ligado; até cinco itens, com quantidades.
- **Oferecer encaminhamento**: ligado. Para troca, cancelamento ou reclamação, oferece [transferir a ligação](/ajuda/actions/call-transfer) ou anotar retorno; desligado, diz que não pode ajudar.
::::

::mockup{kind="integration-config" name="BaseLinker" mode="credentials" caption="BaseLinker: token de API e opções do que o assistente informa"}

## Antes da ligação

Quando o telefone toca, o assistente busca o número nos pedidos. Se o Paulo liga por um pacote, ele já sabe qual é o pedido, quando foi feito e o status. Com vários pedidos, resume e pergunta qual interessa. Quem não é encontrado informa o número do pedido.

:::tip[Fica entre você e seu assistente]
O assistente nunca diz que pesquisou alguém e só fala de um pedido depois que a pessoa toca no assunto.
:::

## Durante a ligação

O assistente confirma o pedido e informa o status no idioma de quem liga, com envio, rastreio, nota da equipe e itens conforme as opções. Se já há rastreio, pode mandar o link por SMS.

Para "quando chega?", ele não chuta datas: o prazo é da transportadora. Ele não cancela, não muda endereço, não promete reembolso e interrompe quem começa a ditar dados de cartão ou bancários.

## Depois da ligação

Nada é gravado no BaseLinker. O resumo e as consultas feitas ficam na ligação, em [Conversas](/app/inbox).

## Teste a integração

Use um pedido de teste com seu celular e ligue desse número para o assistente. Pergunte pelo pedido, peça o rastreio e confira [Conversas](/app/inbox). Para simular o número numa **Ligação de teste**, veja [Teste com contexto](/ajuda/developers/test-context).

## Bom saber

- **Só os pedidos de quem liga.** De outro número, ninguém recebe detalhes, nem com o código certo.
- **Número oculto** impede a busca de pedidos nessa ligação.
- **Ligações desviadas**: sua central precisa repassar o número de origem. Veja [Conecte seu número](/ajuda/get-started/connect-your-number).
- **SMS** consome sua cota e só chega a celulares.
- **Nomes de status** são lidos como estão; prefira nomes claros, como "Enviado", ou um nome para clientes.

## Se algo não estiver funcionando

| Mensagem | O que verificar |
| --- | --- |
| O BaseLinker não reconhece este token | Copie a linha inteira, com os dois hífens, ou gere um token novo. |
| O token não tem permissão para ler pedidos | Gere o token com um usuário que vê os pedidos. |
| A conta não tem status de pedido | Crie ao menos um status nas configurações de pedidos. |
| O assistente não encontra o pedido | A pessoa liga do número do pedido? O número informado consta no pedido? |
| O cliente recorrente não é reconhecido | O telefone está no pedido? O número estava oculto ou foi trocado pela central? |
| Status com nome estranho | Renomeie o status ou dê a ele um nome para clientes. |

:::tip[Precisa de ajuda?]
Clique no botão **Suporte**, no topo desta central, ou fale com a gente em [Fale com o time](/contato).
:::`,
  },

  // ───────────────────────────────────────────────────────────── bexio
  {
    section: 'integrations',
    slug: 'bexio',
    title: 'bexio',
    description: 'Seu assistente reconhece quem liga pelos contatos do bexio, responde sobre faturas, orçamentos, pedidos e projetos e registra cada ligação.',
    source: '[210]',
    related: ['get-started/contacts', 'actions/email', 'get-started/troubleshooting'],
    keywords: ['bexio', 'faturas', 'orçamentos', 'ERP', 'reenviar fatura', 'tarefa de retorno', 'contatos'],
    body: `Com o bexio conectado, seu assistente sabe quem está ligando e já conhece as faturas, os orçamentos, os pedidos e os projetos da pessoa — como um colega que acompanha cada cliente há anos.

Ele também reenvia faturas, transforma pedidos de retorno em tarefas e deixa uma nota no contato ao fim da ligação.

:::warning[Acesso antecipado]
O bexio ainda não está liberado para todas as contas. Se ele não aparece em [Integrações](/app/integrations), peça a liberação pelo botão **Suporte**.
:::

::::steps
### Conecte sua conta do bexio
Em [Integrações](/app/integrations), adicione o **bexio** e clique em **Conectar**. Entre no bexio, escolha a empresa à qual as ligações pertencem (se você tiver várias) e autorize a Kloel.

O assistente usa as permissões de quem fez login: editar contatos, notas, faturas e tarefas e ver orçamentos, pedidos e projetos. Se faltar algo, aparece **Permissões do bexio ausentes**; peça a um administrador ou conecte outro usuário.

### Escolha o que o assistente pode fazer
Tudo vem ligado, exceto o grupo.

- **Nome**: padrão **bexio**.
- **Usuário responsável**: dono dos contatos novos e dos retornos de quem liga pela primeira vez. Vazio, vale quem conectou.
- **Adicionar quem liga pela primeira vez**, com **Grupo para contatos novos** opcional.
- **Compartilhar faturas, orçamentos, pedidos e projetos**: só com quem é reconhecido pelo número.
- **Reenviar faturas**: sempre para o e-mail do contato.
- **Pedidos de retorno**: cria uma tarefa. Desligado, o assistente nunca promete retorno.
- **Registrar conversas**: nota no contato após cada ligação.
::::

::mockup{kind="integration-config" name="bexio" mode="oauth" caption="bexio conectado: usuário responsável, contatos novos e o que o assistente compartilha"}

## Antes da ligação

O assistente procura o número nos telefones dos contatos e carrega nome, empresa, responsável, e-mail, as três notas mais recentes e os documentos em aberto. Quando a Ana, da Padaria Pão de Mel, liga sobre a última fatura, ele já sabe se ela está paga.

Número de empresa: ele pergunta quem fala e ajuda com os documentos dela. Número compartilhado por várias pessoas: pergunta e não revela nada. Os demais, inclusive número oculto, são tratados como novos.

:::tip[Fica entre você e seu assistente]
O assistente nunca diz que pesquisou ou cadastrou alguém, nunca fala de outros contatos e nunca inventa valor ou data.
:::

## Durante a ligação

- **Documentos**: "minha fatura foi paga?", "até quando vale o orçamento?" — só sobre documentos de quem liga. Em projetos, informa status, datas, responsável, marcos e horas lançadas.
- **Reenvio**: a fatura sai do bexio para o e-mail do contato, com link e PDF. Faturas pagas antigas exigem o número. Sem e-mail no cadastro, ele avisa que não consegue enviar.
- **Primeira ligação**: pede nome e sobrenome, soletra até a confirmação e cria o contato.
- **Retorno**: cria uma tarefa vinculada ao contato, com o pedido, o melhor horário, vencimento no mesmo dia e link para a ligação. Nunca promete horário.

## Depois da ligação

Quem foi reconhecido ou cadastrado recebe a nota **Ligação com o assistente Kloel**, com resumo e links para a ligação e a gravação. As mensagens de cada etapa ficam na ligação, em [Conversas](/app/inbox).

## Teste a integração

Crie um contato de teste com seu celular e e-mail, ligue desse número para o assistente e peça o reenvio de uma fatura. Confira o e-mail, a nota no contato e a ligação em [Conversas](/app/inbox).

## Bom saber

- **Limites**: até cinco faturas em aberto, três pagas recentes, cinco orçamentos, cinco pedidos e cinco projetos ativos.
- **Nada é alterado ou excluído.** O assistente só adiciona contatos, notas e tarefas e envia faturas; o reenvio não muda o status.
- **Telefones** em formatos comuns, como +55 11 90000-0123, são encontrados; símbolos incomuns podem falhar.
- **Número oculto**: sem reconhecimento, mas o retorno pode ser registrado com o nome dito.
- **Fuso**: notas e tarefas usam o fuso da empresa (aqui, America/Sao_Paulo).
- **Dados são contexto.** Instruções escritas num contato são ignoradas.

## Se algo não estiver funcionando

| Mensagem | O que verificar |
| --- | --- |
| Quem liga não foi encontrado no bexio | O número está num contato, num formato comum? |
| Vários contatos usam este número | Mescle os contatos ou tire o número de quem não precisa dele. |
| Permissões do bexio ausentes | Peça as permissões listadas ou desligue o compartilhamento de documentos. |
| bexio (reconexão necessária) | Clique em **Conectar** e entre de novo. |
| Não há fatura que possa ser enviada | O contato tem e-mail? Rascunhos e faturas canceladas não são enviados. |
| A conversa não foi registrada | Quem ligou não foi reconhecido nem cadastrado, ou ocultou o número. |

:::tip[Precisa de ajuda?]
Clique no botão **Suporte**, no topo desta central, ou fale com a gente em [Fale com o time](/contato).
:::`,
  },

  // ───────────────────────────────────────────────────────────── GoHighLevel
  {
    section: 'integrations',
    slug: 'gohighlevel',
    title: 'GoHighLevel',
    description: 'Seu assistente reconhece seus contatos do GoHighLevel, agenda horários e deixa um resumo no contato depois de cada ligação.',
    source: '[211]',
    related: ['actions/appointments', 'get-started/contacts', 'get-started/troubleshooting'],
    keywords: ['gohighlevel', 'highlevel', 'GHL', 'CRM', 'subconta', 'agendamento', 'workflow', 'lead'],
    body: `Com o GoHighLevel conectado, seu assistente reconhece quem liga, sabe quais horários a pessoa tem marcados e o que sua equipe anotou por último — como um colega que conhece bem a clientela.

Ele também cuida da papelada: quem é novo vira lead, agendamentos entram no calendário e cada ligação ganha um resumo.

:::warning[Acesso antecipado]
O GoHighLevel ainda não está liberado para todas as contas. Se ele não aparece em [Integrações](/app/integrations), peça a liberação pelo botão **Suporte**.
:::

::::steps
### Conecte a subconta certa
Em [Integrações](/app/integrations), adicione o **GoHighLevel** e clique em **Conectar**. Ao escolher a conta, selecione a **subconta** à qual as ligações pertencem — não a agência — e autorize.

A partir daí, o assistente lê e atualiza contatos, vê workflows e calendários e marca horários. Cada conexão vale para uma subconta; se você gerencia várias, conecte cada uma.

### Escolha o que o assistente pode fazer
Tudo vem ligado por padrão.

- **Nome**: padrão **GoHighLevel**.
- **Carregar as notas de quem liga**: evita perguntar o que a equipe já registrou.
- **Carregar os agendamentos de quem liga**: "o meu horário" passa a ter contexto.
- **Salvar e atualizar dados do contato**: novos viram lead após dizerem nome e sobrenome; correções de nome, empresa ou endereço são gravadas. Desligado, nada muda nos contatos.
- **Nota de resumo após cada conversa.**
- **Inscrever em um workflow após a ligação**: exibe **Workflow** (só publicados; sem escolha, ninguém é inscrito) e **Condição** (em branco, vale para toda ligação):

~~~text
Inscreva somente se a pessoa pediu retorno sobre um orçamento.
~~~

- **Agendar, remarcar e cancelar**: escolha o **Calendário**. Sem calendário, o assistente só consegue cancelar. Desligado, o calendário fica intocado.
::::

::mockup{kind="integration-config" name="GoHighLevel" mode="oauth" caption="GoHighLevel: subconta conectada, notas, agendamentos e workflow pós-ligação"}

## Antes da ligação

O assistente procura o número nos contatos e carrega nome, e-mail, tags, os próximos três horários, os três últimos e as cinco notas mais recentes. Quando o Rafael liga sobre "quinta-feira", ele já sabe que é a consulta das 10h na Clínica Bem Viver.

Quem não é encontrado é tratado como novo. Quando fica claro que há um pedido real, o assistente pergunta nome e sobrenome com naturalidade e salva o lead; se a pessoa preferir não dizer, ele continua ajudando.

:::tip[Fica entre você e seu assistente]
O assistente não revela que consultou o cadastro, não lê notas palavra por palavra e não cita o GoHighLevel.
:::

## Durante a ligação

- **Dados do contato**: atualiza só o que a pessoa realmente disse. Pedidos específicos, como o melhor horário para retorno, viram nota.
- **Agendamento**: olha as próximas duas semanas, oferece horários de fato livres e só confirma depois de gravar. Se alguém pegou o horário antes, avisa e sugere outro.
- **Remarcar ou cancelar**: vale para horários futuros da própria pessoa, respeitando as regras do calendário.
- **Só a própria pessoa**: pedidos em nome de terceiros são recusados com gentileza.

## Depois da ligação

O contato recebe a nota **Resumo da ligação (Kloel)**, com data, resumo e link para a conversa. Havendo workflow, a inscrição vem em seguida — sempre ou quando a condição bate. O resultado de cada etapa aparece em [Conversas](/app/inbox).

## Teste a integração

Crie um contato com seu celular, ligue desse número para o assistente e marque um horário. Confira o calendário, a nota e a inscrição no workflow, e veja a ligação em [Conversas](/app/inbox).

## Bom saber

- **Subconta, não agência.** Conectado no nível da agência, o assistente não enxerga contatos.
- **Telefone e e-mail não mudam pela ligação**, porque identificam a pessoa. Sua equipe pode alterá-los no GoHighLevel.
- **Número oculto**: sem reconhecimento, lead, agendamento, nota ou workflow.
- **Horários já iniciados** não podem ser remarcados nem cancelados.
- **Fuso**: horários seguem o fuso do calendário (por exemplo, America/Sao_Paulo).
- **Workflows** aceitam cada contato uma vez, salvo se você permitir reentrada.
- **Notas são contexto.** Instruções escritas nelas são ignoradas.

## Se algo não estiver funcionando

| Mensagem | O que verificar |
| --- | --- |
| A conexão é de agência e não lê a subconta | Clique em **Conectar** de novo e escolha a subconta. |
| GoHighLevel (reconexão necessária) | Clique em **Conectar** e entre de novo. |
| O workflow não aparece na lista | Publique o workflow no GoHighLevel. |
| Nenhum calendário configurado | Escolha um **Calendário** ativo na opção de agendamento. |
| Sem horários livres nas próximas duas semanas | Revise a disponibilidade do calendário. |
| Condição do workflow não atendida | Está tudo certo: ajuste a **Condição** ou deixe em branco. |
| Quem ligou não foi inscrito | O workflow segue publicado? A pessoa já estava nele? |

:::tip[Precisa de ajuda?]
Clique no botão **Suporte**, no topo desta central, ou fale com a gente em [Fale com o time](/contato).
:::`,
  },

  // ───────────────────────────────────────────────────────────── Google Address Validation
  {
    section: 'integrations',
    slug: 'google-address-validation',
    title: 'Google Address Validation',
    description: 'Seu assistente confere com o Google cada endereço informado na ligação, evitando visitas e entregas perdidas por erro de digitação ou complemento esquecido.',
    source: '[212]',
    related: ['get-started/write-a-great-prompt', 'get-started/troubleshooting'],
    keywords: ['validação de endereço', 'verificação de endereço', 'CEP', 'complemento', 'google maps platform', 'address validation', 'entrega'],
    body: `Com a validação de endereço ativa, cada endereço dito ao telefone passa pelo Google antes de ser anotado. O Google corrige pequenos erros, completa o CEP e percebe quando falta o complemento (apartamento, sala ou conjunto).

É como um entregador veterano: se o endereço está certo, a conversa segue; só quando algo não fecha o assistente lê de volta e confirma.

:::warning[Acesso antecipado]
A validação de endereço ainda não está liberada para todas as contas. Se ela não aparece em [Integrações](/app/integrations), peça a liberação pelo botão **Suporte**.
:::

::::steps
### Prepare o projeto no Google Cloud
As verificações rodam no seu projeto e o Google cobra cada uma de você, então é preciso poder gerenciar o projeto e o faturamento.

1. No console do Google Cloud, escolha ou crie um projeto.
2. Vincule uma conta de faturamento; sem ela, toda verificação é recusada.
3. Em **APIs e serviços**, abra a biblioteca e ative a **Address Validation API**.
4. Em **Credenciais**, crie uma **chave de API**. Ela começa com \`AIza\`.

### Restrinja a chave
- **Restrições de aplicativos**: deixe em **Nenhuma**. Uma chave limitada a sites não funciona com a Kloel.
- **Restrições de API**: restrinja a chave apenas à **Address Validation API**.
- **Cota diária**: defina um limite nas cotas da API para o custo não fugir do controle.

### Conecte à Kloel
Em [Integrações](/app/integrations), adicione **Google Address Validation** e cole a chave em **Chave de API**:

~~~text
AIzaSyA-EXEMPLO-0000000000000000000000
~~~

Ao clicar em **Conectar**, a Kloel faz uma verificação de teste (também cobrada) e avisa se falta algo.

### Ajuste as opções
- **Nome**: padrão **Verificação de endereço**.
- **Pedir o complemento que falta**: ligado. Prédio certo sem apartamento ou sala? O assistente pergunta; sem complemento, anota e segue. Desligado, aceita sem comentar.
- O aviso **Cada verificação é cobrada pelo Google** lembra que reverificações também custam.
::::

::mockup{kind="integration-config" name="Google Address Validation" mode="credentials" caption="Chave de API do Google e a opção de pedir o complemento"}

## Antes da ligação

Nada é consultado antes de atender. A verificação só acontece quando alguém dita um endereço.

:::tip[Fica entre você e seu assistente]
O assistente nunca diz que está pesquisando e nunca inventa número, rua, cidade ou CEP.
:::

## Durante a ligação

A Juliana marca uma coleta domiciliar com a Clínica Bem Viver e dita o endereço. O assistente diz "um momento" e envia ao Google exatamente o que ouviu.

- **Tudo certo**: a conversa segue, sem repetir o endereço.
- **Correção ou CEP completado**, ou rua encontrada sem o prédio: ele lê a versão do Google e espera um "sim" claro — "acho que sim" não basta.
- **Complemento faltando**: com a opção ligada, ele pergunta.
- **Endereço não localizado**: pede o número dígito por dígito e a rua soletrada e confere de novo. Após algumas tentativas sem sucesso, anota o que ouviu e avisa que não conseguiu validar.

Endereço validado não significa coleta ou entrega confirmada.

## Depois da ligação

Cada verificação aparece na ligação, em [Conversas](/app/inbox), com o nome que você escolheu.

## Teste a integração

Faça uma **Ligação de teste** e dite um endereço sem CEP ou sem complemento. Veja se o assistente confirma do jeito esperado e confira o resultado em [Conversas](/app/inbox). Lembre-se: cada teste é cobrado.

## Bom saber

- **Países**: cerca de 40, incluindo Brasil, Portugal, Argentina, Chile, Colômbia, México e Estados Unidos. Fora da cobertura, o endereço é anotado como foi dito.
- **Qual país**: o assistente deduz pela conversa. Se todos os clientes estão no Brasil, diga isso no [prompt](/ajuda/get-started/write-a-great-prompt).
- **Leitura sempre**: ele só lê o endereço de volta quando há o que confirmar. Para ler sempre, peça nas instruções.
- **Custo**: não há limite por ligação. Com a cota diária esgotada, ele avisa e oferece tentar depois.
- **Privacidade (LGPD):** só o endereço vai ao Google, pelo seu projeto. Nome, telefone e o resto da conversa ficam na Kloel.

## Se algo não estiver funcionando

| Mensagem | O que verificar |
| --- | --- |
| O Google recusou esta chave | Copie a chave de novo, inteira e sem espaços. |
| A Address Validation API não está ativada | Ative a API no projeto e clique em **Conectar** de novo. |
| As restrições de API excluem a Address Validation API | Edite a chave e inclua essa API. |
| A chave está restrita a sites ou IPs | Deixe **Restrições de aplicativos** em **Nenhuma**. |
| O projeto não tem conta de faturamento | Vincule uma conta de faturamento ao projeto. |
| O assistente diz que não conseguiu validar | A cota acabou ou o faturamento parou? O país está coberto? |

:::tip[Precisa de ajuda?]
Clique no botão **Suporte**, no topo desta central, ou fale com a gente em [Fale com o time](/contato).
:::`,
  },

  // ───────────────────────────────────────────────────────────── Google Sheets
  {
    section: 'integrations',
    slug: 'google-sheets',
    title: 'Google Sheets',
    description: 'Seu assistente consulta suas planilhas ou acrescenta linhas, antes, durante ou depois de cada ligação.',
    source: '[213]',
    related: ['get-started/contacts', 'integrations/airtable', 'get-started/troubleshooting'],
    keywords: ['google sheets', 'planilha', 'planilhas google', 'registro de ligações', 'adicionar linha', 'filtro', 'lista de preços'],
    body: `Com o Google Sheets conectado, seu assistente usa planilhas como sua equipe usa: confere um preço enquanto a pessoa aguarda, reconhece clientes frequentes pela sua lista ou registra cada pedido de retorno numa linha nova.

Pense num colega que nunca esquece de anotar.

::::steps
### Conecte sua conta do Google
Em [Integrações](/app/integrations), clique em **Adicionar integração**, escolha **Google Sheets** e depois **Conectar**. Dê um nome à conexão (por exemplo, "Conta da recepção"), entre com o Google e autorize.

A Kloel só abre as planilhas escolhidas, lê e adiciona linhas — nada além disso no Drive. Cada conta conectada serve para todas as integrações; para outra, use **Conectar outro**.

### Defina o modo e o momento
- **Nome**: padrão **Nova integração Google Sheets**. Prefira algo como "Consultar preços".
- **Modo**: **Leitura** (padrão) só consulta; **Adição** acrescenta uma linha no fim.
- **Execução**: **Antes da conversa** (padrão), **Durante a conversa** ou **Após a conversa**, com a janela **A qualquer momento** (padrão), **Durante o horário de funcionamento** ou **Fora do horário de funcionamento**. **Leitura** não roda após a conversa.
- **Quando a IA deve usar isso?**: obrigatório com **Durante a conversa**.

~~~text
Se a pessoa perguntar o valor de uma consulta, procure na aba de preços.
~~~

### Escolha planilha, aba e dados
Clique em **Abrir seletor**, escolha a planilha e depois a **Aba**. A **Pré-visualização** mostra as primeiras linhas; a linha 1 traz os nomes das colunas.

- **Filtro** (só **Leitura**): JSON de coluna e valor; o padrão procura o número de quem liga na coluna **Caller**. Operadores: \`$ne\` (diferente), \`$in\` (um destes), \`$regex\` (trecho).

~~~json
{
  "Telefone": "{{personNumber}}",
  "Status": { "$ne": "Encerrado" }
}
~~~

- **Valores da linha** (só **Adição**): qual valor vai em cada coluna. Maiúsculas não importam, mas a grafia sim; colunas inexistentes são ignoradas.

~~~json
{
  "Nome": "{{nome_cliente}}",
  "Telefone": "{{personNumber}}",
  "Motivo": "{{motivo}}",
  "Ligação": "{{conversationLink}}"
}
~~~

- **Variáveis personalizadas**: tipo **Texto**, **Número** ou **Booleano** e descrição obrigatória. Funcionam durante e após a conversa, nunca antes.
- **Avançado**: **O que dizer durante a execução**, **Linhas máx.** (1 a 1000; padrão 50) e **Usar primeira linha como cabeçalhos** (ligado; desligado, o filtro é ignorado).
::::

::mockup{kind="integration-config" name="Google Sheets" mode="action" caption="Google Sheets: modo, execução, planilha, aba e filtro com variáveis"}

## Antes da ligação

Em **Leitura**, a busca roda quando o telefone toca, normalmente pelo número, e o assistente já atende sabendo quem é a pessoa. Em **Adição**, cada ligação vira uma linha com o número.

:::tip[Fica entre você e seu assistente]
Quem liga nunca vê a planilha. O assistente apenas usa o que encontrou.
:::

## Durante a ligação

No momento descrito, o assistente pede o que precisa (um produto, um número de pedido), consulta e responde; se nada bater, avisa. Em **Adição**, grava a linha durante a conversa. O limite de espera é de 15 segundos.

## Depois da ligação

Em **Adição** com **Após a conversa**, o assistente preenche as variáveis com base na conversa e acrescenta a linha — um registro de ligações pronto. Cada execução fica na ligação, em [Conversas](/app/inbox).

## Teste a integração

Coloque seu celular numa linha e faça uma **Ligação de teste**. Confira a linha nova (em **Adição**) ou os dados usados (em **Leitura**) e o status em [Conversas](/app/inbox).

## Bom saber

- **Uma aba por integração.** Para outra aba, modo ou momento, adicione o Google Sheets de novo.
- **Células são lidas como texto.** \`$gt\` compara texto, então "9" vale mais que "10". Prefira valores exatos, \`$ne\`, \`$in\` e \`$regex\`.
- **Telefones** chegam como \`+5511900000123\`. O Sheets costuma apagar o "+", então formate a coluna como texto simples.
- **Limite de 96.000 caracteres por consulta.** Use um filtro preciso e poucas **Linhas máx.**.
- **Só reconhecer pelo nome?** Os [Contatos](/ajuda/get-started/contacts) resolvem sem planilha.
- **Privacidade (LGPD):** o assistente vê todas as colunas das linhas encontradas; guarde notas internas em outra aba.

## Se algo não estiver funcionando

| Mensagem | O que verificar |
| --- | --- |
| O modo Leitura não pode rodar após a conversa | Escolha outra **Execução** ou use **Adição**. |
| Descreva quando a IA deve usar isso | Preencha **Quando a IA deve usar isso?**. |
| O filtro precisa ser um JSON válido | Confira aspas, vírgulas e chaves; cada variável entre aspas. |
| Nenhuma linha corresponde ao filtro | Os nomes batem com a linha 1? Os telefones têm o "+"? |
| Não foi possível adicionar a linha | Alguma coluna dos valores existe na linha 1? A aba mudou de nome? |
| (reconexão necessária) em **Conexão** | Use **Conectar outro**, entre de novo e escolha a nova conexão. |
| Não roda em todas as ligações | A janela está limitada ao horário de funcionamento? |

:::tip[Precisa de ajuda?]
Clique no botão **Suporte**, no topo desta central, ou fale com a gente em [Fale com o time](/contato).
:::`,
  },

  // ───────────────────────────────────────────────────────────── Hostaway
  {
    section: 'integrations',
    slug: 'hostaway',
    title: 'Hostaway',
    description: 'Seu assistente reconhece seus hóspedes, tira dúvidas sobre a estadia e informa o código da porta e o Wi-Fi na hora certa.',
    source: '[214]',
    related: ['integrations/idobooking', 'get-started/troubleshooting'],
    keywords: ['hostaway', 'aluguel por temporada', 'hóspedes', 'check-in', 'código da porta', 'wi-fi', 'reservas'],
    body: `Com o Hostaway conectado, seu assistente reconhece o hóspede pelo telefone e responde sobre a reserva, como um recepcionista que conhece cada estadia da Pousada Maré Alta.

Quando alguém chega tarde da noite, ele informa o código da porta e o Wi-Fi — só ao hóspede certo e só no período da estadia.

:::warning[Acesso antecipado]
O Hostaway ainda não está liberado para todas as contas. Se ele não aparece em [Integrações](/app/integrations), peça a liberação pelo botão **Suporte**.
:::

::::steps
### Crie a chave no Hostaway
Na área de API das configurações do Hostaway, crie uma chave com um nome reconhecível, como "Kloel". Copie na hora o **Account ID** e a **API key**: a chave só aparece uma vez.

Chaves do Hostaway sempre têm acesso total, mas a Kloel só lê reservas e acomodações. Sem acesso a essa área, peça a quem administra a conta.

### Conecte o Hostaway à Kloel
Em [Integrações](/app/integrations), adicione o **Hostaway** e preencha **ID da conta** (o número exibido junto da chave, como \`204518\`) e **Chave de API**, inteira. Ao salvar, a Kloel verifica os dois.

### Escolha o que o assistente pode compartilhar
- **Nome**: padrão **Hostaway**.
- **Compartilhar código da porta**: ligado; inclui retirada de chaves e instruções de chegada. Desligado, o assistente diz que você enviará à parte.
- **Compartilhar dados do Wi-Fi**: ligado; rede e senha.
- O quadro **Quem recebe código e Wi-Fi** resume as regras abaixo.
::::

::mockup{kind="integration-config" name="Hostaway" mode="credentials" caption="Hostaway: ID da conta, chave de API e o que o assistente pode compartilhar"}

## Antes da ligação

O assistente procura o número nas estadias em andamento e nas que começam em até 30 dias. Encontrando, cumprimenta pelo primeiro nome e já sabe acomodação, datas, hóspedes, horários e se a reserva está confirmada.

Quando a Fernanda liga da estrada para saber a partir de que horas pode entrar, ele responde sem pedir código de reserva. Quem não é encontrado, ou liga com número oculto, informa alguns dados na conversa.

:::tip[Fica entre você e seu assistente]
O assistente nunca diz que pesquisou alguém, só fala da reserva de quem liga e nunca chuta um código.
:::

## Durante a ligação

Ele responde se a reserva está confirmada, quando entrar e até quando ficar, no fuso local da acomodação.

Sem reconhecer o número, pede o sobrenome soletrado e o código de confirmação do canal (Airbnb, Booking.com ou o número do Hostaway); hífens e espaços não importam.

Identificado o hóspede, ele informa código da porta, chaves, instruções de chegada e Wi-Fi, devagar, pedindo que a pessoa repita e indicando maiúsculas e minúsculas na senha.

Esses dados só saem para reservas confirmadas, do dia anterior à chegada até a saída; antes disso, ele diz quando poderá informá-los. Reserva pendente ou simples consulta não recebe dados de acesso.

## Depois da ligação

Nada é gravado no Hostaway. Em [Conversas](/app/inbox), a ligação mostra se o hóspede foi encontrado.

## Teste a integração

Crie uma reserva confirmada com seu celular e chegada amanhã, ligue desse número e peça o Wi-Fi. Depois, adie a chegada uma semana e confirme que os dados não são informados.

## Bom saber

- **Só leitura.** Nada é criado, alterado ou cancelado no Hostaway.
- **Telefones** precisam bater com o da reserva, com ou sem código do país; sem número no canal, valem sobrenome e código.
- **Estadias mais distantes** que 30 dias são encontradas pelo sobrenome e pelo código.
- **Origem dos dados**: o código da porta vem da reserva ou da acomodação; chaves, chegada e Wi-Fi vêm da acomodação. Estadias do proprietário ficam de fora.
- **Sua chave** tem acesso total. Apague-a no Hostaway se deixar de usar a integração.

## Se algo não estiver funcionando

| Mensagem | O que verificar |
| --- | --- |
| O Hostaway recusou o ID da conta e a chave | Use o ID exibido junto da chave e cole-a inteira; se foi apagada, crie outra. |
| Falha na consulta ao Hostaway | A chave segue ativa? Se for ocasional, o Hostaway oscilou. |
| O hóspede não é reconhecido pelo número | O número está na reserva? A estadia começa em até 30 dias? |
| A reserva não é encontrada por sobrenome e código | O sobrenome confere? O código é do canal ou do Hostaway? |
| O código da porta ou o Wi-Fi não é informado | A reserva está confirmada e é véspera da chegada ou depois? As opções estão ligadas? |
| Não há código nem Wi-Fi para ler | Preencha esses dados na acomodação, no Hostaway. |

:::tip[Precisa de ajuda?]
Clique no botão **Suporte**, no topo desta central, ou fale com a gente em [Fale com o time](/contato).
:::`,
  },

  // ───────────────────────────────────────────────────────────── IdoBooking
  {
    section: 'integrations',
    slug: 'idobooking',
    title: 'IdoBooking',
    description: 'Seu assistente conhece suas acomodações, consulta datas livres e preços, recebe pedidos de reserva e atende hóspedes sobre a reserva deles.',
    source: '[215]',
    related: ['integrations/hostaway', 'get-started/troubleshooting'],
    keywords: ['idobooking', 'reservas', 'hospedagem', 'pedido de reserva', 'disponibilidade', 'código da porta', 'cancelamento'],
    body: `Com o IdoBooking conectado, seu assistente conhece acomodações, datas livres e preços. Ele tira dúvidas, recebe pedidos de reserva e atende hóspedes, como um recepcionista com o calendário aberto.

Na véspera da chegada, também informa o código da porta — só ao hóspede certo.

:::warning[Acesso antecipado]
O IdoBooking ainda não está liberado para todas as contas. Se ele não aparece em [Integrações](/app/integrations), peça a liberação pelo botão **Suporte**.
:::

::::steps
### Crie um usuário de API no IdoBooking
Nas configurações de API do painel, ative o acesso à API de administração. Em usuários, crie um usuário só para a Kloel (como \`assistente-kloel\`) com acesso à API, anote login e senha gerada e salve.

O assistente age como esse usuário: lê acomodações, datas, preços e reservas, cria pedidos, cancela e grava notas. Seu login pessoal fica de fora. Sem acesso a essas telas, peça ao administrador.

### Conecte o IdoBooking à Kloel
Em [Integrações](/app/integrations), adicione o **IdoBooking** e preencha **Endereço do painel** (só o trecho antes do primeiro ponto, como \`client12345\`), **Login** e **Senha**. Ao salvar, a Kloel confere o acesso; se trocar a senha no IdoBooking, atualize aqui.

### Escolha o que o assistente pode fazer
- **Nome**: padrão **IdoBooking**.
- **Detalhes da reserva** (lembrete): só para quem liga do telefone salvo na reserva.
- **Moeda**: a das suas tarifas, por exemplo **BRL**.
- **Receber pedidos de reserva**: ligado; sua equipe confirma depois. Desligado, ele só informa datas e preços.
- **Cancelar reservas**: ligado, com **Prazo de cancelamento (dias)** — padrão 7. Reservas de canais como Airbnb nunca são canceladas por ele.
- **Compartilhar código da porta**: ligado; do dia anterior à chegada até a saída, só para reservas confirmadas.
- **Registrar ligações**: ligado; nota no hóspede e em cada reserva criada ou cancelada.
::::

::mockup{kind="integration-config" name="IdoBooking" mode="credentials" caption="IdoBooking: endereço do painel, usuário de API e regras de reserva"}

## Antes da ligação

O assistente carrega as acomodações: nome, capacidade, camas, endereço e horários. Assim, "vocês têm algo para seis pessoas?" tem resposta imediata. Com o IdoBooking fora do ar, ele não arrisca: avisa que a equipe retornará.

:::tip[Fica entre você e seu assistente]
O assistente nunca lê números internos, nunca inventa preço e só fala de uma reserva quando o telefone de quem liga confere.
:::

## Durante a ligação

- **Acomodações**: tamanho, camas, comodidades, extras, localização e horários, a partir das suas descrições.
- **Datas**: pede chegada, saída, adultos e crianças e oferece só opções livres em todas as noites, que comportem todos, com o preço da estadia calculado pelo IdoBooking (sem extras).
- **Pedido de reserva**: soletra nome, sobrenome e e-mail, repete o resumo e, com um "sim" claro, cria o pedido. Informa número e preço, lembrando que a equipe ainda confirma; o IdoBooking avisa o hóspede.
- **Reserva existente**: com o número da reserva e o telefone salvo nela, informa status, horários, quarto e saldo. A Beatriz liga na véspera e recebe o código da porta, dígito por dígito.
- **Cancelamento**: só reservas diretas, dentro do prazo, com aviso de que não há volta.

## Depois da ligação

Com **Registrar ligações**, uma nota com data, resumo e links para a ligação e a gravação é acrescentada ao hóspede e às reservas tratadas, sem apagar nada. Confira em [Conversas](/app/inbox).

## Teste a integração

Faça uma **Ligação de teste**, peça datas e conclua um pedido com dados de teste; ele deve aparecer no IdoBooking aguardando confirmação.

## Bom saber

- **Pedidos, não reservas fechadas**: você confirma como qualquer outro pedido.
- **Telefones** do hóspede ou de acompanhantes valem, com ou sem código do país.
- **Número oculto**: sem busca, código ou cancelamento; o pedido ainda pode ser feito com e-mail.
- **Limites**: 100 acomodações, 10 opções livres por vez e estadias de até 100 noites.
- **Fuso**: "hoje", a janela do código e o prazo seguem o fuso de São Paulo (America/Sao_Paulo).
- **Seu usuário**: desative o acesso à API ou apague-o ao deixar de usar.

## Se algo não estiver funcionando

| Mensagem | O que verificar |
| --- | --- |
| O IdoBooking recusou o login e a senha | Os dados estão certos? O acesso à API está ativo para o usuário e para o painel? |
| As acomodações não foram carregadas | A senha mudou ou o acesso à API foi desligado? |
| O assistente não encontra a reserva | O telefone de quem liga está salvo nela? |
| Nenhuma acomodação livre é oferecida | Há preço para todas as noites? Todos os hóspedes cabem? |
| O cancelamento não acontece | A reserva é direta, dentro do prazo, e a opção está ligada? |

:::tip[Precisa de ajuda?]
Clique no botão **Suporte**, no topo desta central, ou fale com a gente em [Fale com o time](/contato).
:::`,
  },

  // ───────────────────────────────────────────────────────────── IdoSell
  {
    section: 'integrations',
    slug: 'idosell',
    title: 'IdoSell',
    description: 'Seu assistente reconhece seus clientes, informa onde está cada pedido e ajuda com produtos, cupons, devoluções e alterações.',
    source: '[216]',
    related: ['integrations/baselinker', 'actions/sms', 'get-started/troubleshooting'],
    keywords: ['idosell', 'loja virtual', 'e-commerce', 'status do pedido', 'devolução', 'cupom', 'assinatura', 'rastreamento'],
    body: `Com o IdoSell conectado, seu assistente atende como alguém que conhece os clientes da loja: reconhece quem liga, conta onde está o pedido e tira dúvidas sobre produtos, cupons e devoluções.

Se você permitir, também cancela e altera pedidos, registra devoluções, ajusta assinaturas e recebe pedidos.

:::warning[Acesso antecipado]
O IdoSell ainda não está liberado para todas as contas. Se ele não aparece em [Integrações](/app/integrations), peça a liberação pelo botão **Suporte**.
:::

::::steps
### Crie a chave no IdoSell
Nas configurações de API do painel, crie uma chave com autorização por **API key**, nome \`Kloel\` e status ativo. Dê leitura e escrita a **CRM** e **OMS**, só leitura a **PIM** e **System** e nenhum acesso aos demais. Salve e copie a chave na lista de chaves ativas. Uma chave exclusiva pode ser desativada quando quiser.

### Conecte o IdoSell à Kloel
Em [Integrações](/app/integrations), adicione o **IdoSell** e preencha **Endereço do painel** (como aparece no navegador) e **Chave de API**; a Kloel confere ao salvar.

### Escolha o que o assistente pode fazer
Só a leitura e os links de rastreio vêm ligados.

- **Nome**: padrão **IdoSell**. **Loja**: vazio atende todas as lojas do painel.
- **Enviar links de rastreio**: ligado, por SMS. Desligado, ele lê o código.
- **Cancelar pedidos**: só os ainda não embalados.
- **Alterar entregas**: endereço, ponto de retirada ou recado ao entregador, antes de embalar.
- **Registrar devoluções**: até 30 dias após o envio. Política mais rígida? Escreva no [prompt](/ajuda/get-started/write-a-great-prompt).
- **Alterar assinaturas**: pausar, retomar, cancelar ou mudar a próxima entrega.
- **Receber pedidos**: criados sem frete. Desligado, sugere a loja online.
- **Registrar ligações**: resumo na conta do cliente e nos pedidos tratados.
::::

::mockup{kind="integration-config" name="IdoSell" mode="credentials" caption="IdoSell: endereço do painel, chave de API e permissões de alteração"}

## Antes da ligação

O assistente procura o número entre os clientes e carrega os últimos cinco pedidos (itens, status, pagamento, entrega, rastreio), pontos, saldo e formas de entrega. Quando a Patrícia pergunta pelo pacote, ele responde sem pedir o número do pedido. Com o IdoSell fora do ar, ele não chuta.

:::tip[Fica entre você e seu assistente]
O assistente nunca lê números internos e só fala de um pedido se reconhece quem liga ou recebe o número do pedido com o sobrenome dele. Pontos e saldo, só para o dono.
:::

## Durante a ligação

- **Status**: explica em palavras simples em que etapa está o pedido e oferece o link de rastreio.
- **Produtos**: por nome ou código, com preço, tamanhos e prazo de envio, sem listas longas.
- **Cupons e cartões-presente**: valor e validade; para cartão-presente, só com o PIN correto.
- **Devoluções e reclamações**: informa o status, mas não abre reclamação nova.
- **Alterações permitidas**: antes de cancelar, mudar a entrega, registrar devolução ou mexer na assinatura, repete o que vai fazer e espera um "sim" claro.
- **Pedidos por telefone**: soletra nome, e-mail e endereço, repete tudo e só finaliza com confirmação; informa número e total sem frete.

## Depois da ligação

Com **Registrar ligações**, uma nota com data, resumo e links para a ligação e a gravação vai para a conta do cliente e os pedidos tratados, abaixo do que já existe. Confira em [Conversas](/app/inbox).

## Teste a integração

Cadastre seu celular numa conta com um pedido recente, ligue desse número e peça o rastreio. Depois, ligue uma alteração por vez e teste com pedidos de teste.

## Bom saber

- **Número oculto**: sem reconhecimento, assinaturas ou SMS; número do pedido e sobrenome ainda funcionam.
- **Antes de embalar**: depois disso, cancelamento e alteração de entrega não são feitos por telefone.
- **Reembolso** de pedido pago cancelado fica com você, no IdoSell.
- **Limites**: últimos cinco pedidos e até dez produtos por busca.
- **Várias lojas**: adicione o IdoSell uma vez por loja, mudando **Loja**.
- **Sua chave**: desative-a ao deixar de usar.

## Se algo não estiver funcionando

| Mensagem | O que verificar |
| --- | --- |
| O IdoSell recusou esta chave | A chave foi copiada inteira? Ela está ativa? |
| A chave não tem os direitos necessários | Leitura e escrita em CRM e OMS; leitura em PIM e System. |
| O cliente não é reconhecido | O número dele está na conta? Ligou com número oculto? |
| O pedido não é encontrado | O número ou o sobrenome consta no pedido? É da loja escolhida? |
| Não cancela nem altera | O pedido ainda não foi embalado? A opção está ligada? |

:::tip[Precisa de ajuda?]
Clique no botão **Suporte**, no topo desta central, ou fale com a gente em [Fale com o time](/contato).
:::`,
  },

  // ───────────────────────────────────────────────────────────── Livespace
  {
    section: 'integrations',
    slug: 'livespace',
    title: 'Livespace',
    description: 'Seu assistente reconhece quem liga pelo Livespace, conhece o histórico de cada cliente e registra cada ligação no contato.',
    source: '[190]',
    related: ['get-started/contacts', 'actions/appointments', 'get-started/troubleshooting'],
    keywords: ['livespace', 'CRM', 'contatos', 'notas', 'compromissos', 'histórico do cliente', 'lead'],
    body: `Com o Livespace conectado, seu assistente trata cada cliente como um colega de longa data: cumprimenta pelo nome e sabe o que foi conversado e combinado.

Quem é novo entra no Livespace sem ninguém digitar nada, e cada ligação deixa um resumo no contato.

:::warning[Acesso antecipado]
O Livespace ainda não está liberado para todas as contas. Se ele não aparece em [Integrações](/app/integrations), peça a liberação pelo botão **Suporte**.
:::

::::steps
### Pegue a chave e o segredo no Livespace
Nas configurações de API do Livespace, confirme que o acesso está ativo. Na lista de usuários, exiba as credenciais de uma pessoa e copie **API key** e **API secret**.

Use um usuário real, não o anônimo da API, que não pode ter compromissos. O assistente enxerga só o que esse usuário enxerga e precisa ao menos de acesso a contatos (mais as permissões para criar contatos, notas e compromissos).

### Conecte o Livespace à Kloel
Em [Integrações](/app/integrations), adicione o **Livespace** e preencha **Endereço do Livespace** (a primeira parte do endereço, como \`bemviver\`), **Chave de API** e **Segredo de API**, do mesmo usuário. Ao salvar, a Kloel testa a conexão.

### Escolha o que o assistente pode registrar
Vem ligado: **Adicionar quem liga pela primeira vez** (sem duplicar), **Corrigir dados do contato**, **Registrar cada ligação no contato**, **Notas visíveis para toda a equipe** e **Oferecer retorno quando não puder ajudar**. Além disso:

- **Nome**: padrão **Central do CRM**.
- **Salvar quem não diz o nome**: desligado; usa um nome provisório.
- **Compromissos**: **Não agendar** (padrão), **Solicitar; um colega confirma** ou **Agendar direto**. O Livespace não informa a disponibilidade real, então solicitar é o mais seguro.
- **Notas recentes lidas antes de responder**: padrão 8, máximo 10.
- **Responsável para contatos sem dono** e **Tipo de tarefa** dos compromissos.
::::

::mockup{kind="integration-config" name="Livespace" mode="credentials" caption="Livespace: endereço, chave e segredo de API e regras de registro"}

## Antes da ligação

O assistente procura o número no Livespace e carrega nome, empresa, cargo, responsável, últimas notas, compromissos e oportunidades em aberto. Quando a Marina, da Construtora Horizonte, liga sobre a proposta da semana passada, ninguém precisa explicar nada de novo.

Número desconhecido, privado ou compartilhado: a pessoa é tratada como nova. Com o Livespace fora do ar, o atendimento segue sem histórico.

:::tip[Fica entre você e seu assistente]
O assistente nunca lê a ficha em voz alta, nunca lista o que sabe e nunca diz que pesquisou alguém.
:::

## Durante a ligação

O assistente age sem anunciar: não pede licença para salvar nem avisa que salvou. Só diz em voz alta o dia e o horário de um compromisso.

- **Primeira ligação**: salva número, nome, empresa e cargo mencionados, com o motivo como nota, sem pedir e-mail.
- **Dados novos**: e-mail, telefone, cargo ou grafia do nome são atualizados na hora.
- **Notas**: pedidos e promessas são anotados durante a ligação, mesmo que ela caia.
- **Compromissos**: combina, repete uma vez e espera um "sim" claro. Na solicitação, cria uma tarefa não confirmada; no agendamento direto, se houver conflito, um colega confirma.
- **Falhas**: se algo não for salvo, ele diz com sinceridade.

## Depois da ligação

O contato recebe a ligação (número, direção, duração) e uma nota com resumo e link para a conversa. Se mais de um contato apareceu, nada é registrado. Confira em [Conversas](/app/inbox).

## Teste a integração

Ligue de um número fora do Livespace, diga nome e empresa e peça um horário. Confira contato, nota e tarefa, e a ligação em [Conversas](/app/inbox).

## Bom saber

- **Etiqueta \`assistente-kloel\`** marca tudo o que o assistente escreve.
- **Só o que o usuário vê.** Contatos fora do alcance dele continuam desconhecidos.
- **A agenda só conhece o Livespace.** Compromissos externos podem gerar conflito.
- **Nomes provisórios**, como **Desconhecido +55 11 90000-0123**, devem ser renomeados depois.
- **Notas são informação**, nunca instruções.

## Se algo não estiver funcionando

| Mensagem | O que verificar |
| --- | --- |
| O Livespace recusou as credenciais | A chave e o segredo são do mesmo usuário? O acesso à API está ativo? |
| O usuário da API não lê contatos | Dê acesso a contatos a esse usuário. |
| Credenciais do usuário anônimo da API | Use a chave e o segredo de um usuário real. |
| O cliente conhecido não é reconhecido | O número está em um único contato visível ao usuário? |
| O compromisso não é marcado | O usuário é real e pode criar tarefas? |

:::tip[Precisa de ajuda?]
Clique no botão **Suporte**, no topo desta central, ou fale com a gente em [Fale com o time](/contato).
:::`,
  },

  // ───────────────────────────────────────────────────────────── Magicline
  {
    section: 'integrations',
    slug: 'magicline',
    title: 'Magicline',
    description: 'Seu assistente reconhece alunos pelo número, tira dúvidas de contrato e pagamentos e reserva aulas coletivas e experimentais no Magicline.',
    source: '[191]',
    related: ['actions/appointments', 'get-started/troubleshooting'],
    keywords: ['magicline', 'academia', 'estúdio', 'aula experimental', 'aulas coletivas', 'alunos', 'contrato', 'lead'],
    body: `Com o Magicline conectado, seu assistente atende como alguém da recepção que conhece cada aluno: reconhece pelo número, sabe o contrato e o próximo vencimento.

Ele reserva aulas coletivas e experimentais direto no Magicline, e quem quer se matricular vira lead.

:::warning[Acesso antecipado]
O Magicline ainda não está liberado para todas as contas. Se ele não aparece em [Integrações](/app/integrations), peça a liberação pelo botão **Suporte**.
:::

::::steps
### Copie o e-mail de vínculo
Em [Integrações](/app/integrations), adicione o **Magicline** e, em **Conecte sua academia do Magicline**, copie o e-mail exibido. Ele é da sua conta Kloel e vale para todas as academias.

### Autorize a conexão no Magicline
Na área de integrações do Magicline, adicione a conexão com a **Kloel** para a sua academia. Quando pedir um e-mail, cole o do passo anterior, permita o acesso e ative.

Não há chave para digitar: em geral em menos de um minuto, a academia aparece sozinha em **Conexão**, com o mesmo nome. Várias unidades? Autorize a conexão em cada uma com o mesmo e-mail e escolha a certa em **Conexão**.

### Escolha o que o assistente pode fazer
Tudo vem desligado.

- **Nome**: padrão **Nova integração Magicline**.
- **Criar leads após a ligação**: pede nome, sobrenome e e-mail a interessados novos e cadastra ao fim.
- **Permitir aulas experimentais**: oferece e reserva para quem não tem plano ativo; quem é novo vira lead na hora.
- **Permitir reservas de aulas**: inscreve alunos reconhecidos e cancela reservas deles. Desligado, ainda informa a grade e o que já está reservado.
::::

::mockup{kind="integrations" highlight="Magicline" caption="Magicline na lista de integrações, com a academia conectada"}

## Antes da ligação

O assistente procura o número entre alunos e leads. De um aluno, conhece plano, preço, início, fidelidade mínima, fim, renovação, aviso prévio e eventual cancelamento. Quando a Luana pergunta quando pode encerrar o plano, o contrato já está à mão.

Ex-alunos são tratados como interessados, mas tiram dúvidas do contrato antigo. Leads já cadastrados não repetem dados. Número compartilhado por vários alunos: assuntos pessoais ficam com a recepção.

:::tip[Fica entre você e seu assistente]
O assistente usa os dados só para responder sobre a situação de quem liga. Contratos antigos ficam fora da conversa, a menos que a pessoa pergunte.
:::

## Durante a ligação

- **Grade**: qualquer pessoa pode perguntar. Ele consulta até quatro semanas à frente e informa horário, professor, local e vagas, sem prometer vaga que não existe.
- **Reservas**: com a opção ligada, repete aula e horário antes de reservar ou cancelar. Aula lotada vai para a lista de espera, com aviso.
- **Contrato e pagamentos**: calcula a data possível de saída pelo fim do contrato e pelo aviso prévio, diz em que datas se baseou e lembra que a academia confirma. Informa saldo, vencimento e cobranças recentes.
- **Aula experimental**: pede nome, sobrenome e data de nascimento (só o que faltar), repete data e horário e reserva. Se a confirmação falhar, avisa que a recepção precisa confirmar.

## Depois da ligação

Com **Criar leads após a ligação**, interessados novos que informaram nome, sobrenome e e-mail (soletrado na ligação) são cadastrados com telefone, interesse e resumo. Duplicados por e-mail ou telefone não são criados de novo. Confira em [Conversas](/app/inbox).

## Teste a integração

Ligue de um número fora do Magicline e peça uma aula experimental. Verifique a reserva e o lead no Magicline e a ligação em [Conversas](/app/inbox).

## Bom saber

- **Número oculto**: ele fala da grade, mas não reserva experimental nem cria lead.
- **Cancelar plano**: ele explica as datas, mas não cancela.
- **Alcance**: pagamentos de 90 dias, contratos encerrados há até seis meses e aulas até quatro semanas à frente.
- **Regras das aulas experimentais** do Magicline continuam valendo.
- **E-mails provisórios**, gerados a partir do telefone, identificam leads de aula experimental.
- **Desconectar**: remova a conexão com a Kloel na área de integrações do Magicline.

## Se algo não estiver funcionando

| Mensagem | O que verificar |
| --- | --- |
| A academia não aparece em **Conexão** | O e-mail colado é o da Kloel? A conexão foi autorizada na unidade certa? |
| O aluno não é reconhecido | O número está no Magicline? Estava oculto? |
| Não fala de contrato | Outra pessoa usa o mesmo número? |
| Não reserva aulas | **Permitir reservas de aulas** está ligado? O aluno tem plano ativo? |
| Não oferece aula experimental | A opção está ligada e há horários livres nas ofertas? |
| Nenhum lead depois da ligação | A opção está ligada e a pessoa informou nome, sobrenome e e-mail? |

:::tip[Precisa de ajuda?]
Clique no botão **Suporte**, no topo desta central, ou fale com a gente em [Fale com o time](/contato).
:::`,
  },

  // ───────────────────────────────────────────────────────────── Make
  {
    section: 'integrations',
    slug: 'makecom',
    title: 'Make',
    description: 'Seu assistente dispara seus cenários do Make no momento certo: antes, durante ou depois de uma ligação.',
    source: '[192]',
    related: ['integrations/n8n', 'developers/http-request', 'integrations/zapier', 'get-started/troubleshooting'],
    keywords: ['make', 'make.com', 'integromat', 'automação', 'cenário', 'webhook', 'no-code'],
    body: `Com o Make conectado, seu assistente inicia seus cenários sozinho: avisa a equipe sobre um lead, registra um retorno no CRM ou consulta outro aplicativo na hora certa.

É como um colega que sabe qual botão apertar depois de cada ligação.

::::steps
### Gere o token no Make
Abra o Make e observe a barra de endereço: o começo, no formato \`https://<sua-zona>.make.com\`, é a sua zona. Anote.

No seu perfil, abra a área de acesso à API e crie um token com estes escopos:

~~~text
scenarios:read
scenarios:run
hooks:read
teams:read
organizations:read
~~~

Copie o token na hora, porque ele só aparece uma vez. O cenário precisa começar com um **Custom webhook** e estar ativo.

### Conecte o Make à Kloel
Em [Integrações](/app/integrations), clique em **Adicionar integração** e escolha **Make**. Preencha **URL da zona** (só o começo do endereço, sem nada depois de \`.make.com\`) e **Token de API**. Ao salvar, a Kloel testa a conexão.

### Configure o disparo
- **Nome**: padrão **Nova integração Make**. Prefira algo como "Avisar a equipe comercial".
- **Equipe**: a equipe do Make dona do cenário.
- **Execução**: **Antes da conversa** (padrão), **Durante a conversa** ou **Após a conversa**, com a janela **A qualquer momento** (padrão), **Durante o horário de funcionamento** ou **Fora do horário de funcionamento**.
- **Quando a IA deve usar isso?**: obrigatório com **Durante a conversa**.

~~~text
Se a pessoa pedir retorno, anote o nome e o motivo e inicie este cenário.
~~~

- **Webhook**: os Custom webhooks da equipe. Itens marcados como **(inativo)**, **(sem cenário)** ou **(removido)** só ficam disponíveis depois de corrigidos no Make.
- **Chave de API do webhook**: opcional; preencha só se protegeu o webhook com uma chave.
- **Corpo da requisição**: por padrão, o número de quem liga e o do assistente. Use **Adicionar variável** para incluir dados da ligação e crie **Variáveis personalizadas** (tipo e descrição obrigatórios), válidas durante e após a conversa:

~~~json
{
  "from": "{{personNumber}}",
  "to": "{{agentNumber}}",
  "nome": "{{nome_cliente}}",
  "motivo": "{{motivo}}",
  "link": "{{conversationLink}}"
}
~~~
::::

::mockup{kind="integration-config" name="Make" mode="action" caption="Make: execução, webhook escolhido e corpo da requisição com variáveis"}

## Antes da ligação

O cenário começa quando o telefone toca, com o número de quem liga — bom para avisar a equipe ou registrar chamadas. Variáveis personalizadas ainda não existem, e a resposta do cenário não é usada.

:::tip[Fica entre você e seu assistente]
O assistente nunca menciona que um cenário rodou. Para quem liga, é uma conversa comum.
:::

## Durante a ligação

Quando chega o momento descrito, o assistente reúne o que o cenário precisa e o dispara. Se o cenário termina com um **Webhook response**, ele ouve a resposta e pode repassá-la, como o status de um pedido; sem isso, o Make só confirma o recebimento. O limite de espera é de 15 segundos.

## Depois da ligação

Ao desligar, o assistente preenche as variáveis e envia tudo; o cenário pode criar o lead, avisar a equipe ou abrir uma tarefa. Em [Conversas](/app/inbox), cada execução mostra o que foi enviado e o resultado.

## Teste a integração

No webhook do Make, clique em **Redetermine data structure** e faça uma **Ligação de teste**: o Make aprende o formato dos dados com essa chamada. Depois, confira o histórico do cenário e a ligação em [Conversas](/app/inbox).

## Bom saber

- **Um cenário por integração.** Para outro cenário ou momento, adicione o Make de novo.
- **Só Custom webhooks.** Outros gatilhos, como mailhooks, não aparecem.
- **Telefones** chegam como \`+5511900000123\`; número oculto chega vazio.
- **Consumo**: cada execução conta no seu plano do Make.
- **Privacidade (LGPD):** o corpo da requisição sai da Kloel e é processado na sua conta do Make. Envie só o necessário.

## Se algo não estiver funcionando

| Mensagem | O que verificar |
| --- | --- |
| O Make recusou o token | O token foi copiado inteiro e tem os cinco escopos? |
| Não foi possível acessar o Make nesta zona | Use só o começo do endereço da sua zona. |
| Descreva quando a IA deve usar isso | Preencha **Quando a IA deve usar isso?**. |
| A lista de **Equipe** está vazia | O token tem \`teams:read\` e \`organizations:read\`? |
| O webhook não aparece | A equipe certa está escolhida? O cenário começa com Custom webhook e está ativo? |
| Execução com falha em Conversas | O cenário segue ativo? A chave do webhook está preenchida? |
| Faltam dados no Make | Use **Redetermine data structure** e repita o teste. |
| A resposta do cenário não é repassada | Há **Webhook response** respondendo em até 15 segundos? |

:::tip[Precisa de ajuda?]
Clique no botão **Suporte**, no topo desta central, ou fale com a gente em [Fale com o time](/contato).
:::`,
  },

  // ───────────────────────────────────────────────────────────── n8n
  {
    section: 'integrations',
    slug: 'n8n',
    title: 'n8n',
    description: 'Cada ligação pode acionar seus workflows do n8n, de um aviso rápido à equipe a um novo registro no CRM.',
    source: '[193]',
    related: ['developers/http-request', 'integrations/makecom', 'get-started/troubleshooting'],
    keywords: ['n8n', 'workflow', 'automação', 'webhook', 'self-hosted', 'n8n cloud', 'API'],
    body: `Com o n8n conectado, suas ligações acionam automações que você já criou: um aviso à equipe, uma consulta ao sistema de pedidos com a pessoa na linha ou um registro no CRM ao fim da conversa. Onde ainda não há integração nativa, o n8n faz a ponte.

O assistente repassa cada informação na hora certa; o n8n cuida do resto.

::::steps
### Prepare o workflow
O workflow precisa começar com um nó **Webhook**. Nele:

- **HTTP Method**: **POST**.
- **Authentication**: **Basic Auth**, **Header Auth** ou **JWT Auth**, para que só a Kloel inicie o workflow. **None** funciona, mas qualquer pessoa com a URL poderia dispará-lo.
- **Respond**: **When Last Node Finishes** ou **Using 'Respond to Webhook' Node** se o assistente deve repassar o resultado; caso contrário, **Immediately**.

Ative o workflow (**Active** ou **Publish**). A Kloel usa a URL de produção, então o modo de teste do editor não captura as chamadas.

### Crie a chave de API
Nas configurações do n8n, crie uma chave de API (por exemplo, "Kloel"), de preferência sem expiração: chave vencida para tudo sem aviso. No Enterprise, \`workflow:read\` e \`workflow:list\` bastam.

A chave enxerga os mesmos workflows de quem a criou. A API não está no teste gratuito do n8n Cloud; sem ela, use [Requisição HTTP](/ajuda/developers/http-request) com a URL do webhook.

### Conecte o n8n à Kloel
Em [Integrações](/app/integrations), adicione o **n8n**, clique em **Conectar** em **Conexão** e preencha **URL do servidor** (só o começo do endereço do editor, acessível pela internet) e **Chave de API**:

~~~text
https://n8n.exemplo.com.br
~~~

### Configure a ação
- **Nome**: padrão **Nova integração n8n**.
- **Execução**: **Antes da conversa** (padrão), **Durante a conversa** ou **Após a conversa**, com a janela **A qualquer momento** (padrão), **Durante o horário de funcionamento** ou **Fora do horário de funcionamento**.
- **Quando a IA deve usar isso?**: obrigatório com **Durante a conversa**.
- **Webhook**: aparece como "Workflow → nó Webhook"; inativos ficam em cinza.
- **Usuário** e **Senha**, **Nome do cabeçalho** (padrão \`Authorization\`) e **Valor do cabeçalho**, ou **Token JWT**: conforme a autenticação do nó.
- **Corpo da requisição**, com **Adicionar variável** e **Variáveis personalizadas** (**Texto**, **Número** ou **Booleano**, com descrição):

~~~json
{
  "from": "{{personNumber}}",
  "to": "{{agentNumber}}",
  "pedido": "{{numero_pedido}}"
}
~~~
::::

::mockup{kind="integration-config" name="n8n" mode="action" caption="n8n: webhook do workflow, credenciais do nó e corpo da requisição"}

## Antes da ligação

O workflow recebe o número de quem liga, o número discado e o que mais estiver no corpo. O n8n tem até cinco segundos, então use **Immediately** e deixe o resto em segundo plano. Variáveis personalizadas ainda não existem.

:::tip[Fica entre você e seu assistente]
Quem liga não percebe nada: o assistente cumprimenta normalmente enquanto o n8n trabalha.
:::

## Durante a ligação

Uma paciente da Clínica Bem Viver quer saber se o exame ficou pronto. O assistente pede o protocolo, dispara o workflow e conta a resposta com as próprias palavras. Com **Immediately**, só sabe que o workflow começou; sem resposta em 15 segundos, avisa com sinceridade.

## Depois da ligação

O assistente preenche as variáveis com o que foi dito; o que não surgiu pode chegar vazio, então prepare o workflow para lacunas. É o momento de criar um lead, um chamado ou um resumo por e-mail.

## Teste a integração

Faça uma **Ligação de teste** e abra **Executions** no n8n: cada execução mostra tudo o que a Kloel enviou. Confira também a ligação em [Conversas](/app/inbox).

## Bom saber

- **Um workflow por integração**, todos podendo usar a mesma conexão.
- **Só workflows ativos** podem ser disparados.
- **Mudou a autenticação do nó?** Escolha o webhook de novo para atualizar os campos.
- **Limites**: 5 segundos antes, 15 durante; respostas acima de 96.000 caracteres são cortadas.
- **Número oculto** chega vazio.
- **Privacidade (LGPD):** o corpo vai para o seu n8n e segue para onde o workflow mandar. Envie só o necessário.

## Se algo não estiver funcionando

| Mensagem | O que verificar |
| --- | --- |
| O n8n recusou a chave | A chave expirou? No n8n Cloud, a API exige plano pago. |
| Não foi possível acessar o n8n nesta URL | Use só o começo do endereço, acessível pela internet. |
| Descreva quando a IA deve usar isso | Preencha o campo para **Durante a conversa**. |
| O workflow não aparece ou está inativo | Ele tem nó Webhook e está ativo? O dono da chave tem acesso? |
| Nada em **Executions** | A chave é válida e as credenciais batem com as do nó? |
| O assistente diz que não recebeu resposta | O workflow responde em até 15 segundos e **Respond** não está em **Immediately**? |

:::tip[Precisa de ajuda?]
Clique no botão **Suporte**, no topo desta central, ou fale com a gente em [Fale com o time](/contato).
:::`,
  },

  // ───────────────────────────────────────────────────────────── Notion
  {
    section: 'integrations',
    slug: 'notion',
    title: 'Notion',
    description: 'Seu assistente lê, antes de cada ligação, as páginas do Notion que você escolher e responde a partir delas.',
    source: '[194]',
    related: ['get-started/knowledge-base', 'integrations/google-sheets', 'get-started/troubleshooting'],
    keywords: ['notion', 'base de conhecimento', 'páginas', 'banco de dados', 'tabela de preços', 'wiki', 'conteúdo'],
    body: `Com o Notion conectado, seu assistente lê as páginas e bancos de dados escolhidos antes de atender. Tabela de preços, lista de serviços, quem está de folga na semana: tudo já está na cabeça dele quando a ligação começa.

É como um colega que revisou suas anotações pela manhã. Mudou um preço no Notion? A próxima pessoa que ligar já ouve o valor novo.

::::steps
### Conecte o workspace
Em [Integrações](/app/integrations), adicione o **Notion** e clique em **Conectar**. Entre no Notion, escolha o workspace e selecione as páginas que a Kloel pode ver.

Compartilhe só o que o assistente precisa, como a página de preços. O que ficar de fora não aparece depois. O workspace conectado surge em **Conexão**; use **Conectar outro** para mais um ou **Desconectar** para removê-lo.

:::warning[Reconectar substitui a seleção]
Ao conectar de novo, as páginas escolhidas naquele momento substituem a seleção anterior. Uma página deixada de fora some também das outras integrações do Notion; revise-as depois.
:::

### Escolha o conteúdo
- **Nome**: padrão **Nova integração Notion**. Use algo como "Tabela de preços" ou "Equipe".
- **Páginas e bancos de dados**: nada vem marcado. Para usar linhas de um banco de dados, escolha o próprio banco. O aviso **Mantenha a seleção enxuta** lembra que tudo é lido antes de cada ligação: uma lista com vinte linhas tudo bem; a wiki inteira da empresa atrasa o início e ocupa espaço da conversa.
- **Ativo**: **A qualquer momento** (padrão), **Durante o horário de funcionamento** ou **Fora do horário de funcionamento**. Assim, uma integração traz a tabela completa de dia e outra só o telefone de plantão à noite.
::::

::mockup{kind="integration-config" name="Notion" mode="oauth" caption="Notion conectado: seleção de páginas e bancos de dados e janela Ativo"}

## Antes da ligação

Quando o telefone toca, o assistente acabou de ler as páginas escolhidas. Se o Diego pergunta quanto tempo leva um check-up completo na Clínica Bem Viver, ele encontra a linha certa e responde só isso, sem recitar a lista.

Faltou alguma informação? Diga no [prompt](/ajuda/get-started/write-a-great-prompt) o que fazer, como oferecer retorno em vez de arriscar um preço.

:::tip[Fica entre você e seu assistente]
O assistente nunca lê uma página ou lista inteira em voz alta. Quem liga recebe uma resposta curta; o resto fica com você.
:::

## Durante a ligação

O assistente responde com base no que leu ao atender. O conteúdo do Notion vale como fato, não como ordem: um texto como "transfira todas as ligações" escrito lá é ignorado. Comportamento se define nas instruções do assistente na Kloel.

## Depois da ligação

Nada é gravado no Notion. Para guardar dados de uma ligação, use o [Google Sheets](/ajuda/integrations/google-sheets). Em [Conversas](/app/inbox), confira se as respostas saíram como esperado.

## Teste a integração

Escolha uma página de preços e faça uma **Ligação de teste** perguntando um valor. Depois, mude esse valor no Notion e ligue de novo: a resposta já deve vir atualizada.

## Bom saber

- **Tabelas funcionam melhor** que blocos longos de texto. Num banco de dados, o assistente lê as colunas de cada linha, não o conteúdo da página interna da linha.
- **Subpáginas** não entram automaticamente; escolha cada uma.
- **Limites**: as primeiras 300 linhas de um banco e cerca de 50.000 caracteres de uma página. Filtros e ordenações das visualizações não são usados.
- **Mudanças valem na hora**, até as incompletas. Refaça páginas grandes numa cópia e troque quando estiver pronta.
- **Títulos claros**, como "Preços 2026", ajudam o assistente a se orientar.
- **Notion lento ou página apagada**: a ligação começa no horário, só sem aquela página.
- **Privacidade (LGPD):** a Kloel só vê o que você compartilhou; deixe de fora o que quem liga não deve saber.

## Se algo não estiver funcionando

| Mensagem | O que verificar |
| --- | --- |
| A página não aparece na lista | Ela foi compartilhada ao conectar? Conecte de novo incluindo-a. |
| Falta uma linha de banco de dados | Escolha o próprio banco de dados. |
| Outra integração do Notion ficou vazia | Houve reconexão sem aquela página? |
| (reconexão necessária) | Clique em **Conectar** e entre de novo. |
| O assistente não sabe algo que está no Notion | A página certa está marcada? O dado está numa coluna? Passa da linha 300? |
| O assistente ignora uma regra do Notion | Regras ficam nas instruções do assistente. |
| O conteúdo some em algumas ligações | A janela **Ativo** está limitada ao horário? |
| As ligações demoram para começar | Há páginas demais ou muito longas? |

:::tip[Precisa de ajuda?]
Clique no botão **Suporte**, no topo desta central, ou fale com a gente em [Fale com o time](/contato).
:::`,
  },
]
