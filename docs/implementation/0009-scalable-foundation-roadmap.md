# Roadmap 0009 — construção incremental da fundação expansível

**Status:** em implementação incremental
**Data:** 30 de agosto de 2026
**Fonte:** [Spec 0009](../specs/0009-scalable-product-foundation.md)
**Custo desta documentação:** [Avaliação 0010](../costs/0010-scalable-foundation-planning.md) e [Avaliação 0012](../costs/0012-supabase-infisical-platform-planning.md), delta US$ 0
**Modelo de dados:** [MER 0001](../data/0001-system-entity-relationship-model.md)
**Plataforma de dados e segredos:** [ADRs 0016](../adr/0016-managed-supabase-postgres.md) e [0017](../adr/0017-infisical-secrets-control-plane.md)

## 1. Estratégia

Evoluir o sistema por strangler/refatoração incremental. As rotas e testes atuais
continuam funcionando enquanto responsabilidades são extraídas e substituídas
por contratos duráveis. Não haverá reescrita integral nem introdução simultânea
de banco, fila, storage e novos módulos.

Cada etapa produz uma fundação utilizável e reversível. Alteração estrutural sem
mudança de comportamento começa por testes de caracterização. Alteração de
comportamento começa por teste falhando e spec executável.

## 2. Ordem obrigatória

### Etapa A — limites de módulo e HTTP fino

**Resultado:** o código pode crescer sem transformar o servidor HTTP em ponto
único de acoplamento.

**Progresso em 31/08/2026:** FND-011 está atendido localmente para as 15
operações HTTP públicas atuais. O contrato OpenAPI 3.1 versionado valida
operações, DTOs, paginação, erros e bearer; a CI bloqueia remoções e mudanças
incompatíveis contra a branch-base. Sessão, busca, perfis, alertas,
processos/documentos e publicações agora possuem handlers próprios; transporte
seguro e upgrade WebSocket também foram isolados. `src/http/server.ts` caiu de
1.567 para 99 linhas e um teste arquitetural bloqueia nova centralização e
mudança na ordem de precedência. A etapa continua aberta para migrar a
organização global por camadas para limites completos por capability e para
formalizar AsyncAPI antes de exposição externa do WebSocket.

Entregas:

- mapa de módulos e dependências permitidas;
- contracts públicos por módulo e shared kernel mínimo;
- `RequestContext`, relógio e IDs opacos;
- roteador/handlers separados por capability;
- mapeamento uniforme de entrada, saída e erro;
- composition root por workload;
- configuração tipada e validada no startup;
- teste de arquitetura para ciclos e imports proibidos.

Migração inicial:

1. caracterizar rotas atuais;
2. extrair health/static sem tocar regra;
3. extrair busca processual;
4. extrair documentos/publicações;
5. extrair sessão assistida;
6. manter contrato `/api/v1` inalterado.

IDs: `FND-001` a `FND-005`, `FND-011`.

Gate de saída:

- `src/http/server.ts` deixa de conhecer implementações de fonte/documento;
- cada handler tem responsabilidade única e contract test;
- configuração insegura falha antes de abrir a porta;
- cobertura, build e E2E atuais permanecem verdes;
- nenhum recurso de nuvem novo.

### Etapa B — tenancy e persistência operacional

**Resultado:** usuários recuperam alvos e preferências sem risco cross-tenant.

**Progresso em 30/08/2026:** a fundação local já possui repositories equivalentes
em memória/PostgreSQL, RLS forçada, FKs compostas, paginação por cursor,
concorrência otimista, arquivamento lógico, estado por fonte, teste de pool e
restore sintético. O mapeamento do provider subject autenticado para UUIDs
internos estáveis também está pronto e o bootstrap concorrente foi verificado.
A etapa permanece aberta para organizações, Supabase sandbox,
Infisical/Secret Manager, RPO/RTO gerenciado e medição cross-cloud.

**Ciclo de vida em 31/08/2026:** classificação, retenção inicial, exportação e
exclusão pessoal foram especificadas na Spec 0027/ADR 0022 e revisadas no threat
model 0007. A migration 0012 implementa pedidos duráveis, freeze imediato,
claim/lease/retry, TTL de 24 horas, purge tenant-bound e tombstone sem PII, com
RLS forçada, role dedicada, pgTAP, contrato PostgreSQL A/B e restore. O worker
one-shot local projeta JSON determinístico, revela identificadores somente em
memória, grava com SHA-256 no store privado, expira objetos e reconcilia todos
os locators antes do purge. A implementação 0032 adicionou API/OpenAPI e painel
para pedido, estado, download íntegro e exclusão, com `auth_time`,
reautenticação recente, confirmação exata e testes HTTP/A-B. Permanecem abertas
organizações, legal hold e políticas gerenciadas de backup/GCS.

**Proteção de identificadores em 30/08/2026:** HMAC tenant-bound, AES-256-GCM,
minimização de rótulos, migration 0003 e redaction no contrato de listagem estão
verificados localmente. Cadastro, listagem e arquivamento autenticados já estão
conectados ao PostgreSQL no Compose com configuração fail-closed. O painel já
consome a projeção minimizada e apaga o Web Storage legado. A entrega de chaves
reais por vault permanece aberta. O worker local e a persistência inicial de
evidência tenant-private já estão conectados ao cadastro protegido.

**Object storage em 31/08/2026:** o adapter GCS tenant-private já implementa
download, materialização, exportação e deleção pelos mesmos contratos locais.
Criação condicional, geração imutável, hash, limites, namespaces, configuração
fail-closed e IAM de verificação estão cobertos integralmente. Nenhuma conta ou
bucket foi acessado. O próximo gate é Supabase/Supavisor sandbox, seguido por
Secret Sync e somente então rollout do bucket/revisão Cloud Run.

Pré-condições:

- revisão jurídica de dados persistidos;
- avaliação de custo de Supabase/GCS/egress cross-cloud aprovada acima do teto
  atual quando necessário;
- threat model de persistência e exclusão;
- Supabase CLI/PostgreSQL e storage local adicionados ao Compose antes de usar
  serviço real;
- Infisical e Secret Manager especificados com bootstrap, sync, rotação e
  recuperação sem segredo estático.

Entregas:

- tenant e membership resolvidos server-side;
- repositories de organizações, alvos, subscriptions e source state;
- contract tests idênticos para memory e Supabase/PostgreSQL local;
- concorrência otimista e paginação por cursor;
- migrations SQL, constraints, índices e RLS testados com pgTAP;
- role sem ownership/BYPASSRLS e tenant aplicado por transação;
- Supavisor transaction mode validado com pool/timeout/carga;
- classificação, TTL, exportação e exclusão;
- backup/restore e migração expand-contract;
- secrets de runtime sincronizados de Infisical para GCP Secret Manager com
  namespace allowlisted e deleção inicialmente desabilitada;
- implementação incremental das entidades e aggregate boundaries do MER 0001.

IDs: `FND-005`, `FND-006`, `FND-008`, `FND-012`, `FND-013`, `FND-016`,
`FND-017`, `FND-019`.

Gate de saída:

- todos os repositories falham fechados sem tenant;
- suíte cross-tenant cobre leitura, escrita, paginação e exclusão;
- restore e migração são exercitados com dados sintéticos;
- produção não é usada em teste;
- custo por 1.000 alvos e limite mensal conhecidos.
- nenhum valor de secret aparece em Git, CI, Terraform state, logs ou banco;
- falha do Infisical não interrompe requests que usam a última versão válida.

### Etapa C — evidência e projeções reconstruíveis

**Resultado:** adicionar fonte ou corrigir parser não perde histórico nem muda
silenciosamente o fato exibido.

**Progresso em 31/08/2026:** `SourceEnvelope`, `CanonicalObservation`,
`CaseRecord`, referência externa e `TenantCase` já são gravados na mesma
transação da conclusão do worker. Replay, parser novo, isolamento tenant, RLS,
privilégios, restore e 1.000 observações sintéticas foram verificados. A API já
lista a carteira pessoal persistida por uma projeção paginada que revalida o
tenant no banco e não concede leitura direta das evidências. A etapa permanece
aberta para payload em object storage, eventos/publicações, detalhe/linha do
tempo, vínculo de evidência, conflitos multi-fonte e ferramenta explícita de
rebuild/diff.

Entregas:

- `SourceEnvelope`, `CanonicalObservation` e `ProjectionVersion`;
- adapter DJEN traduz payload externo no limite da infraestrutura;
- hash, fonte, external ID, coleta e versões preservados;
- object storage local/emulado para payload grande;
- projeção de processo/linha do tempo reconstruível;
- vínculo candidate/confirmed/rejected/revoked;
- conflict report entre fontes;
- ferramenta de rebuild com dry-run e comparação.

IDs: `FND-007`, `FND-012`, `FND-013`, `FND-019`.

Gate de saída:

- payload específico do DJEN não aparece no domínio canônico;
- reprocessar o mesmo envelope não duplica evento;
- trocar versão do parser mantém original e gera diff auditável;
- evidência global pública só é acessível por grant tenant-scoped;
- evidência restrita nunca usa namespace global.

### Etapa D — outbox, jobs e monitoramento durável

**Resultado:** atualizações agendadas e retries não perdem trabalho nem duplicam
efeito.

**Progresso em 31/08/2026:** gatilho periódico, fronteira privilegiada e contrato
da state machine estão definidos na Spec 0014/ADR 0020. O executor local já
valida fonte habilitada, reveal em memória, projeção mínima de observações,
sucesso, backoff, limite de falhas e métricas fail-safe com cobertura integral.
Persistência de leases/outbox, role restrita, cadastro atômico e comando Compose
one-shot estão implementados. O dispatcher agora reivindica a outbox com role
própria, lease, retry limitado, dead letter e `eventId` como chave de
idempotência; a inbox possui constraint por consumidor/evento para uso na mesma
transação do efeito futuro. Permanecem abertos o publisher real, handlers de
consumidor, cancelamento e política de retenção; nenhuma fonte real foi ativada.

Pré-condições:

- custo e quotas de Scheduler/Tasks aprovados;
- métricas e runbooks de backlog/fonte definidos.

Entregas:

- outbox transacional e dispatcher;
- deduplicação/inbox por consumidor;
- state machine de job e leases;
- sync inicial e seleção de alvos ativos/vencidos;
- retry/backoff/rate limit por fonte e tenant;
- sucesso parcial, cancelamento e dead letter;
- clock fake e replay determinístico;
- adapter local in-process e adapter Cloud Tasks posterior.

IDs: `FND-009`, `FND-010`, `FND-015`, `FND-020`.

Gate de saída:

- falhar após commit e antes do dispatch não perde trabalho;
- entregar evento duas vezes produz um único efeito;
- lease expirado é retomado sem duas execuções válidas simultâneas;
- backlog, retries e dead letters são observáveis;
- condição de parada por custo/fonte funciona.

### Etapa E — observabilidade e operação de piloto

**Resultado:** o time consegue detectar, explicar e reverter falhas sem ler dado
sensível.

Entregas:

- correlation end-to-end;
- métricas de API, job, fonte, vínculo, entrega e custo;
- auditoria separada de logs operacionais;
- SLOs do piloto e alertas acionáveis;
- runbooks de fonte indisponível, backlog, vazamento, restore e rollback;
- dashboards sem PII;
- teste de redaction e inventário de eventos de auditoria;
- exercício de incident response.

IDs: `FND-015`, `FND-019`, `FND-020`.

Gate de saída:

- cada alerta possui ação e responsável;
- um fluxo pode ser rastreado por correlation ID;
- logs/scans não encontram nome, CPF/CNPJ, token, publicação ou URL assinada;
- restore e rollback têm evidência recente;
- 30 dias de operação controlada precedem compromisso comercial.

### Etapa F — entitlements e extensão profissional

**Resultado:** recursos e limites podem variar por persona sem duplicar produto
ou enfraquecer autorização.

Entregas:

- decisões separadas de role, entitlement e feature flag;
- quotas atômicas/idempotentes;
- flags server-side com owner e expiração;
- medição por unidade comercial;
- organizações/clientes/OABs sobre os contratos existentes;
- módulo avançado sem alterar fato processual.

IDs: `FND-014`, `FND-020` e requisitos `ORG/PRO/ENT` da Spec 0008.

Gate de saída:

- retirar plano/flag nunca concede dado não autorizado;
- concorrência não ultrapassa quota de forma silenciosa;
- experiência simples e avançada usam a mesma projeção;
- billing futuro consome usage records, não logs.

### Etapa G — hardening de entrega e produção

**Resultado:** o mesmo artefato validado é promovido com provenance, rollback e
ambientes realmente isolados.

Entregas:

- projetos/states/identidades separados por ambiente;
- build único, SBOM e assinatura/provenance;
- promoção por digest;
- staging com dados sintéticos e DAST;
- canário, smoke e rollback automatizado/manual;
- budgets, quotas e verificação de custo D+7/D+30;
- restore e disaster recovery testados.

IDs: `FND-017` a `FND-020`.

Gate de saída:

- production não recompila;
- nenhum secret estático em CI;
- staging e production não compartilham state, SA, secrets ou dados;
- deploy falho interrompe promoção e rollback usa digest conhecido;
- todos os checks normativos bloqueiam merge/deploy.

## 3. Primeiras specs executáveis

| Ordem | Spec proposta | Mudança | Infra nova? |
|---:|---|---|---:|
| 1 | Limites de módulo e teste de arquitetura | refatoração sem comportamento | não |
| 2 | Configuration, composition root e secret references | startup seguro e adapters por ambiente | não |
| 3 | Handlers e contrato de erro v1 | HTTP fino, mantendo API | não |
| 4 | RequestContext e resolução de tenant | autorização preparada para persistência | não |
| 5 | Supabase local e repository contracts | PostgreSQL, migrations, pgTAP e storage local | local apenas |
| 6 | Infisical → Secret Manager | entrega, rotação, alerta e rollback de secrets | sim |
| 7 | Persistência de alvos/subscriptions | primeiro estado durável | sim |
| 8 | Envelope de evidência e projeção | origem/rebuild/versionamento | sim |
| 9 | Outbox e job state machine local | durabilidade/idempotência | banco existente |
| 10 | Scheduler/Tasks adapters | execução periódica e retry | sim |
| 11 | Observabilidade do piloto | SLO, métricas e runbooks | possivelmente |

As specs 1 a 4 formam o primeiro pacote recomendado porque reduzem acoplamento
sem criar custo de nuvem nem persistir dado pessoal.

## 4. Estrutura-alvo do código

Estrutura indicativa; nomes finais serão validados na primeira spec:

```text
src/
  platform/
    config/
    http/
    observability/
    persistence/
  modules/
    identity-access/
      domain/
      application/
      adapters/
      contract.ts
    monitoring/
    case-evidence/
    documents/
    notifications/
    audit/
  workloads/
    web-api/
      composition-root.ts
    browser-renderer/
      composition-root.ts
    worker/
      composition-root.ts
```

Não haverá pasta `utils` indiscriminada. Código só sobe para `platform/shared`
depois de pelo menos dois usos reais e sem regra de domínio.

## 5. Matriz de testes por etapa

| Etapa | Unit | Contract | Integration/emulator | Cross-tenant | E2E | Mutation | Load/operation |
|---|---:|---:|---:|---:|---:|---:|---:|
| A | sim | API | não | auth context | atuais | autorização | não |
| B | sim | repositories | Supabase/pgTAP | obrigatório | persistência | auth/repos/RLS | queries/pool |
| C | sim | fontes/projeções | storage | grants | timeline | vínculo/dedup | rebuild |
| D | sim | eventos/jobs | fila local | jobs | monitoramento | outbox/dedup | backlog/replay |
| E | sim | telemetry | staging sintético | auditoria | incidente | redaction | restore/rollback |
| F | sim | entitlement | emulator | org/role | profissional | quota | concorrência |
| G | — | artefato | staging | IAM | smoke/DAST | — | canário/DR |

## 6. Gatilhos que bloqueiam expansão funcional

Uma feature posterior não inicia se:

- importar adapter/SDK diretamente no domínio;
- não possuir tenant/grant em toda rota de dados privados;
- criar escrita sem idempotência/concorrência definida;
- depender de payload externo sem adapter/versionamento;
- não distinguir original, normalizado e derivado;
- exigir scan/listagem sem paginação/limite;
- não possuir cenário parcial, retry e rollback;
- introduzir novo serviço sem métrica e custo aprovados;
- exigir quebra de `/api/v1` sem migração;
- não conseguir operar e excluir o dado coletado.

## 7. Métricas de saúde da fundação

- ciclos/imports proibidos: zero;
- contratos quebrados sem versão: zero;
- acessos cross-tenant: zero;
- efeitos duplicados após replay: zero;
- jobs sem estado terminal ou retry conhecido: zero;
- payload externo sem proveniência: zero;
- migrations sem dry-run/rollback: zero;
- alertas sem runbook/owner: zero;
- dependências/serviços sem custo e ownership: zero;
- tempo de adicionar uma fonte sem alterar módulos consumidores;
- tempo de reconstruir projeção e recuperar backlog;
- custo por alvo, evento, documento e job.

## 8. Definition of Ready por etapa

- spec pequena e IDs `FND-*` selecionados;
- comportamento atual caracterizado;
- ameaça e classificação de dados revisadas;
- custo aprovado, mesmo zero;
- contratos/migração/rollback descritos;
- testes e métricas definidos;
- blast radius e feature flag quando necessários;
- nenhuma dependência ou serviço escolhido sem comparar alternativa simples.

## 9. Próxima ação recomendada

A fundação local, os limites de módulo, a persistência e a base cloud passiva já
estão implementados. A próxima fatia é o **adapter GCS com contract tests**, sem
ativação cloud: reproduzir leitura, escrita, integridade, TTL e exclusão do store
local contra um emulator/fake determinístico. Depois, um gate separado poderá
validar Secret Sync e Supavisor em sandbox antes de declarar Jobs/Scheduler.
