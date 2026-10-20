# Contatos: importação, exportação e busca

`registerContactImport(app, store)` adiciona operações locais autenticadas ao mesmo CRM de `/api/v1/contacts`. Nenhuma importação envia mensagens ou valida contatos nos provedores.

## Importar com prévia

1. Envie `POST /api/v1/contacts/import/preview` com o payload abaixo. A prévia não grava dados, nem recibos.
2. Revise `rows` e `summary`. Cada linha informa `create`, `merge`, `skip` ou `error`, dados normalizados, avisos e erros. `line` é a linha física inicial do registro CSV, inclusive quando notas têm múltiplas linhas; em JSON, é a posição no array, começando em 1.
3. Envie o mesmo payload a `POST /api/v1/contacts/import/commit`, acrescentando `previewFingerprint` com o `fingerprint` recebido. Inclua um cabeçalho `Idempotency-Key` exclusivo para a operação, de 8–128 caracteres (`A–Z`, `a–z`, dígitos, `_`, `.`, `:`, `-`).

```json
{
  "format": "csv",
  "content": "name,email,phone\nAna Silva,ana@example.com,11999990000\n",
  "defaultCountry": "BR",
  "duplicatePolicy": "error"
}
```

Alternativamente, substitua `content` por `base64` contendo os bytes UTF-8 do arquivo. Não forneça ambos. `format: "json"` usa um array de objetos serializado em `content` ou `base64`; os objetos usam o schema de contato com `consent` aninhado. CSV aceita BOM UTF-8, aspas duplicadas como escape, quebras de linha entre aspas e `delimiter: ";"` explícito; o padrão é vírgula. Os cabeçalhos são os nomes canônicos abaixo e não podem repetir.

Qualquer erro de linha impede todo o commit. Mudanças no arquivo, nas opções ou nos contatos do tenant invalidam a prévia (`409 preview_stale`). Repetir a mesma operação com a mesma chave retorna o recibo sem gravar novamente. Reusar a chave com outro payload é conflito. Uma falha durante a gravação reverte todos os contatos e o recibo.

| Campo | Formato e comportamento |
| --- | --- |
| `name` | Obrigatório, 1–200 caracteres. |
| `email` | Opcional, até 254 caracteres. Espaços externos removidos e minúsculas. |
| `phone` | Opcional, string E.164 com `+` e código do país. |
| `company` | Empresa, até 200 caracteres. |
| `notes` | Notas, até 20.000 caracteres; CSV permite múltiplas linhas entre aspas. |
| `tags` | Array de até 50 strings, cada uma com 1–80 caracteres. No CSV, array JSON dentro da célula. |
| `timezone` | Fuso IANA; padrão `America/Sao_Paulo`. |
| `consent.whatsapp`, `consent.email`, `consent.phone` | Booleanos, padrão `false`; CSV exige exatamente `true` ou `false`. |
| `consent.recordedAt` | Data ISO com fuso. Obrigatória se algum consentimento for `true`. |
| `consent.source` | Origem do consentimento, até 500 caracteres. Obrigatória para qualquer `true`. A importação não coleta consentimento. |

Não são aceitos `id`, `tenantId`, datas do sistema ou campos desconhecidos. Em JSON, por exemplo: `{"name":"Ana","consent":{"email":true,"source":"Formulário próprio","recordedAt":"2026-10-18T09:00:00-03:00"}}`.

## Telefone e duplicação

Sem `defaultCountry`, telefone sem `+` é erro: país não é inferido. Com `defaultCountry: "BR"`, `(11) 99999-0000` vira `+5511999990000` e `11 3234-5678` vira `+551132345678`. DDD deve ser válido; celular tem 9 dígitos e começa com 9, telefone fixo tem 8 e começa com 2–5. Não acrescentamos DDD, nono dígito ou prefixo de operadora. Extensões, números de serviço e números ambíguos exigem correção. Números estrangeiros precisam de `+` e código do país; a validação é de sintaxe E.164, não de existência da linha.

A correspondência usa telefone normalizado ou e-mail, sempre dentro do tenant. `duplicatePolicy`:

- `error` (padrão): duplicação bloqueia o commit.
- `skip`: ignora correspondências existentes e repetições no arquivo.
- `merge`: aplica campos fornecidos não vazios ao contato existente e une etiquetas. Campos omitidos ou vazios não apagam dados. Preserva integralmente todos os consentimentos existentes; o arquivo não substitui concessões nem revogações. A prévia lista `changedFields`. Repetições do mesmo contato dentro do arquivo são erro para evitar a última linha sobrescrever a primeira.

Quando e-mail e telefone apontam para contatos diferentes, ou o CRM já contém múltiplas correspondências, nenhuma política resolve a identidade automaticamente. A mesclagem também não troca telefone/e-mail existente por outro valor não vazio. Corrija esses conflitos no CRM. Contatos sem telefone/e-mail são permitidos com aviso: não podem ser deduplicados por identidade; a chave idempotente ainda protege o replay do mesmo commit.

## Exportar e buscar

`GET /api/v1/contacts/export?format=csv` entrega CSV UTF-8 com BOM; `format=json` entrega array JSON somente com campos editáveis, sem tenant, IDs ou metadados internos. CSV prefixa apóstrofo em células potencialmente interpretadas como fórmulas. O importador reconhece essa proteção nos telefones E.164; JSON preserva os demais textos exatamente. A exportação inclui consentimentos já armazenados, sem alterá-los.

`GET /api/v1/contacts/lookup?q=joao%20silva&limit=10` procura por nome, e-mail, telefone, empresa e etiquetas. Ignora acentos e maiúsculas na busca textual; correspondências exatas de telefone/e-mail aparecem primeiro. Retorna apenas identificação básica do contato, sem notas nem consentimentos. Consulta exige 2–254 caracteres; limite padrão 10, máximo 50. A busca local usa os registros persistidos; não consulta serviços externos.

Importação/prévia/exportação em massa exigem `owner` ou `admin`. Membros autenticados podem usar a busca. Documentação dos campos também está em `GET /api/v1/contacts/import/fields`. Todos os dados, prévias, recibos e resultados são isolados pelo tenant da sessão.

Limites: 2 MiB e 2.000 contatos por importação; 10 MiB e 10.000 contatos por exportação. Exportações acima do limite são recusadas, sem truncamento silencioso.
