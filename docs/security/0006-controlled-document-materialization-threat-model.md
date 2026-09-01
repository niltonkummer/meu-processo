# Threat model 0006 — materialização controlada de documentos

**Status:** aprovado para implementação local  
**Data:** 31 de agosto de 2026  
**Spec:** [0024](../specs/0024-controlled-document-materialization.md)

## Ativos e fronteiras

Ativos: membership, vínculo processo/documento, metadado oficial, bytes em
quarentena, objeto publicado, hash, lease, outcome e trilha de auditoria.

Fronteiras: navegador → API; API → PostgreSQL; worker → PostgreSQL; worker →
adapter de fonte; bytes não confiáveis → quarentena/scanner; quarentena → object
store privado. Neste gate não existe fronteira de rede no adapter.

## Capacidades do atacante

- usuário autenticado tentando enumerar ou preparar documento de outro tenant;
- processo concorrente tentando completar job com lease/token alheio;
- fonte/fixture fornecendo shape, MIME, tamanho ou bytes maliciosos;
- processo local capaz de trocar arquivo por symlink ou alterar diretórios;
- crash deliberado entre fetch, stage, publish e commit;
- operador tentando habilitar modo local com roots perigosas ou ilimitadas.

## Abusos e controles

| Abuso | Impacto | Controle obrigatório |
|---|---|---|
| IDOR/cross-tenant no pedido | exposição ou gasto em documento alheio | contexto server-side, FKs compostas, função tenant-scoped e 404 uniforme |
| job duplicado ou corrida | download/custo/artefato duplicado | unique tenant/document, upsert atômico, `SKIP LOCKED` e lease |
| token de lease roubado no banco | conclusão forjada | persistir somente SHA-256, comparar dentro da função e nunca logar token |
| SSRF por URL de documento | acesso a metadata/LAN | browser não envia URL; adapter local não possui rede; registry allowlisted |
| traversal/symlink | leitura/escrita fora da raiz | UUID allowlist, locator derivado, realpath/lstat, `O_NOFOLLOW`, `O_EXCL` |
| arquivo ativo ou bomba de memória | execução/DoS | PDF attachment, assinatura, MIME, limite 25 MiB antes/durante, batch 10 |
| conteúdo infectado | arquivo nocivo entregue | quarantine primeiro, scanner obrigatório, publish somente `clean` |
| scanner local confundido com produção | falsa garantia | modo denominado fixture, docs explícitas e cloud bloqueada sem scanner real |
| TOCTOU/overwrite | objeto trocado ou corrompido | arquivo exclusivo `0600`, fsync, rename atômico, hash/tamanho pós-operação |
| crash após publish | órfão ou duplicidade | ID/locator determinístico, target idempotente e DB continua deny-by-default |
| erro interno refletido | vazamento de path/fonte | códigos allowlisted e mensagens genéricas; métricas sem identificadores |
| privilégio excessivo | comprometimento transversal | role dedicada sem table grants/RLS bypass; funções `security definer` fixas |

## Decisão de risco residual

O scanner determinístico não detecta malware real e a fixture não prova
compatibilidade com tribunais. O risco é aceito exclusivamente porque não há
dado externo, usuário público ou deploy. Ativar fonte real/GCS exige novo threat
model para SSRF/DNS rebinding, redirects, TLS, decompression bombs, engine AV,
retenção, egress, exclusão e resposta a incidente.

## Evidência exigida

- testes cross-tenant, privilégio e concorrência no PostgreSQL;
- testes de path/symlink/arquivo grande e publicação idempotente;
- testes de falha em cada transição e reconciliação pós-publish;
- confirmação de zero chamada de rede no fluxo Compose;
- secret scan, dependency scan e container scan antes do fechamento.

