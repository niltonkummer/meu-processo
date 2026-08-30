# Instruções obrigatórias do repositório

Antes de alterar código, leia integralmente:

1. `ENGINEERING_GUARDRAILS.md`
2. `PLANO_MVP_MEU_PROCESSO.md`

## Regras inegociáveis

- Antes de qualquer alteração, crie ou atualize em `docs/costs/` uma avaliação baseada em `docs/templates/infra-cost-assessment.md` e obtenha status `aprovado para implementação`; impacto zero também deve ser declarado.
- Antes dessa aprovação, a única alteração permitida é a própria avaliação de custo, sem mudança de runtime, dependência, dado ou infraestrutura.
- Trabalhe spec-first. Não implemente comportamento sem critérios de aceitação.
- Use TDD: crie um teste que falhe, implemente o mínimo e refatore.
- Mantenha 100% de cobertura de statements, branches, functions e lines no código de aplicação/domínio.
- Correções começam por teste de regressão.
- Não desative, ignore ou enfraqueça testes, scanners, CSP, autorização ou validação para fazer checks passarem.
- Não adicione segredos, tokens, dados pessoais ou respostas processuais reais ao repositório, fixtures, logs ou imagens.
- Não use produção em testes. APIs judiciais reais só podem ser usadas em smoke tests controlados e explicitamente autorizados.
- Toda infraestrutura é Terraform. Não altere recursos GCP manualmente, salvo bootstrap/incidente documentado e autorizado.
- Mudanças Terraform exigem diff Infracost. Novo SKU faturável, instância mínima, aumento de retenção, egress regional ou consumo sem limite exige aprovação explícita antes da implementação.
- Use Docker Compose e emuladores para desenvolvimento e testes locais.
- Use lockfile e instalação reproduzível com `npm ci` em CI.
- Justifique toda nova dependência e prefira biblioteca pequena, mantida e pinada.
- Frontend não contém segredo e não persiste token ou dado processual em Web Storage/service worker.
- Autorização é server-side/Rules, deny-by-default e testada entre tenants.
- Toda consulta, cache, fila e resposta é escopada por usuário/organização/processo.
- Não una processos por similaridade de nome. Homônimos ficam separados.
- Preserve fonte, identificador, hash e horário de coleta.
- Não faça deploy nem merge com check falhando.
- Não implemente enquanto o gate `Infra cost / Cost assessment` estiver ausente, pendente ou rejeitado.
- Não faça commit, push, merge ou deploy sem solicitação explícita do usuário.

## Antes de declarar conclusão

- Execute testes, cobertura, lint, typecheck e build relevantes.
- Execute scans de segredo, dependências, SAST, container e IaC aplicáveis.
- Verifique isolamento entre usuários e processos.
- Atualize documentação/ADR.
- Informe a avaliação aprovada, o custo atual, esperado e limite, inclusive quando todos forem zero.
- Informe exatamente o que foi verificado e qualquer limitação restante.

Exceções seguem o processo formal definido em `ENGINEERING_GUARDRAILS.md`; nunca use comentários de ignore sem responsável, justificativa e expiração.
