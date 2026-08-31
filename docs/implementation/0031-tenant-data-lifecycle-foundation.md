# Implementação 0031 — fundação do ciclo de vida de dados

**Status:** fundação local completa; API/UI entregues na implementação 0032  
**Data:** 31 de agosto de 2026  
**Spec:** [0027](../specs/0027-tenant-data-lifecycle.md)  
**ADR:** [0022](../adr/0022-two-phase-tenant-data-lifecycle.md)  
**Threat model:** [0007](../security/0007-tenant-data-lifecycle-threat-model.md)  
**Custo:** [0034](../costs/0034-local-data-lifecycle-foundation.md)

## Resultado entregue

- inventário normativo de classes, finalidade e retenção inicial;
- migration 0012 aditiva com pedido de exportação/exclusão, TTL e tombstone;
- role `app_lifecycle_worker` sem login, herança, ownership ou `BYPASSRLS`;
- tabelas com RLS habilitada/forçada, FKs compostas e índices de FK/fila/TTL;
- funções estreitas para request, freeze, claim, complete, retry, expiry e purge;
- congelamento atômico: tenant `deleting`, membership inativa, alvos sem agenda;
- purge em ordem explícita de FK, pseudonimização da identidade órfã e
  preservação do tenant B;
- serviço de aplicação e adapter PostgreSQL que usam apenas `RequestContext`;
- migration 0013 com snapshot JSON versionado, inventário de objetos e página
  limitada de exportações vencidas;
- worker one-shot com reveal somente em memória, serialização determinística,
  SHA-256, retry/dead-end, TTL e purge depois da reconciliação de objetos;
- object store local com escrita atômica `0600`, diretórios `0700`, namespaces
  allowlisted, proteção contra symlink/traversal e exclusão idempotente;
- composition root, configuração fail-closed e serviço Compose com role e rede
  dedicadas, sem conexão com tribunais ou cloud;
- restore ampliado para verificar tabelas, RLS, role e grants de lifecycle.

## Evidência TDD

Os primeiros pgTAP falharam porque migrations/tabelas/funções não existiam. Os
testes do worker, adapter, store, configuração e composição também começaram
vermelhos pela ausência dos respectivos módulos. Cada fronteira ficou verde
antes da integração.

Validação final desta fatia:

- 74 arquivos e 908 testes locais;
- cobertura core 100%: 1.657 statements, 1.269 branches, 332 functions e 1.526
  lines;
- 12 arquivos/244 asserts pgTAP;
- 11 arquivos/35 contratos PostgreSQL;
- E2E real em Compose: exportações A/B legíveis e isoladas, TTL de 24 horas,
  remoção de A e preservação integral do objeto/tenant B;
- backup/restore lógico aprovado com RLS e privilégios preservados;
- lint, typecheck, actionlint, hadolint, OpenAPI e build de produção aprovados;
- audit sem High/Critical (nove moderadas transitivas já conhecidas em tooling
  Firebase), secret scan limpo e imagem com zero High/Critical no Trivy.

## Limite honesto

O fluxo está completo apenas no ambiente local/CI e com dados sintéticos. Ainda
não há rota nem UI para solicitar/baixar exportação ou confirmar exclusão. GCS,
Supabase gerenciado, signed URL, scheduler/job, observabilidade gerenciada,
legal hold e política definitiva de backup/auditoria não foram ativados.

O incremento local de API/UI foi entregue na implementação 0032. A adoção cloud
vem somente depois, com GCS privado, retenção e reconciliação equivalentes
validadas em sandbox e uma avaliação de custo própria.

## Rollout e rollback

Não houve deploy. O rollout local é migration 0012 → migration 0013 → worker
one-shot, com o modo desabilitado por padrão. Rollback antes de uso descarta o
banco efêmero e reaplica 0001–0011; após um tenant entrar em
`deleting/deleted`, rollback de código não o reativa.
