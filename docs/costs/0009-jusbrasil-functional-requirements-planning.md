# Avaliação de custo 0009 — levantamento funcional e plano de requisitos

<!-- infra-cost-assessment:v1 -->

**Status:** aprovado para implementação
**Solicitado por:** proprietário do produto
**Responsável:** proprietário do produto e engenharia
**Data da avaliação:** 30 de agosto de 2026
**Ambientes afetados:** documentação local; nenhum ambiente de runtime
**Spec/issue:** levantamento funcional, plano de requisitos e ADRs solicitados em 30/08/2026

**Custo mensal atual (USD):** até US$ 0,38 no cenário de validação já aprovado
**Custo mensal esperado (USD):** até US$ 0,38; delta mensal US$ 0
**Custo mensal limite (USD):** US$ 10
**Aprovação:** o pedido do proprietário para levantar as funcionalidades, criar a spec, o plano de requisitos e os ADRs aprova esta alteração exclusivamente documental em 30/08/2026

## 1. Decisão

Autorizar pesquisa manual e documentação do panorama funcional do Jusbrasil,
incluindo a criação de uma especificação de produto, um roadmap de requisitos e
ADRs de arquitetura. A pesquisa usa somente navegação interativa controlada e
páginas públicas ou acessíveis pela conta do proprietário, sem coleta em massa,
automação recorrente ou persistência de respostas e dados pessoais.

Esta avaliação não autoriza implementar as capacidades planejadas. Cada fatia
de runtime, dado, dependência ou infraestrutura descrita no roadmap exigirá sua
própria avaliação de custo aprovada antes do desenvolvimento.

O impacto de infraestrutura desta mudança é zero.

## 2. Alteração de infraestrutura

| Componente/SKU | Região | Estado atual | Estado proposto | Quantidade | Custo unitário | Delta mensal |
|---|---|---|---|---:|---:|---:|
| Documentação versionada | local/Git | existente | novos arquivos Markdown | — | US$ 0 | US$ 0 |
| Cloud Run, Identity Platform e worker | `southamerica-east1`/global | cenário de validação existente | sem mudança | — | inalterado | US$ 0 |
| Firestore, Storage, filas, busca e IA | — | não provisionados para esta etapa | não provisionar | 0 | — | US$ 0 |

Custos únicos de implantação, migração, backfill, recuperação e saída de dados:
US$ 0. Não haverá deploy, alteração Terraform, execução de crawler ou cópia de
base externa.

## 3. Premissas e cenários

| Direcionador | Base atual | Esperado | Limite operacional | Unidade |
|---|---:|---:|---:|---|
| Requisições do produto | cenário aprovado | inalterado | inalterado | por mês |
| Navegação de pesquisa | manual e pontual | uma sessão | sem automação | sessão |
| Processamento em nuvem | cenário aprovado | inalterado | inalterado | vCPU-s/GiB-s |
| Armazenamento adicional | 0 | 0 | 0 | GiB-mês |
| Operações de dados adicionais | 0 | 0 | 0 | operações/mês |
| Saída de rede adicional do produto | 0 | 0 | 0 | GiB/mês |
| Logs adicionais do produto | 0 | 0 | 0 | GiB/mês |

O cenário atual, esperado e limite operacional do runtime permanecem iguais. O
roadmap poderá mencionar serviços futuros apenas como hipótese; nenhuma hipótese
é aprovação para consumo.

## 4. Custos não cobertos automaticamente

- **Cloud Run, Firestore, Storage, egress, logs e filas:** não sofrem alteração.
- **E-mail, WhatsApp, APIs de terceiros e IA:** não serão contratados nem usados
  pelo produto nesta etapa.
- **Busca dedicada e analytics:** não serão provisionados.
- **Infracost:** não aplicável porque não há mudança Terraform.
- **Pesquisa manual no navegador:** não gera SKU do projeto GCP nem persistência
  no produto.
- **Impostos e câmbio:** não aplicáveis ao delta de US$ 0.

## 5. Limites e condição de parada

- Proibido iniciar crawler, backfill, coleta em massa ou copiar conteúdo
  proprietário durante este levantamento.
- Proibido registrar na documentação dados de conta, cobrança, nomes de partes,
  números de processos ou qualquer resposta processual real observada.
- Proibido alterar runtime, dependências, CI, Terraform ou ambientes.
- Qualquer implementação futura para imediatamente até existir uma nova
  avaliação aprovada com volumes, preços, quotas e condição de parada.
- Somente o proprietário pode aprovar novo SKU ou aumento do limite de US$ 10.
- Validade desta estimativa: enquanto a mudança permanecer apenas documental.

## 6. Evidência e fontes

- [Avaliação 0007 — consulta autenticada sem verificação de e-mail](./0007-authenticated-access-without-email-verification.md), baseline de custo.
- [Cloud Run pricing](https://cloud.google.com/run/pricing), sem alteração nesta etapa.
- [Firestore pricing](https://cloud.google.com/firestore/pricing), não provisionado nesta etapa.
- [Cloud Storage pricing](https://cloud.google.com/storage/pricing), não provisionado nesta etapa.
- Limitação: funcionalidades futuras ainda não possuem volume nem arquitetura
  aprovada; seus custos serão avaliados por fatia.

## 7. Aprovação

O pedido explícito do proprietário aprova a criação local desta documentação. A
aprovação não autoriza implementação, commit, push, PR, merge, deploy, aquisição
de dados, contratação de fornecedor, coleta em massa ou alteração do ambiente.

## 8. Verificação posterior

Não aplicável sem deploy. A revisão final deve confirmar que o diff contém
somente documentação e que o custo mensal esperado continua em até US$ 0,38.
