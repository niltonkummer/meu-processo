# Implementação 0004 — autenticação Firebase/Identity Platform

**Data:** 29 de agosto de 2026
**Spec:** [Spec 0003](../specs/0003-authentication.md)
**ADR:** [ADR 0003](../adr/0003-firebase-authentication-boundary.md)
**Custo:** [Avaliação 0004](../costs/0004-firebase-authentication.md)

## Entregue

- cadastro e login por e-mail/senha no SDK oficial Firebase;
- verificação de e-mail obrigatória e reenvio da confirmação;
- confirmação enviada em `pt-BR` pelo serviço nativo do Firebase, com retorno
  restrito à origem atual do painel;
- sessão do navegador em memória (`inMemoryPersistence`);
- logout com limpeza do estado da interface;
- carregamento sob demanda do SDK para não pesar a busca pública inicial;
- validação server-side do ID token com Firebase Admin e revogação habilitada;
- memberships carregadas no servidor e filtradas por estado ativo;
- `GET /api/v1/session` com resposta privada e sem token/e-mail;
- Identity Platform e chave pública restrita declarados em Terraform, sem
  Firebase Project ou Web App;
- somente e-mail/senha habilitado; telefone, anônimo e duplicidade de e-mail
  desabilitados;
- emulador Firebase Auth disponível no Docker Compose;
- frontend aceita o emulador somente quando o build declara uma origem HTTP em
  `127.0.0.1` ou `localhost`; endereços remotos falham fechados;
- CSP restrita aos endpoints oficiais usados pelo Firebase Auth;
- Cloud Run ainda privado por IAM e com escala a zero.

## Executar localmente

O caminho mais simples para desenvolvimento interativo é iniciar o emulador e
o Vite, porque o servidor de desenvolvimento não impõe a CSP de produção:

```sh
cp .env.example .env.local
docker compose up --build auth-emulator
npm run dev
```

Abra o endereço informado pelo Vite. Todas as contas criadas nesse fluxo são
sintéticas e ficam apenas no emulador `demo-meu-processo`.

O emulador não envia e-mail real. Depois de criar a conta, o painel consulta
somente o endpoint local oficial de códigos fora de banda e mostra o botão
`Confirmar e-mail de teste`. Esse botão nunca é produzido no build cloud. Se o
endpoint local estiver indisponível, o link continua disponível no log de
`auth-emulator`; em seguida, volte ao painel e entre novamente.

Para validar a imagem completa, incluindo o backend conectado ao emulador:

```sh
docker compose up --build app auth-emulator
```

O teste automatizado continua isolado e determinístico:

```sh
docker compose --profile test run --build --rm test
```

## Configuração cloud

Depois de um `terraform apply` explicitamente autorizado, o output sensível à
exibição acidental
`firebase_web_config` fornece `api_key`, `app_id`, `auth_domain` e `project_id`.
Esses identificadores devem ser cadastrados como GitHub Actions Variables para
o build imutável. Eles não são credenciais; a autorização continua no backend.

O deploy exige as variáveis:

- `FIREBASE_BROWSER_KEY`;
- `FIREBASE_APP_ID`;
- `FIREBASE_AUTH_DOMAIN`;
- `FIREBASE_PROJECT_ID`.

O primeiro bootstrap do Identity Platform e da chave restrita precisa ocorrer
por um plano Terraform revisado antes do primeiro build autenticado. Não criar
chaves manualmente.

O MVP usa o remetente transacional padrão do Firebase/Identity Platform, sem
SMTP, SendGrid ou outro fornecedor. `sendEmailVerification` solicita a mensagem
imediatamente após o cadastro, define o locale `pt-BR` e aponta a continuação
para a própria origem autorizada. Personalizar domínio de remetente ou SMTP é
uma mudança futura de infraestrutura, custo e segredo e exige avaliação própria.

## Limitações antes do piloto

- recuperação de senha e MFA ainda não foram especificados;
- memberships usam diretório vazio no runtime até o repositório persistente;
- o Cloud Run permanece privado até o smoke real do proxy de documentos passar;
- a borda pública já está modelada e protegida na aplicação, mas o binding
  `allUsers` continua desabilitado;
- a validação cloud está registrada na
  [Implementação 0005](./0005-cloud-authentication-validation.md).
