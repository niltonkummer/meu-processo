# Avaliação de custo 0005 — proxy público autenticado no Brasil

<!-- infra-cost-assessment:v1 -->

**Status:** aprovado para implementação e rollout de validação
**Solicitado por:** proprietário do produto
**Responsável:** proprietário do produto e engenharia
**Data da avaliação:** 30 de agosto de 2026
**Ambiente:** `validation` em `southamerica-east1`
**Spec:** [Spec 0004](../specs/0004-authenticated-brazilian-proxy.md)

**Custo mensal atual (USD):** variável, serviço existente em escala a zero
**Custo mensal esperado incremental (USD):** até US$ 0,05 para 100 PDFs/mês
**Custo mensal limite (USD):** US$ 10
**Aprovação:** o objetivo “preparar tudo e permitir a consulta e abertura de um
processo via proxy via Google Cloud” autoriza o rollout controlado descrito aqui;
não autoriza produção, novo banco/bucket, commit, push ou merge

## 1. Decisão

Reutilizar o Cloud Run `meu-processo-mvp`, sem segundo serviço, banco, cache,
Storage, VPC, NAT, load balancer ou Cloud Armor. O Identity Platform já aprovado
na avaliação 0004 será aplicado diretamente, com uma chave de navegador
restrita. Um binding sem custo
`roles/run.invoker` para `allUsers` será habilitado apenas após a revisão
protegida ser testada enquanto o serviço ainda estiver privado.

O alcance público serve o frontend e health. Consulta e download exigem Firebase
ID token e rate limit no aplicativo. O documento é transmitido sem persistência.
Um desafio visual, quando necessário, usa somente memória já alocada na instância
e afinidade de sessão de melhor esforço; não cria banco, cache ou novo SKU.

## 2. Estimativa

Premissas: PDF médio de 2 MiB, cinco segundos ativos, 1 vCPU/512 MiB, 100 PDFs e
1.000 consultas por mês no cenário de validação. Franquias não reduzem o limite.

| Componente | Alteração | Esperado/mês | Limite operacional |
|---|---|---:|---:|
| Cloud Run existente | revisão autenticada, ainda escala a zero | US$ 0,01 | US$ 2,50 |
| Internet egress de PDFs | 0,2 GiB esperado | até US$ 0,04 | US$ 7,50 |
| Identity Platform e-mail/senha | até 1.000 MAU | US$ 0 | parar em 10.000 MAU |
| IAM público, chave restrita e APIs (inclui Cloud Resource Manager) | configuração sem SKU provisionado | US$ 0 | US$ 0 |
| Firestore, Storage, NAT, LB, Armor | não criar | US$ 0 | US$ 0 |

O cenário de 1.000 PDFs/2 GiB permanece estimado em aproximadamente US$ 0,51;
10.000 PDFs/20 GiB em aproximadamente US$ 5,07. O rollout para antes de US$ 10
estimados ou de qualquer novo recurso faturável.

## 3. Controles de custo e abuso

- `min_instance_count = 0`, `max_instance_count = 2`, concorrência 20;
- afinidade de sessão apenas para o desafio efêmero de até dois minutos;
- 10 consultas e 20 downloads por minuto por UID e instância;
- máximo de 25 MiB e dois downloads simultâneos por instância;
- sem retry automático após HTTP 429 e sem rotação de IP;
- somente dois hosts TJRS em allowlist;
- rollout em duas fases e rollback remove primeiro o binding público;
- medir requests, downloads, bytes, erros 429/502 e custo em D+1, D+7 e D+30.

Budgets do Google Cloud alertam, mas não impõem hard cap. Antes de produção será
obrigatório adicionar controle global de borda e alerta financeiro revisado.

## 4. Evidência

- [Cloud Run pricing](https://cloud.google.com/run/pricing), consultado em
  30/08/2026: cobrança por uso, escala a zero, request-based CPU
  US$ 0,000024/vCPU-s, memória US$ 0,0000025/GiB-s e US$ 0,40/milhão.
- [Google Cloud network pricing](https://cloud.google.com/vpc/network-pricing),
  consultado em 30/08/2026.
- [Identity Platform pricing](https://cloud.google.com/identity-platform/pricing),
  consultado em 30/08/2026.
- [DJEN OpenAPI 1.0.4](https://hcomunicaapi.cnj.jus.br/swagger/djen.yml),
  consultado em 30/08/2026: endpoint público, rate limit por IP e vedação ao uso
  de múltiplos IPs para contornar a taxa.
- Plano Terraform remoto de 30/08/2026 (`public_access_enabled=false`): 3 recursos
  adicionados (Identity Platform, chave restrita e ativação de API), nenhuma
  alteração e nenhuma destruição. Nenhum banco, bucket, rede ou segundo serviço.
- Infracost 2.16.2, executado em 30/08/2026 sobre a configuração correspondente:
  17 recursos, 5 precificados, 12 gratuitos e US$ 0,02/mês de custo-base total
  identificado (uma versão de chave KMS já existente). Identity Platform e API
  Keys ainda não são precificados pelo parser; seus preços
  foram verificados nas fontes oficiais acima. O alerta de tags exibido pertence
  à política demonstrativa do trial do Infracost e não altera a estimativa.

## 5. Condições de parada

Não publicar se uma API cara aceitar chamada sem token, se a revisão privada não
passar smoke, se o plano criar recurso fora da tabela, se existir finding
High/Critical, se o PDF TJRS não passar do runtime brasileiro ou se o custo
estimado exceder US$ 10.
