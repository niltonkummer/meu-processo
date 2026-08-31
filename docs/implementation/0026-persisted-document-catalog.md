# Implementação 0026 — catálogo persistido de documentos

**Status:** implementada e validada localmente  
**Data:** 31 de agosto de 2026  
**Custo:** [0029](../costs/0029-local-persisted-document-catalog.md)  
**Spec:** [0022](../specs/0022-persisted-document-catalog.md)  
**Fundação:** [Implementação 0025](0025-persisted-portfolio-dashboard.md)

## Resultado

O produto agora possui catálogo persistido de documentos vinculado ao
`caseId` e, quando conhecido, ao `caseEventId` exato. Metadado e arquivo
materializado são separados: o PostgreSQL nunca recebe os bytes e o ponteiro
do objeto permanece interno.

A migração 0009 cria:

- `document_records`, com identidade idempotente por fonte, processo, evento,
  envelope, classificação, disponibilidade e datas;
- `document_artifacts`, com namespace tenant-private, SHA-256, MIME, tamanho,
  estado de malware, versão de chave e TTL;
- FKs compostas e índices para impedir mistura de tenant/processo/evento e
  sustentar paginação keyset;
- função `list_tenant_case_documents`, executável somente pelo runtime, com RLS
  forçada e projeção que não contém `storage_object_id`.

## API e integridade

`GET /api/v1/cases/{caseId}/documents` usa contexto pessoal resolvido no
servidor, cursor opaco e limite de 1 a 100. A resposta contém somente metadados
seguros, fonte lógica e, se válido, resumo do artefato limpo e não expirado.

- processo ausente ou alheio retorna 404 sem permitir enumeração;
- parâmetros extras/repetidos, UUID, limite ou cursor inválido retornam 400;
- tabela privada não é legível diretamente pelo runtime/worker/dispatcher;
- caminhos de storage, URLs, tenant/user IDs e versão da chave não atravessam a
  API;
- cliente web valida allowlist, IDs, datas, MIME, hash, tamanho, estados,
  duplicidade e correspondência exata do processo antes de renderizar.

## Experiência e desempenho

- abrir um processo inicia timeline e documentos em paralelo após uma única
  obtenção de token;
- falha de documentos não apaga a timeline e falha da timeline não apaga o
  catálogo;
- resposta tardia é descartada pela mesma geração da seleção do processo;
- modo simples mostra título, tipo, data, fonte, vínculo e estado em linguagem
  direta;
- modo avançado usa os mesmos objetos e acrescenta IDs, tamanho e SHA-256 sem
  refetch;
- arquivo não materializado é distinguido de catálogo vazio e falha;
- download aparece desabilitado como “em preparação”, pois nenhuma entrega GCS
  foi autorizada neste gate;
- revisão em 390 × 844 confirmou largura 390/390 sem overflow, hash contido e
  ações com 44 px.

As práticas de Supabase/PostgreSQL orientaram constraints, FKs indexadas,
índice composto compatível com a ordenação, RLS forçada, privilégios mínimos e
função de leitura tenant-scoped. As práticas de frontend/React orientaram
componentes estáveis, requisições independentes em paralelo, estados separados,
listas com `content-visibility` e responsividade sem nova dependência.

## Evidência de validação

- 642 testes em 55 arquivos;
- cobertura de 100%: 1238/1238 statements, 966/966 branches, 261/261 functions
  e 1123/1123 lines;
- 181 asserts pgTAP em 8 arquivos e 27 contratos PostgreSQL em 7 arquivos;
- backup/restore lógico aprovado; worker one-shot sem item e dispatcher
  one-shot concluído;
- lint, typecheck, build, Compose, Actionlint, ShellCheck e diff check aprovados;
- Terraform: 3 testes; Checkov: 9 aprovados, zero falhas;
- Hadolint aprovado nos dois Dockerfiles e scan de segredos sem achados;
- imagens da API, renderer e PostgreSQL com zero vulnerabilidades HIGH/CRITICAL
  corrigíveis;
- build web: JS principal 74,79 KiB gzip e CSS 6,16 KiB gzip;
- auditoria npm sem high/critical; permanecem nove findings moderados
  transitivos conhecidos na cadeia Firebase;
- nenhum serviço de produto externo foi acessado, nenhum bucket/recurso cloud
  foi criado e o custo incremental local permanece R$ 0.

## Decisão arquitetural

Não foi necessário novo ADR. A implementação aplica os ADRs 0002 e 0012: o
gateway recebe IDs internos, artefato é privado e temporário, e evidência não
concede acesso sem controle tenant-scoped.

## Próximo gate

Implementar entrega individual do artefato por ID interno com autorização
renovada, auditoria, quota e adapter local de object storage. Antes de ativar o
GCS: orçamento por volume/retenção, bucket privado, lifecycle, Public Access
Prevention, IAM mínimo, alerta de custo e teste de remoção. Exportação em lote
permanece posterior ao gate controlado do download individual; Cloud Workflows
continua desnecessário.
