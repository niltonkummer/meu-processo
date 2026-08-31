# Avaliação de custo 0015 — bootstrap de e-mail transacional Brevo

<!-- infra-cost-assessment:v1 -->

**Status:** implementado e verificado
**Solicitado por:** proprietário do produto
**Responsável:** proprietário do produto e engenharia
**Data da avaliação:** 30 de agosto de 2026
**Ambientes afetados:** Brevo `NHK Tech` e Infisical `Meu Processo/dev`
**Spec/issue:** preparar credencial exclusiva para e-mail transacional

**Custo mensal atual (USD):** até US$ 0,38 no cenário de validação aprovado
**Custo mensal esperado (USD):** até US$ 0,38; delta mensal US$ 0
**Custo mensal limite (USD):** US$ 10
**Aprovação:** o pedido explícito do proprietário aprova este bootstrap em 30/08/2026

## 1. Escopo aprovado

- manter o plano Brevo Free, sem compra de créditos ou add-on;
- criar uma API key dedicada chamada `Meu Processo Dev`;
- configurar a chave sem data de expiração, conforme solicitação explícita do
  proprietário; a Brevo ainda informa expiração após 90 dias de inatividade;
- armazenar o valor uma única vez no Infisical `Development` como
  `BREVO_API_KEY`;
- não reutilizar as chaves `Marketing`, `Khairus Prod` ou SMTP Master Password;
- não enviar e-mail, alterar remetente, domínio, IP autorizado ou webhook;
- não integrar Cloud Run nem criar Secret Sync nesta etapa.

## 2. Impacto

| Componente | Estado atual | Estado esperado | Delta mensal |
|---|---|---|---:|
| Brevo Free | API/SMTP disponíveis, 300 e-mails/dia | 1 API key dedicada adicional | US$ 0 |
| Infisical Free | segredos de desenvolvimento | `BREVO_API_KEY` mascarada | US$ 0 |
| GCP/runtime/Terraform | sem integração Brevo | inalterado | US$ 0 |

O limite diário é compartilhado pela conta e e-mails não usados não acumulam.
Plano pago, remoção de marca, IP dedicado, créditos e volume adicional não estão
autorizados.

## 3. Guardrails

- valor da chave não aparece em terminal, documentação, resposta ou screenshot;
- chave não entra em Git, `.env`, Terraform state, clipboard persistente ou GCP;
- credencial é exclusiva de desenvolvimento e não é compartilhada com Khairus;
- nenhum envio ocorre sem remetente Meu Processo verificado e política de
  conteúdo transacional aprovada;
- e-mail futuro contém somente aviso mínimo e link autenticado, nunca PDF,
  publicação integral, token, CPF/CNPJ ou segredo;
- rotação, webhook e restrição de IP exigem spec própria e teste de rollback.

## 4. Pendências antes do primeiro envio

- definir domínio e endereço remetente do Meu Processo;
- configurar SPF, DKIM e DMARC e confirmar verificação na Brevo;
- implementar outbox/idempotência, template versionado, opt-out quando aplicável,
  bounce/complaint e limite por tenant;
- sincronizar o secret ao GCP Secret Manager e autorizar somente o workload;
- aprovar teste end-to-end com destinatário explícito.

## 5. Condição de parada

Parar se a criação exigir pagamento, se a chave não puder ser capturada uma única
vez ou se o Infisical não aceitar o segredo. Nenhum envio ou upgrade é permitido.

## 6. Evidência

- Conta observada: Free, 300 e-mails/dia e API transacional disponível.
- Chave `Meu Processo Dev` criada como ativa e sem data de expiração.
- `BREVO_API_KEY` confirmada no Infisical `Meu Processo/Development`, com valor
  mascarado; o valor em memória foi descartado após a gravação.
- Nenhum e-mail, remetente, domínio, webhook, IP autorizado, runtime ou plano foi
  alterado.
- [Brevo — planos](https://help.brevo.com/hc/en-us/articles/208589409-About-Brevo-s-pricing-plans).
- [Brevo — limites do Free](https://help.brevo.com/hc/pt/articles/208580669-FAQ-Quais-s%C3%A3o-os-limites-do-plano-Gr%C3%A1tis).
- [ADR 0017 — Infisical](../adr/0017-infisical-secrets-control-plane.md).
- Infracost não aplicável: nenhum Terraform será alterado.

## 7. Aprovação

O pedido autoriza gerar a chave dedicada e salvá-la no Infisical. Não autoriza
commit, push, PR, deploy, envio de e-mail, plano pago ou alteração de remetente.
A solicitação posterior “crie uma chave sem expiração” aprova especificamente a
ausência de data de expiração da credencial de desenvolvimento.
