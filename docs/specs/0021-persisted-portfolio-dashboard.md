# Spec 0021 — carteira persistida como superfície principal

**Status:** aprovada para implementação local  
**Data:** 31 de agosto de 2026  
**Custo:** [0028](../costs/0028-local-persisted-portfolio-dashboard.md)  
**Fundação:** [Spec 0016](0016-persisted-case-portfolio.md) e [Spec 0020](0020-activity-dashboard.md)

## Objetivo

Fazer da carteira persistida a referência principal do painel autenticado. A
consulta síncrona à fonte oficial continua sendo uma validação pontual e não
pode se apresentar como se fosse a carteira monitorada.

## Contrato HTTP seguro

`GET /api/v1/cases?limit=20&after=<uuid>` retorna somente:

- `caseId`, `cnjNumber`, `tribunal`, `identityStatus`, `lastUpdatedAt`;
- `sources`, limitadas a `sourceId`, `official` e `collectedAt`;
- `page.nextCursor`.

O endpoint deve omitir `scope`, IDs de usuário/tenant, memberships, eventos e
qualquer outro campo interno, inclusive quando um repositório legado é usado.
Cache permanece `private, no-store`. Campos extras ou estruturas inesperadas
devem ser rejeitados pelo cliente.

## Comportamento do painel

1. Carteira e alertas iniciam o carregamento em paralelo após autenticação.
2. A carteira é exibida antes do acompanhamento e é a superfície principal.
3. Modo simples usa cartões; modo avançado usa tabela com os mesmos objetos já
   carregados, sem nova requisição.
4. Selecionar um processo da carteira abre sua timeline pelo `caseId`, sem
   destacar evento de origem.
5. Selecionar um alerta abre a mesma timeline pelo `caseId` e destaca somente o
   `caseEventId` exato do alerta.
6. Existe apenas uma seleção de processo entre carteira, alertas e timeline.
7. Paginação preserva páginas anteriores, rejeita IDs repetidos entre páginas e
   falha se o cursor não avançar.
8. Resposta tardia de uma seleção anterior não altera a timeline atual.
9. Logout desmonta a superfície e remove da tela todos os fatos persistidos.

## Estados vazios

- sem perfis ativos: informar que ainda não existe monitoramento e orientar o
  cadastro de nome, CPF ou CNPJ;
- com perfis ativos, mas sem processos: informar que o monitoramento está ativo
  e ainda não coletou processo;
- processo selecionado sem eventos: informar que o processo está persistido,
  mas ainda não há evento coletado;
- falhas de carteira, alertas e timeline são independentes e não apagam dados
  válidos das outras superfícies.

## Integridade visual e semântica

- CNJ, tribunal, estado de identidade, atualização e procedência exibidos sem
  mistura entre processos;
- nenhuma união por nome, CPF, CNPJ, texto ou posição na lista;
- correspondência `confirmed` descrita como identificação confirmada na projeção
  persistida; alertas continuam `unverified` até validação própria;
- estados não dependem apenas de cor, foco é visível, ações têm alvo mínimo de
  44 px e tabela é navegável em viewport estreito;
- IDs técnicos aparecem somente no modo avançado.

## Critérios de aceite

1. API omite todos os campos fora da allowlist em coleções persistidas e
   legadas;
2. cliente valida envelope, campos, UUID, CNJ, datas, fontes e cursor;
3. modos simples/avançado não refazem fetch;
4. seleção pela carteira e pelo alerta converge para uma única timeline;
5. paginação, duplicidade, cursor estacionário e corrida de respostas têm testes;
6. estado vazio distingue ausência de perfil, ausência de processo e ausência de
   evento;
7. cobertura definida permanece em 100%, contratos de banco e guardrails passam;
8. nenhum serviço externo é acessado e o custo incremental é zero.

## Fora do escopo

- filtros, ordenação customizada e busca textual na carteira;
- detalhe completo, documentos e download em lote;
- organização/escritório, compartilhamento e permissões por equipe;
- envio de e-mail, IA e fontes reais;
- deploy ou alteração de infraestrutura cloud.
