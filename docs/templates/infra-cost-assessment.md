# Avaliação de custo NNNN — título da mudança

<!-- infra-cost-assessment:v1 -->

**Status:** rascunho | em revisão | aprovado para implementação | rejeitado
**Solicitado por:** pessoa ou papel
**Responsável:** pessoa ou equipe
**Data da avaliação:** DD de mês de AAAA
**Ambientes afetados:** local | development | staging | production
**Spec/issue:** link ou identificador

**Custo mensal atual (USD):** valor ou fórmula
**Custo mensal esperado (USD):** valor ou fórmula
**Custo mensal limite (USD):** valor ou fórmula
**Aprovação:** responsável, decisão e data

## 1. Decisão

Explique o que será alterado, por que a mudança é necessária e qual escopo esta avaliação autoriza. Declare expressamente quando o impacto de infraestrutura for zero.

## 2. Alteração de infraestrutura

| Componente/SKU | Região | Estado atual | Estado proposto | Quantidade | Custo unitário | Delta mensal |
|---|---|---|---|---:|---:|---:|
| Exemplo | `southamerica-east1` | — | — | — | US$ — | US$ — |

Inclua custos únicos de migração, backfill, recuperação ou saída de dados em tabela separada quando existirem.

## 3. Premissas e cenários

Registre a data de acesso de cada preço, moeda, impostos excluídos ou incluídos, franquias, câmbio utilizado e todas as premissas de volume.

| Direcionador | Base atual | Esperado | Limite operacional | Unidade |
|---|---:|---:|---:|---|
| Requisições | — | — | — | por mês |
| Processamento | — | — | — | vCPU-s/GiB-s |
| Armazenamento | — | — | — | GiB-mês |
| Operações de dados | — | — | — | operações/mês |
| Saída de rede | — | — | — | GiB/mês e destino |
| Logs | — | — | — | GiB/mês e retenção |

Calcule pelo menos:

- cenário atual/base;
- cenário esperado para os próximos 30 dias;
- limite operacional ou pior cenário plausível antes de quotas e controles interromperem o crescimento.

## 4. Custos não cobertos automaticamente

Liste explicitamente os custos que o Infracost não representa ou que dependem de uso: Cloud Run, Firestore, Storage, egress, logs, filas, e-mail, APIs de terceiros, IA, suporte e impostos. Escreva “não aplicável” somente após revisar cada categoria relevante.

## 5. Limites e condição de parada

Defina:

- budget e alertas;
- quotas, limites de concorrência, tamanho, retenção e taxa;
- condição que bloqueia rollout ou aciona rollback;
- pessoa autorizada a aceitar aumento;
- prazo de validade da estimativa.

Sem aprovação explícita, é proibido introduzir novo SKU faturável, instância mínima, retenção maior, egress entre regiões, consumo ilimitado ou aumento mensal maior que US$ 5 ou 20% sobre a base, prevalecendo o menor limite.

## 6. Evidência e fontes

- URL oficial de preço — acessada em DD/MM/AAAA;
- saída Infracost ou justificativa de não aplicabilidade;
- planilha/cálculo reproduzível, sem segredos ou dados pessoais;
- limitações conhecidas da estimativa.

## 7. Aprovação

Registre nome/papel, decisão, data e condições. Somente `aprovado para implementação` libera o início da mudança. Aprovação de custo não autoriza commit, deploy ou acesso adicional.

## 8. Verificação posterior

Preencher 7 e 30 dias após o deploy:

| Data | Custo estimado | Custo real | Variação | Explicação | Ação |
|---|---:|---:|---:|---|---|
| — | — | — | — | — | — |
