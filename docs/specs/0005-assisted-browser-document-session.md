# Spec 0005 — sessão assistida de documento no navegador

**Status:** aprovado para implementação
**Data:** 30 de agosto de 2026
**Custo:** [Avaliação 0006](../costs/0006-isolated-browser-renderer.md)
**Escopo:** validação privada no TJRS

## 1. Problema e resultado esperado

Algumas páginas oficiais do TJRS constroem o desafio visual com JavaScript. O
cliente HTTP seguro existente recebe o HTML, mas não executa a página e não
consegue apresentar o CAPTCHA real. A abertura deve funcionar a partir do
Brasil sem resolver ou contornar o desafio automaticamente.

O resultado esperado é um fluxo único e autenticado no qual:

1. o usuário escolhe uma publicação já retornada pelo DJEN;
2. o backend resolve novamente a comunicação e sua URL oficial;
3. um navegador isolado no Brasil executa somente a página autorizada;
4. o usuário lê e digita o CAPTCHA exibido pelo tribunal;
5. o mesmo navegador envia a resposta e captura o PDF;
6. o PDF validado é transmitido ao usuário sem persistência.

## 2. Limites funcionais

- O cliente informa apenas CNJ e número da comunicação no caminho da sessão.
- A URL oficial sempre vem de uma nova resolução no DJEN pelo backend.
- O primeiro tribunal suportado é TJRS, nos hosts exatos
  `eproc1g.tjrs.jus.br` e `eproc2g.tjrs.jus.br`.
- O CAPTCHA é resolvido exclusivamente pelo usuário. OCR, IA, solver externo,
  rotação de IP e tentativa automática são proibidos.
- A sessão dura no máximo 120 segundos e não pode reconectar nem retomar.
- Uma queda descarta navegador, cookies, imagem e bytes já recebidos.
- O PDF tem no máximo 25 MiB, assinatura `%PDF`, hash SHA-256 e download como
  anexo com `Cache-Control: private, no-store`.

## 3. Contrato externo

O frontend abre WebSocket no mesmo host da aplicação:

```text
/api/v1/processes/{cnjDigits}/communications/{communication}/document/session
```

Primeira mensagem obrigatória, em até cinco segundos:

```json
{ "type": "authenticate", "token": "<Firebase ID token>" }
```

O token não aparece na URL. Depois da autenticação, o servidor pode enviar:

```json
{ "type": "status", "status": "preparing" }
{ "type": "challenge", "imageDataUrl": "data:image/png;base64,...", "expiresAt": "..." }
{ "type": "document", "fileName": "...pdf", "mediaType": "application/pdf", "byteLength": 123, "sha256": "..." }
{ "type": "error", "code": "...", "message": "..." }
```

Após `document`, o frame seguinte e último é binário e deve ter exatamente o
tamanho declarado. A resposta humana aceita é:

```json
{ "type": "answer", "answer": "A1B2C3" }
```

Somente letras e números, de 1 a 32 caracteres. Mensagem, ordem, tamanho ou tipo
inesperado encerra a conexão com falha segura.

## 4. Contrato interno

O gateway abre uma segunda conexão WebSocket para o renderizador privado. A
requisição usa identidade da conta de serviço e `roles/run.invoker`; não existe
binding `allUsers` no renderizador.

O gateway envia uma única mensagem `open` contendo a URL resolvida pelo servidor
e os identificadores oficiais já validados. O renderizador repete a validação de
HTTPS, porta, host e endereço público. Ele nunca aceita URL do navegador do
usuário nem redireciona para host não autorizado.

Challenge, resposta e PDF permanecem na mesma conexão ponta a ponta. Afinidade
de sessão não é requisito de correção.

## 5. Isolamento e privacidade

- A sessão é vinculada ao UID autenticado, CNJ e comunicação.
- O UID não é enviado ao tribunal nem ao renderizador.
- Não há cache compartilhado, sessão recuperável ou lista global de desafios.
- Um usuário não consegue responder, observar ou baixar a sessão de outro.
- Logs contêm correlation ID aleatório, fase, duração, tamanho e código
  categórico; nunca token, nome, CPF/CNPJ, URL, CNJ, comunicação, HTML, cookies,
  CAPTCHA ou conteúdo do PDF.
- O screenshot contém somente o elemento visual validado do desafio.
- O frontend mantém token, imagem e PDF apenas em memória.

## 6. Estados e erros observáveis

| Estado/código | Comportamento |
|---|---|
| `preparing` | página oficial está sendo aberta no Brasil |
| `challenge` | usuário deve digitar o código da imagem |
| `SOURCE_RATE_LIMITED` | origem limitou a consulta; não repetir automaticamente |
| `SESSION_BUSY` | única capacidade de validação ocupada |
| `SESSION_EXPIRED` | conexão ultrapassou 120 segundos |
| `INVALID_CHALLENGE_ANSWER` | entrada local inválida |
| `CHALLENGE_REJECTED` | tribunal rejeitou; apresentar nova imagem na mesma sessão |
| `SOURCE_POLICY_REJECTED` | host, redirect, IP, recurso ou documento violou política |
| `SOURCE_UNAVAILABLE` | página oficial não concluiu o fluxo |
| `UNAUTHENTICATED` | token ausente, inválido, expirado ou revogado |
| `PUBLICATION_NOT_FOUND` | DJEN não confirmou exatamente a referência |

Erros não refletem resposta, seletor, URL ou HTML da origem.

## 7. Critérios de aceitação

1. Sem autenticação válida, nenhum acesso ao DJEN ou renderizador é iniciado.
2. O backend revalida CNJ e comunicação no DJEN antes de abrir a origem.
3. URL enviada pelo cliente, host fora da allowlist, redirect externo, IP privado
   ou frame de protocolo inválido encerra a sessão.
4. O desafio real executado por JavaScript aparece como PNG limitado, sem o
   ícone de áudio ou screenshot amplo da página.
5. A resposta humana usa o mesmo contexto de navegador que gerou a imagem.
6. Resposta rejeitada pode gerar uma nova imagem, ainda na mesma conexão.
7. PDF válido é entregue uma vez; tamanho, assinatura e hash são conferidos no
   renderizador, gateway e frontend.
8. Queda ou timeout não permite retomar o contexto nem receber bytes atrasados.
9. Sessões simultâneas de usuários/processos distintos nunca trocam mensagens.
10. Nenhum artefato efêmero permanece depois de sucesso, erro ou cancelamento.
11. Testes determinísticos usam uma página fixture com CAPTCHA em JavaScript e
    PDF sintético; pull request não depende do TJRS.
12. Cobertura rastreada permanece 100%, e lint, typecheck, Compose, scans,
    Terraform, Infracost e E2E passam.

## 8. Rollout e rollback

Rollout futuro, mediante autorização separada:

1. publicar imagem imutável do renderizador;
2. aplicar o serviço privado com escala 0–1;
3. validar IAM a partir da API ainda privada;
4. executar smoke sintético;
5. testar uma única publicação real autenticada;
6. habilitar a ação no frontend somente após o PDF válido.

Rollback remove a variável de endpoint do gateway e retorna ao cliente HTTP já
existente. O renderizador permanece privado e pode escalar a zero até remoção
posterior aprovada.
