# Implementação 0042 — resultados gratuitos antes do painel comercial

**Status:** implementado, validado e publicado em `validation`
**Data:** 1 de setembro de 2026
**Spec:** [0033](../specs/0033-commercial-mvp-billing-and-discovery.md)
**Custo:** [0046](../costs/0046-free-search-results-before-commercial-panel.md)

## Regressão

Após uma consulta por nome, os processos eram renderizados, mas apareciam
depois da carteira persistida, do painel de assinatura e dos controles da
conta. Como o bloco comercial ocupa uma área extensa, o fluxo aparentava
substituir o resultado por um paywall, apesar de a API já ter respondido.

## Correção

Histórico e resultado da consulta agora são renderizados imediatamente após o
formulário e eventuais mensagens de erro. Carteira persistida, oferta opcional
de plano e controles de dados permanecem abaixo. Nenhum entitlement, checkout,
contrato HTTP, autorização, dado ou recurso de nuvem foi alterado.

## Evidência TDD

1. o teste de regressão reproduziu a ordem incorreta e falhou ao encontrar o
   painel comercial antes do resultado;
2. a composição React foi reordenada sem alterar os componentes;
3. o teste passou e também confirmou que `Abrir processo` continua disponível;
4. os testes existentes de busca e billing permaneceram verdes.

## Rollout e rollback

O comportamento foi publicado pela pipeline OIDC no Cloud Run a partir do
commit `fc63b50ba014eed1217bcde4616d25ac1a0137d2`. O workflow
`33517113771` repetiu os release gates, publicou imagens imutáveis com SBOM e
proveniência, aplicou o plano Terraform e verificou a revisão e a fundação
gerenciada. O smoke test público confirmou `GET /health` com `200` e
`{"ok":true}`, além da entrega do frontend em
`https://meu-processo-mvp-rsirxb5ptq-rj.a.run.app`.

O rollback é reapontar o Cloud Run para a imagem imutável anterior
`cd968c4ea7fcfe383dc7eb6c219de8f8ad8a4437`; não existe migração de dados nem
alteração estrutural de infraestrutura.
