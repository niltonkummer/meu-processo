# Avaliação de custo 0019 — identificadores protegidos e API local

<!-- infra-cost-assessment:v1 -->

**Status:** aprovado para implementação  
**Solicitado por:** proprietário do produto  
**Responsável:** proprietário do produto e engenharia  
**Data da avaliação:** 30 de agosto de 2026  
**Ambientes afetados:** local e CI sem credenciais externas  
**Spec/issue:** continuação da Etapa B do [Roadmap 0009](../implementation/0009-scalable-foundation-roadmap.md)

**Custo mensal atual (USD):** até US$ 0,38 no ambiente de validação já aprovado  
**Custo mensal esperado (USD):** até US$ 0,38; delta mensal US$ 0  
**Custo mensal limite (USD):** US$ 10  
**Aprovação:** a instrução persistente para continuar a implementação planejada
aprova esta fatia local de delta zero em 30/08/2026

## 1. Decisão

Autorizar somente local/CI:

- normalização, minimização e mascaramento de nome, CPF e CNPJ;
- blind index HMAC tenant-bound para igualdade/idempotência;
- criptografia autenticada AES-256-GCM com chave injetada em memória de teste;
- migration forward-only para envelope cifrado e versão de chave;
- API autenticada de perfis/alvos usando repository local;
- testes unitários, contracts, pgTAP, restore e scans.

Não autoriza Supabase, Infisical, Secret Manager, GCP, Brevo, fonte judicial,
credencial ou dado pessoal real, Terraform, deploy, commit ou push.

## 2. Alteração de infraestrutura

| Componente/SKU | Região | Estado atual | Estado proposto | Quantidade | Custo unitário | Delta mensal |
|---|---|---|---|---:|---:|---:|
| PostgreSQL/pgTAP local | computador/runner | migrations 0001/0002 | migration e testes adicionais | 1 efêmero | US$ 0 | US$ 0 |
| Node.js crypto | processo local/runner | disponível no runtime | AES-GCM/HMAC nativos | em processo | US$ 0 | US$ 0 |
| GitHub Actions | runner já previsto | gates existentes | suíte adicional no mesmo job | por PR | sem novo plano | US$ 0 |

Custos únicos de migração, backfill, recuperação e egress: US$ 0. Infracost não
se aplica porque nenhum Terraform será alterado.

## 3. Premissas e cenários

| Direcionador | Base atual | Esperado | Limite operacional | Unidade |
|---|---:|---:|---:|---|
| Identificadores sintéticos | 0 | < 100 | 1.000 | por execução |
| Corpo HTTP | 0 | < 1 | 16 | KiB por request |
| Conexões PostgreSQL | 5 | 5 | 5 | por processo |
| Retenção local/CI | 0 | 0 | 0 | dias após cleanup |
| Egress de produto | 0 | 0 | 0 | GiB |
| Dados pessoais reais | 0 | 0 | 0 | registros |

Base, esperado em 30 dias e pior caso autorizado não criam cobrança adicional.

## 4. Custos não cobertos automaticamente

Cloud Run, Storage, Supabase, Infisical, Secret Manager, filas, logs, e-mail,
APIs judiciais, IA, suporte, impostos e câmbio não são consumidos ou alterados.

## 5. Limites e condição de parada

- somente fixtures sintéticas e chaves geradas para o processo de teste;
- nenhuma chave real aparece em resposta, log, fixture ou repositório; fixtures
  locais usam bytes públicos e previsíveis que são inválidos para produção;
- corpo HTTP máximo 16 KiB e paginação máxima 100;
- containers/volumes removidos após o teste;
- parar antes de qualquer secret real, serviço externo, novo SKU ou egress;
- qualquer delta acima de US$ 0 exige nova avaliação do proprietário;
- estimativa válida até 29 de setembro de 2026.

## 6. Evidência e fontes

- [Avaliação 0017](./0017-local-operational-persistence.md) como baseline;
- `compose.yaml` para limites reproduzíveis;
- Infracost não aplicável: nenhum recurso Terraform;
- nenhum preço externo precisa ser consultado porque não há consumo externo.

## 7. Aprovação

Aprovado para implementação local em 30/08/2026, com delta US$ 0 e sem
autorização para commit, deploy, conta externa ou dado real.

## 8. Verificação posterior

Sem deploy não se aplicam verificações D+7/D+30. Conexão a um vault ou banco
gerenciado exige avaliação separada e rotação/rollback ensaiados.

**Progresso em 30/08/2026:** proteção criptográfica, migration 0003, API
autenticada de cadastro/listagem/arquivamento e composition root PostgreSQL foram
verificados com delta US$ 0. O ensaio usou somente containers, usuários e dados
sintéticos descartáveis; não houve acesso externo.
