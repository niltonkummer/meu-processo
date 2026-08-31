# Avaliação de custo 0043 — agregação de resultados e recuperação de publicação

<!-- infra-cost-assessment:v1 -->

**Status:** aprovado para implementação local e `validation`
**Solicitado por:** proprietário do produto
**Responsável:** engenharia do Meu Processo
**Data da avaliação:** 31 de agosto de 2026
**Ambientes afetados:** local e `validation` em `southamerica-east1`
**Spec/issue:** agregação dos resultados por perfil e correção do fluxo de
download assistido de publicação

**Custo mensal atual (USD):** até US$ 1,71 esperado; US$ 2,25 operacional,
considerando a fundação comercial já aprovada e ainda não publicada
**Custo mensal esperado (USD):** até US$ 1,71 fixo; delta incremental US$ 0
**Custo mensal limite (USD):** US$ 2,25 operacional; US$ 10,00 de segurança
**Aprovação:** proprietário do produto, autorização confirmada em 31/08/2026

## 1. Decisão

Autorizar duas correções antes da continuidade das funcionalidades comerciais:

1. apresentar cada perfil monitorado como uma lista tenant-scoped com nome ou
   rótulo minimizado, quantidade de processos e um resumo curto dos processos
   já associados àquele perfil;
2. tornar o download assistido de publicação observável e recuperável, detectar
   corretamente o elemento visual do CAPTCHA e manter a conclusão humana no
   painel antes de materializar o documento pelo fluxo já existente.

O impacto incremental esperado é **US$ 0/mês**. A mudança não cria crawler,
banco, cache, fila, serviço, instância mínima, secret, armazenamento ou chamada
externa adicional. A agregação deriva dos registros já persistidos. O fluxo de
publicação reutiliza o Cloud Run privado e a sessão máxima de 120 segundos já
aprovados.

Esta avaliação não autoriza resolução ou bypass automático de CAPTCHA. Quando a
origem exigir desafio, a plataforma apenas apresenta a imagem válida ao usuário
autenticado e envia a resposta no mesmo contexto efêmero.

## 2. Alteração de infraestrutura

| Componente/SKU | Região | Estado atual | Estado proposto | Quantidade | Delta mensal |
|---|---|---|---|---:|---:|
| Cloud Run da aplicação | `southamerica-east1` | escala 0–2 | mesmo serviço e capacidade | 1 | US$ 0 esperado |
| Cloud Run do renderer | `southamerica-east1` | escala 0–1, concorrência 1, sessão máxima 120 s | mesma capacidade; detecção mais precisa dentro da sessão | 1 | US$ 0 esperado |
| Supabase Postgres | gerenciado | fundação existente | consulta tenant-scoped sobre vínculos existentes | 1 projeto | US$ 0 esperado |
| Cloud Storage | `southamerica-east1` | materialização já aprovada | nenhum volume ou retenção adicional | 1 bucket | US$ 0 esperado |
| Logging | `southamerica-east1` | eventos técnicos categóricos | sem conteúdo, imagem ou identificador processual | existente | US$ 0 esperado |

Custos únicos de migração, backfill, recuperação e saída de dados: US$ 0. Não
há alteração Terraform ou novo recurso gerenciado.

## 3. Premissas e cenários

Os preços e a base financeira permanecem os da avaliação 0042, consultada em
31/08/2026. A avaliação 0008 continua governando o limite da sessão assistida do
TJRS. Valores em USD, sem impostos ou câmbio.

| Direcionador | Base atual | Esperado | Limite operacional | Unidade |
|---|---:|---:|---:|---|
| Perfis retornados por página | até 50 | até 50 | 50 | perfis/requisição |
| Processos resumidos por perfil | 0 | até 3 | 3 | itens/perfil |
| Consultas judiciais para compor a lista | 0 | 0 | 0 | consultas extras |
| Downloads assistidos | até 2.000 | sem aumento | 2.000 | por mês |
| Duração máxima por sessão | 120 | 120 | 120 | segundos |
| Tentativas automáticas adicionais | 0 | 0 | 0 | por solicitação |
| Armazenamento adicional | 0 | 0 | 0 | GiB-mês |
| Saída adicional | 0 | 0 | 0 | GiB/mês |

O resumo será paginado e limitado. Ele não iniciará busca ao abrir a tela e não
duplicará consultas por nome. Apenas processos ligados de forma explícita ao
perfil serão contados; similaridade de nome nunca autoriza vínculo ou união de
processos.

## 4. Custos não cobertos automaticamente

- **Cloud Run:** cobrança depende do uso, mas não há aumento de sessão, escala,
  memória, CPU ou quantidade autorizada de downloads.
- **Supabase:** a consulta agregada usa o projeto e o plano já aprovados, sem
  novo banco, réplica, extensão ou retenção.
- **Cloud Storage e egress:** não aumenta volume, retenção, tamanho nem número de
  documentos autorizados.
- **Logging:** somente estado categórico e duração; sem conteúdo sensível.
- **Firestore, cache, filas, e-mail, IA e APIs pagas:** não aplicável; não serão
  adicionados nesta mudança.
- **Infracost:** não existe diff Terraform esperado; o gate manual desta
  avaliação continua obrigatório.

## 5. Limites e condição de parada

- no máximo 50 perfis por página e três processos no resumo de cada perfil;
- contagem e resumo sempre filtrados pelo tenant autenticado e pelo vínculo
  explícito do perfil;
- nenhuma união por nome parecido, CPF/CNPJ parcial ou heurística de homônimo;
- sessão total máxima de 120 segundos, sem retry ou reconexão automática;
- escala 0–1, concorrência 1 e no máximo 2.000 documentos/mês no renderer;
- CAPTCHA permanece humano; ícone de áudio não pode ser tratado como imagem do
  desafio e uma resposta vazia nunca é enviada;
- PDF limitado a 25 MiB e sujeito às validações de origem, tipo e integridade já
  existentes;
- logs sem nome, CPF/CNPJ, CNJ, comunicação, URL, HTML, CAPTCHA ou conteúdo do
  documento;
- falha cross-tenant, mistura de processos, finding High/Critical, aumento de
  infraestrutura ou custo fixo acima de US$ 1,71 bloqueia a entrega;
- custo operacional acima de US$ 2,25 ou projeção total acima de US$ 10 exige
  interrupção e nova aprovação;
- cinco falhas consecutivas da origem acionam rollback/interrupção;
- somente o proprietário pode ampliar volume, duração, capacidade ou custo;
- validade até 30/09/2026 ou mudança de preço, arquitetura ou comportamento da
  origem.

## 6. Evidência e fontes

- [Avaliação 0042 — billing e descoberta](./0042-commercial-mvp-billing-and-discovery.md).
- avaliação 0008 do ramo de correção do TJRS — confiabilidade do download,
  sessão máxima de 120 segundos, escala 0–1 e teto de 2.000 documentos/mês;
- inspeção do modelo atual: perfis, alvos e vínculos já existem no Postgres; a
  listagem atual não retorna contagem ou resumo por perfil;
- inspeção do renderer atual: a descoberta considera imagem e canvas, mas ainda
  precisa distinguir a superfície visual do desafio de controles como áudio;
- limitação: CAPTCHA e disponibilidade da fonte oficial permanecem fatores
  externos e não existe garantia de download sem interação humana.

## 7. Aprovação

O proprietário aprovou em 31/08/2026 o avanço sem nova consulta quando o custo
total projetado permanecer em até US$ 10/mês. Esta avaliação projeta até
US$ 1,71 fixo, US$ 2,25 operacional e teto de US$ 10; portanto, libera spec,
testes e implementação local/validation dentro dos limites acima.

A autorização não libera commit, push, merge, deploy, produção, cobrança real,
novo risco relevante ou custo total projetado acima de US$ 10/mês.

## 8. Verificação posterior

| Data | Custo estimado | Custo real | Variação | Explicação | Ação |
|---|---:|---:|---:|---|---|
| D0 validation | até US$ 1,71 fixo | pendente | — | correções sem nova infraestrutura | smoke ou rollback |
| D+7 | até US$ 1,71 fixo | pendente | — | medir latência e sucesso | manter ou corrigir |
| D+30 | até US$ 1,71 fixo | pendente | — | recalibrar uso real | reaprovar ou encerrar |
