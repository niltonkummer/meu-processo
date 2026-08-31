# ADR 0018 — Brevo para e-mail transacional

**Status:** aceito para bootstrap; integração e envio dependem de spec e custo próprios
**Data:** 30 de agosto de 2026
**Relacionado:** [ADR 0013](./0013-transactional-outbox-and-idempotent-jobs.md), [ADR 0017](./0017-infisical-secrets-control-plane.md), [Custo 0015](../costs/0015-brevo-transactional-email-bootstrap.md)

## Contexto

O produto precisa confirmar endereços, recuperar contas e, futuramente, avisar
sobre novas movimentações. A conta Brevo `NHK Tech` já está no plano Free, que
oferece API transacional e limite compartilhado de 300 envios por dia. A conta
também contém credenciais e remetentes de outros produtos; compartilhá-los
ampliaria o impacto de incidentes e misturaria identidades de marca.

## Decisão

Adotar a API REST transacional da Brevo para os e-mails do Meu Processo, com:

- chave exclusiva por ambiente; no bootstrap de desenvolvimento, o nome é
  `Meu Processo Dev`, sem data de expiração por decisão explícita do
  proprietário; a rotação continua obrigatória e a Brevo informa expiração após
  90 dias de inatividade;
- `BREVO_API_KEY` armazenada somente no Infisical e, no futuro, sincronizada
  para o Google Secret Manager conforme o ADR 0017;
- remetente e domínio próprios do Meu Processo, verificados com SPF, DKIM e
  DMARC antes do primeiro envio;
- outbox transacional, idempotência e dispatcher assíncrono conforme o ADR 0013;
- identificação do template e versão, provider message ID, tentativas e estado
  de entrega, sem persistir o corpo completo quando não for necessário;
- webhooks autenticados para entrega, bounce, bloqueio e reclamação, com
  deduplicação e lista de supressão;
- limites de taxa e orçamento que parem ou enfileirem envios antes de exceder a
  franquia diária.

Usaremos a API REST em vez de SMTP para obter erros estruturados, idempotência,
observabilidade e rotação de credencial mais simples. Chaves, senhas SMTP e
remetentes já existentes de outros produtos não serão reutilizados.

### Privacidade e conteúdo

O e-mail conterá somente a informação mínima necessária e um link para a área
autenticada. Não incluirá documento, conteúdo processual sensível, CPF/CNPJ,
token, segredo ou URL assinada de longa duração. Logs e eventos não registrarão
endereço em texto puro, credencial nem corpo da mensagem.

E-mails essenciais de conta e segurança ficam separados de alertas opcionais.
Preferência, consentimento e descadastro serão aplicados por canal e finalidade;
nenhum contato será incluído automaticamente em campanha de marketing.

## Bootstrap autorizado

Nesta etapa, a única mudança externa autorizada é criar a chave dedicada e
armazená-la no ambiente Development do Infisical. Não estão autorizados envio,
webhook, Secret Sync, runtime, alteração de domínio/remetente, upgrade de plano
ou uso de contatos da conta.

## Consequências

- o bootstrap permanece em US$ 0 no plano Free;
- a franquia de 300 envios/dia é compartilhada com a conta e exige medição;
- não haverá envio até existir remetente próprio verificado;
- indisponibilidade ou limite do provedor não bloqueia a transação principal: o
  evento permanece na outbox para retry controlado;
- produção exigirá DPA/subprocessadores, retenção, threat model, entregabilidade,
  alertas e custo aprovados.

## Alternativas

- **SMTP Brevo:** rejeitado como padrão pela menor riqueza de resposta e
  observabilidade; permanece apenas como contingência futura avaliada.
- **E-mail nativo do Firebase:** insuficiente para alertas, templates,
  entregabilidade e eventos de entrega do produto.
- **Outro provedor transacional:** possível por meio do adapter do dispatcher,
  caso custo, residência ou entregabilidade mudem.
- **Reutilizar chave/remetente existente:** rejeitado por isolamento, auditoria
  e identidade da marca.

## Revisão

Revisar a credencial a cada 90 dias, antes do primeiro envio e quando o volume
se aproximar de 80% da quota diária. Qualquer plano pago ou aumento de escopo
exige nova avaliação de custo.

## Referências

- [Brevo — planos](https://help.brevo.com/hc/en-us/articles/208589409-About-Brevo-s-pricing-plans)
- [Brevo — limites do plano Free](https://help.brevo.com/hc/pt/articles/208580669-FAQ-Quais-s%C3%A3o-os-limites-do-plano-Gr%C3%A1tis)
- [Brevo — e-mail transacional](https://www.brevo.com/products/transactional-email/)
