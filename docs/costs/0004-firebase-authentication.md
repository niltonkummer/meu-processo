# Avaliação de custo 0004 — autenticação com Firebase

<!-- infra-cost-assessment:v1 -->

**Status:** aprovado para implementação
**Solicitado por:** proprietário do produto
**Responsável:** proprietário do produto e engenharia
**Data da avaliação:** 29 de agosto de 2026
**Ambientes afetados:** local e development; configuração declarativa para staging/production sem `apply`
**Spec/issue:** autenticação do painel privado; ADR 0003

**Custo mensal atual (USD):** US$ 0 para autenticação
**Custo mensal esperado (USD):** US$ 0 para até 1.000 MAU com e-mail/senha
**Custo mensal limite (USD):** US$ 0 para autenticação; rollout bloqueado antes de 10.000 MAU ou da ativação de método faturável
**Aprovação:** proprietário do produto, aprovado para implementação local e IaC em 29/08/2026; não autoriza `terraform apply`, deploy ou exposição pública do Cloud Run

## 1. Decisão

Implementar cadastro, login, verificação de e-mail, logout e validação server-side de ID tokens usando Firebase Authentication/Google Cloud Identity Platform. A primeira versão aceita exclusivamente e-mail e senha. Telefone/SMS, SAML, OIDC, login anônimo e provedores sociais permanecem desabilitados.

A mudança introduz configuração Terraform e dependências de aplicação, mas não cria instância mínima, armazenamento, egress regional, retenção ou SKU com custo mensal dentro do limite operacional. O Cloud Run continuará privado por IAM; sua futura exposição a clientes ou a introdução de um gateway autenticado exigirá ADR, threat model e nova avaliação de custo.

## 2. Alteração de infraestrutura

| Componente/SKU | Região | Estado atual | Estado proposto | Quantidade | Custo unitário | Delta mensal |
|---|---|---|---|---:|---:|---:|
| Firebase Authentication / Identity Platform — Tier 1 | Global, vinculado ao projeto GCP | Não configurado por IaC | E-mail/senha, e-mail verificado | até 1.000 MAU esperados | US$ 0 até 50.000 MAU/mês | US$ 0 |
| Firebase Web App | Global | Não declarado | Uma aplicação web declarada por IaC | 1 | Sem cobrança própria | US$ 0 |
| Identity Toolkit API | Global | Não declarada | API habilitada por IaC | 1 projeto | Sem cobrança pela habilitação | US$ 0 |
| Cloud Run | `southamerica-east1` | Privado, escala a zero | Sem alteração de exposição ou capacidade | 1 | Avaliado separadamente | US$ 0 |

Custos únicos de implantação, migração, backfill, recuperação e saída de dados: US$ 0. Não haverá migração de usuários nem dados reais nesta etapa.

## 3. Premissas e cenários

Preços consultados em 29/08/2026, em USD, antes de impostos. A cobrança do Tier 1 começa acima de 50.000 MAU: US$ 0,0055 por MAU entre 50.000 e 100.000. SMS no Brasil custa US$ 0,02 por mensagem enviada após a franquia diária indicada pelo serviço, mas não será habilitado.

| Direcionador | Base atual | Esperado | Limite operacional | Unidade |
|---|---:|---:|---:|---|
| Usuários ativos autenticados | 0 | até 1.000 | 10.000 | MAU |
| Login/cadastro por e-mail | 0 | até 5.000 | 50.000 | operações/mês |
| SMS/telefone | 0 | 0 | 0 | mensagens/mês |
| Provedores SAML/OIDC | 0 | 0 | 0 | MAU |
| Processamento adicional no Cloud Run | 0 | desprezível, dentro da capacidade atual | sem aumento de instâncias/concurrency | vCPU-s/GiB-s |
| Armazenamento adicional | 0 | 0 | 0 | GiB-mês |
| Saída de rede adicional | 0 | desprezível para tokens | sem novo egress regional | GiB/mês |
| Logs de autenticação da aplicação | 0 | somente códigos técnicos, sem token/e-mail | retenção atual, sem aumento | GiB/mês |

Cenário atual: nenhum usuário autenticado, US$ 0. Cenário esperado em 30 dias: validação local e até 1.000 MAU em development, US$ 0. Pior cenário permitido antes da parada: 10.000 MAU, ainda dentro da franquia de 50.000 MAU e US$ 0 de autenticação.

## 4. Custos não cobertos automaticamente

- **Cloud Run:** sem alteração de capacidade ou exposição nesta mudança; custo existente permanece na avaliação da fundação.
- **Firestore e Storage:** não utilizados pela implementação de autenticação desta etapa.
- **Egress e logs:** uso residual; tokens e mensagens de erro não serão persistidos em logs.
- **E-mail:** os e-mails transacionais nativos de verificação/recuperação seguem limites e proteção contra abuso do Firebase; provedor de e-mail próprio não será adicionado.
- **SMS:** não aplicável porque autenticação por telefone estará desabilitada.
- **Filas, IA, APIs de terceiros e suporte:** não aplicáveis.
- **Impostos e câmbio:** excluídos; custo calculado em USD.
- **Infracost:** Identity Platform/Firebase pode não aparecer como custo estimável no Terraform; o preço por consumo foi calculado manualmente e o diff será anexado à validação.

## 5. Limites e condição de parada

- Limite operacional: 10.000 MAU; bloquear expansão antes desse valor para reavaliar abuso, quota e preço.
- Métodos permitidos: somente e-mail/senha com verificação de e-mail obrigatória.
- Telefone/SMS, login anônimo, SAML/OIDC e provedores sociais ficam desabilitados.
- O frontend não persiste ID token em `localStorage`; a sessão é mantida somente em memória.
- O backend valida assinatura, projeto/audiência, expiração e revogação do token e falha fechado.
- Cloud Run permanece privado; não criar binding `allUsers` nesta alteração.
- Novo método faturável, exposição pública, MAU acima de 10.000 ou delta mensal maior que US$ 0 bloqueia rollout e exige nova aprovação do proprietário.
- Validade desta estimativa: 90 dias, até 27/11/2026, ou até alteração de preço/escopo.

## 6. Evidência e fontes

- [Firebase Pricing](https://firebase.google.com/pricing) — acessado em 29/08/2026.
- [Google Cloud Identity Platform Pricing](https://cloud.google.com/identity-platform/pricing) — acessado em 29/08/2026.
- Infracost v2.16.2 executado em 30/08/2026: 15 recursos analisados, 9 sem
  cobrança própria, estimativa mensal total de US$ 0, sem budgets ou guardrails
  configurados na conta. A política externa sinalizou as tags existentes de
  ambiente e o scanner não precificou Firebase/Identity Platform; por isso o
  cálculo de consumo continua documentado manualmente nesta avaliação.
- Cálculo reproduzível: `min(MAU, 50.000) × US$ 0 = US$ 0`; o rollout para em 10.000 MAU.

## 7. Aprovação

O pedido “Agora vamos fazer a autenticação” aprova a implementação deste escopo de custo zero em 29/08/2026. A aprovação cobre código local, testes, documentação e configuração Terraform sem aplicação. Não autoriza commit, push, merge, deploy, criação manual de recursos ou abertura do Cloud Run.

## 8. Verificação posterior

Somente após deploy autorizado:

| Data | Custo estimado | Custo real | Variação | Explicação | Ação |
|---|---:|---:|---:|---|---|
| D+7 | US$ 0 | — | — | — | confirmar MAU e métodos ativos |
| D+30 | US$ 0 | — | — | — | comparar uso e revisar limite |
