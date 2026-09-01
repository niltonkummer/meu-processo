# ADR 0012 — separar plano de controle do tenant e plano de evidência

**Status:** aceito
**Data:** 30 de agosto de 2026
**Relacionado:** [Spec 0009](../specs/0009-scalable-product-foundation.md)

## Contexto

Vários usuários podem acompanhar o mesmo processo público. Duplicar toda
evidência por tenant eleva custo e cria versões divergentes. Compartilhar tudo,
por outro lado, permite enumeração e pode vazar documentos restritos ou dados
fornecidos por um cliente.

## Decisão

Separar logicamente:

- **controle tenant-scoped:** organizações, memberships, perfis, alvos,
  subscriptions, grants, alertas, jobs, preferências, consumo e auditoria;
- **evidência pública deduplicável:** envelopes oficiais públicos, processos,
  eventos e metadados com proveniência;
- **conteúdo restrito/privado:** namespace e objetos do tenant, nunca globais.

O cliente não acessa a evidência diretamente. Um caso de uso resolve o tenant a
partir do principal, valida `AccessGrant`/subscription e só então carrega a
evidência. Repositories, caches, jobs, índices e objetos preservam o escopo
necessário. Evidência pública não implica autorização automática.

## Consequências

- uma coleta pública pode atender vários assinantes sem duplicar payload;
- verdade processual pública permanece consistente;
- autorização exige join/resolução server-side e testes negativos rigorosos;
- exclusão de conta remove controle/grants, sem necessariamente apagar fato
  público cuja retenção tenha finalidade própria aprovada;
- documento restrito e dado do usuário não podem reutilizar cache global.

## Alternativas

- **Duplicar tudo por tenant:** rejeitado por custo, divergência e reprocessamento.
- **Base global acessível por ID:** rejeitada por enumeração e vazamento.
- **Classificar todo dado judicial como público:** rejeitado; fonte, segredo,
  credencial e contexto alteram a classificação.

## Revisão

Revisar após a classificação jurídica de uma nova fonte, ou se a autorização de
evidência compartilhada se tornar gargalo medido. A revisão nunca presume que
novo conteúdo é público.
