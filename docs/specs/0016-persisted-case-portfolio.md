# Spec 0016 — carteira processual persistida

**Status:** aprovada para implementação local  
**Data:** 31 de agosto de 2026  
**Custo:** [0023](../costs/0023-local-persisted-case-portfolio.md)  
**Arquitetura:** [ADR 0012](../adr/0012-tenant-control-and-evidence-planes.md)

## Objetivo

Permitir que uma pessoa autenticada recupere os processos já projetados para seu
tenant pessoal, sem consultar uma fonte externa e sem acesso direto às tabelas
de evidência.

## Contrato

`GET /api/v1/cases?limit=20&after=<uuid>` retorna:

- itens ordenados por `caseId` em ordem crescente estável;
- `caseId`, CNJ, tribunal, identidade, última projeção e fontes mínimas;
- `nextCursor` somente quando existe outra página;
- cache `private, no-store`.

`limit` deve estar entre 1 e 100. Parâmetro desconhecido, repetido ou cursor
inválido retorna erro seguro. A primeira versão atende somente tenant pessoal.

## Autorização

- o provider subject vem exclusivamente do token verificado;
- o resolver interno provisiona/resolve UUIDs opacos de usuário/tenant;
- membership ativa é revalidada dentro da transação;
- a função de leitura deriva tenant de `current_setting` e não aceita tenant ID
  como argumento;
- `app_runtime` recebe `EXECUTE`, nunca `SELECT` nas tabelas de evidência;
- tenant sem grant ativo não recebe o processo, mesmo conhecendo `caseId`/CNJ.

## Critérios de aceite

1. tenant pessoal lista somente `TenantCase` ativo próprio;
2. mesmo CNJ de outro tenant não aparece;
3. cursor e limite são aplicados no banco com `limit + 1`;
4. uma fonte aparece uma vez, com código, classificação oficial e última coleta;
5. tenant novo recebe lista vazia após bootstrap idempotente;
6. falha de autenticação é 401; contexto profissional ainda não suportado falha
   fechado sem fallback para outro tenant;
7. função, RLS, grants, contracts, HTTP, restore e cobertura permanecem verdes;
8. nenhuma chamada externa ou custo mensal é ativado.

## Fora do escopo

- detalhe, eventos, publicações e documentos persistidos;
- ordenação/filtro por data, tribunal ou texto;
- organizações, compartilhamento e entitlements;
- frontend definitivo da carteira;
- Supabase real, cache ou search engine.
