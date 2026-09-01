# Avaliação de custo 0018 — identidade interna local

<!-- infra-cost-assessment:v1 -->

**Status:** implementado e verificado; delta mensal US$ 0  
**Data:** 30 de agosto de 2026  
**Ambientes afetados:** aplicação e testes locais/CI  
**Custo atual/esperado/limite:** US$ 0 / US$ 0 / US$ 10 por mês  

## Decisão

Autorizar o mapeamento determinístico do subject autenticado do Firebase para
UUIDs internos de usuário e tenant pessoal, seguido do provisionamento
idempotente no repository já existente. Não há novo SKU, dependência, serviço,
rede, dado judicial, credencial ou Terraform.

Não estão autorizados nesta fatia: Supabase real, Infisical, GCP, deploy, API
CRUD, nome/CPF/CNPJ, e-mail, documento, commit ou push. Qualquer custo acima de
US$ 0 exige nova avaliação.

## Limites e verificação

- somente provider subjects sintéticos em testes;
- IDs internos não são usados como segredo ou decisão única de autorização;
- o repository continua validando membership e tenant em cada transação;
- implementação e testes usam a suíte existente, sem retenção adicional;
- estimativa válida até 29 de setembro de 2026.

Sem deploy, não se aplicam verificações D+7/D+30. A verificação local usou
somente fixtures sintéticas e containers descartáveis; custo observado US$ 0.
