# Implementação 0018 — fundação durável do worker de monitoramento

**Status:** implementada e validada localmente  
**Data:** 31 de agosto de 2026  
**Custo:** [0021](../costs/0021-local-monitoring-worker.md)  
**Spec:** [0014](../specs/0014-monitoring-worker-foundation.md)  
**Decisão:** [ADR 0020](../adr/0020-worker-trigger-and-privilege-boundary.md)

## Resultado

O cadastro de um perfil protegido agora grava em uma única transação o sujeito,
o alvo, o vínculo, o estado da fonte e o evento de outbox. A fonte DJEN continua
desabilitada e sem `next_attempt_at` enquanto a revisão de termos e operação não
for aprovada.

O worker ganhou persistência PostgreSQL para executions, leases, recibos mínimos
de observação e outbox. Claims concorrentes usam `SKIP LOCKED`; conclusão e falha
exigem o token original e são idempotentes pelo fingerprint do resultado. Lease
expirada é reconciliada e pode ser reivindicada novamente sem manter dois donos
válidos.

## Fronteiras de privilégio

- `app_runtime` registra perfis por uma função estreita que revalida membership;
- `app_worker` não tem login, ownership, DDL, acesso direto às tabelas nem
  `BYPASSRLS`;
- o login local herda somente `app_worker` e existe apenas no Compose;
- claim, complete e fail são as únicas operações concedidas ao worker;
- todas as funções privilegiadas têm `search_path = ''`;
- as tabelas operacionais usam RLS habilitada e forçada;
- outbox e recibos não recebem label, blind index, ciphertext ou plaintext.

## Execução one-shot

O composition root abre um pool com a credencial restrita, constrói o protetor
AES-GCM, executa exatamente um tick e fecha todas as conexões. A configuração
falha antes do startup para URL, chaves, IDs ou limites inválidos. Não existe
loop permanente nem adapter real registrado.

O profile `worker` do Compose executa o mesmo artefato distroless usado pela API,
como usuário não privilegiado, filesystem somente leitura, capabilities
removidas e `no-new-privileges`. Em banco recém-criado, o smoke test retorna:

```json
{"event":"monitoring.worker.tick","claimed":0,"succeeded":0,"failed":0}
```

Esse resultado é intencional: nenhuma fonte real está liberada.

## Evidência

- 433 testes de aplicação/UI em 40 arquivos;
- 100% de statements, branches, functions e lines no núcleo monitorado;
- 84 asserts pgTAP em banco criado do zero;
- 11 contracts PostgreSQL, incluindo concorrência e caminho sintético cifrado;
- replay de cadastro, complete e fail sem efeitos duplicados;
- crash/reclaim e rejeição do dono antigo provados no banco;
- restore lógico preserva dados, ownership, RLS, roles, grants e funções;
- executável one-shot aprovado no Compose sem chamada externa;
- shell script e workflow aprovados pelos validadores estáticos;
- custo adicional de fornecedor: US$ 0.

## Próximo gate

O dispatcher durável, retry/dead letter genérica e a reserva estrutural da inbox
foram entregues pela [Spec 0017](../specs/0017-durable-outbox-dispatcher.md).
Efeitos específicos de consumidores e o adapter real de fila permanecem fora.
Ativar uma fonte exige avaliação separada de termos, rate limits, allowlist,
timeouts, parser, observabilidade e custo para 10, 1.000 e 10.000 perfis. Cloud
Scheduler/Run Job, Supabase e Infisical reais permanecem fora desta fatia.
