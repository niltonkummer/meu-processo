# Avaliação de custo 0046 — resultados gratuitos antes do painel comercial

<!-- infra-cost-assessment:v1 -->

**Status:** aprovado para implementação e rollout de validação
**Solicitado por:** proprietário do produto
**Responsável:** engenharia do Meu Processo
**Data da avaliação:** 1 de setembro de 2026
**Ambientes afetados:** local e `validation` no projeto `meu-processo-507018`
**Spec/issue:** correção de regressão da [Spec 0033](../specs/0033-commercial-mvp-billing-and-discovery.md)

**Custo mensal atual (USD):** até US$ 1,71 fixo; US$ 2,30 operacional
**Custo mensal esperado (USD):** inalterado; até US$ 1,71 fixo e US$ 2,30 operacional
**Custo mensal limite (USD):** US$ 10,00 de segurança
**Aprovação:** autorização permanente do proprietário para avançar abaixo de
US$ 10/mês, registrada antes desta avaliação; impacto desta correção: US$ 0

## 1. Decisão

Corrigir a ordem visual do painel para que uma consulta autenticada por nome
mostre imediatamente o histórico e os processos encontrados. O bloco comercial
continua disponível, mas não pode anteceder, ocultar ou condicionar o resultado
gratuito. A mudança é somente de composição React e testes; o impacto de
infraestrutura, runtime, dados, dependências e consumo externo é zero.

## 2. Alteração de infraestrutura

| Componente/SKU | Região | Estado atual | Estado proposto | Quantidade | Custo unitário | Delta mensal |
|---|---|---|---|---:|---:|---:|
| Cloud Run API/frontend | `southamerica-east1` | escala a zero existente | mesma revisão lógica, sem recurso novo | 1 | inalterado | US$ 0 |
| PostgreSQL/Supabase | existente | nenhuma consulta adicional | inalterado | — | inalterado | US$ 0 |
| Stripe test mode | externo | painel informativo existente | mesma quantidade de chamadas | — | US$ 0 | US$ 0 |

Não há custo único de migração, backfill, recuperação ou saída de dados.

## 3. Premissas e cenários

| Direcionador | Base atual | Esperado | Limite operacional | Unidade |
|---|---:|---:|---:|---|
| Requisições de busca | 1 por ação | 1 por ação | limite HTTP existente | requisições |
| Requisições de billing | 1 ao autenticar | 1 ao autenticar | contrato existente | requisições |
| Processamento | renderização atual | mesma renderização | escala a zero existente | vCPU-s/GiB-s |
| Armazenamento | inalterado | inalterado | lifecycle existente | GiB-mês |
| Saída de rede | resposta atual | mesma resposta | limites existentes | GiB/mês |
| Logs | inalterado | inalterado | retenção existente | GiB/mês |

O cenário atual, esperado e o pior cenário plausível têm o mesmo consumo: a
árvore de componentes já é renderizada; apenas sua ordem será corrigida.

## 4. Custos não cobertos automaticamente

- Cloud Run, Storage, logs e egress: nenhuma operação ou byte adicional;
- banco, filas, e-mail, APIs judiciais e IA: não participam da correção;
- Stripe: nenhuma sessão de Checkout é criada automaticamente;
- impostos e câmbio: não aplicáveis ao delta de US$ 0;
- Infracost: não aplicável porque não haverá diff Terraform.

## 5. Limites e condição de parada

- nenhum SKU, instância mínima, retenção, egress regional ou dependência nova;
- resultados continuam privados, `no-store` e escopados pela sessão;
- pagamento não concede nem remove acesso à consulta básica;
- rollback: restaurar somente a ordem anterior dos componentes React;
- bloquear rollout se a busca passar a depender de entitlement, se os
  resultados continuarem abaixo do bloco comercial ou se qualquer gate falhar;
- validade desta avaliação: até 30 de setembro de 2026 ou mudança de escopo.

## 6. Evidência e fontes

- [avaliação 0045](./0045-djen-publication-copy.md), baseline operacional vigente;
- [Spec 0033](../specs/0033-commercial-mvp-billing-and-discovery.md), regra de
  que consulta e histórico próprio não dependem de pagamento;
- diff esperado sem arquivo Terraform e sem dependência nova;
- preços unitários não são recalculados porque o consumo e os recursos não
  mudam; o delta reproduzível é US$ 0.

## 7. Aprovação

**Aprovado para implementação e rollout de validação.** A autorização permanente
do proprietário permite avançar sem nova pergunta quando o custo permanece
abaixo de US$ 10/mês. Em 1 de setembro de 2026, o proprietário autorizou
explicitamente commit, push e deploy desta correção em `validation`. Merge não
faz parte desta autorização.

## 8. Verificação posterior

| Data | Custo estimado | Custo real | Variação | Explicação | Ação |
|---|---:|---:|---:|---|---|
| 1 de setembro de 2026 | US$ 0 de delta | pendente | — | verificar apenas se houver deploy | nenhuma neste momento |
