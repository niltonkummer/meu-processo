# ADR 0003 — Usar Firebase para identidade e manter autorização no backend

**Status:** aceito
**Data:** 29 de agosto de 2026
**Relacionado:** [Spec 0003 — Autenticação](../specs/0003-authentication.md)

## Contexto

O painel precisa identificar pessoas sem criar armazenamento próprio de senhas.
Ao mesmo tempo, uma sessão Firebase no navegador não substitui a autorização de
invocação IAM de um serviço Cloud Run privado, e claims fornecidas pelo cliente
não podem definir o tenant dos dados processuais.

## Decisão

Firebase Authentication/Identity Platform será o provedor de identidade. O SDK
cliente cria contas e obtém ID tokens; o Firebase Admin SDK valida esses tokens
no backend com credenciais nativas do runtime e verificação de revogação.

Uma camada de aplicação exige e-mail confirmado e combina a identidade verificada
com memberships carregadas de um diretório confiável server-side. A autorização
continua usando o escopo pessoal ou organizacional já existente.

O token permanece somente em memória no cliente. O Cloud Run continua privado
por IAM nesta mudança. Antes de abrir o painel externamente será escolhida e
modelada uma borda que valide Firebase e invoque o serviço privado, ou uma
exposição pública estritamente limitada com autenticação integral na aplicação,
proteção contra abuso e threat model.

## Consequências

- senhas não passam pelo backend do produto;
- nenhum segredo ou chave de service account é entregue ao frontend;
- API key e identificadores Firebase do web app são configuração pública, não
  autorização;
- revogação oferece falha segura com uma consulta adicional do Admin SDK;
- recarregar a página encerra a sessão nesta fase, priorizando não persistir o
  token;
- memberships precisarão de um repositório persistente antes do multiusuário;
- a autenticação pode ser testada com adaptadores em memória sem usar produção.

## Alternativas consideradas

- **Sessão persistente no Web Storage:** rejeitada pelo risco adicional de roubo
  de token e pelos guardrails do produto.
- **Confiar em UID ou organização enviados pelo frontend:** rejeitada porque
  permitiria personificação e quebra de isolamento.
- **Conta de serviço/chave no navegador:** rejeitada; seria um segredo exposto.
- **Desabilitar IAM do Cloud Run agora:** rejeitada até existir revisão completa
  das rotas públicas, limitação de abuso e autorização de deploy.
- **Autenticação própria com senha:** rejeitada por ampliar superfície de risco,
  recuperação de conta e operação de credenciais sem necessidade.

## Emenda de implantação — 30 de agosto de 2026

O Identity Platform será inicializado diretamente pela API Google Cloud, sem
criar um Firebase Project ou Firebase Web App. Essa forma evita a dependência do
aceite manual dos termos do Firebase Console e mantém o mesmo protocolo: o SDK
Firebase Web obtém ID tokens e o Firebase Admin SDK os verifica no backend.

A configuração pública usa uma API key criada pelo Terraform, limitada por
referer ao Cloud Run/localhost e por destino a
`identitytoolkit.googleapis.com`. A chave identifica o projeto, mas não autentica
usuários nem autoriza rotas `/api/`; essa autorização continua dependendo do ID
token validado no servidor.
