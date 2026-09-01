# Implementação 0011 — primeira fatia da fundação expansível

**Status:** implementada e verificada localmente  
**Data:** 30 de agosto de 2026  
**Spec:** [0010](../specs/0010-local-expandable-foundation.md)  
**Custo:** [0016](../costs/0016-local-expandable-foundation.md)

## Resultado

A primeira fatia foi concluída sem alterar Supabase, Infisical, Brevo, GCP ou
dados externos. A API existente preserva seus contratos e agora possui:

- configuração de runtime tipada, validada antes de abrir a porta;
- composition root separado do servidor HTTP;
- `RequestContext` criado pelo servidor, com principal autenticado, tenant
  pessoal ou organização com membership ativa e IDs de correlação opacos;
- testes de arquitetura impedindo dependências invertidas e leitura de
  `process.env` pelo domínio/aplicação;
- contratos de repository independentes de adapter;
- adapters equivalentes em memória e PostgreSQL;
- PostgreSQL 17.11 local sem porta publicada, com limites de recursos, filesystem
  somente leitura e execução como UID/GID 999;
- migration inicial, roles distintas, grants mínimos, constraints, índices e RLS
  habilitada e forçada;
- testes pgTAP e contract tests incluídos no CI;
- lint e scan HIGH/CRITICAL da imagem PostgreSQL incluídos no CI.

## Modelo persistido nesta fatia

Foram criadas as tabelas `user_accounts`, `tenants`, `tenant_members`,
`monitored_subjects`, `monitoring_targets` e `subject_targets`. Todas as relações
privadas carregam `tenant_id`; as relações entre subject e target usam FKs
compostas para impedir vínculo entre tenants.

Nome, CPF ou CNPJ real continuam fora do banco. O contrato desta etapa aceita
somente rótulo sintético e uma referência protegida opaca, até existir uma spec
de criptografia/HMAC e tratamento de dados pessoais.

## Evidências de verificação

Executado em banco e volume novos após a última alteração:

| Verificação | Resultado |
|---|---:|
| pgTAP de schema, constraints, grants e RLS | 25/25 |
| contrato PostgreSQL | 3/3 |
| suíte regular | 301/301 |
| cobertura monitorada | 100% statements/branches/functions/lines |
| lint, typecheck e build | aprovado |
| `docker compose config` e `git diff --check` | aprovado |
| secret scan Trivy | 0 segredos |
| scan da imagem PostgreSQL | 0 HIGH/CRITICAL |
| SBOM CycloneDX da imagem | gerado e validado, 767.436 bytes |
| `npm audit --audit-level=high` | aprovado; 0 high/critical |

O `npm audit` ainda relata nove vulnerabilidades moderadas transitivas da cadeia
Firebase/Firebase Tools. O reparo automático disponível exige downgrade/breaking
change e não foi aplicado nesta fatia. Elas não foram introduzidas pelo adapter
`pg` e permanecem visíveis para tratamento separado.

## Validação e endurecimento do Dockerfile

Primeira iteração:

- Critical: nenhum;
- High: nenhum;
- Medium: nenhum;
- Low: usuário não numérico informado pelo Hadolint;
- resultado: falhou o gate estrito.

Correções e segunda iteração:

- imagem atualizada de PostgreSQL 17.6 para 17.11 e fixada por digest;
- runtime alterado de `postgres:postgres` para `999:999`;
- Hadolint, Checkov e checks de boas práticas aprovados sem findings;
- o scan Trivy detectou CVEs no `gosu` herdado da imagem oficial;
- `gosu` foi removido porque este derivado nunca inicia como root e, portanto,
  não executa a troca de usuário do entrypoint;
- nova inicialização em volume vazio, pgTAP, contrato, scan e SBOM aprovados.

O Dockerfile permanece single-stage intencionalmente: não há compilação nem
artefato de build; pgTAP e `pg_prove` precisam existir na imagem de teste final.
Adicionar outro estágio não reduziria permissões nem dependências de runtime.
Revisar essa decisão ao promover uma imagem PostgreSQL própria fora de local/CI.

## Operação e rollback

Os comandos reproduzíveis estão no README. A remoção do projeto Compose com
`--volumes` apaga somente a base sintética descartável. O adapter em memória
permanece disponível; nenhum runtime cloud passou a depender do PostgreSQL.

## Próximo gate

Antes de conectar esta fundação ao Supabase real são necessários nova avaliação
de custo e uma spec de integração contendo, no mínimo: identidade Firebase → UUID
interno, migrations não destrutivas, estratégia de conexão/pooling, backup/PITR,
criptografia e busca determinística de CPF/CNPJ, rotação via Infisical, ambientes
development/staging/production e rollback ensaiado.
