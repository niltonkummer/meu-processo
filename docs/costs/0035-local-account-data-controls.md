# Avaliação de custo 0035 — controles locais de dados da conta

<!-- infra-cost-assessment:v1 -->

**Status:** aprovado para implementação  
**Solicitado por:** proprietário do produto  
**Responsável:** engenharia do Meu Processo  
**Data da avaliação:** 31 de agosto de 2026  
**Ambientes afetados:** local e CI  
**Spec/issue:** continuação da Spec 0027 e do gate FND-019

**Custo mensal atual (USD):** até US$ 0,38 já aprovado; execução local US$ 0  
**Custo mensal esperado (USD):** inalterado; delta US$ 0  
**Custo mensal limite (USD):** inalterado; esta fatia não pode consumir cloud  
**Aprovação:** proprietário, continuação explícita do plano em 31/08/2026,
restrita à API, ao painel, ao PostgreSQL e ao armazenamento privado locais,
testes e CI

## 1. Decisão

Implementar os controles locais de dados da conta para uma pessoa autenticada:
solicitar exportação, acompanhar seu estado, baixar o artefato JSON concluído e
solicitar a exclusão da conta com autenticação recente e confirmação explícita.
A fatia autoriza contratos OpenAPI, migração PostgreSQL aditiva, serviços e
handlers TypeScript, entrega privada pelo servidor, interface React, testes
pgTAP/unitários/integração/E2E e documentação operacional.

O impacto de infraestrutura e custo é zero. O worker permanece one-shot e
local. Não serão ativados Supabase gerenciado, Google Cloud Storage, Cloud Run,
Jobs/Tasks, Brevo, Infisical, fonte judicial real, egress ou dados pessoais.

## 2. Alteração de infraestrutura

| Componente/SKU | Região | Estado atual | Estado proposto | Quantidade | Custo unitário | Delta mensal |
|---|---|---|---|---:|---:|---:|
| PostgreSQL efêmero | Docker Compose/local | migrations 0001–0013 | projeção tenant-bound de estado e download | 1 banco efêmero | US$ 0 | US$ 0 |
| Object store privado local | filesystem isolado | exportações sintéticas com TTL | leitura validada pelo servidor | até 10 MiB por tenant de teste | US$ 0 | US$ 0 |
| API e painel | processo local/CI | lifecycle sem superfície pública | quatro operações autenticadas e UI | 1 runtime local | US$ 0 | US$ 0 |
| Worker de ciclo de vida | processo local/CI | one-shot, concorrência 1 | sem alteração de capacidade | até 10 solicitações por lote | US$ 0 | US$ 0 |
| Cloud/Supabase/GCS/e-mail | — | configuração atual | sem alteração ou consumo | 0 | — | US$ 0 |

Não há custo único de implantação, migração remota, backfill, recuperação ou
saída de dados. Nenhum arquivo Terraform será alterado.

## 3. Premissas e cenários

| Direcionador | Esperado | Limite operacional | Unidade |
|---|---:|---:|---|
| Tenants sintéticos por teste | 3 | 20 | tenants efêmeros |
| Solicitações por tenant | 2 | 10 | exportação/exclusão |
| Consultas de estado | 5 | 100 | por execução de teste |
| Downloads de exportação | 1 | 10 | por tenant de teste |
| Tamanho de exportação | abaixo de 1 | 10 | MiB |
| Retenção de exportação | 24 | 24 | horas |
| Chamadas externas | 0 | 0 | chamadas |
| Armazenamento/egress/logs cloud | 0 | 0 | consumo mensal |

O cenário esperado e o limite permanecem em US$ 0 porque todo o tráfego e os
artefatos são sintéticos e locais. A futura execução gerenciada exigirá outra
avaliação baseada em solicitações, tamanho armazenado e downloads reais.

## 4. Custos não cobertos automaticamente

- Supabase, GCS, Cloud Run, Jobs/Tasks, egress e logs cloud: não consumidos.
- Infisical, Secret Manager, Brevo, APIs judiciais e IA: não consumidos.
- Infracost: não aplicável porque o diff Terraform deve permanecer vazio.
- Pacotes npm: nenhum pacote novo autorizado; usar dependências já pinadas.
- Restore local: coberto pelos testes existentes, sem armazenamento faturado.
- Impostos e câmbio: não aplicáveis ao delta zero.

## 5. Limites e condição de parada

- todas as leituras e mutações são resolvidas no servidor pelo tenant da
  identidade autenticada; identificadores do cliente nunca definem o tenant;
- listagem, estado, objeto e download de outro tenant devem parecer ausentes;
- o cliente fornece somente o `requestId`; o locator privado nunca é exposto;
- o download só ocorre em estado `completed`, antes do TTL, após conferir
  tamanho e SHA-256, com `attachment`, `nosniff` e `private, no-store`;
- respostas públicas não expõem locator, hash de lease, código interno de
  falha, CPF/CNPJ, token ou conteúdo de outro tenant;
- exclusão exige conta pessoal, confirmação textual exata e token com
  autenticação feita há no máximo cinco minutos; não pode usar GET;
- tokens permanecem apenas em memória; o painel não persiste dados sensíveis e
  não usa renderização HTML insegura;
- Bearer token no cabeçalho permanece o único mecanismo de sessão desta fatia;
  qualquer migração para cookie exige análise e defesa CSRF próprias;
- o worker não será disparado por uma rota pública; execução local permanece
  one-shot e a ativação gerenciada exige novo gate de custo;
- qualquer ativação cloud, novo pacote, dado real, retenção maior, email ou
  mudança de custo interrompe a implementação e exige nova aprovação;
- somente o proprietário pode aceitar aumento; validade até 30/09/2026 ou
  mudança de escopo, o que ocorrer primeiro.

## 6. Evidência e fontes

- avaliação 0034 e ADR 0022, ciclo de vida em duas fases;
- Spec 0027 e threat model 0007;
- Engineering Guardrails, seções 6.1, 8, 10 e 13;
- baseline de segurança React/Node: autorização no servidor, tokens em memória,
  anexos privados, validação estrita e sem sinks HTML;
- Infracost dispensado por diff Terraform vazio.

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
