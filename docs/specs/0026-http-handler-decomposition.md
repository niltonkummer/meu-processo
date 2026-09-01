# Spec 0026 — decomposição dos handlers HTTP v1

**Status:** aceita para implementação local/CI  
**Data:** 31 de agosto de 2026  
**Responsável:** engenharia do Meu Processo  
**Custo:** [Avaliação 0033](../costs/0033-local-http-handler-decomposition.md)  
**Relacionadas:** [Spec 0009](./0009-scalable-product-foundation.md),
[ADR 0011](../adr/0011-modular-monolith-and-composition-roots.md) e
[Spec 0025](./0025-openapi-v1-contract.md)

## 1. Problema e resultado esperado

`src/http/server.ts` possui 1.567 linhas e concentra transporte, parsing,
autenticação, roteamento, mapeamento de erro, arquivos estáticos e WebSocket de
seis capacidades. Embora os casos de uso estejam separados, qualquer evolução
de uma rota aumenta a superfície de regressão das demais.

O resultado será um servidor raiz de composição, com handlers independentes por
capacidade e utilitários de transporte compartilhados. O comportamento externo
permanecerá idêntico e verificável pelo OpenAPI v1 e pelos testes HTTP atuais.

## 2. Escopo estrutural

- `transport`: headers seguros, JSON privado, autenticação, rate limit, body
  limitado, contexto verificado e entrega de PDF;
- `session`: sessão autenticada;
- `search`: busca controlada;
- `monitoring-subjects`: cadastro, listagem e arquivamento;
- `alerts`: listagem e leitura;
- `cases`: carteira, detalhe, eventos, catálogo, conteúdo e materialização;
- `publications`: proxy de publicação e desafio assistido;
- `server`: health, estáticos, ordem explícita de handlers, fallback, WebSocket
  e erro final.

Os contratos de dependência HTTP ficarão em um módulo próprio. Nenhum handler
instanciará adapter, lerá segredo/configuração ou resolverá tenant por input
bruto.

## 3. Invariantes funcionais

1. As 15 operações, métodos, paths, status, DTOs e media types do OpenAPI v1 não
   mudam.
2. Toda rota `/api/v1` continua negando acesso sem bearer válido.
3. `X-Organization-Id` continua passando por membership verificada antes de
   produzir `tenantScope`.
4. Erros de ausência e autorização preservam a proteção contra enumeração.
5. Dados processuais e PDFs mantêm `private, no-store`, CSP e headers atuais.
6. Corpo JSON permanece limitado a 16 KiB e PDFs não passam a ser renderizados
   inline.
7. Limites por usuário e `Retry-After` permanecem idênticos.
8. URL, caminho, tenant e fonte de documento não passam a ser controlados pelo
   cliente.
9. O WebSocket preserva path, payload máximo, autenticação, renderer isolado,
   rejeições e timeout.
10. Health, arquivos estáticos e fallback 404 permanecem iguais.

## 4. Limites arquiteturais

- `server.ts` não define regra de capability nem importa casos de uso concretos;
- cada handler expõe um contrato uniforme e retorna `false` quando não reconhece
  a requisição;
- a ordem de handlers é explícita e preserva precedências atuais;
- utilitários de transporte não importam infraestrutura;
- application/domain continuam sem importar HTTP;
- handlers não usam `process.env`, estado de outro request ou cache sem tenant;
- servidor raiz deve ficar abaixo de 500 linhas e cada capability em arquivo
  próprio; o limite é um guardrail contra nova centralização, não meta estética.

## 5. Segurança e privacidade

O checklist seguro desta refatoração é preservar fail-closed em autenticação e
dependência ausente, validar antes de chamar caso de uso, não refletir erro
externo, não registrar PII/payload e manter IDs opacos. Funções sensíveis de
transporte serão exportadas apenas para handlers internos e testadas por meio
dos fluxos HTTP.

Não há nova trust boundary, serviço público ou persistência; por isso não é
necessário novo threat model. A refatoração aplica o ADR 0011 sem mudar a decisão
arquitetural.

## 6. Estratégia TDD

1. adicionar um teste arquitetural que falha com o servidor central de 1.567
   linhas e capabilities embutidas;
2. manter os testes de caracterização HTTP e WebSocket como baseline;
3. extrair primeiro contratos/transporte, depois handlers menores e por fim
   processos/publicações;
4. executar testes focados após cada fatia;
5. validar que o OpenAPI candidato é idêntico à baseline local;
6. executar suíte completa, cobertura, lint, tipos, build e scans aplicáveis.

## 7. Critérios de aceitação

- servidor raiz abaixo de 500 linhas e sem definições dos seis handlers;
- handlers de sessão, busca, perfis, alertas, processos e publicações existem
  separadamente e são registrados em ordem explícita;
- nenhum `operationId`, path ou schema OpenAPI muda;
- testes HTTP e WebSocket atuais continuam verdes, incluindo cross-tenant,
  autenticação, rate limit, documentos e falha segura;
- teste arquitetural bloqueia retorno das capabilities ao servidor raiz;
- 100% de cobertura do núcleo permanece;
- nenhuma dependência, recurso cloud, migration, frontend ou dado é alterado;
- custo real local permanece US$ 0.

## 8. Rollout e rollback

Rollout somente por CI/revisão, sem deploy nesta fatia. Rollback reverte os
novos módulos e restaura o servidor anterior junto do teste arquitetural. A
refatoração não autoriza relaxar contrato ou teste para facilitar reversão.
