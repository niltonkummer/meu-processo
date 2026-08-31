# Cost gate 0025 — projeção local de alertas internos

Status: aprovado para implementação local em 2026-08-31.

## Escopo

- projetar alertas internos a partir da outbox já existente;
- persistir leitura e deduplicação no PostgreSQL local;
- expor listagem e marcação de leitura pela API autenticada;
- executar somente com dados sintéticos no Docker Compose.

## Impacto financeiro

| Item | Alteração | Custo incremental neste marco |
|---|---|---:|
| PostgreSQL local | uma tabela, índices e funções | R$ 0 |
| Dispatcher local | adapter no processo one-shot existente | R$ 0 |
| API local | dois endpoints no container existente | R$ 0 |
| Supabase, Cloud Run, filas e e-mail | não ativados | R$ 0 |

Não há provisionamento, tráfego externo, armazenamento gerenciado ou envio de
mensagens neste marco. Antes de habilitar qualquer ambiente remoto será exigida
nova estimativa Infracost/orçamento, limites de consumo e autorização explícita.

