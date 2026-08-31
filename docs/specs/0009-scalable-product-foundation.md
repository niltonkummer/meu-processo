# Spec 0009 — fundação expansível da plataforma

**Status:** aceita para planejamento; implementação incremental depende de specs e custos próprios
**Data:** 30 de agosto de 2026
**Responsável:** Meu Processo
**Relacionadas:** [Spec 0008](./0008-jusbrasil-functional-landscape.md), [Roadmap 0009](../implementation/0009-scalable-foundation-roadmap.md), [MER 0001](../data/0001-system-entity-relationship-model.md), [ADRs 0016](../adr/0016-managed-supabase-postgres.md) e [0017](../adr/0017-infisical-secrets-control-plane.md)

## 1. Objetivo

Criar uma fundação que permita adicionar monitoramento persistente, documentos,
equipes, pesquisa, IA e API sem reescrever o núcleo, misturar dados entre
clientes ou introduzir serviços distribuídos antes da necessidade.

A fundação deve suportar crescimento em quatro dimensões independentes:

- **produto:** novas capacidades e personas;
- **dados:** novas fontes, formatos, volume e retenção;
- **operação:** mais jobs, conectores, latência e falhas parciais;
- **organização:** mais usuários, papéis, clientes e integrações.

Expansível não significa distribuir tudo. A decisão inicial é um monólito modular
com contratos rigorosos, adaptadores substituíveis e processamento assíncrono
idempotente. Serviços só serão separados quando houver evidência operacional.

## 2. Diagnóstico da base atual

### Pontos fortes a preservar

- separação inicial entre `domain`, `application`, `infrastructure` e `http`;
- interfaces para fontes, repositórios, documentos, autenticação e renderer;
- testes determinísticos e 100% de cobertura de aplicação/domínio;
- autorização server-side e tipos de escopo pessoal/organizacional;
- API versionada em `/api/v1`;
- Docker Compose endurecido e Identity Platform emulado;
- infraestrutura declarada em Terraform;
- CI com lint, tipos, testes, cobertura, build, auditoria, container e IaC;
- Cloud Run com escala a zero e renderer isolado.

### Lacunas antes da expansão

- `src/http/server.ts` concentra roteamento, autenticação, parsing, transporte,
  tratamento de erro e vários casos de uso;
- `src/main.ts` compõe dependências diretamente e não possui configuração
  tipada/validada como unidade;
- repositórios operacionais são apenas em memória;
- tipos do DJEN aparecem nos contratos centrais, dificultando múltiplas fontes;
- não existe modelo durável de evidência original, projeção ou versão de parser;
- não existe transação com outbox, job persistente ou política uniforme de
  idempotência;
- contexto organizacional ainda é selecionado por header e precisa ser resolvido
  por membership confiável antes de persistência multiusuário;
- não há estratégia de migração, backfill, rebuild de projeção ou rollback de
  schema;
- Compose ainda não contém Supabase/PostgreSQL e object storage local;
- observabilidade é técnica e pontual, sem SLOs, métricas de fonte e correlação
  transversal;
- entitlements, feature flags e auditoria persistente ainda não existem.

## 3. Princípios arquiteturais

1. Uma única verdade processual, com evidência imutável e projeções reconstruíveis.
2. Autorização antes de leitura; escopo de tenant em banco, cache, fila e objeto.
3. Domínio e aplicação não conhecem SDKs de nuvem, HTTP ou payload de tribunal.
4. Toda escrita relevante é idempotente e possui controle de concorrência.
5. Eventos internos têm entrega pelo menos uma vez; consumidores deduplicam.
6. Estado parcial é explícito e não apaga o último estado válido.
7. Contratos são versionados antes de integrações externas.
8. Configuração falha no startup; segredo não possui valor padrão.
9. Observabilidade não contém PII nem conteúdo processual.
10. Serviços são separados por necessidade medida, não por possibilidade.
11. Evolução ocorre por fatias verticais e testes de caracterização, sem big bang.
12. Toda expansão possui teto de custo, quota e condição de parada.

## 4. Módulos e limites

O monólito modular será organizado por capacidade. Cada módulo terá contrato
público mínimo e poderá conter `domain`, `application` e adapters próprios.

| Módulo | Responsabilidade | Não pode fazer diretamente |
|---|---|---|
| `identity-access` | principal autenticado, memberships, papéis e políticas | confiar em tenant informado sem membership |
| `tenancy` | organizações, usuários, preferências e ciclo de conta | acessar evidência sem grant |
| `source-catalog` | fontes, tribunais, cobertura, limites e saúde | criar vínculo de usuário |
| `monitoring` | alvos, assinaturas, agenda, runs e deduplicação de descoberta | baixar documento ou enviar mensagem |
| `case-evidence` | processos, eventos, evidências e projeções canônicas | decidir autorização de tenant sozinho |
| `documents` | metadados, acesso, sessão assistida, cache e exportações | aceitar URL arbitrária do cliente |
| `notifications` | preferências, templates técnicos e entregas idempotentes | interpretar juridicamente evento |
| `organizations` | clientes, OABs, equipes, tags e responsáveis | alterar fato processual |
| `entitlements` | planos, quotas, feature flags e consumo | substituir autorização |
| `audit` | trilha de segurança e operação | armazenar conteúdo processual integral |
| `research` | corpus e busca jurídica | consultar dado privado sem grant |
| `ai-assistance` | tarefas baseadas em evidência | ser fonte canônica ou misturar casos |
| `public-api` | contratos, chaves, webhooks e sandbox | acessar adapter de fonte diretamente |

Regras de dependência:

- módulo importa somente o contrato público de outro módulo;
- adapters dependem de application/domain, nunca o inverso;
- HTTP chama casos de uso; não contém regra de negócio;
- `shared` contém somente tipos técnicos estáveis: IDs opacos, relógio, paginação,
  correlation, resultado e erros base;
- CPF, CNJ, proveniência, tenant e entitlement pertencem aos respectivos domínios,
  não a um pacote genérico;
- ciclos de dependência falham no CI.

## 5. Planos de dados

As entidades, cardinalidades, constraints, classificação e mapeamento inicial no
Supabase PostgreSQL/Cloud Storage estão definidas no [MER 0001](../data/0001-system-entity-relationship-model.md).

### 5.1 Plano de controle do tenant

Dados privados que sempre possuem `tenantId`:

- usuários, organizações, memberships e papéis;
- clientes, perfis, OABs e alvos cadastrados;
- subscriptions, preferências, alertas e status de leitura;
- grants de acesso, jobs, exportações, consumo e entitlements;
- auditoria de ações do usuário.

Nenhuma consulta do plano de controle é feita sem tenant resolvido pelo servidor.

### 5.2 Plano de evidência

Dados oficiais públicos podem ser deduplicados entre tenants:

- envelopes originais de fonte;
- processo canônico e aliases oficiais;
- eventos, publicações e metadados públicos de documentos;
- versão de parser, normalizador e projeção.

O cliente nunca consulta esse plano diretamente. Um `AccessGrant` ou
`CaseSubscription` tenant-scoped autoriza a resolução. Evidência restrita,
credencializada ou fornecida pelo usuário nunca é global: pertence ao tenant e
usa namespace/objeto próprio.

### 5.3 Plano de conteúdo

Payloads grandes, PDFs, originais e exportações ficam em object storage. O banco
operacional guarda IDs, metadados, hashes e lifecycle. Objetos usam caminhos
opacos; nenhuma URL da fonte ou assinada é chave pública da API.

### 5.4 Plano analítico

Métricas agregadas e sem PII podem futuramente ir para BigQuery. Analytics não é
fonte do painel, autorização ou estado operacional.

## 6. Contratos canônicos

### 6.1 IDs e tempo

- IDs internos são opacos, não enumeráveis e independentes da fonte;
- CNJ é atributo/identificador natural validado, não chave de tenant;
- timestamps originais mantêm timezone/precisão; `collectedAt` é separado;
- relógio é injetável nos casos de uso e testes;
- paginação externa usa cursor opaco e ordenação total estável.

### 6.2 Evidência e projeção

Todo item recebido da fonte produz:

```text
SourceEnvelope
  sourceId + externalId + retrievedAt + contentHash + parserVersion
      ↓
CanonicalObservation
  schemaVersion + processIdentity + facts + provenance
      ↓
Projection
  case timeline / search view / alert candidate
```

O envelope é append-only. Corrigir parser cria nova observação/projeção, sem
reescrever silenciosamente o original. Projeções possuem versão e podem ser
reconstruídas.

### 6.3 Comandos, consultas e eventos

- comandos expressam intenção e incluem actor, tenant e idempotency key;
- consultas não alteram estado;
- eventos internos descrevem fato no passado e incluem `eventId`, tipo, versão,
  aggregate ID, tenant quando aplicável, correlation e horário;
- payload de evento contém referência mínima, nunca PDF/texto integral;
- mudança incompatível cria nova versão do evento/endpoint.

### 6.4 Erros de API

Toda API usa envelope consistente com código estável, mensagem segura,
correlation ID e detalhes validados. Classes mínimas:

- entrada inválida;
- não autenticado;
- não autorizado ou não encontrado sem enumeração;
- conflito/concorrência;
- quota excedida;
- dependência indisponível;
- sucesso parcial;
- erro interno sem refletir payload externo.

## 7. Persistência e consistência

Supabase PostgreSQL gerenciado é a escolha operacional planejada, sujeito a uma
spec, threat model e custo próprios. Cada repositório expõe operações de domínio,
não queries genéricas nem tipos do SDK.

Requisitos:

- tabelas privadas possuem `tenant_id`, constraints e RLS forçada;
- writes críticos usam transação e versionamento otimista quando aplicável;
- aplicação usa role dedicada sem owner/BYPASSRLS e aplica contexto de tenant
  dentro de cada transação compatível com transaction pooling;
- índices e policies são versionados nas migrations SQL;
- Supavisor transaction mode é usado pelo Cloud Run sem prepared statements;
- limites de pool, timeout, tamanho, lock e fan-out são testados;
- leitura paginada nunca faz scan sem limite;
- exclusão usa workflow auditável e tombstone quando necessário;
- schema separa evidência pública e controle privado; vínculo ocorre somente por
  grant tenant-scoped e policy testada;
- backups, restore, TTL e retenção são definidos antes do piloto.

Mudanças de schema seguem expandir → migrar/reconstruir → verificar → contrair.
Readers permanecem compatíveis durante a janela. Backfill é idempotente,
retomável, limitado e possui dry-run, progresso e rollback.

## 8. Processamento assíncrono

Uma transação que altera estado e precisa produzir trabalho grava também um
registro de outbox. O dispatcher entrega pelo menos uma vez. Consumidores usam
`eventId`/idempotency key e uma inbox ou estado equivalente para deduplicar.

Estados de job:

```text
queued → running → succeeded
                 ↘ partially_succeeded
                 ↘ retry_scheduled → running
                 ↘ failed → dead_lettered
cancel_requested → cancelled
```

Cada job registra escopo, tipo, versão, input mínimo, tentativas, lease,
deadline, progresso, erro seguro e resultado. Timeout não implica falha final; o
lease expirado permite retomada. Concorrência é limitada por fonte e tenant.

Scheduler, Tasks e Run Jobs são adapters futuros. O domínio não depende deles.
Não prometemos exactly-once; garantimos efeito idempotente observável.

## 9. Multi-tenancy, autorização e entitlements

O backend cria um `RequestContext` imutável após verificar token e memberships:

```text
requestId + principalId + tenantId + roleSet + correlationId
```

- tenant solicitado só é aceito se houver membership ativo;
- autorização de recurso ocorre no caso de uso e no repositório;
- ausência e proibição podem retornar a mesma resposta para impedir enumeração;
- cache, job, objeto, índice e prompt carregam tenant/grant;
- papel define ação; entitlement define disponibilidade/limite; feature flag
  define rollout. Nenhum deles substitui os outros;
- suporte administrativo exige fluxo break-glass, justificativa, prazo e auditoria.

## 10. API e integrações

- OpenAPI versionada será fonte de contrato das rotas públicas;
- `/api/v1` permanece compatível durante migração;
- requests de criação/ação aceitam `Idempotency-Key` quando repetição for possível;
- listagens têm cursor, `limit` máximo e filtros allowlisted;
- downloads retornam attachment ou referência temporária autorizada;
- webhooks futuros são assinados, versionados e protegidos contra replay;
- testes de contrato verificam backward compatibility;
- DTOs HTTP não são entidades de domínio nem payloads de fonte.

## 11. Configuração e composição

Haverá uma única composition root por workload. Ela:

- lê e valida todo environment no startup;
- escolhe adapters por ambiente;
- instancia módulos e registra rotas;
- falha se combinação insegura for usada;
- não permite modo de autenticação desabilitado fora de local/test;
- nunca usa segredo como fallback.

Configuração é tipada e testada. Feature flags são server-side, têm proprietário,
expiração e default seguro. Configuração operacional não altera autorização.

Infisical será a fonte de verdade de segredos. O Google Secret Manager recebe
somente os valores necessários por Secret Sync e é a camada lida pelo Cloud Run.
Workloads autenticam com identidade GCP nativa; não há token estático do vault.
Falha de sincronização conserva a última versão válida, alerta e bloqueia a
promoção dependente. Nenhum valor entra em Git, `.env` versionado, Terraform
state, output, log ou banco. Ambientes, identities, pastas e destinos são
isolados. Produção exige threat model, DPA/residência, auditoria, rotação e
recovery drill aprovados.

## 12. Observabilidade e SLOs

Contexto de correlação atravessa HTTP, caso de uso, repositório, job, conector e
notificação. Logs estruturados usam IDs técnicos e nunca nome, CPF/CNPJ, token,
texto integral, PDF ou URL assinada.

Métricas mínimas:

- requests, latência e erros por rota/código;
- runs, backlog, tentativas, dead letters e duração por job;
- disponibilidade, throttle, latência e frescor por fonte;
- resultados, duplicidade e vínculos candidatos/confirmados;
- entregas e falhas por canal;
- bytes, operações e custo por tenant/faixa, sem expor conteúdo;
- acessos negados e ações administrativas.

Antes do piloto: SLOs, alertas acionáveis e runbooks. Antes de SLA comercial:
30 dias de SLO interno comprovado e restore/rollback exercitados.

## 13. Estratégia de testes

Camadas obrigatórias:

- unitários de domínio e aplicação;
- contratos de fontes com fixtures anonimizadas;
- contratos de repositories executados contra memória e Supabase/PostgreSQL local;
- integração com Auth, PostgreSQL e Storage locais;
- migrations e policies testadas com pgTAP, incluindo RLS cross-tenant;
- arquitetura: imports permitidos, ausência de ciclos e SDK fora dos adapters;
- cross-tenant e papéis em toda rota/repository;
- propriedade/fuzz para CNJ, IDs, paginação, deduplicação e idempotência;
- mutation tests em autorização, vínculo, outbox e deduplicação;
- E2E dos fluxos pessoais e profissionais críticos;
- compatibilidade de OpenAPI/eventos;
- carga controlada para queries, fan-out e jobs;
- restore, migração, replay e rollback.

Testes de PR não usam produção nem fonte judicial real. Smoke externo é separado,
limitado e autorizado.

## 14. Requisitos de fundação e aceitação

| ID | Requisito | Critério de aceite |
|---|---|---|
| FND-001 | Monólito modular | módulos e contratos públicos documentados; CI bloqueia ciclo/import indevido |
| FND-002 | HTTP fino | route valida/mapeia e chama caso de uso; regra não reside no transporte |
| FND-003 | Composition root | dependências/configuração montadas em um único ponto testado por workload |
| FND-004 | Configuração segura | startup falha em valor ausente/inseguro; auth disabled só em local/test |
| FND-005 | RequestContext confiável | tenant só resolve por membership server-side |
| FND-006 | Persistência por portas | mesmos contract tests passam em memória e Supabase/PostgreSQL local |
| FND-007 | Evidência imutável | envelope guarda fonte/hash/versões e projeção pode ser reconstruída |
| FND-008 | Concorrência | writes críticos detectam conflito e não perdem atualização |
| FND-009 | Outbox/inbox | falha entre write e dispatch não perde trabalho; replay não duplica efeito |
| FND-010 | Jobs duráveis | timeout/lease/retry/partial/dead letter possuem transições testadas |
| FND-011 | API versionada | OpenAPI valida DTO, paginação, erro e compatibilidade |
| FND-012 | Migração segura | expand/migrate/verify/contract, dry-run e rollback exercitados |
| FND-013 | Isolamento de dados | consultas, objetos, jobs, índices e cache possuem teste cross-tenant |
| FND-014 | Entitlement separado | papel, plano e flag têm decisões distintas e server-side |
| FND-015 | Observabilidade | correlation atravessa fluxo e logs não contêm PII/conteúdo |
| FND-016 | Serviços locais | Compose inicia Auth, Supabase/PostgreSQL e storage necessários sem credencial real |
| FND-017 | IaC por ambiente | state, identidade, secrets e dados não são compartilhados entre ambientes |
| FND-018 | Supply chain | imagem única, SBOM, assinatura/provenance e promoção por digest |
| FND-019 | Data lifecycle | classificação, TTL, exportação, exclusão, backup e restore testados |
| FND-020 | Capacidade/custo | limites e gatilhos de evolução medidos antes de novo serviço |

## 15. Critérios de evolução tecnológica

| Decisão | Permanecer simples enquanto | Considerar evolução quando |
|---|---|---|
| Monólito modular | deploy/escala/SLO comuns atendem | módulo exige escala, segurança ou disponibilidade independente e contrato estável |
| Supabase PostgreSQL | pool, RLS, integridade, custo e SLO atendem | fronteira cross-cloud falha ou escala exige alternativa medida |
| Sem busca dedicada | índices direcionados atendem | texto livre/filtros/latência/custo falham em carga medida |
| Sem Redis | idempotência e cache persistente atendem | hot keys/reuso/latência têm benefício e custo demonstrados |
| Tasks | fila HTTP e retry atendem | múltiplos consumidores/event streaming justificam Pub/Sub |
| Sem Workflows | job possui passos simples | fluxo longo exige compensação, aprovação e dependências visíveis |
| Sem BigQuery | métricas operacionais atendem | análise histórica volumosa possui perguntas e retenção próprias |

Novo serviço exige ao menos duas evidências: limite atual reproduzido, benefício
mensurável, contrato do módulo estável, ownership/runbook e custo aprovado.

## 16. Não objetivos

- microservices, Kubernetes, Kafka, service mesh ou multi-cloud preventivos;
- framework interno genérico antes de duas implementações reais;
- event sourcing integral; somente evidência append-only e eventos necessários;
- abstrair completamente peculiaridades legítimas de cada tribunal;
- migrar tudo em um único PR;
- persistir dados reais antes de isolamento, lifecycle e revisão jurídica;
- usar feature flag como autorização ou esconder dívida permanente.

## 17. Definition of Done da fundação mínima

A fundação mínima estará pronta para o MVP persistente quando `FND-001` a
`FND-017`, `FND-019` e `FND-020` estiverem atendidos para os módulos de identidade,
monitoramento e evidência. `FND-018` deve estar completo antes de produção.

Pesquisa, IA, billing e API corporativa devem reutilizar essa fundação, mas cada
módulo ainda exige seus próprios requisitos, ameaça, custo e avaliação de
qualidade.
