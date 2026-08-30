# Threat model 0003 — renderizador de página judicial

**Status:** baseline obrigatório da validação
**Data:** 30 de agosto de 2026
**Escopo:** Spec 0005 e Avaliação 0006

## 1. Ativos

- Firebase ID token e identidade autenticada;
- associação entre usuário, processo e comunicação;
- URL oficial resolvida no DJEN;
- cookies e contexto efêmero do tribunal;
- imagem do CAPTCHA e resposta humana;
- PDF e hash do documento;
- identidade de serviço usada para invocar o renderizador.

## 2. Fronteiras de confiança

1. navegador do usuário → API pública;
2. API pública → DJEN;
3. API pública → Cloud Run privado por IAM;
4. renderizador → hosts TJRS permitidos;
5. página e JavaScript não confiáveis → processo Chromium;
6. Chromium → aplicação controladora do renderizador.

DJEN e TJRS são fontes oficiais, mas todas as respostas continuam não
confiáveis. O frontend nunca é fronteira de autorização.

## 3. Capacidades do atacante

- abrir muitas conexões públicas, omitir ou falsificar mensagens;
- usar token válido de uma conta própria contra referências arbitrárias;
- manipular URL, CNJ, comunicação, frames, tamanhos e ordem;
- controlar ou comprometer conteúdo carregado por uma página permitida;
- induzir redirects, DNS rebinding, downloads enormes e loops de JavaScript;
- tentar obter token, URL, cookie, CAPTCHA, HTML ou PDF pelos logs;
- provocar queda para reutilizar uma sessão ou receber bytes de outro fluxo.

## 4. Ameaças e controles

| Ameaça | Controle obrigatório | Evidência |
|---|---|---|
| Acesso sem conta | primeira mensagem autenticada em 5 s; token verificado e revogação consultada | testes HTTP/WS |
| IDOR por CNJ/comunicação | resolução exata no DJEN após autenticação; URL não vem do cliente | testes de publicação |
| Mistura cross-tenant | um socket, uma referência e um contexto; sem retomada; fechamento limpa listeners e browser | testes concorrentes |
| SSRF/redirect/DNS rebinding | HTTPS/443, allowlist exata, resolução pública e pin do host; toda requisição do browser interceptada | testes de rede |
| Página maliciosa | serviço separado, conta sem privilégios, usuário não-root, filesystem read-only, caps removidas, timeout e memória | Docker/Compose/Terraform |
| Escape do Chromium | imagem pinada, processo isolado no Cloud Run, sem credenciais e sem acesso a APIs; scan High/Critical zero | Trivy/SBOM |
| CAPTCHA automatizado | nenhuma API de OCR/IA, somente mensagem `answer` humana, sem retries automáticos | revisão de dependências/fluxo |
| Exfiltração no screenshot | somente elemento raster validado, limites de dimensão/tamanho, PNG reencodado | testes fixture |
| PDF falso ou bomba | content-type, `%PDF`, 25 MiB, tamanho declarado e SHA-256 conferidos nas três camadas | testes de integridade |
| DoS/custo | escala 0–1, concorrência 1, 120 s, payload pequeno, rate limit por UID, uma sessão ativa | testes/Terraform |
| Token em log | token somente no primeiro frame TLS; logger categórico; nenhuma URL ou payload | teste com logger espião |
| Estado órfão | `finally` fecha página, contexto, browser e conexões em sucesso, erro, timeout e cancelamento | testes de cleanup |
| Supply chain | lockfile, imagem por versão/digest, npm audit, Hadolint, Checkov, Trivy, SBOM | pipeline |

## 5. Invariantes de segurança

- O renderizador nunca é público.
- O renderizador não conhece UID, nome, CPF/CNPJ ou organização.
- O gateway nunca aceita uma URL externa no protocolo público.
- O processo Chromium não recebe credencial Google.
- Uma sessão não pode produzir mais de um PDF.
- Frame binário só é aceito depois de metadata válida e com tamanho exato.
- Erro ou timeout fecha todos os dois sockets e o browser.
- Nenhuma tentativa de resolver CAPTCHA existe no código ou nas dependências.

## 6. Riscos residuais

- O sandbox interno do Chromium pode ser limitado pelo runtime serverless; o
  isolamento compensatório é o serviço dedicado, sem privilégio e sem segredo.
- Mudanças legítimas do TJRS podem quebrar a detecção e causar indisponibilidade.
- IAM do Cloud Run protege invocação, mas a aplicação ainda valida protocolo e
  origem em profundidade.
- O budget envia alerta e não interrompe cobrança; os limites de instância,
  concorrência, tempo e volume são a barreira operacional.

Esses riscos são aceitáveis somente na validação privada de baixo volume. Uma
abertura ampla exige revisão deste documento e controle global de abuso.
