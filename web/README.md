# Kloel AI — casca completa (demonstração local, sem motor)

Aplicação web real e navegável da **Kloel AI** (kloel.ai) que reproduz a aparência, a estrutura e o comportamento da Fonio.ai — site público, central de ajuda, primeiro acesso e aplicativo — com **dados locais persistentes** e **operações de motor simuladas**.

> **Ambiente de demonstração local.** Nenhuma ação realiza ligações, cobranças, envios de WhatsApp/e-mail/SMS, conexões OAuth ou chamadas a serviços externos. Tudo que dependeria do motor (IA, telefonia, mensageria, pagamentos, integrações) passa por adaptadores **simulados**; para a interface ficar idêntica à Fonio, os resultados não levam rótulos na tela. O selo “Demonstração local” (canto inferior direito) fica sempre visível e é o único controle de demonstração na interface.

## Requisitos
- Node.js 22+ e npm (testado com Node 22.22 / npm 12).
- Nenhuma credencial de serviço pago. Não depende da sessão da Fonio.

## Instalação
```bash
cd kloel-ai
npm install
```
Se o npm bloquear o script de instalação do esbuild (npm 12 `allowScripts`), aprove-o uma vez:
```bash
npm install-scripts approve esbuild && npm rebuild esbuild
```

## Execução
```bash
npm run dev
```
Abra **http://127.0.0.1:5173**.

Build de produção local (opcional):
```bash
npm run build && npm run preview
```
(serve em http://127.0.0.1:4173)

### Conta de demonstração
- E-mail: `demo@kloel.ai`
- Senha: `demo1234`

Organização fictícia **“Clínica Bem Viver”** com 3 assistentes (Roberta, Joana — voz; Maria — chat), 83 conversas com transcrições, 24 contatos, 2 números, 16 reservas na agenda (todas em dias úteis, dentro da disponibilidade do tipo de evento), assinaturas e 6 faturas.

Outra conta do seed, sem assinatura ativa (mostra o estado “antes do pagamento”): `primeiro.acesso@exemplo.com.br` / `demo1234`. Para percorrer o **primeiro acesso** do zero, crie uma conta nova em `/criar-conta` (ou a partir de `/planos`, que leva o plano escolhido, ou de um link de indicação `/register?ref=<código>` / `/r/:codigo`).

### Cenário espelho da conta Fonio (comparar lado a lado)
- E-mail: `espelho@kloel.ai`
- Senha: `demo1234`

Organização **“Kloel Tecnologia”** no MESMO estado da conta Fonio ao vivo levantada em 18/10/2026 (`docs/reference/fonio-live2`, spec 09), para navegar nos dois apps ao mesmo tempo e ver as mesmas telas:
- 2 assistentes de voz, **Joana** e **Roberta**, sem número de telefone (Roberta: voz Camila, pt-BR, “Conectar contatos” ativo, fonte de conhecimento `kloel.com` com 5 páginas);
- 1 conversa: chamada web de 3:02 com a Roberta (“Configuração Kloel AI”, resolvida) em 18/10 às 01:35;
- nenhum número de telefone, conta de WhatsApp, calendário/tipo de evento, contato, chave de API ou convite (estados vazios iguais aos da Fonio);
- assinaturas WhatsApp Solo, Solo (telefone) e Chatbot de IA Solo; add-ons zerados; compra automática ligada; verificação de identidade em “Ação necessária”; uso 0/1.000 min, 0/450, 0/100, 0/2, 0/1, 1/3 usuários, 0/2 conexões, até 1 chamada; período 18 de out. – 18 de nov.

O nome do usuário (“Diego Prado”, iniciais DP como no avatar da conta original) é fictício: dados pessoais do operador não entram no app. As datas são as da conta original (num relógio anterior a elas, ficam relativas ao momento atual).

**Trocar de cenário:** selo “Demonstração local” (canto inferior direito) → **Cenário** → “Clínica Bem Viver” (demo) ou “Kloel Tecnologia” (espelho). A troca entra na conta do cenário e abre `/app`; no espelho o grupo “Mais” fica aberto, como na conta original. Bancos locais gravados antes deste cenário recebem a organização espelho automaticamente ao abrir o app (acréscimo, sem alterar outros dados); “Restaurar demo” recria os dois cenários. Nas capturas automáticas: `node scripts/shot.mjs <rota> <saída.png> 1355 661 --as=espelho@kloel.ai`.

Código de desconto demonstrativo no checkout: `DEMO10` (10% na primeira fatura).

## Mapa de rotas
| Área | Rotas |
|---|---|
| Site público | `/` (institucional = Assistente telefônico IA), `/produtos/ia-whatsapp`, `/produtos/webchat-ia`, `/webchat/criar`, `/demo-ia`, `/solucoes/:slug` (5), `/planos`, `/agendar-demo`, `/parceiros`, `/parceiros/agendar`, `/contato`, `/carreiras`, `/imprensa`, `/casos-de-sucesso`, `/webinars`, `/integracoes`, `/lp` (landing de campanha), `/criar-conta`, `/login`, `/recuperar-senha`, `/r/:codigo` |
| Central de ajuda | `/ajuda`, `/ajuda/:secao/:artigo`, `/ajuda/legal/:doc` |
| Aplicativo (login) | `/app` (Visão geral), `/app/agents/:id/:aba`, `/app/inbox`, `/app/tasks` (BETA, `/app/tasks/:id`), `/app/phone-numbers`, `/app/whatsapp`, `/app/scheduling`, `/app/email-agents`, `/app/contacts`, `/app/integrations`, `/app/campaigns`, `/app/billing` (+ `/portal`, `/identity`), `/app/change-plan/:produto`, `/app/add-product/:produto`, `/app/checkout`, `/app/free-credits`, `/app/api-keys`, `/app/company-settings`, `/app/users`, `/app/account`, `/app/onboarding` |
| Página de reserva | `/c/:empresa/:evento` |
| Chatbot hospedado (sem login) | `/w/:empresa/:assistente` (e `/w/:empresa/:assistente/:sessão`) — link público do Webchat |

As rotas internas da Fonio (`/agents`, `/inbox`, `/tasks`, `/phone-numbers`, `/whatsapp`, `/scheduling`, `/email-agents`, `/contacts`, `/integrations`, `/billing`, …) redirecionam para os equivalentes em `/app/...`. A home pública (`/`) e a home autenticada (`/app`) ficam separadas.

## Percursos de demonstração sugeridos
1. **Visitante**: `/` → menus Produtos/Soluções/Recursos → “Receber ligação da IA agora” (simulada) → `/planos` (mensal/anual) → “Agendar uma demo” (3 etapas) → confirmação.
2. **Webchat**: `/produtos/webchat-ia` → digite um site → “Gerar minha IA” → sequência de geração → converse com o chatbot gerado (limite de 5 mensagens) → “Criar conta”.
3. **Primeiro acesso**: `/criar-conta` → escolha de produto/plano → pagamento demonstrativo → configuração → criação do assistente → ligação de teste simulada → painel.
4. **Assistentes**: `/app/agents/...` → voz, idioma, mensagem inicial com variáveis, regras, conhecimento (site/documentos/entradas), prompt, técnico, ações (transferência, e-mail, WhatsApp, agendamento, pesquisa web, integrações, webhooks) → salvar → “Testar ligação”.
5. **Conversas e contatos**: filtros, etiquetas, exportação CSV, detalhes; contatos, campos inteligentes e importação CSV.
6. **Mais**: números (compra/SIP/importação), WhatsApp, Agendador, E-Mail IA, Integrações, Campanhas outbound (restrição por plano), chaves de API, empresa, usuários, conta, bônus.
7. **Assinatura**: add-ons, alterar plano (desbloqueia Campanhas outbound com Voice Team), portal financeiro demonstrativo, verificação de identidade.

### Simulações e regras determinísticas
- Painel **Demonstração local → “Simular falha na próxima operação”**: a próxima operação simulada falha, exibindo o estado de erro e “Tentar novamente”.
- Painel **Demonstração local → “Simular erro ao carregar a próxima página”**: a próxima página do app que carrega dados mostra “Não foi possível carregar os dados” com “Tentar novamente” (o carregamento normal exibe um esqueleto breve).
- Restrição por plano: **Campanhas outbound** fica bloqueada até o plano Voice Team (alterar em Assinatura → Alterar plano).
- Painel **Demonstração local → “Recursos BETA: Tarefas”**: liga/desliga o recurso BETA **Tarefas** da organização atual (`organizations[].betaFeatures.tasks`, persiste após recarregar). Com ele ligado, o item “Tarefas BETA” aparece na barra lateral entre Conversas e Mais e os assistentes de chat ganham “Criar tarefa”. **Padrão desligado** na Clínica Bem Viver: a conta ao vivo da Fonio capturada em 2026-10-18 não mostra Tarefas — o item só aparece nas capturas da central de ajuda (WC-02 / TK-V01).
- Kloel PBX: quem tem **posição PBX** vê o telefone do navegador (simulado) no canto inferior direito de todas as páginas do app quando a organização tem um número PBX (Números de telefone → Adicionar número PBX).
- Sites com “erro”/“falha” no endereço falham na geração/leitura; telefones terminados em `0000` falham no retorno de ligação.
- Cartões de teste: `4242 4242 4242 4242` (aprovado), `4000 0000 0000 0002` (recusado). Qualquer validade futura `MM/AA` e CVC de 3 dígitos.
- Para testes automatizados, `localStorage['kloel-demo:speed']='0.05'` acelera as simulações.

## Dados locais e restauração
- Os dados ficam no `localStorage` do navegador (chave `kloel-demo:db:v1`). Recarregar a página mantém tudo.
- **Restaurar o cenário inicial**: selo “Demonstração local” → **Restaurar demo**. Antes de restaurar, o estado atual é salvo automaticamente em **Backups** (até 5 cópias), recuperáveis no mesmo painel. Nada no disco do operador é alterado.
- **Exportar/Importar**: o mesmo painel exporta o estado em JSON e importa de volta (com backup automático antes de importar).
- Pelo console: `window.__kloelDemo.store.getState().resetDemo()`.

## Arquitetura (pontos de integração para o motor futuro)
- `src/domain/types.ts` — modelo de domínio (organizações, usuários, assistentes, conhecimento, conversas, contatos, números, canais, agenda, e-mail, cobrança…).
- `src/data/` — persistência (`storage.ts`), store (`store.ts`), seed determinístico (`seed/`), catálogos (`catalogs/`).
- `src/services/` — **contratos** (`types.ts`) e adaptadores **simulados** (`simulated/`). Para conectar o motor real, implemente `KloelServices` e troque o registro em `src/services/index.ts`; a interface não precisa ser reescrita.
- `src/components/ui` (primitivos shadcn/Radix), `src/components/app` (padrões do app), `src/site` (site público), `src/help` (central de ajuda), `src/app` (aplicativo).

## Validação
```bash
npx tsc -p tsconfig.json --noEmit         # tipos
node scripts/smoke.mjs                     # varre todas as rotas (erros, placeholders, 404) e salva capturas
node scripts/smoke.mjs --mobile            # idem em 390 px
node scripts/coverage.mjs                  # consolida a matriz em docs/COVERAGE.md
node scripts/shot.mjs /app captura.png 1440 900 --login
```
Relatório de entrega (o que foi feito, validação, cenários, inferências e limitações): **`docs/ENTREGA.md`**. Documentação do levantamento e da validação: `docs/` (inventário das referências, especificações por área, capturas ao vivo da Fonio, matriz de cobertura, evidências e registro de progresso).
