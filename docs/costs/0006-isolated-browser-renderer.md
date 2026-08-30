# Avaliação de custo 0006 — renderizador isolado do desafio TJRS

<!-- infra-cost-assessment:v1 -->

**Status:** aprovado para implementação e rollout de validação
**Solicitado por:** proprietário do produto
**Responsável:** proprietário do produto e engenharia
**Data da avaliação:** 30 de agosto de 2026
**Ambientes afetados:** local, integração contínua e `validation` em
`southamerica-east1`
**Spec/issue:** extensão da Spec 0004 — abertura assistida de documento oficial

**Custo mensal atual (USD):** US$ 0,02 de base identificada pelo Infracost,
mais consumo variável do serviço existente
**Custo mensal esperado (USD):** US$ 0,33 incremental para 100 documentos/mês
**Custo mensal limite (USD):** US$ 10 incremental
**Aprovação:** proprietário do produto, aprovado explicitamente em 30 de agosto
de 2026; a solicitação “Commit e Publique no gcloud para que eu consiga testar”
autoriza commit e rollout privado no ambiente `validation`. Abertura pública,
produção e novos recursos continuam fora do escopo.

## 1. Decisão proposta

Criar um segundo serviço privado do Cloud Run, dedicado a executar um navegador
Chromium em São Paulo. O serviço renderizará somente a página oficial
previamente resolvida pelo gateway, recortará o desafio visual para apresentação
ao usuário e enviará o código que o próprio usuário digitar. Ele não fará OCR,
reconhecimento por IA, resolução ou contorno automático de CAPTCHA.

O desafio, a digitação e a entrega ocorrerão na mesma conexão WebSocket
autenticada e limitada a 120 segundos, encaminhada pelo gateway. Manter a mesma
conexão preserva o contexto do navegador na mesma instância sem depender de
afinidade de sessão, reconexão, banco ou cache. Se a conexão cair, o contexto é
descartado e o usuário reinicia o fluxo; nunca se tenta reconstruí-lo com estado
de outro processo.

O serviço será separado porque o navegador amplia superfície de ataque, tamanho
da imagem, memória e tempo de execução. O isolamento permite aplicar IAM próprio,
concorrência baixa, allowlist de rede e limites mais restritos sem aumentar os
privilégios do frontend ou da API principal.

Esta avaliação autoriza, somente após aprovação:

- código e testes TDD do renderizador e da integração com o gateway;
- um serviço Cloud Run privado em `southamerica-east1`, definido por Terraform;
- uma conta de serviço própria e IAM serviço-a-serviço de mínimo privilégio;
- uma imagem Chromium no Artifact Registry regional já existente;
- validação controlada com desafio resolvido exclusivamente por uma pessoa.

Não autoriza Storage, Firestore, Redis, Cloud Tasks, NAT, VPC connector, load
balancer, Cloud Armor, OCR/IA, fornecedor de CAPTCHA, produção, commit, push,
merge ou deploy. Qualquer um desses itens exige nova avaliação e aprovação.

## 2. Alteração de infraestrutura

| Componente/SKU | Região | Estado atual | Estado proposto | Quantidade | Custo unitário conservador | Delta esperado/mês |
|---|---|---|---|---:|---:|---:|
| Cloud Run, cobrança por requisição | `southamerica-east1` | inexistente | serviço privado, 1 vCPU, 1 GiB, escala 0–1 | 4.500 vCPU-s e 4.500 GiB-s | US$ 0,000024/vCPU-s + US$ 0,0000025/GiB-s | US$ 0,12 |
| Requisições Cloud Run | `southamerica-east1` | inexistente | uma sessão e chamadas de controle para 100 fluxos | até 300 | US$ 0,40/milhão | < US$ 0,01 |
| Artifact Registry | `southamerica-east1` | repositório existente | imagem Chromium incremental de até 1,5 GiB | 1,5 GiB-mês | aproximadamente US$ 0,10/GiB-mês acima da franquia | US$ 0,15 |
| Tráfego entre os dois Cloud Run | `southamerica-east1` | inexistente | chamada autenticada na mesma região | até 0,2 GiB | sem cobrança na mesma região | US$ 0 |
| Saída do PDF ao usuário | internet | já prevista na avaliação 0005 | até 0,2 GiB no cenário esperado | 0,2 GiB | até US$ 0,19/GiB | US$ 0,04 |
| Logging padrão | `southamerica-east1` | existente | metadados técnicos, sem conteúdo | até 0,02 GiB | US$ 0,50/GiB após 50 GiB/projeto/mês | US$ 0 esperado |

Não há custo único de migração, backfill, recuperação ou saída de dados. Build e
scan da imagem usam a pipeline já existente; eventual custo de Cloud Build não
está autorizado e deverá permanecer dentro da franquia ou receber avaliação
separada.

## 3. Premissas e cenários

Preços consultados em 30/08/2026, em USD, antes de impostos e câmbio. Para não
depender da franquia gratuita, o cálculo de Cloud Run cobra todo o tempo ativo.
WebSockets são requisições ativas durante toda a conexão e, portanto, faturáveis.
Cada fluxo esperado mantém a sessão e o navegador ativos por 45 segundos,
incluindo inicialização, carregamento, espera humana curta e entrega. O limite
calcula 120 segundos por fluxo. O PDF médio tem 2 MiB.

| Direcionador | Base atual | Esperado | Limite operacional | Unidade |
|---|---:|---:|---:|---|
| Documentos assistidos | 0 | 100 | 2.000 | por mês |
| Tempo faturável | 0 | 4.500 | 240.000 | segundos/mês |
| Processamento | 0 | 4.500/4.500 | 240.000/240.000 | vCPU-s/GiB-s |
| Requisições internas | 0 | 300 | 6.000 | por mês |
| Imagem do container | 0 | 1,5 | 2 | GiB-mês incrementais |
| PDF entregue | 0 | 0,2 | 4 | GiB/mês |
| Logs da aplicação | 0 | 0,02 | 0,4 | GiB/mês, retenção padrão |

| Cenário | Cloud Run | Imagem | Egress de PDF | Logs | Total incremental |
|---|---:|---:|---:|---:|---:|
| Atual | US$ 0 | US$ 0 | US$ 0 | US$ 0 | US$ 0 |
| Validação esperada: 100 × 45 s | US$ 0,12 | US$ 0,15 | US$ 0,04 | US$ 0 | **US$ 0,31** |
| Reserva operacional esperada | US$ 0,02 | US$ 0 | US$ 0 | US$ 0 | **US$ 0,02** |
| **Total esperado arredondado** |  |  |  |  | **US$ 0,33** |
| Limite: 2.000 × 120 s | US$ 6,36 | US$ 0,20 | US$ 0,76 | US$ 0 | **US$ 7,32** |

O limite financeiro de US$ 10 preserva US$ 2,68 para cold starts maiores,
retries controlados e variação de tamanho. O sistema deve parar antes desse
limite; orçamento do Google Cloud é alerta, não hard cap.

## 4. Custos não cobertos automaticamente

- O Infracost estima a configuração declarada, mas não representa com precisão
  duração real de Cloud Run, tamanho de imagem, egress, logs ou franquias.
- Entrada de dados da internet no Google Cloud não é cobrada; a origem oficial
  pode impor limites próprios, mas nenhum conector pago está autorizado.
- O PDF sai ao usuário pelo gateway existente e mantém o limite já aprovado na
  avaliação 0005; ele foi repetido aqui para evitar subestimar o custo total do
  novo fluxo.
- Artifact Registry oferece 0,5 GiB-mês por conta sem cobrança, mas o cálculo
  conservador não desconta essa franquia porque ela pode estar consumida.
- Cloud Logging oferece 50 GiB/projeto/mês sem cobrança e 30 dias incluídos; não
  serão criados buckets de log nem retenção adicional.
- Impostos, conversão cambial, suporte e consumo de CI fora das franquias não
  estão incluídos.
- Não haverá IA, OCR, provedor de proxy, solver de CAPTCHA ou API externa paga.

## 5. Limites e condição de parada

- `min_instance_count = 0`, `max_instance_count = 1` e concorrência inicial 1;
- 1 vCPU, 1 GiB e timeout máximo de 120 segundos;
- uma única conexão autenticada conduz desafio, resposta humana e PDF; não há
  segundo pedido que dependa de afinidade de instância;
- no máximo um contexto ativo por instância e desafio válido somente durante a
  conexão, uso único e vínculo a usuário, processo e comunicação;
- queda ou timeout fecha o navegador e exige reinício seguro; reconexão nunca
  reutiliza o contexto anterior;
- nenhuma persistência de cookies, HTML, screenshot ou PDF após o fluxo;
- somente o gateway autenticado pode invocar o serviço; sem `allUsers`;
- o cliente nunca fornece URL; o gateway resolve a origem e aplica allowlist;
- navegação e sub-recursos limitados aos hosts oficiais exatos necessários;
- screenshot apenas do elemento validado do desafio, com tipo e dimensões
  limitados; URL, HTML, cookies e nomes de campos não chegam ao frontend;
- PDF máximo de 25 MiB, validação de assinatura `%PDF` e resposta `no-store`;
- sem retry automático de CAPTCHA, rotação de IP ou resolução automática;
- bloquear rollout se o plano criar qualquer recurso fora desta tabela, se
  Infracost exceder a base declarada, se houver finding High/Critical, se testes
  de isolamento falharem ou se a página oficial exigir controle incompatível;
- interromper a função ao projetar US$ 10 incremental, atingir 2.000 documentos
  no mês ou ultrapassar cinco falhas consecutivas da origem;
- qualquer aumento só pode ser aceito pelo proprietário do produto;
- esta estimativa expira em 30 de setembro de 2026 ou quando o Google alterar os
  preços, o que ocorrer primeiro.

## 6. Evidência e fontes

- [Cloud Run pricing](https://cloud.google.com/run/pricing), consultado em
  30/08/2026: cobrança por uso, CPU ativa de US$ 0,000024/vCPU-s, memória ativa
  de US$ 0,0000025/GiB-s e US$ 0,40/milhão de requisições na cobrança por
  requisição; tráfego entre serviços na mesma região não é cobrado.
- [Artifact Registry pricing](https://cloud.google.com/artifact-registry/pricing),
  consultado em 30/08/2026: primeiros 0,5 GiB-mês por conta sem cobrança e
  aproximadamente US$ 0,10/GiB-mês acima disso; tráfego para a mesma localização
  é gratuito.
- [Google Cloud network pricing](https://cloud.google.com/vpc/network-pricing),
  consultado em 30/08/2026: até US$ 0,19/GiB usado como teto conservador para
  saída de rede relevante.
- [Google Cloud Observability pricing](https://cloud.google.com/products/observability/pricing),
  consultado em 30/08/2026: primeiros 50 GiB de logs por projeto/mês sem cobrança,
  US$ 0,50/GiB excedente e 30 dias de retenção incluídos.
- [WebSockets no Cloud Run](https://cloud.google.com/run/docs/triggering/websockets),
  consultado em 30/08/2026: a conexão permanece na mesma instância durante sua
  vida, está sujeita ao timeout e mantém a instância faturável; afinidade só é
  melhor esforço para conexões subsequentes, por isso o fluxo não reconecta.
- Avaliação 0005: até US$ 0,05 para 100 PDFs e limite de US$ 10 no gateway
  autenticado existente.
- Estado observado em 30/08/2026: o serviço atual está em `southamerica-east1`,
  escala de 0 a 2 e concorrência 20; o Artifact Registry contém aproximadamente
  0,18 GiB em 223 arquivos. A imagem Chromium de até 1,5 GiB permanece uma
  hipótese conservadora a ser substituída pela medição do build.
- Plano Terraform e diff Infracost serão obrigatórios após aprovação. Esta
  avaliação, por si só, não executa `terraform apply`.

## 7. Aprovação

**Decisão: aprovado para implementação e rollout de validação em 30 de agosto
de 2026.** O proprietário registrou aprovação explícita após receber o custo e
os limites abaixo:

1. o novo serviço Cloud Run privado e sua imagem Chromium;
2. custo incremental esperado de US$ 0,33/mês;
3. limite incremental de US$ 10/mês e 2.000 documentos;
4. ausência de resolução automática de CAPTCHA;
5. validação humana e efêmera, sem persistência de documentos.

Aprovação de custo não autoriza commit, push, merge, deploy ou abertura pública.

## 8. Verificação posterior

| Data | Custo estimado | Custo real | Variação | Explicação | Ação |
|---|---:|---:|---:|---|---|
| D+1 | US$ 0,33/mês projetado | — | — | validar cold start e duração | manter ou rollback |
| D+7 | US$ 0,33/mês | — | — | medir custo por fluxo | manter, otimizar ou rollback |
| D+30 | US$ 0,33/mês | — | — | comparar volume e egress | revisar estimativa |

## 9. Evidência pós-implementação local

Em 30 de agosto de 2026, `infracost scan` avaliou os 20 recursos Terraform:
7 recursos com modelo de custo e 13 gratuitos. O valor estático apresentado foi
US$ 0/mês e não houve diagnóstico de configuração. Esse zero não substitui a
estimativa de uso acima: Cloud Run com escala a zero, duração de WebSocket,
Artifact Registry e tráfego dependem do consumo real e não são inferidos pelo
scan estático.

A política de exemplo da conta Infracost pediu tags `Service` e `Environment`.
Ela não altera o custo nem representa uma falha do projeto: os recursos Google
Cloud já usam os labels normalizados `application`, `environment` e
`managed_by`. Nenhuma exceção ou recurso foi aplicado na nuvem.

A imagem local do renderizador foi verificada com Trivy 0.74.0 após remover do
runtime o gerenciador npm, que não é necessário para executar o serviço. O
resultado final foi zero vulnerabilidades corrigíveis High ou Critical. O
scan também encontrou zero segredos High ou Critical. O Dockerfile passou
Hadolint e 12 verificações Checkov sem falhas.
