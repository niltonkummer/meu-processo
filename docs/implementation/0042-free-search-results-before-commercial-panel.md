# Implementação 0042 — resultados gratuitos antes do painel comercial

**Status:** implementado e validado localmente; não publicado
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

Não houve commit, push ou deploy. Se posteriormente autorizado, publicar pela
pipeline OIDC da PR existente somente com todos os gates verdes. O rollback é
reapontar o Cloud Run para a revisão imutável anterior; não existe migração de
dados nem alteração de infraestrutura.
