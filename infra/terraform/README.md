# Infraestrutura do MVP

Esta configuração cria um Artifact Registry e um Cloud Run em
`southamerica-east1`. O padrão `public_access_enabled = false` não concede
`roles/run.invoker` a `allUsers`. Depois que a revisão autenticada passar pelos
smokes privados, a validação pode usar `public_access_enabled = true` para
carregar o frontend sem Google IAM; todas as rotas `/api/` continuam exigindo
um ID token válido do Identity Platform no próprio aplicativo.

Também habilita o Identity Platform diretamente e permite somente autenticação
por e-mail e senha. Login anônimo e telefone/SMS ficam explicitamente
desabilitados. A chave do navegador é restrita ao Cloud Run, ao ambiente local e
à API `identitytoolkit.googleapis.com`. O output `firebase_web_config` mantém o
nome esperado pelo SDK, mas não concede acesso aos dados.

O repositório de imagens usa uma chave Cloud KMS controlada pelo projeto, com rotação a cada 90 dias. Essa escolha elimina uma falha de política do baseline de segurança, mas acrescenta o custo mensal da chave e das operações criptográficas ao MVP.

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
