# Implementação 0040 — deploy keyless em validation

**Status:** pronto para bootstrap e validação
**Data:** 31 de agosto de 2026
**Ambiente:** `validation` / `meu-processo-507018`
**Custo aprovado:** [avaliação 0044](../costs/0044-oidc-and-publication-validation-rollout.md)

## Objetivo

Permitir que o GitHub Actions publique API e renderer no Cloud Run sem chave
estática, mantendo o renderer privado e vinculando a confiança ao Environment
`validation`, ao repositório e aos seus IDs numéricos.

## Controles implementados

- Workload Identity Pool e provider gerenciados por Terraform;
- subject exato `repo:niltonkummer/meu-processo:environment:validation`;
- service account de deploy sem chave de usuário;
- IAM de administração/uso de service accounts limitado às identidades do
  state;
- papéis de projeto declarados em allowlist e cobertos por teste Terraform;
- credenciais efêmeras excluídas do Git e do build Docker;
- workflow manual com Environment, concorrência serial, imagens imutáveis,
  SBOM, provenance, scans e plano salvo antes do apply;
- gate de custo apontando para a avaliação 0044.

## Procedimento autorizado

1. validar Terraform, TFLint, Checkov, workflows e testes da aplicação;
2. revisar o plano remoto e rejeitar destruições ou substituições;
3. obter o aceite do Infracost no PR;
4. aplicar uma única vez o bootstrap por identidade administrativa;
5. criar/configurar o Environment `validation` com variables públicas;
6. disparar o deploy do commit da branch pela pipeline;
7. verificar revisões, IAM, saúde, autenticação, busca e download;
8. comprovar que a conta de deploy não possui chave gerenciada pelo usuário.

## Limites do smoke funcional

O teste de publicação usa somente o caminho oficial. Se o tribunal exigir
CAPTCHA, a resposta é humana; não há bypass, OCR ou solver. O fluxo atual
entrega o PDF diretamente ao navegador. O armazenamento automático em GCS e a
referência PostgreSQL ainda não fazem parte deste caminho e terão validação
própria quando forem integrados.

## Evidências de rollout

Preencher após a execução:

- commit e PR: pendentes;
- plano Terraform: pendente;
- workflow e revisões: pendentes;
- chave de usuário da service account: pendente;
- resultado do smoke: pendente.
