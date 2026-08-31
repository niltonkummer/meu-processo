# Spec 0010 — primeira fatia da fundação expansível local

**Status:** implementada e verificada localmente
**Data:** 30 de agosto de 2026
**Responsável:** Meu Processo
**Custo:** [Avaliação 0016](../costs/0016-local-expandable-foundation.md)
**Arquitetura:** [Spec 0009](./0009-scalable-product-foundation.md), [ADR 0011](../adr/0011-modular-monolith-and-composition-roots.md), [ADR 0012](../adr/0012-tenant-control-and-evidence-planes.md) e [ADR 0016](../adr/0016-managed-supabase-postgres.md)
**Implementação:** [0011](../implementation/0011-local-expandable-foundation.md)

## 1. Problema

O servidor HTTP concentra composição, autenticação, resolução de escopo,
transporte e casos de uso. O estado operacional é somente em memória e o Compose
não oferece PostgreSQL. Persistir alvos nesse estado criaria risco de mistura
entre tenants, configuração inválida em runtime e divergência entre adapters.

## 2. Resultado desta fatia

Criar uma fundação local e reversível que preserve `/api/v1` e permita evoluir
para Supabase sem usar o sandbox real. Ao final:

- configuração é tipada e validada antes de o servidor abrir a porta;
- cada request autenticado recebe `RequestContext` criado pelo servidor;
- organização só é selecionada por membership ativa do principal;
- handlers dependem de contratos, não de adapters concretos;
- PostgreSQL local aplica migrations, constraints, privileges e RLS forçada;
- os mesmos repository contracts exercitam memória e PostgreSQL;
- ausência ou troca indevida de tenant falha fechada;
- nenhum serviço cloud, segredo ou dado pessoal é usado.

## 3. Escopo funcional mínimo

### 3.1 Configuração e composição

- validar `PORT`, `AUTH_MODE`, URL/mode do renderer e proxy opcional;
- rejeitar número, enum ou URL inválida com erro seguro no startup;
- preservar defaults locais explícitos já suportados;
- composition root constrói adapters; domínio/aplicação não leem `process.env`;
- imports entre módulos seguem o grafo permitido e ciclos bloqueiam CI.

### 3.2 RequestContext e tenancy

`RequestContext` contém:

- `requestId` e `correlationId` opacos;
- principal autenticado;
- tenant pessoal ou organização autorizada;
- instante fornecido por relógio injetável.

Regras:

1. sem principal não existe contexto privado;
2. sem organização solicitada, o tenant pessoal do usuário é usado;
3. organização solicitada exige membership ativa correspondente;
4. header de usuário nunca altera o principal verificado;
5. organização inexistente/inativa falha como acesso negado;
6. IDs e contexto não contêm nome, e-mail, CPF/CNPJ ou token.

### 3.3 Persistência inicial

Primeira migration:

- schemas `app_private` e `app_public` com `public` revogado;
- roles locais separadas para migration e runtime;
- `user_accounts`, `tenants`, `tenant_members`, `monitored_subjects`,
  `monitoring_targets` e `subject_targets`;
- chaves UUID opacas, `timestamptz`, constraints de estado/tipo e versionamento;
- FK privada inclui `tenant_id` quando a relação atravessa tabelas tenant-scoped;
- índices de FK, RLS e consultas previstas;
- RLS habilitada e forçada em toda tabela privada tenant-scoped;
- tenant definido com `set_config(..., true)` dentro de cada transação;
- runtime sem `OWNER`, `BYPASSRLS`, DDL ou acesso fora dos grants explícitos.

O valor original de nome/CPF/CNPJ não será persistido nesta fatia. Os contracts
aceitam apenas `display_label` sintético e `protected_reference` opaca; a
criptografia/HMAC real terá spec própria antes de dados externos.

## 4. Casos observáveis

### Sucesso

1. Configuração válida produz objeto imutável e o servidor inicia.
2. Principal pessoal recebe tenant pessoal determinístico/resolvido.
3. Membership ativa permite contexto organizacional.
4. Repository cria e recupera tenant, membership, subject e target no mesmo
   tenant.
5. Lista usa cursor estável e limite máximo explícito.

### Falha segura

1. Configuração inválida falha antes de `listen`.
2. Organização sem membership ativa é negada.
3. Transação sem tenant não lê, cria, altera nem exclui linha privada.
4. Tenant A não lê, relaciona, pagina, altera ou exclui linha do tenant B.
5. FK cross-tenant é rejeitada mesmo com tentativa direta de SQL.
6. Runtime não desabilita RLS nem executa DDL.
7. Migration parcialmente aplicada falha e banco descartável pode ser recriado.

### Ausência e concorrência

- lista vazia retorna coleção vazia e cursor nulo;
- recurso ausente não revela existência em outro tenant;
- unicidade de membership e alvo é garantida pelo banco;
- create repetido usa chave idempotente/constraint, sem check-then-insert;
- qualquer operação de update adicionada em fatia futura deverá exigir `version`
  corrente; update e delete não fazem parte deste primeiro contrato.

## 5. Contratos e compatibilidade

- nenhuma rota pública nova é necessária nesta fatia;
- rotas atuais, status, headers seguros e payloads permanecem compatíveis;
- repositories expõem operações de domínio e `RequestContext`, nunca SQL/SDK;
- adapter PostgreSQL usa transações curtas, pool máximo cinco e statements sem
  nome, compatíveis com Supavisor transaction mode;
- paginação é por cursor, nunca `OFFSET`.

## 6. Estratégia TDD

Ordem Red → Green → Refactor:

1. testes da configuração inválida/válida;
2. testes de `RequestContext` pessoal, organização ativa e negação;
3. teste de arquitetura para imports proibidos;
4. pgTAP falhando para schema, constraints, grants e RLS;
5. contract suite de repository em memória;
6. executar a mesma suite no adapter PostgreSQL;
7. integração HTTP de regressão garantindo contrato atual.

Application/domain mantêm 100% de statements, branches, functions e lines.
Testes PostgreSQL usam somente valores sintéticos como `user_alpha`,
`tenant_alpha` e referências aleatórias sem semelhança com dados reais.

## 7. Rollout e rollback

O rollout é somente local/CI. O adapter em memória continua disponível e é o
fallback. Rollback remove a seleção do adapter PostgreSQL e recria o volume local;
nenhuma migração externa ou dado de usuário precisa ser revertido.

## 8. Fora de escopo

- conectar ao Supabase real;
- criar APIs CRUD de cadastro no frontend;
- criptografar identificadores reais ou realizar buscas judiciais;
- evidência, processo, evento, documento, outbox, job ou notificação;
- GCS, Secret Manager, Infisical sync, Scheduler, Tasks ou deploy;
- staging, production, billing, IA ou busca textual dedicada.

## 9. Critérios de aceite

1. `docker compose up --build` mantém os serviços atuais e inicia PostgreSQL
   saudável sem credencial externa.
2. migrations e pgTAP rodam em banco novo e após reset documentado.
3. contract tests passam para memória e PostgreSQL.
4. testes cross-tenant cobrem leitura, criação, relação e paginação; update e
   delete permanecem fora do contrato desta fatia.
5. API atual mantém testes, cobertura, lint, typecheck e build verdes.
6. scans não encontram segredo/PII e a auditoria de dependência não piora.
7. Compose valida, containers não usam modo privilegiado e o banco não publica
   porta por padrão.
8. custo permanece até US$ 0,38/mês, delta US$ 0.
