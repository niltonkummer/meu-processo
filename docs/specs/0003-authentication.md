# Spec 0003 — Autenticação do painel privado

**Status:** implementada e validada em revisão privada
**Data:** 29 de agosto de 2026
**Responsável de produto:** Meu Processo
**Custo:** [Avaliação 0004](../costs/0004-firebase-authentication.md)

## 1. Resultado esperado

Uma pessoa cria uma conta com e-mail e senha, confirma o e-mail, entra no painel
e encerra a sessão. O backend aceita rotas privadas apenas quando recebe um ID
token Firebase válido, não revogado e pertencente ao projeto configurado.

A busca exige autenticação durante a validação cloud. Login no frontend não é
autorização: dados privados continuam protegidos no servidor e escopados pelo
usuário ou organização.

## 2. Escopo

- cadastro por e-mail/senha;
- envio de verificação de e-mail após o cadastro;
- login somente para e-mail confirmado;
- reenvio do e-mail de verificação;
- logout que elimina identidade e token da memória;
- sessão em memória, sem token em `localStorage` ou `sessionStorage`;
- validação server-side de assinatura, audiência/projeto, validade e revogação;
- endpoint privado `GET /api/v1/session` para confirmar a identidade efetiva;
- memberships ativas carregadas no servidor, nunca aceitas como autorização
  fornecida pelo frontend;
- Identity Platform configurado diretamente por Terraform com e-mail/senha e
  chave de navegador restrita;
- Cloud Run permanece privado e sem binding `allUsers`.

## 3. Fora do escopo

- telefone/SMS, login anônimo, provedores sociais, SAML ou OIDC;
- recuperação de senha e MFA, que serão especificados antes do piloto externo;
- persistência de usuários, convites e organizações (agora planejada no
  Supabase PostgreSQL conforme ADR 0016);
- exposição pública do Cloud Run, Firebase Hosting ou deploy;
- migração de contas existentes;
- autorização baseada apenas em controles visuais.

## 4. Contratos e regras

### 4.1 Identidade verificada

O adaptador Firebase converte o token em uma identidade mínima:

- `userId` obrigatório e não vazio;
- `email` obrigatório;
- `emailVerified` deve ser verdadeiro;
- nenhuma claim de organização recebida do cliente concede acesso.

Falhas do Firebase não são refletidas ao cliente. Token ausente, malformado,
expirado, revogado, de outro projeto ou com e-mail não confirmado resulta em
`401 UNAUTHENTICATED`.

### 4.2 Sessão

`GET /api/v1/session`, com `Authorization: Bearer <ID token>`, responde:

```json
{
  "user": {
    "userId": "firebase-uid",
    "memberships": [
      { "organizationId": "org-id", "role": "viewer" }
    ]
  }
}
```

Somente memberships ativas são retornadas. A resposta usa
`Cache-Control: private, no-store` e não devolve o token nem e-mail.

### 4.3 Frontend

- configuração pública do Firebase vem de `VITE_FIREBASE_*`; nenhuma variável é
  segredo;
- ausência/inconsistência de configuração falha de forma explícita;
- SDK Firebase é carregado apenas quando o usuário abre o acesso à conta;
- senha nunca é registrada, persistida ou incluída em mensagens de erro;
- erros do provedor são mapeados para mensagens seguras em português;
- cadastro informa que a confirmação foi enviada e não cria acesso privado;
- login de e-mail não confirmado oferece reenvio, sem revelar dados adicionais;
- logout limpa imediatamente estado e dados privados em memória.

## 5. Critérios de aceitação

1. Token válido e e-mail confirmado retorna a sessão correta.
2. Token ausente, malformado, rejeitado ou com e-mail não confirmado retorna 401.
3. Memberships inativas não aparecem na sessão e não concedem acesso.
4. O UID do frontend nunca substitui o UID verificado pelo backend.
5. Cadastro chama criação de conta e envio de verificação.
6. Login confirmado conclui a sessão; login não confirmado não libera acesso.
7. Logout remove a sessão em memória e não deixa token em Web Storage.
8. O formulário é navegável por teclado, rotulado e anuncia erros/estados.
9. Configuração Terraform habilita somente e-mail/senha e mantém o Cloud Run
   privado.
10. Testes, cobertura, lint, typecheck, build, Compose e scans aplicáveis passam.

## 6. Rollout e rollback

Esta entrega termina em código local e plano Terraform. Um rollout futuro exige:

1. aprovação do plano e do diff Infracost;
2. criação/configuração do Identity Platform por pipeline;
3. configuração das variáveis públicas do frontend;
4. validação em development com contas sintéticas;
5. threat model antes de expor uma superfície pública;
6. smoke de cadastro, confirmação, login, revogação e logout.

Rollback desabilita a interface de conta por configuração e restaura a revisão
anterior. A API permanece deny-by-default quando o verificador não está
configurado.
