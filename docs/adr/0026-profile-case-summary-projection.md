# ADR 0026 — projeção de resumo de processos por perfil

**Status:** aceito
**Data:** 31 de agosto de 2026
**Custo:** [Avaliação 0043](../costs/0043-search-result-aggregation-and-publication-recovery.md)

## Contexto

Perfis monitorados, alvos e processos existem no modelo, mas `tenant_cases`
representa a carteira inteira do tenant e não identifica qual pessoa originou
cada descoberta. Relacionar um processo a um perfil por igualdade ou
similaridade de nome criaria risco de homônimos e vazamento lógico.

O pipeline já produz alertas com `tenant_id`, `subject_id`, `case_id`, CNJ,
tribunal e instante da ocorrência. Esse vínculo é derivado da execução concreta
do alvo e da evidência oficial que projetou o caso.

## Decisão

A listagem de perfis usará `alerts` como projeção explícita de vínculo entre
perfil e processo. A consulta agrupa casos distintos por `subject_id`, retorna a
contagem total e limita o resumo aos três casos com atividade mais recente.

A paginação de perfis continuará por cursor. A agregação será feita em lote na
mesma consulta da página, com filtro explícito de tenant e RLS forçada. Nenhuma
consulta externa será iniciada para montar a lista.

Resultados de buscas manuais ainda não projetados pelo worker poderão aparecer
imediatamente em uma lista efêmera da sessão do navegador, identificada pelo ID
exato da busca e nunca persistida em Web Storage.

## Alternativas rejeitadas

- **Relacionar por nome/trecho:** inseguro para homônimos e proibido pelos
  guardrails.
- **Usar todos os `tenant_cases`:** atribuiria a carteira inteira a cada perfil.
- **Criar tabela de resumo ou cache agora:** adiciona consistência e manutenção
  sem necessidade medida.
- **Fazer uma consulta por perfil:** cria N+1 e piora proporcionalmente ao número
  de perfis.
- **Persistir o histórico no navegador:** expõe dados processuais fora do
  backend e viola a política de armazenamento local.

## Consequências

- A contagem persistente aparece depois que o pipeline projeta o alerta.
- A lista imediata da sessão cobre a latência entre busca manual e projeção.
- Casos sem vínculo explícito não aparecem no perfil, mesmo que o nome seja
  semelhante; isso é uma falha segura intencional.
- O desempenho precisa ser acompanhado quando o volume de alertas crescer. Um
  índice ou projeção materializada só será introduzido com medição e nova
  avaliação de custo.
