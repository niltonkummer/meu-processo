# Avaliação de custo 0044 — OIDC e smoke de publicação em validation

<!-- infra-cost-assessment:v1 -->

**Status:** aprovado para implementação e rollout de validação
**Solicitado por:** proprietário do produto
**Responsável:** engenharia do Meu Processo
**Data da avaliação:** 31 de agosto de 2026
**Ambientes afetados:** GitHub e `validation` no projeto `meu-processo-507018`
**Spec/issue:** publicar a correção de resultados/CAPTCHA e executar um smoke
humano CAPTCHA → PDF → download pelo painel

**Custo mensal atual (USD):** até US$ 1,71 fixo; US$ 2,25 operacional
**Custo mensal esperado (USD):** até US$ 1,71 fixo; delta incremental US$ 0
**Custo mensal limite (USD):** US$ 2,25 operacional; US$ 10,00 de segurança
**Aprovação:** proprietário do produto, autorização explícita em 31/08/2026

## 1. Decisão

Autorizar a criação, por Terraform, de uma federação OIDC exclusiva entre o
repositório `niltonkummer/meu-processo` e uma conta de deploy de `validation`,
sem chave estática. Autorizar também uma nova revisão, com escala mínima zero e
capacidade inalterada, da API e do renderer privado para um único smoke real.

O bootstrap inicial da própria federação pode ser aplicado uma única vez pela
identidade administrativa já autenticada, usando plano Terraform salvo,
revisado e sem destruições. Depois do bootstrap, todo apply deve ocorrer pela
pipeline protegida. A exceção é necessária porque a pipeline ainda não possui a
identidade que será criada por ela.

Esta avaliação não autoriza bypass, OCR, solver, terceirização ou repetição
automática do CAPTCHA. Se houver desafio, o usuário o resolve no painel.

## 2. Alterações e custo

| Componente/SKU | Estado proposto | Limite | Delta mensal |
|---|---|---:|---:|
| Workload Identity Pool/Provider | GitHub OIDC, claims restritos ao repositório | 1 | US$ 0 |
| Service account de deploy | privilégio mínimo para o state e recursos declarados | 1 | US$ 0 |
| Cloud Run API | nova revisão, mínimo 0 e máximo 2 | existente | US$ 0 fixo |
| Cloud Run renderer | nova revisão, mínimo 0, máximo 1, concorrência 1 | existente | US$ 0 fixo |
| Artifact Registry | duas imagens imutáveis com SBOM/proveniência | 2 | desprezível |
| Supabase Free | migrations 0021–0022 antes do tráfego | 1 projeto | US$ 0 |
| GCS | fundação privada existente, sem gravação pelo smoke atual | existente | US$ 0 |
| Logs | somente estados categóricos e duração | 1 smoke | < US$ 0,01 |

Não há novo SKU faturável, instância mínima, retenção, fila, schedule, cache,
proxy pago, e-mail, IA ou API comercial. O custo único esperado também é US$ 0.

## 3. Segurança e condições de parada

- OIDC aceita somente o subject do ambiente `validation`, o nome exato do
  repositório e seus IDs numéricos imutáveis de repositório e proprietário;
- administração/uso de service accounts é concedida somente sobre as
  identidades declaradas no state, nunca no nível do projeto;
- nenhuma chave de service account será criada ou armazenada no GitHub;
- renderer permanece privado e invocável somente pela identidade da API;
- plano com destruição, substituição inesperada, IAM público ou wildcard
  bloqueia o apply;
- imagens e commit são imutáveis e precisam passar cobertura, banco, OpenAPI,
  dependências, secrets, SAST, IaC e scans High/Critical;
- migration remota deve ser transacional e validada antes de promover tráfego;
- smoke limitado a uma sessão de até 120 segundos e um documento de até 25 MiB;
- cinco falhas consecutivas, finding High/Critical, mistura cross-tenant,
  indisponibilidade persistente da fonte ou projeção acima de US$ 10 interrompe
  o teste;
- logs nunca contêm token, nome, CPF/CNPJ, CNJ, URL oficial, HTML, CAPTCHA,
  cookies, comunicação ou PDF;
- o CAPTCHA permanece humano e sua ausência só pode ser tratada como caminho
  oficial sem desafio, nunca como evidência de bypass.

## 4. Rollout e rollback

1. criar spec/testes Terraform para a federação e a identidade de deploy;
2. revisar plano e Infracost; aplicar apenas o bootstrap OIDC sem destruições;
3. configurar variáveis públicas do ambiente GitHub, sem secrets estáticos;
4. publicar commit da feature em PR e executar todos os checks;
5. publicar as duas revisões pela pipeline; migrations 0021–0022 permanecem
   fora deste rollout enquanto o runtime PostgreSQL não estiver ativado;
6. validar saúde, IAM, autenticação, busca e o fluxo humano de download;
7. em falha, devolver tráfego às revisões anteriores e manter escala mínima zero.

## 5. Evidência e limitação financeira

- [Avaliação 0043](./0043-search-result-aggregation-and-publication-recovery.md)
  cobre a mudança funcional e projeta delta de US$ 0;
- [Avaliação 0040](./0040-gcp-validation-foundation-rollout.md) cobre GCS, KMS,
  Secret Manager, budgets e o teto geral do sandbox;
- IAM e Workload Identity Federation não possuem cobrança direta; Cloud Run,
  Artifact Registry, GCS e logs variam com uso e permanecem limitados acima;
- Infracost não representa consumo variável de Cloud Run nem IAM/OIDC; o plano
  e esta estimativa manual são ambos obrigatórios.

O fluxo assistido publicado nesta etapa transmite o PDF diretamente ao
navegador. A materialização automática em GCS e sua referência no PostgreSQL
continuam sendo uma integração posterior da fundação de documentos e não podem
ser reportadas como validadas por este smoke.

Validade até 30/09/2026 ou mudança de preço, região, repositório, capacidade,
retenção ou arquitetura, o que ocorrer primeiro.

## 6. Aprovação

Em 31/08/2026, o proprietário escreveu: “Autorizo commit push pr oidc e deploy
em validation”. A autorização financeira permanente permite avançar sem nova
consulta porque o total projetado permanece abaixo de US$ 10/mês. Merge em
`main`, produção, cobrança real e bypass de CAPTCHA continuam fora do escopo.

## 7. Verificação posterior

| Data | Custo estimado | Custo real | Variação | Ação |
|---|---:|---:|---:|---|
| D0 | até US$ 1,71 fixo | pendente | — | smoke ou rollback |
| D+7 | até US$ 1,71 fixo | pendente | — | comparar Billing e logs |
| D+30 | até US$ 1,71 fixo | pendente | — | recalibrar e reaprovar |
