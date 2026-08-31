# Spec 0019 — linha do tempo canônica com evidência

Status: aprovada para implementação local.

## Objetivo

Persistir publicações/eventos com identidade estável, procedência verificável e
ordenação determinística, permitindo que o painel e os alertas abram exatamente
o processo e evento corretos.

## Contrato da observação v1

Além da identidade processual da spec 0015, cada observação contém:

- `eventType = publication`;
- `externalEventKey` explícita, sem derivação por nome ou texto;
- `occurredAt` original da fonte, nunca substituído por `collectedAt`;
- `title` em texto plano entre 1 e 200 caracteres;
- `plainTextExcerpt` opcional, já decodificado e limitado a 500 caracteres;
- IDs opacos para `CaseEvent` e `EventEvidence` gerados pelo repositório.

HTML não é armazenado nem executado. Adapter real futuro deve decodificar
entidades e remover marcação antes de construir a observação. Script, URL,
participante, CPF/CNPJ e documento não entram neste contrato.

## Persistência

1. `case_events` pertence ao mesmo tenant e `CaseRecord`.
2. A identidade é única por `(tenant, source, externalEventKey)`.
3. Replay idêntico reutiliza o evento; mudança de processo, data, tipo, título,
   trecho ou hash para a mesma chave falha fechada.
4. `event_evidence` liga evento e envelope do mesmo tenant; a relação inicial é
   `supports`.
5. A conclusão do worker persiste evidência, processo, evento e outbox na mesma
   transação.
6. O alerta de descoberta referencia `case_event_id`; combinação
   evento/perfil/processo permanece idempotente.

## Consulta

- `GET /api/v1/cases/{caseId}/events` é autenticado e tenant-scoped;
- paginação keyset usa `(occurredAt desc, caseEventId desc)` e cursor opaco;
- cada item informa tipo, título, trecho mínimo, data original e procedência
  (`sourceId`, oficialidade e `collectedAt`);
- processo inexistente e processo de outro tenant são indistinguíveis;
- limite máximo é 100 e nenhuma consulta usa `OFFSET`.

## Segurança

- RLS forçada em todas as tabelas novas;
- runtime e worker não recebem acesso direto;
- FKs incluem tenant e colunas filhas são indexadas;
- funções `security definer` têm `search_path` vazio e grants mínimos;
- logs/outbox não recebem CNJ, título, trecho ou chave externa.

## Critérios de aceite

- eventos iguais em replays e execuções posteriores não duplicam;
- mesma chave externa com fatos conflitantes é rejeitada atomicamente;
- eventos de CNJs diferentes nunca se unem;
- ordenação e paginação não pulam nem repetem eventos;
- alerta abre o `caseId` e `caseEventId` correspondentes;
- tenant estrangeiro não lista nem altera os dados;
- TDD, cobertura 100%, pgTAP, contracts, restore e scans permanecem verdes;
- custo externo permanece zero.

## Fora do escopo

- adapter/crawler real, movimentações sem chave oficial e conteúdo integral;
- documentos, participantes, classificação por IA e explicação jurídica;
- envio de e-mail ou deploy remoto.

