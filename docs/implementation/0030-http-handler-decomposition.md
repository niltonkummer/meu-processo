# Implementação 0030 — decomposição dos handlers HTTP v1

**Status:** implementada e validada localmente  
**Data:** 31 de agosto de 2026  
**Spec:** [Spec 0026](../specs/0026-http-handler-decomposition.md)  
**Custo aprovado:** [Avaliação 0033](../costs/0033-local-http-handler-decomposition.md), delta US$ 0

## 1. Sequência

1. fixar o guardrail arquitetural em teste vermelho;
2. extrair contratos de dependência e transporte seguro;
3. extrair sessão, busca, perfis e alertas;
4. extrair processos/documentos e publicações;
5. reduzir o servidor à composição, estáticos, health e WebSocket;
6. validar OpenAPI sem diff e executar todos os gates.

## 2. Resultado esperado

- cada capability evolui sem editar o roteador inteiro;
- autenticação, tenant, headers e erro seguro têm uma implementação
  compartilhada;
- precedência de rotas permanece explícita;
- nenhuma mudança de runtime, contrato ou custo.

## 3. Evidências

- `src/http/server.ts`: reduzido de 1.567 para 99 linhas;
- transporte seguro compartilhado e seis handlers por capability;
- upgrade WebSocket isolado em módulo próprio, sem alteração de protocolo;
- guardrail arquitetural: três testes verificam módulos, limite do servidor,
  ausência de imports de application/domain/infrastructure no servidor raiz e
  ordem estável dos handlers;
- HTTP/WebSocket/arquitetura focados: 47 testes aprovados;
- suíte completa: 67 arquivos e 824 testes aprovados;
- cobertura do núcleo: 100% de statements (1471/1471), branches (1147/1147),
  functions (300/300) e lines (1346/1346);
- OpenAPI: 15 operações válidas e comparação local sem incompatibilidade;
- lint, typecheck, build, Actionlint e `git diff --check`: aprovados;
- `npm audit --audit-level=high`: aprovado; nove vulnerabilidades moderadas
  transitivas já conhecidas no tooling Firebase, sem dependência nova;
- imagem distroless de produção construída; Trivy encontrou zero
  vulnerabilidades High/Critical;
- Trivy secret scan: nenhum segredo encontrado;
- banco, Terraform, frontend, dependências e cloud: inalterados;
- custo real local: US$ 0.

## 4. Limitações remanescentes

- os módulos ainda usam a organização global por camadas; a migração para
  diretórios completos por capability continua incremental;
- erros específicos de adapters já existentes permanecem mapeados no handler de
  publicação até uma spec própria de fronteira de aplicação;
- WebSocket continua sem contrato AsyncAPI de mensagens; o listener de upgrade
  já está isolado do roteador raiz, mas o protocolo público futuro exige spec
  própria.
