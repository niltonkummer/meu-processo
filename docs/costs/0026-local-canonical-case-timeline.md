# Cost gate 0026 — linha do tempo processual canônica local

Status: aprovado para implementação local em 2026-08-31.

## Escopo

- ampliar o contrato sintético de observação com fatos mínimos de evento;
- persistir eventos e vínculos à evidência no PostgreSQL local;
- expor a linha do tempo paginada pela API autenticada;
- fazer alertas internos apontarem para o evento exato;
- executar testes somente com dados sintéticos no Docker Compose.

## Impacto financeiro

| Item | Alteração | Custo incremental neste marco |
|---|---|---:|
| PostgreSQL local | duas tabelas, índices e funções | R$ 0 |
| Worker/dispatcher local | payload interno ampliado, sem fila externa | R$ 0 |
| API local | leitura no container existente | R$ 0 |
| Cloud Storage, Supabase remoto, GCP e Brevo | não ativados | R$ 0 |

O marco não provisiona infraestrutura, não coleta dados reais e não gera
tráfego externo. Ativação remota exige nova avaliação de custo e autorização.

