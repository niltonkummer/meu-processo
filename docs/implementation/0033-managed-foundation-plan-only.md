# Implementação 0033 — fundação gerenciada plan-only

**Status:** implementada e verificada localmente  
**Data:** 31 de agosto de 2026  
**Spec:** [0029](../specs/0029-managed-foundation-plan-only.md)  
**ADR:** [0023](../adr/0023-two-stage-managed-foundation-activation.md)  
**Custo:** [0036](../costs/0036-managed-foundation-plan-only.md)

## Resultado

O Terraform agora representa a base passiva do produto principal atrás de
`managed_foundation_enabled=false`. O plano opt-in contém:

- um bucket GCS regional, privado, CMEK, versionado e protegido;
- sete secret containers regionais, sem values ou versions;
- cinco service accounts separadas além da identidade existente da API;
- IAM por bucket/secret com matriz mínima por workload;
- Cloud Audit Logs para leituras e escritas de objetos;
- nenhum Cloud Run Job, Scheduler ou conexão remota ativável.

O nome `infracost.tfvars` é intencional: ele contém somente valores sintéticos,
não é auto-carregado e faz o Infracost enxergar o cenário opt-in. O deploy não
usa esse arquivo. O ponteiro de custo seleciona a avaliação 0036, cujo status
não permite rollout.

## Testes implementados

- plano padrão sem recursos da fundação;
- plano opt-in com um bucket, sete secrets e cinco identidades;
- PAP, uniform access, versioning, soft delete e deletion protection;
- roles de objeto distintas para API, materializador e lifecycle;
- accessor mínimo e allowlist de workloads para secrets;
- acknowledgement obrigatório para opt-in;
- Terraform fmt/validate/test, TFLint, Checkov e Trivy no CI;
- Infracost com inputs sintéticos dedicados para baseline e candidate.

## Evidência de verificação

Em 31/08/2026, sem autenticar ou alterar qualquer conta externa:

- `terraform fmt -check -recursive`, `validate` e cinco testes nativos: verdes;
- TFLint local e pela imagem fixada no CI: verdes;
- Checkov no cenário opt-in: 16 checks aprovados, zero falhas e um skip
  documentado para substituir access logs legados por Cloud Audit Logs;
- Trivy no cenário opt-in: zero misconfigurations High/Critical;
- Actionlint, Compose e `git diff --check`: verdes;
- suíte da aplicação: 77 arquivos, 948 testes e núcleo com 100% de cobertura;
- lint, tipos, OpenAPI, build e auditoria sem vulnerabilidades High/Critical:
  verdes.

O breakdown/diff real do Infracost permanece no workflow de pull request. A
chave não está disponível no ambiente local e não foi buscada em conta externa;
por isso, a estimativa manual conservadora da avaliação 0036 continua sendo a
evidência de custo deste gate.

## Bootstrap futuro — ainda bloqueado

1. ~~implementar adapters GCS e contract tests equivalentes ao store local~~ —
   concluído pela Implementação 0034;
2. validar Supabase/Supavisor com roles existentes e migrations assinadas;
3. criar secret containers em apply de bootstrap aprovado;
4. configurar Infisical Secret Sync com deleção remota desabilitada;
5. verificar versões e piná-las em uma revision/job candidata;
6. declarar Jobs/Scheduler pausados, executar smoke manual e só então agendar;
7. medir sete dias de custo, egress, pool, logs e backlog.

Nenhum passo acima está autorizado por esta implementação.
