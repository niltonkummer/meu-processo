# Meu Processo — Engineering Guardrails

**Status:** obrigatório antes do desenvolvimento do produto
**Versão:** 1.1
**Atualizado em:** 29 de agosto de 2026

Este documento é normativo. Os termos **MUST**, **MUST NOT**, **SHOULD** e **MAY** indicam obrigação, proibição, recomendação forte e opção, respectivamente.

## 1. Princípios

1. Segurança, privacidade e isolamento entre usuários são requisitos funcionais.
2. Nenhuma feature começa sem comportamento esperado e critérios de aceitação.
3. Nenhum código de produção é escrito sem um teste que primeiro demonstre a ausência do comportamento.
4. Todo recurso de nuvem é definido como código.
5. O mesmo artefato imutável é promovido entre ambientes.
6. Nenhuma verificação é desativada apenas para fazer a pipeline passar.
7. Falha segura é preferível a resultado silenciosamente incorreto.
8. Dados oficiais, normalizados e gerados por IA são sempre distinguíveis.
9. Produção não é ambiente de teste.
10. Toda exceção tem responsável, justificativa, controle compensatório e validade.
11. Nenhuma alteração começa sem custo atual, esperado e limite operacional aprovados, inclusive quando o impacto for zero.

## 2. Spec-first e arquitetura

Antes de implementar uma história, o pull request ou issue MUST conter:

- problema e resultado esperado;
- critérios de aceitação observáveis;
- casos de sucesso, erro, ausência de dados e resposta parcial;
- impacto em privacidade, autorização e isolamento entre clientes;
- estratégia de testes;
- avaliação de custo versionada em `docs/costs/`, com status `aprovado para implementação`;
- plano de rollout e rollback quando houver mudança operacional.

Decisões que alterem arquitetura, armazenamento, autenticação, autorização, fontes de dados, retenção ou dependências críticas MUST gerar um ADR versionado.

Mudanças de contrato de API MUST ser compatíveis com a versão anterior durante a janela de migração ou ser explicitamente versionadas.

## 3. TDD e cobertura

### Ciclo obrigatório

Toda alteração de comportamento segue **Red → Green → Refactor**:

1. adicionar um teste que falha pelo motivo esperado;
2. implementar a menor alteração que o faz passar;
3. refatorar mantendo todos os testes verdes;
4. executar a suíte completa antes do merge.

Correções de bug MUST começar com um teste de regressão reproduzindo o defeito.

### Cobertura

Código de aplicação e domínio MUST manter:

- 100% de statements;
- 100% de branches;
- 100% de functions;
- 100% de lines.

Exclusões são permitidas apenas para código gerado, adaptadores puramente declarativos ou trechos comprovadamente inalcançáveis. Toda exclusão MUST estar documentada no arquivo de configuração e aprovada em revisão.

Cobertura não substitui qualidade. Também são obrigatórios:

- testes unitários de regras e normalização;
- testes de contrato para formatos do DJEN e outras fontes;
- testes de integração com emuladores e serviços locais;
- testes end-to-end dos fluxos críticos;
- testes de isolamento entre usuários e organizações;
- testes de propriedade/fuzz para número CNJ, deduplicação e entradas não confiáveis;
- mutation testing nos módulos críticos de autorização, deduplicação e vinculação de processos.

Meta inicial de mutation score: 80%, evoluindo para 90%. Mutantes sobreviventes em autorização ou isolamento bloqueiam merge independentemente da pontuação total.

Testes de pull request MUST ser determinísticos e não depender de APIs judiciais reais. Respostas externas são representadas por fixtures anonimizadas e contratos. Smoke tests contra fontes reais são separados, limitados e executados em ambiente controlado.

## 4. Estratégia Git

- `main` é protegida e sempre implantável.
- É proibido push direto em `main`.
- Trabalho ocorre em branches curtas: `feat/`, `fix/`, `chore/`, `docs/`, `security/`.
- Todo merge ocorre por pull request revisado.
- Commits seguem Conventional Commits.
- Cada commit deve representar uma unidade lógica e manter o projeto verificável.
- Rebase/squash é permitido na branch; force push em `main` é proibido.
- Pelo menos uma aprovação é necessária; duas para autenticação, autorização, IaC de produção e tratamento de dados pessoais.
- Discussões pendentes e checks obrigatórios bloqueiam merge.
- Releases são marcadas com versão semântica e notas de mudança.
- Dependências automáticas não recebem auto-merge quando alteram versão major, autenticação, build ou runtime.

Proteções mínimas de branch:

- pull request obrigatório;
- branch atualizada antes do merge;
- conversas resolvidas;
- reviews anulados após novos commits relevantes;
- assinatura/verificação de commits quando viável;
- todos os checks da seção de CI obrigatórios;
- exclusão da branch após merge.

## 5. Desenvolvimento local com Docker Compose

O ambiente local MUST iniciar com um único comando documentado, preferencialmente:

```text
docker compose up --build
```

O Compose deverá conter, conforme a fase:

- API/worker;
- frontend;
- Firebase/Firestore Emulator;
- emulador compatível de object storage quando necessário;
- serviços de teste, nunca credenciais ou dados de produção.

Regras:

- imagens base pinadas por versão e, em CI/produção, por digest;
- containers executam como usuário não-root;
- sem `privileged`, host network ou montagem ampla do host;
- filesystems read-only quando possível;
- healthchecks obrigatórios;
- limites de CPU/memória documentados;
- volumes de desenvolvimento claramente separados;
- `.env.example` contém somente nomes e valores não secretos;
- nenhum teste local depende de VPN, proxy público ou produção;
- fixtures não contêm CPF, nomes, documentos ou textos reais não anonimizados.

## 6. Infrastructure as Code

Terraform será a fonte de verdade de toda infraestrutura Google Cloud:

- APIs habilitadas;
- service accounts e IAM;
- Cloud Run e Cloud Run Jobs;
- Cloud Scheduler/Tasks/Pub/Sub quando usados;
- Firestore, buckets e lifecycle;
- Secret Manager;
- Artifact Registry;
- monitoramento, alertas e budgets;
- Workload Identity Federation;
- configurações de Firebase que sejam suportadas por IaC.

Regras:

- mudanças manuais no console são proibidas, exceto bootstrap ou incidente documentado;
- `terraform fmt`, `validate`, `tflint` e scanner de segurança são obrigatórios;
- o plano Terraform é anexado ao pull request;
- `apply` ocorre somente pela pipeline protegida;
- produção requer aprovação manual e revisão do plano salvo;
- state remoto usa bucket dedicado, versionamento, retenção, IAM mínimo e proteção contra deleção;
- módulos e providers são pinados;
- ambientes não compartilham state, service accounts, secrets ou dados;
- nenhuma saída de Terraform pode revelar segredo;
- permissões curinga exigem exceção formal.

O projeto atual `meu-processo-507018` será considerado desenvolvimento até decisão explícita. Staging e produção SHOULD usar projetos GCP separados.

### 6.1 FinOps e custo antes da implementação

Antes de qualquer alteração de código, configuração, dependência, workflow, dados ou infraestrutura, o autor MUST criar ou atualizar uma avaliação baseada em `docs/templates/infra-cost-assessment.md`. Impacto zero também MUST ser declarado e justificado.

A criação ou correção da própria avaliação é a única alteração permitida antes da aprovação; ela não pode modificar runtime, recursos, dependências ou dados do produto.

A avaliação é parte da Definition of Ready e MUST conter:

- custo mensal atual, esperado e limite operacional em USD;
- custo único de implantação, migração, backfill, recuperação e saída de dados;
- região, SKU, preço unitário, URL oficial e data de consulta;
- premissas reproduzíveis de requisições, processamento, armazenamento, operações, logs, retenção e egress;
- serviços externos, e-mail, APIs e IA que não sejam representados pelo Terraform;
- budgets, quotas, limites de taxa/tamanho/concorrência e condição de parada;
- responsável, prazo de validade e aprovação explícita.

Para mudanças Terraform:

- o diff Infracost é obrigatório e complementa, mas não substitui, a avaliação manual de consumo;
- a estimativa executa sem credenciais de nuvem e MUST NOT executar `terraform apply`;
- pull request externo sem acesso ao token Infracost permanece bloqueado até execução em contexto interno confiável;
- ausência de suporte do Infracost para um recurso MUST ser registrada como limitação e calculada manualmente.

Novo SKU faturável, `min_instances > 0`, aumento de retenção, tráfego entre regiões, consumo sem limite, aumento mensal superior a US$ 5 ou superior a 20% da base — prevalecendo o menor limite — exige aprovação explícita do proprietário antes da implementação.

Após deploy, o custo real MUST ser comparado à estimativa em 7 e 30 dias. Desvio superior a 20% exige investigação, correção da premissa e decisão registrada de manter, otimizar ou reverter.

## 7. Cloud e ambientes

Ambientes:

1. **local:** Docker Compose e emuladores;
2. **development:** integração contínua e dados sintéticos;
3. **staging:** réplica operacional sem dados pessoais de produção;
4. **production:** acesso restrito, deploy aprovado e dados reais.

Princípios cloud:

- São Paulo (`southamerica-east1`) é a região padrão do backend e dados;
- serviços são privados por padrão;
- escala a zero no MVP sempre que compatível;
- cada workload possui service account própria e mínimo privilégio;
- autenticação entre serviços usa identidade, nunca chaves estáticas;
- acesso do GitHub ao GCP usa OIDC/Workload Identity Federation;
- budgets, quotas e alertas de custo são obrigatórios;
- logs de auditoria e métricas de saúde são habilitados;
- produção possui procedimento testado de rollback;
- recursos públicos exigem ADR e threat model.

## 8. Segurança de aplicação e dados

### Autenticação e autorização

- toda autorização é aplicada no backend ou nas Security Rules;
- controles visuais no frontend são apenas UX;
- IDs públicos usam UUID/identificadores não enumeráveis;
- toda consulta é escopada por `userId` ou `organizationId`;
- caches e filas incluem o escopo do tenant;
- testes cross-tenant são obrigatórios em toda rota protegida;
- princípio deny-by-default;
- sessões/tokens não são persistidos em `localStorage`;
- segredos nunca são entregues ao frontend ou incluídos em `VITE_*`.

### Frontend

- renderização usa escape padrão do React;
- `dangerouslySetInnerHTML`, `innerHTML`, `eval`, `new Function` e scripts dinâmicos são proibidos sem exceção formal e sanitização auditada;
- URLs externas e links de fontes são validados por protocolo e host;
- CSP é implantada inicialmente em report-only e depois enforced, sem `unsafe-eval`;
- headers mínimos: CSP, `X-Content-Type-Options`, proteção contra framing, `Referrer-Policy` e `Permissions-Policy`;
- scripts de terceiros são minimizados, pinados e protegidos com SRI ou hospedados internamente;
- source maps não são publicados abertamente;
- service worker, se existir, armazena somente arquivos estáticos;
- dados processuais usam `Cache-Control: private, no-store`.

### Entrada, saída e arquivos

- toda entrada é validada por schema no limite da aplicação;
- limites de tamanho, paginação e timeout são explícitos;
- erros externos não são refletidos integralmente ao cliente;
- arquivos e documentos são tratados como conteúdo não confiável;
- HTML/SVG enviados por usuário não são renderizados inline;
- dados de fontes externas são tratados como não confiáveis mesmo quando oficiais.

### Dados pessoais

- classificação de dados e threat model precedem o piloto externo;
- coleta mínima e finalidade documentada;
- produção não é copiada para desenvolvimento;
- logs não contêm nomes completos, CPF/CNPJ, tokens ou conteúdo processual integral;
- retenção, exclusão e solicitação do titular são definidas antes da abertura pública;
- backups seguem a mesma política de retenção e acesso;
- respostas originais têm acesso restrito e trilha de auditoria.

## 9. Supply chain e vulnerability checks

Checks obrigatórios:

| Área | Ferramenta/classe | Política de bloqueio |
|---|---|---|
| Segredos | Gitleaks ou equivalente | qualquer segredo confirmado |
| SAST | CodeQL e/ou Semgrep | Critical/High confirmado |
| Dependências | npm audit + OSV-Scanner/Dependabot | Critical/High explorável; Medium com SLA |
| Licenças | scanner de licenças | licença proibida ou desconhecida |
| Containers | Trivy ou Grype | Critical/High explorável |
| SBOM | Syft ou Trivy CycloneDX/SPDX | ausência de SBOM |
| Dockerfile | Hadolint | erro configurado como bloqueante |
| IaC | Checkov + TFLint | Critical/High e misconfiguration obrigatória |
| Terraform | fmt/validate/plan | qualquer falha ou alteração inesperada |
| DAST | OWASP ZAP baseline em staging | alerta High confirmado |
| Frontend | auditoria CSP/headers | ausência de baseline em release |

Regras adicionais:

- lockfile é obrigatório e CI usa `npm ci`;
- atualização de dependência inclui teste e revisão do changelog;
- imagens são construídas uma vez, recebem SBOM, assinatura e provenance;
- produção recebe a imagem pelo digest aprovado em staging;
- tags mutáveis como `latest` não são usadas para deploy;
- dependências sem manutenção ou com install scripts injustificados devem ser evitadas;
- vulnerabilidades Critical têm SLA imediato; High, 7 dias; Medium, 30 dias; Low, backlog priorizado.

Exceções de vulnerabilidade MUST registrar CVE/regra, análise de explorabilidade, responsável, controle compensatório e expiração máxima de 30 dias. `ignore` sem justificativa é proibido.

## 10. CI obrigatória em pull requests

Os checks podem executar em paralelo, mas todos são obrigatórios:

1. avaliação de custo aprovada e alterada no próprio pull request;
2. política de PR e commits;
3. instalação reproduzível;
4. formatação e lint;
5. typecheck;
6. testes unitários;
7. cobertura 100%;
8. testes de integração em Docker Compose/emuladores;
9. testes de isolamento e contratos;
10. build de produção;
11. secret scan;
12. SAST;
13. dependency e license scan;
14. Dockerfile lint;
15. build da imagem;
16. container scan e geração de SBOM;
17. Terraform fmt/validate/TFLint/Checkov;
18. plano Terraform e diff Infracost para mudanças de infraestrutura;
19. testes end-to-end dos fluxos críticos.

Mutation testing completo MAY executar em pipeline noturna, mas módulos de autorização, tenant isolation e deduplicação MUST ser verificados no pull request.

Nenhuma pipeline usa credencial estática de nuvem. Pull requests de forks ou código não confiável não recebem secrets.

## 11. CD e promoção

```text
Pull request aprovado
        ↓
merge em main
        ↓
build único + testes + scan + SBOM + assinatura
        ↓
deploy automático em development
        ↓
smoke + integração
        ↓
promoção do mesmo digest para staging
        ↓
E2E + DAST + observabilidade
        ↓
aprovação manual
        ↓
produção gradual/canário
        ↓
health checks e rollback automático/manual
```

Regras:

- produção nunca recompila o código;
- deploy só usa artefato assinado e aprovado;
- migrations são versionadas, compatíveis e testadas;
- mudança destrutiva exige backup verificado e plano de reversão;
- falha em smoke test interrompe promoção;
- rollback aponta para digest anterior conhecido;
- jobs concorrentes do mesmo ambiente são serializados;
- ambiente production do GitHub exige reviewers autorizados;
- deploy de emergência segue break-glass auditado e gera retrospectiva.

## 12. Observabilidade e operação

- logs estruturados com correlation ID, sem conteúdo sensível;
- métricas de latência, erro, disponibilidade da fonte, resultados, duplicidade e custo;
- alertas acionáveis com runbook;
- health, readiness e startup checks;
- SLOs definidos antes do piloto externo;
- falha de fonte mantém o último dado válido e marca desatualização;
- auditoria de acesso a dados sensíveis;
- testes periódicos de restore e rollback;
- dependências externas possuem timeout, retry limitado, backoff e circuit breaker quando necessário.

## 13. Definition of Done

Uma alteração só está pronta quando:

- critérios de aceitação estão atendidos;
- teste foi escrito antes da implementação;
- cobertura permanece em 100%;
- testes unitários, integração, isolamento e E2E passam;
- lint, typecheck e build passam;
- scans de segurança, dependências, container e IaC passam;
- documentação e ADR foram atualizados;
- mudança de infraestrutura está em Terraform;
- logs, métricas e alertas necessários existem;
- avaliação de custo está aprovada, anexada ao pull request e consistente com o diff Infracost quando aplicável;
- custo real possui responsável e datas de verificação em 7 e 30 dias quando houver deploy;
- rollout e rollback foram verificados;
- não há segredo, dado pessoal de teste ou bypass de segurança;
- reviewer confirma que os dados de um processo não podem aparecer em outro contexto.

## 14. Alteração destes guardrails

Este documento só pode ser alterado por pull request dedicado, com justificativa explícita e revisão de segurança. Reduções de cobertura, remoção de checks ou ampliação de permissões não podem ser misturadas a uma feature.
