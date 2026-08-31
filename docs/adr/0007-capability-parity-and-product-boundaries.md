# ADR 0007 — equivalência funcional com limites de produto e conteúdo

**Status:** aceito
**Data:** 30 de agosto de 2026
**Relacionado:** [Spec 0008](../specs/0008-jusbrasil-functional-landscape.md)

## Contexto

O levantamento do Jusbrasil revelou produtos de acompanhamento, pesquisa
jurídica, IA, comunidade, diretório profissional e soluções corporativas. Tentar
reproduzir tudo como uma única entrega confundiria a tese do MVP, criaria risco
de cópia de conteúdo/interface e tornaria acervo licenciado uma dependência do
monitoramento pessoal.

## Decisão

Buscaremos equivalência de resultado e fluxo, com marca, UX, código, modelo de
dados e base próprios. A plataforma será modular e entregue nesta ordem:

1. acompanhamento pessoal;
2. operação profissional;
3. pesquisa e IA baseadas em corpus próprio/licenciado;
4. API e soluções corporativas;
5. comunidade/diretório somente se houver tese específica.

O núcleo não depende de doutrina, modelos, peças, artigos, notícias ou perfis
públicos. Conteúdo protegido só entra mediante autoria própria, domínio público
ou licença compatível. Scraping massivo de superfície autenticada não será usado
para recriar acervo proprietário.

## Consequências

- O MVP permanece centrado em confiabilidade, não em volume aparente de acervo.
- Pesquisa, IA e marketplace podem evoluir sem contaminar a verdade processual.
- Algumas funcionalidades do mercado ficam explicitamente adiadas ou excluídas.
- Marketing não pode prometer “mesma base” ou cobertura equivalente sem medição.
- Cada módulo exige spec, custo, fonte e revisão jurídica próprios.

## Alternativas consideradas

- **Clone integral do produto:** rejeitado por risco jurídico, operacional e de
  foco, além de depender de conteúdo que não possuímos.
- **Começar pela pesquisa jurídica:** rejeitado porque requer corpus/indexação e
  não resolve primeiro a necessidade já validada de acompanhar processos.
- **Um produto separado por persona:** rejeitado; modos simples e avançado devem
  compartilhar a mesma verdade e autorização, conforme ADR 0002.

## Revisão

Revisar quando dados de uso mostrarem que pesquisa, IA ou conteúdo são o
principal valor, ou quando uma licença alterar materialmente o custo e a
viabilidade do corpus.
