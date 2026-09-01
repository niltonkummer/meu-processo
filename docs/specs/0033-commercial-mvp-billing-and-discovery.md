# Spec 0033 — MVP comercial, billing e descoberta de valor

**Status:** aprovada para implementação local/test mode
**Data:** 31 de agosto de 2026
**Custo:** [0042](../costs/0042-commercial-mvp-billing-and-discovery.md)
**ADR:** [0025](../adr/0025-stripe-billing-and-ethical-discovery.md)
**Threat model:** [0011](../security/0011-billing-and-discovery-threat-model.md)

## Escopo

O marco 100% é um piloto comercial fechado: conta verificada, busca protegida,
homônimos, monitoramento diário, documentos escaneados, assinatura, Radar,
privacidade, operação e trinta dias sem mistura ou perda conhecida.

O primeiro plano pago é `person`, com preço e quota live ainda bloqueados. O
plano gratuito mantém consulta inicial, exportação e exclusão.

## Contratos HTTP

- `GET /api/v1/billing/subscription`;
- `POST /api/v1/billing/checkout-sessions`, recebendo apenas `offerCode` e
  request ID idempotente;
- `POST /api/v1/billing/portal-sessions`;
- `POST /api/v1/webhooks/stripe`, sem Firebase, com corpo bruto e assinatura.

O frontend nunca envia Customer ID, Price ID, valor, moeda, entitlement ou URL.

## Persistência

- `billing_customers`: relação única tenant↔provider customer;
- `billing_subscriptions`: projeção temporal do estado canônico;
- `billing_events`: inbox por provider event ID, tipo, hash e resultado;
- `checkout_attempts`: idempotência tenant-scoped;
- `product_plans`, `tenant_plans` e usage conforme o MER existente.

Tabelas tenant-scoped usam RLS forçada, FKs compostas, índices de acesso e role
de webhook sem leitura de alvos, processos ou documentos.

## Regras

- Checkout usa `mode=subscription` e Price allowlisted;
- `active` e `trialing` concedem plano; `past_due` usa graça explícita;
- `unpaid`, `canceled` e `incomplete_expired` bloqueiam novas ações pagas;
- cancelamento no fim do período preserva acesso até `current_period_end`;
- evento é persistido antes do efeito e duplicidade não repete efeito;
- eventos fora de ordem são reconciliados com a assinatura canônica;
- validation aceita somente test mode;
- consulta, histórico próprio, exportação e exclusão não dependem de pagamento.
- após uma consulta, histórico e processos aparecem antes de qualquer oferta
  comercial; o painel de plano não pode ocultar, substituir ou aparentar
  condicionar o resultado gratuito.

## Radar Processual

Após consulta autenticada válida, exibir faixa de possíveis processos,
fontes/tribunais consultados, recência, confiança e capacidade de automação.
Nunca usar PII em analytics, certeza sobre homônimo, urgência falsa ou contador
público pesquisável.

## Critérios de aceitação

1. checkout idempotente não cria assinaturas concorrentes;
2. redirect forjado não altera plano;
3. webhook inválido não persiste efeito;
4. evento duplicado ou fora de ordem converge;
5. customer, portal, subscription e entitlement não cruzam tenants;
6. quota é atômica e idempotente;
7. Radar não expõe PII nem mistura consultas;
8. falha Stripe não derruba o produto básico;
9. logs não contêm PII, payload, URL de Checkout ou segredo;
10. memory/PostgreSQL, pgTAP, HTTP e Stripe fixtures passam com cobertura 100%;
11. nenhuma cobrança real ocorre em teste;
12. OpenAPI, audit, scans, Terraform e Infracost permanecem bloqueantes.
13. consulta por nome lista os resultados antes do painel comercial e continua
    utilizável quando billing estiver gratuito, indisponível ou sem entitlement.
