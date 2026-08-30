# Meu Processo

MVP para cadastrar alvos de acompanhamento e consultar publicações judiciais na
fonte oficial DJEN. A interface agrega publicações pelo número único CNJ, sem
misturar documentos que não tenham um número de processo válido.

## Escopo desta primeira validação

- cadastro de nome, CPF ou CNPJ no armazenamento local do navegador;
- consulta autenticada por nome usando o filtro oficial `nomeParte` do DJEN;
- consulta experimental de CPF/CNPJ pela ocorrência literal no texto;
- agrupamento somente por número CNJ normalizado de 20 dígitos;
- API sem estado: CPF, CNPJ e resultados não são persistidos no servidor;
- painel responsivo, leve e com avisos explícitos sobre cobertura e homônimos;
- alternância entre modo simples e primeira carteira avançada sobre os mesmos
  fatos, sem repetir a consulta;
- fundação privada versionada com escopo pessoal/organização e negação por
  padrão.
- cadastro e login Firebase por e-mail/senha, confirmação de e-mail e sessão
  mantida somente em memória.

A busca da Spec 0001 continua sem estado. A fundação multiusuário da Spec 0002
já possui contratos, modelo canônico e autorização. Firebase Authentication
protege as rotas da API e exige confirmação de e-mail. Firestore, Storage e
persistência de memberships continuam fora desta entrega.

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

Para desenvolver o fluxo de conta sem tocar na nuvem:

```sh
cp .env.example .env.local
docker compose up --build auth-emulator
npm run dev
```

O Firebase Auth Emulator usa somente o projeto sintético `demo-meu-processo`.

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
GET /api/v1/cases/{caseId}/documents/{documentId}/content
GET /api/v1/session
Authorization: Bearer <token>
```

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
recusando todas as chamadas com HTTP 401. E-mail não confirmado, token revogado
ou token inválido também resulta em 401.

O gateway de documentos recebe somente IDs internos. A URL de origem permanece
no servidor, passa por allowlist exata, HTTPS, validação de DNS/IP, redirects,
tipo, tamanho e hash. PDFs são enviados como download com cache desabilitado;
não são renderizados inline na origem principal. A implementação e seus limites
estão descritos em
[`docs/implementation/0003-document-gateway.md`](docs/implementation/0003-document-gateway.md).

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
- cobertura de 100% no núcleo de domínio, busca e armazenamento local;
- lint, tipos, build, auditoria de dependências e scan da imagem;
- imagem final distroless e fixada por digest;
- Docker Compose local e Terraform para Cloud Run com publicação em duas fases;
- avaliação de custo obrigatória antes de toda alteração;
- diff Infracost para mudanças Terraform em pull requests;
- CI em pull requests e deploy manual por ambiente protegido.

As decisões e critérios completos estão em
[`docs/specs/0001-target-search-validation.md`](docs/specs/0001-target-search-validation.md),
[`docs/specs/0002-process-monitoring-functional-parity.md`](docs/specs/0002-process-monitoring-functional-parity.md),
[`docs/specs/0003-authentication.md`](docs/specs/0003-authentication.md),
[`docs/specs/0004-authenticated-brazilian-proxy.md`](docs/specs/0004-authenticated-brazilian-proxy.md),
[`docs/adr/0001-stateless-djen-validation.md`](docs/adr/0001-stateless-djen-validation.md),
[`docs/adr/0002-multiuser-modes-and-document-delivery.md`](docs/adr/0002-multiuser-modes-and-document-delivery.md),
[`docs/adr/0003-firebase-authentication-boundary.md`](docs/adr/0003-firebase-authentication-boundary.md),
[`docs/adr/0004-public-edge-stateless-proxy.md`](docs/adr/0004-public-edge-stateless-proxy.md),
[`docs/operations/infra-cost-gate.md`](docs/operations/infra-cost-gate.md),
[`docs/implementation/0002-phase-a-b-foundation.md`](docs/implementation/0002-phase-a-b-foundation.md),
[`docs/implementation/0004-firebase-authentication.md`](docs/implementation/0004-firebase-authentication.md)
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
