# Avaliação de custo 0033 — decomposição local dos handlers HTTP

<!-- infra-cost-assessment:v1 -->

**Status:** aprovado para implementação  
**Solicitado por:** proprietário do produto  
**Responsável:** engenharia do Meu Processo  
**Data da avaliação:** 31 de agosto de 2026  
**Ambientes afetados:** local e CI  
**Spec/issue:** etapa A da Spec 0009 — FND-001, FND-002 e FND-003

**Custo mensal atual (USD):** até US$ 0,38 já aprovado; execução local US$ 0  
**Custo mensal esperado (USD):** inalterado; delta US$ 0  
**Custo mensal limite (USD):** inalterado; esta fatia não pode consumir cloud  
**Aprovação:** proprietário, continuação explícita do plano em 31/08/2026,
restrita a refatoração comportamentalmente neutra, testes locais e CI

## 1. Decisão

Decompor `src/http/server.ts` em transporte compartilhado e handlers separados
por capacidade: sessão, busca, perfis monitorados, alertas, processos/documentos
e publicações. O servidor raiz ficará responsável apenas por composição do
roteamento, estáticos, health, WebSocket e tratamento de erro de último nível.

O impacto de infraestrutura e custo é zero. A mudança não altera o OpenAPI v1,
URLs, autenticação, autorização, headers, limites, DTOs, banco, frontend,
workers ou fontes. Não serão adicionados pacote, serviço, recurso Terraform,
chamada externa ou dado.

## 2. Alteração de infraestrutura

| Componente/SKU | Região | Estado atual | Estado proposto | Quantidade | Custo unitário | Delta mensal |
|---|---|---|---|---:|---:|---:|
| Código HTTP TypeScript | repositório local | servidor monolítico com 1.567 linhas | handlers por capacidade e servidor de composição | mesmos fluxos | US$ 0 | US$ 0 |
| Testes/CI | máquina local/runner CI | suíte e contrato v1 existentes | caracterização arquitetural adicional | 1 execução por pipeline | US$ 0 | US$ 0 |
| Runtime/dependências/cloud | — | configuração atual | permanecem inalterados | 0 | — | US$ 0 |

Não há custo único de implantação, migração, backfill, recuperação ou egress.

## 3. Premissas e cenários

| Direcionador | Base atual | Esperado | Limite operacional | Unidade |
|---|---:|---:|---:|---|
| Operações HTTP públicas | 15 | 15 | 15 | operações sem mudança |
| Arquivos de handler | 0 | 6–8 | 10 | arquivos locais |
| Dependências novas | 0 | 0 | 0 | pacotes |
| Chamadas externas de teste | 0 | 0 | 0 | chamadas |
| Duração adicional de CI | 0 | abaixo de 5 | 30 | segundos |
| Armazenamento/egress/logs cloud | 0 | 0 | 0 | consumo mensal |

O cenário esperado e o limite custam US$ 0 porque executam somente no ambiente
local e no runner já utilizado. Nenhuma linha de consumo da aplicação muda.

## 4. Custos não cobertos automaticamente

- Cloud Run, Supabase, GCS, filas, egress, logs cloud, e-mail, APIs e IA: não
  consumidos ou alterados.
- Infracost: não aplicável, pois nenhum arquivo Terraform será alterado.
- Pacotes npm: nenhum pacote novo.
- Impostos e câmbio: não aplicáveis ao delta zero.

## 5. Limites e condição de parada

- as 15 operações e seus `operationId` devem permanecer compatíveis;
- autenticação bearer, autorização tenant-bound, `private, no-store`, CSP,
  limites de corpo/taxa e respostas seguras não podem ser enfraquecidos;
- WebSocket assistido mantém path, payload máximo, autenticação e timeout;
- nenhum handler pode acessar estado global de request ou escolher tenant a
  partir de input não verificado;
- servidor raiz deve deixar de conter regra de capability; handlers devem ser
  registrados em ordem explícita e testada;
- refatoração para se a suíte de caracterização, OpenAPI ou isolamento falhar;
- qualquer mudança funcional, dependência, runtime, cloud ou custo exige spec e
  avaliação separadas;
- somente o proprietário pode aceitar aumento; validade até 30/09/2026 ou
  mudança de escopo, o que ocorrer primeiro.

## 6. Evidência e fontes

- Spec 0009 e Roadmap 0009, etapa A;
- OpenAPI v1 e gate de compatibilidade da implementação 0029;
- testes HTTP atuais como baseline de comportamento;
- Infracost dispensado por diff Terraform vazio;
- limitação: a fatia reduz acoplamento estrutural, mas não transforma todos os
  casos de uso ou erros de infraestrutura em contratos de aplicação.

## 7. Aprovação

Status **aprovado para implementação** local/CI. A continuação solicitada pelo
proprietário autoriza documentação, testes e refatoração TypeScript desta fatia.
Não autoriza commit, push, deploy, recurso cloud, fonte real ou dado pessoal.

## 8. Verificação posterior

Não há deploy ou custo externo a verificar em 7/30 dias.

| Data | Custo estimado | Custo real | Variação | Explicação | Ação |
|---|---:|---:|---:|---|---|
| 31/08/2026 | US$ 0 | US$ 0 | US$ 0 | refatoração local | manter cloud desativada |
