# Implementação 0041 — cópia PDF da publicação DJEN

**Status:** publicado e validado em `validation`; merge não realizado
**Data:** 31 de agosto de 2026
**Spec:** [0035](../specs/0035-djen-publication-copy.md)
**ADR:** [0027](../adr/0027-djen-copy-first-download.md)
**Custo:** [0045](../costs/0045-djen-publication-copy.md)

## Resultado

O download principal deixa de depender do eproc e do CAPTCHA. Para publicações
com número de comunicação, o backend relê o registro no DJEN, valida CNJ e
comunicação exatos e produz uma cópia PDF autenticada. O original continua
disponível em ação separada, explicitamente experimental.

## Controles implementados

- rota autenticada
  `GET /api/v1/processes/{cnj}/communications/{communication}/publication-copy`;
- releitura server-side da comunicação, sem aceitar texto enviado pelo cliente;
- identidade exata de CNJ e comunicação, sem associação por nome;
- conversão de HTML e entidades para texto inerte;
- limites de metadados, texto e PDF com falha fechada;
- identificação visual permanente como reprodução do DJEN;
- `private, no-store`, download forçado e SHA-256;
- validação de tipo, tamanho, assinatura `%PDF-` e hash também no navegador;
- rate limit compartilhado com downloads de documentos;
- contrato OpenAPI versionado e interface separando cópia e original.

## Evidências locais

- 93 arquivos de teste e 1.195 testes aprovados;
- cobertura de 100% em instruções, ramificações, funções e linhas;
- lint, TypeScript, build e validação OpenAPI aprovados;
- auditoria sem vulnerabilidades High ou Critical; nove findings Moderate já
  conhecidos permanecem transitivos nas ferramentas Firebase;
- PDF A4 com 10 páginas renderizado e inspecionado visualmente;
- metadados, paginação, acentuação, aviso de reprodução e quebra de página
  confirmados; nenhum JavaScript incorporado;
- nenhuma tentativa de OCR, solver ou bypass de CAPTCHA.

## Limites desta entrega

A cópia é gerada sob demanda em memória e entregue diretamente ao navegador.
Ela não é documento original, certidão ou cópia assinada. A materialização em
GCS/PostgreSQL permanece uma evolução independente; o contrato criado permite
adicioná-la sem alterar a autorização nem a identidade da publicação.

## Evidências de rollout

- commit de aplicação `cd968c4`, na
  [PR 14](https://github.com/niltonkummer/meu-processo/pull/14);
- deploy OIDC aprovado no
  [workflow 33443672396](https://github.com/niltonkummer/meu-processo/actions/runs/33443672396);
- revisão pública `meu-processo-mvp-00035-f47` com 100% do tráfego e imagem
  imutável correspondente ao commit;
- renderer privado preservado na revisão
  `meu-processo-browser-renderer-00007-j6g`;
- saúde pública respondeu `200` após o rollout;
- smoke autenticado real encontrou 3 processos e 16 publicações agrupadas;
- cópia da comunicação `37884` respondeu `200`, 2.976 bytes e 0,462 s, passou
  pela validação de integridade do navegador e concluiu sem CAPTCHA;
- nenhuma chamada ao renderer ocorreu durante o download da cópia; a atividade
  mais recente dele antecedia o teste e correspondia ao próprio rollout;
- a conta sintética foi desconectada, removida do Identity Platform e a busca
  posterior confirmou zero registros remanescentes;
- a `main` não foi alterada e o rollback continua disponível pela revisão
  imutável anterior.
