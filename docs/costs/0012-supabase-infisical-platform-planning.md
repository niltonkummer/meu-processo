# Avaliação de custo 0012 — planejamento de Supabase e Infisical

<!-- infra-cost-assessment:v1 -->

**Status:** aprovado para alteração documental
**Solicitado por:** proprietário do produto
**Responsável:** proprietário do produto e engenharia
**Data da avaliação:** 30 de agosto de 2026
**Ambientes afetados:** documentação local; nenhum ambiente de runtime
**Spec/issue:** incluir Supabase e Infisical no plano da plataforma

**Custo mensal atual (USD):** até US$ 0,38 no cenário de validação já aprovado
**Custo mensal esperado (USD):** até US$ 0,38; delta mensal US$ 0
**Custo mensal limite (USD):** US$ 10
**Aprovação:** o pedido do proprietário aprova somente o planejamento documental em 30/08/2026

## 1. Decisão de custo

Autorizar a documentação de:

- Supabase gerenciado como PostgreSQL operacional planejado;
- Infisical como fonte de verdade de segredos;
- Google Secret Manager como destino de sincronização e entrega ao runtime;
- desenvolvimento local com Supabase CLI/PostgreSQL e Infisical sem segredos reais.

Nenhum projeto Supabase ou Infisical, banco, sync, secret, migration, recurso
Terraform ou dependência será criado por esta mudança.

## 2. Delta desta alteração

| Componente/SKU | Região | Estado atual | Estado proposto nesta mudança | Quantidade | Delta mensal |
|---|---|---|---|---:|---:|
| Documentação/ADRs | local/Git | decisões em Firestore/Secret Manager | plano híbrido Supabase/Infisical | — | US$ 0 |
| Supabase gerenciado | São Paulo, AWS `sa-east-1` | inexistente | somente decisão planejada | 0 projetos | US$ 0 |
| Infisical Cloud | a definir após revisão de residência/DPA | inexistente | somente decisão planejada | 0 identidades | US$ 0 |
| GCP Secret Manager Sync | `meu-processo-507018` | inexistente | somente fluxo planejado | 0 syncs/secrets | US$ 0 |

Custos únicos, processamento, armazenamento, operações e egress desta alteração:
US$ 0.

## 3. Cenários futuros não aprovados

| Cenário | Supabase | Infisical | Total mínimo indicativo, sem GCP | Situação |
|---|---:|---:|---:|---|
| Validação técnica | Free, US$ 0 | Free, US$ 0 até 5 identidades | US$ 0 | somente local/temporário; não é produção |
| Piloto com um banco gerenciado | Pro, US$ 25/mês | Free, se os controles forem suficientes | US$ 25/mês | excede o limite atual |
| Produção + staging isolado | aproximadamente US$ 35/mês antes de extras | a definir | a partir de ~US$ 35/mês | excede o limite atual |
| Exemplo Infisical Pro com 3 identidades | — | US$ 60/mês com cobrança anual ou US$ 69 mensal | adicional ao banco/GCP | não aprovado |

O valor de aproximadamente US$ 35 para Supabase considera uma organização Pro
com um projeto Micro coberto pelo crédito de compute e um segundo projeto Micro
cobrado à parte. Backups PITR, egress entre AWS/GCP, compute maior, branches,
suporte, impostos e câmbio não estão incluídos. PITR de sete dias adicionaria
aproximadamente US$ 100 por projeto/mês e não faz parte do MVP.

## 4. Premissas e riscos de custo

- Supabase Free é adequado somente para desenvolvimento e validação; pode pausar
  projeto com baixa atividade e não substitui ambiente de produção.
- O banco em AWS São Paulo e o runtime em Google Cloud São Paulo podem gerar
  egress e latência cross-cloud, a medir antes do piloto.
- O tier Free do Infisical possui até cinco identidades e dez Secret Syncs, mas
  controles de versão, recuperação, rotação e retenção de auditoria pertencem a
  planos pagos.
- Usuários humanos, serviços, CI e sincronizadores contam como identidades no
  modelo de preço do Infisical; separar ambientes pode aumentar a quantidade.
- Google Secret Manager continua sujeito a operações, versões e retenção; sua
  franquia e custo devem ser recalculados na spec de implementação.
- GCS permanece para originais, PDFs e exportações; backup do banco Supabase não
  inclui objetos de storage.

## 5. Limites e condição de parada

- Esta avaliação autoriza apenas Markdown local.
- Proibido criar conta paga, projeto, banco, sync, identity, secret ou migration.
- Proibido inserir valor de segredo, token, CPF/CNPJ ou dado processual real.
- A implementação para ao exigir qualquer custo recorrente acima de US$ 10.
- Somente o proprietário pode aprovar novo teto, plano pago ou egress cross-cloud.
- A spec futura deve comparar custo e risco de Supabase gerenciado, Postgres em
  GCP e eventual self-hosting antes do primeiro dado persistente.

## 6. Evidência e fontes

- [Supabase — billing e compute credits](https://supabase.com/docs/guides/platform/billing-on-supabase).
- [Supabase — regiões](https://supabase.com/docs/guides/platform/regions).
- [Supabase — PITR](https://supabase.com/docs/guides/platform/manage-your-usage/point-in-time-recovery).
- [Infisical — preços](https://infisical.com/pricing).
- [Infisical — autenticação GCP](https://infisical.com/docs/documentation/platform/identities/gcp-auth).
- [Infisical — sincronização com GCP Secret Manager](https://infisical.com/docs/integrations/secret-syncs/gcp-secret-manager).
- Infracost não aplicável: Terraform não será alterado.

## 7. Aprovação

O pedido explícito aprova a documentação local. Não autoriza implementação,
commit, push, PR, merge, deploy, assinatura paga ou persistência de dados.

## 8. Verificação posterior

Confirmar delta US$ 0 e ausência de alterações em runtime, dependências,
Terraform, contas externas e dados.
