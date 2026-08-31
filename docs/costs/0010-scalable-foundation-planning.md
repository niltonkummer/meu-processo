# Avaliação de custo 0010 — planejamento da fundação expansível

<!-- infra-cost-assessment:v1 -->

**Status:** aprovado para implementação
**Solicitado por:** proprietário do produto
**Responsável:** proprietário do produto e engenharia
**Data da avaliação:** 30 de agosto de 2026
**Ambientes afetados:** documentação local; nenhum ambiente de runtime
**Spec/issue:** fundação arquitetural necessária para expansão do produto

**Custo mensal atual (USD):** até US$ 0,38 no cenário de validação já aprovado
**Custo mensal esperado (USD):** até US$ 0,38; delta mensal US$ 0
**Custo mensal limite (USD):** US$ 10
**Aprovação:** o pedido do proprietário para garantir a fundação necessária à expansão aprova esta alteração exclusivamente documental em 30/08/2026

## 1. Decisão

Autorizar a auditoria read-only da arquitetura atual e a criação de spec,
roadmap e ADRs que definam a fundação expansível. O escopo cobre limites de
módulo, contratos, multi-tenancy, persistência, processamento assíncrono,
observabilidade, segurança, testes e critérios de evolução.

Esta avaliação não autoriza refatorar código, adicionar dependência, provisionar
banco/fila/storage, executar migração, coletar dados, fazer commit ou deploy.
Cada fatia executável da fundação terá spec e avaliação de custo próprias.

O impacto de infraestrutura desta mudança é zero.

## 2. Alteração de infraestrutura

| Componente/SKU | Região | Estado atual | Estado proposto | Quantidade | Custo unitário | Delta mensal |
|---|---|---|---|---:|---:|---:|
| Documentação versionada | local/Git | existente | novos arquivos Markdown | — | US$ 0 | US$ 0 |
| Cloud Run e Identity Platform | `southamerica-east1`/global | cenário atual | sem mudança | — | inalterado | US$ 0 |
| Firestore, Storage, Scheduler e Tasks | — | ainda não provisionados para a fundação | não provisionar nesta etapa | 0 | — | US$ 0 |
| Busca, analytics e IA | — | ausentes | manter ausentes | 0 | — | US$ 0 |

Custos únicos de implantação, migração, backfill, recuperação e egress: US$ 0.

## 3. Premissas e cenários

| Direcionador | Base atual | Esperado | Limite operacional | Unidade |
|---|---:|---:|---:|---|
| Requisições do produto | cenário aprovado | inalterado | inalterado | por mês |
| Processamento adicional | 0 | 0 | 0 | vCPU-s/GiB-s |
| Armazenamento adicional | 0 | 0 | 0 | GiB-mês |
| Operações de dados adicionais | 0 | 0 | 0 | operações/mês |
| Saída de rede adicional | 0 | 0 | 0 | GiB/mês |
| Logs adicionais | 0 | 0 | 0 | GiB/mês |

Arquiteturas e serviços futuros serão descritos como decisões condicionais,
nunca como recursos aprovados.

## 4. Custos não cobertos automaticamente

- Cloud Run, Firestore, Storage, egress, logs e filas: sem alteração.
- E-mail, WhatsApp, APIs, busca e IA: não usados nesta etapa.
- Infracost: não aplicável porque não há mudança Terraform.
- Dependências e ferramentas: nenhuma alteração de manifesto ou lockfile.
- Impostos e câmbio: não aplicáveis ao delta de US$ 0.

## 5. Limites e condição de parada

- O diff deve permanecer exclusivamente documental.
- Nenhum novo SKU, recurso, dependência ou dado pode ser criado.
- A documentação não pode conter dado pessoal, processo real, token ou segredo.
- Toda implementação futura para até existir avaliação própria aprovada.
- Somente o proprietário aceita novo SKU ou aumento do limite de US$ 10.
- Validade: enquanto o escopo permanecer apenas documental.

## 6. Evidência e fontes

- [Avaliação 0009](./0009-jusbrasil-functional-requirements-planning.md), baseline documental.
- [Engineering Guardrails](../../ENGINEERING_GUARDRAILS.md).
- [Roadmap funcional 0008](../implementation/0008-functional-requirements-roadmap.md).
- Infracost não aplicável: nenhum arquivo Terraform será alterado.

## 7. Aprovação

O pedido explícito do proprietário aprova a documentação local desta fundação.
Não autoriza implementação, commit, push, PR, merge, deploy ou alteração de
infraestrutura.

## 8. Verificação posterior

Não aplicável sem deploy. A revisão final deve confirmar diff documental, delta
US$ 0 e custo mensal esperado mantido em até US$ 0,38.
