# Spec 0018 — alertas internos persistidos e idempotentes

Status: aprovado para implementação local.

## Objetivo

Transformar uma conclusão de monitoramento já persistida em alertas de
descoberta no painel, sem duplicidade e sem confundir descoberta com
movimentação processual confirmada.

## Contrato funcional

1. `monitoring.execution.completed.v1` pode produzir um alerta para cada
   combinação distinta de perfil monitorado e processo observado na execução.
2. O alerta referencia IDs internos de perfil, concessão do processo e processo,
   preservando o isolamento por tenant.
3. O tipo inicial é `case_discovered` e o vínculo permanece `unverified`.
4. O painel recebe somente o rótulo do perfil, CNJ, tribunal, data da fonte e IDs
   necessários para abrir o processo correto; texto integral não é copiado.
5. Reprocessar o mesmo `eventId` não cria outro alerta. O efeito e o recibo do
   consumidor são gravados na mesma transação.
6. Eventos que não geram alertas também recebem recibo idempotente, sem inventar
   conteúdo.
7. A listagem é autenticada, tenant-scoped, limitada e usa cursor opaco com
   ordenação total por `(created_at desc, alert_id desc)`.
8. Marcar como lido é idempotente e não altera evidência, processo ou fato
   oficial. IDs ausentes ou de outro tenant são indistinguíveis.

## Não objetivos

- afirmar que uma movimentação/publicação específica foi encontrada;
- enviar e-mail, push ou WhatsApp;
- usar fila externa, Supabase remoto ou dados reais;
- permitir acesso direto do navegador às tabelas;
- silenciar preferências ou criar uma linha do tempo processual.

## Segurança e consistência

- RLS forçada e funções `security definer` com `search_path` vazio;
- papéis de API e dispatcher sem acesso direto às tabelas;
- FKs compostas garantem que alerta, perfil e processo pertençam ao mesmo
  tenant;
- privilégios mínimos por função;
- payload recebido pelo consumidor é comparado ao evento persistido;
- índice parcial atende a caixa de entrada não lida e índice composto atende à
  paginação keyset;
- nenhum CPF, CNPJ, nome cifrado, documento ou texto processual entra na outbox,
  recibo ou log.

## Critérios de aceite

- projeção concorrente/repetida gera no máximo um alerta;
- falha antes do recibo reverte alerta e recibo juntos;
- tenant A nunca lista ou altera alerta do tenant B;
- cursor, limite, filtro e identificador inválidos falham fechados;
- alerta abre o `caseId` persistido correspondente, mas não expõe um `eventId`
  processual inexistente;
- testes unitários, HTTP, contratos PostgreSQL e pgTAP passam com cobertura
  configurada em 100%.

