# Implementação 0006 — consulta antes da configuração de e-mail

**Data:** 30 de agosto de 2026
**Spec:** [0006](../specs/0006-authenticated-access-without-email-verification.md)
**ADR:** [0006](../adr/0006-temporary-unverified-email-access.md)
**Custo:** [0007](../costs/0007-authenticated-access-without-email-verification.md)

## Comportamento

O autenticador server-side continua validando o ID token Firebase e sua
revogação. UID e e-mail não vazios permanecem obrigatórios, mas o booleano
`emailVerified` pode ser falso durante a validação.

Cadastro e login sempre enviam o token ao endpoint `/api/v1/session`. A entrega
de verificação solicitada pelo SDK no cadastro é de melhor esforço: uma falha do
canal de e-mail não desfaz a conta nem impede validar a sessão. A interface não
afirma que uma mensagem foi enviada e identifica contas ainda não confirmadas.

## Controles preservados

- nenhuma rota `/api/` ficou anônima;
- token ausente, inválido ou revogado continua recebendo HTTP 401;
- login anônimo permanece desabilitado;
- memberships continuam carregadas no servidor;
- token e resultados permanecem somente em memória;
- rate limits e escopo por UID não foram alterados;
- worker Chromium permanece privado;
- não há novo recurso, dependência, armazenamento ou e-mail transacional.

## Testes de regressão

- autenticador aceita token válido com `emailVerified=false`;
- autenticador ainda rejeita UID ou e-mail vazio;
- cadastro não verificado conclui a sessão pelo backend;
- login não verificado conclui a sessão sem oferecer reenvio;
- falha ao tentar a entrega de verificação não bloqueia criação da conta;
- entrega aceita mantém seus metadados;
- logout, erro seguro e sessão verificada continuam cobertos.

## Rollout

A imagem será construída com o commit aprovado e promovida por plano Terraform
salvo, sem alterar capacidade ou IAM. O smoke exige frontend HTTP 200, API sem
token HTTP 401, worker sem identidade HTTP 403 e consulta autenticada com uma
conta de validação não confirmada.

Rollback restaura a imagem anterior, que volta a exigir confirmação de e-mail.
Nenhuma migração ou remoção de conta é necessária.
