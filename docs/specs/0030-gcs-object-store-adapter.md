# Spec 0030 — object storage GCS tenant-private

**Status:** implementada localmente; rollout não autorizado  
**Data:** 31 de agosto de 2026  
**Custo:** [Avaliação 0037](../costs/0037-gcs-object-store-adapter.md)  
**Decisões:** [ADR 0023](../adr/0023-two-stage-managed-foundation-activation.md)  
**Threat model:** [0009](../security/0009-managed-foundation-threat-model.md)

## 1. Objetivo

Permitir que API, materializador de documentos e worker de ciclo de vida usem o
bucket GCS privado da fundação, preservando os mesmos contratos do filesystem
local. O adapter não ativa cloud por presença de variável e não altera o modo
local usado por desenvolvimento/Compose.

## 2. Modos explícitos

| Workload | Modo local | Modo GCS | Bucket |
|---|---|---|---|
| API/download/export | `DOCUMENT_DELIVERY_MODE=local` | `gcs` | `DOCUMENT_GCS_BUCKET` |
| materializador | `local-fixture` | `gcs-fixture` | `DOCUMENT_MATERIALIZATION_BUCKET` |
| lifecycle | `local` | `gcs` | `TENANT_LIFECYCLE_GCS_BUCKET` |

O modo desativado rejeita qualquer variável relacionada. Modo local rejeita
bucket e modo GCS rejeita path local. Bucket é um nome lowercase de 3–63
caracteres, não URL, locator, projeto, credencial ou caminho.

## 3. Namespaces e contratos

- PDF: `documents/tenant/{tenantId}/{documentId}/{artifactId}.pdf`;
- exportação: `exports/{tenantId}/{requestId}/{artifactId}.json`;
- todos os IDs são UUIDs canônicos aceitos pelo domínio;
- nenhum nome, CPF/CNPJ, CNJ, título ou URL integra o object ID;
- nenhum método lista bucket ou resolve prefixo por similaridade;
- API expõe apenas leitura de PDF/export autorizado pelo banco;
- materializador cria PDF depois do scanner;
- lifecycle cria/lê exportações e apaga somente locators allowlisted.

## 4. Integridade e concorrência

1. criação usa CRC32C e `ifGenerationMatch=0`;
2. `sha256:<hex>` fica em custom metadata, nunca em nome público;
3. retry com objeto existente baixa uma geração imutável e só conclui se bytes,
   tamanho, tipo e SHA-256 coincidirem integralmente;
4. leitura busca metadata primeiro, rejeita tamanho acima do limite e fixa a
   geração antes do download;
5. deleção fixa a geração e aplica precondition; ausência é sucesso idempotente;
6. erro do provider é traduzido para erro sem token, bucket, path ou detalhe.

## 5. Autenticação e IAM

O SDK usa Application Default Credentials do workload. Chave JSON, URL assinada
e segredo de storage não são aceitos por configuração.

- API: `roles/storage.objectViewer`;
- materializador: `objectCreator` + `objectViewer`, somente para criar e
  verificar retries; não apaga nem sobrescreve;
- lifecycle: `roles/storage.objectUser`, pois expira e elimina objetos;
- service agent do GCS: acesso à chave CMEK.

## 6. Critérios de aceite

- configuração default continua desativada e local continua compatível;
- testes provam namespace, limites, hash, tipo, geração e erros sanitizados;
- retries idempotentes não aceitam objeto divergente;
- composition roots nunca selecionam GCS implicitamente;
- Terraform testa as quatro bindings mínimas;
- cobertura permanece 100% no escopo protegido;
- zero chamada externa, segredo ou custo durante os testes.

## 7. Fora do escopo

- `terraform apply`, criação de bucket/objeto ou conexão sandbox;
- fonte judicial real, malware scanner gerenciado e Scheduler;
- signed URLs, exposição pública, listagem e download em lote;
- Supabase, Infisical Secret Sync, Brevo e deploy.

