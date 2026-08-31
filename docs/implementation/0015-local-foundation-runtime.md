# Implementação 0015 — runtime local da fundação

**Status:** implementado e verificado  
**Data:** 30 de agosto de 2026  
**Custo:** [0019](../costs/0019-local-protected-identifiers-and-api.md)  
**Spec:** [0013](../specs/0013-protected-monitored-identifiers.md)

## Resultado

A API real deixa de responder “não configurado” quando o modo PostgreSQL é
explicitamente habilitado. O runtime conecta, em um único composition root:

1. pool PostgreSQL limitado;
2. repository com RLS e transações tenant-bound;
3. identidade Firebase para UUID interno estável;
4. HMAC/AES-GCM com versões de chave;
5. serviço autenticado de cadastro, listagem e arquivamento.

O padrão continua sendo `FOUNDATION_MODE=disabled`. Em modo `postgres`, startup
rejeita URL não PostgreSQL, credenciais ausentes, pool fora de 1–20, versão
inválida, JSON de chaves malformado, chave ativa ausente e chave que não seja
Base64URL canônica de exatamente 32 bytes. A mensagem de erro contém somente o
nome do campo, nunca seu valor.

## Contrato operacional

| Variável | Regra |
|---|---|
| `FOUNDATION_MODE` | `disabled` ou `postgres` |
| `DATABASE_URL` | URL PostgreSQL com usuário/senha; TLS query somente `require`, `verify-ca` ou `verify-full` |
| `DATABASE_POOL_MAX` | inteiro de 1 a 20; padrão 5 |
| `IDENTIFIER_ACTIVE_KEY_VERSION` | versão `vN` presente no keyring |
| `IDENTIFIER_ENCRYPTION_KEYS_JSON` | objeto de até oito versões e chaves Base64URL de 32 bytes |
| `IDENTIFIER_BLIND_INDEX_VERSION` | versão `vN` |
| `IDENTIFIER_BLIND_INDEX_KEY_BASE64URL` | chave Base64URL de 32 bytes |

No Compose, valores são fixtures locais públicas. Produção deve injetar valores
reais do vault sem incorporá-los à imagem ou ao frontend.

## Evidência

- 372 testes em 36 arquivos e 100% no núcleo monitorado;
- lint, tipos, build e `docker compose config` aprovados;
- pgTAP 34/34, contract PostgreSQL 7/7 e restore aprovados;
- runtime real: create 201, list 200, archive 200;
- segundo usuário recebeu zero itens, provando isolamento observável;
- inspeção do banco: zero plaintext, ciphertext AES e blind index HMAC versionados;
- Trivy: zero segredos e zero HIGH/CRITICAL corrigíveis na imagem;
- `npm audit --audit-level=high`: zero high/critical; nove moderados transitivos
  conhecidos na cadeia Firebase/Firebase Tools.

## Ainda não realizado

Nenhum recurso Supabase, Infisical, GCP, Brevo ou tribunal foi alterado. Não houve
deploy, commit ou push. O painel já usa a API e remove o payload legado conforme
[Implementação 0016](./0016-protected-profile-dashboard.md). Ainda faltam worker,
políticas operacionais e serviços gerenciados antes de usar dados reais.
