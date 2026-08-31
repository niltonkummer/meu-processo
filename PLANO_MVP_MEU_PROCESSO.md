# Meu Processo — plano de produto, arquitetura e custos

**Status:** proposta de trabalho
**Atualizado em:** 30 de agosto de 2026
**Projeto Google Cloud:** `meu-processo-507018`
**Região principal:** São Paulo (`southamerica-east1`)

## 1. Decisão de produto

O primeiro produto será um **monitor privado de processos com experiência para pessoa física e modo avançado para profissionais**, e não um buscador público nacional de pessoas ou empresas.

O usuário cadastra:

- seu nome e eventuais variações;
- números de processos já conhecidos;
- opcionalmente, nomes adicionais que tenha legitimidade para acompanhar.

O sistema consulta fontes oficiais, descobre novas publicações, organiza os processos e avisa quando houver novidade.

### Direção funcional ampliada

O produto buscará paridade funcional progressiva com a categoria de acompanhamento processual de plataformas jurídicas consolidadas, mantendo base, marca, código e interface próprios. A experiência simples será prioritária para pessoa física; advogados e escritórios terão uma visão avançada sobre os mesmos fatos, com carteira, filtros, auditoria e ações em lote.

Documentos públicos poderão ser acessados por um gateway brasileiro e baixados em lote por trabalhos assíncronos. Não haverá cópia de base proprietária, conteúdo editorial, doutrina, modelos ou peças de terceiros. A especificação completa está em [Spec 0002 — Paridade funcional em acompanhamento processual](./docs/specs/0002-process-monitoring-functional-parity.md).

O panorama das plataformas de acompanhamento, pesquisa, IA, conteúdo e soluções
corporativas observado em 30 de agosto de 2026 está consolidado na
[Spec 0008 — panorama funcional e requisitos-alvo](./docs/specs/0008-jusbrasil-functional-landscape.md).
A ordem de implementação, os gates por fase e o backlog executável estão no
[Roadmap 0008](./docs/implementation/0008-functional-requirements-roadmap.md).
Esses documentos são referência de produto; não autorizam copiar conteúdo ou
base de terceiros e não substituem a avaliação de custo de cada fatia.

A fundação arquitetural obrigatória para crescer sem misturar tenants, acoplar
fontes ou antecipar microservices está na
[Spec 0009 — fundação expansível](./docs/specs/0009-scalable-product-foundation.md)
e no [Roadmap 0009](./docs/implementation/0009-scalable-foundation-roadmap.md).
O modelo lógico de entidades, relações, cardinalidades e a projeção inicial de
persistência estão no [MER 0001](./docs/data/0001-system-entity-relationship-model.md).
A plataforma de dados e segredos está decidida para planejamento nas
[ADRs 0016 — Supabase PostgreSQL](./docs/adr/0016-managed-supabase-postgres.md) e
[0017 — Infisical](./docs/adr/0017-infisical-secrets-control-plane.md), com adoção
gradual no [Plano 0010](./docs/implementation/0010-supabase-infisical-adoption-plan.md).

### Limite jurídico atual

A partir da Portaria CNJ nº 374/2026, a API Pública do DataJud passou a restringir os dados a fins legais, não comerciais e autorizados, vedando exploração comercial e informações derivadas. Portanto:

- DataJud pode continuar nos testes e no uso pessoal não comercial;
- nenhum produto pago deverá depender de dados do DataJud sem autorização específica;
- o caminho comercial será baseado no DJEN e em fontes próprias/oficiais cuja utilização seja juridicamente validada;
- antes da abertura para clientes, será necessária uma revisão jurídica sobre DJEN, consultas aos tribunais e LGPD.

Referências:

- [Portaria CNJ nº 374/2026](https://atos.cnj.jus.br/atos/detalhar/6972)
- [Termos da API Pública do DataJud](https://datajud-wiki.cnj.jus.br/api-publica/termo-uso/)
- [Documentação da API Pública do DJEN](https://hcomunicaapi.cnj.jus.br/swagger/index.html)

## 2. MVP fundamental

O MVP precisa provar apenas cinco coisas:

1. Encontramos publicações relacionadas a um nome monitorado.
2. Transformamos as publicações em processos únicos, sem duplicação.
3. Percebemos quando surgiu algo novo.
4. Mostramos a informação de forma mais clara que a fonte oficial.
5. Entregamos um alerta confiável.

### Escopo da primeira versão

- Um usuário sintético de validação.
- Um nome principal e variações controladas.
- Os três processos já identificados no teste.
- Consulta diária ao DJEN.
- Registro da resposta original da fonte.
- Deduplicação por comunicação, processo e data.
- Linha do tempo por processo.
- Painel privado.
- Alerta inicialmente dentro do painel; Brevo será o canal transacional do
  próximo passo, após remetente próprio verificado e implementação da outbox.
- Registro da última execução, sucesso, falha e quantidade de resultados.

### O que fica fora do MVP

- Varredura histórica de todo o Judiciário.
- Busca pública por CPF ou CNPJ.
- Avaliação automática de risco jurídico.
- Inteligência artificial e resumos pagos.
- Aplicativo móvel.
- WhatsApp.
- Pagamentos e assinaturas.
- Redis, Elasticsearch/OpenSearch, Kafka ou Kubernetes.
- banco PostgreSQL gerenciado em produção antes da aprovação do novo teto;
- Google Cloud Workflows.

## 3. Arquitetura mínima

```text
Cloud Scheduler
      │ uma execução por dia
      ▼
Cloud Run — coletor/API privado
      │
      ├── consulta DJEN a partir do Brasil
      ├── normaliza nomes e processos
      ├── calcula duplicidade
      ├── grava estado ──────────────► Supabase PostgreSQL
      └── preserva resposta original ► Cloud Storage
                                           │
Firebase Hosting ◄── Cloud Run API ◄───────┘
      │
      ▼
Painel web privado + Firebase Authentication
```

Infisical será a fonte de verdade dos segredos. Ele sincroniza somente os valores
allowlisted para o Google Secret Manager, que os entrega ao Cloud Run por IAM. O
runtime não consulta o vault em cada request e o navegador não acessa diretamente
o banco.

Todos os serviços que armazenam ou processam dados serão mantidos, quando possível, em São Paulo para reduzir latência, transferência entre regiões e dispersão de dados.

## 4. Bancos e armazenamento

### 4.1 Cloud Storage — o equivalente ao S3

Usaremos **Google Cloud Storage**, não Amazon S3, porque a aplicação já está no Google Cloud.

Função:

- guardar respostas originais do DJEN;
- futuramente guardar cadernos diários compactados;
- permitir reprocessamento sem baixar novamente da fonte;
- manter evidência do que a fonte oficial retornou em determinada data;
- guardar exportações e relatórios;
- manter cache privado e temporário de documentos obtidos sob demanda;
- guardar pacotes de download em lote com expiração automática.

Estrutura sugerida:

```text
gs://meu-processo-raw/
  djen/search/2026/08/29/<hash>.json.gz
  djen/cadernos/TJRS/2026/08/29/D/<versao>.zip
  runs/2026/08/29/<run-id>.json
```

Política inicial:

- classe Standard durante 30 ou 90 dias;
- lifecycle para Nearline ou Coldline depois do período de uso frequente;
- versionamento apenas se a necessidade de auditoria justificar;
- criptografia padrão do Google e acesso somente pelas contas de serviço.

### 4.2 Supabase PostgreSQL — banco operacional planejado

Função:

- usuários;
- perfis/nome monitorados;
- processos conhecidos;
- metadados das publicações;
- estado das execuções;
- alertas;
- ponteiros para os arquivos originais no Cloud Storage.

Tabelas/áreas sugeridas:

```text
user_accounts
tenants / tenant_members
monitored_subjects / monitoring_targets
subscriptions / tenant_cases
case_records / case_events / source_envelopes
monitoring_runs / jobs / outbox_events
alerts / audit_events
sourceHealth/{sourceId}
```

`monitoringTargets` representa uma consulta única e normalizada, por exemplo um número CNJ, um nome ou uma OAB. `subscriptions` liga um usuário a esse alvo. Assim, se várias pessoas acompanharem o mesmo processo, o sistema consulta a fonte uma vez e distribui o resultado aos assinantes autorizados.

O texto integral e os arquivos ficam comprimidos no Cloud Storage; no PostgreSQL
mantemos somente o trecho necessário, metadados, hash e referência opaca.

O Supabase será usado inicialmente como PostgreSQL gerenciado, não como segunda
plataforma completa. Auth continua no Firebase, objetos continuam no GCS e API/
workers continuam no Cloud Run. O Cloud Run conecta pelo Supavisor em transaction
mode. Constraints, foreign keys, migrations e RLS forçada protegem as relações e
o isolamento; a API continua aplicando autorização antes da consulta.

### 4.3 Banco de busca

**Não será criado no MVP.**

PostgreSQL é suficiente para listar processos/publicações e a primeira busca
textual controlada. Elasticsearch, OpenSearch, Typesense ou Meilisearch só será
necessário quando a base e as consultas medidas excederem esses índices.

Gatilhos para adicionar busca dedicada:

- centenas de milhares de publicações normalizadas;
- pesquisa textual lenta ou cara;
- necessidade de tolerância a erros de digitação e homônimos;
- filtros combinados por tribunal, nome, assunto, classe e período.

### 4.4 Cloud SQL PostgreSQL

**Não será usado inicialmente.** É a alternativa de contingência se o Supabase
não atender custo, latência cross-cloud, residência, DPA, disponibilidade ou
restore. A decisão deve ser reaberta com medição, não por preferência de vendor.

### 4.5 BigQuery

**Não será usado no fluxo operacional do MVP.** Poderá ser adicionado para medir cobertura, volumes, tribunais, falhas e padrões sobre uma base histórica. Não deve ser usado como banco do painel.

## 5. Cache e agregadores

### Cache

Não precisamos de Redis/Memorystore no MVP. Usaremos:

- `last_checked_at` e `next_check_at` no PostgreSQL;
- deduplicação por hash/identificador da comunicação;
- cabeçalhos HTTP e dados previamente gravados;
- memória temporária apenas durante cada execução.

Redis só será considerado com muitas requisições concorrentes ou cálculos repetidos que não possam ser evitados pelo modelo de dados.

### Agregador

O agregador será inicialmente uma camada de código dentro do coletor, com conectores independentes:

```text
connectors/
  djen
  tribunal-tjrs (futuro)
  tribunal-tjsp (futuro)
  datajud-personal (somente não comercial)
```

Todos devolvem um formato normalizado comum. Não precisamos operar um serviço separado chamado “agregador”.

## 6. Serviços necessários

| Serviço | Agora? | Função |
|---|---:|---|
| Cloud Run | Sim | API privada e execução do coletor no Brasil |
| Cloud Scheduler | Sim | Disparar a consulta diária |
| Supabase PostgreSQL | Após aprovação de custo | Estado operacional, constraints, RLS e outbox |
| Cloud Storage | Sim | Fonte original e arquivo histórico |
| Firebase Authentication | Sim | Login do painel |
| Firebase Hosting | Sim | Hospedar o frontend estático |
| Infisical | Após spec de secrets | Fonte de verdade, ambientes, acesso e rotação |
| Secret Manager | Sim | Projeção de entrega dos secrets ao runtime por IAM |
| Cloud Logging/Monitoring | Sim | Falhas, duração e saúde das fontes |
| Cloud Tasks | Na fase de monitoramento/lote | Fila e retry por alvo, fonte e documento |
| Cloud Run Jobs | Na fase de lote | Empacotar exportações de documentos fora de uma requisição web |
| Pub/Sub | Depois | Separar coleta, normalização, alertas e analytics |
| BigQuery | Depois | Análise histórica e métricas de cobertura |
| Workflows | Não agora | Orquestração visual de fluxos longos e complexos |
| Redis/Memorystore | Não agora | Cache de alta concorrência |
| Cloud SQL | Contingência | Alternativa PostgreSQL se Supabase falhar nos gates |
| OpenSearch/Elastic | Não agora | Busca textual em grande volume |

## 7. Workflows e processamento assíncrono

Google Cloud Workflows **não é necessário neste momento**. O fluxo diário cabe em uma execução idempotente:

```text
agendamento → consulta → normalização → deduplicação → gravação → alerta
```

O próprio código registra cada etapa no PostgreSQL e pode retomar ou repetir uma execução sem criar duplicidades.

### O que ativa o worker

Hoje, o Cloud Run já publicado é um serviço sob demanda: ele escala de zero e só inicia quando recebe uma chamada HTTP, como `/search-djen`. O agendamento automático e a leitura do PostgreSQL ainda serão implementados.

No MVP, o worker trabalha somente com registros cadastrados e ativos. Não haverá pesquisa indiscriminada de pessoas que não tenham sido colocadas em monitoramento.

Existem três gatilhos:

1. **Cadastro:** ao cadastrar um nome, OAB ou processo, a aplicação solicita uma sincronização inicial para mostrar os resultados existentes.
2. **Agendamento diário:** o Cloud Scheduler inicia uma execução que seleciona os alvos com `active = true` e `nextCheckAt <= now`.
3. **Atualização manual:** no futuro, o usuário poderá pedir uma atualização, respeitando limite por plano e limites da fonte.

Fluxo diário:

```text
Scheduler
   ↓
selecionar alvos vencidos
   ↓
agrupar consultas iguais
   ↓
consultar por nome, OAB ou processo
   ↓
normalizar e deduplicar
   ↓
vincular resultados aos assinantes
   ↓
criar alertas
   ↓
definir nextCheckAt
```

Para poucos usuários, esse modelo direcionado é o mais barato. O custo e o número de chamadas crescem com a quantidade de alvos únicos, não necessariamente com o número de usuários.

### Quando mudar para coleta global

Em uma fase posterior, um segundo worker poderá baixar uma vez por dia os cadernos do DJEN de cada tribunal e comparar as publicações com todos os nomes, OABs e processos cadastrados.

```text
cadernos diários do DJEN
          ↓
uma coleta por tribunal/dia
          ↓
normalização e índice temporário
          ↓
comparação apenas com alvos cadastrados
          ↓
alertas
```

Essa estratégia tem custo quase fixo por tribunal e passa a ser melhor quando consultas individuais se aproximarem dos limites de taxa ou ficarem mais caras que processar os cadernos. A decisão será baseada em medição real, não em uma quantidade arbitrária de usuários.

Evolução recomendada:

1. **MVP:** um Cloud Scheduler chama o Cloud Run.
2. **Primeiros usuários:** Cloud Tasks cria uma tarefa por perfil monitorado, com retry e limite de taxa.
3. **Múltiplos consumidores:** Pub/Sub separa coleta, indexação, alertas e analytics.
4. **Fluxos realmente complexos:** Workflows coordena backfill histórico, várias fontes e processos longos.

Cloud Tasks oferece o primeiro milhão de operações mensais sem cobrança. Workflows também possui franquia, mas o motivo para evitá-lo agora é simplicidade, não preço.

## 8. Painel e frontend

### Direção visual: editorial institucional de precisão

O frontend deverá ser moderno sem parecer informal, experimental ou genérico. A direção escolhida combina clareza editorial com a precisão de um sistema financeiro ou de auditoria.

Características:

- fundo claro levemente frio, superfícies brancas e texto em azul-marinho profundo;
- uma única cor de destaque, azul-petróleo, reservada a ações e estados confirmados;
- âmbar somente para atenção e vermelho somente para erro real;
- títulos editoriais discretos e texto de interface altamente legível;
- números CNJ, horários e identificadores com tipografia monoespaçada;
- bordas finas, pouco arredondamento e sombras quase imperceptíveis;
- ícones simples, sem ilustrações decorativas ou clichês jurídicos;
- alta densidade informativa apenas onde necessário, com bastante espaço entre blocos;
- modo escuro não faz parte do MVP, para reduzir variações que precisam ser testadas.

A assinatura visual será uma **régua de procedência** presente em resultados e publicações. Ela mostra sempre:

```text
Processo CNJ · Tribunal · Fonte oficial · Coletado em · Confiança do vínculo
```

Assim, a identidade visual reforça a confiança em vez de ser apenas decoração.

### Modos de experiência

Os dois modos usam a mesma API, autorização, identidade de processo e proveniência:

- **simples:** padrão para pessoa física, orientado a “o que mudou”, “precisa de atenção” e “onde confirmar”;
- **avançado:** carteira densa para profissionais, com clientes, OAB, filtros, seleção múltipla, documentos, exportações e auditoria.

Alternar o modo nunca muda o fato processual nem amplia autorização. O módulo avançado será carregado sob demanda para preservar o desempenho da experiência simples. Critérios detalhados estão na [Spec 0002](./docs/specs/0002-process-monitoring-functional-parity.md).

### Tokens iniciais

| Uso | Definição inicial |
|---|---|
| Fundo | `#F4F6F8` |
| Superfície | `#FFFFFF` |
| Texto principal | `#0B172A` |
| Texto secundário | `#526070` |
| Ação/confirmado | `#0E7182` |
| Atenção | `#A46408` |
| Erro | `#B42318` |
| Bordas | `#D9E0E7` |
| Títulos | Source Serif 4 ou equivalente editorial |
| Interface | Source Sans 3 ou equivalente sans-serif |
| Identificadores | IBM Plex Mono ou equivalente monoespaçada |

As fontes devem ser hospedadas como WOFF2 em subconjuntos mínimos, com `font-display: swap`. Se o custo de carregamento não compensar, utilizaremos uma pilha de fontes do sistema.

### Tecnologia e leveza

- React + TypeScript + Vite.
- Firebase Hosting.
- Firebase Authentication.
- API privada em Cloud Run.
- Layout responsivo, funcionando bem no celular sem aplicativo nativo.
- CSS Modules ou CSS nativo com tokens; evitar bibliotecas visuais pesadas.
- Animações somente em CSS, entre 160 e 220 ms, e compatíveis com `prefers-reduced-motion`.
- Carregamento sob demanda das telas de detalhe e administração.
- Paginação da linha do tempo e virtualização apenas quando o volume justificar.
- Nenhuma biblioteca pesada de gráficos no MVP.
- Cache local somente de arquivos estáticos; dados processuais não devem ficar em service worker ou armazenamento persistente do navegador.

Metas de desempenho do MVP:

| Métrica | Meta |
|---|---:|
| LCP em conexão móvel | menor que 2,5 s |
| INP | menor que 200 ms |
| CLS | menor que 0,1 |
| JavaScript inicial comprimido | alvo de até 150 KB, excluindo autenticação quando inevitável |
| Elementos clicáveis | mínimo de 44 × 44 px |

### Hierarquia de informação

Antes de mostrar qualquer movimentação, a tela deve deixar inequívoco o contexto atual:

```text
Pessoa ou cliente monitorado
    └── Processo CNJ
          └── Tribunal / grau / órgão
                └── Publicação ou movimentação
```

O cabeçalho do processo fica visível durante a navegação da linha do tempo. Nunca exibiremos um texto processual sem número CNJ e fonte no mesmo contexto visual.

### Telas do MVP

#### Visão geral

- quantidade de processos monitorados;
- publicações novas;
- última atualização;
- situação da coleta;
- card de atenção quando uma fonte falhar.

#### Meus processos

- número CNJ;
- tribunal e órgão julgador;
- classe e assunto quando disponíveis;
- última publicação;
- quantidade de novidades não lidas;
- status “confirmado” ou “possível homônimo”.

#### Detalhe do processo

- linha do tempo;
- texto/trecho da publicação;
- data de disponibilização;
- tipo da comunicação;
- link para a fonte oficial;
- origem de cada informação.

#### Perfis monitorados

- nome exato;
- variações aceitas;
- processos vinculados;
- última consulta;
- ativar/desativar monitoramento.

#### Saúde da coleta

- última execução bem-sucedida;
- duração;
- resultados encontrados;
- falhas e tentativas;
- limites de taxa observados.

### Princípios de confiança

- Sempre mostrar a fonte oficial.
- Separar fato da fonte de interpretação do sistema.
- Não afirmar identidade quando houver homônimo.
- Mostrar quando a informação foi coletada.
- Não usar “sem processos” como prova de inexistência; usar “nenhum resultado encontrado nas fontes consultadas”.
- Exibir “dados possivelmente desatualizados” quando uma consulta falhar ou ultrapassar o prazo esperado.
- Distinguir visualmente dado oficial, dado normalizado e explicação gerada.
- Nunca usar apenas cor para comunicar erro, alerta ou confirmação.
- Não fazer atualização otimista de informação processual; somente preferências do usuário podem ser atualizadas antes da confirmação do servidor.

### Regras obrigatórias contra mistura de dados

Isolamento e precisão não serão responsabilidade apenas do frontend. Devem ser garantidos no backend, banco e testes.

1. Toda requisição é autenticada e vinculada a um `userId` ou `organizationId` no servidor.
2. A autorização é aplicada na consulta ao banco; nunca baixamos dados de vários clientes para filtrá-los apenas no navegador.
3. Toda chave de cache contém organização, usuário e alvo monitorado. Não existe cache compartilhado sem escopo.
4. Processos são identificados pelo número CNJ normalizado e contexto de tribunal/grau. Não são unidos por semelhança de nome.
5. Publicações são deduplicadas por identificador da fonte e hash do conteúdo, não por comparação aproximada de texto.
6. Homônimos permanecem como candidatos separados até confirmação explícita.
7. A resposta original, seu hash, fonte e horário de coleta são preservados no Cloud Storage.
8. Ao trocar de processo, requisições pendentes da tela anterior são canceladas ou ignoradas; uma resposta atrasada não pode substituir a tela atual.
9. Chaves de consulta do frontend incluem `organizationId`, `userId`, `caseId` e filtros relevantes.
10. Conteúdo de IA recebe somente o processo atual e suas fontes. Nenhuma conversa ou resumo pode misturar documentos entre processos.
11. A API retorna somente os campos necessários para a tela atual.
12. Dados processuais usam `Cache-Control: private, no-store`; preferências podem ter cache próprio.

### Estados obrigatórios da interface

Cada tela deve prever explicitamente:

- carregando, preservando o contexto do processo;
- sem resultados;
- fonte indisponível;
- dados desatualizados;
- possível homônimo;
- acesso negado;
- erro recuperável com nova tentativa;
- sucesso parcial quando apenas uma das fontes responder.

Uma tela vazia nunca pode ser confundida com “não existem processos”.

### Acessibilidade

- contraste mínimo WCAG AA;
- navegação completa por teclado;
- foco sempre visível;
- um único `h1` e hierarquia semântica;
- `aria-live` para conclusão de atualização e novos alertas;
- rótulos explícitos em filtros e formulários;
- datas apresentadas em horário de Brasília, mantendo o timestamp original da fonte;
- texto e ícone acompanhando qualquer uso de cor.

### Testes que bloqueiam uma publicação

O frontend não será publicado se falhar em qualquer um destes testes:

- usuário A nunca acessa processos do usuário B;
- escritório A nunca acessa processos do escritório B;
- trocar rapidamente entre dois processos não mistura respostas;
- duas pessoas homônimas permanecem separadas;
- publicação duplicada aparece uma única vez;
- falha parcial de uma fonte não apaga dados anteriores válidos;
- página recarregada mantém o contexto correto;
- logout elimina sessão e dados em memória;
- todas as rotas privadas recusam acesso sem autenticação;
- responsividade, teclado, contraste e redução de movimento.

## 9. Quantidade de armazenamento

Ainda não medimos um caderno diário real de cada tribunal. A primeira tarefa de capacidade será baixar 30 dias de três perfis diferentes — TJRS, TJSP e TRT4 — e medir:

- comunicações por dia;
- bytes compactados e descompactados;
- bytes médios por comunicação;
- tempo de download e processamento;
- proporção de documentos duplicados ou reprocessados.

### Modelo inicial para planejamento

Hipótese provisória: **5 KB compactados por comunicação**, incluindo metadados e texto. Essa hipótese deverá ser substituída por medição real.

| Comunicações/dia | Entrada/dia | Entrada/mês | Acúmulo/ano |
|---:|---:|---:|---:|
| 100 mil | ~0,5 GB | ~15 GB | ~183 GB |
| 500 mil | ~2,5 GB | ~75 GB | ~913 GB |
| 1 milhão | ~5 GB | ~150 GB | ~1,8 TB |

O Cloud Storage Standard em São Paulo está próximo de **US$ 0,02/GiB-mês**. Assim, o custo mensal do estoque ao final de um ano seria aproximadamente:

- 183 GB: US$ 3,70/mês;
- 913 GB: US$ 18,30/mês;
- 1,8 TB: US$ 36,50/mês.

Esses valores são apenas armazenamento. Processamento, operações, download e indexação são componentes separados. Nearline/Coldline reduzem o preço do histórico pouco acessado, com regras mínimas de permanência e custos de recuperação.

### Estratégia recomendada

No MVP, não arquivar todos os cadernos nacionais. Guardar apenas:

- respostas relacionadas aos perfis monitorados;
- resultados dos processos conhecidos;
- registros técnicos das execuções.

Depois da validação, iniciar arquivo prospectivo por tribunal. A varredura histórica nacional só será decidida após conhecermos volume, cobertura e utilidade comercial.

## 10. Estimativa de custo mensal

Valores em dólar e antes de impostos/conversão cambial. São estimativas, não orçamento contratual.

### Gate obrigatório por mudança

As faixas deste plano servem apenas como baseline de produto. Antes de qualquer alteração, deverá existir uma avaliação aprovada em `docs/costs/`, criada a partir de `docs/templates/infra-cost-assessment.md`, com custo atual, esperado e limite operacional. Impacto zero também será registrado.

Mudanças Terraform deverão receber diff Infracost no pull request. A estimativa automática será complementada pela modelagem manual de consumo, egress, logs, retenção, e-mail, IA e APIs externas. O custo real será verificado 7 e 30 dias depois do deploy. O procedimento está em [Operação do gate de custo](./docs/operations/infra-cost-gate.md).

### Validação atual, sem persistência gerenciada nova

| Item | Estimativa mensal |
|---|---:|
| Recursos GCP já aprovados | até US$ 0,38 |
| Supabase | US$ 0; sandbox Free em São Paulo, sem dados |
| Infisical | US$ 0; projeto Free com segredos de desenvolvimento |
| Brevo | US$ 0; plano Free, 300 envios/dia; bootstrap sem envio |
| **Total aprovado** | **até US$ 0,38/mês** |

O teto atual continua em US$ 10. Esta alteração de plano tem delta zero e não
autoriza contas, projetos, secrets ou bancos externos.

### Piloto persistente planejado, ainda não aprovado

| Item | Faixa mensal provisória |
|---|---:|
| Supabase Pro, um projeto Micro | a partir de US$ 25 |
| Cloud Run/coleta | US$ 0–15 |
| Cloud Storage | US$ 0–10 |
| Infisical Free, até 5 identidades | US$ 0 |
| Secret Manager | US$ 0–1 |
| E-mail transacional Brevo | US$ 0–20; Free até 300 envios/dia, upgrade não aprovado |
| Logs e observabilidade | US$ 0–5 |
| **Total mínimo esperado** | **a partir de US$ 25/mês** |

A variável mais importante não será o número de usuários isoladamente, e sim a quantidade de perfis/processos consultados, frequência, volume de publicações e necessidade de reprocessamento.

Staging e production Supabase isolados ficam em aproximadamente US$ 35/mês
antes de egress, backups avançados e GCP. Infisical Pro custa US$ 20 por
identidade/mês com cobrança anual ou US$ 23 mensal; um exemplo com três
identidades adicionaria US$ 60–69/mês. O Free pode validar até cinco identidades,
mas recursos de produção como versionamento, recuperação, rotação e retenção de
auditoria podem exigir upgrade. Nenhum desses valores está aprovado. O detalhe
está na [Avaliação 0012](./docs/costs/0012-supabase-infisical-platform-planning.md).

O Brevo foi escolhido como provedor transacional, com chave dedicada por
ambiente e segredo centralizado no Infisical. O bootstrap tem custo zero, mas
não autoriza envio: primeiro será necessário verificar domínio e remetente do
Meu Processo, implementar outbox/webhooks e aprovar a mudança correspondente.
A decisão está no [ADR 0018](./docs/adr/0018-brevo-transactional-email.md) e o
bootstrap na [Avaliação 0015](./docs/costs/0015-brevo-transactional-email-bootstrap.md).

Referências de preços:

- [Cloud Run](https://cloud.google.com/run/pricing)
- [Cloud Storage](https://cloud.google.com/storage/pricing)
- [Supabase](https://supabase.com/pricing)
- [Infisical](https://infisical.com/pricing)
- [Secret Manager](https://cloud.google.com/secret-manager/pricing)
- [Cloud Scheduler](https://cloud.google.com/scheduler/pricing)
- [Cloud Tasks](https://cloud.google.com/tasks/pricing)
- [Pub/Sub](https://cloud.google.com/pubsub/pricing)
- [Firebase](https://firebase.google.com/pricing)

## 11. Formas de monetização

O modelo será organizado por persona, quantidade de processos e tecnologias disponíveis. Os limites e preços abaixo são hipóteses para teste, não uma oferta final.

Como referência, em agosto de 2026 o plano Jusbrasil Processos informa monitoramento de até cinco processos e um nome. Os planos profissionais do Jusbrasil oferecem 30, 150 ou mensagens ilimitadas de IA, enquanto planos organizacionais anunciam faixas de 200 a mais de 1.000 processos. Isso valida o uso de limites de processos, usuários e IA como dimensões comerciais.

Referências:

- [Funcionalidades do plano Jusbrasil Processos](https://suporte.jusbrasil.com.br/hc/pt-br/articles/8488202195476-Quais-s%C3%A3o-as-funcionalidades-do-plano-Jusbrasil-Processos)
- [Planos individuais e profissionais do Jusbrasil](https://www.jusbrasil.com.br/pro)
- [Planos para organizações](https://conteudo.jusbrasil.com.br/oportunidade-pro-pj)

### 11.1 Pessoa física

Foco: acompanhar e entender os próprios processos sem juridiquês.

| Plano | Processos | Nomes | Tecnologia disponível | Hipótese de preço |
|---|---:|---:|---|---:|
| Gratuito | 1 | — | Painel, atualização diária e fonte oficial | R$ 0 |
| Acompanha | 5 | 1 | Alertas por e-mail, histórico, explicação simples e até 5 resumos de IA/mês | R$ 14,90–24,90/mês |
| Acompanha Plus | 20 | 3 | Alertas prioritários, relatório, calendário e até 25 resumos de IA/mês | R$ 29,90–49,90/mês |

O recurso principal para pessoa física é tradução e tranquilidade: “o que aconteceu, quando aconteceu e preciso fazer algo?”. A IA deve explicar a publicação em linguagem simples, sempre com ressalva de que não substitui orientação jurídica.

### 11.2 Advogado individual

Foco: monitorar carteira própria e reduzir trabalho manual.

| Plano | Processos | Usuários/OAB | Tecnologia disponível | Hipótese de preço |
|---|---:|---:|---|---:|
| Advogado Solo | 100 | 1 usuário / 1 OAB | Monitoramento por OAB e CNJ, e-mail, importação CSV, filtros e 50 resumos de IA/mês | R$ 49–79/mês |
| Advogado Pro | 300 | 1 usuário / até 2 OABs | Tudo do Solo, relatórios, exportação, tags, clientes e 200 resumos de IA/mês | R$ 99–149/mês |
| Advogado Premium | 750 | 2 usuários / até 3 OABs | Carteira ampliada, webhooks, integrações e franquia maior de IA | R$ 199–299/mês |

Não devemos prometer controle automático de prazos processuais no início. O produto alerta publicações; qualquer interpretação de prazo exige validação humana.

### 11.3 Escritório de advocacia

Foco: equipe, carteira compartilhada, auditoria e gestão de volume.

| Plano | Processos | Usuários | Tecnologia disponível | Hipótese de preço |
|---|---:|---:|---|---:|
| Escritório Start | 500 | 3 | Carteira compartilhada, OABs, clientes, permissões, relatórios e IA em pool | R$ 299–399/mês |
| Escritório Team | 2.000 | 10 | Auditoria, API/webhook, importação em lote, regras e dashboards de equipe | R$ 599–999/mês |
| Escritório Scale | Sob medida | Sob medida | SLA, integrações, retenção, suporte e volume negociado | Contrato |

Para escritórios, o número de processos sozinho não basta. As dimensões de valor são usuários, OABs, frequência, canais, integrações, retenção e consumo de IA.

### 11.4 Como limitar IA

A IA deverá ser um consumo separado e mensurável:

- resumo automático curto somente quando houver nova publicação;
- explicação detalhada sob demanda;
- franquia mensal por plano;
- cache do resumo para não pagar duas vezes pelo mesmo documento;
- possibilidade de comprar pacote adicional;
- texto original e fonte sempre disponíveis para conferência.

No MVP pessoal, começaremos sem IA generativa. Primeiro validaremos a coleta e o painel; depois mediremos o custo real por resumo.

### 11.5 Serviço gerenciado ou white-label

No futuro, escritórios, associações ou empresas poderão usar uma versão personalizada, com implantação e mensalidade.

### O que não monetizar

- revenda de dados do DataJud;
- buscador público irrestrito de pessoas;
- resultados brutos apresentados como garantia de identidade;
- score jurídico automático sem transparência e validação;
- acesso a documentos sigilosos ou obtidos mediante credencial de terceiros.

O valor cobrado deve estar na **automação, organização, alerta, experiência e produtividade**, e não na simples revenda de dados públicos.

## 12. Métricas de validação

Antes de ampliar a arquitetura, o MVP precisa operar por pelo menos algumas semanas e medir:

- percentual de execuções diárias bem-sucedidas;
- tempo entre publicação e detecção;
- publicações duplicadas;
- falsos positivos por homônimo;
- processos descobertos;
- falhas por tribunal/fonte;
- custo mensal por perfil monitorado;
- quantidade de acessos ao painel após um alerta;
- disposição real de usuários para pagar.

Critério de avanço sugerido:

- pelo menos 30 dias de operação;
- nenhuma publicação conhecida perdida no período;
- duplicidade próxima de zero no painel;
- custo por usuário previsível;
- cinco a dez usuários externos interessados em testar;
- revisão jurídica antes da cobrança.

## 13. Próxima implementação

Ordem recomendada:

1. Aprovar a avaliação de custo específica da próxima mudança.
2. Adicionar autenticação, organizações, papéis e testes de isolamento.
3. Criar o modelo canônico de processo, fonte, monitoramento e documento.
4. Construir o design system comum e priorizar a experiência simples.
5. Gravar resultados e execuções do worker existente.
6. Adicionar execução diária idempotente e alertas no painel.
7. Criar os buckets privados de originais, cache e exportações com lifecycle.
8. Implementar o gateway brasileiro de documentos com allowlist e auditoria.
9. Implementar o modo avançado e downloads em lote assíncronos.
10. Operar e medir cobertura, documentos, custo e falsos positivos por 30 dias.
11. Medir cadernos reais de TJRS, TJSP e TRT4.
12. Só então decidir sobre arquivo nacional, busca dedicada, IA e expansão comercial.

O detalhamento desta sequência passa a ser normativo no
[Roadmap 0008](./docs/implementation/0008-functional-requirements-roadmap.md).
Quando houver divergência, prevalecem os gates mais restritivos e a spec menor
aprovada para a fatia em execução.

Antes dos itens persistentes desta lista, devem ser concluídas incrementalmente
as etapas de módulos, configuração, `RequestContext`, repository contracts,
evidência e jobs do [Roadmap 0009](./docs/implementation/0009-scalable-foundation-roadmap.md).

## 14. Guardrails de engenharia

Nenhum desenvolvimento adicional deve começar sem obedecer à especificação [ENGINEERING_GUARDRAILS.md](./ENGINEERING_GUARDRAILS.md). As regras também são reforçadas para agentes e automações por [AGENTS.md](./AGENTS.md).

Os pilares obrigatórios são:

- spec-first e ADRs para decisões relevantes;
- avaliação de custo aprovada antes de toda alteração, com Infracost para Terraform;
- TDD e cobertura integral desde o primeiro comportamento;
- Git e pull requests protegidos;
- ambiente local reproduzível com Docker Compose;
- Terraform como fonte de verdade da infraestrutura;
- ambientes cloud isolados e promoção de artefato imutável;
- scans de segredo, SAST, dependências, licenças, containers e IaC;
- CI com gates obrigatórios e CD gradual com rollback;
- isolamento entre usuários, escritórios e processos testado em todas as camadas.
