# ADR 0025 — Stripe hospedada e descoberta ética de valor

**Status:** aceito para test mode
**Data:** 31 de agosto de 2026
**Custo:** [0042](../costs/0042-commercial-mvp-billing-and-discovery.md)
**Spec:** [0033](../specs/0033-commercial-mvp-billing-and-discovery.md)

## Decisão

Usar Stripe Billing, Checkout Sessions em `subscription` e Customer Portal.
Cartão é o método recorrente inicial; boleto e Pix não entram no primeiro piloto.
Não construir formulário próprio nem renovação com PaymentIntent.

O plano local só muda por webhook assinado, idempotente e reconciliado. Redirect,
browser e metadata livre não concedem entitlement. Papel, plano e feature flag
permanecem decisões separadas.

O fator curiosidade será o Radar Processual: após consulta autenticada, mostra
cobertura, possíveis correspondências, recência e valor da automação sem expor
terceiros, alegar certeza sobre homônimos ou usar urgência falsa.

Cancelamento impede novas operações pagas ao fim do período, mas exportação,
exclusão e histórico próprio continuam acessíveis.

## Consequências

- nenhum dado de cartão chega ao Meu Processo;
- Price IDs e URLs são allowlisted server-side por ambiente;
- webhook precisa de corpo bruto, assinatura, inbox e reconciliação;
- falha Stripe não derruba consulta nem controles de privacidade;
- não haverá domínio customizado do Checkout no MVP.
