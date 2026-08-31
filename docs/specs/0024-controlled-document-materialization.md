# Spec 0024 — materialização controlada de documento público

**Status:** aprovada para implementação local  
**Data:** 31 de agosto de 2026  
**Custo:** [0031](../costs/0031-local-controlled-document-materialization.md)  
**Threat model:** [0006](../security/0006-controlled-document-materialization-threat-model.md)  
**Decisões:** [ADR 0009](../adr/0009-asynchronous-monitoring-notification-and-export.md),
[ADR 0012](../adr/0012-tenant-control-and-evidence-planes.md) e
[ADR 0021](../adr/0021-tenant-private-evidence-first.md)

## Objetivo

Transformar, fora da requisição web, um `document_record` público e oficial em
um `document_artifact` privado, íntegro, temporário e auditável. A primeira
implementação usa somente fixture sintética local e não possui capacidade de
rede. O contrato deve permitir trocar o conector e o object store no futuro sem
alterar as invariantes de tenant, processo, documento ou artefato.

## Ativação explícita

`POST /api/v1/cases/{caseId}/documents/{documentId}/materializations`:

- exige `Authorization: Bearer` novo e resolve o tenant no servidor;
- rejeita query, body, IDs adicionais e documento que não pertença ao processo;
- aceita somente `public_official`, `application/pdf` e fonte ativa com termos
  revisados;
- cria ou reutiliza atomicamente um job para o documento e retorna `202` com
  `materializationId`, `documentId` e estado `queued`, `processing` ou
  `available`;
- processo/documento alheio, restrito, desconhecido ou inelegível recebe `404`
  uniforme;
- não recebe URL, caminho, source code, external ID, artifact ID ou tenant ID.

Repetir a requisição não cria trabalho duplicado. Se já existir artefato limpo,
não expirado e não removido, o estado retornado é `available`.

## Estado persistido

`document_materialization_jobs` mantém um job por tenant/documento, com estado
`pending`, `running`, `retry`, `completed` ou `dead`, próxima tentativa,
tentativas e timestamps. `document_materialization_executions` mantém cada
lease e outcome imutável, com token armazenado apenas como SHA-256.

Invariantes:

- FKs compostas ligam job ao tenant/documento e execução ao tenant/job;
- somente a função tenant-scoped de solicitação é executável pelo runtime;
- somente a role dedicada `app_document_worker` executa claim/complete/fail;
- nenhuma role de aplicação lê ou escreve as tabelas diretamente;
- claim usa `FOR UPDATE SKIP LOCKED`, lease de 30 s a 15 min e transação curta;
- expiração recupera job abandonado sem aguardar I/O externo dentro do banco;
- complete é idempotente pelo fingerprint do outcome e por
  `(tenant_id, document_id, content_hash)`;
- todo terminal/retry produz evento outbox mínimo, sem conteúdo ou localização.

## Pipeline do worker

1. reclamar no máximo dez jobs vencidos com lease e token aleatório;
2. resolver o adapter pelo `sourceCode` persistido, nunca por URL do cliente;
3. buscar no máximo 25 MiB; a fixture local aceita somente identificador UUID e
   lê em raiz privada sem symlink, traversal ou acesso à rede;
4. validar shape exato, `application/pdf`, bytes, assinatura `%PDF-`, tamanho e
   calcular SHA-256;
5. criar arquivo exclusivo na quarentena privada com permissão `0600`;
6. executar scanner por interface. Neste gate o scanner determinístico local
   serve somente a fixtures e não representa proteção de produção;
7. em `clean`, publicar por rename atômico para locator derivado no servidor;
8. concluir no PostgreSQL com artefato, hash, tamanho, TTL e outcome exatos;
9. em `infected`, inválido ou adapter desconhecido, descartar quarentena e
   encerrar como `dead`; falhas transitórias recebem backoff limitado;
10. emitir somente métricas agregadas e códigos allowlisted.

O artifact ID é determinístico a partir do tenant, documento e hash. Assim, uma
falha após a publicação do arquivo e antes do commit pode repetir a mesma
publicação sem sobrescrever conteúdo divergente. Um target existente só é
aceito se tamanho e hash forem idênticos.

## Falhas e reconciliação

- lease ou token incorreto nunca completa outro job;
- resultado após a expiração do lease é rejeitado;
- arquivo parcial permanece apenas em quarentena e é removido no `finally`;
- objeto final sem linha no banco é órfão seguro, não é listável nem baixável;
- retry do mesmo conteúdo reconcilia esse órfão pelo ID/locator determinístico;
- banco concluído sem objeto não é possível pelo fluxo normal: publicação
  antecede complete; o download ainda verifica presença, tamanho e hash;
- scanner indisponível ou outcome não auditável falha fechado.

## Configuração local

O modo default é `disabled`. O modo `local-fixture` exige roots absolutas,
distintas, fora de `dist` e `web`, banco PostgreSQL, batch máximo 10, arquivo
máximo 25 MiB e TTL entre 1 hora e 7 dias. O container é one-shot, non-root,
read-only, sem capabilities, com fixture montada `ro` e object root limitado a
um volume local privado.

## Critérios de aceite

1. solicitação autenticada e tenant-scoped é idempotente e não enumera dados;
2. dois workers concorrentes nunca reclamam o mesmo job ativo;
3. lease expirado é recuperado e resultado tardio é rejeitado;
4. runtime, monitoring worker e dispatcher não acessam a fila dedicada;
5. adapter local rejeita absoluto, traversal, controle, symlink, não regular,
   identificador inválido, tamanho excessivo e arquivo ausente;
6. HTML disfarçado, MIME divergente, PDF vazio/grande e resposta extra são
   rejeitados antes da publicação;
7. scanner `infected`/`failed` e erro de storage nunca criam artefato pronto;
8. publicação é atômica, `0600`, idempotente e não sobrescreve divergência;
9. complete cria um único artefato tenant-private e outcome/outbox coerentes;
10. retry após falha entre objeto e banco reutiliza o mesmo objeto com hash;
11. logs, métricas e erros não contêm path, URL, bytes, título ou identificador
    externo;
12. testes unitários, pgTAP, integração concorrente, fluxo Compose, cobertura
    100%, lint, typecheck, build e scans permanecem verdes;
13. custo incremental é US$ 0 e nenhuma rede/cloud/dado real é utilizado.

## Fora do escopo

- GCS, URL assinada, Cloud Tasks, Cloud Run Jobs, Pub/Sub e Workflows;
- acesso a tribunal, proxy, VPN, crawler ou documento real;
- scanner antivírus de produção e política definitiva de retenção;
- documentos `restricted`/`unknown`, captcha, login judicial ou credencial;
- download em lote, ZIP, exportação, e-mail, cobrança e deploy.

