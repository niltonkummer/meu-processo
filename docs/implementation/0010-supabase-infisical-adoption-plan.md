# Plano 0010 — adoção segura de Supabase e Infisical

**Status:** aceito para planejamento; nenhuma conta ou infraestrutura autorizada
**Data:** 30 de agosto de 2026
**Custo:** [Avaliação 0012](../costs/0012-supabase-infisical-platform-planning.md), delta documental US$ 0
**Decisões:** [ADR 0016](../adr/0016-managed-supabase-postgres.md) e [ADR 0017](../adr/0017-infisical-secrets-control-plane.md)

## 1. Arquitetura-alvo

```text
desenvolvedor/CI ── identidade curta ──► Infisical (fonte de verdade)
                                            │ promoção/sync allowlisted
                                            ▼
                                      GCP Secret Manager
                                            │ IAM
                                            ▼
frontend ──► Cloud Run API/worker ── Supavisor ──► Supabase PostgreSQL
                  │                                      │
                  └──────── objetos/evidência ─────────► GCS
```

Não há acesso direto do navegador ao banco nem consulta do vault por request.

## 2. Fases e gates

### Fase 0 — aprovação

- aprovar novo teto mensal, pois Supabase Pro excede US$ 10;
- validar DPA, residência, subprocessadores e egress AWS/GCP;
- concluir threat model de banco, secrets e supply chain;
- definir RPO/RTO, retenção, classificação e inventário de segredos.

**Gate:** nenhum recurso externo antes das quatro aprovações.

### Fase 1 — local, sem segredo real

**Progresso em 30/08/2026:** PostgreSQL/pgTAP local, migrations 0001/0002,
contracts memory/PostgreSQL, RLS forçada, isolamento cross-tenant e restore
sintético estão implementados. Supabase CLI/storage local e qualquer conexão ou
segredo externo continuam pendentes e não foram acessados.

**Atualização em 31/08/2026:** migrations 0001–0015, cinco roles de workload,
factory de pool compatível com Supavisor transaction mode e contrato pgTAP global
estão implementados. O projeto sandbox existe em São Paulo, mas permanece sem
schema, login cloud ou conexão desta implementação.

- adicionar Supabase CLI/PostgreSQL ao ambiente local;
- criar migrations vazias/baseline e testes pgTAP;
- executar repository contracts em memória e Postgres;
- validar constraints, RLS forçada e tentativa cross-tenant;
- usar fixtures sintéticas e placeholders de secret references.

**Gate:** TDD, cobertura e checks de segurança verdes; zero credencial externa.

### Fase 2 — sandbox descartável

- criar projeto Supabase Free apenas para validação técnica;
- medir conexão Cloud Run → Supavisor em transaction mode;
- testar limite do pool, timeout, reconexão, latência e egress;
- autenticar workload no Infisical via GCP ID Token;
- sincronizar um segredo sintético para namespace isolado no Secret Manager;
- provar rollback, redaction e comportamento durante falha do Infisical.

**Gate:** nenhum dado/secret real; resultado de custo e carga registrado. Sandbox
é removível e não serve produção.

### Fase 3 — staging isolado

- provisionar contas/projetos/IAM por Terraform onde o provider suportar;
- aplicar schema por migration assinada/revisada, nunca por Terraform state;
- promover secrets por ambiente com revisão e deleção remota desabilitada;
- executar DAST, cross-tenant, carga, migration rollback e restore drill;
- observar sete dias de custo, pool, sync, erros e egress.

**Gate:** RLS não é bypassável pela role da aplicação; restore atende RPO/RTO;
nenhum scanner encontra secret/PII; orçamento e alertas funcionam.

### Fase 4 — produção

- projeto Supabase Pro e ambiente Infisical aprovados e separados;
- migration expand/migrate/verify/contract com backup e plano de rollback;
- rotação com duas versões durante janela curta e revogação confirmada;
- canário por digest, smoke e reconciliação banco ↔ GCS;
- revisão D+7 e D+30 de custo, segurança e SLO.

**Gate:** promoção para se custo, isolamento, sync, restore ou SLO falhar.

## 3. Segredos iniciais permitidos

| Referência lógica | Consumidor | Entrega | Observação |
|---|---|---|---|
| conexão PostgreSQL da aplicação | Cloud Run API/worker | Secret Manager | role sem owner/BYPASSRLS |
| credenciais de fonte oficial, se autorizadas | conector específico | Secret Manager | pasta e SA dedicadas |
| signing secret de webhook futuro | notifications/public-api | Secret Manager | versão e rotação separadas |

Tokens de usuário, dados processuais, CPF/CNPJ e URLs assinadas não são
configuração de vault. Segredos locais reais não são necessários para testes.

## 4. Definition of Done

- migrations forward/rollback, pgTAP, repository contracts e cross-tenant verdes;
- pool serverless medido sob concorrência e degradação;
- Infisical é a única origem editável e Secret Manager reconcilia sem drift;
- Cloud Run usa IAM e não contém credencial de vault;
- sync falho alerta sem derrubar requests com a versão vigente;
- logs, traces, erros, CI e Terraform não revelam valores;
- backup/restore, rotação, revogação e break-glass foram exercitados;
- custo real permanece no teto explicitamente aprovado.
