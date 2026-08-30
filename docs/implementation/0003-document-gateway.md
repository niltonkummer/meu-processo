# Implementação 0003 — gateway brasileiro de documentos

**Data:** 29 de agosto de 2026
**Spec:** [Spec 0002 — fase D](../specs/0002-process-monitoring-functional-parity.md)
**Custo:** [Avaliação 0003](../costs/0003-brazilian-document-gateway.md)
**Estado:** fluxo visual assistido implantado em revisão privada; a origem TJRS
não entrega o código visual por uma rota raster determinística e o rollout
público permanece retido

## Contratos entregues

```http
GET /api/v1/cases/{caseId}/documents
GET /api/v1/cases/{caseId}/documents/{documentId}/content
Authorization: Bearer <token>
X-Organization-Id: <organizationId opcional>
```

A listagem retorna metadados, nunca `sourceUrl`. O conteúdo retorna somente PDF
autorizado, como anexo e com:

- `Content-Type: application/pdf`;
- `Content-Disposition: attachment` com nome normalizado;
- `Cache-Control: private, no-store`;
- CSP `sandbox` e `default-src 'none'`;
- `Cross-Origin-Resource-Policy: same-origin`;
- hash SHA-256 calculado pelo gateway.

## Ordem de autorização

1. validar o Bearer token;
2. determinar escopo pessoal ou organização solicitada;
3. validar vínculo ativo com a organização;
4. autorizar o processo pai;
5. localizar o documento pelo escopo, processo e ID interno;
6. filtrar defensivamente qualquer resposta misturada do repositório;
7. somente então realizar a saída de rede.

Processo ou documento de outro tenant é tratado como não encontrado. A API não
aceita URL, hostname, endereço IP, caminho local, nome de bucket ou credencial
fornecida pelo cliente.

## Controles contra SSRF e origem hostil

- apenas `https:` e porta 443;
- credenciais e fragmentos na URL são rejeitados;
- host exato em allowlist; não existe wildcard ou comparação por sufixo;
- todos os endereços DNS precisam ser públicos;
- conexão TLS é feita contra o IP validado e fixado, preservando SNI e `Host`;
- cada redirect é resolvido e validado novamente;
- uma página HTML intermediária só pode apontar para exatamente um destino
  estático em `iframe`, `embed`, `object` ou link cujo endereço identifique
  explicitamente PDF/download/documento/arquivo, ou conter exatamente um
  formulário `POST` com campos ocultos ou de texto não vazios cujo valor venha
  somente do próprio HTML da origem e, no máximo, um botão de envio nomeado;
- formulário intermediário tem ação HTTPS no mesmo host autorizado, no máximo
  20 campos e 32 KiB; senha, upload e múltiplos formulários são rejeitados;
- cookies da origem têm limite de 8 KiB, existem somente na memória durante um
  download e nunca atravessam hosts; nenhum JavaScript é executado;
- um único campo de texto vazio pode ser tratado como desafio visual somente
  quando existir exatamente uma imagem CAPTCHA no mesmo host permitido;
- a imagem é buscada pelo mesmo transporte com DNS/IP fixado, máximo de 512 KiB
  e validação simultânea de MIME e assinatura PNG/JPEG/GIF; SVG e HTML falham
  fechados;
- o desafio opaco é vinculado ao usuário, processo, comunicação, URL e cookies,
  vive dois minutos, é usado uma única vez e permanece apenas na memória;
- a resposta é digitada pelo usuário; o sistema não resolve nem terceiriza o
  CAPTCHA;
- máximo de três redirects dentro do timeout total de 15 segundos;
- máximo de 25 MiB por documento durante o streaming da origem;
- máximo de dois downloads simultâneos por instância;
- somente HTTP 200, `application/pdf` e assinatura `%PDF-`;
- hash esperado, quando conhecido, é comparado antes da entrega;
- respostas, URLs e mensagens privadas da origem não são refletidas ao cliente.

Os erros públicos são estáveis: `UNAUTHENTICATED`, `FORBIDDEN`,
`DOCUMENT_NOT_FOUND`, `DOCUMENT_GATEWAY_UNAVAILABLE`,
`DOCUMENT_CHALLENGE_REQUIRED`, `DOCUMENT_CHALLENGE_EXPIRED` e
`DOCUMENT_SOURCE_UNAVAILABLE`.

## Decisão sobre visualização

PDF é conteúdo potencialmente ativo. Por isso, este corte usa download como
anexo e não visualização inline na mesma origem da aplicação. Uma visualização
futura deverá usar origem isolada, sandbox e spec própria, sem compartilhar
credenciais da aplicação.

## Integração de infraestrutura

Nenhum host está autorizado por padrão. Cada conector deverá fornecer uma
allowlist exata validada por teste de capacidade no runtime brasileiro:

```ts
const documentClient = new SecureDocumentClient({
  allowedHosts: ["host-oficial-validado.example"],
});
```

O servidor aceita `DocumentRepository` e `DocumentClient` por injeção. O
runtime usa Identity Platform para autenticação e reconsulta o DJEN antes de
cada tentativa. URLs e documentos não são persistidos. A afinidade de sessão do
Cloud Run reduz a chance de a confirmação cair em outra instância, mas continua
sendo de melhor esforço; nesse caso o desafio expira de forma segura e deve ser
refeito.

Antes do rollout público ainda é necessário um teste de PDF real a partir de
`southamerica-east1`, com o código visual informado por uma pessoa e sem
compartilhar sessão entre usuários. O teste de 30/08/2026
encontrou somente um ícone de áudio PNG 24×24 e uma referência CAPTCHA estática
que respondeu 404/HTML; o código visual efetivo depende da interação JavaScript
da página. O gateway recusou ambos e não executou JavaScript nem tentou resolver
o CAPTCHA.

## Evidências

- testes unitários de autorização e não exposição da URL;
- testes de SSRF para protocolo, porta, credenciais, host e IP privado;
- testes de redirects, tipo, tamanho, assinatura e hash;
- teste de limite de concorrência;
- testes HTTP de metadados, conteúdo e erros fechados;
- cobertura integral do domínio e aplicação;
- lint, tipos, build, auditoria de dependências e Docker Compose.
