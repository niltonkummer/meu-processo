# Implementação 0019 — evidência processual local reconstruível

**Status:** implementada e validada localmente  
**Data:** 31 de agosto de 2026  
**Custo:** [0022](../costs/0022-local-case-evidence-foundation.md)  
**Spec:** [0015](../specs/0015-local-case-evidence-foundation.md)  
**Decisão:** [ADR 0021](../adr/0021-tenant-private-evidence-first.md)

## Resultado

A conclusão do worker agora persiste, na mesma transação, o recibo da execução,
um envelope tenant-private, a observação canônica versionada, o processo mínimo,
a referência externa, o grant `TenantCase`, o novo estado do agendamento e a
outbox. O DJEN continua desabilitado e nenhuma fonte externa foi consultada.

O contrato da fonte aceita somente external ID, SHA-256, versões de parser e
schema, CNJ, tribunal e data. Nome, CPF/CNPJ, label, ciphertext, texto, URL,
payload e documento não atravessam a fronteira de evidência.

## Consistência e reconstrução

- envelope deduplica por tenant, fonte, external ID e hash;
- parser v2 cria nova observação append-only sobre o mesmo envelope;
- processo deduplica por tenant e CNJ;
- referência externa não pode ser remapeada para outro processo;
- replay idêntico não cria novo efeito;
- mudança conflitante de CNJ/tribunal falha e reverte a transação;
- a projeção v1 pode ser reconstruída agrupando observações por tenant e CNJ.

## Segurança

As cinco tabelas novas usam PK/FK tenant-scoped, RLS habilitada e forçada e
ownership de `app_migrator`. `app_worker` não possui acesso direto. A função de
recibos anterior foi rebaixada a helper interno sem grant; a única conclusão
exposta ao worker exige evidência canônica válida. A outbox continua contendo
somente IDs internos e contagens.

## Evidência de validação

- 442 testes de aplicação/UI em 40 arquivos, com 100% de statements, branches,
  functions e lines no núcleo monitorado;
- 101 asserts pgTAP em 4 arquivos;
- 12 contracts PostgreSQL em 2 arquivos;
- banco criado do zero e restore lógico aprovados;
- replay, duplicata na mesma execução, parser v2 e mesmo CNJ em tenants distintos
  verificados;
- worker one-shot retorna zero claims com fontes reais desabilitadas;
- lint, tipos, build, Compose, workflow, ShellCheck, audit de severidade alta,
  secret scan e scan HIGH/CRITICAL da imagem aprovados;
- 1.000 observações sintéticas ocuparam 2,10 MiB nas seis tabelas/índices medidos;
- custo adicional de fornecedor: US$ 0.

## Próximo gate

A projeção de leitura paginada e autorizada por `TenantCase` foi entregue pela
[Implementação 0020](./0020-persisted-case-portfolio.md), sem expor o plano de
evidência diretamente. Eventos/publicações, payload em GCS, evidência global e
adapter de fonte real continuam sujeitos a specs, threat model e custos
próprios.
