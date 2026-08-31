# Avaliação de custo 0017 — persistência operacional local

<!-- infra-cost-assessment:v1 -->

**Status:** implementado e verificado; delta mensal US$ 0  
**Solicitado por:** proprietário do produto  
**Responsável:** proprietário do produto e engenharia  
**Data da avaliação:** 30 de agosto de 2026  
**Ambientes afetados:** local e CI sem credenciais  
**Spec/issue:** continuação da Etapa B do [Roadmap 0009](../implementation/0009-scalable-foundation-roadmap.md)

**Custo mensal atual (USD):** até US$ 0,38 no ambiente de validação aprovado  
**Custo mensal esperado (USD):** até US$ 0,38; delta mensal US$ 0  
**Custo mensal limite (USD):** US$ 10  
**Aprovação:** a instrução “vamos continuar com a implementação planejada e
alcançar o objetivo” aprova esta fatia local, com delta zero, em 30/08/2026

## 1. Decisão

Completar localmente a parte operacional da persistência antes de conectar um
serviço gerenciado. Esta avaliação autoriza:

- migrations incrementais para sources, subscriptions e estado de alvo por
  fonte;
- concorrência otimista, arquivamento/exclusão lógica e paginação por cursor;
- contracts equivalentes em memória e PostgreSQL;
- backup/restore e migration verification somente com fixtures sintéticas;
- configuração de conexão por referência validada, sem valor real;
- testes pgTAP, isolamento cross-tenant, CI e documentação.

Não autoriza acesso ou alteração em Supabase, Infisical, Brevo, GCP, dados
judiciais, dados pessoais, secrets reais, Terraform, deploy, commit ou push.

## 2. Alteração de infraestrutura

| Componente/SKU | Região | Estado atual | Estado proposto | Quantidade | Custo unitário | Delta mensal |
|---|---|---|---|---:|---:|---:|
| PostgreSQL/pgTAP local | computador/runner | imagem e volume descartável | migrations e testes adicionais na mesma imagem | 1 efêmero | US$ 0 de fornecedor | US$ 0 |
| GitHub Actions | runner já previsto | suíte de banco existente | mais contracts/restore na mesma pipeline | por PR | sem novo plano contratado | US$ 0 |
| Supabase Free | AWS São Paulo | sandbox vazio | inalterado e não acessado | 1 existente | US$ 0 | US$ 0 |
| GCP/Infisical/Brevo | São Paulo/externo | validações já aprovadas | inalterado | — | — | US$ 0 |

Custos únicos de migração, backfill, recuperação ou egress: US$ 0. Nenhuma
operação externa será executada.

## 3. Premissas e cenários

| Direcionador | Base atual | Esperado | Limite operacional | Unidade |
|---|---:|---:|---:|---|
| Dados de teste | < 1 | < 5 | 20 | MiB por execução |
| Conexões PostgreSQL | 5 | 5 | 5 | conexões por processo de teste |
| Memória do banco | 256 | 256 | 256 | MiB |
| CPU do banco | 0,5 | 0,5 | 0,5 | CPU |
| Retenção CI | 0 | 0 | 0 | dias; volume removido ao final |
| Saída de rede | 0 | 0 | 0 | GiB para serviços do produto |
| Dados pessoais/judiciais | 0 | 0 | 0 | registros |

Cenário atual, esperado em 30 dias e pior caso autorizado possuem o mesmo custo
de fornecedor: zero. O tempo adicional de runner não cria SKU nem assinatura
nova e deve permanecer abaixo de 20 minutos no job de banco.

## 4. Custos não cobertos automaticamente

- Cloud Run, GCS, Secret Manager, Scheduler, Tasks, logs, egress cross-cloud,
  Brevo, IA e APIs judiciais: não usados nem alterados nesta fatia;
- Supabase e Infisical: não acessados;
- impostos e câmbio: não aplicáveis ao delta US$ 0;
- Infracost: não aplicável porque nenhum Terraform será alterado.

## 5. Limites e condição de parada

- banco local limitado a 0,5 CPU, 256 MiB e cinco conexões;
- job de banco limitado a 20 minutos;
- somente fixtures sintéticas e volumes descartáveis;
- parar antes de qualquer credencial, egress externo, novo SKU ou alteração
  cloud;
- aumento acima de US$ 0 ou necessidade de sandbox real exige nova avaliação;
- estimativa válida até 29 de setembro de 2026;
- somente o proprietário do produto pode aprovar aumento.

## 6. Evidência e fontes

- [Avaliação 0016](./0016-local-expandable-foundation.md) como baseline;
- [Roadmap 0009](../implementation/0009-scalable-foundation-roadmap.md), Etapa B;
- `compose.yaml` como limite reproduzível de CPU, memória e conexões;
- Infracost não aplicável: zero alteração Terraform;
- preços externos não precisam de nova consulta porque nenhum serviço externo é
  consumido ou modificado.

## 7. Aprovação

Proprietário do produto: aprovado para implementação local em 30/08/2026, sob
as condições desta avaliação. A aprovação não autoriza commit, deploy ou acesso
adicional.

## 8. Verificação posterior

Sem deploy não existem verificações D+7/D+30. Antes de usar o sandbox Supabase,
será criada avaliação separada para conexão, carga, egress, restore e secrets.

Verificação local concluída em 30/08/2026: os testes usaram somente containers,
fixtures e volumes descartáveis; nenhum serviço externo, credencial ou SKU foi
acessado. O custo observado e o delta mensal permanecem US$ 0.
