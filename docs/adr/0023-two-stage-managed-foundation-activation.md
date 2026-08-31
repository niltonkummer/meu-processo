# ADR 0023 — ativação em duas etapas da fundação gerenciada

**Status:** fundação passiva aprovada para rollout de validação
**Data:** 31 de agosto de 2026  
**Custo:** [Avaliação 0040](../costs/0040-gcp-validation-foundation-rollout.md)
**Relacionado:** ADRs [0016](./0016-managed-supabase-postgres.md),
[0017](./0017-infisical-secrets-control-plane.md) e
[0020](./0020-worker-trigger-and-privilege-boundary.md)

## Contexto

A aplicação local já possui PostgreSQL, roles por workload, RLS, outbox,
workers one-shot e object store privado. O Terraform existente, porém, ainda
representa a validação inicial em Cloud Run e não declara a base passiva do
produto principal. Declarar jobs e schedules antes de existir adapter GCS e
fonte real criaria uma rota de ativação insegura: os workers de documentos e
ciclo de vida ainda usam filesystem local e o worker de monitoramento não
possui fonte registrada.

## Decisão

Separar a adoção cloud em duas etapas independentes:

1. **fundação passiva:** bucket privado, CMEK, secret containers sem versões,
   service accounts e IAM mínimo, atrás de uma flag falsa por padrão e de um
   acknowledgement exato, restrito ao ambiente autorizado;
2. **runtime ativo:** Secret Sync, versões pinadas, adapters cloud, Cloud Run
   Jobs, Scheduler, migrations e tráfego; exige spec, custo e aprovação novos.

Terraform nunca recebe valores de segredo. Infisical permanece a única fonte
editável; Secret Manager contém somente a projeção materializada. A fundação
passiva não referencia `latest`, não cria versões e não executa workloads.

O bucket é regional em São Paulo, não público, com acesso uniforme, CMEK,
versionamento, soft delete curto, limpeza de versões antigas e bloqueios de
destruição. IAM é concedido no recurso, nunca por papel amplo de projeto.

## Consequências

- um plano pode ser revisado sem criar custo ou depender de credencial real;
- `apply` acidental continua bloqueado pelo workflow e pela avaliação sem
  autorização de rollout;
- a etapa ativa só começa quando cada workload possuir adapter compatível e
  teste de integração;
- haverá um bootstrap explícito entre criar secret containers, sincronizar
  versões e implantar revisions/jobs que as consumam;
- quatro jobs futuros continuam no modelo de custo, mas não entram neste estado.

## Alternativas rejeitadas

- **Declarar jobs desabilitados agora:** ainda expõe uma flag capaz de iniciar
  código incompatível com storage cloud.
- **Injetar valores por variável Terraform:** persiste segredo em plan/state.
- **Cloud Run com volume local:** o filesystem é descartável e não serve como
  armazenamento de evidência.
- **Um service account para todos os workloads:** amplia o blast radius.
- **Scheduler chamando rota pública:** quebra a fronteira privilegiada.

## Gate para a etapa ativa

Exigir adapter GCS com contract tests, fonte allowlisted, secret versions
sincronizadas, migrations aplicadas em sandbox, restore, plano/Infracost,
threat model atualizado e aprovação explícita de rollout.
