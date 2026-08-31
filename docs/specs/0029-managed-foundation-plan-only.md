# Spec 0029 — fundação gerenciada plan-only

**Status:** aceita para implementação local/CI  
**Data:** 31 de agosto de 2026  
**Custo:** [Avaliação 0036](../costs/0036-managed-foundation-plan-only.md)  
**Decisão:** [ADR 0023](../adr/0023-two-stage-managed-foundation-activation.md)

## 1. Objetivo

Representar em Terraform a base passiva necessária para levar o produto
principal ao Google Cloud, sem criar, alterar ou consumir recurso externo.

## 2. Requisitos funcionais

- `managed_foundation_enabled=false` é o padrão;
- habilitar a flag exige acknowledgement textual de plan-only;
- quando habilitada em um plano, declarar um bucket privado e regional;
- declarar secret containers separados por finalidade, sem versões/valores;
- declarar identidades distintas para monitoramento, outbox, documentos, ciclo
  de vida e invocação futura;
- conceder IAM somente no bucket/secret necessário ao workload;
- expor apenas nomes/IDs não sensíveis como outputs;
- não declarar Job ou Scheduler ativável neste gate.

## 3. Requisitos de storage

- `southamerica-east1`, Standard, acesso uniforme e prevenção pública enforced;
- CMEK separada da chave de artefatos;
- `force_destroy=false`, deletion policy e lifecycle `prevent_destroy`;
- versionamento e soft delete de sete dias;
- excluir versões arquivadas após sete dias;
- abortar uploads multipart incompletos após um dia;
- habilitar Cloud Audit Logs `DATA_READ` e `DATA_WRITE` para o serviço de
  storage; não usar o mecanismo legado de access logs em outro bucket;
- API recebe somente leitura; materializador recebe criação; ciclo de vida
  recebe gestão de objetos; demais workloads não recebem storage.

## 4. Requisitos de secrets

Secret IDs necessários:

- database URL da API;
- database URL de monitoring worker;
- database URL de dispatcher;
- database URL de document worker;
- database URL de lifecycle worker;
- keyring de encryption de identificadores;
- blind-index key.

Cada secret usa replicação regional e deletion protection. Terraform não cria
`google_secret_manager_secret_version`, lê data source de valor ou produz output
sensível. API e lifecycle recebem keyring/blind index; monitoring recebe ambos;
dispatcher e document worker recebem somente sua conexão.

## 5. Testes de aceitação

- plano padrão possui zero recurso da fundação gerenciada;
- plano opt-in cria exatamente um bucket, uma CMEK, sete secret containers e
  cinco identidades adicionais;
- bucket e secrets têm proteção contra destruição;
- auditoria de leitura e escrita do bucket está declarada;
- nenhum membro `allUsers`/`allAuthenticatedUsers` existe;
- IAM de cada workload coincide com a matriz desta spec;
- `terraform fmt`, init sem backend, validate e test passam;
- TFLint, Checkov e Trivy não possuem finding High/Critical não justificado;
- Infracost e avaliação manual permanecem dentro do limite;
- scans confirmam ausência de secret value e `.tfstate` no Git.

## 6. Fora de escopo

Apply/import, secret versions/sync, Supabase remoto, migrations remotas, GCS
adapter, uploads, Cloud Run Jobs, Scheduler, Brevo, fonte real e dados pessoais.
