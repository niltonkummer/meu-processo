# Avaliação de custo 0007 — consulta autenticada sem verificação de e-mail

<!-- infra-cost-assessment:v1 -->

**Status:** aprovado para implementação e rollout de validação
**Solicitado por:** proprietário do produto
**Responsável:** proprietário do produto e engenharia
**Data da avaliação:** 30 de agosto de 2026
**Ambientes afetados:** local e `validation` em `southamerica-east1`
**Spec/issue:** [Spec 0006](../specs/0006-authenticated-access-without-email-verification.md)

**Custo mensal atual (USD):** até US$ 0,38 no cenário de validação já aprovado
**Custo mensal esperado (USD):** até US$ 0,38; nenhuma alteração de infraestrutura ou capacidade
**Custo mensal limite (USD):** US$ 10
**Aprovação:** o pedido “Ainda não foi configurado o envio de email, permita a consulta de processos” aprova a implementação e o rollout desta mudança de custo inalterado em 30/08/2026

## 1. Decisão

Permitir que uma conta autenticada por e-mail e senha consulte processos mesmo
quando o claim `email_verified` ainda for falso. O ID token Firebase válido, o
UID, o e-mail, os limites de taxa e toda autorização server-side continuam
obrigatórios. Login anônimo permanece desabilitado.

A mudança é temporária enquanto o canal de envio e a experiência de verificação
de e-mail não estão configurados. Ela não cria nem altera Cloud Run, Identity
Platform, banco, cache, fila, Storage, rede, e-mail transacional ou qualquer SKU
faturável. A imagem da aplicação será substituída mantendo escala e capacidade.

## 2. Alteração de infraestrutura

| Componente/SKU | Região | Estado atual | Estado proposto | Quantidade | Custo unitário | Delta mensal |
|---|---|---|---|---:|---:|---:|
| Cloud Run da aplicação | `southamerica-east1` | escala a zero, máximo 2 | mesma capacidade; nova imagem | 1 | cobrança por uso já aprovada | US$ 0 de capacidade fixa |
| Identity Platform — e-mail/senha | global | ativo, até 1.000 MAU esperados | sem mudança | 1 projeto | US$ 0 dentro da franquia adotada | US$ 0 |
| Worker Chromium | `southamerica-east1` | privado, escala a zero | sem mudança | 1 | cobrança por uso já aprovada | US$ 0 de capacidade fixa |
| Verificação nativa do Identity Platform | global | envio não validado | tentativa de melhor esforço, sem bloquear cadastro | até 1 por cadastro | incluída no método adotado | US$ 0 |
| Provedor de e-mail próprio | — | não configurado | não configurar nesta mudança | 0 | — | US$ 0 |

Custos únicos de migração, backfill, recuperação e saída de dados: US$ 0. Não
há migração de usuário, alteração de state Terraform ou persistência adicional.

## 3. Premissas e cenários

Valores reutilizam as avaliações 0004, 0005 e 0006, consultadas e validadas em
29 e 30/08/2026. Moeda USD, impostos e câmbio excluídos.

| Direcionador | Base atual | Esperado | Limite operacional | Unidade |
|---|---:|---:|---:|---|
| Usuários ativos | validação individual | até 1.000 | 10.000 | MAU |
| Consultas de processos | até 1.000 | até 1.000 | limitado pelas taxas existentes | requisições/mês |
| Downloads de documentos | até 100 | até 100 | 2.000 | documentos/mês |
| Instâncias mínimas | 0 | 0 | 0 | instâncias |
| Armazenamento adicional | 0 | 0 | 0 | GiB-mês |
| Tentativas de verificação nativa | não medidas | até 1.000 | 10.000 | mensagens/mês |
| Saída adicional | nenhuma além do cenário aprovado | inalterada | dentro do teto de US$ 10 | GiB/mês |

Cenário atual e esperado: a autenticação deixa de bloquear as consultas já
modeladas; nenhum recurso fixo ou volume planejado aumenta. Pior cenário
permitido: os limites existentes de taxa, downloads e custo interrompem o
rollout antes de US$ 10.

## 4. Custos não cobertos automaticamente

- **Cloud Run e egress:** dependem do uso, mas permanecem dentro dos volumes das
  avaliações 0005 e 0006.
- **Identity Platform:** nenhum método novo e nenhum SMS; permanece dentro da
  franquia de MAU adotada na avaliação 0004.
- **E-mail:** nenhum provedor próprio será configurado. A tentativa nativa já
  existente passa a ser de melhor esforço e não altera o custo estimado.
- **Firestore, Storage, filas, IA e APIs pagas:** não serão adicionados.
- **Logs:** sem aumento de retenção e sem registrar e-mail, token ou conteúdo
  processual.
- **Infracost:** não há mudança Terraform; o gate manual é suficiente e o job de
  diff deve ser corretamente ignorado.

## 5. Limites e condição de parada

- Toda rota de consulta continua exigindo ID token Firebase válido.
- UID e e-mail não vazios continuam obrigatórios; login anônimo fica desativado.
- Senha mínima de 12 caracteres e limites existentes de consulta/download são
  mantidos.
- Nenhum token ou dado processual pode ser persistido no navegador.
- Bloquear rollout ou executar rollback se uma rota `/api/` responder sem token,
  se o worker ficar público, se houver finding High/Critical, se os testes de
  isolamento falharem ou se o custo estimado ultrapassar US$ 10.
- Somente o proprietário pode aceitar aumento de limite ou novo SKU.
- Validade: 30 dias, até 29/09/2026, ou até a configuração do envio de e-mail.

## 6. Evidência e fontes

- [Avaliação 0004 — Firebase Authentication](./0004-firebase-authentication.md).
- [Avaliação 0005 — proxy público autenticado](./0005-public-authenticated-proxy.md).
- [Avaliação 0006 — worker de navegador](./0006-isolated-browser-renderer.md).
- [Identity Platform pricing](https://cloud.google.com/identity-platform/pricing),
  consultado originalmente em 29/08/2026.
- [Cloud Run pricing](https://cloud.google.com/run/pricing), consultado
  originalmente em 30/08/2026.
- Limitação: custo por uso real será observado após o rollout; não há novo
  recurso Terraform para o Infracost comparar.

## 7. Aprovação

O pedido explícito do proprietário aprova implementação, commit, PR, merge e
rollout no ambiente de validação dentro deste escopo. A aprovação não autoriza
login anônimo, remoção da validação de token, novo provedor de identidade,
produção, novo recurso faturável ou aumento do limite de US$ 10.

## 8. Verificação posterior

| Data | Custo estimado | Custo real | Variação | Explicação | Ação |
|---|---:|---:|---:|---|---|
| D+1 | até US$ 0,38/mês | — | — | confirmar autenticação e volume | manter ou rollback |
| D+7 | até US$ 0,38/mês | — | — | medir requests e downloads | revisar |
| D+30 | até US$ 0,38/mês | — | — | comparar com billing | encerrar exceção ou reaprovar |
