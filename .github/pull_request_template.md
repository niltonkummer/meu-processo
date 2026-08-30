## Objetivo

Descreva o problema, o resultado esperado e o que não faz parte desta alteração.

## Critérios de aceitação

- [ ] Critérios observáveis definidos e atendidos
- [ ] Estados de sucesso, erro, vazio e resposta parcial considerados

## TDD e qualidade

- [ ] Teste foi criado e falhou antes da implementação
- [ ] Cobertura permanece em 100% para statements, branches, functions e lines
- [ ] Testes unitários, integração, isolamento e E2E relevantes passam
- [ ] Lint, typecheck e build passam

## Segurança e privacidade

- [ ] Autorização server-side/Rules verificada
- [ ] Teste cross-tenant incluído ou comprovadamente não aplicável
- [ ] Nenhum segredo ou dado pessoal foi adicionado
- [ ] Entradas e URLs externas são validadas
- [ ] Logs não expõem dados processuais ou identificadores pessoais
- [ ] Scans de segredo, SAST, dependências, container e IaC passam

## Infraestrutura e operação

- [ ] Criei/atualizei uma avaliação em `docs/costs/` antes da implementação
- [ ] A avaliação está `aprovado para implementação` e informa custo atual, esperado e limite em USD
- [ ] Custos não cobertos pelo Terraform (uso, egress, logs, terceiros e IA) foram calculados ou marcados como não aplicáveis com justificativa
- [ ] Mudanças de cloud estão em Terraform
- [ ] Plano Terraform revisado, se aplicável
- [ ] Diff Infracost revisado, se aplicável
- [ ] Budget, quotas, condição de parada e verificação em 7/30 dias foram definidos
- [ ] Observabilidade/runbook atualizados
- [ ] Rollout e rollback definidos

## Dados processuais

- [ ] Processo, tribunal, fonte e horário permanecem vinculados
- [ ] Não há risco de misturar usuários, escritórios, homônimos ou processos
- [ ] Dados gerados/normalizados são distinguíveis da fonte oficial

## Evidências

Inclua resultados dos testes, screenshots sem dados pessoais e links para ADR/spec quando aplicável.

**Avaliação de custo:** `docs/costs/NNNN-titulo.md`
**Custo atual / esperado / limite (USD):** `— / — / —`
**Aprovado por e em:** `—`
