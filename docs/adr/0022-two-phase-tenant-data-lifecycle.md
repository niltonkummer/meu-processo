# ADR 0022 — exportação temporária e exclusão de tenant em duas fases

**Status:** aceito  
**Data:** 31 de agosto de 2026  
**Relacionado:** [Spec 0027](../specs/0027-tenant-data-lifecycle.md)

## Contexto

Exportar dentro de uma requisição HTTP prende conexão e memória, enquanto apagar
todas as relações e objetos em uma transação longa aumenta lock, timeout e risco
de estado parcial. Por outro lado, apagar primeiro e registrar depois perde a
trilha; manter acesso durante o purge permite novas escritas concorrentes.

## Decisão

Solicitações são registros duráveis tenant-bound. Exportação e exclusão rodam em
worker com claim/lease/retry. A exportação produz JSON versionado em storage
privado, por no máximo 24 horas, e persiste apenas locator opaco, hash, tamanho e
estado.

Exclusão usa duas fases: `freeze` transacional muda o tenant para `deleting`,
revoga memberships e agenda; `purge` idempotente remove agregados privados e
objetos antes de marcar `deleted`. Um tombstone sem PII preserva a prova da ação.
Tenant atual continua sendo resolvido server-side, RLS permanece forçada e a
role do worker só executa funções allowlisted.

Até revisão jurídica por fonte, evidência permanece tenant-private e é apagada.
Uma futura base oficial compartilhada deverá preservar o fato público e remover
somente grants/projeções privadas.

## Consequências

- acesso é interrompido imediatamente sem depender do tempo do purge;
- crash e repetição são recuperáveis e não duplicam export/efeito;
- export não ocupa a conexão HTTP e pode ganhar ZIP/documentos no futuro;
- o banco mantém linhas técnicas mínimas após exclusão;
- conta congelada não é reativada automaticamente após falha;
- lifecycle cloud, backup e legal hold ainda bloqueiam produção.

## Alternativas

- **Export síncrono por HTTP:** rejeitado por timeout, memória e resposta parcial.
- **`DELETE CASCADE` do tenant:** rejeitado por blast radius, falta de tombstone e
  impossibilidade de reconciliar objetos externos com segurança.
- **Uma transação para banco e storage:** rejeitada porque storage não participa
  da transação PostgreSQL.
- **Soft delete indefinido:** rejeitado porque não atende minimização/exclusão.
- **Fila cloud agora:** rejeitada; a state machine local prova o contrato antes
  de criar custo e dependência operacional.

## Revisão

Revisar antes do endpoint público, de organizações, de evidência global e da
ativação Supabase/GCS. Cada revisão exige custo, threat model e restore próprios.
