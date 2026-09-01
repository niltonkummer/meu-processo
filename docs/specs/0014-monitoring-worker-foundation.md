# Spec 0014 — fundação do worker de monitoramento

**Status:** critérios locais implementados; fonte real não ativada  
**Data:** 30 de agosto de 2026  
**Custo:** [Avaliação 0021](../costs/0021-local-monitoring-worker.md)  
**Arquitetura:** [ADR 0013](../adr/0013-transactional-outbox-and-idempotent-jobs.md)
e [ADR 0020](../adr/0020-worker-trigger-and-privilege-boundary.md)

## 1. Objetivo

Transformar um perfil protegido cadastrado em trabalho recorrente, recuperável e
auditável, sem expor nome/CPF/CNPJ ao navegador, banco de eventos ou logs.

## 2. O que ativa o worker

O cadastro não executa o crawler diretamente. Ele grava atomicamente:

1. `monitored_subject` protegido;
2. `monitoring_target` 1:1 inicial;
3. vínculo subject/target;
4. estado por fonte;
5. evento de outbox `monitoring.target.created.v1`.

O estado nasce `disabled` se a fonte ou seus termos não estiverem ativos; caso
contrário nasce `ready` com `next_attempt_at = now()`. Um tick periódico consulta
somente estados `ready`/`backoff` vencidos. Logo, cadastrar define **o que** deve
ser monitorado e o Scheduler define **quando** o worker acorda.

## 3. State machine

```text
pending -> ready -> running -> ready
                    |          ^
                    v          |
                  backoff -----+

qualquer estado -> disabled | archived
running com lease vencido -> ready (reconciliação)
falhas acima do limite -> disabled + dead-letter outbox
```

- cada claim tem `execution_id`, `lease_token_hash`, `leased_until` e versão;
- no máximo 25 itens por tick local, configurável abaixo desse teto;
- conclusão exige o token original e execução corrente;
- retry exponencial com jitter determinístico, mínimo 5 min e máximo 24 h;
- sucesso agenda o próximo ciclo, inicialmente 24 h;
- fonte desabilitada é kill switch imediato e impede novos claims.

## 4. Segurança e privacidade

- role `app_worker` sem login direto, ownership, DDL ou `BYPASSRLS`;
- login local herda somente `app_worker`; produção usa credencial do vault;
- nenhuma permissão direta cross-tenant nas tabelas operacionais;
- funções estreitas claim/complete/fail, `SECURITY DEFINER`, `search_path = ''`;
- claim retorna envelope AES, tipo, tenant, key version e IDs opacos;
- decrypt somente depois do claim e fora da transação;
- plaintext permanece somente no menor escopo possível em memória, sua
  referência é descartada após a chamada e ele nunca é serializado (strings
  JavaScript não oferecem limpeza garantida em memória);
- erros, outbox, métricas e tracing usam códigos, IDs e contagens sem entrada;
- adapters usam allowlist de host, timeout, limites, rate limit e classificação
  explícita da fonte;
- DJEN continua desabilitado até revisão de termos e limite operacional.

## 5. Idempotência e proveniência

- `execution_id` é único por claim; complete/fail repetido não duplica efeito;
- observação externa usa chave determinística de fonte + external ID + hash;
- o payload bruto não entra na outbox; somente ID/hash/versões;
- gravação de observação, novo estado e outbox de conclusão ocorre em uma
  transação;
- entrega é pelo menos uma vez; o efeito observável deve ocorrer uma vez;
- cada resultado preserva source, collected_at, parser_version e content_hash.

## 6. Falhas seguras

- envelope adulterado/versão de chave ausente: falha permanente, sem plaintext;
- timeout/5xx/rate limit: backoff limitado;
- lease/token inválido: nenhuma alteração e conflito seguro;
- crash após claim: lease vence e reconciliador devolve a `ready`;
- source desabilitada entre claim e chamada: adapter não inicia;
- duas instâncias concorrentes: somente uma recebe cada estado;
- backlog excedido: para novos claims, emite métrica e preserva registros;
- custo/erro por fonte acima do teto: kill switch para a fonte.

## 7. Implementação incremental TDD

1. contrato e state machine puros com relógio/IDs injetados;
2. repository em memória e adapter de fonte sintético;
3. migration de outbox, execution e funções privilegiadas;
4. contract PostgreSQL de concorrência, lease e idempotência;
5. comando worker de execução única no Compose;
6. teste crash/reclaim, duplicate completion e ausência de plaintext;
7. scans, backup/restore e documentação operacional.

## 8. Critérios de aceite local

1. cadastro e agendamento são atômicos ou não gravam nada;
2. fonte desabilitada nunca é chamada;
3. dois workers não obtêm o mesmo lease válido;
4. crash é retomado após o lease sem execução simultânea válida;
5. complete/fail duplicado não altera contadores nem gera evento duplicado;
6. nenhum plaintext aparece no PostgreSQL, outbox, console ou artefatos;
7. outro tenant não lê ou conclui execução alheia;
8. 100% de cobertura no novo application/domain;
9. pgTAP, contracts, restore, lint, tipos, build e scans passam;
10. delta de custo continua US$ 0 e nenhuma integração externa é chamada.

## 9. Fora de escopo desta fatia

- ativar DJEN ou qualquer tribunal no worker;
- Supabase/Infisical/GCP reais;
- persistência canônica completa de processos/documentos; a projeção mínima é
  continuada pela [Spec 0015](./0015-local-case-evidence-foundation.md);
- notificações Brevo;
- Cloud Scheduler, Tasks, Run Jobs ou Workflows;
- dados reais, deploy, commit ou push.
