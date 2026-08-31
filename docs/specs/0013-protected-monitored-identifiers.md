# Spec 0013 — identificadores monitorados protegidos

**Status:** implementada e verificada no runtime local  
**Data:** 30 de agosto de 2026  
**Custo:** [0019](../costs/0019-local-protected-identifiers-and-api.md)  
**Decisão:** [ADR 0019](../adr/0019-tenant-bound-identifier-protection.md)
**Implementação:** [0014](../implementation/0014-protected-identifiers-core.md),
[0015](../implementation/0015-local-foundation-runtime.md) e
[0016](../implementation/0016-protected-profile-dashboard.md)

## Resultado esperado

Produzir um `MonitoredSubjectInput` seguro a partir de nome, CPF ou CNPJ validado:

- `displayLabel` minimizado, sem nome completo ou documento integral;
- `protectedReference` HMAC tenant-bound para igualdade;
- `encryptedValue` AES-256-GCM autenticado;
- `keyVersion` explícita;
- nenhum plaintext em retorno do repository/listagem.

Para nomes, a forma cifrada preserva a grafia normalizada necessária ao DJEN. A
forma canônica do blind index usa NFKD, remoção de marcas, uppercase e espaços
normalizados, tornando diferenças de caixa/acento equivalentes. CPF/CNPJ usam
somente dígitos e seus checksums existentes.

## Casos observáveis

1. Mesmo tenant/tipo/forma canônica gera o mesmo blind index.
2. Tenant ou tipo diferente gera blind index diferente.
3. Duas proteções do mesmo valor geram ciphertexts distintos.
4. Revelação correta recupera apenas o valor normalizado.
5. Alterar envelope, tenant, tipo, versão ou AAD falha sem plaintext parcial.
6. Nome mostra somente iniciais extrema; CPF/CNPJ mostram somente dois dígitos.
7. Entrada inválida falha antes da criptografia ou repository.
8. Chave ausente, curta, longa ou versão desconhecida falha no startup/uso.

## Persistência e API

Migration 0003 adiciona ciphertext e key version com constraints de formato,
mantendo RLS forçada e unicidade tenant/type/blind-index. Repository não retorna
blind index/ciphertext em modelos de listagem. A API aceita corpo JSON estrito,
Bearer token, limite de 16 KiB, IDs UUID opacos e paginação limitada; respostas
são `private, no-store` e contêm apenas rótulo minimizado. Cadastro, listagem e
arquivamento com concorrência otimista (`If-Match`) estão disponíveis.

## TDD e aceite

- testes de aplicação cobrem nome/CPF/CNPJ, canonicalização e erros;
- adapter criptográfico cobre round-trip, não determinismo do ciphertext,
  separação por tenant/tipo e tampering;
- contracts memory/PostgreSQL provam idempotência e ausência de campos protegidos;
- pgTAP prova constraints, grants e RLS;
- HTTP prova autenticação, validação, cross-tenant e redaction;
- application/domain mantêm 100% de cobertura;
- lint, tipos, build, restore, secret/SCA/SAST/container scans passam.

## Fora de escopo

Chaves reais, vault, Supabase gerenciado, rotação/backfill real, busca parcial,
fonte judicial, deploy, dados pessoais reais e logs de auditoria externos.
