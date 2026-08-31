# ADR 0015 — separação entre modelo lógico e projeção física

**Status:** aceito quanto ao modelo lógico; escolha Firestore substituída pela [ADR 0016](./0016-managed-supabase-postgres.md)
**Data:** 30 de agosto de 2026
**Relacionado:** [MER 0001](../data/0001-system-entity-relationship-model.md)

## Contexto

O sistema precisa manter semântica consistente ao crescer, exportar dados e
adicionar busca. Desenhar o domínio como estrutura específica de um fornecedor
acoplaria regras de negócio ao banco e esconderia cardinalidades, unicidade e
ownership.

## Decisão

O MER lógico é a fonte de verdade semântica para entidades, relacionamentos,
chaves e invariantes. A implementação física atual passa a ser Supabase
PostgreSQL, conforme ADR 0016, com tabelas, constraints, transações e projeções
derivadas quando uma tela justificar denormalização.

Adotamos uma entidade `TENANT` uniforme para escopos pessoais e organizacionais.
Todo dado privado referencia `tenant_id`. Evidência pública deduplicável fica em
um plano separado e só é resolvida para o cliente por `TENANT_CASE`/grants.

Referências entre agregados usam IDs opacos. Cópias denormalizadas são marcadas
como projeções, possuem `projection_version`/`updated_at` e podem ser
reconstruídas da fonte canônica. Regras de unicidade e integridade usam
constraints PostgreSQL; isolamento usa autorização server-side e RLS como defesa
em profundidade. Payloads grandes ficam no Cloud Storage, com metadados e hash no
banco.

## Consequências

- regras permanecem portáveis e testáveis independentemente do SDK;
- PostgreSQL representa diretamente relações e invariantes do MER;
- denormalização exige projeções idempotentes e ferramentas de rebuild;
- constraints, RLS e transações precisam de migrations e testes explícitos;
- uma futura migração de fornecedor/busca preserva IDs e contratos lógicos;
- MER e mapa físico devem evoluir juntos na mesma spec de schema.

## Alternativas

- **Coleções/documentos como modelo de domínio:** rejeitada por acoplamento e
  invariantes implícitas.
- **Firestore como primeiro adapter:** substituído porque a complexidade
  relacional já existe no modelo aprovado.
- **Cloud SQL:** permanece alternativa se Supabase não passar nos gates.
- **Modelos lógicos diferentes por storage:** rejeitada por divergência factual.

## Revisão

Revisar quando o primeiro repository persistente for especificado e antes de
mudar de fornecedor. Mudança física não altera a semântica sem novo ADR/migração.
