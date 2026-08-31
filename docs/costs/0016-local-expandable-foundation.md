# Avaliação de custo 0016 — fundação expansível local

<!-- infra-cost-assessment:v1 -->

**Status:** implementado e verificado; delta mensal confirmado em US$ 0
**Solicitado por:** proprietário do produto
**Responsável:** proprietário do produto e engenharia
**Data da avaliação:** 30 de agosto de 2026
**Validade:** 30 dias, até 29 de setembro de 2026
**Ambientes afetados:** somente local e CI sem credenciais
**Spec/issue:** [Spec 0009](../specs/0009-scalable-product-foundation.md), etapas A e início da B do [Roadmap 0009](../implementation/0009-scalable-foundation-roadmap.md)

**Custo mensal atual (USD):** até US$ 0,38 no cenário de validação aprovado
**Custo mensal esperado (USD):** até US$ 0,38; delta mensal US$ 0
**Custo mensal limite (USD):** US$ 10
**Custo único esperado (USD):** US$ 0
**Aprovação:** o pedido “Lets plan and do this” aprova a implementação local
descrita neste documento em 30/08/2026

## 1. Escopo aprovado

- testes de caracterização e arquitetura;
- módulos HTTP finos, configuração tipada, `RequestContext` e composition roots;
- PostgreSQL local em Docker Compose, migrations SQL e testes pgTAP;
- repositories em memória e PostgreSQL para conta, tenant, membership, perfil
  monitorado e alvo;
- RLS forçada, role local sem `OWNER`/`BYPASSRLS` e testes cross-tenant;
- dependência Node PostgreSQL pequena, mantida, pinada no lockfile, se necessária;
- documentação de execução, rollback e próxima integração.

Não estão autorizados nesta fatia:

- alteração de Supabase, Infisical, Brevo, GCP ou qualquer dado externo;
- Terraform, deploy, Secret Sync, GCS, Scheduler, Tasks ou envio de e-mail;
- dados pessoais, respostas judiciais reais ou credenciais;
- commit, push, PR ou merge sem solicitação explícita adicional.

## 2. Impacto de custo

| Componente | Estado atual | Estado esperado | Delta mensal |
|---|---|---|---:|
| Cloud Run/GCP existente | validação aprovada | inalterado | US$ 0 |
| Supabase Free São Paulo | sandbox vazio | inalterado e não acessado | US$ 0 |
| Infisical/Brevo | bootstrap de development | inalterado | US$ 0 |
| PostgreSQL/pgTAP local | ausente | containers efêmeros no computador/CI | US$ 0 de fornecedor |
| Dependência Node PostgreSQL | ausente | pacote open source pinado | US$ 0 |

CPU, memória e disco usados pelo Docker local ou runner GitHub já disponível não
geram novo SKU contratado nesta fatia. O banco de testes terá volume local
nomeado, fixtures sintéticas mínimas e poderá ser removido sem custo de saída.

## 3. Limites e condições de parada

- banco local limitado a 256 MiB de memória e 0,5 CPU quando suportado pelo
  ambiente Compose;
- pool de testes limitado a cinco conexões; timeout de conexão de cinco segundos;
- migrations e testes não acessam rede judicial nem serviços cloud;
- CI não recebe secrets e não aplica schema externo;
- parar se qualquer ferramenta exigir plano pago, credencial real ou novo SKU;
- qualquer integração com o sandbox Supabase exige uma nova avaliação aprovada.

## 4. Segurança e rollback

- role de migration e role de aplicação são distintas;
- a role da aplicação não cria schema, tabela, policy ou role;
- todas as tabelas tenant-scoped habilitam e forçam RLS;
- contexto de tenant é local à transação e falha fechado quando ausente;
- migrations possuem `down`/reset local documentado e são exercitadas em banco
  descartável;
- rollback de código remove os novos adapters e mantém os repositories em memória;
- nenhum valor sensível entra em `.env.example`, Git, logs ou relatório.

## 5. Verificação

- Red → Green → Refactor por comportamento;
- 100% de cobertura em application/domain;
- contract tests idênticos para repository em memória e PostgreSQL;
- pgTAP para constraints, privileges e RLS;
- tentativa explícita de leitura, escrita, paginação e exclusão cross-tenant;
- lint, typecheck, build, auditoria de dependências, secret scan e Compose config;
- Infracost não aplicável: nenhum Terraform será alterado.

## 6. Revisão posterior

Sem deploy, não há verificação financeira D+7/D+30. Antes de conectar Cloud Run ao
Supabase ou criar armazenamento/secret no GCP, será criada uma nova avaliação com
latência, egress, pool, operações, armazenamento, backup e condição de parada.
