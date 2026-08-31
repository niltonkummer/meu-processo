# Avaliação 0023 — carteira processual persistida local

**Status:** aprovado somente para desenvolvimento local e CI  
**Data:** 31 de agosto de 2026  
**Teto adicional aprovado:** US$ 0/mês

## Escopo autorizado

- criar uma projeção de leitura paginada sobre `TenantCase` e `CaseRecord`;
- expor somente resumo de processo e proveniência mínima por função PostgreSQL
  estreita;
- conectar a coleção `GET /api/v1/cases` ao tenant pessoal autenticado;
- implementar contracts equivalentes em memória/PostgreSQL e testes HTTP;
- usar apenas dados sintéticos no Compose/CI.

## Custo

| Recurso | Uso | Delta mensal |
|---|---:|---:|
| CPU/RAM local | testes sob demanda | US$ 0 |
| PostgreSQL local | função e índices existentes | US$ 0 |
| GitHub Actions | franquia existente | US$ 0 incremental |
| Supabase/GCP/tribunais | não acessados | US$ 0 |

## Limites

- nenhuma tabela de evidência recebe grant direto para `app_runtime`;
- resposta máxima de 100 casos e cursor opaco/validado;
- nenhum texto, participante, CPF/CNPJ, URL ou documento é retornado;
- organização profissional permanece fora até membership interna própria;
- sem cache, Redis, busca dedicada, materialized view ou serviço cloud;
- commit, push e deploy não estão autorizados nesta etapa.

## Gate de expansão

Eventos/publicações e detalhe de processo exigem nova projeção, medição de query,
threat model confirmado e política de retenção. Cache só será considerado após
latência/carga reproduzível; a leitura inicial deve usar o PostgreSQL existente.
