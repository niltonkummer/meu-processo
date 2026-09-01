# Infraestrutura do MVP

Esta configuração cria um Artifact Registry e um Cloud Run em
`southamerica-east1`. O padrão `public_access_enabled = false` mantém a checagem
IAM do Cloud Run. Depois que a revisão autenticada passar pelos smokes privados,
a validação pode usar `public_access_enabled = true` para desativar essa checagem
somente na aplicação, conforme a recomendação do Google para projetos com
Domain Restricted Sharing; todas as rotas `/api/` continuam exigindo um ID
token válido do Identity Platform. O renderizador nunca desativa sua checagem
IAM.

Também habilita o Identity Platform diretamente e permite somente autenticação
por e-mail e senha. Login anônimo e telefone/SMS ficam explicitamente
desabilitados. A chave do navegador é restrita ao Cloud Run, ao ambiente local e
à API `identitytoolkit.googleapis.com`. O output `firebase_web_config` mantém o
nome esperado pelo SDK, mas não concede acesso aos dados.

O repositório de imagens usa uma chave Cloud KMS controlada pelo projeto, com rotação a cada 90 dias. Essa escolha elimina uma falha de política do baseline de segurança, mas acrescenta o custo mensal da chave e das operações criptográficas ao MVP.

## Fundação gerenciada passiva

A base do produto principal é deliberadamente opt-in. Com os defaults, nenhum
bucket, secret container ou identidade adicional é incluído. Para revisar o
desenho sem autorizar rollout:

```bash
terraform test
infracost breakdown \
  --path=. \
  --terraform-var-file=infracost.tfvars
```

O opt-in declara um bucket GCS privado/CMEK, sete secret containers vazios e
cinco identidades de workload. Não declara secret versions, Cloud Run Jobs ou
Scheduler. Infisical continua sendo a fonte de verdade; a projeção de valores
para Secret Manager e qualquer runtime ativo exigem um gate separado.

A avaliação 0040 autoriza somente a fundação passiva no ambiente de validação.
O workflow passa `APPROVED_VALIDATION_ROLLOUT_0040` explicitamente; esse valor é
rejeitado em staging e produção. O modo plan-only continua disponível com
`PLAN_ONLY_NO_APPLY` e o comportamento padrão continua sem recursos adicionais.

O materializador possui `objectCreator` e `objectViewer`: cria objetos novos com
precondition e relê apenas para provar idempotência quando o locator
determinístico já existe. Ele não recebe permissão de apagar ou sobrescrever.

## Billing comercial em test mode

O billing também é opt-in e permanece ausente nos defaults. O gate
`PLAN_ONLY_NO_APPLY` acrescenta exatamente dois containers regionais de segredo:

- `stripe_secret_key`, contendo somente a chave `sk_test_...`;
- `billing_webhook_config`, contendo JSON com `signingSecret` e a URL PostgreSQL
  da role exclusiva `app_billing_webhook_login`.

O agrupamento do segundo secret mantém o limite aprovado de duas versões sem
reutilizar a credencial do runtime. Infisical continua sendo a fonte de verdade;
Terraform cria containers, IAM e referências, mas nunca valores ou versões.
Cloud Run recebe versões numéricas fixadas — `latest` é recusado —, hard-code de
`BILLING_MODE=stripe-test`, Price ID allowlisted e origem HTTPS explícita.

Para revisar o desenho sem ativá-lo, use os valores sintéticos de
`infracost.tfvars`. Um rollout futuro precisa projetar os dois valores do
Infisical, informar as versões criadas e trocar o acknowledgement para
`APPROVED_VALIDATION_ROLLOUT_0042`; esse token é recusado fora de validation.
Isso não autoriza cobrança live nem substitui o gate separado de ativação do
runtime PostgreSQL já planejado.

`infracost.tfvars` contém somente valores sintéticos, não é carregado
automaticamente pelo Terraform e nunca deve ser usado em `apply`. A avaliação
vigente para rollout é
[`docs/costs/0040-gcp-validation-foundation-rollout.md`](../../docs/costs/0040-gcp-validation-foundation-rollout.md).

## Estado remoto

O bloco `backend "gcs"` é parcial. A implantação de validação usa o bucket
`meu-processo-507018-terraform-state`, protegido com versionamento, soft delete
de sete dias, acesso uniforme e prevenção de acesso público:

```bash
terraform init \
  -backend-config="bucket=meu-processo-507018-terraform-state" \
  -backend-config="prefix=meu-processo/validation"
```

O bucket de estado foi criado fora deste estado para evitar uma dependência
circular. Não aplique retenção fixa ao bucket sem validar o comportamento dos
objetos de lock do backend GCS.

## Bootstrap sem drift

O Cloud Run só pode ser criado depois que a imagem existir. No primeiro uso:

1. Crie APIs e o repositório em um estado de bootstrap revisado.
2. Envie uma imagem com tag imutável de commit para o repositório.
3. Execute `terraform plan` com `-var="image_uri=...:COMMIT_SHA"`.
4. Revise o plano e somente então execute `terraform apply`.

O workflow manual de deploy repete testes, cria a imagem, verifica
vulnerabilidades, publica com tag imutável e aplica a troca de revisão por
Terraform. O rollout público é separado: primeiro aplique a imagem com
`public_access_enabled=false`, execute os smokes e só depois planeje/aplique
`public_access_enabled=true`.

## Identidade keyless do GitHub

Terraform declara um Workload Identity Pool/Provider e a service account
`meu-processo-deploy`. O provider aceita exclusivamente tokens cujo subject é
`repo:niltonkummer@823477/meu-processo@1350848235:environment:validation` e
também confirma os IDs numéricos imutáveis do repositório e do proprietário em
claims separados. Nenhuma chave JSON é criada.

O primeiro bootstrap é uma exceção única: a identidade administrativa já
autenticada aplica um plano salvo, revisado e sem destruições. Depois disso,
configure no GitHub Environment `validation` somente estas variables:

- `GCP_TF_STATE_BUCKET`, com o bucket do state remoto;
- `GCP_WORKLOAD_IDENTITY_PROVIDER`, com o output homônimo do Terraform;
- `GCP_DEPLOY_SERVICE_ACCOUNT`, com o output homônimo do Terraform;
- `FIREBASE_BROWSER_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID` e
  `FIREBASE_APP_ID`, obtidas do output sensível `firebase_web_config` sem
  registrá-lo em logs.

O workflow recebe `id-token: write`, autentica por OIDC e publica apenas o
commit selecionado. Credenciais temporárias `gha-creds-*.json` são ignoradas
pelo Git e pelo contexto Docker. Novos applies de `validation` devem ocorrer
pela pipeline, salvo incidente documentado e explicitamente autorizado.

## Validação local

```bash
terraform fmt -check -recursive
terraform init \
  -backend-config="bucket=meu-processo-507018-terraform-state" \
  -backend-config="prefix=meu-processo/validation"
terraform validate
terraform test
```

Nenhum `apply` deve ser executado sem revisão do plano e autorização explícita.

O primeiro bootstrap do Identity Platform deve ocorrer antes do primeiro build
do frontend autenticado. Depois do apply aprovado, copie os campos do output
`firebase_web_config` para as GitHub Actions Variables descritas em
[`docs/implementation/0004-firebase-authentication.md`](../../docs/implementation/0004-firebase-authentication.md).
