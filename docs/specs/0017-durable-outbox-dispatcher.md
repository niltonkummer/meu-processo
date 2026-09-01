# Spec 0017 — dispatcher durável e idempotência da outbox

**Status:** aprovada para implementação local  
**Data:** 31 de agosto de 2026  
**Custo:** [0024](../costs/0024-local-outbox-dispatcher.md)  
**Arquitetura:** [ADR 0013](../adr/0013-transactional-outbox-and-idempotent-jobs.md)

## Objetivo

Entregar eventos já gravados atomicamente na outbox sem perdê-los entre commit e
publicação, permitindo repetição segura quando o processo cai em qualquer ponto.

## Contrato

1. o dispatcher reivindica eventos `pending` vencidos em ordem
   `available_at,event_id` usando `FOR UPDATE SKIP LOCKED`;
2. cada claim incrementa `attempt_count` e recebe token aleatório armazenado
   somente como SHA-256, worker e lease limitado;
3. o publisher recebe payload mínimo e `eventId` como idempotency key, nunca o
   token do lease;
4. sucesso confirma `published` somente com token corrente;
5. falha reagenda com backoff limitado ou move para `dead` no máximo configurado;
6. lease expirado torna o mesmo evento elegível novamente, preservando o mesmo
   `eventId`;
7. repetir o mesmo complete/fail é idempotente; token antigo/diferente falha;
8. publisher ausente/desabilitado produz retry, nunca falso sucesso.

## Inbox

`consumer_inbox_receipts` reserva a unicidade `(consumer_name,event_id)` e
preserva tenant, hash do payload e data. O recibo só deve ser inserido na mesma
transação do efeito do consumidor. Não haverá função genérica que grave recibo
antes de um efeito externo e crie falsa promessa de exactly-once.

Para destinos externos, o consumidor deve usar `eventId` como chave de
idempotência oferecida pelo destino. O sistema promete entrega pelo menos uma
vez e efeito idempotente, não exactly-once distribuído.

## Segurança

- `app_dispatcher` é nologin, sem ownership, DDL, herança ou `BYPASSRLS`;
- login local herda somente essa role;
- acesso é limitado às funções claim/complete/fail `SECURITY DEFINER` com
  `search_path = ''`;
- nenhuma tabela recebe grant direto para dispatcher, worker, runtime ou public;
- logs e métricas contêm somente IDs, tipo, tentativa, outcome e código estável;
- payload inválido, grande, não objeto ou projeção inesperada falha fechado.

## Critérios de aceite

1. dois dispatchers não reivindicam o mesmo lease válido;
2. crash/lease expirado reentrega o mesmo `eventId` com nova tentativa;
3. sucesso e falha duplicados não alteram contadores duas vezes;
4. falhas chegam a `dead` exatamente no limite configurado;
5. evento futuro não é reivindicado;
6. role não lê/escreve outbox/inbox diretamente;
7. restore preserva dados, constraints, RLS, ownership e grants;
8. aplicação, PostgreSQL, pgTAP, Compose, scans e cobertura passam;
9. nenhuma integração externa é chamada e o delta mensal é US$ 0.

## Fora do escopo

- ativar publisher de nuvem, e-mail, webhook ou notificação;
- criar efeito de negócio específico de um consumidor;
- limpeza/arquivamento da outbox e inbox;
- Scheduler, Cloud Tasks, Pub/Sub, Workflows, Supabase real ou deploy.
