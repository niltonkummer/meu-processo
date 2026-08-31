# Implementação 0012 — persistência operacional, concorrência e lifecycle

**Status:** implementada e verificada localmente  
**Data:** 30 de agosto de 2026  
**Spec:** [0011](../specs/0011-operational-persistence-and-lifecycle.md)  
**Custo:** [0017](../costs/0017-local-operational-persistence.md)  
**Threat model:** [0004](../security/0004-operational-persistence-threat-model.md)

## Resultado

A segunda fatia da Etapa B foi concluída sem acessar Supabase, Infisical, GCP,
Brevo, dados pessoais ou fontes judiciais. O aggregate de monitoramento local
agora suporta:

- atualização e arquivamento lógico com versão esperada;
- exatamente um vencedor para updates concorrentes com a mesma versão;
- listagem ativa por padrão e inclusão explícita de inativos;
- paginação por cursor, limite de 1 a 100 e nenhuma consulta com `OFFSET`;
- catálogo global de fontes somente leitura para o runtime;
- estado tenant-scoped de cada fonte por alvo, com idempotência e backoff;
- preservação do último sucesso quando uma tentativa posterior falha;
- FK composta e RLS forçada contra referências e leituras cross-tenant;
- contexto de tenant transacional limpo após commit e rollback;
- backup/restore lógico que verifica dados, owner, grants e RLS.

A fonte `djen` foi cadastrada desabilitada e com termos pendentes de revisão. A
implementação não ativa coleta, não agenda workers e não persiste identificadores
reais.

## TDD e mudanças

O ciclo Red começou com contracts de repository e pgTAP falhando por operações e
tabelas inexistentes. O ciclo Green implementou o mesmo comportamento nos
adapters em memória e PostgreSQL, a migration forward-only `0002`, o teste de
reutilização de pool e o restore drill. O refactor concentrou validação de limite,
erros seguros de conflito e mapeamentos do adapter.

Principais artefatos:

- `database/migrations/0002_operational_persistence.sql`;
- `database/tests/0001_foundation_test.sql` com 31 asserts pgTAP;
- `src/application/foundation-repository.ts`;
- `src/infrastructure/foundation-repository.contract-test.ts`;
- `src/infrastructure/memory-foundation-repository.ts`;
- `src/infrastructure/postgres-foundation-repository.ts`;
- `database/scripts/verify_backup_restore.sh`;
- serviços de teste e gates correspondentes no Compose e CI.

## Restore drill e requisitos do script

| ID | Requisito | Evidência |
|---|---|---|
| REQ-001 | falhar cedo e não ocultar erro | strict mode e `ON_ERROR_STOP` |
| REQ-002 | operar apenas no banco Compose allowlisted | host, origem e nome de restore validados |
| REQ-003 | usar somente marcador sintético | UUID/texto reservado no script |
| REQ-004 | verificar controles, não apenas linhas | owner, grants e RLS forçada validados após restore |
| REQ-005 | limpar somente recursos criados | flag de criação, trap de saída e caminhos temporários exatos |
| REQ-006 | não revelar credenciais | nenhum valor de ambiente é impresso |

Referências aplicadas do skill de Bash:

- [Ref: `docs/bash-scripting-guide.md` → Strict Mode and Error Handling]
- [Ref: `docs/script-patterns.md` → Argument Parsing Patterns]
- [Ref: `docs/generation-best-practices.md` → Security Best Practices]

O script foi validado com sintaxe Bash, ShellCheck e checks adicionais, todos
sem findings. A edição foi feita como patch auditável conforme os guardrails do
repositório; nenhum gerador escreveu diretamente no worktree.

## Evidências finais

Executado após a última mudança em banco e volume novos:

| Verificação | Resultado |
|---|---:|
| pgTAP de schema, constraints, grants e RLS | 31/31 |
| contract compartilhado no PostgreSQL e isolamento de pool | 7/7 |
| suíte regular | 304/304 em 29 arquivos |
| cobertura monitorada | 100% statements/branches/functions/lines |
| backup/restore sintético | aprovado |
| Bash syntax, ShellCheck e custom checks | 0 findings |
| lint, typecheck, build e actionlint | aprovado |
| Compose config e `git diff --check` | aprovado |
| secret scan Trivy | 0 segredos |
| imagem PostgreSQL HIGH/CRITICAL corrigíveis | 0 vulnerabilidades |
| SBOM CycloneDX da imagem PostgreSQL | gerado, 336.099 bytes |
| `npm audit --audit-level=high` | aprovado; 0 high/critical |

O audit ainda informa nove vulnerabilidades moderadas transitivas já registradas
na cadeia Firebase/Firebase Tools. O reparo sugerido exige alteração breaking e
não foi aplicado silenciosamente.

## Mitigações verificadas

- TM-001: contexto aplicado com `set_config(..., true)` e teste na mesma conexão
  após commit e rollback;
- TM-002: updates atômicos por `tenant_id`, ID e versão esperada;
- TM-003: listagem ativa por padrão e proibição de criar estado para alvo
  arquivado;
- TM-004: FK composta, RLS forçada e contract cross-tenant;
- TM-005: fixtures sintéticas, scan de secrets e volumes removidos;
- TM-006: restore falha se owner, grants ou RLS não forem preservados;
- TM-007: pool máximo cinco, timeouts de cinco segundos e paginação limitada.

## Operação, rollback e limites

Os projetos Compose usados no Red/Green/final foram removidos com seus volumes.
O adapter em memória permanece como rollback de código; banco local é recriado
somente por migrations forward-only. Não houve commit, push ou deploy.

Esta entrega ainda não oferece persistência de conta real, API CRUD, busca de
CPF/CNPJ, storage de documentos, scheduler, outbox ou execução de worker. O
próximo incremento recomendado é a identidade Firebase → UUID interno e uma API
autenticada mínima para perfis e alvos, ainda com dados sintéticos e antes de
conectar serviços externos.
