/**
 * Modelo de conteúdo da Central de ajuda da Kloel.
 *
 * Cada artigo é um objeto tipado cujo corpo (`body`) usa um subconjunto de Markdown com diretivas.
 * O mesmo texto alimenta: a renderização da página, o sumário "Nesta página", a busca (⌘K),
 * o assistente simulado (⌘I) e a ação "Copiar página" (Markdown).
 *
 * ── FORMATO DO `body` ───────────────────────────────────────────────────────────────────────────
 * Blocos (separados por linha em branco):
 *   ## Título            → H2 (entra no sumário)
 *   ### Subtítulo        → H3 (entra no sumário, recuado)
 *   #### Rótulo          → H4 (não entra no sumário)
 *   parágrafo            → texto corrido (linhas consecutivas são unidas)
 *   - item / 1. item     → listas (um nível; "  - " com 2 espaços cria subitem)
 *   | a | b |            → tabela GFM (linha 2 = separador |---|---|)
 *   ```json … ```        → bloco de código com linguagem (text, json, bash, js, html, csv, markdown)
 *   > citação            → citação/realce
 *
 * Inline: **negrito**, *itálico*, `código`, [texto](/ajuda/secao/slug) ou [texto](/app/rota)
 *         (links internos usam o roteador; links http(s) externos ficam desativados com aviso).
 *
 * Contêineres (abertura e fechamento com o MESMO número de dois-pontos; contêiner interno usa MENOS
 * dois-pontos que o externo):
 *   ::::steps            → passos numerados (círculo + linha vertical). Cada passo começa com
 *   ### Título do passo     uma linha "### Título do passo" (esses títulos NÃO entram no sumário).
 *   texto do passo…
 *   :::tip[Dica]            (callouts podem ficar dentro de um passo)
 *   …
 *   :::
 *   ::::
 *
 *   :::tip[Título]  … :::   → callout verde (dica / sucesso)
 *   :::info[Título] … :::   → callout azul (informação)
 *   :::warning[Título] … ::: → callout âmbar (atenção / acesso antecipado)
 *   :::danger[Título] … :::  → callout vermelho (erro / risco)
 *   :::note[Título] … :::    → callout neutro
 *   :::faq[Pergunta] … :::   → item recolhível (FAQ/accordion)
 *   ::::tabs                 → abas; cada aba é ":::tab[Rótulo] … :::"
 *   :::cards … :::           → grade de cartões; corpo = lista "- [Título](/ajuda/x/y) Descrição curta"
 *
 * Diretivas de linha única:
 *   ::mockup{kind="agent-general" caption="Legenda"}      → mini interface (não é screenshot). Ver MOCKUP_KINDS.
 *   ::tiles{group="integrations"}                         → grade pesquisável dos artigos de integração
 *
 * Variáveis em exemplos: use {{nomeDaVariavel}} dentro de blocos de código ou `código`.
 */

export type HelpTabId = 'get-started' | 'product' | 'integrations' | 'partner'

export interface HelpArticle {
  /** 1º segmento da URL (/ajuda/<section>/<slug>) — ex.: 'get-started', 'actions', 'integrations' */
  section: string
  /** 2º segmento da URL — ex.: 'first-steps' */
  slug: string
  /** Título (H1 e item da sidebar) */
  title: string
  /** Rótulo opcional mais curto para a sidebar */
  sidebarTitle?: string
  /** Lead exibido abaixo do H1 (1 frase) */
  description: string
  /** Proveniência: ids do INVENTORY (ex.: '[170]'), 'captura ao vivo', 'INFERIDO' ou 'DEMONSTRATIVO' */
  source: string
  /** Conteúdo demonstrativo (sem nota de referência) — exibe faixa "Conteúdo demonstrativo" */
  demo?: boolean
  /** Artigos relacionados: 'section/slug' */
  related?: string[]
  /** Termos extras para a busca (sinônimos) */
  keywords?: string[]
  /** Corpo no formato descrito acima */
  body: string
}

/** Tipos de mini interface disponíveis para ::mockup{kind="..."} (parâmetros opcionais entre parênteses). */
export const MOCKUP_KINDS = [
  'overview', //            Visão geral: indicadores + gráfico de chamadas
  'agent-general', //       Assistente › Geral: nome, voz, idioma, mensagens iniciais
  'agent-resources', //     Assistente › Geral › Recursos: grade de 9 cartões (highlight="contacts|transfer|email|whatsapp|scheduling|websearch|integrations|webhooks|sms")
  'agent-rules', //         Assistente › Regras: regras do sistema, regra própria, pronúncia
  'agent-knowledge', //     Assistente › Conhecimento: fontes (site/PDF) + informações (P&R) + horário
  'agent-prompt', //        Assistente › Prompt personalizado: editor de prompt
  'agent-technical', //     Assistente › Técnico: duração máx., gravação, criatividade, ruído, pausas
  'resource-sheet', //      Folha lateral de recurso (title="…" fields="Rótulo=Valor|Rótulo=Valor")
  'phone-numbers', //       Números de telefone: lista + atribuição a assistente
  'call-forwarding', //     Widget INTERATIVO de desvio de chamadas (códigos de operadora)
  'test-call', //           Ligação de teste no navegador com transcrição
  'inbox', //               Conversas: lista + transcrição + resumo
  'contacts', //            Contatos: tabela
  'scheduling', //          Agendador: tipos de evento + disponibilidade
  'whatsapp', //            WhatsApp: conta conectada + conversa
  'webchat', //             Chatbot de IA: site com widget
  'email-inbox', //         E-Mail IA: caixa de entrada com rascunho
  'integrations', //        Integrações: grade de cartões (highlight="Nome")
  'integration-config', //  Formulário de integração (name="Pipedrive" mode="credentials|action|oauth")
  'http-request', //        Requisição HTTP / webhook: método, URL, cabeçalhos, corpo JSON
  'campaign', //            Campanhas outbound: CSV + progresso
  'api-keys', //            Chaves de API
  'pbx', //                 Central telefônica no navegador: ramais + discador
  'tasks', //               Tarefas: lista com responsáveis
  'message', //             Pré-visualização de mensagem (channel="sms|whatsapp|email|slack" text="…")
  'partner-portal', //      Área do parceiro: clientes, status, comissões
  'prompt-builder', //      Construtor de prompt INTERATIVO (setor, nome, tom → prompt copiável)
] as const

export type MockupKind = (typeof MOCKUP_KINDS)[number]

export interface HelpNavGroup {
  /** Título do grupo na sidebar (também usado como "eyebrow" acima do H1) */
  label: string
  /** chaves 'section/slug' na ordem da sidebar */
  items: string[]
  /** grupo de links legais (abre em nova aba, ícone ↗) */
  external?: boolean
}

export interface HelpTab {
  id: HelpTabId
  label: string
  /** rótulo original observado na Fonio (para a cobertura) */
  observedLabel: string
  icon: 'rocket' | 'box' | 'plug' | 'handshake'
  groups: HelpNavGroup[]
}
