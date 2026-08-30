# Registro de risco 0001 — advisories transitivos dos SDKs Firebase

**Status:** aceito temporariamente conforme SLA de vulnerabilidade Medium
**Responsável:** engenharia
**Registrado em:** 30 de agosto de 2026
**Expira em:** 29 de setembro de 2026
**Revisão antecipada:** nova versão de `firebase-admin` ou `firebase-tools`

## Resultado do scanner

`npm audit --audit-level=high` passa, com zero vulnerabilidades Critical/High.
O relatório completo contém nove nós transitivos Medium, derivados de dois
advisories:

| Advisory | Pacote afetado | Caminho relevante | Exploração no produto |
|---|---|---|---|
| [GHSA-8988-4f7v-96qf](https://github.com/advisories/GHSA-8988-4f7v-96qf) | `@opentelemetry/core < 2.8.0` | `firebase-tools` → `@google-cloud/pubsub` | Não alcançável no runtime; `firebase-tools` é dependência de desenvolvimento e existe somente no estágio do emulador local. O produto não recebe nem propaga W3C Baggage nesse estágio. |
| [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) | `uuid < 11.1.1` | `firebase-admin` → `@google-cloud/storage` e `firebase-tools` → `gaxios` | A falha exige uso de UUID v3/v5/v6 com buffer fornecido. O código importa apenas Firebase App/Auth e nunca chama essas funções nem fornece buffer controlado pelo usuário. |

Os nove itens são a propagação desses dois advisories por
`@google-cloud/pubsub`, `@google-cloud/storage`, `gaxios`, `retry-request` e
`teeny-request`; não representam nove vulnerabilidades independentes.

## Decisão e controles compensatórios

- manter `firebase-admin@14.3.0` e `firebase-tools@15.28.2`, as versões atuais
  verificadas no início da implementação;
- não executar `npm audit fix --force`, pois o remédio proposto faz downgrade
  major para versões antigas e não constitui atualização segura;
- remover dependências de desenvolvimento da imagem final com
  `npm prune --omit=dev`;
- importar no runtime somente `firebase-admin/app` e `firebase-admin/auth`;
- não usar UUID v3/v5/v6 nem aceitar buffers para geração de UUID;
- manter scanner de dependências e Trivy bloqueando Critical/High;
- revisar semanalmente versões upstream até a expiração.

## Condição de encerramento

Atualizar para versões oficiais que removam os caminhos vulneráveis, executar
suíte, auditoria, build e scan de imagem, e então marcar este registro como
encerrado. Se a correção não existir até 29/09/2026, uma nova decisão explícita
é obrigatória; este registro não pode ser renovado silenciosamente.
