# Avaliação 0021 — worker local de monitoramento

**Status:** aprovado somente para desenvolvimento local e CI  
**Data:** 30 de agosto de 2026  
**Teto adicional aprovado:** US$ 0/mês

**Resultado em 31/08/2026:** cadastro atômico, persistência, contracts, restore e
worker one-shot concluídos localmente dentro do teto, sem acesso externo.

## Escopo autorizado

- especificar o gatilho e o ciclo de execução do worker;
- criar contratos, state machine, outbox e leases usando PostgreSQL descartável;
- executar somente adapters sintéticos/fakes em testes;
- ampliar Compose e CI sem chamar tribunais, Supabase, Infisical, Brevo ou GCP;
- usar exclusivamente identificadores e resultados sintéticos.

## Custo desta etapa

| Recurso | Uso | Delta mensal |
|---|---:|---:|
| CPU/RAM local | testes e Compose sob demanda | US$ 0 |
| PostgreSQL local | volume descartável | US$ 0 |
| GitHub Actions | dentro da franquia existente | US$ 0 incremental |
| Cloud Scheduler, Tasks, Run Jobs ou Workflows | não provisionados | US$ 0 |
| Supabase/Infisical/GCS/Brevo | não acessados | US$ 0 |

## Limites obrigatórios

- a entrada DJEN permanece desabilitada enquanto termos, limites e operação não
  forem aprovados;
- plaintext pode existir apenas na memória do processo worker durante uma
  execução autorizada; nunca em banco, outbox, log, métrica ou erro;
- nenhum loop permanente ou recurso cloud será criado nesta etapa;
- a validação local deve remover containers e volumes sintéticos ao terminar;
- deploy, commit e push continuam fora do escopo sem autorização explícita.

## Gate para cloud

Antes de ativar Scheduler/Cloud Run worker devem existir estimativas para
10, 1.000 e 10.000 perfis, teto mensal, quotas por fonte, egress, tempo máximo,
alertas de backlog e kill switch. Workflows só será considerado se houver uma
orquestração multi-etapa que não caiba em um job idempotente.
