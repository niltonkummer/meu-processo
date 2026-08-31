# Spec 0023 — entrega individual segura de documento persistido

**Status:** aprovada para implementação local  
**Data:** 31 de agosto de 2026  
**Custo:** [0030](../costs/0030-local-individual-document-delivery.md)  
**Decisões:** [ADR 0002](../adr/0002-multiuser-modes-and-document-delivery.md),
[ADR 0012](../adr/0012-tenant-control-and-evidence-planes.md) e
[ADR 0016](../adr/0016-managed-supabase-postgres.md)

## Objetivo

Permitir que a pessoa autenticada baixe um único PDF já materializado no
catálogo persistido, sem revelar endereço, URL ou caminho de storage e sem
misturar processo, documento, artefato, usuário ou tenant.

Este gate entrega somente arquivos `public_official`. Documento `restricted` ou
`unknown` exige uma futura política de credencial/consentimento da fonte e deve
falhar como não encontrado.

## Fluxo normativo

1. o navegador solicita somente `caseId` e `documentId` e obtém um token novo;
2. a API autentica novamente e resolve o tenant pessoal server-side;
3. uma função transacional do PostgreSQL comprova membership, processo,
   documento e artefato atual no mesmo tenant;
4. a mesma função consome atomicamente a quota e grava uma autorização imutável;
5. somente então o repository recebe o ponteiro opaco do objeto;
6. o adapter lê o objeto dentro de uma raiz privada configurada pelo servidor;
7. a aplicação confere limite, tamanho exato, MIME, assinatura `%PDF-` e SHA-256;
8. o resultado é registrado em auditoria e o PDF é enviado como attachment.

Nenhuma chamada a storage ocorre dentro da transação do PostgreSQL. O browser
nunca fornece `artifactId`, `storage_object_id`, URL, nome de arquivo ou caminho.

## Contrato HTTP

`GET /api/v1/cases/{caseId}/documents/{documentId}/content`

- `Authorization: Bearer <token>` é obrigatório em toda tentativa;
- query string, body e parâmetros adicionais são rejeitados;
- sucesso retorna `application/pdf`, `Content-Disposition: attachment`, tamanho
  exato, `Cache-Control: private, no-store`, CSP sandbox e `nosniff`;
- `401` para sessão ausente/inválida;
- `404` uniforme para ID inválido, processo/documento alheio, artefato ausente,
  expirado, removido, não limpo ou classe de acesso não pública;
- `429` com `Retry-After` para quota esgotada;
- `502` genérico para objeto ausente, leitura ou integridade divergente;
- `503` quando o adapter de entrega não está configurado.

O endpoint legado que busca diretamente na fonte oficial continua disponível
somente no fluxo profissional legado. No modo pessoal persistido, esta spec tem
precedência e não faz fallback para URL externa.

## Persistência e quota

`document_download_windows` mantém contador por `tenant_id`, `user_id` e minuto.
O incremento usa `INSERT ... ON CONFLICT ... DO UPDATE ... WHERE consumed <
limit`, garantindo que concorrência não ultrapasse silenciosamente o teto.

`document_download_authorizations` registra autorização, usuário, processo,
documento, artefato, request ID, instante e expiração curta. É append-only.

`document_download_outcomes` registra exatamente um resultado final por
autorização: `delivered`, `object_missing`, `integrity_failed` ou
`storage_failed`. Nenhuma tabela contém bytes, token, nome/CPF/CNPJ, URL ou
conteúdo do documento.

O limite inicial é configuração server-side, padrão 20/minuto e máximo 100.
Entitlements por plano substituirão esse valor em outro gate sem alterar o
contrato do endpoint.

## Adapter local privado

- habilitado somente por raiz absoluta explicitamente configurada;
- raiz precisa existir, ser diretório e ficar fora do web root;
- chave vem apenas do banco e deve obedecer ao namespace tenant-private;
- path traversal, path absoluto, caracteres de controle, symlink e arquivo não
  regular são negados;
- leitura é limitada a 25 MiB antes e durante a operação;
- erro não revela path, chave, hash esperado ou detalhe de filesystem.

## Frontend

- botão é habilitado somente quando o catálogo contém artefato válido;
- cada clique obtém token novo e baixa o `Blob` retornado;
- resposta deve ser PDF e respeitar o tamanho anunciado antes de salvar;
- estado de carregamento impede duplo clique acidental;
- erro é mostrado no cartão exato, sem apagar documentos já carregados;
- modos simples e avançado usam o mesmo `documentId` e a mesma autorização.

## Critérios de aceite

1. autorização, quota e auditoria são atômicas e tenant-scoped;
2. vinte tentativas concorrentes passam e a seguinte falha no limite padrão;
3. processo/documento/artefato cross-tenant jamais fornece ponteiro ou sinal
   distinguível;
4. runtime não lê/escreve as tabelas novas diretamente, apenas executa funções;
5. adapter rejeita traversal, absoluto, symlink, arquivo grande e não regular;
6. conteúdo ausente, HTML disfarçado, tamanho/hash divergente nunca é entregue;
7. cada autorização recebe no máximo um resultado auditado;
8. API renova autenticação, aplica headers privados e não registra conteúdo;
9. frontend valida resposta e associa erro/download ao documento exato;
10. testes unitários, integração PostgreSQL, pgTAP, cobertura 100%, scans e
    guardrails existentes permanecem verdes;
11. nenhum recurso cloud, secret, dado real, commit, push ou deploy é criado.

## Fora do escopo

- GCS, URL assinada, CDN, bucket, lifecycle e scanner real;
- download de documento restrito ou com credencial judicial;
- busca/cópia do arquivo na fonte oficial;
- export job, ZIP, lote, Cloud Tasks, Cloud Run Jobs e Workflows;
- cobrança, planos e entitlements definitivos.
