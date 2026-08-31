# Implementação 0037 — rollout da fundação GCP de validação

**Status:** aplicada e verificada no ambiente de validação
**Data:** 31 de agosto de 2026
**ADR:** [0023](../adr/0023-two-stage-managed-foundation-activation.md)
**Custo:** [0040](../costs/0040-gcp-validation-foundation-rollout.md)
**Pull request:** [#13](https://github.com/niltonkummer/meu-processo/pull/13)

## Resultado

A fundação passiva do produto foi aplicada no projeto
`meu-processo-507018`, região `southamerica-east1`, após aprovação explícita do
limite conservador de US$ 1,47/mês e teto de segurança de US$ 10/mês.

O plano revisado continha 33 criações, quatro atualizações somente de labels
FinOps, uma leitura e nenhuma exclusão, substituição ou recriação. O apply
concluiu com `33 added, 4 changed, 0 destroyed`. Um plano completo posterior
retornou `No changes`, confirmando que infraestrutura real, configuração e
state remoto estão alinhados.

Foram ativados:

- bucket regional privado para documentos processuais;
- chave KMS dedicada com rotação automática;
- cinco identidades separadas para dispatcher, documentos, lifecycle,
  monitoramento e scheduler;
- sete containers do Secret Manager com IAM mínimo;
- permissões GCS distintas para criar, verificar, ler e administrar lifecycle;
- auditoria de leitura e escrita de dados do Cloud Storage;
- labels obrigatórias `service` e `environment` nos recursos gerenciados.

Nenhum documento, dado pessoal, execução automática, schedule ou valor de
segredo foi criado. O Infisical continua sendo a fonte de verdade; os sete
containers permanecem com zero versões.

## Controles verificados

| Controle | Evidência observada |
|---|---|
| Localização | bucket e workloads em `southamerica-east1` |
| Acesso ao bucket | uniforme, prevenção pública `enforced`, nenhum membro público |
| Proteção dos objetos | CMEK dedicada, versionamento e soft delete de 604.800 segundos |
| Destruição acidental | `force_destroy=false` e lifecycle prevent-destroy no IaC |
| KMS | chave `ENABLED`, rotação de 90 dias, sem membro público |
| Identidades | cinco service accounts habilitadas e separadas por responsabilidade |
| Segredos | sete containers, zero versões, acesso somente por workload autorizado |
| Aplicação | imagem imutável preservada, escala 0–2, `GET /health` respondeu 200 |
| Browser renderer | imagem imutável preservada, escala 0–1, sem acesso público; chamada anônima respondeu 403 |
| State | backend remoto íntegro com 56 endereços após o rollout |
| Drift | plano pós-apply com exit code 0 e nenhuma alteração |

Os serviços Cloud Run receberam uma nova revisão apenas para incorporar labels;
as imagens publicadas permaneceram exatamente as mesmas e ambos ficaram com a
condição `Ready=True`.

## Gates de qualidade

No pull request, todos os gates obrigatórios foram aprovados:

- testes, cobertura de 100%, lint, tipos e build;
- migrations, RLS e contratos PostgreSQL;
- validação Terraform, políticas e segurança de containers;
- auditoria de dependências sem finding High ou Critical;
- diff de custo do Infracost e avaliação de custo aprovada;
- política FinOps bloqueante exigindo `service` e `environment`.

O Infracost modelou delta de US$ 0,02/mês e total de US$ 0,04/mês. Como tráfego,
armazenamento, operações e logs dependem de uso, o limite conservador de
US$ 1,47/mês continua sendo o controle financeiro válido.

## Rollback e próximo gate

Não existe carga para interromper nem dado para migrar. Em incidente, os
serviços atuais podem continuar nas imagens já validadas; a fundação passiva
permanece sem uso. A remoção de KMS e bucket não deve ser automatizada porque
ambos possuem proteção contra destruição e devem seguir procedimento separado,
com inventário vazio e aprovação explícita.

O próximo gate é projetar os valores estritamente necessários do Infisical no
Secret Manager e ativar um workload por vez. Essa etapa deve ter plano próprio,
smoke com dados sintéticos, confirmação de redaction, teste de rollback e nova
verificação de custo antes de habilitar qualquer schedule, worker ou carga
processual.
