# Spec 0022 — catálogo persistido de documentos

**Status:** aprovada para implementação local  
**Data:** 31 de agosto de 2026  
**Custo:** [0029](../costs/0029-local-persisted-document-catalog.md)  
**Decisões:** [ADR 0002](../adr/0002-multiuser-modes-and-document-delivery.md) e
[ADR 0012](../adr/0012-tenant-control-and-evidence-planes.md)

## Objetivo

Adicionar a fundação mínima para mostrar, sem mistura, quais documentos
pertencem a um processo e opcionalmente a qual evento exato. Metadado judicial
e arquivo materializado são entidades distintas. O primeiro pode existir sem o
segundo; o conteúdo nunca é armazenado no PostgreSQL.

## Modelo persistido

`document_records` contém identidade, processo, evento opcional, fonte,
envelope de evidência, tipo, título, classificação de acesso, disponibilidade e
datas da fonte/verificação.

`document_artifacts` contém somente o ponteiro opaco do objeto privado, SHA-256,
MIME real, tamanho, estado de malware, versão da chave e expiração. Neste corte,
todo artefato é `tenant_private`; cache público compartilhado depende de revisão
jurídica específica.

Regras obrigatórias:

- chaves e FKs compostas preservam `tenant_id` e impedem vínculo entre tenants;
- quando houver `case_event_id`, o evento deve pertencer ao mesmo processo;
- fonte/envelope/documento oficial formam proveniência verificável;
- unicidade por fonte e identificador externo torna ingestão idempotente;
- PDF tem no máximo 100 MiB e SHA-256 no formato canônico;
- artefato expirado, removido ou sem malware `clean` não é retornado como pronto;
- papéis de runtime não leem tabelas diretamente; acessam função
  `security definer` com contexto local de usuário e tenant.

## Contrato HTTP seguro

`GET /api/v1/cases/{caseId}/documents?limit=20&cursor=<opaco>` retorna:

- `documentId`, `caseId`, `caseEventId` opcional;
- `title`, `documentType`, `accessClass`, `availabilityStatus`;
- `expectedMediaType`, `sourceCreatedAt`, `lastVerifiedAt`;
- fonte limitada a `sourceId` lógico e `official`;
- artefato pronto opcional limitado a `artifactId`, `mediaType`, `sizeBytes`,
  `sha256` e `expiresAt`;
- `page.nextCursor`.

A API nunca retorna tenant/user IDs, `storage_object_id`, URL de origem, URL
assinada, versão de chave ou resultado interno detalhado da varredura. Cursor é
opaco, validado e usa ordenação determinística por data/UUID.

Processo ausente, documento alheio e processo de outro tenant são
indistinguíveis (`404`). Parâmetros extras, repetidos ou inválidos retornam
`400`. Cache HTTP permanece `private, no-store`.

## Integração com a timeline

- documentos do processo são buscados quando o processo é aberto, em paralelo
  com os eventos, sem pré-carregar a carteira inteira;
- documentos vinculados a um evento mostram essa relação pelo ID exato, nunca
  por título, data, nome, CPF, CNPJ ou posição;
- modo simples mostra título, tipo, data, fonte e estado em linguagem clara;
- modo avançado acrescenta IDs, hash e tamanho do mesmo objeto já carregado;
- ausência de documento, ausência de arquivo materializado e falha de catálogo
  são estados diferentes;
- seleção tardia de outro processo não pode receber documentos da seleção
  anterior.

## Preparação de download

Este gate prepara a referência segura do artefato, mas não entrega bytes. A ação
de download permanece indisponível quando não há artefato válido e aparece como
“em preparação” neste incremento. O endpoint de conteúdo legado continua
isolado e não pode receber `storage_object_id` do navegador.

Download individual via GCS/gateway e lote serão incrementos posteriores:

1. nova autorização no momento da entrega;
2. leitura por ID interno e escopo tenant;
3. auditoria e quota antes de gerar URL/stream;
4. lote assíncrono com manifesto, falha parcial e TTL de 24 horas.

## Critérios de aceite

1. banco rejeita evento/processo, envelope e artefato de outro tenant;
2. RLS é forçada e só a função paginada é executável pelo runtime;
3. consulta usa índice keyset compatível e não retorna ponteiro do storage;
4. repositório rejeita projeções inesperadas e mantém transação/contexto;
5. aplicação valida UUID, cursor, limites, datas, hash, MIME e tamanhos;
6. API diferencia `400`, `401`, `403`, `404` e indisponibilidade;
7. timeline e catálogo compartilham somente `caseId`/`caseEventId` exatos;
8. resposta tardia, paginação, duplicidade e cursor estacionário têm testes;
9. cobertura permanece em 100% e contratos de banco/guardrails passam;
10. nenhum serviço externo é ativado e o custo incremental local é zero.

## Fora do escopo

- download real, URL assinada, streaming, bucket ou lifecycle;
- coleta de documentos reais e conectores adicionais;
- criação/cancelamento de export jobs e ZIP;
- malware scanner real, e-mail, IA e deploy.
