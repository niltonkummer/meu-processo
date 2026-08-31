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
