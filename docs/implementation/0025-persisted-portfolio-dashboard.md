# Implementação 0025 — carteira persistida como superfície principal

**Status:** implementada e validada localmente  
**Data:** 31 de agosto de 2026  
**Custo:** [0028](../costs/0028-local-persisted-portfolio-dashboard.md)  
**Spec:** [0021](../specs/0021-persisted-portfolio-dashboard.md)  
**Fundação:** [Implementação 0024](0024-persisted-activity-dashboard.md)

## Resultado

A carteira pessoal persistida é agora a primeira superfície do painel
autenticado. O navegador consome `GET /api/v1/cases` por páginas e a API projeta
somente `caseId`, CNJ, tribunal, estado de identidade, atualização e proveniência.
`scope`, usuário, tenant, eventos, órgão, classe e referências oficiais internas
não atravessam o contrato da coleção.

O resultado síncrono do DJEN foi renomeado para “Resultado técnico da consulta
atual”, deixando explícito que é uma validação pontual e não a carteira já
monitorada.

## Integridade e coordenação

- carteira e alertas carregam em paralelo após uma única obtenção de token;
- cliente valida por allowlist envelope, campos, UUID, CNJ, datas, fontes e
  cursor antes de renderizar;
- IDs repetidos na página ou entre páginas falham fechados;
- cursor que não avança falha fechado e não duplica dados;
- a seleção compartilhada usa somente `caseId` para abrir a timeline;
- abertura pela carteira não inventa evento de origem;
- abertura por alerta acrescenta o `caseEventId` exato e destaca somente esse
  evento;
- respostas tardias de outra seleção continuam invalidadas por geração;
- logout desmonta carteira, alertas e timeline sem gravar fatos no navegador.

## Experiência

- modo simples apresenta cartões com CNJ, tribunal, identidade, atualização e
  quantidade de fontes oficiais;
- modo avançado apresenta os mesmos objetos em tabela, adicionando somente IDs
  técnicos, sem refetch;
- estado vazio distingue conta sem perfil, perfil ativo sem processo e processo
  persistido sem eventos;
- a carteira precede o acompanhamento na estrutura e na leitura visual;
- revisão em 390 × 844 confirmou largura `390/390`, sem overflow de página, e
  ações visíveis com 44 px;
- tabela avançada fica contida em região horizontalmente rolável e não amplia a
  página.

As práticas de frontend e React orientaram componentes estáveis no nível de
módulo, estado derivado em render, operações independentes em paralelo,
condicionais explícitas e ausência de nova biblioteca de interface.

## Evidência de validação

- 599 testes em 52 arquivos;
- cobertura de 100%: 1118/1118 statements, 836/836 branches, 238/238 functions
  e 1019/1019 lines;
- 167 asserts pgTAP em 7 arquivos e 24 contratos PostgreSQL em 6 arquivos;
- backup/restore lógico, worker e dispatcher one-shot aprovados com zero itens;
- lint, typecheck, build, Compose, Actionlint, ShellCheck e diff check aprovados;
- Terraform: 3 testes; Checkov: 9 aprovados, zero falhas;
- Hadolint aprovado nos dois Dockerfiles e scan de segredos sem achados;
- imagens da API, renderer e PostgreSQL com zero vulnerabilidades HIGH/CRITICAL
  corrigíveis;
- build web: JS principal 73,17 KiB gzip e CSS 5,83 KiB gzip;
- auditoria npm sem high/critical; permanecem nove findings moderados transitivos
  conhecidos na cadeia Firebase;
- nenhum serviço de produto externo foi acessado, nenhum recurso cloud foi
  criado e o custo incremental permanece R$ 0.

## Decisão arquitetural

Não foi necessário novo ADR. A projeção HTTP reduzida e a seleção por ID aplicam
as decisões já registradas nos ADRs 0012, 0019 e 0021, sem criar uma nova
decisão estrutural de longo prazo.

## Próximo gate

Conectar documentos persistidos à timeline e definir download individual/lote
com autorização tenant-scoped, retenção no Google Cloud Storage, integridade de
arquivo e orçamento antes de qualquer ativação remota. E-mail e fontes reais
continuam fora até seus gates próprios.
