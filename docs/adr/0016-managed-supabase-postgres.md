# ADR 0016 — Supabase PostgreSQL gerenciado como banco operacional

**Status:** aceito; runtime local preparado, rollout depende de gate próprio
**Data:** 30 de agosto de 2026
**Relacionado:** [Spec 0009](../specs/0009-scalable-product-foundation.md), [MER 0001](../data/0001-system-entity-relationship-model.md), [Custo 0012](../costs/0012-supabase-infisical-platform-planning.md)
**Substitui:** a escolha física de Firestore nas ADRs [0014](./0014-evolutionary-storage-and-service-extraction.md) e [0015](./0015-logical-model-and-firestore-projections.md)

## Contexto

O MER possui relacionamentos, unicidade, outbox, quotas, organizações,
autorizações e transações multi-entidade. Implementar essas invariantes sobre
Firestore exigiria claims, denormalização e compensações próprias. PostgreSQL
representa o modelo com constraints e transações nativas e reduz risco de
mistura entre tenants.

O produto continuará executando no Google Cloud. Supabase gerenciado oferece
PostgreSQL, região AWS São Paulo (`sa-east-1`), pooling para workloads serverless,
migrations locais e testes de banco. A escolha cria uma fronteira cross-cloud
que precisa ser medida e governada.

## Decisão

Adotar Supabase gerenciado como PostgreSQL operacional planejado, mantendo:

- Cloud Run para API e workers;
- Firebase Identity Platform para identidade;
- Google Cloud Storage para originais, PDFs e exportações;
- Scheduler, Tasks e Run Jobs como adapters assíncronos;
- API do Cloud Run como única porta de dados do frontend no primeiro estágio.

Não adotaremos inicialmente Supabase Auth, Storage, Realtime, Edge Functions,
Queues ou Cron. Isso evita duplicar serviços e responsabilidades. A integração
oficial com Firebase Auth poderá ser avaliada se um cliente Supabase direto for
necessário, mas não é requisito do MVP.

### Conexão e schema

- Cloud Run usa Supavisor em transaction mode, apropriado para serverless;
- prepared statements e recursos dependentes de sessão não são usados nesse
  modo;
- cada workload conecta com login restrito próprio no formato
  `<login>.<project-ref>`; o runtime nunca usa `postgres.<project-ref>`;
- logins cloud herdam uma única role de grupo `NOLOGIN` e não possuem ownership,
  administração ou `BYPASSRLS`;
- pool, timeout, limites e comportamento de falha são testados em carga;
- schema evolui somente por migrations SQL versionadas e revisadas;
- constraints, índices e políticas recebem testes pgTAP e contract tests;
- tipos gerados ajudam o adapter, mas não substituem entidades de domínio;
- Terraform administra organização/projeto/configuração suportada; conteúdo do
  schema continua nas migrations, sem segredo em state.

### Isolamento

- cada tabela privada possui `tenant_id` obrigatório e foreign keys compostas
  quando necessárias para impedir referência cross-tenant;
- RLS é habilitado e forçado como defesa em profundidade;
- a aplicação usa role dedicada sem ownership/BYPASSRLS;
- o contexto de tenant é aplicado dentro de cada transação, nunca por variável
  de sessão que possa vazar no pool;
- colunas usadas pelas policies possuem índices adequados;
- autorização no caso de uso e repository continua obrigatória; RLS não a
  substitui;
- jobs administrativos usam role separada, escopo explícito e auditoria.

### Ambientes e disponibilidade

- local usa Supabase CLI/PostgreSQL com dados sintéticos;
- staging e production têm projetos, credenciais, backups e migrations separados;
- Free serve apenas para validação; produção requer plano e custo aprovados;
- restore, RPO/RTO e retenção são exercitados antes de dado real;
- latência, egress, disponibilidade, DPA e residência entre AWS/GCP são gates do
  piloto;
- indisponibilidade do banco falha fechada; não há fallback para store em memória
  em produção.

## Consequências

- o MER passa a ter mapeamento físico relacional direto;
- constraints e outbox podem ser atômicos sem mecanismo de claim específico;
- ports mantêm domínio independente do SDK Supabase/Postgres;
- existe custo mínimo gerenciado e tráfego cross-cloud a medir;
- GCS continua necessário, inclusive porque backup do banco Supabase não inclui
  objetos de Storage;
- busca textual inicial pode usar PostgreSQL, com motor dedicado apenas por
  evidência de carga.

## Alternativas

- **Firestore:** substituído porque a complexidade de invariantes já está
  presente no modelo, não é apenas uma necessidade futura.
- **Cloud SQL PostgreSQL:** alternativa de contingência se custo, latência,
  residência ou operação cross-cloud falhar nos gates.
- **Supabase self-hosted no GCP:** rejeitado inicialmente; transfere HA, patching,
  backup e segurança para o time.
- **Frontend direto no Data API:** adiado; ampliaria a superfície de autorização
  e criaria dois contratos públicos no início.

## Revisão

Antes da implementação, aprovar custo acima do teto vigente e uma spec de
persistência. Reavaliar após teste de carga/egress, restore e DPA. Falha em
isolamento, RPO/RTO, latência ou custo reabre a comparação com Cloud SQL.
