# Implementação 0036 — fundação Supabase no sandbox

**Status:** implementada e verificada no sandbox
**Data:** 31 de agosto de 2026
**Spec:** [0031](../specs/0031-supabase-supavisor-runtime-readiness.md)
**ADR:** [0023](../adr/0023-two-stage-managed-foundation-activation.md)
**Custo:** [0039](../costs/0039-supabase-sandbox-schema-rollout.md)

## Resultado

O projeto Supabase Free `Meu Processo`, referência
`tbfhcvrdkrerhzqjwyyu`, em São Paulo, recebeu as 19 migrations versionadas e
cinco logins separados para API, monitoramento, dispatcher, documentos e ciclo
de vida. Cada login possui limite de cinco conexões, uma única role de grupo e
nenhum privilégio administrativo, ownership ou bypass de RLS.

As seis URLs de conexão — incluindo o alias do worker de ciclo de vida — foram
armazenadas no Infisical Development. Nenhum valor de senha, token ou URL foi
registrado no repositório ou nesta evidência.

O rollout revelou e corrigiu três diferenças reais entre PostgreSQL local e o
serviço gerenciado:

- grants executados fora de `app_migrator` podiam virar apenas warnings em uma
  sessão administrativa sem superusuário;
- um lock timeout de um segundo era insuficiente para o teste concorrente entre
  Portugal e São Paulo; o limite fail-fast passou a três segundos;
- o Supabase instala `pgcrypto` no schema `extensions`, enquanto a imagem local
  anterior assumia `public`.

As migrations iniciais foram corrigidas para instalações novas e as migrations
0017–0019 reparam instalações que já tinham avançado.

## TLS e secrets

- conexões administrativas usam o endpoint direto exclusivamente durante
  migration/manutenção;
- conexões de runtime usam Supavisor transaction mode na porta 6543;
- todas usam verificação de certificado, sem `rejectUnauthorized=false`;
- a imagem inclui a CA pública Supabase Root 2021 e fixa o fingerprint SHA-256
  `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`;
- o arquivo público expira em 26/04/2031 e deve ser rotacionado antes dessa
  data.

Fonte: [Supabase — SSL enforcement](https://supabase.com/docs/guides/platform/ssl-enforcement).

## Evidência

- migrations remotas: 19, sem versão pendente após o rollout;
- contratos PostgreSQL remotos: 11 arquivos e 35 testes aprovados;
- contrato fundamental remoto: 8 testes aprovados, incluindo concorrência e
  cross-tenant;
- alertas remotos: 3 testes aprovados;
- pgTAP local em PostgreSQL novo: 14 arquivos e 263 testes aprovados;
- contratos PostgreSQL locais: 11 arquivos e 35 testes aprovados;
- suíte da aplicação: 82 arquivos e 1.011 testes, com 100% de statements,
  branches, funções e linhas;
- build local e da imagem distroless de produção aprovados, incluindo a CA;
- backup e restauração lógica aprovados;
- teste de carga limitado: cinco workloads, 25 operações por workload, cinco
  conexões máximas, zero erro; p95 observado entre 2,592 e 3,070 segundos a
  partir de Portugal;
- Dockerfile: hadolint e 12 checks Checkov aprovados, zero finding;
- dependências: zero High/Critical; nove ocorrências Medium já cobertas pelo
  registro de risco 0001, ainda dentro do SLA;
- auditoria final: zero usuários, zero tenants, zero tabelas públicas, zero
  tabela tenant-scoped sem RLS forçada e somente a fonte oficial inicial;
- Infisical: nove secrets presentes; valores não lidos nem registrados.

## Operações reproduzíveis

Os scripts em `database/scripts` validam o alvo antes de qualquer mudança,
recusam dados não reconhecidos, não imprimem secrets e oferecem:

- provisionamento inicial dos logins;
- reconciliação idempotente dos limites e timeouts;
- auditoria de ACL, roles, RLS e estado vazio;
- preparação/limpeza exclusiva de dados sintéticos;
- smoke de carga limitado por workload.

## Estado final e próximo gate

O sandbox permaneceu no plano Free, sem dados pessoais ou processuais e sem
alteração em GCP. Cloud Run, GCS, Secret Manager e Infisical Secret Sync exigem
uma nova avaliação de custo aprovada antes de qualquer mutação.
