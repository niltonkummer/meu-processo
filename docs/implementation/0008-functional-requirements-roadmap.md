# Roadmap 0008 — plano de implementação dos requisitos funcionais

**Status:** aceito para planejamento
**Data:** 30 de agosto de 2026
**Fonte de requisitos:** [Spec 0008](../specs/0008-jusbrasil-functional-landscape.md)
**Custo desta documentação:** [Avaliação 0009](../costs/0009-jusbrasil-functional-requirements-planning.md), delta US$ 0
**Fundação obrigatória:** [Spec 0009](../specs/0009-scalable-product-foundation.md) e [Roadmap 0009](./0009-scalable-foundation-roadmap.md)

## 1. Resultado pretendido

Evoluir a validação atual para uma plataforma confiável de acompanhamento
processual, primeiro para pessoa física e depois para profissionais. Pesquisa
jurídica, IA, API e ecossistema só entram após o núcleo provar cobertura,
isolamento, custo e valor de uso.

O roadmap é orientado a gates, não a datas. Uma fase não avança apenas porque o
código existe: precisa demonstrar precisão, segurança, custo e operação.

As capacidades deste roadmap só podem crescer sobre os contratos, módulos,
isolamento, persistência e processamento definidos na Spec 0009. Os gates de
fundação prevalecem quando forem mais restritivos.

## 2. Regras de execução

Para toda fatia:

1. criar avaliação de custo específica e obter aprovação;
2. criar ou refinar spec executável com sucesso, erro, vazio e parcial;
3. escrever teste falhando, implementar o mínimo e refatorar;
4. manter isolamento, proveniência e cobertura integral;
5. executar CI, scans e testes locais determinísticos;
6. fazer rollout controlado e rollback verificável quando autorizado;
7. medir custo e qualidade antes de ampliar volume;
8. trabalhar em branch curta e integrar somente por PR.

Nenhuma fase autoriza coleta em massa, aquisição de dados, novo SKU, commit,
push, merge ou deploy sem a aprovação correspondente.

## 3. Sequência de entrega

### Fase 0 — baseline, conformidade e medição

**Objetivo:** transformar a validação atual em uma base mensurável antes de
persistir dados pessoais.

Entregas:

- matriz de fontes/tribunais com cobertura, método, autenticação, documentos,
  frequência, termos e saúde;
- contratos anonimizados de DJEN e conectores já usados;
- catálogo de dados e classificação LGPD;
- ameaça atualizada para busca, documentos e futura persistência;
- métricas de sucesso, falso positivo, latência, falha, custo e duplicidade;
- restauração da confirmação de e-mail antes do piloto externo;
- decisão jurídica documentada por fonte e finalidade comercial.

Requisitos preparatórios: `FUN-003`, `FUN-006`, `FUN-008`, `FUN-010`.

Gate de saída:

- nenhuma credencial/dado pessoal em logs ou fixtures;
- cobertura conhecida para as fontes testadas, sem promessa nacional;
- baseline de custo e latência reproduzível;
- risco do acesso temporário por e-mail não verificado encerrado.

### Fase 1 — MVP pessoal confiável

**Objetivo:** cadastrar nome/CNJ, agregar candidatos e acompanhar novidades com
uma experiência simples, sem misturar processos.

Entregas em ordem:

1. modelo canônico versionado de fonte, alvo, processo, evento e vínculo;
2. persistência autenticada e tenant-scoped de alvos e estado de coleta;
3. consulta por CNJ e nome, com paginação, cobertura e candidato de homônimo;
4. confirmação/rejeição explícita de candidatos;
5. sincronização inicial e worker diário somente para alvos ativos;
6. deduplicação determinística e linha do tempo;
7. alertas dentro do painel;
8. modo simples, estados parciais e central de saúde/privacidade.

Requisitos: todos os `FUN-*`, `DIS-*`, `MON-*`, `CAS-*` e `UI-*` P0.

Infraestrutura candidata, sujeita a avaliação própria:

- Supabase PostgreSQL para estado operacional, sujeito à ADR 0016 e aprovação de
  custo acima do teto vigente;
- Cloud Storage para originais mínimos e auditáveis;
- Cloud Scheduler para execução diária;
- Cloud Run existente com separação lógica de API/worker;
- Firebase Authentication com e-mail verificado.

Serviços deliberadamente ausentes: Cloud SQL, Redis, mecanismo de busca,
BigQuery, Pub/Sub, Workflows e IA.

Gate de saída:

- 30 dias de execução controlada;
- nenhuma publicação conhecida perdida no conjunto de validação;
- zero mistura cross-tenant/processo nos testes e incidentes observados;
- duplicidade próxima de zero e toda ausência corretamente qualificada;
- custo por alvo único medido e dentro do limite aprovado;
- pelo menos cinco usuários de validação concluem os fluxos essenciais.

### Fase 2 — documentos e comunicação confiável

**Objetivo:** tornar o acompanhamento acionável com acesso seguro a originais e
notificações externas.

Entregas em ordem:

1. registro de cobertura de documentos por tribunal;
2. download individual pelo gateway brasileiro;
3. sessão humana isolada quando a fonte exigir desafio legítimo;
4. auditoria, limites e malware/content checks;
5. e-mail transacional com verificação, preferências e idempotência;
6. jobs de exportação e download em lote;
7. ZIP com manifesto, hashes, falhas parciais e expiração automática.

Requisitos: `DOC-*`, `NTF-*`, `EXP-*`.

Infraestrutura candidata, sujeita a avaliação própria:

- bucket privado de cache/exportação com lifecycle;
- Cloud Tasks para fila, retry e rate limit por fonte;
- Cloud Run Jobs apenas para pacotes que excedam requisição curta;
- provedor de e-mail escolhido por entregabilidade, região e custo.

Gate de saída:

- autorização e isolamento testados para documento e artefato;
- 100 downloads controlados ou 30 dias sem vazamento/mistura;
- falhas parciais não invalidam documentos corretos;
- objetos expiram e restore/cleanup são verificados;
- taxa de entrega de e-mail e opt-out mensuráveis;
- custo por documento/exportação dentro do limite.

### Fase 3 — profissional e escritório

**Objetivo:** permitir operar uma carteira de clientes e OABs em equipe.

Entregas em ordem:

1. organizações, memberships e papéis;
2. clientes, perfis, OABs, tags e responsáveis;
3. modo avançado carregado sob demanda;
4. filtros, paginação e colunas de carteira;
5. importação CSV com prévia e exportação auditada;
6. ações em lote e central de jobs;
7. auditoria de equipe;
8. entitlements, quotas e medição de consumo;
9. planos comerciais e faturamento em spec separada.

Requisitos: `ORG-*`, `PRO-*`, `ENT-*`.

Gate de saída:

- testes cross-organization e por papel sem exceção;
- importação é retomável e não cria estado parcial silencioso;
- carteira mantém latência alvo no volume aprovado;
- experiência simples não recebe o bundle avançado antes de uso;
- métricas demonstram valor e disposição a pagar;
- revisão jurídica concluída antes de cobrança ou monitoramento de terceiros.

### Fase 4 — pesquisa jurídica própria/licenciada

**Objetivo:** pesquisar somente corpus cuja origem, atualização e direito de uso
sejam conhecidos.

Entregas incrementais por vertical:

1. diários oficiais e publicações já coletados legitimamente;
2. legislação oficial, vigência e versões;
3. jurisprudência oficial e filtros por tribunal;
4. pesquisas salvas e alertas;
5. conteúdo doutrinário, peças e modelos somente após licença.

Requisitos: `RES-001`, `RES-002`.

Decisão de busca:

- começar com índices direcionados do banco operacional;
- adicionar mecanismo textual dedicado somente quando medição mostrar que
  PostgreSQL não atende latência, filtros ou custo;
- manter índice tenant-scoped para conteúdo privado e corpus público separado;
- não usar BigQuery como banco da experiência interativa.

Gate de saída por vertical:

- corpus, período, cobertura e atualização visíveis;
- recall/precision avaliados com conjunto jurídico revisado;
- remoção e reindexação reproduzíveis;
- direitos e retenção aprovados;
- custo por consulta e tamanho do índice medidos.

### Fase 5 — IA baseada em evidência

**Objetivo:** explicar e auxiliar sem inventar fonte nem misturar casos.

Entregas em ordem:

1. conjunto de avaliação aceito e baseline sem IA;
2. resumo/explicação de uma nova publicação com citações;
3. cronologia e resumo de documentos de um único processo;
4. conversas organizadas por caso e histórico pesquisável;
5. pesquisa jurídica conversacional sobre corpus aprovado;
6. rascunhos e mapeamento de teses somente após avaliação específica.

Requisitos: `AI-001` a `AI-004`.

Gate de saída:

- nenhuma afirmação material sem evidência navegável;
- testes adversariais de cross-case e prompt injection passam;
- qualidade jurídica revisada e regressões bloqueiam release;
- usuário sempre acessa original e reconhece conteúdo gerado;
- custo por tarefa, quota e condição de parada aprovados;
- nenhuma saída é protocolada ou tratada como parecer automático.

### Fase 6 — API e soluções corporativas

**Objetivo:** integrar o núcleo comprovado a operações externas, sem transformar
o produto em buscador irrestrito ou motor opaco de decisão.

Entregas em ordem:

1. API versionada para CNJ e carteira autorizada;
2. sandbox com dados sintéticos, documentação e chaves rotacionáveis;
3. webhooks assinados e idempotentes;
4. OAB, publicações e autos conforme cobertura aprovada;
5. consulta em lote assíncrona;
6. SLA e suporte após SLOs internos comprovados.

Requisitos: `API-001` a `API-004`.

Gate de saída:

- contrato de dados, finalidade, quota e auditoria por cliente;
- teste de isolamento e abuso em alta escala;
- billing e limite de custo bloqueiam consumo excedente;
- documentação não promete cobertura ou tempo não medidos;
- background check/score permanecem fora até decisão jurídica e ADR próprios.

### Fase 7 — ecossistema editorial e diretório (opcional)

**Objetivo:** avaliar se conteúdo e diretório melhoram aquisição/retenção sem
desviar do núcleo.

Pré-condições:

- estratégia de moderação, autoria, direitos, denúncias e ranking;
- perfil público somente opt-in;
- proteção contra avaliações falsas, spam e exposição de dados;
- equipe e custo operacional dedicados.

Esta fase não bloqueia nem faz parte da tese principal do produto.

## 4. Backlog executável inicial

As próximas specs pequenas devem ser abertas nesta ordem:

| Ordem | Spec proposta | IDs principais | Resultado observável |
|---:|---|---|---|
| 1 | Catálogo de fontes e cobertura | `FUN-003`, `FUN-006`, `FUN-008` | saber exatamente o que cada tribunal entrega |
| 2 | Modelo canônico e proveniência | `FUN-002` a `FUN-005` | impedir divergência e mistura antes de persistir |
| 3 | Persistência tenant-scoped de alvos | `FUN-001`, `DIS-001`, `DIS-002` | usuário autenticado recupera sua lista com segurança |
| 4 | Vínculo e homônimos | `DIS-003`, `DIS-004` | candidato nunca vira confirmação automática |
| 5 | Coleta direcionada idempotente | `MON-001` a `MON-004` | somente alvos ativos geram novidades únicas |
| 6 | Linha do tempo confiável | `CAS-001` a `CAS-005` | processo exibe fatos e fontes sem HTML indevido |
| 7 | Alertas no painel | `MON-005`, `MON-006` | novidade abre o evento correto |
| 8 | Privacidade e ciclo de conta | `FUN-010` | exportar e excluir antes do piloto externo |

## 5. Dependências e decisões de serviço

| Necessidade | Primeira escolha | Evitar inicialmente | Gatilho de revisão |
|---|---|---|---|
| Estado operacional | Supabase PostgreSQL | Firestore/Cloud SQL inicialmente | falha de custo, latência, residência, SLO ou restore reabre Cloud SQL |
| Originais/exportações | Cloud Storage com lifecycle | arquivo permanente nacional | retenção legítima e economia medida |
| Disparo diário | Cloud Scheduler | Workflows | fluxo longo com dependências e compensações |
| Fila/retry por alvo | Cloud Tasks na Fase 2 | Kafka/Pub/Sub prematuro | múltiplos consumidores independentes |
| Pacote de documentos | Cloud Run Jobs quando necessário | requisição web longa | volume/tamanho exceder serviço curto |
| Cache | estado/idempotência no banco | Redis | alta concorrência e benefício medido |
| Busca | índices direcionados | OpenSearch desde o início | texto livre/filtros não atendidos |
| Analytics | métricas operacionais | BigQuery no painel | volume histórico e perguntas analíticas |
| IA | nenhuma no MVP | resumo automático não avaliado | núcleo confiável e corpus citável |

## 6. Métricas por etapa

| Dimensão | Métrica mínima |
|---|---|
| Cobertura | fontes/tribunais consultados, indisponíveis e desatualizados |
| Precisão | falsos vínculos, homônimos confirmados incorretamente, duplicidade |
| Frescor | atraso fonte → detecção → alerta |
| Confiabilidade | sucesso por fonte, retry, falha parcial, backlog |
| Segurança | tentativas negadas, violações cross-tenant, acesso a documentos |
| Produto | alvos ativos, alertas abertos, documentos acessados, retenção |
| Custo | por alvo único, consulta, GiB, documento, exportação e tarefa de IA |
| Qualidade de IA | groundedness, cobertura de citação, revisão e regressão |

## 7. Definition of Ready de uma fatia

Uma fatia só entra em desenvolvimento se tiver:

- IDs da Spec 0008 e comportamento observável;
- fonte e cobertura conhecidas;
- classificação de dados, finalidade e autorização;
- modelos de sucesso, vazio, erro, parcial e retry;
- testes de isolamento e precisão definidos;
- avaliação de custo aprovada;
- ADR novo ou confirmação explícita dos ADRs existentes;
- rollout, métricas, limite e rollback.

## 8. Definition of Done do roadmap

O roadmap não exige implementar o catálogo inteiro. Ele será considerado
cumprido por fase quando o gate correspondente for atendido e a próxima decisão
for tomada com evidência. Capacidades licenciadas, opcionais ou excluídas não
podem ser contabilizadas como dívida do MVP.
