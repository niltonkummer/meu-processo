# Avaliação de custo 0034 — fundação local do ciclo de vida de dados

<!-- infra-cost-assessment:v1 -->

**Status:** aprovado para implementação  
**Solicitado por:** proprietário do produto  
**Responsável:** engenharia do Meu Processo  
**Data da avaliação:** 31 de agosto de 2026  
**Ambientes afetados:** local e CI  
**Spec/issue:** Spec 0009 — FND-019, antes do piloto persistente

**Custo mensal atual (USD):** até US$ 0,38 já aprovado; execução local US$ 0  
**Custo mensal esperado (USD):** inalterado; delta US$ 0  
**Custo mensal limite (USD):** inalterado; esta fatia não pode consumir cloud  
**Aprovação:** proprietário, continuação explícita do plano em 31/08/2026,
restrita a documentação, PostgreSQL e armazenamento privado locais, testes e CI

## 1. Decisão

Implementar a fundação local e tenant-bound para classificação, retenção,
solicitação de exportação e exclusão dos dados privados do produto. A fatia
autoriza especificação e threat model, uma migração PostgreSQL aditiva, funções
com menor privilégio, serviços TypeScript, worker idempotente, manifestos de
exportação sintéticos no object store local, testes pgTAP/integração/E2E e a
documentação de operação, rollout e rollback.

O impacto de infraestrutura e custo é zero. Não serão ativados Supabase
gerenciado, Google Cloud Storage, Cloud Run Jobs/Tasks, Brevo, Infisical, fonte
judicial real, egress ou dados pessoais. A exclusão será exercitada apenas em
bancos efêmeros com tenants e objetos sintéticos.

## 2. Alteração de infraestrutura

| Componente/SKU | Região | Estado atual | Estado proposto | Quantidade | Custo unitário | Delta mensal |
|---|---|---|---|---:|---:|---:|
| PostgreSQL efêmero | Docker Compose/local | migrations 0001–0011 | uma migration aditiva e testes pgTAP | 1 banco efêmero | US$ 0 | US$ 0 |
| Object store privado local | filesystem isolado | artefatos sintéticos de documentos | manifestos de exportação sintéticos com TTL | até 10 MiB por tenant de teste | US$ 0 | US$ 0 |
| Worker de ciclo de vida | processo local/CI | inexistente | execução one-shot, concorrência 1 | até 10 solicitações por lote | US$ 0 | US$ 0 |
| Cloud/Supabase/GCS/e-mail | — | configuração atual | sem alteração ou consumo | 0 | — | US$ 0 |

Não há custo único de implantação, migração remota, backfill, recuperação ou
saída de dados. Nenhum arquivo Terraform será alterado.

## 3. Premissas e cenários

| Direcionador | Base atual | Esperado | Limite operacional | Unidade |
|---|---:|---:|---:|---|
| Tenants sintéticos por teste | 2 | 3 | 20 | tenants efêmeros |
| Solicitações por lote | 0 | 3 | 10 | exportação/exclusão |
| Concorrência do worker | 0 | 1 | 1 | execução local |
| Tamanho de exportação | 0 | abaixo de 1 | 10 | MiB por tenant |
| Retenção de exportação | 0 | 24 | 24 | horas |
| Tentativas por solicitação | 0 | 1 | 3 | tentativas |
| Chamadas externas | 0 | 0 | 0 | chamadas |
| Armazenamento/egress/logs cloud | 0 | 0 | 0 | consumo mensal |

O cenário esperado e o limite permanecem em US$ 0 por executarem apenas no
ambiente local e no runner já utilizado. A futura execução gerenciada exigirá
avaliação própria baseada no volume real de linhas, objetos e downloads.

## 4. Custos não cobertos automaticamente

- Supabase, GCS, Cloud Run, Jobs/Tasks, egress e logs cloud: não consumidos.
- Infisical, Secret Manager, Brevo, APIs judiciais e IA: não consumidos.
- Infracost: não aplicável porque o diff Terraform deve permanecer vazio.
- Pacotes npm: nenhum pacote novo autorizado; usar dependências já pinadas.
- Restore local: coberto pelos testes existentes, sem armazenamento faturado.
- Impostos e câmbio: não aplicáveis ao delta zero.

## 5. Limites e condição de parada

- toda solicitação, fila, exportação, auditoria e objeto inclui `tenant_id`;
- RLS deve permanecer habilitada e forçada, com acesso somente por funções de
  privilégio mínimo e testes cross-tenant;
- um tenant nunca pode exportar, consultar ou apagar dados de outro tenant;
- exclusão não apaga evidência pública compartilhada com finalidade autônoma,
  mas revoga todas as relações e acessos privados do tenant solicitante;
- manifestos e logs não podem conter token, CPF/CNPJ em claro, nome real ou
  conteúdo processual integral;
- exportações expiram após 24 horas e objetos expirados entram em reconciliação;
- lote máximo 10, concorrência 1, no máximo 3 tentativas e transações curtas;
- exclusão HTTP pública não será ativada sem autenticação recente, confirmação
  explícita e uma avaliação complementar do fluxo de conta;
- qualquer ativação cloud, novo pacote, dado real, retenção maior ou mudança de
  custo interrompe a implementação e exige nova aprovação;
- somente o proprietário pode aceitar aumento; validade até 30/09/2026 ou
  mudança de escopo, o que ocorrer primeiro.

## 6. Evidência e fontes

- Engineering Guardrails, seções 6.1, 8, 10 e 13;
- Spec 0009, requisito FND-019;
- MER 0001, classificação, retenção e transações de exportação/exclusão;
- recomendações Supabase/PostgreSQL: constraints, índices de FKs, RLS forçada,
  papéis mínimos, `timestamptz`, índices parciais e transações curtas;
- Infracost dispensado por diff Terraform vazio;
- limitação: o valor de produção de Supabase, GCS, backup, egress e downloads só
  poderá ser estimado após telemetria sintética desta etapa.

## 7. Aprovação

Status **aprovado para implementação** local/CI. A continuação solicitada pelo
proprietário autoriza somente o escopo local desta avaliação. Não autoriza
commit, push, deploy, recurso cloud, acesso a contas externas, fonte real ou
dado pessoal.

## 8. Verificação posterior

Não há deploy ou custo externo a verificar em 7/30 dias.

| Data | Custo estimado | Custo real | Variação | Explicação | Ação |
|---|---:|---:|---:|---|---|
| 31/08/2026 | US$ 0 | US$ 0 | US$ 0 | implementação local/CI | manter cloud desativada |
