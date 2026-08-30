# Avaliação de custo 0002 — fundação multiusuário e experiência local

<!-- infra-cost-assessment:v1 -->

**Status:** aprovado para implementação
**Solicitado por:** proprietário do produto
**Responsável:** engenharia
**Data da avaliação:** 29 de agosto de 2026
**Ambientes afetados:** local e integração contínua
**Spec/issue:** Spec 0002, fases A e primeiro slice vertical da fase B

**Custo mensal atual (USD):** US$ 0 de impacto desta entrega
**Custo mensal esperado (USD):** US$ 0
**Custo mensal limite (USD):** US$ 0
**Aprovação:** solicitação explícita do proprietário para implementar a spec em 29 de agosto de 2026

## 1. Decisão

Implementar localmente a fundação multiusuário e o primeiro slice da experiência simples/avançada da Spec 0002:

- identidade, organização, papéis e autorização deny-by-default;
- modelo canônico de processo, fonte, evento, monitoramento e auditoria;
- repositório em memória substituível, usado somente em testes e validação local;
- contratos privados versionados sem remover a busca stateless da Spec 0001;
- modo simples e primeira visão avançada consumindo os mesmos fatos canônicos;
- testes cross-tenant, de contrato, regressão e interface.

Esta avaliação não autoriza Firebase/Firestore reais, buckets, Scheduler, Tasks, Jobs, e-mail, gateway de documentos, armazenamento persistente, deploy ou qualquer alteração Terraform. Essas capacidades exigirão avaliações próprias antes da implementação.

## 2. Alteração de infraestrutura

| Componente/SKU | Região | Estado atual | Estado proposto | Quantidade | Custo unitário | Delta mensal |
|---|---|---|---|---:|---:|---:|
| Google Cloud | `southamerica-east1` | serviço de validação existente | sem alteração | 0 | US$ 0 | US$ 0 |
| Banco/Storage | não aplicável | nenhum recurso novo | repositório somente em memória local | 0 | US$ 0 | US$ 0 |
| CI | GitHub-hosted | gates existentes | executar suíte ampliada nos mesmos jobs | dentro do limite atual | franquia/plano atual | US$ 0 esperado |

Não existe custo único de migração, backfill, recuperação ou egress nesta entrega.

## 3. Premissas e cenários

| Direcionador | Base atual | Esperado | Limite operacional | Unidade |
|---|---:|---:|---:|---|
| Requisições cloud adicionais | 0 | 0 | 0 | por mês |
| Processamento cloud adicional | 0 | 0 | 0 | vCPU-s/GiB-s |
| Armazenamento cloud adicional | 0 | 0 | 0 | GiB-mês |
| Operações de dados adicionais | 0 | 0 | 0 | operações/mês |
| Saída de rede adicional | 0 | 0 | 0 | GiB/mês |
| Logs cloud adicionais | 0 | 0 | 0 | GiB/mês |

Premissas:

- somente fixtures sintéticas e anonimizadas;
- nenhuma fonte judicial real em testes;
- nenhuma nova dependência será adicionada sem justificativa, revisão de licença e auditoria;
- o runtime publicado permanece inalterado;
- aumento de minutos de CI permanece dentro da franquia existente e do limite da avaliação 0001.

## 4. Custos não cobertos automaticamente

- Cloud Run: não aplicável, pois não haverá deploy.
- Firestore/Firebase Authentication: não aplicável, pois não serão provisionados nesta entrega.
- Cloud Storage e egress: não aplicável.
- Logs, filas, e-mail, APIs externas e IA: não aplicável.
- Infracost: não aplicável porque não haverá alteração Terraform.
- Impostos, câmbio e suporte: não aplicável a custo incremental zero.

## 5. Limites e condição de parada

- Qualquer necessidade de recurso cloud, alteração Terraform ou serviço externo interrompe esta entrega até nova avaliação aprovada.
- O servidor de produção não pode possuir autenticação falsa, bypass por header ou tenant padrão implícito.
- A busca stateless existente deve permanecer compatível enquanto a migração não estiver concluída.
- Teste cross-tenant, cobertura inferior a 100%, vulnerabilidade bloqueante ou divergência factual entre modos impede conclusão.
- Nenhum deploy é autorizado por esta avaliação.

## 6. Evidência e fontes

- [Spec 0002](../specs/0002-process-monitoring-functional-parity.md)
- [Engineering Guardrails](../../ENGINEERING_GUARDRAILS.md)
- [Avaliação 0001 — governança FinOps](./0001-infracost-governance.md)

Não há preço de SKU a consultar porque esta entrega não cria nem altera recurso faturável.

## 7. Aprovação

A solicitação explícita do proprietário para implementar a spec aprova somente o escopo local descrito nesta avaliação. Commit, push, merge, deploy e criação de infraestrutura continuam exigindo autorização ou avaliação própria conforme os guardrails.

## 8. Verificação posterior

Não se aplica verificação de 7/30 dias porque não há deploy. Se o escopo mudar, esta conclusão perde validade e uma nova avaliação deverá ser aprovada antes da alteração.
