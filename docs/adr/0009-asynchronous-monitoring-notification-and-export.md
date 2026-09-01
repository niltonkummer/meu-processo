# ADR 0009 — processamento assíncrono para monitoramento, alertas e exportações

**Status:** aceito como direção; provisionamento depende de avaliação por fase
**Data:** 30 de agosto de 2026
**Relacionado:** [Roadmap 0008](../implementation/0008-functional-requirements-roadmap.md)

## Contexto

Coletas, retries por tribunal, notificações e lotes de documentos têm duração e
limites diferentes. Executá-los dentro da requisição do navegador aumenta
timeouts, duplicidade e risco de o usuário repetir operações. Adotar desde já
Workflows, Pub/Sub, Kafka ou um cluster permanente acrescentaria complexidade
antes de volume e múltiplos consumidores.

## Decisão

O fluxo será orientado por jobs idempotentes e estados persistidos:

- Cloud Scheduler dispara a seleção periódica de alvos vencidos;
- inicialmente o worker processa lotes pequenos direcionados;
- Cloud Tasks será introduzido quando houver retry/rate limit por alvo, fonte,
  documento ou notificação;
- Cloud Run Jobs será usado somente para empacotamentos que não cabem em uma
  requisição curta;
- cada job possui tenant, alvo, chave idempotente, estado, tentativas, prazo,
  resultado parcial e correlação, sem conteúdo sensível em logs;
- alertas e webhooks têm chave de entrega e não duplicam no retry;
- exportações geram manifesto, hashes, erros parciais e expiração automática.

Google Cloud Workflows, Pub/Sub, Redis, Kafka e Kubernetes não entram nas fases
iniciais. Pub/Sub será reconsiderado quando existirem vários consumidores
independentes do mesmo evento. Workflows será reconsiderado para backfills
longos com dependências, compensações e aprovações.

## Consequências

- A interface recebe um `jobId` e acompanha progresso sem conexão longa.
- Falha parcial pode ser retomada e auditada.
- Retry respeita fonte e não duplica alerta/documento.
- Estados assíncronos e limpeza precisam de testes e observabilidade.
- Cloud Tasks/Jobs são novos SKUs e só podem ser provisionados após custo e IaC
  aprovados; esta ADR isoladamente não os autoriza.

## Alternativas consideradas

- **Tudo síncrono:** rejeitado para lotes e fontes instáveis.
- **Workflows desde o MVP:** rejeitado por não existir fluxo complexo que o
  justifique.
- **Pub/Sub desde o MVP:** rejeitado enquanto há um único pipeline/consumidor.
- **Redis como fila:** rejeitado por custo fixo e semântica operacional inferior
  à fila gerenciada para este caso.
- **Cron por usuário:** rejeitado por custo, concorrência e duplicação; um
  agendador seleciona alvos únicos vencidos.

## Revisão

Revisar quando houver mais de um consumidor independente, backfill multi-etapa,
limites de Tasks/Jobs atingidos ou requisito de orquestração humana/compensação.
