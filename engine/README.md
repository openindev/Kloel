# Kloel AI — motor local

Backend local em desenvolvimento para integrar à interface Kloel. O estado detalhado e as lacunas estão em [docs/ENGINE_STATUS.md](docs/ENGINE_STATUS.md). A presença de um adaptador não significa que a conta externa esteja conectada ou que seu fluxo já tenha passado em teste real.

## Executar

Requer Node.js 22.13 ou superior.

```sh
npm ci
npm run check
npm test
npm run build
npm run dev
```

Servidor: `http://127.0.0.1:4310`. Painel local: `/ops`. Saúde: `/health`.

O servidor lê `.env.local`, que não deve ser versionado. Nesta máquina o ambiente já foi inicializado; preserve o arquivo existente. Em uma instalação nova, copie `.env.example`, forneça as credenciais do próprio operador e crie o primeiro proprietário com `POST /api/v1/auth/bootstrap` usando `email`, `password` (mínimo 12 caracteres) e `organization`. O bootstrap só funciona uma vez. O identificador `tenantId` retornado deve ser vinculado em `PROVIDER_TENANT_ID` para o piloto.

A sessão usa cookie HttpOnly. Todos os endpoints administrativos exigem sessão; ações administrativas exigem owner/admin. O painel `/ops` permite ao owner gravar uma configuração por vez somente por origem local. O valor secreto não é devolvido pela API. Acesso inicial privado desta instalação fica em `data/local-owner.json`, com permissão 0600.

## Módulos

- `/api/v1/agents`, `/contacts`, `/conversations`, `/calendars`, `/appointments`: domínio persistente com isolamento por organização.
- `/api/v1/knowledge`, `/knowledge/:id/ingest`, `/knowledge/search`: documentos e recuperação por embeddings.
- `/api/v1/knowledge/upload`, `/knowledge/import-url`: extração de texto/PDF e importação de URL pública com proteção contra SSRF. OCR não implementado.
- `/api/v1/members`, `/invitations`: membros, papéis, convites, revogação de sessões. O link de convite local não equivale a envio por e-mail.
- `/api/v1/ai/chat`, `/ai/realtime/session`: OpenAI Responses e voz WebRTC; chave permanente fica no servidor.
- `/api/v1/oauth/*`: conexões Google/Microsoft, agenda e e-mail. Consulte [docs/oauth-calendar.md](docs/oauth-calendar.md).
- `/api/v1/billing/*`: Checkout, Portal e estado de assinatura; webhooks determinam o estado de pagamento.
- `/api/v1/email/send`, `/whatsapp/send`, `/voice/calls`: operações explícitas nos provedores configurados.
- `/api/v1/providers/status`, `/providers/operations`, `/providers/jobs`: configuração e registros reais de execução.

Os endpoints recusam a operação quando faltam credenciais, permissões ou relacionamentos. Respostas de teste usam transporte controlado; evidências externas reais ficam em `docs/evidence` e identificam o ambiente.

## Stripe em localhost

Com o Stripe CLI oficial instalado e a chave `sk_test_` da sandbox configurada:

```sh
node --env-file=.env.local scripts/stripe-local.mjs
```

O script conecta a sandbox ao webhook local, registra o segredo de assinatura sem imprimi-lo e filtra os eventos de assinatura necessários. Não usa chave de produção nem altera o perfil global do CLI. Mantenha o servidor rodando durante o teste.

## Persistência e limites atuais

Dados em SQLite com WAL e transações; tokens OAuth criptografados com AES-256-GCM. O backend usa credenciais compartilhadas vinculadas a uma única organização piloto. O isolamento de entidades é testado, mas a gestão comercial de múltiplas organizações ainda precisa ser completada antes de venda.

O worker WhatsApp exige `WHATSAPP_AUTOREPLY_ENABLED=true`, canal habilitado e assistente ativo. Respeita atendimento humano, janela de resposta e limite diário. Resultado externo incerto fica para reconciliação e não é reenviado automaticamente.

Nunca inclua `.env.local`, `data/`, tokens ou senhas em frontend, repositório, captura ou relatório. A interface demonstrativa do Claude ainda será conectada às APIs; seus dados fictícios não são prova de funcionamento do motor.
