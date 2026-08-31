# Avaliação de custo 0036 — fundação gerenciada em modo plan-only

<!-- infra-cost-assessment:v1 -->

**Status:** aprovado para implementação  
**Solicitado por:** proprietário do produto  
**Responsável:** engenharia do Meu Processo  
**Data da avaliação:** 31 de agosto de 2026  
**Ambientes afetados:** repositório, testes locais e CI  
**Spec/issue:** preparar a fundação do produto principal sem ativar recursos

**Custo mensal atual (USD):** até US$ 0,38 já aprovado  
**Custo mensal esperado (USD):** inalterado; delta deste gate US$ 0  
**Custo mensal limite (USD):** inalterado neste gate; nenhuma mutação cloud  
**Aprovação:** continuação explícita do plano pelo proprietário em 31/08/2026,
restrita a documentação, IaC, testes, scanners, Infracost e planos sem `apply`

## 1. Decisão

Preparar, sem ativar, a infraestrutura gerenciada mínima do produto principal:

- bucket GCS privado e regional para evidências, documentos e exportações;
- containers de Secret Manager sem valores, para projeção futura do Infisical;
- identidades separadas para API, workers e Scheduler;
- fronteira preparada para Cloud Run Jobs/Scheduler futuros, mas sem declarar
  workloads ativáveis enquanto os adapters cloud não existirem;
- IAM mínimo por workload, proteção contra destruição e lifecycle de storage;
- testes nativos do Terraform, Checkov/Trivy, Infracost e documentação de
  bootstrap/rollback.

Este gate não autoriza `terraform apply`, criação de versão de segredo, Secret
Sync, conexão ao Supabase, execução de worker, agendamento ativo, upload,
download, egress, dado pessoal, migração remota, e-mail ou fonte judicial real.

## 2. Alteração de infraestrutura

| Componente/SKU | Região | Alteração neste gate | Quantidade aplicada | Delta mensal |
|---|---|---|---:|---:|
| Terraform/CI | local/GitHub | código, testes e planos | 0 recurso cloud | US$ 0 |
| GCS privado | `southamerica-east1` | somente declaração protegida | 0 bucket | US$ 0 |
| Secret Manager | `southamerica-east1` | somente metadados declarados | 0 secret/version | US$ 0 |
| Cloud Run Jobs | `southamerica-east1` | não declarados neste gate | 0 job/execução | US$ 0 |
| Cloud Scheduler | `southamerica-east1` | não declarado neste gate | 0 schedule | US$ 0 |
| Supabase/Infisical/Brevo | externo | sem acesso ou alteração | 0 | US$ 0 |

Infracost pode não representar consumo variável de Cloud Run, operações e
egress; a tabela de cenário abaixo continua obrigatória mesmo quando o diff
automatizado indicar zero.

## 3. Cenário de ativação futuro — não autorizado

Estimativa conservadora para um piloto posterior, usando preços públicos
consultados em 31/08/2026. Ela serve para dimensionar o desenho, não para
autorizar rollout.

| Direcionador | Cenário piloto | Estimativa mensal |
|---|---:|---:|
| GCS Standard regional | 10 GiB médios | US$ 0,20 |
| Operações GCS classe A | 10.000 | US$ 0,05 |
| Operações GCS classe B | 50.000 | US$ 0,02 |
| Saída de documentos | 5 GiB | até US$ 0,60 |
| Cloud Scheduler | 4 jobs; 3 gratuitos por billing account | até US$ 0,10 |
| Secret Manager | 7 versões ativas; 6 gratuitas | cerca de US$ 0,06 |
| Cloud KMS | 1 versão de chave CMEK adicional | cerca de US$ 0,06 |
| Cloud Run API/Jobs | escala a zero, dentro das franquias assumidas | US$ 0 |
| **Delta piloto conhecido** | antes de logs e egress cross-cloud | **até US$ 1,09** |

Com a base já aprovada de até US$ 0,38, o total conhecido seria de até
**US$ 1,47/mês**. O teto de segurança para uma avaliação futura permanece
**US$ 10/mês**, mas qualquer ativação exige aprovação separada mesmo abaixo
desse teto.

Premissas:

- Standard regional custa aproximadamente US$ 0,02/GiB-mês;
- operações Standard em região única custam US$ 0,005/1.000 classe A e
  US$ 0,0004/1.000 classe B;
- a estimativa de saída usa US$ 0,12/GiB como limite conservador;
- quatro schedules são contabilizados mesmo pausados após criação;
- franquias são agregadas por billing account e podem já estar consumidas;
- CPU/memória de Cloud Run, logs e tráfego Supabase AWS São Paulo → GCP São
  Paulo precisam de medição real antes do rollout.

## 4. Guardrails de custo e segurança

- `managed_foundation_enabled` fica falso por padrão e exige acknowledgement;
- não existe flag de runtime/schedule neste gate;
- a etapa ativa futura deverá manter escala a zero, lote e concorrência limitados;
- GCS usa acesso uniforme, prevenção pública, encryption, lifecycle e proteção
  contra destruição; nenhum objeto é público ou servido por URL permanente;
- Terraform declara apenas secret IDs; nenhum valor/versão entra em HCL,
  variável, output, plano ou state;
- Infisical continua fonte de verdade e Secret Manager será somente projeção;
- cada workload acessa apenas seus secrets e objetos necessários;
- planos não podem ser publicados se contiverem material sensível;
- aumento acima de US$ 5/mês ou 20%, novo SKU, retenção maior ou consumo sem
  limite exige nova aprovação explícita.

## 5. Condições de parada

Interromper este gate se qualquer comando tentar:

- autenticar ou mutar Google Cloud, Supabase, Infisical ou Brevo;
- executar `terraform apply`, import ou operação de state remoto;
- criar secret version, bucket, job, schedule, IAM ou API habilitada;
- utilizar credencial real em teste/plan;
- habilitar schedule, fonte real, envio de e-mail ou dado pessoal;
- aceitar finding High/Critical ou redução de cobertura.

## 6. Evidência e fontes

- [Cloud Storage — preços](https://cloud.google.com/storage/pricing), incluindo
  storage regional, operações e transferência;
- [Cloud Run — preços](https://cloud.google.com/run/pricing), escala a zero,
  CPU, memória e jobs;
- [Cloud Scheduler — preços](https://cloud.google.com/scheduler/pricing),
  US$ 0,10/job-mês e três jobs gratuitos por billing account;
- [Secret Manager — preços](https://cloud.google.com/secret-manager/pricing),
  seis versões ativas e 10.000 acessos gratuitos;
- [Cloud KMS — preços](https://cloud.google.com/kms/pricing), versão de chave
  software e operações criptográficas;
- [Provider Google — storage bucket](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/storage_bucket);
- [Cloud Run — agendar jobs](https://cloud.google.com/run/docs/execute/jobs-on-schedule);
- ADRs 0016, 0017 e 0020 e Plano 0010.

## 7. Aprovação

Status **aprovado para implementação** apenas no repositório e no CI. Não
autoriza commit, push, PR, deploy, `apply`, acesso a contas, sync de segredo ou
consumo externo. A avaliação de rollout deverá substituir explicitamente esse
status por `aprovado para implementação e rollout de validação` após plano,
Infracost, threat model, restore e aprovação do proprietário.

## 8. Verificação posterior

Não existe custo cloud a verificar neste gate e nenhum recurso externo foi
criado. A verificação local de 31/08/2026 concluiu:

| Evidência | Resultado |
|---|---|
| Terraform fmt/validate/test | 5 testes aprovados, zero falhas |
| TFLint | aprovado localmente e pela imagem fixada no CI |
| Checkov opt-in | 16 aprovados, zero falhas, um skip documentado |
| Trivy config opt-in | zero misconfigurations High/Critical |
| Infracost local | não executado: chave ausente e nenhuma conta externa acessada |

O breakdown/diff automatizado permanece obrigatório no pull request confiável,
onde a chave fica protegida pelo GitHub. Até lá, a projeção conservadora de até
US$ 1,09 de delta futuro — ainda não autorizado — é o limite de planejamento.
