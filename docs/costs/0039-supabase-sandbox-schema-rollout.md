# Avaliação de custo 0039 — rollout do schema no sandbox Supabase

<!-- infra-cost-assessment:v1 -->

**Status:** aprovado para implementação
**Solicitado por:** proprietário do produto
**Responsável:** engenharia do Meu Processo
**Data da avaliação:** 31 de agosto de 2026
**Ambientes afetados:** Supabase Free `Meu Processo` em `sa-east-1`, código e CI
**Spec/issue:** aplicar migrations e validar isolamento com dados sintéticos

**Custo mensal atual (USD):** até US$ 0,38 já aprovado
**Custo mensal esperado (USD):** inalterado; delta esperado US$ 0
**Custo mensal limite (USD):** US$ 0 neste gate; upgrade pago proibido
**Aprovação:** instrução explícita do proprietário em 31/08/2026 para continuar
até completar a fundação, condicionada aos guardrails de custo existentes

## 1. Decisão

Usar somente o projeto Supabase Free existente, referência
`tbfhcvrdkrerhzqjwyyu`, para:

- fixar e executar a Supabase CLI sem expor token;
- verificar projeto, região, plano e ausência de dados reais;
- executar lint/dry-run antes de qualquer migration;
- aplicar migrations 0001–0019 pelo endpoint administrativo;
- criar cinco logins sandbox restritos com senhas geradas e armazenadas no
  Infisical Development;
- executar pgTAP, contracts, RLS/cross-tenant e carga sintética limitada;
- medir conexões, latência e erros sem Cloud Run neste gate.

Não autoriza upgrade, projeto adicional, dado pessoal/processual real, GCS,
Secret Manager, Cloud Run, Infisical Secret Sync, produção ou exclusão de
recurso externo fora do rollback do próprio sandbox.

## 2. Impacto de custo

| Componente | Antes | Depois deste gate | Delta mensal |
|---|---:|---:|---:|
| Supabase Free São Paulo | 1 projeto vazio | mesmo projeto com schema/dados sintéticos | US$ 0 |
| Supavisor | 0 conexão do produto | smoke/carga curta e limitada | US$ 0 esperado |
| Egress | 0 | apenas resultados sintéticos de teste | desprezível, teto US$ 0 |
| GCP/Cloud Run/GCS | nenhuma alteração | nenhuma alteração | US$ 0 |

Se qualquer tela, API ou CLI exigir cartão, add-on, compute pago, read replica,
PITR ou upgrade de plano, o rollout para antes da confirmação.

## 3. Guardrails

- confirmar `Free`, `sa-east-1` e project ref antes da primeira escrita;
- nunca imprimir conexão, senha, token ou valor do Infisical;
- migrations usam conexão administrativa direta; runtime usa Supavisor `6543`;
- runtime nunca conecta como `postgres`;
- logins recebem somente uma role de grupo `NOLOGIN` e não possuem ownership,
  `SUPERUSER`, `CREATEDB`, `CREATEROLE` ou `BYPASSRLS`;
- uma combinação de role/database/mode é ativada por vez durante a medição;
- no máximo cinco conexões de cliente por workload e 25 operações concorrentes;
- dados são UUIDs/rótulos sintéticos, nunca nome, CPF, CNPJ ou processo real;
- falha em RLS, redaction ou grants executa rollback e bloqueia os próximos gates;
- migration history e hashes locais são registrados sem conteúdo de secret.

## 4. Rollback

Antes do rollout, capturar inventário estrutural sem dados. Em falha:

1. revogar login dos cinco usuários sandbox;
2. terminar somente sessões desses usuários;
3. remover logins criados pelo gate;
4. remover schemas `app_private`/`app_public` e roles de grupo somente se o
   inventário inicial confirmar que foram criados pelo Meu Processo;
5. manter o projeto Free para nova tentativa ou pausá-lo pela interface.

Nenhum comando destrutivo será executado por target implícito ou sem conferir o
project ref novamente.

## 5. Condições de parada

- plano/região/ref divergente;
- banco não vazio ou objeto não reconhecido;
- dry-run diferente das 19 migrations versionadas;
- secret ausente ou CLI não autenticada;
- qualquer finding High/Critical, quebra de cobertura ou teste cross-tenant;
- necessidade de usar `postgres` como runtime;
- limite/custo indisponível ou superior ao teto.

## 6. Fontes

- [Supabase — conexão com Postgres](https://supabase.com/docs/guides/database/connecting-to-postgres);
- [Supabase — migrations](https://supabase.com/docs/guides/local-development/database-migrations);
- [Supabase — preços](https://supabase.com/pricing);
- [Avaliação 0038](0038-supabase-supavisor-runtime-readiness.md).

## 7. Aprovação

Status **aprovado para implementação** dentro dos limites acima. O próximo
gate de Secret Manager/GCS/Cloud Run terá avaliação própria antes de qualquer
mutação GCP.
