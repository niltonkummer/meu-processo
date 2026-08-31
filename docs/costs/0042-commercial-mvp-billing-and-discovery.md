# Avaliação de custo 0042 — billing e descoberta do MVP comercial

<!-- infra-cost-assessment:v1 -->

**Status:** aprovado para implementação local e validation em test mode
**Estado do rollout:** não iniciado
**Solicitado por:** proprietário do produto
**Responsável:** engenharia do Meu Processo
**Data:** 31 de agosto de 2026
**Spec:** [0033](../specs/0033-commercial-mvp-billing-and-discovery.md)

**Custo mensal atual (USD):** até US$ 1,59 esperado; US$ 2,10 operacional
**Custo mensal esperado (USD):** até US$ 1,71 fixo; tarifas somente sobre receita
**Custo mensal limite (USD):** US$ 2,25 operacional; US$ 10,00 de segurança
**Aprovação:** proprietário do produto, continuidade autorizada em 31/08/2026

## Decisão

Implementar Stripe Billing com Checkout hospedado, Customer Portal e webhook
assinado. Local e validation usam exclusivamente test mode. Cobrança real,
Product/Price live, commit, push e deploy não são autorizados por esta avaliação.

O Radar Processual reutiliza consultas autenticadas existentes e não cria
crawler, banco, cache, fila ou serviço adicional.

## Alteração e custo fixo

| Componente | Alteração | Delta mensal conservador |
|---|---|---:|
| Cloud Run | endpoints no serviço existente, mínimo zero | US$ 0 esperado |
| Supabase Free | billing, eventos e entitlements pequenos | US$ 0 no piloto |
| Secret Manager | chave Stripe e secret do webhook | até US$ 0,12 |
| Stripe test mode | Checkout, Portal e eventos sintéticos | US$ 0 |
| domínio customizado Stripe | não contratar | US$ 0 |
| **Total fixo esperado** | baseline + dois secrets | **até US$ 1,71** |

Secret Manager oferece seis versões ativas gratuitas por billing account e
cobra US$ 0,06 por versão ativa excedente. O inventário planejado passa de sete
para nove versões, produzindo delta marginal conservador de US$ 0,12.

## Tarifas variáveis de referência

Preço ilustrativo de R$ 29,90, sem impostos, consultado em 31/08/2026:

| Método | Custo conservador por pagamento |
|---|---:|
| cartão nacional + Billing | aprox. R$ 1,90 |
| boleto + Billing | aprox. R$ 3,66 |
| Pix avulso | aprox. R$ 0,36; não recorrente e sujeito à disponibilidade |

Cartão é o único método de assinatura do primeiro piloto. Boleto exige fluxo
próprio de confirmação mensal. Pix não suporta recorrência na Stripe atual.

## Limites e condições de parada

- zero cobranças reais em local/validation;
- no máximo cinco Checkout Sessions por conta/dia;
- no máximo duas versões ativas novas de secrets;
- redirect nunca libera entitlement; somente webhook assinado e reconciliado;
- Price ID, valor, moeda e Customer ID são allowlisted server-side;
- custo fixo acima de US$ 1,71, operacional acima de US$ 2,25 ou novo produto
  Stripe bloqueia rollout e exige nova aprovação;
- finding High/Critical, falha cross-tenant, evento não idempotente, chave live
  ou segredo em log bloqueiam a entrega;
- esta avaliação expira em 30/09/2026 ou com mudança de preço/arquitetura.

## Evidências

- [Stripe — preços Brasil](https://stripe.com/br/pricing), 31/08/2026;
- [Stripe — Pix](https://docs.stripe.com/payments/pix?locale=pt-BR), 31/08/2026;
- [Stripe — boleto em assinaturas](https://docs.stripe.com/payments/boleto/set-up-subscription?locale=pt-BR), 31/08/2026;
- [Secret Manager — preços](https://cloud.google.com/secret-manager/pricing?hl=pt-BR), 31/08/2026.

## Verificação posterior

| Data | Custo esperado | Custo real | Ação |
|---|---:|---:|---|
| D0 validation | até US$ 1,71 fixo | pendente | smoke ou rollback |
| D+7 | até US$ 1,71 fixo | pendente | manter ou corrigir |
| D+30 | fixo + tarifas aprovadas | pendente | recalibrar |
