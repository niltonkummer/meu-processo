# ADR 0006 — permitir temporariamente e-mail não confirmado na validação

**Status:** aceita para validação, com expiração em 29/09/2026
**Data:** 30 de agosto de 2026
**Relacionado:** [Spec 0006](../specs/0006-authenticated-access-without-email-verification.md)

## Contexto

O Identity Platform autentica e-mail e senha e emite um ID token válido, mas o
produto ainda não possui envio de e-mail operacional. A decisão original do ADR
0003 exige `email_verified=true`; assim, contas recém-criadas não conseguem
consultar durante a validação.

Não devemos substituir esse bloqueio por login anônimo, credencial compartilhada
ou acesso público à API. Também não é adequado afirmar que um e-mail foi enviado
quando o canal não está configurado.

## Decisão

Durante a validação, o backend aceitará `email_verified=false` se e somente se o
Firebase Admin validar o token, a revogação e o projeto e o token contiver UID e
e-mail não vazios. Memberships e autorização permanecem server-side.

O frontend concluirá a sessão após cadastro ou login. A tentativa nativa de
verificação no cadastro será de melhor esforço e sua falha não impedirá criar a
sessão. A interface não afirmará que a mensagem foi entregue e informará que a
confirmação ainda não faz parte desta etapa. Token e resultados continuam
somente em memória.

Esta ADR altera temporariamente apenas a exigência de confirmação do ADR 0003.
As demais decisões daquele ADR e da borda pública do ADR 0004 permanecem.

## Controles compensatórios

- login anônimo permanece desabilitado no Identity Platform;
- senha mínima de 12 caracteres na interface;
- Firebase Admin verifica token e revogação;
- UID e e-mail continuam obrigatórios;
- API continua respondendo 401 sem token;
- rate limits existentes permanecem por UID e instância;
- worker permanece privado e invocável apenas pela identidade da aplicação;
- nenhum dado ou token é persistido no navegador;
- rollback restaura a imagem anterior sem migração.

## Consequências

- usuários podem testar imediatamente sem depender de e-mail;
- alguém que controle uma caixa de e-mail diferente da informada não precisa
  provar esse controle nesta etapa;
- recuperação de conta e comunicações por e-mail continuam indisponíveis;
- o comportamento não é adequado para piloto externo ou produção;
- configurar o canal de e-mail exige nova mudança para restaurar a confirmação.

## Alternativas consideradas

- **Login anônimo:** rejeitado porque elimina a identidade estável do usuário.
- **Conta compartilhada de teste:** rejeitada por auditoria, isolamento e
  revogação inadequados.
- **Marcar usuários manualmente como verificados:** rejeitado por depender de
  operação manual não declarativa e afirmar uma verificação que não ocorreu.
- **Aguardar o provedor de e-mail:** rejeitado para a validação atual porque
  impede testar a funcionalidade principal já implantada.
- **Manter envio e ignorar sua falha:** rejeitado porque cadastro continuaria
  dependente de um serviço indisponível e a interface seria enganosa.
