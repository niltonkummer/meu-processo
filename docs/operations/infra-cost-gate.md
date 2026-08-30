# Operação do gate de custo de infraestrutura

## Objetivo

Impedir que código, configuração ou infraestrutura avance sem uma avaliação de custo aprovada. O processo combina uma avaliação humana versionada com estimativa automática do Terraform.

## Fluxo obrigatório

1. Copiar `docs/templates/infra-cost-assessment.md` para `docs/costs/NNNN-titulo.md`.
2. Preencher custo atual, esperado e limite, incluindo os custos dependentes de uso.
3. Obter a decisão `aprovado para implementação` antes de iniciar a mudança.
4. Alterar a avaliação no mesmo pull request da implementação para preservar a trilha de auditoria.
5. Revisar o comentário do Infracost quando `infra/terraform/` tiver sido alterado; na primeira baseline, revisar a evidência local registrada.
6. Para autorizar deploy de validação, criar ou atualizar `.github/deploy-cost-assessment` com o caminho da avaliação aprovada no mesmo pull request.
7. Após deploy, preencher os custos reais em 7 e 30 dias.

Antes do passo 3, a única alteração permitida é criar ou corrigir a própria avaliação de custo. Nenhum runtime, recurso, dado ou dependência pode ser modificado nessa etapa.

O check `Infra cost / Cost assessment` roda em todo pull request. Mudanças
Terraform recebem `Terraform cost diff` quando já existe baseline ou
`Terraform bootstrap cost evidence` somente na primeira inclusão.

## Configuração única no GitHub

1. Criar uma conta/organização no Infracost e gerar um token específico para CI.
2. Adicionar o token em **Settings → Secrets and variables → Actions** com o nome `INFRACOST_API_KEY`.
3. Tornar `Infra cost / Cost assessment` um check obrigatório da branch `main`.
4. Tornar `Infra cost / Terraform cost diff` obrigatório para mudanças de infraestrutura por ruleset ou revisão de CODEOWNERS.
5. Manter aprovação de ambiente separada para qualquer `terraform apply`.

O workflow atual é deliberadamente fixo no ambiente `validation`; não aceita parâmetros manuais que alterem o alvo ou a avaliação. Produção deverá ter um workflow dedicado, revisão própria e avaliação de custo específica.

O token não deve ser colocado em arquivo, variável pública, log ou argumento de comando. O workflow não recebe credenciais do Google Cloud e não executa `terraform apply`.

## Pull requests externos

Forks não recebem secrets. A avaliação documental continua funcionando, mas um pull request externo que altera Terraform falha com instrução explícita. Um mantenedor deve revisar o código e reproduzir a alteração em branch interna confiável; nunca se deve liberar o secret para código não confiável.

## Limites da automação

O Infracost calcula somente o que consegue representar a partir do IaC e de suas premissas. Ele não substitui a estimativa manual de:

Na primeira inclusão da baseline Terraform, não existe um projeto-base na
`main` para calcular um diff. Somente nesse caso, o workflow aceita a avaliação
aprovada que contenha a evidência de um `infracost scan` local autenticado. Essa
exceção encerra automaticamente após o merge: qualquer alteração Terraform
seguinte exige o diff remoto e uma credencial de CI válida e rotacionada.

- carga real do Cloud Run;
- operações e volume do Firestore;
- armazenamento, recuperação e egress do Cloud Storage;
- logs e retenção;
- e-mail, IA e APIs externas;
- impostos, câmbio e suporte.

O processamento do diff usa o serviço externo do Infracost. Antes de enviar infraestrutura sensível, a organização deve aceitar seus termos e revisar o tratamento dos metadados do repositório.

## Falhas que bloqueiam merge

- avaliação ausente ou fora de `docs/costs/`;
- ponteiro `.github/deploy-cost-assessment` ausente ou inválido em uma tentativa de deploy;
- marcador de versão ausente;
- status diferente de `aprovado para implementação` ou `aprovado para implementação e rollout de validação`;
- custo atual, esperado, limite ou aprovação ausente;
- token Infracost ausente em uma mudança Terraform interna após a baseline inicial;
- tentativa de executar estimativa com secret em pull request externo;
- falha do scanner ou ausência do comentário de diff aplicável.

## Atualizações

A ação Infracost e o scanner são pinados separadamente. Atualizações devem passar por avaliação de custo, revisão de release notes, verificação do SHA, validação do workflow e pull request dedicado quando alterarem o modelo de confiança.
