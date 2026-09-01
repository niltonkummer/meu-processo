# ADR 0010 — IA opcional, isolada por caso e fundamentada em evidências

**Status:** aceito como guardrail; IA permanece fora do MVP
**Data:** 30 de agosto de 2026
**Relacionado:** [Spec 0008](../specs/0008-jusbrasil-functional-landscape.md)

## Contexto

Assistentes jurídicos oferecem resumo de autos, pesquisa, rascunho de peças e
teses. No produto em questão, uma resposta que misture processos, invente fonte
ou oculte incerteza pode causar dano maior que uma indisponibilidade. O custo de
modelo e corpus também é variável, e o núcleo ainda precisa provar coleta e
proveniência sem IA.

## Decisão

IA generativa não faz parte do MVP fundamental. Quando introduzida, será uma
camada derivada e opcional sobre o modelo canônico, com estes limites:

- contexto criado no servidor para exatamente um tenant e caso;
- somente fontes e documentos que o usuário já pode acessar;
- recuperação mantém `sourceId`, trecho, página/posição e data;
- afirmações materiais exigem citações navegáveis;
- falta de evidência gera recusa ou ressalva explícita;
- conteúdo externo é tratado como dado, nunca instrução confiável;
- saída mostra que é gerada, modelo/versão e necessidade de revisão humana;
- nenhuma peça é protocolada e nenhum prazo/decisão adversa é automatizado;
- prompts, documentos ou conversas de um cliente não treinam nem aparecem para
  outro cliente;
- cache inclui tenant, caso, conjunto de evidências e versão do modelo/política.

Cada habilidade terá conjunto de avaliação próprio. Release de IA compara
candidato com baseline em groundedness, cobertura de citações, mistura de casos,
injeção de prompt, utilidade jurídica e custo. Regressão crítica bloqueia a
entrega.

## Consequências

- O produto primeiro demonstra uma verdade verificável sem depender de modelo.
- Resumos repetidos podem ser cacheados de forma segura e mensurável.
- Rascunhos e pesquisa avançada chegam mais tarde que explicações simples.
- A experiência precisa expor evidência e incerteza, ocupando mais espaço que um
  chat genérico.
- O provedor de modelo e a arquitetura RAG só serão escolhidos após custo,
  privacidade, região e avaliação.

## Alternativas consideradas

- **Chat genérico sobre toda a base:** rejeitado por mistura de contexto e baixa
  verificabilidade.
- **Gerar sem citações:** rejeitado para domínio jurídico.
- **Enviar diretamente tudo ao provedor:** rejeitado por minimização, custo e
  isolamento.
- **IA como fonte canônica:** rejeitado; fatos continuam ligados à fonte oficial.
- **Escolher um provedor agora:** adiado até requisitos e benchmark existirem.

## Revisão

Revisar após o MVP confiável, um corpus citável e um conjunto de avaliação
aceito, ou se nova obrigação legal/regulatória exigir controles adicionais.
