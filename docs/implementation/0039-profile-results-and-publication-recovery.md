# Implementação 0039 — resultados por perfil e recuperação de publicação

**Status:** implementada e verificada localmente; rollout não iniciado
**Data:** 31 de agosto de 2026
**Spec:** [0034](../specs/0034-profile-results-and-publication-recovery.md)
**ADR:** [0026](../adr/0026-profile-case-summary-projection.md)
**Custo:** [0043](../costs/0043-search-result-aggregation-and-publication-recovery.md)

## Resultado

- cada perfil monitorado retorna a quantidade de processos explicitamente
  vinculados e um resumo dos três processos com atividade mais recente;
- a agregação ocorre em uma única consulta tenant-scoped, sem N+1, busca
  judicial adicional, associação por similaridade de nome ou novo cache;
- a busca manual mantém, apenas durante a sessão do navegador, uma lista de até
  vinte resultados identificados pelo ID exato da consulta;
- o painel apresenta nome, quantidade, CNJ e tribunal em listas compactas,
  preservando a separação entre perfis e processos;
- o fluxo de publicação informa o estado atual da operação, rejeita resposta
  vazia e aguarda mais tempo pela resposta da fonte oficial;
- a descoberta de CAPTCHA distingue imagem, canvas e superfície `data-url` de
  controles de áudio, enviando a resposta humana no mesmo contexto efêmero;
- o renderer registra somente correlação aleatória, resultado categórico e
  duração, sem nome, CPF/CNPJ, CNJ, URL, CAPTCHA ou conteúdo documental.

## Persistência e segurança

A função `app_private.list_monitored_subject_summaries` valida usuário, tenant e
limite de página, confirma a associação ativa ao tenant e agrega somente
`alerts` ligados explicitamente ao perfil e ao processo. Apenas `app_runtime`
pode executá-la. A função retorna no máximo três resumos, mas mantém a contagem
distinta total.

O histórico de busca imediata não usa `localStorage`, `sessionStorage` ou outro
armazenamento persistente do navegador. Ele é descartado no logout e não mistura
um resultado novo com uma consulta anterior que falhou.

## Evidências

- 89 arquivos de teste e 1.161 testes aprovados;
- cobertura de 100% em statements, branches, functions e lines;
- 292 asserções pgTAP e 39 testes de contrato do banco aprovados em PostgreSQL
  descartável;
- lint, typecheck, contrato OpenAPI, build web e build das imagens aprovados;
- auditoria de dependências sem finding High/Critical; nove findings moderados
  permanecem em dependências transitivas do Firebase;
- varredura do repositório sem segredo detectado;
- imagens da aplicação e do renderer sem vulnerabilidade High/Critical;
- revisão visual local da tela pública concluída; o estado autenticado está
  coberto por testes de interface, sem uso de credenciais do proprietário.

## Limites conhecidos e liberação

- CAPTCHA continua sendo resolvido pelo usuário; a implementação não contorna,
  terceiriza nem automatiza o desafio;
- disponibilidade, HTML e tempo de resposta do TJRS permanecem externos. O
  aumento de espera reduz falso timeout, mas não garante documento quando a
  fonte não responde;
- a contagem persistente aparece depois que o worker projeta o alerta. O resumo
  da consulta manual cobre apenas a sessão atual até essa projeção;
- ainda é necessário um smoke autenticado contra a fonte real no ambiente
  brasileiro para comprovar o percurso completo CAPTCHA → PDF → Storage;
- nenhuma cobrança, commit, push, merge, apply ou publicação em nuvem foi feita;
- o rollout pode avançar no ambiente de validação enquanto a projeção total
  permanecer abaixo de US$ 10/mês, respeitando os limites da avaliação 0043.
