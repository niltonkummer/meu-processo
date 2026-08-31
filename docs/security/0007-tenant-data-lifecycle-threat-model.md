# Threat model 0007 — ciclo de vida de dados do tenant

**Status:** aprovado para implementação local  
**Data:** 31 de agosto de 2026  
**Spec:** [0027](../specs/0027-tenant-data-lifecycle.md)

## Ativos e fronteiras

Ativos: identidade, membership, identificador revelável, configurações,
evidência, documentos, export JSON, hash/locator, pedido, lease, tombstone e
prova de exclusão.

Fronteiras: caso de uso autenticado → PostgreSQL; worker dedicado → PostgreSQL;
worker → protetor de identificadores; bytes do export → object store privado;
reconciliação → banco/objetos. Neste gate não há navegador, cloud ou rede.

## Capacidades do atacante

- usuário autenticado tentando exportar ou excluir outro tenant por IDOR;
- membro sem papel suficiente ou token antigo após congelamento;
- worker concorrente tentando concluir com lease alheio/expirado;
- entrada persistida maliciosa tentando escapar o JSON ou caminho do objeto;
- processo local tentando symlink/traversal, overwrite ou leitura de órfão;
- crash entre snapshot, escrita, complete, deleção de objeto e purge;
- operador tentando restaurar backup e ressuscitar conta/dado excluído;
- consumidor de logs tentando obter PII, conteúdo ou locator.

## Abusos e controles

| Abuso | Impacto | Controle obrigatório |
|---|---|---|
| request cross-tenant | vazamento ou destruição | contexto server-side, owner personal, função estreita e teste A/B |
| troca de tenant no payload | IDOR | tenant/user nunca vêm do payload; RLS/FK composta |
| corrida de claims | export/purge duplicado | índice parcial, `SKIP LOCKED`, lease e hash do token |
| token/lease persistido em claro | tomada de job | somente SHA-256, comparação na função, redaction |
| export mistura dados | incidente LGPD | snapshot tenant-bound, schema allowlist e teste sentinela B ausente |
| dump bruto/ciphertext | export inútil e segredo estrutural | DTO versionado; reveal somente em memória; campos proibidos testados |
| path traversal/symlink | escrita/leitura arbitrária | locator derivado de UUID, root canônica, `O_NOFOLLOW`/criação exclusiva |
| export ilimitado | DoS/custo | máximo 10 MiB, batch 10, concorrência 1 e falha fechada |
| download após TTL | retenção excessiva | 24 h, apagar objeto antes de marcar expired e reconciliação |
| nova escrita durante purge | ressurreição/inconsistência | `deleting`, memberships inativas, agenda desativada, deny-by-default |
| cascade amplo/acidental | perda de outro tenant | fases e `tenant_id` explícito em cada operação; sem cascade raiz |
| crash após apagar parcialmente | conta presa/dado órfão | fases idempotentes, retry limitado, tombstone e runbook |
| restore ressuscita exclusão | violação da solicitação | inventário/tombstone pós-restore e backup com lifecycle equivalente |
| logs/telemetria sensíveis | exposição indireta | somente IDs técnicos, tipo, estado e contagens; testes de redaction |
| role excessiva | comprometimento transversal | sem login/ownership/BYPASSRLS/table grants; funções allowlisted |

## Riscos residuais e decisão

O ambiente local não prova deleção física em backups gerenciados, lifecycle do
GCS, legal hold, SLA nem direito de exclusão por fonte oficial. O JSON inicial
pode omitir classes ainda não implementadas, mas deve declarar cada omissão e
nunca se chamar completo. Esses riscos são aceitos somente para dados sintéticos
e sem endpoint/deploy.

Ativar piloto exige revisão jurídica, autenticação recente, confirmação,
notificação, políticas Supabase/GCS, DPA, RPO/RTO, restore pós-exclusão e resposta
a incidente testados.

## Evidência exigida

- pgTAP de RLS, grants, constraints, FKs e índices;
- contratos de idempotência, lease, retry, expiração e redaction;
- E2E A/B de exportação e purge sem tocar B;
- testes de objeto órfão/symlink/tamanho/TTL;
- restore sintético sem reativação;
- secret, dependency, SAST e container scans antes do fechamento.
