# ADR 0004 — borda pública com autorização de aplicação e proxy stateless

**Status:** aceita para validação
**Data:** 30 de agosto de 2026

## Contexto

O navegador precisa carregar o painel sem credencial Google IAM, enquanto
consultas e PDFs devem sair de uma região brasileira. O serviço atual é privado
e o Firebase autentica usuários finais, não invoca Cloud Run por IAM. Persistir
URLs de documentos exigiria banco, regras por tenant, retenção e custo antes de
essa necessidade estar comprovada.

## Decisão

Reutilizar um único Cloud Run em `southamerica-east1` e permitir invocação HTTP
pública somente após uma revisão que já proteja toda rota `/api/` com Firebase.
Arquivos estáticos e health permanecem anônimos. Consulta e proxy exigem token
verificado, e o proxy resolve novamente a referência no DJEN usando número do
processo e da comunicação.

A URL oficial não faz parte do contrato público. Ela existe apenas entre o
cliente DJEN e o `SecureDocumentClient`, que aplica allowlist exata e proteção
contra SSRF. O frontend mantém o token apenas em memória e baixa o PDF com
`fetch` autenticado.

## Alternativas

- **Firebase Hosting + API Gateway:** mantém Cloud Run privado, mas adiciona
  serviços, configuração e custo sem benefício suficiente para a validação.
- **Load balancer + IAP/Cloud Armor:** mais controle de borda, porém IAP não é a
  identidade Firebase do produto e o load balancer adiciona custo fixo.
- **URL assinada pelo servidor:** exigiria segredo e ainda transportaria uma
  capacidade reutilizável; rejeitada enquanto o DJEN permite re-resolução.
- **Firestore/Storage:** rejeitados nesta fase por retenção, privacidade e custo.
- **Proxy de URL fornecida pelo cliente:** rejeitado por SSRF e falta de
  proveniência.

## Consequências

- o container recebe tráfego anônimo para estáticos e tentativas negadas;
- rate limiting em memória é por instância, suficiente apenas para validação;
- o limite global e Cloud Armor serão reavaliados antes de produção;
- disponibilidade do PDF depende do DJEN e do tribunal;
- cada novo host exige teste brasileiro e alteração revisada da allowlist.
