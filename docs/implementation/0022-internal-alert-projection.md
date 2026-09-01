# Implementação 0022 — alertas internos idempotentes

**Status:** implementada e validada localmente  
**Data:** 31 de agosto de 2026  
**Custo:** [0025](../costs/0025-local-internal-alert-projection.md)  
**Spec:** [0018](../specs/0018-internal-alert-projection.md)  
**Decisões:** [ADR 0013](../adr/0013-transactional-outbox-and-idempotent-jobs.md) e [ADR 0021](../adr/0021-tenant-private-evidence-first.md)

## Resultado

O dispatcher possui agora um efeito local concreto: eventos persistidos de
conclusão são projetados em alertas de descoberta. O consumidor reconstrói a
relação entre execução, perfil, evidência canônica e processo dentro do banco;
o payload da outbox continua mínimo e não transporta nome, CPF/CNPJ ou texto
processual.

Cada alerta aponta para o `caseId` e o perfil corretos, traz CNJ, tribunal e data
da fonte, e declara `matchStatus = unverified`. Ele não afirma existir uma
movimentação específica porque a linha do tempo canônica ainda não faz parte
deste marco.

## Consistência e idempotência

- efeito e `consumer_inbox_receipts` são gravados na mesma transação;
- o recibo é único por `internal-alert-projector-v1/eventId`;
- a deduplicação inclui tenant, evento de origem, perfil, concessão do processo
  e tipo do alerta;
- payload, tenant, tipo e aggregate recebidos são comparados ao evento
  persistido e ao lease vigente;
- chamadas concorrentes e replay após falha de ack retornam sem duplicar;
- eventos sem efeito conhecido recebem recibo, sem gerar conteúdo fictício.

## API privada

- `GET /api/v1/alerts` lista `all`, `unread` ou `read` com limite máximo 100;
- cursor opaco representa `(createdAt, alertId)` e mantém paginação keyset
  estável;
- `PATCH /api/v1/alerts/{alertId}/read` marca leitura de forma idempotente;
- autenticação, rate limit, `private, no-store` e erros estáveis são aplicados;
- ID inexistente e ID de outro tenant produzem o mesmo resultado não encontrado.

## Fronteiras de banco

- `alerts` usa RLS forçada e não concede acesso direto a runtime, worker ou
  dispatcher;
- FKs compostas impedem misturar perfil, tenant-case e processo de tenants
  diferentes;
- funções `SECURITY DEFINER` usam `search_path = ''` e privilégios mínimos;
- índice composto cobre a paginação e índice parcial cobre a caixa não lida;
- índices dos FKs evitam custo imprevisível em manutenção referencial.

Essas escolhas seguem as práticas de PostgreSQL/Supabase adotadas pelo projeto:
RLS como defesa em profundidade, grants estreitos, índices compostos alinhados
às consultas, índice parcial para o subconjunto ativo e paginação keyset.

## Evidência de validação

- TDD demonstrado pelos testes inicialmente ausentes e depois verdes;
- 504 testes locais em 48 arquivos, com 100% de statements, branches, functions
  e lines no núcleo monitorado;
- 150 asserts pgTAP em 6 arquivos;
- 21 contracts PostgreSQL em 5 arquivos;
- projeção concorrente, replay, payload adulterado, tenant estrangeiro,
  paginação, leitura repetida e negação de acesso direto verificados;
- schema recriado do zero e build de produção aprovados;
- nenhum serviço externo acessado e custo incremental de fornecedor igual a
  zero.

## Próximo gate

Adicionar a linha do tempo canônica (`case_events` + evidência) antes de emitir
alertas de movimentação/publicação. Depois, integrar a caixa de alertas ao
frontend. E-mail/Brevo permanece fora do escopo até custo, consentimento,
preferência verificada e idempotência do canal serem aprovados.

