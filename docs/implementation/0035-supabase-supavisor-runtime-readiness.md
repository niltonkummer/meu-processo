# Implementação 0035 — prontidão Supabase/Supavisor

**Status:** implementada e verificada localmente  
**Data:** 31 de agosto de 2026  
**Spec:** [0031](../specs/0031-supabase-supavisor-runtime-readiness.md)  
**Custo:** [0038](../costs/0038-supabase-supavisor-runtime-readiness.md)

## Resultado

- uma factory central aplica limites, timeouts, keepalive e identidade aos cinco
  pools PostgreSQL;
- endpoints Supavisor aceitam somente transaction mode, TLS e login restrito
  correspondente ao workload;
- superusuário `postgres`, pooler em session mode e pool acima de cinco falham
  antes de qualquer tentativa de rede;
- um teste de arquitetura protege a compatibilidade contra prepared statements
  nomeados;
- o contrato pgTAP global valida RLS forçada em toda tabela tenant-scoped, as
  cinco roles restritas e o bloqueio do schema privado para `public`;
- migrations 0014 e 0015 foram incluídas na documentação do manifesto.

## Evidência local

- testes direcionados de pool/arquitetura: 27 aprovados;
- suíte protegida: 81 arquivos e 1.010 testes, com 100% de statements,
  branches, funções e linhas;
- pgTAP em PostgreSQL novo e descartável: 14 arquivos, 257 testes aprovados;
- repository contracts PostgreSQL: 11 arquivos e 35 testes aprovados;
- lint, tipos, OpenAPI, build e auditoria High/Critical aprovados;
- scanner de secrets sem finding;
- nenhuma credencial, conexão ou migration Supabase foi utilizada;
- o banco local já aberto não foi resetado; o volume isolado de teste foi
  removido após a validação.

## Próximo gate — rollout sandbox controlado

1. criar avaliação de custo/rollout e fixar a versão da Supabase CLI;
2. obter o endpoint direto administrativo sem registrar senha;
3. executar lint e dry-run das migrations antes de `db push`;
4. criar cinco logins cloud restritos, com senhas separadas no Infisical e sem
   `SUPERUSER`, ownership ou `BYPASSRLS`;
5. ativar um workload por vez e verificar role, TLS, RLS e redaction;
6. executar pgTAP e smoke com dois tenants sintéticos, incluindo tentativa
   cross-tenant;
7. medir conexões por combinação user/database/mode, latência, timeout e egress;
8. remover logins/schema do sandbox se qualquer gate falhar.

O rollout deve parar se a soma dos pools por role ameaçar o limite do projeto
Free. A configuração do pool interno Supavisor precisa ser medida, pois cada
combinação de usuário, database e modo pode formar um pool independente.
