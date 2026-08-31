# ADR 0011 — monólito modular com composition root por workload

**Status:** aceito
**Data:** 30 de agosto de 2026
**Relacionado:** [Spec 0009](../specs/0009-scalable-product-foundation.md)

## Contexto

A validação atual possui camadas úteis, mas o servidor HTTP concentra vários
fluxos e a composição conhece adapters concretos. A expansão para monitoramento,
equipes, notificações, pesquisa e IA pode criar acoplamento transversal. Separar
microservices agora aumentaria deploys, contratos e operação sem carga ou times
independentes que justifiquem o custo.

## Decisão

Adotar monólito modular por capability. Cada módulo publica um contrato pequeno,
mantém domínio/aplicação/adapters próprios e não importa internals de outro
módulo. Domain/application não dependem de HTTP, SDK GCP ou payload de fonte.

Cada workload possui uma única composition root que valida configuração,
seleciona adapters e registra casos de uso/handlers. HTTP permanece fino. O CI
bloqueia ciclos, imports entre internals e SDKs fora dos adapters.

A migração será incremental, mantendo `/api/v1` e testes de caracterização. Um
módulo só vira serviço quando precisa comprovadamente de escala, isolamento de
segurança, disponibilidade ou ciclo de deploy independente e seu contrato já é
estável.

## Consequências

- desenvolvimento local e transações permanecem simples;
- limites permitem extrair serviço depois sem inventar contrato às pressas;
- haverá disciplina adicional de imports e DTOs;
- um deploy ainda contém vários módulos, opção intencional nesta fase;
- código compartilhado só sobe para platform/shared após dois usos reais.

## Alternativas

- **Microservices desde agora:** rejeitado por complexidade e ausência de
  evidência.
- **Manter apenas camadas globais:** rejeitado porque novos recursos ampliariam
  o acoplamento horizontal e o servidor central.
- **Reescrita integral:** rejeitada; a migração usa strangler e contratos atuais.

## Revisão

Revisar por módulo quando dois ou mais gatilhos forem medidos: escala distinta,
isolamento necessário, SLO independente, ownership separado ou frequência de
deploy incompatível.
