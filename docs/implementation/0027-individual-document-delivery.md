# Implementação 0027 — entrega individual segura de documento

**Status:** implementada e validada localmente  
**Data:** 31 de agosto de 2026  
**Custo:** [0030](../costs/0030-local-individual-document-delivery.md)  
**Spec:** [0023](../specs/0023-individual-document-delivery.md)  
**Threat model:** [0005](../security/0005-individual-document-delivery-threat-model.md)  
**Fundação:** [Implementação 0026](0026-persisted-document-catalog.md)

## Resultado

O painel pessoal agora baixa um PDF já materializado a partir do `caseId` e
`documentId` internos. A decisão de acesso continua no PostgreSQL e o caminho
do objeto permanece exclusivamente no servidor. O navegador nunca escolhe
tenant, usuário, artefato, storage key, nome de arquivo ou URL.

A migração 0010 acrescenta:

- quota atômica por tenant, usuário e janela de minuto;
- autorização curta e imutável vinculada ao processo, documento e artefato
  exatos;
- um único outcome imutável por autorização;
- funções `SECURITY DEFINER` com `search_path` fixo, RLS forçada e `EXECUTE`
  apenas para a role do runtime;
- FKs compostas que impedem combinações válidas isoladamente, mas pertencentes
  a tenants, processos ou documentos diferentes.

## Entrega e integridade

O serviço autoriza e consome a quota numa transação curta, fecha a transação e
somente depois lê o object storage. Antes de enviar, confere:

- classe `public_official`, artefato disponível, limpo, não expirado e não
  removido;
- correspondência exata de tenant, usuário, processo, documento e artefato;
- chave no namespace tenant-private, sem caminho absoluto, traversal, controle,
  URL, symlink ou arquivo não regular;
- limite de 25 MiB, tamanho antes/depois da leitura, assinatura `%PDF-` e
  SHA-256 com comparação de tempo constante.

Falha de objeto, integridade ou storage é auditada e nunca produz bytes. Se o
outcome não puder ser persistido, a entrega também falha fechada.

## API e painel

`GET /api/v1/cases/{caseId}/documents/{documentId}/content` exige uma sessão
nova em cada clique e rejeita query/body extras. Sucesso usa attachment,
`application/pdf`, CSP sandbox, `nosniff`, tamanho e hash exatos e cache privado
desabilitado. Ausência/alheamento retorna 404 uniforme; quota retorna 429;
integridade/storage retorna 502; adapter desabilitado retorna 503.

No frontend:

- somente documento materializado possui botão de download ativo;
- o cliente confere origem relativa, redirect, MIME, tamanho, hash, disposition
  e assinatura antes de criar o arquivo local;
- o nome salvo é derivado apenas do UUID validado;
- duplo clique é bloqueado enquanto a operação está em andamento;
- erro fica no cartão do documento exato e não apaga timeline ou catálogo;
- layout mantém ação de pelo menos 44 px e ocupa a largura disponível no mobile.

## Operação local

O Compose configura o adapter `local` e monta `.local/document-objects` como
somente leitura. Todo conteúdo dessa pasta, exceto o README de orientação, é
ignorado pelo Git. A raiz existe fora de `dist` e do web root. Nenhum arquivo
real foi adicionado e nenhum recurso cloud foi ativado.

## Evidência de validação

- 693 testes em 58 arquivos;
- cobertura de 100%: 1316/1316 statements, 1049/1049 branches, 277/277
  functions e 1196/1196 lines;
- 193 asserts pgTAP em 9 arquivos e 30 contratos PostgreSQL em 8 arquivos;
- concorrência comprovada: limite 2 aceita exatamente duas autorizações e nega
  a terceira;
- fluxo real em Compose aprovado: conta sintética, catálogo, download e outcome
  `delivered` ligados aos cinco IDs exatos, sem dado externo;
- revisão em navegador a 390 × 844 confirmou largura 390/390 sem overflow,
  ação com 44 px e zero erro de console;
- lint, typecheck, build e configuração Compose aprovados;
- backup/restore e os fluxos one-shot de worker e dispatcher aprovados em banco
  descartável recém-criado;
- Terraform 1.14.9 aprovado em `fmt`, `init -backend=false`, `validate` e três
  testes; TFLint e Checkov aprovados, com 9 checks de infraestrutura;
- os dois Dockerfiles passaram na validação de segurança e boas práticas; as
  imagens de aplicação, renderer e PostgreSQL têm zero vulnerabilidade
  corrigível `HIGH` ou `CRITICAL` no Trivy 0.74.0;
- secret scan sem achados; `npm audit` sem vulnerabilidade alta ou crítica (há
  9 moderadas transitivas de Firebase/toolchain, fora do runtime de entrega);
- os três workflows passaram no Actionlint e a action de dependency review foi
  atualizada para a versão principal vigente, mantendo SHA completo fixado;
- custo incremental R$ 0, sem GCS, fila, job, workflow, dado real, secret,
  commit, push ou deploy.

## Decisão arquitetural

Não foi necessário novo ADR. O gate executa os ADRs 0002, 0012 e 0016: acesso
por IDs internos, plano de controle tenant-scoped, objeto fora do banco e
transações curtas. As práticas de PostgreSQL/Supabase guiaram constraints,
índices de FK, RLS, privilégios e lock atômico; o threat model definiu o
fail-closed do adapter e da auditoria.

## Próximo gate

Implementar materialização controlada de documentos públicos: job idempotente,
conector oficial, quarentena, abstração de malware scan, gravação atômica do
artefato e reconciliação banco ↔ objeto, ainda com fixture local. GCS só poderá
substituir o adapter após nova autorização explícita, avaliação de custo,
Terraform, bucket privado, lifecycle, IAM mínimo, alertas e teste de remoção.
Exportação em lote permanece posterior à materialização; Workflows continua
sem necessidade neste estágio.
