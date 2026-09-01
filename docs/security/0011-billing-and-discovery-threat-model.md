# Threat model 0011 — billing, entitlements e descoberta

**Status:** aprovado para test mode
**Data:** 31 de agosto de 2026
**Spec:** [0033](../specs/0033-commercial-mvp-billing-and-discovery.md)

| Ameaça | Controle obrigatório |
|---|---|
| Price ID privilegiado | oferta allowlisted e tenant resolvido pela sessão |
| success URL forjada | redirect nunca altera entitlement |
| webhook falso | corpo bruto, assinatura e secret por ambiente |
| replay ou duplicidade | event ID único e efeito transacional idempotente |
| evento fora de ordem | versão temporal e reconciliação canônica |
| customer de outro tenant | relação única tenant↔customer e RLS forçada |
| portal alheio | sessão criada para customer resolvido server-side |
| confusão test/live | validation recusa secret, Price e evento live |
| enumeração pelo Radar | autenticação, rate limit, alvo protegido e sem PII |
| segredo em log/state | Infisical→Secret Manager, IAM mínimo e redaction |

Rollout é bloqueado por chave live em validation, entitlement vindo do browser,
ausência de idempotência, acesso cross-tenant, payload financeiro em log ou
finding High/Critical.
