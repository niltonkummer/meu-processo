# Implementação 0038 — billing comercial em test mode

**Status:** implementada e verificada localmente; rollout não iniciado
**Data:** 31 de agosto de 2026
**Spec:** [0033](../specs/0033-commercial-mvp-billing-and-discovery.md)
**ADR:** [0025](../adr/0025-stripe-billing-and-ethical-discovery.md)
**Custo:** [0042](../costs/0042-commercial-mvp-billing-and-discovery.md)

## Resultado

- Checkout hospedado e Customer Portal para o plano `person` em Stripe test mode;
- webhook público com corpo bruto, assinatura, limite de 256 KiB e resposta segura;
- inbox idempotente e projeção de assinatura temporal no PostgreSQL;
- RLS forçada para dados tenant-scoped e role exclusiva do webhook;
- painel de plano sem formulário de cartão, urgência artificial ou liberação por redirect;
- Radar Processual pós-consulta com cobertura, confiança e ressalva sobre homônimos;
- contrato OpenAPI para assinatura, Checkout, Portal e webhook;
- Terraform desligado por padrão, com exatamente dois novos secrets e versões fixadas.

## Entrega de segredos

Infisical permanece fonte de verdade e Secret Manager é somente a projeção para
Cloud Run. Para respeitar o limite de custo sem compartilhar a role do banco:

1. `stripe_secret_key` contém a chave de teste;
2. `billing_webhook_config` contém apenas
   `{"databaseUrl":"...","signingSecret":"..."}`.

O runtime recusa JSON com campos ausentes, extras ou tipos diferentes, recusa a
mistura com variáveis legadas e nunca registra o conteúdo. Terraform não cria
secret versions nem recebe plaintext no state.

## Gates mantidos

- defaults sem billing e sem novos recursos;
- test mode obrigatório; `sk_live_...` falha no startup;
- Price ID e origem definidos server-side;
- no máximo cinco checkouts por pessoa/dia;
- nenhuma cobrança, commit, push, apply ou deploy realizado nesta etapa;
- ativação depende de secret sync, versão fixada, runtime PostgreSQL e smoke com
  eventos sintéticos Stripe.
