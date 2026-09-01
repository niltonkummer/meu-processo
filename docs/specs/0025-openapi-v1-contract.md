# Spec 0025 — contrato OpenAPI v1 e compatibilidade

**Status:** aceita para implementação local/CI  
**Data:** 31 de agosto de 2026  
**Responsável:** engenharia do Meu Processo  
**Custo:** [Avaliação 0032](../costs/0032-local-openapi-v1-contract.md)  
**Requisito:** FND-011 da [Spec 0009](./0009-scalable-product-foundation.md)

## 1. Problema e resultado esperado

A API já usa o prefixo `/api/v1`, mas o contrato existe apenas de forma
implícita no roteador, nos tipos internos e em exemplos de testes. Isso permite
que uma rota, parâmetro, DTO, resposta ou requisito de autenticação seja
alterado sem que a revisão identifique uma quebra para o painel.

O resultado será um documento OpenAPI 3.1 versionado, validado offline e tratado
como contrato público da API HTTP v1. A CI comparará o candidato com o contrato
da branch-base e bloqueará incompatibilidades conhecidas.

## 2. Escopo

O contrato cobre todas as operações HTTP públicas atuais:

- sessão autenticada;
- busca controlada;
- perfis monitorados;
- carteira, detalhe, linha do tempo e documentos de processos;
- preparação e entrega individual de documentos;
- alertas internos;
- proxy assistido de publicação.

`/health` e o canal WebSocket assistido serão inventariados, mas ficam fora do
contrato HTTP público versionado: health é contrato operacional e OpenAPI não
descreve mensagens WebSocket. A sessão WebSocket continua coberta pelos testes
de protocolo existentes e deverá receber contrato AsyncAPI próprio quando
houver consumidor externo.

Não fazem parte desta fatia Swagger UI, portal externo, geração de cliente,
validação de payload em runtime, novo endpoint, nova dependência ou publicação
na internet.

## 3. Regras do contrato

1. O documento usa OpenAPI `3.1.x`, JSON válido e caminho canônico
   `api/openapi.v1.json`.
2. Toda operação possui `operationId` único, resumo, tags, autenticação e ao
   menos uma resposta documentada.
3. Toda operação `/api/v1` exige bearer token; nenhuma alteração pode torná-la
   pública silenciosamente.
4. Parâmetros de path são obrigatórios e correspondem ao template da rota.
5. Parâmetros de paginação documentam tipo, mínimo, máximo e formato do cursor.
6. Corpos JSON declaram `required`, media type, limite estrutural e
   `additionalProperties: false` quando o servidor rejeita campos extras.
7. Respostas JSON usam schemas fechados para impedir mistura acidental de DTOs;
   valores opcionais ou nulos são declarados explicitamente.
8. Erros usam o envelope mínimo `{code, message}` e códigos HTTP observados no
   servidor; detalhes adicionais só aparecem em schemas específicos.
9. PDFs são `application/pdf`, sempre attachment privado, sem cache, e não são
   representados como JSON.
10. IDs opacos/UUIDs, números CNJ, hashes, timestamps e enums possuem formatos
    ou padrões explícitos.

## 4. Compatibilidade

Uma comparação entre baseline e candidato deve bloquear, no mínimo:

- remoção de path, método ou `operationId` existente;
- duplicação ou troca de `operationId`;
- remoção de parâmetro ou transformação de opcional em obrigatório;
- mudança incompatível de localização, tipo, formato, padrão, limites ou enum;
- remoção de media type, request body ou resposta HTTP existente;
- transformação de body opcional em obrigatório;
- remoção de propriedade ou adição de propriedade obrigatória em resposta;
- remoção de propriedade aceita ou adição de obrigatoriedade em request;
- redução de enum e mudança incompatível de tipo/schema;
- remoção ou enfraquecimento do requisito bearer.

Mudanças aditivas compatíveis são aceitas. Uma quebra intencional exige nova
versão de API ou janela de migração explicitamente especificada; não haverá
flag de ignore genérica.

Na primeira adoção, a CI pode informar que a branch-base ainda não possui o
arquivo. Depois que a baseline existir, ausência, JSON inválido ou falha de
leitura deve bloquear a mudança.

## 5. Segurança, privacidade e isolamento

- o validador não resolve `$ref` remoto nem executa código do documento;
- os schemas contêm apenas estruturas e exemplos sintéticos, nunca nome, CPF,
  CNPJ, token, texto processual, URL assinada ou PDF real;
- o contrato não substitui autenticação e autorização server-side;
- schemas diferentes para processo, evento, documento e alerta reduzem o risco
  de projeção cruzada ou mistura de contexto;
- requisitos bearer não podem ser removidos por uma mudança compatível;
- mensagens de erro permanecem seguras e não expõem payload externo;
- nenhuma especificação é servida pelo runtime nesta etapa.

## 6. Estratégia TDD e testes

1. testes unitários falham para documento inválido, operação incompleta,
   referência local ausente e `operationId` duplicado;
2. testes de compatibilidade falham para cada classe de quebra da seção 4 e
   aceitam mudanças aditivas;
3. o contrato real é carregado pelo teste e passa pelo mesmo validador da CI;
4. testes de caracterização verificam que as operações HTTP existentes no
   servidor aparecem no contrato;
5. a implementação mantém 100% de cobertura do código TypeScript incluído;
6. lint, typecheck, testes, cobertura, build e auditoria de dependências passam;
7. a CI executa validação offline e comparação com a branch-base.

## 7. Critérios de aceitação

- `api/openapi.v1.json` descreve todas as operações HTTP `/api/v1` atuais;
- o validador retorna sucesso para o contrato real e diagnóstico determinístico
  por caminho para documentos inválidos;
- o comparador demonstra bloqueio das incompatibilidades da seção 4;
- a CI busca baseline com histórico suficiente e falha fechada após a primeira
  adoção;
- nenhuma dependência, recurso cloud ou dado real é adicionado;
- custo mensal atual e esperado permanecem inalterados, delta US$ 0;
- rollback consiste em reverter o contrato, validador e step de CI juntos;
- a evidência de testes e limitações fica registrada no plano de implementação.

## 8. Ausência, erro e parcial

- contrato candidato ausente ou inválido: falha;
- baseline legitimamente inexistente na primeira adoção: aviso explícito e
  validação completa do candidato;
- baseline esperada, porém ilegível/inválida: falha;
- schema local referenciado e ausente: falha;
- operação sem resposta ou sem segurança: falha;
- comparação não reconhece construção incompatível: falha conservadora com
  diagnóstico, nunca aprovação silenciosa.

## 9. ADR

Não é necessário novo ADR. A fatia executa decisões já aceitas: API `/api/v1`
compatível, contratos versionados, CI bloqueante e ausência de novo serviço ou
dependência arquitetural.
