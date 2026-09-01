# ADR 0008 — fontes oficiais, proveniência e vínculo sem inferência

**Status:** aceito
**Data:** 30 de agosto de 2026
**Relacionado:** [Spec 0008](../specs/0008-jusbrasil-functional-landscape.md)

## Contexto

Consulta por CNJ, nome, CPF, CNPJ e OAB possui semânticas diferentes. Algumas
fontes permitem filtro exato; outras apenas encontram texto. Tratar todos os
resultados como identidade confirmada criaria falsos positivos, misturaria
homônimos e transformaria ausência de resposta em afirmação incorreta.

Também haverá divergência legítima entre fontes, campos normalizados e futuras
interpretações por classificadores ou IA.

## Decisão

Todo conector produz um envelope imutável de evidência contendo fonte,
identificador externo, horário de origem quando disponível, `collectedAt`, hash
do conteúdo e versão do parser. A partir dele são criados fatos normalizados
versionados; explicações e classificações são derivações separadas.

Identidade de processo usa o número CNJ normalizado. Sem CNJ, o registro é
provisório e usa chave composta de fonte, tribunal e identificador externo.

Vínculos terão estado e método explícitos:

- `candidate`: encontrado por nome ou correspondência não conclusiva;
- `confirmed_by_source`: a fonte entrega vínculo determinístico;
- `confirmed_by_user`: o usuário confirmou o processo candidato;
- `rejected`: candidato rejeitado;
- `revoked`: vínculo antes confirmado foi removido ou invalidado.

Nome semelhante nunca confirma identidade. CPF/CNPJ só serão apresentados como
consulta precisa se a fonte fornecer esse vínculo de forma compatível; busca
literal em texto deve ser rotulada como experimental e incompleta. OAB é alvo de
monitoramento próprio e não equivale à confirmação de representação atual.

Resultados sempre informam fontes consultadas, indisponíveis, parcialidade,
truncagem e frescor. Ausência é formulada como “nenhum resultado encontrado nas
fontes consultadas”.

## Consequências

- Usuários conseguem verificar de onde veio cada afirmação.
- Homônimos permanecem separados e exigem ação explícita.
- Reprocessar um parser não apaga a evidência original.
- Armazenamento e APIs precisam manter versões e estados adicionais.
- Conflitos entre fontes são expostos em vez de resolvidos silenciosamente.
- Produto e marketing não podem declarar busca precisa por documento antes da
  existência de uma fonte realmente precisa.

## Alternativas consideradas

- **Unir por nome normalizado/fuzzy:** rejeitado por risco de mistura.
- **Sobrescrever dado antigo com a fonte mais nova:** rejeitado porque perde
  auditoria e não trata divergência.
- **Usar somente payload normalizado:** rejeitado porque impede reprocessamento e
  prova do que foi recebido.
- **Considerar confirmação manual como fato oficial:** rejeitado; é um vínculo do
  usuário e deve permanecer distinguível.

## Revisão

Revisar quando um identificador nacional oficial e estável substituir o CNJ em
alguma classe de processo, ou quando fonte/legislação permitir vínculo por
documento com nova semântica.
