# Spec 0012 — mapeamento de identidade autenticada para UUID interno

**Status:** implementada e verificada localmente  
**Data:** 30 de agosto de 2026  
**Custo:** [0018](../costs/0018-local-identity-mapping.md)  
**Implementação:** [0013](../implementation/0013-internal-identity-mapping.md)  
**Arquitetura:** [ADR 0003](../adr/0003-firebase-authentication-boundary.md) e
[Spec 0009](./0009-scalable-product-foundation.md)

## Resultado esperado

Um provider subject já verificado pelo adapter Firebase resolve sempre para o
mesmo `user_id` e `tenant_id` pessoal, sem usar o subject externo como chave de
domínio. O serviço de aplicação:

1. valida comprimento de 1 a 255 caracteres;
2. deriva IDs separados por propósito (`user` e `personal-tenant`);
3. solicita provisionamento idempotente ao repository;
4. retorna somente o contexto interno `{userId, tenantId}`.

O algoritmo concreto fica na infraestrutura, usa SHA-256 com separação de
domínio e formata UUID v8/RFC 9562. IDs são estáveis e opacos, mas não são
segredos nem substituem autenticação/autorização.

## Casos e critérios de aceite

- subject igual produz contexto igual entre instâncias;
- propósitos diferentes não produzem o mesmo ID;
- subject vazio ou acima de 255 caracteres falha antes do repository;
- falha do repository não é convertida em identidade válida;
- provisionamento repetido e concorrente permanece idempotente pelos contracts;
- nenhum token, e-mail, nome, CPF/CNPJ ou membership é inferido do cliente;
- application/domain mantêm cobertura 100%; lint, tipos, build e scans passam.

## Fora de escopo

API HTTP, organização, migração de IDs legados, segredo de derivação, cadastro
de perfil/alvo e conexão de adapter em runtime. Esses itens exigem specs próprias
para não misturar bootstrap de identidade com tratamento de dados pessoais.
