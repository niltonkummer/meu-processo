# Implementação 0023 — linha do tempo canônica por processo

**Status:** implementada e validada localmente  
**Data:** 31 de agosto de 2026  
**Custo:** [0026](../costs/0026-local-canonical-case-timeline.md)  
**Spec:** [0019](../specs/0019-canonical-case-timeline.md)  
**Decisões:** [ADR 0013](../adr/0013-transactional-outbox-and-idempotent-jobs.md), [ADR 0020](../adr/0020-worker-trigger-and-privilege-boundary.md) e [ADR 0021](../adr/0021-tenant-private-evidence-first.md)

## Resultado

Cada observação aceita pelo worker pode agora materializar um evento canônico
do processo, com tipo, chave externa, data de ocorrência, título, trecho em
texto simples e hash de conteúdo. O evento mantém vínculo explícito com o
envelope oficial que o sustenta; ele não é inferido por similaridade de nome.

A API privada expõe `GET /api/v1/cases/{caseId}/events`, em ordem cronológica
reversa e com cursor opaco. O mesmo evento é usado pela projeção de alertas:
`caseEventId` identifica exatamente a publicação que originou o alerta, evitando
mistura entre processos, perfis ou observações da mesma execução.

## Consistência e proveniência

- conclusão, evidência do processo, evento canônico, vínculo com envelope e
  outbox permanecem na mesma transação;
- replays idênticos são idempotentes e uma chave externa que muda fatos
  canônicos falha fechada;
- a projeção de alerta percorre execução, receipt, envelope, observação,
  processo, concessão e evento-evidência antes de criar o efeito;
- efeito e recibo do consumidor continuam atômicos;
- a leitura de alerta devolve o ID exato mesmo quando ele já está fora das 101
  entradas mais recentes, coberto por teste de regressão.

## Fronteiras de banco e consulta

- `case_events` e `event_evidence` usam RLS forçada e acesso direto negado às
  identidades de runtime, worker e dispatcher;
- FKs compostas por tenant impedem vínculos cruzados e possuem índices de
  suporte;
- o índice `(tenant_id, case_id, occurred_at desc, case_event_id desc)` atende
  ao filtro e à paginação keyset sem offset;
- alertas têm FK tenant-scoped para o evento e índice parcial para não lidos;
- funções `SECURITY DEFINER` fixam `search_path = ''` e recebem apenas os grants
  mínimos de cada papel.

Essas escolhas seguem as práticas PostgreSQL/Supabase adotadas pelo projeto:
índices compostos alinhados à consulta, índice parcial para o subconjunto
ativo, índices de FKs, RLS como defesa em profundidade, menor privilégio e
paginação keyset.

## Evidência de validação

- 527 testes locais em 49 arquivos, com 100% de statements, branches, functions
  e lines no núcleo monitorado;
- 167 asserts pgTAP em 7 arquivos;
- 24 contratos PostgreSQL em 6 arquivos;
- concorrência, replay, conflito de fatos, isolamento de tenant, paginação,
  acesso direto negado e alerta antigo verificados;
- banco recriado do zero, restore lógico e worker/dispatcher one-shot aprovados;
- Compose, Actionlint, ShellCheck, Terraform, Checkov, Hadolint e diff check
  aprovados;
- scan de segredos sem achados e imagem final com zero vulnerabilidades
  HIGH/CRITICAL corrigíveis;
- auditoria sem high/critical; permanecem nove findings moderados transitivos já
  conhecidos na cadeia das ferramentas Firebase;
- nenhuma fonte, Supabase, GCP, Infisical ou Brevo foi acessada; custo externo
  incremental igual a zero.

## Próximo gate

Integrar a caixa de alertas e a linha do tempo persistida ao frontend, mantendo
um único modelo de fatos nos modos simples e profissional. A seguir, documentos
podem referenciar `caseEventId` e `event_evidence` sem depender de associação
por texto. Notificação por e-mail e ativação de fontes reais continuam exigindo
avaliações próprias de custo, privacidade, consentimento, quota e rollout.
