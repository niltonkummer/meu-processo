# Implementação 0013 — identidade interna estável

**Status:** implementada e verificada localmente  
**Data:** 30 de agosto de 2026  
**Spec:** [0012](../specs/0012-internal-identity-mapping.md)  
**Custo:** [0018](../costs/0018-local-identity-mapping.md)

## Resultado

O subject retornado por um verificador Firebase pode agora ser convertido em
UUIDs internos distintos de usuário e tenant pessoal. A aplicação valida o
subject, delega a derivação a um adapter e provisiona o tenant pelo contrato de
repository. A infraestrutura usa SHA-256 com separação de domínio e UUID v8.

Os IDs são estáveis, não reversíveis por simples leitura e diferentes por
propósito. Eles não são tratados como segredo nem concedem acesso: membership,
tenant transacional e RLS continuam obrigatórios.

## TDD e condição de corrida encontrada

Os testes Red falharam pela ausência do resolver e do adapter. Depois do Green,
um novo contract concorrente executou dois bootstraps iguais simultaneamente no
PostgreSQL e encontrou uma disputa entre os índices únicos de `user_id` e
`provider_subject`.

O insert passou a tolerar conflito em qualquer índice único, mas a transação
continua verificando em seguida que usuário, provider subject, tenant pessoal e
membership owner formam exatamente o mesmo conjunto. Assim, repetição legítima
é idempotente e uma associação divergente continua falhando fechada.

## Evidências

| Verificação | Resultado |
|---|---:|
| testes do resolver/derivador | 5/5 |
| suíte regular | 309/309 em 31 arquivos |
| cobertura monitorada | 100% statements/branches/functions/lines |
| contract PostgreSQL com bootstrap concorrente | 7/7 |
| lint, typecheck e build | aprovado |
| secret scan Trivy | 0 segredos |
| imagem PostgreSQL HIGH/CRITICAL corrigíveis | 0 vulnerabilidades |
| `npm audit --audit-level=high` | aprovado; 0 high/critical |

Nenhuma dependência, migration, credencial, rota HTTP ou infraestrutura externa
foi adicionada. O ambiente PostgreSQL final usou volume novo e fixtures
sintéticas.

O audit continua reportando as nove vulnerabilidades moderadas transitivas da
cadeia Firebase/Firebase Tools já registradas. A correção automática proposta é
breaking e não foi aplicada silenciosamente.

## Próximo gate

Antes de cadastrar nome, CPF/CNPJ ou alvo real, é necessária a spec de proteção
de identificadores e busca determinística. A próxima fatia segura pode expor o
bootstrap autenticado e CRUD somente depois de definir validação, criptografia,
redaction, autorização, respostas e tratamento LGPD; não será usado o UUID
interno como substituto de autorização.
