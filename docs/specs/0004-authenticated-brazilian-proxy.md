# Spec 0004 — consulta autenticada e proxy brasileiro de publicações

**Status:** aceita para implementação e rollout de validação
**Data:** 30 de agosto de 2026
**Responsável de produto:** Meu Processo
**Custo:** [Avaliação 0005](../costs/0005-public-authenticated-proxy.md)
**Decisão:** [ADR 0004](../adr/0004-public-edge-stateless-proxy.md)

## 1. Resultado esperado

Uma pessoa com e-mail confirmado entra no painel, consulta publicações no DJEN,
abre o detalhe de um processo agrupado e baixa uma publicação pública por um
proxy executado em `southamerica-east1`. A URL oficial permanece exclusivamente
no servidor e processos diferentes nunca são misturados.

## 2. Escopo da validação

- tornar públicos somente os arquivos estáticos e `GET /health` do Cloud Run;
- exigir Firebase ID token válido em todas as rotas de consulta e proxy;
- desativar a rota legada não versionada `/api/searches`;
- manter `POST /api/v1/searches` como consulta autenticada;
- abrir um detalhe do processo usando os fatos retornados pela mesma consulta;
- obter PDF em
  `GET /api/v1/processes/{cnj}/communications/{numero}/document`;
- reconsultar o DJEN por `numeroProcesso` e `numeroComunicacao` no servidor;
- confirmar que a comunicação pertence exatamente ao processo solicitado;
- aceitar inicialmente somente `eproc1g.tjrs.jus.br` e
  `eproc2g.tjrs.jus.br`, por HTTPS/443;
- aplicar os controles SSRF, redirect, tamanho, timeout, PDF e hash já
  existentes no gateway;
- quando a página pública exigir um CAPTCHA visual simples, entregar somente a
  imagem raster validada ao usuário autenticado e aceitar o código digitado por
  ele em uma segunda requisição;
- limitar por instância e usuário a 10 consultas e 20 downloads por minuto;
- respeitar HTTP 429 e cabeçalhos de limite da origem sem alternar IPs;
- não persistir consultas, URLs, PDFs ou tokens.

## 3. Fora do escopo

- processos sob segredo e documentos que exigem login;
- resolução automática, terceirizada ou por IA de CAPTCHA;
- HTML inline, execução de JavaScript ou automação de navegador. Uma página
  intermediária pode ser resolvida quando contém exatamente um destino estático
  seguro ou exatamente um formulário `POST` composto por campos ocultos ou de
  texto não vazios e, no máximo, um botão de envio nomeado, sempre com valores
  originados exclusivamente na própria página. A ação deve permanecer no mesmo host HTTPS
  permitido, o corpo tem limite de 32 KiB e os cookies recebidos são efêmeros,
  limitados e enviados somente ao mesmo host durante aquele download;
- Firestore, Storage, cache, fila, varredura integral ou download em lote;
- comprovação de que um resultado por nome pertence à pessoa autenticada;
- suporte a hosts de outros tribunais sem validação e allowlist próprias;
- Cloud Armor, load balancer, domínio customizado e produção.

## 4. Contratos

### 4.1 Consulta

```http
POST /api/v1/searches
Authorization: Bearer <Firebase ID token>
Content-Type: application/json
```

A resposta não contém `link` nem outra URL de origem. Uma publicação só recebe
`documentAvailable: true` quando o DJEN fornece simultaneamente número da
comunicação e link HTTPS.

### 4.2 Documento

```http
GET /api/v1/processes/{cnjDigits}/communications/{numero}/document
Authorization: Bearer <Firebase ID token>
```

`cnjDigits` contém exatamente 20 dígitos e `numero` é inteiro positivo seguro.
O servidor reconsulta o DJEN com ambos os identificadores, exige uma
correspondência exata e usa somente a URL retornada nessa resposta oficial.

Sucesso retorna PDF como anexo, `private, no-store`, `nosniff`, CSP `sandbox` e
hash SHA-256. Identificador inválido retorna 400; comunicação ausente ou
misturada retorna 404; limite local/origem retorna 429; origem incompatível ou
indisponível retorna 502.

Quando a fonte exigir confirmação visual, a primeira tentativa retorna HTTP 409
com `DOCUMENT_CHALLENGE_REQUIRED`, um identificador opaco, uma imagem
`data:image/png|jpeg|gif;base64` e a expiração. O navegador envia a resposta
digitada pelo próprio usuário em:

```http
POST /api/v1/processes/{cnjDigits}/communications/{numero}/document/challenge
Authorization: Bearer <Firebase ID token>
Content-Type: application/json

{"challengeId":"<opaco>","answer":"<alfanumérico>"}
```

O servidor reconsulta o DJEN, reconstrói a mesma referência e só então conclui
o formulário. O desafio é de uso único, vive no máximo dois minutos, fica
somente em memória, limita-se a 100 itens por instância e está vinculado ao
mesmo usuário, processo, comunicação, URL oficial e cookies efêmeros. A imagem
tem no máximo 512 KiB, assinatura PNG/JPEG/GIF obrigatória e nunca pode ser SVG,
HTML ou URL remota. Cloud Run usa afinidade de sessão de melhor esforço; perda
da instância ou da afinidade expira o desafio sem compartilhar estado.

## 5. Segurança e privacidade

- O binding `allUsers` concede alcance HTTP ao container, não acesso aos dados.
- Rotas sob `/api/` falham fechadas sem token Firebase válido e e-mail
  confirmado.
- O UID e os limites vêm do token verificado pelo backend.
- Bearer token não entra em URL, log, Web Storage ou resposta.
- URL oficial, query string e mensagens privadas da origem não entram em log ou
  resposta JSON.
- O cliente nunca escolhe host, protocolo, porta, URL, IP ou redirect.
- O cliente recebe somente a imagem raster validada; nome do campo, ação do
  formulário, cookies, HTML e URL oficial nunca saem do servidor.
- O código visual não é registrado, persistido, resolvido ou compartilhado.
- A consulta por nome continua exibindo o risco de homônimos.

## 6. Critérios de aceitação

1. Usuário sem token ou e-mail confirmado não consulta nem baixa.
2. Consulta autenticada continua agrupando apenas por CNJ válido.
3. A resposta de consulta não expõe URL oficial.
4. O detalhe usa exatamente o agregado selecionado, sem nova mistura de fatos.
5. Comunicação e CNJ divergentes não causam saída para o tribunal.
6. Host fora da allowlist, IP privado, redirect inseguro, HTML ambíguo, ação de
   formulário externa, senha, upload, desafio não raster ou arquivo acima dos
   limites falham fechados.
7. Um PDF TJRS autorizado pode ser obtido a partir do runtime brasileiro após o
   usuário digitar o código visual, quando ele for exigido.
8. Limites locais e 429 da origem produzem resposta estável e não fazem retry
   por outro IP.
9. Cloud Run escala a zero, no máximo duas instâncias, mantém afinidade de sessão
   de melhor esforço e não cria banco, bucket, NAT, load balancer ou segundo
   serviço.
10. Testes, cobertura integral, lint, tipos, build, Compose, Terraform,
    Infracost e scans bloqueantes passam.
11. Rollout ocorre em duas fases: revisão protegida ainda privada e somente
    depois binding público.

## 7. Rollback

Remover o binding público por Terraform e restaurar a revisão anterior. A
remoção do binding é o primeiro passo do rollback; não depende de alterar
Firebase nem dados persistidos, pois esta fase não cria dados.
