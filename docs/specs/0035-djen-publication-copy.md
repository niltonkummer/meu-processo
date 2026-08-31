# Spec 0035 — cópia PDF da publicação DJEN

**Status:** aprovada para implementação em `validation`
**Data:** 31 de agosto de 2026
**ADR:** [0027](../adr/0027-djen-copy-first-download.md)
**Custo:** [0045](../costs/0045-djen-publication-copy.md)

## Problema

O link de uma comunicação do DJEN pode abrir o eproc e exigir CAPTCHA. Mesmo
após a resposta humana, o tribunal pode não produzir um PDF observável pelo
renderer. O painel não pode apresentar esse caminho instável como a única forma
de baixar uma publicação que já possui texto oficial no DJEN.

## Resultado funcional

Para toda publicação com número de comunicação, o painel deve oferecer
`Baixar cópia da publicação` como ação principal. A API reencontra a comunicação
na fonte oficial, exige correspondência exata de CNJ e comunicação e gera um PDF
com:

- identificação visual `Reprodução de publicação oficial — DJEN`;
- CNJ, tribunal, comunicação, data, órgão, classe, tipo e meio disponíveis;
- conteúdo integral de `texto`, decodificado e sem marcação HTML executável;
- data de geração, paginação e aviso de que a reprodução não substitui o
  documento original do tribunal;
- nome seguro, SHA-256, `private, no-store` e download autenticado.

A ação `Tentar documento original` permanece separada e marcada como
experimental quando houver link HTTPS. Ela pode solicitar CAPTCHA, mas sua
falha não bloqueia a cópia DJEN.

## Regras de segurança e precisão

- autenticação Firebase e rate limit são obrigatórios;
- o backend nunca aceita texto, CNJ ou metadados enviados pelo navegador;
- a comunicação é relida no DJEN e validada por CNJ e número exatos;
- nenhuma associação por nome, similaridade ou estado visual é permitida;
- HTML é convertido para texto inerte antes de entrar no PDF;
- campos e conteúdo possuem limites explícitos; excesso falha fechado sem
  truncar silenciosamente a publicação;
- o PDF não é chamado de original, certidão ou documento assinado;
- CAPTCHA não é resolvido, reconhecido, terceirizado nem contornado.

## Critérios de aceite

1. cópia válida baixa sem acessar o eproc ou iniciar renderer;
2. CNJ/comunicação divergentes retornam `404` e não geram arquivo;
3. requisição sem autenticação retorna `401`; excesso retorna `429`;
4. PDF começa com `%PDF-`, tem SHA-256 verificável e texto recuperável;
5. entidades HTML e tags não aparecem codificadas nem executáveis;
6. interface diferencia inequivocamente cópia DJEN e original experimental;
7. cobertura permanece em 100% e o PDF de referência passa por renderização
   visual e extração de texto.
