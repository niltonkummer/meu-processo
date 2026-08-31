# Avaliação de custo 0032 — contrato OpenAPI v1 local e gate de compatibilidade

<!-- infra-cost-assessment:v1 -->

**Status:** aprovado para implementação  
**Solicitado por:** proprietário do produto  
**Responsável:** engenharia do Meu Processo  
**Data da avaliação:** 31 de agosto de 2026  
**Ambientes afetados:** local e CI  
**Spec/issue:** FND-011 da Spec 0009 — API versionada

**Custo mensal atual (USD):** até US$ 0,38 já aprovado; execução local US$ 0  
**Custo mensal esperado (USD):** inalterado; delta US$ 0  
**Custo mensal limite (USD):** inalterado; este gate não pode consumir cloud  
**Aprovação:** proprietário, continuação explícita do plano em 31/08/2026,
restrita a arquivos versionados e validações locais/CI

## 1. Decisão

Versionar o contrato HTTP público de `/api/v1` em OpenAPI 3.1 e adicionar um
gate determinístico que valide a estrutura do documento e bloqueie alterações
incompatíveis em operações, parâmetros, corpos, respostas e autenticação.

O impacto de infraestrutura e custo é zero. A implementação reutilizará Node.js,
TypeScript, Vitest e o runner de CI já existentes. Não serão adicionados pacote,
serviço, banco, storage, chamada externa, recurso Terraform ou endpoint de
runtime para publicar a especificação.

## 2. Alteração de infraestrutura

| Componente/SKU | Região | Estado atual | Estado proposto | Quantidade | Custo unitário | Delta mensal |
|---|---|---|---|---:|---:|---:|
| Arquivo OpenAPI | repositório local | ausente | contrato JSON versionado | 1 | US$ 0 | US$ 0 |
| Validação de contrato | máquina local/runner CI | testes existentes | validação estrutural e de compatibilidade | 1 execução por pipeline | US$ 0 | US$ 0 |
| Dependências/serviços cloud | — | nenhuma para este gate | permanecem inalterados | 0 | — | US$ 0 |

Não há custo único de implantação, migração, backfill, recuperação ou egress.

## 3. Premissas e cenários

| Direcionador | Base atual | Esperado | Limite operacional | Unidade |
|---|---:|---:|---:|---|
| Documentos de contrato | 0 | 1 | 1 | arquivo OpenAPI v1 |
| Execuções locais | 0 | 1–10 | 50 | por dia de desenvolvimento |
| Execuções CI | 0 | 1–5 | 100 | por mês |
| Duração adicional | 0 | abaixo de 5 | 30 | segundos por pipeline |
| Chamadas de rede | 0 | 0 | 0 | por validação |
| Armazenamento externo | 0 | 0 | 0 | GiB-mês |

Os três cenários custam US$ 0 porque usam somente recursos locais ou minutos já
incluídos no runner público do repositório, sem dependência ou consumo externo.

## 4. Custos não cobertos automaticamente

- Cloud Run, Supabase, GCS, egress, filas, logs cloud, e-mail, APIs e IA: não
  consumidos.
- Infracost: não aplicável, pois nenhum arquivo Terraform será alterado.
- Pacotes npm: nenhum pacote novo será incluído.
- Impostos e câmbio: não aplicáveis ao delta zero.

## 5. Limites e condição de parada

- um único contrato para a versão pública `/api/v1`;
- validação exclusivamente offline, sem resolver referências remotas;
- nenhuma leitura de segredo, dado pessoal ou resposta processual real;
- a CI deve falhar quando uma operação, parâmetro, mídia, resposta, propriedade
  ou requisito de autenticação compatível for removido/enfraquecido;
- a primeira adoção pode registrar ausência de baseline; após o contrato entrar
  na branch-base, sua ausência ou leitura inválida deve falhar fechada;
- o incremento não publica Swagger UI nem novo endpoint;
- qualquer pacote, serviço, chamada externa, aumento de minutos faturáveis ou
  alteração Terraform exige nova avaliação aprovada;
- somente o proprietário pode aceitar aumento; validade até 30/09/2026 ou
  mudança de escopo, o que ocorrer primeiro.

## 6. Evidência e fontes

- Spec 0009, requisito FND-011;
- arquivo OpenAPI, testes unitários e execução do gate de compatibilidade serão
  anexados à implementação;
- Infracost dispensado por diff Terraform vazio;
- limitação: o gate cobre compatibilidade sintática do contrato HTTP v1 e não
  substitui testes de autorização, isolamento ou semântica de negócio.

## 7. Aprovação

Status **aprovado para implementação** local/CI. A continuação solicitada pelo
proprietário autoriza documentação, testes, código de validação e workflow desta
fatia. Não autoriza commit, push, deploy, recurso cloud, dado real ou chamada a
fonte externa.

## 8. Verificação posterior

Não há deploy ou custo externo a verificar em 7/30 dias. Uma futura publicação
do contrato ou portal de desenvolvedor exigirá avaliação própria.

| Data | Custo estimado | Custo real | Variação | Explicação | Ação |
|---|---:|---:|---:|---|---|
| 31/08/2026 | US$ 0 | US$ 0 | US$ 0 | contrato e gate locais | manter cloud desativada |
