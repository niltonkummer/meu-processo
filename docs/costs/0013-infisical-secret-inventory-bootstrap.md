# Avaliação de custo 0013 — bootstrap do inventário no Infisical

<!-- infra-cost-assessment:v1 -->

**Status:** aprovado para implementação
**Solicitado por:** proprietário do produto
**Responsável:** proprietário do produto e engenharia
**Data da avaliação:** 30 de agosto de 2026
**Ambientes afetados:** projeto Infisical `Meu Processo`; nenhum runtime
**Spec/issue:** cadastrar no vault os segredos reais já existentes

**Custo mensal atual (USD):** até US$ 0,38 no cenário de validação aprovado
**Custo mensal esperado (USD):** até US$ 0,38; delta mensal US$ 0
**Custo mensal limite (USD):** US$ 10
**Aprovação:** o pedido explícito do proprietário aprova este bootstrap em 30/08/2026

## 1. Escopo aprovado

- inventariar nomes/consumidores sem revelar valores;
- cadastrar no projeto Infisical somente segredos reais já existentes;
- usar o ambiente `dev` enquanto não existem staging/production aprovados;
- não criar Secret Sync, machine identity, plano pago ou integração de runtime;
- não copiar configurações públicas, URLs, IDs Firebase ou service accounts.

O inventário encontrou um segredo real: `INFRACOST_API_KEY`, já presente no
GitHub Actions. Google Secret Manager não contém segredos e o projeto Supabase,
provedor de e-mail e demais credenciais ainda não existem.

## 2. Impacto

| Componente | Estado atual | Alteração | Delta mensal |
|---|---|---|---:|
| Infisical Free | projeto criado pelo proprietário | 1 segredo em `dev` | US$ 0 |
| GitHub Actions | 1 secret existente | permanece como consumidor atual | US$ 0 |
| GCP Secret Manager | sem secrets | nenhuma alteração | US$ 0 |
| Cloud Run/Terraform | runtime atual | nenhuma alteração | US$ 0 |

## 3. Guardrails

- valor não aparece em terminal, documentação, log, screenshot ou resposta;
- segredo não é lido de GitHub, pois a plataforma não permite recuperar o valor;
- não substituir nem remover o secret do GitHub nesta etapa;
- não habilitar auto-sync ou deleção no destino;
- registrar apenas nome, valor e comentário técnico mínimo no Infisical;
- futura rotação/sincronização exige spec, threat model e custo próprios.

## 4. Condição de parada

Parar se o projeto exigir upgrade, se `dev` não existir, se houver conflito com
valor já cadastrado ou se não for possível confirmar o projeto correto sem
expor dados. Nenhum plano pago está autorizado.

## 5. Evidência

- [ADR 0017 — Infisical](../adr/0017-infisical-secrets-control-plane.md).
- [Custo 0012 — planejamento](./0012-supabase-infisical-platform-planning.md).
- [Infisical — preços](https://infisical.com/pricing).
- Infracost não aplicável: nenhum Terraform ou recurso cloud será alterado.

## 6. Aprovação

O pedido autoriza cadastrar o inventário acima no projeto Infisical. Não autoriza
commit, push, PR, deploy, plano pago, sync, rotação, exclusão ou novo segredo.

## 7. Verificação posterior

**Executado em:** 30 de agosto de 2026

- projeto confirmado: `Meu Processo`, Infisical Cloud EU;
- ambiente confirmado: `Development` (`dev`), pasta raiz;
- `INFRACOST_API_KEY` criada e exibida com valor mascarado;
- inventário final: 1 segredo;
- nenhum sync, identity, plano pago, permissão, secret GCP ou runtime alterado;
- delta mensal confirmado: US$ 0.
