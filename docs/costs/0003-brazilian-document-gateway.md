# Avaliação de custo 0003 — gateway brasileiro de documentos

<!-- infra-cost-assessment:v1 -->

**Status:** aprovado para implementação local; deploy não autorizado
**Solicitado por:** proprietário do produto
**Responsável:** engenharia
**Data da avaliação:** 29 de agosto de 2026
**Ambientes afetados:** local e integração contínua
**Spec/issue:** Spec 0002, fase D — gateway brasileiro

**Custo mensal atual (USD):** US$ 0 de impacto desta entrega local
**Custo mensal esperado após deploy futuro (USD):** aproximadamente US$ 0,51
**Custo mensal limite antes de nova aprovação (USD):** US$ 10
**Aprovação:** solicitação explícita do proprietário para implementar o gateway em 29 de agosto de 2026

## 1. Decisão

Implementar o gateway dentro da API Cloud Run já prevista para
`southamerica-east1`, sem criar um segundo serviço e sem copiar documentos para
Cloud Storage nesta etapa.

O gateway:

- recebe apenas IDs internos de processo e documento;
- autoriza usuário, organização, processo e documento antes da saída de rede;
- obtém a URL exclusivamente do repositório confiável do servidor;
- aplica allowlist exata de hosts, HTTPS obrigatório, resolução DNS segura,
  limite de redirecionamentos, tempo e tamanho;
- aceita inicialmente somente PDF;
- não persiste o arquivo e não registra URL ou conteúdo em logs;
- devolve o documento com cache privado desabilitado.

Essa alternativa evita custo de operações e armazenamento, e é adequada ao
baixo volume de validação. Cache privado em Storage só será reconsiderado se a
medição mostrar repetição suficiente para compensar armazenamento, operações e
complexidade de retenção.

## 2. Alteração de infraestrutura

| Componente/SKU | Região | Estado atual | Estado proposto | Delta mensal esperado |
|---|---|---|---|---:|
| Cloud Run existente | `southamerica-east1` | API de validação | mesma API com gateway | US$ 0,13 de compute antes de franquias |
| Saída de rede | conforme destino do usuário | busca e API | até 2 GiB/mês no cenário esperado | até US$ 0,38 |
| Cloud Storage | não aplicável | nenhum cache de documento | sem alteração | US$ 0 |
| Novo Cloud Run/VPC/NAT | não aplicável | inexistente | não criar | US$ 0 |

Não há alteração Terraform nesta entrega local. O deploy futuro reutilizaria o
serviço existente e exigiria aprovação específica do plano e desta estimativa.

## 3. Premissas e cenários

Premissas de cálculo conservadoras:

- documento médio de 2 MiB;
- cinco segundos de tempo ativo por documento;
- 1 vCPU e 512 MiB já configurados no serviço;
- tarifação por requisição do Cloud Run;
- saída de rede calculada pelo maior valor inicial relevante de US$ 0,19/GiB;
- franquias gratuitas não são usadas para reduzir o limite operacional.

| Cenário | Documentos/mês | Volume entregue | Compute estimado | Rede estimada | Total estimado |
|---|---:|---:|---:|---:|---:|
| Validação | 100 | 0,2 GiB | US$ 0,01 | US$ 0,04 | US$ 0,05 |
| Esperado | 1.000 | 2 GiB | US$ 0,13 | US$ 0,38 | US$ 0,51 |
| Limite operacional | 10.000 | 20 GiB | US$ 1,27 | US$ 3,80 | US$ 5,07 |

O limite financeiro de US$ 10 mantém margem para documentos maiores, retries e
destinos mais caros. A funcionalidade deve ser interrompida ou reavaliada antes
de ultrapassar esse valor mensal estimado.

## 4. Custos não cobertos automaticamente

- o tribunal ou provedor de origem pode impor custo, autenticação ou limite
  próprio; nenhum conector pago está autorizado;
- proteção de borda, Cloud Armor, load balancer e VPC/NAT não estão incluídos;
- logs devem conter somente metadados técnicos mínimos, mas eventual volume
  acima da franquia exige nova estimativa;
- câmbio, impostos e suporte não estão incluídos;
- documentos protegidos por CAPTCHA ou login não serão contornados.

## 5. Limites e condição de parada

- máximo inicial de 25 MiB por documento;
- máximo de dois downloads simultâneos por instância para limitar buffers em
  memória;
- timeout total inicial de 15 segundos e no máximo três redirecionamentos;
- somente HTTPS, porta 443, host exato autorizado e endereço IP público;
- somente `application/pdf`;
- entrega como anexo; visualização inline na origem principal permanece
  desabilitada;
- nenhuma URL, hostname, caminho de bucket ou credencial fornecida pelo cliente;
- falha fechada quando DNS, origem, tipo, tamanho ou hash forem inesperados;
- teste cross-tenant, SSRF, redirect inseguro, vazamento de URL ou cobertura
  inferior a 100% impede conclusão;
- qualquer Storage, novo serviço, VPC, NAT, CDN ou deploy exige nova aprovação.

## 6. Evidência e fontes

- [Preços oficiais do Cloud Run](https://cloud.google.com/run/pricing): cobrança
  por uso, CPU de US$ 0,000024/vCPU-s, memória de US$ 0,0000025/GiB-s e US$ 0,40
  por milhão de requisições para tarifação por requisição; valores consultados
  em 29 de agosto de 2026.
- [Preços oficiais de rede do Google Cloud](https://cloud.google.com/vpc/network-pricing):
  Premium Tier e até US$ 0,19/GiB para os destinos conservadores do cenário;
  valores consultados em 29 de agosto de 2026.
- [Spec 0002](../specs/0002-process-monitoring-functional-parity.md)
- [Engineering Guardrails](../../ENGINEERING_GUARDRAILS.md)

## 7. Aprovação e rollout

A solicitação atual autoriza código, testes, documentação e validação local.
Não autoriza commit, push, merge, provisionamento ou deploy. Antes do rollout,
o plano deve mostrar que nenhum recurso faturável novo foi criado, a allowlist
real deve ser revisada por fonte e os testes de capacidade do tribunal precisam
passar a partir do runtime brasileiro.

## 8. Verificação posterior

Após um deploy aprovado, medir em 7 e 30 dias: downloads, bytes de entrada e
saída, duração, taxa de cache inexistente, falhas por origem, bloqueios SSRF,
custo por documento e repetição por hash. Storage só será proposto com esses
dados.
