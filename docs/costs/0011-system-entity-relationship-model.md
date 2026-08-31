# Avaliação de custo 0011 — modelo entidade-relacionamento do sistema

<!-- infra-cost-assessment:v1 -->

**Status:** aprovado para implementação
**Solicitado por:** proprietário do produto
**Responsável:** proprietário do produto e engenharia
**Data da avaliação:** 30 de agosto de 2026
**Ambientes afetados:** documentação local; nenhum ambiente de runtime
**Spec/issue:** definição do MER lógico e do mapeamento inicial de persistência

**Custo mensal atual (USD):** até US$ 0,38 no cenário de validação já aprovado
**Custo mensal esperado (USD):** até US$ 0,38; delta mensal US$ 0
**Custo mensal limite (USD):** US$ 10
**Aprovação:** o pedido do proprietário para definir o MER aprova esta alteração exclusivamente documental em 30/08/2026

## 1. Decisão

Autorizar a definição do modelo lógico de entidades, relacionamentos,
cardinalidades, chaves, invariantes, classificação de dados e mapeamento inicial
para Firestore/Cloud Storage.

O documento não cria banco, coleção, índice, bucket ou migração. A implementação
futura exigirá spec executável, threat model, avaliação de custo, testes com
emuladores e IaC próprios.

## 2. Alteração de infraestrutura

| Componente/SKU | Região | Estado atual | Estado proposto | Quantidade | Custo unitário | Delta mensal |
|---|---|---|---|---:|---:|---:|
| Documentação do modelo | local/Git | inexistente | arquivo Markdown com diagramas Mermaid | — | US$ 0 | US$ 0 |
| Firestore e Cloud Storage | — | não provisionados por esta mudança | somente mapeamento conceitual | 0 | — | US$ 0 |
| Migração/backfill | — | inexistente | não executar | 0 | — | US$ 0 |

Custos únicos, processamento, armazenamento, operações e egress: US$ 0.

## 3. Premissas e cenários

| Direcionador | Base atual | Esperado | Limite operacional | Unidade |
|---|---:|---:|---:|---|
| Documentos persistidos | 0 | 0 | 0 | registros |
| Armazenamento adicional | 0 | 0 | 0 | GiB-mês |
| Operações de banco | 0 | 0 | 0 | operações/mês |
| Processamento/egress/logs | 0 | 0 | 0 | consumo adicional |

Volumes futuros servem apenas para orientar particionamento e índices; não são
aprovação de consumo.

## 4. Custos não cobertos automaticamente

- Firestore, Storage, backups, operações, egress e logs: não usados.
- Banco de busca, analytics, filas, IA e APIs externas: não usados.
- Infracost: não aplicável porque Terraform não será alterado.
- Dependências: nenhuma alteração.

## 5. Limites e condição de parada

- O diff permanece documental.
- Proibido inserir CPF/CNPJ, nome, CNJ, publicação ou documento real.
- Proibido provisionar coleções, buckets, índices ou executar migração.
- A futura persistência para até possuir custo, retenção e isolamento aprovados.
- Somente o proprietário aceita novo SKU ou aumento do limite de US$ 10.

## 6. Evidência e fontes

- [Spec 0009 — fundação expansível](../specs/0009-scalable-product-foundation.md).
- [ADR 0012 — planos de tenant e evidência](../adr/0012-tenant-control-and-evidence-planes.md).
- [ADR 0013 — outbox e jobs](../adr/0013-transactional-outbox-and-idempotent-jobs.md).
- Infracost não aplicável: nenhum recurso de infraestrutura será alterado.

## 7. Aprovação

O pedido explícito aprova a documentação local. Não autoriza implementação,
commit, push, PR, merge, deploy ou persistência de dados.

## 8. Verificação posterior

Não aplicável sem deploy. Confirmar delta US$ 0 e ausência de alteração de
runtime, dependência, Terraform ou dado.
