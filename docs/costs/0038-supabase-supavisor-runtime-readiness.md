# Avaliação de custo 0038 — prontidão Supabase/Supavisor sem rollout

<!-- infra-cost-assessment:v1 -->

**Status:** aprovado para implementação  
**Solicitado por:** proprietário do produto  
**Responsável:** engenharia do Meu Processo  
**Data da avaliação:** 31 de agosto de 2026  
**Ambientes afetados:** código, testes locais e CI  
**Spec/issue:** preparar os workloads PostgreSQL para Supavisor transaction mode

**Custo mensal atual (USD):** até US$ 0,38 já aprovado  
**Custo mensal esperado (USD):** inalterado; delta deste gate US$ 0  
**Custo mensal limite (USD):** inalterado; nenhum consumo cloud autorizado  
**Aprovação:** continuação explícita da implementação pelo proprietário em
31/08/2026, limitada a código, testes sintéticos locais e documentação

## 1. Decisão

Preparar API e workers para usar o pool transacional compartilhado do Supabase,
sem conectar ou alterar o projeto remoto. Este gate inclui:

- política única de pool PostgreSQL com identidade por workload;
- detecção e validação fail-closed de endpoints Supavisor transaction mode;
- limite conservador de conexões, timeouts e reciclagem de conexões;
- verificação estática de ausência de prepared statements nomeados;
- auditoria testada de migrations, RLS forçada e papéis restritos;
- testes somente com dados sintéticos e sem rede.

Este gate não autoriza `supabase db push`, migration remota, criação de usuário,
segredo, conexão ao banco remoto, Cloud Run, `terraform apply`, dado pessoal real,
commit, push, PR ou deploy.

## 2. Impacto de custo

| Componente | Alteração neste gate | Quantidade aplicada | Delta mensal |
|---|---|---:|---:|
| Supabase Free São Paulo | projeto existente permanece vazio | 0 query/migration | US$ 0 |
| Supavisor | configuração e testes locais | 0 conexão remota | US$ 0 |
| Cloud Run | nenhuma revisão ou job | 0 | US$ 0 |
| CI | testes determinísticos locais | sem serviço externo | US$ 0 |

Um rollout posterior deve medir conexões, latência e limites no projeto Free. Se
o Supabase exigir plano pago, o processo para imediatamente e volta para nova
avaliação de custo.

## 3. Guardrails

- workloads serverless usam somente endpoint Supavisor transaction mode na porta
  `6543`; endpoint pooler em outra porta falha antes da conexão;
- o usuário do pooler deve seguir `<login-restrito>.<project-ref>`; o login
  `postgres` é proibido no runtime e TLS é obrigatório;
- cada workload aceita somente seu login (`app_runtime_login`,
  `app_worker_login`, `app_dispatcher_login`, `app_document_worker_login` ou
  `app_lifecycle_worker_login`);
- transaction mode aceita no máximo cinco conexões por processo neste sandbox;
- nenhum query config de produção pode definir `name` (prepared statement);
- cada workload anuncia `application_name` fixo e não derivado do ambiente;
- statement, query, lock e idle-in-transaction timeouts são obrigatórios;
- migrations continuam fora do runtime e deverão usar conexão administrativa
  direta em gate separado;
- URLs, senhas e dados de conexão nunca são registrados em logs ou evidências;
- RLS forçada e grants de menor privilégio são verificados antes do rollout.

## 4. Condições de parada

Parar se for necessário desabilitar RLS, usar `service_role` na aplicação,
armazenar senha no repositório, relaxar TLS, usar prepared statement nomeado,
exceder cinco conexões por processo, acessar o Supabase ou reduzir cobertura.

## 5. Evidência e fontes

- [Supabase — conexão com Postgres](https://supabase.com/docs/guides/database/connecting-to-postgres);
- [Supabase — migrations](https://supabase.com/docs/guides/local-development/database-migrations);
- [Supabase — preços](https://supabase.com/pricing);
- [node-postgres — queries](https://node-postgres.com/features/queries);
- [Avaliação 0014](0014-supabase-sao-paulo-sandbox.md).

## 6. Aprovação

Status **aprovado para implementação** somente no repositório. A aplicação de
migrations e o smoke test remoto exigem outra avaliação de rollout, dry-run,
inventário de secrets, plano de rollback e aprovação explícita.

## 7. Verificação posterior

Em 31/08/2026, sem credencial ou conexão Supabase:

| Evidência | Resultado |
|---|---|
| suíte protegida | 81 arquivos, 1.010 testes, 100% nas quatro métricas |
| schema PostgreSQL novo | 14 arquivos pgTAP, 257 testes aprovados |
| repository contracts | 11 arquivos, 35 testes aprovados |
| lint, tipos, OpenAPI e build | aprovados |
| dependências | zero High/Critical; nove moderados transitivos conhecidos |
| scanner de secrets | zero finding |
| recursos/conexões Supabase | zero |

O delta realizado permanece US$ 0.
