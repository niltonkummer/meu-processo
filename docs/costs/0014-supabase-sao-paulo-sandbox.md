# Avaliação de custo 0014 — sandbox Supabase em São Paulo

<!-- infra-cost-assessment:v1 -->

**Status:** aprovado para implementação
**Solicitado por:** proprietário do produto
**Responsável:** proprietário do produto e engenharia
**Data da avaliação:** 30 de agosto de 2026
**Ambientes afetados:** organização Supabase Free e Infisical `Meu Processo/dev`
**Spec/issue:** recriar o sandbox Supabase na região correta

**Custo mensal atual (USD):** até US$ 0,38 no cenário de validação aprovado
**Custo mensal esperado (USD):** até US$ 0,38; delta mensal US$ 0
**Custo mensal limite (USD):** US$ 10
**Aprovação:** o pedido explícito do proprietário aprova este sandbox em 30/08/2026

## 1. Escopo aprovado

- criar um segundo projeto Supabase Free chamado `Meu Processo`;
- selecionar a região específica South America (São Paulo), `sa-east-1`;
- manter intacto o projeto vazio existente em East US (Ohio), `us-east-2`;
- gerar senha PostgreSQL forte e cadastrá-la no Infisical `Development`;
- não criar schema, dados, bucket, Auth, Edge Function, integração ou deploy;
- não habilitar plano Pro, add-on, PITR ou recurso cobrado.

## 2. Impacto

| Componente | Estado atual | Estado esperado | Delta mensal |
|---|---|---|---:|
| Supabase Free | 1 projeto vazio em Ohio | 2 projetos Free, novo em São Paulo | US$ 0 |
| Infisical Free | 1 segredo em `dev` | senha do sandbox adicionada | US$ 0 |
| GCP/runtime/Terraform | inalterado | inalterado | US$ 0 |

## 3. Guardrails

- confirmar `Free`, `sa-east-1` e ausência de cobrança antes de criar;
- senha não aparece em terminal, documentação, resposta ou screenshot;
- senha não entra em Git, `.env`, Terraform state ou clipboard persistente;
- não copiar `anon`/publishable key para vault quando usada somente no cliente;
- secret/service key e connection strings serão inventariadas depois da criação;
- projeto de Ohio só poderá ser excluído com autorização separada.

## 4. Condição de parada

Parar se o Supabase exigir upgrade, pagamento, organização diferente, região
indisponível ou se não for possível guardar a senha no Infisical. Nenhum gasto
recorrente novo está autorizado.

## 5. Evidência

- [ADR 0016 — Supabase PostgreSQL](../adr/0016-managed-supabase-postgres.md).
- [ADR 0017 — Infisical](../adr/0017-infisical-secrets-control-plane.md).
- [Supabase — regiões](https://supabase.com/docs/guides/platform/regions).
- [Supabase — preços](https://supabase.com/pricing).
- Infracost não aplicável: nenhum Terraform será alterado.

## 6. Aprovação

O pedido autoriza a criação Free e o armazenamento da senha no vault. Não
autoriza commit, push, PR, deploy, plano pago, exclusão ou dado real.

## 7. Verificação posterior

**Executado em:** 30 de agosto de 2026

- projeto criado: `Meu Processo`, referência pública `tbfhcvrdkrerhzqjwyyu`;
- plano/compute: Free, `nano`;
- região confirmada: South America (São Paulo), `sa-east-1`;
- estado final confirmado: `Healthy`;
- Data API desabilitada e RLS automática habilitada na criação;
- `SUPABASE_DB_PASSWORD` armazenada no Infisical `Development`, valor mascarado;
- projeto anterior em Ohio mantido intacto;
- nenhum schema, migration, dado, bucket, integração ou deploy criado;
- delta mensal confirmado: US$ 0.
