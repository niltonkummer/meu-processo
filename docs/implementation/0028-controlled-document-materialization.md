# Implementação 0028 — materialização controlada de documentos

**Status:** implementada e validada localmente  
**Data:** 31 de agosto de 2026  
**Custo:** [0031](../costs/0031-local-controlled-document-materialization.md)  
**Spec:** [0024](../specs/0024-controlled-document-materialization.md)  
**Threat model:** [0006](../security/0006-controlled-document-materialization-threat-model.md)

## Plano executável

1. contrato de aplicação e testes vermelhos para request, worker e falhas;
2. adapter de fixture, quarentena e publicação local atômica;
3. migration de job/execution, RLS, privilégios e funções estreitas;
4. repository PostgreSQL e testes de concorrência/idempotência;
5. composition root, worker one-shot, configuração e Compose;
6. endpoint autenticado e estado preciso no painel;
7. validação de fluxo real sintético, isolamento, cobertura e scans.

Nenhuma etapa deste documento autoriza fonte real, GCS, commit, push ou deploy.
Os resultados e comandos verificados serão registrados somente depois de
executados.

## Resultado implementado

- endpoint pessoal autenticado e idempotente, sem body ou identificador de
  fonte controlado pelo cliente;
- função PostgreSQL tenant-scoped que oculta documento alheio, restrito ou
  inelegível como `404` uniforme;
- job por tenant/documento e execuções com lease, token em hash, retry,
  terminal e recuperação de expiração;
- role dedicada que acessa somente `claim`, `complete` e `fail`; runtime e
  demais workers não leem as tabelas diretamente;
- adapter UUID-only de fixture, limite de 25 MiB, validação PDF, SHA-256,
  quarentena `0600`, scanner determinístico e publicação atômica idempotente;
- worker one-shot non-root, read-only, sem capabilities, com lote máximo dez e
  rede Compose interna contendo apenas worker e PostgreSQL;
- ação “Preparar arquivo” no painel, com token renovado, estado por documento,
  mensagens acessíveis e sem polling ou indicação otimista de disponibilidade;
- MER físico atualizado para job, execução, relações, constraints e índices.

## Evidência verificada em 31/08/2026

- lint, typecheck, build e Compose válidos;
- 65 arquivos e 795 testes de aplicação/UI aprovados;
- cobertura exata de 100%: 1.471 statements, 1.147 branches, 300 functions e
  1.346 lines;
- 10 arquivos e 208 testes pgTAP aprovados em banco recém-criado;
- 9 arquivos e 33 contratos PostgreSQL aprovados, incluindo concorrência,
  isolamento, expiração de lease e idempotência;
- backup lógico e restauração aprovados;
- smoke dos workers de monitoramento, outbox e documento aprovado;
- fluxo sintético real: um job reclamado e concluído, PDF 77 bytes, objeto
  `0600`, SHA-256 idêntico à entrada, scan `clean`, documento `available` e
  repetição retornando o mesmo `materializationId` como `available`;
- actionlint e hadolint aprovados, nenhum segredo detectado e zero
  vulnerabilidades altas/críticas na imagem de produção;
- `npm audit --audit-level=high` aprovado; permanecem nove vulnerabilidades
  moderadas transitivas nas ferramentas Firebase, sem relaxar o gate alto;
- bancos, volume e arquivos sintéticos descartáveis removidos após a validação;
- custo incremental e consumo cloud: US$ 0.

## Limites preservados

O scanner desta etapa prova o contrato somente com fixtures e não é antivírus
de produção. GCS, fonte judicial real, proxy, scheduler e deploy continuam
desativados. Ativar qualquer um deles exige novo cost gate, adapter revisado,
scanner de produção e autorização explícita.
