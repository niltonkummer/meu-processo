# Avaliação 0024 — dispatcher durável da outbox local

**Status:** aprovado somente para desenvolvimento local e CI  
**Data:** 31 de agosto de 2026  
**Teto adicional aprovado:** US$ 0/mês

## Escopo autorizado

- adicionar lease, retry limitado e dead letter à outbox PostgreSQL existente;
- criar role exclusiva e funções estreitas de claim/complete/fail;
- preservar uma tabela de recibos de inbox para consumidores transacionais;
- implementar dispatcher one-shot, adapter em memória/PostgreSQL e testes;
- executar apenas com eventos e credenciais sintéticas no Compose/CI.

## Custo

| Recurso | Uso | Delta mensal |
|---|---:|---:|
| CPU/RAM local | testes e smoke sob demanda | US$ 0 |
| PostgreSQL local | colunas, índice parcial e recibos | US$ 0 |
| GitHub Actions | franquia existente | US$ 0 incremental |
| Cloud Tasks/Pub/Sub/Scheduler/GCP | não ativados | US$ 0 |

## Limites

- batch máximo de 25 eventos e lease entre 30 segundos e 15 minutos;
- payload continua limitado a 4 KiB e não pode carregar plaintext/URL/documento;
- retry é finito, com backoff entre 1 minuto e 24 horas;
- dispatcher não recebe acesso direto a tabelas nem credencial do worker/API;
- publisher local desabilitado falha fechado; nunca confirma entrega fictícia;
- sem chamada a Brevo, tribunal, Supabase ou qualquer fila externa;
- commit, push e deploy não estão autorizados nesta etapa.

## Gate de expansão

Um adapter real para Cloud Tasks, Pub/Sub, Brevo ou webhook exige avaliação de
custo própria, threat model do destino, contrato de idempotência comprovado,
limites por tenant e rollout privado com kill switch.
