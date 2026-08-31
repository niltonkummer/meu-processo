# Spec 0011 — persistência operacional, concorrência e lifecycle

**Status:** implementada e verificada localmente  
**Data:** 30 de agosto de 2026  
**Responsável:** Meu Processo  
**Custo:** [Avaliação 0017](../costs/0017-local-operational-persistence.md)  
**Threat model:** [0004](../security/0004-operational-persistence-threat-model.md)  
**Implementação:** [0012](../implementation/0012-operational-persistence-and-lifecycle.md)  
**Arquitetura:** [Spec 0009](./0009-scalable-product-foundation.md),
[MER 0001](../data/0001-system-entity-relationship-model.md) e
[ADR 0016](../adr/0016-managed-supabase-postgres.md)

## 1. Problema

A migration inicial prova tenancy, criação e paginação, mas ainda não oferece as
invariantes necessárias para operar monitoramento: alterações não usam versão
esperada, registros arquivados continuam listáveis, não há estado por fonte e o
restore dos controles do banco não é exercitado. Conectar o sandbox antes de
resolver essas lacunas ampliaria o risco e dificultaria rollback.

## 2. Resultado esperado

Completar localmente o primeiro aggregate operacional de monitoramento:

- perfil e alvo possuem update/arquivamento com concorrência otimista;
- listagens retornam ativos por padrão e arquivados somente por opção explícita;
- catálogo de fonte é separado do estado tenant-scoped;
- cada alvo mantém estado por fonte sem relação cross-tenant;
- adapters em memória e PostgreSQL obedecem ao mesmo contract;
- commit, rollback e reutilização do pool não vazam contexto;
- backup/restore preserva dados sintéticos, ownership, grants, constraints e RLS;
- migrations são forward-only e executadas em ordem explícita.

Nenhuma rota pública, dado pessoal, consulta judicial ou serviço cloud será
adicionado nesta fatia.

## 3. Modelo e contratos

### 3.1 Lifecycle e versão

`monitored_subjects` e `monitoring_targets` mantêm `version bigint > 0`.
Operações mutáveis recebem `expectedVersion` e executam uma única atualização:

```text
where tenant_id = context.tenantId
  and id = command.id
  and version = expectedVersion
returning version + 1
```

Zero linhas alteradas retorna conflito seguro, sem revelar se o recurso existe
em outro tenant. Arquivamento é lógico, define status `inactive`, `archived_at` e
incrementa versão. Hard delete não pertence ao runtime desta etapa.

### 3.2 Fonte e estado por alvo

`sources` é catálogo operacional global, somente leitura para `app_runtime`.
Uma entrada inicial `djen` será criada desabilitada, com termos pendentes de
revisão; habilitação não faz parte desta etapa.

`target_source_states` contém:

- `tenant_id`, `target_id`, `source_id` e PK opaca;
- status `pending`, `ready`, `running`, `backoff`, `disabled` ou `archived`;
- `last_attempt_at`, `last_success_at`, `next_attempt_at`;
- `consecutive_failures`, `version`, `created_at`, `updated_at`;
- FK composta `(tenant_id, target_id)` e unicidade por target/source;
- RLS habilitada/forçada e índice de seleção por próximo horário.

O runtime não cria, altera ou exclui o catálogo global. Estado tenant-scoped é
criado idempotentemente e atualizado somente com versão esperada.

### 3.3 Listagem e paginação

- cursor continua baseado em UUID com ordenação total;
- limite deve estar entre 1 e 100 no contrato de aplicação;
- sem `includeInactive`, somente status `active` é retornado;
- arquivados nunca são selecionados como alvos de execução;
- não é permitido `OFFSET`.

### 3.4 Pool e transação

- máximo cinco conexões;
- statements sem nome, compatíveis com transaction pooling;
- `statement_timeout` e `idle_in_transaction_session_timeout` de cinco segundos;
- usuário/tenant definidos com `set_config(..., true)` após `BEGIN`;
- commit e rollback limpam o contexto antes de a conexão voltar ao pool;
- nenhuma chamada externa ocorre dentro da transação.

## 4. Casos observáveis

### Sucesso

1. Atualizar rótulo com versão corrente retorna versão incrementada.
2. Arquivar com versão corrente remove o perfil da listagem padrão.
3. Listagem explícita de inativos mostra o item no mesmo tenant.
4. Criar estado de fonte repetidamente com a mesma chave é idempotente.
5. Atualizar estado de fonte com versão corrente registra sucesso/backoff.
6. Backup e restore recuperam marcador sintético e todos os controles.

### Falha segura

1. Update/archive com versão antiga retorna conflito e não altera o valor atual.
2. Usuário de outro tenant não distingue ausente de proibido.
3. Estado não referencia target de outro tenant.
4. Ausência de tenant não lê nem escreve estado.
5. Runtime não cria/altera source, schema, policy ou role.
6. Restore sem RLS forçada, grant mínimo ou owner correto falha o teste.
7. Rollback de transação seguido de reutilização da conexão não preserva tenant.

### Concorrência e ausência

- duas atualizações com a mesma versão produzem exatamente um sucesso;
- recurso ausente e versão obsoleta usam o mesmo erro de conflito;
- lista vazia retorna itens vazios/cursor nulo;
- timestamp de sucesso nunca é apagado por uma tentativa com falha;
- `next_attempt_at` é obrigatório para `ready` ou `backoff`.

## 5. Estratégia TDD

Ordem obrigatória Red → Green → Refactor:

1. ampliar o contract compartilhado com update, conflito e archive;
2. demonstrar falha dos adapters atuais;
3. implementar comportamento no adapter em memória;
4. adicionar pgTAP falhando para migration 0002, RLS, grants e FKs;
5. implementar migration e adapter PostgreSQL;
6. adicionar contract de estado por fonte e concorrência;
7. testar troca de tenant na mesma pool após commit e rollback;
8. adicionar restore drill falhando e depois fazê-lo passar;
9. executar regressão HTTP, arquitetura, cobertura, scans e build.

Application/domain mantêm 100% de statements, branches, functions e lines. Todo
dado de teste usa UUIDs e textos sintéticos.

## 6. Rollout, rollback e recuperação

Rollout somente local/CI:

1. banco vazio aplica 0001 e 0002;
2. pgTAP e contracts executam;
3. dump lógico é restaurado em outro database do mesmo cluster descartável;
4. controles e marcador são verificados;
5. todos os databases/volumes de teste são removidos.

Rollback de código seleciona o adapter em memória. Rollback local do banco
descarta o volume e reaplica somente migrations compatíveis com a versão do
código. Não haverá migration destrutiva/down automática; antes de ambiente
gerenciado será adotado expand/migrate/verify/contract.

## 7. Fora de escopo

- Supabase/Infisical/GCP reais, Terraform ou secret sync;
- identidade Firebase → UUID interno definitiva;
- criptografia/HMAC de nome, CPF/CNPJ ou e-mail;
- APIs CRUD/frontend, processo, evento, documento, evidência, outbox ou jobs;
- hard delete, solicitação LGPD completa ou retenção de backup gerenciado;
- carga cross-cloud, DPA, RPO/RTO de produção e deploy.

## 8. Critérios de aceite

1. migrations 0001/0002 passam em banco vazio e pgTAP valida o novo schema.
2. contracts idênticos passam em memória e PostgreSQL.
3. concorrência produz um vencedor e conflito seguro para versão obsoleta.
4. active/inactive e estado por fonte não vazam entre tenants.
5. mesma pool é reutilizada após commit/rollback sem contexto residual.
6. restore recupera marcador sintético e preserva owner, grants e RLS forçada.
7. runtime continua sem DDL, catálogo de fonte mutável, ownership ou BYPASSRLS.
8. CI executa migration, contracts e restore sem secret/serviço externo.
9. lint, typecheck, cobertura, build e scans permanecem verdes.
10. custo mensal continua até US$ 0,38, delta US$ 0.
