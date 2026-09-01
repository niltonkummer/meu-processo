# Implementação 0017 — state machine do worker de monitoramento

**Status:** concluída; continuada pela [Implementação 0018](./0018-durable-monitoring-worker-foundation.md)  
**Data:** 30 de agosto de 2026  
**Custo:** [0021](../costs/0021-local-monitoring-worker.md)  
**Spec:** [0014](../specs/0014-monitoring-worker-foundation.md)

## Resultado

Foi criado o caso de uso de execução única do worker, independente de cloud e de
qualquer tribunal. O contrato:

- reivindica até 25 trabalhos com lease;
- resolve somente fontes explicitamente habilitadas;
- revela o identificador apenas no escopo da chamada ao adapter;
- agenda sucesso e backoff determinístico limitado;
- encerra fonte/reveal inválido e falhas que excedem o limite;
- preserva a lease se claim ou acknowledge falhar;
- nunca deixa uma falha do backend de métricas alterar trabalho concluído.

O retorno da fonte passa por uma projeção allowlisted. Somente `externalId`,
`contentHash` SHA-256, `parserVersion` e `collectedAt` válidos chegam ao
repository. Campos extras, mais de 1.000 itens e objetos malformados viram falha
terminal segura. Códigos de erro também são allowlisted para impedir conteúdo
arbitrário em métricas/outbox.

## Evidência

- Red comprovado antes da implementação;
- 28 testes específicos da state machine;
- 400 testes em 37 arquivos no total;
- 100% statements (763/763), branches (500/500), functions (159/159) e lines
  (698/698) no núcleo monitorado;
- nenhum adapter externo, dado real, secret, serviço cloud ou custo adicional.

## Continuação

Repository em memória, persistência PostgreSQL, role/funções estreitas,
contracts, cadastro atômico e comando one-shot foram concluídos na
[Implementação 0018](./0018-durable-monitoring-worker-foundation.md). O DJEN
permanece desabilitado e não foi chamado.
