# ADR 0013 — outbox transacional e jobs com efeitos idempotentes

**Status:** aceito como direção
**Data:** 30 de agosto de 2026
**Relacionado:** [Spec 0009](../specs/0009-scalable-product-foundation.md)

## Contexto

Persistir um alvo e agendar sincronização, gravar evento e criar alerta, ou
concluir exportação e notificar o usuário são operações que atravessam banco e
processamento externo. Publicar trabalho depois do commit pode falhar e perdê-lo;
publicar antes pode executar algo que não foi persistido. Filas entregam mais de
uma vez em cenários normais.

## Decisão

Toda escrita que exige efeito assíncrono grava estado e outbox na mesma transação.
Um dispatcher entrega registros pendentes pelo menos uma vez. Cada mensagem tem
ID, tipo, versão, aggregate, tenant quando aplicável, correlation e payload
mínimo.

Consumidores são idempotentes por `eventId`/idempotency key e registram inbox ou
estado equivalente. Jobs usam state machine explícita, lease, deadline, retry
limitado, backoff, progresso, sucesso parcial, cancelamento e dead letter.

Não prometemos exactly-once. O contrato é: entrega pelo menos uma vez e efeito
observável uma vez. Cloud Tasks/Scheduler/Run Jobs são adapters futuros e
dependem de custo aprovado.

## Consequências

- falha entre commit e dispatch não perde trabalho;
- replay e recuperação são operações normais e testáveis;
- outbox/inbox aumentam escrita, índices, limpeza e observabilidade;
- handlers precisam definir idempotência e concorrência antes de implementar;
- payload grande permanece em storage e é referenciado por ID/hash.

## Alternativas

- **Chamada direta após commit:** rejeitada por janela de perda.
- **Exactly-once distribuído:** rejeitado por promessa impraticável e custo.
- **Fila como fonte de verdade:** rejeitada; estado operacional permanece no
  banco e pode ser reconciliado.
- **Workflows para toda operação:** rejeitado enquanto jobs simples atendem.

## Revisão

Revisar se o volume de outbox, ordenação ou número de consumidores exceder o
modelo medido e justificar log/event stream dedicado.
