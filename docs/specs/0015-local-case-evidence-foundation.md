# Spec 0015 — evidência processual local reconstruível

**Status:** aprovada para implementação local  
**Data:** 31 de agosto de 2026  
**Custo:** [0022](../costs/0022-local-case-evidence-foundation.md)  
**Arquitetura:** [ADR 0012](../adr/0012-tenant-control-and-evidence-planes.md),
[ADR 0013](../adr/0013-transactional-outbox-and-idempotent-jobs.md) e
[ADR 0021](../adr/0021-tenant-private-evidence-first.md)

## Objetivo

Transformar cada resultado sintético válido do worker em evidência append-only e
uma projeção mínima de processo autorizada para o tenant, sem payload bruto e sem
acoplar o domínio ao formato do DJEN.

## Contrato canônico mínimo

Cada observação aceita contém somente:

- `externalId`, `contentHash`, `collectedAt`;
- `parserVersion` e `schemaVersion=1`;
- CNJ normalizado e validado;
- código de tribunal normalizado.

Não entram nesta versão: nome, CPF/CNPJ, participante, texto de publicação, URL,
documento, payload bruto, classe, órgão ou decisão de vínculo por homônimo.

## Escrita transacional

A conclusão válida de uma execução deve, na mesma transação:

1. registrar o recibo da execução;
2. deduplicar um `SourceEnvelope` tenant-private por fonte, external ID e hash;
3. registrar uma `CanonicalObservation` append-only por envelope, parser e
   schema;
4. resolver ou criar um `CaseRecord` por tenant e CNJ;
5. resolver a referência externa da fonte sem permitir remapeamento para outro
   processo;
6. criar o `TenantCase` que autoriza a projeção;
7. concluir a execução, reagendar o alvo e gravar outbox mínima.

Replay idêntico não cria linhas adicionais. Replay incompatível, CNJ inválido,
mudança de tribunal ou remapeamento de referência falha fechado.

## Isolamento e privilégios

- todas as tabelas desta fatia carregam `tenant_id`, habilitam e forçam RLS;
- FKs privadas incluem `tenant_id`;
- a role `app_worker` não recebe acesso direto às tabelas;
- somente a função estreita de conclusão pode gravar evidência;
- a aplicação não consulta o plano de evidência sem `TenantCase`.

## Rebuild e evolução

A projeção mínima deve poder ser reconstruída agrupando observações canônicas
por tenant e CNJ. `projection_version` começa em 1. Uma versão de parser nova
cria nova observação para o mesmo envelope; não altera a anterior.

Payload original e object storage serão adicionados por migration expand quando
retenção e lifecycle forem aprovados. Compartilhamento cross-tenant exige a
promoção descrita no ADR 0021, nunca uma remoção direta de `tenant_id`.

## Critérios de aceite

1. duas observações iguais na mesma execução produzem uma evidência e um caso;
2. uma execução posterior idêntica reutiliza envelope, observação e caso;
3. o mesmo CNJ em tenants diferentes não compartilha nenhuma linha nesta fase;
4. parser novo preserva envelope e acrescenta observação;
5. CNJ, schema, tribunal, hash ou datas inválidos são rejeitados antes e dentro
   do banco;
6. worker não consegue `SELECT/INSERT/UPDATE/DELETE` direto;
7. outbox não contém CNJ, tribunal, external ID ou conteúdo;
8. pgTAP, contracts PostgreSQL, restore e cobertura integral permanecem verdes;
9. nenhuma fonte externa, serviço cloud ou custo mensal é ativado.

## Fora do escopo

- API/painel de carteira persistida;
- eventos/publicações e participantes;
- conteúdo integral, documentos e Cloud Storage;
- evidência pública global;
- adapter real, backfill ou crawler nacional.
