# Spec 0006 — Consulta autenticada sem verificação de e-mail

**Status:** aprovada para implementação
**Data:** 30 de agosto de 2026
**Responsável de produto:** Meu Processo
**Custo:** [Avaliação 0007](../costs/0007-authenticated-access-without-email-verification.md)
**Decisão:** [ADR 0006](../adr/0006-temporary-unverified-email-access.md)

## 1. Problema e resultado esperado

O envio de e-mail ainda não está configurado. Hoje, uma conta é criada no
Identity Platform, mas o frontend interrompe o fluxo aguardando confirmação e o
backend rejeita o ID token com `email_verified=false`. O usuário não consegue
consultar processos mesmo tendo autenticado com e-mail e senha válidos.

Durante a validação, cadastro e login devem concluir a sessão e liberar a
consulta sem exigir confirmação do e-mail. Isso não torna a consulta anônima:
um ID token Firebase válido, não revogado, com UID e e-mail continua obrigatório
em toda rota `/api/`.

## 2. Escopo

- cadastro por e-mail e senha; a tentativa nativa de verificação é de melhor
  esforço e sua falha não bloqueia a sessão;
- login de conta com `email_verified=false`;
- validação server-side de assinatura, projeto, expiração e revogação do token;
- UID e e-mail não vazios obrigatórios;
- sessão somente em memória;
- consulta, documentos e sessão continuam autenticados e limitados por UID;
- mensagem na interface explicando que o e-mail ainda não é verificado nesta
  etapa de validação.

## 3. Fora do escopo

- login anônimo, telefone, SMS, provedores sociais, SAML ou OIDC;
- recuperação de senha, MFA ou troca de e-mail;
- provedor de e-mail transacional;
- persistência de usuários, processos ou tokens;
- mudança de infraestrutura, capacidade, rate limit ou orçamento;
- acesso público a qualquer rota `/api/` ou ao worker Chromium.

## 4. Regras de segurança e privacidade

1. Token ausente, malformado, expirado, revogado ou de outro projeto retorna
   `401 UNAUTHENTICATED`.
2. UID ausente/vazio ou e-mail ausente/vazio continua rejeitado.
3. O claim `email_verified` deve existir e ser booleano, mas pode ser falso.
4. Claims de organização recebidas do cliente não concedem acesso; memberships
   continuam carregadas server-side.
5. O frontend não persiste token nem dado processual em Web Storage.
6. Logout limpa sessão e resultados em memória.
7. A dispensa de confirmação não altera o vínculo de processo, a separação de
   homônimos nem o escopo de documentos.

## 5. Critérios de aceitação

1. Conta recém-criada recebe sessão após validação do backend e pode consultar.
2. Login com `email_verified=false` recebe sessão após validação do backend.
3. Falha na tentativa nativa de verificação não impede concluir o cadastro.
4. Token válido com `email_verified=false`, UID e e-mail retorna a sessão.
5. Token com UID ou e-mail vazio continua sendo rejeitado.
6. Requisição sem token continua retornando HTTP 401.
7. Worker sem identidade Google continua retornando HTTP 403.
8. Memberships inativas continuam removidas e isolamento por usuário permanece.
9. Testes, cobertura de 100%, lint, typecheck, build e scans passam.
10. O rollout mantém escala, custo e revisões de infraestrutura sob controle do
    Terraform.

## 6. Casos de erro e resposta parcial

- Falha do Identity Platform mostra mensagem genérica, sem revelar se a conta
  existe.
- Falha ao validar a sessão no backend não libera a consulta.
- Falha da fonte judicial mantém a mensagem de indisponibilidade já existente;
  não é interpretada como ausência de processos.
- Resultado parcial continua identificado pela fonte e nunca mistura processos
  ou usuários.

## 7. Estratégia de testes

- unidade no autenticador para identidade não verificada aceita e identidades
  incompletas rejeitadas;
- componente para cadastro e login não verificados concluindo sessão;
- regressão garantindo que cadastro não dispara e-mail;
- integração HTTP garantindo 401 sem token e sessão com token válido;
- suíte completa com cobertura e checks de isolamento existentes;
- smoke controlado no Cloud Run após deploy, sem dados processuais em logs.

## 8. Rollout e rollback

1. implementar por TDD em branch curta;
2. executar todos os checks e comparação de custo manual aprovada;
3. mesclar por PR;
4. construir imagens imutáveis com o commit aprovado;
5. aplicar troca de imagem por plano Terraform salvo;
6. testar cadastro/login, sessão, consulta sem token e worker privado.

Rollback restaura as imagens da revisão anterior. A revisão anterior volta a
exigir e-mail verificado; nenhuma migração ou limpeza de dados é necessária.

## 9. Encerramento da exceção

Quando o envio de e-mail estiver configurado e testado, uma nova spec deve
restaurar a confirmação obrigatória antes do piloto externo. Esta decisão expira
em 29/09/2026 ou antes, caso o canal de e-mail entre em operação.
