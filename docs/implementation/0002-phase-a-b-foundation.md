# Implementação 0002 — fundação das fases A e B

**Data:** 29 de agosto de 2026
**Spec:** [Spec 0002](../specs/0002-process-monitoring-functional-parity.md)
**Avaliação de custo:** [0002 — fundação local](../costs/0002-phase-a-b-local-foundation.md)
**Impacto cloud desta entrega:** nenhum

## Estado entregue

- principal autenticado independente do provedor de identidade;
- escopos pessoais e de organização sem coerção entre identificadores;
- papéis `owner`, `admin`, `lawyer` e `viewer`, com vínculo ativo obrigatório;
- autorização aplicada antes de consultar o repositório;
- filtragem defensiva de respostas indevidamente misturadas pelo repositório;
- modelo canônico de processo, fonte, evento, alvo de monitoramento e auditoria;
- repositório substituível e implementação em memória para testes locais;
- `POST /api/v1/searches`, preservando `POST /api/searches` da Spec 0001;
- `GET /api/v1/cases`, detalhe e eventos, todos privados e com
  `Cache-Control: private, no-store`;
- códigos estáveis `UNAUTHENTICATED`, `FORBIDDEN` e `CASE_NOT_FOUND`;
- modo simples e primeira carteira avançada sobre a mesma resposta factual;
- régua de proveniência DJEN no cartão e na carteira;
- testes de isolamento pessoal, organização, vazamento defensivo e troca de
  modo sem nova consulta.

## Propriedades de segurança

- Sem adaptador de identidade ou repositório configurado, a API privada sempre
  responde HTTP 401.
- Um `caseId` existente em outro escopo é tratado como não encontrado.
- Selecionar uma organização pelo cliente não concede acesso; o vínculo ativo é
  revalidado pelo backend.
- A implementação publicada não recebeu autenticação falsa, usuário padrão ou
  bypass por cabeçalho.
- Fixtures usam apenas identidades e processos sintéticos.

## Limites deste corte

Este corte não conclui as fases A e B completas. Ainda faltam:

- adaptador real do Firebase Authentication;
- Firestore e Storage Emulator, regras do banco e persistência cifrada;
- gravação da trilha de auditoria;
- Início, Meus processos e Detalhe consumindo a API autenticada;
- confirmação explícita de candidato/homônimo;
- explicações determinísticas e alertas no painel;
- paginação com cursor além do contrato inicial sem próxima página.

As fases C a F — worker agendado, alertas externos, documentos, gateway,
Storage, exportação em lote e IA — não foram iniciadas. Cada mudança que crie ou
altere recurso cloud exige avaliação de custo própria antes do código de
infraestrutura.

## Contrato local da API privada

O servidor aceita implementações injetadas de `TokenVerifier` e
`CaseRepository`. Isso permite testes completos sem credencial real. A seleção
de tenant funciona assim:

1. validar o Bearer token;
2. criar o escopo pessoal a partir do usuário autenticado ou ler a organização
   solicitada;
3. verificar o vínculo ativo;
4. consultar pelo escopo;
5. filtrar novamente a resposta pelo mesmo escopo;
6. devolver apenas fatos autorizados, sem cache compartilhado.

## Evidências de qualidade

- TDD registrado por falhas esperadas antes de cada implementação;
- cobertura de 100% em statements, branches, functions e lines para domínio e
  aplicação;
- verificação de tipos, lint e build de produção;
- bundle inicial do frontend abaixo da meta de 150 KB comprimidos;
- verificação visual local da direção editorial institucional e dos controles
  de modo.
