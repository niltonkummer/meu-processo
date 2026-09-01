# ADR 0021 — iniciar evidência como tenant-private

**Status:** aceito  
**Data:** 31 de agosto de 2026  
**Relacionado:** [Spec 0015](../specs/0015-local-case-evidence-foundation.md)

## Contexto

O modelo alvo permite deduplicar fatos oficiais públicos entre tenants, mas a
classificação jurídica, finalidade e retenção ainda não foram aprovadas por
fonte. Criar imediatamente uma base global tornaria um detalhe de implementação
uma decisão irreversível de tratamento e compartilhamento de dados.

## Decisão

A primeira persistência de envelopes, observações e processos será
tenant-scoped. Toda linha carrega `tenant_id`, usa FK composta e RLS forçada. O
worker escreve apenas por função privilegiada estreita e nenhum cliente acessa
evidência sem a projeção `TenantCase` correspondente.

Uma fonte poderá ser promovida para `PUBLIC_OFFICIAL` somente por migration
expandir → copiar/deduplicar → verificar grants → contrair, após revisão jurídica,
retenção, exclusão, custo e threat model documentados. Evidência restrita nunca é
promovida.

## Consequências

- isolamento e exclusão são demonstráveis antes do piloto;
- o mesmo fato pode ficar duplicado entre tenants no início;
- custo de storage será maior até a promoção, mas o volume inicial é limitado;
- IDs tenant-private não podem ser tratados como IDs globais por APIs futuras;
- a migration de promoção precisará preservar proveniência e grants.

## Alternativas

- **Deduplicação global imediata:** rejeitada sem classificação jurídica e
  lifecycle aprovados.
- **Somente recibos do worker:** rejeitada porque não produz projeção
  reconstruível nem carteira persistente.
- **Persistir payload bruto no PostgreSQL:** rejeitada por minimização, custo e
  futura separação de object storage.

## Revisão

Revisar separadamente para cada fonte após piloto controlado e medição de volume.
Ausência de revisão mantém o escopo tenant-private.
