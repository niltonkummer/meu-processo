# Implementação 0021 — dispatcher durável da outbox

**Status:** implementada e validada localmente  
**Data:** 31 de agosto de 2026  
**Custo:** [0024](../costs/0024-local-outbox-dispatcher.md)  
**Spec:** [0017](../specs/0017-durable-outbox-dispatcher.md)  
**Decisão:** [ADR 0013](../adr/0013-transactional-outbox-and-idempotent-jobs.md)

## Resultado

A outbox transacional agora possui um dispatcher one-shot recuperável. Eventos
pendentes são reivindicados em ordem estável com `FOR UPDATE SKIP LOCKED`, lease
limitado e token aleatório armazenado somente como SHA-256. Sucesso, retry e
dead letter exigem o token corrente e aceitam replay idêntico sem duplicar a
transição.

O mesmo `eventId` acompanha todas as tentativas e é entregue ao publisher como
idempotency key. Uma queda após a publicação e antes do ack pode provocar nova
entrega, mas não troca a chave. Essa é a fronteira explícita de entrega pelo
menos uma vez; não existe promessa de exactly-once distribuído.

## Falha fechada no marco 0021

No marco 0021 o composition root ainda não registrava um publisher real. Se
houvesse evento, a publicação desabilitada gerava `OUTBOX_PUBLISH_FAILED`,
limpava o lease e agendava nova tentativa. Um smoke com evento sintético
comprovou:

```json
{"event":"outbox.dispatcher.tick","claimed":1,"published":0,"retried":1,"dead":0,"acknowledgementFailed":0}
```

O registro permaneceu `pending`, com `attempt_count = 1`, próxima tentativa no
futuro e nenhum lease residual. Em banco vazio, worker e dispatcher retornaram
zero claims.

## Fronteiras de segurança

- `app_dispatcher` é uma role separada, nologin, sem herança, DDL, ownership ou
  `BYPASSRLS`;
- a role executa somente `claim_outbox_event`, `complete_outbox_event` e
  `fail_outbox_event`;
- dispatcher, worker e runtime não possuem acesso direto à outbox/inbox;
- funções são `SECURITY DEFINER` com `search_path = ''`;
- leases expirados usam índice parcial para recuperação, e claims concorrentes
  não bloqueiam eventos independentes;
- payload continua sendo objeto JSON de até 4 KiB e passa por validação estrita
  no adapter;
- logs/métricas usam somente IDs, tipo, tentativa, outcome e código estável.

`consumer_inbox_receipts` reserva unicidade por consumidor/evento, FK
tenant-scoped, RLS forçada e ownership do migrator. Nenhuma função genérica grava
o recibo antecipadamente: cada consumidor futuro deve inserir o recibo na mesma
transação do próprio efeito.

## Evidência de validação

- 496 testes de aplicação/UI em 46 arquivos;
- 100% de statements, branches, functions e lines no núcleo monitorado;
- 137 asserts pgTAP em 5 arquivos;
- 18 contracts PostgreSQL em 4 arquivos;
- concorrência, lease expirado, token antigo, replay de ack, retry, dead letter,
  evento futuro e negação de tabela verificados;
- banco recriado do zero, worker/dispatcher one-shot e restore lógico aprovados;
- lint, tipos, build, Compose, Actionlint, ShellCheck, Hadolint e diff check
  aprovados;
- scan de segredos sem achados e imagem final com zero vulnerabilidades
  HIGH/CRITICAL;
- auditoria sem high/critical; permanecem nove findings moderados transitivos já
  conhecidos na cadeia das ferramentas Firebase;
- nenhuma fonte, fila, Supabase, GCP, Infisical ou Brevo foi acessada;
- custo adicional de fornecedor: US$ 0.

## Evolução posterior

O consumidor concreto de alerta interno foi adicionado no marco 0022. Quando o
recurso PostgreSQL padrão está ativo, ele substitui o publisher desabilitado e
grava efeito/receipt atomicamente. A injeção sem publisher nos testes continua
falhando fechada. Publisher de nuvem, e-mail ou webhook ainda exige custo,
threat model, quota por tenant, idempotência do destino, kill switch e rollout
próprios.
