# Avaliação de custo 0040 — rollout da fundação GCP de validação

<!-- infra-cost-assessment:v1 -->

**Status:** aplicado e verificado no ambiente de validação
**Solicitado por:** proprietário do produto  
**Responsável:** engenharia do Meu Processo  
**Data da avaliação:** 31 de agosto de 2026  
**Ambientes afetados:** validation no projeto `meu-processo-507018`  
**Spec/issue:** ativação controlada da fundação preparada na avaliação 0036

**Custo mensal atual (USD):** até US$ 0,38 já aprovado  
**Custo mensal esperado (USD):** até US$ 1,47 no total; delta de até US$ 1,09  
**Custo mensal limite (USD):** US$ 10,00, com interrupção antes do excesso  
**Aprovação:** proprietário do produto, aprovado explicitamente em 31/08/2026

## 1. Decisão proposta

Autorizar um rollout de validação pequeno, reversível e sem carga automática da
fundação já preparada em Terraform:

- um bucket GCS privado, regional e criptografado para documentos processuais;
- uma chave Cloud KMS adicional para os objetos;
- cinco service accounts de workloads com privilégio mínimo;
- sete containers do Secret Manager, sem valores no Terraform, usados somente
  como projeção controlada do Infisical;
- IAM mínimo para leitura, criação e lifecycle de objetos;
- Cloud Audit Logs de leitura e escrita do bucket.

O Infisical permanece a fonte de verdade dos segredos. O rollout não autoriza
varrer bases judiciais, carregar CPF/CNPJ/nome, baixar documentos, executar
workers, criar schedules, enviar e-mail, habilitar IA ou aumentar instâncias
mínimas. Os dois serviços atuais do produto continuam com escala mínima zero.

## 2. Inventário confirmado antes do rollout

Inventário somente leitura obtido em 31/08/2026:

| Componente | Estado atual confirmado |
|---|---|
| Cloud Run | `meu-processo-mvp` (máx. 2, mín. 0) e browser renderer (máx. 1, mín. 0) |
| GCS | somente buckets de estado Terraform e source deploy; bucket de processos ausente |
| KMS | key ring existente com uma chave de Artifact Registry |
| Service accounts | runtime e renderer existentes; cinco identidades especializadas ausentes |
| Secret Manager | API desativada e nenhum container gerenciado |
| Artifact Registry | repositórios existentes; nenhum novo repositório necessário |
| Terraform remoto | 21 endereços sob gestão; fundação passiva ainda ausente |

O rollout deve reaproveitar key ring, runtime identity, Artifact Registry,
Cloud Run e backend GCS existentes. Ele não pode recriar esses recursos.

## 3. Alteração e estimativa mensal

| Componente/SKU | Região | Estado proposto | Cenário piloto | Delta mensal máximo |
|---|---|---|---:|---:|
| GCS Standard regional | `southamerica-east1` | bucket privado com versionamento e soft delete de 7 dias | 10 GiB médios | US$ 0,20 |
| Operações GCS classe A | `southamerica-east1` | uploads/listagens controlados | 10.000/mês | US$ 0,05 |
| Operações GCS classe B | `southamerica-east1` | leituras/metadados controlados | 50.000/mês | US$ 0,02 |
| Saída de documentos | Brasil para usuário | downloads autenticados | 5 GiB/mês | até US$ 0,60 |
| Cloud KMS | `southamerica-east1` | uma versão de chave software adicional | 1 | cerca de US$ 0,06 |
| Secret Manager | `southamerica-east1` | sete versões ativas projetadas do Infisical | 7 | cerca de US$ 0,06 |
| Service accounts e IAM | global/regional | cinco identidades e bindings mínimos | 5 | US$ 0 |
| Cloud Audit Logs | projeto | DATA_READ e DATA_WRITE do GCS | uso piloto | incluído no teto |
| Cloud Run | `southamerica-east1` | nenhuma nova instância mínima ou serviço | mín. 0 | US$ 0 incremental esperado |
| Scheduler/Jobs | `southamerica-east1` | não criados nesta avaliação | 0 | US$ 0 |
| **Delta conhecido** | — | — | — | **até US$ 1,09** |

O custo mensal conhecido passa de até US$ 0,38 para até US$ 1,47. O teto de
US$ 10,00 cobre logs, variação de franquias e arredondamento, mas não autoriza
consumir o teto como meta.

## 4. Premissas e cenários

Preços em USD, sem impostos e consultados em 31/08/2026. Franquias podem estar
parcialmente consumidas por outros recursos da mesma billing account; por isso
o cálculo não depende delas, exceto onde indicado como custo esperado zero.

| Direcionador | Base atual | Esperado em 30 dias | Limite operacional | Unidade |
|---|---:|---:|---:|---|
| Objetos processuais armazenados | 0 | até 10 | 10 | GiB-mês |
| Operações classe A | 0 | até 10.000 | 10.000 | operações/mês |
| Operações classe B | 0 | até 50.000 | 50.000 | operações/mês |
| Saída de documentos | 0 | até 5 | 5 | GiB/mês |
| Execuções automáticas de worker | 0 | 0 | 0 | execuções/mês |
| Instâncias mínimas novas | 0 | 0 | 0 | instâncias |
| Retenção de soft delete | 0 | 7 | 7 | dias |
| Versões ativas de segredo | 0 | 7 | 7 | versões |

Versões antigas e soft-deleted do GCS também ocupam armazenamento; os 10 GiB
incluem essa margem no piloto. Não existe custo único de migração ou backfill
porque nenhum dado processual será copiado neste rollout.

## 5. Custos não cobertos automaticamente

- Cloud Run e logs variam com tráfego real, tempo de execução e volume.
- GCS varia com objetos, versões, operações, retrieval e egress.
- Tráfego Supabase AWS São Paulo para GCP São Paulo pode ser cobrado pelo
  provedor de origem e será medido antes de habilitar workers.
- Supabase Free e Infisical não recebem upgrade nesta avaliação.
- Brevo, fontes judiciais, proxy, IA, suporte, impostos e câmbio ficam fora do
  rollout e exigem avaliação própria antes de uso pago.
- O diff autenticado do Infracost no pull request estimou aumento modelado de
  US$ 0,02/mês e novo total modelado de US$ 0,04/mês. Custos dependentes de uso
  não são totalmente modelados; por isso o limite conservador aprovado de
  US$ 1,47/mês permanece autoritativo.

## 6. Limites e condições de parada

- manter todas as instâncias mínimas em zero e não criar Cloud Run Job ou
  Cloud Scheduler neste rollout;
- bucket com acesso uniforme, prevenção pública, CMEK, versionamento,
  soft delete de sete dias, `force_destroy=false` e proteção contra destruição;
- nenhum segredo, token ou URL de banco no Terraform, state, plano ou log;
- habilitar Secret Manager somente como parte do apply aprovado e criar no
  máximo sete containers e sete versões ativas;
- aplicar exclusivamente o plano revisado do ambiente `validation`;
- bloquear se o plano tentar substituir ou destruir recurso existente;
- bloquear se Infracost indicar total superior a US$ 1,47/mês ou delta superior
  a US$ 1,09/mês sem nova aprovação;
- configurar budget/alertas ou confirmar cobertura por budget existente antes
  de liberar qualquer carga automática;
- findings High/Critical, regressão de testes/cobertura, IAM amplo, objeto
  público ou ausência de rollback bloqueiam o rollout;
- a avaliação expira em 30/09/2026 ou quando preços, região, volume, retenção ou
  arquitetura mudarem, o que ocorrer primeiro.

Somente o proprietário do produto pode aceitar aumento. Novo SKU faturável,
mais de US$ 5 ou 20% de aumento, retenção maior, egress entre regiões ou consumo
sem limite exige nova avaliação explícita.

## 7. Evidência e fontes

- [Cloud Storage — preços](https://cloud.google.com/storage/pricing), acessado em 31/08/2026;
- [Cloud KMS — preços](https://cloud.google.com/kms/pricing), acessado em 31/08/2026;
- [Secret Manager — preços](https://cloud.google.com/secret-manager/pricing), acessado em 31/08/2026;
- [Cloud Run — preços](https://cloud.google.com/run/pricing), acessado em 31/08/2026;
- inventário `gcloud` somente leitura e lista do state Terraform remoto em
  31/08/2026, sem leitura de valores de segredo;
- avaliação 0036 e evidências de Supabase/TLS/RLS em 0039 e implementação 0036.

## 8. Aprovação

O proprietário do produto aprovou explicitamente em 31/08/2026 o total
conhecido de até **US$ 1,47/mês**, o delta de até **US$ 1,09/mês** e o teto de
parada de **US$ 10/mês** para o ambiente de validação. A aprovação libera a
alteração e os testes do IaC, o plano revisado e o rollout de validação. O
`terraform apply` permanece condicionado a plano sem destruições, gates verdes
e registro de evidência no mesmo checkpoint.

## 9. Verificação posterior

| Data | Custo estimado | Custo real | Variação | Explicação | Ação |
|---|---:|---:|---:|---|---|
| 31/08/2026 | US$ 0,04/mês modelados; até US$ 1,47/mês conservadores | pendente | pendente | rollout passivo aplicado, sem carga, schedules ou versões de segredo | manter e observar |
| +7 dias | até US$ 1,47/mês | pendente | pendente | conferir Billing e logs | manter ou rollback |
| +30 dias | até US$ 1,47/mês | pendente | pendente | recalibrar volumes | nova avaliação |

O plano aplicado continha 33 criações, quatro atualizações somente de labels e
nenhuma destruição ou substituição. A verificação posterior confirmou plano
Terraform sem alterações. A evidência operacional completa está registrada na
[implementação 0037](../implementation/0037-gcp-validation-foundation-rollout.md).
