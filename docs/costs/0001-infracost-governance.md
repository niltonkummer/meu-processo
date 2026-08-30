# Avaliação de custo 0001 — governança FinOps e Infracost

<!-- infra-cost-assessment:v1 -->

**Status:** aprovado para implementação
**Solicitado por:** proprietário do produto
**Responsável:** engenharia
**Data da avaliação:** 29 de agosto de 2026
**Ambientes afetados:** repositório e integração contínua
**Referência:** inclusão de custo de infraestrutura antes de qualquer alteração

**Custo mensal atual (USD):** 0 de impacto desta mudança
**Custo mensal esperado (USD):** 0 enquanto coberto pelas franquias aplicáveis
**Custo mensal limite (USD):** tarifa de até 180 minutos adicionais de GitHub Actions
**Aprovação:** solicitação explícita do proprietário em 29 de agosto de 2026

## 1. Decisão

Adicionar um gate obrigatório de custo antes da implementação. Todo pull request deverá incluir uma avaliação versionada, mesmo quando o impacto esperado for zero. Mudanças Terraform também deverão apresentar um diff automatizado do Infracost antes da aprovação.

Esta avaliação autoriza apenas a criação dos documentos e checks de governança descritos aqui. Ela não autoriza criação, alteração ou remoção de recursos no Google Cloud.

## 2. Alteração de infraestrutura

| Componente | Estado atual | Estado proposto | Alteração faturável |
|---|---|---|---:|
| Google Cloud | Sem mudança causada por este trabalho | Sem mudança | US$ 0/mês |
| GitHub Actions | Pipeline atual | Um job curto de governança por pull request | Variável conforme minutos incluídos no plano |
| Infracost | Não configurado no repositório | Diff para pull requests internos com Terraform | Confirmar franquia/plano da organização antes de habilitar o token |
| Armazenamento de artefatos | Sem relatório de custo | Sem artefato persistente adicional nesta fase | US$ 0/mês |

## 3. Premissas e cenários

O custo canônico é registrado em USD, sem impostos. Não há conversão para BRL nesta avaliação porque nenhuma cobrança fixa nova foi aprovada.

| Cenário | Pull requests/mês | PRs com Terraform/mês | Minutos adicionais estimados | Custo incremental esperado |
|---|---:|---:|---:|---:|
| Base atual | 0 | 0 | 0 | US$ 0 |
| Esperado | 20 | 2 | até 30 | US$ 0 enquanto coberto pela franquia; caso contrário, minutos × tarifa do plano |
| Limite operacional | 100 | 20 | até 180 | minutos × tarifa do plano, sujeito a aprovação antes de exceder a franquia |

Premissas:

- o check documental deve terminar em menos de um minuto;
- o diff Infracost deve executar somente quando houver alteração em `infra/terraform`;
- pull requests de forks não recebem o segredo do Infracost e devem ser reenviados ou executados em contexto interno confiável;
- nenhuma credencial de nuvem é usada e nenhum `terraform apply` é executado;
- o workflow terá timeout para impedir consumo não limitado.

## 4. Custos não cobertos automaticamente

O Infracost estima recursos representados em IaC, mas não substitui a modelagem de consumo. Cada avaliação futura continuará declarando, quando aplicável:

- requisições, vCPU-segundo e GiB-segundo do Cloud Run;
- leituras, escritas, exclusões e armazenamento do Firestore;
- GiB-mês, operações, recuperação e saída de rede do Cloud Storage;
- operações do Cloud Tasks, Scheduler, Pub/Sub e Jobs;
- volume e retenção de logs;
- tráfego entre regiões e para a internet;
- e-mail, APIs externas, IA e outros custos que não estejam no Terraform.

## 5. Limites e condição de parada

- Nenhum serviço faturável novo pode ser ativado apenas para este gate.
- O token `INFRACOST_API_KEY` deve ser configurado como secret do GitHub, nunca em arquivo.
- Ausência da avaliação ou do diff aplicável bloqueia merge.
- Aumento mensal esperado maior que US$ 5, aumento superior a 20% sobre a base, novo SKU, retenção maior ou consumo sem limite exige aprovação explícita do proprietário.
- Se o gate exceder 180 minutos adicionais por mês, sua frequência e implementação deverão ser revistas antes de continuar.

## 6. Evidência e acompanhamento

Fontes consultadas em 29 de agosto de 2026:

- [Infracost — integração com GitHub Actions](https://www.infracost.io/docs/integrations/github_actions/)
- [Infracost Actions — ação oficial de diff](https://github.com/infracost/actions/tree/master/diff)
- [GitHub — faturamento do GitHub Actions](https://docs.github.com/en/billing/concepts/product-billing/github-actions)

Após 30 dias de uso, registrar nesta avaliação:

- quantidade de execuções;
- minutos efetivamente consumidos;
- eventual cobrança do Infracost ou GitHub Actions;
- divergência entre a estimativa e o custo real;
- decisão de manter, otimizar ou substituir a integração.

## 7. Aprovação

A solicitação explícita do proprietário em 29 de agosto de 2026 aprova esta mudança de governança dentro dos limites acima. Commit, push, merge, configuração de segredo e habilitação de branch protection continuam exigindo ação ou autorização separada.
