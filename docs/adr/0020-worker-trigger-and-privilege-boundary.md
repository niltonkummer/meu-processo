# ADR 0020 — gatilho periódico e fronteira privilegiada do worker

**Status:** aceito para implementação local  
**Data:** 30 de agosto de 2026  
**Custo:** [Avaliação 0021](../costs/0021-local-monitoring-worker.md)  
**Relacionado:** [ADR 0013](./0013-transactional-outbox-and-idempotent-jobs.md)

## Contexto

Cadastrar um perfil não deve iniciar uma chamada externa dentro da transação
HTTP, nem devolver o identificador ao navegador para que ele faça a busca. O
worker precisa enxergar trabalho de todos os tenants, mas conceder acesso direto
cross-tenant às tabelas ou chaves destruiria a defesa de RLS.

## Decisão

O banco é a fonte de verdade do agendamento. Criar um perfil produz, na mesma
transação, alvo, vínculo, estado por fonte e evento de outbox. Um tick periódico
aciona um worker stateless, que reivindica um lote pequeno com lease e
`SKIP LOCKED`.

O worker usa uma identidade de banco própria, sem login humano, ownership,
DDL ou `BYPASSRLS`. Ele não recebe `SELECT` geral nas tabelas privadas. Funções
estreitas, `SECURITY DEFINER`, com `search_path` vazio e ownership controlado,
expõem apenas claim/complete/fail. O claim fornece o envelope cifrado e o
contexto criptográfico mínimo; a chave vem do vault e o plaintext só existe na
memória durante a chamada ao adapter.

No local, um comando de execução única representa o tick. Em cloud, a direção é
Cloud Scheduler autenticado chamando um endpoint privado do Cloud Run worker a
cada cinco minutos, com escala a zero. Cloud Tasks pode reduzir latência depois;
Workflows não será usado no MVP.

## Consequências

- o cadastro é rápido e não depende da disponibilidade do tribunal;
- uma falha entre commit e execução não perde o trabalho;
- o pior atraso normal é o intervalo do Scheduler mais o backlog;
- leases expirados permitem retomada e entrega pelo menos uma vez;
- efeitos precisam ser idempotentes pela chave de execução/evento;
- comprometer a API não concede automaticamente varredura cross-tenant;
- rotação de chave e kill switch de fonte são dependências operacionais.

## Alternativas rejeitadas

- **worker disparado somente pelo cadastro:** perde recorrência e recuperação;
- **busca externa dentro do request:** aumenta latência, acoplamento e janela de
  falha;
- **Cloud Tasks já no cadastro:** adiciona custo/serviço antes de medir demanda;
- **Workflows para cada perfil:** custo e complexidade sem orquestração real;
- **role com `BYPASSRLS`:** blast radius incompatível com os dados tratados.

## Revisão

Revisar após medição de backlog/latência ou quando uma coleta exigir passos
duráveis independentes, aprovação humana ou compensação.
