# Implementação 0024 — painel persistido de acompanhamento

**Status:** implementada e validada localmente  
**Data:** 31 de agosto de 2026  
**Custo:** [0027](../costs/0027-local-activity-dashboard.md)  
**Spec:** [0020](../specs/0020-activity-dashboard.md)  
**Fundação:** [Implementação 0023](0023-canonical-case-timeline.md)

## Resultado

O frontend autenticado consome agora a caixa de alertas e a linha do tempo
persistidas. Cada cartão usa o `caseId` recebido do alerta para abrir o processo
e destaca somente o `caseEventId` que originou aquela descoberta. Nenhuma união
é feita por nome, CNJ, tribunal ou texto.

O modo simples apresenta perfil minimizado, CNJ, tribunal, data, estado e aviso
de correspondência não verificada. O modo avançado usa os mesmos objetos já
carregados e acrescenta IDs técnicos e procedência, sem nova requisição.

## Integridade do cliente

- envelopes, campos, IDs, datas, cursores e tamanhos são validados por allowlist;
- campos extras ou protegidos falham fechados;
- evento com `caseId` diferente do solicitado é rejeitado;
- resposta de leitura que altera processo, evento, perfil ou concessão é
  rejeitada antes de atualizar a tela;
- IDs repetidos na página ou entre páginas não são renderizados;
- troca rápida de alerta invalida a resposta tardia da seleção anterior;
- paginação preserva atualizações concorrentes, como a leitura de um alerta;
- logout desmonta o painel e remove imediatamente os fatos sensíveis da tela;
- nenhum alerta, evento, token, CNJ ou rótulo entra em Web Storage.

## UX e desempenho

- direção editorial sóbria alinhada ao produto: tinta azul, papel claro, verde
  institucional e filete dourado na linha do tempo;
- estados “Novo”, “Lido” e “Origem do alerta” têm texto, não apenas cor;
- headings semânticos, `aria-live`, atalho para o conteúdo principal e foco
  visível;
- botões têm pelo menos 44 px, não existe overflow horizontal em 390 px e IDs
  recebem `translate="no"`;
- listas usam `content-visibility`, datas usam `Intl.DateTimeFormat` e não há
  nova dependência de UI;
- perfis e alertas iniciam carregamento independentemente após autenticação;
- contagem de não lidos é derivada durante render, sem estado redundante.

Essas decisões foram orientadas pelas práticas de frontend de produção e React:
componentes estáveis no nível de módulo, ausência de waterfalls independentes,
estado derivado durante render, condicionais explícitas e bundle sem biblioteca
adicional.

## Evidência de validação

- ciclo TDD comprovado para cliente, componente e integração no App;
- 576 testes em 51 arquivos;
- 100% de statements, branches, functions e lines no escopo monitorado;
- 167 asserts pgTAP em 7 arquivos e 24 contratos PostgreSQL em 6 arquivos;
- troca rápida de processo, leitura exata, timeline exata, paginação e
  duplicidade cross-page cobertas;
- revisão renderizada nos modos simples/avançado e viewport de 390 × 844;
- alvos de toque de 44 px e largura móvel sem overflow horizontal;
- build de produção: JS principal 71,54 KiB gzip e CSS 5,44 KiB gzip;
- restore lógico, worker/dispatcher one-shot, Compose, Actionlint, ShellCheck,
  Terraform, Checkov, Hadolint e diff check aprovados;
- scan de segredos sem achados e imagem final com zero vulnerabilidades
  HIGH/CRITICAL corrigíveis;
- auditoria sem high/critical; permanecem nove findings moderados transitivos já
  conhecidos na cadeia das ferramentas Firebase;
- nenhum serviço externo acessado e custo incremental de fornecedor igual a
  zero.

## Próximo gate

Gate concluído em [Implementação 0025](0025-persisted-portfolio-dashboard.md): a
carteira persistida tornou-se a superfície principal, com seleção compartilhada
e estados vazios distintos. Documentos em lote, e-mail e fontes reais continuam
fora até seus gates próprios.
