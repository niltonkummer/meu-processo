# Spec 0031 — prontidão de runtime Supabase/Supavisor

**Status:** implementada e validada localmente; conexão remota não autorizada  
**Data:** 31 de agosto de 2026  
**Custo:** [Avaliação 0038](../costs/0038-supabase-supavisor-runtime-readiness.md)  
**Decisão:** [ADR 0016](../adr/0016-managed-supabase-postgres.md)

## 1. Objetivo

Tornar os cinco workloads PostgreSQL compatíveis com o Supavisor transaction
mode antes de aplicar qualquer migration no sandbox. A implementação deve
preservar o Compose local, falhar antes da conexão diante de um endpoint inseguro
e impedir que a aplicação use o superusuário `postgres`.

## 2. Workloads e identidades

| Workload | `application_name` | login Supavisor permitido |
|---|---|---|
| API | `meu-processo-api` | `app_runtime_login.<project-ref>` |
| monitoramento | `meu-processo-monitoring-worker` | `app_worker_login.<project-ref>` |
| outbox | `meu-processo-outbox-dispatcher` | `app_dispatcher_login.<project-ref>` |
| documentos | `meu-processo-document-worker` | `app_document_worker_login.<project-ref>` |
| lifecycle | `meu-processo-tenant-lifecycle-worker` | `app_lifecycle_worker_login.<project-ref>` |

Os logins cloud serão roles `LOGIN` sem privilégio administrativo, vinculadas a
uma única role de grupo `NOLOGIN` já criada pelas migrations. A criação e as
senhas desses logins pertencem ao gate de rollout, não a esta implementação.

## 3. Política de conexão

- endpoint `*.pooler.supabase.com` é aceito somente na porta `6543`;
- username contém exatamente o login esperado e project ref lowercase de 20
  caracteres;
- `sslmode` é obrigatório e limitado a `require`, `verify-ca` ou `verify-full`;
- `postgres.<project-ref>` e login de outro workload falham antes da conexão;
- pool Supavisor tem no máximo cinco conexões por processo, zero mínimo, idle de
  10 segundos e lifetime de cinco minutos;
- conexão direta local preserva limite configurado até 20, idle de 30 segundos e
  lifetime de 30 minutos;
- toda conexão tem keepalive, connection timeout de 5 segundos, statement
  timeout de 5 segundos, query timeout de 6 segundos, lock timeout de 1 segundo
  e idle-in-transaction timeout de 5 segundos;
- workers one-shot permitem saída quando o pool está idle e sempre encerram o
  pool no `finally`.

## 4. Compatibilidade transacional

- nenhum repository usa query config com `name`/prepared statement nomeado;
- contexto de usuário e tenant usa configuração transaction-local;
- uma transação usa sempre o mesmo client checked-out;
- migrations, restore e manutenção não usam transaction pooler;
- comandos que dependem de estado de sessão são proibidos no runtime.

## 5. Schema e isolamento

- toda tabela tenant-scoped em `app_private` habilita e força RLS;
- `app_runtime`, `app_worker`, `app_dispatcher`, `app_document_worker` e
  `app_lifecycle_worker` existem como roles `NOLOGIN`, `NOINHERIT`, sem
  administração ou `BYPASSRLS`;
- `public` não possui `USAGE` ou `CREATE` em `app_private`;
- pgTAP executa o contrato em schema novo com dados exclusivamente sintéticos;
- o manifesto de bootstrap inclui migrations 0001–0015 em ordem lexical.

## 6. Critérios de aceite

- TDD prova conexão local, endpoint Supavisor válido e falhas inseguras;
- todos os cinco composition roots usam a mesma factory de pool;
- teste arquitetural impede prepared statement nomeado;
- os 14 arquivos pgTAP passam em banco descartável novo;
- cobertura protegida permanece 100%;
- não há chamada, migration, segredo ou dado real no Supabase.

## 7. Fora do escopo

- instalar/configurar Supabase CLI;
- criar logins cloud ou secrets;
- aplicar migrations no sandbox;
- executar carga/latência Cloud Run → Supavisor;
- commit, push, PR, deploy ou promoção de ambiente.

