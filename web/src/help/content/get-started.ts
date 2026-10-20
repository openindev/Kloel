import type { HelpArticle } from './types'

/**
 * Central de ajuda — aba "Começar" (section 'get-started').
 * Fontes: notas [219]–[227] (reescritas e adaptadas para a Kloel / Brasil).
 */
export const GET_STARTED_ARTICLES: HelpArticle[] = [
  /* ------------------------------------------------------------------ [219] */
  {
    section: 'get-started',
    slug: 'first-steps',
    title: 'Primeiros passos',
    description: 'Um roteiro curto para criar, testar e colocar no ar o seu primeiro assistente da Kloel.',
    source: '[219]',
    related: ['get-started/write-a-great-prompt', 'get-started/connect-your-number', 'actions/call-transfer', 'get-started/knowledge-base'],
    keywords: ['começar', 'onboarding', 'criar assistente', 'configuração inicial', 'primeiro assistente', 'tutorial'],
    body: `Este guia leva você do zero até um assistente atendendo ligações reais. Cada etapa tem um artigo próprio com mais detalhes; aqui ficam só as decisões essenciais, na ordem em que vale a pena tomá-las.

Ao final você terá um assistente com voz, conhecimento sobre a sua empresa, um número de telefone e pelo menos um recurso ativo, como transferência de ligação ou envio de e-mail.

## 1. Crie seu primeiro assistente

Abra [Assistentes](/app/agents) e clique em **+** (ou em **Novo assistente**, no seletor do topo). Na janela **Criar assistente**, escolha o tipo:

- **Assistente de voz**: atende e faz ligações telefônicas.
- **Assistente de chat**: conversa pelo [WhatsApp](/app/whatsapp) ou pelo Chatbot de IA do seu site.

Dê um nome, por exemplo "Roberta", e confirme em **Criar assistente**. O novo assistente passa a aparecer no seletor do topo, com as abas **Geral**, **Regras**, **Conhecimento**, **Prompt personalizado** e **Técnico**.

### 1.1 Geral

::mockup{kind="agent-general" caption="Aba Geral da Roberta: nome, voz, idioma e mensagem inicial"}

Na aba **Geral** você define a identidade básica do assistente:

- **Voz**: ouça algumas amostras antes de decidir. Em atendimento, vozes calmas costumam agradar mais.
- **Idioma**: use o idioma da maioria de quem liga, normalmente Português (Brasil). Veja [Idiomas e multilinguismo](/ajuda/get-started/languages).
- **Mensagens iniciais**: é a primeira frase da ligação. Seja breve: saudação, nome da empresa e uma pergunta aberta.

:::tip[Uma saudação para cada situação]
Ative **Personalizar** e use a engrenagem para criar mensagens iniciais com condições, por exemplo para chamar pelo nome quem já está nos seus [Contatos](/ajuda/get-started/contacts).
:::

### 1.2 Regras

Regras são comportamentos que valem em todas as conversas. O bloco **Sistema** já vem ativo (respostas curtas, perguntas objetivas, tom educado). Em **Suas regras** você ajusta, entre outros, o **Aviso de IA** (se e quando o assistente diz que é uma IA) e o **Estilo de comunicação**.

Para algo específico do seu negócio, use **Adicionar regra própria**: escreva a **Condição** como uma frase que começa com "Se..." e, na **Instrução**, o que o assistente deve fazer.

#### Pronúncia

Marcas, ruas e sobrenomes às vezes saem estranhos. Em **Regras → Pronúncia**, informe a palavra e como ela deve soar. A transcrição fonética (AFI) deixa a pronúncia sempre igual:

~~~text
Kloel = /kloˈɛw/
~~~

### 1.3 Conhecimento

Na aba **Conhecimento**, abra **Informações da empresa** e clique em **Gerar automaticamente a partir do seu site**. A Kloel lê as páginas e monta um texto-base para você revisar. Em **Adicionar fonte** você também importa outros sites ou envia PDFs. Dessas fontes surgem sugestões de perguntas e respostas na aba **Informações**; para corrigir uma, clique no texto, ajuste e salve.

:::warning[Cadastre o horário de funcionamento]
Use o link **Horário de funcionamento** no topo da aba. Transferências, e-mails e outras ações podem usar esse horário para saber se a empresa está aberta.
:::

Os detalhes estão em [Base de conhecimento](/ajuda/get-started/knowledge-base).

### 1.4 Prompt personalizado

O prompt descreve o papel do assistente, o fluxo da conversa e em que momento cada recurso deve ser usado (transferir, enviar e-mail, agendar). Prefira um texto curto e organizado em seções. O passo a passo, com modelos por setor, está em [Como escrever um ótimo prompt](/ajuda/get-started/write-a-great-prompt).

### 1.5 Técnico

A aba **Técnico** reúne gravação de áudio, duração máxima, velocidade da fala, sensibilidade a ruídos e outros ajustes finos. Para começar, os valores padrão bastam. Veja [Configurações técnicas](/ajuda/get-started/technical).

:::info[Teste antes de publicar]
O botão **Ligação de teste** abre uma conversa pelo navegador, sem precisar de número. Repita o teste a cada mudança importante.
:::

## 2. Conecte um número de telefone

Sem número, o assistente só conversa na ligação de teste. O caminho mais rápido:

::::steps
### Adicione um número
No menu **Mais**, abra [Números de telefone](/app/phone-numbers), clique em **Adicionar número** e escolha um número disponível.
### Atribua ao assistente
Vincule o número à Roberta (ou ao assistente que você criou).
### Ligue para testar
Ligue do seu celular para o novo número e converse com o assistente.
### Desvie o número que você já usa
Configure um desvio de chamadas do número comercial que seus clientes conhecem para o número da Kloel.
::::

O widget abaixo monta o código de desvio para celular com o seu número Kloel:

::mockup{kind="call-forwarding" caption="Escolha o tipo de desvio e copie o código pronto para o seu celular"}

Números SIP, importação de número e centrais telefônicas estão em [Números de telefone](/ajuda/get-started/connect-your-number).

## 3. Ative os recursos

Recursos são o que permite ao assistente agir antes, durante e depois da ligação: transferir, mandar mensagem, marcar horário. Eles ficam na seção **Recursos** da aba **Geral**, e cada cartão abre uma folha lateral de configuração.

::mockup{kind="agent-resources" highlight="transfer" caption="Seção Recursos com o cartão Transferir ligações em destaque"}

:::warning[O prompt sozinho não executa ações]
Escrever "transfira para o financeiro" no prompt não basta. A ação só acontece depois que o recurso correspondente estiver configurado e salvo.
:::

### 3.1 Transferir ligações

Defina para quem transferir e em que situação, por exemplo "quando a pessoa pedir para falar com o financeiro". Para testar, use primeiro o seu próprio celular como destino. Mais em [Transferência de chamadas](/ajuda/actions/call-transfer).

### 3.2 Enviar e-mail

Ideal quando a IA faz o primeiro atendimento e o caso precisa chegar a alguém da equipe. Você escolhe quando o e-mail sai (durante ou depois da ligação), para quem e em que condição, e monta o texto com variáveis captadas na conversa, como nome e motivo do contato. Assim nenhum pedido se perde. Veja [E-mail](/ajuda/actions/email).

### 3.3 WhatsApp e SMS

O cartão **Enviar WhatsApp** manda uma mensagem para quem ligou, com um endereço, um link ou um resumo do que foi combinado. Veja [Mensagens de WhatsApp](/ajuda/actions/whatsapp-messages).

### 3.4 Agendar compromissos

O assistente consulta a disponibilidade e marca horários no [Agendador](/app/scheduling) da Kloel ou em uma agenda conectada (Calendly, Cal.com, Google ou Microsoft). Crie tipos de evento com duração e regras próprias e mantenha um link de agendamento como plano B, para quando o horário não puder ser fechado na ligação. Veja [Agendamentos](/ajuda/actions/appointments).

### 3.5 Pesquisa na web, integrações e webhooks

**Pesquisa na web** permite consultar o seu site durante a conversa. **Integrações** levam os dados para planilhas, CRMs e ferramentas de automação, e **Webhooks** enviam o resultado da conversa para o seu próprio sistema. Estas são as integrações nativas, cada uma com seu guia:

::tiles{group="integrations"}

## Configuração básica concluída

Pronto: o assistente já atende, responde com base no que sabe sobre a sua empresa e executa ações. Acompanhe as primeiras conversas em [Conversas](/app/inbox) e ajuste o prompt e a base conforme o que aparecer.

:::cards
- [Como escrever um ótimo prompt](/ajuda/get-started/write-a-great-prompt) Estrutura, regras Se/Então e modelos por setor.
- [Análises](/ajuda/get-started/analytics) Filtre conversas e acompanhe o consumo.
- [Solução de problemas](/ajuda/get-started/troubleshooting) Encontre a causa pelo sintoma.
:::

:::tip[Precisa de ajuda?]
Clique em **Suporte** no topo desta central ou [fale com o time](/contato).
:::`,
  },

  /* ------------------------------------------------------------------ [220] */
  {
    section: 'get-started',
    slug: 'connect-your-number',
    title: 'Números de telefone',
    description: 'Como adicionar um número da Kloel, atribuí-lo ao assistente e desviar para ele as ligações do número que você já usa.',
    source: '[220]',
    related: ['phone-numbers/import-number', 'phone-systems/sip-numbers', 'phone-numbers/pbx', 'get-started/first-steps'],
    keywords: ['número', 'desvio de chamadas', 'encaminhamento', 'redirecionar ligações', 'DDD', 'operadora', 'celular'],
    body: `Para atender ligações de verdade, o assistente precisa de um número de telefone. Você pode divulgar esse número diretamente ou, se preferir, manter o número que todo mundo já conhece e desviar as ligações dele para o número da Kloel.

A quantidade de números incluída varia conforme o plano (veja [Planos](/planos)); números adicionais podem ser contratados em [Faturamento](/app/billing).

| Opção | Para que serve | Onde ler |
|---|---|---|
| Número da Kloel | Receber ligações e falar com o assistente | Este artigo |
| Importar o seu número | Exibir o número da sua empresa em ligações de saída (a partir do plano Team) | [Importar um número](/ajuda/phone-numbers/import-number) |
| Números SIP | Ligar a central telefônica (PABX) que você já usa | [Números SIP](/ajuda/phone-systems/sip-numbers) |

## Adicionar um número da Kloel

::mockup{kind="phone-numbers" caption="Números de telefone: lista de números e o assistente atribuído a cada um"}

::::steps
### Abra Números de telefone
No menu **Mais**, abra [Números de telefone](/app/phone-numbers) e clique em **Adicionar número**.
### Escolha o tipo
Decida entre contratar um número novo ou conectar um número SIP que você já tem.
### Selecione o país
Escolha Brasil (ou outro país disponível) e, quando houver opção, o DDD que faz sentido para seus clientes.
### Atribua a um assistente
Vincule o número ao assistente que vai atender. Também dá para fazer isso pelo botão **Atribuir número**, dentro do próprio assistente.
### Ligue para testar
Ligue de outro aparelho. Se o assistente atender, o número está pronto.
::::

## Desviar o número que você já usa

:::warning[O desvio é feito fora da Kloel]
Quem ativa o desvio é a sua operadora, o seu aparelho ou a sua central (PABX). Por isso o nosso time não consegue ligá-lo por você nem enxergar se ele está ativo; o que conseguimos confirmar é se a ligação chegou à Kloel.
:::

::::steps
### Copie o número do assistente
Em [Números de telefone](/app/phone-numbers), copie o número atribuído ao assistente.
### Configure conforme o tipo de linha
- **Celular**: digite o código de desvio no próprio aparelho (veja a tabela) ou use o menu de chamadas do telefone.
- **Fixo ou VoIP**: use o app, a área do cliente ou a central de atendimento da operadora.
- **PABX**: crie a regra de desvio na própria central; em geral ela permite regras por horário.
### Escolha quando desviar
Sempre, só quando você não atender ou só quando a linha estiver ocupada.
::::

### Códigos de desvio para celular

::mockup{kind="call-forwarding" caption="Widget interativo: escolha o tipo de desvio e copie o código com o número da Kloel"}

| Tipo de desvio | Ativar | Desativar |
|---|---|---|
| Todas as ligações, na hora | \`*21*NÚMERO#\` | \`#21#\` |
| Quando você não atende | \`*61*NÚMERO#\` | \`#61#\` |
| Quando a linha está ocupada | \`*67*NÚMERO#\` | \`#67#\` |
| Aparelho desligado ou sem sinal | \`*62*NÚMERO#\` | \`#62#\` |
| Cancelar todos os desvios | \`##002#\` | não se aplica |

Troque NÚMERO pelo número da Kloel sem espaços nem hífens. Exemplo: para +55 11 90000-0123, digite \`*21*+5511900000123#\`.

:::info[Cada operadora tem suas regras]
Esses são os códigos padrão da rede celular. Algumas operadoras pedem o número com 0, código de operadora e DDD, exigem liberar o serviço antes ou cobram a ligação desviada como uma chamada sua. Em linhas fixas e VoIP o caminho costuma ser o app ou a área do cliente. Se o código não funcionar, consulte a sua operadora.
:::

:::tip[Desvio só fora do horário]
A Kloel não liga nem desliga o desvio por horário. Para desviar só à noite ou nos fins de semana, crie a regra na central ou com a operadora. A alternativa mais simples é desviar tudo e deixar o assistente atender sempre, transferindo para a equipe quando o horário de funcionamento permitir.
:::

## Testar o desvio

::::steps
### Ative e aguarde
Depois de ativar o desvio, espere um ou dois minutos.
### Ligue para o número antigo
Use outro telefone. Se o desvio for do tipo "quando não atender", deixe tocar sem atender.
### Confira o resultado
Se o assistente atender, está funcionando. Se não, procure a ligação em [Conversas](/app/inbox): sem registro, o desvio ainda não está ativo (fale com a operadora); com registro mas sem atendimento, chame o nosso time.
::::

## Perguntas frequentes

:::faq[Posso manter o meu número atual?]
Sim, você não precisa trocar o número comercial. Há quatro formas de usar o assistente com ele: desvio imediato (todas as ligações vão para o assistente), com atraso (ele atende se você não atender), quando ocupado e fora do horário (este último configurado na operadora ou no PABX). Quem já tem central também pode conectá-la direto por [SIP](/ajuda/phone-systems/sip-numbers).
:::

:::faq[Continuo ligando para clientes pelo meu número?]
Sim. O desvio só afeta as ligações recebidas; as de saída continuam pela sua linha. Para que o assistente faça ligações exibindo o número da sua empresa, é preciso [importar o número](/ajuda/phone-numbers/import-number).
:::

:::faq[Quem configura o desvio?]
Você, sozinho ou com ajuda da operadora. A Kloel fornece o número de destino e mostra em Conversas se a chamada chegou.
:::

:::faq[Posso usar a Kloel como central telefônica?]
Sim, com a [central telefônica (PBX)](/ajuda/phone-numbers/pbx): ramais, caixa postal, roteamento para a equipe e telefone no navegador, com o assistente fazendo parte da central.
:::

:::tip[Precisa de ajuda?]
Clique em **Suporte** no topo desta central ou [fale com o time](/contato).
:::`,
  },

  /* ------------------------------------------------------------------ [221] */
  {
    section: 'get-started',
    slug: 'write-a-great-prompt',
    title: 'Como escrever um ótimo prompt',
    description: 'As regras práticas, o construtor interativo e modelos por setor para escrever um prompt que funciona ao telefone.',
    source: '[221]',
    related: ['get-started/knowledge-base', 'get-started/first-steps', 'get-started/languages', 'get-started/troubleshooting'],
    keywords: ['prompt', 'instruções', 'prompt personalizado', 'roteiro de atendimento', 'modelo de prompt', 'persona', 'script'],
    body: `O prompt é o roteiro do assistente: diz quem ele é, como conduz a conversa e o que fazer em cada situação. Um prompt claro evita a maior parte dos comportamentos estranhos antes mesmo de eles aparecerem.

Você edita o texto em [Assistentes](/app/agents) → escolha o assistente → aba **Prompt personalizado**. O editor aceita textos longos (até 100.000 caracteres), mas, como você vai ver abaixo, menos é mais.

::mockup{kind="agent-prompt" caption="Aba Prompt personalizado com o editor e o contador de caracteres"}

## As 5 regras de um bom prompt

### 1. Dê um nome e um papel ao assistente

O assistente precisa saber para quem trabalha, qual é a função dele e com que tom deve falar.

:::danger[✗ Genérico]
"Atenda o telefone da clínica."
:::

:::tip[✓ Específico]
"Você é a Roberta, recepcionista virtual da Clínica Bem Viver. Fala de forma acolhedora e objetiva e trata o paciente por 'você'."
:::

### 2. Organize em seções com títulos

Títulos ajudam o modelo a separar contexto, passos e exceções, e fazem cada instrução ser seguida com mais consistência. Um esqueleto que funciona bem:

~~~markdown
## Papel
## Fluxo da conversa
## Regras Se/Então
## Pontos importantes
~~~

### 3. Escreva as decisões como "Se... então..."

Toda bifurcação da conversa vira uma regra explícita. Assim o assistente não precisa adivinhar o que você quer.

| Se... | Então... |
|---|---|
| a pessoa disser que é urgente | transfira imediatamente para o plantão |
| perguntarem o valor de um procedimento | diga que a equipe envia a tabela por WhatsApp após a ligação |
| pedirem para falar com o financeiro | transfira para o financeiro |

### 4. Diga o que fazer, não só o que evitar

Uma lista de proibições deixa o assistente sem saída. Troque cada "não faça" por uma ação concreta.

:::danger[✗ Só proibições]
"Não fale de preços. Não prometa retorno."
:::

:::tip[✓ Ação clara]
"Se perguntarem preços, diga: 'Vou pedir para a equipe te mandar a tabela atualizada por WhatsApp ainda hoje.'"
:::

### 5. Fique abaixo de 300 palavras

Mais texto não significa mais qualidade. Com instruções demais, cresce a chance de o assistente pular ou misturar pontos. Mantenha só o que muda o comportamento; os fatos (preços, endereços, horários) ficam na [Base de conhecimento](/ajuda/get-started/knowledge-base).

:::info[Prompt ou regra?]
O que vale para todas as conversas, como avisar que é uma IA ou o estilo de comunicação, pode ficar na aba **Regras**. Ali você também cria uma **regra própria**, com **Condição** ("Se...") e **Instrução**. Deixe o prompt para o fluxo específico do seu atendimento.
:::

## Construtor de prompt

Não sabe por onde começar? Escolha o setor, o nome do assistente e o tom de voz: o construtor monta um rascunho já estruturado, que você copia e cola na aba **Prompt personalizado** para então ajustar.

::mockup{kind="prompt-builder" caption="Construtor de prompt: escolha setor, nome e tom e copie o rascunho gerado"}

## Modelos por setor

Os modelos abaixo seguem as cinco regras e servem como ponto de partida. Escolha a aba mais parecida com o seu negócio, copie e adapte à sua realidade.

:::warning[Antes de colar]
Troque todos os campos entre colchetes, como [empresa] e [nome do assistente], pelos dados reais. Transferências, e-mails, mensagens de WhatsApp e agendamentos citados no texto só funcionam se os recursos correspondentes estiverem configurados na seção **Recursos** do assistente: o prompt diz *quando* agir, mas não cria nem executa a ação sozinho.
:::

::::tabs
:::tab[Clínica e saúde]
Cenários: nova consulta, remarcação, resultado de exames, urgência e dúvidas gerais.

~~~text
# Papel
Você é [nome do assistente], recepcionista virtual da [empresa]. Fala com calma e acolhimento, em frases curtas.

# Fluxo da conversa
## Nova consulta
Se a pessoa quiser marcar consulta, pergunte a especialidade, se é particular ou convênio (e qual), o período preferido, o nome completo e a data de nascimento. Ofereça os horários livres e confirme o escolhido.
## Remarcar ou cancelar
Se quiser remarcar ou cancelar, pergunte o nome, a data de nascimento e a data da consulta atual. Ofereça novas opções ou confirme o cancelamento.
## Resultado de exames
Se perguntar sobre resultado, não comente valores nem diagnósticos. Anote o nome e o exame e informe que a equipe retorna em até [prazo].
## Urgência
Se a pessoa relatar dor no peito, falta de ar, desmaio ou outro sinal grave, oriente ligar agora para o 192 (SAMU) e encerre com cordialidade.
## Dúvidas gerais
Para endereço, horários, convênios aceitos e preparo de exames, use somente a base de conhecimento.

# Pontos importantes
Nunca dê orientação médica. Peça apenas os dados necessários para o agendamento.
~~~

Variáveis sugeridas para e-mail: \`{{nome}}\`, \`{{data_nascimento}}\`, \`{{especialidade}}\`, \`{{convenio}}\`, \`{{telefone_retorno}}\`
:::
:::tab[Imobiliária]
Cenários: interesse em imóvel anunciado, captação para venda ou locação, inquilino com problema e questões administrativas.

~~~text
# Papel
Você é [nome do assistente], assistente virtual da [empresa], imobiliária em [cidade]. Fala de forma cordial e prática.

# Fluxo da conversa
## Interesse em imóvel
Se a pessoa ligar por um anúncio, pergunte o código ou o endereço do imóvel, se é para compra ou locação, o nome e o melhor horário para retorno. Se quiser visitar, ofereça os horários disponíveis.
## Quero vender ou alugar
Se a pessoa quiser anunciar um imóvel, pergunte o tipo, o bairro, a metragem aproximada e o nome. Informe que um corretor vai entrar em contato para a avaliação.
## Inquilino com problema
Se for inquilino, pergunte o endereço, o que aconteceu e se há risco (vazamento, falta de energia). Havendo risco, transfira para [plantão de manutenção]; se ninguém atender, registre como urgente.
## Boletos e contratos
Se a dúvida for sobre boleto, reajuste ou contrato, anote o endereço do imóvel e a dúvida e transfira para o administrativo.
## Dúvidas gerais
Responda usando somente a base de conhecimento.
~~~

Variáveis sugeridas para e-mail: \`{{nome}}\`, \`{{codigo_imovel}}\`, \`{{finalidade}}\`, \`{{bairro}}\`, \`{{urgencia}}\`, \`{{telefone_retorno}}\`
:::
:::tab[Restaurante]
Cenários: reserva de mesa, alteração, grupos e eventos, delivery e cardápio.

~~~text
# Papel
Você é [nome do assistente], atendente virtual do [empresa]. Fala de forma simpática e ágil.

# Fluxo da conversa
## Reserva
Se quiserem reservar, pergunte a data, o horário, o número de pessoas, se há criança ou necessidade de acessibilidade e o nome. Confirme repetindo os dados.
## Alterar ou cancelar
Se quiserem alterar ou cancelar, pergunte o nome e a data da reserva e faça a mudança.
## Grupos e eventos
Se for grupo acima de [número] pessoas ou evento fechado, pergunte a data, a quantidade, a ocasião e o nome e informe que a equipe de eventos retorna.
## Delivery
Se quiserem pedir para entrega, explique como pedir conforme a base de conhecimento e, se a pessoa quiser, envie o link de pedido por WhatsApp.
## Dúvidas gerais
Para cardápio, alergênicos, estacionamento e horários, use somente a base de conhecimento.
~~~

Variáveis sugeridas para e-mail: \`{{nome}}\`, \`{{data}}\`, \`{{horario}}\`, \`{{pessoas}}\`, \`{{ocasiao}}\`, \`{{telefone_retorno}}\`
:::
:::tab[Academia]
Cenários: aula experimental, planos, alunos atuais (contrato, trancamento, mensalidade) e grade de aulas.

~~~text
# Papel
Você é [nome do assistente], assistente virtual da academia [empresa]. Fala com energia, sem exageros.

# Fluxo da conversa
## Aula experimental
Se a pessoa quiser conhecer a academia, pergunte a modalidade de interesse, o dia e o período preferidos e o nome. Agende a aula experimental.
## Planos e valores
Se perguntar sobre planos, explique as opções exatamente como estão na base de conhecimento e ofereça a aula experimental.
## Aluno atual
Se for aluno e o assunto for contrato, trancamento, cancelamento ou mensalidade, pergunte o nome completo e o motivo, registre o pedido e informe que a recepção retorna em até [prazo].
## Pessoa específica
Se pedir um professor ou o gerente, pergunte o motivo e tente resolver pela base de conhecimento. Se não der, registre o recado.
## Dúvidas gerais
Para horário de funcionamento e grade de aulas, use somente a base de conhecimento.
~~~

Variáveis sugeridas para e-mail: \`{{nome}}\`, \`{{modalidade}}\`, \`{{assunto}}\`, \`{{telefone_retorno}}\`
:::
:::tab[Oficina e serviços]
Cenários: agendamento, orçamento, status do serviço e socorro.

~~~text
# Papel
Você é [nome do assistente], assistente virtual da [empresa], oficina especializada em [especialidade]. Fala de forma direta e prestativa.

# Fluxo da conversa
## Agendar serviço
Se a pessoa quiser revisão ou reparo, pergunte o modelo e o ano do veículo, a placa, o que precisa ser feito, o período preferido e o nome. Agende no primeiro horário que a pessoa aceitar.
## Orçamento
Se pedir orçamento, pergunte o veículo e o problema. Explique que o valor só sai depois da avaliação e ofereça agendá-la.
## Status do serviço
Se perguntar se o carro está pronto, pergunte a placa e o nome e transfira para [responsável pela oficina]. Se ninguém atender, registre o pedido de retorno.
## Socorro
Se o veículo estiver parado na rua, pergunte a localização, a placa e um telefone para retorno e registre como urgente.
## Dúvidas gerais
Para endereço, horários e formas de pagamento, use somente a base de conhecimento.
~~~

Variáveis sugeridas para e-mail: \`{{nome}}\`, \`{{placa}}\`, \`{{veiculo}}\`, \`{{servico}}\`, \`{{urgencia}}\`, \`{{telefone_retorno}}\`
:::
:::tab[Advocacia]
Cenários: cliente com processo em andamento, novo caso, agendamento e perguntas jurídicas.

~~~text
# Papel
Você é [nome do assistente], assistente virtual do escritório [empresa]. Fala de forma formal, clara e discreta.

# Fluxo da conversa
## Cliente atual
Se for cliente, pergunte o nome completo e o número do processo ou o assunto e transfira para [advogado responsável]. Se ninguém atender, registre o recado e informe o prazo de retorno.
## Novo caso
Se for um primeiro contato, pergunte a área (trabalhista, família, cível, empresarial etc.), um resumo breve da situação, o nome e o telefone. Informe que um advogado retorna para uma conversa inicial.
## Agendar reunião
Se quiser agendar, pergunte o assunto, o formato (presencial ou online) e o período preferido e faça o agendamento.
## Pergunta jurídica
Se fizerem uma pergunta jurídica, não dê orientação. Registre a dúvida e informe que um advogado vai retornar.
## Dúvidas gerais
Para endereço, horários e áreas de atuação, use somente a base de conhecimento.

# Pontos importantes
Trate tudo como confidencial. Nunca confirme a terceiros se alguém é cliente do escritório.
~~~

Variáveis sugeridas para e-mail: \`{{nome}}\`, \`{{area}}\`, \`{{numero_processo}}\`, \`{{resumo}}\`, \`{{telefone_retorno}}\`
:::
:::tab[Contabilidade]
Cenários: cliente atual, documentos e prazos, novo cliente e dúvidas fiscais.

~~~text
# Papel
Você é [nome do assistente], assistente virtual da [empresa], escritório de contabilidade. Fala de forma clara e organizada.

# Fluxo da conversa
## Cliente atual
Se for cliente, pergunte o nome da empresa ou o CNPJ e o assunto e transfira para [contador responsável]. Se ninguém atender, registre o recado.
## Documentos e prazos
Se ligar sobre guia de imposto, folha de pagamento, nota fiscal ou documento pendente, pergunte a empresa, o documento e o prazo e registre com a prioridade adequada.
## Novo cliente
Se for abertura de empresa ou troca de contador, pergunte o porte e o regime (MEI, Simples Nacional, Lucro Presumido etc.), o ramo, o número de funcionários e o nome. Informe que um contador retorna com uma proposta.
## Dúvida fiscal
Se fizerem uma pergunta tributária específica, não dê orientação. Registre a dúvida para o contador.
## Dúvidas gerais
Para horários, endereço e serviços oferecidos, use somente a base de conhecimento.
~~~

Variáveis sugeridas para e-mail: \`{{nome}}\`, \`{{empresa_cliente}}\`, \`{{documento}}\`, \`{{prazo}}\`, \`{{telefone_retorno}}\`
:::
:::tab[Salão e estética]
Cenários: agendamento, remarcação, preços e duração dos serviços.

~~~text
# Papel
Você é [nome do assistente], assistente virtual do [empresa]. Fala de forma leve e acolhedora.

# Fluxo da conversa
## Agendar
Se a pessoa quiser marcar, pergunte o serviço, se tem preferência de profissional, o dia, o período e o nome. Ofereça os horários livres e confirme.
## Remarcar ou cancelar
Se quiser remarcar ou cancelar, pergunte o nome e o horário atual e ofereça novas opções. Lembre a política de cancelamento que está na base de conhecimento.
## Preços e duração
Se perguntar valores ou quanto tempo leva um serviço, responda exatamente como está na base de conhecimento.
## Dúvidas gerais
Para endereço, estacionamento e formas de pagamento, use somente a base de conhecimento.
~~~

Variáveis sugeridas para e-mail: \`{{nome}}\`, \`{{servico}}\`, \`{{profissional}}\`, \`{{horario_preferido}}\`, \`{{telefone_retorno}}\`
:::
::::

## Evite respostas inventadas

O assistente deve falar apenas o que você disponibilizou. Quatro cuidados resolvem a maior parte dos casos:

::::steps
### Fatos na base, comportamento no prompt
Preços, horários, endereços, descrição de serviços e textos padrão ficam na [Base de conhecimento](/ajuda/get-started/knowledge-base). O prompt descreve como agir.
### Diga de onde vêm as respostas
Inclua no prompt uma instrução explícita, como esta:
~~~text
Para qualquer informação sobre a empresa, use apenas a base de conhecimento. Se não encontrar a resposta, diga: "Essa informação eu não tenho agora, mas vou pedir para alguém da equipe te retornar." Nunca deduza nem invente detalhes.
~~~
### Repita dados exatos sem mexer
Peça que preços, telefones, e-mails e horários sejam ditos exatamente como estão cadastrados, sem arredondar, resumir ou reformular.
### Proteja dados sensíveis
O assistente não deve mencionar por conta própria dados de clientes, endereços de obras ou contatos pessoais da equipe. Só informe algo assim se a pessoa pedir e se a informação estiver cadastrada para ser compartilhada, respeitando a LGPD.
::::

## Prompt vindo de um chat de texto? Adapte

:::warning[Telefone não é chat]
Prompts criados em ferramentas de conversa por texto costumam ser longos, cheios de listas e formatação, e esperam respostas extensas. Numa ligação, as falas são curtas e a pessoa não vê nada na tela. Encurte, transforme listas em regras Se/Então e retire instruções de formatação, como negrito, emojis ou tabelas.
:::

## Revise as frases entre aspas

Tudo o que aparece entre aspas tende a ser falado ao pé da letra. Releia o prompt de tempos em tempos e apague nomes antigos, telefones desatualizados ou exemplos que não valem mais.

## Ações: a condição fica no recurso

O momento em que uma integração, um webhook ou um e-mail é disparado é definido na folha lateral do próprio recurso (seção **Recursos** da aba **Geral**), não no prompt. Ações durante a ligação usam a descrição e a condição configuradas no recurso; ações depois da ligação ficam nas configurações dele. O prompt cuida apenas da conversa. Se uma ação não dispara, veja [Solução de problemas](/ajuda/get-started/troubleshooting).

:::info[Teste cada mudança]
Depois de salvar, faça uma **Ligação de teste** simulando os cenários do prompt, inclusive os difíceis, como alguém irritado ou fugindo do assunto.
:::

:::tip[Precisa de ajuda?]
Clique em **Suporte** no topo desta central ou [fale com o time](/contato).
:::`,
  },

  /* ------------------------------------------------------------------ [222] */
  {
    section: 'get-started',
    slug: 'knowledge-base',
    title: 'Base de conhecimento',
    description: 'Como organizar informações, fontes e dados da empresa para que o assistente responda com precisão.',
    source: '[222]',
    related: ['get-started/write-a-great-prompt', 'actions/websearch', 'get-started/first-steps', 'get-started/troubleshooting'],
    keywords: ['conhecimento', 'FAQ', 'perguntas e respostas', 'PDF', 'site', 'fontes', 'informações da empresa', 'horário de funcionamento'],
    body: `A base de conhecimento é a memória factual do assistente. Quanto mais completa e bem escrita ela estiver, mais perguntas ele resolve sozinho, sem precisar transferir a ligação ou anotar recado.

Ela fica em [Assistentes](/app/agents) → escolha o assistente → aba **Conhecimento**, que se divide em duas abas: **Fontes** e **Informações**.

::mockup{kind="agent-knowledge" caption="Aba Conhecimento: fontes importadas, informações da empresa e entradas de perguntas e respostas"}

## As quatro peças

| Peça | O que você cadastra | Melhor para |
|---|---|---|
| **Informações** | Entradas curtas de pergunta e resposta | Dúvidas frequentes e respostas exatas |
| **Fontes** | Sites importados e documentos PDF | Conteúdo longo: catálogos, regulamentos, tabelas |
| **Informações da empresa** | Um texto livre com os dados essenciais | Endereço, equipe, serviços, políticas |
| **Pesquisa na web** | Consulta ao seu site durante a ligação | Dados que mudam muito, como estoque ou agenda de eventos |

A pesquisa em tempo real é um recurso do assistente; veja [Pesquisa na web](/ajuda/actions/websearch).

## 1. Crie entradas de informação

::::steps
### Abra a aba Informações
Clique em **Nova entrada**, no topo da lista.
### Escreva a pergunta como o cliente fala
Por exemplo, "Vocês atendem convênio?" em vez de "Política de convênios".
### Escreva uma resposta curta e inequívoca
Uma ou duas frases, com o dado exato.
### Salve
Use **Salvar** (⌘↵) ou **Salvar + novo** (⌘⇧↵) para já emendar a próxima entrada.
::::

:::tip[Uma pergunta por entrada]
Entradas curtas e separadas funcionam melhor do que um parágrafo com cinco assuntos. Se a mesma resposta serve para perguntas diferentes, pode repetir.
:::

Cada entrada indica a origem: o globo mostra que ela veio de um site importado, e o brilho, que foi gerada automaticamente. Um contador (por exemplo, "3×") mostra quantas vezes ela já foi usada em conversas, o que ajuda a descobrir o que mais perguntam.

## 2. Adicione fontes

Na aba **Fontes**, clique em **Adicionar fonte** e escolha:

- **Site**: informe a **URL do site** e clique em **Importar**. A Kloel lê as páginas e mostra quantas foram processadas.
- **Documentos**: preencha o **Nome do documento**, clique em **Selecionar documento** e envie.

:::warning[Requisitos do documento]
- Apenas PDF, com até 20 MB.
- O texto precisa ser selecionável; arquivos digitalizados (só imagem) não são lidos de forma confiável.
- Use nomes claros, como "Tabela de convênios 2026", para o assistente achar o conteúdo certo.
:::

Para remover uma fonte, use o menu **⋯** ao lado dela.

## 3. Preencha as informações da empresa

Na aba **Fontes**, abra **Informações da empresa** e clique em **Gerar automaticamente a partir do seu site** para criar um primeiro texto. Depois revise e complete: endereço e como chegar, equipe, serviços, formas de pagamento e políticas (cancelamento, atrasos). Tudo vai num único campo de texto livre.

Aproveite para configurar o **Horário de funcionamento** (link no topo da aba Conhecimento), no fuso de Brasília (America/Sao_Paulo). Transferências e outras ações podem depender dele.

## 4. Revise as sugestões

A partir dos sites e PDFs adicionados, a Kloel propõe novas entradas de pergunta e resposta. Elas se baseiam exclusivamente nas suas fontes e mostram de onde veio cada informação. Abra a sugestão, confira resposta e origem e então aceite, ajuste antes de salvar ou exclua se não fizer sentido para o seu negócio.

:::info[Por que vale a pena]
Você deixa de escrever cada entrada do zero e passa só a revisar. Reserve alguns minutos por semana para isso.
:::

## 5. Controle o que cada assistente usa

O conhecimento é configurado por assistente. Na aba **Conhecimento**, a chave **Base de conhecimento** liga ou desliga todo o conteúdo, e cada fonte pode ser ativada individualmente. Isso ajuda quando você tem, por exemplo, uma assistente para a recepção e outro para o financeiro, cada um com informações diferentes.

## Prompt ou base: o que vai onde?

| Vai no prompt | Vai na base de conhecimento |
|---|---|
| Papel, tom e fluxo da conversa | Horários, endereço e preços |
| Quando transferir, agendar ou enviar mensagem | Serviços, convênios e políticas |
| Regras Se/Então | Nomes e funções da equipe |

A regra prática: se a informação pode mudar ou precisa ser repetida com exatidão, ela vai para a base. Se descreve como o assistente fala ou age, vai para o [prompt](/ajuda/get-started/write-a-great-prompt).

## Checklist

- As perguntas mais comuns estão cadastradas como entradas.
- Conteúdos longos estão em PDFs legíveis ou em sites importados.
- Informações da empresa e horário de funcionamento estão completos e atualizados.
- As sugestões novas são revisadas com frequência.
- Cada assistente usa apenas as fontes relevantes para ele.

:::warning[O assistente não usa a base?]
1. A fonte está ativa para esse assistente?
2. A informação existe mesmo e está escrita como o cliente perguntaria?
3. O prompt manda usar só a base para dados da empresa? Veja [Como escrever um ótimo prompt](/ajuda/get-started/write-a-great-prompt).
:::

:::tip[Precisa de ajuda?]
Clique em **Suporte** no topo desta central ou [fale com o time](/contato).
:::`,
  },

  /* ------------------------------------------------------------------ [223] */
  {
    section: 'get-started',
    slug: 'languages',
    title: 'Idiomas e multilinguismo',
    description: 'Escolha o idioma e a voz do assistente e prepare-o para atender quem liga em outra língua.',
    source: '[223]',
    related: ['get-started/first-steps', 'get-started/write-a-great-prompt', 'get-started/technical', 'get-started/troubleshooting'],
    keywords: ['idioma', 'multilíngue', 'voz', 'inglês', 'espanhol', 'tradução', 'sotaque', 'pronúncia'],
    body: `O idioma define em que língua o assistente começa a conversa e como ele entende quem está do outro lado. Para a maioria das empresas brasileiras a escolha é simples, Português (Brasil), mas vale preparar o assistente para o turista, o cliente estrangeiro ou o fornecedor que liga falando outra língua.

Este artigo mostra onde ficam as opções, por que a mensagem inicial não muda de idioma e como evitar textos fixos na língua errada.

## 1. Defina idioma e voz

Em [Assistentes](/app/agents) → aba **Geral**, ajuste os campos **Idioma** e **Voz**.

::mockup{kind="agent-general" caption="Campos Voz e Idioma na aba Geral do assistente"}

- **Idioma**: escolha a língua da maioria das ligações. Evite deixar **Multi (todos os idiomas)** como padrão: quando quase todas as ligações são em um só idioma, a opção fixa entende melhor a fala.
- **Voz**: na lista de vozes, filtre pelo idioma desejado, ouça as amostras e salve.

:::info[Português ou Português (Brasil)?]
As duas opções existem. "Português (Brasil)" usa vocabulário e pronúncia brasileiros, enquanto "Português" pode soar europeu. Para clientes no Brasil, prefira a primeira.
:::

## 2. Permita a troca de idioma durante a ligação

:::warning[A troca não é automática]
O assistente nem sempre muda de idioma sozinho. Se você quer esse comportamento, peça de forma explícita no prompt.
:::

Escolha uma voz que soe natural em mais de um idioma e acrescente ao [prompt](/ajuda/get-started/write-a-great-prompt) uma instrução como esta:

~~~text
Se a pessoa falar em outro idioma, passe a usar esse idioma até o fim da ligação, inclusive nas perguntas e na despedida. Não pergunte se pode trocar: apenas troque.
~~~

Se você recebe muitas ligações em um idioma específico, como espanhol numa cidade de fronteira, pode valer criar um segundo assistente nesse idioma, com o próprio número.

## 3. A mensagem inicial não é traduzida

A mensagem inicial é um texto fixo: o assistente sempre a fala exatamente como foi escrita, seja qual for o idioma de quem liga. Por isso, prefira uma saudação curta e neutra, com o nome da empresa e uma pergunta. A troca de idioma acontece a partir da fala seguinte, seguindo a regra do prompt.

Se quiser saudações diferentes por público, use **Personalizar** nas **Mensagens iniciais** para criar mensagens com condições, por exemplo para contatos que você sabe que falam inglês. Veja [Contatos](/ajuda/get-started/contacts).

## 4. Textos padrão no idioma certo

Textos fixos de recursos e integrações, como e-mails, mensagens de WhatsApp e avisos de transferência, também não são traduzidos automaticamente. Escreva-os na língua que o destinatário entende.

O idioma da interface (menus e botões do app) é uma configuração separada: você o altera em [Conta](/app/account) → **Idioma**. Mudar a interface não muda o idioma dos assistentes, e vice-versa.

## 5. Pronúncia e sotaques

Nomes próprios, marcas e palavras estrangeiras podem sair estranhos. Duas ferramentas ajudam:

- **Regras → Pronúncia**: define como uma palavra deve ser falada, inclusive com transcrição fonética.
- **Técnico → Termos técnicos**: ajuda o reconhecimento de fala a entender nomes de ruas, bairros, produtos e sobrenomes. Veja [Configurações técnicas](/ajuda/get-started/technical).

::mockup{kind="agent-rules" caption="Aba Regras com a opção Pronúncia para nomes e termos difíceis"}

## Idiomas disponíveis

A mesma lista vale para o campo **Idioma** e para o filtro de vozes:

| Grupo | Idiomas |
|---|---|
| Português | Português (Brasil), Português |
| Inglês | Inglês, Inglês (americano), Inglês (britânico) |
| Europa ocidental | Alemão, Alemão suíço, Catalão, Espanhol, Francês, Holandês, Italiano |
| Europa do norte e Bálticos | Dinamarquês, Estoniano, Finlandês, Lituano, Norueguês, Sueco |
| Europa central, oriental e do sul | Búlgaro, Croata, Eslovaco, Esloveno, Grego, Húngaro, Polonês, Romeno, Russo, Sérvio, Tcheco, Ucraniano |
| Ásia e Oriente Médio | Árabe, Bengali, Cantonês, Chinês (mandarim), Coreano, Hindi, Japonês, Persa (farsi), Turco, Urdu |
| Automático | Multi (todos os idiomas) |

## Perguntas frequentes

:::faq[O assistente entende sotaques regionais?]
Em geral, sim. Se nomes locais pouco comuns, como bairros e sobrenomes, forem mal entendidos, cadastre-os em **Termos técnicos** para reduzir erros de transcrição.
:::

:::faq[Posso ter um assistente em português e outro em inglês no mesmo número?]
Cada número é atribuído a um assistente. Para atender em mais de uma língua pelo mesmo número, use a regra de troca de idioma no prompt; para separar por completo, use um número para cada assistente.
:::

:::tip[Precisa de ajuda?]
Clique em **Suporte** no topo desta central ou [fale com o time](/contato).
:::`,
  },

  /* ------------------------------------------------------------------ [224] */
  {
    section: 'get-started',
    slug: 'technical',
    title: 'Configurações técnicas',
    description: 'Os ajustes da aba Técnico: limites da ligação, gravação, áudio, criatividade, captura precisa de dados e interrupções.',
    source: '[224]',
    related: ['get-started/first-steps', 'get-started/languages', 'get-started/analytics', 'legal/protecao-de-dados'],
    keywords: ['técnico', 'gravação', 'duração máxima', 'silêncio', 'velocidade da fala', 'sensibilidade', 'temperatura', 'DTMF'],
    body: `A aba **Técnico** reúne os ajustes finos do assistente: quanto tempo uma ligação pode durar, se ela é gravada, como o assistente soa e reage a ruídos e com quanta liberdade ele formula as respostas. Os valores padrão atendem a maioria dos casos; se for mudar, altere um item por vez e teste.

Para chegar lá: [Assistentes](/app/agents) → escolha o assistente → **Técnico**. Ao alterar um campo, aparece uma barra com a quantidade de alterações pendentes; clique em **Salvar** para aplicar ou desfaça.

::mockup{kind="agent-technical" caption="Aba Técnico com duração máxima, gravação, sons ambiente e criatividade"}

:::info[Moderação sempre ativa]
O item **Guardrails e moderação de conteúdo** vem marcado e não pode ser desligado. Ele monitora as conversas para barrar violência, conteúdo sexual, assédio e discurso de ódio.
:::

## 1. Limites da ligação

- **Duração máxima da ligação** (em minutos): ao atingir o limite, a ligação é encerrada. Use como base a duração típica do seu atendimento mais uma folga; isso evita conversas que se arrastam e mantém o consumo de minutos sob controle.
- **Tempo máximo de espera** (em segundos): se a pessoa ficar em silêncio por esse tempo, o assistente encerra. Resolve o caso de quem esqueceu a ligação aberta.

Em [Conversas](/app/inbox), as ligações encerradas por esses limites aparecem com os resultados **Limite de tempo** e **Inatividade**.

## 2. Gravação

- **Gravar áudio**: cada ligação gera um arquivo de áudio, disponível por 30 dias para ouvir ou baixar na conversa.
- **Exclusão automática (recomendado)**: se a pessoa recusar a gravação, áudio e transcrição são apagados na hora e nenhuma extração nem ação pós-ligação é executada.

:::warning[Avise quem liga]
Se gravar, o assistente deve informar no início da conversa que a ligação está sendo gravada; coloque o aviso na mensagem inicial. Defina também no prompt o que fazer quando alguém recusar: encerrar com cordialidade ou transferir para uma pessoa. Para as obrigações da LGPD, veja [Proteção de dados](/ajuda/legal/protecao-de-dados).
:::

Na lista de conversas, as recusas aparecem com o resultado **Gravação recusada**.

## 3. Áudio e fala

- **Sons ambiente** e **Volume do som ambiente**: adicionam um fundo discreto, como ruído de escritório ou de digitação, para a ligação soar menos artificial. **Limpar seleção** volta para **Sem sons ambiente**.
- **Velocidade da fala** (de Lento a Rápido): comece perto do meio. Públicos mais velhos costumam preferir um ritmo um pouco mais lento.
- **Sensibilidade** (de Baixa a Alta): define com que facilidade o assistente é interrompido e reage a sons. Reduza se muita gente liga de lugares barulhentos (obra, rua, cozinha); aumente se as pessoas costumam falar baixo em ambientes silenciosos.

:::warning[Velocidade não é tempo de resposta]
A velocidade da fala muda apenas o ritmo com que o assistente fala; ela não faz a resposta ficar pronta mais cedo.
:::

## 4. Compreensão e respostas

### Termos técnicos

Cadastre palavras raras que o reconhecimento de fala pode confundir: nomes de produtos, ruas, bairros, profissionais ou sobrenomes. Digite e confirme com Enter. Exemplo: sem cadastro, quem diz "Itaquaquecetuba" com pressa pode virar uma sequência sem sentido na transcrição; com o termo salvo, o assistente associa o som à palavra certa.

### Criatividade (temperatura)

O controle vai de **Segue o prompt à risca** até **Muito criativo**.

| Nível | Comportamento | Indicado para |
|---|---|---|
| Baixo | Respostas previsíveis e fiéis ao prompt | Suporte, agendamentos, preços e horários |
| Médio | Natural, mas ainda estruturado | A maioria dos assistentes |
| Alto | Variado e espontâneo, menos previsível | Conversas abertas, marketing e ideias |

### Processamento preciso de informações

Para dados que não podem sair errados, como e-mail, telefone, CPF ou número do pedido, o assistente pode acionar por alguns instantes um modelo mais forte. A captura fica mais confiável e chega melhor ao CRM ou à integração, com menos retrabalho manual; em troca, a resposta nesse trecho fica um pouco mais lenta.

::::steps
### Localize a seção
Na aba **Técnico**, vá até **Processamento preciso de informações**.
### Adicione cada informação
Clique em **Adicionar informação** e preencha **Nome da informação ou gatilho** (letras sem acento, números, hífen e sublinhado) e um **Formato de exemplo**.
### Salve
Clique em **Salvar** na barra de alterações.
::::

~~~text
email     → maria.souza@exemplo.com.br
telefone  → +55 11 90000-0123
cpf       → 000.000.000-00
pedido    → 123456
~~~

### Rapidez de resposta

Escolha **Normal** ou **Paciente**. No modo paciente, o assistente espera um pouco mais antes de falar quando a pessoa faz pausas no meio da frase. Ajuda com idosos, em cuidados de saúde e com quem pensa em voz alta, ao custo de respostas um pouco mais lentas.

## 5. Opções avançadas

| Opção | O que faz | Cuidado |
|---|---|---|
| **Transferência livre de ligações** | Permite transferir para números descritos no prompt, além dos cadastrados no recurso | Restrinja bem, para que quem liga não consiga ditar o destino |
| **Envio de tons DTMF / discagem por tom** | O assistente digita tons durante a ligação, por exemplo para navegar no menu de outra central | Ative só se precisar |
| **Impedir interrupção da mensagem inicial** | A saudação é falada por inteiro, mesmo que a pessoa comece a falar | Bom para avisos obrigatórios, como o de gravação |
| **Impedir interrupções** | O assistente sempre termina a frase antes de ouvir | Pode soar menos natural em conversas longas |

:::tip[Precisa de ajuda?]
Clique em **Suporte** no topo desta central ou [fale com o time](/contato).
:::`,
  },

  /* ------------------------------------------------------------------ [225] */
  {
    section: 'get-started',
    slug: 'contacts',
    title: 'Contatos',
    description: 'Cadastre e importe contatos, reconheça quem já ligou e faça o assistente cumprimentar cada pessoa pelo nome.',
    source: '[225]',
    related: ['get-started/first-steps', 'get-started/analytics', 'phone-numbers/pbx', 'products/whatsapp'],
    keywords: ['contatos', 'CRM', 'importar CSV', 'saudação personalizada', 'bloquear número', 'campos inteligentes', 'E.164'],
    body: `Com os contatos, o assistente sabe quem está ligando: cumprimenta pelo nome, aproveita o que já sabe sobre a pessoa e adapta o atendimento. A área fica em **Mais** → [Contatos](/app/contacts).

::mockup{kind="contacts" caption="Lista de contatos com busca, importação e criação manual"}

## Criar contatos

### Um por um

Clique em **+**, no canto superior direito, e preencha:

- **Nome** e **Sobrenome**
- **Números de telefone**: escolha o país pela bandeira e o tipo do número; **Adicionar telefone** inclui outros.
- **Endereços de e-mail**: quantos forem necessários.
- **Empresa**: busque uma existente ou crie na hora.
- **Responsável**: a pessoa da equipe que cuida do contato.
- **Notas**: qualquer observação útil.

Depois, clique em **Salvar**.

:::warning[Telefones no formato internacional]
Salve sempre no padrão E.164: sinal de mais, código do país, DDD e número, sem espaços. Números com zero na frente ou sem o +55 muitas vezes não batem com o número de quem liga, e essa é a causa mais comum de a saudação personalizada falhar.
:::

~~~text
Correto: +5511900000123
Errado:  (011) 90000-0123
~~~

### Importar uma planilha (CSV)

Para muitos contatos, use **Importar**. O processo tem cinco etapas: **Envio**, **Mapear colunas**, **Revisão**, **Importando** e **Concluído**. O arquivo deve ser CSV em UTF-8, com linha de cabeçalho; na dúvida, baixe o **modelo CSV** na própria tela.

~~~csv
nome,sobrenome,telefone,email,empresa
Ana,Ribeiro,+5511900000101,ana.ribeiro@exemplo.com.br,Clínica Bem Viver
Carlos,Mendes,+5511900000102,carlos.mendes@exemplo.com.br,
~~~

No mapeamento, associe cada campo a uma coluna. Telefone e e-mail aceitam várias colunas, e pelo menos uma delas é obrigatória, porque é por elas que a Kloel identifica cada pessoa. Se o contato já existir, escolha **Manter existentes** (só preenche campos vazios) ou **Sobrescrever** (troca os valores atuais pelos do arquivo). Telefones e e-mails são sempre somados, nunca apagados.

## Gerenciar contatos

Ao clicar em um contato você vê os **Detalhes do contato**, as **Configurações de comunicação** (bloquear o contato e ligar ou desligar a IA do WhatsApp para ele), os **Campos inteligentes** que a Kloel mantém a partir das conversas e as **Atividades**, com ligações e conversas. Use **Editar** para alterar dados. **Bloquear contato** faz o assistente deixar de atender esse número.

Dá para excluir um contato, vários selecionados ou todos de uma vez, pela opção **Excluir contatos** em **Configurações**.

:::danger[Exclusão definitiva]
Excluir todos os contatos apaga a base inteira da organização e não pode ser desfeito. Confira com calma antes de confirmar.
:::

### Configurações e campos inteligentes

Em **Configurações** (canto superior direito):

- **Capturar contatos automaticamente**: cria contatos a partir das conversas.
- **Quando devemos criar um contato?**: o critério, em texto livre. Se ficar vazio, o contato é criado assim que o nome ou o sobrenome for conhecido.

~~~text
Crie um contato apenas se a pessoa já for paciente ou marcar uma consulta.
~~~

Com **Adicionar detalhe** você cria campos inteligentes, com nome, tipo (inclusive lista de opções) e descrição. A IA preenche a partir das conversas, você também pode editar, e cada campo vira uma variável para mensagens e prompts.

:::info[LGPD]
Criar contatos automaticamente é tratar dados pessoais. Use um critério enxuto, guarde só o necessário e alinhe o uso ao seu aviso de privacidade. Veja [Proteção de dados](/ajuda/legal/protecao-de-dados).
:::

## Usar contatos no assistente

### Conecte os contatos

Em **Assistentes** → **Geral** → **Recursos**, abra **Conectar contatos** e marque o que o assistente pode usar: nome, sobrenome, empresa, notas, telefones, e-mails e campos inteligentes. Campo desmarcado também não fica disponível como variável.

::mockup{kind="agent-resources" highlight="contacts" caption="Cartão Conectar contatos ativo na seção Recursos"}

:::warning[Telefones fixos]
**Associar contatos pelo número fixo** vem desligado: um fixo costuma ser usado por várias pessoas, e o contato errado poderia ser reconhecido. Contatos também nunca são criados automaticamente a partir de fixos.
:::

### Cumprimente pelo nome

::::steps
### Abra as regras da mensagem inicial
Na aba **Geral**, em **Mensagens iniciais**, ative **Personalizar** e clique na engrenagem.
### Escolha o modo
No modo **Automático**, a Kloel já mantém uma saudação com o nome. Para escrever as suas, selecione **Avançado** e confirme **Sair do modo automático**.
### Crie a regra
Clique em **Adicionar mensagem** e em **Adicionar condição** (por exemplo, **Contato: Nome** está preenchido). Escreva o texto e insira o nome por **Adicionar variável**, sem digitar a variável à mão.
### Conclua
Clique em **Pronto**. As regras são lidas de cima para baixo e a primeira que corresponder vence; arraste para reordenar. Se nenhuma servir, vale a mensagem **Padrão**.
::::

~~~text
Quando:   Contato: Nome está preenchido
Mensagem: Oi, [Contato: Nome]! Aqui é a Roberta, da Clínica Bem Viver. Em que posso ajudar?
Padrão:   Olá! Aqui é a Roberta, da Clínica Bem Viver. Em que posso ajudar?
~~~

:::warning[Número oculto]
Ligações com número restrito não são reconhecidas. Escreva a mensagem **Padrão** de modo que funcione sem nome.
:::

### Variáveis e comportamento por contato

Entre as variáveis estão **Assistente: Nome**, **Empresa: Nome**, **Contato: Nome**, **Contato: Sobrenome**, **Contato: Empresa**, **Contato: Números de telefone** e **Contato: Endereços de e-mail**. A lista não é fechada: outras variáveis funcionam no formato \`{{nomeDaVariavel}}\`.

No **Prompt personalizado**, você pode tratar grupos de contatos de forma diferente:

~~~text
Se quem ligar estiver nos contatos como fornecedor, anote o assunto e transfira para o setor de compras.
~~~

## Bom saber

Sem central telefônica, o assistente sempre atende primeiro. Com a [central telefônica (PBX)](/ajuda/phone-numbers/pbx), contatos escolhidos podem tocar direto na equipe, sem passar pelo assistente.

:::tip[Precisa de ajuda?]
Clique em **Suporte** no topo desta central ou [fale com o time](/contato).
:::`,
  },

  /* ------------------------------------------------------------------ [226] */
  {
    section: 'get-started',
    slug: 'analytics',
    title: 'Análises',
    description: 'Filtre e analise conversas, ouça gravações e acompanhe o consumo do seu plano.',
    source: '[226]',
    related: ['get-started/troubleshooting', 'get-started/technical', 'developers/inbound-webhook', 'developers/test-context'],
    keywords: ['análises', 'analytics', 'relatórios', 'histórico de chamadas', 'conversas', 'filtros', 'transcrição', 'consumo'],
    body: `Tudo o que seus assistentes conversam fica registrado. Em [Conversas](/app/inbox) você encontra cada ligação e cada chat, com transcrição, resumo e dados técnicos; na [Visão geral](/app) você acompanha o volume de atendimentos e o consumo do plano.

Use essas telas para duas coisas: descobrir o que melhorar no assistente e localizar rápido uma conversa específica.

::mockup{kind="inbox" caption="Conversas: lista filtrada, transcrição e resumo da ligação selecionada"}

## 1. Filtre as conversas

Em [Conversas](/app/inbox), clique no ícone de funil ao lado da busca. Os filtros ativos aparecem como etiquetas acima da lista e podem ser removidos um a um.

| Filtro | Opções |
|---|---|
| **Canal** | Chamadas ou Chats (WhatsApp e Chatbot de IA) |
| **Agente** | Qualquer assistente da organização |
| **Direção** | Entrada ou Saída |
| **Resultado** | Resolvido, Transferido, Não atendida, Consulta agendada, Abandonada, Sem interação, Spam, Correio de voz, Saída sem resposta, Inatividade, Limite de tempo, Gravação recusada |
| **Status** | Favoritos, Não lido, Lido |
| **Data** | Hoje, Ontem, Últimos 7 dias, Últimos 30 dias, Este mês, Mês passado, Todo o período ou um intervalo personalizado |
| **Duração** | Intervalo de 0:00 a 30:00+ |

Ative **Mostrar arquivados** para incluir conversas arquivadas, e marque com a estrela as que quiser rever depois.

:::tip[Combine filtros]
Os filtros se somam. Alguns atalhos úteis:
- **Ligações perdidas da semana**: Canal Chamadas, Resultado Abandonada ou Sem interação, Data Últimos 7 dias.
- **Agendamentos do mês**: Resultado Consulta agendada, Data Este mês.
- **Transferências de um assistente**: Agente Roberta, Resultado Transferido, Data Últimos 30 dias.
- **Campanha de saída**: Direção Saída, Data no período da campanha.
:::

## 2. Abra uma conversa

Clique em uma conversa para ver o andamento, a transcrição e o resumo. O painel da direita reúne os detalhes:

- **Detalhes da chamada**: assistente, canal, quem ligou, número chamado, data e hora, duração e custo.
- **Informações de admin**: identificadores internos, como o ID da conversa, úteis ao pedir suporte.
- **Contexto**: dados que chegaram antes de a conversa começar.
- **Extração**: dados que o assistente captou durante a conversa.

O contexto pode vir de um [webhook de entrada](/ajuda/developers/inbound-webhook), da [API outbound](/ajuda/developers/outbound-api), do [contexto de teste](/ajuda/developers/test-context), do seu CRM ou de automações próprias. Esses valores já estão à disposição do assistente desde a primeira fala. Exemplo:

~~~json
{
  "nome": "Ana Ribeiro",
  "idPaciente": "BV-1042",
  "convenio": "Plano Exemplo Saúde"
}
~~~

A extração traz, por exemplo, o nome de quem ligou, o motivo do contato, o número do pedido, o horário desejado ou o e-mail. Variáveis personalizadas são criadas no próprio recurso, como o e-mail, a mensagem de WhatsApp ou a requisição HTTP.

| Aspecto | Contexto | Extração |
|---|---|---|
| Origem | Sistema externo, antes da conversa | O que a pessoa disse durante a conversa |
| Exemplo | ID do paciente no seu sistema | Horário preferido para retorno |
| Precisão | Valor exato | Depende da clareza da fala |

:::warning[Prefira o valor exato quando ele existir]
Para IDs, telefones e dados de contrato, use o Contexto ou variáveis do sistema. Valores extraídos podem variar quando a pronúncia não está clara; para melhorar a captura, veja o processamento preciso de informações em [Configurações técnicas](/ajuda/get-started/technical).
:::

:::faq[Não vejo o painel da direita]
Ele pode estar recolhido. Clique no ícone de painel no topo da conversa. Em telas pequenas e no modo focado, ele começa oculto.
:::

## 3. Ouça a gravação e leia o resumo

Se o assistente estava com **Gravar áudio** ativado, a conversa mostra um player com forma de onda. Nele você ouve tudo, pula para um trecho, avança ou volta, muda a velocidade e compara o áudio com a transcrição.

:::warning[Sem gravação?]
O áudio só existe se a gravação estava ligada no momento da ligação; não dá para gerá-lo depois.
:::

Abaixo do player fica o resumo automático, que mostra o pedido em poucos segundos. Para dados críticos, como telefone, e-mail ou número de cliente, confira também a transcrição e a extração.

## 4. Visão geral e consumo

A [Visão geral](/app) é a página inicial da organização. Escolha o período no topo.

::mockup{kind="overview" caption="Visão geral: indicadores do período e gráfico de chamadas por dia"}

- **Histórico de chamadas**: número de ligações, minutos usados e evolução no período, o que facilita enxergar picos e quedas.
- **Uso**: consumo em relação aos limites do plano, como minutos usados e incluídos, números de telefone, usuários, chamadas simultâneas, conexões e números de WhatsApp.

:::warning[Perto do limite?]
Se o uso estiver chegando ao que o plano inclui, avalie em [Faturamento](/app/billing) se vale trocar de plano ou liberar consumo excedente.
:::

## Dados para o suporte

Ao falar com o time sobre uma conversa, abra-a e separe: o link da conversa, o ID (em **Informações de admin**), o nome do assistente, a data e a hora exatas, os números envolvidos e uma frase sobre o que você esperava que acontecesse. Depois, use o botão **Suporte** no topo desta central.

:::info[Área em evolução]
As análises recebem melhorias com frequência, e novos gráficos e indicadores podem aparecer aqui.
:::

:::tip[Precisa de ajuda?]
Clique em **Suporte** no topo desta central ou [fale com o time](/contato).
:::`,
  },

  /* ------------------------------------------------------------------ [227] */
  {
    section: 'get-started',
    slug: 'troubleshooting',
    title: 'Solução de problemas',
    description: 'Encontre pelo sintoma a causa provável de um problema e o artigo com a solução.',
    source: '[227]',
    related: ['get-started/write-a-great-prompt', 'get-started/connect-your-number', 'get-started/knowledge-base', 'get-started/analytics'],
    keywords: ['problemas', 'erro', 'não funciona', 'suporte', 'diagnóstico', 'relatar problema', 'bug'],
    body: `Algo não saiu como esperado? Comece pelo sintoma. As tabelas abaixo apontam o que verificar primeiro e qual artigo traz o passo a passo. Na maioria das vezes a causa está em uma configuração e se resolve em poucos minutos.

Se nada disso resolver, a parte final mostra como relatar o problema para que o time encontre a causa rapidamente.

## Assistente e conhecimento

| Sintoma | O que verificar | Leia |
|---|---|---|
| Responde errado ou inventa informação | O prompt manda usar só a base? O dado está cadastrado? | [Como escrever um ótimo prompt](/ajuda/get-started/write-a-great-prompt) |
| Diz não saber algo que está cadastrado | Fonte ativa para esse assistente; pergunta escrita como o cliente fala | [Base de conhecimento](/ajuda/get-started/knowledge-base) |
| Ignora parte das instruções | Prompt longo demais ou com regras contraditórias | [Como escrever um ótimo prompt](/ajuda/get-started/write-a-great-prompt) |
| Responde em outra língua ou não troca de idioma | Campo Idioma; regra de troca no prompt | [Idiomas e multilinguismo](/ajuda/get-started/languages) |
| Pronuncia ou entende nomes errado | Regras → Pronúncia; Técnico → Termos técnicos | [Configurações técnicas](/ajuda/get-started/technical) |
| Interrompido por barulho ou encerra cedo | Sensibilidade, Tempo máximo de espera, Duração máxima da ligação | [Configurações técnicas](/ajuda/get-started/technical) |

## Chamadas e números

| Sintoma | O que verificar | Leia |
|---|---|---|
| Ligações não chegam ao assistente | Número atribuído ao assistente certo; a ligação aparece em Conversas? | [Números de telefone](/ajuda/get-started/connect-your-number) |
| Desvio do número antigo não funciona | Código aceito pela operadora; serviço liberado na linha | [Números de telefone](/ajuda/get-started/connect-your-number) |
| A central (PABX) não conecta | Dados do tronco SIP configurados dos dois lados | [Números SIP](/ajuda/phone-systems/sip-numbers) |
| A transferência não acontece | Recurso Transferir ligações salvo; condição; horário de funcionamento | [Transferência de chamadas](/ajuda/actions/call-transfer) |
| Ligações de saída não mostram o meu número | Número importado e verificado | [Importar um número](/ajuda/phone-numbers/import-number) |
| Campanha não começa | Plano Team ou superior; arquivo com números em E.164 | [Ligações outbound](/ajuda/developers/outbound-calls) |

## Mensagens e agendamentos

| Sintoma | O que verificar | Leia |
|---|---|---|
| E-mail não chega | Recurso Enviar e-mail ativo; condição; destinatário; pasta de spam | [E-mail](/ajuda/actions/email) |
| WhatsApp não é enviado | Número de WhatsApp conectado; condição do recurso | [Mensagens de WhatsApp](/ajuda/actions/whatsapp-messages) |
| SMS não é enviado | Recurso disponível na sua conta | [SMS](/ajuda/actions/sms) |
| Horário não é marcado | Agenda conectada; tipo de evento; disponibilidade e fuso | [Agendamentos](/ajuda/actions/appointments) |
| Saudação personalizada não usa o nome | Telefone do contato em E.164; Conectar contatos ativo | [Contatos](/ajuda/get-started/contacts) |

## Integrações e API

| Sintoma | O que verificar | Leia |
|---|---|---|
| Integração não dispara | Condição definida na folha do recurso, não no prompt; conexão ativa | [Integrações](/app/integrations) |
| Webhook não recebe dados | URL, método, cabeçalhos e corpo; resposta do seu servidor | [Requisição HTTP](/ajuda/developers/http-request) |
| Contexto não aparece na conversa | Formato do envio pelo webhook de entrada | [Webhook de entrada](/ajuda/developers/inbound-webhook) |
| Erro de autenticação na API | Chave ativa e copiada por inteiro | [Chaves de API](/app/api-keys) |

## Conta e administração

| Sintoma | O que verificar | Onde |
|---|---|---|
| Minutos ou números esgotados | Uso na Visão geral; plano atual | [Faturamento](/app/billing) |
| Colega não consegue acessar | Convite enviado e função do usuário | [Usuários](/app/users) |
| Dados errados na fatura | Razão social, CNPJ e endereço | [Configurações da empresa](/app/company-settings) |

## Antes de entrar em contato

::::steps
### Repita o teste
Faça uma nova **Ligação de teste** ou ligue de outro aparelho e veja se o problema se repete.
### Confirme assistente e número
Verifique se o número está atribuído ao mesmo assistente que você editou.
### Procure a ligação em Conversas
Se ela não aparece em [Conversas](/app/inbox), o problema está antes da Kloel: operadora, desvio ou central.
### Lembre da última mudança
O problema começou depois de mexer no prompt, num recurso ou no número? Desfazer a mudança costuma confirmar a causa.
::::

::mockup{kind="test-call" caption="Ligação de teste no navegador, com a transcrição aparecendo em tempo real"}

## Como relatar um problema

Clique em **Suporte** no topo desta central (ou [fale com o time](/contato)) e mande tudo já na primeira mensagem, para evitar idas e vindas:

- Nome da organização e do assistente
- Número de telefone envolvido
- Data e hora exatas, no horário de Brasília
- Link ou ID da conversa (veja onde encontrar em [Análises](/ajuda/get-started/analytics))
- O que deveria acontecer e o que aconteceu de fato
- A mensagem de erro exata e, se ajudar, uma captura de tela
- Os passos para reproduzir e o que você já verificou

~~~text
Organização:
Assistente:
Número de telefone:
Data e hora (horário de Brasília):
Link ou ID da conversa:
O que deveria acontecer:
O que aconteceu:
Mensagem de erro:
Como reproduzir:
O que já verifiquei:
~~~

:::danger[Nunca envie credenciais]
Não mande senhas, chaves de API completas nem tokens. A mensagem de erro e a descrição da configuração bastam para a análise.
:::

## Funciona, mas poderia ser melhor?

Nem todo comportamento estranho é falha técnica. Muitas vezes basta deixar o prompt mais preciso, completar a base de conhecimento ou ajustar a condição de um recurso. Revise as conversas com resultado **Abandonada** ou **Transferido** e observe onde o assistente hesitou.

:::cards
- [Como escrever um ótimo prompt](/ajuda/get-started/write-a-great-prompt) Regras práticas e modelos por setor.
- [Base de conhecimento](/ajuda/get-started/knowledge-base) Organize os fatos para respostas precisas.
- [Análises](/ajuda/get-started/analytics) Filtre conversas e encontre padrões.
:::

:::tip[Precisa de ajuda?]
Clique em **Suporte** no topo desta central ou [fale com o time](/contato).
:::`,
  },
]
