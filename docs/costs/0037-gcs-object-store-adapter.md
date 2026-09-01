# Avaliação de custo 0037 — adapter GCS sem rollout

<!-- infra-cost-assessment:v1 -->

**Status:** aprovado para implementação  
**Solicitado por:** proprietário do produto  
**Responsável:** engenharia do Meu Processo  
**Data da avaliação:** 31 de agosto de 2026  
**Ambientes afetados:** código, testes locais e CI  
**Spec/issue:** substituir object stores locais por contrato GCS opt-in

**Custo mensal atual (USD):** até US$ 0,38 já aprovado  
**Custo mensal esperado (USD):** inalterado; delta deste gate US$ 0  
**Custo mensal limite (USD):** inalterado; nenhum consumo cloud autorizado  
**Aprovação:** continuação explícita da implementação pelo proprietário em
31/08/2026, limitada a código, dependência oficial, testes e configuração
desativada por padrão

## 1. Decisão

Implementar o adapter de object storage para o bucket privado já descrito na
avaliação 0036, mantendo o backend local como padrão. Este gate inclui:

- cliente oficial `@google-cloud/storage` fixado no lockfile;
- leitura limitada e validada de PDFs e exportações;
- criação condicional e idempotente de objetos com `ifGenerationMatch=0`;
- deleção idempotente restrita aos namespaces permitidos;
- configuração fail-closed e composition roots testados;
- contract tests com cliente em memória, sem credencial ou chamada externa.

Este gate não autoriza bucket, objeto, credencial, `terraform apply`, Cloud Run,
Supabase, Infisical, upload, download, egress ou dado pessoal real.

## 2. Impacto de custo

| Componente | Alteração neste gate | Quantidade aplicada | Delta mensal |
|---|---|---:|---:|
| Biblioteca GCS | dependência de runtime e lockfile | 0 chamada | US$ 0 |
| GCS | adapter desativado por padrão | 0 operação/objeto | US$ 0 |
| Cloud Run | nenhuma revisão ou job | 0 | US$ 0 |
| CI | testes locais com doubles | sem serviço externo | US$ 0 |

Uma ativação futura continua dentro do cenário conservador da avaliação 0036:
até US$ 1,09/mês de delta conhecido e até US$ 1,47/mês somado à base, antes de
logs e egress cross-cloud. Ela exige avaliação e aprovação separadas.

## 3. Guardrails

- modo GCS não pode ser inferido por presença de variável; exige flag explícita;
- modo desativado rejeita variáveis GCS soltas;
- bucket aceita somente nome, nunca URL, caminho ou credencial;
- Application Default Credentials; nenhuma chave JSON em variável ou arquivo;
- locators permanecem opacos, tenant-bound e validados por allowlist;
- uploads usam precondition de ausência e hash SHA-256 em metadata;
- conflito só é aceito como idempotente após releitura e validação integral;
- o materializador recebe `objectCreator` + `objectViewer` para validar retries,
  sem permissão de sobrescrever ou apagar objetos;
- downloads têm limite estrito de bytes e validação de hash na aplicação;
- deleção de objeto inexistente é idempotente; outros erros falham fechados;
- testes não usam emulator não oficial nem rede.

## 4. Condições de parada

Parar se a implementação exigir credencial estática, tornar objeto público,
aceitar locator arbitrário, sobrescrever objeto existente sem precondition,
reduzir cobertura, introduzir finding High/Critical ou acessar conta externa.

## 5. Evidência e fontes

- [Cloud Storage — request preconditions](https://cloud.google.com/storage/docs/request-preconditions);
- [Cloud Storage — retry strategy](https://cloud.google.com/storage/docs/retry-strategy);
- [Cloud Storage — preços](https://cloud.google.com/storage/pricing);
- [Avaliação 0036](0036-managed-foundation-plan-only.md).

## 6. Aprovação

Status **aprovado para implementação** somente no repositório. Não autoriza
commit, push, PR, deploy, `apply` ou ativação em sandbox. O rollout deverá ter
plano/Infracost, permissões revisadas e aprovação explícita própria.

## 7. Verificação posterior

Em 31/08/2026, sem credencial ou chamada GCS:

| Evidência | Resultado |
|---|---|
| suíte e cobertura | 79 arquivos, 983 testes; 100% nas quatro métricas |
| lint, tipos, OpenAPI e build | aprovados |
| Terraform fmt/validate/test | 5 testes aprovados, zero falhas |
| TFLint/Checkov | aprovados; 16 checks, zero falhas, um skip documentado |
| Trivy Terraform/segredos | zero High/Critical e nenhum segredo detectado |
| npm audit | zero High/Critical; nove moderados transitivos no tooling Firebase |
| recursos/operações GCS | zero |

O delta deste gate permanece US$ 0. Infracost real e consumo por operação serão
medidos somente em um rollout sandbox aprovado separadamente.
