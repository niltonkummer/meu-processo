# Meu Processo

MVP para cadastrar alvos de acompanhamento e consultar publicações judiciais na
fonte oficial DJEN. A interface agrega publicações pelo número único CNJ, sem
misturar documentos que não tenham um número de processo válido.

## Escopo desta primeira validação

- cadastro autenticado de nome, CPF ou CNPJ com criptografia e rótulo minimizado;
- consulta autenticada por nome usando o filtro oficial `nomeParte` do DJEN;
- consulta experimental de CPF/CNPJ pela ocorrência literal no texto;
- agrupamento somente por número CNJ normalizado de 20 dígitos;
- resultados síncronos da busca continuam sem persistência; perfis, processos,
  eventos canônicos e alertas do worker são persistidos de forma tenant-bound e
  nunca ficam em Web Storage;
- painel responsivo, leve e com avisos explícitos sobre cobertura e homônimos;
- alternância entre modo simples e primeira carteira avançada sobre os mesmos
  fatos, sem repetir a consulta;
- caixa autenticada de acompanhamento com leitura idempotente, paginação e linha
  do tempo que destaca o evento exato de origem do alerta;
- fundação privada versionada com escopo pessoal/organização e negação por
  padrão;
- fundação local de ciclo de vida com pedido de exportação, congelamento de
  tenant pessoal, JSON privado por 24 horas, reconciliação de objetos, purge
  isolado e tombstone técnico;
- painel e API locais para solicitar, acompanhar e baixar exportações, além de
  exclusão com reautenticação recente e confirmação forte;
- cadastro e login Firebase por e-mail/senha, com sessão mantida somente em
  memória; durante a validação, o envio e a confirmação de e-mail ainda não são
  obrigatórios.

A busca da Spec 0001 continua sem estado quanto a resultados. A persistência
local daquela validação foi substituída pela Spec 0013. A fundação multiusuário
já possui contratos, modelo canônico e autorização. Firebase Authentication
protege as rotas da API e continua exigindo token válido, UID e e-mail. A
confirmação do e-mail está temporariamente dispensada pela Spec 0006 enquanto o
envio não é configurado. Supabase gerenciado, Storage e persistência cloud de
memberships continuam fora do runtime. A base passiva de GCS, Secret Manager e
identidades já pode ser revisada em plano, mas permanece falsa por padrão e sem
autorização de `apply`.

## Executar localmente

Pré-requisitos: Docker com Compose v2.

```sh
docker compose --profile test run --build --rm test
docker compose up --build app
```

Acesse `http://localhost:8080`. Se a porta estiver ocupada:

```sh
APP_PORT=18080 docker compose up --build app
```

O container executa como usuário não privilegiado, com sistema de arquivos
somente leitura, capacidades removidas e `no-new-privileges`.

O Compose habilita a entrega individual somente a partir de
`.local/document-objects`, montada como leitura privada. Arquivos colocados ali
são ignorados pelo Git. O banco fornece a chave interna no formato
`documents/tenant/{tenantId}/{documentId}/{artifactId}.pdf`; nenhum nome, CPF,
CNPJ, CNJ ou URL deve aparecer no caminho. O arquivo só é entregue quando
metadados, autorização, quota, tamanho, assinatura PDF e SHA-256 coincidem.

Para desenvolver o fluxo de conta sem tocar na nuvem:

```sh
cp .env.example .env.local
docker compose up --build auth-emulator
npm run dev
```

O Firebase Auth Emulator usa somente o projeto sintético `demo-meu-processo`.

Para validar a fundação PostgreSQL em uma base descartável, incluindo schema,
privilégios, RLS e o mesmo contrato usado pelo adapter em memória:

```sh
docker compose -p meu-processo-database --profile test up --build \
  --abort-on-container-exit --exit-code-from database-test database-test
docker compose -p meu-processo-database --profile worker run --rm --build \
  monitoring-worker
docker compose -p meu-processo-database --profile worker run --rm --build \
  outbox-dispatcher
LOCAL_UID="$(id -u)" LOCAL_GID="$(id -g)" \
  docker compose -p meu-processo-database --profile worker run --rm --build \
  document-materialization-worker
LOCAL_UID="$(id -u)" LOCAL_GID="$(id -g)" \
  docker compose -p meu-processo-database --profile worker run --rm --build \
  tenant-data-lifecycle-worker
docker compose -p meu-processo-database --profile test up --build \
  --abort-on-container-exit --exit-code-from database-contract-test \
  database-contract-test
docker compose -p meu-processo-database --profile test run --rm \
  database-restore-test
docker compose -p meu-processo-database --profile test down \
  --volumes --remove-orphans
```

O PostgreSQL não publica porta no host. As credenciais são sintéticas, limitadas
ao Compose local e não servem para Supabase ou qualquer ambiente cloud.
O dispatcher local usa uma role própria e, sem publisher explicitamente
configurado, reagenda o evento em vez de confirmar uma entrega fictícia.
O worker de documentos fica somente na rede interna do PostgreSQL. Ele aceita
exclusivamente PDFs sintéticos em
`.local/document-fixtures/synthetic-worker/{externalDocumentId}.pdf`, publica
em `.local/document-objects` e não possui rota de rede para tribunais ou cloud.
O worker de ciclo de vida usa o mesmo volume privado para exportações JSON e
exclusão idempotente de documentos, com lote máximo 10 e três tentativas. Ele é
one-shot, não agenda trabalho sozinho e permanece inacessível por HTTP.

No sandbox futuro, o mesmo contrato seleciona GCS somente por modo explícito:

```text
API:          DOCUMENT_DELIVERY_MODE=gcs
              DOCUMENT_GCS_BUCKET=<bucket>
documento:    DOCUMENT_MATERIALIZATION_MODE=gcs-fixture
              DOCUMENT_MATERIALIZATION_BUCKET=<bucket>
lifecycle:    TENANT_LIFECYCLE_MODE=gcs
              TENANT_LIFECYCLE_GCS_BUCKET=<bucket>
```

Essas configurações usam Application Default Credentials da service account.
Não existe variável para chave JSON, URL assinada ou credencial de bucket. Os
modos continuam desativados/local no Compose e não devem ser habilitados antes
do gate de rollout sandbox.

Quando o desenvolvimento ocorre fora do Brasil, a busca por nome pode usar o
worker privado existente sem publicar o Cloud Run. Em outro terminal, abra o
túnel autenticado e informe sua rota ao Compose:

```sh
gcloud run services proxy djen-egress-test \
  --project=meu-processo-507018 \
  --region=southamerica-east1 \
  --port=19090
DJEN_SEARCH_PROXY_URL=http://host.docker.internal:19090/search-djen \
  APP_PORT=18080 docker compose up --build app
```

O túnel depende da sessão local do `gcloud`, permanece privado e não cria um
novo recurso. Nesta validação, o worker existente aceita busca por nome; CPF,
CNPJ e a revalidação necessária para abrir documentos ainda exigem a evolução
controlada do contrato do worker brasileiro.

## API

```http
POST /api/v1/searches
Authorization: Bearer <Firebase ID token>
Content-Type: application/json

{"type":"name","value":"Nome completo"}
```

Tipos aceitos: `name`, `cpf` e `cnpj`. O antigo `POST /api/searches` permanece
desativado para impedir uma busca sem autenticação. CPF e CNPJ passam por validação de
dígitos verificadores e são mascarados na resposta. A aplicação também expõe
`GET /health`. O caminho `/healthz` não é usado porque é reservado pelo
frontend do Cloud Run e recebe HTTP 404 antes de chegar ao container.

A fundação privada também adiciona:

```http
GET /api/v1/cases
GET /api/v1/cases/{caseId}
GET /api/v1/cases/{caseId}/events
GET /api/v1/cases/{caseId}/documents
POST /api/v1/cases/{caseId}/documents/{documentId}/materializations
GET /api/v1/cases/{caseId}/documents/{documentId}/content
GET /api/v1/alerts?limit=20&status=all
PATCH /api/v1/alerts/{alertId}/read
GET /api/v1/session
Authorization: Bearer <token>
```

O contrato executável dessas rotas está em
[`api/openapi.v1.json`](api/openapi.v1.json). Ele é validado offline e toda
alteração é comparada com a versão da branch-base para bloquear remoção de
operações, parâmetros, respostas, propriedades ou autenticação:

```sh
npm run openapi:validate
npm run openapi:compare -- caminho/para/baseline.json api/openapi.v1.json
```

O canal WebSocket da sessão assistida não faz parte do OpenAPI; suas mensagens
continuam cobertas pelos testes de protocolo e exigirão AsyncAPI antes de se
tornarem uma integração pública.

A coleção `GET /api/v1/cases?limit=20&after=<caseId>` lê a carteira pessoal já
persistida, com cursor estável e proveniência mínima. O envelope da coleção é
reduzido por allowlist a `caseId`, CNJ, tribunal, estado de identidade, última
atualização e fontes; não expõe scope, usuário, tenant ou eventos. Ela não
consulta tribunal durante a requisição e não retorna partes, CPF/CNPJ, URL ou
documento.

No painel autenticado, essa coleção é a carteira principal. Carteira e alertas
carregam em paralelo, e ambos abrem uma única timeline pelo `caseId`; somente a
abertura por alerta destaca o `caseEventId` exato. O resultado síncrono do DJEN
permanece identificado como validação pontual, sem ser confundido com dado já
monitorado. A linha do tempo pessoal lê eventos canônicos e trechos mínimos já
decodificados por cursor opaco. Alertas usam leitura idempotente e não associam
conteúdo por nome ou similaridade textual. Detalhe profissional e organizações
persistidas continuam em implementação e falham fechado quando o respectivo
provider não está configurado.

Perfis protegidos usam:

```http
POST /api/v1/monitoring/subjects
GET /api/v1/monitoring/subjects?limit=100
DELETE /api/v1/monitoring/subjects/{subjectId}
Authorization: Bearer <token>
```

O `DELETE` exige `If-Match: "<version>"`. Respostas contêm somente ID opaco,
tipo, rótulo minimizado, status, versão e data de arquivamento.

Uma publicação localizada pelo DJEN pode ser baixada pelo proxy brasileiro sem
expor a URL do tribunal ao navegador:

```http
GET /api/v1/processes/{numeroCNJ}/communications/{numeroComunicacao}/document
Authorization: Bearer <Firebase ID token>
```

O servidor consulta novamente o DJEN com os dois identificadores, exige
correspondência exata e aceita nesta validação apenas PDF originado dos hosts
TJRS explicitamente permitidos. O arquivo não é armazenado.

Quando o tribunal exigir um código visual, a interface mostra somente a imagem
raster validada e a própria pessoa digita o código. O desafio expira em dois
minutos, é de uso único, permanece em memória e não expõe URL, HTML, cookies ou
campos internos do tribunal. O sistema não resolve CAPTCHA automaticamente.
Na validação atual do TJRS, a página ainda não fornece essa imagem por uma rota
raster determinística; por isso o download falha fechado e o serviço permanece
privado até existir um conector oficial ou um renderizador isolado aprovado.

O escopo padrão é pessoal. Um cliente autenticado pode solicitar o contexto de
uma organização com `X-Organization-Id`; o servidor valida vínculo ativo antes
de consultar o repositório. O runtime usa Firebase Admin quando
`AUTH_MODE=firebase`; sem essa configuração, as rotas privadas continuam
recusando todas as chamadas com HTTP 401. Durante a validação, e-mail não
confirmado é aceito; token ausente, revogado ou inválido continua resultando em
401.

O gateway de documentos recebe somente IDs internos. A URL de origem permanece
no servidor, passa por allowlist exata, HTTPS, validação de DNS/IP, redirects,
tipo, tamanho e hash. PDFs são enviados como download com cache desabilitado;
não são renderizados inline na origem principal. A implementação e seus limites
estão descritos em
[`docs/implementation/0003-document-gateway.md`](docs/implementation/0003-document-gateway.md).
No painel pessoal persistido, o endpoint por `caseId`/`documentId` tem
precedência: ele renova a autorização, aplica quota e auditoria e nunca faz
fallback para uma URL externa.
Um documento público catalogado, ainda sem artefato, pode ser preparado pelo
`POST .../materializations`. A chamada não recebe body, URL, caminho, tenant ou
identificador de fonte; retorna HTTP 202 com `queued`, `processing` ou
`available`. Repetições reutilizam o mesmo trabalho. Neste gate, somente o
adapter sintético local está habilitado.

## Resultado da validação de 29/08/2026

A consulta controlada do nome informado, executada por um egress brasileiro,
retornou 16 publicações oficiais do TJRS. O código deste repositório as agrupou
em 3 processos, com 2, 7 e 7 publicações, sem itens órfãos e sem truncagem.

Acesso direto ao DJEN a partir de Lisboa retornou HTTP 403. Por isso, o runtime
permanece na região brasileira. A aplicação foi implantada como serviço privado
em `southamerica-east1` e a mesma consulta foi repetida com sucesso na revisão
`meu-processo-mvp-00002-6x6`.

## Limites que a interface deve preservar

- busca por nome pode incluir homônimos e não comprova identidade;
- DJEN contém comunicações/publicações, não uma base nacional completa de autos;
- DJEN não oferece filtro próprio para CPF ou CNPJ;
- a busca por documento é experimental e só encontra menções literais;
- nenhum resultado sem número CNJ válido é anexado a outro processo.

## Qualidade, segurança e infraestrutura

- suíte automatizada de domínio, aplicação, HTTP, infraestrutura local e UI;
- cobertura de 100% no núcleo de domínio, busca e cliente de perfis;
- lint, tipos, build, auditoria de dependências e scan da imagem;
- OpenAPI 3.1 versionada e gate de compatibilidade da API v1;
- servidor HTTP de composição com handlers separados por capability e ordem de
  precedência protegida por teste arquitetural;
- imagem final distroless e fixada por digest;
- Docker Compose local e Terraform para Cloud Run com publicação em duas fases;
- fundação cloud passiva com GCS privado, secret containers sem valores e IAM
  por workload, desativada por padrão;
- adapter GCS tenant-private com criação condicional, geração fixa, integridade
  SHA-256 e seleção explícita por workload, ainda sem rollout;
- avaliação de custo obrigatória antes de toda alteração;
- diff Infracost para mudanças Terraform em pull requests;
- CI em pull requests e deploy manual por ambiente protegido.

As decisões e critérios completos estão em
[`docs/specs/0001-target-search-validation.md`](docs/specs/0001-target-search-validation.md),
[`docs/specs/0002-process-monitoring-functional-parity.md`](docs/specs/0002-process-monitoring-functional-parity.md),
[`docs/specs/0003-authentication.md`](docs/specs/0003-authentication.md),
[`docs/specs/0004-authenticated-brazilian-proxy.md`](docs/specs/0004-authenticated-brazilian-proxy.md),
[`docs/specs/0006-authenticated-access-without-email-verification.md`](docs/specs/0006-authenticated-access-without-email-verification.md),
[`docs/adr/0001-stateless-djen-validation.md`](docs/adr/0001-stateless-djen-validation.md),
[`docs/adr/0002-multiuser-modes-and-document-delivery.md`](docs/adr/0002-multiuser-modes-and-document-delivery.md),
[`docs/adr/0003-firebase-authentication-boundary.md`](docs/adr/0003-firebase-authentication-boundary.md),
[`docs/adr/0004-public-edge-stateless-proxy.md`](docs/adr/0004-public-edge-stateless-proxy.md),
[`docs/operations/infra-cost-gate.md`](docs/operations/infra-cost-gate.md),
[`docs/implementation/0002-phase-a-b-foundation.md`](docs/implementation/0002-phase-a-b-foundation.md),
[`docs/implementation/0004-firebase-authentication.md`](docs/implementation/0004-firebase-authentication.md),
[`docs/implementation/0011-local-expandable-foundation.md`](docs/implementation/0011-local-expandable-foundation.md),
[`docs/implementation/0012-operational-persistence-and-lifecycle.md`](docs/implementation/0012-operational-persistence-and-lifecycle.md),
[`docs/implementation/0013-internal-identity-mapping.md`](docs/implementation/0013-internal-identity-mapping.md),
[`docs/implementation/0014-protected-identifiers-core.md`](docs/implementation/0014-protected-identifiers-core.md),
[`docs/implementation/0015-local-foundation-runtime.md`](docs/implementation/0015-local-foundation-runtime.md),
[`docs/implementation/0016-protected-profile-dashboard.md`](docs/implementation/0016-protected-profile-dashboard.md),
[`docs/specs/0014-monitoring-worker-foundation.md`](docs/specs/0014-monitoring-worker-foundation.md),
[`docs/implementation/0017-monitoring-worker-state-machine.md`](docs/implementation/0017-monitoring-worker-state-machine.md),
[`docs/implementation/0018-durable-monitoring-worker-foundation.md`](docs/implementation/0018-durable-monitoring-worker-foundation.md),
[`docs/specs/0015-local-case-evidence-foundation.md`](docs/specs/0015-local-case-evidence-foundation.md),
[`docs/implementation/0019-local-case-evidence-foundation.md`](docs/implementation/0019-local-case-evidence-foundation.md),
[`docs/specs/0016-persisted-case-portfolio.md`](docs/specs/0016-persisted-case-portfolio.md),
[`docs/implementation/0020-persisted-case-portfolio.md`](docs/implementation/0020-persisted-case-portfolio.md),
[`docs/specs/0017-durable-outbox-dispatcher.md`](docs/specs/0017-durable-outbox-dispatcher.md),
[`docs/implementation/0021-durable-outbox-dispatcher.md`](docs/implementation/0021-durable-outbox-dispatcher.md),
[`docs/specs/0025-openapi-v1-contract.md`](docs/specs/0025-openapi-v1-contract.md),
[`docs/implementation/0029-openapi-v1-contract.md`](docs/implementation/0029-openapi-v1-contract.md),
[`docs/specs/0026-http-handler-decomposition.md`](docs/specs/0026-http-handler-decomposition.md),
[`docs/implementation/0030-http-handler-decomposition.md`](docs/implementation/0030-http-handler-decomposition.md),
[`docs/specs/0029-managed-foundation-plan-only.md`](docs/specs/0029-managed-foundation-plan-only.md),
[`docs/implementation/0033-managed-foundation-plan-only.md`](docs/implementation/0033-managed-foundation-plan-only.md),
[`docs/specs/0030-gcs-object-store-adapter.md`](docs/specs/0030-gcs-object-store-adapter.md),
[`docs/implementation/0034-gcs-object-store-adapter.md`](docs/implementation/0034-gcs-object-store-adapter.md)
e [`ENGINEERING_GUARDRAILS.md`](ENGINEERING_GUARDRAILS.md).

## Implantação de validação

O serviço de validação está em
`https://meu-processo-mvp-rsirxb5ptq-rj.a.run.app`. Antes da liberação pública,
use um proxy autenticado para abrir a interface no navegador:

```sh
gcloud run services proxy meu-processo-mvp \
  --project meu-processo-507018 \
  --region southamerica-east1 \
  --port 8081
```

Depois, acesse `http://localhost:8081`. O workflow de deploy permanece manual,
restrito a `validation`, e requer uma avaliação aprovada apontada por
`.github/deploy-cost-assessment`, além da configuração do Workload Identity
Federation do GitHub. O primeiro disparo mantém
`public_access_enabled=false`; um segundo disparo com `true` somente deve
acontecer após o smoke test privado da revisão autenticada. Detalhes da primeira
implantação estão em
[`docs/deployments/2026-08-29-validation.md`](docs/deployments/2026-08-29-validation.md).
