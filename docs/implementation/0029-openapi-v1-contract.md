# Implementação 0029 — contrato OpenAPI v1 e gate de compatibilidade

**Status:** implementada e validada localmente  
**Data:** 31 de agosto de 2026  
**Spec:** [Spec 0025](../specs/0025-openapi-v1-contract.md)  
**Custo aprovado:** [Avaliação 0032](../costs/0032-local-openapi-v1-contract.md), delta US$ 0

## 1. Entregas

- documento `api/openapi.v1.json` em OpenAPI 3.1;
- validador estrutural offline com referências exclusivamente locais;
- comparador conservador de compatibilidade v1;
- testes TDD do validador, comparador e inventário de operações;
- comandos npm para validação e comparação;
- gate no job de qualidade da CI, sem credencial e sem rede;
- atualização do progresso de FND-011 após evidência verde.

## 2. Sequência Red → Green → Refactor

1. criar testes de validação e compatibilidade que falham sem implementação;
2. implementar o modelo mínimo e diagnósticos determinísticos;
3. criar o documento real e validar todas as operações;
4. adicionar teste de inventário contra as rotas existentes;
5. integrar os comandos à CI e exercitar baseline ausente/presente;
6. executar a suíte completa e scanners aplicáveis;
7. registrar resultados e limitações neste documento.

## 3. Rollout e rollback

O rollout ocorre somente na revisão/CI. A primeira execução aceita apenas a
ausência comprovada do arquivo na branch-base; as seguintes comparam a baseline.
Não há deploy ou alteração de runtime.

Rollback: reverter, na mesma mudança, o arquivo OpenAPI, o código/testes do gate,
os scripts npm e o step da CI. Nunca manter um contrato que não corresponda ao
servidor nem remover apenas o bloqueio de compatibilidade.

## 4. Evidências

- testes: 66 arquivos e 821 testes aprovados;
- cobertura do núcleo: 100% de statements (1471/1471), branches (1147/1147),
  functions (300/300) e lines (1346/1346);
- contrato real: JSON válido, OpenAPI 3.1 offline e 15 operações autenticadas;
- gate: 26 testes aprovados, incluindo rota, método,
  `operationId`, bearer, parâmetros, body, media type, respostas, propriedades,
  required, enum, const, tipo, formato, limites e schema recursivo;
- comandos `openapi:validate` e `openapi:compare` aprovados;
- lint, typecheck, build, `git diff --check` e Actionlint aprovados;
- `npm audit --audit-level=high`: aprovado; permanecem nove vulnerabilidades
  moderadas transitivas já conhecidas em tooling Firebase, sem dependência nova;
- Trivy secret scan: nenhum segredo encontrado;
- Terraform, container e banco: não alterados por esta fatia;
- custo real local: US$ 0; nenhum recurso ou chamada de produto em cloud.

## 5. Limitações remanescentes

- OpenAPI não descreve as mensagens do WebSocket assistido;
- a validação de DTO em runtime permanece responsabilidade dos handlers e
  testes atuais;
- geração de SDK, documentação interativa e publicação do contrato permanecem
  fora do escopo e exigem avaliação própria.
